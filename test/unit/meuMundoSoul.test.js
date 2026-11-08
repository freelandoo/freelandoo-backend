// mm3d-72: a alma do hóspede (personalidade, afeto, desejos, apelido).
const test = require("node:test");
const assert = require("node:assert/strict");
const Soul = require("../../src/utils/meuMundoSoul");

const H = 3600 * 1000;
const T0 = Date.UTC(2026, 10, 7, 15, 0); // 12 h em Brasília
const life = (seed = 1234) => ({ seed, status: "alive", personality: { appetite: 0.3 } });

test("mesma semente = mesma alma; quem é de antes nasce pela semente", () => {
  const a = Soul.soulOf(life(77));
  const b = Soul.soulOf(life(77));
  assert.deepEqual(a, b);
  assert.ok(Soul.TEMPERS.includes(a.temper));
  assert.notEqual(a.likes.food, a.hates.food);
  assert.notEqual(a.likes.act, a.hates.act);
  assert.equal(a.affection, Soul.AFFECTION.START);
});

test("as cinco personalidades aparecem no sorteio", () => {
  const seen = new Set();
  for (let i = 1; i < 400; i++) seen.add(Soul.bornSoul(i).temper);
  assert.deepEqual([...seen].sort(), [...Soul.TEMPERS].sort());
});

test("comilão tem o apetite do corpo no alto; covarde odeia lutar; psicopata gosta", () => {
  for (let i = 1; i < 300; i++) {
    const s = life(i);
    const so = Soul.soulOf(s);
    if (so.temper === "comilao") assert.ok(s.personality.appetite >= 0.85);
    if (so.temper === "covarde") assert.equal(so.hates.act, "fight");
    if (so.temper === "psicopata") assert.equal(so.likes.act, "fight");
  }
});

test("afeto: cuidar sobe, deixar com fome e internar desce; piso 0, sem teto", () => {
  const s = life(5);
  const so = Soul.soulOf(s);
  so.nextWishAt = T0 + 1000 * H; // sem desejo atrapalhando a conta
  Soul.applyEvents(s, [{ at: T0, kind: "meal", data: { late: false } }], T0);
  assert.equal(so.affection, 52);
  Soul.applyEvents(s, [{ at: T0, kind: "meal_missed", data: {} }, { at: T0, kind: "hospital_in", data: {} }], T0);
  assert.equal(so.affection, 38);
  for (let i = 0; i < 20; i++) Soul.applyEvents(s, [{ at: T0, kind: "hospital_in" }], T0);
  assert.equal(so.affection, 0);
  so.affection = 5000;
  Soul.applyEvents(s, [{ at: T0, kind: "meal", data: {} }], T0);
  assert.equal(so.affection, 5002);
});

test("comida favorita agrada, a odiada desagrada", () => {
  const s = life(9);
  const so = Soul.soulOf(s);
  so.nextWishAt = T0 + 1000 * H;
  const base = so.affection;
  Soul.applyEvents(s, [{ at: T0, kind: "consume", data: { item: so.likes.food } }], T0);
  const up = so.affection - base;
  assert.ok(up >= Soul.AFFECTION.FAV_FOOD);
  const mid = so.affection;
  Soul.applyEvents(s, [{ at: T0, kind: "consume", data: { item: so.hates.food } }], T0);
  assert.ok(so.affection < mid + (so.temper === "comilao" ? Soul.AFFECTION.SNACK_COMILAO : 0));
});

test("apelido: ≥ 200 = o que mais gosta; zerado há um dia = o que mais odeia", () => {
  const s = life(11);
  const so = Soul.soulOf(s);
  assert.deepEqual(Soul.callName(so, T0), { kind: "nick" });
  so.affection = 200;
  assert.deepEqual(Soul.callName(so, T0), { kind: "like", food: so.likes.food });
  so.affection = 0;
  so.zeroSince = T0;
  assert.deepEqual(Soul.callName(so, T0 + 2 * H), { kind: "nick" });
  assert.deepEqual(Soul.callName(so, T0 + 25 * H), { kind: "hate", food: so.hates.food });
});

test("desejo: nasce pela personalidade; atendido sobe, vencido desce", () => {
  // um hóspede competitivo: quer minijogo ou luta
  let seed = 1;
  while (Soul.bornSoul(seed).temper !== "competitivo") seed++;
  const s = life(seed);
  const so = Soul.soulOf(s);
  const r = Soul.applyEvents(s, [], T0);
  assert.ok(so.wish && ["minigame", "fight"].includes(so.wish.id));
  assert.equal(r.events[0].kind, "wish");
  const want = so.wish.id;
  const before = so.affection;
  const ok = Soul.applyEvents(s, [{ at: T0 + H, kind: want, data: { win: false } }], T0 + H);
  assert.ok(ok.events.some((e) => e.kind === "wish_ok"));
  assert.ok(so.affection >= before + Soul.AFFECTION.WISH_OK);
  assert.equal(so.wish, null);
  // depois do intervalo vem outro; deixar vencer desce
  const t2 = T0 + H + (Soul.WISH_GAP_H + 1) * H;
  Soul.applyEvents(s, [], t2);
  assert.ok(so.wish);
  const mid = so.affection;
  const fail = Soul.applyEvents(s, [], so.wish.until + 1);
  assert.ok(fail.events.some((e) => e.kind === "wish_fail"));
  assert.ok(so.affection <= mid + Soul.AFFECTION.WISH_FAIL + 0.01);
});

test("covarde: de noite quer ficar em casa; lutar quebra, não lutar cumpre", () => {
  let seed = 1;
  while (Soul.bornSoul(seed).temper !== "covarde") seed++;
  const night = Date.UTC(2026, 10, 7, 23, 0); // 20 h em Brasília
  const s = life(seed);
  const so = Soul.soulOf(s);
  Soul.applyEvents(s, [], T0); // de dia: nada
  assert.equal(so.wish, null);
  Soul.applyEvents(s, [], night);
  assert.equal(so.wish.id, "home_night");
  const r = Soul.applyEvents(s, [{ at: night + H, kind: "fight", data: { win: true } }], night + H);
  assert.ok(r.events.some((e) => e.kind === "wish_fail"));
  const s2 = life(seed);
  const so2 = Soul.soulOf(s2);
  Soul.applyEvents(s2, [], night);
  const r2 = Soul.applyEvents(s2, [], so2.wish.until + 1);
  assert.ok(r2.events.some((e) => e.kind === "wish_ok"));
});

test("luta abandonada não conta", () => {
  const s = life(21);
  const so = Soul.soulOf(s);
  so.nextWishAt = T0 + 1000 * H;
  const a = so.affection;
  Soul.applyEvents(s, [{ at: T0, kind: "fight", data: { win: false, abandoned: true } }], T0);
  assert.equal(so.affection, a);
});
