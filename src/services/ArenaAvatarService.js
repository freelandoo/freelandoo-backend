// Freelandoo Arena — avatares (Módulo 10). Cada função devolve { status, body }.
//
// Conceitos separados (mig 285):
//   modelo de catálogo · combinação pronta · DIREITO DE USO · aparência equipada.
// Tom de pele e cor de cabelo são aparência pessoal: não têm posse nem preço.
//
// Equipar valida, NO SERVIDOR e nesta ordem: formato dos ids → revisão
// esperada → modelo existe e está pronto → combinação existe para o modelo →
// derivados prontos → posse viva. Escrita condicional na revisão, com o
// jogador travado (abas concorrentes). Repetir o que já está equipado é no-op
// 200, mesmo com revisão velha (idempotente, mesma regra das preferências).
//
// A aparência PÚBLICA (o que os outros jogadores veem) é resolvida aqui e só
// aqui: equipada e ainda válida → ela; senão o modelo padrão na aparência
// original; senão null (o cliente mostra o substituto explícito). Nunca sai
// inventário, histórico de posse, origem da concessão nem id de conta.

const pool = require("../databases");
const ArenaAvatarStorage = require("../storages/ArenaAvatarStorage");
const ArenaService = require("./ArenaService");
const rules = require("../utils/arenaRules");

const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const okRes = (body, status = 200) => ({ status, body });

const MODEL_ID = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const PALETTE_ID = /^[a-z0-9][a-z0-9-]{0,22}[a-z0-9]$/;
const ORIGINAL = "original";

function pickLabels(labels) {
  const out = {};
  for (const l of rules.LOCALES) if (typeof labels?.[l] === "string") out[l] = labels[l];
  return out;
}

function acquisitionOf(model) {
  if (model.default_grant) return { available: false, reason: "granted_by_default" };
  if (model.sale_status === "not_for_sale") return { available: false, reason: "purchase_not_integrated" };
  // rights_unconfirmed / owner_decision: não há compra, e o motivo é outro.
  return { available: false, reason: model.sale_status };
}

async function getCatalog({ db = pool } = {}) {
  const [models, variants] = await Promise.all([ArenaAvatarStorage.listModels(db), ArenaAvatarStorage.listVariants(db)]);
  let version = 0;
  const byModel = new Map();
  for (const v of variants) {
    version = Math.max(version, new Date(v.updated_at).getTime());
    if (!byModel.has(v.model_id)) byModel.set(v.model_id, []);
    byModel.get(v.model_id).push([v.skin_id, v.hair_id]);
  }
  const out = models.map((m) => {
    version = Math.max(version, new Date(m.updated_at).getTime());
    return {
      modelId: m.model_id,
      labels: pickLabels(m.labels),
      order: m.sort_order,
      assetVersion: m.asset_version,
      defaultGrant: m.default_grant,
      acquisition: acquisitionOf(m),
      variants: byModel.get(m.model_id) || [],
    };
  });
  return okRes({ version: String(version), models: out });
}

/** Aparência pública resolvida. `conn` pode ser pool ou cliente em transação. */
async function resolvePublic(conn, id_user, equipped) {
  const rev = equipped ? equipped.avatar_revision : 0;
  if (equipped && equipped.avatar_model_id) {
    const { avatar_model_id: m, avatar_skin_id: s, avatar_hair_id: h } = equipped;
    // Sequencial: `conn` pode ser um cliente em transação (uma consulta por vez).
    const model = await ArenaAvatarStorage.getModel(conn, m);
    const variant = await ArenaAvatarStorage.getVariant(conn, m, s, h);
    const owns = await ArenaAvatarStorage.ownsLive(conn, id_user, m);
    if (model && model.status === "ready" && variant && variant.ready && owns) {
      return { modelId: m, skinId: s, hairId: h, rev };
    }
  }
  const models = await ArenaAvatarStorage.listModels(conn);
  for (const model of models) {
    if (!model.default_grant) continue;
    const v = await ArenaAvatarStorage.getVariant(conn, model.model_id, ORIGINAL, ORIGINAL);
    if (v && v.ready) return { modelId: model.model_id, skinId: ORIGINAL, hairId: ORIGINAL, rev };
  }
  return null;
}

async function stateFor(conn, id_user) {
  const equipped = await ArenaAvatarStorage.getEquipped(conn, id_user);
  const owned = await ArenaAvatarStorage.listOwned(conn, id_user);
  return {
    revision: equipped ? equipped.avatar_revision : 0,
    equipped:
      equipped && equipped.avatar_model_id
        ? { modelId: equipped.avatar_model_id, skinId: equipped.avatar_skin_id, hairId: equipped.avatar_hair_id }
        : null,
    appearance: await resolvePublic(conn, id_user, equipped),
    // Posse é PRIVADA: só o titular recebe esta lista.
    owned: owned.map((g) => ({ modelId: g.model_id, source: g.source })),
  };
}

/** Concessão padrão: idempotente, origem explícita, sem simular compra. */
async function grantDefaults(conn, id_user) {
  return ArenaAvatarStorage.grantDefaults(conn, id_user);
}

async function getMine(ctx, { db = pool } = {}) {
  const client = await db.connect();
  try {
    await ArenaService.ensurePlayer(client, ctx.id_user);
    await grantDefaults(client, ctx.id_user);
    return okRes(await stateFor(client, ctx.id_user));
  } finally {
    client.release();
  }
}

async function equip(ctx, body, { db = pool } = {}) {
  const modelId = body?.modelId;
  const skinId = body?.skinId;
  const hairId = body?.hairId;
  const expectedRevision = body?.expectedRevision;
  if (typeof modelId !== "string" || !MODEL_ID.test(modelId)) return fail(400, "invalid_input", "Modelo inválido.");
  if (typeof skinId !== "string" || !PALETTE_ID.test(skinId)) return fail(400, "invalid_input", "Tom de pele inválido.");
  if (typeof hairId !== "string" || !PALETTE_ID.test(hairId)) return fail(400, "invalid_input", "Cor de cabelo inválida.");
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return fail(400, "invalid_input", "Revisão esperada ausente.");
  }
  return ArenaService.withLockedPlayer(
    ctx.id_user,
    async (client) => {
      await grantDefaults(client, ctx.id_user);
      const cur = await ArenaAvatarStorage.getEquipped(client, ctx.id_user, { forUpdate: true });
      const same =
        cur && cur.avatar_model_id === modelId && cur.avatar_skin_id === skinId && cur.avatar_hair_id === hairId;
      if (same) return { result: okRes(await stateFor(client, ctx.id_user)), commit: true };
      if (cur.avatar_revision !== expectedRevision) {
        return {
          result: fail(409, "revision_conflict", "Sua aparência mudou em outra aba. Confira e tente de novo.", {
            state: await stateFor(client, ctx.id_user),
          }),
          commit: true,
        };
      }
      const model = await ArenaAvatarStorage.getModel(client, modelId);
      if (!model || model.status !== "ready") {
        return { result: fail(409, "model_unavailable", "Este personagem não está disponível."), commit: false };
      }
      const variant = await ArenaAvatarStorage.getVariant(client, modelId, skinId, hairId);
      if (!variant) {
        return {
          result: fail(422, "combination_unsupported", "Este personagem não tem essa combinação de pele e cabelo."),
          commit: false,
        };
      }
      if (!variant.ready) {
        return { result: fail(409, "variant_not_ready", "Esta combinação ainda está sendo preparada."), commit: false };
      }
      if (!(await ArenaAvatarStorage.ownsLive(client, ctx.id_user, modelId))) {
        return { result: fail(403, "not_owned", "Você ainda não tem este personagem."), commit: false };
      }
      const row = await ArenaAvatarStorage.setEquipped(client, ctx.id_user, { modelId, skinId, hairId, expectedRevision });
      if (!row) {
        // Travado acima, não deveria acontecer; responde como conflito.
        return {
          result: fail(409, "revision_conflict", "Sua aparência mudou em outra aba.", { state: await stateFor(client, ctx.id_user) }),
          commit: false,
        };
      }
      return { result: okRes(await stateFor(client, ctx.id_user)), commit: true };
    },
    { db }
  );
}

/** Para a sessão (/arena/session e /arena/internal/session): só o público. */
async function publicAppearance(conn, id_user) {
  await grantDefaults(conn, id_user);
  const equipped = await ArenaAvatarStorage.getEquipped(conn, id_user);
  return resolvePublic(conn, id_user, equipped);
}

module.exports = { getCatalog, getMine, equip, publicAppearance, _internal: { acquisitionOf, MODEL_ID, PALETTE_ID } };
