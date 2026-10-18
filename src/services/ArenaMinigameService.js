// Freelandoo Arena — resultado de minigame (Jetpack Race, M14, mig 289).
//
// Quem atesta o resultado é o SERVIDOR DE JOGO (canal interno assinado): a
// chegada é detectada lá, por tick + fração. Aqui só se guarda o que ele
// atestou, de forma idempotente:
//   • mesmo resultId + mesmo conteúdo  → already_recorded (reenvio após queda);
//   • mesmo resultId (ou matchId) com conteúdo diferente → 409, nunca update;
//   • cada participante que CRUZOU a chegada vira um fato `race_finished` na
//     MESMA transação (outbox do M12). DNF não gera fato.
//
// A identidade vem do registro canônico (playerId → tb_arena_player): o
// servidor de jogo nunca manda id_user.

const crypto = require("node:crypto");
const pool = require("../databases");
const Missions = require("../storages/ArenaMissionStorage");
const AdStorage = require("../storages/ArenaAdStorage");
const arenaRules = require("../utils/arenaRules");
const MissionService = require("./ArenaMissionService");
const { createLogger } = require("../utils/logger");

const log = createLogger("ArenaMinigameService");

/** Experiências que o backend aceita (lista fechada; espelho do registro do servidor de jogo). */
const EXPERIENCES = Object.freeze({
  "jetpack-race": { maxPlayers: 4, maxDurationMs: 10 * 60_000 },
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENV_ID = /^br-[a-z]{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HASH = /^[0-9a-f]{8,64}$/;
const PLAYER_ID = /^pl_[A-Za-z0-9]{10,32}$/;
const WORKER_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_RACE_MS = 30 * 60_000;

const fail = (status, code, error) => ({ status, body: { error, code } });
const ok = (body, status = 200) => ({ status, body });
const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
const isoMs = (s) => (typeof s === "string" && s.length <= 40 && !Number.isNaN(Date.parse(s)) ? Date.parse(s) : null);

/** Valida e normaliza. Devolve { value } ou { error: [código, campo] }. */
function parseResult(body) {
  const picked = arenaRules.pickBody(body, [
    "resultId", "matchId", "experienceId", "experienceVersion", "rulesVersion",
    "environmentId", "portalId", "track", "startedAt", "finishedAt", "standings", "authority",
  ]);
  if (!picked.ok) return { error: ["invalid_input", picked.field] };
  const b = picked.value;
  if (typeof b.resultId !== "string" || !UUID.test(b.resultId)) return { error: ["invalid_input", "resultId"] };
  if (typeof b.matchId !== "string" || !UUID.test(b.matchId)) return { error: ["invalid_input", "matchId"] };
  const exp = typeof b.experienceId === "string" ? EXPERIENCES[b.experienceId] : undefined;
  if (!exp) return { error: ["unknown_experience", "experienceId"] };
  if (!isInt(b.experienceVersion, 1, 10_000)) return { error: ["invalid_input", "experienceVersion"] };
  if (!isInt(b.rulesVersion, 1, 10_000)) return { error: ["invalid_input", "rulesVersion"] };
  if (typeof b.environmentId !== "string" || !ENV_ID.test(b.environmentId)) return { error: ["invalid_input", "environmentId"] };
  if (typeof b.portalId !== "string" || b.portalId.length > 64 || !SLUG.test(b.portalId)) return { error: ["invalid_input", "portalId"] };
  const t = b.track;
  if (!t || typeof t !== "object" || Array.isArray(t) || Object.keys(t).some((k) => !["seed", "version", "hash"].includes(k))) return { error: ["invalid_input", "track"] };
  if (!isInt(t.seed, 0, 0xffffffff) || !isInt(t.version, 1, 10_000) || typeof t.hash !== "string" || !HASH.test(t.hash)) return { error: ["invalid_input", "track"] };
  const started = isoMs(b.startedAt);
  const finished = isoMs(b.finishedAt);
  if (started === null) return { error: ["invalid_input", "startedAt"] };
  if (finished === null || finished < started || finished - started > Math.min(MAX_RACE_MS, exp.maxDurationMs)) return { error: ["invalid_input", "finishedAt"] };
  let authority = null;
  if (b.authority !== undefined && b.authority !== null) {
    const a = b.authority;
    if (typeof a !== "object" || Array.isArray(a) || Object.keys(a).some((k) => k !== "workerId" && k !== "epoch")) return { error: ["invalid_input", "authority"] };
    if (typeof a.workerId !== "string" || !WORKER_ID.test(a.workerId) || !isInt(a.epoch, 0, 2_000_000_000)) return { error: ["invalid_input", "authority"] };
    authority = { workerId: a.workerId, epoch: a.epoch };
  }
  const st = b.standings;
  if (!Array.isArray(st) || st.length < 1 || st.length > exp.maxPlayers) return { error: ["invalid_input", "standings"] };
  const slots = new Set();
  const players = new Set();
  const standings = [];
  for (const s of st) {
    if (!s || typeof s !== "object" || Array.isArray(s) || Object.keys(s).some((k) => !["playerId", "slot", "outcome", "place", "timeMs"].includes(k))) return { error: ["invalid_input", "standings"] };
    if (typeof s.playerId !== "string" || !PLAYER_ID.test(s.playerId) || players.has(s.playerId)) return { error: ["invalid_input", "standings.playerId"] };
    if (!isInt(s.slot, 0, exp.maxPlayers - 1) || slots.has(s.slot)) return { error: ["invalid_input", "standings.slot"] };
    if (s.outcome === "finished") {
      if (!isInt(s.place, 1, exp.maxPlayers) || !isInt(s.timeMs, 1, MAX_RACE_MS)) return { error: ["invalid_input", "standings.finished"] };
    } else if (s.outcome === "dnf") {
      if (s.place !== null || s.timeMs !== null) return { error: ["invalid_input", "standings.dnf"] };
    } else return { error: ["invalid_input", "standings.outcome"] };
    slots.add(s.slot);
    players.add(s.playerId);
    standings.push({ playerId: s.playerId, slot: s.slot, outcome: s.outcome, place: s.place, timeMs: s.timeMs });
  }
  // Colocação coerente com o tempo: mais rápido = melhor; empate = mesma colocação;
  // colocação = 1 + quantos chegaram ESTRITAMENTE antes (competição padrão).
  const fin = standings.filter((s) => s.outcome === "finished");
  for (const s of fin) {
    const expected = 1 + fin.filter((o) => o.timeMs < s.timeMs).length;
    if (s.place !== expected) return { error: ["invalid_input", "standings.place"] };
  }
  standings.sort((a, b2) => a.slot - b2.slot);
  return {
    value: {
      resultId: b.resultId.toLowerCase(),
      matchId: b.matchId.toLowerCase(),
      experienceId: b.experienceId,
      experienceVersion: b.experienceVersion,
      rulesVersion: b.rulesVersion,
      environmentId: b.environmentId,
      portalId: b.portalId,
      track: { seed: t.seed, version: t.version, hash: t.hash },
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(finished).toISOString(),
      authority,
      standings,
    },
  };
}

/** Hash canônico do resultado (ordem fixa; independe da ordem em que o JSON chegou). */
function hashResult(v) {
  const canon = JSON.stringify([
    v.resultId, v.matchId, v.experienceId, v.experienceVersion, v.rulesVersion, v.environmentId, v.portalId,
    [v.track.seed, v.track.version, v.track.hash], v.startedAt, v.finishedAt,
    v.authority ? [v.authority.workerId, v.authority.epoch] : null,
    v.standings.map((s) => [s.slot, s.playerId, s.outcome, s.place, s.timeMs]),
  ]);
  return crypto.createHash("sha256").update(canon).digest("hex");
}

async function recordResult(body, { db = pool, retry = 0 } = {}) {
  const parsed = parseResult(body);
  if (parsed.error) return fail(parsed.error[0] === "unknown_experience" ? 422 : 400, parsed.error[0], parsed.error[1]);
  const v = parsed.value;
  const payloadHash = hashResult(v);
  const client = await db.connect();
  const finishers = [];
  let recorded = false;
  try {
    await client.query("BEGIN");
    // Serializa reenvios do MESMO resultado (e da mesma partida) entre processos.
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('arena-mg:' || $1))`, [v.matchId]);
    const prior = (await client.query(
      `SELECT result_id, match_id, payload_hash FROM public.tb_arena_minigame_match WHERE result_id = $1 OR match_id = $2`,
      [v.resultId, v.matchId]
    )).rows;
    if (prior.length) {
      await client.query("ROLLBACK");
      const same = prior.length === 1 && prior[0].result_id === v.resultId && prior[0].payload_hash === payloadHash;
      if (same) return ok({ result: "already_recorded" });
      log.error("minigame.result_conflict", { match: v.matchId });
      return fail(409, "result_conflict", "Já existe outro resultado para esta partida");
    }
    const ids = v.standings.map((s) => s.playerId);
    const owners = (await client.query(`SELECT player_id, id_user FROM public.tb_arena_player WHERE player_id = ANY($1::varchar[])`, [ids])).rows;
    const userOf = new Map(owners.map((r) => [r.player_id, r.id_user]));
    if (userOf.size !== ids.length || new Set(userOf.values()).size !== ids.length) {
      await client.query("ROLLBACK");
      return fail(422, "unknown_player", "Participante desconhecido ou repetido");
    }
    await client.query(
      `INSERT INTO public.tb_arena_minigame_match
         (result_id, match_id, experience_id, experience_version, rules_version, environment_id, portal_id,
          track_seed, track_version, track_hash, worker_id, worker_epoch, started_at, finished_at, participants, payload_hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [
        v.resultId, v.matchId, v.experienceId, v.experienceVersion, v.rulesVersion, v.environmentId, v.portalId,
        v.track.seed, v.track.version, v.track.hash, v.authority?.workerId ?? null, v.authority?.epoch ?? null,
        v.startedAt, v.finishedAt, v.standings.length, payloadHash,
      ]
    );
    for (const s of v.standings) {
      await client.query(
        `INSERT INTO public.tb_arena_minigame_result (result_id, slot, id_user, outcome, place, time_ms) VALUES ($1,$2,$3,$4,$5,$6)`,
        [v.resultId, s.slot, userOf.get(s.playerId), s.outcome, s.place, s.timeMs]
      );
    }
    // Instante AUTORITATIVO do fato = relógio do banco (o ciclo diário do M12 é por ele).
    const now = await AdStorage.now(client);
    for (const s of v.standings) {
      if (s.outcome !== "finished") continue;
      const id_user = userOf.get(s.playerId);
      const fact = await Missions.insertFact(client, {
        id_user,
        fact_type: "race_finished",
        source_ref: `${v.experienceId}/${v.resultId}`,
        environment_id: v.environmentId,
        occurred_at: now,
        payload: { matchId: v.matchId, place: s.place },
      });
      if (fact) finishers.push(id_user);
    }
    await client.query("COMMIT");
    recorded = true;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    // Corrida entre dois reenvios simultâneos com a trava não pegos: unicidade decide.
    if (err?.code === "23505" && retry < 1) return recordResult(body, { db, retry: retry + 1 });
    throw err;
  } finally {
    client.release();
  }
  if (recorded) {
    for (const id_user of finishers) await MissionService.kick(id_user, { db });
    log.info("minigame.recorded", { experience: v.experienceId, participants: v.standings.length, finished: finishers.length });
  }
  return ok({ result: "recorded" });
}

module.exports = { recordResult, parseResult, hashResult, EXPERIENCES };
