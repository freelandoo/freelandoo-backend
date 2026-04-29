class ClanStorage {
  // ─── Criação ──────────────────────────────────────────────────────────────
  static async createClanProfile(
    conn,
    { id_user, id_machine, display_name, bio, avatar_url, estado, municipio }
  ) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_profile
        (id_user, id_category, id_machine, is_clan, display_name, bio,
         avatar_url, estado, municipio)
      VALUES
        ($1, NULL, $2, TRUE, $3, $4, $5, $6, $7)
      RETURNING id_profile, id_user, id_machine, is_clan, display_name, bio,
                avatar_url, estado, municipio, is_active, is_visible,
                created_at, updated_at
      `,
      [id_user, id_machine, display_name, bio, avatar_url, estado, municipio]
    );
    return r.rows[0];
  }

  static async createSettings(conn, id_profile) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_clan_settings (id_profile)
      VALUES ($1)
      ON CONFLICT (id_profile) DO NOTHING
      RETURNING id_profile, free_slots, paid_slots, slot_price_cents
      `,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getSettings(conn, id_profile) {
    const r = await conn.query(
      `SELECT id_profile, free_slots, paid_slots, slot_price_cents,
              created_at, updated_at
         FROM public.tb_clan_settings
        WHERE id_profile = $1
        LIMIT 1`,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async incrementPaidSlots(conn, id_profile) {
    const r = await conn.query(
      `UPDATE public.tb_clan_settings
          SET paid_slots = paid_slots + 1,
              updated_at = NOW()
        WHERE id_profile = $1
          AND paid_slots < 3
        RETURNING paid_slots`,
      [id_profile]
    );
    return r.rowCount ? r.rows[0].paid_slots : null;
  }

  // ─── Members ──────────────────────────────────────────────────────────────
  static async addMember(conn, { id_clan_profile, id_member_profile, role }) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_clan_member
        (id_clan_profile, id_member_profile, role)
      VALUES ($1, $2, $3)
      RETURNING id_clan_profile, id_member_profile, role, joined_at
      `,
      [id_clan_profile, id_member_profile, role || "member"]
    );
    return r.rows[0];
  }

  static async removeMember(conn, { id_clan_profile, id_member_profile }) {
    const r = await conn.query(
      `DELETE FROM public.tb_clan_member
        WHERE id_clan_profile = $1 AND id_member_profile = $2
        RETURNING id_member_profile`,
      [id_clan_profile, id_member_profile]
    );
    return r.rowCount > 0;
  }

  static async listMembers(conn, id_clan_profile) {
    const r = await conn.query(
      `
      SELECT
        cm.id_member_profile,
        cm.role,
        cm.joined_at,
        p.id_user,
        p.display_name,
        p.avatar_url,
        u.username
      FROM public.tb_clan_member cm
      JOIN public.tb_profile p ON p.id_profile = cm.id_member_profile
      JOIN public.tb_user u    ON u.id_user    = p.id_user
      WHERE cm.id_clan_profile = $1
      ORDER BY (cm.role = 'owner') DESC, cm.joined_at ASC
      `,
      [id_clan_profile]
    );
    return r.rows;
  }

  static async countMembers(conn, id_clan_profile) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_clan_member
        WHERE id_clan_profile = $1`,
      [id_clan_profile]
    );
    return r.rows[0].n;
  }

  /**
   * Retorna o id_clan_profile em que o sub-perfil já está, se existir.
   * Usa o UNIQUE(id_member_profile) para resposta O(1).
   */
  static async findMembershipByProfile(conn, id_member_profile) {
    const r = await conn.query(
      `SELECT id_clan_profile, role
         FROM public.tb_clan_member
        WHERE id_member_profile = $1
        LIMIT 1`,
      [id_member_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ─── Reads de clan ────────────────────────────────────────────────────────
  static async getClanById(conn, id_profile) {
    const r = await conn.query(
      `
      SELECT
        p.id_profile,
        p.id_user,
        p.id_machine,
        m.slug AS machine_slug,
        m.name AS machine_name,
        p.display_name,
        p.bio,
        p.avatar_url,
        p.estado,
        p.municipio,
        p.is_active,
        p.is_visible,
        p.deleted_at,
        p.created_at,
        p.updated_at,
        EXISTS (
          SELECT 1 FROM public.tb_profile_subscription ps
           WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
        ) AS is_paid
      FROM public.tb_profile p
      LEFT JOIN public.tb_machine m ON m.id_machine = p.id_machine
      WHERE p.id_profile = $1
        AND p.is_clan = TRUE
      LIMIT 1
      `,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Lista clans em que o usuário é dono (owner) ou participante (qualquer
   * sub-perfil dele). Usado pelo dashboard.
   */
  static async listClansOfUser(conn, id_user) {
    const r = await conn.query(
      `
      SELECT
        p.id_profile,
        p.display_name,
        p.avatar_url,
        p.is_visible,
        p.deleted_at,
        p.created_at,
        m.slug AS machine_slug,
        m.name AS machine_name,
        cm_self.role AS my_role,
        cs.free_slots,
        cs.paid_slots,
        (cs.free_slots + cs.paid_slots) AS max_slots,
        (SELECT COUNT(*)::int FROM public.tb_clan_member cm2
           WHERE cm2.id_clan_profile = p.id_profile) AS members_count
      FROM public.tb_profile p
      JOIN public.tb_clan_member cm_self
        ON cm_self.id_clan_profile = p.id_profile
      JOIN public.tb_profile mp
        ON mp.id_profile = cm_self.id_member_profile
       AND mp.id_user    = $1
      LEFT JOIN public.tb_clan_settings cs ON cs.id_profile = p.id_profile
      LEFT JOIN public.tb_machine m ON m.id_machine = p.id_machine
      WHERE p.is_clan = TRUE
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      `,
      [id_user]
    );
    return r.rows;
  }

  // ─── Validações de pré-requisito ─────────────────────────────────────────
  /**
   * Soma minutos online do usuário (migration 014). Usado para validar 10h.
   */
  static async getUserOnlineMinutes(conn, id_user) {
    const r = await conn.query(
      `SELECT COALESCE(SUM(minutes_online), 0)::int AS minutes
         FROM public.user_online_time
        WHERE id_user = $1`,
      [id_user]
    );
    return r.rows[0].minutes;
  }

  /**
   * Verifica se um sub-perfil existe, é do usuário, NÃO é clan, está ativo
   * (assinatura active), visível e não deletado. Retorna o perfil ou null.
   */
  static async getEligibleSubProfile(conn, { id_profile, id_user }) {
    const r = await conn.query(
      `
      SELECT
        p.id_profile,
        p.id_user,
        p.display_name,
        p.avatar_url,
        EXISTS (
          SELECT 1 FROM public.tb_profile_subscription ps
           WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
        ) AS is_paid
      FROM public.tb_profile p
      WHERE p.id_profile = $1
        AND p.id_user    = $2
        AND p.is_clan    = FALSE
        AND p.deleted_at IS NULL
      LIMIT 1
      `,
      [id_profile, id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ─── Invites ──────────────────────────────────────────────────────────────
  static async createInvite(conn, { id_clan_profile, id_invited_profile, id_invited_by_user, expires_at }) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_clan_invite
        (id_clan_profile, id_invited_profile, id_invited_by_user, expires_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id_clan_invite, id_clan_profile, id_invited_profile,
                id_invited_by_user, status, created_at, expires_at
      `,
      [id_clan_profile, id_invited_profile, id_invited_by_user, expires_at || null]
    );
    return r.rows[0];
  }

  static async getInviteById(conn, id_clan_invite) {
    const r = await conn.query(
      `SELECT id_clan_invite, id_clan_profile, id_invited_profile,
              id_invited_by_user, status, created_at, responded_at, expires_at
         FROM public.tb_clan_invite
        WHERE id_clan_invite = $1
        LIMIT 1`,
      [id_clan_invite]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async updateInviteStatus(conn, id_clan_invite, status) {
    const r = await conn.query(
      `UPDATE public.tb_clan_invite
          SET status = $2,
              responded_at = NOW()
        WHERE id_clan_invite = $1
          AND status = 'pending'
        RETURNING id_clan_invite, status, responded_at`,
      [id_clan_invite, status]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listPendingInvitesByClan(conn, id_clan_profile) {
    const r = await conn.query(
      `
      SELECT
        ci.id_clan_invite,
        ci.id_invited_profile,
        ci.id_invited_by_user,
        ci.status,
        ci.created_at,
        ci.expires_at,
        p.display_name AS invited_display_name,
        p.avatar_url   AS invited_avatar_url,
        u.username     AS invited_username
      FROM public.tb_clan_invite ci
      JOIN public.tb_profile p ON p.id_profile = ci.id_invited_profile
      JOIN public.tb_user u    ON u.id_user    = p.id_user
      WHERE ci.id_clan_profile = $1
        AND ci.status = 'pending'
      ORDER BY ci.created_at DESC
      `,
      [id_clan_profile]
    );
    return r.rows;
  }

  static async listPendingInvitesForUser(conn, id_user) {
    const r = await conn.query(
      `
      SELECT
        ci.id_clan_invite,
        ci.id_clan_profile,
        ci.id_invited_profile,
        ci.created_at,
        ci.expires_at,
        invitee.display_name AS invited_display_name,
        clan.display_name    AS clan_display_name,
        clan.avatar_url      AS clan_avatar_url,
        m.name               AS clan_machine_name,
        m.slug               AS clan_machine_slug
      FROM public.tb_clan_invite ci
      JOIN public.tb_profile invitee ON invitee.id_profile = ci.id_invited_profile
      JOIN public.tb_profile clan    ON clan.id_profile    = ci.id_clan_profile
      LEFT JOIN public.tb_machine m  ON m.id_machine       = clan.id_machine
      WHERE invitee.id_user = $1
        AND ci.status = 'pending'
        AND clan.deleted_at IS NULL
      ORDER BY ci.created_at DESC
      `,
      [id_user]
    );
    return r.rows;
  }

  /**
   * Resolve sub-perfis convidáveis para um username dado (para autocompletar
   * no frontend). Não retorna clans nem perfis sem assinatura ativa.
   */
  static async findInvitableProfilesByUsername(conn, username) {
    const r = await conn.query(
      `
      SELECT
        p.id_profile,
        p.display_name,
        p.avatar_url,
        u.username,
        c.desc_category,
        EXISTS (
          SELECT 1 FROM public.tb_profile_subscription ps
           WHERE ps.id_profile = p.id_profile AND ps.status = 'active'
        ) AS is_paid,
        EXISTS (
          SELECT 1 FROM public.tb_clan_member cm
           WHERE cm.id_member_profile = p.id_profile
        ) AS already_in_clan
      FROM public.tb_profile p
      JOIN public.tb_user u ON u.id_user = p.id_user
      LEFT JOIN public.tb_category c ON c.id_category = p.id_category
      WHERE LOWER(u.username) = LOWER($1)
        AND p.is_clan = FALSE
        AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      `,
      [username]
    );
    return r.rows;
  }

  // ─── Mensagens (quadro de recados do clan) ─────────────────────────────
  static async createMessage(conn, { id_clan_profile, id_user, id_member_profile, content }) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_clan_message
        (id_clan_profile, id_user, id_member_profile, content)
      VALUES ($1, $2, $3, $4)
      RETURNING id_clan_message, id_clan_profile, id_user, id_member_profile,
                content, created_at
      `,
      [id_clan_profile, id_user, id_member_profile || null, content]
    );
    return r.rows[0];
  }

  static async listMessages(conn, id_clan_profile, { limit = 100, before_id } = {}) {
    const args = [id_clan_profile];
    let whereBefore = "";
    if (before_id) {
      args.push(before_id);
      whereBefore = `AND m.id_clan_message < $${args.length}`;
    }
    args.push(Math.min(Math.max(Number(limit) || 100, 1), 200));
    const limitParam = args.length;

    const r = await conn.query(
      `
      SELECT
        m.id_clan_message,
        m.id_user,
        m.id_member_profile,
        m.content,
        m.created_at,
        u.username AS author_username,
        COALESCE(mp.display_name, u.username) AS author_display_name,
        mp.avatar_url AS author_avatar_url
      FROM public.tb_clan_message m
      JOIN public.tb_user u ON u.id_user = m.id_user
      LEFT JOIN public.tb_profile mp ON mp.id_profile = m.id_member_profile
      WHERE m.id_clan_profile = $1
        AND m.deleted_at IS NULL
        ${whereBefore}
      ORDER BY m.id_clan_message DESC
      LIMIT $${limitParam}
      `,
      args
    );
    return r.rows;
  }

  static async getMessageById(conn, id_clan_message) {
    const r = await conn.query(
      `SELECT id_clan_message, id_clan_profile, id_user, deleted_at
         FROM public.tb_clan_message
        WHERE id_clan_message = $1
        LIMIT 1`,
      [id_clan_message]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async softDeleteMessage(conn, id_clan_message) {
    const r = await conn.query(
      `UPDATE public.tb_clan_message
          SET deleted_at = NOW()
        WHERE id_clan_message = $1 AND deleted_at IS NULL
        RETURNING id_clan_message`,
      [id_clan_message]
    );
    return r.rowCount > 0;
  }

  /**
   * Verifica se o usuário é membro de um clan (qualquer sub-perfil dele).
   * Retorna { id_member_profile, role } se sim, null caso contrário.
   */
  static async getUserMembership(conn, id_clan_profile, id_user) {
    const r = await conn.query(
      `SELECT cm.id_member_profile, cm.role
         FROM public.tb_clan_member cm
         JOIN public.tb_profile p ON p.id_profile = cm.id_member_profile
        WHERE cm.id_clan_profile = $1 AND p.id_user = $2
        LIMIT 1`,
      [id_clan_profile, id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ─── Compras de vagas (Stripe one-time) ────────────────────────────────
  static async createSlotPurchase(conn, { id_clan_profile, id_user_payer, amount_cents }) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_clan_slot_purchase
        (id_clan_profile, id_user_payer, amount_cents, status)
      VALUES ($1, $2, $3, 'pending')
      RETURNING id_clan_slot_purchase, id_clan_profile, id_user_payer,
                amount_cents, status, created_at
      `,
      [id_clan_profile, id_user_payer, amount_cents]
    );
    return r.rows[0];
  }

  static async setSlotPurchaseSession(conn, id_clan_slot_purchase, stripe_session_id) {
    const r = await conn.query(
      `UPDATE public.tb_clan_slot_purchase
          SET stripe_session_id = $2
        WHERE id_clan_slot_purchase = $1
        RETURNING id_clan_slot_purchase, stripe_session_id`,
      [id_clan_slot_purchase, stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async findSlotPurchaseBySession(conn, stripe_session_id) {
    const r = await conn.query(
      `SELECT id_clan_slot_purchase, id_clan_profile, id_user_payer,
              amount_cents, status, stripe_session_id, paid_at
         FROM public.tb_clan_slot_purchase
        WHERE stripe_session_id = $1
        LIMIT 1`,
      [stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async markSlotPurchasePaid(conn, id_clan_slot_purchase, stripe_payment_intent_id) {
    const r = await conn.query(
      `UPDATE public.tb_clan_slot_purchase
          SET status = 'paid',
              paid_at = NOW(),
              stripe_payment_intent_id = $2
        WHERE id_clan_slot_purchase = $1
          AND status = 'pending'
        RETURNING id_clan_slot_purchase, status, paid_at`,
      [id_clan_slot_purchase, stripe_payment_intent_id || null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listSlotPurchasesByClan(conn, id_clan_profile) {
    const r = await conn.query(
      `SELECT id_clan_slot_purchase, id_user_payer, amount_cents, status,
              stripe_session_id, created_at, paid_at
         FROM public.tb_clan_slot_purchase
        WHERE id_clan_profile = $1
        ORDER BY created_at DESC`,
      [id_clan_profile]
    );
    return r.rows;
  }

  static async machineExistsActive(conn, id_machine) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_machine
        WHERE id_machine = $1 AND is_active = TRUE LIMIT 1`,
      [id_machine]
    );
    return r.rowCount > 0;
  }
}

module.exports = ClanStorage;
