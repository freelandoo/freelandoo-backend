/**
 * PostReportStorage — denúncias de posts (tb_post_report) +
 * agregados em tb_profile_portfolio_item.
 */

// Enum espelha ReportMessageDialog (chat moderation). Mantemos os códigos em
// inglês para alinhar com o restante do sistema de denúncia já em produção.
const REASON_CATEGORIES = new Set([
  "spam",
  "fraud",
  "harassment",
  "inappropriate",
  "hate",
  "forbidden_item",
  "personal_data",
  "other",
]);

async function insertReport(db, { id_portfolio_item, reporter_user_id, reason_category, reason }) {
  const r = await db.query(
    `
    INSERT INTO public.tb_post_report
      (id_portfolio_item, reporter_user_id, reason_category, reason)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id_portfolio_item, reporter_user_id) DO NOTHING
    RETURNING id_post_report
    `,
    [id_portfolio_item, reporter_user_id, reason_category, reason || null]
  );
  return r.rows[0] || null;
}

async function recountReports(db, id_portfolio_item) {
  await db.query(
    `
    WITH top AS (
      SELECT reason_category, COUNT(*)::int AS c
        FROM public.tb_post_report
       WHERE id_portfolio_item = $1
       GROUP BY reason_category
       ORDER BY c DESC, reason_category ASC
       LIMIT 1
    ), total AS (
      SELECT COUNT(*)::int AS c FROM public.tb_post_report WHERE id_portfolio_item = $1
    )
    UPDATE public.tb_profile_portfolio_item ppi
       SET report_count = (SELECT c FROM total),
           top_report_reason = (SELECT reason_category FROM top)
     WHERE ppi.id_portfolio_item = $1
    `,
    [id_portfolio_item]
  );
}

// Marca as denúncias do post como resolvidas (sem banir) — sai do alerta admin.
async function resolveReports(db, { id_portfolio_item, resolved_by_user_id }) {
  const r = await db.query(
    `
    UPDATE public.tb_profile_portfolio_item
       SET reports_resolved_at = NOW(),
           reports_resolved_by_user_id = $2
     WHERE id_portfolio_item = $1
     RETURNING id_portfolio_item, reports_resolved_at
    `,
    [id_portfolio_item, resolved_by_user_id]
  );
  return r.rows[0] || null;
}

// Zera a resolução — chamado quando chega uma denúncia NOVA, pra reabrir o alerta.
async function clearResolved(db, id_portfolio_item) {
  await db.query(
    `
    UPDATE public.tb_profile_portfolio_item
       SET reports_resolved_at = NULL,
           reports_resolved_by_user_id = NULL
     WHERE id_portfolio_item = $1
    `,
    [id_portfolio_item]
  );
}

// Lista enxuta para o modal de alerta: denunciados, não banidos, não resolvidos.
async function listReportedForAlert(db, { limit = 50 } = {}) {
  const r = await db.query(
    `
    SELECT
      ppi.id_portfolio_item::text   AS id,
      ppi.title,
      ppi.feed_kind,
      ppi.report_count,
      ppi.top_report_reason,
      pro.display_name              AS owner_name,
      tu.username                   AS owner_username,
      (
        SELECT COALESCE(ppm.thumbnail_url, ppm.media_url)
          FROM public.tb_profile_portfolio_media ppm
         WHERE ppm.id_portfolio_item = ppi.id_portfolio_item
         ORDER BY ppm.sort_order, ppm.created_at
         LIMIT 1
      )                             AS thumbnail_url
      FROM public.tb_profile_portfolio_item ppi
      JOIN public.tb_profile pro ON pro.id_profile = ppi.id_profile
      JOIN public.tb_user    tu  ON tu.id_user     = pro.id_user
     WHERE ppi.report_count > 0
       AND ppi.is_banned = FALSE
       AND ppi.reports_resolved_at IS NULL
     ORDER BY ppi.report_count DESC, ppi.published_at DESC NULLS LAST
     LIMIT $1
    `,
    [limit]
  );
  return r.rows;
}

// Soft-ban: marca is_banned=TRUE. As queries públicas (feed + perfil) filtram
// AND is_banned = FALSE, então isso já tira o post do ar em todo lugar. NÃO
// mexemos em is_active (estado do próprio dono) nem em deleted_at — esta tabela
// não tem coluna deleted_at; escrever nela derrubava o ban com erro 500 e o
// botão "Suspender" falhava silenciosamente (o post continuava no feed).
async function ban(db, { id_portfolio_item, banned_by_user_id }) {
  const r = await db.query(
    `
    UPDATE public.tb_profile_portfolio_item
       SET is_banned = TRUE,
           banned_at = NOW(),
           banned_by_user_id = $2
     WHERE id_portfolio_item = $1
     RETURNING id_portfolio_item, is_banned, banned_at, banned_by_user_id
    `,
    [id_portfolio_item, banned_by_user_id]
  );
  return r.rows[0] || null;
}

// Restaurar: tira o ban (volta ao feed) e JÁ marca as denúncias como resolvidas,
// pra o post NÃO reaparecer no modal de alerta do admin. Uma denúncia nova futura
// zera reports_resolved_at (clearResolved) e o alerta volta a aparecer.
async function unban(db, { id_portfolio_item, resolved_by_user_id }) {
  const r = await db.query(
    `
    UPDATE public.tb_profile_portfolio_item
       SET is_banned = FALSE,
           banned_at = NULL,
           banned_by_user_id = NULL,
           reports_resolved_at = NOW(),
           reports_resolved_by_user_id = $2
     WHERE id_portfolio_item = $1
     RETURNING id_portfolio_item, is_banned, reports_resolved_at
    `,
    [id_portfolio_item, resolved_by_user_id || null]
  );
  return r.rows[0] || null;
}

async function adminList(db, { q, sort, minReports, limit, offset }) {
  const params = [];
  const where = [];

  if (q) {
    params.push(`%${q.trim()}%`);
    where.push(
      `(pro.display_name ILIKE $${params.length} OR ppi.title ILIKE $${params.length})`
    );
  }
  if (typeof minReports === "number" && minReports > 0) {
    params.push(minReports);
    where.push(`ppi.report_count >= $${params.length}`);
  }

  const orderBy = (() => {
    switch (sort) {
      case "newest":      return "ppi.published_at DESC NULLS LAST";
      case "oldest":      return "ppi.published_at ASC NULLS LAST";
      case "reports":     return "ppi.report_count DESC, ppi.published_at DESC NULLS LAST";
      default:            return "ppi.report_count DESC, ppi.published_at DESC NULLS LAST";
    }
  })();

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const itemsSql = `
    SELECT
      ppi.id_portfolio_item::text                AS id,
      ppi.title,
      ppi.feed_kind,
      ppi.published_at,
      ppi.report_count,
      ppi.top_report_reason,
      ppi.is_banned,
      ppi.banned_at,
      ppi.reports_resolved_at,
      pro.id_profile::text                       AS id_profile,
      pro.display_name                           AS owner_name,
      pro.avatar_url                             AS owner_avatar,
      tu.username                                AS owner_username,
      m.name                                     AS machine_name,
      m.color_accent                             AS machine_color,
      (
        SELECT jsonb_build_object(
          'url', ppm.media_url,
          'type', ppm.media_type,
          'thumbnail_url', ppm.thumbnail_url
        )
          FROM public.tb_profile_portfolio_media ppm
         WHERE ppm.id_portfolio_item = ppi.id_portfolio_item
         ORDER BY ppm.sort_order, ppm.created_at
         LIMIT 1
      )                                          AS first_media
      FROM public.tb_profile_portfolio_item ppi
      JOIN public.tb_profile pro ON pro.id_profile = ppi.id_profile
      JOIN public.tb_user    tu  ON tu.id_user     = pro.id_user
      LEFT JOIN public.tb_category ca ON ca.id_category = pro.id_category
      LEFT JOIN public.tb_machine  m  ON m.id_machine   = COALESCE(ca.id_machine, pro.id_machine)
      ${whereSql}
     ORDER BY ${orderBy}
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;
  const countSql = `
    SELECT COUNT(*)::int AS c
      FROM public.tb_profile_portfolio_item ppi
      JOIN public.tb_profile pro ON pro.id_profile = ppi.id_profile
      ${whereSql}
  `;

  const [rows, count] = await Promise.all([
    db.query(itemsSql, [...params, limit, offset]),
    db.query(countSql, params),
  ]);

  return { items: rows.rows, total: count.rows[0]?.c || 0 };
}

async function adminGetPreview(db, id_portfolio_item) {
  const r = await db.query(
    `
    SELECT
      ppi.id_portfolio_item::text                AS id,
      ppi.title,
      ppi.description,
      ppi.feed_kind,
      ppi.published_at,
      ppi.report_count,
      ppi.top_report_reason,
      ppi.is_banned,
      ppi.banned_at,
      pro.id_profile::text                       AS id_profile,
      pro.display_name                           AS owner_name,
      pro.avatar_url                             AS owner_avatar,
      tu.username                                AS owner_username,
      m.name                                     AS machine_name,
      m.color_accent                             AS machine_color,
      COALESCE(media.media_json, '[]'::jsonb)    AS media,
      COALESCE(reports.reasons_json, '[]'::jsonb) AS reasons
      FROM public.tb_profile_portfolio_item ppi
      JOIN public.tb_profile pro ON pro.id_profile = ppi.id_profile
      JOIN public.tb_user    tu  ON tu.id_user     = pro.id_user
      LEFT JOIN public.tb_category ca ON ca.id_category = pro.id_category
      LEFT JOIN public.tb_machine  m  ON m.id_machine   = COALESCE(ca.id_machine, pro.id_machine)
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'url', ppm.media_url,
          'type', ppm.media_type,
          'thumbnail_url', ppm.thumbnail_url
        ) ORDER BY ppm.sort_order, ppm.created_at) AS media_json
          FROM public.tb_profile_portfolio_media ppm
         WHERE ppm.id_portfolio_item = ppi.id_portfolio_item
      ) media ON TRUE
      LEFT JOIN LATERAL (
        SELECT jsonb_agg(jsonb_build_object(
          'reason_category', reason_category,
          'count', c
        ) ORDER BY c DESC) AS reasons_json
          FROM (
            SELECT reason_category, COUNT(*)::int AS c
              FROM public.tb_post_report
             WHERE id_portfolio_item = ppi.id_portfolio_item
             GROUP BY reason_category
          ) sub
      ) reports ON TRUE
     WHERE ppi.id_portfolio_item = $1
    `,
    [id_portfolio_item]
  );
  return r.rows[0] || null;
}

module.exports = {
  REASON_CATEGORIES,
  insertReport,
  recountReports,
  resolveReports,
  clearResolved,
  listReportedForAlert,
  ban,
  unban,
  adminList,
  adminGetPreview,
};
