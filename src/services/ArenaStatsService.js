// Freelandoo Arena — estatísticas e mapas de calor (Módulo 08).
//
// Toda métrica é PROJEÇÃO de fonte canônica (ver utils/arenaMetrics): o
// placar continua sendo do M07 (fatos + apuração) e nada aqui escreve nele.
// Cada bucket da resposta diz o seu ESTADO, para a interface nunca desenhar
// ausência como zero:
//   final         — período encerrado, coberto
//   partial       — período em curso, ou coleta incompleta (coverage < 1)
//   no_data       — antes do início da coleta/registro (não é zero)
//   unavailable   — deveria haver dado e não há (consolidação perdida)
//   suppressed    — grupo pequeno (camada "people"); valor nulo
//
// Respostas são agregadas e PÚBLICAS (sem identidade): podem ficar em cache
// curto, inclusive na borda. Nenhuma linha leva id_user ou playerId.

const pool = require("../databases");
const S = require("../storages/ArenaStatsStorage");
const M = require("../utils/arenaMetrics");

const ENV_ID = /^br-[a-z]{2}$/;
const CATEGORY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const fail = (status, code, error) => ({ status, body: { error, code } });
const ok = (body) => ({ status: 200, body });
const iso = (d) => new Date(d).toISOString();
const key = (d) => new Date(d).getTime();

// ─── cache curto em memória (resposta pública, por URL) ─────────────────────
const CACHE_MS = 30_000;
const CACHE_MAX = 400;
const cache = new Map();
async function cached(k, fn) {
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = await fn();
  if (value.status === 200) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(k, { at: Date.now(), value });
  }
  return value;
}
function clearCache() {
  cache.clear();
}

function bucketsOf(range) {
  const out = [];
  for (let t = range.from.getTime(); t < range.to.getTime(); t += range.stepMs) out.push(t);
  return out;
}

async function resolveFilters(query, { allowCategory = true } = {}) {
  const env = query?.environmentId ? String(query.environmentId) : null;
  if (env !== null && !ENV_ID.test(env)) return { err: fail(400, "invalid_input", "environmentId") };
  let category = null;
  if (query?.categoryId) {
    if (!allowCategory) return { err: fail(400, "invalid_input", "categoryId não se aplica a esta métrica") };
    category = String(query.categoryId);
    if (!CATEGORY.test(category) || category.length > 32) return { err: fail(400, "invalid_input", "categoryId") };
    const cat = await S.category(pool, category);
    if (!cat) return { err: fail(404, "unknown_category", "Categoria não existe") };
    // Categoria sensível (Política) não tem estatística pública: a coleta
    // dela segue fechada (M05) e este módulo não a abre.
    if (cat.is_sensitive) return { err: fail(422, "sensitive_category", "Categoria sem estatística pública") };
  }
  return { env, category };
}

/** Estado temporal comum: no_data antes do início; partial no bucket em curso. */
function timeState(bucketStart, stepMs, now, since) {
  if (!since || bucketStart + stepMs <= key(since)) return "no_data";
  if (bucketStart + stepMs > key(now)) return "partial";
  return "final";
}

// ─── META ───────────────────────────────────────────────────────────────────

async function meta() {
  return cached("meta", async () => {
    const [clock, starts] = await Promise.all([S.clock(pool), S.coverageStarts(pool)]);
    return ok({
      version: 1,
      timezone: "UTC",
      serverTime: iso(clock.now),
      currentHour: iso(clock.hour_start),
      minCohort: M.MIN_COHORT,
      minCellPlayerMinutes: M.MIN_CELL_PLAYER_MINUTES,
      limits: { hour: { maxBuckets: M.LIMITS.hour.maxBuckets }, day: { maxBuckets: M.LIMITS.day.maxBuckets } },
      collection: {
        presenceSince: starts.presence_since ? iso(starts.presence_since) : null,
        checkpointsSince: starts.posts_since ? iso(starts.posts_since) : null,
      },
      metrics: M.METRICS,
    });
  });
}

// ─── SÉRIES ─────────────────────────────────────────────────────────────────

async function series(query) {
  const metric = String(query?.metric || "");
  if (!M.SERIES_METRICS.has(metric)) return fail(400, "invalid_input", "metric");
  const gran = String(query?.granularity || "");
  const range = M.parseRange(query, gran);
  if (range.error) return fail(400, "invalid_input", range.error);
  const f = await resolveFilters(query, { allowCategory: metric === "checkpoints" || metric === "participants" });
  if (f.err) return f.err;
  // Pessoas por UF só em dia: por hora, a mesma UF seria recuperável pela
  // diferença entre o dia e as outras horas.
  if (M.PEOPLE.has(metric) && f.env && gran !== "day") {
    return fail(400, "granularity_not_allowed", "Métrica de pessoas por ambiente só existe por dia");
  }
  const k = `series|${metric}|${gran}|${key(range.from)}|${key(range.to)}|${f.env || ""}|${f.category || ""}`;
  return cached(k, () => buildSeries(metric, gran, range, f));
}

async function buildSeries(metric, gran, range, f) {
  const [clock, starts] = await Promise.all([S.clock(pool), S.coverageStarts(pool)]);
  const now = clock.now;
  const def = M.METRICS.find((m) => m.key === metric);
  const buckets = bucketsOf(range);
  const out = [];
  let anonymized = 0;

  if (metric === "checkpoints") {
    const rows = await S.checkpointCounts(pool, { gran, from: range.from, to: range.to, env: f.env, category: f.category });
    const by = new Map();
    for (const r of rows) by.set(key(r.bucket), (by.get(key(r.bucket)) || 0) + r.n);
    for (const b of buckets) {
      const st = timeState(b, range.stepMs, now, starts.posts_since);
      out.push({ start: iso(b), state: st, value: st === "no_data" ? null : by.get(b) || 0, coverage: null });
    }
  } else if (metric === "participants") {
    const rows = await S.participants(pool, { gran, from: range.from, to: range.to, category: f.category });
    const cells = new Map(); // bucket -> Map(env -> n)
    for (const r of rows) {
      const m = cells.get(key(r.bucket)) ?? new Map();
      m.set(r.env, r.n);
      cells.set(key(r.bucket), m);
      if (r.env === "*") anonymized += r.anon;
    }
    for (const b of buckets) {
      const st = timeState(b, range.stepMs, now, starts.posts_since);
      if (st === "no_data") {
        out.push({ start: iso(b), state: st, value: null, coverage: null });
        continue;
      }
      const m = cells.get(b) ?? new Map();
      const envCells = new Map([...m].filter(([e]) => e !== "*"));
      const suppressed = M.suppressCells(envCells);
      const target = f.env ?? "*";
      const v = m.get(target) || 0;
      const hide = f.env ? suppressed.has(target) : v > 0 && v < M.MIN_COHORT;
      out.push({ start: iso(b), state: hide ? "suppressed" : st, value: hide ? null : v, coverage: null });
    }
  } else if (metric === "active_players") {
    const target = f.env ?? "*";
    const [done, live] = await Promise.all([
      S.uniques(pool, { gran, from: range.from, to: range.to }),
      S.liveUniques(pool, { gran, from: range.from, to: range.to }),
    ]);
    const covered = await S.coveredMinutes(pool, { gran, from: range.from, to: range.to });
    const cov = new Map(covered.map((r) => [key(r.bucket), r.minutes]));
    const byDone = new Map();
    for (const r of done) {
      const m = byDone.get(key(r.bucket)) ?? new Map();
      m.set(r.env, r.n);
      byDone.set(key(r.bucket), m);
    }
    const byLive = new Map();
    for (const r of live) {
      const m = byLive.get(key(r.bucket)) ?? new Map();
      m.set(r.env, r.n);
      byLive.set(key(r.bucket), m);
    }
    const minutesIn = range.stepMs / 60_000;
    for (const b of buckets) {
      const st = timeState(b, range.stepMs, now, starts.presence_since);
      const covMin = cov.get(b) || 0;
      if (st === "no_data" || covMin === 0) {
        out.push({ start: iso(b), state: st === "no_data" ? "no_data" : b + range.stepMs > key(now) ? "partial" : "no_data", value: null, coverage: 0 });
        continue;
      }
      const finalized = byDone.get(b);
      const source = finalized && finalized.has("*") ? finalized : byLive.get(b);
      if (!source && st === "final") {
        out.push({ start: iso(b), state: "unavailable", value: null, coverage: covMin / minutesIn });
        continue;
      }
      const m = source ?? new Map();
      const envCells = new Map([...m].filter(([e]) => e !== "*"));
      const suppressed = M.suppressCells(envCells);
      const v = m.get(target) || 0;
      const hide = f.env ? suppressed.has(target) : v > 0 && v < M.MIN_COHORT;
      const coverage = Math.min(1, covMin / (b + range.stepMs > key(now) ? Math.max(1, (key(now) - b) / 60_000) : minutesIn));
      const state = hide ? "suppressed" : finalized && finalized.has("*") && coverage >= 0.999 ? "final" : "partial";
      out.push({ start: iso(b), state, value: hide ? null : v, coverage: round(coverage, 3) });
    }
  } else {
    // online_avg / online_peak / resident_avg
    const [rows, covered] = await Promise.all([
      S.presenceByBucket(pool, { gran, from: range.from, to: range.to }),
      S.coveredMinutes(pool, { gran, from: range.from, to: range.to }),
    ]);
    const cov = new Map(covered.map((r) => [key(r.bucket), r.minutes]));
    const by = new Map();
    for (const r of rows) {
      const m = by.get(key(r.bucket)) ?? new Map();
      m.set(r.env, r);
      by.set(key(r.bucket), m);
    }
    const value = (r, minutes) => {
      if (!r) return 0;
      if (metric === "online_peak") return r.ctl_peak;
      const sum = Number(metric === "online_avg" ? r.ctl_sum : r.res_sum);
      return round(sum / minutes, 1);
    };
    // Supressão: por UF dentro do bucket; nacional por hora com complemento
    // dentro do dia (a média do dia recuperaria a hora oculta).
    const nationalHour = !f.env && gran === "hour";
    const nationalVals = new Map();
    for (const b of buckets) {
      const minutes = cov.get(b) || 0;
      if (minutes) nationalVals.set(b, value(by.get(b)?.get("*"), minutes));
    }
    const hiddenHours = new Set();
    if (nationalHour) {
      const byDay = new Map();
      for (const [b, v] of nationalVals) {
        const d = Math.floor(b / DAY) * DAY;
        const m = byDay.get(d) ?? new Map();
        m.set(b, v);
        byDay.set(d, m);
      }
      for (const m of byDay.values()) for (const h of M.suppressCells(m)) hiddenHours.add(h);
    }
    const minutesIn = range.stepMs / 60_000;
    for (const b of buckets) {
      const st = timeState(b, range.stepMs, now, starts.presence_since);
      const minutes = cov.get(b) || 0;
      if (st === "no_data" || minutes === 0) {
        out.push({ start: iso(b), state: st === "partial" ? "partial" : "no_data", value: null, coverage: 0 });
        continue;
      }
      const m = by.get(b) ?? new Map();
      let hide;
      let v;
      if (f.env) {
        const envCells = new Map();
        for (const [e, r] of m) if (e !== "*") envCells.set(e, value(r, minutes));
        v = value(m.get(f.env), minutes);
        hide = M.suppressCells(envCells).has(f.env);
      } else {
        v = nationalVals.get(b) ?? 0;
        hide = nationalHour ? hiddenHours.has(b) : v > 0 && v < M.MIN_COHORT;
      }
      const elapsed = b + range.stepMs > key(now) ? Math.max(1, (key(now) - b) / 60_000) : minutesIn;
      const coverage = Math.min(1, minutes / elapsed);
      const state = hide ? "suppressed" : st === "final" && coverage >= 0.999 ? "final" : "partial";
      out.push({ start: iso(b), state, value: hide ? null : v, coverage: round(coverage, 3) });
    }
  }

  return ok({
    metric,
    unit: def.unit,
    additive: def.additive,
    tier: def.tier,
    granularity: gran,
    from: iso(range.from),
    to: iso(range.to),
    environmentId: f.env,
    categoryId: f.category,
    serverTime: iso(now),
    anonymizedFacts: metric === "participants" ? anonymized : undefined,
    buckets: out,
  });
}

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

// ─── RANKING ────────────────────────────────────────────────────────────────

async function ranking(query) {
  const metric = String(query?.metric || "");
  if (!["checkpoints", "hourly_wins", "leading_now"].includes(metric)) return fail(400, "invalid_input", "metric");
  if (!query?.categoryId) return fail(400, "invalid_input", "categoryId é obrigatório (equipes são por categoria)");
  const f = await resolveFilters(query);
  if (f.err) return f.err;
  let range = null;
  if (metric !== "leading_now") {
    range = M.parseRange(query, String(query?.granularity || "day"));
    if (range.error) return fail(400, "invalid_input", range.error);
  }
  const k = `rank|${metric}|${range ? `${key(range.from)}|${key(range.to)}` : "now"}|${f.env || ""}|${f.category}`;
  return cached(k, async () => {
    const clock = await S.clock(pool);
    let rows = [];
    let ties = null;
    let neutral = null;
    let late = null;
    if (metric === "checkpoints") {
      rows = await S.checkpointsByTeam(pool, { from: range.from, to: range.to, env: f.env, category: f.category });
    } else {
      const raw =
        metric === "hourly_wins"
          ? await S.winsByTeam(pool, { from: range.from, to: range.to, env: f.env, category: f.category })
          : await S.leadingNow(pool, { env: f.env, category: f.category });
      rows = raw.filter((r) => r.status === "leader").map((r) => ({ team_id: r.team_id, n: r.n }));
      ties = raw.filter((r) => r.status === "tie").reduce((a, r) => a + r.n, 0);
      neutral = raw.filter((r) => r.status === "neutral").reduce((a, r) => a + r.n, 0);
      if (metric === "hourly_wins") late = await S.lateWindows(pool, { from: range.from, to: range.to, env: f.env, category: f.category });
    }
    // Ordenação técnica, documentada: valor desc; empate de VALOR ordena pelo
    // id da equipe. Isso não é desempate competitivo nem vitória.
    rows.sort((a, b) => b.n - a.n || String(a.team_id).localeCompare(String(b.team_id)));
    return ok({
      metric,
      categoryId: f.category,
      environmentId: f.env,
      from: range ? iso(range.from) : null,
      to: range ? iso(range.to) : null,
      window: metric === "leading_now" ? { startsAt: iso(clock.hour_start), endsAt: iso(key(clock.hour_start) + HOUR), partial: true } : null,
      serverTime: iso(clock.now),
      order: "value_desc_then_team_id",
      rows: rows.map((r, i) => ({ position: i + 1, teamId: r.team_id, value: r.n })),
      ties,
      neutral,
      lateWindows: late,
    });
  });
}

// ─── POR AMBIENTE (visão nacional das 27 UFs) ────────────────────────────────

async function environments(query) {
  const metric = String(query?.metric || "");
  if (!["checkpoints", "participants", "online_avg", "active_players"].includes(metric)) return fail(400, "invalid_input", "metric");
  const gran = String(query?.granularity || "day");
  const range = M.parseRange(query, gran);
  if (range.error) return fail(400, "invalid_input", range.error);
  const f = await resolveFilters(query, { allowCategory: metric === "checkpoints" || metric === "participants" });
  if (f.err) return f.err;
  if (f.env) return fail(400, "invalid_input", "environmentId não se aplica (a resposta é por ambiente)");
  if (metric === "active_players" && range.buckets !== 1) {
    // Únicos não se somam: ativos por UF só para UM bucket.
    return fail(400, "not_additive", "Ativos por ambiente só para um único bucket (únicos não se somam)");
  }
  const k = `envs|${metric}|${gran}|${key(range.from)}|${key(range.to)}|${f.category || ""}`;
  return cached(k, async () => {
    const [clock, starts] = await Promise.all([S.clock(pool), S.coverageStarts(pool)]);
    const values = new Map();
    let national = null;
    let coverage = null;
    let anonymized;
    const since = metric === "checkpoints" || metric === "participants" ? starts.posts_since : starts.presence_since;
    if (!since || key(since) >= key(range.to)) {
      return ok({ metric, from: iso(range.from), to: iso(range.to), state: "no_data", national: null, environments: [], serverTime: iso(clock.now) });
    }
    if (metric === "checkpoints") {
      const rows = await S.checkpointCounts(pool, { gran, from: range.from, to: range.to, env: null, category: f.category });
      for (const r of rows) values.set(r.env, (values.get(r.env) || 0) + r.n);
      national = [...values.values()].reduce((a, b) => a + b, 0);
    } else if (metric === "participants") {
      const rows = await S.participantsOverRange(pool, { from: range.from, to: range.to, category: f.category });
      for (const r of rows) {
        if (r.env === "*") {
          national = r.n;
          anonymized = r.anon;
        } else values.set(r.env, r.n);
      }
    } else if (metric === "online_avg") {
      const [rows, covered] = await Promise.all([
        S.presenceByBucket(pool, { gran, from: range.from, to: range.to }),
        S.coveredMinutes(pool, { gran, from: range.from, to: range.to }),
      ]);
      const minutes = covered.reduce((a, r) => a + r.minutes, 0);
      const sums = new Map();
      for (const r of rows) sums.set(r.env, (sums.get(r.env) || 0) + Number(r.ctl_sum));
      if (minutes) {
        for (const [e, s] of sums) if (e !== "*") values.set(e, round(s / minutes, 1));
        national = round((sums.get("*") || 0) / minutes, 1);
      }
      const elapsed = Math.max(1, (Math.min(key(range.to), key(clock.now)) - key(range.from)) / 60_000);
      coverage = round(Math.min(1, minutes / elapsed), 3);
    } else {
      const [done, live] = await Promise.all([
        S.uniques(pool, { gran, from: range.from, to: range.to }),
        S.liveUniques(pool, { gran, from: range.from, to: range.to }),
      ]);
      const finalized = done.some((r) => r.env === "*");
      for (const r of finalized ? done : live) {
        if (r.env === "*") national = r.n;
        else values.set(r.env, r.n);
      }
    }
    const people = M.PEOPLE.has(metric);
    const hidden = people ? M.suppressCells(values) : new Set();
    const nationalHidden = people && national !== null && national > 0 && national < M.MIN_COHORT;
    return ok({
      metric,
      granularity: gran,
      from: iso(range.from),
      to: iso(range.to),
      partial: key(range.to) > key(clock.now),
      coverage,
      serverTime: iso(clock.now),
      anonymizedFacts: anonymized,
      national: nationalHidden ? { value: null, state: "suppressed" } : { value: national ?? 0, state: "ok" },
      // Ambiente sem linha = 0 (houve coleta e ninguém); a interface lista as 27.
      environments: [...values.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([environmentId, v]) => (hidden.has(environmentId) ? { environmentId, value: null, state: "suppressed" } : { environmentId, value: v, state: "ok" })),
    });
  });
}

// ─── MAPA DE CALOR ──────────────────────────────────────────────────────────

async function heatmap(query) {
  const mode = String(query?.mode || "");
  if (!["checkpoints", "dispute", "presence"].includes(mode)) return fail(400, "invalid_input", "mode");
  if (!query?.environmentId) return fail(400, "invalid_input", "environmentId é obrigatório (o mapa é de um ambiente)");
  const f = await resolveFilters(query, { allowCategory: mode !== "presence" });
  if (f.err) return f.err;
  const range = M.parseRange(query, "day");
  if (range.error) return fail(400, "invalid_input", range.error);
  const k = `heat|${mode}|${key(range.from)}|${key(range.to)}|${f.env}|${f.category || ""}`;
  return cached(k, async () => {
    const [clock, starts] = await Promise.all([S.clock(pool), S.coverageStarts(pool)]);
    const base = { mode, environmentId: f.env, categoryId: f.category, from: iso(range.from), to: iso(range.to), serverTime: iso(clock.now), partial: key(range.to) > key(clock.now) };
    if (mode === "presence") {
      if (!starts.presence_since || key(starts.presence_since) >= key(range.to)) return ok({ ...base, state: "no_data", unit: "jogadores (média)", cells: [] });
      const [rows, covered] = await Promise.all([
        S.presenceHeat(pool, { from: range.from, to: range.to, env: f.env }),
        S.coveredMinutes(pool, { gran: "day", from: range.from, to: range.to }),
      ]);
      const minutes = covered.reduce((a, r) => a + r.minutes, 0);
      const pm = new Map(rows.map((r) => [r.chunk_index, Number(r.player_minutes)]));
      const hidden = M.suppressCells(pm, M.MIN_CELL_PLAYER_MINUTES);
      return ok({
        ...base,
        state: "ok",
        unit: "jogadores (média por minuto coberto)",
        chunkM: 32,
        coveredMinutes: minutes,
        cells: [...pm.entries()]
          .sort((a, b) => a[0] - b[0])
          .slice(0, 4000)
          .map(([chunk, v]) => (hidden.has(chunk) ? { chunk, value: null, state: "suppressed" } : { chunk, value: minutes ? round(v / minutes, 2) : 0, state: "ok" })),
      });
    }
    if (!starts.posts_since || key(starts.posts_since) >= key(range.to)) return ok({ ...base, state: "no_data", cells: [], unplaced: 0 });
    if (mode === "checkpoints") {
      const rows = await S.checkpointHeat(pool, { from: range.from, to: range.to, env: f.env, category: f.category });
      const placed = rows.filter((r) => r.x !== null && r.y !== null);
      const unplaced = rows.filter((r) => r.x === null || r.y === null).reduce((a, r) => a + r.n, 0);
      return ok({
        ...base,
        state: "ok",
        unit: "checkpoints aceitos",
        unplaced,
        cells: placed.slice(0, 2000).map((r) => ({ postId: r.post_id, x: r.x, y: r.y, mapVersion: r.map_version, value: r.n })),
      });
    }
    const rows = await S.disputeHeat(pool, { from: range.from, to: range.to, env: f.env, category: f.category });
    const placed = rows.filter((r) => r.x !== null && r.y !== null);
    const unplaced = rows.filter((r) => r.x === null || r.y === null).reduce((a, r) => a + r.contested + r.ties + r.decided, 0);
    return ok({
      ...base,
      state: "ok",
      unit: "apurações disputadas (2+ equipes)",
      unplaced,
      cells: placed.slice(0, 2000).map((r) => ({ postId: r.post_id, x: r.x, y: r.y, mapVersion: r.map_version, value: r.contested, ties: r.ties, decided: r.decided })),
    });
  });
}

// ─── PREFERÊNCIA DECLARADA (agregada, nacional, estado atual) ────────────────

async function preferences(query) {
  if (!query?.categoryId) return fail(400, "invalid_input", "categoryId é obrigatório");
  if (query?.environmentId) return fail(400, "invalid_input", "Preferência não é da UF: só nacional");
  const f = await resolveFilters(query);
  if (f.err) return f.err;
  return cached(`prefs|${f.category}`, async () => {
    const clock = await S.clock(pool);
    const rows = await S.preferenceCounts(pool, { category: f.category, includeSynthetic: process.env.NODE_ENV !== "production" });
    const cells = new Map(rows.map((r) => [r.team_id, r.n]));
    // Sem total publicado: só a supressão primária (não há do que subtrair).
    const hidden = M.suppressCells(cells, M.MIN_COHORT, { complement: false });
    return ok({
      categoryId: f.category,
      serverTime: iso(clock.now),
      snapshot: true,
      order: "value_desc_then_team_id",
      // Sem total: o total menos as equipes visíveis revelaria as ocultas.
      rows: [...cells.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([teamId, v]) => (hidden.has(teamId) ? { teamId, value: null, state: "suppressed" } : { teamId, value: v, state: "ok" })),
    });
  });
}

module.exports = { meta, series, ranking, environments, heatmap, preferences, clearCache, timeState };
