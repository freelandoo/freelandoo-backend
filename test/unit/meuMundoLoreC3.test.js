// test/unit/meuMundoLoreC3.test.js — lore v2 C3 (caps. 4 e 5, "Ferro" e "Os Pequenos de Ferro").
//
// O que é puro: o check paintTop deixou de ser pendente, a sala do Paint grava a
// chegada à ilha de Bastor uma vez por lugar (sem robô), a ruína do Ninho nas
// Matas (placa + ponto de visita, sem caixa nova) e o livro do Ninho preso ao lugar.
const test = require("node:test");
const assert = require("node:assert/strict");
const Q = require("../../src/utils/meuMundoQuests");
const A = require("../../src/utils/meuMundoArchive");
const L = require("../../src/utils/meuMundoLayout");
const C = require("../../src/utils/meuMundoCenter");
const P = require("../../src/utils/meuMundoPlaces");
const { CENTER_INTERIORS } = require("../../src/utils/meuMundoCenterInteriors");

test("C3: paintTop tem dado (nenhum check fica pendente) e é o passo 'bastor' do cap. 5", () => {
  assert.deepEqual([...Q.PENDING_CHECKS], []);
  const cap5 = Q.CHAPTER_BY_ID.get("cap5");
  assert.equal(cap5.steps.find((s) => s.key === "bastor").check, "paintTop");
});

test("C3: a sala do Paint grava a chegada ao topo UMA vez por lugar, nunca de robô", async () => {
  const { _markPaintTop } = require("../../src/realtime/meuMundoPaint");
  const got = [];
  const rec = async (u) => got.push(u);
  const s = { userId: "u1" };
  assert.equal(_markPaintTop(s, rec), true);
  assert.equal(_markPaintTop(s, rec), false); // a mesma partida não grava de novo
  assert.equal(_markPaintTop({ bot: true, userId: null }, rec), false);
  assert.equal(_markPaintTop({ userId: null }, rec), false);
  // gravação falhou: só vai para o log (o laço nunca espera nem cai)
  assert.equal(_markPaintTop({ userId: "u2" }, async () => Promise.reject(new Error("db"))), true);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(got, ["u1"]);
});

const nbOf = (clan) => L.buildNeighborhoodPayload({ code: "bairro-0003", name: "Bairro 03", residents: 0, houses: [], clan });

test("C3: a ruína do Ninho é placa das Matas, na pracinha noroeste, e abre o registro", () => {
  const sign = nbOf("raposa").signs.find((s) => s.id === "ninho");
  assert.ok(sign);
  assert.equal(sign.archive, "registro_ninho");
  assert.ok(!nbOf("vampiro").signs.some((s) => s.id === "ninho"));
  assert.ok(!nbOf(null).signs.some((s) => s.id === "ninho"));
  // a placa fica dentro do ponto de visita "ninho" (ler = estar lá)
  const pt = L.VISIT_POINTS.find((p) => p.id === "ninho");
  assert.ok(pt && Math.hypot(sign.x - pt.x, sign.z - pt.z) < pt.r);
  assert.equal(P.pickVisit(L.VISIT_POINTS, sign.x, sign.z), "ninho");
  // longe de Aurion (os pontos não se tocam)
  assert.ok(Math.hypot(pt.x, pt.z) > pt.r + 7);
});

test("C3: o livro não mexe na colisão (obstáculos iguais nos dois povos)", () => {
  assert.deepEqual(nbOf("raposa").obstacles, nbOf("vampiro").obstacles);
});

test("C3: o registro do Ninho mora na ruína e na Biblioteca (pontos que existem)", () => {
  const e = A.ENTRY_BY_ID.get("registro_ninho");
  assert.deepEqual([...e.at], ["ninho", "biblioteca"]);
  assert.ok(L.VISIT_POINTS.some((p) => p.id === "ninho"));
  assert.ok(C.VISIT_POINTS.some((p) => p.id === "biblioteca"));
  // o resto do Arquivo se lê em qualquer lugar
  assert.ok(A.ENTRIES.filter((x) => x.id !== "registro_ninho").every((x) => x.at === null));
});

test("C3: Forjador, Armeiro e a bibliotecária falam no prédio deles", () => {
  const talk = (place) => (CENTER_INTERIORS[place].npcs || []).map((n) => n.talk).filter(Boolean);
  assert.deepEqual(talk("forja"), ["forjador"]);
  assert.deepEqual(talk("arsenal"), ["armeiro"]);
  assert.deepEqual(talk("biblioteca"), ["bibliotecaria"]);
  for (const [npc, place] of [["forjador", "forja"], ["armeiro", "arsenal"], ["bibliotecaria", "biblioteca"]]) assert.deepEqual([...P.NPCS[npc].places], [place]);
});
