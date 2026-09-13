// test/unit/bookingFee.test.js
//
// A conta do dinheiro do agendamento (mig 244). É *unit* e não e2e de
// propósito: `professionalNet` e `estimateProcessorFee` são puras, e
// `resolvePlatformFee` só precisa de um `conn` com `query` — dá para exercitar
// a decisão inteira sem Postgres.
const test = require("node:test");
const assert = require("node:assert");

const {
  FALLBACK_PLATFORM_FEE_CENTS,
  resolvePlatformFee,
  estimateProcessorFee,
  professionalNet,
} = require("../../src/utils/bookingFee");

/** Conn de mentira: devolve a linha de `tb_booking_fee_settings` que o teste quiser. */
const connWith = (row) => ({ query: async () => ({ rows: row ? [row] : [] }) });
const connThatFails = () => ({
  query: async () => {
    throw new Error("conexão caiu");
  },
});

// ─────────────────────────────────────────────────────────────────────────────
// A taxa da plataforma sai da TABELA, não de uma constante
// ─────────────────────────────────────────────────────────────────────────────

test("a taxa é a linha de admin: parte fixa mais percentual sobre o preço", async () => {
  const conn = connWith({ service_fee_cents: 100, stripe_fee_percent: 5, is_active: true });
  // R$ 1,00 fixo + 5% de R$ 40,00 = R$ 1,00 + R$ 2,00
  assert.strictEqual(await resolvePlatformFee(conn, 4000), 300);
});

test("com o percentual em zero vale só a parte fixa — que é o modelo da mig 244", async () => {
  const conn = connWith({ service_fee_cents: 100, stripe_fee_percent: 0, is_active: true });
  assert.strictEqual(await resolvePlatformFee(conn, 4000), 100);
  // E não muda com o preço: R$ 1,00 por agendamento é R$ 1,00 em qualquer corte.
  assert.strictEqual(await resolvePlatformFee(conn, 100000), 100);
});

test("`is_active = FALSE` é o kill-switch: a plataforma não cobra nada", async () => {
  const conn = connWith({ service_fee_cents: 100, stripe_fee_percent: 5, is_active: false });
  assert.strictEqual(await resolvePlatformFee(conn, 4000), 0);
});

test("sem a linha singleton o fallback NÃO é zero — configuração quebrada não vira doação", async () => {
  assert.strictEqual(await resolvePlatformFee(connWith(null), 4000), FALLBACK_PLATFORM_FEE_CENTS);
  assert.strictEqual(FALLBACK_PLATFORM_FEE_CENTS, 100);
});

test("falha de leitura não derruba um agendamento válido — cai no fallback", async () => {
  assert.strictEqual(await resolvePlatformFee(connThatFails(), 4000), FALLBACK_PLATFORM_FEE_CENTS);
});

test("valor torto na tabela não vira taxa negativa", async () => {
  const conn = connWith({ service_fee_cents: -500, stripe_fee_percent: -10, is_active: true });
  assert.strictEqual(await resolvePlatformFee(conn, 4000), 0);
});

// ─────────────────────────────────────────────────────────────────────────────
// ⚠️ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA TRAVAR
//
// A comissão do afiliado é ADITIVA (mig 090): o cliente paga `preço + comissão`
// e a comissão é DO AFILIADO. Descontando só taxa e tarifa de um `charge` que
// já a carrega, o profissional receberia o dinheiro do afiliado junto — e o
// afiliado seria pago de novo pelo webhook. A mesma comissão, duas vezes.
// ─────────────────────────────────────────────────────────────────────────────

test("a comissão do afiliado NÃO vai para o profissional", () => {
  const servico = 4000;      // R$ 40,00
  const comissao = 400;      // 10%
  const charge = servico + comissao;
  const taxa = 100;          // R$ 1,00
  const tarifa = 169;        // tarifa do gateway

  const liquido = professionalNet({
    chargeAmountCents: charge,
    platformFeeCents: taxa,
    processorFeeCents: tarifa,
    affiliateCommissionCents: comissao,
  });

  // Sem o desconto da comissão isto daria 4131 — R$ 4,00 a mais, que é
  // exatamente o dinheiro do afiliado indo parar no bolso errado.
  assert.strictEqual(liquido, 3731);
  assert.strictEqual(liquido, servico - taxa - tarifa);
});

test("as quatro partes fecham EXATAMENTE o que o cliente pagou", () => {
  const servico = 4000;
  const comissao = 400;
  const charge = servico + comissao;
  const taxa = 100;
  const tarifa = 169;

  const profissional = professionalNet({
    chargeAmountCents: charge,
    platformFeeCents: taxa,
    processorFeeCents: tarifa,
    affiliateCommissionCents: comissao,
  });

  assert.strictEqual(taxa + tarifa + comissao + profissional, charge);
});

test("sem afiliado a conta é o preço menos a taxa e a tarifa", () => {
  const liquido = professionalNet({
    chargeAmountCents: 4000,
    platformFeeCents: 100,
    processorFeeCents: 169,
  });
  assert.strictEqual(liquido, 3731);
});

test("o líquido NUNCA é negativo — a plataforma não debita quem trabalhou", () => {
  // Sobrancelha de R$ 5 no Pix: R$ 1,99 de tarifa + R$ 1,00 de taxa.
  assert.strictEqual(
    professionalNet({ chargeAmountCents: 500, platformFeeCents: 100, processorFeeCents: 199 }),
    201
  );
  // Caso patológico: tarifa maior que a cobrança inteira.
  assert.strictEqual(
    professionalNet({ chargeAmountCents: 300, platformFeeCents: 100, processorFeeCents: 900 }),
    0
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// A estimativa da tarifa — o número que a confirmação substitui
// ─────────────────────────────────────────────────────────────────────────────

test("a estimativa sai da régua admin-editável da Loja", () => {
  const governanca = {
    processor_fee_percent_fallback: 3.99,
    processor_fee_fixed_cents_fallback: 39,
  };
  // 3,99% de R$ 40,00 = R$ 1,596 → 160 + 39
  assert.deepStrictEqual(estimateProcessorFee(4000, governanca), {
    cents: 199,
    source: "fallback",
  });
});

test("estimativa sobre cobrança zero é zero — e não a parte fixa", () => {
  const governanca = {
    processor_fee_percent_fallback: 3.99,
    processor_fee_fixed_cents_fallback: 39,
  };
  assert.deepStrictEqual(estimateProcessorFee(0, governanca), { cents: 0, source: "fallback" });
});

test("sem régua configurada a estimativa é zero, e o valor REAL chega na confirmação", () => {
  assert.deepStrictEqual(estimateProcessorFee(4000, null), { cents: 0, source: "fallback" });
});

test("a estimativa se declara `fallback` — é assim que se descobre repasse feito no palpite", () => {
  assert.strictEqual(estimateProcessorFee(4000, {}).source, "fallback");
});
