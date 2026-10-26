// Cores do personagem (mm3d-36, mig 304): paleta, código look, quem pinta e o
// espelho do cliente (features/meu-mundo/avatar-colors.ts).
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const C = require("../../src/utils/meuMundoColors");
const MeuMundoStorage = require("../../src/storages/MeuMundoStorage");

const FRONT = path.resolve(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/avatar-colors.ts");

test("padrão e normalização", () => {
  assert.equal(C.DEFAULT_LOOK, "0032");
  assert.equal(C.normalizeLook("0032"), "0032");
  assert.equal(C.normalizeLook("b97b"), "b97b");
  assert.equal(C.normalizeLook("c000"), C.DEFAULT_LOOK); // camiseta 12 não existe
  assert.equal(C.normalizeLook("0080"), C.DEFAULT_LOOK); // pele 8 não existe
  assert.equal(C.normalizeLook("00"), C.DEFAULT_LOOK);
  assert.equal(C.normalizeLook(null), C.DEFAULT_LOOK);
  assert.equal(C.normalizeLook("00-1"), C.DEFAULT_LOOK);
  assert.equal(C.normalizeLook("00A1"), C.DEFAULT_LOOK); // só minúsculas
});

test("só o padrão e a feminina mudam de cor; cada skin guarda as suas", () => {
  assert.deepEqual([...C.COLORABLE_SKINS].sort(), ["feminina", "standard"]);
  assert.equal(C.lookFor({ standard: "1111" }, "standard"), "1111");
  assert.equal(C.lookFor({ standard: "1111" }, "feminina"), C.DEFAULT_LOOK);
  assert.equal(C.lookFor({ sergio: "1111" }, "sergio"), "");
  assert.equal(C.lookFor(null, "standard"), C.DEFAULT_LOOK);
});

test("corpos pintados = todos os da sala menos Sergio e Ekaterina", () => {
  const want = MeuMundoStorage.BODIES.filter((b) => b !== "sergio" && b !== "ekaterina").sort();
  assert.deepEqual([...C.COLORABLE_BODIES].sort(), want);
  assert.equal(C.roomLook("sergio", "1111"), "");
  assert.equal(C.roomLook("female", "1111"), "1111");
  assert.equal(C.roomLook("fat", "zzzz"), C.DEFAULT_LOOK);
});

test("espelho: avatar-colors.ts tem a mesma paleta e o mesmo padrão", async (t) => {
  if (!fs.existsSync(FRONT)) return t.skip("front fora do lugar");
  const F = await import(pathToFileURL(FRONT).href);
  assert.equal(F.DEFAULT_LOOK, C.DEFAULT_LOOK);
  assert.deepEqual([...F.PARTS], [...C.PARTS]);
  for (const part of C.PARTS) assert.deepEqual(F.PALETTE[part].map((c) => c.hex), C.PALETTE[part].map((c) => c.hex), part);
  assert.equal(F.lookCode(F.parseLook("b97b")), "b97b");
  assert.equal(F.lookCode(F.parseLook("c000")), C.DEFAULT_LOOK);
  assert.deepEqual([...F.COLORABLE_SKINS].sort(), [...C.COLORABLE_SKINS].sort());
});

test("recolorPixels: pinta só a região, mantém o sombreado e o resto intacto", async (t) => {
  if (!fs.existsSync(FRONT)) return t.skip("front fora do lugar");
  const F = await import(pathToFileURL(FRONT).href);
  // 3 pixels: camiseta clara, camiseta escura (metade da luz), fora da máscara
  const base = new Uint8ClampedArray([200, 32, 46, 255, 100, 16, 23, 255, 10, 200, 10, 255]);
  const mask = new Uint8Array([1, 1, 0]);
  const refs = { shirt: [200, 32, 46], pants: [43, 63, 115], skin: [217, 162, 122], hair: [107, 58, 34] };
  const out = F.recolorPixels(base, mask, refs, "6032"); // camiseta 6 = verde #1E8A4A
  assert.deepEqual([...out.slice(0, 4)], [30, 138, 74, 255]);
  assert.ok(out[4] < out[0] && out[5] < out[1]); // a dobra continua mais escura
  assert.deepEqual([...out.slice(8, 12)], [10, 200, 10, 255]); // fora da máscara não muda
  assert.deepEqual([...base.slice(0, 3)], [200, 32, 46]); // a original não é tocada
});
