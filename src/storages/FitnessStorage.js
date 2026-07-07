// src/storages/FitnessStorage.js
// Persistência do diário fitness (mig 177): alimentos, refeições, água,
// medidas corporais e metas pessoais.
module.exports = {
  // ─── Alimentos ─────────────────────────────────────────────────────────────
  async searchFoods(db, q, limit = 20) {
    const r = await db.query(
      `SELECT id_food, source, nome, kcal_100g, protein_g, carbs_g, fat_g
         FROM public.tb_food
        WHERE nome ILIKE $1
        ORDER BY (source = 'taco') DESC, nome ASC
        LIMIT $2`,
      [`%${q}%`, limit]
    );
    return r.rows;
  },

  async getFoodById(db, id_food) {
    const r = await db.query(`SELECT * FROM public.tb_food WHERE id_food = $1`, [id_food]);
    return r.rows[0] || null;
  },

  async upsertOffFood(db, { external_ref, nome, kcal_100g, protein_g, carbs_g, fat_g }) {
    const r = await db.query(
      `INSERT INTO public.tb_food (source, external_ref, nome, kcal_100g, protein_g, carbs_g, fat_g)
       VALUES ('off', $1, $2, $3, $4, $5, $6)
       ON CONFLICT (source, external_ref) WHERE external_ref IS NOT NULL
       DO UPDATE SET nome = EXCLUDED.nome
       RETURNING *`,
      [external_ref, nome, kcal_100g, protein_g, carbs_g, fat_g]
    );
    return r.rows[0];
  },

  async createCustomFood(db, id_user, { nome, kcal_100g, protein_g, carbs_g, fat_g }) {
    const r = await db.query(
      `INSERT INTO public.tb_food (source, nome, kcal_100g, protein_g, carbs_g, fat_g, created_by)
       VALUES ('custom', $1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [nome, kcal_100g, protein_g || 0, carbs_g || 0, fat_g || 0, id_user]
    );
    return r.rows[0];
  },

  // ─── Diário de refeições ───────────────────────────────────────────────────
  async addFoodLog(db, entry) {
    const r = await db.query(
      `INSERT INTO public.tb_fitness_food_log
         (id_user, log_date, meal, id_food, quantity_g, kcal, protein_g, carbs_g, fat_g)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [entry.id_user, entry.log_date, entry.meal, entry.id_food, entry.quantity_g, entry.kcal, entry.protein_g, entry.carbs_g, entry.fat_g]
    );
    return r.rows[0];
  },

  async deleteFoodLog(db, id_user, id_log) {
    const r = await db.query(
      `DELETE FROM public.tb_fitness_food_log WHERE id_log = $1 AND id_user = $2`,
      [id_log, id_user]
    );
    return r.rowCount > 0;
  },

  async listFoodLogs(db, id_user, log_date) {
    const r = await db.query(
      `SELECT fl.*, f.nome AS food_nome, f.source AS food_source
         FROM public.tb_fitness_food_log fl
         JOIN public.tb_food f ON f.id_food = fl.id_food
        WHERE fl.id_user = $1 AND fl.log_date = $2
        ORDER BY fl.created_at ASC`,
      [id_user, log_date]
    );
    return r.rows;
  },

  async dayTotals(db, id_user, log_date) {
    const r = await db.query(
      `SELECT COALESCE(SUM(kcal),0)::float AS kcal,
              COALESCE(SUM(protein_g),0)::float AS protein_g,
              COALESCE(SUM(carbs_g),0)::float AS carbs_g,
              COALESCE(SUM(fat_g),0)::float AS fat_g
         FROM public.tb_fitness_food_log
        WHERE id_user = $1 AND log_date = $2`,
      [id_user, log_date]
    );
    return r.rows[0];
  },

  // ─── Água ──────────────────────────────────────────────────────────────────
  async setWater(db, id_user, log_date, total_ml) {
    const r = await db.query(
      `INSERT INTO public.tb_fitness_water_log (id_user, log_date, total_ml)
       VALUES ($1,$2,$3)
       ON CONFLICT (id_user, log_date) DO UPDATE SET total_ml = EXCLUDED.total_ml, updated_at = NOW()
       RETURNING total_ml`,
      [id_user, log_date, total_ml]
    );
    return r.rows[0].total_ml;
  },

  async getWater(db, id_user, log_date) {
    const r = await db.query(
      `SELECT total_ml FROM public.tb_fitness_water_log WHERE id_user = $1 AND log_date = $2`,
      [id_user, log_date]
    );
    return r.rows[0] ? r.rows[0].total_ml : 0;
  },

  // ─── Medidas ───────────────────────────────────────────────────────────────
  async addMeasurement(db, { id_user, weight_kg, height_cm, recorded_by }) {
    const r = await db.query(
      `INSERT INTO public.tb_fitness_measurement (id_user, weight_kg, height_cm, recorded_by)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [id_user, weight_kg || null, height_cm || null, recorded_by]
    );
    return r.rows[0];
  },

  async listMeasurements(db, id_user, limit = 30) {
    const r = await db.query(
      `SELECT * FROM public.tb_fitness_measurement
        WHERE id_user = $1 ORDER BY measured_at DESC LIMIT $2`,
      [id_user, limit]
    );
    return r.rows;
  },

  async latestMeasurement(db, id_user) {
    const r = await db.query(
      `SELECT * FROM public.tb_fitness_measurement
        WHERE id_user = $1 ORDER BY measured_at DESC LIMIT 1`,
      [id_user]
    );
    return r.rows[0] || null;
  },

  // ─── Metas ─────────────────────────────────────────────────────────────────
  async getSettings(db, id_user) {
    const r = await db.query(`SELECT * FROM public.tb_fitness_settings WHERE id_user = $1`, [id_user]);
    return r.rows[0] || { id_user, daily_kcal_goal: 2000, water_goal_ml: 2000 };
  },

  async setSettings(db, id_user, { daily_kcal_goal, water_goal_ml }) {
    const r = await db.query(
      `INSERT INTO public.tb_fitness_settings (id_user, daily_kcal_goal, water_goal_ml)
       VALUES ($1,$2,$3)
       ON CONFLICT (id_user) DO UPDATE SET
         daily_kcal_goal = EXCLUDED.daily_kcal_goal,
         water_goal_ml = EXCLUDED.water_goal_ml,
         updated_at = NOW()
       RETURNING *`,
      [id_user, daily_kcal_goal, water_goal_ml]
    );
    return r.rows[0];
  },
};
