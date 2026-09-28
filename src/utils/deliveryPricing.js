/**
 * A CONTA DO DINHEIRO DO DELIVERY ENTRE VIZINHOS — fonte única.
 *
 * ── O MODELO, EM UMA LINHA ───────────────────────────────────────────────────
 *   quem pede paga o PREÇO DA TABELA
 *   → o gateway tira a tarifa dele
 *   → quem entrega recebe o resto
 *
 * ⚠️ NÃO HÁ TAXA DA PLATAFORMA AQUI, e a ausência é decisão do Alex: a corrida
 * de comida vale R$3, e tirar uma taxa de R$3 deixaria o vizinho carregando
 * sacola por moedas. A plataforma fica com zero e ainda paga a tarifa quando o
 * entregador cancela (o estorno é integral). Se um dia isso mudar, o lugar é
 * aqui — e não uma constante nova espalhada pelo service.
 *
 * ⚠️ QUEM ABSORVE A TARIFA É QUEM ENTREGA (decisão do Alex, levantada e
 * mantida duas vezes). É a mesma escolha do agendamento (`utils/bookingFee.js`)
 * e o oposto da Loja, que repassa a tarifa ao comprador inflando o preço de
 * tela. Aqui o preço anunciado é o preço pago: "R$3" na tela de quem pede é
 * R$3 no cartão dele.
 *
 * ── ⚠️ O NÚMERO LÍQUIDO NÃO PODE SER CRAVADO EM LUGAR NENHUM ────────────────
 *
 * A MESMA corrida de R$3 rende coisas diferentes conforme quem estiver
 * cobrando (ordens de grandeza de 2026-09-16, NÃO medidas em extrato):
 *
 *   Stripe cartão (3,99% + R$0,39) — legado, ainda cobra → líquido ~R$2,49
 *   Mercado Pago Pix (~0,99%)      — o escolhido        → líquido ~R$2,97
 *   Asaas Pix (R$1,99 FIXO)        — REMOVIDO           → líquido  R$1,01
 *
 * ⚠️ FOI ESTA LINHA QUE MATOU O ASAAS: tarifa FIXA come dois terços de uma
 * corrida de R$3. Tarifa PERCENTUAL come centavos. Como praticamente nenhum
 * ticket da Freelandoo passa de R$150, o ponto em que a fixa ganha da
 * percentual (~R$201) nunca é alcançado.
 *
 * Escrever "R$2,49" ou "R$2,97" em qualquer lugar — código, teste ou tela —
 * cria um número que fica errado no dia do switch, sem ninguém perceber. A
 * conta sai SEMPRE do `PaymentGateway` ativo.
 */

const { createLogger } = require("./logger");

const log = createLogger("deliveryPricing");

/**
 * Os tipos de corrida. A lista é FECHADA aqui e no CHECK da mig 248 — os dois
 * lugares, porque o valor vira literal no INSERT.
 *
 * ⚠️ TIPO NOVO entra nos DOIS, mais uma linha no seed da tabela de preços.
 * Faltando no CHECK, o INSERT estoura; faltando no seed, o chamado nasce sem
 * preço e o service recusa em voz alta — que é o comportamento certo, mas
 * ninguém entende por quê.
 */
const DELIVERY_KINDS = Object.freeze(["food", "parcel", "moving", "bulky"]);

/**
 * O que vale quando a tabela de preços não responde.
 *
 * ⚠️ NÃO É ZERO, de propósito, e não é "um preço qualquer": banco sem a linha é
 * banco quebrado, e zero significaria uma corrida de graça — um defeito de
 * configuração virando trabalho não pago. Os valores são os mesmos com que a
 * mig 248 semeia a tabela, para o fallback CONCORDAR com ela em vez de
 * inventar um terceiro número.
 */
const FALLBACK_PRICES = Object.freeze({
  food: 300,
  parcel: 400,
  moving: 5000,
  bulky: 5000,
});

const FALLBACK_EXPIRES_MINUTES = Object.freeze({
  // Comida é perecível: o chamado perde o sentido em duas horas.
  food: 120,
  parcel: 1440,
  moving: 1440,
  bulky: 1440,
});

/** Quantos cancelamentos, em quantos dias, e por quanto tempo trava. */
const STRIKE_LIMIT = 3;
const STRIKE_WINDOW_DAYS = 7;
const STRIKE_BLOCK_HOURS = 24;

function isDeliveryKind(kind) {
  return typeof kind === "string" && DELIVERY_KINDS.includes(kind);
}

/**
 * A tabela de preços vigente, direto da tabela que a tela de admin escreve.
 *
 * ⚠️ NUNCA CONSTANTE NO SERVICE. Lição já paga na mig 244: a taxa do
 * agendamento era `PLATFORM_FEE_CENTS = 1000` no código enquanto a tela de
 * admin escrevia noutro lugar — em produção havia 5% + R$2,50 configurados
 * sem efeito nenhum. Tela morta é ruim; tela morta que MENTE é pior, porque a
 * pessoa decide preço olhando para ela.
 *
 * @returns {Promise<Array<{kind, label, price_cents, expires_minutes, confirm_hours, is_active}>>}
 */
async function listDeliveryTypes(conn, { onlyActive = true } = {}) {
  try {
    const { rows } = await conn.query(
      `SELECT kind, label, price_cents, expires_minutes, confirm_hours,
              sort_order, is_active
         FROM public.tb_community_delivery_settings
        ${onlyActive ? "WHERE is_active = TRUE" : ""}
        ORDER BY sort_order ASC, kind ASC`
    );
    if (rows.length) return rows;
  } catch (err) {
    // Falha de leitura não pode derrubar a tela inteira do delivery.
    log.warn("delivery.settings.read.fail", { message: err?.message });
  }
  // Banco sem a linha: devolve o mesmo que a migration semeia.
  return DELIVERY_KINDS.map((kind, i) => ({
    kind,
    label: kind,
    price_cents: FALLBACK_PRICES[kind],
    expires_minutes: FALLBACK_EXPIRES_MINUTES[kind],
    confirm_hours: 24,
    sort_order: i + 1,
    is_active: true,
  }));
}

/** A linha de um tipo. `null` quando o tipo não existe ou está desligado. */
async function getDeliveryType(conn, kind, { onlyActive = true } = {}) {
  if (!isDeliveryKind(kind)) return null;
  const rows = await listDeliveryTypes(conn, { onlyActive });
  return rows.find((r) => r.kind === kind) || null;
}

/**
 * Estimativa da tarifa do gateway, usada só até o valor REAL chegar.
 *
 * ⚠️ ELA QUASE NUNCA VIRA DINHEIRO: o repasse só nasce na CONFIRMAÇÃO da
 * entrega, e antes disso a tarifa apurada (`PaymentGateway.getChargeFee`) já
 * substituiu esta estimativa. Ela existe para a linha não mentir na janela
 * entre aceitar e confirmar — não para governar repasse.
 *
 * A régua vem de `tb_store_governance` (admin-editável) porque ela já é a
 * resposta da plataforma para "quanto o processador cobra"; um segundo lugar
 * guardando a mesma suposição divergiria do primeiro na próxima renegociação.
 * É exatamente o que `bookingFee.estimateProcessorFee` faz, e é de propósito
 * que as duas leiam a MESMA régua.
 *
 * @returns {{ cents: number, source: "fallback" }}
 */
function estimateProcessorFee(chargeAmountCents, governanceSettings) {
  const amount = Math.max(0, Math.round(Number(chargeAmountCents) || 0));
  if (amount === 0) return { cents: 0, source: "fallback" };
  const pct = Math.max(0, Number(governanceSettings?.processor_fee_percent_fallback) || 0);
  const fixed = Math.max(
    0,
    Math.round(Number(governanceSettings?.processor_fee_fixed_cents_fallback) || 0)
  );
  return { cents: Math.round((amount * pct) / 100) + fixed, source: "fallback" };
}

/**
 * O que sobra para quem entrega.
 *
 * ⚠️ NUNCA NEGATIVO, e este é o caso concreto que a trava existe para impedir:
 * uma corrida de comida de R$3,00 com uma tarifa FIXA de R$1,99 (era a do Asaas
 * Pix, já removido) deixa R$1,01; com uma tarifa fixa maior que o preço — que é
 * o que acontece num pedido de R$1,50 —, a subtração crua daria
 * NEGATIVO — e um número negativo aqui viraria **débito na carteira de quem
 * carregou a sacola**, a plataforma cobrando dele por ter trabalhado. Fixar no
 * zero é a perda ficar com quem calibrou o preço, não com quem entregou.
 *
 * ⚠️ E ZERO NÃO É "DE GRAÇA": é o sinal de que a tabela de preços está mal
 * calibrada para a tarifa vigente. A tela de quem entrega mostra este número
 * ANTES de ele aceitar (ver `courierNetPreview`), então ele nunca descobre na
 * corrida seguinte.
 */
function courierNet({ chargeAmountCents, processorFeeCents, platformFeeCents = 0 }) {
  const charge = Math.max(0, Math.round(Number(chargeAmountCents) || 0));
  const processor = Math.max(0, Math.round(Number(processorFeeCents) || 0));
  const platform = Math.max(0, Math.round(Number(platformFeeCents) || 0));
  return Math.max(0, charge - processor - platform);
}

/** A taxa que o delivery deixa para a plataforma se ninguém configurou (mig 267). */
const FALLBACK_DELIVERY_FEE_PERCENT = 3;

/**
 * A parte da Freelandoo numa corrida (mig 267, decisão do Alex: 3%).
 *
 * ⚠️ SAI DE QUEM ENTREGA, como a tarifa do gateway — quem pede continua
 * pagando o preço publicado. A régua é `delivery_fee_percent` da MESMA linha
 * que governa a venda na vitrine (`getListingSettings`), e `is_active = FALSE`
 * naquela linha zera as duas taxas juntas: é um kill-switch só.
 *
 * ⚠️ Sem configuração a taxa é 3%, não zero: banco sem a linha é banco
 * quebrado, e zero seria a decisão virando doação silenciosa.
 *
 * Nunca maior que a própria corrida — no limite o entregador fica com zero,
 * nunca com dívida.
 */
function deliveryPlatformFee(priceCents, settings) {
  const price = Math.max(0, Math.round(Number(priceCents) || 0));
  if (!price) return 0;
  if (settings && settings.is_active === false) return 0;
  const raw = settings?.delivery_fee_percent;
  const pct =
    raw === undefined || raw === null || !Number.isFinite(Number(raw))
      ? FALLBACK_DELIVERY_FEE_PERCENT
      : Math.max(0, Number(raw));
  return Math.min(price, Math.round((price * pct) / 100));
}

/**
 * O LÍQUIDO que a tela de quem entrega mostra, antes de ele aceitar.
 *
 * ⚠️ A TELA MOSTRA O LÍQUIDO, NÃO O BRUTO — decisão registrada no brief. Se o
 * card anuncia "R$3" e caem R$1,01 na carteira, o vizinho descobre na primeira
 * corrida e não faz a segunda. O número vem da MESMA estimativa que a cobrança
 * vai usar, então preview e realidade só divergem pela diferença entre a
 * tarifa estimada e a apurada — que é pequena e sempre a favor de quem entrega
 * ou contra, mas nunca uma surpresa de ordem de grandeza.
 */
function courierNetPreview(priceCents, governanceSettings, listingSettings) {
  const fee = estimateProcessorFee(priceCents, governanceSettings);
  const platform = deliveryPlatformFee(priceCents, listingSettings);
  return {
    gross_cents: Math.max(0, Math.round(Number(priceCents) || 0)),
    estimated_fee_cents: fee.cents,
    platform_fee_cents: platform,
    net_cents: courierNet({
      chargeAmountCents: priceCents,
      processorFeeCents: fee.cents,
      platformFeeCents: platform,
    }),
  };
}

/* ─── Faixas de peso (mig 266) ────────────────────────────────────────────── */

/**
 * As faixas de peso do delivery. Lista FECHADA aqui e no CHECK da mig 266 —
 * faixa nova entra nos DOIS, mais uma linha no seed.
 *
 * O preço de um chamado por peso é o que quem pede OFERECE, nunca menor que o
 * piso da faixa. Acima de 10 kg a faixa é negociada: o vizinho pode aceitar a
 * oferta ou fazer uma contraproposta.
 */
const WEIGHT_BANDS = Object.freeze(["w1", "w3", "w6", "w10", "w10p"]);

/**
 * O que vale quando a tabela de faixas não responde. Os MESMOS números do seed
 * da mig 266, pela regra do FALLBACK_PRICES acima: banco sem a linha não pode
 * virar corrida de graça, nem inventar um terceiro preço.
 */
const FALLBACK_BANDS = Object.freeze([
  { band: "w1", label: "Até 1 kg", min_cents: 300, negotiable: false, sort_order: 1, is_active: true },
  { band: "w3", label: "De 1 a 3 kg", min_cents: 500, negotiable: false, sort_order: 2, is_active: true },
  { band: "w6", label: "De 3 a 6 kg", min_cents: 1500, negotiable: false, sort_order: 3, is_active: true },
  { band: "w10", label: "De 6 a 10 kg", min_cents: 2000, negotiable: false, sort_order: 4, is_active: true },
  { band: "w10p", label: "Mais de 10 kg", min_cents: 2000, negotiable: true, sort_order: 5, is_active: true },
]);

/** As duas direções: quem pede ENVIA (o vizinho leva) ou RECEBE (o vizinho busca). */
const DELIVERY_DIRECTIONS = Object.freeze(["send", "receive"]);

function isWeightBand(band) {
  return typeof band === "string" && WEIGHT_BANDS.includes(band);
}

function isDeliveryDirection(direction) {
  return typeof direction === "string" && DELIVERY_DIRECTIONS.includes(direction);
}

/**
 * Qual `kind` da mig 248 um chamado por peso usa. O `kind` continua
 * governando a expiração e o prazo de confirmação (tabela por tipo); a faixa
 * negociada é carga grande (mudança, móvel) e herda os prazos de `bulky`.
 */
function kindForBand(band) {
  return band === "w10p" ? "bulky" : "parcel";
}

async function listWeightBands(conn, { onlyActive = true } = {}) {
  try {
    const { rows } = await conn.query(
      `SELECT band, label, min_cents, negotiable, sort_order, is_active
         FROM public.tb_community_delivery_weight_band
        ${onlyActive ? "WHERE is_active = TRUE" : ""}
        ORDER BY sort_order ASC, band ASC`
    );
    if (rows.length) return rows;
  } catch (err) {
    log.warn("delivery.bands.read.fail", { message: err?.message });
  }
  return FALLBACK_BANDS.map((b) => ({ ...b }));
}

async function getWeightBand(conn, band, { onlyActive = true } = {}) {
  if (!isWeightBand(band)) return null;
  const rows = await listWeightBands(conn, { onlyActive });
  return rows.find((r) => r.band === band) || null;
}

module.exports = {
  DELIVERY_KINDS,
  FALLBACK_PRICES,
  FALLBACK_EXPIRES_MINUTES,
  STRIKE_LIMIT,
  STRIKE_WINDOW_DAYS,
  STRIKE_BLOCK_HOURS,
  isDeliveryKind,
  listDeliveryTypes,
  getDeliveryType,
  estimateProcessorFee,
  courierNet,
  courierNetPreview,
  deliveryPlatformFee,
  FALLBACK_DELIVERY_FEE_PERCENT,
  WEIGHT_BANDS,
  FALLBACK_BANDS,
  DELIVERY_DIRECTIONS,
  isWeightBand,
  isDeliveryDirection,
  kindForBand,
  listWeightBands,
  getWeightBand,
};
