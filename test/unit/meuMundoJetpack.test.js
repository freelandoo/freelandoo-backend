// test/unit/meuMundoJetpack.test.js — MEU MUNDO 3D: jetpack (mm3d-21)
//
// O fixture de ouro foi gravado da simulação do mm3d-20, ANTES de ela ser
// separada em percurso + jogador + partida para o modo de até 4 pessoas
// (scripts/jetpack-golden.js). Enquanto ele bater, o jogo sozinho é o mesmo:
// mesmas posições, mesmo combustível, mesmos obstáculos, mesmos eventos no
// mesmo passo. A sim do front é carregada direto do .ts (test/unit/_frontTs.js);
// sem o front ao lado, a parte do front pula.

const test = require("node:test");
const assert = require("node:assert/strict");
const { loadFront } = require("./_frontTs");
const { golden } = require("./_jetpackScript");
const GOLD = require("../fixtures/jetpack-golden.json");

process.removeAllListeners("warning"); // aviso de "module type" do .ts do front

test("jetpack — front: o jogo sozinho é idêntico ao ouro do mm3d-20", async (t) => {
  const world = await loadFront("sim/world.ts");
  const pilot = await loadFront("sim/autopilot.ts");
  if (!world || !pilot) return t.skip("front fora do lugar");
  const now = golden(world.World, pilot.autopilot);
  assert.deepEqual(Object.keys(now), Object.keys(GOLD));
  for (const k of Object.keys(GOLD)) assert.deepEqual(now[k], GOLD[k], k);
});
