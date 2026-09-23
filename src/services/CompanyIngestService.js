// src/services/CompanyIngestService.js
// O PIPELINE: um `CompanyDraft` de qualquer fonte vira (ou atualiza) uma linha
// de `tb_company`, com a proveniência registrada.
//
//   draft (de um provider)
//     ↓  normalizeDraft()      — completa o que a fonte não derivou
//     ↓  isSuppressed()        — opt-out ANTES de criar (LGPD)
//     ↓  findCandidates()      — reduz o universo
//     ↓  matchScore()          — pontua cada candidato
//     ↓  mergeOrCreate()       — funde acima do limiar, cria abaixo
//     ↓  applyFields()         — campo a campo, com resolução de conflito
//     ↓  recordSource()        — de onde veio cada valor
//     ↓  scoreCompany()        — a nota da linha
//
// ⚠️ TODO CAMINHO DE ESCRITA EM `tb_company` PASSA POR AQUI. Um provider que
// escreva direto na storage pula o matching (criando a quarta cópia da mesma
// academia), pula o opt-out (recriando quem pediu para sair) e pula a
// resolução de conflito (deixando o rodapé do site apagar a Receita Federal).

const pool = require("../databases");
const CompanyStorage = require("../storages/CompanyStorage");
const N = require("../utils/companyNormalize");
const { shouldReplace, fieldConfidence, scoreCompany } = require("../utils/companyConfidence");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CompanyIngestService");

/**
 * Campos que a proveniência acompanha.
 *
 * ⚠️ É DE PROPÓSITO QUE ELA NÃO COBRE TODOS. Guardar uma linha de
 * `tb_company_source` para cada um dos 30 campos de cada empresa, por fonte,
 * multiplicaria a tabela por dez para responder "de onde veio o complemento do
 * endereço" — pergunta que ninguém faz. Estes são os que a tela mostra, os que
 * têm conflito real entre fontes e os que alguém pode querer contestar.
 */
const TRACKED_FIELDS = Object.freeze([
  "display_name", "legal_name", "trade_name", "cnpj", "phone", "whatsapp",
  "email", "website", "instagram", "facebook", "linkedin", "tiktok", "youtube",
  "address", "city", "uf", "zip_code", "latitude", "longitude",
  "category_key", "main_cnae", "reg_status", "company_size",
  "share_capital_cents", "opened_at",
]);

class CompanyIngestService {
  /**
   * Completa o que a fonte não derivou.
   *
   * ⚠️ ISTO É REDE DE SEGURANÇA, NÃO O LUGAR DA NORMALIZAÇÃO. Cada provider já
   * normaliza o que devolve (é o contrato). Aqui só se garante que domínio,
   * cidade normalizada e o nome de tela existam — se um provider novo esquecer,
   * a linha nasce inconsistente e nunca mais casa com nada, o que é um defeito
   * mudo.
   */
  static normalizeDraft(draft = {}) {
    const f = { ...(draft.fields || {}) };
    f.display_name = String(
      f.display_name || f.trade_name || f.legal_name || ""
    ).trim().slice(0, 300);
    if (f.website && !f.domain) f.domain = N.normalizeDomain(f.website);
    if (f.city) f.city_norm = N.normalizeCity(f.city);
    if (f.uf) f.uf = String(f.uf).toUpperCase().slice(0, 2);
    if (f.cnpj) f.cnpj = N.normalizeCnpj(f.cnpj);
    f.name_norm = N.normalizeName(f.display_name);
    // ⚠️ O `osm_ref` CHEGA NO NÍVEL DO RASCUNHO E PRECISA DESCER PARA OS
    // CAMPOS. Sem esta linha, `findMatch` recebia `draft.fields` — sem
    // `osm_ref` — e a busca por identidade do OSM NUNCA rodava: o dedupe só
    // acontecia por acidente, quando a heurística de telefone/nome casava, e
    // caía num `ON CONFLICT DO NOTHING` sem alvo quando ela não casava. Foi a
    // suíte que pegou, pelo caminho da empresa suprimida.
    if (draft.osm_ref && !f.osm_ref) f.osm_ref = draft.osm_ref;
    return { ...draft, fields: f };
  }

  /**
   * Acha a empresa existente que este rascunho representa.
   *
   * A ordem é a do pedido, e ela não é gosto: CNPJ e `osm_ref` são
   * IDENTIDADE (uma consulta direta, sem pontuação), o resto é INDÍCIO e
   * precisa passar pelo limiar.
   *
   * ⚠️ NA DÚVIDA, NÃO FUNDE. Abaixo de `MATCH_THRESHOLD` a empresa nasce
   * separada. Fundir errado é irreversível na prática — os campos se misturam e
   * ninguém sabe mais o que veio de onde — e produz o pior estrago possível
   * aqui: o telefone de uma empresa no card de outra, que o vendedor vai usar.
   * Não fundir só deixa duas linhas parecidas na tela.
   */
  static async findMatch(conn, fields) {
    if (fields.cnpj) {
      const byCnpj = await CompanyStorage.findByCnpj(conn, fields.cnpj);
      if (byCnpj) return { company: byCnpj, score: 1, via: "cnpj" };
    }
    if (fields.osm_ref) {
      const byOsm = await CompanyStorage.findByOsmRef(conn, fields.osm_ref);
      if (byOsm) return { company: byOsm, score: 1, via: "osm_ref" };
    }

    const candidates = await CompanyStorage.findCandidates(conn, fields);
    let best = null;
    for (const cand of candidates) {
      const score = N.matchScore(fields, cand);
      if (!best || score > best.score) best = { company: cand, score, via: "heuristic" };
    }
    if (best && best.score >= N.MATCH_THRESHOLD) return best;
    return null;
  }

  /**
   * Aplica os campos do rascunho sobre a empresa, campo a campo.
   *
   * ⚠️ CADA CAMPO É UMA DECISÃO SEPARADA, e é isso que faz a base melhorar em
   * vez de oscilar. O crawler pode ter um Instagram melhor que o OSM e um
   * telefone pior que a Receita, na MESMA visita: decidir o rascunho inteiro de
   * uma vez faria o pior campo entrar de carona com o melhor.
   */
  static async applyFields(conn, company, draft, source) {
    const fields = draft.fields || {};
    const current = await CompanyStorage.winningSources(conn, company.id_company);
    const patch = {};
    const provenance = [];

    for (const [key, value] of Object.entries(fields)) {
      if (["name_norm", "city_norm"].includes(key)) continue;
      if (value === null || value === undefined || String(value).trim() === "") continue;

      const replace = shouldReplace({
        field: key,
        currentValue: company[key],
        currentSource: current[key] || null,
        nextValue: value,
        nextSource: source,
      });
      if (replace) patch[key] = value;

      // ⚠️ A PROVENIÊNCIA É GRAVADA MESMO QUANDO A FONTE PERDE. É ela que
      // responde "a Receita diz outro telefone" na ficha, e é ela que permite
      // reverter uma decisão de precedência depois sem ter que re-crawlear
      // tudo. Gravar só o vencedor jogaria fora a informação mais útil de um
      // conflito: que houve conflito.
      if (TRACKED_FIELDS.includes(key)) {
        provenance.push({ field: key, value, confidence: fieldConfidence(key, source) });
      }
    }

    // A região é derivada, nunca vem da fonte: ela é a régua interna da
    // plataforma (mig 121) e só a plataforma sabe resolvê-la.
    const uf = patch.uf || company.uf;
    const city = patch.city || company.city;
    if (uf && city && !company.id_region) {
      const id_region = await CompanyStorage.resolveRegion(conn, uf, city);
      if (id_region) patch.id_region = id_region;
    }

    let updated = company;
    if (Object.keys(patch).length) {
      updated = (await CompanyStorage.updateFields(conn, company.id_company, patch)) || company;
    }

    for (const pv of provenance) {
      await CompanyStorage.recordSource(conn, {
        id_company: company.id_company,
        field: pv.field,
        value: pv.value,
        source,
        source_url: draft.source_url || null,
        confidence: pv.confidence,
      });
    }

    return { company: updated, changed: Object.keys(patch) };
  }

  /** Recalcula a nota 0..100 da linha a partir das fontes vencedoras. */
  static async rescore(conn, id_company, { status, touched } = {}) {
    const company = await CompanyStorage.getById(conn, id_company);
    if (!company) return null;
    const sources = await CompanyStorage.winningSources(conn, id_company);
    const confidence = scoreCompany(company, sources);
    await CompanyStorage.setEnrichment(conn, id_company, {
      confidence,
      status: status || null,
      touched: touched || [],
    });
    return { ...company, confidence };
  }

  /**
   * O ponto de entrada. Recebe um rascunho, devolve a empresa.
   *
   * `conn` é parâmetro para que a descoberta possa ingerir centenas de
   * rascunhos dentro de UMA transação — sem isso, uma varredura de cidade
   * abriria e fecharia conexão 400 vezes.
   */
  static async ingest(conn, rawDraft, source, { skipSuppressionCheck = false } = {}) {
    const draft = this.normalizeDraft(rawDraft);
    const f = draft.fields;

    if (!skipSuppressionCheck) {
      const blocked = await CompanyStorage.isSuppressed(conn, {
        cnpj: f.cnpj,
        domain: f.domain,
        email: f.email,
      });
      // ⚠️ RECONHECER O PEDIDO ANTES DE CRIAR é o que faz o opt-out durar. Se
      // a checagem fosse só na leitura, a varredura da semana que vem recriaria
      // a linha e ela voltaria à vitrine como se nada tivesse sido pedido.
      if (blocked) return { skipped: "suprimida" };
    }

    const match = await this.findMatch(conn, f);
    if (match) {
      // ⚠️ IDENTIDADE ACHA ATÉ O QUE ESTÁ SUPRIMIDO, de propósito: `findByCnpj`
      // e `findByOsmRef` não filtram `suppressed_at` — é assim que a plataforma
      // RECONHECE quem pediu para sair em vez de criar uma linha nova para a
      // mesma empresa. Reconhecer é o ponto; TOCAR é que não pode.
      //
      // Sem este guard, a varredura seguinte encontraria a empresa suprimida
      // pelo `osm_ref` e a atualizaria normalmente — o opt-out duraria até a
      // próxima passagem do worker, sem erro nenhum aparecer.
      if (match.company.suppressed_at) return { skipped: "suprimida" };
      const { company, changed } = await this.applyFields(conn, match.company, draft, source);
      return { company, created: false, matched_via: match.via, match_score: match.score, changed };
    }

    // ⚠️ NOME É EXIGÊNCIA DE **CRIAR**, NÃO DE ATUALIZAR — e a suíte pegou a
    // diferença. O guard ficava no topo e barrava todo rascunho sem nome,
    // inclusive o de ENRIQUECIMENTO: o crawler devolve e-mail, WhatsApp e redes,
    // e não devolve nome nenhum (ele não tem como saber o nome melhor que quem
    // já está na linha). Com o guard lá em cima, enriquecer por este caminho era
    // um no-op silencioso — e só não mordeu em produção porque o worker chama
    // `applyFields` direto. Aqui a exigência fica onde ela de fato vale.
    if (!f.display_name) return { skipped: "sem_nome" };

    let created = await CompanyStorage.insert(conn, {
      ...f,
      osm_ref: draft.osm_ref || f.osm_ref || null,
    });

    // ⚠️ `ON CONFLICT DO NOTHING` DEVOLVE VAZIO NUMA CORRIDA. Dois workers
    // ingerindo o mesmo CNPJ no mesmo instante: um insere, o outro recebe
    // `null`. Tratar isso como falha perderia a empresa; re-buscar transforma a
    // corrida em no-op, que é o que ela é.
    if (!created) {
      const again = await this.findMatch(conn, f);
      if (!again) return { skipped: "conflito_sem_alvo" };
      const { company, changed } = await this.applyFields(conn, again.company, draft, source);
      return { company, created: false, matched_via: "race", match_score: 1, changed };
    }

    const { company } = await this.applyFields(conn, created, draft, source);
    return { company, created: true, matched_via: null, match_score: null };
  }

  /** Ingestão em lote (o que a descoberta produz), numa transação só. */
  static async ingestMany(drafts, source, { id_profile } = {}) {
    return runWithLogs(
      log,
      "ingestMany",
      () => ({ source, count: drafts?.length || 0, id_profile }),
      async () => {
        const conn = await pool.connect();
        const out = { created: 0, updated: 0, skipped: 0, ids: [] };
        try {
          await conn.query("BEGIN");
          for (const draft of drafts || []) {
            const r = await this.ingest(conn, draft, source);
            if (r.skipped) {
              out.skipped++;
              continue;
            }
            if (r.created) out.created++;
            else out.updated++;
            out.ids.push(r.company.id_company);
          }
          await conn.query("COMMIT");
        } catch (err) {
          await conn.query("ROLLBACK").catch(() => {});
          throw err;
        } finally {
          conn.release();
        }

        // ⚠️ O RESCORE RODA FORA DA TRANSAÇÃO, de propósito: ele é uma leitura
        // seguida de um UPDATE por empresa, e segurar uma transação aberta por
        // 400 dessas travaria as linhas durante toda a varredura.
        for (const id of out.ids) {
          await this.rescore(pool, id, { touched: [source] }).catch(() => {});
        }
        return out;
      }
    );
  }
  /**
   * Ingestão em LOTE de uma partição inteira (o caminho do R2).
   *
   * ⚠️ POR QUE UM SEGUNDO CAMINHO EM VEZ DE OTIMIZAR O PRIMEIRO. `ingestMany`
   * resolve conflito de fonte campo a campo, e é isso que impede o crawler de
   * apagar o telefone da Receita — não dá para acelerá-lo sem afrouxar a régua.
   * Aqui a régua não tem o que decidir: a empresa **não existe**, então esta é
   * a primeira e única fonte a falar sobre cada campo dela.
   *
   * ⚠️ QUEM JÁ EXISTE NÃO PASSA POR AQUI. Volta para `ingestMany`, campo a
   * campo, porque ali sim há duas fontes disputando. Num reabastecimento novo
   * isso costuma ser um punhado de linhas.
   *
   * Medido em SP/bar: 5.556 rascunhos que levariam ~110 mil idas ao banco
   * passam a ~30.
   */
  static async ingestPartition(drafts, source, { chunk = 400 } = {}) {
    return runWithLogs(
      log,
      "ingestPartition",
      () => ({ source, count: drafts?.length || 0 }),
      async () => {
        const out = { created: 0, updated: 0, skipped: 0, reused: 0 };
        const prepared = [];
        for (const d of drafts || []) {
          const n = this.normalizeDraft(d);
          if (!n?.fields?.display_name || !n.fields.osm_ref) {
            out.skipped += 1;
            continue;
          }
          prepared.push(n);
        }
        if (!prepared.length) return out;

        // ⚠️ DEDUPE DENTRO DO PRÓPRIO LOTE, ANTES DO BANCO. O mesmo `osm_ref`
        // pode aparecer duas vezes num arquivo (o gerador varre node, way e
        // relation, e um estabelecimento mapeado das duas formas aparece nos
        // dois). Sem isto, o `ON CONFLICT DO NOTHING` engoliria a segunda e o
        // relatório diria "criadas" um número maior do que a base recebeu.
        const seen = new Set();
        const unique = [];
        for (const p of prepared) {
          if (seen.has(p.fields.osm_ref)) continue;
          seen.add(p.fields.osm_ref);
          unique.push(p);
        }

        for (let i = 0; i < unique.length; i += chunk) {
          const slice = unique.slice(i, i + chunk);
          const conn = await pool.connect();
          try {
            await conn.query("BEGIN");

            const existing = await CompanyStorage.findExistingOsmRefs(
              conn,
              slice.map((p) => p.fields.osm_ref)
            );
            const novos = slice.filter((p) => !existing.has(p.fields.osm_ref));
            const antigos = slice.filter((p) => existing.has(p.fields.osm_ref));

            if (novos.length) {
              // Região para o lote inteiro, numa consulta.
              const regions = await CompanyStorage.bulkResolveRegions(
                conn,
                novos
                  .filter((p) => p.fields.uf && p.fields.city)
                  .map((p) => ({
                    uf: p.fields.uf,
                    city_norm: N.normalizeCity(p.fields.city),
                  }))
              );
              for (const p of novos) {
                const key = `${p.fields.uf}|${N.normalizeCity(p.fields.city)}`;
                if (regions.has(key)) p.fields.id_region = regions.get(key);
              }

              const inserted = await CompanyStorage.bulkInsert(
                conn,
                novos.map((p) => p.fields)
              );
              const idByRef = new Map(inserted.map((r) => [r.osm_ref, r.id_company]));
              out.created += inserted.length;

              const provenance = [];
              const scores = [];
              for (const p of novos) {
                const id = idByRef.get(p.fields.osm_ref);
                if (!id) continue; // perdeu a corrida do ON CONFLICT
                const winning = {};
                for (const [field, value] of Object.entries(p.fields)) {
                  if (["name_norm", "city_norm"].includes(field)) continue;
                  if (value === null || value === undefined || String(value).trim() === "") continue;
                  if (!TRACKED_FIELDS.includes(field)) continue;
                  provenance.push({
                    id_company: id,
                    field,
                    value,
                    source,
                    source_url: p.source_url || null,
                    confidence: fieldConfidence(field, source),
                  });
                  winning[field] = source;
                }
                // `scoreCompany` é pura: a nota sai em memória, sem reler a
                // linha que acabamos de escrever.
                scores.push({ id_company: id, confidence: scoreCompany(p.fields, winning) });
              }

              for (let j = 0; j < provenance.length; j += 1000) {
                await CompanyStorage.bulkRecordSources(conn, provenance.slice(j, j + 1000));
              }
              for (let j = 0; j < scores.length; j += 1000) {
                await CompanyStorage.bulkSetConfidence(conn, scores.slice(j, j + 1000));
              }
            }

            // Quem já existe volta ao caminho campo a campo — é lá que a régua
            // de precedência precisa rodar.
            for (const p of antigos) {
              const r = await this.ingest(conn, p, source);
              if (r.skipped) out.skipped += 1;
              else if (r.created) out.created += 1;
              else out.updated += 1;
              out.reused += 1;
            }

            await conn.query("COMMIT");
          } catch (err) {
            await conn.query("ROLLBACK").catch(() => {});
            throw err;
          } finally {
            conn.release();
          }
        }

        return out;
      }
    );
  }
}

module.exports = CompanyIngestService;
module.exports.TRACKED_FIELDS = TRACKED_FIELDS;
