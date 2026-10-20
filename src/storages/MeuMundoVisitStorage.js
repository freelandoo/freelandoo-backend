// src/storages/MeuMundoVisitStorage.js — MEU MUNDO 3D: convites e visitas (mig 293).
//
// Só SQL. As regras (quem pode convidar, quem pode aceitar, prazos) ficam no
// MeuMundoService; as garantias de unicidade são do banco (índices parciais).

const VISIT_SELECT = `
  SELECT v.id_visit, v.id_host, v.id_guest, v.id_house, v.status, v.created_at, v.expires_at,
         v.accepted_at, v.closed_at, v.end_reason,
         uh.username AS host_name, ug.username AS guest_name,
         l.lot_number, n.id_neighborhood, n.name AS neighborhood_name
    FROM tb_mm_visit v
    JOIN tb_user uh ON uh.id_user = v.id_host
    JOIN tb_user ug ON ug.id_user = v.id_guest
    JOIN tb_mm_house h ON h.id_house = v.id_house
    JOIN tb_mm_lot l ON l.id_lot = h.id_lot
    JOIN tb_mm_neighborhood n ON n.id_neighborhood = l.id_neighborhood`;

class MeuMundoVisitStorage {
  static async create(db, { idHost, idGuest, idHouse, ttlMs }) {
    const r = await db.query(
      `INSERT INTO tb_mm_visit (id_host, id_guest, id_house, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4::int * INTERVAL '1 millisecond'))
       RETURNING id_visit`,
      [idHost, idGuest, idHouse, Math.round(ttlMs)]
    );
    return r.rows[0].id_visit;
  }

  static async getById(db, idVisit, forUpdate = false) {
    const r = await db.query(`${VISIT_SELECT} WHERE v.id_visit = $1${forUpdate ? " FOR UPDATE OF v" : ""}`, [idVisit]);
    return r.rows[0] || null;
  }

  /** Convites pendentes e visita ativa em que a pessoa aparece (como anfitrião ou convidado). */
  static async listLiveFor(db, idUser) {
    const r = await db.query(
      `${VISIT_SELECT} WHERE (v.id_host = $1 OR v.id_guest = $1) AND v.status IN ('pending', 'active')
        ORDER BY v.created_at`,
      [idUser]
    );
    return r.rows;
  }

  static async activeAsGuest(db, idUser) {
    const r = await db.query(`${VISIT_SELECT} WHERE v.id_guest = $1 AND v.status = 'active'`, [idUser]);
    return r.rows[0] || null;
  }

  static async liveAsHost(db, idUser) {
    const r = await db.query(`${VISIT_SELECT} WHERE v.id_host = $1 AND v.status IN ('pending', 'active')`, [idUser]);
    return r.rows[0] || null;
  }

  static async activeList(db) {
    const r = await db.query(`${VISIT_SELECT} WHERE v.status = 'active'`);
    return r.rows;
  }

  /** Transição guardada: só muda se o estado atual for um dos `from`. */
  static async transition(db, idVisit, from, to, reason = null) {
    const r = await db.query(
      `UPDATE tb_mm_visit
          SET status = $3,
              accepted_at = CASE WHEN $3 = 'active' THEN NOW() ELSE accepted_at END,
              closed_at = CASE WHEN $3 = 'active' THEN NULL ELSE NOW() END,
              end_reason = COALESCE($4, end_reason)
        WHERE id_visit = $1 AND status = ANY($2::text[])
        RETURNING id_visit`,
      [idVisit, from, to, reason]
    );
    return r.rowCount === 1;
  }

  /** Pendentes vencidos viram 'expired'. Devolve os afetados (para avisar). */
  static async expirePending(db) {
    const r = await db.query(
      `UPDATE tb_mm_visit SET status = 'expired', closed_at = NOW(), end_reason = 'timeout'
        WHERE status = 'pending' AND expires_at <= NOW()
        RETURNING id_visit, id_host, id_guest`
    );
    return r.rows;
  }

  /** Encerra tudo que estiver vivo numa casa (troca de titular, por exemplo). */
  static async closeAllForHouse(db, idHouse, reason) {
    const r = await db.query(
      `UPDATE tb_mm_visit
          SET status = CASE WHEN status = 'pending' THEN 'canceled' ELSE 'ended' END,
              closed_at = NOW(), end_reason = $2
        WHERE id_house = $1 AND status IN ('pending', 'active')
        RETURNING id_visit, id_host, id_guest`,
      [idHouse, reason]
    );
    return r.rows;
  }
}

module.exports = MeuMundoVisitStorage;
