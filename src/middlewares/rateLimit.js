// Rate limiters por categoria.
//
// Webhooks (Stripe/Melhor Envio) NÃO devem passar por aqui — eles são
// montados antes do roteador principal e seu volume é controlado pelo
// próprio Stripe (retries com backoff). Aplicar rate limit poderia
// devolver 429 para um retry legítimo e mascarar perda de evento.
//
// Decisões:
//   - `windowMs`/`max` calibrados para um único usuário ativo numa rede
//     compartilhada (ex.: empresa com NAT). Se aparecer falso positivo
//     real, frouxar AQUI, não no controller.
//   - `standardHeaders: "draft-7"` envia `RateLimit-*` na resposta para
//     o cliente saber quando tentar de novo.
//   - `skip` em desenvolvimento para não atrapalhar o fluxo local.

const rateLimit = require("express-rate-limit");
const { createLogger } = require("../utils/logger");

const log = createLogger("rate-limit");

function buildHandler(name) {
  return (req, res, _next, options) => {
    log.warn("rate_limit.hit", {
      preset: name,
      ip: req.ip,
      path: req.originalUrl || req.url,
      method: req.method,
      requestId: req.requestId,
    });
    res.status(options.statusCode).json({
      error: "Muitas requisições. Tente novamente em instantes.",
      retryAfterSeconds: Math.ceil(options.windowMs / 1000),
    });
  };
}

const isDev = process.env.NODE_ENV !== "production";

function makeLimiter({ name, windowMs, max }) {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    handler: buildHandler(name),
    skip: () => isDev,
  });
}

// 5 tentativas a cada 60s por IP — bloqueia brute force de senha sem
// atrapalhar o usuário que erra duas vezes seguidas.
const auth = makeLimiter({
  name: "auth",
  windowMs: 60 * 1000,
  max: 5,
});

// 20 uploads por hora por IP — cobre todo o fluxo de portfólio + avatar
// + manifestação + curso. Multer já barra payload acima do limite.
const upload = makeLimiter({
  name: "upload",
  windowMs: 60 * 60 * 1000,
  max: 20,
});

// 30 mensagens/min por IP — protege endpoint de chat sem inviabilizar
// conversa real. O socket.io tem rate próprio (não passa por aqui).
const chat = makeLimiter({
  name: "chat",
  windowMs: 60 * 1000,
  max: 30,
});

// 30 checkout calls/min — Stripe tem rate-limit próprio bem acima disso.
const checkout = makeLimiter({
  name: "checkout",
  windowMs: 60 * 1000,
  max: 30,
});

module.exports = { auth, upload, chat, checkout };
