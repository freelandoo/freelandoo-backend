// src/integrations/whatsappProvider/evolution.js
// Adaptador da Evolution API (Baileys) para o contrato de `whatsappProvider`.
//
// ─── ISTO É UM TRADUTOR, NÃO UMA REESCRITA ──────────────────────────────────
//
// O cliente HTTP continua em `integrations/evolution` — arquivo grande, bem
// documentado e em produção desde a mig 223. Movê-lo para cá só trocaria o
// caminho do require e tornaria o diff desta migração grande o bastante para
// esconder uma regressão. O que este arquivo faz é ESCONDER O `cfg`: o Service
// deixa de carregar credencial de um lado para outro e passa a falar em
// instâncias.
//
// ─── ⚠️ ESTE PROVEDOR É NÃO-OFICIAL ─────────────────────────────────────────
//
// A Evolution se passa por WhatsApp Web e viola os Termos da Meta. O número do
// usuário pode ser banido de forma PERMANENTE e sem recurso — a janela típica
// de detecção é de semanas. Ele continua aqui porque desligá-lo antes de o
// oficial estar de pé deixaria todo mundo sem canal, e porque quem já conectou
// precisa continuar podendo DESCONECTAR.
//
// Conexão NOVA deve preferir o `cloud` (ver `defaultProvider` no index).

const evolution = require("../evolution");

/**
 * A Evolution mantém uma SESSÃO Baileys viva por número conectado, e é ela que
 * custa memória enquanto está de pé — daí `idleSession: true`, que é o que
 * autoriza o sweeper da mig 224 a desligar quem não abre a caixa há dias.
 *
 * Não tem janela de atendimento (responde a qualquer hora) nem nota de
 * qualidade: essas duas são da Meta.
 */
const capabilities = Object.freeze({
  qrPairing: true,
  numberRegistration: false,
  serviceWindow: false,
  qualityRating: false,
  idleSession: true,
});

/** A ENV decide, não a flag (regra da mig 214). */
function isAvailable() {
  return evolution.isConfigured();
}

/** O nome da instância é o `provider_ref` — a coluna tem nome legado. */
function refOf(instance) {
  return instance?.evolution_instance;
}

/**
 * Cria a instância do lado da Evolution e aponta o webhook para cá.
 * Idempotente: a Evolution aceita recriar, e o Service chama a cada QR.
 */
async function ensure(instance) {
  const cfg = evolution.config();
  await evolution.createInstance(cfg, refOf(instance));
}

/** Levanta a sessão e devolve o QR (ou o estado, se já estava conectada). */
async function connect(instance) {
  const cfg = evolution.config();
  const r = await evolution.connect(cfg, refOf(instance));
  return {
    connected: !!r.connected,
    qrBase64: r.qrBase64,
    pairingCode: r.pairingCode,
  };
}

/**
 * ⚠️ `connected` pode ser `null`, e isso é um TERCEIRO estado, não um falso.
 *
 * `connectionState` devolve `null` quando a Evolution não respondeu — e quem
 * chama precisa distinguir "está desconectado" de "não sei": tratar os dois
 * como desconectado faz a caixa de quem está conversando virar um botão de
 * conectar por causa de um soluço de rede. Um `!!open` aqui apagaria essa
 * distinção em silêncio.
 */
async function state(instance) {
  const cfg = evolution.config();
  const open = await evolution.connectionState(cfg, refOf(instance));
  return { connected: open };
}

async function disconnect(instance) {
  const cfg = evolution.config();
  await evolution.logout(cfg, refOf(instance));
}

async function sendText(instance, dest, text) {
  const cfg = evolution.config();
  return evolution.sendText(cfg, refOf(instance), dest, text);
}

async function fetchMedia(instance, ref) {
  const cfg = evolution.config();
  return evolution.fetchMedia(cfg, refOf(instance), ref);
}

module.exports = {
  provider: "evolution",
  label: "Evolution (não-oficial)",
  capabilities,
  isAvailable,
  ensure,
  connect,
  state,
  disconnect,
  sendText,
  fetchMedia,
};
