// test/unit/composerLut.test.js
//
// A LUT é a transcrição literal do FRAG do editor (front,
// lib/camera/renderer.ts). Estes casos travam essa equivalência: se alguém
// mexer na ordem das operações ou nas constantes de um dos lados, o preview
// passa a mostrar uma cor e o vídeo publicado outra — divergência que só
// aparece depois de publicado, que é o pior momento.

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildCubeLut, isNeutralFilter, applyChain, LUT_SIZE } = require("../../src/utils/composerLut");

const f = (p) => ({
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  vignette: 0,
  grain: 0,
  mono: 0,
  tint: [1, 1, 1],
  tintStrength: 0,
  ...p,
});

const near = (a, b, tol = 1e-6) => Math.abs(a - b) <= tol;

test("filtro neutro não gera LUT (o grafo não paga por uma identidade)", () => {
  assert.equal(buildCubeLut(f({})), null);
  assert.equal(buildCubeLut(null), null);
  assert.equal(isNeutralFilter(f({})), true);
});

test("vinheta e grão sozinhos NÃO geram LUT — são espaciais", () => {
  // A vinheta vai assada no PNG de sobreposição e o grão é filtro próprio do
  // ffmpeg; nenhum dos dois é função de cor→cor, então não cabe numa LUT.
  assert.equal(buildCubeLut(f({ vignette: 0.6 })), null);
  assert.equal(buildCubeLut(f({ grain: 0.2 })), null);
});

test("tint neutro com força alta continua sendo neutro", () => {
  assert.equal(buildCubeLut(f({ tintStrength: 1, tint: [1, 1, 1] })), null);
  assert.notEqual(buildCubeLut(f({ tintStrength: 1, tint: [1.2, 1, 0.8] })), null);
});

test("P&B: a conta bate com a do shader, dígito a dígito", () => {
  // Vermelho puro, preset "pb" (mono 1, contrast 0.16):
  //   r = (1-0.5)*1.16+0.5 = 1.08 ; g = b = (0-0.5)*1.16+0.5 = -0.08
  //   lum = 1.08*0.299 + (-0.08)*0.587 + (-0.08)*0.114 = 0.26684
  // mono=1 leva os três canais a lum — ANTES do clamp final.
  const [r, g, b] = applyChain(1, 0, 0, f({ mono: 1, contrast: 0.16 }));
  assert.ok(near(r, 0.26684, 1e-5), `r=${r}`);
  assert.ok(near(r, g) && near(g, b), "os três canais convergem");
});

test("lum é calculado UMA vez e as duas misturas usam o mesmo escalar", () => {
  // O shader faz `float lum = dot(col,...)` e depois mistura duas vezes com
  // esse valor. Recalcular entre as duas mudaria o resultado do P&B parcial.
  const out = applyChain(0.8, 0.2, 0.4, f({ saturation: 0.5, mono: 0.5 }));
  const lum = 0.8 * 0.299 + 0.2 * 0.587 + 0.4 * 0.114;
  const sat = (c) => lum + (c - lum) * 1.5;
  const esperado = [0.8, 0.2, 0.4].map((c) => sat(c) + (lum - sat(c)) * 0.5);
  out.forEach((v, i) => assert.ok(near(v, esperado[i], 1e-6), `canal ${i}: ${v} vs ${esperado[i]}`));
});

test("temperatura desloca R para cima e B para baixo, na mesma medida", () => {
  const quente = applyChain(0.5, 0.5, 0.5, f({ temperature: 0.32 }));
  assert.ok(quente[0] > 0.5 && quente[2] < 0.5, "R sobe, B desce");
  assert.ok(near(quente[0] - 0.5, 0.5 - quente[2], 1e-6), "simétrico");
  assert.ok(near(quente[0] - 0.5, 0.32 * 0.12, 1e-6), "constante 0.12 do shader");
});

test("saída é sempre fixada em 0..1", () => {
  for (const filtro of [f({ brightness: 1, contrast: 1 }), f({ brightness: -1 }), f({ contrast: 1, saturation: 1 })]) {
    for (const [r, g, b] of [[0, 0, 0], [1, 1, 1], [1, 0, 0.5]]) {
      for (const v of applyChain(r, g, b, filtro)) {
        assert.ok(v >= 0 && v <= 1, `fora de faixa: ${v}`);
      }
    }
  }
});

test("o .cube sai no formato que o ffmpeg lê", () => {
  const cube = buildCubeLut(f({ mono: 1 }));
  const linhas = cube.trim().split("\n");
  assert.match(linhas[1], new RegExp(`^LUT_3D_SIZE ${LUT_SIZE}$`));
  assert.equal(linhas.length, 4 + LUT_SIZE ** 3, "cabeçalho + uma amostra por ponto");
  // Preto continua preto e branco continua branco sob P&B puro: são os dois
  // extremos e servem de âncora do domínio.
  assert.equal(linhas[4], "0.000000 0.000000 0.000000");
  assert.equal(linhas[linhas.length - 1], "1.000000 1.000000 1.000000");
  for (const l of linhas.slice(4)) {
    assert.match(l, /^-?\d\.\d{6} -?\d\.\d{6} -?\d\.\d{6}$/);
  }
});
