// src/services/ApiConnectionService.js
// Gestão das conexões de API do usuário. Dois tipos (kind):
//   'atendimento' → token flnd_atd_ que lê/responde mensagens (/ext/v1)
//   'data'        → token flnd_data_ somente-leitura de dados (/ext/v1/data)
// O token em claro só existe na resposta do create — nunca é persistido.
const crypto = require("crypto");
const pool = require("../databases");
const ApiConnectionStorage = require("../storages/ApiConnectionStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ApiConnectionService");

const MAX_ACTIVE_CONNECTIONS = 3; // por kind
const TOKEN_PREFIX = "flnd_atd_";
// Prefixo por tipo de conexão.
const KIND_TOKEN_PREFIX = {
  atendimento: "flnd_atd_",
  data: "flnd_data_",
};
const VALID_KINDS = Object.keys(KIND_TOKEN_PREFIX);

function normalizeKind(kind) {
  return VALID_KINDS.includes(kind) ? kind : "atendimento";
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

// Um token válido de QUALQUER kind (usado pelo apiConnectionAuth).
function isKnownTokenPrefix(token) {
  return VALID_KINDS.some((k) => token.startsWith(KIND_TOKEN_PREFIX[k]));
}

class ApiConnectionService {
  static async list(user, kind) {
    const k = normalizeKind(kind);
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user, kind: k }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const connections = await ApiConnectionStorage.listForUser(pool, user.id_user, k);
      return { connections };
    });
  }

  static async create(user, body, kind) {
    const k = normalizeKind(kind);
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user, kind: k }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const name = String(body?.name || "").trim();
      if (name.length < 2 || name.length > 80) {
        return { error: "Nome da conexão precisa ter entre 2 e 80 caracteres" };
      }
      // scope_personal só faz sentido no atendimento (histórico de diretas).
      const scope_personal = k === "atendimento" && body?.scope_personal === true;

      const active = await ApiConnectionStorage.countActiveForUser(pool, user.id_user, k);
      if (active >= MAX_ACTIVE_CONNECTIONS) {
        return {
          error: `Limite de ${MAX_ACTIVE_CONNECTIONS} conexões ativas atingido. Revogue uma para criar outra.`,
        };
      }

      const token = KIND_TOKEN_PREFIX[k] + crypto.randomBytes(24).toString("base64url");
      const webhook_secret = "flwh_" + crypto.randomBytes(24).toString("base64url");
      const created = await ApiConnectionStorage.create(pool, {
        id_user: user.id_user,
        name,
        token_hash: sha256Hex(token),
        token_prefix: token.slice(0, 14),
        scope_personal,
        webhook_secret,
        kind: k,
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
      // Conexões gerenciadas morrem junto com a assinatura que as criou.
      if (existing.managed_by) {
        return { error: "Conexão gerenciada pelo Atendimento IA — cancele a assinatura para removê-la.", statusCode: 403 };
      }
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
ApiConnectionService.KIND_TOKEN_PREFIX = KIND_TOKEN_PREFIX;
ApiConnectionService.VALID_KINDS = VALID_KINDS;
ApiConnectionService.isKnownTokenPrefix = isKnownTokenPrefix;

module.exports = ApiConnectionService;
