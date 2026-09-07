// src/integrations/evolution/index.js
// Client HTTP da Evolution API v2 (mig 223). Copiado do Coliseu
// (`src/lib/whatsapp/evolution.ts`) e adaptado para multi-usuário.
//
// ─── O QUE ESTE MÓDULO É, E O QUE ELE NÃO É ─────────────────────────────────
//
// É o ÚNICO lugar do backend que fala com a Evolution — e, portanto, o único
// que ENVIA mensagem de WhatsApp. A ingestão do webhook
// (`WhatsappIngestService`) NÃO o importa, e isso é a garantia ESTRUTURAL de
// que ninguém é respondido automaticamente: não existe caminho de código de uma
// mensagem que chega até um `sendText`. Toda saída nasce de um clique do dono
// do número.
//
// ─── A CREDENCIAL É DO SERVIDOR; A INSTÂNCIA É DA PESSOA ────────────────────
//
// `EVOLUTION_URL` + `EVOLUTION_API_KEY` são uma só, do servidor Evolution, e
// nunca saem daqui — nenhuma rota devolve a apikey, nem para o dono da
// instância. O que separa uma pessoa da outra é o NOME DA INSTÂNCIA, que vem
// como argumento em toda função e é derivado do id_user
// (`utils/whatsappInstance.js`).
//
// ⚠️ Diferente do Coliseu, aqui NÃO existe `EVOLUTION_INSTANCE` no ambiente:
// uma instância global significaria um WhatsApp para o site inteiro.
//
// ─── SEM ENV, O MÓDULO SE DECLARA NÃO CONFIGURADO ───────────────────────────
//
// `config()` devolve `null` e as rotas respondem 503 dizendo isso. É a regra da
// mig 214: quem decide se a integração aparece é a ENV, não a flag — flag
// ligada sem credencial produz um botão que só falha depois do clique.

const TIMEOUT_MS = 15_000;

class EvolutionError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "EvolutionError";
    this.statusCode = statusCode;
  }
}

/** O endereço PÚBLICO deste backend — é ele que a Evolution vai chamar. */
function selfUrl() {
  const explicit = process.env.PUBLIC_BACKEND_URL;
  const railway = process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${String(process.env.RAILWAY_PUBLIC_DOMAIN).replace(/^https?:\/\//, "")}`
    : "";
  const raw = explicit || railway || process.env.BASE_URL || "";
  return raw ? String(raw).replace(/\/+$/, "") : "";
}

/** `null` = integração não configurada neste ambiente. */
function config() {
  const url = String(process.env.EVOLUTION_URL || "").trim().replace(/\/+$/, "");
  const apiKey = String(process.env.EVOLUTION_API_KEY || "").trim();
  if (!url || !apiKey) return null;

  const base = selfUrl();
  return {
    url,
    apiKey,
    // O webhook cai no EXPRESS (este backend), nunca no front: o front é a
    // Vercel, cobra por invocação e não tem o banco à mão.
    webhookUrl: base ? `${base}/webhooks/whatsapp` : "",
    webhookSecret: String(process.env.WHATSAPP_WEBHOOK_SECRET || "").trim(),
  };
}

function isConfigured() {
  return !!config();
}

async function call(cfg, method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${cfg.url}${path}`, {
      method,
      headers: { apikey: cfg.apiKey, "Content-Type": "application/json" },
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
    return { status: r.status, data };
  } catch (e) {
    const why = e && e.name === "AbortError" ? "tempo esgotado" : "sem resposta";
    throw new EvolutionError(`WhatsApp indisponível (${why}). Tente de novo em instantes.`);
  } finally {
    clearTimeout(timer);
  }
}

/** A Evolution responde 200 com `success:false` em algumas falhas — vale erro. */
function errorMessage(data) {
  const raw = (data.response && data.response.message) || data.message || data.error;
  if (Array.isArray(raw)) return raw.map(String).join("; ").slice(0, 300);
  if (typeof raw === "string" && raw.trim()) return raw.trim().slice(0, 300);
  return "Falha na Evolution API.";
}

function ensureOk({ status, data }) {
  if (status >= 400 || data.success === false) {
    throw new EvolutionError(errorMessage(data), status >= 400 ? status : 502);
  }
  return data;
}

/**
 * O webhook que a instância dessa pessoa vai chamar.
 *
 * `MESSAGES_UPSERT` traz o que chega, `CONNECTION_UPDATE` mantém o status em dia
 * SEM polling (é o que evita uma varredura periódica por instância), e
 * `QRCODE_UPDATED` avisa quando o QR foi renovado do lado de lá.
 *
 * `base64: false` de propósito: com ele ligado, TODA foto e TODO áudio de TODA
 * instância viriam embutidos no corpo do webhook, e o binário de terceiros
 * passaria a atravessar (e a inflar) o nosso backend sem ninguém pedir. A mídia
 * é buscada sob demanda, quando alguém abre a mensagem.
 */
function webhookConfig(cfg) {
  if (!cfg.webhookUrl) return null;
  return {
    enabled: true,
    url: cfg.webhookUrl,
    byEvents: false,
    base64: false,
    headers: cfg.webhookSecret ? { "x-webhook-secret": cfg.webhookSecret } : undefined,
    events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE", "QRCODE_UPDATED"],
  };
}

/**
 * Cria a instância. IDEMPOTENTE: já existindo na Evolution (403/409/"already in
 * use"), segue em frente e só reaplica o webhook — a tela chama isto toda vez
 * que alguém pede um QR, e um erro aqui pararia a reconexão de quem já tinha
 * conectado antes.
 */
async function createInstance(cfg, name) {
  const webhook = webhookConfig(cfg);
  const r = await call(cfg, "POST", "/instance/create", {
    instanceName: name,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
    ...(webhook ? { webhook } : {}),
  });

  const exists =
    r.status === 403 || r.status === 409 || /already in use|exists/i.test(errorMessage(r.data));
  if (r.status >= 400 && !exists) throw new EvolutionError(errorMessage(r.data), r.status);

  await applyWebhook(cfg, name);
}

/** Reaplicar o webhook é seguro, e cobre instância criada fora daqui. */
async function applyWebhook(cfg, name) {
  const webhook = webhookConfig(cfg);
  if (!webhook) return;
  // Falha aqui não trava o QR: o webhook é reaplicado a cada conexão.
  await call(cfg, "POST", `/webhook/set/${encodeURIComponent(name)}`, { webhook }).catch(
    () => undefined
  );
}

/** `instance/connect`: devolve o QR, ou `connected` quando já está pareado. */
async function connect(cfg, name) {
  const data = ensureOk(await call(cfg, "GET", `/instance/connect/${encodeURIComponent(name)}`));

  const state = data.instance && data.instance.state;
  if (state === "open") return { connected: true, qrBase64: null, pairingCode: null };

  const qr = data.qrcode || {};
  const qrBase64 = data.base64 || qr.base64 || null;
  const pairingCode = data.pairingCode || data.code || null;
  if (!qrBase64 && !pairingCode) {
    throw new EvolutionError("O QR Code ainda não ficou pronto. Tente de novo em alguns segundos.");
  }
  return { connected: false, qrBase64, pairingCode };
}

/** Estado da sessão. NUNCA lança: indisponibilidade vira `null` (desconhecido). */
async function connectionState(cfg, name) {
  try {
    const { status, data } = await call(
      cfg,
      "GET",
      `/instance/connectionState/${encodeURIComponent(name)}`
    );
    if (status >= 400) return null;
    const state = (data.instance && data.instance.state) || data.state;
    return ["open", "connected", "connection_open"].includes(String(state || "").toLowerCase());
  } catch {
    return null;
  }
}

/** Desconecta o aparelho. A instância continua existindo (e a caixa também). */
async function logout(cfg, name) {
  const r = await call(cfg, "DELETE", `/instance/logout/${encodeURIComponent(name)}`);
  // 404 = já não havia sessão. Desconectar o que já está desconectado é sucesso.
  if (r.status >= 400 && r.status !== 404) throw new EvolutionError(errorMessage(r.data), r.status);
}

/** Grupo endereça pelo JID inteiro; pessoa, só pelos dígitos do telefone. */
function destinationNumber(dest) {
  const v = String(dest || "").trim();
  const number = /@g\.us$/i.test(v) ? v : v.replace(/\D/g, "");
  if (!number) throw new EvolutionError("Conversa sem número para envio.", 400);
  return number;
}

/** `key.id` do WhatsApp: é ele que deduplica o eco que volta pelo webhook. */
function extractKeyId(data) {
  const key = data.key || (data.message && data.message.key);
  return (key && key.id) || null;
}

/**
 * Envia texto. Único ponto de saída de mensagem do sistema — sempre acionado
 * por um clique de quem é dono do número, nunca pela ingestão.
 */
async function sendText(cfg, name, dest, text) {
  const number = destinationNumber(dest);
  const content = String(text || "").trim();
  if (!content) throw new EvolutionError("Mensagem vazia.", 400);

  const data = ensureOk(
    await call(cfg, "POST", `/message/sendText/${encodeURIComponent(name)}`, {
      number,
      text: content,
    })
  );
  return extractKeyId(data);
}

/**
 * Baixa a mídia de uma mensagem recebida, pelo `key.id` que já guardamos.
 *
 * A Evolution mantém o histórico de mídia da instância, então nada precisa ser
 * armazenado do nosso lado: quem abre a conversa vê a foto na hora e o arquivo
 * não fica em repouso na Freelandoo. `convertToMp4: false` porque recodificar
 * gasta CPU do servidor para um vídeo que o navegador já toca no original.
 */
async function fetchMedia(cfg, name, waMessageId) {
  const data = ensureOk(
    await call(cfg, "POST", `/chat/getBase64FromMediaMessage/${encodeURIComponent(name)}`, {
      message: { key: { id: waMessageId } },
      convertToMp4: false,
    })
  );

  const base64 = String(data.base64 || "");
  // Mídia velha demais expira no WhatsApp e a Evolution não recupera.
  if (!base64) throw new EvolutionError("Mídia não está mais disponível no WhatsApp.", 404);

  return {
    bytes: Buffer.from(base64, "base64"),
    mimetype: String(data.mimetype || "application/octet-stream"),
    fileName: String(data.fileName || "midia"),
  };
}

module.exports = {
  EvolutionError,
  config,
  isConfigured,
  createInstance,
  applyWebhook,
  connect,
  connectionState,
  logout,
  sendText,
  fetchMedia,
};
