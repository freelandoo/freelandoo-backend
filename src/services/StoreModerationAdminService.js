const pool = require("../databases");
const StoreProhibitedRuleStorage = require("../storages/StoreProhibitedRuleStorage");
const StoreProductPolicyService = require("./StoreProductPolicyService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("StoreModerationAdminService");

const RULE_TYPES = ["term", "category", "regex", "brand", "product_name", "manual_allow"];
const SEVERITIES = ["low", "medium", "high", "critical"];
const ACTIONS = ["allow", "review", "block", "ban_product", "hide_product", "ban_category"];
const STATUSES = ["active", "paused", "deleted"];

function normalizeTerm(term) {
  return StoreProductPolicyService.normalize(term || "");
}

function validateRule(payload, { partial = false } = {}) {
  const out = {};

  if (!partial || Object.prototype.hasOwnProperty.call(payload, "rule_type")) {
    if (!RULE_TYPES.includes(payload.rule_type)) return { error: "rule_type inválido" };
    out.rule_type = payload.rule_type;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "term")) {
    if (payload.term !== null && payload.term !== undefined) {
      out.term = String(payload.term).trim().slice(0, 500);
      out.normalized_term = normalizeTerm(out.term);
    }
  }
  if (Object.prototype.hasOwnProperty.call(payload, "normalized_term")) {
    out.normalized_term = String(payload.normalized_term).trim().slice(0, 500);
  }
  if (Object.prototype.hasOwnProperty.call(payload, "id_product_category")) {
    if (payload.id_product_category === null || payload.id_product_category === "") {
      out.id_product_category = null;
    } else {
      const n = Number(payload.id_product_category);
      if (!Number.isInteger(n) || n <= 0) return { error: "id_product_category inválido" };
      out.id_product_category = n;
    }
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "severity")) {
    const s = payload.severity || "medium";
    if (!SEVERITIES.includes(s)) return { error: "severity inválido" };
    out.severity = s;
  }
  if (!partial || Object.prototype.hasOwnProperty.call(payload, "action")) {
    const a = payload.action || "review";
    if (!ACTIONS.includes(a)) return { error: "action inválido" };
    out.action = a;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "reason")) {
    out.reason = payload.reason ? String(payload.reason).trim().slice(0, 1000) : null;
  }
  if (Object.prototype.hasOwnProperty.call(payload, "status")) {
    if (!STATUSES.includes(payload.status)) return { error: "status inválido" };
    out.status = payload.status;
  }

  if (!partial) {
    if (["term", "regex", "brand", "product_name", "manual_allow"].includes(out.rule_type)) {
      if (!out.term || !out.term.trim()) return { error: "term é obrigatório para este rule_type" };
    }
    if (out.rule_type === "category" && !out.id_product_category) {
      return { error: "id_product_category é obrigatório para rule_type=category" };
    }
  }

  return { data: out };
}

class StoreModerationAdminService {
  // ─── Regras ──────────────────────────────────────────────────────────────
  static async listRules(user, query) {
    return runWithLogs(log, "listRules", () => ({ id_user: user?.id_user }), async () => {
      const status = query?.status && STATUSES.includes(query.status) ? query.status : null;
      const rules = await StoreProhibitedRuleStorage.listAll(pool, { status });
      return { rules };
    });
  }

  static async createRule(user, body) {
    return runWithLogs(log, "createRule", () => ({ id_user: user?.id_user }), async () => {
      const v = validateRule(body || {});
      if (v.error) return { error: v.error };
      const rule = await StoreProhibitedRuleStorage.create(pool, {
        ...v.data,
        created_by_user_id: user?.id_user || null,
      });
      StoreProductPolicyService.invalidateCache();
      return { rule };
    });
  }

  static async updateRule(user, id, body) {
    return runWithLogs(log, "updateRule", () => ({ id_user: user?.id_user, id }), async () => {
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId <= 0) return { error: "id inválido" };
      const existing = await StoreProhibitedRuleStorage.getById(pool, numId);
      if (!existing) return { error: "Regra não encontrada" };
      const v = validateRule(body || {}, { partial: true });
      if (v.error) return { error: v.error };
      const rule = await StoreProhibitedRuleStorage.update(pool, numId, v.data);
      StoreProductPolicyService.invalidateCache();
      return { rule };
    });
  }

  static async removeRule(user, id) {
    return runWithLogs(log, "removeRule", () => ({ id_user: user?.id_user, id }), async () => {
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId <= 0) return { error: "id inválido" };
      const existing = await StoreProhibitedRuleStorage.getById(pool, numId);
      if (!existing) return { error: "Regra não encontrada" };
      await StoreProhibitedRuleStorage.remove(pool, numId);
      StoreProductPolicyService.invalidateCache();
      return { message: "Regra removida" };
    });
  }

  static async ruleOccurrences(user, id) {
    return runWithLogs(log, "ruleOccurrences", () => ({ id_user: user?.id_user, id }), async () => {
      const numId = Number(id);
      if (!Number.isInteger(numId) || numId <= 0) return { error: "id inválido" };
      const rule = await StoreProhibitedRuleStorage.getById(pool, numId);
      if (!rule) return { error: "Regra não encontrada" };
      const occurrences = await StoreProhibitedRuleStorage.occurrencesForRule(pool, rule);
      return { rule, occurrences };
    });
  }

  // ─── Fila de revisão de produtos ─────────────────────────────────────────
  static async listPendingProducts(user) {
    return runWithLogs(log, "listPendingProducts", () => ({ id_user: user?.id_user }), async () => {
      const { rows } = await pool.query(
        `SELECT pp.id_profile_product, pp.id_profile, pp.name, pp.description,
                pp.moderation_status, pp.created_at,
                pc.name AS category_name,
                p.display_name AS profile_display_name,
                p.sub_profile_slug
           FROM public.tb_profile_product pp
      LEFT JOIN public.tb_product_category pc ON pc.id_product_category = pp.id_product_category
           JOIN public.tb_profile p ON p.id_profile = pp.id_profile
          WHERE pp.moderation_status IN ('pending_review','blocked','banned')
            AND pp.deleted_at IS NULL
          ORDER BY pp.created_at DESC
          LIMIT 200`
      );
      return { products: rows };
    });
  }

  static async reviewProduct(user, id_profile_product, body) {
    return runWithLogs(log, "reviewProduct", () => ({ id_user: user?.id_user, id_profile_product }), async () => {
      const numId = Number(id_profile_product);
      if (!Number.isInteger(numId) || numId <= 0) return { error: "id_profile_product inválido" };

      const decision = body?.decision;
      const reason = body?.reason ? String(body.reason).slice(0, 1000) : null;
      const validDecisions = ["approve", "block", "ban", "pause", "allow_exception"];
      if (!validDecisions.includes(decision)) return { error: "decision inválido" };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT id_profile_product, moderation_status, is_active
             FROM public.tb_profile_product
            WHERE id_profile_product = $1 AND deleted_at IS NULL
            LIMIT 1`,
          [numId]
        );
        const product = rows[0];
        if (!product) { await client.query("ROLLBACK"); return { error: "Produto não encontrado" }; }

        let newStatus = product.moderation_status;
        let newIsActive = product.is_active;
        switch (decision) {
          case "approve":          newStatus = "active"; break;
          case "block":            newStatus = "blocked"; newIsActive = false; break;
          case "ban":              newStatus = "banned";  newIsActive = false; break;
          case "pause":            newIsActive = false; break;
          case "allow_exception":  newStatus = "active"; break;
        }
        await client.query(
          `UPDATE public.tb_profile_product
              SET moderation_status = $2, is_active = $3, updated_at = NOW()
            WHERE id_profile_product = $1`,
          [numId, newStatus, newIsActive]
        );
        await client.query(
          `INSERT INTO public.tb_store_product_moderation_review
            (id_profile_product, reviewer_user_id, decision, reason)
           VALUES ($1, $2, $3, $4)`,
          [numId, user.id_user, decision, reason]
        );
        await client.query("COMMIT");
        return { id_profile_product: numId, moderation_status: newStatus, is_active: newIsActive };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async reviewRequest(user, id_product_request, body) {
    return runWithLogs(log, "reviewRequest", () => ({ id_user: user?.id_user, id_product_request }), async () => {
      const decision = body?.decision;
      const reason = body?.reason ? String(body.reason).slice(0, 1000) : null;
      const validDecisions = ["approve", "block", "ban", "pause", "allow_exception"];
      if (!validDecisions.includes(decision)) return { error: "decision inválido" };

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const { rows } = await client.query(
          `SELECT id_product_request, moderation_status, status
             FROM public.tb_product_request
            WHERE id_product_request = $1
            LIMIT 1`,
          [id_product_request]
        );
        const req = rows[0];
        if (!req) { await client.query("ROLLBACK"); return { error: "Pedido não encontrado" }; }

        let newStatus = req.moderation_status;
        let newReqStatus = req.status;
        switch (decision) {
          case "approve":          newStatus = "active"; break;
          case "block":            newStatus = "blocked"; newReqStatus = "closed"; break;
          case "ban":              newStatus = "banned";  newReqStatus = "closed"; break;
          case "pause":            newReqStatus = "closed"; break;
          case "allow_exception":  newStatus = "active"; break;
        }
        await client.query(
          `UPDATE public.tb_product_request
              SET moderation_status = $2, status = $3, updated_at = NOW()
            WHERE id_product_request = $1`,
          [id_product_request, newStatus, newReqStatus]
        );
        await client.query(
          `INSERT INTO public.tb_store_product_moderation_review
            (id_product_request, reviewer_user_id, decision, reason)
           VALUES ($1, $2, $3, $4)`,
          [id_product_request, user.id_user, decision, reason]
        );
        await client.query("COMMIT");
        return { id_product_request, moderation_status: newStatus, status: newReqStatus };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }
}

module.exports = StoreModerationAdminService;
