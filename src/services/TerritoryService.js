// src/services/TerritoryService.js
// Resolução de endereço → território → unidade (subsistema 2 do desenho macro).
//
// O ponto honesto do modelo (§6.2 do spec): NENHUMA fonte externa gratuita
// confirma que você mora no número 123. O ViaCEP valida o CEP e o logradouro —
// não o morador. Então a divisão é:
//
//   território → provado pelo ViaCEP (externo e forte)
//   unidade    → provado por pessoas (reconhecimento dos co-moradores) e, só
//                em divergência, por documento — isso é o subsistema 3
//
// A máquina garante o ONDE; as pessoas garantem o QUEM.
//
// Degradação: o ViaCEP é serviço público sem SLA e está no caminho crítico da
// entrada, então ele NUNCA bloqueia. Cache primeiro; se faltar, o endereço é
// aceito como não-verificado e reprocessado depois.

const pool = require("../databases");
const TerritoryStorage = require("../storages/TerritoryStorage");
const { lookupZipcode } = require("../integrations/viacep/lookup");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("TerritoryService");

// Quanto tempo uma linha do cache é considerada fresca. Endereço dos Correios
// muda com frequência baixíssima; 90 dias evita bater no serviço à toa.
const CACHE_TTL_DAYS = 90;

// Rótulo do território quando o CEP é único da cidade (municípios pequenos
// costumam ter um CEP só, sem bairro nem logradouro).
const CITY_WIDE_LABEL = "Cidade inteira";

function onlyDigits(v) {
  return String(v || "").replace(/\D/g, "");
}

function isFresh(row) {
  if (!row?.fetched_at) return false;
  const age = Date.now() - new Date(row.fetched_at).getTime();
  return age < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

class TerritoryService {
  /**
   * Resolve um CEP em dados de endereço, com cache e degradação.
   *
   * @returns {Promise<{source:"cache"|"viacep"|"unavailable", data:object|null}>}
   *   `data` null com source 'unavailable' significa: o serviço não respondeu e
   *   não havia cache — o chamador decide se aceita o cadastro como pendente.
   */
  static async lookupCep(cep, conn = pool) {
    const digits = onlyDigits(cep);
    if (digits.length !== 8) return { source: "invalid", data: null };

    const cached = await TerritoryStorage.getCachedCep(conn, digits);
    if (cached && isFresh(cached)) {
      if (cached.not_found) return { source: "cache", data: null, not_found: true };
      return { source: "cache", data: cached };
    }

    let fetched = null;
    try {
      fetched = await lookupZipcode(digits);
    } catch (err) {
      // lookupZipcode já engole erro de rede, mas nunca confiar nisso: este
      // caminho não pode derrubar um cadastro.
      log.warn("lookupCep.fetch_fail", { cep: digits, error: err?.message });
    }

    if (fetched) {
      const saved = await TerritoryStorage.putCachedCep(conn, {
        cep: digits,
        logradouro: fetched.logradouro,
        bairro: fetched.bairro,
        localidade: fetched.localidade,
        uf: fetched.uf,
        not_found: false,
      });
      return { source: "viacep", data: saved };
    }

    // Não respondeu. Cache velho ainda serve — é melhor que travar a entrada.
    if (cached && !cached.not_found) {
      log.info("lookupCep.stale_cache", { cep: digits });
      return { source: "cache", data: cached, stale: true };
    }

    return { source: "unavailable", data: null };
  }

  /**
   * O caminho principal: CEP + número (+ complemento) viram a árvore inteira.
   *
   * Devolve `verified: false` quando o território não pôde ser confirmado pelo
   * ViaCEP — nesse caso NADA é criado, porque um território inventado a partir
   * de um CEP não resolvido contaminaria a base de bairros. Quem chama decide
   * o que fazer (o subsistema 3 registra o pedido como pendente de verificação).
   */
  static async resolveResidence({ cep, numero, complemento = null }, conn = pool) {
    return runWithLogs(
      log,
      "resolveResidence",
      // O CEP e o número NÃO entram no log (§11 do desenho): dado de residência
      // não vai para telemetria. Só o suficiente para achar o problema.
      () => ({ cep_prefix: onlyDigits(cep).slice(0, 5) || null }),
      async () => {
        const digits = onlyDigits(cep);
        if (digits.length !== 8) {
          return { error: "CEP inválido.", statusCode: 400 };
        }
        const num = String(numero || "").trim();
        if (!num) return { error: "Informe o número.", statusCode: 400 };

        const lookup = await this.lookupCep(digits, conn);

        if (lookup.not_found) {
          return { error: "CEP não encontrado.", statusCode: 400 };
        }
        if (!lookup.data) {
          // ViaCEP fora do ar e sem cache: aceita como não-verificado, mas não
          // cria território nenhum.
          return { verified: false, reason: "cep_service_unavailable" };
        }

        const { bairro, localidade, uf } = lookup.data;
        if (!localidade || !uf) {
          return { verified: false, reason: "cep_incomplete" };
        }

        // Cidade com CEP único: o ViaCEP devolve sem bairro. O território nasce
        // abrangente da cidade em vez de o cadastro travar (§6.4).
        const isCityWide = !bairro || !String(bairro).trim();
        const territory = await TerritoryStorage.getOrCreateTerritory(conn, {
          uf,
          municipio: localidade,
          bairro: isCityWide ? CITY_WIDE_LABEL : bairro,
          is_city_wide: isCityWide,
        });
        if (!territory) {
          return { error: "Não foi possível resolver o território.", statusCode: 500 };
        }

        const address = await TerritoryStorage.getOrCreateAddress(conn, {
          id_territory: territory.id_territory,
          cep: digits,
          numero: num,
        });
        if (!address) {
          return { error: "Não foi possível registrar o endereço.", statusCode: 500 };
        }

        const unit = await TerritoryStorage.getOrCreateUnit(conn, {
          id_address: address.id_address,
          label: complemento,
          source: "claimed",
        });
        if (!unit) {
          return { error: "Não foi possível registrar a unidade.", statusCode: 500 };
        }

        return {
          verified: true,
          territory,
          address,
          unit,
          // Logradouro vem do CEP e é devolvido só para EXIBIÇÃO — não é
          // persistido em lugar nenhum (D4).
          logradouro: lookup.data.logradouro || null,
        };
      }
    );
  }

  /**
   * Planta do condomínio a partir de torres × andares × apartamentos (D10).
   * É um PONTO DE PARTIDA, não a verdade: condomínio real tem torre com número
   * de andares diferente, prédio sem 13º andar, cobertura e loja térrea — o
   * gestor edita depois. Por isso a geração é idempotente e aditiva.
   *
   * @param {number} floors      andares por torre
   * @param {number} perFloor    apartamentos por andar
   * @param {number[]} blockIds  blocos já criados (vazio = condomínio sem torres)
   */
  static buildUnitGrid({ floors, perFloor, blockIds = [] }) {
    const f = Math.max(1, Math.min(Number(floors) || 0, 200));
    const p = Math.max(1, Math.min(Number(perFloor) || 0, 50));
    const blocks = Array.isArray(blockIds) && blockIds.length ? blockIds : [null];

    const entries = [];
    for (const id_block of blocks) {
      for (let floor = 1; floor <= f; floor += 1) {
        for (let n = 1; n <= p; n += 1) {
          // Numeração brasileira usual: andar + sequencial de dois dígitos
          // (101, 102, 201, 202...).
          entries.push({ id_block, label: `${floor}${String(n).padStart(2, "0")}` });
        }
      }
    }
    return entries;
  }

  static async generateCondoUnits({ id_address, floors, perFloor, blockIds }, conn = pool) {
    return runWithLogs(
      log,
      "generateCondoUnits",
      () => ({ id_address, floors, perFloor, blocks: blockIds?.length || 0 }),
      async () => {
        const entries = this.buildUnitGrid({ floors, perFloor, blockIds });
        if (!entries.length) {
          return { error: "Informe andares e apartamentos por andar.", statusCode: 400 };
        }
        if (entries.length > 5000) {
          return { error: "Planta grande demais para gerar de uma vez.", statusCode: 400 };
        }
        const created = await TerritoryStorage.bulkCreateUnits(conn, id_address, entries);
        return { requested: entries.length, created };
      }
    );
  }
}

module.exports = TerritoryService;
