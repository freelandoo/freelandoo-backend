// test/unit/postOrientation.test.js
// Orientações aceitas em post (4:5 · 1:1 · 16:9). É a regra que decide em que
// moldura a mídia de um post é gravada — vale pra imagem e pra vídeo, em todas
// as superfícies que publicam (feed, comunidade, academia, vaquinha, condomínio).
const test = require("node:test");
const assert = require("node:assert");

const {
  POST_ORIENTATIONS,
  pickPostOrientation,
} = require("../../src/utils/mediaProcessing");

test("as três orientações estão declaradas com o lado curto em 1080", () => {
  assert.deepStrictEqual(
    POST_ORIENTATIONS.map((o) => o.id),
    ["4:5", "1:1", "16:9"]
  );
  for (const o of POST_ORIENTATIONS) {
    assert.strictEqual(Math.min(o.width, o.height), 1080, `${o.id} fora do padrão`);
    assert.ok(Math.abs(o.width / o.height - o.ratio) < 0.01, `${o.id} com dims incoerentes`);
  }
});

test("mídia que já chega numa das três é reconhecida sem corte", () => {
  assert.strictEqual(pickPostOrientation(1080, 1350).id, "4:5");
  assert.strictEqual(pickPostOrientation(1080, 1080).id, "1:1");
  assert.strictEqual(pickPostOrientation(1920, 1080).id, "16:9");
});

test("ruído de arredondamento do encoder não muda a orientação", () => {
  // 1080x608 é o que o composer antigo produzia pra 16:9 (607,5 arredondado).
  assert.strictEqual(pickPostOrientation(1080, 608).id, "16:9");
  assert.strictEqual(pickPostOrientation(1079, 1349).id, "4:5");
});

test("foto crua vai pra orientação mais próxima em vez de ser recusada", () => {
  assert.strictEqual(pickPostOrientation(3024, 4032).id, "4:5"); // 3:4 em pé
  assert.strictEqual(pickPostOrientation(4032, 3024).id, "16:9"); // 4:3 deitada
  assert.strictEqual(pickPostOrientation(1200, 1000).id, "1:1"); // 6:5
  assert.strictEqual(pickPostOrientation(3000, 1000).id, "16:9"); // panorâmica
});

test("vertical 9:16 postado como post vira 4:5, não 1:1", () => {
  // Sem isso um Curto reaproveitado no feed sairia com as bordas comidas.
  assert.strictEqual(pickPostOrientation(1080, 1920).id, "4:5");
});

test("empate real (4:3) desempata preservando deitado/em pé", () => {
  // 4:3 fica à MESMA distância log de 1:1 e de 16:9 — sem desempate explícito o
  // resultado dependeria da ordem em que a lista foi escrita.
  assert.strictEqual(pickPostOrientation(4000, 3000).id, "16:9");
  assert.strictEqual(pickPostOrientation(3000, 4000).id, "4:5");
});

test("dimensão ausente cai no retrato, que é o formato histórico do feed", () => {
  assert.strictEqual(pickPostOrientation(0, 0).id, "4:5");
  assert.strictEqual(pickPostOrientation(undefined, undefined).id, "4:5");
});
