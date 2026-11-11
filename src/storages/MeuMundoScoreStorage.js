/**
 * Placar semanal do Meu Mundo (lore v2 N1, mig 440). SQL puro.
 *
 * Uma linha por conta × jogo × semana. `record` roda DENTRO da transação do
 * recibo (o chamador só chama com recibo novo): a marca da semana é a maior, a
 * menor ou a soma, conforme utils/meuMundoScores.js. O ranking é do Brasil
 * inteiro, sem menor de idade (como os outros rankings do jogo); empate = quem
 * fez a marca primeiro.
 */
const S = require("../utils/meuMundoScores");
const { WHO, WHO_JOIN, CHAR_ACTIVE, who } = require("./MeuMundoPoderStorage");

/** Como a linha guardada muda com uma partida nova (por tipo de jogo). */
function mergeSql(g) {
  if (g.kind === "sum")
    return `best = tb_mm_score.best + EXCLUDED.best, best_at = EXCLUDED.best_at`;
  const cmp = g.dir === "asc" ? "<" : ">";
  return `best = CASE WHEN EXCLUDED.best ${cmp} tb_mm_score.best THEN EXCLUDED.best ELSE tb_mm_score.best END,
          best_at = CASE WHEN EXCLUDED.best ${cmp} tb_mm_score.best THEN EXCLUDED.best_at ELSE tb_mm_score.best_at END`;
}

const ranked = (g) => `
  WITH ranked AS (
    SELECT sc.id_user, sc.best, sc.plays, sc.best_at,
           ROW_NUMBER() OVER (ORDER BY sc.best ${g.dir === "asc" ? "ASC" : "DESC"}, sc.best_at ASC, sc.id_user) AS position
      FROM tb_mm_score sc
      JOIN tb_user uu ON uu.id_user = sc.id_user
     WHERE sc.game = $1 AND sc.week = $2 AND uu.is_minor = FALSE
  )`;

const row = (x) => ({ position: Number(x.position), value: Number(x.best), plays: Number(x.plays), ...who(x) });

class MeuMundoScoreStorage {
  /**
   * Grava uma partida no placar da semana. `value` já validado (S.markOf).
   * Devolve a linha da semana depois da partida.
   */
  static async record(c, { idUser, game, week, value, at }) {
    const g = S.GAME_BY_ID.get(game);
    if (!g || g.kind === "live") throw new Error(`placar: jogo ${game} não grava`);
    const r = await c.query(
      `INSERT INTO tb_mm_score (id_user, game, week, best, plays, best_at, updated_at)
       VALUES ($1, $2, $3, $4, 1, $5, NOW())
       ON CONFLICT (id_user, game, week) DO UPDATE
          SET ${mergeSql(g)}, plays = tb_mm_score.plays + 1, updated_at = NOW()
       RETURNING best, plays`,
      [idUser, game, week, value, new Date(at)]
    );
    return { best: Number(r.rows[0].best), plays: Number(r.rows[0].plays) };
  }

  static async top(db, game, week, limit = 100) {
    const g = S.GAME_BY_ID.get(game);
    const r = await db.query(
      `${ranked(g)}
       SELECT b.position, b.best, b.plays, b.id_user, ${WHO}
         FROM (SELECT * FROM ranked ORDER BY position LIMIT $3) b
         ${WHO_JOIN}
         ${CHAR_ACTIVE}
        ORDER BY b.position`,
      [game, week, limit]
    );
    return r.rows.map(row);
  }

  static async mine(db, game, week, idUser) {
    const g = S.GAME_BY_ID.get(game);
    const r = await db.query(
      `${ranked(g)}
       SELECT b.position, b.best, b.plays, b.id_user, ${WHO}
         FROM (SELECT * FROM ranked WHERE id_user = $3) b
         ${WHO_JOIN}
         ${CHAR_ACTIVE}`,
      [game, week, idUser]
    );
    return r.rows[0] ? row(r.rows[0]) : null;
  }
}

module.exports = MeuMundoScoreStorage;
