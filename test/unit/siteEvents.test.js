// A lista fechada de eventos do site (mig 235).
//
// Unit e não e2e de propósito: `isSiteEventKind` é função pura e é a FRONTEIRA
// DE CONFIANÇA da porta anônima — o `kind` que passa por ela vira valor de uma
// coluna com CHECK. Se ela afrouxar, a gravação estoura em produção; se ela
// apertar demais, um evento legítimo some sem erro nenhum.

const test = require("node:test");
const assert = require("node:assert");
const {
  SITE_EVENT_KINDS,
  isSiteEventKind,
  VIEW,
  BOOKING_CLICK,
  WHATSAPP_CLICK,
} = require("../../src/utils/siteEvents");

test("aceita exatamente os três eventos do CHECK da mig 235", () => {
  assert.deepStrictEqual([...SITE_EVENT_KINDS], ["view", "booking_click", "whatsapp_click"]);
  for (const k of [VIEW, BOOKING_CLICK, WHATSAPP_CLICK]) {
    assert.strictEqual(isSiteEventKind(k), true, k);
  }
});

test("recusa qualquer outra coisa, inclusive o que parece um evento", () => {
  for (const k of ["click", "views", "VIEW", "view ", "", null, undefined, 1, {}, []]) {
    assert.strictEqual(isSiteEventKind(k), false, String(k));
  }
});

test("a lista é congelada — ninguém acrescenta um kind em tempo de execução", () => {
  assert.throws(() => SITE_EVENT_KINDS.push("outro"));
});
