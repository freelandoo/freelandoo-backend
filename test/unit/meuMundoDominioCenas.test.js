// test/unit/meuMundoDominioCenas.test.js — Domínios v2 DV1: 3 cenas de mundo aberto por Domínio
// (plano MEU MUNDO 3D/planos/2026-11-11-dominios-v2.md §1). Cena = faixa de setores; a passagem
// abre com o chefe da cena anterior; travas de setor iguais.
const test = require("node:test");
const assert = require("node:assert/strict");
const D = require("../../src/utils/meuMundoDomains");

test("DV1: os seis com as mesmas 3 cenas — 1–3 (chefe 3), 4–7 (chefe 7), 8–10 (guardião 9, deus 10)", () => {
  for (const id of D.DOMAIN_IDS) {
    const list = D.scenesOf(id);
    assert.deepEqual(list.map((c) => [...c.sectors]), [[1, 2, 3], [4, 5, 6, 7], [8, 9, 10]], id);
    assert.deepEqual(list.map((c) => c.boss), [3, 7, 9], id);
    assert.equal(list[2].god, 10);
    // toda a faixa 1–10 coberta uma vez só
    assert.deepEqual(list.flatMap((c) => c.sectors), Array.from({ length: D.SECTORS }, (_, k) => k + 1));
    assert.equal(D.sceneName(id, 2), `${id}-2`);
  }
  assert.equal(D.sceneOf("floresta", 3), 1);
  assert.equal(D.sceneOf("floresta", 4), 2);
  assert.equal(D.sceneOf("floresta", 6), 2, "Pedraverde (setor 6) fica na cena 2");
  assert.equal(D.sceneOf("floresta", 10), 3);
  assert.equal(D.sceneOf("floresta", 11), null);
  assert.equal(D.scenesOf("nada"), null);
});

test("DV1: a cena abre quando o chefe da anterior cai (igual ao setor seguinte abrir)", () => {
  assert.equal(D.sceneOpen("floresta", 1, 5, {}), true);
  assert.equal(D.sceneOpen("floresta", 1, 4, {}), false, "trava do treinador vale para a cena");
  assert.equal(D.sceneOpen("floresta", 2, 5, { floresta: 2 }), false, "chefe da cena 1 (setor 3) ainda de pé");
  assert.equal(D.sceneOpen("floresta", 2, 5, { floresta: 3 }), true);
  assert.equal(D.sceneOpen("floresta", 3, 5, { floresta: 6 }), false);
  assert.equal(D.sceneOpen("floresta", 3, 5, { floresta: 7 }), true);
  assert.equal(D.sceneOpen("canion", 1, 9, { floresta: 9 }), false, "travessia vale para a cena");
  assert.equal(D.sceneOpen("canion", 3, 1, {}, true), true, "administrador passa");
  assert.equal(D.sceneOpen("floresta", 4, 5, { floresta: 10 }), false, "não existe cena 4");
  for (let top = 0; top <= 10; top++)
    for (const c of D.SCENES) assert.equal(D.sceneOpen("floresta", c.n, 5, { floresta: top }), D.sectorOpen("floresta", c.sectors[0], 5, { floresta: top }));
});

test("DV1: a tela manda as cenas (nome, faixa, chefe, aberta, passagem) e a cena de cada setor", () => {
  const fl = D.view(5, { floresta: 3 })[0];
  assert.deepEqual(fl.scenes.map((c) => c.name), ["floresta-1", "floresta-2", "floresta-3"]);
  assert.deepEqual(fl.scenes.map((c) => c.open), [true, true, false]);
  assert.deepEqual(fl.scenes.map((c) => c.cleared), [true, false, false]);
  assert.deepEqual(fl.scenes[0].passage, { to: 2, open: true });
  assert.deepEqual(fl.scenes[1].passage, { to: 3, open: false });
  assert.equal(fl.scenes[2].passage, null, "a cena 3 termina no castelo");
  assert.equal(fl.scenes[2].god, 10);
  assert.deepEqual(fl.sectors.map((s) => s.scene), [1, 1, 1, 2, 2, 2, 2, 3, 3, 3]);
  // fechado: nenhuma cena aberta
  const ca = D.view(5, { floresta: 3 })[1];
  assert.equal(ca.open, false);
  assert.ok(ca.scenes.every((c) => !c.open && !(c.passage && c.passage.open)));
  // o resto da tela não mudou
  assert.equal(fl.sectors[9].boss, "noctis");
  assert.equal(fl.places[0].id, "pedraverde");
});
