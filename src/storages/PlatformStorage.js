// src/storages/PlatformStorage.js
//
// AS PLATAFORMAS DA FREELANDOO — uma linha por ambiente, do site inteiro.
//
// Hoje são duas: o FINANCEIRO (mig 229) e o GAMES (mig 232). Elas não são
// comunidades de ninguém: ninguém entra, ninguém é promovido, ninguém lidera —
// todo mundo lê e todo mundo publica, e quem edita nome, foto e cores é o admin
// da plataforma.
//
// ⚠️ ESTE ARQUIVO NASCEU DO `FinanceStorage`, E O RENAME FOI DE PROPÓSITO:
// servir dois ambientes com o nome de um é nome que mente — a mesma correção
// que o `GamesActivityStorage` sofreu ao virar `PlatformActivityStorage`. O que
// ele faz é UMA coisa: dizer QUAL é a linha de um ambiente. Todo o resto —
// feed, composer, curtida, comentário, denúncia — é a máquina de comunidade que
// já existe, e é ela que recebe esse id.
//
// PLATAFORMA NOVA = uma entrada em `PLATFORM_SEED` aqui, a modalidade na lista
// fechada de `utils/gamesScore.js` e o índice único (singleton) na migration
// dela. Sem o índice, duas primeiras aberturas simultâneas criam dois murais
// com metade dos posts cada, e ninguém percebe por semanas.

const { createLogger, runWithLogs } = require("../utils/logger");
const { assertPlatformKind } = require("../utils/gamesScore");

const log = createLogger("PlatformStorage");

const FINANCE_KIND = "finance";
const GAMES_KIND = "games";

/**
 * O que uma plataforma é quando ela ainda não existe.
 *
 * ⚠️ TEM QUE BATER COM O SEED DA MIGRATION de cada uma: se o texto daqui e o de
 * lá divergirem, a plataforma nasce com uma cara em produção (onde a migration
 * rodou) e outra num banco novo (onde ela nasce por esta porta).
 */
const PLATFORM_SEED = Object.freeze({
  [FINANCE_KIND]: {
    slug: "financeiro",
    name: "Financeiro",
    bio: "O mundo financeiro da Freelandoo. Todo mundo lê, todo mundo publica.",
  },
  [GAMES_KIND]: {
    slug: "games",
    name: "Games",
    bio: "A plataforma de games da Freelandoo. Todo mundo lê, todo mundo publica.",
  },
});

const SELECT_PLATFORM = `
  SELECT p.id_profile,
         p.display_name,
         p.bio,
         p.avatar_url,
         p.community_kind AS kind,
         p.created_at
    FROM public.tb_profile p
   WHERE p.community_kind = $1
     AND p.is_community = TRUE
     AND p.deleted_at IS NULL
   LIMIT 1
`;

module.exports = {
  FINANCE_KIND,
  GAMES_KIND,
  PLATFORM_SEED,

  /** A plataforma daquele ambiente, ou null se ela ainda não existe. */
  async getPlatform(db, kind) {
    assertPlatformKind(kind, "PlatformStorage.getPlatform");
    const r = await db.query(SELECT_PLATFORM, [kind]);
    return r.rows[0] || null;
  },

  /**
   * A plataforma, criando-a se ainda não existir.
   *
   * ⚠️ A CORRIDA É RESOLVIDA PELO BANCO, não por lock de aplicação: o índice
   * único sobre expressão constante (`ux_profile_finance_singleton`,
   * `ux_profile_games_singleton`) faz de dois primeiros acessos simultâneos um
   * insert e um conflito — e o `ON CONFLICT DO NOTHING` transforma o perdedor
   * num no-op que relê a linha do vencedor.
   *
   * ⚠️ E ELA NASCE SEM LÍDER (`id_leader_user` fica NULL, que é o default da
   * coluna): é isso que tira as portas de edição da mão de quem abriu a tela
   * primeiro. O `id_user` é o admin mais antigo — a coluna é NOT NULL e alguém
   * precisa constar; é escrituração, não posse.
   */
  async getOrCreatePlatform(db, kind) {
    assertPlatformKind(kind, "PlatformStorage.getOrCreatePlatform");
    return runWithLogs(log, "getOrCreatePlatform", () => ({ kind }), async () => {
      const existing = await this.getPlatform(db, kind);
      if (existing) return existing;

      const seed = PLATFORM_SEED[kind];
      await db.query(
        `INSERT INTO public.tb_profile (
           id_user, sub_profile_slug, display_name, bio,
           is_community, community_kind, community_privacy,
           is_clan, is_visible, is_active, id_category, id_machine
         )
         SELECT u.id_user, $2::text, $3::text, $4::text,
                TRUE, $1::text, 'public',
                FALSE, TRUE, TRUE, NULL, NULL
           FROM public.tb_user u
          ORDER BY u.is_admin DESC, u.created_at
          LIMIT 1
         ON CONFLICT DO NOTHING`,
        [kind, seed.slug, seed.name, seed.bio]
      );

      return await this.getPlatform(db, kind);
    });
  },
};
