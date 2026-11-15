// Conta do Baú de doação (mig 460). Função PURA (teste em test/unit).
//
//   bruto (o que o doador pagou)
//   − taxa da doação (Freelandoo, donation_fee_bps — 5%)
//   − tarifa do Mercado Pago (real, apurada; sai de quem recebe)
//   = o que a pessoa ganhou
//   − taxa do saque (Freelandoo, withdraw_fee_bps — 5% do que ela ganhou)
//   = líquido que cai no PIX dela
//
// Tarifa não apurada (null) entra como 0 e volta marcada `processor_estimated`:
// `null` ≠ zero — quem confirma registra o aviso.

function bps(amount, points) {
  return Math.round((Number(amount) * Number(points)) / 10000);
}

function splitBau({ grossCents, donationFeeBps = 500, withdrawFeeBps = 500, processorFeeCents = null }) {
  const gross = Math.max(0, Math.round(Number(grossCents) || 0));
  const platform = Math.min(gross, bps(gross, donationFeeBps));
  const known = processorFeeCents !== null && processorFeeCents !== undefined && Number.isFinite(Number(processorFeeCents));
  const processor = known ? Math.min(gross - platform, Math.max(0, Math.round(Number(processorFeeCents)))) : 0;
  const received = gross - platform - processor;
  const withdraw = Math.min(received, bps(received, withdrawFeeBps));
  return {
    gross_cents: gross,
    platform_fee_cents: platform,
    processor_fee_cents: processor,
    received_cents: received,
    withdraw_fee_cents: withdraw,
    net_cents: received - withdraw,
    processor_estimated: !known,
  };
}

module.exports = { splitBau };
