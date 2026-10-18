// Regras PURAS das missões, do XP da Arena e do aquecimento x2 (Módulo 12).
// Testadas em test/unit/arenaMissions.test.js.
//
// O "XP da Arena" é PROGRESSÃO DO JOGO. Ele nunca chama XpStorage, nunca gera
// Poléns e nunca toca XP global, de perfil, de clã ou de comunidade.

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const FACT_TYPES = ["checkpoint_accepted", "post_visited", "video_completed", "race_finished"];
const OBJECTIVES = ["count", "distinct"];
const CYCLES = ["daily_utc"];
const REQUIREMENTS = ["none", "game_server", "competitive_posts", "video_campaign"];
const STATUSES = ["active", "disabled"];
const DAY_MS = 86_400_000;

/** Ciclo diário UTC pelo instante AUTORITATIVO do fato (nunca o relógio do navegador). */
function cycleKeyOf(atMs) {
  return new Date(Math.floor(atMs / DAY_MS) * DAY_MS).toISOString().slice(0, 10);
}
function cycleBounds(atMs) {
  const start = Math.floor(atMs / DAY_MS) * DAY_MS;
  return { key: cycleKeyOf(atMs), startsAt: new Date(start).toISOString(), endsAt: new Date(start + DAY_MS).toISOString() };
}

/** Chave da contribuição: "count" deduplica o FATO; "distinct" deduplica a dimensão declarada. */
function contribKey(def, fact) {
  if (def.objective === "count") return `f:${fact.id_fact}`;
  if (fact.fact_type === "post_visited") return `post:${fact.environment_id}:${fact.payload?.postId}`;
  if (fact.fact_type === "checkpoint_accepted") return `post:${fact.environment_id}:${fact.payload?.postId}`;
  return `f:${fact.id_fact}`;
}

/** Níveis V1 (configuração versionada): limiares acumulados; depois do último, +step por nível. */
function levelOf(xp, levels) {
  const thresholds = levels.thresholds;
  let level = 1;
  for (let i = 1; i < thresholds.length; i++) if (xp >= thresholds[i]) level = i + 1;
  const last = thresholds[thresholds.length - 1];
  if (xp >= last && levels.stepAfter > 0) level = thresholds.length + Math.floor((xp - last) / levels.stepAfter);
  const startXp = level <= thresholds.length ? thresholds[level - 1] : last + (level - thresholds.length) * levels.stepAfter;
  const nextXp = level < thresholds.length ? thresholds[level] : last + (level - thresholds.length + 1) * levels.stepAfter;
  return { level, levelStartXp: startXp, nextLevelXp: nextXp };
}

/**
 * Pode ativar o x2 AGORA? Toda a decisão sai daqui, com o que o banco viu sob a
 * trava da conta: ativações de hoje (dia UTC), a mais recente e se há uma ativa.
 */
function boostDecision({ enabled, policy, nowMs, todayCount, lastStartsAtMs, activeUntilMs }) {
  if (!enabled) return { ok: false, reason: "disabled" };
  if (activeUntilMs != null && activeUntilMs > nowMs) return { ok: false, reason: "already_active" };
  if (todayCount >= policy.maxPerDay) return { ok: false, reason: "daily_limit" };
  if (lastStartsAtMs != null && nowMs < lastStartsAtMs + policy.cooldownMin * 60_000) return { ok: false, reason: "cooldown" };
  return { ok: true, startsAtMs: nowMs, expiresAtMs: nowMs + policy.durationMin * 60_000 };
}

/** Fator da concessão: decidido pelo instante do FATO que completa a missão. */
function factorFor(def, boost, factAtMs) {
  if (!def.x2_eligible || !boost) return { factor: 1, id_boost: null };
  const s = new Date(boost.starts_at).getTime();
  const e = new Date(boost.expires_at).getTime();
  if (boost.revoked_at || factAtMs < s || factAtMs >= e) return { factor: 1, id_boost: null };
  return { factor: 2, id_boost: boost.id_boost };
}

/** Valida o documento seeds/arena-missions.json. Nenhuma expressão executável. */
function validateMissionsDoc(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object") return { errors: ["documento"] };
  if (!Number.isInteger(doc.ruleVersion) || doc.ruleVersion < 1) errors.push("ruleVersion");
  const lv = doc.levels;
  if (!lv || !Array.isArray(lv.thresholds) || lv.thresholds[0] !== 0 || lv.thresholds.length < 2) errors.push("levels.thresholds começa em 0");
  else for (let i = 1; i < lv.thresholds.length; i++) if (!(Number.isInteger(lv.thresholds[i]) && lv.thresholds[i] > lv.thresholds[i - 1])) errors.push("levels.thresholds crescente");
  if (!lv || !Number.isInteger(lv.stepAfter) || lv.stepAfter < 1) errors.push("levels.stepAfter");
  const b = doc.boost;
  if (!b || !Number.isInteger(b.version) || !Number.isInteger(b.durationMin) || b.durationMin < 1 || b.durationMin > 120) errors.push("boost.durationMin");
  if (!b || !Number.isInteger(b.maxPerDay) || b.maxPerDay < 0 || b.maxPerDay > 24) errors.push("boost.maxPerDay");
  if (!b || !Number.isInteger(b.cooldownMin) || b.cooldownMin < 0 || b.cooldownMin > 1440) errors.push("boost.cooldownMin");
  if (b && b.factor !== 2) errors.push("boost.factor = 2");
  const seen = new Set();
  for (const m of Array.isArray(doc.missions) ? doc.missions : (errors.push("missions"), [])) {
    const tag = m?.missionKey ?? "?";
    if (typeof m?.missionKey !== "string" || m.missionKey.length > 48 || !SLUG.test(m.missionKey)) errors.push(`${tag}: missionKey`);
    if (seen.has(m?.missionKey)) errors.push(`${tag}: duplicada`);
    seen.add(m?.missionKey);
    if (!Number.isInteger(m?.version) || m.version < 1) errors.push(`${tag}: version`);
    if (!STATUSES.includes(m?.status)) errors.push(`${tag}: status`);
    if (!FACT_TYPES.includes(m?.factType)) errors.push(`${tag}: factType`);
    if (!OBJECTIVES.includes(m?.objective)) errors.push(`${tag}: objective`);
    if (m?.objective === "distinct" && !["post_visited", "checkpoint_accepted"].includes(m?.factType)) errors.push(`${tag}: distinct sem dimensão`);
    if (!Number.isInteger(m?.target) || m.target < 1 || m.target > 100) errors.push(`${tag}: target`);
    if (!CYCLES.includes(m?.cycle)) errors.push(`${tag}: cycle`);
    if (!Number.isInteger(m?.rewardXp) || m.rewardXp < 0 || m.rewardXp > 10_000) errors.push(`${tag}: rewardXp`);
    if (typeof m?.x2Eligible !== "boolean") errors.push(`${tag}: x2Eligible`);
    if (m?.factType === "video_completed" && m?.x2Eligible) errors.push(`${tag}: a missão do vídeo não pode ser multiplicada pelo bônus que ela mesma ativa`);
    if (!REQUIREMENTS.includes(m?.requirement)) errors.push(`${tag}: requirement`);
    if (typeof m?.voluntary !== "boolean") errors.push(`${tag}: voluntary`);
    if (!Number.isInteger(m?.order)) errors.push(`${tag}: order`);
  }
  return errors.length ? { errors } : { value: doc };
}

/** Disponibilidade para a TELA (o progresso nunca depende disto: o fato já é a prova). */
function availability(def, ctx) {
  if (def.status === "disabled") return "disabled";
  if (def.requirement === "competitive_posts" && !ctx.competitivePosts) return "competitive_closed";
  if (def.requirement === "video_campaign" && !ctx.videoCampaign) return "no_campaign";
  if (def.requirement === "game_server" && !ctx.gameServer) return "game_server_required";
  return "available";
}

module.exports = {
  FACT_TYPES,
  OBJECTIVES,
  REQUIREMENTS,
  DAY_MS,
  cycleKeyOf,
  cycleBounds,
  contribKey,
  levelOf,
  boostDecision,
  factorFor,
  validateMissionsDoc,
  availability,
};
