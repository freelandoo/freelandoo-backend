// Lore v2 F5 — o que destrava cada texto do Arquivo (utils/meuMundoArchive.js).
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../src/utils/meuMundoArchive");
const Q = require("../../src/utils/meuMundoQuests");
const { TROPHY_KINDS } = require("../../src/utils/meuMundoAdventure");

const ch = (obj) => new Map(Object.entries(obj));

test("ids únicos e seguros; capítulo de 1 a 10", () => {
  const ids = A.ENTRIES.map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of A.ENTRIES) {
    assert.match(e.id, /^[a-z0-9_]{1,40}$/);
    assert.ok(e.chapter >= 1 && e.chapter <= 10, e.id);
  }
});

test("todo archive:<id> dos capítulos existe e destrava ANTES ou NO passo que pede a leitura", () => {
  for (const c of Q.CHAPTERS)
    c.steps.forEach((s, i) => {
      const { type, arg } = Q.parseCheck(s.check);
      if (type !== "archive") return;
      assert.ok(A.ENTRY_BY_ID.has(arg), arg);
      // chegou no passo (capítulo aberto naquele passo) → já destravou
      assert.ok(A.unlockedIds(ch({ [c.id]: { step: i, done: false } }), new Set()).includes(arg), `${c.id}:${s.key}`);
    });
});

test("toda condição aponta para capítulo, passo ou monstro que existe", () => {
  for (const e of A.ENTRIES)
    for (const u of e.unlock) {
      const [type, a, b] = u.split(":");
      if (type === "win") assert.ok(TROPHY_KINDS.includes(a), u);
      else {
        const c = Q.CHAPTER_BY_ID.get(a);
        assert.ok(c, u);
        if (type === "step") assert.ok(c.steps.some((s) => s.key === b), u);
        else assert.equal(type, "done", u);
      }
    }
});

test("conta nova: nada destravado; fim do cap. 1 destrava a Praça", () => {
  assert.deepEqual(A.unlockedIds(new Map(), new Set()), []);
  assert.deepEqual(A.unlockedIds(ch({ cap1: { step: 5, done: false } }), new Set()), []);
  assert.deepEqual(A.unlockedIds(ch({ cap1: { step: 6, done: true } }), new Set()), ["praca"]);
});

test("passo: antes não, no passo e depois sim; capítulo feito também", () => {
  const idx = Q.CHAPTER_BY_ID.get("cap7").steps.findIndex((s) => s.key === "caderno");
  assert.ok(!A.unlockedIds(ch({ cap7: { step: idx - 1, done: false } }), new Set()).includes("caderno_aeryn"));
  assert.ok(A.unlockedIds(ch({ cap7: { step: idx, done: false } }), new Set()).includes("caderno_aeryn"));
  assert.ok(A.unlockedIds(ch({ cap7: { step: 0, done: true } }), new Set()).includes("caderno_aeryn"));
});

test("vencer o monstro destrava a história dele mesmo sem o capítulo", () => {
  const ids = A.unlockedIds(new Map(), new Set(["ciborgue", "brute"]));
  assert.deepEqual(ids.sort(), ["brutamontes", "ciborgue"]);
});

test("vídeos: um lugar por capítulo e por personagem; lugar estranho recusa", () => {
  assert.equal(A.VIDEO_SLOTS.chapter.length, 10);
  assert.ok(A.isVideoSlot("chapter", "cap1") && A.isVideoSlot("character", "morkhan") && A.isVideoSlot("character", "stone"));
  assert.ok(!A.isVideoSlot("chapter", "cap11") && !A.isVideoSlot("outro", "cap1") && !A.isVideoSlot("character", "../x"));
});
