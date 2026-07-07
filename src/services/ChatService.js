"use strict";

const pool = require("../databases");
const ChatStorage = require("../storages/ChatStorage");
const ChatReadStorage = require("../storages/ChatReadStorage");
const ChatModerationService = require("./ChatModerationService");
const realtime = require("../realtime/socket");
const {
  assertMinorPermission,
  assertMachineAllowed,
} = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ChatService");

const MAX_USERS_PER_ROOM = 100;
const MAX_MESSAGE_LENGTH = 500;
const MESSAGES_PAGE_DEFAULT = 50;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Sanitiza conteúdo de mensagem.
 * - Remove tags HTML (proteção XSS básica).
 * - Preserva todos os caracteres Unicode, incluindo emojis.
 * - Comprime espaços/newlines excessivos.
 * - Limita comprimento.
 */
// Escopo de não-lido de uma sala (não a instância): 'global' ou 'machine:<id>'.
function scopeForRoom(room) {
  if (!room) return null;
  return room.type === "global" ? "global" : `machine:${room.id_machine}`;
}

function sanitizeContent(raw) {
  if (typeof raw !== "string") return "";
  let s = raw
    // remove tags HTML — comum em XSS
    .replace(/<[^>]*>/g, "")
    // colapsa quebras excessivas (>3 newlines viram 2)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (s.length > MAX_MESSAGE_LENGTH) {
    s = s.slice(0, MAX_MESSAGE_LENGTH);
  }
  return s;
}

function mapRoom(row) {
  if (!row) return null;
  return {
    id_chat_room: row.id_chat_room,
    type: row.type,
    id_machine: row.id_machine,
    instance_number: row.instance_number,
    max_users: row.max_users,
    status: row.status,
    display_name: row.display_name,
    // internal_name intencionalmente NÃO exposto para o cliente
    current_users: typeof row.current_users === "number" ? row.current_users : undefined,
  };
}

function mapMessage(row) {
  if (!row) return null;
  const hidden = !!row.hidden_at;
  return {
    id_chat_message: row.id_chat_message,
    id_chat_room: row.id_chat_room,
    content: hidden ? "" : row.content,
    hidden,
    hidden_reason: row.hidden_reason || null,
    message_type: row.message_type,
    created_at: row.created_at,
    sender: {
      id_user: row.id_user,
      username: row.user_username,
      nome: row.user_nome,
    },
    profile: row.id_profile
      ? {
          id_profile: row.id_profile,
          display_name: row.profile_display_name,
          avatar_url: row.profile_avatar_url,
          sub_profile_slug: row.profile_slug,
          xp_level: row.profile_xp_level || 0,
          machine: row.profile_machine_id
            ? {
                id_machine: row.profile_machine_id,
                name: row.profile_machine_name,
                slug: row.profile_machine_slug,
              }
            : null,
        }
      : null,
  };
}

class ChatService {
  // ------------------------------------------------------------------
  // Entrada automática em sala (Global ou Máquina)
  // ------------------------------------------------------------------

  static async joinRoom(user, body = {}) {
    return runWithLogs(
      log,
      "joinRoom",
      () => ({ id_user: user?.id_user, type: body?.type, id_machine: body?.id_machine }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };

        const type = body?.type === "machine" ? "machine" : body?.type === "global" ? "global" : null;
        if (!type) return { error: "type inválido (use 'global' ou 'machine')" };

        // Supervisão: chats coletivos respeitam toggle do responsável.
        const permKey = type === "global" ? "can_use_global_chat" : "can_use_machine_chat";
        const minorBlock = await assertMinorPermission(user.id_user, permKey);
        if (minorBlock) return minorBlock;

        let idMachine = null;
        if (type === "machine") {
          const requested = body?.id_machine != null ? Number(body.id_machine) : null;
          if (requested != null && Number.isFinite(requested)) {
            idMachine = requested;
          } else {
            // tenta resolver máquina principal do user
            const machines = await ChatStorage.listUserMachines(pool, user.id_user);
            if (machines.length === 1) {
              idMachine = machines[0].id_machine;
            } else if (machines.length === 0) {
              return { error: "Sem enxame principal. Escolha um enxame antes." };
            } else {
              return { error: "Ambíguo. Escolha um enxame." };
            }
          }
          // valida machine
          const machine = await ChatStorage.getMachineById(pool, idMachine);
          if (!machine) return { error: "Enxame inválido" };

          // Supervisão: máquina precisa estar liberada para o menor.
          const machineBlock = await assertMachineAllowed(user.id_user, idMachine);
          if (machineBlock) return machineBlock;
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          let room = await ChatStorage.findAvailableRoom(client, { type, id_machine: idMachine });
          if (!room) {
            // cria nova instância
            const maxN = await ChatStorage.getMaxInstanceNumber(client, { type, id_machine: idMachine });
            const next = maxN + 1;
            let display_name = "Global";
            let internal_name = `global_${next}`;
            if (type === "machine") {
              const machine = await ChatStorage.getMachineById(client, idMachine);
              display_name = machine?.name || "Enxame";
              internal_name = `${machine?.slug || "machine"}_${next}`;
            }
            room = await ChatStorage.createRoom(client, {
              type,
              id_machine: idMachine,
              instance_number: next,
              max_users: MAX_USERS_PER_ROOM,
              display_name,
              internal_name,
            });
            // adiciona presença vazia
            room.current_users = 0;
          }

          await ChatStorage.upsertPresence(client, {
            id_chat_room: room.id_chat_room,
            id_user: user.id_user,
          });

          await client.query("COMMIT");

          // re-conta presença pós-join (inclui o próprio usuário)
          const online = await ChatStorage.countOnline(pool, room.id_chat_room);
          return {
            room: { ...mapRoom(room), current_users: online },
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  // ------------------------------------------------------------------
  // Listar máquinas do user (para o seletor quando ambíguo / fallback)
  // ------------------------------------------------------------------

  static async listUserMachines(user) {
    return runWithLogs(
      log,
      "listUserMachines",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const own = await ChatStorage.listUserMachines(pool, user.id_user);
        const all = await ChatStorage.listAllActiveMachines(pool);
        return {
          user_machines: own.map((m) => ({
            id_machine: m.id_machine,
            name: m.name,
            slug: m.slug,
            color_accent: m.color_accent,
          })),
          all_machines: all,
        };
      }
    );
  }

  // ------------------------------------------------------------------
  // Heartbeat de presença
  // ------------------------------------------------------------------

  static async heartbeat(user, params) {
    return runWithLogs(
      log,
      "heartbeat",
      () => ({ id_user: user?.id_user, id_chat_room: params?.id_chat_room }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_chat_room = params?.id_chat_room;
        if (!id_chat_room || !UUID_RE.test(id_chat_room)) {
          return { error: "id_chat_room inválido" };
        }
        const room = await ChatStorage.getRoomById(pool, id_chat_room);
        if (!room) return { error: "Sala não encontrada" };
        await ChatStorage.upsertPresence(pool, {
          id_chat_room,
          id_user: user.id_user,
        });
        const online = await ChatStorage.countOnline(pool, id_chat_room);
        return { ok: true, current_users: online };
      }
    );
  }

  static async leaveRoom(user, params) {
    return runWithLogs(
      log,
      "leaveRoom",
      () => ({ id_user: user?.id_user, id_chat_room: params?.id_chat_room }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_chat_room = params?.id_chat_room;
        if (!id_chat_room || !UUID_RE.test(id_chat_room)) {
          return { error: "id_chat_room inválido" };
        }
        await ChatStorage.removePresence(pool, {
          id_chat_room,
          id_user: user.id_user,
        });
        return { ok: true };
      }
    );
  }

  // ------------------------------------------------------------------
  // Mensagens
  // ------------------------------------------------------------------

  static async listMessages(user, params, query) {
    return runWithLogs(
      log,
      "listMessages",
      () => ({ id_user: user?.id_user, id_chat_room: params?.id_chat_room }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_chat_room = params?.id_chat_room;
        if (!id_chat_room || !UUID_RE.test(id_chat_room)) {
          return { error: "id_chat_room inválido" };
        }
        const room = await ChatStorage.getRoomById(pool, id_chat_room);
        if (!room) return { error: "Sala não encontrada" };

        const limit = Math.min(Math.max(parseInt(query?.limit, 10) || MESSAGES_PAGE_DEFAULT, 1), 100);
        const before = query?.before || null;

        // toca presença (usuário está ativamente lendo)
        await ChatStorage.upsertPresence(pool, {
          id_chat_room,
          id_user: user.id_user,
        });

        // marca o escopo (global/enxame) como lido — apaga a bolinha de não-lido
        await ChatReadStorage.markRead(pool, {
          id_user: user.id_user,
          scope: scopeForRoom(room),
        }).catch(() => {});

        const rows = await ChatStorage.listMessages(pool, {
          id_chat_room,
          before,
          limit,
        });
        const items = rows.map(mapMessage).filter(Boolean);
        const oldest = items.length > 0 ? items[items.length - 1].created_at : null;
        const online = await ChatStorage.countOnline(pool, id_chat_room);
        return {
          items, // DESC: mais novas primeiro (frontend inverte)
          next_before: items.length === limit ? oldest : null,
          has_more: items.length === limit,
          current_users: online,
        };
      }
    );
  }

  static async sendMessage(user, params, body) {
    return runWithLogs(
      log,
      "sendMessage",
      () => ({ id_user: user?.id_user, id_chat_room: params?.id_chat_room }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_chat_room = params?.id_chat_room;
        if (!id_chat_room || !UUID_RE.test(id_chat_room)) {
          return { error: "id_chat_room inválido" };
        }

        const room = await ChatStorage.getRoomById(pool, id_chat_room);
        if (!room) return { error: "Sala não encontrada" };
        if (room.status !== "active") return { error: "Sala não está ativa" };

        const sanitized = sanitizeContent(body?.content);
        if (!sanitized) return { error: "Mensagem vazia" };

        // Moderação (rate limit, profanity, blocked_terms, links, score)
        const moderation = await ChatModerationService.moderateMessage({
          id_user: user.id_user,
          room_type: room.type,
          original_text: sanitized,
        });

        if (
          moderation.action === "block" ||
          moderation.action === "mute_temp" ||
          moderation.action === "review"
        ) {
          // Log da decisão mesmo sem id_chat_message (mensagem não chega a existir)
          await ChatModerationService.applyResult({
            moderation,
            id_user: user.id_user,
            id_chat_room,
            id_chat_message: null,
          });
          return {
            error:
              moderation.user_facing_error ||
              (moderation.action === "review"
                ? "Mensagem em análise."
                : "Mensagem bloqueada."),
            moderation_action: moderation.action,
          };
        }

        // resolve perfil pra anexar (badge)
        let id_profile = null;
        if (room.type === "machine" && room.id_machine) {
          id_profile = await ChatStorage.getUserProfileForMachine(pool, {
            id_user: user.id_user,
            id_machine: room.id_machine,
          });
        }
        if (!id_profile) {
          id_profile = await ChatStorage.getUserAnyProfile(pool, user.id_user);
        }

        // Conteúdo final: máscara se aplicável
        const finalContent =
          moderation.action === "mask" && moderation.masked_content
            ? moderation.masked_content
            : sanitized;

        const inserted = await ChatStorage.insertMessage(pool, {
          id_chat_room,
          id_user: user.id_user,
          id_profile,
          content: finalContent,
          message_type: "text",
        });

        // Loga o resultado vinculando ao id_chat_message
        await ChatModerationService.applyResult({
          moderation,
          id_user: user.id_user,
          id_chat_room,
          id_chat_message: inserted.id_chat_message,
        });

        // bump presença
        await ChatStorage.upsertPresence(pool, {
          id_chat_room,
          id_user: user.id_user,
        });

        // quem envia está lendo → marca o escopo como lido
        await ChatReadStorage.markRead(pool, {
          id_user: user.id_user,
          scope: scopeForRoom(room),
        }).catch(() => {});

        // re-lê com enriquecimento (mesmo formato do list)
        const enriched = await ChatStorage.listMessages(pool, {
          id_chat_room,
          before: null,
          limit: 1,
        });
        const message = enriched.length > 0 ? mapMessage(enriched[0]) : null;
        const finalMessage = message || mapMessage({ ...inserted });

        // Push pra quem está na sala (WebSocket) — o front não faz mais poll
        // curto de mensagens; sem esse emit, mensagem nova só apareceria no
        // fallback lento.
        realtime.emitToChatRoom(id_chat_room, "chat:message", {
          id_chat_room,
          message: finalMessage,
        });

        return { message: finalMessage };
      }
    );
  }

  static async deleteOwnMessage(user, params) {
    return runWithLogs(
      log,
      "deleteOwnMessage",
      () => ({ id_user: user?.id_user, id_chat_message: params?.id_chat_message }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_chat_message = params?.id_chat_message;
        if (!id_chat_message || !UUID_RE.test(id_chat_message)) {
          return { error: "id_chat_message inválido" };
        }
        const message = await ChatStorage.getMessageById(pool, id_chat_message);
        if (!message) return { error: "Mensagem não encontrada" };
        if (message.deleted_at) return { ok: true };
        const isOwner = String(message.id_user) === String(user.id_user);
        const isAdmin = !!user?.is_admin;
        if (!isOwner && !isAdmin) {
          return { error: "Sem permissão para apagar" };
        }
        await ChatStorage.softDeleteMessage(pool, id_chat_message);
        realtime.emitToChatRoom(message.id_chat_room, "chat:message:deleted", {
          id_chat_room: message.id_chat_room,
          id_chat_message,
        });
        return { ok: true };
      }
    );
  }

  static async reportMessage(user, params, body) {
    return runWithLogs(
      log,
      "reportMessage",
      () => ({ id_user: user?.id_user, id_chat_message: params?.id_chat_message }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_chat_message = params?.id_chat_message;
        if (!id_chat_message || !UUID_RE.test(id_chat_message)) {
          return { error: "id_chat_message inválido" };
        }
        const message = await ChatStorage.getMessageById(pool, id_chat_message);
        if (!message) return { error: "Mensagem não encontrada" };
        if (String(message.id_user) === String(user.id_user)) {
          return { error: "Não dá pra denunciar a própria mensagem" };
        }
        const reason = (body?.reason || "").toString().trim().slice(0, 280);
        const reason_category = (body?.reason_category || "").toString().trim().slice(0, 40) || null;
        await ChatStorage.insertReport(pool, {
          id_chat_message,
          id_reporter_user: user.id_user,
          reason: reason || null,
          reason_category,
        });
        // Pós-denúncia: pode esconder automaticamente e/ou marcar pra revisão.
        try {
          await ChatModerationService.onMessageReported({ id_chat_message });
        } catch (err) {
          log.warn("report.post_hook_fail", { id_chat_message, message: err.message });
        }
        return { ok: true };
      }
    );
  }

  // ------------------------------------------------------------------
  // Não-lido (bolinhas): quais escopos têm mensagem nova desde a última leitura
  // ------------------------------------------------------------------
  static async unreadSummary(user) {
    return runWithLogs(
      log,
      "unreadSummary",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) {
          return { global: false, machines: [], total: 0 };
        }
        const [activity, reads] = await Promise.all([
          ChatReadStorage.activityByScope(pool, user.id_user),
          ChatReadStorage.readByScope(pool, user.id_user),
        ]);
        let global = false;
        const machines = [];
        for (const row of activity) {
          const lastRead = reads.get(row.scope);
          const lastMsg = row.last_msg_at ? new Date(row.last_msg_at).getTime() : 0;
          const seen = lastRead ? new Date(lastRead).getTime() : 0;
          if (lastMsg <= seen) continue; // já lido
          if (row.scope === "global") {
            global = true;
          } else if (row.scope.startsWith("machine:")) {
            const id_machine = Number(row.scope.slice("machine:".length));
            if (Number.isFinite(id_machine)) machines.push(id_machine);
          }
        }
        return {
          global,
          machines,
          total: (global ? 1 : 0) + machines.length,
        };
      }
    );
  }
}

module.exports = ChatService;
module.exports.MAX_USERS_PER_ROOM = MAX_USERS_PER_ROOM;
module.exports.MAX_MESSAGE_LENGTH = MAX_MESSAGE_LENGTH;
