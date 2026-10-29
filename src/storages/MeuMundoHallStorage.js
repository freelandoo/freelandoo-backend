// src/storages/MeuMundoHallStorage.js — Salão do Hall da Fama (mm3d-48, mig 312).
//
// Quem ficou 3 meses seguidos em 1º numa prova. A porta do Salão pergunta
// `isMember`; lá dentro os nichos do Muro dos Herdeiros mostram `listMembers`
// (só o nome público, a prova e o mês — projeção campo a campo).

class MeuMundoHallStorage {
  static async isMember(db, idUser) {
    const r = await db.query(`SELECT 1 FROM tb_mm_hall_member WHERE id_user = $1 LIMIT 1`, [idUser]);
    return r.rowCount > 0;
  }

  static async listMembers(db, limit = 60) {
    const r = await db.query(
      `SELECT u.username AS name, m.game, to_char(m.since, 'YYYY-MM') AS since
         FROM tb_mm_hall_member m
         JOIN tb_user u ON u.id_user = m.id_user
        ORDER BY m.since DESC, m.created_at DESC
        LIMIT $1`,
      [limit]
    );
    return r.rows.map((x) => ({ name: x.name || "—", game: x.game, since: x.since }));
  }
}

module.exports = MeuMundoHallStorage;
