const pool = require("../databases");
const ConversationStorage = require("../storages/ConversationStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("GroupConversationService");

const MAX_MEMBERS_HARD = 200;

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === "string" && v.length) return [v];
  return [];
}

async function userOwnsProfile(client, userId, profileId) {
  if (!profileId) return false;
  const { rows } = await client.query(
    `SELECT 1 FROM public.tb_profile WHERE id_profile = $1 AND id_user = $2 AND deleted_at IS NULL LIMIT 1`,
    [profileId, userId]
  );
  return rows.length > 0;
}

class GroupConversationService {
  static async create(user, payload = {}) {
    return runWithLogs(
      log,
      "create",
      () => ({ user_id: user?.id_user, owner: payload.owner_profile_id }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const ownerId = String(payload.owner_profile_id || "").trim();
        const name = String(payload.name || "").trim();
        if (!ownerId) return { error: "owner_profile_id é obrigatório", status: 400 };
        if (name.length < 2) return { error: "Nome do grupo precisa ter pelo menos 2 caracteres", status: 400 };
        if (name.length > 120) return { error: "Nome do grupo é muito longo", status: 400 };

        const memberIds = asArray(payload.member_profile_ids)
          .map((id) => String(id).trim())
          .filter(Boolean)
          .filter((id) => id !== ownerId);

        if (memberIds.length > MAX_MEMBERS_HARD - 1) {
          return { error: `Grupo aceita no máximo ${MAX_MEMBERS_HARD} membros`, status: 400 };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          if (!(await userOwnsProfile(client, user.id_user, ownerId))) {
            await client.query("ROLLBACK");
            return { error: "Você não é dono deste subperfil", status: 403 };
          }

          // Verifica que membros existem e não são clans
          if (memberIds.length > 0) {
            const { rows } = await client.query(
              `
              SELECT id_profile
                FROM public.tb_profile
               WHERE id_profile = ANY($1::uuid[])
                 AND deleted_at IS NULL
                 AND is_active = TRUE
              `,
              [memberIds]
            );
            const validIds = new Set(rows.map((r) => String(r.id_profile)));
            for (const id of memberIds) {
              if (!validIds.has(id)) {
                await client.query("ROLLBACK");
                return { error: `Subperfil inválido: ${id}`, status: 400 };
              }
            }
          }

          const group = await ConversationStorage.createGroup(client, {
            owner_profile_id: ownerId,
            name,
            cover_url: payload.cover_url || null,
            max_members: payload.max_members || MAX_MEMBERS_HARD,
          });

          await ConversationStorage.addGroupMember(client, {
            id_conversation: group.id_conversation,
            profile_id: ownerId,
            role: "owner",
          });
          for (const id of memberIds) {
            await ConversationStorage.addGroupMember(client, {
              id_conversation: group.id_conversation,
              profile_id: id,
              role: "member",
            });
          }

          await client.query("COMMIT");
          return { data: { conversation: group, member_count: memberIds.length + 1 } };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          log.error("create.failed", { message: err.message });
          return { error: err.message || "Erro ao criar grupo", status: 500 };
        } finally {
          client.release();
        }
      }
    );
  }

  static async listMembers(user, { id_conversation } = {}) {
    return runWithLogs(
      log,
      "listMembers",
      () => ({ id_conversation, user_id: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        if (!id_conversation) return { error: "id_conversation obrigatório", status: 400 };
        const conv = await ConversationStorage.getById(pool, id_conversation);
        if (!conv) return { error: "Grupo não encontrado", status: 404 };
        if (conv.kind !== "group") return { error: "Conversa não é grupo", status: 400 };
        const members = await ConversationStorage.listGroupMembers(pool, id_conversation);
        // Confirma que o user faz parte
        const userProfiles = await ProfileStorage.listProfilesByUser(pool, user.id_user).catch(() => []);
        const userProfileIds = new Set((userProfiles || []).map((p) => String(p.id_profile)));
        const isMember = members.some((m) => userProfileIds.has(String(m.id_profile)));
        if (!isMember) return { error: "Você não faz parte deste grupo", status: 403 };
        return { data: { members, count: members.length } };
      }
    );
  }

  static async addMembers(user, { id_conversation, profile_ids } = {}) {
    return runWithLogs(
      log,
      "addMembers",
      () => ({ id_conversation, count: asArray(profile_ids).length }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        if (!id_conversation) return { error: "id_conversation obrigatório", status: 400 };

        const ids = asArray(profile_ids).map((v) => String(v).trim()).filter(Boolean);
        if (ids.length === 0) return { error: "Nenhum subperfil informado", status: 400 };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const conv = await ConversationStorage.getById(client, id_conversation);
          if (!conv || conv.kind !== "group") {
            await client.query("ROLLBACK");
            return { error: "Grupo não encontrado", status: 404 };
          }
          // Só owner/admin pode adicionar
          const { rows: actorRows } = await client.query(
            `
            SELECT cp.role
              FROM public.tb_conversation_participant cp
              JOIN public.tb_profile p ON p.id_profile = cp.entity_id
             WHERE cp.id_conversation = $1
               AND p.id_user = $2
               AND cp.deleted_at IS NULL
            ORDER BY CASE cp.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END
             LIMIT 1
            `,
            [id_conversation, user.id_user]
          );
          const actorRole = actorRows[0]?.role || null;
          if (actorRole !== "owner" && actorRole !== "admin") {
            await client.query("ROLLBACK");
            return { error: "Apenas dono ou admin podem adicionar membros", status: 403 };
          }

          const current = await ConversationStorage.countGroupMembers(client, id_conversation);
          const cap = conv.max_members || MAX_MEMBERS_HARD;
          if (current + ids.length > cap) {
            await client.query("ROLLBACK");
            return { error: `Excede o limite de ${cap} membros`, status: 400 };
          }

          for (const profile_id of ids) {
            await ConversationStorage.addGroupMember(client, {
              id_conversation,
              profile_id,
              role: "member",
            });
          }

          await client.query("COMMIT");
          const next = await ConversationStorage.countGroupMembers(pool, id_conversation);
          return { data: { added: ids.length, total_members: next } };
        } catch (err) {
          await client.query("ROLLBACK").catch(() => {});
          return { error: err.message, status: 500 };
        } finally {
          client.release();
        }
      }
    );
  }

  static async leave(user, { id_conversation } = {}) {
    return runWithLogs(
      log,
      "leave",
      () => ({ id_conversation, user_id: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        if (!id_conversation) return { error: "id_conversation obrigatório", status: 400 };
        // Remove TODOS os subperfis do user no grupo
        const { rowCount } = await pool.query(
          `
          UPDATE public.tb_conversation_participant cp
             SET deleted_at = NOW(), updated_at = NOW()
            FROM public.tb_profile p
           WHERE cp.entity_id = p.id_profile
             AND cp.id_conversation = $1
             AND p.id_user = $2
             AND cp.deleted_at IS NULL
          `,
          [id_conversation, user.id_user]
        );
        return { data: { left: rowCount } };
      }
    );
  }
}

module.exports = GroupConversationService;
