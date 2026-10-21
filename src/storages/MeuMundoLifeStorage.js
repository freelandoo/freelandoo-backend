// src/storages/MeuMundoLifeStorage.js — MEU MUNDO 3D: vida do hóspede (mig 295).
//
// Só SQL e a conversão linha ↔ estado da regra (src/utils/meuMundoLife.js).
// Quem chama abre a transação e trava (MeuMundoLifeService). As moedas são
// do jogo (ambiente dev): nada aqui toca saldo, Poléns ou Carteira.

const ms = (v) => (v == null ? null : new Date(v).getTime());
const iso = (v) => (v == null ? null : new Date(v).toISOString());

/** Linha do banco → estado da simulação. */
function rowToState(r) {
  return {
    seed: r.seed,
    personality: r.personality,
    heightM: Number(r.height_m),
    energy: r.energy,
    satiety: r.satiety,
    mood: r.mood,
    stress: r.stress,
    health: r.health,
    vitality: r.vitality,
    fatKg: r.fat_kg,
    leanKg: r.lean_kg,
    diabetesRisk: r.diabetes_risk,
    hasDiabetes: r.has_diabetes,
    bpRisk: r.bp_risk,
    hasHypertension: r.has_hypertension,
    toxicity: r.toxicity,
    cardiac: r.cardiac,
    awakeH: r.awake_h,
    zeroEnergyH: r.zero_energy_h,
    diet: r.diet,
    intelligence: r.intelligence,
    strength: r.strength,
    speed: r.speed,
    fertility: r.fertility,
    // mig 297: maior valor já alcançado (o piso que não se perde sai dele)
    peaks: r.attr_peaks || { intelligence: r.intelligence, strength: r.strength, speed: r.speed },
    activity: {
      kind: r.activity,
      startedAt: ms(r.activity_started_at),
      until: ms(r.activity_until),
      bed: r.activity_bed,
      resume: r.activity_resume,
    },
    effects: r.effects || [],
    meals: r.meals,
    dayAcc: r.day_acc,
    status: r.status,
    deathCause: r.death_cause,
    diedAt: ms(r.died_at),
    simAt: ms(r.sim_at),
  };
}

// Colunas gravadas a cada simulação (mesma ordem dos valores de `values`).
const COLS = [
  "energy", "satiety", "mood", "stress", "health", "vitality", "fat_kg", "lean_kg",
  "diabetes_risk", "has_diabetes", "bp_risk", "has_hypertension", "toxicity", "cardiac",
  "awake_h", "zero_energy_h", "diet", "intelligence", "strength", "speed", "fertility", "attr_peaks",
  "activity", "activity_started_at", "activity_until", "activity_bed", "activity_resume",
  "effects", "meals", "day_acc", "status", "died_at", "death_cause", "sim_at",
];

function values(s) {
  const a = s.activity;
  return [
    s.energy, s.satiety, s.mood, s.stress, s.health, s.vitality, s.fatKg, s.leanKg,
    s.diabetesRisk, s.hasDiabetes, s.bpRisk, s.hasHypertension, s.toxicity, s.cardiac,
    s.awakeH, s.zeroEnergyH, s.diet, s.intelligence, s.strength, s.speed, s.fertility, JSON.stringify(s.peaks),
    a.kind, iso(a.startedAt), iso(a.until),
    a.bed ? JSON.stringify(a.bed) : null,
    a.resume ? JSON.stringify(a.resume) : null,
    JSON.stringify(s.effects), JSON.stringify(s.meals), JSON.stringify(s.dayAcc),
    s.status, iso(s.diedAt), s.deathCause, iso(s.simAt),
  ];
}

class MeuMundoLifeStorage {
  /** O hóspede mais recente do usuário (vivo ou morto), travado. */
  static async lockLatest(c, idUser) {
    const r = await c.query(
      `SELECT * FROM tb_mm_character WHERE id_user = $1 ORDER BY generation DESC LIMIT 1 FOR UPDATE`,
      [idUser]
    );
    return r.rows[0] || null;
  }

  static async insert(c, idUser, generation, s) {
    const cols = ["id_user", "generation", "seed", "personality", "height_m", "born_at", ...COLS];
    const vals = [idUser, generation, s.seed, JSON.stringify(s.personality), s.heightM, iso(s.simAt), ...values(s)];
    const r = await c.query(
      `INSERT INTO tb_mm_character (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING *`,
      vals
    );
    return r.rows[0];
  }

  static async save(c, idCharacter, s) {
    const set = COLS.map((k, i) => `${k} = $${i + 2}`).join(", ");
    await c.query(`UPDATE tb_mm_character SET ${set}, updated_at = NOW() WHERE id_character = $1`, [
      idCharacter,
      ...values(s),
    ]);
  }

  /**
   * Cama em que o hóspede vivo está deitado/dormindo (sem simular — a sala
   * confere e levanta quem já acordou). Usado para decidir onde a pessoa entra.
   */
  static async restingBed(db, idUser) {
    const r = await db.query(
      `SELECT activity_bed FROM tb_mm_character
        WHERE id_user = $1 AND status = 'alive' AND activity IN ('lying', 'sleeping') AND activity_bed IS NOT NULL`,
      [idUser]
    );
    const bed = r.rows[0] && r.rows[0].activity_bed;
    return bed && typeof bed.houseId === "string" ? bed : null;
  }

  static async markDeathSeen(c, idCharacter) {
    await c.query(`UPDATE tb_mm_character SET death_seen_at = NOW() WHERE id_character = $1 AND death_seen_at IS NULL`, [
      idCharacter,
    ]);
  }

  /** Grava (ou atualiza) um dia do diário. `closed` = o dia já virou. */
  static async upsertDay(c, idCharacter, d, condition, closed) {
    await c.query(
      `INSERT INTO tb_mm_character_day
         (id_character, day, closed, hours, meals_eaten, meals_missed, healthy_count, junk_count,
          avg_mood, min_health, max_stress, coins_earned, condition_score, condition_label, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       ON CONFLICT (id_character, day) DO UPDATE SET
         closed = EXCLUDED.closed, hours = EXCLUDED.hours, meals_eaten = EXCLUDED.meals_eaten,
         meals_missed = EXCLUDED.meals_missed, healthy_count = EXCLUDED.healthy_count,
         junk_count = EXCLUDED.junk_count, avg_mood = EXCLUDED.avg_mood, min_health = EXCLUDED.min_health,
         max_stress = EXCLUDED.max_stress, coins_earned = EXCLUDED.coins_earned,
         condition_score = EXCLUDED.condition_score, condition_label = EXCLUDED.condition_label,
         updated_at = NOW()`,
      [
        idCharacter,
        d.day,
        closed,
        JSON.stringify(d.hours),
        d.mealsEaten,
        d.mealsMissed,
        d.healthy,
        d.junk,
        d.moodH > 0 ? d.moodSum / d.moodH : null,
        d.minHealth,
        d.maxStress,
        d.coins || 0,
        condition.score,
        condition.label,
      ]
    );
  }

  static async insertEvents(c, idCharacter, events) {
    if (!events.length) return;
    const vals = [];
    const rows = events.map((e, i) => {
      vals.push(idCharacter, iso(e.at), e.kind, JSON.stringify(e.data || {}));
      return `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`;
    });
    await c.query(`INSERT INTO tb_mm_character_event (id_character, at, kind, data) VALUES ${rows.join(", ")}`, vals);
  }

  static async recentEvents(db, idCharacter, limit = 30) {
    const r = await db.query(
      `SELECT at, kind, data FROM tb_mm_character_event WHERE id_character = $1 ORDER BY at DESC, id_event DESC LIMIT $2`,
      [idCharacter, limit]
    );
    return r.rows.map((e) => ({ at: iso(e.at), kind: e.kind, data: e.data }));
  }

  static async recentDays(db, idCharacter, limit = 14) {
    const r = await db.query(
      `SELECT to_char(day, 'YYYY-MM-DD') AS day, closed, hours, meals_eaten, meals_missed, healthy_count,
              junk_count, avg_mood, min_health, max_stress, coins_earned, condition_score, condition_label
         FROM tb_mm_character_day WHERE id_character = $1 ORDER BY day DESC LIMIT $2`,
      [idCharacter, limit]
    );
    return r.rows.map((d) => ({
      day: d.day,
      closed: d.closed,
      hours: d.hours,
      mealsEaten: d.meals_eaten,
      mealsMissed: d.meals_missed,
      healthy: d.healthy_count,
      junk: d.junk_count,
      avgMood: d.avg_mood == null ? null : Math.round(d.avg_mood),
      minHealth: Math.round(d.min_health),
      maxStress: Math.round(d.max_stress),
      coins: Math.round(d.coins_earned),
      condition: { score: d.condition_score, label: d.condition_label },
    }));
  }

  /** Carteira do jogo, criada com o saldo inicial na primeira vez, travada. */
  static async lockWallet(c, idUser, startCoins) {
    await c.query(`INSERT INTO tb_mm_wallet (id_user, coins) VALUES ($1, $2) ON CONFLICT (id_user) DO NOTHING`, [
      idUser,
      startCoins,
    ]);
    const r = await c.query(`SELECT coins FROM tb_mm_wallet WHERE id_user = $1 FOR UPDATE`, [idUser]);
    return r.rows[0].coins;
  }

  static async setCoins(c, idUser, coins) {
    await c.query(`UPDATE tb_mm_wallet SET coins = $2, updated_at = NOW() WHERE id_user = $1`, [idUser, coins]);
  }
}

module.exports = MeuMundoLifeStorage;
module.exports.rowToState = rowToState;
