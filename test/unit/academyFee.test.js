// Mensalidade de academia pela Freelandoo (mig 310): o dinheiro e o calendário.
const test = require("node:test");
const assert = require("node:assert");
const { splitFee, normalizePixKey, hintOf } = require("../../src/utils/academyFee");
const {
  localDay,
  monthBounds,
  shiftYm,
  monthSummary,
  currentStreak,
} = require("../../src/utils/academyCalendar");

test("as partes somam exatamente o que o aluno pagou", () => {
  const m = splitFee({ amountCents: 12000, platformFeeCents: 250, processorFeeCents: 599 });
  assert.deepStrictEqual(
    [m.processor_fee_cents, m.platform_fee_cents, m.net_cents],
    [599, 250, 11151]
  );
  assert.strictEqual(m.processor_fee_cents + m.platform_fee_cents + m.net_cents, 12000);
  assert.strictEqual(m.shortfall_cents, 0);
});

test("mensalidade minúscula: encolhe a parte da Freelandoo, nunca o repasse fica negativo", () => {
  const m = splitFee({ amountCents: 300, platformFeeCents: 250, processorFeeCents: 100 });
  assert.strictEqual(m.net_cents, 0);
  assert.strictEqual(m.platform_fee_cents, 200);
  assert.strictEqual(m.shortfall_cents, 50);
  const z = splitFee({ amountCents: 100, platformFeeCents: 250, processorFeeCents: 500 });
  assert.deepStrictEqual([z.processor_fee_cents, z.platform_fee_cents, z.net_cents], [100, 0, 0]);
});

test("chave PIX é normalizada e conferida pelo tipo", () => {
  assert.deepStrictEqual(normalizePixKey("phone", "(11) 98765-4321"), { key: "+5511987654321" });
  assert.deepStrictEqual(normalizePixKey("email", " Academia@X.com "), { key: "academia@x.com" });
  assert.ok(normalizePixKey("cpf", "111.111.111-11").error);
  assert.ok(normalizePixKey("random", "não-é-uuid").error);
  assert.ok(normalizePixKey("boleto", "x").error);
  assert.strictEqual(hintOf("+5511987654321"), "4321");
});

test("dia local é o de Brasília, não o de UTC", () => {
  // 02:30 UTC do dia 5 = 23:30 do dia 4 em Brasília.
  assert.strictEqual(localDay(new Date("2026-10-05T02:30:00Z")), "2026-10-04");
});

test("limites do mês e deslizar entre meses", () => {
  assert.deepStrictEqual(monthBounds("2026-02"), { first: "2026-02-01", next: "2026-03-01", days: 28 });
  assert.strictEqual(monthBounds("2026-12").next, "2027-01-01");
  assert.strictEqual(shiftYm("2026-01", -1), "2025-12");
  assert.strictEqual(shiftYm("2026-12", 1), "2027-01");
});

test("✕ só conta dias que já passaram e são depois do vínculo", () => {
  const s = monthSummary({
    ym: "2026-10",
    presentDays: ["2026-10-10", "2026-10-12", "2026-10-27"],
    linkedDay: "2026-10-10",
    todayDay: "2026-10-27",
  });
  // de 10 a 26 = 17 dias passados; hoje (27) não conta.
  assert.strictEqual(s.elapsed, 17);
  assert.strictEqual(s.present, 3);
});

test("a sequência não quebra porque hoje ainda não veio", () => {
  const days = ["2026-10-24", "2026-10-25", "2026-10-26"];
  assert.strictEqual(currentStreak(days, "2026-10-27"), 3);
  assert.strictEqual(currentStreak([...days, "2026-10-27"], "2026-10-27"), 4);
  assert.strictEqual(currentStreak(["2026-10-20"], "2026-10-27"), 0);
});
