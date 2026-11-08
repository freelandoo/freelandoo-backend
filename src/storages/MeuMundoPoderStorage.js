/**
 * Rankings do Meu Mundo (B7, migs 334/335). SQL puro.
 *
 * Poder: tb_mm_character.power (gravado pela vida, MeuMundoPowerService); o ranking pega o
 * melhor personagem VIVO de cada pessoa (hoje um vivo por pessoa; o B3 vai ter vários). O de Nível lê tb_mm_adventure (por pessoa).
 * Recorte: Brasil inteiro (o jogo não tem recorte regional ainda). Menor de idade fica fora,
 * como no ranking da Freelandoo.
 */
const { avatarBody } = require("../utils/meuMundoSkins");
const { clanBody } = require("../utils/meuMundoClans");

/** Quem aparece: nome do perfil-conta, foto e o corpo que o jogo desenha. */
const WHO = `
  COALESCE(NULLIF(pro.display_name, ''), u.username) AS name,
  u.username,
  pro.avatar_url,
  ap.body AS pref_body, ap.skin AS pref_skin, k.clan, k.sex,
  (SELECT ch.growth->>'stage' FROM tb_mm_character ch
    WHERE ch.id_user = u.id_user ORDER BY ch.generation DESC LIMIT 1) AS stage`;
const WHO_JOIN = `
  JOIN tb_user u ON u.id_user = b.id_user
  LEFT JOIN LATERAL (
    SELECT p.display_name, p.avatar_url FROM tb_profile p
     WHERE p.id_user = u.id_user AND p.is_user_account = TRUE AND p.deleted_at IS NULL
     LIMIT 1
  ) pro ON TRUE
  LEFT JOIN tb_mm_avatar_pref ap ON ap.id_user = u.id_user
  LEFT JOIN tb_mm_clan k ON k.id_user = u.id_user`;

function who(r) {
  return {
    idUser: r.id_user,
    name: r.name || r.username || "",
    username: r.username || null,
    avatar: r.avatar_url || null,
    body: avatarBody(r.pref_body || "normal", r.pref_skin, clanBody(r.clan, r.sex, r.stage)),
  };
}

/** O melhor personagem vivo de cada pessoa, já com a posição (empate: quem chegou antes). */
const BEST_POWER = `
  WITH best AS (
    SELECT DISTINCT ON (ch.id_user) ch.id_user, ch.id_character, ch.power AS poder, ch.power_at AS updated_at
      FROM tb_mm_character ch
      JOIN tb_user uu ON uu.id_user = ch.id_user
     WHERE ch.status = 'alive' AND ch.power IS NOT NULL AND uu.is_minor = FALSE
     ORDER BY ch.id_user, ch.power DESC, ch.power_at ASC NULLS LAST
  ), ranked AS (
    SELECT best.*, ROW_NUMBER() OVER (ORDER BY poder DESC, updated_at ASC NULLS LAST, id_user) AS position FROM best
  )`;

const BEST_LEVEL = `
  WITH players AS (
    SELECT DISTINCT ch.id_user FROM tb_mm_character ch
  ), ranked AS (
    -- quem nunca lutou ainda não tem linha de aventura: nível 1, 0 de XP
    SELECT p.id_user, COALESCE(a.level, 1) AS level, COALESCE(a.xp, 0) AS xp, a.updated_at,
           ROW_NUMBER() OVER (ORDER BY COALESCE(a.level, 1) DESC, COALESCE(a.xp, 0) DESC, a.updated_at ASC NULLS LAST, p.id_user) AS position
      FROM players p
      JOIN tb_user uu ON uu.id_user = p.id_user
      LEFT JOIN tb_mm_adventure a ON a.id_user = p.id_user
     WHERE uu.is_minor = FALSE
  )`;

class MeuMundoPoderStorage {
  static async topPower(db, limit = 100) {
    const r = await db.query(
      `${BEST_POWER}
       SELECT b.position, b.poder, b.id_character, b.id_user, ${WHO}
         FROM (SELECT * FROM ranked ORDER BY position LIMIT $1) b
         ${WHO_JOIN}
        ORDER BY b.position`,
      [limit]
    );
    return r.rows.map((x) => ({ position: Number(x.position), value: x.poder, idCharacter: x.id_character, ...who(x) }));
  }

  static async myPower(db, idUser) {
    const r = await db.query(
      `${BEST_POWER}
       SELECT b.position, b.poder, b.id_character, b.id_user, ${WHO}
         FROM (SELECT * FROM ranked WHERE id_user = $1) b
         ${WHO_JOIN}`,
      [idUser]
    );
    const x = r.rows[0];
    return x ? { position: Number(x.position), value: x.poder, idCharacter: x.id_character, ...who(x) } : null;
  }

  static async topLevel(db, limit = 100) {
    const r = await db.query(
      `${BEST_LEVEL}
       SELECT b.position, b.level, b.xp, b.id_user, ${WHO}
         FROM (SELECT * FROM ranked ORDER BY position LIMIT $1) b
         ${WHO_JOIN}
        ORDER BY b.position`,
      [limit]
    );
    return r.rows.map((x) => ({ position: Number(x.position), value: x.level, xp: Number(x.xp), ...who(x) }));
  }

  static async myLevel(db, idUser) {
    const r = await db.query(
      `${BEST_LEVEL}
       SELECT b.position, b.level, b.xp, b.id_user, ${WHO}
         FROM (SELECT * FROM ranked WHERE id_user = $1) b
         ${WHO_JOIN}`,
      [idUser]
    );
    const x = r.rows[0];
    return x ? { position: Number(x.position), value: x.level, xp: Number(x.xp), ...who(x) } : null;
  }

  /** Perfil-conta da pessoa (o ranking da Freelandoo é por perfil). */
  static async accountProfile(db, idUser) {
    const r = await db.query(
      `SELECT id_profile FROM tb_profile WHERE id_user = $1 AND is_user_account = TRUE AND deleted_at IS NULL LIMIT 1`,
      [idUser]
    );
    return r.rows[0]?.id_profile || null;
  }
}

module.exports = MeuMundoPoderStorage;
