const pool = require("../databases");
const AffiliateStorage = require("../storages/AffiliateStorage");

class ServiceError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

async function listEligible(id_affiliate) {
  if (!id_affiliate) throw new ServiceError("id_affiliate obrigatório", 400);
  const affiliate = await AffiliateStorage.getAffiliateById(pool, id_affiliate);
  if (!affiliate) throw new ServiceError("Afiliado não encontrado", 404);
  const items = await AffiliateStorage.listEligibleConversions(pool, id_affiliate);
  const total = items.reduce((s, r) => s + r.commission_cents, 0);
  return { affiliate, items, total_cents: total };
}

async function createBatch(actor, body) {
  const {
    id_affiliate,
    period_start = null,
    period_end,
    conversion_ids,
    notes = null,
  } = body || {};

  if (!id_affiliate) throw new ServiceError("id_affiliate obrigatório", 400);
  if (!period_end) throw new ServiceError("period_end obrigatório", 400);
  if (!Array.isArray(conversion_ids) || conversion_ids.length === 0) {
    throw new ServiceError("conversion_ids vazio", 400);
  }

  const affiliate = await AffiliateStorage.getAffiliateById(pool, id_affiliate);
  if (!affiliate) throw new ServiceError("Afiliado não encontrado", 404);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const batch = await AffiliateStorage.createPayoutBatch(client, {
      id_affiliate,
      period_start,
      period_end,
      conversion_ids,
      pix_key_snapshot: affiliate.pix_key || null,
      notes,
      created_by: actor.id_user,
    });
    await AffiliateStorage.writeAudit(client, {
      entity: "affiliate_payout_batch",
      entity_id: batch.id_batch,
      action: "create",
      after_state: batch,
      actor_user_id: actor.id_user,
    });
    await client.query("COMMIT");
    return batch;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.status) throw err;
    throw new ServiceError(err.message || "Erro ao criar lote", 500);
  } finally {
    client.release();
  }
}

async function listBatches(query) {
  const page = Math.max(parseInt(query.page || "1", 10), 1);
  const limit = Math.min(Math.max(parseInt(query.limit || "20", 10), 1), 100);
  return await AffiliateStorage.listPayoutBatches(
    pool,
    { id_affiliate: query.id_affiliate || null, status: query.status || null },
    { page, limit }
  );
}

async function getBatch(id_batch) {
  const batch = await AffiliateStorage.getPayoutBatchWithItems(pool, id_batch);
  if (!batch) throw new ServiceError("Lote não encontrado", 404);
  return batch;
}

async function markStatus(actor, id_batch, { status, receipt_url = null, reason = null }) {
  const allowed = ["SENT", "PAID", "CANCELED", "FAILED"];
  if (!allowed.includes(status)) throw new ServiceError("status inválido", 400);

  const before = await AffiliateStorage.getPayoutBatchWithItems(pool, id_batch);
  if (!before) throw new ServiceError("Lote não encontrado", 404);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (status === "CANCELED" || status === "FAILED") {
      if (before.status === "PAID") {
        throw new ServiceError("Não é possível reverter lote já pago", 400);
      }
      await AffiliateStorage.unlinkBatchItems(client, id_batch);
    }

    const after = await AffiliateStorage.markBatchStatus(client, {
      id_batch,
      status,
      receipt_url,
      paid_by: actor.id_user,
    });

    if (status === "PAID") {
      await AffiliateStorage.setConversionsPaidForBatch(client, id_batch);
    }

    await AffiliateStorage.writeAudit(client, {
      entity: "affiliate_payout_batch",
      entity_id: id_batch,
      action: `status_${status.toLowerCase()}`,
      before_state: { status: before.status },
      after_state: after,
      reason,
      actor_user_id: actor.id_user,
    });

    await client.query("COMMIT");
    return after;
  } catch (err) {
    await client.query("ROLLBACK");
    if (err.status) throw err;
    throw new ServiceError(err.message || "Erro ao atualizar lote", 500);
  } finally {
    client.release();
  }
}

module.exports = {
  ServiceError,
  listEligible,
  createBatch,
  listBatches,
  getBatch,
  markStatus,
};
