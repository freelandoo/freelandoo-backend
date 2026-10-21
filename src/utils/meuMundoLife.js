// src/utils/meuMundoLife.js
//
// MEU MUNDO 3D — a VIDA do hóspede (mm3d-13). Fonte única das regras.
//
// ═══ COMO FUNCIONA ═══
// Simulação PREGUIÇOSA e DETERMINÍSTICA: nada roda em segundo plano. Quem lê
// ou age (MeuMundoLifeService) trava a linha do hóspede, chama
// `simulate(state, agora)` — que avança do `simAt` gravado até agora em
// passos de no máximo 15 min, quebrando exatamente nos limites (fim da
// atividade, fim de efeito, fim de janela de refeição, meia-noite) — aplica
// a ação e grava. Simular 10 h de uma vez dá o MESMO resultado que simular
// 10 vezes 1 h (o teste confere). Por isso deixar o personagem estudando e
// fechar o jogo funciona: ao voltar, as horas são contadas.
//
// ═══ RELÓGIO ═══
// O relógio do jogo é o de Brasília (UTC−3 fixo — o Brasil não tem horário
// de verão desde 2019), igual para todo mundo; 1 h de jogo = 1 h real.
// Refeições: janelas de 2 h que abrem às 10, 14, 18 e 22 h.
//
// ═══ UNIDADES ═══
// Vitais e fertilidade 0–100; inteligência, força e velocidade 0–1000 (ATTR). Taxas "por hora". Tempo em ms (epoch) nas
// fronteiras e em horas (dt) dentro do passo. Massa em kg, energia da comida
// em kcal. As regras por extenso estão no plano
// (MEU MUNDO 3D/planos/2026-10-20-mm3d-13-vida-do-hospede.md) e no REGISTRO.

const HOUR = 3600 * 1000;
const STEP_MS = 15 * 60 * 1000;
const MAX_CATCHUP_MS = 60 * 24 * HOUR; // além disso, o tempo passa sem simular

const CLOCK = Object.freeze({
  OFFSET_MIN: -180, // America/Sao_Paulo
  MEALS: [10, 14, 18, 22],
  MEAL_WINDOW_H: 2,
});

const ACTIVITIES = Object.freeze(["idle", "lying", "sleeping", "studying", "training", "working", "hospital"]);
// Horas que o jogador pode marcar em cada atividade (deitar sem hora = até levantar).
const ACTIVITY_HOURS = Object.freeze({
  studying: [1, 72],
  training: [1, 72],
  working: [1, 72],
  sleeping: [1, 16],
  lying: [1, 24],
});

// Por hora: energia, saciedade, estresse e o multiplicador do gasto calórico.
const RATES = Object.freeze({
  idle: { energy: -4.5, satiety: -6.5, stress: -1, kcal: 1.3 },
  lying: { energy: 3, satiety: -5, stress: -4, kcal: 1.0 },
  sleeping: { energy: 12, satiety: -3, stress: -3.5, kcal: 0.9 },
  studying: { energy: -7, satiety: -6.5, stress: 2.2, kcal: 1.4 },
  training: { energy: -11, satiety: -10, stress: -2.5, kcal: 6.0 },
  working: { energy: -6.5, satiety: -7, stress: 3, kcal: 1.6 },
  hospital: { energy: 6, satiety: 0, stress: -2, kcal: 1.0 },
});

const RULES = Object.freeze({
  BASE_KCAL_H: 70,
  // Na vida real 1 kg de gordura ≈ 7.700 kcal; no jogo o corpo responde 2×
  // mais rápido (uma semana de porcaria tem que aparecer).
  KCAL_PER_KG: 3850,
  FULL_SATIETY: 92, // acima disso a comida é recusada ("está cheio")
  COLLAPSE_AFTER_H: 6, // horas com energia zerada (sem estimulante) até desmaiar
  COLLAPSE_SLEEP_H: 8,
  HOSPITAL_AT: 15, // saúde
  DISCHARGE_AT: 60,
  DISCHARGE_MAX_TOX: 20,
  ADMIT_SEQUEL: 8, // vitalidade perdida por internação
  INFARCT_SEQUEL: 20,
  INFARCT_DAMAGE: 55,
  FATAL_VITALITY: 20, // internado com vitalidade ≤ isto não resiste
  START_COINS: 500,
  WORK_COINS_H: 14,
  MEAL_MISSED: { mood: -6, stress: 4 },
});

// ═══ ATRIBUTOS (0–1000) ═══ — progressão longa (pedido do Alex, 2026-10-20):
// com o ritmo máximo de todo dia, 800 leva ~1 ano e 900 ~2 anos.
//  • Ganho por hora ÚTIL = base × (1 − v/CURVE_AT)² × multiplicadores.
//  • Só as primeiras USEFUL_H horas do dia rendem (o músculo/a cabeça precisa
//    recuperar); passando disso, OVER_FACTOR.
//  • Permanência: cada atributo guarda o maior valor já alcançado (`peaks`) e
//    nunca cai abaixo de FLOOR × pico; abaixo do pico ganha REGAIN× (memória).
//  • O hóspede nasce na casa das dezenas (15–35) — mig 298.
const ATTR = Object.freeze({
  MAX: 1000,
  CURVE_AT: 1100,
  GAIN_H: { studyInt: 1.6, trainStr: 2.0, trainSpd: 1.4, workInt: 0.2 },
  USEFUL_H: { studying: 5, training: 4 },
  OVER_FACTOR: 0.05,
  REGAIN: 2,
  FLOOR: { intelligence: 0.9, strength: 0.6, speed: 0.6 },
  DECAY_DAY: { intelligence: 0.3, strength: 1, speed: 1 },
});
const TRAINED = Object.freeze(["intelligence", "strength", "speed"]);

// ═══ ROTINA ═══ — estudar/treinar/trabalhar por horas não é maratona: o
// hóspede dorme quando a energia acaba, descansa quando o estresse estoura e
// come nas janelas (comprando com as moedas do jogo), depois volta à tarefa.
const ROUTINE = Object.freeze({
  KINDS: ["studying", "training", "working"],
  SLEEP_AT_ENERGY: 12,
  SLEEP_H: 8,
  REST_AT_STRESS: 80,
  REST_H: 3,
  MIN_LEFT_H: 1, // com menos que isso sobrando, ele só termina
  // Bateu as horas úteis do dia (estudo/treino): descansa deitado até a hora
  // de dormir, dorme e retoma de manhã.
  BED_AT: 23,
  WAKE_AT: 7,
  MEALS: ["prato_integral", "prato_feito", "miojo"], // o melhor que a carteira paga
});

// Ritmo de caminhada pelo estado do corpo (a sala aplica; o cliente espelha
// em engine/motion.ts — paceSpeeds).
const PACE = Object.freeze({ NORMAL: 1, TIRED: 0.7, EXHAUSTED: 0.42 });

// ═══ CATÁLOGO ═══ — preços em moedas do jogo (não é Polén nem saldo).
// Saudável é caro, porcaria é barata (pedido do Alex).
// kcal, sat (saciedade), sugar/sodium 0–10, nutri −10…+10 (qualidade),
// protein (g), mood (prazer por 2 h), energy/stress instantâneos, tox
// (toxicidade), effect = [id, horas].
const I = (id, kind, name, price, o = {}) =>
  Object.freeze({ id, kind, name, price, kcal: 0, sat: 0, sugar: 0, sodium: 0, nutri: 0, protein: 0, mood: 0, energy: 0, stress: 0, tox: 0, effect: null, ...o });

const ITEMS = Object.freeze([
  // Comida saudável (cara)
  I("salmao_legumes", "food", "Salmão grelhado com legumes", 58, { kcal: 520, sat: 45, sodium: 3, nutri: 10, protein: 38, mood: 6 }),
  I("frango_salada", "food", "Frango grelhado com salada", 42, { kcal: 430, sat: 40, sodium: 3, nutri: 9, protein: 40, mood: 4 }),
  I("prato_integral", "food", "Arroz integral, feijão, ovo e salada", 34, { kcal: 560, sat: 48, sodium: 3, nutri: 8, protein: 24, mood: 4 }),
  I("bowl_frutas", "food", "Bowl de frutas", 28, { kcal: 260, sat: 22, sugar: 4, nutri: 7, protein: 3, mood: 6 }),
  I("omelete_legumes", "food", "Omelete de legumes", 26, { kcal: 330, sat: 30, sodium: 3, nutri: 7, protein: 22, mood: 3 }),
  I("iogurte_aveia", "food", "Iogurte natural com aveia", 24, { kcal: 280, sat: 25, sugar: 2, nutri: 7, protein: 14, mood: 3 }),
  I("sopa_legumes", "food", "Sopa de legumes", 22, { kcal: 220, sat: 28, sodium: 4, nutri: 7, protein: 8, mood: 3 }),
  I("agua_coco", "drink", "Água de coco", 12, { kcal: 60, sat: 4, sugar: 2, nutri: 4, energy: 3 }),
  // Comida do dia a dia
  I("prato_feito", "food", "Prato feito (arroz, feijão, bife e fritas)", 18, { kcal: 850, sat: 50, sodium: 6, nutri: 1, protein: 32, mood: 7 }),
  // Porcaria (barata)
  I("hamburguer", "food", "Hambúrguer com fritas", 12, { kcal: 1100, sat: 45, sugar: 3, sodium: 8, nutri: -7, protein: 28, mood: 12 }),
  I("pizza", "food", "Pizza (3 fatias)", 10, { kcal: 900, sat: 40, sugar: 2, sodium: 8, nutri: -6, protein: 30, mood: 12 }),
  I("cachorro_quente", "food", "Cachorro-quente", 8, { kcal: 620, sat: 32, sugar: 2, sodium: 8, nutri: -6, protein: 16, mood: 9 }),
  I("coxinha", "food", "Coxinha", 5, { kcal: 380, sat: 20, sodium: 6, nutri: -6, protein: 9, mood: 8 }),
  I("chocolate", "food", "Barra de chocolate", 5, { kcal: 540, sat: 12, sugar: 9, nutri: -6, protein: 5, mood: 14 }),
  I("miojo", "food", "Miojo", 4, { kcal: 380, sat: 22, sodium: 10, nutri: -7, protein: 7, mood: 5 }),
  I("salgadinho", "food", "Salgadinho de pacote", 4, { kcal: 450, sat: 12, sodium: 9, nutri: -8, protein: 5, mood: 9 }),
  I("biscoito_recheado", "food", "Biscoito recheado", 3, { kcal: 480, sat: 12, sugar: 9, nutri: -8, protein: 4, mood: 10 }),
  I("refrigerante", "drink", "Refrigerante (lata)", 3, { kcal: 150, sat: 3, sugar: 10, nutri: -7, mood: 7, energy: 2 }),
  // Suplementos
  I("albumina", "supplement", "Albumina", 15, { kcal: 110, sat: 6, nutri: 3, protein: 25, effect: ["albumin", 4] }),
  I("whey", "supplement", "Whey protein", 45, { kcal: 130, sat: 8, sugar: 1, nutri: 4, protein: 25, effect: ["whey", 4] }),
  I("pre_treino", "supplement", "Pré-treino", 30, { energy: 15, tox: 5, effect: ["preworkout", 3] }),
  I("creatina", "supplement", "Creatina", 35, { nutri: 1, effect: ["creatine", 24] }),
  I("multivitaminico", "supplement", "Multivitamínico", 25, { nutri: 2, effect: ["multivit", 24] }),
  // Remédios
  I("metformina", "medicine", "Metformina (diabetes)", 20, { effect: ["metformin", 24] }),
  I("losartana", "medicine", "Losartana (pressão)", 18, { effect: ["losartan", 24] }),
  I("calmante", "medicine", "Calmante", 25, { stress: -30, energy: -10, tox: 3, effect: ["calm", 8] }),
  // Estimulantes (para não dormir)
  I("cafe", "stimulant", "Café", 2, { kcal: 5, energy: 8, tox: 1, effect: ["coffee", 2] }),
  I("energetico", "stimulant", "Energético", 6, { kcal: 110, sugar: 7, energy: 15, tox: 4, mood: 4, effect: ["energy_drink", 3] }),
  I("estimulante", "stimulant", "Estimulante (cápsula)", 40, { energy: 35, tox: 22, stress: 5, effect: ["stim", 8] }),
  // Anabolizante
  I("anabolizante", "anabolic", "Anabolizante injetável", 120, { tox: 15, mood: 4, effect: ["anabolic", 7 * 24] }),
]);
const ITEM_BY_ID = new Map(ITEMS.map((it) => [it.id, it]));

// ═══ UTILIDADES ═══
const clamp = (v, lo = 0, hi = 100) => (v < lo ? lo : v > hi ? hi : v);
const r2 = (v) => Math.round(v * 100) / 100;

/** PRNG determinístico (mulberry32) — personalidade sai da semente. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Partes do relógio do jogo: dia (AAAA-MM-DD) e hora local (fracionária). */
function localParts(ms) {
  const d = new Date(ms + CLOCK.OFFSET_MIN * 60000);
  const day = d.toISOString().slice(0, 10);
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600 + d.getUTCMilliseconds() / 3.6e6;
  return { day, hour };
}

/** Epoch da hora local `h` (0–24) do dia de `ms`. */
function atLocalHour(ms, h) {
  const off = CLOCK.OFFSET_MIN * 60000;
  const local = ms + off;
  const midnight = local - (((local % (24 * HOUR)) + 24 * HOUR) % (24 * HOUR));
  return midnight + h * HOUR - off;
}

/** Próximo instante > ms em que uma janela de refeição FECHA (12, 16, 20, 24 h). */
function nextWindowClose(ms) {
  for (const start of CLOCK.MEALS) {
    const close = atLocalHour(ms, start + CLOCK.MEAL_WINDOW_H);
    if (close > ms) return close;
  }
  return atLocalHour(ms + 24 * HOUR, CLOCK.MEALS[0] + CLOCK.MEAL_WINDOW_H);
}

/** Índice da janela de refeição aberta em `ms` (−1 = nenhuma). */
function mealWindowAt(ms) {
  const { hour } = localParts(ms);
  return CLOCK.MEALS.findIndex((h) => hour >= h && hour < h + CLOCK.MEAL_WINDOW_H);
}

const effectOn = (s, id, t) => s.effects.some((e) => e.id === id && e.until > t);

const fatPct = (s) => (100 * s.fatKg) / (s.fatKg + s.leanKg);
const weightKg = (s) => s.fatKg + s.leanKg;

function emptyDay(day) {
  return {
    day,
    hours: { idle: 0, lying: 0, sleeping: 0, studying: 0, training: 0, working: 0, hospital: 0 },
    mealsEaten: 0,
    mealsMissed: 0,
    healthy: 0,
    junk: 0,
    moodSum: 0,
    moodH: 0,
    minHealth: 100,
    maxStress: 0,
    coins: 0,
  };
}

// ═══ NASCIMENTO ═══
/** Um hóspede novo. `seed` inteiro (o serviço sorteia). */
function birth(seed, t) {
  const r = rng(seed);
  const p = {
    discipline: r2(r()),
    anxiety: r2(r()),
    optimism: r2(r()),
    appetite: r2(r()),
    resilience: r2(r()),
    metabolism: r2(r()),
  };
  const heightM = r2(1.68 + r() * 0.18);
  const leanKg = r2(22 * heightM * heightM * (0.8 + r() * 0.08)); // ~50–60 kg
  const fatKg = r2(leanKg * (0.17 + r() * 0.1));
  const s = {
    seed,
    personality: p,
    heightM,
    energy: 80,
    satiety: 60,
    mood: 65,
    stress: 20,
    health: 90,
    vitality: 100,
    fatKg,
    leanKg,
    diabetesRisk: r2(r() * 10),
    hasDiabetes: false,
    bpRisk: r2(r() * 10),
    hasHypertension: false,
    toxicity: 0,
    cardiac: 0,
    awakeH: 2,
    zeroEnergyH: 0,
    diet: 0,
    // Começa fraco na escala 0–1000 (decisão do Alex): o caminho é que é longo.
    intelligence: r2(15 + r() * 15),
    strength: r2(15 + r() * 15),
    speed: r2(20 + r() * 15),
    fertility: r2(70 + r() * 20),
    activity: { kind: "idle", startedAt: t, until: null, bed: null, resume: null },
    effects: [],
    peaks: null, // preenchido logo abaixo (maior valor já alcançado)
    meals: { day: localParts(t).day, eaten: [false, false, false, false] },
    dayAcc: emptyDay(localParts(t).day),
    status: "alive",
    deathCause: null,
    diedAt: null,
    simAt: t,
  };
  s.peaks = { intelligence: s.intelligence, strength: s.strength, speed: s.speed };
  return s;
}

// ═══ ATRIBUTOS ═══
const attrFloor = (s, k) => ATTR.FLOOR[k] * s.peaks[k];

/** Horas do passo que ainda rendem hoje (as primeiras USEFUL_H do dia). */
function usefulHours(s, kind, dt) {
  const cap = ATTR.USEFUL_H[kind];
  if (!cap) return dt;
  const done = s.dayAcc.hours[kind] || 0;
  const full = Math.max(0, Math.min(dt, cap - done));
  return full + (dt - full) * ATTR.OVER_FACTOR;
}

/** Soma `base` pontos já escalados pela curva; abaixo do pico, REGAIN×. */
function gain(s, k, base) {
  if (base <= 0) return;
  const v = s[k];
  const curve = Math.pow(Math.max(0, 1 - v / ATTR.CURVE_AT), 2);
  const regain = v < s.peaks[k] - 0.5 ? ATTR.REGAIN : 1;
  s[k] = clamp(v + base * curve * regain, 0, ATTR.MAX);
  if (s[k] > s.peaks[k]) s.peaks[k] = s[k];
}

function decay(s, k, dt) {
  const floor = attrFloor(s, k);
  if (s[k] <= floor) return;
  s[k] = Math.max(floor, s[k] - (ATTR.DECAY_DAY[k] / 24) * dt);
}

// ═══ UM PASSO ═══
function admit(s, t, events, reason) {
  s.vitality = clamp(s.vitality - RULES.ADMIT_SEQUEL);
  if (s.vitality <= RULES.FATAL_VITALITY) return die(s, t, events, "complicacoes");
  s.activity = { kind: "hospital", startedAt: t, until: null, bed: null, resume: null };
  events.push({ at: t, kind: "hospital_in", data: { reason, health: r2(s.health) } });
}

function die(s, t, events, cause) {
  s.status = "dead";
  s.health = 0;
  s.deathCause = cause;
  s.diedAt = t;
  s.activity = { kind: "idle", startedAt: t, until: null, bed: null, resume: null };
  events.push({ at: t, kind: "death", data: { cause } });
}

function stepState(s, t, dt, events, out) {
  const p = s.personality;
  const kind = s.activity.kind;
  const stim = effectOn(s, "stim", t);
  const hospital = kind === "hospital";
  // Com estimulante não se dorme: fica deitado de olhos abertos.
  const eff = kind === "sleeping" && stim ? "lying" : kind;
  const rate = RATES[eff];
  const resting = eff === "sleeping" || eff === "lying" || hospital;
  const diabetesOpen = s.hasDiabetes && !hospital && !effectOn(s, "metformin", t);
  const hyperOpen = s.hasHypertension && !hospital && !effectOn(s, "losartan", t);
  const fp = fatPct(s);

  // Energia
  let de = rate.energy;
  if (de < 0) {
    de *= 1.1 - 0.2 * p.resilience;
    if (stim) de *= 0.5;
    else if (effectOn(s, "energy_drink", t) || effectOn(s, "coffee", t) || effectOn(s, "preworkout", t)) de *= 0.8;
    if (diabetesOpen) de -= 1;
    if (s.satiety <= 0) de -= 2;
  }
  s.energy = clamp(s.energy + de * dt);

  // Saciedade (internado recebe soro: tende a 60)
  if (hospital) s.satiety += (60 - s.satiety) * Math.min(1, 0.5 * dt);
  else s.satiety = clamp(s.satiety + rate.satiety * (0.8 + 0.4 * p.appetite) * dt);

  // Horas acordado
  if (eff === "sleeping" || hospital) s.awakeH = Math.max(0, s.awakeH - 3 * dt);
  else s.awakeH += eff === "lying" ? 0.5 * dt : dt;
  if (s.energy <= 0.01 && !resting && !stim) s.zeroEnergyH += dt;
  else s.zeroEnergyH = 0;

  // Corpo: gasto calórico contínuo (a comida soma na hora de comer)
  const burn = RULES.BASE_KCAL_H * (0.85 + 0.3 * p.metabolism) * Math.pow(weightKg(s) / 70, 0.75) * rate.kcal * dt;
  s.fatKg = clamp(s.fatKg - burn / RULES.KCAL_PER_KG, 2, 140);
  const anab = effectOn(s, "anabolic", t);
  const protein = effectOn(s, "whey", t) ? 1.4 : effectOn(s, "albumin", t) ? 1.25 : 1;
  if (kind === "training") s.leanKg += 0.004 * dt * protein * (anab ? 2 : 1) * (s.energy > 10 ? 1 : 0.3);
  if (s.satiety <= 0) s.leanKg -= 0.002 * dt;
  s.leanKg = clamp(s.leanKg, 38, 95);

  // Atributos (0–1000; ver ATTR)
  const focus = (s.energy < 20 ? 0.4 : 1) * (s.stress > 70 ? 0.6 : 1);
  const disc = 0.7 + 0.6 * p.discipline;
  const useful = usefulHours(s, kind, dt);
  if (kind === "studying") gain(s, "intelligence", ATTR.GAIN_H.studyInt * useful * disc * focus * (stim ? 1.15 : 1));
  if (kind === "training") {
    const pre = effectOn(s, "preworkout", t) ? 1.15 : 1;
    const creat = effectOn(s, "creatine", t) ? 1.1 : 1;
    const prot = protein === 1.4 ? 1.25 : protein === 1.25 ? 1.15 : 1;
    gain(s, "strength", ATTR.GAIN_H.trainStr * useful * disc * focus * prot * pre * creat * (anab ? 2 : 1));
    gain(s, "speed", ATTR.GAIN_H.trainSpd * useful * disc * focus * pre);
  }
  if (kind === "working") {
    gain(s, "intelligence", ATTR.GAIN_H.workInt * dt * focus);
    const coins = RULES.WORK_COINS_H * dt * (0.6 + s.intelligence / ATTR.MAX) * focus;
    out.coins += coins;
    s.dayAcc.coins += coins;
  }
  // Sem praticar, cai devagar — nunca abaixo do piso (fração do pico).
  if (kind !== "studying" && kind !== "working") decay(s, "intelligence", dt);
  if (kind !== "training") {
    decay(s, "strength", dt);
    decay(s, "speed", dt);
  }

  // Estresse
  let ds = rate.stress;
  if (ds > 0) {
    ds *= 0.7 + 0.6 * p.anxiety;
    if (effectOn(s, "calm", t)) ds *= 0.5;
  }
  if (s.awakeH > 20) ds += (s.awakeH - 20) * 0.15;
  if (s.satiety <= 0 && !hospital) ds += 3;
  if (s.energy <= 0.01 && stim) ds += 6;
  if (diabetesOpen || hyperOpen) ds += 0.5;
  s.stress = clamp(s.stress + ds * dt);

  // Riscos de doença
  let dr = -0.08;
  if (fp > 28) dr += (fp - 28) * 0.02;
  if (kind === "training") dr -= 0.15;
  if (s.diet < -30) dr += 0.05;
  s.diabetesRisk = clamp(s.diabetesRisk + dr * dt);
  if (!s.hasDiabetes && s.diabetesRisk >= 100) {
    s.hasDiabetes = true;
    events.push({ at: t, kind: "diabetes", data: {} });
  }
  let db = -0.1;
  if (s.stress > 60) db += (s.stress - 60) * 0.01;
  if (stim) db += 0.3;
  if (anab) db += 0.25;
  if (effectOn(s, "preworkout", t)) db += 0.1;
  if (fp > 30) db += (fp - 30) * 0.02;
  if (kind === "training") db -= 0.08;
  s.bpRisk = clamp(s.bpRisk + db * dt);
  if (!s.hasHypertension && s.bpRisk >= 100) {
    s.hasHypertension = true;
    events.push({ at: t, kind: "hypertension", data: {} });
  }

  // Toxicidade
  s.toxicity = Math.max(0, s.toxicity - 1.5 * dt * (hospital ? 3 : 1));

  // Coração
  let dc = -(eff === "sleeping" || hospital ? 0.8 : 0.3);
  if (hyperOpen) dc += 0.5;
  if (stim) dc += 0.6;
  if (s.energy <= 0.01 && stim) dc += 3;
  if (s.awakeH > 30) dc += (s.awakeH - 30) * 0.05;
  if (s.stress > 85) dc += (s.stress - 85) * 0.08;
  if (anab) dc += 0.2;
  if (fp > 35) dc += 0.1;
  s.cardiac = clamp(s.cardiac + dc * dt);

  // Saúde: danos (com a causa de cada um) e recuperação
  const dmgMul = 1.2 - 0.4 * p.resilience;
  const dmg = {};
  if (!hospital) {
    if (s.satiety <= 0) dmg.fome = 1.2;
    if (s.energy <= 0.01 && stim) dmg.exaustao = 2.5;
    else if (s.zeroEnergyH > 0) dmg.exaustao = 1.5;
    if (s.awakeH > 40) dmg.sono = (s.awakeH - 40) * 0.08;
    if (diabetesOpen) dmg.diabetes = 0.25;
    if (hyperOpen) dmg.hipertensao = 0.15;
    if (s.diet < -30) dmg.dieta = 0.05;
    if (s.stress > 90) dmg.estresse = 0.2;
  }
  if (s.toxicity > 40) dmg.overdose = (s.toxicity - 40) * 0.06 + (s.toxicity > 100 ? (s.toxicity - 100) * 0.25 + 4 : 0);
  let total = 0;
  for (const k of Object.keys(dmg)) {
    dmg[k] *= dmgMul;
    total += dmg[k];
  }
  const ok = s.satiety > 25 && s.energy > 25 && s.stress < 70 && s.toxicity < 30;
  let rec = hospital ? 1.8 : !ok ? 0 : eff === "sleeping" ? 0.6 : eff === "lying" ? 0.4 : 0.25;
  if (effectOn(s, "multivit", t)) rec *= 1.3;
  s.health = Math.min(s.vitality, clamp(s.health + (rec - total) * dt));
  if (s.health >= 80) s.vitality = clamp(s.vitality + (0.5 / 24) * dt);

  // Fertilidade: caminha para um alvo
  let ft = 85 + (p.resilience - 0.5) * 20;
  if (anab) ft -= 40;
  if (fp > 30) ft -= (fp - 30) * 1.5;
  if (s.stress > 70) ft -= (s.stress - 70) * 0.5;
  if (s.health < 50) ft -= (50 - s.health) * 0.6;
  if (s.hasDiabetes) ft -= 10;
  if (s.toxicity > 30) ft -= 15;
  s.fertility = clamp(s.fertility + (clamp(ft) - s.fertility) * Math.min(1, 0.02 * dt));

  // Humor: caminha para um alvo
  const pleasure = s.effects.filter((e) => e.id === "pleasure" && e.until > t).reduce((n, e) => n + (e.mag || 0), 0);
  let mt =
    50 +
    (p.optimism - 0.5) * 20 +
    (s.satiety - 50) * 0.2 +
    (s.energy - 50) * 0.25 -
    (s.stress - 30) * 0.4 +
    (s.health - 70) * 0.3 +
    Math.min(25, pleasure);
  if (diabetesOpen || hyperOpen) mt -= 5;
  s.mood = clamp(s.mood + (clamp(mt) - s.mood) * Math.min(1, 0.25 * dt));

  // Diário do dia
  const acc = s.dayAcc;
  acc.hours[kind] += dt;
  acc.moodSum += s.mood * dt;
  acc.moodH += dt;
  acc.minHealth = Math.min(acc.minHealth, s.health);
  acc.maxStress = Math.max(acc.maxStress, s.stress);

  // Transições (na ordem: infarto, morte, internação, alta, desmaio)
  const end = t + dt * HOUR;
  if (s.cardiac >= 100) {
    s.health = clamp(s.health - RULES.INFARCT_DAMAGE * dmgMul);
    s.vitality = clamp(s.vitality - RULES.INFARCT_SEQUEL);
    s.cardiac = 40;
    events.push({ at: end, kind: "heart_attack", data: {} });
    if (s.health <= 0) return die(s, end, events, "infarto");
    if (!hospital) return admit(s, end, events, "infarto");
  }
  if (s.health <= 0) {
    const cause = Object.entries(dmg).sort((a, b) => b[1] - a[1])[0];
    return die(s, end, events, cause ? cause[0] : "complicacoes");
  }
  if (!hospital && s.health <= RULES.HOSPITAL_AT) return admit(s, end, events, "saude");
  if (hospital && s.health >= RULES.DISCHARGE_AT && s.toxicity < RULES.DISCHARGE_MAX_TOX) {
    s.activity = { kind: "idle", startedAt: end, until: null, bed: null, resume: null };
    events.push({ at: end, kind: "hospital_out", data: { health: r2(s.health) } });
    return;
  }
  if (s.zeroEnergyH >= RULES.COLLAPSE_AFTER_H) {
    // Desmaio: dorme no chão e, se a ordem ainda vale, volta a ela depois.
    const prev = s.activity;
    const resume = prev.until && prev.until > end + RULES.COLLAPSE_SLEEP_H * HOUR ? { kind: prev.kind, until: prev.until } : null;
    s.health = clamp(s.health - 3);
    s.mood = clamp(s.mood - 10);
    s.zeroEnergyH = 0;
    s.activity = { kind: "sleeping", startedAt: end, until: end + RULES.COLLAPSE_SLEEP_H * HOUR, bed: null, resume };
    events.push({ at: end, kind: "collapse", data: { during: prev.kind } });
  }
}

/** Fecha o dia corrente do diário (registro diário com a condição). */
function closeDay(s) {
  const acc = s.dayAcc;
  const rec = { ...acc, hours: { ...acc.hours }, condition: dayCondition(acc) };
  return rec;
}

/**
 * Condição do dia (0–100 + rótulo) a partir do diário: saúde mínima, humor
 * médio, estresse máximo, sono e refeições.
 */
function dayCondition(acc) {
  const mood = acc.moodH > 0 ? acc.moodSum / acc.moodH : 50;
  const sleep = Math.min(acc.hours.sleeping, 8) / 8;
  const meals = acc.mealsEaten / (acc.mealsEaten + acc.mealsMissed || 1);
  const food = acc.healthy + acc.junk > 0 ? acc.healthy / (acc.healthy + acc.junk) : 0.5;
  const score = Math.round(
    0.3 * acc.minHealth + 0.2 * mood + 0.15 * (100 - acc.maxStress) + 0.15 * sleep * 100 + 0.1 * meals * 100 + 0.1 * food * 100
  );
  const label = score >= 80 ? "otima" : score >= 60 ? "boa" : score >= 40 ? "regular" : score >= 20 ? "ruim" : "critica";
  return { score, label };
}

/** Limites dentro de (t, to]: o passo quebra exatamente neles. */
function nextBoundary(s, t, to) {
  // Grade GLOBAL de 15 min: simular em pedaços (a cada leitura) dá os mesmos
  // passos que simular de uma vez.
  const grid = Math.floor(t / STEP_MS) * STEP_MS + STEP_MS;
  let b = Math.min(to, grid, nextWindowClose(t), atLocalHour(t + 24 * HOUR, 0));
  if (s.activity.until && s.activity.until > t) b = Math.min(b, s.activity.until);
  for (const e of s.effects) if (e.until > t) b = Math.min(b, e.until);
  return b;
}

/** O que acontece exatamente no instante `t` (fim de passo). */
function atBoundary(s, t, events, out) {
  s.effects = s.effects.filter((e) => e.until > t);
  if (s.status !== "alive") return;
  const a = s.activity;
  if (a.until && a.until <= t) {
    if ((a.kind === "sleeping" || a.kind === "lying") && a.resume && a.resume.until > t) {
      s.activity = { kind: a.resume.kind, startedAt: t, until: a.resume.until, bed: null, resume: null };
    } else {
      s.activity = { kind: "idle", startedAt: t, until: null, bed: null, resume: null };
    }
    events.push({ at: t, kind: "activity_end", data: { kind: a.kind } });
  }
  const { day, hour } = localParts(t);
  // Janela que fechou agora (12, 16, 20 ou 0 h = a das 22 do dia anterior).
  const closed = CLOCK.MEALS.findIndex((h) => Math.abs(((h + CLOCK.MEAL_WINDOW_H) % 24) - hour) < 1e-6);
  if (closed >= 0 && !s.meals.eaten[closed] && s.activity.kind !== "hospital") {
    s.mood = clamp(s.mood + RULES.MEAL_MISSED.mood);
    s.stress = clamp(s.stress + RULES.MEAL_MISSED.stress);
    s.dayAcc.mealsMissed += 1;
    events.push({ at: t, kind: "meal_missed", data: { meal: CLOCK.MEALS[closed] } });
  }
  if (day !== s.dayAcc.day) {
    out.days.push(closeDay(s));
    s.dayAcc = emptyDay(day);
    s.meals = { day, eaten: [false, false, false, false] };
  }
  routine(s, t, events, out);
}

/**
 * A ROTINA (ver ROUTINE): durante estudar/treinar/trabalhar, ele mesmo dorme
 * quando a energia acaba, descansa quando o estresse estoura e come na janela
 * de refeição — e volta à tarefa (`resume`), até fechar as horas pedidas.
 */
function routine(s, t, events, out) {
  if (s.status !== "alive") return;
  const a = s.activity;
  const working = ROUTINE.KINDS.includes(a.kind) && a.until;
  const pausedAwake = a.kind === "lying" && a.resume && ROUTINE.KINDS.includes(a.resume.kind);
  if (!working && !pausedAwake) return;
  // Comer: só na janela aberta, se ainda não comeu nela e se a carteira paga
  // (também no descanso da rotina — dormindo, não).
  const w = mealWindowAt(t);
  if (w >= 0 && !s.meals.eaten[w] && s.satiety <= RULES.FULL_SATIETY && out.wallet) {
    const buy = ROUTINE.MEALS.map((id) => ITEM_BY_ID.get(id)).find((it) => it.price <= out.wallet.coins);
    if (buy) {
      const r = consume(s, buy.id, t);
      if (r.ok) {
        out.wallet.coins -= buy.price;
        out.coins -= buy.price;
        events.push(...r.events, { at: t, kind: "routine_meal", data: { item: buy.id, price: buy.price } });
      }
    }
  }
  if (!working) return;
  const leftH = (a.until - t) / HOUR;
  if (leftH < ROUTINE.MIN_LEFT_H) return;
  const pause = (kind, h, reason) => {
    const until = t + Math.min(h, leftH) * HOUR;
    s.activity = { kind, startedAt: t, until, bed: null, resume: { kind: a.kind, until: a.until } };
    if (kind === "sleeping") s.zeroEnergyH = 0;
    events.push({ at: t, kind: "routine_pause", data: { during: a.kind, pause: kind, reason, hours: r2(Math.min(h, leftH)) } });
  };
  if (s.energy <= ROUTINE.SLEEP_AT_ENERGY && !effectOn(s, "stim", t)) return pause("sleeping", ROUTINE.SLEEP_H, "energy");
  if (s.stress >= ROUTINE.REST_AT_STRESS) return pause("lying", ROUTINE.REST_H, "stress");
  const cap = ATTR.USEFUL_H[a.kind];
  if (cap && (s.dayAcc.hours[a.kind] || 0) >= cap - 1e-9) {
    const { hour } = localParts(t);
    if (hour >= ROUTINE.BED_AT || hour < ROUTINE.WAKE_AT) {
      const wake = atLocalHour(hour >= ROUTINE.BED_AT ? t + 24 * HOUR : t, ROUTINE.WAKE_AT);
      return pause("sleeping", (wake - t) / HOUR, "night");
    }
    return pause("lying", ROUTINE.BED_AT - hour, "daily_cap");
  }
}

/**
 * Avança a vida até `to` (ms). Muta `s`. Devolve os eventos, os dias
 * fechados e o saldo de moedas do período (ganho trabalhando − gasto pela
 * rotina comendo). `wallet` ({ coins }) é a carteira do jogo: a rotina só
 * compra o que ela paga, e ela é atualizada aqui (quem simula aos pedaços
 * passa a mesma carteira — o resultado é o mesmo).
 */
function simulate(s, to, wallet = null) {
  const events = [];
  const out = { days: [], coins: 0, wallet };
  if (to <= s.simAt) return { events, days: out.days, coins: 0 };
  let t = s.simAt;
  const stop = Math.min(to, t + MAX_CATCHUP_MS);
  while (t < stop && s.status === "alive") {
    const next = Math.min(nextBoundary(s, t, stop), stop);
    const before = out.coins;
    stepState(s, t, (next - t) / HOUR, events, out);
    if (wallet) wallet.coins += out.coins - before;
    t = next;
    atBoundary(s, t, events, out);
  }
  s.simAt = to;
  return { events, days: out.days, coins: out.coins };
}

// ═══ AÇÕES ═══ (sempre depois de simular até `t`)
const fail = (code) => ({ ok: false, code });

/** Comer / tomar um item do catálogo. Não mexe na carteira (o serviço cobra). */
function consume(s, itemId, t) {
  const it = ITEM_BY_ID.get(itemId);
  if (!it) return fail("item");
  if (s.status !== "alive") return fail("dead");
  if (s.activity.kind === "hospital") return fail("hospital");
  if (s.activity.kind === "sleeping") return fail("sleeping");
  if ((it.kind === "food" || it.kind === "drink") && it.sat > 0 && s.satiety > RULES.FULL_SATIETY) return fail("full");
  const events = [];
  s.satiety = clamp(s.satiety + it.sat);
  s.fatKg = clamp(s.fatKg + it.kcal / RULES.KCAL_PER_KG, 2, 140);
  if (it.kind === "food" || it.kind === "drink" || it.kind === "supplement") s.diet = clamp(s.diet * 0.85 + it.nutri * 10 * 0.15, -100, 100);
  if (it.sugar) {
    if (s.hasDiabetes) {
      if (!effectOn(s, "metformin", t)) s.health = Math.max(0.01, s.health - it.sugar * 0.8);
    } else s.diabetesRisk = clamp(s.diabetesRisk + Math.max(0, it.sugar - 3) * 0.5);
  }
  // Só o EXCESSO pesa: sal e açúcar de comida de verdade o corpo elimina.
  if (it.sodium > 4) s.bpRisk = clamp(s.bpRisk + (it.sodium - 4) * 1.5);
  s.energy = clamp(s.energy + it.energy);
  s.stress = clamp(s.stress + it.stress);
  s.toxicity += it.tox;
  if (it.mood) s.effects.push({ id: "pleasure", until: t + 2 * HOUR, mag: it.mood });
  if (it.effect) {
    const [id, h] = it.effect;
    const until = t + h * HOUR;
    const cur = s.effects.find((e) => e.id === id);
    if (cur) cur.until = Math.max(cur.until, until);
    else s.effects.push({ id, until });
  }
  if (it.kind === "food") {
    if (it.nutri >= 5) s.dayAcc.healthy += 1;
    else if (it.nutri <= -5) s.dayAcc.junk += 1;
    const w = mealWindowAt(t);
    if (w >= 0 && !s.meals.eaten[w]) {
      s.meals.eaten[w] = true;
      s.dayAcc.mealsEaten += 1;
      events.push({ at: t, kind: "meal", data: { meal: CLOCK.MEALS[w], item: it.id } });
    }
  }
  events.push({ at: t, kind: "consume", data: { item: it.id } });
  return { ok: true, item: it, events };
}

/**
 * Começa uma atividade. `hours` = quanto tempo ele vai ficar nela (mesmo com
 * o jogo fechado). Deitar e dormir pedem `bed` (a sala da casa confere a
 * cama); sem cama, o serviço recusa antes de chegar aqui.
 */
function startActivity(s, kind, hours, t, bed = null) {
  if (!ACTIVITIES.includes(kind) || kind === "hospital") return fail("activity");
  if (s.status !== "alive") return fail("dead");
  if (s.activity.kind === "hospital") return fail("hospital");
  if (kind === "idle") {
    s.activity = { kind: "idle", startedAt: t, until: null, bed: null, resume: null };
    return { ok: true, events: [{ at: t, kind: "activity", data: { kind } }] };
  }
  if ((kind === "lying" || kind === "sleeping") && !bed) return fail("bed");
  if (kind === "sleeping" && effectOn(s, "stim", t)) return fail("stimulated");
  const range = ACTIVITY_HOURS[kind];
  let h = hours == null && kind === "lying" ? range[1] : Number(hours);
  if (!Number.isFinite(h) || h < range[0] || h > range[1]) return fail("hours");
  h = Math.round(h * 4) / 4;
  s.activity = { kind, startedAt: t, until: t + h * HOUR, bed, resume: null };
  if (kind === "sleeping") s.zeroEnergyH = 0;
  return { ok: true, events: [{ at: t, kind: "activity", data: { kind, hours: h } }] };
}

// ═══ LEITURA ═══
/** Ritmo de caminhada (a sala aplica nas velocidades). */
function pace(s) {
  if (s.status !== "alive") return PACE.NORMAL;
  if (s.energy < 10 || s.health < 25) return PACE.EXHAUSTED;
  if (s.energy < 25 || s.stress >= 85 || s.health < 40) return PACE.TIRED;
  return PACE.NORMAL;
}

/** Corpo do seletor que mais combina com o corpo atual (os cards e, depois, o avatar). */
function bodyHint(s) {
  const fp = fatPct(s);
  if (fp >= 30) return "fat";
  if (s.strength >= 600 && fp < 22) return "strong";
  if (fp < 13) return "slim";
  return "normal";
}

function mealsToday(s, t) {
  const { hour } = localParts(t);
  return CLOCK.MEALS.map((h, i) => ({
    at: h,
    state: s.meals.eaten[i] ? "eaten" : hour >= h + CLOCK.MEAL_WINDOW_H ? "missed" : hour >= h ? "open" : "upcoming",
  }));
}

/** Projeção para a rede (cards): tudo arredondado, nada interno. */
function snapshot(s, t) {
  const fp = fatPct(s);
  const w = weightKg(s);
  const diabetesOpen = s.hasDiabetes && !effectOn(s, "metformin", t) && s.activity.kind !== "hospital";
  const hyperOpen = s.hasHypertension && !effectOn(s, "losartan", t) && s.activity.kind !== "hospital";
  const stim = effectOn(s, "stim", t);
  const pl = s.effects.filter((e) => e.id === "pleasure" && e.until > t).reduce((n, e) => n + e.mag, 0);
  const a = s.activity;
  return {
    status: s.status === "dead" ? "dead" : a.kind === "hospital" ? "hospital" : "alive",
    deathCause: s.deathCause,
    diedAt: s.diedAt ? new Date(s.diedAt).toISOString() : null,
    personality: s.personality,
    vitals: {
      energy: r2(s.energy),
      satiety: r2(s.satiety),
      mood: r2(s.mood),
      stress: r2(s.stress),
      health: r2(s.health),
      vitality: r2(s.vitality),
    },
    body: {
      heightM: s.heightM,
      weightKg: r2(w),
      fatPct: r2(fp),
      leanKg: r2(s.leanKg),
      bmi: r2(w / (s.heightM * s.heightM)),
      bodyHint: bodyHint(s),
    },
    attributes: {
      intelligence: r2(s.intelligence),
      strength: r2(s.strength),
      speed: r2(s.speed),
      fertility: r2(s.fertility),
      // 0–1000: maior valor já alcançado e o piso que não se perde mais.
      peaks: Object.fromEntries(TRAINED.map((k) => [k, r2(s.peaks[k])])),
      floors: Object.fromEntries(TRAINED.map((k) => [k, r2(attrFloor(s, k))])),
      // Horas que ainda rendem hoje (estudo e treino têm teto por dia).
      usefulToday: Object.fromEntries(
        Object.entries(ATTR.USEFUL_H).map(([k, cap]) => [k, { done: r2(Math.min(cap, s.dayAcc.hours[k] || 0)), cap }])
      ),
    },
    health: {
      diabetes: s.hasDiabetes ? (diabetesOpen ? "uncontrolled" : "controlled") : "none",
      hypertension: s.hasHypertension ? (hyperOpen ? "uncontrolled" : "controlled") : "none",
      diabetesRisk: r2(s.diabetesRisk),
      bpRisk: r2(s.bpRisk),
      // Leituras derivadas (para os cards; não entram na conta).
      glucose: Math.round(85 + s.diabetesRisk * 0.15 + Math.min(40, pl) + (diabetesOpen ? 110 : s.hasDiabetes ? 25 : 0)),
      systolic: Math.round(112 + s.bpRisk * 0.2 + s.stress * 0.1 + (stim ? 10 : 0) + (hyperOpen ? 35 : s.hasHypertension ? 8 : 0)),
      diastolic: Math.round(72 + s.bpRisk * 0.1 + (stim ? 6 : 0) + (hyperOpen ? 20 : s.hasHypertension ? 5 : 0)),
      toxicity: r2(s.toxicity),
      cardiac: r2(s.cardiac),
      diet: r2(s.diet),
      awakeHours: r2(s.awakeH),
    },
    activity: {
      kind: a.kind,
      startedAt: new Date(a.startedAt).toISOString(),
      until: a.until ? new Date(a.until).toISOString() : null,
      remainingH: a.until ? r2(Math.max(0, (a.until - t) / HOUR)) : null,
      inBed: !!a.bed,
      resume: a.resume ? { kind: a.resume.kind, until: new Date(a.resume.until).toISOString() } : null,
    },
    effects: s.effects
      .filter((e) => e.until > t && e.id !== "pleasure")
      .map((e) => ({ id: e.id, remainingH: r2((e.until - t) / HOUR) })),
    meals: mealsToday(s, t),
    today: { ...dayCondition(s.dayAcc), day: s.dayAcc.day, hours: Object.fromEntries(Object.entries(s.dayAcc.hours).map(([k, v]) => [k, r2(v)])) },
    pace: pace(s),
  };
}

/** Catálogo e relógio para a rede (vão inteiros no payload). */
function publicCatalog() {
  return {
    items: ITEMS.map((it) => ({ ...it, effect: it.effect ? { id: it.effect[0], hours: it.effect[1] } : null })),
    activityHours: ACTIVITY_HOURS,
    attributes: { max: ATTR.MAX, usefulH: ATTR.USEFUL_H, floor: ATTR.FLOOR },
    routine: { meals: ROUTINE.MEALS, sleepAtEnergy: ROUTINE.SLEEP_AT_ENERGY, restAtStress: ROUTINE.REST_AT_STRESS },
    clock: { offsetMin: CLOCK.OFFSET_MIN, meals: CLOCK.MEALS, mealWindowH: CLOCK.MEAL_WINDOW_H },
  };
}

module.exports = {
  HOUR,
  CLOCK,
  ACTIVITIES,
  ACTIVITY_HOURS,
  RATES,
  RULES,
  ATTR,
  ROUTINE,
  PACE,
  ITEMS,
  ITEM_BY_ID,
  birth,
  simulate,
  consume,
  startActivity,
  snapshot,
  pace,
  bodyHint,
  dayCondition,
  closeDay,
  publicCatalog,
  localParts,
  atLocalHour,
  mealWindowAt,
};
