// Vida do hóspede do Meu Mundo (mm3d-13). Os casos são o comportamento que o
// jogador sente: estudar cansa e ensina, dormir recupera, refeição perdida
// pesa, porcaria engorda e adoece, abuso leva ao hospital e pode matar — e a
// simulação preguiçosa dá o mesmo resultado lida aos pedaços ou de uma vez.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/utils/meuMundoLife");

const H = L.HOUR;
// 2026-10-20 07:00 em Brasília (10:00 UTC) — antes da primeira refeição.
const T0 = Date.UTC(2026, 9, 20, 10, 0, 0);
const BED = { houseId: "h", bedId: "b01" };

function fresh(seed = 7, t = T0) {
  return L.birth(seed, t);
}

function inRange(s) {
  for (const k of ["energy", "satiety", "mood", "stress", "health", "vitality", "fertility"]) {
    assert.ok(s[k] >= 0 && s[k] <= 100, `${k} fora de 0–100: ${s[k]}`);
  }
  for (const k of ["intelligence", "strength", "speed"]) {
    assert.ok(s[k] >= 0 && s[k] <= L.ATTR.MAX, `${k} fora de 0–1000: ${s[k]}`);
    assert.ok(s[k] >= L.ATTR.FLOOR[k] * s.peaks[k] - 1e-9, `${k} abaixo do piso`);
  }
}

/** Rotina saudável: as 4 refeições nas janelas e 8 h de sono a partir das 23 h. */
function feedHealthy(s, from, to) {
  const events = [];
  for (let t = from; t < to; t += H) {
    events.push(...L.simulate(s, t).events);
    if (L.mealWindowAt(t) >= 0 && s.satiety <= 92) L.consume(s, "prato_integral", t);
    if (Math.round(L.localParts(t).hour) === 23 && s.activity.kind === "idle") L.startActivity(s, "sleeping", 8, t, BED);
  }
  events.push(...L.simulate(s, to).events);
  return events;
}

test("nascimento é determinístico pela semente e começa saudável", () => {
  const a = fresh(42);
  const b = fresh(42);
  const c = fresh(43);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a.personality, c.personality);
  assert.equal(a.status, "alive");
  assert.equal(a.activity.kind, "idle");
  inRange(a);
  const snap = L.snapshot(a, T0);
  assert.ok(snap.body.weightKg > 50 && snap.body.weightKg < 90, `peso ${snap.body.weightKg}`);
  assert.equal(snap.pace, 1);
});

test("5 h estudando: inteligência sobe, energia cai, a atividade termina sozinha", () => {
  const s = fresh();
  s.energy = 100;
  const int0 = s.intelligence;
  assert.ok(L.startActivity(s, "studying", 5, T0).ok);
  const { events } = L.simulate(s, T0 + 5 * H);
  assert.ok(s.intelligence > int0 + 2, `inteligência ${int0} → ${s.intelligence}`);
  assert.ok(s.energy < 70, `energia ${s.energy}`);
  assert.equal(s.activity.kind, "idle");
  assert.ok(events.some((e) => e.kind === "activity_end"));
  inRange(s);
});

test("dormir 8 h na cama recupera a energia e zera as horas acordado", () => {
  const s = fresh();
  s.energy = 10;
  s.awakeH = 18;
  assert.equal(L.startActivity(s, "sleeping", 8, T0).code, "bed", "dormir pede cama");
  assert.ok(L.startActivity(s, "sleeping", 8, T0, BED).ok);
  L.simulate(s, T0 + 8 * H);
  assert.ok(s.energy > 90, `energia ${s.energy}`);
  assert.equal(s.awakeH, 0);
  assert.equal(s.activity.kind, "idle");
});

test("janela das 10 h: comer dentro conta; passar das 12 h sem comer é refeição perdida", () => {
  const s = fresh();
  L.simulate(s, T0 + 3.5 * H); // 10:30
  const r = L.consume(s, "frango_salada", s.simAt);
  assert.ok(r.ok);
  assert.ok(r.events.some((e) => e.kind === "meal"));
  const { events } = L.simulate(s, T0 + 9.5 * H); // 16:30 — a das 14 h fechou sem comida
  const missed = events.filter((e) => e.kind === "meal_missed").map((e) => e.data.meal);
  assert.deepEqual(missed, [14]);
  assert.equal(s.dayAcc.mealsEaten, 1);
  assert.equal(s.dayAcc.mealsMissed, 1);
});

test("cheio recusa comida, mas aceita remédio", () => {
  const s = fresh();
  s.satiety = 95;
  assert.equal(L.consume(s, "pizza", T0).code, "full");
  assert.ok(L.consume(s, "losartana", T0).ok);
  assert.equal(L.consume(s, "nao_existe", T0).code, "item");
});

test("saudável é bem mais caro que porcaria", () => {
  const avg = (ids) => ids.reduce((n, id) => n + L.ITEM_BY_ID.get(id).price, 0) / ids.length;
  const healthy = L.ITEMS.filter((i) => i.kind === "food" && i.nutri >= 5).map((i) => i.id);
  const junk = L.ITEMS.filter((i) => i.kind === "food" && i.nutri <= -5).map((i) => i.id);
  assert.ok(avg(healthy) > 3 * avg(junk), `${avg(healthy)} × ${avg(junk)}`);
});

test("duas semanas de porcaria engordam e levam ao diabetes; comida saudável não", () => {
  const junk = fresh(11);
  const good = fresh(11);
  const end = T0 + 14 * 24 * H;
  const evJunk = [];
  for (let t = T0; t < end; t += H) {
    evJunk.push(...L.simulate(junk, t).events);
    if (L.mealWindowAt(t) >= 0) {
      L.consume(junk, "hamburguer", t);
      L.consume(junk, "refrigerante", t);
      L.consume(junk, "chocolate", t);
    }
  }
  feedHealthy(good, T0, end);
  const fj = L.snapshot(junk, end).body.fatPct;
  const fg = L.snapshot(good, end).body.fatPct;
  assert.ok(fj > fg + 3, `gordura porcaria ${fj} × saudável ${fg}`);
  assert.ok(junk.diabetesRisk > good.diabetesRisk + 30, `risco ${junk.diabetesRisk} × ${good.diabetesRisk}`);
  assert.ok(junk.hasDiabetes || junk.hasHypertension, "porcaria adoece");
  assert.ok(!good.hasDiabetes && !good.hasHypertension, "saudável não adoece");
  assert.ok(good.health > 70, `saúde ${good.health}`);
  inRange(junk);
});

test("diabetes sem remédio machuca; com metformina, não", () => {
  const a = fresh();
  const b = fresh();
  for (const s of [a, b]) {
    s.hasDiabetes = true;
    s.satiety = 80;
    s.energy = 90;
    s.health = 80;
  }
  L.consume(b, "metformina", T0);
  L.simulate(a, T0 + 10 * H);
  L.simulate(b, T0 + 10 * H);
  assert.ok(a.health < b.health - 1.5, `sem ${a.health} × com ${b.health}`);
});

test("rotina sem moedas: dorme e descansa sozinho (sem desmaio), mas sem comer passa fome", () => {
  const s = fresh(5);
  assert.ok(L.startActivity(s, "studying", 72, T0).ok);
  const { events } = L.simulate(s, T0 + 72 * H, { coins: 0 });
  const kinds = events.map((e) => e.kind);
  assert.ok(!kinds.includes("collapse"), "não desmaia na rotina");
  assert.ok(kinds.includes("routine_pause"), "pausou");
  assert.ok(!kinds.includes("routine_meal"), "sem moedas não compra");
  assert.ok(kinds.includes("meal_missed"), "perdeu refeições");
  inRange(s);
});

test("rotina: sem energia ele dorme e volta à mesma tarefa", () => {
  const s = fresh(5);
  s.energy = 5;
  s.satiety = 90;
  assert.ok(L.startActivity(s, "studying", 40, T0).ok);
  const { events } = L.simulate(s, T0 + 9 * H, { coins: 500 });
  const p = events.find((e) => e.kind === "routine_pause");
  assert.ok(p && p.data.pause === "sleeping" && p.data.reason === "energy", JSON.stringify(p));
  assert.equal(s.activity.kind, "studying", `atividade ${s.activity.kind}`);
});

test("à toa e sem energia ainda desmaia", () => {
  const s = fresh(5);
  s.energy = 0;
  s.satiety = 90;
  const { events } = L.simulate(s, T0 + 8 * H);
  assert.ok(events.some((e) => e.kind === "collapse"), "desmaiou");
});

test("rotina come na janela com as moedas da carteira (a pedaços dá o mesmo)", () => {
  const a = fresh(8);
  const b = fresh(8);
  const wa = { coins: 300 };
  const wb = { coins: 300 };
  L.startActivity(a, "training", 72, T0);
  L.startActivity(b, "training", 72, T0);
  const ra = L.simulate(a, T0 + 72 * H, wa);
  let net = 0;
  for (let h = 1; h <= 72; h++) net += L.simulate(b, T0 + h * H, wb).coins;
  assert.deepEqual(a, b);
  assert.equal(wa.coins, wb.coins);
  assert.ok(Math.abs(ra.coins - net) < 1e-6);
  const meals = ra.events.filter((e) => e.kind === "routine_meal");
  assert.ok(meals.length >= 8, `refeições da rotina: ${meals.length}`);
  assert.ok(Math.abs(300 + ra.coins - wa.coins) < 1e-6 && wa.coins >= 0, `carteira ${wa.coins}`);
  assert.ok(!ra.events.some((e) => e.kind === "hospital_in" || e.kind === "collapse"));
});

test("só as primeiras horas do dia rendem: 10 h de treino ≈ 4 h", () => {
  const four = fresh(31);
  const ten = fresh(31);
  for (const s of [four, ten]) {
    s.energy = 100;
    s.satiety = 90;
    s.stress = 10;
  }
  const s0 = four.strength;
  L.startActivity(four, "training", 4, T0);
  L.startActivity(ten, "training", 10, T0);
  L.simulate(four, T0 + 4 * H);
  L.simulate(ten, T0 + 4 * H);
  const g4 = four.strength - s0;
  L.simulate(ten, T0 + 10 * H);
  const g10 = ten.strength - s0;
  assert.ok(g4 > 3, `4 h rende ${g4}`);
  assert.ok(g10 < g4 * 1.1, `10 h ${g10} × 4 h ${g4}`);
  assert.ok(L.snapshot(ten, T0 + 10 * H).attributes.usefulToday.training.done === 4);
});

test("nasce fraco (dezenas) e a escala é longa: 72 h de treino dão ~+20; um ano de rotina passa de 600 sem chegar a 1000", () => {
  const s = fresh(42);
  for (const k of ["intelligence", "strength"]) assert.ok(s[k] >= 15 && s[k] <= 30, `${k} inicial ${s[k]}`);
  assert.ok(s.speed >= 20 && s.speed <= 35, `velocidade inicial ${s.speed}`);
  const w = { coins: 1e6 };
  const s0 = s.strength;
  L.startActivity(s, "training", 72, T0);
  L.simulate(s, T0 + 72 * H, w);
  assert.ok(s.strength - s0 > 8 && s.strength - s0 < 35, `72 h: ${s0} → ${s.strength}`);
  for (let t = T0 + 72 * H; t < T0 + 365 * 24 * H; t += 72 * H) {
    L.startActivity(s, "training", 72, t);
    L.simulate(s, t + 72 * H, w);
  }
  assert.equal(s.status, "alive");
  assert.ok(s.strength > 600 && s.strength < 900, `1 ano: ${s.strength}`);
  inRange(s);
});

test("permanência: força e velocidade param em 60% do pico; inteligência em 90%; voltar é mais rápido", () => {
  const s = fresh(4);
  s.strength = 800;
  s.speed = 500;
  s.intelligence = 700;
  s.peaks = { intelligence: 700, strength: 800, speed: 500 };
  s.satiety = 90;
  const end = T0 + 2 * 365 * 24 * H;
  for (let t = T0; t < end; t += 24 * H) {
    L.simulate(s, t, { coins: 1e6 });
    s.satiety = 90; // o teste alimenta: aqui só importa o tempo sem treinar
    s.health = 100;
  }
  assert.ok(Math.abs(s.strength - 480) < 1, `força ${s.strength}`);
  assert.ok(Math.abs(s.speed - 300) < 1, `velocidade ${s.speed}`);
  assert.ok(Math.abs(s.intelligence - 630) < 1, `inteligência ${s.intelligence}`);
  const back = fresh(4);
  Object.assign(back, { strength: 480, peaks: { ...s.peaks }, energy: 100, satiety: 90, stress: 10, simAt: T0 });
  const novice = fresh(4);
  Object.assign(novice, { strength: 480, peaks: { intelligence: novice.intelligence, strength: 480, speed: novice.speed }, energy: 100, satiety: 90, stress: 10 });
  L.startActivity(back, "training", 4, T0);
  L.startActivity(novice, "training", 4, T0);
  L.simulate(back, T0 + 4 * H);
  L.simulate(novice, T0 + 4 * H);
  assert.ok(back.strength - 480 > 1.8 * (novice.strength - 480), `memória ${back.strength} × ${novice.strength}`);
});

test("estimulantes em série: overdose mata", () => {
  const s = fresh();
  for (let i = 0; i < 8; i++) L.consume(s, "estimulante", T0 + i * 0.1 * H);
  const { events } = L.simulate(s, T0 + 48 * H);
  assert.equal(s.status, "dead");
  assert.ok(events.some((e) => e.kind === "death"));
});

test("dias sem dormir à base de estimulante e estresse: infarto", () => {
  const s = fresh(9);
  s.stress = 90;
  s.hasHypertension = true;
  const events = [];
  L.startActivity(s, "working", 72, T0);
  for (let t = T0; t < T0 + 72 * H && s.status === "alive"; t += 4 * H) {
    events.push(...L.simulate(s, t).events);
    L.consume(s, "estimulante", t);
    L.consume(s, "prato_feito", t);
  }
  assert.ok(events.some((e) => e.kind === "heart_attack" || e.kind === "death"), events.map((e) => e.kind).join(","));
});

test("hospital trata e dá alta com saúde ≥ 60, e cada internação deixa sequela", () => {
  const s = fresh();
  s.health = 16;
  s.satiety = 0;
  const { events } = L.simulate(s, T0 + 2 * H);
  assert.ok(events.some((e) => e.kind === "hospital_in"));
  assert.equal(s.activity.kind, "hospital");
  assert.equal(s.vitality, 100 - L.RULES.ADMIT_SEQUEL);
  assert.equal(L.consume(s, "pizza", s.simAt).code, "hospital");
  assert.equal(L.startActivity(s, "studying", 2, s.simAt).code, "hospital");
  const r = L.simulate(s, T0 + 60 * H);
  const out = r.events.find((e) => e.kind === "hospital_out");
  assert.ok(out, "teve alta");
  assert.ok(out.data.health >= 60, `saúde na alta ${out.data.health}`);
  assert.equal(s.activity.kind, "idle");
});

test("internado com a vitalidade no fim não resiste", () => {
  const s = fresh();
  s.vitality = 25;
  s.health = 16;
  s.satiety = 0;
  L.simulate(s, T0 + 2 * H);
  assert.equal(s.status, "dead");
  assert.equal(s.deathCause, "complicacoes");
});

test("simular aos pedaços dá o mesmo que de uma vez", () => {
  const a = fresh(3);
  const b = fresh(3);
  L.startActivity(a, "training", 10, T0);
  L.startActivity(b, "training", 10, T0);
  L.simulate(a, T0 + 30 * H);
  for (let h = 1; h <= 30; h++) L.simulate(b, T0 + h * H);
  assert.deepEqual(a, b);
});

test("ritmo: normal, cansado e exausto", () => {
  const s = fresh();
  assert.equal(L.pace(s), L.PACE.NORMAL);
  s.energy = 20;
  assert.equal(L.pace(s), L.PACE.TIRED);
  s.energy = 5;
  assert.equal(L.pace(s), L.PACE.EXHAUSTED);
});

test("treino com whey e anabolizante ganha mais força, e o anabolizante derruba a fertilidade", () => {
  const plain = fresh(21);
  const juiced = fresh(21);
  for (const s of [plain, juiced]) {
    s.energy = 100;
    s.satiety = 90;
  }
  L.consume(juiced, "whey", T0);
  L.consume(juiced, "anabolizante", T0);
  L.startActivity(plain, "training", 4, T0);
  L.startActivity(juiced, "training", 4, T0);
  L.simulate(plain, T0 + 4 * H);
  L.simulate(juiced, T0 + 4 * H);
  assert.ok(juiced.strength - plain.strength > 1, `${plain.strength} × ${juiced.strength}`);
  L.simulate(juiced, T0 + 5 * 24 * H);
  L.simulate(plain, T0 + 5 * 24 * H);
  assert.ok(juiced.fertility < plain.fertility - 15, `fertilidade ${juiced.fertility} × ${plain.fertility}`);
});

test("trabalhar rende moedas", () => {
  const s = fresh();
  L.startActivity(s, "working", 8, T0);
  const r = L.simulate(s, T0 + 8 * H);
  assert.ok(r.coins > 60 && r.coins < 160, `moedas ${r.coins}`);
});

test("virada do dia fecha o diário com a condição", () => {
  const s = fresh();
  const r = L.simulate(s, T0 + 24 * H);
  assert.equal(r.days.length, 1);
  assert.equal(r.days[0].day, "2026-10-20");
  assert.ok(["otima", "boa", "regular", "ruim", "critica"].includes(r.days[0].condition.label));
  assert.equal(r.days[0].mealsMissed, 4);
});

test("snapshot não vaza a semente nem campos internos", () => {
  const snap = L.snapshot(fresh(), T0);
  assert.equal(snap.seed, undefined);
  assert.equal(snap.simAt, undefined);
  assert.equal(snap.meals.length, 4);
  assert.equal(snap.meals[0].state, "upcoming");
});

// ═══ Corpo pela alimentação (2026-10-21): o tipo físico não se escolhe ═══
test("todo hóspede nasce muito magro", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const snap = L.snapshot(fresh(seed), T0);
    assert.equal(snap.body.bodyHint, "slim", `semente ${seed}: ${snap.body.fatPct}%`);
    assert.ok(snap.body.fatPct < 11, `semente ${seed}: ${snap.body.fatPct}%`);
  }
});

test("comer sem atividade física só engorda: magro → normal → gordo, sem ganhar músculo", () => {
  const s = fresh(5);
  const lean0 = s.leanKg;
  const seen = [];
  for (let t = T0; t < T0 + 45 * 24 * H; t += H) {
    L.simulate(s, t);
    if (L.mealWindowAt(t) >= 0 && s.satiety <= 92) L.consume(s, "prato_feito", t);
    if (Math.round(L.localParts(t).hour) === 23 && s.activity.kind === "idle") L.startActivity(s, "sleeping", 8, t, BED);
    const hint = L.bodyHint(s);
    if (seen[seen.length - 1] !== hint) seen.push(hint);
  }
  assert.deepEqual(seen, ["slim", "normal", "fat"]);
  assert.ok(s.leanKg <= lean0 + 1e-9, `massa magra ${lean0} → ${s.leanKg}`);
});

test("gordo: os danos à saúde pesam 1,2×", () => {
  const thin = fresh(9);
  const fat = fresh(9);
  fat.fatKg = fat.leanKg; // 50% de gordura
  assert.equal(L.bodyHint(fat), "fat");
  for (const s of [thin, fat]) {
    s.satiety = 0; // fome: dano contínuo
    s.health = 80;
    s.diabetesRisk = 0;
    s.bpRisk = 0;
  }
  L.simulate(thin, T0 + H);
  L.simulate(fat, T0 + H);
  const lostThin = 80 - thin.health;
  const lostFat = 80 - fat.health;
  assert.ok(lostThin > 0, "fome machuca");
  assert.ok(Math.abs(lostFat / lostThin - L.RULES.FAT_HEALTH_MUL) < 0.02, `perda ${lostThin} × ${lostFat}`);
});
