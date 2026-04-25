const express = require("express");
const cors = require("cors");
const path = require("path");
const routes = require("./routes");
const webhooksRoutes = require("./routes/webhooks.routes");
const { createLogger } = require("./utils/logger");

const appLog = createLogger("app");

const app = express();

const allowedOrigins = ["https://v0.dev", "http://localhost:3000"];

const allowedOriginPatterns = [
  /^https:\/\/([a-z0-9-]+\.)*v0\.dev$/i,
  /^https:\/\/([a-z0-9-]+\.)*vercel\.app$/i,
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
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
  optionsSuccessStatus: 200,
};

app.use("/storage", express.static(path.join(__dirname, "..", "storage")));
app.use(cors(corsOptions));

// Webhooks precisam do body raw (verificação de assinatura Stripe).
// Montado ANTES do express.json() pra não ser consumido.
app.use("/webhooks", webhooksRoutes);

app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    appLog.info("request.complete", {
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      ms: Date.now() - start,
      user: req.user?.id_user,
    });
  });
  next();
});

// rotas
routes(app);

app.use((err, req, res, next) => {
  if (res.headersSent) {
    return next(err);
  }

  const statusCode = err.statusCode || 500;
  const message = err.message || "Erro interno no servidor";

  if (statusCode >= 500) {
    appLog.error("error_handler", {
      statusCode,
      message: err?.message,
      stack: err?.stack,
      method: req.method,
      url: req.originalUrl || req.url,
    });
  }

  return res.status(statusCode).json({ error: message });
});

module.exports = app;
