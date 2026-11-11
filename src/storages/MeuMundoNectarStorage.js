/**
 * Néctar da semana do Meu Mundo (lore v2 N2, mig 441). SQL puro.
 *
 * `standings` lê o placar INTEIRO de um jogo numa semana (não só o top 100),
 * na mesma ordem do ranking da tela (empate = quem fez a marca primeiro; menor
 * de idade fora). O Poder é o número de AGORA (o fechamento roda logo depois
 * do sábado): a posição é a do ranking de Poder da tela, e o 1 L de quem fica
 * fora do top 10 só vai para quem jogou alguma coisa na semana.
 */
const S = require("../utils/meuMundoScores");
const { BEST_POWER } = require("./MeuMundoPoderStorage");

const num = (x) => ({ idUser: x.id_user, position: Number(x.position), value: Number(x.value), scored: x.scored !== false });

class MeuMundoNectarStorage {
  /** Placar completo de `game` na `week`: [{ idUser, position, value, scored }]. */
  static async standings(c, game, week) {
    const g = S.GAME_BY_ID.get(game);
    if (!g) throw new Error(`néctar: jogo ${game} não existe`);
    if (g.kind === "live") {
      const r = await c.query(
        `${BEST_POWER}
         SELECT ranked.id_user, ranked.position, ranked.poder AS value,
                EXISTS (SELECT 1 FROM tb_mm_score sc WHERE sc.id_user = ranked.id_user AND sc.week = $1) AS scored
           FROM ranked
          ORDER BY ranked.position`,
        [week]
      );
      return r.rows.map(num);
    }
    const r = await c.query(
      `SELECT sc.id_user, sc.best AS value,
              ROW_NUMBER() OVER (ORDER BY sc.best ${g.dir === "asc" ? "ASC" : "DESC"}, sc.best_at ASC, sc.id_user) AS position
         FROM tb_mm_score sc
         JOIN tb_user uu ON uu.id_user = sc.id_user
        WHERE sc.game = $1 AND sc.week = $2 AND uu.is_minor = FALSE
        ORDER BY position`,
      [game, week]
    );
    return r.rows.map(num);
  }

  /** A semana já fechou? (linha em tb_mm_nectar_week) */
  static async weekClosed(c, week) {
    const r = await c.query(`SELECT week, closed_at, accounts, total_ml FROM tb_mm_nectar_week WHERE week = $1`, [week]);
    return r.rows[0] || null;
  }

  /**
   * Grava o recibo de um prêmio. Devolve true só se for NOVO (a chave conta ×
   * semana × jogo impede o segundo crédito).
   */
  static async insertAward(c, { idUser, week, game, position, value, ml }) {
    const r = await c.query(
      `INSERT INTO tb_mm_nectar_award (id_user, week, game, position, value, ml)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id_user, week, game) DO NOTHING
       RETURNING id_user`,
      [idUser, week, game, position, value, ml]
    );
    return r.rowCount > 0;
  }

  /** Credita mL na carteira (néctar para entregar + total ganho). */
  static async credit(c, idUser, ml) {
    const r = await c.query(
      `INSERT INTO tb_mm_nectar_wallet (id_user, pending_ml, earned_ml, updated_at)
       VALUES ($1, $2, $2, NOW())
       ON CONFLICT (id_user) DO UPDATE
          SET pending_ml = tb_mm_nectar_wallet.pending_ml + EXCLUDED.pending_ml,
              earned_ml = tb_mm_nectar_wallet.earned_ml + EXCLUDED.earned_ml,
              updated_at = NOW()
       RETURNING pending_ml, earned_ml`,
      [idUser, ml]
    );
    return { pendingMl: Number(r.rows[0].pending_ml), earnedMl: Number(r.rows[0].earned_ml) };
  }

  static async markClosed(c, { week, accounts, totalMl }) {
    await c.query(
      `INSERT INTO tb_mm_nectar_week (week, accounts, total_ml) VALUES ($1, $2, $3)
       ON CONFLICT (week) DO NOTHING`,
      [week, accounts, totalMl]
    );
  }

  static async wallet(db, idUser) {
    const r = await db.query(`SELECT pending_ml, earned_ml FROM tb_mm_nectar_wallet WHERE id_user = $1`, [idUser]);
    const w = r.rows[0];
    return { pendingMl: w ? Number(w.pending_ml) : 0, earnedMl: w ? Number(w.earned_ml) : 0 };
  }

  /** Os prêmios de uma conta numa semana, na ordem dos jogos. */
  static async awards(db, idUser, week) {
    const r = await db.query(`SELECT game, position, value, ml FROM tb_mm_nectar_award WHERE id_user = $1 AND week = $2`, [idUser, week]);
    const order = new Map(S.GAMES.map((g, i) => [g.id, i]));
    return r.rows
      .map((x) => ({ game: x.game, position: Number(x.position), value: Number(x.value), ml: Number(x.ml) }))
      .sort((a, b) => order.get(a.game) - order.get(b.game));
  }
}

module.exports = MeuMundoNectarStorage;
