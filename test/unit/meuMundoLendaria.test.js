// legend-v1 (24/11/2026): o placar dos minijogos só conta disputa (2+ pessoas jogando) e a sala diz quantas jogaram.
const test = require("node:test");
const assert = require("node:assert/strict");

const Adv = require("../../src/services/MeuMundoAdventureService");
const { PracticeMeter, MULTI_MIN_MS } = require("../../src/realtime/meuMundoPractice");
const Scores = require("../../src/utils/meuMundoScores");

function play(meter, id, ms) {
  for (let t = 0; t <= ms; t += 500) meter.pose(id, { x: t }, 1000 + t);
}

test("legend-v1: a sala conta quem jogou de verdade (20 s ou mais) e manda para o crédito", () => {
  const calls = [];
  const orig = Adv.creditMinigame;
  Adv.creditMinigame = async (id, o) => (calls.push([id, o.players]), { receipt: null });
  try {
    const m = new PracticeMeter("jetpack", "jp:1", null);
    play(m, "a", MULTI_MIN_MS + 1000);
    play(m, "b", 3000); // entrou e saiu: não conta como disputa
    m.settle(null, null, new Map([["a", 10], ["b", 1]]));
    assert.deepEqual(calls.sort(), [["a", 1], ["b", 1]]);
    calls.length = 0;
    const m2 = new PracticeMeter("jetpack", "jp:2", null);
    play(m2, "a", MULTI_MIN_MS + 1000);
    play(m2, "b", MULTI_MIN_MS + 1000);
    m2.settle("b"); // quem saiu antes ainda conta para o outro
    m2.settle(null, null, new Map([["a", 10]]));
    assert.deepEqual(calls, [["b", 2], ["a", 2]]);
  } finally {
    Adv.creditMinigame = orig;
  }
  assert.equal(Scores.isMulti(1), false);
  assert.equal(Scores.isMulti(2), true);
});
