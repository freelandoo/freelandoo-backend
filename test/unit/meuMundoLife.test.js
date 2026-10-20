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
  for (const k of ["energy", "satiety", "mood", "stress", "health", "vitality", "intelligence", "strength", "speed", "fertility"]) {
    assert.ok(s[k] >= 0 && s[k] <= 100, `${k} fora de 0–100: ${s[k]}`);
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

test("8 h estudando: inteligência sobe, energia cai, a atividade termina sozinha", () => {
  const s = fresh();
  s.energy = 100;
  const int0 = s.intelligence;
  assert.ok(L.startActivity(s, "studying", 8, T0).ok);
  const { events } = L.simulate(s, T0 + 8 * H);
  assert.ok(s.intelligence > int0 + 2, `inteligência ${int0} → ${s.intelligence}`);
  assert.ok(s.energy < 50, `energia ${s.energy}`);
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

test("72 h estudando sem comer: desmaia, volta a estudar e acaba no hospital", () => {
  const s = fresh(5);
  assert.ok(L.startActivity(s, "studying", 72, T0).ok);
  const { events } = L.simulate(s, T0 + 72 * H);
  const kinds = events.map((e) => e.kind);
  assert.ok(kinds.includes("collapse"), "desmaiou");
  assert.ok(kinds.includes("hospital_in"), `internado: ${kinds.join(",")}`);
  inRange(s);
});

test("depois do desmaio ele volta a fazer a mesma coisa", () => {
  const s = fresh(5);
  s.energy = 5;
  s.satiety = 90;
  assert.ok(L.startActivity(s, "studying", 40, T0).ok);
  const { events } = L.simulate(s, T0 + 16 * H);
  const collapse = events.find((e) => e.kind === "collapse");
  assert.ok(collapse, "desmaiou");
  assert.equal(s.activity.kind, "studying", `atividade ${s.activity.kind}`);
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
