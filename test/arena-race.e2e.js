// test/arena-race.e2e.js — Freelandoo Arena, resultado do Jetpack Race (M14,
// mig 289), pela HTTP DE VERDADE contra um Postgres de TESTE.
//
//   npm run test:arena-race
//
// Exercita: assinatura do canal, CHECK de fato como superset, gravação do
// resultado com empate e DNF, fato `race_finished` só para quem cruzou,
// idempotência por resultId (reenvio e reenvios CONCORRENTES), conflito (mesmo
// id com outro conteúdo; outra id na mesma partida), validação (colocação
// incoerente, campo extra, experiência e participante desconhecidos sem
// escrever nada) e a missão `race-daily` (50 XP, uma vez por dia).

const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");

const DB_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";
if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = `arena-race-${crypto.randomBytes(16).toString("hex")}`;
process.env.ARENA_SERVICE_SECRET = `svc-${crypto.randomBytes(24).toString("hex")}`;
process.env.DATABASE_URL_COLD = "";

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}
const eq = (a, b, msg) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: esperado ${JSON.stringify(b)}, veio ${JSON.stringify(a)}`);
};
const ok = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function main() {
  console.log("━━━ migrations (banco de teste) ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

  const bcrypt = require("bcrypt");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const { sign: signSvc, sha256Hex } = require("../src/middlewares/arenaServiceAuth");
  const { syncMissions } = require("../src/services/ArenaMissionSync");
  const missionsDoc = require("../src/databases/seeds/arena-missions.json");

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const URL_RESULTS = "/arena/internal/minigames/results";

  const post = async (body, { service = true } = {}) => {
    const headers = { Accept: "application/json", "Content-Type": "application/json" };
    const raw = JSON.stringify(body);
    if (service) {
      const ts = String(Date.now());
      const nonce = crypto.randomBytes(18).toString("base64url");
      headers["X-Arena-Service-Timestamp"] = ts;
      headers["X-Arena-Service-Nonce"] = nonce;
      headers["X-Arena-Service-Signature"] = signSvc(process.env.ARENA_SERVICE_SECRET, { method: "POST", url: URL_RESULTS, ts, nonce, bodyHash: sha256Hex(Buffer.from(raw)) });
    }
    const res = await fetch(base + URL_RESULTS, { method: "POST", headers, body: raw });
    let json = null;
    try {
      json = await res.json();
    } catch {
      /* vazio */
    }
    return { status: res.status, body: json };
  };

  // ─── fixtures ────────────────────────────────────────────────────────────
  const stamp = Date.now().toString(36);
  const hash = await bcrypt.hash("senha-de-teste-123", 4);
  const users = [];
  for (let i = 0; i < 5; i++) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo) VALUES ($1, $2, $3, $4, TRUE) RETURNING id_user`,
      [`Race ${i}`, `race${i}${stamp}`.slice(0, 30), `arena.race.${i}.${stamp}@teste.invalid`, hash]
    );
    const id = r.rows[0].id_user;
    const playerId = `pl_race${stamp}${i}`.replace(/[^A-Za-z0-9_]/g, "0").padEnd(13, "0").slice(0, 35);
    await pool.query(`INSERT INTO public.tb_arena_player (id_user, player_id) VALUES ($1, $2)`, [id, playerId]);
    users.push({ id, playerId });
  }
  const syncClient = await pool.connect();
  const synced = await syncMissions(syncClient, missionsDoc, { apply: true });
  syncClient.release();
  ok(synced.ok, `sync das missões: ${JSON.stringify(synced.errors)}`);

  const now = Date.now();
  const mkResult = (over = {}) => ({
    resultId: crypto.randomUUID(),
    matchId: crypto.randomUUID(),
    experienceId: "jetpack-race",
    experienceVersion: 1,
    rulesVersion: 1,
    environmentId: "br-sp",
    portalId: "q1-l0-e0",
    track: { seed: 12345, version: 1, hash: "a1b2c3d4e5f60718" },
    startedAt: new Date(now - 60_000).toISOString(),
    finishedAt: new Date(now).toISOString(),
    // Empate no 1º lugar (mesmo instante), 3º lugar, e um DNF.
    standings: [
      { playerId: users[0].playerId, slot: 0, outcome: "finished", place: 1, timeMs: 41_250 },
      { playerId: users[1].playerId, slot: 1, outcome: "finished", place: 1, timeMs: 41_250 },
      { playerId: users[2].playerId, slot: 2, outcome: "finished", place: 3, timeMs: 44_900 },
      { playerId: users[3].playerId, slot: 3, outcome: "dnf", place: null, timeMs: null },
    ],
    ...over,
  });
  const facts = async (id) => (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE id_user = $1 AND fact_type = 'race_finished'`, [id])).rows[0].n;
  const xp = async (id) => (await pool.query(`SELECT COALESCE(SUM(xp),0)::int AS n FROM public.tb_arena_xp_grant WHERE id_user = $1 AND mission_key = 'race-daily'`, [id])).rows[0].n;

  console.log("━━━ schema ━━━");
  await check("CHECK de fato é superset: race_finished aceito, tipo inventado recusado, um só CHECK", async () => {
    const defs = (await pool.query(
      `SELECT pg_get_constraintdef(c.oid) AS def FROM pg_constraint c WHERE c.conrelid = 'public.tb_arena_fact'::regclass AND c.contype = 'c' AND pg_get_constraintdef(c.oid) LIKE '%fact_type%'`
    )).rows;
    eq(defs.length, 1, "CHECKs de fact_type");
    ok(/race_finished/.test(defs[0].def) && /checkpoint_accepted/.test(defs[0].def) && /video_completed/.test(defs[0].def), defs[0].def);
    let refused = null;
    try {
      await pool.query(`INSERT INTO public.tb_arena_fact (id_user, fact_type, source_ref, occurred_at) VALUES ($1, 'race_bogus', 'x', NOW())`, [users[4].id]);
    } catch (e) {
      refused = e.constraint;
    }
    eq(refused, "chk_arena_fact_type", "constraint que recusou");
    const mdef = (await pool.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'chk_arena_mission_fact'`)).rows;
    ok(mdef.length === 1 && /race_finished/.test(mdef[0].def), "chk_arena_mission_fact");
  });

  console.log("━━━ canal ━━━");
  await check("sem assinatura do serviço é recusado e nada é gravado", async () => {
    const body = mkResult();
    const r = await post(body, { service: false });
    ok(r.status === 401 || r.status === 503, `status ${r.status}`);
    eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_minigame_match WHERE result_id = $1`, [body.resultId])).rows[0].n, 0, "linhas");
  });

  console.log("━━━ gravação e idempotência ━━━");
  const first = mkResult();
  await check("resultado com empate e DNF é gravado; 4 colocações", async () => {
    const r = await post(first);
    eq([r.status, r.body?.result], [200, "recorded"], JSON.stringify(r.body));
    const rows = (await pool.query(`SELECT slot, outcome, place, time_ms FROM public.tb_arena_minigame_result WHERE result_id = $1 ORDER BY slot`, [first.resultId])).rows;
    eq(rows.map((x) => [x.slot, x.outcome, x.place, x.time_ms]), [[0, "finished", 1, 41250], [1, "finished", 1, 41250], [2, "finished", 3, 44900], [3, "dnf", null, null]], "colocações");
  });
  await check("fato race_finished só para quem cruzou a chegada (DNF não)", async () => {
    eq([await facts(users[0].id), await facts(users[1].id), await facts(users[2].id), await facts(users[3].id)], [1, 1, 1, 0], "fatos");
  });
  await check("missão race-daily: 50 XP para quem chegou, nada para o DNF", async () => {
    eq([await xp(users[0].id), await xp(users[1].id), await xp(users[2].id), await xp(users[3].id)], [50, 50, 50, 0], "XP");
  });
  await check("reenvio idêntico → already_recorded, sem fato nem XP novos", async () => {
    const r = await post(first);
    eq([r.status, r.body?.result], [200, "already_recorded"], JSON.stringify(r.body));
    eq(await facts(users[0].id), 1, "fatos");
    eq(await xp(users[0].id), 50, "XP");
  });
  await check("mesmo resultId com conteúdo diferente → 409 (nunca atualiza)", async () => {
    const forged = { ...first, standings: first.standings.map((s) => (s.slot === 2 ? { ...s, timeMs: 44_000 } : s)) };
    const r = await post(forged);
    eq([r.status, r.body?.code], [409, "result_conflict"], JSON.stringify(r.body));
    const t = (await pool.query(`SELECT time_ms FROM public.tb_arena_minigame_result WHERE result_id = $1 AND slot = 2`, [first.resultId])).rows[0].time_ms;
    eq(t, 44900, "tempo preservado");
  });
  await check("outro resultId para a MESMA partida → 409", async () => {
    const r = await post({ ...first, resultId: crypto.randomUUID() });
    eq([r.status, r.body?.code], [409, "result_conflict"], JSON.stringify(r.body));
  });
  await check("segunda corrida no mesmo dia: grava, gera fato, mas não paga a missão de novo", async () => {
    const r = await post(mkResult({ standings: [{ playerId: users[0].playerId, slot: 0, outcome: "finished", place: 1, timeMs: 40_000 }] }));
    eq(r.body?.result, "recorded", JSON.stringify(r.body));
    eq(await facts(users[0].id), 2, "fatos");
    eq(await xp(users[0].id), 50, "XP (uma vez por dia)");
  });
  await check("6 reenvios CONCORRENTES do mesmo resultado: 1 recorded, 5 already_recorded, 1 fato", async () => {
    const body = mkResult({ standings: [{ playerId: users[4].playerId, slot: 0, outcome: "finished", place: 1, timeMs: 50_000 }] });
    const rs = await Promise.all(Array.from({ length: 6 }, () => post(body)));
    const by = rs.map((r) => r.body?.result).sort();
    eq(by, ["already_recorded", "already_recorded", "already_recorded", "already_recorded", "already_recorded", "recorded"], JSON.stringify(rs.map((r) => [r.status, r.body])));
    eq(await facts(users[4].id), 1, "fatos");
  });

  console.log("━━━ validação (nada gravado) ━━━");
  const nothingWritten = async (body) =>
    eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_minigame_match WHERE result_id = $1 OR match_id = $2`, [body.resultId, body.matchId])).rows[0].n, 0, "nada gravado");
  await check("colocação incoerente com o tempo → 400", async () => {
    const body = mkResult({
      standings: [
        { playerId: users[0].playerId, slot: 0, outcome: "finished", place: 2, timeMs: 41_000 },
        { playerId: users[1].playerId, slot: 1, outcome: "finished", place: 1, timeMs: 42_000 },
      ],
    });
    eq((await post(body)).status, 400, "status");
    await nothingWritten(body);
  });
  await check("DNF com tempo, slot repetido, campo extra → 400", async () => {
    const a = mkResult({ standings: [{ playerId: users[0].playerId, slot: 0, outcome: "dnf", place: null, timeMs: 5 }] });
    const b = mkResult({ standings: [{ playerId: users[0].playerId, slot: 0, outcome: "dnf", place: null, timeMs: null }, { playerId: users[1].playerId, slot: 0, outcome: "dnf", place: null, timeMs: null }] });
    const c = { ...mkResult(), id_user: users[0].id };
    for (const x of [a, b, c]) eq((await post(x)).status, 400, JSON.stringify(x.standings ?? "extra"));
  });
  await check("experiência desconhecida → 422; participante desconhecido → 422 sem escrever nada", async () => {
    const a = mkResult({ experienceId: "kart-race" });
    eq((await post(a)).status, 422, "experiência");
    const b = mkResult({ standings: [{ playerId: "pl_ninguem0000000", slot: 0, outcome: "finished", place: 1, timeMs: 30_000 }] });
    const r = await post(b);
    eq([r.status, r.body?.code], [422, "unknown_player"], JSON.stringify(r.body));
    await nothingWritten(b);
  });
  await check("prazo absurdo (fim antes do início) → 400", async () => {
    const body = mkResult({ finishedAt: new Date(now - 120_000).toISOString() });
    eq((await post(body)).status, 400, "status");
  });

  server.close();
  await pool.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} ok`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
