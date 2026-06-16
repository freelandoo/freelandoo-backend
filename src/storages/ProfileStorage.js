const { slugify } = require("../utils/slug");

class ProfileStorage {
  /**
   * Retorna o id_profile do perfil-fantasma (is_user_account=TRUE) do usuário.
   * Cria automaticamente se ainda não existir (defensivo — backfill da
   * migration 052 deveria já ter criado para users existentes).
   */
  static async getUserAccountProfileId(conn, id_user) {
    const r = await conn.query(
      `SELECT id_profile
         FROM public.tb_profile
        WHERE id_user = $1 AND is_user_account = TRUE
        LIMIT 1`,
      [id_user]
    );
    if (r.rowCount) return r.rows[0].id_profile;

    // Fallback: cria sob demanda (display_name do tb_user)
    const ur = await conn.query(`SELECT nome FROM public.tb_user WHERE id_user = $1`, [id_user]);
    const nome = ur.rowCount ? ur.rows[0].nome : "Conta";
    const ins = await conn.query(
      `INSERT INTO public.tb_profile
         (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible,
          is_user_account, feed_visible, showcase_visible, ranking_visible)
       SELECT
         $1::uuid,
         COALESCE((SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1), 1),
         $2,
         'conta-' || substring(replace($1::text, '-', ''), 1, 12),
         TRUE,
         FALSE,
         TRUE,
         TRUE,
         FALSE,
         FALSE
       WHERE NOT EXISTS (
         SELECT 1 FROM public.tb_profile
          WHERE id_user = $1::uuid AND is_user_account = TRUE
       )
       RETURNING id_profile`,
      [id_user, nome]
    );
    if (ins.rowCount) return ins.rows[0].id_profile;
    // Race condition fallback — re-select
    const r2 = await conn.query(
      `SELECT id_profile FROM public.tb_profile
        WHERE id_user = $1 AND is_user_account = TRUE LIMIT 1`,
      [id_user]
    );
    return r2.rows[0]?.id_profile || null;
  }

  /**
   * Resolve um sub_profile_slug único para o usuário a partir do display_name.
   * Aplica sufixo numérico (-2, -3, ...) em caso de colisão com perfis vivos
   * do mesmo usuário. Ignora `excludeProfileId` (usado em update).
   */
  static async resolveUniqueSubProfileSlug(
    conn,
    { id_user, display_name, excludeProfileId = null }
  ) {
    let base = slugify(display_name);
    if (!base || base.length < 2) base = "perfil";
    if (base.length > 75) base = base.substring(0, 75);

    const params = [id_user];
    let exclusionClause = "";
    if (excludeProfileId) {
      params.push(excludeProfileId);
      exclusionClause = `AND id_profile <> $2`;
    }

    const r = await conn.query(
      `SELECT sub_profile_slug
         FROM public.tb_profile
        WHERE id_user = $1
          AND deleted_at IS NULL
          ${exclusionClause}`,
      params
    );
    const taken = new Set(r.rows.map((row) => row.sub_profile_slug));

    if (!taken.has(base)) return base;
    for (let i = 2; i < 10000; i++) {
      const candidate = `${base}-${i}`;
      if (!taken.has(candidate)) return candidate;
    }
    // fallback improvável
    return `${base}-${Date.now()}`;
  }

  // CREATE
  static async createProfile(
    conn,
    { id_user, id_category, display_name, bio, avatar_url, estado, municipio }
  ) {
    const sub_profile_slug = await ProfileStorage.resolveUniqueSubProfileSlug(
      conn,
      { id_user, display_name }
    );

    const r = await conn.query(
      `
      INSERT INTO public.tb_profile
        (id_user, id_category, display_name, bio, avatar_url, estado, municipio, sub_profile_slug, id_region)
      VALUES
        -- ::text nas DUAS posições de $6/$7: o mesmo parâmetro em posição de
        -- coluna (varchar) e de expressão (text) deduz tipos inconsistentes
        -- num schema reconstruído das migrations (F5.S1).
        ($1, $2, $3, $4, $5, $6::text, $7::text, $8,
         (SELECT rc.id_region FROM public.tb_region_city rc
           WHERE rc.uf = $6::text AND rc.municipio_norm = fl_norm_city($7::text)))
      RETURNING
        id_profile, id_user, id_category, display_name, bio, avatar_url,
        estado, municipio, sub_profile_slug, is_active, created_at, updated_at
      `,
      [id_user, id_category, display_name, bio, avatar_url, estado, municipio, sub_profile_slug]
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
      p.is_user_account,
      EXISTS (
        SELECT 1 FROM public.tb_profile_subscription ps
         WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
      ) AS is_paid,
      mq.manifestation
    FROM public.tb_profile p
    JOIN public.tb_user u
      ON u.id_user = p.id_user
    LEFT JOIN public.tb_category c
      ON c.id_category = p.id_category
    LEFT JOIN public.tb_machine m
      ON m.id_machine = COALESCE(c.id_machine, p.id_machine)
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', um.id,
        'product_id', um.product_id,
        'banner_url', mp.banner_url,
        'banner_thumb_url', mp.banner_thumb_url,
        'tag_label', mp.tag_label,
        'tag_color', mp.tag_color,
        'tag_icon', mp.tag_icon,
        'expires_at', um.expires_at
      ) AS manifestation
      FROM public.user_manifestations um
      JOIN public.manifestation_products mp ON mp.id = um.product_id
      WHERE um.user_id = p.id_user
        AND um.is_active = TRUE
        AND (um.expires_at IS NULL OR um.expires_at > NOW())
        AND COALESCE(p.is_clan, FALSE) = FALSE
      LIMIT 1
    ) mq ON TRUE
    WHERE p.id_profile = $1
    LIMIT 1
    `,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Resolve perfil público pelo (handle, profession_slug, sub_profile_slug).
   * Usado pela URL SEO /[profession]/[city]/@[handle]/[subProfile].
   * Se `sub_profile_slug` for null/undefined, cai em modo legado: retorna
   * o perfil canônico (mais recente) que casa só com (handle, profession_slug).
   * Retorna o perfil mesmo se não-publicado; caller decide se exibe ou 404.
   */
  static async getPublicProfileByHandleAndProfession(
    conn,
    { handle, profession_slug, sub_profile_slug = null }
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
      p.is_user_account,
      EXISTS (
        SELECT 1 FROM public.tb_profile_subscription ps
         WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
      ) AS is_paid,
      mq.manifestation
    FROM public.tb_profile p
    JOIN public.tb_user u
      ON u.id_user = p.id_user
    JOIN public.tb_category c
      ON c.id_category = p.id_category
    LEFT JOIN public.tb_machine m
      ON m.id_machine = c.id_machine
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object(
        'id', um.id,
        'product_id', um.product_id,
        'banner_url', mp.banner_url,
        'banner_thumb_url', mp.banner_thumb_url,
        'tag_label', mp.tag_label,
        'tag_color', mp.tag_color,
        'tag_icon', mp.tag_icon,
        'expires_at', um.expires_at
      ) AS manifestation
      FROM public.user_manifestations um
      JOIN public.manifestation_products mp ON mp.id = um.product_id
      WHERE um.user_id = p.id_user
        AND um.is_active = TRUE
        AND (um.expires_at IS NULL OR um.expires_at > NOW())
        AND COALESCE(p.is_clan, FALSE) = FALSE
      LIMIT 1
    ) mq ON TRUE
    WHERE lower(u.username) = lower($1)
      AND lower(c.profession_slug) = lower($2)
      AND p.deleted_at IS NULL
      AND ($3::text IS NULL OR lower(p.sub_profile_slug) = lower($3))
    ORDER BY p.created_at DESC
    LIMIT 1
    `,
      [handle, profession_slug, sub_profile_slug]
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
      COALESCE(p.is_clan, FALSE) AS is_clan,
      COALESCE(p.is_user_account, FALSE) AS is_user_account,
      p.created_at,
      p.updated_at,
      EXISTS (
        SELECT 1 FROM public.tb_profile_subscription ps3
         WHERE ps3.id_profile = p.id_profile AND ps3.status = 'active'
      ) AS is_paid,

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
    }

    if (has("display_name")) {
      fields.push(`display_name = $${idx++}`);
      values.push(payload.display_name); // pode ser null se você quiser permitir

      // Ressincroniza sub_profile_slug com o novo display_name (resolução de
      // colisão por id_user — ignora o próprio perfil em edição).
      const owner = await conn.query(
        `SELECT id_user FROM public.tb_profile WHERE id_profile = $1`,
        [id_profile]
      );
      if (owner.rowCount > 0) {
        const newSlug = await ProfileStorage.resolveUniqueSubProfileSlug(conn, {
          id_user: owner.rows[0].id_user,
          display_name: payload.display_name,
          excludeProfileId: id_profile,
        });
        fields.push(`sub_profile_slug = $${idx++}`);
        values.push(newSlug);
      }
    }

    if (has("bio")) {
      fields.push(`bio = $${idx++}`);
      values.push(payload.bio); // ✅ null limpa
    }

    if (has("avatar_url")) {
      fields.push(`avatar_url = $${idx++}`);
      values.push(payload.avatar_url); // ✅ null limpa
    }

    // Expressões pra recomputar id_region: valor novo (se veio no payload) ou a
    // coluna atual (avaliada com o valor antigo da linha no UPDATE).
    let estadoExpr = "estado";
    let municipioExpr = "municipio";

    if (has("estado")) {
      // ::text nas DUAS posições: o mesmo $ em posição de coluna (varchar) e
      // de expressão (text) deduz tipos inconsistentes (F5.S1).
      estadoExpr = `$${idx}::text`;
      fields.push(`estado = $${idx++}::text`);
      values.push(payload.estado); // ✅ null limpa
    }

    if (has("municipio")) {
      municipioExpr = `$${idx}::text`;
      fields.push(`municipio = $${idx++}::text`);
      values.push(payload.municipio); // ✅ null limpa
    }

    // Mudou estado e/ou cidade → resolve a região correspondente.
    if (has("estado") || has("municipio")) {
      fields.push(
        `id_region = (SELECT rc.id_region FROM public.tb_region_city rc
           WHERE rc.uf = ${estadoExpr} AND rc.municipio_norm = fl_norm_city(${municipioExpr}))`
      );
    }

    if (has("is_active")) {
      fields.push(`is_active = $${idx++}`);
      values.push(payload.is_active); // boolean
    }

    if (has("origin_zipcode")) {
      fields.push(`origin_zipcode = $${idx++}`);
      values.push(payload.origin_zipcode); // string 8 dígitos ou null
    }

    if (has("origin_document")) {
      fields.push(`origin_document = $${idx++}`);
      values.push(payload.origin_document); // CPF/CNPJ só dígitos ou null
    }

    if (has("origin_number")) {
      fields.push(`origin_number = $${idx++}`);
      values.push(payload.origin_number);
    }

    if (has("origin_complement")) {
      fields.push(`origin_complement = $${idx++}`);
      values.push(payload.origin_complement);
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

  /**
   * Mapa { id_profile: id_user } para uma lista de subperfis. Usado pelo split
   * de clan pra creditar o saldo do dono de cada perfil anexado.
   */
  static async getOwnerUserMap(conn, profileIds) {
    if (!profileIds || profileIds.length === 0) return {};
    const r = await conn.query(
      `SELECT id_profile, id_user FROM public.tb_profile
        WHERE id_profile = ANY($1::uuid[])`,
      [profileIds]
    );
    const map = {};
    for (const row of r.rows) map[row.id_profile] = row.id_user;
    return map;
  }
}

module.exports = ProfileStorage;
