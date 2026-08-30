// src/storages/CondoNoticeStorage.js
// SQL dos avisos do condomínio (mig 197). Aviso geral vai para o mural de
// avisos; aviso direcionado a uma unidade/vaga só é visível para o autor, o
// responsável pelo alvo e a administração — o recorte é feito aqui no SQL.

const { residentUnitIdsSql } = require("../utils/condoResidentSql");

const SELECT_COLS = `
  n.id_notice, n.id_condo, n.id_author, n.scope, n.id_unit, n.id_spot,
  n.title, n.body, n.is_pinned, n.created_at,
  au.username AS author_username,
  au.nome     AS author_name,
  u.label     AS unit_number,
  b.name      AS block_name,
  pk.code     AS spot_code,
  (r.id_user IS NOT NULL) AS is_read
`;

const JOINS = `
  JOIN public.tb_user au ON au.id_user = n.id_author
  LEFT JOIN public.tb_residence_unit u  ON u.id_unit  = n.id_unit
  LEFT JOIN public.tb_condo_block   b  ON b.id_block = u.id_block
  LEFT JOIN public.tb_condo_parking pk ON pk.id_spot = n.id_spot
  LEFT JOIN public.tb_condo_notice_read r
    ON r.id_notice = n.id_notice AND r.id_user = $2
`;

class CondoNoticeStorage {
  static async create(conn, { id_condo, id_author, scope, id_unit, id_spot, title, body }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_notice
         (id_condo, id_author, scope, id_unit, id_spot, title, body)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id_notice, id_condo, id_author, scope, id_unit, id_spot,
                 title, body, is_pinned, created_at`,
      [id_condo, id_author, scope, id_unit ?? null, id_spot ?? null, title ?? null, body]
    );
    return r.rows[0];
  }

  static async getById(conn, id_condo, id_notice) {
    const r = await conn.query(
      `SELECT id_notice, id_condo, id_author, scope, id_unit, id_spot, title, body
         FROM public.tb_condo_notice
        WHERE id_condo = $1 AND id_notice = $2 AND deleted_at IS NULL
        LIMIT 1`,
      [id_condo, id_notice]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // is_admin = TRUE vê todos os avisos (é quem administra o prédio).
  // Morador comum vê: os gerais + os direcionados a alguma unidade/vaga dele
  // + os que ele mesmo escreveu.
  static async list(conn, id_condo, { id_user, is_admin = false, scope = null, limit = 50, offset = 0 } = {}) {
    const params = [id_condo, id_user ?? null];
    let visibility = "";
    if (!is_admin) {
      visibility = `
        AND (
          n.scope = 'general'
          OR n.id_author = $2
          OR (n.id_unit IS NOT NULL AND n.id_unit IN (
                ${residentUnitIdsSql("$1", "$2")}))
          OR (n.id_spot IS NOT NULL AND n.id_spot IN (
                SELECT id_spot FROM public.tb_condo_parking
                 WHERE id_condo = $1 AND id_holder_user = $2))
        )`;
    }
    let scopeFilter = "";
    if (scope === "mine") {
      // Caixa do morador: só o que foi direcionado a ele.
      scopeFilter = `
        AND n.scope <> 'general'
        AND (
          (n.id_unit IS NOT NULL AND n.id_unit IN (
              ${residentUnitIdsSql("$1", "$2")}))
          OR (n.id_spot IS NOT NULL AND n.id_spot IN (
              SELECT id_spot FROM public.tb_condo_parking
               WHERE id_condo = $1 AND id_holder_user = $2))
        )`;
    } else if (scope === "general") {
      scopeFilter = ` AND n.scope = 'general'`;
    }

    params.push(Math.min(Number(limit) || 50, 100));
    params.push(Number(offset) || 0);

    const r = await conn.query(
      `SELECT ${SELECT_COLS}
         FROM public.tb_condo_notice n
         ${JOINS}
        WHERE n.id_condo = $1
          AND n.deleted_at IS NULL
          ${visibility}
          ${scopeFilter}
        ORDER BY n.is_pinned DESC, n.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async countUnreadForUser(conn, id_condo, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_condo_notice n
         LEFT JOIN public.tb_condo_notice_read r
           ON r.id_notice = n.id_notice AND r.id_user = $2
        WHERE n.id_condo = $1
          AND n.deleted_at IS NULL
          AND n.scope <> 'general'
          AND r.id_user IS NULL
          AND (
            (n.id_unit IS NOT NULL AND n.id_unit IN (
                ${residentUnitIdsSql("$1", "$2")}))
            OR (n.id_spot IS NOT NULL AND n.id_spot IN (
                SELECT id_spot FROM public.tb_condo_parking
                 WHERE id_condo = $1 AND id_holder_user = $2))
          )`,
      [id_condo, id_user]
    );
    return r.rows[0]?.n || 0;
  }

  static async markRead(conn, id_notice, id_user) {
    await conn.query(
      `INSERT INTO public.tb_condo_notice_read (id_notice, id_user)
            VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [id_notice, id_user]
    );
    return true;
  }

  static async softDelete(conn, id_condo, id_notice) {
    const r = await conn.query(
      `UPDATE public.tb_condo_notice
          SET deleted_at = NOW()
        WHERE id_condo = $1 AND id_notice = $2 AND deleted_at IS NULL`,
      [id_condo, id_notice]
    );
    return r.rowCount > 0;
  }

  static async setPinned(conn, id_condo, id_notice, is_pinned) {
    const r = await conn.query(
      `UPDATE public.tb_condo_notice
          SET is_pinned = $3
        WHERE id_condo = $1 AND id_notice = $2 AND deleted_at IS NULL
        RETURNING id_notice, is_pinned`,
      [id_condo, id_notice, !!is_pinned]
    );
    return r.rowCount ? r.rows[0] : null;
  }
}

module.exports = CondoNoticeStorage;
