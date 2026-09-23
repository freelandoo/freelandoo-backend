// src/services/ProspectService.js
// A porta de prospecção do NEGÓCIO — o que o pill "Leads" chama.
//
// ⚠️ O GUARD É O `_assertCommunityAdmin` DO `CommunityService`, REUSADO, e não
// uma cópia. Ele já carrega os dois regimes (líder numa comunidade, admin da
// plataforma numa plataforma) e é ele que toda escrita de administração de
// comunidade atravessa. Uma segunda régua de "quem manda aqui" seria o começo
// exato do vazamento que a `communityPolicy` existe para impedir: o dia em que
// uma das duas mudasse, a outra continuaria abrindo a porta.

const pool = require("../databases");
const CommunityService = require("./CommunityService");
const CompanyStorage = require("../storages/CompanyStorage");
const CompanyJobStorage = require("../storages/CompanyJobStorage");
const LeadListStorage = require("../storages/LeadListStorage");
const providers = require("../integrations/companyProvider");
const { listCategories, isCategory, guessCategory } = require("../utils/companyCategories");
const N = require("../utils/companyNormalize");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProspectService");

/** Siglas de UF. A fronteira de confiança do que vira literal de consulta. */
const UFS = new Set([
  "AC","AL","AP","AM","BA","CE","DF","ES","GO","MA","MT","MS","MG","PA","PB",
  "PR","PE","PI","RJ","RN","RS","RO","RR","SC","SP","SE","TO",
]);

class ProspectService {
  /**
   * "Este negócio pode prospectar?"
   *
   * ⚠️ SÓ A COMUNIDADE DE NEGÓCIO (`common`), pela MESMA razão que só ela tem
   * site (`kindHasSite`): prospecção é ferramenta comercial. A comunidade do
   * cachorro, a do modelo de carro, a da rua e a do prédio não vendem para
   * ninguém — um pill "Leads" ali seria porta pintada.
   */
  static async _assertBusiness(user, id_profile) {
    const guard = await CommunityService._assertCommunityAdmin(user?.id_user, id_profile);
    if (guard.error) return guard;
    if ((guard.community?.kind || "common") !== "common") {
      return { error: "A prospecção existe só na comunidade de negócio.", statusCode: 403 };
    }
    return guard;
  }

  /** O catálogo + o estado das fontes. É o que a tela desenha antes de buscar. */
  static async catalog(user, id_profile) {
    return runWithLogs(log, "catalog", () => ({ id_profile }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const settings = await CompanyStorage.getSettings(pool);
      return {
        categories: listCategories(),
        // ⚠️ A TELA LÊ O ESTADO DAS FONTES EM VEZ DE ADIVINHAR. Regra das migs
        // 214/220: fonte desligada por ambiente some do painel, e a tela diz
        // "descoberta indisponível" — em vez de oferecer um botão que só falha
        // depois do clique.
        providers: providers.listProviders(),
        limits: {
          daily_discover: settings?.daily_discover_per_user ?? 20,
          daily_enrich: settings?.daily_enrich_per_user ?? 120,
        },
        // Custos existem e valem 0 (mig 254). A tela já os mostra para que
        // ligar a cobrança um dia seja um UPDATE, não um deploy do front.
        costs: {
          enrich_polens: settings?.enrich_cost_polens ?? 0,
          export_polens: settings?.export_cost_polens ?? 0,
        },
        stages: ["new", "contacted", "qualified", "won", "lost"],
      };
    });
  }

  /**
   * A busca.
   *
   * ⚠️ ELA LÊ A BASE LOCAL, SEMPRE — nunca chama a Overpass. Descoberta é
   * trabalho de fila (ver `CompanyWorker`), e misturar as duas coisas faria uma
   * tela de busca depender de um serviço de terceiro respondendo em tempo real.
   * O que a resposta traz é `suggest_discovery`: quando a base tem pouco para
   * aquela (categoria, cidade), a tela oferece o botão "procurar mais" — que
   * enfileira.
   */
  static async search(user, id_profile, q = {}) {
    return runWithLogs(log, "search", () => ({ id_profile, cat: q.category }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;

      // Categoria vem do seletor; o texto livre é só uma dica para quem digitou.
      const category = isCategory(q.category) ? q.category : guessCategory(q.q) || null;
      const uf = q.uf && UFS.has(String(q.uf).toUpperCase()) ? String(q.uf).toUpperCase() : null;

      const filters = {
        q: q.q || null,
        category_key: category,
        uf,
        city: q.city || null,
        neighborhood: q.neighborhood || null,
        cnae: q.cnae || null,
        only_active_status: q.only_active === "1" || q.only_active === true,
        headquarters_only: q.headquarters === "1" || q.headquarters === true,
        company_size: q.size || null,
        min_capital_cents: q.min_capital_cents ? Number(q.min_capital_cents) : null,
        opened_before: q.opened_before || null,
        min_confidence: q.min_confidence ? Number(q.min_confidence) : null,
        has_phone: q.has_phone === "1" || q.has_phone === true,
        has_whatsapp: q.has_whatsapp === "1" || q.has_whatsapp === true,
        has_email: q.has_email === "1" || q.has_email === true,
        has_website: q.has_website === "1" || q.has_website === true,
        has_instagram: q.has_instagram === "1" || q.has_instagram === true,
        has_social: q.has_social === "1" || q.has_social === true,
        has_cnpj: q.has_cnpj === "1" || q.has_cnpj === true,
        lat: q.lat,
        lon: q.lon,
        radius_m: q.radius_m,
        page: q.page,
        per_page: q.per_page,
      };

      const found = await CompanyStorage.search(pool, filters);

      // Em quais listas DESTE negócio cada empresa já está — é o que deixa o
      // card dizer "já salvo" em vez de oferecer adicionar de novo.
      const inLists = await LeadListStorage.listIdsForCompanies(pool, {
        id_profile,
        companyIds: found.rows.map((r) => r.id_company),
      });

      // ⚠️ A SUGESTÃO DE DESCOBERTA SÓ APARECE COM CATEGORIA **E** CIDADE:
      // sem as duas não há o que varrer (a Overpass é consultada por área +
      // tag), e oferecer o botão assim mesmo daria um clique que sempre volta
      // "payload incompleto".
      //
      // ⚠️ E ELA OLHA `base_total`, NUNCA O TOTAL FILTRADO. Eram duas
      // perguntas diferentes tratadas como uma só: "esta cidade já foi
      // varrida?" e "estes filtros acharam alguém?". Usando o total filtrado,
      // uma cidade com centenas de empresas na base aparecia como cidade vazia
      // assim que um filtro cortava tudo — e a tela mandava varrer de novo,
      // que é a única ação que NÃO resolve. `base_total` desce junto para que
      // a tela possa dizer a verdade: "há N aqui, mas nenhuma passa no filtro".
      const placeScoped = !!(category && uf && q.city);
      const base_total = placeScoped
        ? await CompanyStorage.countPlace(pool, {
            category_key: category,
            uf,
            city: q.city,
          })
        : found.total;
      const suggest = placeScoped && base_total < 12;

      return {
        ...found,
        rows: found.rows.map((r) => ({ ...r, in_lists: inLists[r.id_company] || [] })),
        filters: { ...filters, category_key: category },
        base_total,
        suggest_discovery: suggest,
      };
    });
  }

  /** A ficha: a empresa + de onde veio cada campo. */
  static async getCompany(user, id_profile, id_company) {
    return runWithLogs(log, "getCompany", () => ({ id_profile, id_company }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const company = await CompanyStorage.getById(pool, id_company);
      if (!company || company.suppressed_at) {
        return { error: "Empresa não encontrada.", statusCode: 404 };
      }
      const sources = await CompanyStorage.listSources(pool, id_company);
      const inLists = await LeadListStorage.listIdsForCompanies(pool, {
        id_profile,
        companyIds: [id_company],
      });
      return { company, sources, in_lists: inLists[id_company] || [] };
    });
  }

  /**
   * Pede uma varredura de (categoria, uf, cidade).
   *
   * ⚠️ A CHAVE DE DEDUPE É O QUE SEGURA A CONTA. Dez pessoas pedindo a mesma
   * coisa no mesmo minuto geram UM trabalho — e o índice parcial
   * `ux_company_job_live` é quem garante isso, não este código.
   *
   * ⚠️ O TTL EVITA REVARRER O QUE É RECENTE. Estabelecimento não abre de hora
   * em hora; varrer a mesma cidade toda tarde gastaria a cota de um serviço
   * público para reescrever as mesmas linhas.
   */
  static async requestDiscovery(user, id_profile, body = {}) {
    return runWithLogs(log, "requestDiscovery", () => ({ id_profile }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;

      const category = String(body.category || "").trim();
      const uf = String(body.uf || "").toUpperCase().trim();
      const city = String(body.city || "").trim();

      if (!isCategory(category)) return { error: "Escolha uma categoria da lista.", statusCode: 400 };
      if (!UFS.has(uf)) return { error: "Escolha o estado.", statusCode: 400 };
      if (city.length < 2) return { error: "Informe a cidade.", statusCode: 400 };
      if (!providers.discoverProviders().length) {
        return { error: "A descoberta está indisponível no momento.", statusCode: 503 };
      }

      const settings = await CompanyStorage.getSettings(pool);
      const used = await CompanyJobStorage.countToday(pool, {
        requested_by: user.id_user,
        kinds: ["discover"],
      });
      const cap = settings?.daily_discover_per_user ?? 20;
      if (used >= cap) {
        return {
          error: `Você já pediu ${cap} buscas novas hoje. Tente de novo amanhã.`,
          statusCode: 429,
        };
      }

      const cityNorm = N.normalizeCity(city);
      const dedupe_key = `discover:${category}:${uf}:${cityNorm}`;

      // TTL: já varremos isto há pouco tempo?
      const ttlHours = settings?.discovery_ttl_hours ?? 168;
      const { rows: recent } = await pool.query(
        `SELECT id_job, updated_at FROM public.tb_company_job
          WHERE dedupe_key = $1 AND status = 'done'
            AND updated_at > NOW() - ($2 || ' hours')::interval
          ORDER BY updated_at DESC LIMIT 1`,
        [dedupe_key, String(ttlHours)]
      );
      if (recent.length) {
        return { ok: true, fresh: true, last_run_at: recent[0].updated_at, job: null };
      }

      const job = await CompanyJobStorage.enqueue(pool, {
        kind: "discover",
        dedupe_key,
        requested_by: user.id_user,
        id_profile,
        payload: { category, uf, city },
      });
      // `null` = já existe um trabalho vivo. Não é erro: é "alguém já pediu".
      const live = job || (await CompanyJobStorage.findLive(pool, dedupe_key));
      return { ok: true, fresh: false, queued: !!job, job: live };
    });
  }

  /** Pede o enriquecimento de UMA empresa. */
  static async requestEnrichment(user, id_profile, id_company, body = {}) {
    return runWithLogs(
      log,
      "requestEnrichment",
      () => ({ id_profile, id_company }),
      async () => {
        const guard = await this._assertBusiness(user, id_profile);
        if (guard.error) return guard;

        const company = await CompanyStorage.getById(pool, id_company);
        if (!company || company.suppressed_at) {
          return { error: "Empresa não encontrada.", statusCode: 404 };
        }

        const kind = ["enrich_website", "enrich_cnpj", "enrich_all"].includes(body.kind)
          ? body.kind
          : "enrich_all";

        const settings = await CompanyStorage.getSettings(pool);
        const used = await CompanyJobStorage.countToday(pool, {
          requested_by: user.id_user,
          kinds: ["enrich_website", "enrich_cnpj", "enrich_all"],
        });
        const cap = settings?.daily_enrich_per_user ?? 120;
        if (used >= cap) {
          return {
            error: `Você já enriqueceu ${cap} empresas hoje. Tente de novo amanhã.`,
            statusCode: 429,
          };
        }

        // ⚠️ AQUI ENTRA A COBRANÇA, NO DIA EM QUE ELA EXISTIR. O preço já é
        // lido (`enrich_cost_polens`) e vale 0. Ligar é um UPDATE na linha de
        // settings mais uma chamada ao `PolenService.spend` neste ponto — não
        // uma migration nem uma mudança de arquitetura.

        // TTL por fonte: re-enriquecer o que foi conferido há pouco não muda
        // nada e gasta a cota de um serviço de terceiro.
        const websiteFresh =
          company.website_checked_at &&
          Date.now() - new Date(company.website_checked_at).getTime() <
            (settings?.website_ttl_hours ?? 720) * 3600_000;
        const cnpjFresh =
          company.cnpj_checked_at &&
          Date.now() - new Date(company.cnpj_checked_at).getTime() <
            (settings?.cnpj_ttl_hours ?? 4320) * 3600_000;
        if (
          (kind === "enrich_website" && websiteFresh) ||
          (kind === "enrich_cnpj" && cnpjFresh) ||
          (kind === "enrich_all" && websiteFresh && cnpjFresh)
        ) {
          return { ok: true, fresh: true, company };
        }

        const dedupe_key = `${kind}:${id_company}`;
        const job = await CompanyJobStorage.enqueue(pool, {
          kind,
          dedupe_key,
          id_company,
          requested_by: user.id_user,
          id_profile,
          payload: {},
        });
        const live = job || (await CompanyJobStorage.findLive(pool, dedupe_key));
        return { ok: true, fresh: false, queued: !!job, job: live };
      }
    );
  }

  /** O que este negócio pediu e está em curso — a tela pergunta de tempos em tempos. */
  static async jobs(user, id_profile) {
    return runWithLogs(log, "jobs", () => ({ id_profile }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      return { jobs: await CompanyJobStorage.listRecent(pool, { id_profile, limit: 12 }) };
    });
  }

  // ─── LISTAS ────────────────────────────────────────────────────────────────

  static async listLists(user, id_profile) {
    return runWithLogs(log, "listLists", () => ({ id_profile }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      return {
        lists: await LeadListStorage.listByProfile(pool, id_profile),
        funnel: await LeadListStorage.stageSummary(pool, id_profile),
      };
    });
  }

  static async createList(user, id_profile, body = {}) {
    return runWithLogs(log, "createList", () => ({ id_profile }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const name = String(body.name || "").trim();
      if (name.length < 2) return { error: "Dê um nome para a lista.", statusCode: 400 };
      const list = await LeadListStorage.create(pool, {
        id_profile,
        id_user: user.id_user,
        name,
        note: body.note ? String(body.note).slice(0, 500) : null,
      });
      // `null` = já existe lista com este nome (índice único). Não é erro a
      // mostrar na cara de quem clicou duas vezes.
      if (!list) {
        const all = await LeadListStorage.listByProfile(pool, id_profile);
        const same = all.find((l) => l.name.toLowerCase() === name.toLowerCase());
        return { ok: true, list: same || null, existed: true };
      }
      return { ok: true, list };
    });
  }

  static async updateList(user, id_profile, id_list, body = {}) {
    return runWithLogs(log, "updateList", () => ({ id_profile, id_list }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const list = await LeadListStorage.rename(pool, id_list, id_profile, {
        name: body.name,
        note: body.note ?? null,
      });
      if (!list) return { error: "Lista não encontrada.", statusCode: 404 };
      return { ok: true, list };
    });
  }

  static async removeList(user, id_profile, id_list) {
    return runWithLogs(log, "removeList", () => ({ id_profile, id_list }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const ok = await LeadListStorage.remove(pool, id_list, id_profile);
      if (!ok) return { error: "Lista não encontrada.", statusCode: 404 };
      return { ok: true };
    });
  }

  static async listCompanies(user, id_profile, id_list, q = {}) {
    return runWithLogs(log, "listCompanies", () => ({ id_profile, id_list }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const list = await LeadListStorage.getOwned(pool, id_list, id_profile);
      if (!list) return { error: "Lista não encontrada.", statusCode: 404 };
      const rows = await LeadListStorage.listCompanies(pool, {
        id_list,
        id_profile,
        limit: q.limit,
        offset: q.offset,
      });
      return { list, rows };
    });
  }

  static async addToList(user, id_profile, id_list, body = {}) {
    return runWithLogs(log, "addToList", () => ({ id_profile, id_list }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const ids = Array.isArray(body.id_companies)
        ? body.id_companies.slice(0, 200)
        : [body.id_company].filter(Boolean);
      if (!ids.length) return { error: "Escolha ao menos uma empresa.", statusCode: 400 };

      let added = 0;
      for (const id_company of ids) {
        const r = await LeadListStorage.addCompany(pool, {
          id_list,
          id_profile,
          id_company,
          added_by: user.id_user,
          note: body.note || null,
        });
        if (r) added++;
      }
      return { ok: true, added, requested: ids.length };
    });
  }

  static async removeFromList(user, id_profile, id_list, id_company) {
    return runWithLogs(log, "removeFromList", () => ({ id_profile, id_list }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const ok = await LeadListStorage.removeCompany(pool, { id_list, id_profile, id_company });
      if (!ok) return { error: "Este lead não está na lista.", statusCode: 404 };
      return { ok: true };
    });
  }

  static async setStage(user, id_profile, id_list, id_company, body = {}) {
    return runWithLogs(log, "setStage", () => ({ id_profile, id_list }), async () => {
      const guard = await this._assertBusiness(user, id_profile);
      if (guard.error) return guard;
      const item = await LeadListStorage.setStage(pool, {
        id_list,
        id_profile,
        id_company,
        stage: body.stage || null,
        owner_user: body.owner_user || null,
        note: body.note ?? null,
      });
      if (!item) return { error: "Este lead não está na lista.", statusCode: 404 };
      return { ok: true, item };
    });
  }

  // ─── SUPRESSÃO (LGPD) ──────────────────────────────────────────────────────

  /**
   * Tira uma empresa da base, para sempre.
   *
   * ⚠️ É PORTA DE ADMIN DA PLATAFORMA, e não do dono do negócio — de propósito.
   * Quem pede para sair é a EMPRESA (por e-mail, por canal jurídico), não um
   * usuário da Freelandoo. Dar este botão ao líder de um negócio o transformaria
   * numa forma de apagar o concorrente da base de todo mundo.
   */
  static async suppress(user, body = {}) {
    return runWithLogs(log, "suppress", () => ({ id_user: user?.id_user }), async () => {
      const kind = ["domain", "cnpj", "email"].includes(body.kind) ? body.kind : null;
      if (!kind) return { error: "Informe domain, cnpj ou email.", statusCode: 400 };
      let value = String(body.value || "").trim();
      if (kind === "cnpj") value = N.normalizeCnpj(value);
      if (kind === "domain") value = N.normalizeDomain(value);
      if (kind === "email") value = N.normalizeEmail(value);
      if (!value) return { error: "Valor inválido.", statusCode: 400 };
      const r = await CompanyStorage.suppress(pool, {
        kind,
        value,
        reason: body.reason ? String(body.reason).slice(0, 300) : null,
        created_by: user.id_user,
      });
      return { ok: true, ...r };
    });
  }
}

module.exports = ProspectService;
