// src/services/TenkaWebhookForwardService.js
// Repasse dos avisos do Mercado Pago que são da LOJA DA TENKA.
//
// ─── POR QUE ISTO EXISTE ────────────────────────────────────────────────────
//
// A TENKA vende pela MESMA conta (e aplicação) do Mercado Pago da Freelandoo.
// Cobrança avulsa leva `notification_url` própria e o aviso vai direto para o
// back da TENKA. Já o aviso de ASSINATURA (preapproval / authorized_payment)
// vai para o webhook configurado no painel da aplicação — que é ESTE. Sem o
// repasse, a TENKA nunca saberia que a mensalidade foi autorizada/paga.
//
// ─── O QUE NÃO MUDA NA FREELANDOO ───────────────────────────────────────────
//
// 1. Sem `TENKA_WEBHOOK_URL`, nada aqui roda: o controller segue exatamente
//    como antes.
// 2. Só é repassado o recurso cuja `external_reference` começa com `tenka:` —
//    a Freelandoo nunca gera essa referência (as dela são UUID de intenção).
// 3. Qualquer falha ao CONSULTAR o recurso devolve "não é da TENKA" e o evento
//    segue o caminho normal da Freelandoo. A consulta nunca derruba o webhook.
//
// ─── A ASSINATURA ───────────────────────────────────────────────────────────
//
// O repasse leva os MESMOS `x-signature` e `x-request-id` e a MESMA
// querystring (`data.id`) que o Mercado Pago mandou. Como a aplicação é a
// mesma, o segredo é o mesmo, e o back da TENKA revalida a assinatura original
// — nenhum segredo novo, e ninguém de fora forja um repasse.

const mp = require("../integrations/payments/mercadoPagoClient");
const { createLogger } = require("../utils/logger");

const log = createLogger("TenkaWebhookForward");

const TENKA_PREFIX = "tenka:";
const FORWARD_TIMEOUT_MS = 10_000;

function forwardUrl() {
  const url = String(process.env.TENKA_WEBHOOK_URL || "").trim();
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

function isEnabled() {
  return !!forwardUrl();
}

function isTenkaRef(ref) {
  return typeof ref === "string" && ref.startsWith(TENKA_PREFIX);
}

/**
 * O recurso do aviso pertence à loja da TENKA?
 *
 * ⚠️ Lê o recurso na API (o aviso é magro: só `type` e `data.id`). Falha de
 * leitura = `false`, de propósito: na dúvida, o evento é da Freelandoo e segue
 * o fluxo dela — que já sabe ignorar o que não reconhece.
 */
async function belongsToTenka(event, client = mp) {
  const type = String((event && event.type) || "").toLowerCase();
  const id = event && event.data && event.data.id ? String(event.data.id) : "";
  if (!id) return false;
  try {
    if (type === "payment") {
      const p = await client.getPayment(id);
      return isTenkaRef(p && p.external_reference);
    }
    if (type === "subscription_preapproval" || type === "preapproval") {
      const pre = await client.getPreapproval(id);
      return isTenkaRef(pre && pre.external_reference);
    }
    if (type === "subscription_authorized_payment" || type === "authorized_payment") {
      const ap = await client.getAuthorizedPayment(id);
      const preId = ap && ap.preapproval_id;
      if (!preId) return false;
      const pre = await client.getPreapproval(String(preId));
      return isTenkaRef(pre && pre.external_reference);
    }
  } catch (err) {
    log.warn("belongs.read_fail", { type, id, message: err && err.message });
  }
  return false;
}

/**
 * Reenvia a requisição original ao back da TENKA. Resolve `true` com 2xx.
 * Não-2xx ou rede caída = `false`, e o controller responde 500 para o
 * Mercado Pago RE-ENTREGAR (nada foi processado aqui, então repetir é seguro).
 */
async function forward(req, fetchImpl = fetch) {
  const base = forwardUrl();
  if (!base) return false;
  const url = new URL(base);
  for (const [k, v] of Object.entries(req.query || {})) {
    if (v != null) url.searchParams.set(k, String(v));
  }
  const headers = { "Content-Type": "application/json", "x-tenka-forwarded-by": "freelandoo" };
  for (const h of ["x-signature", "x-request-id"]) {
    if (req.headers && req.headers[h]) headers[h] = String(req.headers[h]);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FORWARD_TIMEOUT_MS);
  try {
    const r = await fetchImpl(url.toString(), {
      method: "POST",
      headers,
      body: JSON.stringify(req.body || {}),
      signal: controller.signal,
    });
    if (r.status >= 200 && r.status < 300) return true;
    log.warn("forward.non_2xx", { status: r.status });
    return false;
  } catch (err) {
    log.warn("forward.fail", { message: err && err.message });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { TENKA_PREFIX, isEnabled, isTenkaRef, belongsToTenka, forward };
