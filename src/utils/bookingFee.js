/**
 * A CONTA DO DINHEIRO DO AGENDAMENTO — fonte única.
 *
 * ── O MODELO, EM UMA LINHA ───────────────────────────────────────────────────
 *   o cliente paga o PREÇO PUBLICADO
 *   → a plataforma tira a taxa dela (tb_booking_fee_settings)
 *   → o gateway tira a tarifa dele
 *   → o profissional recebe o resto
 *
 * ⚠️ NÃO EXISTE GROSS-UP AQUI, e a ausência é decisão (Alex, 2026-09-13). A
 * Loja repassa a tarifa ao comprador (`StoreGovernanceService.computeFees`
 * calcula um `display_price` maior que o preço do vendedor); o agendamento faz
 * o OPOSTO, porque o site do cliente publica uma tabela de preços e promete
 * "preço na mesa". Um corte anunciado a R$ 40 que fecha em R$ 42,77 no
 * checkout contradiz a única página que a pessoa leu inteira. Quem absorve a
 * tarifa é o profissional — como já acontece com maquininha, e por menos:
 * 2,99% + R$ 0,49 no cartão do Asaas contra os 3–4% da maquininha.
 *
 * ⚠️ POR ISSO NÃO REUSAR `computeFees` DA LOJA: as duas funções respondem
 * perguntas opostas (quem paga a tarifa), e reusar faria o agendamento
 * começar a inflar preço no dia em que alguém mexesse na régua da Loja.
 */

const { createLogger } = require("./logger");

const log = createLogger("bookingFee");

/**
 * O que vale quando a linha singleton da mig 018 não existe.
 *
 * ⚠️ NÃO É ZERO, de propósito. Banco sem a linha é banco quebrado, e zero
 * significaria "a plataforma trabalha de graça" — um defeito de configuração
 * virando doação silenciosa. R$ 1,00 é o valor com que a mig 244 semeia a
 * tabela, então o fallback concorda com ela em vez de inventar um terceiro
 * número.
 */
const FALLBACK_PLATFORM_FEE_CENTS = 100;

/**
 * A taxa da plataforma para um agendamento, em centavos.
 *
 * Lê `tb_booking_fee_settings` — a MESMA linha que a tela de admin escreve.
 * Antes da mig 244 isto era a constante `PLATFORM_FEE_CENTS = 1000` do
 * `BookingService`, e a tela de admin não governava nada (em produção ela
 * estava com 5% + R$ 2,50 sem efeito nenhum).
 *
 * `is_active = FALSE` significa **sem taxa da plataforma** — é a leitura
 * natural da coluna, e é o kill-switch de quem quiser rodar o agendamento no
 * zero a zero. Note que nesse modo a plataforma segue sem receber nada e o
 * profissional é quem fica com tudo menos a tarifa do gateway.
 *
 * @param {import("pg").Pool|import("pg").PoolClient} conn
 * @param {number} servicePriceCents preço do serviço (base do percentual)
 * @returns {Promise<number>} centavos, nunca negativo
 */
async function resolvePlatformFee(conn, servicePriceCents) {
  const price = Math.max(0, Math.round(Number(servicePriceCents) || 0));
  let row = null;
  try {
    const { rows } = await conn.query(
      `SELECT service_fee_cents, stripe_fee_percent, is_active
         FROM public.tb_booking_fee_settings
        WHERE id = 1
        LIMIT 1`
    );
    row = rows[0] || null;
  } catch (err) {
    // Falha de leitura não pode derrubar um agendamento que é válido.
    log.warn("bookingFee.settings.read.fail", { message: err?.message });
  }

  if (!row) {
    log.warn("bookingFee.settings.missing", { fallback_cents: FALLBACK_PLATFORM_FEE_CENTS });
    return FALLBACK_PLATFORM_FEE_CENTS;
  }
  if (row.is_active === false) return 0;

  const fixed = Math.max(0, Math.round(Number(row.service_fee_cents) || 0));
  const pct = Math.max(0, Number(row.stripe_fee_percent) || 0);
  const variable = pct > 0 ? Math.round((price * pct) / 100) : 0;
  return fixed + variable;
}

/**
 * Estimativa da tarifa do gateway, usada só até o valor REAL chegar.
 *
 * ⚠️ ELA QUASE NUNCA VIRA DINHEIRO, e é importante saber por quê: o repasse ao
 * profissional (`BookingPayoutService`) só acontece DEPOIS da confirmação, e é
 * na confirmação que a tarifa apurada (`PaymentGateway.getChargeFee`)
 * substitui esta estimativa. A estimativa existe para a linha não mentir na
 * janela entre criar e confirmar — não para governar repasse.
 *
 * A régua vem de `tb_store_governance` (admin-editável) porque ela já é a
 * resposta da plataforma para "quanto o processador cobra"; um segundo lugar
 * guardando a mesma suposição divergiria do primeiro na próxima renegociação
 * de tarifa.
 *
 * ⚠️ Ela é calibrada para a tarifa do STRIPE (3,99% + R$ 0,39 no default da
 * mig 073). A do Asaas é 2,99% + R$ 0,49 no cartão e R$ 1,99 fixos no Pix —
 * perto o bastante para uma estimativa, e o número certo chega na confirmação.
 * Ajustar a régua é uma linha no painel da Loja.
 *
 * @returns {{ cents: number, source: "fallback" }}
 */
function estimateProcessorFee(chargeAmountCents, governanceSettings) {
  const amount = Math.max(0, Math.round(Number(chargeAmountCents) || 0));
  if (amount === 0) return { cents: 0, source: "fallback" };
  const pct = Math.max(0, Number(governanceSettings?.processor_fee_percent_fallback) || 0);
  const fixed = Math.max(0, Math.round(Number(governanceSettings?.processor_fee_fixed_cents_fallback) || 0));
  return { cents: Math.round((amount * pct) / 100) + fixed, source: "fallback" };
}

/**
 * O que sobra para o profissional.
 *
 * ⚠️ A COMISSÃO DO AFILIADO SAI DAQUI, e esquecê-la paga a mesma comissão DUAS
 * VEZES. Ela é ADITIVA (mig 090): o cliente paga `preço + comissão`, e a
 * comissão é do afiliado — não do profissional. Descontando só taxa e tarifa
 * de um `charge` que já carrega a comissão, o profissional receberia o
 * dinheiro do afiliado junto, e o afiliado seria pago de novo pelo webhook.
 *
 * Com ela na conta as partes FECHAM exatamente:
 *   plataforma + gateway + afiliado + profissional = o que o cliente pagou
 * e o profissional recebe, na prática, `preço − taxa − tarifa` — que é a
 * promessa de "comissão aditiva não reduz o que o profissional recebe".
 *
 * ⚠️ NUNCA NEGATIVO. Serviço barato com tarifa fixa alta (uma sobrancelha de
 * R$ 5 no Pix, com R$ 1,99 de tarifa e R$ 1,00 de taxa) pode chegar perto do
 * zero, e um número negativo aqui viraria **débito na carteira do
 * profissional** — a plataforma cobrando dele por ter trabalhado. Fixar no
 * zero é a perda ficar com quem escolheu o preço, não com quem prestou o
 * serviço.
 */
function professionalNet({
  chargeAmountCents,
  platformFeeCents,
  processorFeeCents,
  affiliateCommissionCents = 0,
}) {
  const charge = Math.max(0, Math.round(Number(chargeAmountCents) || 0));
  const platform = Math.max(0, Math.round(Number(platformFeeCents) || 0));
  const processor = Math.max(0, Math.round(Number(processorFeeCents) || 0));
  const affiliate = Math.max(0, Math.round(Number(affiliateCommissionCents) || 0));
  return Math.max(0, charge - platform - processor - affiliate);
}

module.exports = {
  FALLBACK_PLATFORM_FEE_CENTS,
  resolvePlatformFee,
  estimateProcessorFee,
  professionalNet,
};
