// src/storages/WorkoutStorage.js
// Persistência de treinos (mig 178): biblioteca de exercícios, fichas,
// sessões diárias e checks por exercício.
module.exports = {
  // ─── Biblioteca ────────────────────────────────────────────────────────────
  async listExercises(db, { muscle, q } = {}) {
    const vals = [];
    const where = ["is_active = TRUE"];
    if (muscle) {
      vals.push(muscle);
      where.push(`muscle_group = $${vals.length}`);
    }
    if (q) {
      vals.push(`%${q}%`);
      where.push(`nome ILIKE $${vals.length}`);
    }
    const r = await db.query(
      `SELECT id_exercise, nome, muscle_group FROM public.tb_exercise
        WHERE ${where.join(" AND ")}
        ORDER BY muscle_group, nome`,
      vals
    );
    return r.rows;
  },

  // ─── Fichas ────────────────────────────────────────────────────────────────
  async createPlan(db, { id_academy, id_member, created_by, nome, notes }) {
    const r = await db.query(
      `INSERT INTO public.tb_workout_plan (id_academy, id_member, created_by, nome, notes)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [id_academy, id_member, created_by, nome, notes || null]
    );
    return r.rows[0];
  },

  async getPlanById(db, id_plan) {
    const r = await db.query(`SELECT * FROM public.tb_workout_plan WHERE id_plan = $1`, [id_plan]);
    return r.rows[0] || null;
  },

  async updatePlan(db, id_plan, { nome, notes, is_active }) {
    const r = await db.query(
      `UPDATE public.tb_workout_plan
          SET nome = COALESCE($2, nome),
              notes = $3,
              is_active = COALESCE($4, is_active),
              updated_at = NOW()
        WHERE id_plan = $1 RETURNING *`,
      [id_plan, nome || null, notes === undefined ? null : notes, is_active === undefined ? null : is_active]
    );
    return r.rows[0] || null;
  },

  async deletePlan(db, id_plan) {
    const r = await db.query(`DELETE FROM public.tb_workout_plan WHERE id_plan = $1`, [id_plan]);
    return r.rowCount > 0;
  },

  async replacePlanExercises(db, id_plan, exercises) {
    await db.query(`DELETE FROM public.tb_workout_plan_exercise WHERE id_plan = $1`, [id_plan]);
    let position = 0;
    for (const ex of exercises) {
      await db.query(
        `INSERT INTO public.tb_workout_plan_exercise
           (id_plan, id_exercise, sets, reps, load_kg, rest_seconds, position)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id_plan, ex.id_exercise, ex.sets, ex.reps, ex.load_kg || null, ex.rest_seconds || null, position++]
      );
    }
  },

  async listPlansForMember(db, id_member, { onlyActive = false } = {}) {
    const r = await db.query(
      `SELECT p.*,
              (SELECT COUNT(*)::int FROM public.tb_workout_plan_exercise pe WHERE pe.id_plan = p.id_plan) AS exercise_count
         FROM public.tb_workout_plan p
        WHERE p.id_member = $1 ${onlyActive ? "AND p.is_active = TRUE" : ""}
        ORDER BY p.created_at ASC`,
      [id_member]
    );
    return r.rows;
  },

  async listPlanExercises(db, id_plan) {
    const r = await db.query(
      `SELECT pe.*, e.nome AS exercise_nome, e.muscle_group
         FROM public.tb_workout_plan_exercise pe
         JOIN public.tb_exercise e ON e.id_exercise = pe.id_exercise
        WHERE pe.id_plan = $1
        ORDER BY pe.position ASC`,
      [id_plan]
    );
    return r.rows;
  },

  // ─── Sessões + checks ──────────────────────────────────────────────────────
  async getOrCreateSession(db, id_plan, id_member, session_date) {
    const r = await db.query(
      `INSERT INTO public.tb_workout_session (id_plan, id_member, session_date)
       VALUES ($1,$2,$3)
       ON CONFLICT (id_plan, session_date) DO UPDATE SET id_member = EXCLUDED.id_member
       RETURNING *`,
      [id_plan, id_member, session_date]
    );
    return r.rows[0];
  },

  async getSession(db, id_plan, session_date) {
    const r = await db.query(
      `SELECT * FROM public.tb_workout_session WHERE id_plan = $1 AND session_date = $2`,
      [id_plan, session_date]
    );
    return r.rows[0] || null;
  },

  async listChecks(db, id_session) {
    const r = await db.query(
      `SELECT id_plan_exercise FROM public.tb_workout_check WHERE id_session = $1`,
      [id_session]
    );
    return r.rows.map((row) => row.id_plan_exercise);
  },

  async addCheck(db, id_session, id_plan_exercise) {
    await db.query(
      `INSERT INTO public.tb_workout_check (id_session, id_plan_exercise)
       VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [id_session, id_plan_exercise]
    );
  },

  async removeCheck(db, id_session, id_plan_exercise) {
    await db.query(
      `DELETE FROM public.tb_workout_check WHERE id_session = $1 AND id_plan_exercise = $2`,
      [id_session, id_plan_exercise]
    );
  },

  async setSessionCompleted(db, id_session, completed) {
    await db.query(
      `UPDATE public.tb_workout_session SET completed_at = ${completed ? "NOW()" : "NULL"} WHERE id_session = $1`,
      [id_session]
    );
  },

  async countSessionsCompleted(db, id_member, sinceDate) {
    const r = await db.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_workout_session
        WHERE id_member = $1 AND completed_at IS NOT NULL AND session_date >= $2`,
      [id_member, sinceDate]
    );
    return r.rows[0].n;
  },

  // ─── Grade do professor ────────────────────────────────────────────────────
  // Uma linha por membro da academia com os agregados do dia/período.
  async trainingGrid(db, id_academy, date) {
    const r = await db.query(
      `SELECT m.id_member, m.id_user, m.member_name, m.membership_status,
              u.username, u.nome AS user_nome,
              meas.weight_kg, meas.height_cm, meas.measured_at,
              COALESCE(food.kcal, 0)::float AS kcal_day,
              COALESCE(water.total_ml, 0)::int AS water_ml_day,
              plan.nome AS active_plan_nome,
              plan.created_at AS active_plan_since,
              COALESCE(freq.days, 0)::int AS frequency_days_30d,
              COALESCE(sess.done, 0)::int AS sessions_done_7d
         FROM public.tb_academy_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
         LEFT JOIN LATERAL (
           SELECT weight_kg, height_cm, measured_at
             FROM public.tb_fitness_measurement fm
            WHERE fm.id_user = m.id_user
            ORDER BY measured_at DESC LIMIT 1
         ) meas ON TRUE
         LEFT JOIN LATERAL (
           SELECT SUM(kcal) AS kcal FROM public.tb_fitness_food_log fl
            WHERE fl.id_user = m.id_user AND fl.log_date = $2::date
         ) food ON TRUE
         LEFT JOIN LATERAL (
           SELECT total_ml FROM public.tb_fitness_water_log wl
            WHERE wl.id_user = m.id_user AND wl.log_date = $2::date
         ) water ON TRUE
         LEFT JOIN LATERAL (
           SELECT nome, created_at FROM public.tb_workout_plan p
            WHERE p.id_member = m.id_member AND p.is_active = TRUE
            ORDER BY created_at ASC LIMIT 1
         ) plan ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(DISTINCT occurred_at::date) AS days
             FROM public.tb_academy_access_event ev
            WHERE ev.id_member = m.id_member
              AND ev.occurred_at >= ($2::date - INTERVAL '30 days')
         ) freq ON TRUE
         LEFT JOIN LATERAL (
           SELECT COUNT(*) AS done FROM public.tb_workout_session s
            WHERE s.id_member = m.id_member AND s.completed_at IS NOT NULL
              AND s.session_date >= ($2::date - INTERVAL '7 days')
         ) sess ON TRUE
        WHERE m.id_academy = $1
        ORDER BY u.nome ASC NULLS LAST`,
      [id_academy, date]
    );
    return r.rows;
  },
};
