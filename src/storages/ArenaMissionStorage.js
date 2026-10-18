// SQL das missões, fatos, XP da Arena e aquecimento x2 (mig 287).
// Nada aqui toca tb_profile.xp_*, XpStorage, Poléns ou ranking da plataforma.

class ArenaMissionStorage {
  static async lockAccount(conn, id_user) {
    await conn.query(`SELECT pg_advisory_xact_lock(73110, hashtext($1::text))`, [id_user]);
  }

  /** Insere o fato NA TRANSAÇÃO DA AUTORIDADE. Repetido → null (já existia). */
  static async insertFact(conn, f) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_fact (id_user, fact_type, source_ref, environment_id, occurred_at, payload)
       VALUES ($1, $2, $3, $4, COALESCE($5::timestamptz, clock_timestamp()), $6::jsonb)
       ON CONFLICT (fact_type, id_user, source_ref) DO NOTHING
       RETURNING id_fact, occurred_at`,
      [f.id_user, f.fact_type, f.source_ref, f.environment_id ?? null, f.occurred_at ?? null, JSON.stringify(f.payload ?? {})]
    );
    return r.rows[0] || null;
  }

  static async getFactForUpdate(conn, id_fact) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_fact WHERE id_fact = $1 FOR UPDATE`, [id_fact]);
    return r.rows[0] || null;
  }

  static async markProcessed(conn, id_fact) {
    await conn.query(`UPDATE public.tb_arena_fact SET processed_at = clock_timestamp(), last_error = NULL WHERE id_fact = $1`, [id_fact]);
  }

  static async markFailed(conn, id_fact, message) {
    await conn.query(`UPDATE public.tb_arena_fact SET attempts = attempts + 1, last_error = $2 WHERE id_fact = $1 AND processed_at IS NULL`, [
      id_fact,
      String(message || "erro").slice(0, 200),
    ]);
  }

  /** Pendentes em ORDEM do instante autoritativo (por conta, mais antigo primeiro). */
  static async listPending(conn, { id_user = null, limit = 200, maxAttempts = 20 } = {}) {
    const r = await conn.query(
      `SELECT id_fact, id_user FROM public.tb_arena_fact
        WHERE processed_at IS NULL AND attempts < $3 AND ($1::uuid IS NULL OR id_user = $1::uuid)
        ORDER BY occurred_at, id_fact LIMIT $2`,
      [id_user, limit, maxAttempts]
    );
    return r.rows;
  }

  static async countPending(conn, id_user) {
    const r = await conn.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE id_user = $1 AND processed_at IS NULL`, [id_user]);
    return r.rows[0].n;
  }

  // ─── Catálogo ─────────────────────────────────────────────────────────────

  static async currentDefs(conn, factType = null) {
    const r = await conn.query(
      `SELECT * FROM public.tb_arena_mission_def
        WHERE status IN ('active', 'disabled') AND ($1::text IS NULL OR fact_type = $1::text)
        ORDER BY sort_order, mission_key`,
      [factType]
    );
    return r.rows;
  }

  static async getDef(conn, mission_key, version) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_mission_def WHERE mission_key = $1 AND version = $2`, [mission_key, version]);
    return r.rows[0] || null;
  }

  // ─── Progresso ────────────────────────────────────────────────────────────

  static async getProgress(conn, id_user, mission_key, cycle_key, { forUpdate = false } = {}) {
    const r = await conn.query(
      `SELECT * FROM public.tb_arena_mission_progress WHERE id_user = $1 AND mission_key = $2 AND cycle_key = $3 ${forUpdate ? "FOR UPDATE" : ""}`,
      [id_user, mission_key, cycle_key]
    );
    return r.rows[0] || null;
  }

  static async createProgress(conn, row) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_mission_progress (id_user, mission_key, cycle_key, mission_version, target)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id_user, mission_key, cycle_key) DO NOTHING
       RETURNING *`,
      [row.id_user, row.mission_key, row.cycle_key, row.mission_version, row.target]
    );
    return r.rows[0] || null;
  }

  static async insertContrib(conn, row) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_mission_contrib (id_user, mission_key, cycle_key, contrib_key, id_fact)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING contrib_key`,
      [row.id_user, row.mission_key, row.cycle_key, row.contrib_key, row.id_fact]
    );
    return r.rowCount > 0;
  }

  static async advance(conn, id_user, mission_key, cycle_key, completedAt) {
    const r = await conn.query(
      `UPDATE public.tb_arena_mission_progress
          SET progress = progress + 1,
              completed_at = CASE WHEN progress + 1 >= target THEN $4::timestamptz ELSE completed_at END,
              updated_at = clock_timestamp()
        WHERE id_user = $1 AND mission_key = $2 AND cycle_key = $3 AND completed_at IS NULL
        RETURNING *`,
      [id_user, mission_key, cycle_key, completedAt]
    );
    return r.rows[0] || null;
  }

  static async listProgress(conn, id_user, cycle_key) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_mission_progress WHERE id_user = $1 AND cycle_key = $2`, [id_user, cycle_key]);
    return r.rows;
  }

  // ─── Concessão (ledger) ───────────────────────────────────────────────────

  static async insertGrant(conn, g) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_xp_grant
         (id_user, mission_key, mission_version, cycle_key, id_fact, fact_type, fact_at, base_xp, factor, xp, id_boost, rule_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (id_user, mission_key, cycle_key) DO NOTHING
       RETURNING *`,
      [g.id_user, g.mission_key, g.mission_version, g.cycle_key, g.id_fact, g.fact_type, g.fact_at, g.base_xp, g.factor, g.xp, g.id_boost, g.rule_version]
    );
    return r.rows[0] || null;
  }

  static async getGrant(conn, id_user, mission_key, cycle_key) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_xp_grant WHERE id_user = $1 AND mission_key = $2 AND cycle_key = $3`, [id_user, mission_key, cycle_key]);
    return r.rows[0] || null;
  }

  static async listGrants(conn, id_user, { limit = 20, before = null } = {}) {
    const r = await conn.query(
      `SELECT id_grant, mission_key, mission_version, cycle_key, fact_type, fact_at, base_xp, factor, xp, granted_at
         FROM public.tb_arena_xp_grant
        WHERE id_user = $1 AND ($3::timestamptz IS NULL OR granted_at < $3::timestamptz)
        ORDER BY granted_at DESC, id_grant DESC LIMIT $2`,
      [id_user, limit, before]
    );
    return r.rows;
  }

  static async addXp(conn, id_user, xp) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_progression (id_user, xp_total, grants, revision) VALUES ($1, $2, 1, 1)
       ON CONFLICT (id_user) DO UPDATE SET
         xp_total = public.tb_arena_progression.xp_total + EXCLUDED.xp_total,
         grants = public.tb_arena_progression.grants + 1,
         revision = public.tb_arena_progression.revision + 1,
         updated_at = clock_timestamp()
       RETURNING *`,
      [id_user, xp]
    );
    return r.rows[0];
  }

  static async getProgression(conn, id_user) {
    const r = await conn.query(`SELECT * FROM public.tb_arena_progression WHERE id_user = $1`, [id_user]);
    return r.rows[0] || null;
  }

  // ─── Aquecimento x2 ───────────────────────────────────────────────────────

  static async boostState(conn, id_user) {
    const r = await conn.query(
      `SELECT
         (SELECT COUNT(*)::int FROM public.tb_arena_boost
           WHERE id_user = $1 AND starts_at >= date_trunc('day', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today_count,
         (SELECT MAX(starts_at) FROM public.tb_arena_boost WHERE id_user = $1) AS last_starts_at,
         (SELECT row_to_json(b) FROM (
            SELECT id_boost, starts_at, expires_at FROM public.tb_arena_boost
             WHERE id_user = $1 AND revoked_at IS NULL AND starts_at <= clock_timestamp() AND clock_timestamp() < expires_at
             ORDER BY starts_at DESC LIMIT 1) b) AS active,
         clock_timestamp() AS now`,
      [id_user]
    );
    return r.rows[0];
  }

  static async insertBoost(conn, b) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_boost (id_user, origin_kind, origin_ref, policy_version, starts_at, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (origin_kind, origin_ref) DO NOTHING RETURNING *`,
      [b.id_user, b.origin_kind, b.origin_ref, b.policy_version, b.starts_at, b.expires_at]
    );
    return r.rows[0] || null;
  }

  /** O bônus vigente no INSTANTE do fato (nunca o de agora). */
  static async boostAt(conn, id_user, at) {
    const r = await conn.query(
      `SELECT * FROM public.tb_arena_boost
        WHERE id_user = $1 AND revoked_at IS NULL AND starts_at <= $2 AND $2 < expires_at
        ORDER BY starts_at DESC LIMIT 1`,
      [id_user, at]
    );
    return r.rows[0] || null;
  }

  static async anyCompetitivePost(conn) {
    const r = await conn.query(
      `SELECT EXISTS (SELECT 1 FROM public.tb_arena_post WHERE competitive AND is_active AND valid_from <= clock_timestamp()) AS yes`
    );
    return r.rows[0].yes;
  }
}

module.exports = ArenaMissionStorage;
