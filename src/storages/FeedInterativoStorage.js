// Feed Interativo (migs 456+): vínculos de lançar, fila de drops e preferências.
// SQL parametrizado; nenhuma regra de negócio aqui (FeedInterativoService).

const USER_CARD = `
  tu.id_user,
  tu.username,
  COALESCE(pa.display_name, tu.username) AS display_name,
  pa.avatar_url
`;
const USER_JOIN = `
  LEFT JOIN public.tb_profile pa
    ON pa.id_user = tu.id_user AND pa.is_user_account = TRUE AND pa.deleted_at IS NULL
`;

// Nenhum dos dois bloqueou o outro (bloqueio social, mig 283).
const NO_BLOCK = (a, b) => `NOT EXISTS (
  SELECT 1 FROM public.tb_user_block ub
   WHERE (ub.blocker_user_id = ${a} AND ub.blocked_user_id = ${b})
      OR (ub.blocker_user_id = ${b} AND ub.blocked_user_id = ${a})
)`;

class FeedInterativoStorage {
  static async userCard(db, id_user) {
    const r = await db.query(
      `SELECT ${USER_CARD}, tu.ativo, tu.blocked_at
         FROM public.tb_user tu ${USER_JOIN}
        WHERE tu.id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async findUserByUsername(db, username) {
    const r = await db.query(
      `SELECT ${USER_CARD}, tu.ativo, tu.blocked_at
         FROM public.tb_user tu ${USER_JOIN}
        WHERE LOWER(tu.username) = LOWER($1)
        LIMIT 1`,
      [username]
    );
    return r.rows[0] || null;
  }

  static async getLink(db, id_sender, id_receiver) {
    const r = await db.query(
      `SELECT * FROM public.tb_feed_throw_link WHERE id_sender = $1 AND id_receiver = $2`,
      [id_sender, id_receiver]
    );
    return r.rows[0] || null;
  }

  static async getLinkById(db, id_link) {
    const r = await db.query(`SELECT * FROM public.tb_feed_throw_link WHERE id_link = $1`, [id_link]);
    return r.rows[0] || null;
  }

  /** Convite novo ou reaberto (a regra de quando pode já foi conferida). */
  static async upsertInvite(db, id_sender, id_receiver) {
    const r = await db.query(
      `INSERT INTO public.tb_feed_throw_link (id_sender, id_receiver, status)
       VALUES ($1, $2, 'pending')
       ON CONFLICT (id_sender, id_receiver) DO UPDATE
          SET status = 'pending', invited_at = NOW(), accepted_at = NULL, updated_at = NOW()
       RETURNING *`,
      [id_sender, id_receiver]
    );
    return r.rows[0];
  }

  /** Troca de estado só a partir dos estados permitidos (corrida = 0 linhas). */
  static async setStatus(db, id_link, from, to) {
    const r = await db.query(
      `UPDATE public.tb_feed_throw_link
          SET status = $3,
              accepted_at = CASE WHEN $3 = 'active' AND accepted_at IS NULL THEN NOW() ELSE accepted_at END,
              updated_at = NOW()
        WHERE id_link = $1 AND status = ANY($2::text[])
        RETURNING *`,
      [id_link, from, to]
    );
    return r.rows[0] || null;
  }

  static async deleteLink(db, id_link) {
    const r = await db.query(`DELETE FROM public.tb_feed_throw_link WHERE id_link = $1`, [id_link]);
    return r.rowCount > 0;
  }

  static async countInvitesToday(db, id_sender) {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_feed_throw_link
        WHERE id_sender = $1 AND invited_at > NOW() - INTERVAL '1 day'`,
      [id_sender]
    );
    return r.rows[0].n;
  }

  /**
   * Os dois lados do usuário. O SENDER nunca vê 'silenced' (vê 'active') nem
   * 'blocked'/'revoked'/'declined' (a linha some da lista dele).
   */
  static async listLinks(db, id_user) {
    const sending = await db.query(
      `SELECT l.id_link,
              CASE WHEN l.status = 'silenced' THEN 'active' ELSE l.status END AS status,
              l.invited_at, l.accepted_at, ${USER_CARD}
         FROM public.tb_feed_throw_link l
         JOIN public.tb_user tu ON tu.id_user = l.id_receiver
         ${USER_JOIN}
        WHERE l.id_sender = $1
          AND l.status IN ('pending', 'active', 'silenced')
          AND tu.ativo = TRUE
        ORDER BY l.status, l.updated_at DESC
        LIMIT 300`,
      [id_user]
    );
    const receiving = await db.query(
      `SELECT l.id_link, l.status, l.invited_at, l.accepted_at, ${USER_CARD}
         FROM public.tb_feed_throw_link l
         JOIN public.tb_user tu ON tu.id_user = l.id_sender
         ${USER_JOIN}
        WHERE l.id_receiver = $1
          AND l.status IN ('pending', 'active', 'silenced', 'blocked', 'revoked')
          AND tu.ativo = TRUE
        ORDER BY l.updated_at DESC
        LIMIT 300`,
      [id_user]
    );
    return { sending: sending.rows, receiving: receiving.rows };
  }

  /** Para quem EU posso lançar agora (silenciado aparece igual: é segredo do outro). */
  static async throwTargets(db, id_sender) {
    const r = await db.query(
      `SELECT ${USER_CARD}, l.status AS link_status
         FROM public.tb_feed_throw_link l
         JOIN public.tb_user tu ON tu.id_user = l.id_receiver
         ${USER_JOIN}
        WHERE l.id_sender = $1
          AND l.status IN ('active', 'silenced')
          AND tu.ativo = TRUE AND tu.blocked_at IS NULL
          AND ${NO_BLOCK("$1", "l.id_receiver")}
        ORDER BY l.accepted_at DESC NULLS LAST
        LIMIT 200`,
      [id_sender]
    );
    return r.rows;
  }

  static async isMutualFollow(db, a, b) {
    const r = await db.query(
      `SELECT
         EXISTS (
           SELECT 1 FROM public.entity_follows f
             JOIN public.tb_profile pf ON pf.id_profile = f.follower_id
             JOIN public.tb_profile pt ON pt.id_profile = f.target_id
            WHERE f.deleted_at IS NULL AND f.follower_type = 'profile' AND f.target_type = 'profile'
              AND pf.id_user = $1 AND pt.id_user = $2
         ) AND EXISTS (
           SELECT 1 FROM public.entity_follows f
             JOIN public.tb_profile pf ON pf.id_profile = f.follower_id
             JOIN public.tb_profile pt ON pt.id_profile = f.target_id
            WHERE f.deleted_at IS NULL AND f.follower_type = 'profile' AND f.target_type = 'profile'
              AND pf.id_user = $2 AND pt.id_user = $1
         ) AS mutual`,
      [a, b]
    );
    return !!r.rows[0]?.mutual;
  }

  // ── preferências ──
  static async getPrefs(db, id_user) {
    const r = await db.query(`SELECT * FROM public.tb_feed_fx_prefs WHERE id_user = $1`, [id_user]);
    return r.rows[0] || { id_user, invite_policy: "todos", accept_gifts: true };
  }

  static async setPrefs(db, id_user, { invite_policy, accept_gifts }) {
    const r = await db.query(
      `INSERT INTO public.tb_feed_fx_prefs (id_user, invite_policy, accept_gifts)
       VALUES ($1, COALESCE($2, 'todos'), COALESCE($3, TRUE))
       ON CONFLICT (id_user) DO UPDATE
          SET invite_policy = COALESCE($2, tb_feed_fx_prefs.invite_policy),
              accept_gifts = COALESCE($3, tb_feed_fx_prefs.accept_gifts),
              updated_at = NOW()
       RETURNING *`,
      [id_user, invite_policy ?? null, typeof accept_gifts === "boolean" ? accept_gifts : null]
    );
    return r.rows[0];
  }

  // ── drops ──
  static async countRecentDrops(db, { id_sender, kind, interval, id_receiver = null }) {
    const r = await db.query(
      `SELECT COUNT(DISTINCT COALESCE(id_batch, id_drop))::int AS n
         FROM public.tb_feed_drop
        WHERE id_sender = $1 AND kind = $2
          AND created_at > NOW() - $3::interval
          AND ($4::uuid IS NULL OR id_receiver = $4)`,
      [id_sender, kind, interval, id_receiver]
    );
    return r.rows[0].n;
  }

  /** Quem já recebeu ESTE post deste sender nas últimas 24 h (não manda de novo). */
  static async recentPostReceivers(db, id_sender, id_portfolio_item, receivers) {
    const r = await db.query(
      `SELECT DISTINCT id_receiver FROM public.tb_feed_drop
        WHERE id_sender = $1 AND kind = 'throw' AND id_portfolio_item = $2
          AND id_receiver = ANY($3::uuid[])
          AND created_at > NOW() - INTERVAL '24 hours'`,
      [id_sender, id_portfolio_item, receivers]
    );
    return new Set(r.rows.map((x) => x.id_receiver));
  }

  static async insertDrop(db, d) {
    const r = await db.query(
      `INSERT INTO public.tb_feed_drop
         (kind, id_sender, id_receiver, id_portfolio_item, payload, status, deliver_at, delivered_at, id_batch)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, COALESCE($7, NOW()),
               CASE WHEN $6 IN ('delivered', 'muted') THEN NOW() ELSE NULL END, $8)
       RETURNING id_drop, kind, status, deliver_at, created_at`,
      [
        d.kind,
        d.id_sender,
        d.id_receiver,
        d.id_portfolio_item || null,
        JSON.stringify(d.payload || {}),
        d.status,
        d.deliver_at || null,
        d.id_batch || null,
      ]
    );
    return r.rows[0];
  }

  /** O que ainda não entrou no feed do receiver (últimos 7 dias, mais velho primeiro). */
  static async inbox(db, id_receiver, limit = 20) {
    const r = await db.query(
      `SELECT d.id_drop, d.kind, d.id_portfolio_item, d.payload, d.created_at, d.delivered_at,
              d.id_sender, ${USER_CARD}
         FROM public.tb_feed_drop d
         JOIN public.tb_user tu ON tu.id_user = d.id_sender
         ${USER_JOIN}
        WHERE d.id_receiver = $1
          AND d.status = 'delivered'
          AND COALESCE(d.delivered_at, d.created_at) > NOW() - INTERVAL '7 days'
          AND tu.ativo = TRUE
          AND ${NO_BLOCK("$1", "d.id_sender")}
        ORDER BY COALESCE(d.delivered_at, d.created_at) ASC
        LIMIT $2`,
      [id_receiver, limit]
    );
    return r.rows;
  }

  static async markStatus(db, id_receiver, ids, from, to, { exceptKind = null } = {}) {
    if (!ids.length) return 0;
    const col = to === "seen" ? "seen_at" : to === "opened" ? "opened_at" : null;
    const r = await db.query(
      `UPDATE public.tb_feed_drop
          SET status = $4${col ? `, ${col} = COALESCE(${col}, NOW())` : ""}
        WHERE id_receiver = $1 AND id_drop = ANY($2::uuid[]) AND status = ANY($3::text[])
          AND ($5::text IS NULL OR kind <> $5)`,
      [id_receiver, ids, from, to, exceptKind]
    );
    return r.rowCount;
  }

  // ── baú (mig 457) ──
  /** Abre o baú uma vez só: troca o estado e marca a recompensa na mesma linha. */
  static async openGift(db, id_drop, id_receiver) {
    const r = await db.query(
      `UPDATE public.tb_feed_drop
          SET status = 'opened', opened_at = NOW(), reward_applied = TRUE
        WHERE id_drop = $1 AND id_receiver = $2 AND kind = 'gift'
          AND status IN ('delivered', 'seen') AND reward_applied = FALSE
        RETURNING *`,
      [id_drop, id_receiver]
    );
    return r.rows[0] || null;
  }

  static async addSticker(db, id_user, sticker_id, from) {
    await db.query(
      `INSERT INTO public.tb_feed_sticker_owned (id_user, sticker_id, last_from)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user, sticker_id) DO UPDATE
          SET qty = tb_feed_sticker_owned.qty + 1, last_at = NOW(), last_from = $3`,
      [id_user, sticker_id, from]
    );
  }

  static async listStickers(db, id_user) {
    const r = await db.query(
      `SELECT sticker_id, qty, first_at, last_at FROM public.tb_feed_sticker_owned
        WHERE id_user = $1 ORDER BY first_at`,
      [id_user]
    );
    return r.rows;
  }

  static async acceptsGifts(db, ids) {
    if (!ids.length) return new Set();
    const r = await db.query(
      `SELECT u.id FROM UNNEST($1::uuid[]) AS u(id)
         LEFT JOIN public.tb_feed_fx_prefs p ON p.id_user = u.id
        WHERE COALESCE(p.accept_gifts, TRUE) = TRUE`,
      [ids]
    );
    return new Set(r.rows.map((x) => x.id));
  }

  static async getDropForReceiver(db, id_drop, id_receiver) {
    const r = await db.query(
      `SELECT * FROM public.tb_feed_drop WHERE id_drop = $1 AND id_receiver = $2`,
      [id_drop, id_receiver]
    );
    return r.rows[0] || null;
  }
}

module.exports = FeedInterativoStorage;
module.exports.USER_CARD = USER_CARD;
module.exports.USER_JOIN = USER_JOIN;
