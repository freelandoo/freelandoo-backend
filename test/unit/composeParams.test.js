// test/unit/composeParams.test.js
//
// A fronteira de confiança da composição no servidor. Estes valores terminam
// INTERPOLADOS numa string de filtro do ffmpeg (`crop=...`,
// `overlay=x=main_w*...`), então o que se testa aqui é que nada que não seja
// número finito e dentro de faixa consegue passar.

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseComposeParams, normalizeFilter } = require("../../src/utils/composeParams");

test("ausente devolve null — o upload segue pelo caminho de sempre", () => {
  assert.equal(parseComposeParams(undefined), null);
  assert.equal(parseComposeParams(null), null);
  assert.equal(parseComposeParams(""), null);
});

test("JSON torto é recusado, não ignorado", () => {
  assert.equal(parseComposeParams("{nao e json").error, "compose inválido");
  assert.equal(parseComposeParams("[1,2,3]").error, "compose inválido");
  assert.equal(parseComposeParams('"texto"').error, "compose inválido");
});

test("aspect é RECUSADO quando inválido, nunca corrigido para um padrão", () => {
  // Cair no 9:16 em silêncio entregaria um vídeo com formato diferente do que
  // a pessoa viu no editor — pior que recusar.
  assert.equal(parseComposeParams(JSON.stringify({ zoom: 1 })).error, "aspect inválido");
  assert.equal(parseComposeParams(JSON.stringify({ aspect: "abc" })).error, "aspect inválido");
  assert.equal(parseComposeParams(JSON.stringify({ aspect: 0 })).error, "aspect inválido");
  assert.equal(parseComposeParams(JSON.stringify({ aspect: -1 })).error, "aspect inválido");
  assert.equal(parseComposeParams(JSON.stringify({ aspect: 99 })).error, "aspect inválido");
  assert.equal(parseComposeParams(JSON.stringify({ aspect: 0.01 })).error, "aspect inválido");
});

test("as quatro proporções do composer passam", () => {
  for (const a of [9 / 16, 4 / 5, 1, 16 / 9]) {
    const r = parseComposeParams(JSON.stringify({ aspect: a }));
    assert.equal(r.aspect, a, `aspect ${a}`);
  }
});

test("zoom e pan são fixados na borda em vez de recusados", () => {
  // Enquadramento fora de faixa não muda o FORMATO do vídeo, então prender na
  // borda entrega o mais próximo do pedido em vez de derrubar a publicação.
  const r = parseComposeParams(JSON.stringify({ aspect: 1, zoom: 0.1, panX: -9, panY: 9 }));
  assert.equal(r.zoom, 1);
  assert.equal(r.panX, -1);
  assert.equal(r.panY, 1);
  assert.equal(parseComposeParams(JSON.stringify({ aspect: 1, zoom: 1000 })).zoom, 10);
});

test("valores não-numéricos viram o neutro, nunca NaN", () => {
  // NaN interpolado no grafo de filtros produziria `main_w*NaN` e o erro
  // apareceria falando do encoder em vez do pedido.
  const r = parseComposeParams(JSON.stringify({ aspect: 1, zoom: "x", panX: {}, panY: [] }));
  assert.ok(Number.isFinite(r.zoom) && Number.isFinite(r.panX) && Number.isFinite(r.panY));
  assert.equal(r.zoom, 1);
  assert.equal(r.panX, 0);
});

test("filtro hostil é neutralizado campo a campo", () => {
  const r = parseComposeParams(
    JSON.stringify({
      aspect: 1,
      filter: { mono: "; rm -rf /", contrast: 99, tint: ["x", 2, null], tintStrength: -5 },
    })
  );
  assert.equal(r.filter.mono, 0);
  assert.equal(r.filter.contrast, 1); // fixado no teto
  assert.deepEqual(r.filter.tint, [1, 2, 1]);
  assert.equal(r.filter.tintStrength, 0);
});

test("filtro ausente vira null (sem LUT, sem custo)", () => {
  assert.equal(parseComposeParams(JSON.stringify({ aspect: 1 })).filter, null);
  assert.equal(normalizeFilter(undefined), null);
  assert.equal(normalizeFilter("texto"), null);
});

test("pip torto cai nos padrões, dentro de faixa", () => {
  const r = parseComposeParams(
    JSON.stringify({ aspect: 1, pip: { x: "abc", y: 2, scale: -9 } })
  );
  assert.equal(r.pip.x, 0.5);
  assert.equal(r.pip.y, 1);
  assert.equal(r.pip.scale, 0.05);
});

test("aceita objeto já parseado, não só string", () => {
  const r = parseComposeParams({ aspect: 0.5625, zoom: 2 });
  assert.equal(r.aspect, 0.5625);
  assert.equal(r.zoom, 2);
});
