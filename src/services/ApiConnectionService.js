// src/services/ApiConnectionService.js
// Gestão das conexões de API do usuário (token pessoal do atendimento).
// O token em claro só existe na resposta do create — nunca é persistido.
const crypto = require("crypto");
const pool = require("../databases");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ApiConnectionService");

const MAX_ACTIVE_CONNECTIONS = 3;
const TOKEN_PREFIX = "flnd_atd_";

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

class ApiConnectionService {
  static async list(user) {
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const connections = await ApiConnectionStorage.listForUser(pool, user.id_user);
      return { connections };
    });
  }

  static async create(user, body) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const name = String(body?.name || "").trim();
      if (name.length < 2 || name.length > 80) {
        return { error: "Nome da conexão precisa ter entre 2 e 80 caracteres" };
      }
      const scope_personal = body?.scope_personal === true;

      const active = await ApiConnectionStorage.countActiveForUser(pool, user.id_user);
      if (active >= MAX_ACTIVE_CONNECTIONS) {
        return {
          error: `Limite de ${MAX_ACTIVE_CONNECTIONS} conexões ativas atingido. Revogue uma para criar outra.`,
        };
      }

      const token = TOKEN_PREFIX + crypto.randomBytes(24).toString("base64url");
      const webhook_secret = "flwh_" + crypto.randomBytes(24).toString("base64url");
      const created = await ApiConnectionStorage.create(pool, {
        id_user: user.id_user,
        name,
        token_hash: sha256Hex(token),
        token_prefix: token.slice(0, 14),
        scope_personal,
        webhook_secret,
      });
      if (!created) return { error: "Erro ao criar conexão" };

      // `token` sai UMA vez. O front avisa que não será mostrado de novo.
      return { connection: created, token };
    });
  }

  static async revoke(user, id_connection) {
    return runWithLogs(log, "revoke", () => ({ id_user: user?.id_user, id_connection }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const existing = await ApiConnectionStorage.getByIdForUser(pool, {
        id_connection,
        id_user: user.id_user,
      });
      if (!existing) return { error: "Conexão não encontrada" };
      if (existing.status === "revoked") return { error: "Conexão já revogada" };
      const revoked = await ApiConnectionStorage.revoke(pool, {
        id_connection,
        id_user: user.id_user,
      });
      return { connection: revoked };
    });
  }
}

ApiConnectionService.sha256Hex = sha256Hex;
ApiConnectionService.TOKEN_PREFIX = TOKEN_PREFIX;

module.exports = ApiConnectionService;
