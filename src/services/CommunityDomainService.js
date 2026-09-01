// src/services/CommunityDomainService.js
// Domínio próprio do site da comunidade (mig 214).
//
// O fluxo tem três etapas, e elas são separadas porque falham por motivos
// diferentes e o dono precisa saber QUAL delas está pendente:
//
//   1. reivindicar → a plataforma guarda o pedido e devolve um token
//   2. provar posse → a pessoa cria o TXT; nós conferimos no DNS
//   3. entrar no ar → o provedor emite o certificado
//
// Juntar tudo num botão só produziria a pior mensagem de erro possível
// ("não funcionou"), quando a pessoa precisa saber se falta ela criar um
// registro ou se falta a gente esperar.
//
// A verificação por TXT NÃO é burocracia: sem ela qualquer usuário logado
// cadastra um domínio alheio e a plataforma passa a pedir certificado — e um
// dia a servir conteúdo — sob um nome que não é dela.

const dns = require("node:dns").promises;
const crypto = require("node:crypto");

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const CommunityDomainStorage = require("../storages/CommunityDomainStorage");
const CommunitySiteStorage = require("../storages/CommunitySiteStorage");
const Domain = require("../utils/communityDomain");
const { getProvider, resolveProviderName } = require("../integrations/domains/provider");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunityDomainService");

/** Teto por comunidade. Domínio custa certificado; ninguém precisa de 50. */
const MAX_DOMAINS = 3;

const REASON = {
  empty: "Informe o domínio.",
  too_long: "Domínio longo demais.",
  not_fqdn: "Use um domínio completo, como exemplo.com.br.",
  label_length: "Uma das partes do domínio é longa demais.",
  label_format: "Use apenas letras, números e hífen no domínio.",
  ip_like: "Isso parece um IP, não um domínio.",
  platform: "Este domínio pertence à plataforma.",
};

/** Nunca devolve o token de outra pessoa nem o estado cru do provedor. */
function toPublic(row) {
  return {
    id_domain: Number(row.id_domain),
    domain: row.domain,
    status: row.status,
    verified_at: row.verified_at,
    provider: row.provider,
    last_error: row.last_error,
    last_checked_at: row.last_checked_at,
    created_at: row.created_at,
    // Instruções de DNS: o que a pessoa precisa copiar para o painel do
    // registrador dela. Vão junto porque a tela sem isso é inútil.
    verification: {
      host: Domain.verificationHost(row.domain),
      type: "TXT",
      value: Domain.verificationValue(row.verification_token),
    },
  };
}

async function assertLeader(id_user, id_profile) {
  if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };
  const community = await CommunityStorage.getById(pool, id_profile);
  if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
  if (String(community.id_leader_user) !== String(id_user)) {
    return { error: "Apenas o líder pode gerenciar os domínios do site." };
  }
  return { community };
}

/**
 * Procura o TXT de verificação.
 *
 * Erro de DNS (NXDOMAIN, timeout) é tratado como "ainda não achei", não como
 * falha da operação: o caso esmagadoramente comum é a pessoa ter acabado de
 * criar o registro e a propagação não ter chegado. Transformar isso em erro
 * faria o painel gritar por algo que se resolve sozinho em minutos.
 */
async function lookupVerification(domain, token) {
  const host = Domain.verificationHost(domain);
  const expected = Domain.verificationValue(token);
  try {
    const records = await dns.resolveTxt(host);
    // resolveTxt devolve array de arrays: um TXT longo vem partido em pedaços
    // de 255 bytes e precisa ser remontado antes de comparar.
    const values = records.map((chunks) => chunks.join("").trim());
    return { found: values.includes(expected), values };
  } catch (err) {
    return { found: false, values: [], dnsError: err?.code || "DNS_ERROR" };
  }
}

class CommunityDomainService {
  static async list(user, params) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await assertLeader(user?.id_user, params.id_profile);
        if (guard.error) return guard;

        const rows = await CommunityDomainStorage.listByProfile(pool, params.id_profile);
        const slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);
        return {
          domains: rows.map(toPublic),
          slug,
          provider: resolveProviderName(),
          max_domains: MAX_DOMAINS,
        };
      }
    );
  }

  /** Etapa 1: reivindicar. Não fala com DNS nem com provedor ainda. */
  static async create(user, params, body) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const guard = await assertLeader(user?.id_user, params.id_profile);
        if (guard.error) return guard;

        const verdict = Domain.validateDomain(body?.domain);
        if (!verdict.ok) {
          return { error: REASON[verdict.reason] || "Domínio inválido." };
        }

        const count = await CommunityDomainStorage.countByProfile(pool, params.id_profile);
        if (count >= MAX_DOMAINS) {
          return { error: `Limite de ${MAX_DOMAINS} domínios por comunidade.` };
        }

        // O site precisa ter endereço próprio para o domínio ter para onde
        // apontar — sem slug, o roteamento por Host não sabe o que renderizar.
        const slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);
        if (!slug) {
          return { error: "Publique o site antes de ligar um domínio próprio." };
        }

        const token = crypto.randomBytes(16).toString("hex");
        const row = await CommunityDomainStorage.create(pool, {
          id_profile: params.id_profile,
          domain: verdict.domain,
          token,
          provider: resolveProviderName(),
        });
        if (row?.taken) {
          return { error: "Este domínio já está ligado a outra comunidade.", statusCode: 409 };
        }
        return { domain: toPublic(row) };
      }
    );
  }

  /**
   * Etapas 2 e 3 no mesmo botão: confere o TXT e, se a posse estiver provada,
   * pede o certificado ao provedor.
   *
   * São o mesmo botão porque, do ponto de vista de quem usa, existe uma ação só
   * ("já criei o registro, confere aí") — mas o RESULTADO distingue as duas, e
   * é isso que aparece na tela.
   */
  static async verify(user, params) {
    return runWithLogs(
      log,
      "verify",
      () => ({ id_user: user?.id_user, id_domain: params?.id_domain }),
      async () => {
        const guard = await assertLeader(user?.id_user, params.id_profile);
        if (guard.error) return guard;

        const row = await CommunityDomainStorage.getById(pool, params.id_domain);
        if (!row || String(row.id_profile) !== String(params.id_profile)) {
          return { error: "Domínio não encontrado", statusCode: 404 };
        }

        const dnsResult = await lookupVerification(row.domain, row.verification_token);
        if (!dnsResult.found) {
          const updated = await CommunityDomainStorage.updateState(pool, row.id_domain, {
            // Volta para 'pending', nunca para 'error': não achar o TXT quase
            // sempre é propagação em curso, e 'error' assustaria à toa.
            status: "pending",
            verified: false,
            provider_state: null,
            last_error: dnsResult.dnsError
              ? `DNS ainda não respondeu (${dnsResult.dnsError}).`
              : "Registro TXT ainda não encontrado.",
          });
          return { domain: toPublic(updated), verified: false };
        }

        const provider = getProvider();
        const result = await provider.addDomain(row.domain);

        const updated = await CommunityDomainStorage.updateState(pool, row.id_domain, {
          status: result.ok ? (result.active ? "active" : "verified") : "error",
          verified: true,
          provider_state: result.state,
          last_error: result.ok ? null : result.error,
        });
        return { domain: toPublic(updated), verified: true };
      }
    );
  }

  /**
   * Reconsulta o provedor. Existe separado do `verify` porque no modo manual o
   * certificado sai DEPOIS, por ação de outra pessoa — e o dono precisa de um
   * jeito de perguntar "já saiu?" sem refazer a prova de posse.
   */
  static async refresh(user, params) {
    return runWithLogs(
      log,
      "refresh",
      () => ({ id_user: user?.id_user, id_domain: params?.id_domain }),
      async () => {
        const guard = await assertLeader(user?.id_user, params.id_profile);
        if (guard.error) return guard;

        const row = await CommunityDomainStorage.getById(pool, params.id_domain);
        if (!row || String(row.id_profile) !== String(params.id_profile)) {
          return { error: "Domínio não encontrado", statusCode: 404 };
        }
        if (!row.verified_at) {
          return { error: "Verifique a posse do domínio antes.", statusCode: 409 };
        }

        const result = await getProvider().checkDomain(row.domain);
        const updated = await CommunityDomainStorage.updateState(pool, row.id_domain, {
          status: result.ok ? (result.active ? "active" : "verified") : "error",
          verified: true,
          provider_state: result.state,
          last_error: result.ok ? null : result.error,
        });
        return { domain: toPublic(updated) };
      }
    );
  }

  static async remove(user, params) {
    return runWithLogs(
      log,
      "remove",
      () => ({ id_user: user?.id_user, id_domain: params?.id_domain }),
      async () => {
        const guard = await assertLeader(user?.id_user, params.id_profile);
        if (guard.error) return guard;

        const row = await CommunityDomainStorage.getById(pool, params.id_domain);
        if (!row || String(row.id_profile) !== String(params.id_profile)) {
          return { error: "Domínio não encontrado", statusCode: 404 };
        }

        // O provedor é avisado ANTES de apagar a linha. Se apagássemos primeiro
        // e a chamada falhasse, o domínio ficaria órfão lá — ativo no provedor,
        // invisível para nós, e ninguém teria como removê-lo pela aplicação.
        try {
          await getProvider().removeDomain(row.domain);
        } catch (err) {
          log.warn("provider.remove.failed", { domain: row.domain, err: err?.message });
        }
        await CommunityDomainStorage.remove(pool, row.id_domain);
        return { removed: true };
      }
    );
  }

  /**
   * Resolve Host → site. Porta PÚBLICA, chamada a cada visita vinda de domínio
   * próprio — por isso é uma consulta só e não carrega nada além do necessário
   * para o roteamento.
   */
  static async resolveHost(params) {
    return runWithLogs(
      log,
      "resolveHost",
      () => ({ host: params?.host }),
      async () => {
        const domain = Domain.normalizeDomain(params?.host);
        if (!domain) return { error: "Host inválido", statusCode: 404 };

        const row = await CommunityDomainStorage.resolveActive(pool, domain);
        if (!row || !row.slug) return { error: "Host não encontrado", statusCode: 404 };
        return { domain: row.domain, slug: row.slug, id_profile: row.id_profile };
      }
    );
  }
}

module.exports = CommunityDomainService;
module.exports.MAX_DOMAINS = MAX_DOMAINS;
