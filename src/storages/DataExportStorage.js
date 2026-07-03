// src/storages/DataExportStorage.js
// SQL puro (somente-leitura) da API de Dados (/ext/v1/data). Escopo: o DONO do
// token. NUNCA expõe dado financeiro (saldo/ganhos/repasses) — só dados
// operacionais/públicos: subperfis, comunidades, serviços, produtos, redes
// sociais, seguidores. Preços LISTADOS de serviço/produto/curso são operacionais
// e entram; receita/faturamento não.

class DataExportStorage {
  // Todos os perfis do usuário (conta, subperfis, clans, comunidades).
  static async listProfiles(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT
         p.id_profile,
         u.username,
         p.display_name,
         p.bio,
         p.avatar_url,
         p.sub_profile_slug,
         p.estado,
         p.municipio,
         c.desc_category      AS profession,
         c.profession_slug,
         m.slug               AS enxame_slug,
         m.name               AS enxame_name,
         p.is_user_account,
         COALESCE(p.is_clan, FALSE)      AS is_clan,
         COALESCE(p.is_community, FALSE) AS is_community,
         p.is_active,
         p.is_visible,
         p.created_at,
         EXISTS (
           SELECT 1 FROM public.tb_profile_subscription ps
            WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
         ) AS is_paid
       FROM public.tb_profile p
       JOIN public.tb_user u ON u.id_user = p.id_user
       LEFT JOIN public.tb_category c ON c.id_category = p.id_category
       LEFT JOIN public.tb_machine  m ON m.id_machine = COALESCE(c.id_machine, p.id_machine)
       WHERE p.id_user = $1 AND p.deleted_at IS NULL
       ORDER BY p.is_user_account DESC, p.created_at ASC`,
      [id_user]
    );
    return rows;
  }

  static async listServices(conn, profileIds) {
    if (!profileIds?.length) return [];
    const { rows } = await conn.query(
      `SELECT
         id_profile_service, id_profile, name, description,
         duration_minutes, price_amount, is_active,
         affiliates_allowed, created_at, updated_at
       FROM public.tb_profile_service
       WHERE id_profile = ANY($1::uuid[]) AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [profileIds]
    );
    return rows;
  }

  static async listProducts(conn, profileIds) {
    if (!profileIds?.length) return [];
    const { rows } = await conn.query(
      `SELECT
         id_profile_product, id_profile, name, description,
         price_amount, stock_quantity, is_active, moderation_status,
         id_product_category, created_at, updated_at
       FROM public.tb_profile_product
       WHERE id_profile = ANY($1::uuid[]) AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [profileIds]
    );
    return rows;
  }

  static async listSocial(conn, profileIds) {
    if (!profileIds?.length) return [];
    const { rows } = await conn.query(
      `SELECT
         sm.id_profile,
         t.desc_social_media_type AS network,
         sm.url,
         fr.follower_range,
         sm.phone_number_normalized
       FROM public.tb_profile_social_media sm
       JOIN public.tb_social_media_type t ON t.id_social_media_type = sm.id_social_media_type
       LEFT JOIN public.tb_follower_range fr ON fr.id_follower_range = sm.id_follower_range
       WHERE sm.id_profile = ANY($1::uuid[]) AND sm.is_active = TRUE
       ORDER BY sm.id_profile ASC, t.desc_social_media_type ASC`,
      [profileIds]
    );
    return rows;
  }

  // Seguidores por perfil (follow é user-level: alvo = perfil). Map id_profile→count.
  static async followerCounts(conn, profileIds) {
    if (!profileIds?.length) return new Map();
    const { rows } = await conn.query(
      `SELECT target_profile_id AS id_profile, COUNT(*)::int AS followers
         FROM public.tb_user_follow
        WHERE target_profile_id = ANY($1::uuid[])
        GROUP BY target_profile_id`,
      [profileIds]
    );
    const map = new Map();
    for (const r of rows) map.set(String(r.id_profile), r.followers);
    return map;
  }
}

module.exports = DataExportStorage;
