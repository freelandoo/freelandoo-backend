// Freelandoo Arena — missões, XP da Arena e aquecimento x2 (Módulo 12).
//
// Fonte de verdade de cada fato:
//   checkpoint_accepted — ArenaTerritoryService (M07), na transação do checkpoint;
//   post_visited        — servidor de jogo (posição AUTORITATIVA), conferida
//                         aqui contra o registro canônico do poste;
//   video_completed     — ArenaAdService, quando a sessão do SERVIDOR conclui.
// O cliente nunca emite um fato: ele pede operações.
//
// Processamento (outbox): o fato é inserido na transação da autoridade; depois
// do commit, `processPendingFor(conta)` roda na hora (melhor esforço) e a
// varredura repete para quem ficou (reinício, banco instável). Cada fato é
// processado na sua transação, sob a trava da conta, e marca `processed_at`
// JUNTO com o progresso e a concessão — ou tudo, ou nada.
//
// XP da Arena: só o ledger tb_arena_xp_grant + tb_arena_progression. Não chama
// XpStorage.recalcProfileXp, não gera Poléns, não toca clã/comunidade/ranking.

const pool = require("../databases");
const Missions = require("../storages/ArenaMissionStorage");
const Territory = require("../storages/ArenaTerritoryStorage");
const AdStorage = require("../storages/ArenaAdStorage");
const rules = require("../utils/arenaMissions");
const arenaRules = require("../utils/arenaRules");
const CONFIG = require("../databases/seeds/arena-missions.json");
const { createLogger } = require("../utils/logger");

const log = createLogger("ArenaMissionService");

const ENV_ID = /^br-[a-z]{2}$/;
const POST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const RANGE_TOLERANCE_M = 0.05;

const boostEnabled = () => process.env.ARENA_BOOST_ENABLED === "true";
const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const ok = (body, status = 200) => ({ status, body });
const iso = (d) => (d ? new Date(d).toISOString() : null);
const ms = (d) => new Date(d).getTime();
const cycleOfDate = (d) => rules.cycleKeyOf(ms(d));
/** DATE do pg chega como Date à meia-noite local do processo; normaliza para 'YYYY-MM-DD'. */
const dateKey = (v) => (typeof v === "string" ? v.slice(0, 10) : `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, "0")}-${String(v.getDate()).padStart(2, "0")}`);

/** Processa UM fato. Idempotente. Devolve as concessões feitas AGORA. */
async function processFact(id_fact, { db = pool } = {}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // A trava da conta vem antes de qualquer linha (mesma ordem em todo o módulo).
    const peek = (await client.query(`SELECT id_user FROM public.tb_arena_fact WHERE id_fact = $1`, [id_fact])).rows[0];
    if (!peek) {
      await client.query("ROLLBACK");
      return { grants: [], skipped: "missing" };
    }
    await Missions.lockAccount(client, peek.id_user);
    const fact = await Missions.getFactForUpdate(client, id_fact);
    if (!fact || fact.processed_at) {
      await client.query("ROLLBACK");
      return { grants: [], skipped: "already" };
    }
    const cycle_key = cycleOfDate(fact.occurred_at);
    const grants = [];
    for (const current of await Missions.currentDefs(client, fact.fact_type)) {
      if (current.status !== "active") continue;
      let progress = await Missions.getProgress(client, fact.id_user, current.mission_key, cycle_key, { forUpdate: true });
      // A versão é FIXADA na primeira contribuição do ciclo.
      if (!progress) {
        progress =
          (await Missions.createProgress(client, {
            id_user: fact.id_user,
            mission_key: current.mission_key,
            cycle_key,
            mission_version: current.version,
            target: current.target,
          })) || (await Missions.getProgress(client, fact.id_user, current.mission_key, cycle_key, { forUpdate: true }));
      }
      if (progress.completed_at) continue;
      const def = progress.mission_version === current.version ? current : await Missions.getDef(client, current.mission_key, progress.mission_version);
      const added = await Missions.insertContrib(client, {
        id_user: fact.id_user,
        mission_key: def.mission_key,
        cycle_key,
        contrib_key: rules.contribKey(def, fact),
        id_fact: fact.id_fact,
      });
      if (!added) continue;
      const next = await Missions.advance(client, fact.id_user, def.mission_key, cycle_key, fact.occurred_at);
      if (!next || !next.completed_at) continue;
      // Concluiu: o fator vem do bônus vigente no INSTANTE DO FATO.
      const boost = def.x2_eligible ? await Missions.boostAt(client, fact.id_user, fact.occurred_at) : null;
      const { factor, id_boost } = rules.factorFor(def, boost, ms(fact.occurred_at));
      const row = {
        id_user: fact.id_user,
        mission_key: def.mission_key,
        mission_version: def.version,
        cycle_key,
        id_fact: fact.id_fact,
        fact_type: fact.fact_type,
        fact_at: fact.occurred_at,
        base_xp: def.reward_xp,
        factor,
        xp: def.reward_xp * factor,
        id_boost,
        rule_version: CONFIG.ruleVersion,
      };
      const inserted = await Missions.insertGrant(client, row);
      if (!inserted) {
        // Mesma chave já usada: idêntica → nada a fazer; diferente → CONFLITO (não é sucesso).
        const existing = await Missions.getGrant(client, fact.id_user, def.mission_key, cycle_key);
        const same = existing && String(existing.id_fact) === String(row.id_fact) && existing.base_xp === row.base_xp && existing.mission_version === row.mission_version;
        if (!same) {
          const e = new Error("grant_conflict");
          e.code = "ARENA_GRANT_CONFLICT";
          throw e;
        }
        continue;
      }
      await Missions.addXp(client, fact.id_user, inserted.xp);
      grants.push(inserted);
    }
    await Missions.markProcessed(client, fact.id_fact);
    await client.query("COMMIT");
    if (grants.length) log.info("mission.granted", { grants: grants.length });
    return { grants };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Falha NÃO é duplicata: registra a tentativa e deixa pendente.
    await db.query(`UPDATE public.tb_arena_fact SET attempts = attempts + 1, last_error = $2 WHERE id_fact = $1 AND processed_at IS NULL`, [
      id_fact,
      String(err?.code || err?.message || "erro").slice(0, 200),
    ]).catch(() => {});
    log.error("fact.process_fail", { code: err?.code, message: err?.message });
    throw err;
  } finally {
    client.release();
  }
}

/** Processa os pendentes da conta (ou de todos), em ordem do instante do fato. */
async function processPending({ db = pool, id_user = null, limit = 200 } = {}) {
  const list = await Missions.listPending(db, { id_user, limit });
  let processed = 0;
  let failed = 0;
  for (const f of list) {
    try {
      await processFact(f.id_fact, { db });
      processed++;
    } catch {
      failed++;
    }
  }
  return { scanned: list.length, processed, failed };
}

/** Depois do commit da autoridade: tenta já (sem derrubar quem chamou). */
function kick(id_user, { db = pool } = {}) {
  return processPending({ db, id_user, limit: 50 }).catch((err) => log.warn("kick.fail", { message: err?.message }));
}

// ─── Visita a poste (servidor de jogo, canal assinado) ─────────────────────

async function recordVisit(ctx, body, { db = pool } = {}) {
  const picked = arenaRules.pickBody(body, ["environmentId", "postId", "position"]);
  if (!picked.ok) return fail(400, "invalid_input", `Campo não aceito: ${picked.field}`);
  const b = picked.value;
  if (typeof b.environmentId !== "string" || !ENV_ID.test(b.environmentId)) return fail(400, "invalid_input", "environmentId");
  if (typeof b.postId !== "string" || b.postId.length > 64 || !POST_ID.test(b.postId)) return fail(400, "invalid_input", "postId");
  const p = b.position;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => k !== "x" && k !== "y")) return fail(400, "invalid_input", "position");
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 20_000 || Math.abs(p.y) > 20_000) return fail(400, "invalid_input", "position");
  const client = await db.connect();
  let recorded = false;
  try {
    await client.query("BEGIN");
    await Missions.lockAccount(client, ctx.id_user);
    const post = await Territory.getPost(client, b.environmentId, b.postId);
    // Visitar NÃO é checkpoint: não exige poste competitivo e não toca território.
    if (!post || !post.is_active || !post.in_force) {
      await client.query("ROLLBACK");
      return fail(404, "unknown_post", "Este poste não existe neste ambiente");
    }
    if (Math.hypot(p.x - post.x, p.y - post.y) > post.radius_m + RANGE_TOLERANCE_M) {
      await client.query("ROLLBACK");
      return fail(422, "out_of_range", "Fora do alcance do poste");
    }
    const now = await AdStorage.now(client);
    const day = cycleOfDate(now);
    const fact = await Missions.insertFact(client, {
      id_user: ctx.id_user,
      fact_type: "post_visited",
      source_ref: `${b.environmentId}/${b.postId}/${day}`,
      environment_id: b.environmentId,
      occurred_at: now,
      payload: { postId: b.postId },
    });
    recorded = !!fact;
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
  if (recorded) await kick(ctx.id_user, { db });
  return ok({ result: recorded ? "recorded" : "already_recorded" });
}

// ─── Aquecimento x2 (chamado DENTRO da transação da conclusão do vídeo) ─────

/**
 * Tenta ativar o bônus na MESMA transação (e sob a mesma trava da conta) que
 * aceitou a conclusão. Origem única: repetir não cria outra ativação.
 */
async function tryActivateBoost(client, { id_user, id_session, is_minor }) {
  if (is_minor) return { activated: false, reason: "minor_restricted" };
  const st = await Missions.boostState(client, id_user);
  const nowMs = ms(st.now);
  const d = rules.boostDecision({
    enabled: boostEnabled(),
    policy: CONFIG.boost,
    nowMs,
    todayCount: st.today_count,
    lastStartsAtMs: st.last_starts_at ? ms(st.last_starts_at) : null,
    activeUntilMs: st.active ? ms(st.active.expires_at) : null,
  });
  if (!d.ok) return { activated: false, reason: d.reason };
  const row = await Missions.insertBoost(client, {
    id_user,
    origin_kind: "video_session",
    origin_ref: id_session,
    policy_version: CONFIG.boost.version,
    starts_at: new Date(d.startsAtMs),
    expires_at: new Date(d.expiresAtMs),
  });
  return row ? { activated: true, boost: { startsAt: iso(row.starts_at), expiresAt: iso(row.expires_at) } } : { activated: false, reason: "already_activated" };
}

/** A missão do vídeo ainda paga hoje? (para dizer, ANTES do play, se há recompensa). */
async function videoRewardOffer(client, ctx) {
  if (ctx.is_minor) return { offered: false, reason: "minor_restricted" };
  const defs = (await Missions.currentDefs(client, "video_completed")).filter((d) => d.status === "active");
  if (!defs.length) return { offered: false, reason: "no_mission" };
  const now = await AdStorage.now(client);
  const cycle = cycleOfDate(now);
  for (const d of defs) {
    const pr = await Missions.getProgress(client, ctx.id_user, d.mission_key, cycle);
    if (!pr || !pr.completed_at) return { offered: true, missionKey: d.mission_key, rewardXp: d.reward_xp };
  }
  return { offered: false, reason: "already_completed" };
}

// ─── Leitura pessoal ────────────────────────────────────────────────────────

const grantDto = (g) => ({
  grantId: g.id_grant,
  missionKey: g.mission_key,
  missionVersion: g.mission_version,
  cycle: dateKey(g.cycle_key),
  factType: g.fact_type,
  factAt: iso(g.fact_at),
  baseXp: g.base_xp,
  factor: g.factor,
  xp: g.xp,
  grantedAt: iso(g.granted_at),
});

async function getMine(ctx, { db = pool } = {}) {
  const now = await AdStorage.now(db);
  const nowMs = ms(now);
  const cycle = rules.cycleBounds(nowMs);
  const [defs, progress, prog, competitive, video, boost, pending, recent] = await Promise.all([
    Missions.currentDefs(db),
    Missions.listProgress(db, ctx.id_user, cycle.key),
    Missions.getProgression(db, ctx.id_user),
    Missions.anyCompetitivePost(db),
    AdStorage.hasLiveVideo(db),
    Missions.boostState(db, ctx.id_user),
    Missions.countPending(db, ctx.id_user),
    Missions.listGrants(db, ctx.id_user, { limit: 5 }),
  ]);
  const byKey = new Map(progress.map((p) => [p.mission_key, p]));
  const xp = prog?.xp_total ?? 0;
  const lvl = rules.levelOf(xp, CONFIG.levels);
  const lastStart = boost.last_starts_at ? ms(boost.last_starts_at) : null;
  return ok({
    serverTime: iso(now),
    cycle,
    progression: { xpTotal: xp, level: lvl.level, levelStartXp: lvl.levelStartXp, nextLevelXp: lvl.nextLevelXp, revision: prog?.revision ?? 0 },
    missions: defs.map((d) => {
      const p = byKey.get(d.mission_key);
      // O progresso do ciclo é da versão FIXADA; a vigente pode ser outra.
      const target = p ? p.target : d.target;
      const availability = p?.completed_at ? "completed" : rules.availability(d, { competitivePosts: competitive, videoCampaign: video && !ctx.is_minor, gameServer: true });
      return {
        missionKey: d.mission_key,
        version: p ? p.mission_version : d.version,
        factType: d.fact_type,
        objective: d.objective,
        target,
        progress: p ? p.progress : 0,
        rewardXp: d.reward_xp,
        x2Eligible: d.x2_eligible,
        requirement: d.requirement,
        voluntary: d.voluntary,
        status: availability,
        completedAt: iso(p?.completed_at),
      };
    }),
    boost: {
      enabled: boostEnabled() && !ctx.is_minor,
      factor: CONFIG.boost.factor,
      policyVersion: CONFIG.boost.version,
      durationMin: CONFIG.boost.durationMin,
      maxPerDay: CONFIG.boost.maxPerDay,
      usedToday: boost.today_count,
      active: boost.active ? { startsAt: iso(boost.active.starts_at), expiresAt: iso(boost.active.expires_at) } : null,
      cooldownUntil: lastStart ? iso(new Date(Math.max(nowMs, lastStart + CONFIG.boost.cooldownMin * 60_000))) : null,
    },
    pendingFacts: pending,
    recentGrants: recent.map(grantDto),
  });
}

async function history(ctx, query, { db = pool } = {}) {
  const limit = Math.min(50, Math.max(1, Number.parseInt(query?.limit ?? "20", 10) || 20));
  let before = null;
  if (query?.before != null) {
    if (Number.isNaN(Date.parse(query.before))) return fail(400, "invalid_input", "before");
    before = new Date(query.before).toISOString();
  }
  const rows = await Missions.listGrants(db, ctx.id_user, { limit, before });
  return ok({ grants: rows.map(grantDto), nextBefore: rows.length === limit ? iso(rows[rows.length - 1].granted_at) : null });
}

let sweeper = null;
function startSweeper({ intervalMs = 30_000 } = {}) {
  if (sweeper) return sweeper;
  const run = () => processPending({ limit: 500 }).catch((err) => log.error("sweeper.fail", { message: err?.message }));
  sweeper = setInterval(run, intervalMs);
  sweeper.unref?.();
  setTimeout(run, 7_000).unref?.();
  return sweeper;
}

module.exports = { processFact, processPending, kick, recordVisit, tryActivateBoost, videoRewardOffer, getMine, history, startSweeper, CONFIG };
