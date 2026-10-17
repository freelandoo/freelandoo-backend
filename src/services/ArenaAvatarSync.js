// Sincroniza o catálogo de avatares (mig 285) a partir do arquivo gerado pelo
// build da Arena (`npm run avatars:export` no freelandoo-arena), mesmo padrão
// do catálogo de categorias e dos postes.
//
// Regras:
//   - modelo ausente do arquivo vira 'retired' (nunca apagado: há posse);
//   - variante ausente deixa de estar pronta (pode estar equipada; a
//     aparência pública cai no fallback explícito);
//   - simulação por padrão: roda tudo numa transação e desfaz.

const ArenaAvatarStorage = require("../storages/ArenaAvatarStorage");
const { _internal } = require("./ArenaAvatarService");

const STATUSES = new Set(["draft", "ready"]);
const SALE = new Set(["not_for_sale", "rights_unconfirmed", "owner_decision"]);

function validate(doc) {
  const errors = [];
  if (!doc || doc.version !== 1 || !Array.isArray(doc.models)) return ["versão/forma do documento"];
  const seen = new Set();
  for (const m of doc.models) {
    const where = `modelo ${m?.modelId}`;
    if (!m || typeof m.modelId !== "string" || !_internal.MODEL_ID.test(m.modelId)) errors.push(`${where}: id inválido`);
    if (seen.has(m.modelId)) errors.push(`${where}: repetido`);
    seen.add(m.modelId);
    if (!STATUSES.has(m.status)) errors.push(`${where}: status inválido`);
    if (!SALE.has(m.saleStatus)) errors.push(`${where}: saleStatus inválido`);
    if (!Array.isArray(m.variants) || m.variants.length === 0) errors.push(`${where}: sem variantes`);
    const vs = new Set();
    for (const v of m.variants || []) {
      if (!_internal.PALETTE_ID.test(v.skinId || "") || !_internal.PALETTE_ID.test(v.hairId || "")) errors.push(`${where}: variante inválida`);
      const k = `${v.skinId}.${v.hairId}`;
      if (vs.has(k)) errors.push(`${where}: variante repetida ${k}`);
      vs.add(k);
    }
    if (m.status === "ready" && !(m.variants || []).some((v) => v.skinId === "original" && v.hairId === "original" && v.ready)) {
      errors.push(`${where}: pronto sem a aparência original pronta`);
    }
  }
  return errors;
}

async function syncAvatars(client, doc, { apply = false } = {}) {
  const errors = validate(doc);
  if (errors.length) return { ok: false, errors };
  await client.query("BEGIN");
  try {
    for (const m of doc.models) {
      await ArenaAvatarStorage.upsertModel(client, m);
      await ArenaAvatarStorage.replaceVariants(client, m.modelId, m.variants);
    }
    const retired = await ArenaAvatarStorage.retireMissing(client, doc.models.map((m) => m.modelId));
    const summary = {
      models: doc.models.length,
      ready: doc.models.filter((m) => m.status === "ready").length,
      variants: doc.models.reduce((n, m) => n + m.variants.filter((v) => v.ready).length, 0),
      retired,
    };
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { ok: true, summary };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

module.exports = { syncAvatars, validate };
