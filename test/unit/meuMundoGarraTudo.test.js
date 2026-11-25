// 24/11/2026 (Alex): o Boxe virou o Coliseu (sem prêmio); o fragmento do Pó de Garra cai em toda vitória.
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const L = require("../../src/utils/mmItems/catalog/loot");

test("fragmento do Pó de Garra: chance no FIM da lista de Lâminas, rua, minijogos e todos os Domínios", () => {
  const ids = Object.keys(L.TABLES).filter((id) => /^(fight:laminas|mob:|minigame:|domain:)/.test(id));
  assert.ok(ids.length >= 8 + 70);
  for (const id of ids) {
    const ch = L.TABLES[id].chance;
    const last = ch[ch.length - 1];
    assert.equal(last.id, "frag_po_garra", id);
    assert.equal(last.p, 0.35, id);
    assert.equal(last.win, true, id);
  }
  assert.equal((L.TABLES["fight:hall"].chance || []).some((x) => x.id === "frag_po_garra"), false);
});
