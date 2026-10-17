// SQL puro dos avatares da Arena (mig 285). Sem regra de negócio: quem decide
// é o ArenaAvatarService.

class ArenaAvatarStorage {
  static async listModels(conn, { onlyReady = true } = {}) {
    const r = await conn.query(
      `SELECT model_id, labels, sort_order, status, default_grant, sale_status, asset_version, updated_at
         FROM public.tb_arena_avatar_model
        ${onlyReady ? "WHERE status = 'ready'" : ""}
        ORDER BY sort_order, model_id`
    );
    return r.rows;
  }

  static async listVariants(conn, { onlyReady = true } = {}) {
    const r = await conn.query(
      `SELECT v.model_id, v.skin_id, v.hair_id, v.ready, v.updated_at
         FROM public.tb_arena_avatar_variant v
         JOIN public.tb_arena_avatar_model m ON m.model_id = v.model_id
        WHERE m.status = 'ready' ${onlyReady ? "AND v.ready" : ""}
        ORDER BY v.model_id, v.skin_id, v.hair_id`
    );
    return r.rows;
  }

  static async getModel(conn, model_id) {
    const r = await conn.query(
      `SELECT model_id, status, default_grant, sale_status FROM public.tb_arena_avatar_model WHERE model_id = $1`,
      [model_id]
    );
    return r.rows[0] || null;
  }

  static async getVariant(conn, model_id, skin_id, hair_id) {
    const r = await conn.query(
      `SELECT ready FROM public.tb_arena_avatar_variant WHERE model_id = $1 AND skin_id = $2 AND hair_id = $3`,
      [model_id, skin_id, hair_id]
    );
    return r.rows[0] || null;
  }

  /** Concede os modelos padrão prontos. Idempotente: a posse viva é única. */
  static async grantDefaults(conn, id_user) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_avatar_grant (id_user, model_id, source)
       SELECT $1, m.model_id, 'default'
         FROM public.tb_arena_avatar_model m
        WHERE m.default_grant AND m.status = 'ready'
       ON CONFLICT (id_user, model_id) WHERE revoked_at IS NULL DO NOTHING
       RETURNING model_id`,
      [id_user]
    );
    return r.rows.map((x) => x.model_id);
  }

  static async listOwned(conn, id_user) {
    const r = await conn.query(
      `SELECT g.model_id, g.source, g.granted_at
         FROM public.tb_arena_avatar_grant g
        WHERE g.id_user = $1 AND g.revoked_at IS NULL
        ORDER BY g.granted_at, g.model_id`,
      [id_user]
    );
    return r.rows;
  }

  static async ownsLive(conn, id_user, model_id) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_arena_avatar_grant WHERE id_user = $1 AND model_id = $2 AND revoked_at IS NULL`,
      [id_user, model_id]
    );
    return r.rowCount > 0;
  }

  static async getEquipped(conn, id_user, { forUpdate = false } = {}) {
    const r = await conn.query(
      `SELECT avatar_model_id, avatar_skin_id, avatar_hair_id, avatar_revision, avatar_updated_at
         FROM public.tb_arena_player WHERE id_user = $1 ${forUpdate ? "FOR UPDATE" : ""}`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  /** Escrita condicional: só aplica se a revisão ainda é a esperada. */
  static async setEquipped(conn, id_user, { modelId, skinId, hairId, expectedRevision }) {
    const r = await conn.query(
      `UPDATE public.tb_arena_player
          SET avatar_model_id = $2, avatar_skin_id = $3, avatar_hair_id = $4,
              avatar_revision = avatar_revision + 1, avatar_updated_at = NOW(), updated_at = NOW()
        WHERE id_user = $1 AND avatar_revision = $5
        RETURNING avatar_model_id, avatar_skin_id, avatar_hair_id, avatar_revision`,
      [id_user, modelId, skinId, hairId, expectedRevision]
    );
    return r.rows[0] || null;
  }

  // ─── Sincronização do catálogo (scripts/arena-avatars.js) ──────────────────

  static async upsertModel(conn, m) {
    await conn.query(
      `INSERT INTO public.tb_arena_avatar_model
         (model_id, labels, sort_order, status, default_grant, sale_status, asset_version, updated_at)
       VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (model_id) DO UPDATE SET
         labels = EXCLUDED.labels, sort_order = EXCLUDED.sort_order, status = EXCLUDED.status,
         default_grant = EXCLUDED.default_grant, sale_status = EXCLUDED.sale_status,
         asset_version = EXCLUDED.asset_version, updated_at = NOW()`,
      [m.modelId, JSON.stringify(m.labels || {}), m.order || 0, m.status, !!m.defaultGrant, m.saleStatus, m.assetVersion || null]
    );
  }

  static async retireMissing(conn, keepIds) {
    const r = await conn.query(
      `UPDATE public.tb_arena_avatar_model SET status = 'retired', updated_at = NOW()
        WHERE status <> 'retired' AND NOT (model_id = ANY($1::varchar[]))
        RETURNING model_id`,
      [keepIds]
    );
    return r.rows.map((x) => x.model_id);
  }

  static async replaceVariants(conn, model_id, variants) {
    // Variante que some do build deixa de estar pronta (não é apagada: pode
    // estar equipada; quem resolve a aparência cai no fallback explícito).
    await conn.query(`UPDATE public.tb_arena_avatar_variant SET ready = FALSE, updated_at = NOW() WHERE model_id = $1`, [model_id]);
    for (const v of variants) {
      await conn.query(
        `INSERT INTO public.tb_arena_avatar_variant (model_id, skin_id, hair_id, ready, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (model_id, skin_id, hair_id) DO UPDATE SET ready = EXCLUDED.ready, updated_at = NOW()`,
        [model_id, v.skinId, v.hairId, !!v.ready]
      );
    }
  }

  static async grantAdmin(conn, id_user, model_id, source_ref) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_avatar_grant (id_user, model_id, source, source_ref)
       VALUES ($1, $2, 'admin', $3)
       ON CONFLICT DO NOTHING
       RETURNING id_grant`,
      [id_user, model_id, source_ref]
    );
    return r.rows[0] || null;
  }

  static async revoke(conn, id_user, model_id) {
    const r = await conn.query(
      `UPDATE public.tb_arena_avatar_grant SET revoked_at = NOW()
        WHERE id_user = $1 AND model_id = $2 AND revoked_at IS NULL RETURNING id_grant`,
      [id_user, model_id]
    );
    return r.rowCount;
  }
}

module.exports = ArenaAvatarStorage;
