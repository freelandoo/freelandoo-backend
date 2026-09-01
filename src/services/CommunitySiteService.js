// src/services/CommunitySiteService.js
// "Meu Site": o site próprio da comunidade, montado pelo líder no construtor
// visual dentro da própria página (mig 212).
//
// Duas regras separam este arquivo de um CRUD qualquer:
//
// 1. QUEM EDITA é só o LÍDER. Nem vice, nem admin da comunidade — o site é a
//    cara pública dela, e cara pública tem um dono.
// 2. QUEM VÊ segue a MESMA trava do resto do conteúdo interno (a de
//    `listBees`): condomínio pede morador, privada pede membro. Um site
//    público não pode virar a porta dos fundos que mostra o que a comunidade
//    fechada esconde — e por isso a checagem é feita aqui, não no front.
//
// Rascunho × publicado: enquanto `is_published = FALSE`, só o líder enxerga.
// É isso que deixa o autosave gravar a cada tecla sem expor obra inacabada.

const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const CommunitySiteStorage = require("../storages/CommunitySiteStorage");
const CondoStorage = require("../storages/CondoStorage");
const CommunitySite = require("../utils/communitySite");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunitySiteService");

/** Linha do banco → contrato da API (camelCase, igual ao que o front manda). */
function toConfig(row) {
  return {
    siteName: row.site_name || "",
    tagline: row.tagline || "",
    theme: CommunitySite.normalizeTheme(row.theme),
    sections: Array.isArray(row.sections) ? row.sections : [],
  };
}

/**
 * O viewer pode LER o que é interno desta comunidade?
 * Espelha `CommunityService.listBees` de propósito: são a mesma pergunta, e
 * responder diferente aqui abriria um vazamento por uma porta nova.
 */
async function canViewInside(community, id_user) {
  const membership = id_user
    ? await CommunityStorage.getMembership(pool, community.id_profile, id_user)
    : null;
  const isAdmin = membership?.role === "leader" || membership?.role === "vice";

  if (community.kind === "condo") {
    if (isAdmin) return true;
    if (!id_user) return false;
    const resident = await CondoStorage.getResidentStatus(
      pool,
      community.id_profile,
      id_user
    );
    return !!resident.confirmed;
  }
  if (community.privacy === "private") return !!membership;
  return true;
}

class CommunitySiteService {
  /**
   * Lê o site. Para o líder sem linha ainda, devolve o TEMPLATE montado a
   * partir da própria comunidade (nome, bio, capa) com `exists: false` — não
   * grava nada: o site só vira linha quando ele salva. Tela em branco não
   * ensina o que dá para fazer ali; um site pré-montado e editável ensina.
   */
  static async get(user, params) {
    return runWithLogs(
      log,
      "get",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user || null;

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) {
          return { error: "Comunidade não encontrada", statusCode: 404 };
        }

        const isLeader =
          !!id_user && String(community.id_leader_user) === String(id_user);
        const row = await CommunitySiteStorage.getByProfile(pool, params.id_profile);

        if (isLeader) {
          return {
            exists: !!row,
            is_leader: true,
            is_published: !!row?.is_published,
            published_at: row?.published_at || null,
            updated_at: row?.updated_at || null,
            config: row ? toConfig(row) : CommunitySite.buildDefaultConfig(community),
          };
        }

        // Visitante: rascunho não existe para ele, e site de comunidade fechada
        // obedece à trava da comunidade mesmo depois de publicado.
        if (!row || !row.is_published) {
          return { exists: false, is_leader: false, is_published: false, config: null };
        }
        if (!(await canViewInside(community, id_user))) {
          return {
            exists: true,
            is_leader: false,
            is_published: true,
            locked: true,
            config: null,
          };
        }
        return {
          exists: true,
          is_leader: false,
          is_published: true,
          published_at: row.published_at,
          updated_at: row.updated_at,
          config: toConfig(row),
        };
      }
    );
  }

  /**
   * Salva o site inteiro (autosave e botão Salvar usam esta MESMA porta — dois
   * caminhos de escrita para o mesmo documento acabariam divergindo).
   *
   * O payload é substituído por inteiro, não mesclado: o construtor é dono da
   * árvore completa e um merge parcial tornaria impossível REMOVER uma seção.
   */
  static async save(user, params, body) {
    return runWithLogs(
      log,
      "save",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) {
          return { error: "Comunidade não encontrada", statusCode: 404 };
        }
        if (String(community.id_leader_user) !== String(id_user)) {
          return { error: "Apenas o líder pode editar o site." };
        }

        const config = CommunitySite.normalizeConfig(body?.config ?? body);
        const row = await CommunitySiteStorage.upsert(pool, params.id_profile, config);

        return {
          exists: true,
          is_leader: true,
          is_published: !!row.is_published,
          published_at: row.published_at,
          updated_at: row.updated_at,
          // Devolvemos o config NORMALIZADO, não o que chegou: o front precisa
          // ver o que de fato ficou gravado (ids gerados, valores recusados),
          // senão a tela mostra um site que o banco não tem.
          config: toConfig(row),
        };
      }
    );
  }

  /** Publica / despublica. Só o líder, e só depois de existir o que publicar. */
  static async setPublished(user, params, body) {
    return runWithLogs(
      log,
      "setPublished",
      () => ({
        id_user: user?.id_user,
        id_profile: params?.id_profile,
        published: body?.published,
      }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) {
          return { error: "Comunidade não encontrada", statusCode: 404 };
        }
        if (String(community.id_leader_user) !== String(id_user)) {
          return { error: "Apenas o líder pode publicar o site." };
        }

        const published = body?.published !== false;
        const row = await CommunitySiteStorage.setPublished(
          pool,
          params.id_profile,
          published
        );
        if (!row) {
          return { error: "Salve o site antes de publicar.", statusCode: 404 };
        }

        return {
          exists: true,
          is_leader: true,
          is_published: row.is_published,
          published_at: row.published_at,
          updated_at: row.updated_at,
          config: toConfig(row),
        };
      }
    );
  }

  /**
   * Registra a imagem já enviada ao R2 pelo controller. O service não toca em
   * arquivo — recebe a URL pronta, como `CommunityService.setBanner` faz.
   *
   * A imagem NÃO é costurada na seção aqui: o construtor recebe a URL e a
   * coloca onde o usuário clicou, e o autosave grava a árvore inteira. Fazer o
   * backend adivinhar o destino criaria uma segunda escrita concorrente com o
   * autosave, sobre o mesmo documento.
   */
  static async assertCanUpload(user, params) {
    return runWithLogs(
      log,
      "assertCanUpload",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) {
          return { error: "Comunidade não encontrada", statusCode: 404 };
        }
        if (String(community.id_leader_user) !== String(id_user)) {
          return { error: "Apenas o líder pode enviar imagens do site." };
        }
        return { ok: true };
      }
    );
  }
}

module.exports = CommunitySiteService;
