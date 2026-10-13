// src/services/AppLinkService.js
//
// VÍNCULO DO APP NATIVO (mig 278) — o EVO Brazil Android entra na conta da
// Freelandoo sem pedir senha dentro do app.
//
// Fluxo: (1) logado no site, a pessoa gera um CÓDIGO (5 min, uso único);
// (2) o app troca o código por um REFRESH TOKEN opaco + um JWT de 1 dia;
// (3) a cada abertura o app troca o refresh token por um JWT novo.
//
// ⚠️ O JWT emitido é IDÊNTICO ao do login ({id_user, email}, JWT_EXPIRES_IN):
// é ele que a Monsters API valida via GET /users/me, e um formato à parte
// exigiria mudar os dois lados. O que torna a sessão do app revogável é o
// refresh token — revogado, o app para de conseguir JWT novo.
//
// ⚠️ Conta BLOQUEADA (mig 201) não troca código nem renova: mesma regra do
// signin, checada a cada renovação (é a única hora em que o app passa por aqui).

const jwt = require("jsonwebtoken");
const pool = require("../databases/index");
const AppLinkStorage = require("../storages/AppLinkStorage");
const {
  CODE_TTL_SECONDS,
  generateCode,
  normalizeCode,
  formatCode,
  sha256,
  generateSessionToken,
  isSessionTokenShape,
} = require("../utils/appLinkCode");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AppLinkService");

// Mensagem ÚNICA para código errado, vencido ou já usado: distinguir os três
// diria a quem tenta adivinhar quais códigos existem.
const BAD_CODE = "Código inválido ou expirado. Gere outro no site.";
const BAD_SESSION = "Sessão do app inválida. Vincule a conta de novo.";

function signAccess(user) {
  return jwt.sign(
    { id_user: user.id_user, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
  );
}

function publicUser(u) {
  return { id_user: u.id_user, nome: u.nome, username: u.username, avatar: u.avatar || null };
}

function cleanLabel(raw) {
  if (typeof raw !== "string") return null;
  const s = Array.from(raw).filter((ch) => ch.charCodeAt(0) >= 32).join("").trim().slice(0, 80);
  return s || null;
}

class AppLinkService {
  static async createCode(id_user) {
    return runWithLogs(log, "createCode", () => ({ id_user }), async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await AppLinkStorage.invalidateLiveCodes(client, id_user);
        // Colisão de hash é astronomicamente improvável, mas o índice é
        // único: tenta de novo em vez de devolver 500.
        let row = null;
        let code = null;
        for (let i = 0; i < 3 && !row; i += 1) {
          code = generateCode();
          try {
            await client.query("SAVEPOINT sp_code");
            row = await AppLinkStorage.createCode(client, {
              id_user,
              code_hash: sha256(code),
              ttl_seconds: CODE_TTL_SECONDS,
            });
          } catch (err) {
            await client.query("ROLLBACK TO SAVEPOINT sp_code");
            if (err.code !== "23505") throw err;
          }
        }
        if (!row) throw new Error("não foi possível gerar o código");
        await client.query("COMMIT");
        return {
          code: formatCode(code),
          expires_at: row.expires_at,
          ttl_seconds: CODE_TTL_SECONDS,
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async exchange(body) {
    return runWithLogs(log, "exchange", () => ({}), async () => {
      const code = normalizeCode(body?.code);
      if (!code) return { error: BAD_CODE, statusCode: 400 };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const id_user = await AppLinkStorage.consumeCode(client, sha256(code));
        if (!id_user) {
          await client.query("ROLLBACK");
          return { error: BAD_CODE, statusCode: 400 };
        }
        const user = await AppLinkStorage.getUserForApp(client, id_user);
        if (!user || user.blocked_at) {
          // O código fica consumido mesmo assim (COMMIT): conta bloqueada não
          // reaproveita o código depois do desbloqueio.
          await client.query("COMMIT");
          return { error: "Esta conta está bloqueada.", statusCode: 403 };
        }
        const refresh_token = generateSessionToken();
        const session = await AppLinkStorage.createSession(client, {
          id_user,
          token_hash: sha256(refresh_token),
          device_label: cleanLabel(body?.device),
        });
        await client.query("COMMIT");
        log.info("exchange.ok", { id_user, id_app_session: session.id_app_session });
        return {
          refresh_token,
          access_token: signAccess(user),
          id_app_session: session.id_app_session,
          user: publicUser(user),
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async refresh(body) {
    return runWithLogs(log, "refresh", () => ({}), async () => {
      const raw = body?.refresh_token;
      if (!isSessionTokenShape(raw)) return { error: BAD_SESSION, statusCode: 401 };
      const session = await AppLinkStorage.touchLiveSession(pool, sha256(raw));
      if (!session) return { error: BAD_SESSION, statusCode: 401 };
      const user = await AppLinkStorage.getUserForApp(pool, session.id_user);
      if (!user || user.blocked_at) {
        return { error: "Esta conta está bloqueada.", statusCode: 403 };
      }
      return { access_token: signAccess(user), user: publicUser(user) };
    });
  }

  /** "Sair da conta" dentro do app: revoga a própria sessão. Idempotente. */
  static async logout(body) {
    return runWithLogs(log, "logout", () => ({}), async () => {
      const raw = body?.refresh_token;
      if (isSessionTokenShape(raw)) await AppLinkStorage.revokeByToken(pool, sha256(raw));
      return { ok: true };
    });
  }

  static async listSessions(id_user) {
    return runWithLogs(log, "listSessions", () => ({ id_user }), async () => ({
      sessions: await AppLinkStorage.listLiveForUser(pool, id_user),
    }));
  }

  static async revokeSession(id_user, id_app_session) {
    return runWithLogs(log, "revokeSession", () => ({ id_user }), async () => {
      if (!/^[0-9a-f-]{36}$/i.test(String(id_app_session || ""))) {
        return { error: "Sessão não encontrada", statusCode: 404 };
      }
      const ok = await AppLinkStorage.revokeForUser(pool, id_user, id_app_session);
      if (!ok) return { error: "Sessão não encontrada", statusCode: 404 };
      return { ok: true };
    });
  }
}

module.exports = AppLinkService;
