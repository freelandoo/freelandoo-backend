// src/storages/VaquinhaStorage.js
// SQL puro da Vaquinha (mig 170): campanha, doações, payout (Saldo) e posts.
module.exports = {
  // ─── Campanha ──────────────────────────────────────────────────────────────
  async getActiveByUser(db, userId) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha WHERE id_user = $1 AND status = 'active' LIMIT 1`,
      [userId]
    );
    return r.rows[0] || null;
  },

  async getBySlug(db, slug) {
    const r = await db.query(`SELECT * FROM public.tb_vaquinha WHERE slug = $1 LIMIT 1`, [slug]);
    return r.rows[0] || null;
  },

  async getById(db, id) {
    const r = await db.query(`SELECT * FROM public.tb_vaquinha WHERE id_vaquinha = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  async slugExists(db, slug) {
    const r = await db.query(`SELECT 1 FROM public.tb_vaquinha WHERE slug = $1 LIMIT 1`, [slug]);
    return r.rowCount > 0;
  },

  async create(db, { id_user, title, slug, bio, cover_url, goal_cents, deadline, kind = "vaquinha" }) {
    const r = await db.query(
      `INSERT INTO public.tb_vaquinha (id_user, title, slug, bio, cover_url, goal_cents, deadline, kind)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id_user, title, slug, bio || null, cover_url || null, goal_cents, deadline || null, kind]
    );
    return r.rows[0];
  },

  async update(db, id, fields) {
    const sets = ["updated_at = NOW()"];
    const vals = [];
    let i = 1;
    for (const key of ["title", "bio", "cover_url", "goal_cents", "deadline", "kind"]) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(fields[key]);
      }
    }
    vals.push(id);
    const r = await db.query(
      `UPDATE public.tb_vaquinha SET ${sets.join(", ")} WHERE id_vaquinha = $${i} RETURNING *`,
      vals
    );
    return r.rows[0] || null;
  },

  async setStatus(db, id, status) {
    const r = await db.query(
      `UPDATE public.tb_vaquinha
          SET status = $2, ended_at = CASE WHEN $2 IN ('ended','canceled') THEN NOW() ELSE ended_at END, updated_at = NOW()
        WHERE id_vaquinha = $1 RETURNING *`,
      [id, status]
    );
    return r.rows[0] || null;
  },

  // Encerra campanhas ativas cujo prazo já venceu (libera o "1 ativa por user").
  // Bolsa não tem prazo (deadline NULL) — nunca fecha sozinha.
  async closeExpiredForUser(db, userId) {
    await db.query(
      `UPDATE public.tb_vaquinha
          SET status = 'ended', ended_at = NOW(), updated_at = NOW()
        WHERE id_user = $1 AND status = 'active'
          AND deadline IS NOT NULL AND deadline < NOW()`,
      [userId]
    );
  },

  async bumpRaised(db, id, deltaCents, deltaDonors) {
    await db.query(
      `UPDATE public.tb_vaquinha
          SET raised_cents = GREATEST(0, raised_cents + $2),
              donors_count = GREATEST(0, donors_count + $3),
              updated_at = NOW()
        WHERE id_vaquinha = $1`,
      [id, deltaCents, deltaDonors]
    );
  },

  // ─── Doações ─────────────────────────────────────────────────────────────
  async createDonation(db, d) {
    const r = await db.query(
      `INSERT INTO public.tb_vaquinha_donation
        (id_vaquinha, id_donor_user, donor_name, message, gross_cents, platform_fee_cents, net_cents, stripe_session_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [d.id_vaquinha, d.id_donor_user || null, d.donor_name || null, d.message || null,
       d.gross_cents, d.platform_fee_cents, d.net_cents, d.stripe_session_id]
    );
    return r.rows[0];
  },

  async getDonationBySession(db, sessionId) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_donation WHERE stripe_session_id = $1 LIMIT 1`,
      [sessionId]
    );
    return r.rows[0] || null;
  },

  async getPaidDonationByCharge(db, { chargeId, paymentIntentId }) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_donation
        WHERE status = 'paid' AND (
          ($1::text IS NOT NULL AND stripe_charge_id = $1) OR
          ($2::text IS NOT NULL AND stripe_payment_intent_id = $2)
        ) LIMIT 1`,
      [chargeId || null, paymentIntentId || null]
    );
    return r.rows[0] || null;
  },

  async markDonationPaid(db, id, { paymentIntentId, chargeId }) {
    const r = await db.query(
      `UPDATE public.tb_vaquinha_donation
          SET status = 'paid', paid_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
              stripe_charge_id = COALESCE($3, stripe_charge_id)
        WHERE id_donation = $1 AND status = 'pending' RETURNING *`,
      [id, paymentIntentId || null, chargeId || null]
    );
    return r.rows[0] || null;
  },

  async markDonationRefunded(db, id) {
    const r = await db.query(
      `UPDATE public.tb_vaquinha_donation
          SET status = 'refunded', refunded_at = NOW()
        WHERE id_donation = $1 AND status = 'paid' RETURNING *`,
      [id]
    );
    return r.rows[0] || null;
  },

  async listPaidDonations(db, vaquinhaId, { limit = 30, offset = 0 } = {}) {
    const r = await db.query(
      `SELECT id_donation, donor_name, message, gross_cents, paid_at
         FROM public.tb_vaquinha_donation
        WHERE id_vaquinha = $1 AND status = 'paid'
        ORDER BY paid_at DESC NULLS LAST
        LIMIT $2 OFFSET $3`,
      [vaquinhaId, Math.min(limit, 100), offset]
    );
    return r.rows;
  },

  // ─── Payout (Saldo, holdback) ─────────────────────────────────────────────
  async insertPayout(db, p) {
    const r = await db.query(
      `INSERT INTO public.tb_vaquinha_payout
        (id_donation, id_vaquinha, id_owner_user, gross_cents, platform_fee_cents, net_cents, available_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id_donation) DO NOTHING RETURNING *`,
      [p.id_donation, p.id_vaquinha, p.id_owner_user, p.gross_cents, p.platform_fee_cents, p.net_cents, p.available_at]
    );
    return r.rows[0] || null;
  },

  async revertPayoutByDonation(db, donationId) {
    const r = await db.query(
      `UPDATE public.tb_vaquinha_payout
          SET status = 'revertido', reverted_at = NOW(), updated_at = NOW()
        WHERE id_donation = $1 AND status <> 'revertido' RETURNING *`,
      [donationId]
    );
    return r.rows[0] || null;
  },

  // ─── Posts (só da vaquinha) ───────────────────────────────────────────────
  async createPost(db, p) {
    const r = await db.query(
      `INSERT INTO public.tb_vaquinha_post
        (id_vaquinha, id_user, kind, caption, media_url, thumbnail_url, media_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [p.id_vaquinha, p.id_user, p.kind, p.caption || null, p.media_url || null, p.thumbnail_url || null, p.media_type || null]
    );
    return r.rows[0];
  },

  async listPosts(db, vaquinhaId, { kind, limit = 30, offset = 0 } = {}) {
    const params = [vaquinhaId];
    let where = `id_vaquinha = $1 AND deleted_at IS NULL`;
    if (kind) {
      params.push(kind);
      where += ` AND kind = $${params.length}`;
    }
    params.push(Math.min(limit, 100), offset);
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_post
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  },

  async getPost(db, id) {
    const r = await db.query(`SELECT * FROM public.tb_vaquinha_post WHERE id_post = $1 LIMIT 1`, [id]);
    return r.rows[0] || null;
  },

  async softDeletePost(db, id) {
    await db.query(
      `UPDATE public.tb_vaquinha_post SET deleted_at = NOW() WHERE id_post = $1 AND deleted_at IS NULL`,
      [id]
    );
  },

  // ─── Patrocínio recorrente (bolsa, mig 174) ───────────────────────────────
  async createSponsorship(db, { id_vaquinha, id_sponsor_user, sponsor_name, monthly_cents }) {
    const r = await db.query(
      `INSERT INTO public.tb_vaquinha_sponsorship
         (id_vaquinha, id_sponsor_user, sponsor_name, monthly_cents)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id_vaquinha, id_sponsor_user, sponsor_name || null, monthly_cents]
    );
    return r.rows[0];
  },

  async setSponsorshipSession(db, id, session_id) {
    await db.query(
      `UPDATE public.tb_vaquinha_sponsorship
          SET stripe_session_id = $2, updated_at = NOW()
        WHERE id_sponsorship = $1`,
      [id, session_id]
    );
  },

  async getSponsorshipById(db, id) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_sponsorship WHERE id_sponsorship = $1 LIMIT 1`,
      [id]
    );
    return r.rows[0] || null;
  },

  async getSponsorshipBySession(db, session_id) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_sponsorship WHERE stripe_session_id = $1 LIMIT 1`,
      [session_id]
    );
    return r.rows[0] || null;
  },

  async getSponsorshipBySubscriptionId(db, subscription_id) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_sponsorship WHERE stripe_subscription_id = $1 LIMIT 1`,
      [subscription_id]
    );
    return r.rows[0] || null;
  },

  // Patrocínio "vivo" (pending/active/past_due) do user nesta bolsa.
  async getLiveSponsorshipForUser(db, id_vaquinha, id_user) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_sponsorship
        WHERE id_vaquinha = $1 AND id_sponsor_user = $2
          AND status IN ('pending','active','past_due')
        LIMIT 1`,
      [id_vaquinha, id_user]
    );
    return r.rows[0] || null;
  },

  async listLiveSponsorships(db, id_vaquinha) {
    const r = await db.query(
      `SELECT * FROM public.tb_vaquinha_sponsorship
        WHERE id_vaquinha = $1 AND status IN ('pending','active','past_due')`,
      [id_vaquinha]
    );
    return r.rows;
  },

  // Lista pública de patrocinadores ativos (nome + mensal + desde quando).
  async listActiveSponsorsPublic(db, id_vaquinha, { limit = 30 } = {}) {
    const r = await db.query(
      `SELECT id_sponsorship, sponsor_name, monthly_cents, activated_at
         FROM public.tb_vaquinha_sponsorship
        WHERE id_vaquinha = $1 AND status IN ('active','past_due')
        ORDER BY monthly_cents DESC, activated_at ASC
        LIMIT $2`,
      [id_vaquinha, Math.min(limit, 100)]
    );
    return r.rows;
  },

  async activateSponsorship(db, id, { stripe_subscription_id, stripe_customer_id }) {
    await db.query(
      `UPDATE public.tb_vaquinha_sponsorship
          SET status = 'active',
              activated_at = COALESCE(activated_at, NOW()),
              stripe_subscription_id = COALESCE($2, stripe_subscription_id),
              stripe_customer_id = COALESCE($3, stripe_customer_id),
              updated_at = NOW()
        WHERE id_sponsorship = $1`,
      [id, stripe_subscription_id || null, stripe_customer_id || null]
    );
  },

  async markSponsorshipStatusBySubscriptionId(db, subscription_id, status) {
    await db.query(
      `UPDATE public.tb_vaquinha_sponsorship
          SET status = $2, updated_at = NOW()
        WHERE stripe_subscription_id = $1
          AND status IN ('pending','active','past_due')`,
      [subscription_id, status]
    );
  },

  async markSponsorshipCanceled(db, id) {
    await db.query(
      `UPDATE public.tb_vaquinha_sponsorship
          SET status = 'canceled', canceled_at = COALESCE(canceled_at, NOW()), updated_at = NOW()
        WHERE id_sponsorship = $1 AND status <> 'canceled'`,
      [id]
    );
  },

  async markSponsorshipExpiredBySession(db, session_id) {
    const r = await db.query(
      `UPDATE public.tb_vaquinha_sponsorship
          SET status = 'expired', updated_at = NOW()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_sponsorship`,
      [session_id]
    );
    return r.rowCount > 0;
  },

  // Fatura mensal paga → linha de doação JÁ paga (idempotente por invoice id).
  // Retorna a linha se inseriu AGORA; null se a fatura já tinha sido registrada.
  async createPaidSponsorDonation(db, d) {
    const r = await db.query(
      `INSERT INTO public.tb_vaquinha_donation
        (id_vaquinha, id_donor_user, donor_name, message, gross_cents, platform_fee_cents,
         net_cents, status, paid_at, id_sponsorship, stripe_invoice_id,
         stripe_payment_intent_id, stripe_charge_id)
       VALUES ($1,$2,$3,NULL,$4,$5,$6,'paid',NOW(),$7,$8,$9,$10)
       ON CONFLICT (stripe_invoice_id) WHERE stripe_invoice_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [d.id_vaquinha, d.id_donor_user || null, d.donor_name || null,
       d.gross_cents, d.platform_fee_cents, d.net_cents,
       d.id_sponsorship, d.stripe_invoice_id,
       d.stripe_payment_intent_id || null, d.stripe_charge_id || null]
    );
    return r.rows[0] || null;
  },

  // ─── Settings (taxa) ──────────────────────────────────────────────────────
  async getSettings(db) {
    const r = await db.query(`SELECT * FROM public.vaquinha_settings WHERE id = 1 LIMIT 1`);
    return r.rows[0] || { id: 1, platform_fee_percent: 10, max_days: 90, min_donation_cents: 500 };
  },

  async updateSettings(db, { platform_fee_percent, max_days, min_donation_cents, updated_by }) {
    const sets = ["updated_at = NOW()"];
    const vals = [];
    let i = 1;
    if (platform_fee_percent !== undefined) { sets.push(`platform_fee_percent = $${i++}`); vals.push(platform_fee_percent); }
    if (max_days !== undefined) { sets.push(`max_days = $${i++}`); vals.push(max_days); }
    if (min_donation_cents !== undefined) { sets.push(`min_donation_cents = $${i++}`); vals.push(min_donation_cents); }
    if (updated_by) { sets.push(`updated_by = $${i++}`); vals.push(updated_by); }
    await db.query(`INSERT INTO public.vaquinha_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    const r = await db.query(
      `UPDATE public.vaquinha_settings SET ${sets.join(", ")} WHERE id = 1 RETURNING *`,
      vals
    );
    return r.rows[0];
  },
};
