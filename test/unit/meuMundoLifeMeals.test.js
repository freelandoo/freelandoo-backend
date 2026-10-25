// Agenda de refeições, sono, exposição e vida do hóspede (2026-10-24). O
// relógio é injetado (todo instante é um argumento): nada aqui lê Date.now().
// Os números de penalidade são EXATOS: dois hóspedes iguais, um com a
// refeição quitada e outro não, diferem exatamente pela fração do atraso.
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/utils/meuMundoLife");

const H = L.HOUR;
// Hora local de Brasília (UTC−3) no dia 2026-10-20.
const at = (h, day = 20) => Date.UTC(2026, 9, day, 3 + h, 0, 0);
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const BED = { houseId: "h", bedId: "b01" };

/** Hóspede "neutro" num instante: vitais no meio, sem nada que bata limite. */
function guest(t, seed = 7) {
  const s = L.birth(seed, t);
  Object.assign(s, { energy: 80, satiety: 80, stress: 30, health: 80, vitality: 100, mood: 60 });
  return s;
}
const clone = (s) => JSON.parse(JSON.stringify(s));

test("refeição das 10 h aceita às 08 h, às 10 h e às 12 h (inclusive); às 07:59 ainda não", () => {
  for (const h of [8, 10, 12]) {
    const s = guest(at(h));
    const r = L.consume(s, "prato_feito", at(h));
    assert.ok(r.ok);
    assert.equal(r.meal && r.meal.at, 10, `às ${h} h`);
    assert.equal(r.meal.late, false);
    assert.equal(r.meal.done, true);
  }
  const early = guest(at(7) + 59 * 60000);
  assert.equal(L.consume(early, "prato_feito", early.simAt).meal, null);
});

test("às 12 h uma porção não quita duas refeições: a das 10 h primeiro, a das 14 h continua aberta", () => {
  const s = guest(at(12));
  s.satiety = 10;
  const a = L.consume(s, "prato_feito", at(12));
  assert.equal(a.meal.at, 10);
  const snap = L.snapshot(s, at(12));
  assert.equal(snap.meals.find((m) => m.at === 10).state, "eaten");
  assert.equal(snap.meals.find((m) => m.at === 14).state, "open");
  const b = L.consume(s, "prato_feito", at(12));
  assert.equal(b.meal.at, 14, "a segunda porção vai para a próxima");
});

test("atraso: às 13 h metade da penalidade, às 14 h ela inteira, e para", () => {
  const late = guest(at(12));
  const fed = clone(late);
  fed.meals.log["2026-10-20@10"] = { c: 1 };
  const sat0 = late.satiety;
  L.simulate(late, at(13));
  L.simulate(fed, at(13));
  assert.ok(near(late.satiety, sat0 - 12.5), `saciedade ${sat0} → ${late.satiety}`);
  assert.ok(near(fed.energy - late.energy, 5), `energia ${fed.energy - late.energy}`);
  assert.ok(near(late.stress - fed.stress, 5), `estresse ${late.stress - fed.stress}`);
  assert.ok(near(fed.health - late.health, 5), `saúde ${fed.health - late.health}`);
  L.simulate(late, at(14));
  L.simulate(fed, at(14));
  assert.ok(near(fed.energy - late.energy, 10));
  assert.ok(near(late.stress - fed.stress, 10));
  assert.ok(near(fed.health - late.health, 10));
  // Depois das 14 h a refeição das 10 h não desconta mais.
  const gap = fed.energy - late.energy;
  L.simulate(late, at(15));
  L.simulate(fed, at(15));
  assert.ok(near(fed.energy - late.energy, gap), "parou de descontar");
  assert.equal(L.snapshot(late, at(15)).meals.find((m) => m.at === 10).state, "missed");
});

test("comer no atraso (13 h): a metade restante não é cobrada, a já perdida não volta", () => {
  const a = guest(at(12));
  const b = clone(a);
  L.simulate(a, at(13));
  L.simulate(b, at(13));
  const r = L.consume(a, "prato_feito", at(13)); // energia 0, estresse 0: só a agenda muda
  assert.equal(r.meal.at, 10);
  assert.equal(r.meal.late, true);
  L.simulate(a, at(15));
  L.simulate(b, at(15));
  assert.ok(near(a.energy - b.energy, 5), `poupou ${a.energy - b.energy}`);
  // a parte cobrada das 12 às 13 h ficou (a energia não foi devolvida pela comida)
  const ctl = guest(at(12));
  ctl.meals.log["2026-10-20@10"] = { c: 1 };
  L.simulate(ctl, at(15));
  assert.ok(near(ctl.energy - a.energy, 5), `perdido ${ctl.energy - a.energy}`);
});

test("lanche pequeno conta em parte; dois lanches quitam; bebida não quita refeição", () => {
  const s = guest(at(9));
  s.satiety = 30;
  const soda = L.consume(s, "refrigerante", at(9));
  assert.equal(soda.meal, null, "refrigerante não tem crédito de refeição");
  const y1 = L.consume(s, "iogurte_aveia", at(9));
  assert.equal(y1.meal.done, false);
  assert.equal(L.snapshot(s, at(9)).meals.find((m) => m.at === 10).state, "partial");
  const y2 = L.consume(s, "iogurte_aveia", at(10));
  assert.equal(y2.meal.done, true);
  assert.equal(y2.meal.at, 10, "a sobra não vai para a das 14 h");
  assert.equal(L.snapshot(s, at(10)).meals.find((m) => m.at === 14).credit, 0);
});

test("meia refeição no horário: o atraso cobra só a metade", () => {
  const half = guest(at(11));
  L.consume(half, "iogurte_aveia", at(11)); // 0,5 — energia/estresse 0
  const none = guest(at(11));
  L.simulate(half, at(14));
  L.simulate(none, at(14));
  const fed = guest(at(11));
  fed.meals.log["2026-10-20@10"] = { c: 1 };
  L.simulate(fed, at(14));
  assert.ok(near(fed.energy - none.energy, 10));
  assert.ok(near(fed.energy - half.energy, 5));
});

test("a das 22 h atravessa a meia-noite com o id do dia em que abriu", () => {
  const s = guest(at(23, 20));
  const r = L.consume(s, "prato_feito", at(23, 20));
  assert.equal(r.meal.id, "2026-10-20@22");
  const u = guest(at(21, 20));
  const ev = L.simulate(u, at(0, 21) + 30 * 60000).events; // 00:30
  assert.ok(ev.some((e) => e.kind === "meal_missed" && e.data.id === "2026-10-20@22"));
  const p = L.pendingMeal(u, u.simAt);
  assert.equal(p && p.id, "2026-10-20@22", "às 00:30 ainda dá para comer a das 22 h (atrasada)");
  const late = L.consume(u, "prato_feito", u.simAt);
  assert.equal(late.meal.late, true);
  // O diário do dia 20 ficou com a das 22 h perdida no horário (fechou à meia-noite).
  const w = guest(at(21, 20));
  const days = L.simulate(w, at(1, 21)).days;
  assert.equal(days[0].day, "2026-10-20");
  assert.equal(days[0].mealsMissed, 1);
});

test("refeição encerrada não captura consumo depois da penalidade", () => {
  const s = guest(at(15));
  L.simulate(s, at(15) + 1);
  const r = L.consume(s, "prato_feito", at(15) + 1);
  assert.equal(r.meal.at, 14, "às 15 h vai para a das 14 h, não para a das 10 h encerrada");
});

test("reconectar não duplica penalidade: 3 dias sem comer, de uma vez ou hora a hora", () => {
  const a = guest(at(6));
  const b = clone(a);
  L.simulate(a, at(6) + 72 * H);
  for (let h = 1; h <= 72; h++) L.simulate(b, at(6) + h * H);
  assert.deepEqual(a, b);
  // e reler no mesmo instante não muda nada
  const snap = JSON.stringify(a);
  L.simulate(a, at(6) + 72 * H);
  assert.equal(JSON.stringify(a), snap);
});

test("um dia inteiro sem comer machuca mas não mata nem interna; voltar a comer recupera", () => {
  const s = L.birth(12, at(7));
  const ev = L.simulate(s, at(7) + 24 * H).events;
  assert.equal(s.status, "alive");
  assert.ok(!ev.some((e) => e.kind === "hospital_in" || e.kind === "death"), ev.map((e) => e.kind).join(","));
  assert.ok(s.health >= L.MEALS.HEALTH_FLOOR, `saúde ${s.health}`);
  assert.ok(s.health < 75, `doeu: ${s.health}`);
  // quatro dias de cuidado (o primeiro começa desmaiado, sem poder comer)
  const t0 = s.simAt;
  for (let t = t0; t < t0 + 96 * H; t += H) {
    L.simulate(s, t);
    if (L.pendingMeal(s, t) && s.satiety <= 80) L.consume(s, "prato_integral", t);
    if (Math.round(L.localParts(t).hour) === 23 && s.activity.kind === "idle") L.startActivity(s, "sleeping", 8, t, BED);
  }
  assert.ok(s.health > 60, `recuperou: ${s.health}`);
  assert.ok(s.exposure.hunger < 1, `exposição ${s.exposure.hunger}`);
});

test("16 h acordado: aviso com as horas certas; dormir 8 h (com o jogo fechado) zera; logout acordado continua contando", () => {
  const s = guest(at(7));
  s.awakeH = 16;
  assert.deepEqual(L.needs(s, at(7)).find((n) => n.id === "sleep"), { id: "sleep", level: 4, hours: 16 });
  s.awakeH = 19.4;
  assert.equal(L.needs(s, at(7)).find((n) => n.id === "sleep").hours, 19);
  // logout acordado: 10 h depois ele está 10 h mais acordado
  const w = guest(at(8));
  w.awakeH = 2;
  L.simulate(w, at(18));
  assert.ok(near(w.awakeH, 12), `acordado ${w.awakeH}`);
  // dormiu na cama e saiu do jogo: acorda sozinho com o sono contado
  const z = guest(at(23));
  z.awakeH = 18;
  assert.ok(L.startActivity(z, "sleeping", 8, at(23), BED).ok);
  L.simulate(z, at(7, 21));
  assert.equal(z.awakeH, 0);
  assert.equal(z.activity.kind, "idle");
  // soneca curta não zera tudo
  const n = guest(at(15));
  n.awakeH = 18;
  L.startActivity(n, "sleeping", 1, at(15), BED);
  L.simulate(n, at(16));
  assert.ok(n.awakeH > 14, `soneca: ${n.awakeH}`);
});

test("vida: bem cuidado gasta 1 dia por dia; o pior estado chega a ~3 semanas; cuidar reduz o desgaste futuro", () => {
  const max = 1 + Object.values(L.LIFE.WEAR).reduce((a, b) => a + b, 0);
  assert.ok(L.LIFE.DAYS / max <= 21, `pior caso ${L.LIFE.DAYS / max} dias`);
  const s = guest(at(8));
  const w0 = s.wearDays;
  L.consume(s, "prato_feito", at(8));
  L.simulate(s, at(12));
  assert.ok(near(s.wearDays - w0, 4 / 24), `bem: ${s.wearDays - w0}`);
  const bad = guest(at(8));
  Object.assign(bad, { satiety: 0, awakeH: 40, stress: 100, health: 10 });
  const b0 = bad.wearDays;
  L.simulate(bad, at(9));
  assert.ok(bad.wearDays - b0 > 25 / 24, `crítico: ${(bad.wearDays - b0) * 24} dias/dia`);
  assert.equal(L.snapshot(bad, at(9)).life.leftDays < L.LIFE.DAYS, true);
});

test("vida no fim: morre de velhice", () => {
  const s = guest(at(8));
  s.wearDays = L.LIFE.DAYS - 0.01;
  L.consume(s, "prato_feito", at(8));
  const ev = L.simulate(s, at(10)).events;
  assert.equal(s.status, "dead");
  assert.equal(s.deathCause, "velhice");
  assert.ok(ev.some((e) => e.kind === "death"));
});

test("debilitado corre por menos tempo", () => {
  const ok = guest(at(9));
  const weak = guest(at(9));
  Object.assign(weak, { energy: 15, health: 30 });
  weak.exposure.sleep = 30;
  assert.ok(L.stamina(weak).maxS < 0.5 * L.stamina(ok).maxS, `${L.stamina(weak).maxS} × ${L.stamina(ok).maxS}`);
  assert.ok(L.stamina(weak).maxS >= L.STAMINA.MIN_S);
  assert.ok(L.stamina(weak).refillS > L.stamina(ok).refillS);
});

test("estado antigo (mig 295) vira o registro novo sem inventar refeição", () => {
  const s = guest(at(13));
  s.meals = { day: "2026-10-20", eaten: [true, false, false, false] };
  delete s.exposure;
  delete s.wearDays;
  L.simulate(s, at(13) + H);
  assert.deepEqual(Object.keys(s.meals.log), ["2026-10-20@10"]);
  assert.equal(s.wearDays > 0, true);
});

test("prioridade das necessidades: hospital > saúde/exaustão > fome > sono > leves", () => {
  const s = guest(at(13));
  Object.assign(s, { satiety: 5, awakeH: 18, energy: 5 });
  const ids = L.needs(s, at(13)).map((n) => n.id);
  assert.deepEqual(ids.slice(0, 3), ["exhausted", "starving", "sleep"]);
  s.activity = { kind: "hospital", startedAt: at(13), until: null, bed: null, resume: null };
  assert.deepEqual(L.needs(s, at(13)), [{ id: "hospital", level: 1 }]);
});
