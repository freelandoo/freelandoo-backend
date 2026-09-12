// src/utils/whatsappCloudSignature.js
// Autenticação do webhook da Meta. Módulo PURO — só criptografia, sem I/O.
//
// ─── POR QUE ISTO É UM ARQUIVO, E NÃO TRÊS LINHAS NO CONTROLLER ─────────────
//
// A rota do webhook é PÚBLICA: qualquer um na internet pode fazer POST nela. A
// única coisa que separa "a Meta falou" de "alguém descobriu a URL" é este
// HMAC. Sem ele, um estranho escreveria dentro da caixa de entrada de qualquer
// profissional da plataforma — e as mensagens pareceriam legítimas, porque
// teriam entrado pelo caminho legítimo.
//
// Separado para ser testável sem subir servidor: um erro aqui não tem sintoma
// visível, o webhook continua "funcionando" e aceitando tudo.
//
// ─── O DETALHE QUE INVALIDA A CONFERÊNCIA INTEIRA ───────────────────────────
//
// O HMAC é sobre os BYTES CRUS do corpo, exatamente como chegaram. Ler o JSON
// antes (`express.json()`) e re-serializar produz outra sequência de bytes —
// espaçamento, ordem de chaves, escapes Unicode — e a assinatura NUNCA bate.
// O sintoma de quem erra isso é sempre 401; a tentação é "desligar a checagem
// para destravar", e aí a rota volta a aceitar qualquer corpo da internet.
//
// Por isso a rota usa `express.raw()`, como o Stripe já faz no mesmo arquivo.

const crypto = require("crypto");

const PREFIX = "sha256=";

/**
 * Compara em tempo constante.
 *
 * `timingSafeEqual` LANÇA quando os buffers têm tamanhos diferentes — e um
 * header forjado tem qualquer tamanho. Comparar o comprimento antes não vaza
 * nada (o tamanho de um HMAC-SHA256 é público e fixo) e evita que um header
 * torto derrube a rota com exceção em vez de 401.
 */
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * @param {Buffer|string} rawBody bytes crus do corpo, como chegaram
 * @param {string} header valor de `X-Hub-Signature-256`
 * @param {string} appSecret o App Secret da Meta
 * @returns {boolean}
 */
function isValidSignature(rawBody, header, appSecret) {
  const secret = String(appSecret || "");
  const received = String(header || "");
  if (!secret || !received.startsWith(PREFIX)) return false;

  const hex = received.slice(PREFIX.length).trim();
  // Hex mal formado faria `Buffer.from` devolver lixo silenciosamente (ele
  // ignora o que não é hex), e um header de lixo passaria a ser comparado
  // contra um buffer truncado.
  if (!/^[0-9a-f]{64}$/i.test(hex)) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""), "utf8");
  const expected = crypto.createHmac("sha256", secret).update(body).digest();

  return safeEqual(expected, Buffer.from(hex, "hex"));
}

/**
 * Resposta ao GET de verificação da inscrição.
 *
 * A Meta chama o endereço com `hub.mode=subscribe` e um `hub.verify_token` que
 * NÓS escolhemos e cadastramos no painel. Devolver o `hub.challenge` em TEXTO
 * PURO é o que faz a inscrição ser aceita — devolver JSON, ou o challenge
 * dentro de um objeto, faz a Meta recusar sem explicar por quê.
 *
 * ⚠️ Sem `verifyToken` configurado o handshake FALHA de propósito, em vez de
 * aceitar qualquer um: quem conseguisse inscrever um endereço nosso passaria a
 * receber as conversas dos clientes.
 *
 * @returns {{ok: true, challenge: string} | {ok: false, reason: string}}
 */
function readVerification(query, verifyToken) {
  const expected = String(verifyToken || "");
  if (!expected) return { ok: false, reason: "verify token não configurado" };

  const q = query || {};
  const mode = String(q["hub.mode"] ?? "");
  const token = String(q["hub.verify_token"] ?? "");
  const challenge = String(q["hub.challenge"] ?? "");

  if (mode !== "subscribe") return { ok: false, reason: "modo inesperado" };
  if (!safeEqual(Buffer.from(token, "utf8"), Buffer.from(expected, "utf8"))) {
    return { ok: false, reason: "verify token não confere" };
  }
  if (!challenge) return { ok: false, reason: "challenge ausente" };

  return { ok: true, challenge };
}

module.exports = { isValidSignature, readVerification };
