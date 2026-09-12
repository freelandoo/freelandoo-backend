// src/integrations/whatsappProvider/cloud.js
// Adaptador da Meta WhatsApp Cloud API — o caminho OFICIAL.
//
// ─── ESTADO: ESQUELETO (W1) ─────────────────────────────────────────────────
//
// Aqui moram a configuração, o contrato e o cliente HTTP da Graph API. Os
// métodos que dependem de número cadastrado (`ensure`, `connect`) chegam no W3,
// e os de tráfego (`sendText`, `fetchMedia`) no W4. Até lá eles RECUSAM EM VOZ
// ALTA em vez de devolver algo falso — provedor que responde "ok" sem fazer
// nada é a falha que só aparece quando o cliente reclama que ninguém respondeu.
//
// ─── FASE 1: OS NÚMEROS MORAM NO NOSSO WABA ─────────────────────────────────
//
// Os números dos clientes entram como *business phone numbers* dentro do
// Business Portfolio da Freelandoo. Consequências que explicam o desenho:
//
//   • quem opera é o **System User token do AMBIENTE**, não um token por
//     cliente — o WABA é nosso. Por isso `access_token_sealed` da mig 240
//     nasce NULL: ele só passa a ser usado na fase 2 (Tech Provider), quando
//     cada cliente traz o WABA e o token dele;
//   • o método de pagamento é UM, nosso — o cliente não cadastra cartão;
//   • Advanced access (App Review, Tech Provider) NÃO é exigido, porque ele só
//     vale para WABAs *não pertencentes ao nosso negócio*.
//
// ⚠️ O TETO DESTE MODELO É O NÚMERO DE NÚMEROS: 2 no começo, até 20 com
// verificação e uso; acima disso só por ticket no Direct Support. Ao encostar
// em ~15 conectados, abrir a fase 2 — ver o plano em
// `docs/superpowers/plans/2026-09-11-whatsapp-cloud-api-migracao.md`.
//
// ─── A DIFERENÇA QUE MAIS MUDA CÓDIGO: A JANELA DE 24H ──────────────────────
//
// Na Evolution dá para escrever a qualquer momento. Aqui, texto livre só sai
// enquanto a janela aberta pelo cliente estiver de pé; fora dela a Meta RECUSA,
// e é preciso um template aprovado. Quem guarda a janela é
// `tb_whatsapp_conversation.service_window_expires_at` (mig 240), preenchida
// pelo webhook — o único que sabe quando o cliente falou.

const crypto = require("crypto");

const TIMEOUT_MS = 15_000;
const DEFAULT_GRAPH_VERSION = "v21.0";

class CloudApiError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = "CloudApiError";
    this.statusCode = statusCode;
  }
}

/**
 * `null` = integração não configurada neste ambiente.
 *
 * Regra da mig 214: quem decide se a integração APARECE é a ENV, não a flag.
 * Flag ligada sem credencial produz um botão que só falha depois do clique, já
 * fora do nosso site.
 */
function config() {
  const appId = String(process.env.META_APP_ID || "").trim();
  const appSecret = String(process.env.META_APP_SECRET || "").trim();
  const token = String(process.env.META_SYSTEM_USER_TOKEN || "").trim();
  const wabaId = String(process.env.META_WABA_ID || "").trim();
  if (!appId || !appSecret || !token || !wabaId) return null;

  const version = String(process.env.META_GRAPH_VERSION || "").trim() || DEFAULT_GRAPH_VERSION;
  return {
    appId,
    appSecret,
    token,
    wabaId,
    version,
    graph: `https://graph.facebook.com/${version}`,
    // O token que a Meta devolve no GET de verificação do webhook. Obrigatório
    // em produção: sem ele a inscrição do webhook não é aceita.
    verifyToken: String(process.env.META_WEBHOOK_VERIFY_TOKEN || "").trim(),
  };
}

function isAvailable() {
  return !!config();
}

/**
 * A Cloud API não pareia por QR: o número é CADASTRADO no WABA e confirmado
 * por um código que a Meta manda por SMS ou chamada. Ela também é STATELESS —
 * não há sessão de pé — e por isso `idleSession: false`: desligar um cliente
 * ocioso aqui arrancaria a integração dele sem motivo (o sweeper da mig 224
 * confere esta capability antes de agir).
 */
const capabilities = Object.freeze({
  qrPairing: false,
  numberRegistration: true,
  serviceWindow: true,
  qualityRating: true,
  idleSession: false,
});

/** O `phone_number_id` da Meta é o `provider_ref` — a coluna tem nome legado. */
function refOf(instance) {
  return instance?.evolution_instance;
}

function ensureConfigured() {
  const cfg = config();
  if (!cfg) {
    throw new CloudApiError("WhatsApp oficial não está configurado neste ambiente.", 503);
  }
  return cfg;
}

async function call(cfg, method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${cfg.graph}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await r.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }
    return { status: r.status, data, raw: text };
  } catch (e) {
    if (e && e.name === "AbortError") {
      throw new CloudApiError("A Meta não respondeu a tempo.", 504);
    }
    throw new CloudApiError("Falha de rede ao falar com a Meta.", 502);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * O erro da Graph API vem aninhado e com vocabulário interno. Traduzir aqui
 * evita que cada chamador reimplemente a leitura — e evita vazar o texto cru
 * da Meta para a tela de quem só queria conectar um número.
 */
function ensureOk({ status, data }) {
  if (status >= 200 && status < 300) return data;
  const err = data && data.error;
  const message = (err && (err.error_user_msg || err.message)) || "Erro na Meta Cloud API.";
  throw new CloudApiError(message, status === 401 || status === 403 ? 502 : 502);
}

/* ─────────────────────────── ainda não implementados ─────────────────────── */

function notYet(step) {
  throw new CloudApiError(
    `WhatsApp oficial: ${step} ainda não está disponível nesta versão.`,
    503
  );
}

/** W4 */
async function sendText() {
  return notYet("envio de mensagem");
}

/** W4 */
async function fetchMedia() {
  return notYet("download de mídia");
}

/* ─────────────────────────── W3 — cadastro do número ─────────────────────── */

/**
 * O PIN de verificação em duas etapas, DERIVADO em vez de guardado.
 *
 * A Cloud API exige um PIN de 6 dígitos no `/register`, e ele é cobrado de novo
 * toda vez que o número for registrado outra vez (troca de WABA, re-registro
 * depois de um problema). Perdê-lo trava o número: a Meta não o devolve, e
 * limpá-lo leva 7 dias de espera.
 *
 * Guardá-lo pediria coluna nova (migration) e criaria mais um segredo em
 * repouso. Derivar de um HMAC do App Secret com o `phone_number_id` dá as duas
 * propriedades que importam: é sempre o mesmo para aquele número, e não existe
 * escrito em lugar nenhum.
 *
 * ⚠️ TROCAR O APP SECRET MUDA TODOS OS PINS. Se um dia ele for rotacionado, os
 * números já registrados continuam funcionando (o PIN só é pedido no
 * `/register`), mas um re-registro vai precisar do PIN antigo — que passa a ser
 * recalculável só com o segredo anterior.
 */
function deriveTwoStepPin(cfg, phoneNumberId) {
  const mac = crypto
    .createHmac("sha256", cfg.appSecret)
    .update(`whatsapp-2fa:${phoneNumberId}`)
    .digest();
  // 6 dígitos com zeros à esquerda preservados — "012345" é PIN válido, e
  // tratá-lo como número o transformaria em "12345", que a Meta recusa.
  return String(mac.readUInt32BE(0) % 1_000_000).padStart(6, "0");
}

/**
 * Inscreve o NOSSO app nos webhooks do WABA.
 *
 * ⚠️ NÃO É REDUNDANTE com a inscrição do app no painel. São dois níveis
 * diferentes: lá o app declara que quer eventos de `whatsapp_business_account`;
 * aqui ele é ligado a UM WABA específico. Sem este passo a Meta aceita tudo,
 * não dá erro nenhum, e a caixa fica vazia para sempre — a falha silenciosa que
 * este módulo inteiro existe para evitar.
 *
 * Idempotente: chamar de novo devolve `success: true` sem duplicar.
 */
async function ensure(instance) {
  const cfg = ensureConfigured();
  const waba = instance?.waba_id || cfg.wabaId;
  ensureOk(await call(cfg, "POST", `/${waba}/subscribed_apps`));
}

/**
 * A Cloud API não tem QR. `needsCode` diz à tela para pedir o NÚMERO — e é a
 * capability `qrPairing: false` que a impede de tentar desenhar um QR vazio.
 */
async function connect(instance) {
  const ref = refOf(instance);
  if (!ref) return { connected: false, needsCode: true };

  const s = await state(instance);
  return { connected: s.connected, needsCode: !s.connected };
}

/**
 * Passo 1 — acrescenta o número ao WABA e dispara o código de verificação.
 *
 * ⚠️ `cc` e `phone_number` vão SEPARADOS. A Meta não aceita o número inteiro
 * num campo só, e mandar "5511988887777" como `phone_number` com `cc` vazio
 * falha com uma mensagem que não explica nada.
 *
 * O `verified_name` é o que o CLIENTE vê no topo da conversa, e passa por
 * análise da Meta. Nome que não corresponde ao negócio é reprovado — e a
 * reprovação chega depois, por webhook, não aqui.
 */
async function addNumber(instance, { cc, number, displayName, method = "SMS" } = {}) {
  const cfg = ensureConfigured();
  const waba = instance?.waba_id || cfg.wabaId;

  const created = ensureOk(
    await call(cfg, "POST", `/${waba}/phone_numbers`, {
      cc: String(cc || "").replace(/\D/g, ""),
      phone_number: String(number || "").replace(/\D/g, ""),
      verified_name: String(displayName || "").trim(),
    })
  );

  const ref = String(created?.id || "").trim();
  if (!ref) throw new CloudApiError("A Meta não devolveu o id do número.", 502);

  // O código é pedido SEPARADAMENTE de criar o número. Falhar aqui deixa o
  // número criado e não verificado — que é recuperável (pede o código de novo),
  // ao contrário de perder o `ref`, que deixaria um número órfão no WABA.
  ensureOk(
    await call(cfg, "POST", `/${ref}/request_code`, {
      code_method: String(method).toUpperCase() === "VOICE" ? "VOICE" : "SMS",
      language: "pt_BR",
    })
  );

  return { ref, waba, method: String(method).toUpperCase() === "VOICE" ? "VOICE" : "SMS" };
}

/** Reenvia o código para um número já criado. */
async function requestCode(instance, method = "SMS") {
  const cfg = ensureConfigured();
  const ref = refOf(instance);
  if (!ref) throw new CloudApiError("Número ainda não cadastrado.", 409);

  ensureOk(
    await call(cfg, "POST", `/${ref}/request_code`, {
      code_method: String(method).toUpperCase() === "VOICE" ? "VOICE" : "SMS",
      language: "pt_BR",
    })
  );
  return { ok: true };
}

/**
 * Passo 2 — confirma o código e REGISTRA o número na Cloud API.
 *
 * ⚠️ SÃO DOIS PASSOS, e parar no primeiro é o erro que não dá sintoma: o
 * `verify_code` só prova a posse do número; é o `/register` que o liga à Cloud
 * API. Sem ele o número aparece verificado no painel e não envia nem recebe
 * nada.
 */
async function confirmCode(instance, code) {
  const cfg = ensureConfigured();
  const ref = refOf(instance);
  if (!ref) throw new CloudApiError("Número ainda não cadastrado.", 409);

  ensureOk(
    await call(cfg, "POST", `/${ref}/verify_code`, {
      code: String(code || "").replace(/\D/g, ""),
    })
  );

  ensureOk(
    await call(cfg, "POST", `/${ref}/register`, {
      messaging_product: "whatsapp",
      pin: deriveTwoStepPin(cfg, ref),
    })
  );

  // A inscrição do WABA vem DEPOIS do registro e é o último passo de propósito:
  // é ela que faz a mensagem chegar, e deixá-la para o fim garante que um
  // número inscrito é um número que já está de pé.
  await ensure(instance);

  return { connected: true };
}

/* ──────────────────────────────── já vale ────────────────────────────────── */

/**
 * Estado do número direto na Meta.
 *
 * Já implementado no W1 porque é a mesma chamada que o W6 (monitor de
 * qualidade) usa: `quality_rating` e `status` vêm no mesmo GET. Número sem
 * `provider_ref` ainda não foi cadastrado — isso é "desconectado", não erro.
 */
async function state(instance) {
  const cfg = ensureConfigured();
  const ref = refOf(instance);
  if (!ref) return { connected: false };

  const res = await call(cfg, "GET", `/${ref}?fields=verified_name,quality_rating,status,display_phone_number`);
  const data = ensureOk(res);
  return {
    connected: String(data?.status || "").toUpperCase() === "CONNECTED",
    number: data?.display_phone_number ? String(data.display_phone_number).replace(/\D/g, "") : undefined,
    qualityRating: data?.quality_rating ? String(data.quality_rating).toUpperCase() : null,
    numberStatus: data?.status ? String(data.status).toUpperCase() : null,
  };
}

/**
 * Desconectar = tirar o número do nosso WABA (`DELETE /{phone_number_id}`).
 *
 * ⚠️ Já vale no W1 de propósito: porta de saída trancada é a única que não pode
 * existir (regra da mig 220). Se o cadastro do W3 entrar e alguma coisa der
 * errado, é preciso conseguir desfazer sem esperar o slice seguinte.
 *
 * Número que já não está lá volta erro, e quem chama trata como sucesso: o
 * estado local vale mais do que o erro remoto.
 */
async function disconnect(instance) {
  const cfg = ensureConfigured();
  const ref = refOf(instance);
  if (!ref) return;
  ensureOk(await call(cfg, "DELETE", `/${ref}`));
}

module.exports = {
  provider: "cloud",
  label: "WhatsApp Business (oficial)",
  capabilities,
  CloudApiError,
  config,
  isAvailable,
  ensure,
  connect,
  state,
  disconnect,
  addNumber,
  requestCode,
  confirmCode,
  deriveTwoStepPin,
  sendText,
  fetchMedia,
};
