// test/unit/accountingTax.test.js
// As contas do painel de Contabilidade (mig 277): DAS do Simples, Fator R e
// acréscimos de guia em atraso. Unit de propósito — tudo é função pura.
const test = require("node:test");
const assert = require("node:assert");

const {
  effectiveRate,
  estimateDas,
  computeLateCharges,
} = require("../../src/utils/accountingTax");

test("alíquota efetiva: 1ª faixa é a nominal, e sem receita não divide por zero", () => {
  assert.strictEqual(effectiveRate("III", 100000).rate, 0.06);
  assert.strictEqual(effectiveRate("III", 0).rate, 0.06);
  assert.strictEqual(effectiveRate("V", 0).rate, 0.155);
});

test("alíquota efetiva: 2ª faixa do Anexo III aplica a dedução", () => {
  // 240 mil × 11,2% − 9.360 = 17.520 → 7,3%
  const r = effectiveRate("III", 240000);
  assert.strictEqual(r.bracket, 2);
  assert.ok(Math.abs(r.rate - 0.073) < 1e-9);
});

test("Fator R: folha ≥ 28% cai no III, abaixo cai no V", () => {
  const base = { anexo: "III_V", revenueMonthCents: 1000000, rbt12Cents: 12000000 };
  assert.strictEqual(estimateDas({ ...base, payroll12Cents: 3360000 }).anexo_applied, "III");
  assert.strictEqual(estimateDas({ ...base, payroll12Cents: 3359999 }).anexo_applied, "V");
});

test("Fator R sem receita nem folha cai no V (lado conservador)", () => {
  const r = estimateDas({ anexo: "III_V", revenueMonthCents: 0, rbt12Cents: 0 });
  assert.strictEqual(r.anexo_applied, "V");
  assert.strictEqual(r.das_cents, 0);
});

test("DAS de R$ 10.000 na 1ª faixa do III = R$ 600", () => {
  const r = estimateDas({ anexo: "III", revenueMonthCents: 1000000, rbt12Cents: 5000000 });
  assert.strictEqual(r.das_cents, 60000);
});

test("anexo inválido é recusado", () => {
  assert.ok(estimateDas({ anexo: "VI", revenueMonthCents: 1 }).error);
});

test("em dia: sem multa nem juros", () => {
  const r = computeLateCharges({ amountCents: 10000, dueDate: "2026-08-20", payDate: "2026-08-20" });
  assert.strictEqual(r.total_cents, 10000);
  assert.strictEqual(r.days_late, 0);
});

test("atraso no próprio mês do vencimento: só multa, sem juros", () => {
  const r = computeLateCharges({ amountCents: 10000, dueDate: "2026-08-10", payDate: "2026-08-20" });
  assert.strictEqual(r.days_late, 10);
  assert.strictEqual(r.interest_rate, 0);
  assert.strictEqual(r.fine_cents, 330);
});

test("multa para em 20%", () => {
  const r = computeLateCharges({ amountCents: 10000, dueDate: "2026-01-10", payDate: "2026-10-09" });
  assert.strictEqual(r.fine_rate, 0.2);
});

test("juros: Selic dos meses do meio + 1% no mês do pagamento", () => {
  // venceu em ago, paga em out → Selic de set + 1% de out
  const r = computeLateCharges({
    amountCents: 23635,
    dueDate: "2026-08-10",
    payDate: "2026-10-09",
    selicByMonth: { "2026-09": 0.012 },
  });
  assert.strictEqual(r.days_late, 60);
  assert.ok(Math.abs(r.fine_rate - 0.198) < 1e-9);
  assert.ok(Math.abs(r.interest_rate - 0.022) < 1e-9);
  assert.strictEqual(r.estimated, false);
  assert.deepStrictEqual(r.selic_months.map((m) => m.month), ["2026-09"]);
});

test("mês sem Selic cadastrada usa o padrão e marca estimativa", () => {
  const r = computeLateCharges({ amountCents: 10000, dueDate: "2026-08-10", payDate: "2026-10-09" });
  assert.strictEqual(r.estimated, true);
});

test("data torta devolve erro em vez de NaN", () => {
  assert.ok(computeLateCharges({ amountCents: 1, dueDate: "x", payDate: "2026-01-01" }).error);
});
