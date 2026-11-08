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
    // mig 320 (mm3d-59): destreza e o orçamento de prática do dia
    dexterity: r.dexterity,
    // mig 334 (B7): acurácia (DEFAULT 0)
    accuracy: r.accuracy != null ? r.accuracy : 0,
    budget: r.attr_budget || { days: {} },
    fertility: r.fertility,
    // mig 297: maior valor já alcançado (o piso que não se perde sai dele)
    peaks: r.attr_peaks || { intelligence: r.intelligence, strength: r.strength, speed: r.speed },
    activity: {
      kind: r.activity,
      startedAt: ms(r.activity_started_at),
      until: ms(r.activity_until),
      bed: r.activity_bed,
      resume: r.activity_resume,
      // mig 308: onde treina/estuda (mm3d-37b)
      place: r.activity_place || null,
    },
    effects: r.effects || [],
    meals: r.meals,
    // mig 301: NULL = hóspede de antes — viveu bem cuidado até o último
    // instante simulado (1 dia de vida por dia); exposição começa em zero.
    exposure: r.exposure || { hunger: 0, sleep: 0, stress: 0, health: 0 },
    // mig 311: cartel do boxe (mm3d-43); NULL = nunca lutou
    boxing: r.boxing || null,
    // mig 317: jovem/adulto (mm3d-58); NULL = de antes (normalize completa)
    growth: r.growth || null,
    // mig 324: como estava ao deitar e o que o sono rendeu, até a pessoa ver
    ...(r.sleep_note && r.sleep_note.from ? { sleepFrom: r.sleep_note.from } : {}),
    ...(r.sleep_note && r.sleep_note.woke ? { woke: r.sleep_note.woke } : {}),
    // nascimento (só leitura): a idade do crescimento conta daqui (2026-11-02)
    bornAt: ms(r.born_at),
    // mig 327 (mm3d-72): a alma (personalidade, afeto, gostos, desejo); NULL = nasce pela semente
    soul: r.soul || null,
    wearDays: r.wear_days != null ? r.wear_days : Math.max(0, (ms(r.sim_at) - ms(r.born_at)) / 86400000),
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
  "activity", "activity_started_at", "activity_until", "activity_bed", "activity_resume", "activity_place",
  "effects", "meals", "day_acc", "status", "died_at", "death_cause", "sim_at",
  "wear_days", "exposure", "boxing", "growth",
  "dexterity", "attr_budget", "sleep_note", "soul",
  "accuracy",
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
    a.place || null,
    JSON.stringify(s.effects), JSON.stringify(s.meals), JSON.stringify(s.dayAcc),
    s.status, iso(s.diedAt), s.deathCause, iso(s.simAt),
    s.wearDays, JSON.stringify(s.exposure),
    s.boxing ? JSON.stringify(s.boxing) : null,
    s.growth ? JSON.stringify(s.growth) : null,
    s.dexterity, JSON.stringify(s.budget || { days: {} }),
    s.sleepFrom || s.woke ? JSON.stringify({ from: s.sleepFrom || null, woke: s.woke || null }) : null,
    s.soul ? JSON.stringify(s.soul) : null,
    s.accuracy || 0,
  ];
}

class MeuMundoLifeStorage {
  /** Apelido que a pessoa escolheu para si no jogo (mig 327); null = ainda não escolheu. */
  static async nickname(db, idUser) {
    const r = await db.query(`SELECT nickname FROM tb_mm_player WHERE id_user = $1`, [idUser]);
    return r.rows[0] ? r.rows[0].nickname : null;
  }

  static async setNickname(db, idUser, nickname) {
    await db.query(
      `INSERT INTO tb_mm_player (id_user, nickname) VALUES ($1, $2)
       ON CONFLICT (id_user) DO UPDATE SET nickname = EXCLUDED.nickname, updated_at = NOW()`,
      [idUser, nickname]
    );
  }

  /**
   * O personagem ATIVO do usuário, travado (B3): o vivo; sem vivo, o último morto
   * (tela de morte → novo hóspede). Os da cápsula e os fundidos não entram.
   */
  static async lockLatest(c, idUser) {
    const r = await c.query(
      `SELECT * FROM tb_mm_character
        WHERE id_user = $1 AND status IN ('alive', 'dead')
        ORDER BY (status = 'alive') DESC, generation DESC LIMIT 1 FOR UPDATE`,
      [idUser]
    );
    return r.rows[0] || null;
  }

  /** Próximo número de personagem da conta (generation é único por pessoa). */
  static async nextGeneration(c, idUser) {
    const r = await c.query(`SELECT COALESCE(MAX(generation), 0) + 1 AS n FROM tb_mm_character WHERE id_user = $1`, [idUser]);
    return Number(r.rows[0].n);
  }

  /**
   * Personagem novo. `meta` (B3): espécie, sexo, linhagem, pais, origem e genética de
   * nascença; o status vem do estado ('alive' ou 'capsule'). Abre o histórico de dono.
   */
  static async insert(c, idUser, generation, s, meta = {}) {
    const cols = [
      "id_user", "generation", "seed", "personality", "height_m", "born_at",
      "species", "sex", "lineage_gen", "parent_a", "parent_b", "origin", "genetics", "frozen_at",
      ...COLS,
    ];
    const vals = [
      idUser, generation, s.seed, JSON.stringify(s.personality), s.heightM, iso(s.simAt),
      meta.species || null, meta.sex || null, meta.lineageGen || 1, meta.parentA || null, meta.parentB || null,
      meta.origin || "hospede", meta.genetics ? JSON.stringify(meta.genetics) : null,
      s.status === "capsule" ? iso(s.simAt) : null,
      ...values(s),
    ];
    const r = await c.query(
      `INSERT INTO tb_mm_character (${cols.join(", ")})
       VALUES (${cols.map((_, i) => `$${i + 1}`).join(", ")})
       RETURNING *`,
      vals
    );
    const row = r.rows[0];
    await c.query(
      `INSERT INTO tb_mm_character_owner (id_character, id_user, since, reason) VALUES ($1, $2, $3, $4)`,
      [row.id_character, idUser, iso(s.simAt), meta.ownerReason || "origin"]
    );
    return row;
  }

  // ═══ PERSONAGENS E CÁPSULA (B3, mig 340) ═══

  /** Um personagem da pessoa, travado (qualquer status). */
  static async lockCharacter(c, idUser, idCharacter) {
    const r = await c.query(`SELECT * FROM tb_mm_character WHERE id_character = $1 AND id_user = $2 FOR UPDATE`, [
      idCharacter,
      idUser,
    ]);
    return r.rows[0] || null;
  }

  /** Quantos estão na cápsula. */
  static async capsuleCount(c, idUser) {
    const r = await c.query(`SELECT COUNT(*)::int AS n FROM tb_mm_character WHERE id_user = $1 AND status = 'capsule'`, [idUser]);
    return r.rows[0].n;
  }

  /** Os personagens da pessoa que existem (ativo + cápsula), o ativo primeiro. */
  static async listMine(db, idUser) {
    const r = await db.query(
      `SELECT * FROM tb_mm_character
        WHERE id_user = $1 AND status IN ('alive', 'capsule', 'dead')
        ORDER BY (status = 'alive') DESC, (status = 'capsule') DESC, generation DESC`,
      [idUser]
    );
    return r.rows;
  }

  /** Guardado na cápsula / tirado dela (o resto do estado vai pelo save). */
  static async markFrozen(c, idCharacter, at) {
    await c.query(`UPDATE tb_mm_character SET frozen_at = $2 WHERE id_character = $1`, [idCharacter, iso(at)]);
  }

  static async markThawed(c, idCharacter) {
    await c.query(`UPDATE tb_mm_character SET frozen_at = NULL WHERE id_character = $1`, [idCharacter]);
  }

  static async markFused(c, idCharacter, into, at) {
    await c.query(`UPDATE tb_mm_character SET fused_at = $3, fused_into = $2, frozen_at = NULL WHERE id_character = $1`, [
      idCharacter,
      into,
      iso(at),
    ]);
  }

  /** Espécie e sexo de quem ainda não tinha (escolheu a classe depois). */
  static async fillSpecies(c, idUser, species, sex) {
    await c.query(`UPDATE tb_mm_character SET species = $2, sex = $3 WHERE id_user = $1 AND species IS NULL`, [idUser, species, sex]);
  }

  /** Personagem a entregar (conversão de skin, prêmio, presente). Idempotente pela referência. */
  static async addGrant(c, idUser, { species, sex, source, ref }) {
    const r = await c.query(
      `INSERT INTO tb_mm_character_grant (id_user, species, sex, source, ref) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id_user, source, ref) DO NOTHING RETURNING id_grant`,
      [idUser, species, sex, source, ref]
    );
    return r.rows[0] ? r.rows[0].id_grant : null;
  }

  /** Entregas pendentes, travadas (quem chama já serializou a pessoa). */
  static async openGrants(c, idUser) {
    const r = await c.query(
      `SELECT * FROM tb_mm_character_grant WHERE id_user = $1 AND claimed_at IS NULL ORDER BY created_at, id_grant FOR UPDATE`,
      [idUser]
    );
    return r.rows;
  }

  static async claimGrant(c, idGrant, idCharacter) {
    await c.query(`UPDATE tb_mm_character_grant SET claimed_at = NOW(), id_character = $2 WHERE id_grant = $1`, [idGrant, idCharacter]);
  }

  /** Certificado público: o personagem pelo código, sem dados do dono além do apelido do jogo. */
  static async certificate(db, code) {
    const r = await db.query(
      `SELECT ch.*, pl.nickname
         FROM tb_mm_character ch
         LEFT JOIN tb_mm_player pl ON pl.id_user = ch.id_user
        WHERE ch.cert_code = $1`,
      [code]
    );
    return r.rows[0] || null;
  }

  /** Linhas de personagens por id (pais e avós do certificado). */
  static async byIds(db, ids) {
    const list = [...new Set(ids.filter(Boolean))];
    if (!list.length) return [];
    const r = await db.query(`SELECT * FROM tb_mm_character WHERE id_character = ANY($1::uuid[])`, [list]);
    return r.rows;
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

  /**
   * A7 (mig 332): as moedas do jogo são a Esmeralda da Freelandoo. Esta linha
   * trava a pessoa e guarda só a FRAÇÃO (< 1) que o trabalho rende por hora.
   * `fresh` = jogador novo (a vida credita as moedas de início); `migrated`
   * false = linha antiga que ainda tem moedas inteiras para passar.
   */
  static async lockWallet(c, idUser) {
    const ins = await c.query(
      `INSERT INTO tb_mm_wallet (id_user, coins, emerald_migrated_at) VALUES ($1, 0, NOW())
       ON CONFLICT (id_user) DO NOTHING RETURNING 1`,
      [idUser]
    );
    const r = await c.query(`SELECT coins, emerald_migrated_at FROM tb_mm_wallet WHERE id_user = $1 FOR UPDATE`, [idUser]);
    return { coins: Number(r.rows[0].coins) || 0, fresh: ins.rowCount > 0, migrated: !!r.rows[0].emerald_migrated_at };
  }

  /** Guarda a fração (< 1) que sobrou; o inteiro já foi para a Esmeralda. */
  static async setCoins(c, idUser, coins) {
    await c.query(
      `UPDATE tb_mm_wallet SET coins = $2, emerald_migrated_at = COALESCE(emerald_migrated_at, NOW()), updated_at = NOW() WHERE id_user = $1`,
      [idUser, coins]
    );
  }

  // ═══ GELADEIRA (mig 301) ═══ — estoque por pessoa; quem chama já travou a carteira.

  /** Estoque { itemId: qtd } (só o que tem). */
  static async pantry(c, idUser) {
    const r = await c.query(`SELECT item_id, qty FROM tb_mm_pantry WHERE id_user = $1 AND qty > 0`, [idUser]);
    return Object.fromEntries(r.rows.map((x) => [x.item_id, x.qty]));
  }

  /** Grava as quantidades que mudaram (`next` inteiro × `prev`). */
  static async savePantry(c, idUser, prev, next) {
    for (const [id, qty] of Object.entries(next)) {
      if ((prev[id] || 0) === qty) continue;
      await c.query(
        `INSERT INTO tb_mm_pantry (id_user, item_id, qty) VALUES ($1, $2, $3)
         ON CONFLICT (id_user, item_id) DO UPDATE SET qty = EXCLUDED.qty, updated_at = NOW()`,
        [idUser, id, qty]
      );
    }
  }

  /** Kit inicial: devolve true só na primeira vez (marca na carteira). */
  static async claimPantrySeed(c, idUser) {
    const r = await c.query(
      `UPDATE tb_mm_wallet SET pantry_seeded_at = NOW() WHERE id_user = $1 AND pantry_seeded_at IS NULL RETURNING 1`,
      [idUser]
    );
    return r.rowCount > 0;
  }

  /** Resultado gravado de um consumo com esta chave (ou null). */
  static async consumeKey(c, idUser, key) {
    const r = await c.query(`SELECT result FROM tb_mm_consume_key WHERE id_user = $1 AND key = $2`, [idUser, key]);
    return r.rows[0] ? r.rows[0].result : null;
  }

  static async saveConsumeKey(c, idUser, key, result) {
    await c.query(
      `INSERT INTO tb_mm_consume_key (id_user, key, result) VALUES ($1, $2, $3) ON CONFLICT (id_user, key) DO NOTHING`,
      [idUser, key, JSON.stringify(result)]
    );
    // Limpeza preguiçosa das chaves velhas desta pessoa.
    await c.query(`DELETE FROM tb_mm_consume_key WHERE id_user = $1 AND created_at < NOW() - INTERVAL '2 days'`, [idUser]);
  }
}

module.exports = MeuMundoLifeStorage;
module.exports.rowToState = rowToState;
