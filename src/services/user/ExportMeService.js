async function execute({ db, id_user }) {
  const [userRes, profilesRes, subscriptionsRes, couponsRes] = await Promise.all([
    db.query(
      `SELECT id_user, nome, username, email, telefone, bio, estado, municipio,
              data_nascimento, sexo, ativo, created_at
       FROM public.tb_user WHERE id_user = $1`,
      [id_user]
    ),
    db.query(
      `SELECT id_profile, display_name, is_active, is_visible, created_at
       FROM public.tb_profile WHERE id_user = $1`,
      [id_user]
    ),
    db.query(
      `SELECT id_subscription, id_profile, status, amount_cents, currency,
              paid_at, current_period_start, current_period_end, canceled_at, created_at
       FROM public.tb_profile_subscription WHERE id_user = $1 ORDER BY created_at DESC`,
      [id_user]
    ),
    db.query(
      `SELECT id_coupon, code, discount_type, value, is_active, created_at
       FROM public.tb_coupon WHERE owner_user_id = $1`,
      [id_user]
    ),
  ]);

  return {
    exported_at: new Date().toISOString(),
    user: userRes.rows[0] || null,
    profiles: profilesRes.rows,
    subscriptions: subscriptionsRes.rows,
    coupons: couponsRes.rows,
  };
}

module.exports = { execute };
