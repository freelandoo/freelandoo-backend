// src/storages/CommunityStorage.js
// SQL puro da Comunidade (tipo is_community em tb_profile). Membros são USERS.
// Espelha o estilo de ClanStorage: métodos estáticos recebendo `conn`.

class CommunityStorage {
  // ─── Entitlement (tetos por user) ───────────────────────────────────────────
  // Garante a linha default (1/1) e devolve os tetos atuais.
  static async getEntitlement(conn, id_user) {
    await conn.query(
      `INSERT INTO public.tb_community_entitlement (id_user)
         VALUES ($1)
       ON CONFLICT (id_user) DO NOTHING`,
      [id_user]
    );
    const r = await conn.query(
      `SELECT id_user, create_cap, member_cap, updated_at
         FROM public.tb_community_entitlement
        WHERE id_user = $1
        LIMIT 1`,
      [id_user]
    );
    return r.rows[0];
  }

  static async countOwned(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_profile
        WHERE id_leader_user = $1
          AND is_community = TRUE
          AND deleted_at IS NULL`,
      [id_user]
    );
    return r.rows[0].n;
  }

  static async countMemberships(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_community_member m
         JOIN public.tb_profile p ON p.id_profile = m.id_community_profile
        WHERE m.id_user = $1
          AND p.deleted_at IS NULL`,
      [id_user]
    );
    return r.rows[0].n;
  }

  // Nível/XP do user = subperfil (não-clã, não-comunidade) de maior XP.
  // has_subprofile = se o user tem ao menos 1 subperfil ativo.
  static async getHighestSubprofile(conn, id_user) {
    const r = await conn.query(
      `SELECT COALESCE(MAX(xp_level), 0)::int       AS lvl,
              COALESCE(MAX(xp_total), 0)::numeric    AS xp,
              COUNT(*)::int                          AS subprofiles
         FROM public.tb_profile
        WHERE id_user = $1
          AND is_clan = FALSE
          AND is_community = FALSE
          AND deleted_at IS NULL`,
      [id_user]
    );
    const row = r.rows[0];
    return {
      lvl: Number(row.lvl) || 0,
      xp: Number(row.xp) || 0,
      has_subprofile: Number(row.subprofiles) > 0,
    };
  }

  // ─── Criação ────────────────────────────────────────────────────────────────
  static async createCommunity(
    conn,
    { id_user, id_machine, display_name, bio, avatar_url, theme }
  ) {
    const r = await conn.query(
      `INSERT INTO public.tb_profile
         (id_user, id_category, id_machine, is_community, id_leader_user,
          community_theme, display_name, bio, avatar_url)
       VALUES
         ($1, NULL, $2, TRUE, $1, $3, $4, $5, $6)
       RETURNING id_profile, id_user, id_machine, is_community, id_leader_user,
                 community_theme, display_name, bio, avatar_url, is_active,
                 is_visible, xp_total, xp_level, created_at, updated_at`,
      [
        id_user,
        id_machine,
        theme ? JSON.stringify(theme) : null,
        display_name,
        bio ?? null,
        avatar_url ?? null,
      ]
    );
    return r.rows[0];
  }

  // ─── Leitura ─────────────────────────────────────────────────────────────────
  static async getById(conn, id_community) {
    const r = await conn.query(
      `SELECT p.id_profile, p.id_machine, p.is_community, p.id_leader_user,
              p.community_theme, p.display_name, p.bio, p.avatar_url,
              p.xp_total, p.xp_level, p.created_at, p.updated_at,
              m.name AS enxame_name,
              (SELECT COUNT(*)::int FROM public.tb_community_member cm
                WHERE cm.id_community_profile = p.id_profile) AS member_count
         FROM public.tb_profile p
         LEFT JOIN public.tb_machine m ON m.id_machine = p.id_machine
        WHERE p.id_profile = $1
          AND p.is_community = TRUE
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [id_community]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listPublic(conn, { q, id_machine, limit = 30, offset = 0 } = {}) {
    const params = [];
    const where = ["p.is_community = TRUE", "p.deleted_at IS NULL"];
    if (q) {
      params.push(`%${q}%`);
      where.push(`p.display_name ILIKE $${params.length}`);
    }
    if (id_machine) {
      params.push(id_machine);
      where.push(`p.id_machine = $${params.length}`);
    }
    params.push(Math.min(Number(limit) || 30, 60));
    params.push(Number(offset) || 0);
    const r = await conn.query(
      `SELECT p.id_profile, p.id_machine, p.display_name, p.avatar_url,
              p.community_theme, p.xp_total, p.xp_level,
              m.name AS enxame_name,
              (SELECT COUNT(*)::int FROM public.tb_community_member cm
                WHERE cm.id_community_profile = p.id_profile) AS member_count
         FROM public.tb_profile p
         LEFT JOIN public.tb_machine m ON m.id_machine = p.id_machine
        WHERE ${where.join(" AND ")}
        ORDER BY p.xp_total DESC, p.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async updateTheme(conn, id_community, theme) {
    const r = await conn.query(
      `UPDATE public.tb_profile
          SET community_theme = $2, updated_at = NOW()
        WHERE id_profile = $1 AND is_community = TRUE AND deleted_at IS NULL
        RETURNING id_profile, community_theme`,
      [id_community, theme ? JSON.stringify(theme) : null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ─── Membros (user-level) ─────────────────────────────────────────────────────
  static async addMember(conn, id_community, id_user, role = "member") {
    const r = await conn.query(
      `INSERT INTO public.tb_community_member (id_community_profile, id_user, role)
         VALUES ($1, $2, $3)
       ON CONFLICT (id_community_profile, id_user) DO NOTHING
       RETURNING id_community_profile, id_user, role, joined_at`,
      [id_community, id_user, role]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async removeMember(conn, id_community, id_user) {
    const r = await conn.query(
      `DELETE FROM public.tb_community_member
        WHERE id_community_profile = $1 AND id_user = $2`,
      [id_community, id_user]
    );
    return r.rowCount > 0;
  }

  static async getMembership(conn, id_community, id_user) {
    const r = await conn.query(
      `SELECT id_community_profile, id_user, role, joined_at
         FROM public.tb_community_member
        WHERE id_community_profile = $1 AND id_user = $2
        LIMIT 1`,
      [id_community, id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listMembers(conn, id_community) {
    const r = await conn.query(
      `SELECT m.id_user, m.role, m.joined_at,
              u.nome AS user_name,
              u.username AS user_username,
              hp.id_profile AS top_profile_id,
              hp.display_name AS top_profile_name,
              hp.avatar_url AS top_profile_avatar,
              hp.xp_level AS top_profile_level
         FROM public.tb_community_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
         LEFT JOIN LATERAL (
           SELECT id_profile, display_name, avatar_url, xp_level
             FROM public.tb_profile
            WHERE id_user = m.id_user
              AND is_clan = FALSE
              AND is_community = FALSE
              AND deleted_at IS NULL
            ORDER BY xp_total DESC
            LIMIT 1
         ) hp ON TRUE
        WHERE m.id_community_profile = $1
        ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'vice' THEN 1 ELSE 2 END,
                 m.joined_at ASC`,
      [id_community]
    );
    return r.rows;
  }

  // ─── Feed/Bees da comunidade (itens de portfólio do perfil-comunidade) ──────
  // feed_kind: 'feed' (posts) | 'bees' (vídeos 9:16) | null (todos).
  static async listItems(conn, id_community, feed_kind, limit = 24, offset = 0) {
    const r = await conn.query(
      `SELECT i.id_portfolio_item, i.title, i.description, i.feed_kind,
              i.created_at,
              COALESCE(mq.media, '[]'::jsonb) AS media
         FROM public.tb_profile_portfolio_item i
         LEFT JOIN LATERAL (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id_portfolio_media', m.id_portfolio_media,
               'media_url', m.media_url,
               'media_type', m.media_type,
               'thumbnail_url', m.thumbnail_url,
               'sort_order', m.sort_order,
               'width', m.width,
               'height', m.height
             ) ORDER BY m.sort_order, m.created_at
           ) AS media
           FROM public.tb_profile_portfolio_media m
           WHERE m.id_portfolio_item = i.id_portfolio_item AND m.is_active = true
         ) mq ON TRUE
        WHERE i.id_profile = $1
          AND i.is_active = true
          AND i.is_banned = false
          AND ($2::text IS NULL OR i.feed_kind = $2)
        ORDER BY i.created_at DESC
        LIMIT $3 OFFSET $4`,
      [id_community, feed_kind || null, Math.min(Number(limit) || 24, 60), Number(offset) || 0]
    );
    return r.rows;
  }

  // ─── Bundle R$100 (slot purchase + entitlement) ─────────────────────────────
  static async createSlotPurchase(conn, { id_user_payer, amount_cents = 10000 }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_slot_purchase (id_user_payer, amount_cents)
         VALUES ($1, $2)
       RETURNING id_purchase, id_user_payer, amount_cents, status, created_at`,
      [id_user_payer, amount_cents]
    );
    return r.rows[0];
  }

  static async setSlotPurchaseSession(conn, id_purchase, session_id) {
    await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET stripe_session_id = $2
        WHERE id_purchase = $1`,
      [id_purchase, session_id]
    );
  }

  static async getSlotPurchaseBySession(conn, session_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_slot_purchase
        WHERE stripe_session_id = $1
        LIMIT 1`,
      [session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Marca a compra como aplicada (idempotente: só se applied_at IS NULL).
  // Retorna o id_user se aplicou AGORA; null se já estava aplicada / inexistente.
  static async markSlotPurchaseApplied(conn, session_id, payment_intent_id) {
    const r = await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET status = 'paid', paid_at = NOW(), applied_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id)
        WHERE stripe_session_id = $1 AND applied_at IS NULL
        RETURNING id_user_payer`,
      [session_id, payment_intent_id]
    );
    return r.rowCount ? r.rows[0].id_user_payer : null;
  }

  // +1/+1 (capado em 3). Cria a linha em 2/2 se ainda não existir.
  static async incrementEntitlement(conn, id_user) {
    await conn.query(
      `INSERT INTO public.tb_community_entitlement (id_user, create_cap, member_cap)
         VALUES ($1, 2, 2)
       ON CONFLICT (id_user) DO UPDATE
         SET create_cap = LEAST(3, public.tb_community_entitlement.create_cap + 1),
             member_cap = LEAST(3, public.tb_community_entitlement.member_cap + 1),
             updated_at = NOW()`,
      [id_user]
    );
  }

  static async getAppliedPurchaseByPaymentIntent(conn, payment_intent_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_slot_purchase
        WHERE stripe_payment_intent_id = $1
          AND applied_at IS NOT NULL
          AND status = 'paid'
        LIMIT 1`,
      [payment_intent_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async markSlotPurchaseRefunded(conn, id_purchase) {
    await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET status = 'refunded'
        WHERE id_purchase = $1`,
      [id_purchase]
    );
  }

  // -1/-1 no reembolso, sem ir abaixo de 1 nem abaixo do que o user já usa
  // (não dá pra "des-criar" comunidades / des-participar à força).
  static async decrementEntitlement(conn, id_user) {
    await conn.query(
      `UPDATE public.tb_community_entitlement e
          SET create_cap = GREATEST(
                1,
                (SELECT COUNT(*) FROM public.tb_profile p
                  WHERE p.id_leader_user = $1 AND p.is_community = TRUE AND p.deleted_at IS NULL),
                e.create_cap - 1),
              member_cap = GREATEST(
                1,
                (SELECT COUNT(*) FROM public.tb_community_member m
                   JOIN public.tb_profile p ON p.id_profile = m.id_community_profile
                  WHERE m.id_user = $1 AND p.deleted_at IS NULL),
                e.member_cap - 1),
              updated_at = NOW()
        WHERE e.id_user = $1`,
      [id_user]
    );
  }

  static async markSlotPurchaseExpiredBySession(conn, session_id) {
    const r = await conn.query(
      `UPDATE public.tb_community_slot_purchase
          SET status = 'canceled'
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_purchase`,
      [session_id]
    );
    return r.rowCount > 0;
  }
}

module.exports = CommunityStorage;
