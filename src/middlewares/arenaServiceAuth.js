// Canal servidor↔servidor da Freelandoo Arena (Módulo 06/07).
//
// O servidor de jogo (arena-server) conhece a POSIÇÃO; o backend conhece a
// conta, as preferências e o placar. Uma rota com o Bearer do usuário que
// aceitasse "{ x, y, valid: true }" não provaria nada — o navegador poderia
// chamá-la. Por isso as rotas /arena/internal/* exigem, ALÉM do token do
// usuário (que continua identificando o titular), uma assinatura do serviço:
//
//   X-Arena-Service-Timestamp  ms desde a época (janela ±30 s)
//   X-Arena-Service-Nonce      16–64 caracteres base64url, uso único
//   X-Arena-Service-Signature  hex(HMAC-SHA256(ARENA_SERVICE_SECRET,
//                                  METHOD \n URL \n TIMESTAMP \n NONCE \n sha256hex(corpo)))
//
// ARENA_SERVICE_SECRET é SÓ deste canal: nunca o JWT_SECRET da plataforma
// (recusado se for igual) e nunca vai ao navegador. Sem o segredo configurado
// o canal fica FECHADO (503), nunca aberto.
//
// Anti-replay: nonce guardado até sair da janela. Funciona para UMA instância
// do backend (o caso atual). Com várias instâncias, a proteção durável de
// checkpoint continua sendo o requestId único no banco; o nonce em memória vira
// defesa adicional por instância (ver relatório do M06/M07).

const crypto = require("node:crypto");
const { createLogger } = require("../utils/logger");

const log = createLogger("arenaServiceAuth");

const SKEW_MS = 30_000;
const NONCE = /^[A-Za-z0-9_-]{16,64}$/;
const MAX_NONCES = 200_000;

function deny(res, status, code, error) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(status).json({ error, code });
}

function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf || Buffer.alloc(0)).digest("hex");
}

function canonical({ method, url, ts, nonce, bodyHash }) {
  return `${method.toUpperCase()}\n${url}\n${ts}\n${nonce}\n${bodyHash}`;
}

function sign(secret, parts) {
  return crypto.createHmac("sha256", secret).update(canonical(parts)).digest("hex");
}

function readSecret(env = process.env) {
  const s = env.ARENA_SERVICE_SECRET || "";
  if (s.length < 32) return null;
  if (env.JWT_SECRET && s === env.JWT_SECRET) return null;
  return s;
}

function createArenaServiceAuth({ secret = () => readSecret(), now = () => Date.now() } = {}) {
  const seen = new Map(); // nonce → expira em (ms)
  let lastSweep = 0;
  const sweep = (t) => {
    if (t - lastSweep < 5_000 && seen.size < MAX_NONCES) return;
    lastSweep = t;
    for (const [k, exp] of seen) if (exp <= t) seen.delete(k);
  };

  return function arenaServiceAuth(req, res, next) {
    const key = secret();
    if (!key) {
      log.error("service_secret.missing", { path: req.originalUrl });
      return deny(res, 503, "service_auth_invalid", "Canal interno da Arena não configurado");
    }
    const ts = req.headers["x-arena-service-timestamp"];
    const nonce = req.headers["x-arena-service-nonce"];
    const sig = req.headers["x-arena-service-signature"];
    if (!ts || !nonce || !sig) return deny(res, 401, "service_auth_required", "Rota interna da Arena");
    const t = now();
    const tsNum = Number(ts);
    if (!/^\d{10,16}$/.test(String(ts)) || !Number.isFinite(tsNum) || Math.abs(t - tsNum) > SKEW_MS) {
      return deny(res, 401, "service_auth_invalid", "Assinatura fora da janela");
    }
    if (!NONCE.test(String(nonce)) || !/^[0-9a-f]{64}$/.test(String(sig))) {
      return deny(res, 401, "service_auth_invalid", "Assinatura inválida");
    }
    const expected = sign(key, {
      method: req.method,
      url: req.originalUrl,
      ts: String(ts),
      nonce: String(nonce),
      bodyHash: sha256Hex(req.rawBody),
    });
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(String(sig), "hex");
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      log.warn("signature.invalid", { path: req.originalUrl });
      return deny(res, 401, "service_auth_invalid", "Assinatura inválida");
    }
    sweep(t);
    if (seen.has(String(nonce))) return deny(res, 401, "service_replay", "Requisição repetida");
    if (seen.size >= MAX_NONCES) return deny(res, 503, "service_auth_invalid", "Canal interno ocupado");
    seen.set(String(nonce), t + 2 * SKEW_MS);
    req.arenaService = { at: t };
    return next();
  };
}

module.exports = { createArenaServiceAuth, sign, sha256Hex, readSecret, canonical, SKEW_MS };
