const pool = require("../databases");
const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateRuleResolver = require("./AffiliateRuleResolver");
const CouponStorage = require("../storages/CouponStorage");

const ZERO_AGGREGATES = {
  pending_cents: 0,
  approved_cents: 0,
  eligible_cents: 0,
  paid_cents: 0,
  reversed_cents: 0,
  total_count: 0,
  converted_count: 0,
};

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

// ───────────────────────── /me/affiliate ─────────────────────────
async function getMe(user) {
  const affiliate = await AffiliateStorage.getAffiliateByUserId(pool, user.id_user);

  // Regra vigente (usada como referência; cada cupom pode ter override)
  const rule = await AffiliateRuleResolver.resolve(pool, {
    id_coupon: "00000000-0000-0000-0000-000000000000", // dummy: só retorna settings, sem override
  });
  const default_rule = rule
    ? {
        commission_percent: rule.commission_percent,
        commission_base: rule.commission_base,
        min_order_cents: rule.min_order_cents,
        max_commission_cents: rule.max_commission_cents,
        approval_delay_days: rule.approval_delay_days,
      }
    : null;

  const couponsRes = await CouponStorage.listByUser(pool, user.id_user, {
    is_active: true,
    limit: 10,
    offset: 0,
  });
  const coupons = couponsRes?.data ?? [];

  if (!affiliate) {
    return {
      affiliate: null,
      aggregates: { ...ZERO_AGGREGATES },
      default_rule,
      coupons,
    };
  }

  const aggregates = await AffiliateStorage.aggregatesForAffiliate(pool, affiliate.id_affiliate);

  return {
    affiliate,
    aggregates,
    default_rule,
    coupons,
  };
}

async function updateMyPayoutInfo(user, body) {
  const affiliate = await AffiliateStorage.getAffiliateByUserId(pool, user.id_user);
  if (!affiliate) throw new ServiceError("Afiliado não encontrado", 404);

  return await AffiliateStorage.updateAffiliatePayoutInfo(pool, {
    id_affiliate: affiliate.id_affiliate,
    pix_key: body.pix_key ?? null,
    pix_key_type: body.pix_key_type ?? null,
    legal_name: body.legal_name ?? null,
    tax_id: body.tax_id ?? null,
    updated_by: user.id_user,
  });
}

async function listMyConversions(user, query) {
  const page = Math.max(parseInt(query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "20", 10), 1), 100);

  const affiliate = await AffiliateStorage.getAffiliateByUserId(pool, user.id_user);
  if (!affiliate) return { items: [], total: 0, page, limit };

  return await AffiliateStorage.listConversions(
    pool,
    {
      id_affiliate: affiliate.id_affiliate,
      status: query.status || null,
      from: query.from || null,
      to: query.to || null,
    },
    { page, limit }
  );
}

// ───────────────────────── /admin/affiliate ─────────────────────────
async function listAffiliates(query) {
  const page = Math.max(parseInt(query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "20", 10), 1), 100);

  return await AffiliateStorage.listAffiliates(
    pool,
    { status: query.status || null, q: query.q || null },
    { page, limit }
  );
}

async function createOrUpdateAffiliate(actor, body) {
  if (!body.id_user) throw new ServiceError("id_user é obrigatório", 400);

  const before = await AffiliateStorage.getAffiliateByUserId(pool, body.id_user);
  const after = await AffiliateStorage.upsertAffiliate(pool, {
    ...body,
    created_by: actor.id_user,
  });

  await AffiliateStorage.writeAudit(pool, {
    entity: "affiliate",
    entity_id: after.id_affiliate,
    action: before ? "update" : "create",
    before_state: before,
    after_state: after,
    actor_user_id: actor.id_user,
  });

  return after;
}

async function updateAffiliateStatus(actor, id_affiliate, { status, reason }) {
  if (!["ACTIVE", "PAUSED", "BLOCKED"].includes(status)) {
    throw new ServiceError("status inválido", 400);
  }
  const before = await AffiliateStorage.getAffiliateById(pool, id_affiliate);
  if (!before) throw new ServiceError("Afiliado não encontrado", 404);

  const after = await AffiliateStorage.updateAffiliateStatus(pool, {
    id_affiliate,
    status,
    updated_by: actor.id_user,
  });

  await AffiliateStorage.writeAudit(pool, {
    entity: "affiliate",
    entity_id: id_affiliate,
    action: "status_change",
    before_state: before,
    after_state: after,
    reason: reason || null,
    actor_user_id: actor.id_user,
  });

  return after;
}

// ───── Settings (versionado) ─────
async function listSettings() {
  return await AffiliateStorage.listSettings(pool);
}

async function createSettings(actor, body) {
  const percent = Number(body.default_commission_percent);
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new ServiceError("default_commission_percent deve estar entre 0 e 100", 400);
  }
  if (body.commission_base && !["GROSS", "NET_OF_DISCOUNT"].includes(body.commission_base)) {
    throw new ServiceError("commission_base inválido", 400);
  }

  const row = await AffiliateStorage.createSettings(pool, {
    ...body,
    default_commission_percent: percent,
    created_by: actor.id_user,
  });

  await AffiliateStorage.writeAudit(pool, {
    entity: "affiliate_settings",
    entity_id: row.id_settings,
    action: "create",
    after_state: row,
    actor_user_id: actor.id_user,
  });

  return row;
}

// ───── Override por cupom ─────
async function upsertCouponOverride(actor, id_coupon, body) {
  if (!id_coupon) throw new ServiceError("id_coupon obrigatório", 400);

  if (body.commission_percent != null) {
    const p = Number(body.commission_percent);
    if (!Number.isFinite(p) || p < 0 || p > 100) {
      throw new ServiceError("commission_percent inválido", 400);
    }
  }
  if (body.commission_base && !["GROSS", "NET_OF_DISCOUNT"].includes(body.commission_base)) {
    throw new ServiceError("commission_base inválido", 400);
  }

  const before = await AffiliateStorage.getCouponOverride(pool, id_coupon);
  const after = await AffiliateStorage.upsertCouponOverride(pool, {
    id_coupon,
    commission_percent: body.commission_percent ?? null,
    commission_base: body.commission_base ?? null,
    max_commission_cents: body.max_commission_cents ?? null,
    approval_delay_days: body.approval_delay_days ?? null,
    updated_by: actor.id_user,
  });

  await AffiliateStorage.writeAudit(pool, {
    entity: "affiliate_coupon_override",
    entity_id: after.id_override,
    action: before ? "update" : "create",
    before_state: before,
    after_state: after,
    actor_user_id: actor.id_user,
  });

  return after;
}

async function deleteCouponOverride(actor, id_coupon) {
  const before = await AffiliateStorage.getCouponOverride(pool, id_coupon);
  if (!before) return { ok: true };

  await AffiliateStorage.deleteCouponOverride(pool, id_coupon);

  await AffiliateStorage.writeAudit(pool, {
    entity: "affiliate_coupon_override",
    entity_id: before.id_override,
    action: "delete",
    before_state: before,
    actor_user_id: actor.id_user,
  });

  return { ok: true };
}

// ───── Conversions (admin) ─────
async function listConversionsAdmin(query) {
  const page = Math.max(parseInt(query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "20", 10), 1), 100);

  return await AffiliateStorage.listConversions(
    pool,
    {
      id_affiliate: query.id_affiliate || null,
      status: query.status || null,
      from: query.from || null,
      to: query.to || null,
      code: query.code || null,
      id_coupon: query.id_coupon || null,
      eligible_only: query.eligible_only === "true",
    },
    { page, limit }
  );
}

// ───── Governance ─────
async function listAudit(query) {
  const page = Math.max(parseInt(query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "50", 10), 1), 200);
  return await AffiliateStorage.listAudit(
    pool,
    {
      entity: query.entity || null,
      action: query.action || null,
      actor_user_id: query.actor_user_id || null,
      entity_id: query.entity_id || null,
    },
    { page, limit }
  );
}

async function overview() {
  return await AffiliateStorage.overviewMetrics(pool);
}

async function resolveDispute(actor, id_conversion, body) {
  if (!id_conversion) throw new ServiceError("id_conversion obrigatório", 400);
  const action = body?.action;
  if (!["keep", "reverse"].includes(action)) {
    throw new ServiceError("action deve ser 'keep' ou 'reverse'", 400);
  }

  const { rows: before } = await pool.query(
    `SELECT * FROM tb_affiliate_conversion WHERE id_conversion = $1`,
    [id_conversion]
  );
  if (before.length === 0) throw new ServiceError("Conversão não encontrada", 404);

  const after = await AffiliateStorage.resolveDispute(pool, {
    id_conversion,
    new_status: action === "reverse" ? "REVERSED" : null,
    clear_disputed: true,
  });

  await AffiliateStorage.writeAudit(pool, {
    entity: "affiliate_conversion",
    entity_id: id_conversion,
    action: `dispute_${action}`,
    before_state: before[0],
    after_state: after,
    reason: body?.reason || null,
    actor_user_id: actor.id_user,
  });

  return after;
}

module.exports = {
  ServiceError,
  listAudit,
  overview,
  resolveDispute,
  // /me
  getMe,
  updateMyPayoutInfo,
  listMyConversions,
  // admin
  listAffiliates,
  createOrUpdateAffiliate,
  updateAffiliateStatus,
  listSettings,
  createSettings,
  upsertCouponOverride,
  deleteCouponOverride,
  listConversionsAdmin,
};
