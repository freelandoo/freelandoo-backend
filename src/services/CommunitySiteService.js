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
const SiteSlug = require("../utils/communitySiteSlug");
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

/**
 * Garante que a comunidade tenha um endereço próprio, gerando um a partir do
 * nome dela quando ainda não há.
 *
 * Roda na PUBLICAÇÃO, não na criação: endereço é recurso escasso e disputado
 * (só existe um /c/padaria no site inteiro). Reservá-lo para toda comunidade
 * que apenas abriu o construtor deixaria os bons nomes presos a rascunhos que
 * talvez nunca sejam publicados. Quem publica, reserva.
 *
 * O desempate por sufixo é feito CONTRA O BANCO, em laço: um SELECT prévio não
 * resolveria a corrida entre duas publicações simultâneas do mesmo nome — quem
 * decide é o índice único, e um 23505 aqui significa "tente o próximo", não
 * "deu erro".
 */
async function ensureSlug(id_profile, displayName) {
  const existing = await CommunitySiteStorage.getSlug(pool, id_profile);
  if (existing) return existing;

  let base = SiteSlug.normalizeSlug(displayName);
  if (!base || base.length < SiteSlug.MIN_LENGTH || SiteSlug.isReserved(base)) {
    // Nome que não vira slug (só emoji, nome curto demais, palavra reservada)
    // não pode impedir a publicação — cai num endereço derivado do id, feio
    // porém válido, e o líder renomeia depois.
    base = `c-${String(id_profile).replace(/-/g, "").slice(0, 10)}`;
  }
  if (base.length > SiteSlug.MAX_LENGTH - 6) {
    base = base.slice(0, SiteSlug.MAX_LENGTH - 6).replace(/-+$/g, "");
  }

  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const claimed = await CommunitySiteStorage.claimSlug(pool, id_profile, candidate);
    if (claimed && !claimed.taken) return claimed.slug;
  }
  return null;
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

        const slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);

        if (isLeader) {
          return {
            exists: !!row,
            is_leader: true,
            is_published: !!row?.is_published,
            published_at: row?.published_at || null,
            updated_at: row?.updated_at || null,
            slug,
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
          slug,
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
          slug: await CommunitySiteStorage.getSlug(pool, params.id_profile),
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

        // O endereço nasce AQUI (mig 213), não na criação: quem publica reserva.
        // Despublicar NÃO devolve o endereço — o líder que tira o site do ar por
        // um tempo não pode voltar e encontrar o /c/dele com outra comunidade.
        let slug = await CommunitySiteStorage.getSlug(pool, params.id_profile);
        if (published && !slug) {
          slug = await ensureSlug(params.id_profile, community.display_name);
        }

        return {
          exists: true,
          is_leader: true,
          is_published: row.is_published,
          published_at: row.published_at,
          updated_at: row.updated_at,
          slug,
          config: toConfig(row),
        };
      }
    );
  }

  /**
   * Troca o endereço próprio, escolhido à mão pelo líder.
   *
   * O endereço ANTIGO é liberado para quem quiser — não guardamos redirecionamento.
   * É uma escolha consciente: manter todo endereço já usado apontando para
   * sempre transformaria a lista de reservados numa lixeira que só cresce, e
   * quem troca de endereço está justamente dizendo que o antigo não serve mais.
   * O preço é que link antigo quebra, e o painel avisa isso antes de trocar.
   */
  static async renameSlug(user, params, body) {
    return runWithLogs(
      log,
      "renameSlug",
      () => ({ id_user: user?.id_user, id_profile: params?.id_profile }),
      async () => {
        const id_user = user?.id_user;
        if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };

        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) {
          return { error: "Comunidade não encontrada", statusCode: 404 };
        }
        if (String(community.id_leader_user) !== String(id_user)) {
          return { error: "Apenas o líder pode mudar o endereço do site." };
        }

        const verdict = SiteSlug.validateSlug(body?.slug);
        if (!verdict.ok) {
          const REASON = {
            empty: "Escolha um endereço.",
            too_short: `O endereço precisa de pelo menos ${SiteSlug.MIN_LENGTH} caracteres.`,
            too_long: `O endereço passa de ${SiteSlug.MAX_LENGTH} caracteres.`,
            format: "Use apenas letras, números e hífen.",
            reserved: "Este endereço é reservado pela plataforma.",
            numeric_only: "O endereço não pode ser só números.",
            punycode_like: "Este endereço tem um formato reservado pelo DNS.",
          };
          return { error: REASON[verdict.reason] || "Endereço inválido." };
        }

        const claimed = await CommunitySiteStorage.claimSlug(
          pool,
          params.id_profile,
          verdict.slug
        );
        if (!claimed) return { error: "Comunidade não encontrada", statusCode: 404 };
        if (claimed.taken) {
          return { error: "Este endereço já é de outra comunidade.", statusCode: 409 };
        }
        return { slug: claimed.slug };
      }
    );
  }

  /**
   * Lê o site pelo ENDEREÇO PÚBLICO (`/c/<slug>`), sem sessão.
   *
   * Esta é a porta que o mundo usa: buscador, link no WhatsApp, domínio
   * próprio. Por isso ela é deliberadamente cega ao viewer — e é justamente
   * essa cegueira que exige a trava aqui:
   *
   *   • site não publicado NÃO EXISTE por esta porta (nem para o líder — ele vê
   *     o rascunho dentro da comunidade, que é onde faz sentido editá-lo);
   *   • comunidade privada ou condomínio devolve `locked` sem o conteúdo.
   *
   * Sem isso, o endereço público seria um jeito de ler por fora o que a
   * comunidade fechada esconde por dentro — exatamente o vazamento que a
   * política de comunidades existe para impedir.
   */
  static async getPublicBySlug(params) {
    return runWithLogs(
      log,
      "getPublicBySlug",
      () => ({ slug: params?.slug }),
      async () => {
        const slug = SiteSlug.normalizeSlug(params?.slug);
        if (!slug) return { error: "Site não encontrado", statusCode: 404 };

        const row = await CommunitySiteStorage.getPublicBySlug(pool, slug);
        if (!row || !row.is_published) {
          return { error: "Site não encontrado", statusCode: 404 };
        }

        // Anônimo por definição: esta porta não tem sessão.
        const open =
          row.kind !== "condo" && row.privacy !== "private";
        if (!open) {
          return {
            locked: true,
            slug: row.slug,
            id_profile: row.id_profile,
            community: { display_name: row.display_name, avatar_url: row.avatar_url },
            config: null,
          };
        }

        return {
          locked: false,
          slug: row.slug,
          id_profile: row.id_profile,
          published_at: row.published_at,
          updated_at: row.updated_at,
          community: {
            display_name: row.display_name,
            avatar_url: row.avatar_url,
            bio: row.bio,
          },
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
