const AffiliateService = require("../services/AffiliateService");
const AffiliatePayoutService = require("../services/AffiliatePayoutService");

function handleError(res, err) {
  if (
    err instanceof AffiliateService.ServiceError ||
    err instanceof AffiliatePayoutService.ServiceError ||
    (err && typeof err.status === "number")
  ) {
    return res.status(err.status || 400).json({ error: err.message });
  }
  throw err;
}

class AffiliateAdminController {
  // Affiliates
  static async list(req, res) {
    try {
      const result = await AffiliateService.listAffiliates(req.query);
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async upsert(req, res) {
    try {
      const result = await AffiliateService.createOrUpdateAffiliate(req.user, req.body || {});
      return res.status(201).json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async updateStatus(req, res) {
    try {
      const result = await AffiliateService.updateAffiliateStatus(
        req.user,
        req.params.id,
        req.body || {}
      );
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Settings (versionado)
  static async listSettings(req, res) {
    try {
      const items = await AffiliateService.listSettings();
      return res.json({ items });
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async createSettings(req, res) {
    try {
      const row = await AffiliateService.createSettings(req.user, req.body || {});
      return res.status(201).json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Coupon override
  static async upsertOverride(req, res) {
    try {
      const row = await AffiliateService.upsertCouponOverride(
        req.user,
        req.params.id_coupon,
        req.body || {}
      );
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  static async deleteOverride(req, res) {
    try {
      const row = await AffiliateService.deleteCouponOverride(req.user, req.params.id_coupon);
      return res.json(row);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Conversions
  static async listConversions(req, res) {
    try {
      const result = await AffiliateService.listConversionsAdmin(req.query);
      return res.json(result);
    } catch (err) {
      return handleError(res, err);
    }
  }

  // Governance
  static async overview(req, res) {
    try {
      const data = await AffiliateService.overview();
      return res.json(data);
    } catch (err) { return handleError(res, err); }
  }

  static async listAudit(req, res) {
    try {
      const items = await AffiliateService.listAudit(req.query);
      return res.json({ items });
    } catch (err) { return handleError(res, err); }
  }

  static async resolveDispute(req, res) {
    try {
      const row = await AffiliateService.resolveDispute(
        req.user,
        req.params.id_conversion,
        req.body || {}
      );
      return res.json(row);
    } catch (err) { return handleError(res, err); }
  }

  // Payouts
  static async listEligible(req, res) {
    try {
      const result = await AffiliatePayoutService.listEligible(req.query.id_affiliate);
      return res.json(result);
    } catch (err) { return handleError(res, err); }
  }

  static async listBatches(req, res) {
    try {
      const items = await AffiliatePayoutService.listBatches(req.query);
      return res.json({ items });
    } catch (err) { return handleError(res, err); }
  }

  static async getBatch(req, res) {
    try {
      const batch = await AffiliatePayoutService.getBatch(req.params.id_batch);
      return res.json(batch);
    } catch (err) { return handleError(res, err); }
  }

  static async createBatch(req, res) {
    try {
      const batch = await AffiliatePayoutService.createBatch(req.user, req.body || {});
      return res.status(201).json(batch);
    } catch (err) { return handleError(res, err); }
  }

  // Painel "Afiliados" — resumo por afiliado (red/green/paid)
  static async payoutsSummary(req, res) {
    try {
      const data = await AffiliatePayoutService.summaryByAffiliate(req.query || {});
      return res.json(data);
    } catch (err) { return handleError(res, err); }
  }

  // Conversões detalhadas de um afiliado para o modal
  static async listAffiliateConversions(req, res) {
    try {
      const data = await AffiliatePayoutService.listConversionsForAffiliate(
        req.params.id_affiliate,
        req.query || {}
      );
      return res.json(data);
    } catch (err) { return handleError(res, err); }
  }

  // Atalho 1-clique: marca conversões como pagas (cria batch + status=PAID)
  static async payConversionsNow(req, res) {
    try {
      const result = await AffiliatePayoutService.payConversionsNow(req.user, {
        id_affiliate: req.params.id_affiliate,
        conversion_ids: (req.body && req.body.conversion_ids) || [],
        notes: req.body && req.body.notes,
      });
      return res.status(201).json(result);
    } catch (err) { return handleError(res, err); }
  }

  static async updateBatchStatus(req, res) {
    try {
      const batch = await AffiliatePayoutService.markStatus(
        req.user,
        req.params.id_batch,
        req.body || {}
      );
      return res.json(batch);
    } catch (err) { return handleError(res, err); }
  }
}

AffiliateAdminController.listRules = async function listRules(req, res) {
  const pool = require("../databases");
  const AffiliateProgramStorage = require("../storages/AffiliateProgramStorage");
  const [rules, settings] = await Promise.all([
    AffiliateProgramStorage.listRules(pool),
    AffiliateProgramStorage.getSettings(pool),
  ]);
  return res.json({ rules, settings });
};

/**
 * PATCH /admin/affiliate/rules/:source_context
 * É aqui que poléns/premium/manifestação/xp_boost/Loja de Funções entram no
 * programa: eles nascem is_enabled=FALSE na mig 192 porque cada um é custo
 * direto e perpétuo de margem — ligar é decisão de negócio, não de deploy.
 */
AffiliateAdminController.updateRule = async function updateRule(req, res) {
  const pool = require("../databases");
  const AffiliateProgramStorage = require("../storages/AffiliateProgramStorage");
  const StoreGovernanceService = require("../services/StoreGovernanceService");
  const body = req.body || {};
  const patch = {};

  if (body.is_enabled !== undefined) {
    if (typeof body.is_enabled !== "boolean") {
      return res.status(400).json({ error: "is_enabled deve ser booleano" });
    }
    patch.is_enabled = body.is_enabled;
  }
  if (body.percent !== undefined) {
    const n = Number(body.percent);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      return res.status(400).json({ error: "percent deve estar entre 0 e 100" });
    }
    patch.percent = n;
  }
  for (const k of ["creates_bond", "grants_discount", "recurring_allowed"]) {
    if (body[k] !== undefined) {
      if (typeof body[k] !== "boolean") {
        return res.status(400).json({ error: `${k} deve ser booleano` });
      }
      patch[k] = body[k];
    }
  }
  for (const k of ["max_pool_cents", "min_order_cents", "max_recurring_cycles"]) {
    if (body[k] !== undefined) {
      if (body[k] === null) { patch[k] = null; continue; }
      const n = Number(body[k]);
      if (!Number.isInteger(n) || n < 0) {
        return res.status(400).json({ error: `${k} inválido` });
      }
      patch[k] = n;
    }
  }
  if (body.notes !== undefined) patch.notes = body.notes ? String(body.notes) : null;

  if (!Object.keys(patch).length) {
    return res.status(400).json({ error: "Nada a atualizar" });
  }

  const before = await AffiliateProgramStorage.getRule(pool, req.params.source_context);
  if (!before) return res.status(404).json({ error: "Contexto não encontrado" });

  const after = await AffiliateProgramStorage.updateRule(
    pool, req.params.source_context, patch, req.user?.id_user
  );

  const AffiliateStorage = require("../storages/AffiliateStorage");
  await AffiliateStorage.writeAudit(pool, {
    entity: "affiliate_commission_rule",
    entity_id: after?.id_rule || null,
    action: "update",
    before_state: before,
    after_state: after,
    actor_user_id: req.user?.id_user,
  }).catch(() => {});

  StoreGovernanceService.invalidateCache();
  return res.json({ rule: after });
};

/** POST /admin/affiliate/program — nova versão dos trilhos globais. */
AffiliateAdminController.createProgramSettings = async function createProgramSettings(req, res) {
  const pool = require("../databases");
  const AffiliateProgramStorage = require("../storages/AffiliateProgramStorage");
  const StoreGovernanceService = require("../services/StoreGovernanceService");
  const b = req.body || {};
  const current = await AffiliateProgramStorage.getSettings(pool);

  const num = (v, fallback) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const split = num(b.commission_split_percent, current?.commission_split_percent ?? 70);
  const min = num(b.seller_percent_min, current?.seller_percent_min ?? 0);
  const max = num(b.seller_percent_max, current?.seller_percent_max ?? 50);
  const def = num(b.default_percent, current?.default_percent ?? 25);

  if ([split, min, max, def].some((n) => n < 0 || n > 100)) {
    return res.status(400).json({ error: "Percentuais devem estar entre 0 e 100" });
  }
  if (min > max) {
    return res.status(400).json({ error: "seller_percent_min > seller_percent_max" });
  }

  const row = await AffiliateProgramStorage.createSettings(pool, {
    commission_split_percent: split,
    seller_percent_min: min,
    seller_percent_max: max,
    default_percent: def,
    notes: b.notes || null,
    created_by: req.user?.id_user || null,
  });
  StoreGovernanceService.invalidateCache();
  return res.status(201).json({ settings: row });
};

/** DELETE /admin/affiliate/referrals/:id — quebra de vínculo (fraude/disputa). */
AffiliateAdminController.releaseReferral = async function releaseReferral(req, res) {
  const pool = require("../databases");
  const ReferralService = require("../services/ReferralService");
  const row = await ReferralService.release(pool, {
    id_referral: req.params.id,
    reason: req.body?.reason || null,
    released_by: req.user?.id_user || null,
  });
  if (!row) return res.status(404).json({ error: "Vínculo não encontrado ou já liberado" });
  return res.json({ referral: row });
};

module.exports = AffiliateAdminController;
