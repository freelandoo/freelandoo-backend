// Freelandoo Arena — identidade de jogador (M04) e comunidades/preferências
// (M05). Cada função devolve { status, body }: o controller só escreve.
//
// Invariantes (as que o banco não garante sozinho estão aqui):
//   - uma equipe por (jogador, categoria) — PK no banco;
//   - equipe pertence à categoria — FK composta no banco;
//   - seleção ativa aponta para preferência DO PRÓPRIO jogador — FK composta;
//     a equipe ativa é a da preferência, então não existe meia seleção;
//   - salvar NÃO ativa (só com `activate: true`, explícito);
//   - trocar a equipe da categoria ativa DESATIVA a participação, em vez de
//     trocar a equipe ativa em silêncio (resposta traz `activeCleared`);
//   - remover a preferência ativa limpa a seleção na MESMA transação (FK);
//   - escrita concorrente: `expectedRevision` + `SELECT ... FOR UPDATE` no
//     jogador. Requisição obsoleta recebe 409 com o estado atual. Repetir uma
//     operação cujo efeito já está no banco é no-op 200 (idempotente) mesmo com
//     revisão velha;
//   - categoria sensível: sem política aprovada a coleta fica desligada;
//     com política, exige autorização específica da versão vigente; menor de
//     idade não escolhe categoria sensível.
//
// Nada aqui toca pontuação, postes, rankings, recompensas ou partidas.

const pool = require("../databases");
const ArenaStorage = require("../storages/ArenaStorage");
const rules = require("../utils/arenaRules");
const { createLogger } = require("../utils/logger");

const log = createLogger("ArenaService");

const includeSynthetic = () => process.env.NODE_ENV !== "production";

const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const okRes = (body, status = 200) => ({ status, body });

// ─── Projeções ───────────────────────────────────────────────────────────────

function pickLabels(labels) {
  const out = {};
  for (const l of rules.LOCALES) if (typeof labels?.[l] === "string") out[l] = labels[l];
  return out;
}

function stateFrom(player, prefs, consents) {
  if (!player) return { revision: 0, active: null, activeBlocked: null, preferences: [], consents: [] };
  const byCat = new Map(prefs.map((p) => [p.category_id, p]));
  const activePref = player.active_category_id ? byCat.get(player.active_category_id) : null;
  return {
    revision: player.revision,
    active: activePref && activePref.valid ? { categoryId: activePref.category_id, teamId: activePref.team_id } : null,
    // Guardada mas não vale agora (catálogo desligou, política mudou): a tela
    // explica em vez de mostrar como participação válida.
    activeBlocked: activePref && !activePref.valid ? activePref.category_id : null,
    preferences: prefs.map((p) => ({ categoryId: p.category_id, teamId: p.team_id, valid: !!p.valid })),
    consents: consents
      .filter((c) => !c.revoked_at)
      .map((c) => ({ categoryId: c.category_id, policyVersion: c.policy_version })),
  };
}

async function loadState(conn, id_user) {
  const player = await ArenaStorage.getPlayer(conn, id_user);
  if (!player) return stateFrom(null, [], []);
  const [prefs, consents] = await Promise.all([
    ArenaStorage.listPreferences(conn, id_user, { includeSynthetic: includeSynthetic() }),
    ArenaStorage.listConsents(conn, id_user),
  ]);
  return stateFrom(player, prefs, consents);
}

// ─── Transação com o jogador travado ────────────────────────────────────────

async function ensurePlayer(conn, id_user) {
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await ArenaStorage.ensurePlayer(conn, id_user, rules.newPlayerId());
      return;
    } catch (err) {
      // Colisão de player_id (≈ impossível com 119 bits): sorteia outro.
      if (err?.code === "23505" && String(err.constraint) === "ux_arena_player_player_id") continue;
      throw err;
    }
  }
  throw new Error("não foi possível gerar um playerId único");
}

/**
 * Abre transação, garante o jogador e o TRAVA. `work` recebe o jogador e
 * devolve `{ result, commit }`; sem commit, faz rollback (no-op ou recusa).
 */
async function withLockedPlayer(id_user, work, { db = pool } = {}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await ensurePlayer(client, id_user);
    const player = await ArenaStorage.getPlayer(client, id_user, { forUpdate: true });
    const out = await work(client, player);
    if (out.commit) await client.query("COMMIT");
    else await client.query("ROLLBACK");
    return out.result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const conflict = async (client, id_user) =>
  fail(409, "revision_conflict", "Suas escolhas mudaram em outro lugar. Confira e tente de novo.", {
    state: await loadState(client, id_user),
  });

// ─── Sessão / identidade (M04) ───────────────────────────────────────────────

async function startSession(ctx, { db = pool } = {}) {
  const client = await db.connect();
  try {
    await ensurePlayer(client, ctx.id_user);
    const player = await ArenaStorage.getPlayer(client, ctx.id_user);
    const state = await loadState(client, ctx.id_user);
    return okRes({
      player: {
        playerId: player.player_id,
        displayName: rules.publicDisplayName(ctx.username),
        avatarRef: null,
      },
      account: { username: ctx.username },
      restrictions: { minor: ctx.is_minor, sensitiveAllowed: !ctx.is_minor },
      preferences: state,
    });
  } finally {
    client.release();
  }
}

async function getPreferences(ctx, { db = pool } = {}) {
  return okRes(await loadState(db, ctx.id_user));
}

// ─── Catálogo (público) ──────────────────────────────────────────────────────

async function getCatalog({ db = pool } = {}) {
  const { categories, teams } = await ArenaStorage.getCatalog(db, { includeSynthetic: includeSynthetic() });
  let version = 0;
  const teamsBy = new Map();
  for (const t of teams) {
    version = Math.max(version, new Date(t.updated_at).getTime());
    if (!teamsBy.has(t.category_id)) teamsBy.set(t.category_id, []);
    teamsBy.get(t.category_id).push({ teamId: t.team_id, labels: pickLabels(t.labels), color: t.color || null, order: t.sort_order });
  }
  const out = categories.map((c) => {
    version = Math.max(version, new Date(c.updated_at).getTime());
    const list = teamsBy.get(c.category_id) || [];
    return {
      categoryId: c.category_id,
      sensitive: c.is_sensitive,
      availability: rules.categoryAvailability({
        isActive: c.is_active,
        isSensitive: c.is_sensitive,
        consentPolicyVersion: c.consent_policy_version,
        activeTeamCount: list.length,
      }),
      consentPolicyVersion: c.is_sensitive ? c.consent_policy_version : null,
      order: c.sort_order,
      labels: pickLabels(c.labels),
      color: c.color || null,
      teams: list,
    };
  });
  return okRes({ version: String(version), categories: out });
}

// ─── Validação de uma escolha contra o catálogo do SERVIDOR ─────────────────

async function checkChoice(conn, ctx, category_id, team_id) {
  const row = await ArenaStorage.getTeamForChoice(conn, category_id, team_id, { includeSynthetic: includeSynthetic() });
  if (!row) return fail(404, "unknown_category", "Categoria não encontrada");
  if (!row.team_id || (row.is_synthetic && !includeSynthetic())) {
    return fail(422, "team_not_in_category", "Essa equipe não pertence a esta categoria");
  }
  const availability = rules.categoryAvailability({
    isActive: row.category_active,
    isSensitive: row.is_sensitive,
    consentPolicyVersion: row.consent_policy_version,
    activeTeamCount: row.active_team_count,
  });
  if (availability === "inactive") return fail(422, "category_unavailable", "Categoria indisponível");
  if (row.is_sensitive && ctx.is_minor) {
    return fail(403, "minor_restricted", "Contas supervisionadas não escolhem esta categoria");
  }
  if (availability === "awaiting_policy") {
    return fail(422, "awaiting_policy", "Esta categoria ainda não está aberta para escolhas");
  }
  if (!row.team_active) return fail(422, "team_unavailable", "Equipe indisponível");
  if (row.is_sensitive) {
    const consent = await ArenaStorage.getConsent(conn, ctx.id_user, category_id);
    if (!consent || consent.revoked_at || consent.policy_version !== row.consent_policy_version) {
      return fail(422, "consent_required", "Autorize o uso desta escolha antes de salvar", {
        policyVersion: row.consent_policy_version,
      });
    }
  }
  return null;
}

function parseRevision(v) {
  return rules.isRevision(v) ? v : null;
}

// ─── Preferências (M05) ──────────────────────────────────────────────────────

async function savePreference(ctx, category_id, rawBody, { db = pool } = {}) {
  if (!rules.isCategoryId(category_id)) return fail(400, "invalid_input", "Categoria inválida");
  const picked = rules.pickBody(rawBody, ["teamId", "expectedRevision", "activate"]);
  if (!picked.ok) return fail(400, "invalid_input", `Campo não aceito: ${picked.field}`);
  const { teamId, expectedRevision, activate = false } = picked.value;
  if (!rules.isTeamId(teamId)) return fail(400, "invalid_input", "Equipe inválida");
  if (parseRevision(expectedRevision) === null) return fail(400, "invalid_input", "expectedRevision inválido");
  if (typeof activate !== "boolean") return fail(400, "invalid_input", "activate deve ser verdadeiro ou falso");

  return withLockedPlayer(ctx.id_user, async (client, player) => {
    const refused = await checkChoice(client, ctx, category_id, teamId);
    if (refused) return { result: refused, commit: false };

    const current = await ArenaStorage.getPreference(client, ctx.id_user, category_id);
    const isActive = player.active_category_id === category_id;
    const sameTeam = current && current.team_id === teamId;
    if (sameTeam && (!activate || isActive)) {
      return { result: okRes({ changed: false, activeCleared: false, state: await loadState(client, ctx.id_user) }), commit: false };
    }
    if (expectedRevision !== player.revision) return { result: await conflict(client, ctx.id_user), commit: false };

    await ArenaStorage.upsertPreference(client, ctx.id_user, category_id, teamId);
    let nextActive = player.active_category_id;
    let activeCleared = false;
    if (activate) nextActive = category_id;
    else if (isActive && !sameTeam) {
      nextActive = null;
      activeCleared = true;
    }
    await ArenaStorage.bumpRevision(client, ctx.id_user, { activeCategoryId: nextActive });
    return { result: okRes({ changed: true, activeCleared, state: await loadState(client, ctx.id_user) }), commit: true };
  }, { db });
}

async function removePreference(ctx, category_id, rawBody, { db = pool } = {}) {
  if (!rules.isCategoryId(category_id)) return fail(400, "invalid_input", "Categoria inválida");
  const picked = rules.pickBody(rawBody, ["expectedRevision"]);
  if (!picked.ok) return fail(400, "invalid_input", `Campo não aceito: ${picked.field}`);
  if (parseRevision(picked.value.expectedRevision) === null) return fail(400, "invalid_input", "expectedRevision inválido");

  return withLockedPlayer(ctx.id_user, async (client, player) => {
    const current = await ArenaStorage.getPreference(client, ctx.id_user, category_id);
    if (!current) return { result: okRes({ changed: false, state: await loadState(client, ctx.id_user) }), commit: false };
    if (picked.value.expectedRevision !== player.revision) return { result: await conflict(client, ctx.id_user), commit: false };
    await ArenaStorage.deletePreference(client, ctx.id_user, category_id);
    const nextActive = player.active_category_id === category_id ? null : player.active_category_id;
    await ArenaStorage.bumpRevision(client, ctx.id_user, { activeCategoryId: nextActive });
    return { result: okRes({ changed: true, state: await loadState(client, ctx.id_user) }), commit: true };
  }, { db });
}

async function setActive(ctx, rawBody, { db = pool } = {}) {
  const picked = rules.pickBody(rawBody, ["categoryId", "expectedRevision"]);
  if (!picked.ok) return fail(400, "invalid_input", `Campo não aceito: ${picked.field}`);
  const { categoryId = null, expectedRevision } = picked.value;
  if (categoryId !== null && !rules.isCategoryId(categoryId)) return fail(400, "invalid_input", "Categoria inválida");
  if (parseRevision(expectedRevision) === null) return fail(400, "invalid_input", "expectedRevision inválido");

  return withLockedPlayer(ctx.id_user, async (client, player) => {
    if (player.active_category_id === categoryId) {
      // Já é o estado pedido. Uma ativação só é no-op se ainda VALER.
      const state = await loadState(client, ctx.id_user);
      if (categoryId === null || state.active) return { result: okRes({ changed: false, state }), commit: false };
    }
    if (categoryId !== null) {
      const pref = await ArenaStorage.getPreference(client, ctx.id_user, categoryId);
      if (!pref) return { result: fail(422, "preference_required", "Escolha uma equipe nesta categoria antes de ativá-la"), commit: false };
      const refused = await checkChoice(client, ctx, categoryId, pref.team_id);
      if (refused) return { result: refused, commit: false };
    }
    if (expectedRevision !== player.revision) return { result: await conflict(client, ctx.id_user), commit: false };
    await ArenaStorage.bumpRevision(client, ctx.id_user, { activeCategoryId: categoryId });
    return { result: okRes({ changed: true, state: await loadState(client, ctx.id_user) }), commit: true };
  }, { db });
}

// ─── Autorização específica (categoria sensível) ────────────────────────────

async function grantConsent(ctx, category_id, rawBody, { db = pool } = {}) {
  if (!rules.isCategoryId(category_id)) return fail(400, "invalid_input", "Categoria inválida");
  const picked = rules.pickBody(rawBody, ["policyVersion"]);
  if (!picked.ok) return fail(400, "invalid_input", `Campo não aceito: ${picked.field}`);
  const { policyVersion } = picked.value;
  if (!Number.isInteger(policyVersion) || policyVersion < 1) return fail(400, "invalid_input", "policyVersion inválido");

  return withLockedPlayer(ctx.id_user, async (client) => {
    const cat = await ArenaStorage.getCategory(client, category_id);
    if (!cat || !cat.is_active) return { result: fail(404, "unknown_category", "Categoria não encontrada"), commit: false };
    if (!cat.is_sensitive) return { result: fail(422, "not_sensitive", "Esta categoria não pede autorização específica"), commit: false };
    if (ctx.is_minor) return { result: fail(403, "minor_restricted", "Contas supervisionadas não escolhem esta categoria"), commit: false };
    if (!cat.consent_policy_version) return { result: fail(422, "awaiting_policy", "Esta categoria ainda não está aberta para escolhas"), commit: false };
    // Só vale aceitar a versão que está em vigor: aceitar "a 1" quando a
    // vigente é a 2 seria consentir com um texto que a pessoa não leu.
    if (policyVersion !== cat.consent_policy_version) {
      return { result: fail(409, "policy_changed", "A política mudou. Leia a versão atual.", { policyVersion: cat.consent_policy_version }), commit: false };
    }
    const current = await ArenaStorage.getConsent(client, ctx.id_user, category_id);
    if (current && !current.revoked_at && current.policy_version === policyVersion) {
      return { result: okRes({ changed: false, state: await loadState(client, ctx.id_user) }), commit: false };
    }
    await ArenaStorage.grantConsent(client, ctx.id_user, category_id, policyVersion);
    const player = await ArenaStorage.getPlayer(client, ctx.id_user);
    await ArenaStorage.bumpRevision(client, ctx.id_user, { activeCategoryId: player.active_category_id });
    return { result: okRes({ changed: true, state: await loadState(client, ctx.id_user) }), commit: true };
  }, { db });
}

/**
 * Revogar = parar de usar: apaga a escolha daquela categoria (e a seleção
 * ativa, pela FK) e marca a revogação. Não guarda cópia da escolha.
 */
async function revokeConsent(ctx, category_id, { db = pool } = {}) {
  if (!rules.isCategoryId(category_id)) return fail(400, "invalid_input", "Categoria inválida");
  return withLockedPlayer(ctx.id_user, async (client, player) => {
    const removed = await ArenaStorage.deletePreference(client, ctx.id_user, category_id);
    const revoked = await ArenaStorage.revokeConsent(client, ctx.id_user, category_id);
    if (!removed && !revoked) return { result: okRes({ changed: false, state: await loadState(client, ctx.id_user) }), commit: false };
    const nextActive = player.active_category_id === category_id ? null : player.active_category_id;
    await ArenaStorage.bumpRevision(client, ctx.id_user, { activeCategoryId: nextActive });
    log.info("consent.revoked", { category_id });
    return { result: okRes({ changed: true, state: await loadState(client, ctx.id_user) }), commit: true };
  }, { db });
}

// ─── Conta apagada ───────────────────────────────────────────────────────────

/** Chamado pelo DeleteMeService: preferência (inclusive sensível) não sobrevive à conta. */
async function deleteAllForUser(id_user, { db = pool } = {}) {
  return ArenaStorage.deletePlayer(db, id_user);
}

module.exports = {
  startSession,
  getPreferences,
  getCatalog,
  savePreference,
  removePreference,
  setActive,
  grantConsent,
  revokeConsent,
  deleteAllForUser,
  _internal: { stateFrom },
};
