/**
 * A CONTA DO DINHEIRO DA VENDA NA VITRINE (mig 249) — fonte única.
 *
 * ── O MODELO ─────────────────────────────────────────────────────────────────
 *
 *   quem compra paga  PREÇO + ENTREGA (o add-on "+R$3", opcional)
 *     → a plataforma tira a taxa dela (tb_community_listing_settings)
 *     → o gateway tira a tarifa dele, RATEADA entre as duas partes
 *     → quem vendeu recebe o resto do preço
 *     → quem entregar recebe o resto da entrega
 *
 * E as quatro partes FECHAM exatamente o que o comprador pagou. Isso não é
 * elegância: é a única forma de descobrir que a conta errou. A lição foi paga
 * no agendamento, onde a comissão do afiliado era descontada de um lado e paga
 * de novo pelo webhook — o dinheiro só aparece em falta quando alguém soma.
 *
 * ── ⚠️ A TARIFA DO GATEWAY É RATEADA, E NÃO JOGADA NUM DOS DOIS ─────────────
 *
 * O comprador paga UMA cobrança de `preço + entrega`, então existe UMA tarifa
 * sobre o total. Jogá-la inteira no vendedor faria o vizinho que só quis ajudar
 * com a entrega sair no lucro às custas de quem vendeu; jogá-la inteira no
 * entregador transformaria uma corrida de R$3 em prejuízo quando o produto
 * custa R$200 (a tarifa percentual do produto comeria a entrega inteira).
 *
 * O rateio é PROPORCIONAL ao que cada um traz para a cobrança, e a sobra dos
 * centavos fica com o VENDEDOR — a parte maior, onde um centavo não muda nada,
 * em vez de com uma corrida de R$3, onde muda.
 *
 * ── ⚠️ NENHUM NÚMERO DE TARIFA ESTÁ CRAVADO AQUI ────────────────────────────
 *
 * A mesma venda rende coisas diferentes conforme quem cobra (Stripe cartão
 * hoje; Asaas Pix no dia em que o Alex ligar a credencial). A tarifa entra como
 * PARÂMETRO, sempre — estimada na criação, apurada na confirmação.
 */

const { createLogger } = require("./logger");

const log = createLogger("listingOrder");

/**
 * O que vale quando a linha singleton da mig 249 não existe.
 *
 * ⚠️ TAXA ZERO É O VALOR CERTO AQUI, ao contrário do `bookingFee` (onde zero
 * significaria a plataforma trabalhando de graça por defeito de configuração).
 * A diferença é que a taxa da venda entre vizinhos NASCE zero por decisão — o
 * Alex pediu o checkout e nunca falou em taxa. O fallback concorda com o seed.
 */
const FALLBACK_SETTINGS = Object.freeze({
  platform_fee_cents: 0,
  platform_fee_percent: 0,
  holdback_days: 8,
  confirm_days: 7,
  is_active: true,
});

/**
 * A régua vigente da venda, direto da tabela que a tela de admin escreve.
 *
 * ⚠️ NUNCA CONSTANTE NO SERVICE — lição da mig 244 (a tela de admin da taxa do
 * agendamento existia e mentia por meses).
 */
async function getListingSettings(conn) {
  try {
    const { rows } = await conn.query(
      `SELECT platform_fee_cents, platform_fee_percent, holdback_days,
              confirm_days, is_active
         FROM public.tb_community_listing_settings
        WHERE id = 1
        LIMIT 1`
    );
    if (rows[0]) {
      return {
        platform_fee_cents: Math.max(0, Math.round(Number(rows[0].platform_fee_cents) || 0)),
        platform_fee_percent: Math.max(0, Number(rows[0].platform_fee_percent) || 0),
        holdback_days: Math.max(0, Math.round(Number(rows[0].holdback_days) || 0)),
        confirm_days: Math.max(1, Math.round(Number(rows[0].confirm_days) || 7)),
        is_active: rows[0].is_active !== false,
      };
    }
  } catch (err) {
    // Falha de leitura não pode derrubar uma compra que é válida.
    log.warn("listingOrder.settings.read.fail", { message: err?.message });
  }
  log.warn("listingOrder.settings.missing");
  return { ...FALLBACK_SETTINGS };
}

/**
 * A taxa da plataforma sobre o PREÇO (nunca sobre a entrega).
 *
 * ⚠️ A ENTREGA FICA DE FORA DA BASE de propósito: ela não é receita do
 * vendedor, é o pagamento de um terceiro que vai carregar a sacola. Cobrar
 * taxa sobre ela seria a plataforma tirando uma parte do dinheiro de quem
 * entrega, que é exatamente o que a decisão do delivery recusou.
 *
 * `is_active = FALSE` significa **sem taxa** — o kill-switch de quem quiser
 * rodar a vitrine no zero a zero.
 */
function platformFeeFor(priceCents, settings) {
  if (!settings || settings.is_active === false) return 0;
  const price = Math.max(0, Math.round(Number(priceCents) || 0));
  const fixed = Math.max(0, Math.round(Number(settings.platform_fee_cents) || 0));
  const pct = Math.max(0, Number(settings.platform_fee_percent) || 0);
  const variable = pct > 0 ? Math.round((price * pct) / 100) : 0;
  // A taxa nunca engole o preço inteiro: no limite ela é o preço, e o vendedor
  // fica com zero — nunca com dívida.
  return Math.min(price, fixed + variable);
}

/**
 * Reparte a tarifa do gateway entre o PREÇO e a ENTREGA, proporcionalmente.
 *
 * ⚠️ A SOBRA DOS CENTAVOS FICA COM O VENDEDOR. O arredondamento sempre deixa
 * 0 ou 1 centavo sem dono, e ele precisa ter um: sem regra explícita, as duas
 * partes somariam mais (ou menos) do que a tarifa cobrada e a conta deixaria de
 * fechar. Fica com o lado maior, onde um centavo não muda nada — e não com uma
 * corrida de R$3, onde muda.
 */
function splitProcessorFee({ processorFeeCents, priceCents, deliveryCents }) {
  const fee = Math.max(0, Math.round(Number(processorFeeCents) || 0));
  const price = Math.max(0, Math.round(Number(priceCents) || 0));
  const delivery = Math.max(0, Math.round(Number(deliveryCents) || 0));
  const total = price + delivery;
  if (fee === 0 || total === 0 || delivery === 0) {
    return { price_fee_cents: fee, delivery_fee_cents: 0 };
  }
  // A parte da ENTREGA é a arredondada; a do preço é o que sobra. Assim as
  // duas SEMPRE somam `fee`, qualquer que seja o arredondamento.
  const deliveryFee = Math.min(fee, Math.round((fee * delivery) / total));
  return { price_fee_cents: fee - deliveryFee, delivery_fee_cents: deliveryFee };
}

/**
 * A conta inteira do pedido — a função que o service e o teste compartilham.
 *
 * ⚠️ AS QUATRO PARTES FECHAM O QUE O COMPRADOR PAGOU:
 *   plataforma + gateway + vendedor + entregador === amount_cents
 * É esta identidade que o teste verifica, e é ela que faz um erro de conta
 * aparecer como número em vez de sumir na diferença.
 *
 * ⚠️ NENHUM LÍQUIDO É NEGATIVO. Um produto de R$1 com tarifa fixa de R$1,99
 * chegaria a -99 centavos na subtração crua — e um número negativo aqui viraria
 * DÉBITO na carteira de quem entregou a mercadoria.
 */
function computeOrder({ priceCents, deliveryCents = 0, platformFeeCents = 0, processorFeeCents = 0 }) {
  const price = Math.max(0, Math.round(Number(priceCents) || 0));
  const delivery = Math.max(0, Math.round(Number(deliveryCents) || 0));
  const amount = price + delivery;
  const platform = Math.min(price, Math.max(0, Math.round(Number(platformFeeCents) || 0)));
  const fee = Math.min(amount, Math.max(0, Math.round(Number(processorFeeCents) || 0)));

  const { price_fee_cents, delivery_fee_cents } = splitProcessorFee({
    processorFeeCents: fee,
    priceCents: price,
    deliveryCents: delivery,
  });

  const sellerRaw = price - platform - price_fee_cents;
  const courierRaw = delivery - delivery_fee_cents;
  const seller = Math.max(0, sellerRaw);
  const courier = Math.max(0, courierRaw);

  return {
    amount_cents: amount,
    price_cents: price,
    delivery_cents: delivery,
    platform_fee_cents: platform,
    processor_fee_cents: fee,
    price_fee_cents,
    delivery_fee_cents,
    seller_cents: seller,
    courier_cents: courier,
    /**
     * Quanto a plataforma ficou devendo à própria conta por causa dos pisos em
     * zero. Zero no caso normal. É o sinal de que o preço ficou abaixo do que a
     * tarifa consegue cobrir — não é erro, é calibração ruim, e sai no log.
     */
    shortfall_cents: Math.max(0, -sellerRaw) + Math.max(0, -courierRaw),
  };
}

module.exports = {
  FALLBACK_SETTINGS,
  getListingSettings,
  platformFeeFor,
  splitProcessorFee,
  computeOrder,
};
