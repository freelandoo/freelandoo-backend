const pool = require("../databases");
const NotificationService = require("./NotificationService");
const ConversationStorage = require("../storages/ConversationStorage");
const MessageStorage = require("../storages/MessageStorage");
const EntityFollowStorage = require("../storages/EntityFollowStorage");
const {
  assertMinorPermission,
  getSupervisionState,
} = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");
const ProfileStorage = require("../storages/ProfileStorage");

const log = createLogger("ConversationService");

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_MESSAGES = 30;
const MAX_BODY_LENGTH = 4000;

function normalizeActorType(value) {
  const t = String(value || "").trim().toLowerCase();
  if (t === "clan") return "clan";
  if (t === "profile" || t === "subprofile") return "profile";
  return null;
}

function mapEntityRow(row) {
  if (!row) return null;
  return {
    id: row.id || row.id_profile,
    type: row.type || (row.is_clan ? "clan" : "profile"),
    display_name: row.display_name,
    bio: row.bio,
    avatar_url: row.avatar_url,
    estado: row.estado,
    municipio: row.municipio,
    username: row.username,
    sub_profile_slug: row.sub_profile_slug,
    profession_name: row.profession_name,
    profession_slug: row.profession_slug,
    machine_name: row.machine_name,
    machine_slug: row.machine_slug,
    members_count: row.members_count,
  };
}

function mapMessage(row) {
  if (!row) return null;
  return {
    id_message: row.id_message,
    id_conversation: row.id_conversation,
    sender_entity_type: row.sender_entity_type,
    sender_entity_id: row.sender_entity_id,
    sender_user_id: row.sender_user_id,
    body: row.body,
    status: row.status,
    created_at: row.created_at,
    deleted_at: row.deleted_at,
  };
}

function mapConversationListItem(row, viewerEntityId) {
  return {
    id_conversation: row.id_conversation,
    conversation_key: row.conversation_key,
    kind: row.kind || "direct",
    name: row.name || null,
    cover_url: row.cover_url || null,
    owner_profile_id: row.owner_profile_id || null,
    member_count: row.member_count ?? null,
    other_entity_id: row.other_entity_id,
    last_message_at: row.last_message_at,
    last_message_preview: row.last_message_preview,
    last_message_sender_entity_id: row.last_message_sender_entity_id,
    is_last_message_from_me: row.last_message_sender_entity_id
      ? String(row.last_message_sender_entity_id) === String(viewerEntityId)
      : null,
    unread_count: row.unread_count || 0,
    last_read_at: row.last_read_at,
    created_at: row.created_at,
  };
}

async function resolveActor(conn, user, payload = {}) {
  if (!user?.id_user) return { error: "Usuário não autenticado" };

  const actor_type = normalizeActorType(payload.actor_type || payload.from_type);
  const actor_id = payload.actor_id || payload.from_id;

  if (!actor_type || !actor_id) {
    return { error: "actor_type e actor_id são obrigatórios" };
  }

  const actor =
    actor_type === "clan"
      ? await EntityFollowStorage.getClanActor(conn, {
          id_user: user.id_user,
          id_profile: actor_id,
        })
      : await EntityFollowStorage.getProfileActor(conn, {
          id_user: user.id_user,
          id_profile: actor_id,
        });

  if (!actor) return { error: "Sem permissão para enviar como esta entidade" };
  if (!EntityFollowStorage.isPublicEntity(actor)) {
    return { error: "Entidade ativa e publicada é obrigatória" };
  }

  return { actor_type, actor_id, actor };
}

async function resolveTarget(conn, payload = {}) {
  const target_id = payload.target_id || payload.to_id;
  if (!target_id) return { error: "target_id é obrigatório" };

  const target = await EntityFollowStorage.getEntity(conn, {
    type: "profile",
    id: target_id,
  });
  // getEntity acima usa is_clan=FALSE; tentar como clan se não veio
  let resolved = target;
  if (!resolved) {
    resolved = await EntityFollowStorage.getEntity(conn, {
      type: "clan",
      id: target_id,
    });
  }

  if (!resolved) return { error: "Destinatário não encontrado" };
  if (!EntityFollowStorage.isPublicEntity(resolved)) {
    return { error: "Destinatário não está disponível para mensagens" };
  }
  return { target_id, target: resolved };
}

class ConversationService {
  static async listMine(user, payload) {
    return runWithLogs(
      log,
      "listMine",
      () => ({ id_user: user?.id_user, actor_id: payload?.actor_id }),
      async () => {
        const actorRes = await resolveActor(pool, user, payload);
        if (actorRes.error) return actorRes;

        const result = await ConversationStorage.listByEntity(pool, {
          entity_id: actorRes.actor_id,
          cursor: payload?.cursor,
          limit: payload?.limit,
        });

        const otherIds = [...new Set(result.items.map((r) => r.other_entity_id))];
        let othersById = {};
        if (otherIds.length > 0) {
          const placeholders = otherIds.map((_, i) => `$${i + 1}`).join(",");
          const { rows } = await pool.query(
            `
            SELECT
              p.id_profile AS id,
              CASE WHEN p.is_clan THEN 'clan' ELSE 'profile' END AS type,
              p.display_name,
              p.avatar_url,
              p.sub_profile_slug,
              p.is_clan,
              u.username
            FROM public.tb_profile p
            JOIN public.tb_user u ON u.id_user = p.id_user
            WHERE p.id_profile IN (${placeholders})
            `,
            otherIds
          );
          othersById = Object.fromEntries(rows.map((r) => [String(r.id), r]));
        }

        return {
          items: result.items.map((row) => ({
            ...mapConversationListItem(row, actorRes.actor_id),
            other_entity: mapEntityRow(othersById[String(row.other_entity_id)]),
          })),
          next_cursor: result.next_cursor,
          has_more: result.has_more,
          actor: mapEntityRow(actorRes.actor),
        };
      }
    );
  }

  static async openOrCreate(user, payload) {
    return runWithLogs(
      log,
      "openOrCreate",
      () => ({
        id_user: user?.id_user,
        actor_id: payload?.actor_id,
        target_id: payload?.target_id,
      }),
      async () => {
        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const actorRes = await resolveActor(client, user, payload);
          if (actorRes.error) {
            await client.query("ROLLBACK");
            return actorRes;
          }
          const targetRes = await resolveTarget(client, payload);
          if (targetRes.error) {
            await client.query("ROLLBACK");
            return targetRes;
          }
          if (String(actorRes.actor_id) === String(targetRes.target_id)) {
            await client.query("ROLLBACK");
            return { error: "Não é possível abrir conversa consigo mesmo" };
          }

          const { conversation, created } = await ConversationStorage.getOrCreate(
            client,
            actorRes.actor_id,
            targetRes.target_id
          );

          await client.query("COMMIT");
          return {
            conversation: {
              ...conversation,
              other_entity_id: targetRes.target_id,
            },
            created,
            actor: mapEntityRow(actorRes.actor),
            other_entity: mapEntityRow(targetRes.target),
          };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    );
  }

  static async getConversation(user, { id_conversation, actor_id, actor_type }) {
    return runWithLogs(
      log,
      "getConversation",
      () => ({ id_user: user?.id_user, id_conversation, actor_id }),
      async () => {
        const actorRes = await resolveActor(pool, user, { actor_id, actor_type });
        if (actorRes.error) return actorRes;

        const conv = await ConversationStorage.getById(pool, id_conversation);
        if (!conv) return { error: "Conversa não encontrada" };

        const participant = await ConversationStorage.getParticipant(pool, {
          id_conversation,
          entity_id: actorRes.actor_id,
        });
        if (!participant) return { error: "Sem permissão para esta conversa" };

        const otherId = await ConversationStorage.otherEntityId(
          conv,
          actorRes.actor_id
        );
        const other = otherId
          ? await EntityFollowStorage.getEntity(pool, { type: "profile", id: otherId })
            || await EntityFollowStorage.getEntity(pool, { type: "clan", id: otherId })
          : null;

        return {
          conversation: {
            ...conv,
            unread_count: participant.unread_count,
            last_read_at: participant.last_read_at,
            other_entity_id: otherId,
          },
          actor: mapEntityRow(actorRes.actor),
          other_entity: mapEntityRow(other),
        };
      }
    );
  }

  static async listMessages(user, { id_conversation, actor_id, actor_type, cursor, limit }) {
    return runWithLogs(
      log,
      "listMessages",
      () => ({ id_user: user?.id_user, id_conversation, actor_id }),
      async () => {
        const actorRes = await resolveActor(pool, user, { actor_id, actor_type });
        if (actorRes.error) return actorRes;

        const participant = await ConversationStorage.getParticipant(pool, {
          id_conversation,
          entity_id: actorRes.actor_id,
        });
        if (!participant) return { error: "Sem permissão para esta conversa" };

        const result = await MessageStorage.listByConversation(pool, {
          id_conversation,
          cursor,
          limit,
        });

        return {
          items: result.items.map(mapMessage),
          next_cursor: result.next_cursor,
          has_more: result.has_more,
        };
      }
    );
  }

  static async sendMessage(user, payload) {
    return runWithLogs(
      log,
      "sendMessage",
      () => ({
        id_user: user?.id_user,
        id_conversation: payload?.id_conversation,
        actor_id: payload?.actor_id,
      }),
      async () => {
        const body = String(payload?.body || "").trim();
        if (!body) return { error: "Mensagem não pode ser vazia" };
        if (body.length > MAX_BODY_LENGTH) {
          return { error: `Mensagem inválida (máximo ${MAX_BODY_LENGTH} caracteres)` };
        }

        // Supervisão: menor com can_message=FALSE não pode enviar.
        const minorSendBlock = await assertMinorPermission(user?.id_user, "can_message");
        if (minorSendBlock) return minorSendBlock;

        const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
        const recent = await MessageStorage.countSentByUserSince(pool, {
          id_user: user?.id_user,
          since,
        });
        if (recent >= RATE_LIMIT_MAX_MESSAGES) {
          return { error: "Limite de envio excedido. Aguarde alguns segundos." };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const actorRes = await resolveActor(client, user, payload);
          if (actorRes.error) {
            await client.query("ROLLBACK");
            return actorRes;
          }

          let conv;
          if (payload?.id_conversation) {
            conv = await ConversationStorage.getById(client, payload.id_conversation);
            if (!conv) {
              await client.query("ROLLBACK");
              return { error: "Conversa não encontrada" };
            }
            const part = await ConversationStorage.getParticipant(client, {
              id_conversation: conv.id_conversation,
              entity_id: actorRes.actor_id,
            });
            if (!part) {
              await client.query("ROLLBACK");
              return { error: "Sem permissão para esta conversa" };
            }
          } else {
            const targetRes = await resolveTarget(client, payload);
            if (targetRes.error) {
              await client.query("ROLLBACK");
              return targetRes;
            }
            if (String(actorRes.actor_id) === String(targetRes.target_id)) {
              await client.query("ROLLBACK");
              return { error: "Não é possível enviar mensagem para si mesmo" };
            }
            // Supervisão: bloqueia envio para menor com can_receive_messages=FALSE.
            const targetProfile = await ProfileStorage.getProfileById(client, targetRes.target_id);
            if (targetProfile?.id_user && !targetProfile.is_clan) {
              const recvBlock = await assertMinorPermission(
                targetProfile.id_user,
                "can_receive_messages",
                client
              );
              if (recvBlock) {
                await client.query("ROLLBACK");
                return { error: "Destinatário não está aceitando mensagens", status: 403 };
              }
            }
            const created = await ConversationStorage.getOrCreate(
              client,
              actorRes.actor_id,
              targetRes.target_id
            );
            conv = created.conversation;
          }

          const message = await MessageStorage.create(client, {
            id_conversation: conv.id_conversation,
            sender_entity_id: actorRes.actor_id,
            sender_user_id: user.id_user,
            body,
          });

          await ConversationStorage.updateLastMessage(client, {
            id_conversation: conv.id_conversation,
            sender_entity_id: actorRes.actor_id,
            body,
            at: message.created_at,
          });

          await ConversationStorage.incrementUnreadForOther(client, {
            id_conversation: conv.id_conversation,
            sender_entity_id: actorRes.actor_id,
          });

          // sender lê automaticamente sua própria mensagem
          await ConversationStorage.markRead(client, {
            id_conversation: conv.id_conversation,
            entity_id: actorRes.actor_id,
          });

          await client.query("COMMIT");

          // Notificação fire-and-forget para o outro participante.
          try {
            const otherEntityId = await ConversationStorage.otherEntityId(
              conv,
              actorRes.actor_id
            );
            if (otherEntityId) {
              NotificationService.notifyMessage({
                actor_user_id: user.id_user,
                actor_profile_id: actorRes.actor_id,
                recipient_profile_id: otherEntityId,
                id_conversation: conv.id_conversation,
                content_preview: body,
              }).catch(() => {});

              // Espelho para o responsável quando o destinatário é menor.
              (async () => {
                try {
                  const otherProfile = await ProfileStorage.getProfileById(
                    pool,
                    otherEntityId
                  );
                  if (otherProfile?.id_user && !otherProfile.is_clan) {
                    const state = await getSupervisionState(otherProfile.id_user);
                    if (
                      state.is_minor &&
                      state.link_status === "active" &&
                      state.responsible_user_id
                    ) {
                      await NotificationService.notifySupervisedMessage({
                        minor_user_id: otherProfile.id_user,
                        minor_profile_id: otherEntityId,
                        responsible_user_id: state.responsible_user_id,
                        actor_user_id: user.id_user,
                        actor_profile_id: actorRes.actor_id,
                        id_conversation: conv.id_conversation,
                        content_preview: body,
                      });
                    }
                  }
                } catch {
                  /* fire-and-forget */
                }
              })();
            }
          } catch {
            /* fire-and-forget */
          }

          return {
            message: mapMessage(message),
            conversation: {
              id_conversation: conv.id_conversation,
              other_entity_id: await ConversationStorage.otherEntityId(
                conv,
                actorRes.actor_id
              ),
            },
          };
        } catch (error) {
          await client.query("ROLLBACK");
          throw error;
        } finally {
          client.release();
        }
      }
    );
  }

  static async markRead(user, payload) {
    return runWithLogs(
      log,
      "markRead",
      () => ({
        id_user: user?.id_user,
        id_conversation: payload?.id_conversation,
        actor_id: payload?.actor_id,
      }),
      async () => {
        const actorRes = await resolveActor(pool, user, payload);
        if (actorRes.error) return actorRes;

        const part = await ConversationStorage.getParticipant(pool, {
          id_conversation: payload?.id_conversation,
          entity_id: actorRes.actor_id,
        });
        if (!part) return { error: "Sem permissão para esta conversa" };

        const updated = await ConversationStorage.markRead(pool, {
          id_conversation: payload.id_conversation,
          entity_id: actorRes.actor_id,
        });

        return {
          unread_count: updated?.unread_count || 0,
          last_read_at: updated?.last_read_at,
        };
      }
    );
  }

  static async unreadSummary(user) {
    return runWithLogs(
      log,
      "unreadSummary",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const total = await ConversationStorage.unreadTotalForUser(pool, user.id_user);
        const byActor = await ConversationStorage.unreadByActor(pool, user.id_user);
        return {
          total,
          by_actor: byActor.map((r) => ({
            actor_id: r.entity_id,
            unread_count: r.unread_count,
          })),
        };
      }
    );
  }
}

module.exports = ConversationService;
