// Coliseu (2026-11-24): duas pessoas na porta, "Lutar" em cima da outra, os dois entram sem aceite.
// A sala confere a entrada e guarda a vida dos dois; a pancada é limitada.
const test = require("node:test");
const assert = require("node:assert/strict");
const { DuelHub, DUEL } = require("../../src/realtime/meuMundoDuel");
const C = require("../../src/utils/meuMundoCenter");

const boxe = C.PLACES.find((p) => p.id === "boxe");
const DOOR = { x: boxe.door.x, z: boxe.door.z };

function world(over = {}) {
  const at = {
    a: { x: DOOR.x + 2, z: DOOR.z, car: false, busy: false, bot: false },
    b: { x: DOOR.x + 4, z: DOOR.z + 1, car: false, busy: false, bot: false },
    ...over,
  };
  return (sid) => at[sid] || null;
}

test("o Coliseu é o prédio do Boxe (a porta existe)", () => {
  assert.ok(boxe, "lugar boxe na planta");
  assert.ok(Number.isFinite(DOOR.x) && Number.isFinite(DOOR.z));
});

test("entrada: os dois perto da porta e um do outro abrem a luta para os dois", () => {
  const h = new DuelHub();
  const r = h.challenge("a", "b", world(), DOOR, 1000);
  assert.ok(r.duel, JSON.stringify(r));
  assert.deepEqual(r.duel.sids, ["a", "b"]);
  assert.equal(h.of("a"), r.duel);
  assert.equal(h.of("b"), r.duel);
  // já em luta: nem um nem outro pode ser chamado de novo
  assert.equal(h.challenge("c", "a", world({ c: { x: DOOR.x, z: DOOR.z } }), DOOR).error, "busy");
});

test("entrada recusada: longe da porta, longe um do outro, ocupado, dirigindo, robô, a si mesmo, sumido", () => {
  const h = new DuelHub();
  assert.equal(h.challenge("a", "b", world({ b: { x: DOOR.x + DUEL.near + 3, z: DOOR.z } }), DOOR).error, "far");
  assert.equal(h.challenge("a", "b", world({ a: { x: DOOR.x - 6, z: DOOR.z - 6 }, b: { x: DOOR.x + 6, z: DOOR.z + 6 } }), DOOR).error, "pair");
  assert.equal(h.challenge("a", "b", world({ b: { x: DOOR.x + 2, z: DOOR.z, busy: true } }), DOOR).error, "busy");
  assert.equal(h.challenge("a", "b", world({ a: { x: DOOR.x, z: DOOR.z, car: true } }), DOOR).error, "driving");
  assert.equal(h.challenge("a", "bot-3", world(), DOOR).error, "bot");
  assert.equal(h.challenge("a", "b", world({ b: { x: DOOR.x, z: DOOR.z, bot: true } }), DOOR).error, "bot");
  assert.equal(h.challenge("a", "a", world(), DOOR).error, "self");
  assert.equal(h.challenge("a", "zz", world(), DOOR).error, "gone");
  assert.equal(h.duels.size, 0);
});

test("pancada só vale com os dois prontos; vida máxima do aparelho com limites", () => {
  const h = new DuelHub();
  h.challenge("a", "b", world(), DOOR, 0);
  assert.equal(h.hit("a", { d: 10 }, 100), null, "antes do versus, nada");
  assert.equal(h.ready("a", 300, 200), false);
  assert.equal(h.hit("a", { d: 10 }, 300), null, "só um pronto, nada");
  assert.equal(h.ready("b", 1e12, 400), true, "os dois prontos agora");
  const d = h.of("a");
  assert.deepEqual(d.max, [300, DUEL.hpMax]);
  assert.equal(h.ready("b", 50, 500), false, "pronto uma vez só (a vida não muda depois)");
  assert.equal(d.max[1], DUEL.hpMax);
});

test("pancada: limitada pela vida de quem leva, no ritmo, lixo ignorado; vida zero acaba a luta", () => {
  const h = new DuelHub();
  h.challenge("a", "b", world(), DOOR, 0);
  h.ready("a", 200, 0);
  h.ready("b", 100, 0);
  const r1 = h.hit("a", { d: 9999, h: 1 }, 1000);
  assert.equal(r1.victim, "b");
  assert.equal(r1.dmg, Math.round(100 * DUEL.hitCap), "no máximo hitCap da vida de quem leva");
  assert.equal(r1.heavy, true);
  assert.equal(h.hit("a", { d: 5 }, 1000 + DUEL.hitGapMs - 1), null, "rápido demais");
  assert.equal(h.hit("a", { d: -3 }, 2000), null);
  assert.equal(h.hit("a", { d: "x" }, 2100), null);
  const r2 = h.hit("b", { d: 30 }, 2200);
  assert.equal(r2.victim, "a");
  assert.deepEqual(r2.hp, [170, 65]);
  let end = null;
  for (let t = 3000; !end && t < 10000; t += 200) end = h.hit("a", { d: 35 }, t)?.end ?? null;
  assert.ok(end);
  assert.equal(end.winner, "a");
  assert.equal(end.loser, "b");
  assert.equal(end.reason, "ko");
  assert.equal(h.of("a"), null, "acabou: os dois livres");
  assert.equal(h.of("b"), null);
});

test("estado do lutador: vai só para o outro, cortado ao palco, no ritmo, estado desconhecido vira parado", () => {
  const h = new DuelHub();
  h.challenge("a", "b", world(), DOOR, 0);
  const r = h.state("a", { x: 99, z: -3.456, f: 1.2, s: "attack", t: 0.2, c: 2, v: 3 }, 1000);
  assert.equal(r.to, "b");
  assert.equal(r.msg.x, DUEL.arena);
  assert.equal(r.msg.z, -3.46);
  assert.equal(r.msg.s, "attack");
  assert.equal(r.msg.c, 2);
  assert.equal(h.state("a", { x: 0 }, 1000 + DUEL.stateGapMs - 1), null, "rápido demais");
  assert.equal(h.state("b", { s: "voar" }, 1000).msg.s, "idle");
  assert.equal(h.state("b", { s: "skill", k: "dash" }, 2000).msg.k, "dash");
  assert.equal(h.state("zz", { x: 0 }, 3000), null);
});

test("desistir, cair e o tempo decidem o fim", () => {
  const h = new DuelHub();
  h.challenge("a", "b", world(), DOOR, 0);
  // caiu antes do versus: desfeita, sem vencedor
  let end = h.drop("a");
  assert.equal(end.reason, "void");
  assert.equal(end.winner, null);

  h.challenge("a", "b", world(), DOOR, 0);
  h.ready("a", 100, 0);
  h.ready("b", 100, 0);
  end = h.quit("b");
  assert.equal(end.winner, "a");
  assert.equal(end.reason, "quit");

  h.challenge("a", "b", world(), DOOR, 0);
  h.ready("a", 100, 0);
  h.ready("b", 100, 0);
  end = h.drop("a");
  assert.equal(end.winner, "b");
  assert.equal(end.reason, "drop");

  // versus esquecido
  h.challenge("a", "b", world(), DOOR, 0);
  assert.deepEqual(h.expire(DUEL.readyMs - 1), []);
  end = h.expire(DUEL.readyMs + 1)[0];
  assert.equal(end.reason, "void");

  // luta longa: mais vida em % vence
  h.challenge("a", "b", world(), DOOR, 0);
  h.ready("a", 100, 0);
  h.ready("b", 400, 0);
  h.hit("b", { d: 30 }, 1000);
  end = h.expire(DUEL.maxMs + 1)[0];
  assert.equal(end.reason, "time");
  assert.equal(end.winner, "b");
  assert.equal(h.duels.size, 0);
  assert.equal(h.bySid.size, 0);
});
