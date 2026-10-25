// test/unit/meuMundoChatLogic.test.js — mm3d-32: lógica pura do chat no front
// (features/meu-mundo/ui/chat/chat-logic.ts). O Node 24 carrega o .ts sem
// imports direto; front fora do lugar (CI só com o back) → o teste pula.
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

process.removeAllListeners("warning");
const FILE = path.resolve(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/ui/chat/chat-logic.ts");
const load = () => import(pathToFileURL(FILE).href);
const skip = !fs.existsSync(FILE);

test("merge: sem duplicar, mais velha primeiro, teto", { skip }, async () => {
  const L = await load();
  const a = [{ id: "1", at: "2026-10-25T10:00:00Z" }, { id: "2", at: "2026-10-25T10:01:00Z" }];
  const b = [{ id: "2", at: "2026-10-25T10:01:00Z" }, { id: "3", at: "2026-10-25T10:02:00Z" }];
  assert.deepEqual(L.mergeLines(a, b).map((l) => l.id), ["1", "2", "3"]);
  // histórico vem DESC (mais nova primeiro): a ordem sai pelo horário
  assert.deepEqual(L.mergeLines([], [...b].reverse()).map((l) => l.id), ["2", "3"]);
  const many = Array.from({ length: 300 }, (_, i) => ({ id: String(i), at: new Date(1e12 + i * 1000).toISOString() }));
  const m = L.mergeLines([], many);
  assert.equal(m.length, L.LINES_MAX);
  assert.equal(m[m.length - 1].id, "299");
});

test("pendente vira a confirmada pelo id do cliente", { skip }, async () => {
  const L = await load();
  const pend = L.pendingLine("c-1", "oi");
  const merged = L.confirmLine([pend], "c-1", { id: "m9", at: "2026-10-25T10:00:00Z", text: "oi" });
  assert.deepEqual(merged.map((l) => [l.id, !!l.pending]), [["m9", false]]);
});

test("a sala entrega a minha linha ANTES da resposta do POST: uma linha só", { skip }, async () => {
  const L = await load();
  const real = { id: "m9", at: "2026-10-25T10:00:00Z", text: "oi", mine: true };
  let cur = L.mergeLines([], [L.pendingLine("c-1", "oi")]);
  cur = L.mergeLines(cur, [real]); // "chat" pela sala
  assert.deepEqual(cur.map((l) => [l.id, !!l.pending]), [["m9", false]]);
  cur = L.confirmLine(cur, "c-1", real); // resposta do POST
  assert.deepEqual(cur.map((l) => l.id), ["m9"]);
  // e depois da resposta: a sala repete, nada duplica
  cur = L.mergeLines(cur, [real]);
  assert.deepEqual(cur.map((l) => l.id), ["m9"]);
});

test("adoção só pega a pendente de mesmo texto; linha dos outros não adota", { skip }, async () => {
  const L = await load();
  let cur = L.mergeLines([], [L.pendingLine("c-1", "oi"), L.pendingLine("c-2", "tudo bem?")]);
  cur = L.mergeLines(cur, [{ id: "x1", at: "2026-10-25T10:00:00Z", text: "oi", mine: false }]);
  assert.equal(cur.filter((l) => l.pending).length, 2);
  cur = L.mergeLines(cur, [{ id: "m2", at: "2026-10-25T10:00:01Z", text: "tudo bem?", mine: true }]);
  assert.deepEqual(cur.filter((l) => l.pending).map((l) => l.clientId), ["c-1"]);
  assert.deepEqual(L.dropPending(cur, "c-1").map((l) => l.id), ["x1", "m2"]);
});

test("texto: corta espaços, recusa vazio e respeita o limite", { skip }, async () => {
  const L = await load();
  assert.equal(L.cleanDraft("  oi  ", 500), "oi");
  assert.equal(L.cleanDraft("   ", 500), null);
  assert.equal(L.cleanDraft("a".repeat(600), 500).length, 500);
});

test("não lidas do Global: conta só as dos outros com o painel fechado", { skip }, async () => {
  const L = await load();
  assert.equal(L.bumpUnread(0, { mine: false }, false), 1);
  assert.equal(L.bumpUnread(3, { mine: true }, false), 3);
  assert.equal(L.bumpUnread(3, { mine: false }, true), 0);
});

test("id do cliente é UUID (o /conversations recusa outro formato)", { skip }, async () => {
  const L = await load();
  assert.match(L.newClientId(), /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});
