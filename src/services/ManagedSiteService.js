// src/services/ManagedSiteService.js
// A PORTA DA PLATAFORMA para o site feito pela Freelandoo (mig 241).
//
// Aqui é onde NÓS montamos o site de um cliente: escolhemos o tema, gravamos o
// conteúdo e colocamos no ar. O cliente não passa por este arquivo em nenhum
// caminho — as rotas vivem sob `roleMiddleware("Administrator")`.
//
// ⚠️ ESTA É A TERCEIRA DAS TRÊS TRAVAS que fazem "só a gente insere site" ser
// verdade por construção (as outras duas estão em `utils/managedSite.js`). Se
// um dia alguma coisa aqui precisar ser chamada por um usuário comum, a
// resposta não é afrouxar o guard: é escrever a porta dele, com as regras dele.
//
// O que este service NÃO faz, de propósito:
//
//   • não desenha nada — quem desenha é o tema, no front;
//   • não mexe no DOCUMENTO do construtor (seções, páginas, tema de cores). O
//     rascunho que o cliente tinha antes de contratar continua guardado, e é o
//     que ele reencontra se um dia voltar a editar sozinho (`release`).

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const CommunitySiteStorage = require("../storages/CommunitySiteStorage");
const CommunitySiteService = require("./CommunitySiteService");
const CommunitySite = require("../utils/communitySite");
const SiteTemplates = require("../utils/siteTemplates");
const CanvasToTemplate = require("../utils/canvasToTemplate");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ManagedSiteService");

/**
 * A comunidade existe e pode ter site?
 *
 * O mesmo predicado das portas do cliente (`kindHasSite`): site é função da
 * comunidade de NEGÓCIO. Um site gerenciado numa comunidade de condomínio
 * ficaria no ar por um endereço que nenhuma tela sabe editar — nem a nossa.
 */
async function loadCommunity(id_profile) {
  const community = await CommunityStorage.getById(pool, id_profile);
  if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
  if (!CommunitySite.kindHasSite(community.kind)) {
    return {
      error: "Site é uma função da comunidade de negócio.",
      statusCode: 403,
    };
  }
  return { community };
}

/** A forma como o painel de admin lê um site. */
function project(row, community, slug) {
  return {
    id_profile: community.id_profile,
    community: {
      display_name: community.display_name,
      id_leader_user: community.id_leader_user,
    },
    slug,
    exists: !!row,
    managed: !!row?.managed_by_platform,
    template: row?.template || null,
    data: row?.template_data || {},
    is_published: !!row?.is_published,
    published_at: row?.published_at || null,
    grace_until: row?.grace_until || null,
    updated_at: row?.updated_at || null,
  };
}

class ManagedSiteService {
  /** Os temas disponíveis — é o que o painel oferece para escolher. */
  static async listTemplates() {
    return {
      templates: SiteTemplates.TEMPLATE_SLUGS.map((slug) => ({
        slug,
        label: SiteTemplates.TEMPLATES[slug].label,
      })),
    };
  }

  /** Todos os sites gerenciados — a carteira de clientes da agência. */
  static async list() {
    return runWithLogs(log, "list", () => ({}), async () => {
      const rows = await CommunitySiteStorage.listManaged(pool);
      return { sites: rows };
    });
  }

  /** O estado de um site, gerenciado ou não. */
  static async get(params) {
    return runWithLogs(log, "get", () => ({ id_profile: params?.id_profile }), async () => {
      const loaded = await loadCommunity(params.id_profile);
      if (loaded.error) return loaded;

      const row = await CommunitySiteStorage.getByProfile(pool, params.id_profile);
      const slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);
      return project(row, loaded.community, slug);
    });
  }

  /**
   * O que o site do CONSTRUTOR vira, neste tema, SEM gravar nada.
   *
   * ⚠️ CONVERTER E GRAVAR SÃO DOIS GESTOS de propósito. A conversão é com
   * perda (ela lê a intenção de blocos de texto livre) e devolve `warnings`
   * dizendo tudo que deduziu. Aplicar no mesmo gesto tiraria o único momento em
   * que um erro de leitura ainda é barato — depois de gravado, ele já é o site
   * que o cliente vê.
   */
  static async draftFromCanvas(params, query) {
    return runWithLogs(
      log,
      "draftFromCanvas",
      () => ({ id_profile: params?.id_profile, template: query?.template }),
      async () => {
        const loaded = await loadCommunity(params.id_profile);
        if (loaded.error) return loaded;

        const template = String(query?.template || "");
        if (!SiteTemplates.isTemplate(template)) {
          return { error: "Tema desconhecido.", statusCode: 400 };
        }

        const row = await CommunitySiteStorage.getByProfile(pool, params.id_profile);
        if (!row) return { error: "Este negócio ainda não tem site.", statusCode: 404 };

        const { data, warnings } = CanvasToTemplate.deriveTemplateData(
          template,
          row,
          loaded.community
        );

        // Passa pelo normalizador ANTES de sair: o painel tem que ver o que
        // seria GRAVADO, não o que a conversão produziu. São coisas diferentes
        // — o normalizador descarta slug repetido, link perigoso e texto acima
        // do teto, e uma prévia do documento cru mentiria sobre o resultado.
        const normalized = SiteTemplates.normalizeTemplateData(template, data);
        if (normalized.error) return { error: normalized.error, statusCode: 400 };

        return { template, data: normalized.data, warnings };
      }
    );
  }

  /**
   * Grava o site: tema + conteúdo, e trava a edição do cliente.
   *
   * É um UPSERT do conteúdo INTEIRO, não um merge: o gerador do site monta o
   * documento completo a cada passada, e um merge tornaria impossível REMOVER
   * uma cidade ou um serviço — ele ficaria no ar para sempre, invisível no
   * arquivo de origem. Mesma escolha do save do construtor.
   */
  static async apply(params, body) {
    return runWithLogs(
      log,
      "apply",
      () => ({ id_profile: params?.id_profile, template: body?.template }),
      async () => {
        const loaded = await loadCommunity(params.id_profile);
        if (loaded.error) return loaded;

        const normalized = SiteTemplates.normalizeTemplateData(body?.template, body?.data);
        if (normalized.error) return { error: normalized.error, statusCode: 400 };

        // `managed` só é FALSE quando pedido explicitamente — o caso de
        // montarmos o site e entregarmos a edição ao cliente. O padrão é
        // travado, porque é para isso que esta porta existe.
        const managed = body?.managed !== false;

        const row = await CommunitySiteStorage.setManaged(pool, params.id_profile, {
          template: body.template,
          templateData: normalized.data,
          managed,
        });

        const slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);
        return project(row, loaded.community, slug);
      }
    );
  }

  /**
   * Publica ou tira do ar — pela porta da plataforma.
   *
   * Existe porque o cliente NÃO PODE publicar um site gerenciado (o guard do
   * `CommunitySiteService.setPublished` recusa), então sem isto o site que
   * montamos não teria como chegar ao ar.
   *
   * ⚠️ NÃO checa o plano do cliente, e isso é deliberado: quem decide colocar
   * no ar somos nós, e pode haver motivo comercial (cortesia, período de teste,
   * migração de um site que já era do cliente). Quem cobra a assinatura é a
   * CARÊNCIA, que roda depois e é automática — regra que não depende de alguém
   * lembrar de conferir na hora.
   */
  static async setPublished(params, body) {
    return runWithLogs(
      log,
      "setPublished",
      () => ({ id_profile: params?.id_profile, published: body?.published }),
      async () => {
        const loaded = await loadCommunity(params.id_profile);
        if (loaded.error) return loaded;

        const published = body?.published !== false;
        const row = await CommunitySiteStorage.setPublished(pool, params.id_profile, published);
        if (!row) return { error: "Monte o site antes de publicar.", statusCode: 404 };

        // O endereço nasce na publicação (mig 213), como no construtor — e pela
        // MESMA função, senão existiriam dois endereços possíveis para o mesmo
        // site e o que está no Google seria um deles por sorteio.
        let slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);
        if (published && !slug) {
          slug = await CommunitySiteService.ensureSlug(
            params.id_profile,
            loaded.community.display_name
          );
        }

        return project(row, loaded.community, slug);
      }
    );
  }

  /**
   * Devolve o site ao cliente: destrava a edição e apaga o tema.
   *
   * O documento do construtor volta a valer — e ele nunca foi tocado, então o
   * que aparece é o que ele tinha antes (em geral, o site semeado). Sem apagar
   * o `template`, o site continuaria sendo desenhado pelo tema e o cliente
   * editaria seções que ninguém vê: o pior dos dois mundos.
   *
   * ⚠️ NÃO despublica. Tirar do ar o site de alguém como efeito colateral de
   * uma mudança administrativa é o tipo de surpresa que ninguém relaciona à
   * causa. Quem tira do ar é uma decisão própria.
   */
  static async release(params) {
    return runWithLogs(log, "release", () => ({ id_profile: params?.id_profile }), async () => {
      const loaded = await loadCommunity(params.id_profile);
      if (loaded.error) return loaded;

      const row = await CommunitySiteStorage.setManaged(pool, params.id_profile, {
        template: null,
        templateData: {},
        managed: false,
      });
      const slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);
      return project(row, loaded.community, slug);
    });
  }
}

module.exports = ManagedSiteService;
