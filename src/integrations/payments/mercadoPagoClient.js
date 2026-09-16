// src/integrations/payments/mercadoPagoClient.js
// O ÚNICO lugar do backend que fala HTTP com o Mercado Pago.
//
// ─── SEM ENV, O MÓDULO SE DECLARA NÃO CONFIGURADO ───────────────────────────
//
// `config()` devolve `null` e quem chama responde que a integração não está
// disponível. É a regra das migs 214/220/223: quem decide se o provedor existe
// é a ENV, não a flag — flag ligada sem credencial produz um botão de pagar que
// só falha depois do clique, já com a pessoa decidida a comprar.
//
// ─── ⚠️ O AMBIENTE É O TOKEN, E ISSO INVERTE A PROTEÇÃO DO ASAAS ────────────
//
// O Asaas tinha DOIS hosts e uma `ASAAS_ENV` que precisava dizer `production`
// por extenso — então um erro de digitação caía no sandbox, onde o pior caso é
// um pagamento de teste que não acontece.
//
// O Mercado Pago tem UM host só (`api.mercadopago.com`): quem decide se o
// dinheiro é real é o PREFIXO DO TOKEN — `TEST-…` é teste, `APP_USR-…` é
// produção. Não existe env para errar, e também não existe rede de segurança:
// colar o token de produção durante um teste COBRA DE VERDADE.
//
// É por isso que `environment()` é derivado do token: a única defesa possível é
// a pessoa conseguir VER em qual ambiente está.

const crypto = require("crypto");
const { createLogger } = require("../../utils/logger");

const log = createLogger("MercadoPagoClient");

const TIMEOUT_MS = 20_000;

/** Um host só, para os dois ambientes. Quem separa é o token. */
const BASE_URL = "https://api.mercadopago.com";

class MercadoPagoError extends Error {
  constructor(message, statusCode = 502, raw = null) {
    super(message);
    this.name = "MercadoPagoError";
    this.statusCode = statusCode;
    this.raw = raw;
  }
}

/** `null` = provedor não configurado neste ambiente. */
function config() {
  const accessToken = String(process.env.MERCADOPAGO_ACCESS_TOKEN || "").trim();
  if (!accessToken) return null;
  return {
    accessToken,
    url: String(process.env.MERCADOPAGO_API_URL || BASE_URL).replace(/\/+$/, ""),
    webhookSecret: String(process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim(),
  };
}

function isConfigured() {
  return !!config();
}

/**
 * `sandbox` ou `production`, DERIVADO do token.
 *
 * ⚠️ Token que não começa por nenhum dos dois prefixos conhecidos devolve
 * `unknown`, e não `production`. Quem lê isto é o diagnóstico de boot, e
 * afirmar "produção" sobre um token que não se reconhece seria pior que dizer
 * "não sei".
 */
function environment() {
  const cfg = config();
  if (!cfg) return null;
  if (cfg.accessToken.startsWith("TEST-")) return "sandbox";
  if (cfg.accessToken.startsWith("APP_USR-")) return "production";
  return "unknown";
}

/**
 * ⚠️ CENTAVOS → REAIS, e este é o ponto de dinheiro mais fácil de errar da
 * integração inteira. A plataforma trabalha em CENTAVOS (inteiro) do começo ao
 * fim; o Mercado Pago recebe `unit_price`/`transaction_amount` em REAIS com
 * decimal. Mandar 1990 onde ele espera 19.90 cobra mil novecentos e noventa
 * reais de alguém.
 *
 * O `toFixed(2)` antes do `Number` não é enfeite: 0.1+0.2 em ponto flutuante
 * produz caudas como 19.900000000000002, e o gateway recusa (ou arredonda)
 * valor com mais de duas casas.
 */
function centsToReais(amount_cents) {
  const cents = Math.round(Number(amount_cents) || 0);
  return Number((cents / 100).toFixed(2));
}

/** REAIS → CENTAVOS, para reidratar o que volta do webhook na régua da casa. */
function reaisToCents(value) {
  return Math.round((Number(value) || 0) * 100);
}

/**
 * O erro do Mercado Pago vem em `cause[]`, não numa string.
 *
 * ⚠️ A mensagem chega a quem clicou em pagar, então precisa ser legível — mas
 * NUNCA carrega o corpo inteiro, que traz e-mail e CPF.
 */
function errorMessage(data, status) {
  const first = Array.isArray(data && data.cause) ? data.cause[0] : null;
  const raw = (first && first.description) || (data && (data.message || data.error));
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 300);
  return `Falha na comunicação com o Mercado Pago (HTTP ${status}).`;
}

/**
 * @param {string=} idempotencyKey Só nos POST que CRIAM cobrança.
 *
 * ⚠️ `X-Idempotency-Key` é o que impede o retry de uma falha de rede de criar
 * DUAS cobranças para o mesmo pedido. A chave é o id da nossa intenção (mig
 * 231), que existe antes da chamada e é único por tentativa de compra — gerar
 * um UUID novo a cada request deixaria a proteção inerte.
 */
async function call(method, path, body, { idempotencyKey } = {}) {
  const cfg = config();
  if (!cfg) throw new MercadoPagoError("Mercado Pago não configurado neste ambiente", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${cfg.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.accessToken}`,
        "Content-Type": "application/json",
        accept: "application/json",
        ...(idempotencyKey ? { "X-Idempotency-Key": String(idempotencyKey) } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
      cache: "no-store",
    });

    let data = {};
    try {
      data = (await r.json()) || {};
    } catch {
      data = {};
    }

    if (r.status >= 400) {
      // ⚠️ O corpo NUNCA entra no log: ele carrega e-mail e CPF de quem paga.
      log.warn("call.fail", { method, path, status: r.status });
      throw new MercadoPagoError(errorMessage(data, r.status), r.status, data);
    }
    return data;
  } catch (e) {
    if (e instanceof MercadoPagoError) throw e;
    const why = e && e.name === "AbortError" ? "tempo esgotado" : "sem resposta";
    throw new MercadoPagoError(
      `Mercado Pago indisponível (${why}). Tente de novo em instantes.`,
      502
    );
  } finally {
    clearTimeout(timer);
  }
}

// ──────────────────────── Checkout Pro (avulso) ─────────────────────────────

/**
 * A "preferência": o objeto que hospeda a página de pagamento.
 *
 * ⚠️ PREFERÊNCIA NÃO É COBRANÇA. Ela é só a página; o `payment` nasce quando a
 * pessoa paga, com um id DIFERENTE. É por isso que o adapter carimba a
 * preferência em `provider_ref` na criação e RE-CARIMBA com o id do payment
 * quando o webhook chega — é o id do payment que o estorno recebe.
 */
function createPreference(payload, { idempotencyKey } = {}) {
  return call("POST", "/checkout/preferences", payload, { idempotencyKey });
}

// ─────────────────────────────── Cobranças ──────────────────────────────────

function getPayment(id) {
  return call("GET", `/v1/payments/${encodeURIComponent(id)}`);
}

/**
 * Acha a cobrança pelo NOSSO id de intenção.
 *
 * ⚠️ Existe por causa de uma diferença de desenho que custa caro: o webhook do
 * Mercado Pago é MAGRO (manda só `{ type, data: { id } }`), então um evento
 * perdido não deixa rastro nenhum do qual reconstruir a venda. Esta busca é o
 * que permite à reconciliação perguntar "esta intenção virou pagamento?" sem
 * depender de o webhook ter chegado.
 *
 * Sem ela, o radar de "pagou e não recebeu" ficaria cego para o provedor que
 * cobra tudo.
 */
async function findPaymentByExternalReference(externalReference) {
  const data = await call(
    "GET",
    `/v1/payments/search?external_reference=${encodeURIComponent(externalReference)}` +
      `&sort=date_created&criteria=desc&limit=10`
  );
  const rows = Array.isArray(data && data.results) ? data.results : [];
  // ⚠️ O APROVADO VENCE, e não o mais recente: uma tentativa recusada e uma
  // aprovada dividem a mesma referência quando a pessoa erra o cartão e tenta
  // de novo. Pegando o mais recente, a reconciliação leria "recusado" numa
  // compra que foi paga.
  return rows.find((p) => p && p.status === "approved") || rows[0] || null;
}

/**
 * Estorno TOTAL. O Mercado Pago aceita parcial por `amount`; a casa não usa
 * parcial — corpo vazio devolve o valor inteiro.
 */
function refundPayment(id) {
  return call(
    "POST",
    `/v1/payments/${encodeURIComponent(id)}/refunds`,
    {},
    // O estorno também é retry-able: sem chave, um timeout seguido de retry
    // devolveria o dinheiro duas vezes.
    { idempotencyKey: `refund:${id}` }
  );
}

// ────────────────── Assinaturas (preapproval, recorrente) ───────────────────

/**
 * A assinatura do Mercado Pago.
 *
 * ⚠️ AVISO DE PRODUTO, não detalhe técnico: `preapproval` cobra por CARTÃO. Não
 * existe Pix recorrente clássico aqui — o Pix Automático é outro produto e
 * precisa estar habilitado na conta. Os fluxos recorrentes da plataforma mudam
 * de meio de pagamento ao migrar, e isso é decisão de negócio.
 *
 * `status: "pending"` é o que faz sentido num fluxo hospedado: a assinatura
 * nasce esperando autorização, e `init_point` é para onde a pessoa vai
 * cadastrar o cartão. Criar já como `authorized` exigiria um `card_token_id`,
 * que só existe se o cartão for digitado DENTRO do nosso site — e aí a
 * plataforma passaria a tocar dado de cartão, que é exatamente o que o checkout
 * hospedado existe para evitar.
 */
function createPreapproval(payload, { idempotencyKey } = {}) {
  return call("POST", "/preapproval", payload, { idempotencyKey });
}

function getPreapproval(id) {
  return call("GET", `/preapproval/${encodeURIComponent(id)}`);
}

/**
 * ⚠️ Cancelar é IMEDIATO — como era no Asaas e ao contrário do Stripe, não
 * existe `cancel_at_period_end`. Quem precisa de "vale até o fim do ciclo" tem
 * que guardar a data do lado de cá e só chamar isto quando ela chegar, senão o
 * assinante perde na hora um mês que ele já pagou. É o que
 * `SubscriptionEndStorage` (mig 251) resolve.
 *
 * `paused` existe e NÃO é usado de propósito: assinatura pausada continua
 * existindo e pode voltar a cobrar sozinha, o que é pior que cancelada para
 * quem pediu para sair.
 */
function cancelPreapproval(id) {
  return call("PUT", `/preapproval/${encodeURIComponent(id)}`, { status: "cancelled" });
}

/**
 * A fatura de um ciclo da assinatura.
 *
 * ⚠️ ÚNICO CAMINHO DA INTEGRAÇÃO NÃO CONFERIDO CONTRA A API — está anotado como
 * pendência de QA em sandbox. O consumidor (`MercadoPagoWebhookService`) trata
 * a falha desta chamada como evento NÃO RESOLVIDO (log + ignorado), nunca como
 * erro: estourar aqui faria o Mercado Pago re-tentar para sempre um evento que
 * não sabemos ler, travando a fila dos que importam.
 */
function getAuthorizedPayment(id) {
  return call("GET", `/authorized_payments/${encodeURIComponent(id)}`);
}

// ───────────────────────── Assinatura do webhook ────────────────────────────

/**
 * Confere a assinatura `x-signature` do webhook.
 *
 * ⚠️ O MANIFESTO NÃO É O CORPO — é uma string montada com três pedaços, e é por
 * isso que esta rota NÃO precisa de `express.raw` (diferente do Stripe e da
 * Meta, que assinam os bytes crus).
 *
 * Formato: `id:<data.id>;request-id:<x-request-id>;ts:<ts>;`
 *
 * ⚠️ TRÊS DETALHES QUE, ERRADOS, FAZEM TODA NOTIFICAÇÃO LEGÍTIMA TOMAR 401:
 *
 * 1. O `data.id` é o da QUERYSTRING (`?data.id=…`), não o do corpo. Eles
 *    coincidem na prática, mas a doc é explícita sobre qual entra no manifesto.
 * 2. Ele vai em MINÚSCULAS. O id de pagamento é numérico e o de assinatura tem
 *    letras — então a diferença só aparece nas notificações de ASSINATURA,
 *    muito depois de a integração parecer pronta.
 * 3. Pedaço AUSENTE é OMITIDO do manifesto, não vira string vazia. Notificação
 *    sem `data.id` existe, e montar `id:;` produz um hash que nunca casa.
 */
function verifyWebhookSignature({ xSignature, xRequestId, dataId, secret }) {
  const key = String(secret || "").trim();
  if (!key) return { ok: false, reason: "secret_not_configured" };

  let ts = null;
  let hash = null;
  for (const part of String(xSignature || "").split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k === "ts") ts = v;
    if (k === "v1") hash = v;
  }
  if (!ts || !hash) return { ok: false, reason: "signature_malformed" };

  const parts = [];
  const id = String(dataId || "").toLowerCase();
  if (id) parts.push(`id:${id}`);
  if (xRequestId) parts.push(`request-id:${xRequestId}`);
  parts.push(`ts:${ts}`);
  const manifest = `${parts.join(";")};`;

  const computed = crypto.createHmac("sha256", key).update(manifest).digest("hex");

  // ⚠️ Comparação em tempo constante: `a === b` vaza o tamanho do prefixo
  // correto pelo TEMPO, e esta assinatura é a única coisa que separa o nosso
  // webhook de qualquer um que saiba a URL — e o webhook ENTREGA PRODUTO.
  const a = Buffer.from(computed, "utf8");
  const b = Buffer.from(String(hash), "utf8");
  if (a.length !== b.length) return { ok: false, reason: "signature_mismatch" };
  if (!crypto.timingSafeEqual(a, b)) return { ok: false, reason: "signature_mismatch" };
  return { ok: true };
}

module.exports = {
  MercadoPagoError,
  BASE_URL,
  config,
  isConfigured,
  environment,
  centsToReais,
  reaisToCents,
  createPreference,
  getPayment,
  findPaymentByExternalReference,
  refundPayment,
  createPreapproval,
  getPreapproval,
  cancelPreapproval,
  getAuthorizedPayment,
  verifyWebhookSignature,
};
