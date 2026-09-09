// src/storages/FinanceStorage.js
//
// A PLATAFORMA FINANCEIRO (mig 229) — uma só, da Freelandoo inteira.
//
// Este arquivo faz uma coisa: dizer QUAL é a linha do Financeiro. Todo o resto
// — feed, composer, curtida, comentário, denúncia — é a máquina de comunidade
// que já existe, e é ela que recebe esse id. Um storage próprio de "posts
// financeiros" seria a segunda máquina que a mig 229 existe para não criar.

const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FinanceStorage");

/** A modalidade. Escrita uma vez, usada por todas as consultas daqui. */
const FINANCE_KIND = "finance";

const SELECT_PLATFORM = `
  SELECT p.id_profile,
         p.display_name,
         p.bio,
         p.avatar_url,
         p.community_kind AS kind,
         p.created_at
    FROM public.tb_profile p
   WHERE p.community_kind = $1
     AND p.deleted_at IS NULL
   LIMIT 1
`;

module.exports = {
  FINANCE_KIND,

  /** A plataforma, ou null se ela ainda não existe. */
  async getPlatform(db) {
    const r = await db.query(SELECT_PLATFORM, [FINANCE_KIND]);
    return r.rows[0] || null;
  },

  /**
   * A plataforma, criando-a se ainda não existir.
   *
   * ⚠️ A CORRIDA É RESOLVIDA PELO BANCO, não por lock de aplicação: o índice
   * `ux_profile_finance_singleton` (mig 229) é único sobre expressão constante,
   * então dois primeiros acessos simultâneos produzem UM insert e um conflito —
   * e o `ON CONFLICT DO NOTHING` transforma o perdedor num no-op que relê a
   * linha do vencedor. Sem isso a plataforma nasceria duplicada e os posts se
   * dividiriam entre dois murais.
   *
   * O dono segue a MESMA regra do seed da migration (admin mais antigo, senão o
   * usuário mais antigo) — divergindo, o caminho tardio criaria a plataforma no
   * nome de outra pessoa. É escrituração: ninguém lidera o Financeiro.
   */
  async getOrCreatePlatform(db) {
    return runWithLogs(log, "getOrCreatePlatform", () => ({}), async () => {
      const existing = await this.getPlatform(db);
      if (existing) return existing;

      await db.query(
        `INSERT INTO public.tb_profile (
           id_user, sub_profile_slug, display_name, bio,
           is_community, community_kind, community_privacy,
           is_clan, is_visible, is_active, id_category, id_machine
         )
         SELECT u.id_user, 'financeiro', 'Financeiro',
                'O mundo financeiro da Freelandoo. Todo mundo lê, todo mundo publica.',
                TRUE, $1, 'public',
                FALSE, TRUE, TRUE, NULL, NULL
           FROM public.tb_user u
          ORDER BY u.is_admin DESC, u.created_at
          LIMIT 1
         ON CONFLICT DO NOTHING`,
        [FINANCE_KIND]
      );

      return await this.getPlatform(db);
    });
  },
};
