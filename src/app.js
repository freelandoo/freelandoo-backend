const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const routes = require("./routes");
const webhooksRoutes = require("./routes/webhooks.routes");
const requestId = require("./middlewares/requestId");
const { createLogger } = require("./utils/logger");

const appLog = createLogger("app");

const app = express();

// Confia no X-Forwarded-For (Railway/Vercel terminam TLS upstream).
// Necessário para que `req.ip` seja o IP real do cliente, usado pelo
// rate limiter e pelo audit log.
app.set("trust proxy", 1);

const allowedOrigins = [
  "https://v0.dev",
  "http://localhost:3000",
  "https://freelandoo.com.br",
  "https://www.freelandoo.com.br",
];

const allowedOriginPatterns = [
  /^https:\/\/([a-z0-9-]+\.)*v0\.dev$/i,
  /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i,
  /^https:\/\/([a-z0-9-]+\.)*freelandoo\.com\.br$/i,
];

const corsOptions = {
  origin(origin, callback) {
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }

    const matchesPattern = allowedOriginPatterns.some((pattern) =>
      pattern.test(origin)
    );
    if (matchesPattern) {
      return callback(null, true);
    }

    const err = new Error("Origin não permitida pelo CORS");
    err.statusCode = 403;
    return callback(err);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
  exposedHeaders: ["X-Request-Id", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
  credentials: true,
  optionsSuccessStatus: 200,
};

// Helmet com defaults — `contentSecurityPolicy: false` porque a API
// devolve JSON, não HTML, e estamos atrás do CORS já restrito acima.
// `crossOriginResourcePolicy: false` porque os assets do bucket R2 são
// servidos via URL pública direta (não passam por aqui).
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: false,
  })
);

app.use(requestId);

app.use("/storage", express.static(path.join(__dirname, "..", "storage")));
app.use(cors(corsOptions));

// Webhooks precisam do body raw (verificação de assinatura Stripe/Melhor Envio).
// Montado ANTES do express.json() pra não ser consumido, e ANTES do rate limit
// pra não devolver 429 em retry legítimo do provedor.
app.use("/webhooks", webhooksRoutes);

// Limite de 1MB cobre praticamente todo POST/PUT JSON do projeto
// (signin, perfil, comentário, etc). Uploads de arquivo usam multer
// em outras rotas e têm seu próprio limite.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    appLog.info("request.complete", {
      requestId: req.requestId,
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      ms: Date.now() - start,
      user: req.user?.id_user,
    });
  });
  next();
});

// Audit log estruturado em qualquer rota /admin/*. Não cria tabela —
// vai pro logger central. Migrar pra `audit_log` em mig futura se virar
// necessidade pesquisável.
const auditAdmin = require("./middlewares/auditAdmin");
app.use("/admin", auditAdmin);

// Log de rotas persistido (Painel de Arquitetura → aba Logs). Fire-and-forget,
// foca em erros (>= 400); sucessos só por amostragem. Não derruba request.
const routeLog = require("./middlewares/routeLog");
app.use(routeLog);

// rotas
routes(app);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const isUploadError =
    err.name === "MulterError" ||
    ["Formato nao aceito", "Tipo de arquivo nao permitido"].some((msg) =>
      String(err.message || "").includes(msg)
    );
  const isPayloadTooLarge =
    err.type === "entity.too.large" || err.status === 413;
  const statusCode =
    err.statusCode ||
    (isPayloadTooLarge ? 413 : isUploadError ? 400 : 500);
  const message =
    err.code === "LIMIT_FILE_SIZE"
      ? "Arquivo muito grande para upload."
      : isPayloadTooLarge
      ? "Payload acima do limite permitido."
      : err.message || "Erro interno no servidor";

  if (statusCode >= 500) {
    appLog.error("error_handler", {
      requestId: req.requestId,
      statusCode,
      message: err?.message,
      stack: err?.stack,
      method: req.method,
      url: req.originalUrl || req.url,
    });
  }

  // Detalhe do erro para o routeLog persistir em arch_route_logs (Painel de Arquitetura).
  res.locals.archError = { message: err?.message, stack: err?.stack };

  return res.status(statusCode).json({ error: message });
});

module.exports = app;
