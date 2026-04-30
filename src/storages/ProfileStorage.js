class ProfileStorage {
  // CREATE
  static async createProfile(
    conn,
    { id_user, id_category, display_name, bio, avatar_url, estado, municipio }
  ) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_profile
        (id_user, id_category, display_name, bio, avatar_url, estado, municipio, sub_profile_slug)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7,
          COALESCE(
            (SELECT profession_slug FROM public.tb_category WHERE id_category = $2),
            'clan'
          )
        )
      RETURNING
        id_profile, id_user, id_category, display_name, bio, avatar_url,
        estado, municipio, sub_profile_slug, is_active, created_at, updated_at
      `,
      [id_user, id_category, display_name, bio, avatar_url, estado, municipio]
    );
    return r.rows[0];
  }

  static async getProfileById(conn, id_profile) {
    const r = await conn.query(
      `
    SELECT
      p.id_profile,
      p.id_user,
      u.username,
      p.id_category,
      c.desc_category,
      c.profession_slug,
      p.sub_profile_slug,
      c.id_machine,
      m.slug AS machine_slug,
      m.name AS machine_name,
      p.display_name,
      p.bio,
      p.avatar_url,
      p.is_active,
      p.is_clan,
      p.is_visible,
      p.deleted_at,
      p.created_at,
      p.updated_at,
      p.estado,
      p.municipio,
      EXISTS (
        SELECT 1 FROM public.tb_profile_subscription ps
         WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
      ) AS is_paid
    FROM public.tb_profile p
    JOIN public.tb_user u
      ON u.id_user = p.id_user
    LEFT JOIN public.tb_category c
      ON c.id_category = p.id_category
    LEFT JOIN public.tb_machine m
      ON m.id_machine = COALESCE(c.id_machine, p.id_machine)
    WHERE p.id_profile = $1
    LIMIT 1
    `,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Resolve perfil público pelo (handle, profession_slug). Usado pelas URLs SEO
   * /[profession]/[city]/@[handle]. Retorna o perfil mesmo se não-publicado;
   * o caller decide se exibe (publicado) ou retorna 404.
   */
  static async getPublicProfileByHandleAndProfession(
    conn,
    { handle, profession_slug }
  ) {
    const r = await conn.query(
      `
    SELECT
      p.id_profile,
      p.id_user,
      u.username,
      p.id_category,
      c.desc_category,
      c.profession_slug,
      p.sub_profile_slug,
      c.id_machine,
      m.slug AS machine_slug,
      m.name AS machine_name,
      p.display_name,
      p.bio,
      p.avatar_url,
      p.is_active,
      p.is_clan,
      p.is_visible,
      p.deleted_at,
      p.created_at,
      p.updated_at,
      p.estado,
      p.municipio,
      EXISTS (
        SELECT 1 FROM public.tb_profile_subscription ps
         WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
      ) AS is_paid
    FROM public.tb_profile p
    JOIN public.tb_user u
      ON u.id_user = p.id_user
    JOIN public.tb_category c
      ON c.id_category = p.id_category
    LEFT JOIN public.tb_machine m
      ON m.id_machine = c.id_machine
    WHERE lower(u.username) = lower($1)
      AND lower(c.profession_slug) = lower($2)
    LIMIT 1
    `,
      [handle, profession_slug]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Lista todos os perfis (id_profile, profession_slug) de um usuário pelo handle.
   * Usado quando precisamos descobrir o perfil canônico ao receber só o @handle.
   */
  static async listPublicProfilesByHandle(conn, handle) {
    const r = await conn.query(
      `
    SELECT
      p.id_profile,
      c.profession_slug,
      p.sub_profile_slug,
      c.desc_category,
      p.municipio,
      p.estado,
      p.is_clan,
      p.is_visible,
      p.deleted_at,
      EXISTS (
        SELECT 1 FROM public.tb_profile_subscription ps
         WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
      ) AS is_paid
    FROM public.tb_profile p
    JOIN public.tb_user u
      ON u.id_user = p.id_user
    JOIN public.tb_category c
      ON c.id_category = p.id_category
    WHERE lower(u.username) = lower($1)
      AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
    `,
      [handle]
    );
    return r.rows;
  }

  static async setVisibility(conn, id_profile, is_visible) {
    const r = await conn.query(
      `
      UPDATE public.tb_profile
         SET is_visible = $2,
             updated_at = NOW()
       WHERE id_profile = $1
         AND deleted_at IS NULL
      RETURNING *
      `,
      [id_profile, !!is_visible]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async softDeleteProfile(conn, id_profile) {
    const r = await conn.query(
      `
      UPDATE public.tb_profile
         SET deleted_at = NOW(),
             is_active  = FALSE,
             is_visible = FALSE,
             updated_at = NOW()
       WHERE id_profile = $1
         AND deleted_at IS NULL
      RETURNING id_profile
      `,
      [id_profile]
    );
    return r.rowCount > 0;
  }

  static async listProfilesByUser(conn, id_user) {
    const r = await conn.query(
      `
    SELECT
      p.id_profile,
      p.id_user,
      p.id_category,
      c.desc_category,
      p.display_name,
      p.bio,
      p.avatar_url,
      p.estado,
      p.municipio,
      p.is_active,
      p.created_at,
      p.updated_at,

      COALESCE(subq.subcategories, '[]'::jsonb) AS subcategories,
      COALESCE(stq.statuses, '[]'::jsonb)      AS statuses,
      COALESCE(smq.social_media, '[]'::jsonb)  AS social_media

    FROM public.tb_profile p
    JOIN public.tb_category c
      ON c.id_category = p.id_category

    -- subcategories agregadas (sem duplicar linhas do profile)
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'id_subcategory', s.id_subcategory,
            'id_category', s.id_category,
            'desc_subcategory', s.desc_subcategory
          )
          ORDER BY s.desc_subcategory
        ) AS subcategories
      FROM public.tb_profile_subcategory ps
      JOIN public.tb_subcategory s
        ON s.id_subcategory = ps.id_subcategory
       AND s.is_active = true
      WHERE ps.id_profile = p.id_profile
    ) subq ON true

    -- statuses agregados
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'id_status', st.id_status,
            'desc_status', st.desc_status,
            'created_at', ps2.created_at
          )
          ORDER BY ps2.created_at DESC
        ) AS statuses
      FROM public.tb_profile_status ps2
      JOIN public.tb_status st
        ON st.id_status = ps2.id_status
      WHERE ps2.id_profile = p.id_profile
    ) stq ON true

    -- social media agregada
    LEFT JOIN LATERAL (
      SELECT
        jsonb_agg(
          jsonb_build_object(
            'id_profile_social_media', psm.id_profile_social_media,
            'id_social_media_type', psm.id_social_media_type,
            'desc_social_media_type', smt.desc_social_media_type,
            'icon', smt.icon,
            'base_url', smt.url,
            'profile_url', psm.url,
            'id_follower_range', psm.id_follower_range,
            'follower_range', fr.follower_range,
            'phone_number_normalized', psm.phone_number_normalized,
            'is_active', psm.is_active
          )
          ORDER BY smt.desc_social_media_type
        ) AS social_media
      FROM public.tb_profile_social_media psm
      JOIN public.tb_social_media_type smt
        ON smt.id_social_media_type = psm.id_social_media_type
      LEFT JOIN public.tb_follower_range fr
        ON fr.id_follower_range = psm.id_follower_range
      WHERE psm.id_profile = p.id_profile
        AND psm.is_active = true
    ) smq ON true

    WHERE p.id_user = $1
      AND p.deleted_at IS NULL
    ORDER BY p.created_at DESC
    `,
      [id_user]
    );

    return r.rows;
  }

  static async updateProfile(conn, id_profile, payload) {
    const fields = [];
    const values = [id_profile];
    let idx = 2;

    const has = (k) => Object.prototype.hasOwnProperty.call(payload, k);

    // permite setar null quando a chave existir
    if (has("id_category")) {
      fields.push(`id_category = $${idx++}`);
      values.push(payload.id_category); // pode ser number
      // Sincroniza sub_profile_slug com a nova categoria (mantém 'clan' se id_category=null)
      fields.push(
        `sub_profile_slug = COALESCE(
          (SELECT profession_slug FROM public.tb_category WHERE id_category = $${idx - 1}),
          'clan'
        )`
      );
    }

    if (has("display_name")) {
      fields.push(`display_name = $${idx++}`);
      values.push(payload.display_name); // pode ser null se você quiser permitir
    }

    if (has("bio")) {
      fields.push(`bio = $${idx++}`);
      values.push(payload.bio); // ✅ null limpa
    }

    if (has("avatar_url")) {
      fields.push(`avatar_url = $${idx++}`);
      values.push(payload.avatar_url); // ✅ null limpa
    }

    if (has("estado")) {
      fields.push(`estado = $${idx++}`);
      values.push(payload.estado); // ✅ null limpa
    }

    if (has("municipio")) {
      fields.push(`municipio = $${idx++}`);
      values.push(payload.municipio); // ✅ null limpa
    }

    if (has("is_active")) {
      fields.push(`is_active = $${idx++}`);
      values.push(payload.is_active); // boolean
    }

    if (fields.length === 0) return null;

    const r = await conn.query(
      `
    UPDATE public.tb_profile
    SET ${fields.join(", ")}
    WHERE id_profile = $1
    RETURNING *
    `,
      values
    );

    return r.rowCount ? r.rows[0] : null;
  }

  // DELETE lógico
  static async disableProfile(conn, id_profile) {
    const r = await conn.query(
      `
      UPDATE public.tb_profile
      SET is_active = false
      WHERE id_profile = $1
      `,
      [id_profile]
    );
    return r.rowCount > 0;
  }

  // SUBCATEGORIES
  static async clearProfileSubcategories(conn, id_profile) {
    await conn.query(
      `DELETE FROM public.tb_profile_subcategory WHERE id_profile = $1`,
      [id_profile]
    );
  }

  static async insertProfileSubcategory(conn, { id_profile, id_subcategory }) {
    await conn.query(
      `
      INSERT INTO public.tb_profile_subcategory (id_profile, id_subcategory)
      VALUES ($1, $2)
      ON CONFLICT (id_profile, id_subcategory) DO NOTHING
      `,
      [id_profile, id_subcategory]
    );
  }

  static async listSubcategoriesByProfile(conn, id_profile) {
    const r = await conn.query(
      `
    SELECT ps.id_subcategory, s.desc_subcategory, s.id_category
    FROM public.tb_profile_subcategory ps
    JOIN public.tb_subcategory s
      ON s.id_subcategory = ps.id_subcategory
     AND s.is_active = true
    WHERE ps.id_profile = $1
    ORDER BY ps.id_subcategory
    `,
      [id_profile]
    );
    return r.rows;
  }

  // PROFILE STATUS
  static async clearProfileStatuses(conn, id_profile) {
    await conn.query(
      `DELETE FROM public.tb_profile_status WHERE id_profile = $1`,
      [id_profile]
    );
  }

  static async insertProfileStatus(
    conn,
    { id_profile, id_status, created_by }
  ) {
    await conn.query(
      `
      INSERT INTO public.tb_profile_status (id_profile, id_status, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (id_profile, id_status) DO NOTHING
      `,
      [id_profile, id_status, created_by]
    );
  }

  static async deleteProfileStatus(conn, { id_profile, id_status }) {
    await conn.query(
      `
      DELETE FROM public.tb_profile_status
      WHERE id_profile = $1 AND id_status = $2
      `,
      [id_profile, id_status]
    );
  }

  static async listStatusesByProfile(conn, id_profile) {
    const r = await conn.query(
      `
      SELECT ps.id_status, s.desc_status, ps.created_at
      FROM public.tb_profile_status ps
      JOIN public.tb_status s ON s.id_status = ps.id_status
      WHERE ps.id_profile = $1
      ORDER BY ps.created_at DESC
      `,
      [id_profile]
    );
    return r.rows;
  }

  static async listSocialMediaByProfile(conn, id_profile) {
    const r = await conn.query(
      `
    SELECT
      psm.id_profile_social_media,
      psm.id_profile,
      psm.id_social_media_type,
      smt.desc_social_media_type,
      smt.icon,
      smt.url AS base_url,
      psm.url AS profile_url,
      psm.id_follower_range,
      fr.follower_range,
      psm.phone_number_normalized,
      psm.is_active
    FROM public.tb_profile_social_media psm
    JOIN public.tb_social_media_type smt
      ON smt.id_social_media_type = psm.id_social_media_type
    LEFT JOIN public.tb_follower_range fr
      ON fr.id_follower_range = psm.id_follower_range
    WHERE psm.id_profile = $1
      AND psm.is_active = true
    ORDER BY smt.desc_social_media_type
    `,
      [id_profile]
    );

    return r.rows;
  }

  static async categoryExistsActive(conn, id_category) {
    const r = await conn.query(
      `
    SELECT 1
    FROM public.tb_category
    WHERE id_category = $1
      AND is_active = true
    LIMIT 1
    `,
      [id_category]
    );
    return r.rowCount > 0;
  }

  static async validateSubcategoriesBelongToCategory(
    conn,
    subcategoryIds,
    id_category
  ) {
    const r = await conn.query(
      `
    SELECT id_subcategory
    FROM public.tb_subcategory
    WHERE id_subcategory = ANY($1::int[])
      AND id_category = $2
      AND is_active = true
    `,
      [subcategoryIds, id_category]
    );

    const found = new Set(r.rows.map((x) => x.id_subcategory));
    const invalid = subcategoryIds.filter((id) => !found.has(id));
    return { ok: invalid.length === 0, invalid_subcategories: invalid };
  }
}

module.exports = ProfileStorage;
