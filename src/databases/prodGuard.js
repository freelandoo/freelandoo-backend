/**
 * TRAVA DE PRODUÇÃO — segurança 0B (2026-11-09).
 *
 * Fora do servidor, nada conecta num banco remoto por acidente: script, seed,
 * backfill ou `npm run dev` com uma DATABASE_URL de produção esquecida no
 * ambiente recusam rodar, a não ser que a pessoa diga que quer (`--prod` na
 * linha de comando ou `FL_ALLOW_PROD=1`).
 *
 * Conta como "servidor" (passa direto): rodando no Railway (variáveis RAILWAY_*
 * que a plataforma injeta) OU `NODE_ENV=production` (o Dockerfile fixa). São
 * dois sinais independentes de propósito: a trava NUNCA pode derrubar a produção.
 *
 * Conta como "local" (passa direto): localhost, 127.0.0.1, ::1 e socket.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", ""]);

function hostOf(connectionString) {
  try {
    return new URL(connectionString).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return null;
  }
}

function isServerRuntime(env = process.env) {
  return (
    env.NODE_ENV === "production" ||
    Boolean(env.RAILWAY_PROJECT_ID || env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_SERVICE_ID)
  );
}

function prodAllowed(argv = process.argv, env = process.env) {
  return argv.includes("--prod") || env.FL_ALLOW_PROD === "1";
}

/**
 * Lança se `connectionString` aponta para fora da máquina e ninguém liberou.
 * Sem string (banco não configurado) não é problema desta trava.
 */
function assertDbAllowed(connectionString, { label = "banco", argv = process.argv, env = process.env } = {}) {
  if (!connectionString) return;
  if (isServerRuntime(env)) return;
  const host = hostOf(connectionString);
  if (host !== null && LOCAL_HOSTS.has(host)) return;
  if (prodAllowed(argv, env)) return;
  const err = new Error(
    `[trava de produção] ${label} aponta para um host remoto (${host || "?"}). ` +
      "Fora do servidor isso só roda com --prod na linha de comando (ou FL_ALLOW_PROD=1). " +
      "Para desenvolver, use o Postgres local no .env."
  );
  err.code = "FL_PROD_GUARD";
  throw err;
}

module.exports = { assertDbAllowed, isServerRuntime, hostOf };
