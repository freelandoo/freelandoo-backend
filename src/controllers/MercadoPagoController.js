const MercadoPagoWebhookService = require("../services/MercadoPagoWebhookService");
const mp = require("../integrations/payments/mercadoPagoClient");
const { createLogger } = require("../utils/logger");

const log = createLogger("MercadoPagoController");

/**
 * O `data.id` que entra no manifesto da assinatura vem da QUERYSTRING.
 *
 * ⚠️ Express não desmonta `data.id` em objeto (o parser não trata ponto como
 * aninhamento), então a chave literal `"data.id"` é a certa. `topic`/`id` são a
 * forma ANTIGA (IPN) da notificação, aceita aqui porque uma aplicação criada há
 * mais tempo pode ter os dois formatos ligados no painel — e a versão antiga
 * chegando como "tópico desconhecido" pararia de entregar pagamento sem um erro
 * que aponte o motivo.
 */
function readDataId(req) {
  const q = req.query || {};
  const fromQuery = q["data.id"] || q.id || q["data_id"];
  if (fromQuery) return String(fromQuery);
  const b = req.body || {};
  if (b.data && b.data.id) return String(b.data.id);
  return "";
}

function readTopic(req) {
  const b = req.body || {};
  const q = req.query || {};
  return String(b.type || b.topic || q.type || q.topic || "").toLowerCase();
}

class MercadoPagoController {
  /**
   * POST /webhooks/mercadopago
   *
   * ⚠️ A AUTENTICAÇÃO É HMAC, MAS NÃO SOBRE O CORPO — e é isso que dispensa o
   * `express.raw` que o Stripe e a Meta exigem. O Mercado Pago assina um
   * MANIFESTO montado com três pedaços (`data.id`, `x-request-id`, `ts`), então
   * o corpo pode ser lido como JSON normal sem invalidar nada.
   *
   * ⚠️ SEM O SEGREDO CONFIGURADO, A ROTA SE RECUSA A FUNCIONAR em vez de
   * aceitar qualquer corpo da internet. Um endpoint aberto que credita Polén e
   * ativa perfil é um caixa aberto: bastaria alguém postar um JSON com um id de
   * intenção para levar o produto sem pagar.
   */
  static async handleWebhook(req, res) {
    const cfg = mp.config();
    const secret =
      (cfg && cfg.webhookSecret) || String(process.env.MERCADOPAGO_WEBHOOK_SECRET || "").trim();

    if (!secret) {
      log.error("webhook.secret_not_configured");
      return res.status(503).json({ error: "Webhook do Mercado Pago não configurado" });
    }

    const verdict = mp.verifyWebhookSignature({
      xSignature: req.headers["x-signature"],
      xRequestId: req.headers["x-request-id"],
      dataId: readDataId(req),
      secret,
    });

    if (!verdict.ok) {
      log.warn("webhook.signature_invalid", { reason: verdict.reason });
      return res.status(401).json({ error: "Assinatura inválida" });
    }

    // Normaliza as duas formas de notificação numa só antes de descer.
    const event = {
      ...(req.body || {}),
      type: readTopic(req),
      data: { id: readDataId(req) },
    };

    try {
      const result = await MercadoPagoWebhookService.processEvent(event);
      // ⚠️ 2xx SEMPRE que o evento foi tratado — inclusive quando ignorado. O
      // Mercado Pago espera 200/201 em até 22 segundos e re-entrega a cada 15
      // minutos o que não recebe; uma cobrança que não é nossa ficaria sendo
      // re-entregue para sempre, travando a fila dos eventos que importam.
      return res.json({ received: true, ...result });
    } catch (err) {
      // ⚠️ O NOME e o CÓDIGO do erro vão junto da mensagem porque nem todo
      // erro tem mensagem: o `AggregateError` que o pg lança quando o banco não
      // responde nasce com `message` VAZIA. Só com a mensagem, uma queda de
      // banco apareceria aqui como `{"message":""}` — um 500 no caminho que
      // ENTREGA PRODUTO, sem nada que diga por onde começar a procurar.
      log.error("webhook.process_fail", {
        event_id: event.id || null,
        type: event.type || null,
        error: (err && (err.name || err.constructor?.name)) || null,
        code: (err && (err.code || err.statusCode)) || null,
        message: (err && err.message) || String(err),
      });
      // 500 de propósito: falha REAL de processamento precisa ser re-tentada,
      // senão o pagamento fica cobrado e sem entrega.
      return res.status(500).json({ error: "Falha ao processar evento" });
    }
  }
}

module.exports = MercadoPagoController;
