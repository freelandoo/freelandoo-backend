const pool = require("../databases");
const ChatModerationStorage = require("../storages/ChatModerationStorage");
const ChatModerationService = require("../services/ChatModerationService");
const ChatStorage = require("../storages/ChatStorage");
const { sendServiceResult } = require("../utils/sendServiceResult");

class ChatModerationAdminController {
  // ─── blocked_terms CRUD ───────────────────────────────────────────────────
  static async listTerms(req, res) {
    const q = req.query || {};
    const items = await ChatModerationStorage.listTermsAdmin(pool, {
      q: q.q || null,
      category: q.category || null,
      status: q.status || null,
      limit: Math.min(Math.max(Number(q.limit) || 100, 1), 200),
      offset: Math.max(Number(q.offset) || 0, 0),
    });
    return res.json({ items });
  }

  static async createTerm(req, res) {
    const b = req.body || {};
    if (!b.term || !b.category) {
      return res.status(400).json({ error: "term e category são obrigatórios" });
    }
    const normalized = ChatModerationService.normalizeText(b.normalized_term || b.term);
    const row = await ChatModerationStorage.createTerm(pool, {
      term: String(b.term).slice(0, 200),
      normalized_term: normalized,
      category: b.category,
      severity: b.severity || "medium",
      action: b.action || "mask",
      language: b.language || "pt-BR",
      is_regex: !!b.is_regex,
      status: b.status || "active",
      notes: b.notes || null,
    });
    ChatModerationService.invalidateTermsCache();
    return res.status(201).json({ term: row });
  }

  static async updateTerm(req, res) {
    const id = Number(req.params.id_blocked_term);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
    const patch = { ...(req.body || {}) };
    if (patch.term && !patch.normalized_term) {
      patch.normalized_term = ChatModerationService.normalizeText(patch.term);
    } else if (patch.normalized_term) {
      patch.normalized_term = ChatModerationService.normalizeText(patch.normalized_term);
    }
    const row = await ChatModerationStorage.updateTerm(pool, id, patch);
    if (!row) return res.status(404).json({ error: "Não encontrado" });
    ChatModerationService.invalidateTermsCache();
    return res.json({ term: row });
  }

  static async deleteTerm(req, res) {
    const id = Number(req.params.id_blocked_term);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
    const row = await ChatModerationStorage.deleteTerm(pool, id);
    ChatModerationService.invalidateTermsCache();
    return res.json({ ok: !!row });
  }

  // ─── settings ─────────────────────────────────────────────────────────────
  static async getSettings(req, res) {
    const [global, machine] = await Promise.all([
      ChatModerationStorage.getSettings(pool, "global"),
      ChatModerationStorage.getSettings(pool, "machine"),
    ]);
    return res.json({ global, machine });
  }

  static async updateSettings(req, res) {
    const room_type = req.params.room_type;
    if (!["global", "machine"].includes(room_type)) {
      return res.status(400).json({ error: "room_type inválido" });
    }
    const row = await ChatModerationStorage.updateSettings(pool, room_type, req.body || {});
    return res.json({ settings: row });
  }

  // ─── moderation results / fila de revisão ─────────────────────────────────
  static async listResults(req, res) {
    const q = req.query || {};
    const items = await ChatModerationStorage.listResultsAdmin(pool, {
      action: q.action || null,
      review_status: q.review_status || null,
      q: q.q || null,
      limit: Math.min(Math.max(Number(q.limit) || 50, 1), 200),
      offset: Math.max(Number(q.offset) || 0, 0),
    });
    return res.json({ items });
  }

  static async approveResult(req, res) {
    const id = Number(req.params.id_moderation_result);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
    const row = await ChatModerationStorage.setReviewDecision(pool, id, {
      decision: "approved",
      reviewer_id: req.user.id_user,
    });
    if (!row) return res.status(404).json({ error: "Não encontrado" });
    // Se a mensagem havia sido escondida, desconde
    if (row.id_chat_message) {
      await pool.query(
        `UPDATE public.tb_chat_message SET hidden_at = NULL, hidden_reason = NULL
          WHERE id_chat_message = $1`,
        [row.id_chat_message]
      );
    }
    return res.json({ result: row });
  }

  static async keepBlockedResult(req, res) {
    const id = Number(req.params.id_moderation_result);
    if (!Number.isFinite(id)) return res.status(400).json({ error: "id inválido" });
    const row = await ChatModerationStorage.setReviewDecision(pool, id, {
      decision: "kept_blocked",
      reviewer_id: req.user.id_user,
    });
    if (!row) return res.status(404).json({ error: "Não encontrado" });
    // Se já tem id_chat_message, esconde definitivamente
    if (row.id_chat_message) {
      await ChatModerationStorage.hideMessage(pool, row.id_chat_message, "admin");
    }
    return res.json({ result: row });
  }

  // ─── ações sobre o user ───────────────────────────────────────────────────
  static async getUserState(req, res) {
    const id_user = req.params.id_user;
    const state = await ChatModerationStorage.getUserState(pool, id_user);
    return res.json({ state });
  }

  static async muteUser(req, res) {
    const id_user = req.params.id_user;
    const minutes = Math.min(Math.max(Number(req.body?.minutes) || 10, 1), 60 * 24 * 30);
    const row = await ChatModerationStorage.muteUser(pool, id_user, minutes, req.body?.notes || null);
    return res.json({ state: row });
  }

  static async banUser(req, res) {
    const id_user = req.params.id_user;
    const minutes = Math.min(Math.max(Number(req.body?.minutes) || 1440, 1), 60 * 24 * 365);
    const row = await ChatModerationStorage.banUser(pool, id_user, minutes, req.body?.notes || null);
    return res.json({ state: row });
  }

  static async clearPenalties(req, res) {
    const id_user = req.params.id_user;
    const row = await ChatModerationStorage.clearUserPenalties(pool, id_user);
    return res.json({ state: row });
  }

  // ─── ocultar/restaurar mensagem direto ────────────────────────────────────
  static async hideMessage(req, res) {
    const id = req.params.id_chat_message;
    const row = await ChatModerationStorage.hideMessage(pool, id, "admin");
    return res.json({ message: row });
  }

  static async unhideMessage(req, res) {
    const id = req.params.id_chat_message;
    const r = await pool.query(
      `UPDATE public.tb_chat_message
          SET hidden_at = NULL, hidden_reason = NULL
        WHERE id_chat_message = $1
        RETURNING *`,
      [id]
    );
    return res.json({ message: r.rows[0] || null });
  }
}

module.exports = ChatModerationAdminController;
