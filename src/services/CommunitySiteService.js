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
const ProfileServiceStorage = require("../storages/ProfileServiceStorage");
const CommunityProfessionalStorage = require("../storages/CommunityProfessionalStorage");
const ProfileServiceMediaStorage = require("../storages/ProfileServiceMediaStorage");
const BookingAvailabilityService = require("./BookingAvailabilityService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CommunitySiteService");

/** Teto da varredura do próximo horário: duas semanas e cinco profissionais. */
const NEXT_SLOT_DAYS = 14;
const MAX_SCANNED_PROFESSIONALS = 5;

/** Data local -> `AAAA-MM-DD` (o backend de agenda fala nesse formato). */
function toDateOnly(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * "Quem manda no site é o LÍDER" — a mesma frase escrita uma vez só. Nem vice,
 * nem admin da comunidade: o site é a cara pública dela.
 */
async function assertLeader(user, id_profile) {
  const id_user = user?.id_user;
  if (!id_user) return { error: "Usuário não autenticado", statusCode: 401 };
  const community = await CommunityStorage.getById(pool, id_profile);
  if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
  if (String(community.id_leader_user) !== String(id_user)) {
    return { error: "Apenas o líder pode montar a equipe do site.", statusCode: 403 };
  }
  return { community };
}

/** A equipe como a tela do líder a mostra. */
async function projectRoster(id_profile, community) {
  const roster = await loadRoster(id_profile, community.id_leader_user);
  return roster.map((p) => ({
    id_user: p.id_user,
    id_profile: p.id_profile,
    username: p.username,
    name: p.profile_name || p.user_name || p.username,
    avatar_url: p.avatar_url || null,
    profession: p.taxonomy_declared_at ? p.profession || null : null,
    is_leader: String(p.id_user) === String(community.id_leader_user),
  }));
}


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
 * Quem atende: o líder na frente, depois a equipe promovida (mig 221).
 *
 * Vive separada da vitrine porque o cartão de "próximo horário" precisa da
 * lista sem pagar a consulta dos serviços de cada um.
 */
async function loadRoster(id_community, id_leader_user) {
  if (!id_leader_user) return [];
  const leader = await CommunityProfessionalStorage.getPersonByUser(pool, id_leader_user);
  if (!leader) return [];

  const promoted = await CommunityProfessionalStorage.list(pool, id_community);

  // O líder primeiro, e sem repetir: se algum dia uma linha de equipe apontar
  // para ele (liderança que mudou de mãos, por exemplo), ele não pode aparecer
  // duas vezes na tela de escolher com quem agendar.
  const roster = [leader];
  for (const p of promoted) {
    if (String(p.id_user) !== String(id_leader_user)) roster.push(p);
  }
  return roster;
}

/**
 * A EQUIPE do site: quem atende, e com quais serviços (mig 221).
 *
 * ═══ DE QUEM SÃO OS SERVIÇOS ═══
 *
 * De cada PROFISSIONAL — do perfil-conta dele, que é onde a aba "Serviços" do
 * /account grava e onde mora a agenda (mig 190). O líder está sempre na lista,
 * em primeiro: ele é profissional por construção, e é dele que a vitrine já
 * vinha desde 2026-09-04. Comunidade sem ninguém promovido devolve exatamente o
 * que devolvia antes — a equipe é um SUPERSET, não uma troca de fonte.
 *
 * ⚠️ A consequência a conhecer segue a mesma: o catálogo acompanha as PESSOAS.
 * Trocou a liderança ou saiu um profissional da equipe, o site passa a anunciar
 * outra coisa. É o comportamento escolhido, não um efeito colateral esquecido.
 *
 * ═══ POR QUE A PROJEÇÃO É ENXUTA ═══
 *
 * A linha de `tb_profile_service` carrega o que é do negócio de quem vende:
 * `affiliates_allowed`, `affiliate_percent`, `created_by_user`. Esta porta é
 * ANÔNIMA e cacheada por 10 minutos na borda — devolver a linha inteira
 * publicaria a régua de comissão em HTML público. Por isso os campos são
 * escolhidos um a um, e campo novo na tabela NÃO passa a vazar sozinho. Vale
 * igual para a pessoa: sai nome, foto e profissão; não sai e-mail nem CPF.
 *
 * Só serviço ATIVO entra: desativar um serviço é a forma que o profissional já
 * tem de tirá-lo da vitrine, e ela precisa valer aqui também.
 */
async function loadShowcase(id_community, id_leader_user) {
  const empty = { services: [], professionals: [], provider_profile_id: null };
  if (!id_leader_user) return empty;

  const roster = await loadRoster(id_community, id_leader_user);
  if (roster.length === 0) return empty;
  const leader = roster[0];

  const services = [];
  const professionals = [];

  for (const person of roster) {
    const rows = await ProfileServiceStorage.list(pool, person.id_profile, { only_active: true });
    const ids = rows.map((r) => Number(r.id_profile_service));
    const mediaMap = ids.length
      ? await ProfileServiceMediaStorage.listByServices(pool, ids)
      : new Map();

    professionals.push({
      // O alvo do agendamento: é a agenda DESTE perfil que a página consulta.
      id_profile: person.id_profile,
      name: person.profile_name || person.user_name || person.username,
      username: person.username,
      avatar_url: person.avatar_url || null,
      // A profissão declarada no onboarding (mig 200). A categoria fantasma do
      // perfil-conta que nunca declarou taxonomia NÃO sai daqui: publicá-la
      // anunciaria como profissão a primeira linha da tabela de categorias.
      profession: person.taxonomy_declared_at ? person.profession || null : null,
      is_leader: String(person.id_user) === String(id_leader_user),
      service_count: rows.length,
    });

    for (const r of rows) {
      const media = mediaMap.get(String(r.id_profile_service)) || [];
      services.push({
        id_profile_service: Number(r.id_profile_service),
        name: r.name,
        description: r.description || "",
        // Centavos, e não texto pronto: quem formata é o front, que conhece o
        // idioma de quem está lendo. O site é traduzido em 3 idiomas.
        price_amount: r.price_amount,
        duration_minutes: r.duration_minutes,
        image_url: media[0]?.media_url || null,
        // De quem é o serviço. Sem isto a tela de agendamento não sabe qual
        // agenda abrir depois da escolha — serviço pertence a UM perfil.
        provider_profile_id: person.id_profile,
      });
    }
  }

  return { services, professionals, provider_profile_id: leader.id_profile };
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

        // Os serviços da vitrine acompanham TODA leitura que devolve config.
        // O construtor mostra exatamente o que o site publicado mostra — é a
        // mesma regra que faz o canvas ser um só: se o líder editasse contra
        // uma amostra diferente, publicaria algo que não viu.
        const showcase = await loadShowcase(params.id_profile, community.id_leader_user);

        if (isLeader) {
          return {
            exists: !!row,
            is_leader: true,
            is_published: !!row?.is_published,
            published_at: row?.published_at || null,
            updated_at: row?.updated_at || null,
            slug,
            config: row ? toConfig(row) : CommunitySite.buildDefaultConfig(community),
            ...showcase,
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
          ...showcase,
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

        // Só depois da trava: o ramo `locked` acima devolve zero conteúdo, e a
        // vitrine de serviços é conteúdo. Buscá-la antes vazaria o catálogo do
        // líder de uma comunidade fechada para qualquer anônimo com o link.
        const showcase = await loadShowcase(row.id_profile, row.id_leader_user);

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
          ...showcase,
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
  /**
   * O PRÓXIMO HORÁRIO LIVRE da equipe — a agenda viva do cartão de chamada.
   *
   * ═══ POR QUE ISTO NÃO VIAJA JUNTO DO SITE ═══
   *
   * A página pública é servida com ISR de 10 minutos. Um horário embutido nela
   * seria servido por até 10 minutos depois de a vaga ter sido tomada, e o
   * visitante clicaria em "Agendar agora" para descobrir que o horário não
   * existe mais. Por isso é porta própria, consultada pelo navegador a cada
   * visita, fora do cache da página.
   *
   * ═══ COMO A VARREDURA É BARATA ═══
   *
   * Dia a dia, TODOS os profissionais no mesmo dia antes de passar para o
   * seguinte: assim o primeiro horário encontrado é o mais cedo de verdade, e
   * a busca para no primeiro dia com vaga — que na prática é hoje ou amanhã.
   * O teto de 14 dias existe para agenda vazia não virar varredura infinita.
   *
   * Quem responde "tem vaga?" é o BookingAvailabilityService, o mesmo que a
   * tela de agendar usa: uma segunda conta de disponibilidade aqui divergiria
   * da que cobra, e o site anunciaria horário que o calendário recusa.
   */
  static async getNextSlot(user, params) {
    return runWithLogs(
      log,
      "getNextSlot",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const community = await CommunityStorage.getById(pool, params.id_profile);
        if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

        // Mesma trava do resto do conteúdo interno: comunidade fechada não
        // conta pelo site o que esconde por dentro — nem a agenda de quem
        // atende nela.
        if (!(await canViewInside(community, user?.id_user || null))) {
          return { slot: null };
        }

        const roster = await loadRoster(params.id_profile, community.id_leader_user);
        if (roster.length === 0) return { slot: null };

        const team = roster.slice(0, MAX_SCANNED_PROFESSIONALS);
        const today = new Date();

        for (let day = 0; day < NEXT_SLOT_DAYS; day += 1) {
          const cursor = new Date(today);
          cursor.setDate(today.getDate() + day);
          const dateStr = toDateOnly(cursor);

          let best = null;
          for (const person of team) {
            const r = await BookingAvailabilityService.getAvailableSlots(
              person.id_profile,
              dateStr
            );
            const first = Array.isArray(r?.slots) ? r.slots[0] : null;
            if (!first?.start) continue;
            const start = String(first.start).slice(0, 5);
            if (!best || start < best.start) best = { start, person };
          }

          if (best) {
            return {
              slot: {
                date: dateStr,
                start: best.start,
                is_today: day === 0,
                professional: {
                  id_profile: best.person.id_profile,
                  name:
                    best.person.profile_name ||
                    best.person.user_name ||
                    best.person.username,
                  profession: best.person.taxonomy_declared_at
                    ? best.person.profession || null
                    : null,
                  avatar_url: best.person.avatar_url || null,
                },
              },
            };
          }
        }

        // Agenda sem nenhuma vaga nas próximas duas semanas: `null`, e nada de
        // inventar. O cartão esconde a linha em vez de prometer um horário.
        return { slot: null };
      }
    );
  }

  /** A equipe, para o construtor. Só o líder enxerga e mexe. */
  static async listProfessionals(user, params) {
    return runWithLogs(
      log,
      "professionals.list",
      () => ({ id_profile: params?.id_profile }),
      async () => {
        const guard = await assertLeader(user, params.id_profile);
        if (guard.error) return guard;
        return { professionals: await projectRoster(params.id_profile, guard.community) };
      }
    );
  }

  /**
   * Promove um membro a profissional do site.
   *
   * ⚠️ Isto NÃO é um papel na comunidade: não modera, não edita o site, não vê
   * o que membro não vê. É só "aparece no site como quem atende". Papel
   * continua sendo `tb_community_member.role`.
   *
   * Precisa ser MEMBRO — como a academia exige vínculo antes de promover a
   * professor. Publicar no site alguém que sequer entrou na comunidade daria ao
   * líder o poder de anunciar o trabalho de terceiros sem que eles soubessem.
   */
  static async addProfessional(user, params, body) {
    return runWithLogs(
      log,
      "professionals.add",
      () => ({ id_profile: params?.id_profile, username: body?.username }),
      async () => {
        const guard = await assertLeader(user, params.id_profile);
        if (guard.error) return guard;

        const target = await CommunityProfessionalStorage.findUserByUsername(
          pool,
          body?.username
        );
        if (!target) return { error: "Usuário não encontrado", statusCode: 404 };

        if (String(target.id_user) === String(guard.community.id_leader_user)) {
          return { error: "O líder já atende pelo site." };
        }

        const membership = await CommunityStorage.getMembership(
          pool,
          params.id_profile,
          target.id_user
        );
        if (!membership) {
          return {
            error: "A pessoa precisa ser membro da comunidade antes de entrar na equipe.",
          };
        }

        // Sem perfil-conta não há agenda nem serviços — o card nasceria morto.
        const person = await CommunityProfessionalStorage.getPersonByUser(pool, target.id_user);
        if (!person) return { error: "Esta conta ainda não tem perfil." };

        await CommunityProfessionalStorage.add(
          pool,
          params.id_profile,
          target.id_user,
          user.id_user
        );
        return { professionals: await projectRoster(params.id_profile, guard.community) };
      }
    );
  }

  static async removeProfessional(user, params) {
    return runWithLogs(
      log,
      "professionals.remove",
      () => ({ id_profile: params?.id_profile, target: params?.id_user }),
      async () => {
        const guard = await assertLeader(user, params.id_profile);
        if (guard.error) return guard;
        await CommunityProfessionalStorage.remove(pool, params.id_profile, params.id_user);
        return { professionals: await projectRoster(params.id_profile, guard.community) };
      }
    );
  }
}

module.exports = CommunitySiteService;
