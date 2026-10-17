// Bloqueio entre usuários e denúncia de mensagem direta (mig 283).
//
// Bloqueio: a pessoa aponta um PERFIL (é o que ela vê na tela), mas o que se
// grava é a CONTA dona dele — bloquear alguém bloqueia todos os perfis dele, e
// trocar de perfil não contorna. Clan: bloqueia o DONO do clan (regra
// explícita: não existe bloqueio de "todos os membros"). O efeito é aplicado em
// utils/socialPolicy (abrir e enviar DM). Desbloquear devolve tudo como era;
// o histórico nunca foi apagado.
//
// Denúncia: só quem PARTICIPA da conversa pode denunciar uma mensagem dela, e
// nunca a própria. Uma por denunciante e mensagem (repetir é ok). A revisão é
// da administração da plataforma (/admin/message-reports).

const pool = require("../databases");
const UserBlockStorage = require("../storages/UserBlockStorage");
const ConversationStorage = require("../storages/ConversationStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("SocialSafetyService");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPORT_CATEGORIES = new Set(["spam", "fraud", "harassment", "inappropriate", "hate", "forbidden_item", "personal_data", "other"]);

const bad = (error, code = "invalid_input", statusCode = 400) => ({ error, code, statusCode });

class SocialSafetyService {
  /** Resolve a conta dona do perfil-alvo, recusando a própria conta. */
  static async _targetUser(conn, user, target_profile_id) {
    if (!UUID_RE.test(String(target_profile_id || ""))) return { err: bad("Perfil inválido") };
    const owner = await UserBlockStorage.ownerOfEntity(conn, target_profile_id);
    if (!owner) return { err: bad("Perfil não encontrado", "not_found", 404) };
    if (String(owner) === String(user.id_user)) return { err: bad("Não é possível bloquear a si mesmo", "self", 422) };
    return { owner };
  }

  static async block(user, { target_profile_id }) {
    return runWithLogs(log, "block", () => ({ id_user: user?.id_user }), async () => {
      const t = await this._targetUser(pool, user, target_profile_id);
      if (t.err) return t.err;
      const created = await UserBlockStorage.block(pool, {
        blocker_user_id: user.id_user,
        blocked_user_id: t.owner,
        via_profile_id: target_profile_id,
      });
      return { blocked: true, changed: created };
    });
  }

  static async unblock(user, { target_profile_id }) {
    return runWithLogs(log, "unblock", () => ({ id_user: user?.id_user }), async () => {
      const t = await this._targetUser(pool, user, target_profile_id);
      if (t.err) return t.err;
      const removed = await UserBlockStorage.unblock(pool, { blocker_user_id: user.id_user, blocked_user_id: t.owner });
      return { blocked: false, changed: removed };
    });
  }

  static async listMine(user) {
    return runWithLogs(log, "listMine", () => ({ id_user: user?.id_user }), async () => {
      const rows = await UserBlockStorage.listMine(pool, user.id_user);
      return {
        items: rows.map((r) => ({
          id_profile: r.id_profile,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
          username: r.username,
          created_at: r.created_at,
        })),
      };
    });
  }

  /** Estado do bloqueio visto por QUEM pergunta: só o que ele mesmo fez. */
  static async status(user, { target_profile_id }) {
    const t = await this._targetUser(pool, user, target_profile_id);
    if (t.err) return t.err;
    return { blocked_by_me: await UserBlockStorage.iBlocked(pool, user.id_user, t.owner) };
  }

  static async reportMessage(user, { id_message, reason_category, reason }) {
    return runWithLogs(log, "reportMessage", () => ({ id_user: user?.id_user, id_message }), async () => {
      if (!UUID_RE.test(String(id_message || ""))) return bad("Mensagem inválida");
      const category = String(reason_category || "");
      if (!REPORT_CATEGORIES.has(category)) return bad("Motivo inválido");
      const text = reason == null ? null : String(reason).trim().slice(0, 280) || null;
      const r = await pool.query(
        `SELECT id_message, id_conversation, sender_user_id FROM public.tb_message WHERE id_message = $1 AND deleted_at IS NULL`,
        [id_message]
      );
      const msg = r.rows[0];
      // Mesma resposta para "não existe" e "não é sua conversa": não confirma
      // a existência de mensagem alheia.
      if (!msg) return bad("Mensagem não encontrada", "not_found", 404);
      const canSee = await ConversationStorage.userCanAccessConversation(pool, { id_conversation: msg.id_conversation, id_user: user.id_user });
      if (!canSee) return bad("Mensagem não encontrada", "not_found", 404);
      if (String(msg.sender_user_id) === String(user.id_user)) return bad("Não é possível denunciar a própria mensagem", "own_message", 422);
      await pool.query(
        `INSERT INTO public.tb_message_report (id_message, reporter_user_id, reason_category, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id_message, reporter_user_id) WHERE reporter_user_id IS NOT NULL DO NOTHING`,
        [id_message, user.id_user, category, text]
      );
      return { reported: true };
    });
  }

  // ─── Revisão (administração) ──────────────────────────────────────────────

  static async adminListReports({ status = "pending", limit = 50 } = {}) {
    const st = ["pending", "dismissed", "actioned", "all"].includes(status) ? status : "pending";
    const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const r = await pool.query(
      `SELECT rep.id_message_report, rep.reason_category, rep.reason, rep.status, rep.created_at, rep.resolved_at,
              m.id_message, m.id_conversation, m.body, m.kind, m.created_at AS message_created_at,
              su.username AS sender_username, ru.username AS reporter_username
         FROM public.tb_message_report rep
         JOIN public.tb_message m ON m.id_message = rep.id_message
         LEFT JOIN public.tb_user su ON su.id_user = m.sender_user_id
         LEFT JOIN public.tb_user ru ON ru.id_user = rep.reporter_user_id
        WHERE ($1 = 'all' OR rep.status = $1)
        ORDER BY rep.created_at DESC
        LIMIT $2`,
      [st, lim]
    );
    return { items: r.rows };
  }

  static async adminResolve(admin, { id_message_report, decision }) {
    if (!UUID_RE.test(String(id_message_report || ""))) return bad("Denúncia inválida");
    if (!["dismissed", "actioned"].includes(decision)) return bad("Decisão inválida");
    const r = await pool.query(
      `UPDATE public.tb_message_report
          SET status = $2, resolved_by = $3, resolved_at = NOW()
        WHERE id_message_report = $1
        RETURNING id_message_report, id_message, status`,
      [id_message_report, decision, admin?.id_user || null]
    );
    const row = r.rows[0];
    if (!row) return bad("Denúncia não encontrada", "not_found", 404);
    // "Agir" esconde a mensagem (soft delete), como a moderação das salas.
    if (decision === "actioned") {
      await pool.query(`UPDATE public.tb_message SET deleted_at = COALESCE(deleted_at, NOW()) WHERE id_message = $1`, [row.id_message]);
    }
    return { report: row };
  }
}

module.exports = SocialSafetyService;
