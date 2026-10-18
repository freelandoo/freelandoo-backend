// SQL dos outdoors da Freelandoo Arena (mig 286). Sem regra de negócio: quem
// decide é ArenaAdService / ArenaAdOps (e as regras puras em utils/arenaAds).
//
// "Agora" é SEMPRE o relógio do banco (clock_timestamp()), nunca o do Node nem
// o do navegador.

/**
 * Subconsulta da entrega VIGENTE de um espaço: reserva ativa cobrindo agora,
 * campanha aprovada + ativa + na janela, criativo corrente aprovado. Ordem
 * determinística (início da reserva, id) — conflitos já são recusados na
 * escrita, a ordem só garante resposta estável se algo escapar.
 */
const LIVE_DELIVERY = `
  SELECT c.id_campaign, c.code, c.sponsor_label, c.is_demo, c.ends_at AS campaign_ends_at,
         b.id_booking, b.ends_at AS booking_ends_at,
         cr.id_creative, cr.version, cr.kind, cr.far_ref, cr.near_ref, cr.poster_ref, cr.video_ref,
         cr.video_duration_ms, cr.alt_text, cr.headline, cr.body, cr.cta_label, cr.cta_url, cr.content_hash
    FROM public.tb_arena_ad_booking b
    JOIN public.tb_arena_ad_campaign c ON c.id_campaign = b.id_campaign
    JOIN public.tb_arena_ad_creative cr ON cr.id_campaign = c.id_campaign AND cr.version = c.current_creative_version
   WHERE b.placement_id = p.placement_id
     AND b.status = 'active' AND b.starts_at <= clock_timestamp() AND clock_timestamp() < b.ends_at
     AND c.approval_status = 'approved' AND c.op_status = 'active'
     AND c.starts_at <= clock_timestamp() AND clock_timestamp() < c.ends_at
     AND cr.approval_status = 'approved'
   ORDER BY b.starts_at, b.id_booking
   LIMIT 1`;

class ArenaAdStorage {
  static async now(conn) {
    const r = await conn.query(`SELECT clock_timestamp() AS now`);
    return r.rows[0].now;
  }

  static async lockAccount(conn, id_user) {
    // Mesmo espaço de travas das missões: conta → linhas. Nunca o inverso.
    await conn.query(`SELECT pg_advisory_xact_lock(73110, hashtext($1::text))`, [id_user]);
  }

  // ─── Entrega ──────────────────────────────────────────────────────────────

  static async listDeliveries(conn, environmentId) {
    const r = await conn.query(
      `SELECT p.placement_id, p.instance_id, p.slot, p.asset_id, p.map_version, p.generator_version, d.*
         FROM public.tb_arena_ad_placement p
         LEFT JOIN LATERAL (${LIVE_DELIVERY}) d ON TRUE
        WHERE p.environment_id = $1 AND p.is_active AND p.slot_class = 'commercial'
        ORDER BY p.placement_id`,
      [environmentId]
    );
    return r.rows;
  }

  /** Próxima mudança AGENDADA no ambiente (início de reserva/campanha). Para o cache do cliente. */
  static async nextChange(conn, environmentId) {
    const r = await conn.query(
      `SELECT MIN(GREATEST(b.starts_at, c.starts_at)) AS at
         FROM public.tb_arena_ad_booking b
         JOIN public.tb_arena_ad_placement p ON p.placement_id = b.placement_id
         JOIN public.tb_arena_ad_campaign c ON c.id_campaign = b.id_campaign
        WHERE p.environment_id = $1 AND b.status = 'active' AND c.op_status = 'active'
          AND c.approval_status = 'approved'
          AND GREATEST(b.starts_at, c.starts_at) > clock_timestamp()`,
      [environmentId]
    );
    return r.rows[0]?.at || null;
  }

  static async getDelivery(conn, placementId) {
    const r = await conn.query(
      `SELECT p.placement_id, p.environment_id, p.instance_id, p.slot, p.is_active, p.slot_class, d.*
         FROM public.tb_arena_ad_placement p
         LEFT JOIN LATERAL (${LIVE_DELIVERY}) d ON TRUE
        WHERE p.placement_id = $1`,
      [placementId]
    );
    return r.rows[0] || null;
  }

  static async hasLiveVideo(conn) {
    const r = await conn.query(
      `SELECT EXISTS (
         SELECT 1 FROM public.tb_arena_ad_placement p, LATERAL (${LIVE_DELIVERY}) d
          WHERE p.is_active AND p.slot_class = 'commercial' AND d.kind = 'video'
       ) AS yes`
    );
    return r.rows[0].yes;
  }

  /** O espaço ainda entrega ESTA versão de criativo? (sessão de vídeo em andamento). */
  static async isStillDeliverable(conn, { placement_id, id_campaign, id_creative }) {
    const r = await conn.query(
      `SELECT EXISTS (
         SELECT 1
           FROM public.tb_arena_ad_booking b
           JOIN public.tb_arena_ad_campaign c ON c.id_campaign = b.id_campaign
           JOIN public.tb_arena_ad_creative cr ON cr.id_creative = $3 AND cr.id_campaign = c.id_campaign
           JOIN public.tb_arena_ad_placement p ON p.placement_id = b.placement_id
          WHERE b.placement_id = $1 AND c.id_campaign = $2 AND p.is_active
            AND b.status = 'active' AND b.starts_at <= clock_timestamp() AND clock_timestamp() < b.ends_at
            AND c.approval_status = 'approved' AND c.op_status = 'active'
            AND c.starts_at <= clock_timestamp() AND clock_timestamp() < c.ends_at
            AND cr.approval_status = 'approved'
       ) AS yes`,
      [placement_id, id_campaign, id_creative]
    );
    return r.rows[0].yes;
  }

  // ─── Sinais do cliente ────────────────────────────────────────────────────

  /** O criativo/versão foi entregue NESTE espaço há no máximo 2 h? (sinal coerente). */
  static async signalTarget(conn, { placementId, creativeId, creativeVersion }) {
    const r = await conn.query(
      `SELECT cr.id_campaign
         FROM public.tb_arena_ad_creative cr
         JOIN public.tb_arena_ad_booking b ON b.id_campaign = cr.id_campaign AND b.placement_id = $1
        WHERE cr.id_creative = $2 AND cr.version = $3
          AND b.starts_at <= clock_timestamp() AND b.ends_at > clock_timestamp() - INTERVAL '2 hours'
        LIMIT 1`,
      [placementId, creativeId, creativeVersion]
    );
    return r.rows[0]?.id_campaign || null;
  }

  static async insertSignal(conn, row) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_ad_signal
         (id_user, placement_id, id_creative, creative_version, id_campaign, signal_type, incentivized, bucket_start)
       VALUES ($1, $2, $3, $4, $5, $6, $7, date_trunc('hour', clock_timestamp()))
       ON CONFLICT DO NOTHING
       RETURNING id_signal`,
      [row.id_user, row.placement_id, row.id_creative, row.creative_version, row.id_campaign, row.signal_type, row.incentivized]
    );
    return r.rowCount > 0;
  }

  // ─── Sessões de vídeo ─────────────────────────────────────────────────────

  static async findSessionByRequest(conn, id_user, request_id) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_ad_video_session WHERE id_user = $1 AND request_id = $2`, [id_user, request_id]);
    return r.rows[0] || null;
  }

  static async getSession(conn, id_user, id_session, { forUpdate = false } = {}) {
    const r = await conn.query(
      `SELECT * FROM public.tb_arena_ad_video_session WHERE id_session = $1 AND id_user = $2 ${forUpdate ? "FOR UPDATE" : ""}`,
      [id_session, id_user]
    );
    return r.rows[0] || null;
  }

  static async countSessionsToday(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_arena_ad_video_session
        WHERE id_user = $1 AND started_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
      [id_user]
    );
    return r.rows[0].n;
  }

  static async supersedeOpen(conn, id_user) {
    const r = await conn.query(
      `UPDATE public.tb_arena_ad_video_session
          SET state = 'superseded', terminal_reason = 'new_session', ended_at = clock_timestamp()
        WHERE id_user = $1 AND state = 'open' RETURNING id_session`,
      [id_user]
    );
    return r.rows.map((x) => x.id_session);
  }

  static async insertSession(conn, s) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_ad_video_session
         (id_session, id_user, request_id, placement_id, id_campaign, id_creative, creative_version, policy_version,
          nonce_hash, duration_ms, incentivized, started_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp(),
               clock_timestamp() + ($12::int * INTERVAL '1 millisecond'))
       RETURNING *`,
      [s.id_session, s.id_user, s.request_id, s.placement_id, s.id_campaign, s.id_creative, s.creative_version, s.policy_version, s.nonce_hash, s.duration_ms, s.incentivized, s.ttl_ms]
    );
    return r.rows[0];
  }

  static async updateSession(conn, id_session, patch) {
    const keys = Object.keys(patch);
    const sets = keys.map((k, i) => `${k} = $${i + 2}`);
    const r = await conn.query(`UPDATE public.tb_arena_ad_video_session SET ${sets.join(", ")} WHERE id_session = $1 RETURNING *`, [
      id_session,
      ...keys.map((k) => patch[k]),
    ]);
    return r.rows[0];
  }

  static async expireOpenSessions(conn, limit = 500) {
    const r = await conn.query(
      `UPDATE public.tb_arena_ad_video_session SET state = 'expired', terminal_reason = 'expired', ended_at = clock_timestamp()
        WHERE id_session IN (
          SELECT id_session FROM public.tb_arena_ad_video_session
           WHERE state = 'open' AND expires_at <= clock_timestamp()
           ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED)
        RETURNING id_session`,
      [limit]
    );
    return r.rowCount;
  }

  static async purgeOld(conn, days = 90) {
    const a = await conn.query(`DELETE FROM public.tb_arena_ad_signal WHERE bucket_start < clock_timestamp() - ($1::int * INTERVAL '1 day')`, [days]);
    const b = await conn.query(
      `DELETE FROM public.tb_arena_ad_video_session
        WHERE state <> 'open' AND COALESCE(ended_at, completed_at, started_at) < clock_timestamp() - ($1::int * INTERVAL '1 day')`,
      [days]
    );
    return { signals: a.rowCount, sessions: b.rowCount };
  }

  // ─── Operação ─────────────────────────────────────────────────────────────

  static async getCampaignByCode(conn, code, { forUpdate = false } = {}) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_ad_campaign WHERE code = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [code]);
    return r.rows[0] || null;
  }

  static async listCreatives(conn, id_campaign) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_ad_creative WHERE id_campaign = $1 ORDER BY version`, [id_campaign]);
    return r.rows;
  }

  static async listBookings(conn, id_campaign) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_ad_booking WHERE id_campaign = $1 ORDER BY starts_at, id_booking`, [id_campaign]);
    return r.rows;
  }

  static async getPlacement(conn, placementId, { forUpdate = false } = {}) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_ad_placement WHERE placement_id = $1 ${forUpdate ? "FOR UPDATE" : ""}`, [placementId]);
    return r.rows[0] || null;
  }

  /** Reservas ATIVAS que se sobrepõem a [s, e) no espaço, de campanha não encerrada. */
  static async overlappingBookings(conn, placementId, s, e, excludeCampaign = null) {
    const r = await conn.query(
      `SELECT b.id_booking, c.code
         FROM public.tb_arena_ad_booking b
         JOIN public.tb_arena_ad_campaign c ON c.id_campaign = b.id_campaign
        WHERE b.placement_id = $1 AND b.status = 'active' AND c.op_status <> 'ended'
          AND b.starts_at < $3 AND $2 < b.ends_at
          AND ($4::uuid IS NULL OR b.id_campaign <> $4::uuid)`,
      [placementId, s, e, excludeCampaign]
    );
    return r.rows;
  }
}

module.exports = ArenaAdStorage;
