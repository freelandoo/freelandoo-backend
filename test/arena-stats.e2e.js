// test/arena-stats.e2e.js — Módulo 08 da Arena (estatísticas e mapas de
// calor), pela HTTP de verdade contra um Postgres de TESTE.
//
//   npm run test:arena-stats
//
// Fatos CONHECIDOS → agregados esperados. Cobre: dicionário, estados de bucket
// (sem dado ≠ zero, hora atual parcial, consolidação perdida), fronteiras UTC,
// período desalinhado/longo, categoria sensível fechada, participantes únicos
// não somados (nacional ≠ soma das UFs), anonimização sem precisão falsa,
// supressão de grupo pequeno + complementar, ranking com empate à parte e
// atrasadas, liderança atual parcial, geometria HISTÓRICA no mapa (poste que
// mudou), presença (abas/shards/instâncias, away ≠ ativo, retry, cobertura,
// consolidação idempotente), preferência agregada só nacional e o custo SQL
// num volume representativo.

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
process.env.JWT_SECRET = `arena-stats-${crypto.randomBytes(16).toString("hex")}`;
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

const HOUR = 3_600_000;
const DAY = 86_400_000;
const iso = (t) => new Date(t).toISOString();

async function main() {
  console.log("━━━ migrations (banco de teste) ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

  const bcrypt = require("bcrypt");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const { syncCatalog } = require("../src/services/ArenaCatalogSync");
  const { sign: signSvc, sha256Hex } = require("../src/middlewares/arenaServiceAuth");
  const Territory = require("../src/services/ArenaTerritoryService");
  const Presence = require("../src/services/ArenaPresenceService");
  const Stats = require("../src/services/ArenaStatsService");
  const catalogDoc = require("../src/databases/seeds/arena-catalog.json");

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async (p) => {
    const res = await fetch(base + p);
    return { status: res.status, body: await res.json().catch(() => null), cache: res.headers.get("cache-control") };
  };
  const internal = async (p, body) => {
    const raw = JSON.stringify(body);
    const ts = String(Date.now());
    const nonce = crypto.randomBytes(18).toString("base64url");
    const sig = signSvc(process.env.ARENA_SERVICE_SECRET, { method: "POST", url: p, ts, nonce, bodyHash: sha256Hex(Buffer.from(raw)) });
    const res = await fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Arena-Service-Timestamp": ts, "X-Arena-Service-Nonce": nonce, "X-Arena-Service-Signature": sig },
      body: raw,
    });
    return { status: res.status, body: await res.json().catch(() => null) };
  };

  // ─── fixtures sintéticas (ambientes br-s*, isolados) ─────────────────────
  const ENVS = ["br-sa", "br-sb", "br-sc", "br-sd"];
  // Os FATOS de território são apagados em TODOS os ambientes, não só nos br-s*:
  // as leituras nacionais somam o Brasil inteiro, e o que outra suíte deixou
  // (o test:arena-territory grava em br-zz no mesmo banco) entraria na conta.
  // Seguro porque este banco é o de teste (o guard acima recusa produção).
  for (const tbl of ["tb_arena_checkpoint", "tb_arena_territory_count", "tb_arena_territory_state", "tb_arena_territory_tally", "tb_arena_presence_sample"]) {
    await pool.query(`DELETE FROM public.${tbl}`);
  }
  await pool.query(`DELETE FROM public.tb_arena_post WHERE environment_id = ANY($1)`, [ENVS]);
  await pool.query(`DELETE FROM public.tb_arena_preference WHERE team_id LIKE 'st-%'`);
  // Presença: o teste é dono das tabelas de presença neste banco isolado.
  for (const tbl of ["tb_arena_presence_beat", "tb_arena_presence_sample", "tb_arena_presence_member", "tb_arena_presence_unique"]) {
    await pool.query(`DELETE FROM public.${tbl}`);
  }
  const c0 = await pool.connect();
  try {
    ok((await syncCatalog(c0, catalogDoc, { apply: true })).ok, "catálogo");
  } finally {
    c0.release();
  }
  for (const [c, t] of [["futebol", "st-azul"], ["futebol", "st-verde"], ["futebol", "st-roxo"], ["politica", "st-grupo"]]) {
    await pool.query(
      `INSERT INTO public.tb_arena_team (category_id, team_id, labels, is_synthetic) VALUES ($1, $2, '{"pt-BR":"Sintética"}'::jsonb, TRUE)
       ON CONFLICT (category_id, team_id) DO UPDATE SET is_active = TRUE`,
      [c, t]
    );
  }

  const nowH = Math.floor(Date.now() / HOUR) * HOUR;
  const today = Math.floor(Date.now() / DAY) * DAY;
  const T0 = nowH - 30 * HOUR; // começo da história sintética
  // Postes valem desde T0; p-move mudou de lugar 3 h atrás.
  for (const env of ENVS) {
    await pool.query(
      `INSERT INTO public.tb_arena_post (environment_id, post_id, map_version, generator_version, x, y, radius_m, competitive, valid_from)
       VALUES ($1, 's-p0-post', 1, 2, 10, -4, 2.5, TRUE, $2), ($1, 's-p1-post', 1, 2, 74, -4, 2.5, TRUE, $2)`,
      [env, iso(T0)]
    );
  }
  await pool.query(
    `INSERT INTO public.tb_arena_post (environment_id, post_id, map_version, generator_version, x, y, radius_m, competitive, valid_from)
     VALUES ('br-sa', 's-move-post', 1, 2, 100, -4, 2.5, TRUE, $1)`,
    [iso(T0)]
  );

  const stamp = Date.now().toString(36);
  const hash = await bcrypt.hash("x-x-x-x-x", 4);
  const users = [];
  for (let i = 0; i < 14; i++) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo) VALUES ($1, $2, $3, $4, TRUE) RETURNING id_user`,
      [`Stat ${i}`, `st${i}${stamp}`.slice(0, 30), `arena.stats.${i}.${stamp}@teste.invalid`, hash]
    );
    const id = r.rows[0].id_user;
    await pool.query(`INSERT INTO public.tb_arena_player (id_user, player_id) VALUES ($1, $2)`, [id, `pl_st${i}${stamp}`.padEnd(14, "0").slice(0, 30)]);
    users.push({ id, playerId: `pl_st${i}${stamp}`.padEnd(14, "0").slice(0, 30) });
  }
  const fact = (u, env, post, team, win, cat = "futebol") =>
    pool.query(
      `INSERT INTO public.tb_arena_checkpoint (id_user, environment_id, post_id, category_id, team_id, window_start, accepted_at, request_id, request_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $6::timestamptz + INTERVAL '5 minutes', $7, $8)`,
      [u.id, env, post, cat, team, iso(win), crypto.randomUUID(), "0".repeat(64)]
    );
  // Hora H1 (encerrada): br-sa p0 → 6 contas (u0..u5): azul 3, verde 3 = EMPATE.
  const H1 = nowH - 5 * HOUR;
  for (let i = 0; i < 6; i++) await fact(users[i], "br-sa", "s-p0-post", i < 3 ? "st-azul" : "st-verde", H1);
  // Hora H2 (encerrada): br-sa p1 → azul 2, verde 1 = azul LIDERA. Mesmas contas u0..u2.
  const H2 = nowH - 4 * HOUR;
  for (let i = 0; i < 3; i++) await fact(users[i], "br-sa", "s-p1-post", i < 2 ? "st-azul" : "st-verde", H2);
  // H2 também em br-sb: u0 (que já jogou em br-sa) + u6..u11 = 7 contas, verde.
  for (const i of [0, 6, 7, 8, 9, 10, 11]) await fact(users[i], "br-sb", "s-p0-post", "st-verde", H2);
  // H2 em br-sc: uma conta só (grupo pequeno).
  await fact(users[12], "br-sc", "s-p0-post", "st-azul", H2);
  // H2 em br-sd: duas contas (também pequeno).
  for (const i of [12, 13]) await fact(users[i], "br-sd", "s-p0-post", "st-roxo", H2);
  // Antes da mudança de lugar: s-move em H1 (posição antiga 100).
  await fact(users[13], "br-sa", "s-move-post", "st-roxo", H1);
  // Estados das disputas → apuração das horas encerradas (usa o sweeper real).
  await pool.query(
    `INSERT INTO public.tb_arena_territory_state (environment_id, post_id, category_id, window_start)
     SELECT DISTINCT environment_id, post_id, category_id, window_start FROM public.tb_arena_checkpoint
      WHERE environment_id = ANY($1) ON CONFLICT DO NOTHING`,
    [ENVS]
  );
  await Territory.closeEndedWindows();
  // O poste s-move muda de lugar agora (vale da hora atual): fatos antigos
  // continuam na posição antiga; a hora atual usa a nova.
  await pool.query(`UPDATE public.tb_arena_post SET x = 300, valid_from = $1 WHERE environment_id = 'br-sa' AND post_id = 's-move-post'`, [iso(nowH)]);
  await fact(users[13], "br-sa", "s-move-post", "st-roxo", nowH);
  // Hora atual em br-sa p0: azul lidera agora.
  await fact(users[1], "br-sa", "s-p0-post", "st-azul", nowH);
  await pool.query(
    `INSERT INTO public.tb_arena_territory_state (environment_id, post_id, category_id, window_start, status, leader_team_id, total)
     VALUES ('br-sa', 's-p0-post', 'futebol', $1, 'leader', 'st-azul', 1)
     ON CONFLICT (environment_id, post_id, category_id, window_start) DO UPDATE SET status = 'leader', leader_team_id = 'st-azul', total = 1`,
    [iso(nowH)]
  );
  Stats.clearCache();

  const qs = (o) => new URLSearchParams(o).toString();
  const day0 = iso(today - DAY);
  const day2 = iso(today + DAY);

  console.log("\n━━━ dicionário e contrato ━━━");
  await check("meta: dicionário com fonte, fórmula, aditividade e limites; resposta pública", async () => {
    const r = await get("/arena/stats/meta");
    eq(r.status, 200, "status");
    const keys = r.body.metrics.map((m) => m.key);
    for (const k of ["checkpoints", "participants", "online_avg", "resident_avg", "active_players", "hourly_wins", "ties", "leading_now", "preference_declared"]) ok(keys.includes(k), `falta ${k}`);
    const p = r.body.metrics.find((m) => m.key === "participants");
    eq([p.additive, p.tier], [false, "people"], "participants");
    eq(r.body.timezone, "UTC", "fuso");
    ok(/public/.test(r.cache), "cache público");
  });
  await check("período desalinhado, longo demais ou métrica desconhecida → 400", async () => {
    eq((await get(`/arena/stats/series?${qs({ metric: "checkpoints", granularity: "hour", from: iso(nowH + 60_000), to: iso(nowH + HOUR) })}`)).status, 400, "desalinhado");
    eq((await get(`/arena/stats/series?${qs({ metric: "checkpoints", granularity: "hour", from: iso(nowH - 200 * HOUR), to: iso(nowH) })}`)).status, 400, "longo");
    eq((await get(`/arena/stats/series?${qs({ metric: "pessoas", granularity: "hour", from: iso(H1), to: iso(nowH) })}`)).status, 400, "métrica");
  });
  await check("categoria sensível (Política) não tem estatística pública", async () => {
    const r = await get(`/arena/stats/series?${qs({ metric: "checkpoints", granularity: "day", from: day0, to: day2, categoryId: "politica" })}`);
    eq([r.status, r.body.code], [422, "sensitive_category"], "status");
    const k = await get(`/arena/stats/ranking?${qs({ metric: "checkpoints", categoryId: "politica", granularity: "day", from: day0, to: day2 })}`);
    eq(k.status, 422, "ranking");
  });

  console.log("\n━━━ séries ━━━");
  await check("checkpoints por hora: valores conhecidos, sem dado antes do registro, hora atual parcial", async () => {
    const r = await get(`/arena/stats/series?${qs({ metric: "checkpoints", granularity: "hour", from: iso(T0 - 2 * HOUR), to: iso(nowH + HOUR), environmentId: "br-sa" })}`);
    eq(r.status, 200, "status");
    const at = (t) => r.body.buckets.find((b) => b.start === iso(t));
    eq([at(T0 - 2 * HOUR).state, at(T0 - 2 * HOUR).value], ["no_data", null], "antes do registro");
    eq([at(H1).state, at(H1).value], ["final", 7], "H1 (6 + s-move)");
    eq(at(H2).value, 3, "H2");
    eq([at(nowH).state, at(nowH).value], ["partial", 2], "hora atual");
    eq(at(nowH - 2 * HOUR).value, 0, "hora coberta sem fatos = 0");
  });
  await check("participantes: nacional NÃO é a soma das UFs (u0 jogou em duas)", async () => {
    const nat = await get(`/arena/stats/series?${qs({ metric: "participants", granularity: "hour", from: iso(H2), to: iso(H2 + HOUR) })}`);
    // br-sa 3 + br-sb 7 + br-sc 1 + br-sd 2 = 13 linhas, mas u0 e u12 repetem → 11 contas.
    eq(nat.body.buckets[0].value, 11, "nacional");
    eq(nat.body.additive, false, "aditiva");
  });
  await check("participantes por UF exigem dia e suprimem grupo pequeno com complemento", async () => {
    const h = await get(`/arena/stats/series?${qs({ metric: "participants", granularity: "hour", from: iso(H2), to: iso(H2 + HOUR), environmentId: "br-sc" })}`);
    eq([h.status, h.body.code], [400, "granularity_not_allowed"], "hora por UF");
    const env = await get(`/arena/stats/environments?${qs({ metric: "participants", granularity: "day", from: iso(today), to: iso(today + DAY) })}`);
    const by = Object.fromEntries(env.body.environments.map((e) => [e.environmentId, e]));
    // Hoje (UTC): H1/H2 podem cair ontem se a hora atual for < 5h; o teste usa o dia de H2.
    ok(env.status === 200, "status");
    const dayOfH2 = Math.floor(H2 / DAY) * DAY;
    const env2 = await get(`/arena/stats/environments?${qs({ metric: "participants", granularity: "day", from: iso(dayOfH2), to: iso(dayOfH2 + DAY) })}`);
    const b2 = Object.fromEntries(env2.body.environments.map((e) => [e.environmentId, e]));
    eq([b2["br-sc"].state, b2["br-sd"].state], ["suppressed", "suppressed"], "pequenos ocultos");
    eq(b2["br-sb"].state, "ok", "grande visível");
    ok(b2["br-sb"].value === null || b2["br-sb"].value >= 5, "valor");
    ok(by !== null, "ok");
  });
  await check("complementar: com UMA só célula pequena, a menor visível também some", async () => {
    const M = require("../src/utils/arenaMetrics");
    const s = M.suppressCells(new Map([["a", 2], ["b", 9], ["c", 30], ["z", 0]]));
    eq([...s].sort(), ["a", "b"], "suprimidas");
    eq([...M.suppressCells(new Map([["a", 2], ["b", 3], ["c", 30]]))].sort(), ["a", "b"], "duas pequenas bastam");
    eq([...M.suppressCells(new Map([["a", 0], ["b", 40]]))], [], "zero não identifica");
  });
  await check("conta excluída: fato fica anônimo, NÃO entra no distinto e a resposta avisa", async () => {
    const before = (await get(`/arena/stats/series?${qs({ metric: "participants", granularity: "hour", from: iso(H1), to: iso(H1 + HOUR) })}`)).body;
    await pool.query(`UPDATE public.tb_arena_checkpoint SET id_user = NULL WHERE id_user = $1 AND window_start = $2`, [users[5].id, iso(H1)]);
    Stats.clearCache();
    const after = (await get(`/arena/stats/series?${qs({ metric: "participants", granularity: "hour", from: iso(H1), to: iso(H1 + HOUR) })}`)).body;
    eq(after.buckets[0].value, before.buckets[0].value - 1, "distinto");
    ok(after.anonymizedFacts >= 1, "não avisou a anonimização");
    const ck = (await get(`/arena/stats/series?${qs({ metric: "checkpoints", granularity: "hour", from: iso(H1), to: iso(H1 + HOUR), environmentId: "br-sa" })}`)).body;
    eq(ck.buckets[0].value, 7, "o fato (e o placar) continuam");
  });

  console.log("\n━━━ rankings ━━━");
  await check("vitórias horárias: empate à parte, sem meio ponto; ordem determinística", async () => {
    const r = await get(`/arena/stats/ranking?${qs({ metric: "hourly_wins", categoryId: "futebol", granularity: "hour", from: iso(H1), to: iso(H2 + HOUR) })}`);
    eq(r.status, 200, "status");
    const byTeam = Object.fromEntries(r.body.rows.map((x) => [x.teamId, x.value]));
    // H1: br-sa p0 empate; s-move roxo. H2: br-sa p1 azul; br-sb verde; br-sc azul; br-sd roxo.
    eq(byTeam, { "st-azul": 2, "st-roxo": 2, "st-verde": 1 }, "vitórias");
    eq(r.body.ties, 1, "empates");
    eq(r.body.rows.map((x) => x.teamId), ["st-azul", "st-roxo", "st-verde"], "ordem (valor, depois id)");
    eq(r.body.order, "value_desc_then_team_id", "regra visível");
  });
  await check("checkpoints por equipe no período; liderança AGORA é parcial", async () => {
    const r = await get(`/arena/stats/ranking?${qs({ metric: "checkpoints", categoryId: "futebol", granularity: "hour", from: iso(H2), to: iso(H2 + HOUR), environmentId: "br-sb" })}`);
    eq(r.body.rows, [{ position: 1, teamId: "st-verde", value: 7 }], "br-sb H2");
    const n = await get(`/arena/stats/ranking?${qs({ metric: "leading_now", categoryId: "futebol", environmentId: "br-sa" })}`);
    eq([n.body.window.partial, n.body.rows[0].teamId], [true, "st-azul"], "agora");
  });
  await check("hora encerrada ainda não apurada aparece como atrasada", async () => {
    const late = nowH - 2 * HOUR;
    await fact(users[3], "br-sd", "s-p1-post", "st-azul", late);
    await pool.query(
      `INSERT INTO public.tb_arena_territory_state (environment_id, post_id, category_id, window_start) VALUES ('br-sd', 's-p1-post', 'futebol', $1)`,
      [iso(late)]
    );
    Stats.clearCache();
    const r = await get(`/arena/stats/ranking?${qs({ metric: "hourly_wins", categoryId: "futebol", granularity: "hour", from: iso(late), to: iso(late + HOUR) })}`);
    eq([r.body.lateWindows, r.body.rows.length], [1, 0], "atrasada não vira vitória");
    await Territory.closeEndedWindows();
  });

  console.log("\n━━━ mapa de calor ━━━");
  await check("checkpoints: geometria DA HORA — fato antigo na posição antiga, hora atual na nova", async () => {
    const dayOfH1 = Math.floor(H1 / DAY) * DAY;
    const r = await get(`/arena/stats/heatmap?${qs({ mode: "checkpoints", environmentId: "br-sa", from: iso(Math.min(dayOfH1, today)), to: iso(today + DAY) })}`);
    eq(r.status, 200, `status ${JSON.stringify(r.body)}`);
    const move = r.body.cells.filter((c) => c.postId === "s-move-post").map((c) => [c.x, c.value]).sort();
    eq(move, [[100, 1], [300, 1]], "duas posições");
    eq(r.body.unplaced, 0, "nada sem posição");
  });
  await check("sem geometria histórica conhecida → fica fora do mapa (unplaced), não na posição de hoje", async () => {
    await pool.query(`UPDATE public.tb_arena_territory_tally SET post_x = NULL, post_y = NULL WHERE environment_id = 'br-sa' AND post_id = 's-move-post'`);
    Stats.clearCache();
    const dayOfH1 = Math.floor(H1 / DAY) * DAY;
    const r = await get(`/arena/stats/heatmap?${qs({ mode: "checkpoints", environmentId: "br-sa", from: iso(Math.min(dayOfH1, today)), to: iso(today + DAY) })}`);
    const move = r.body.cells.filter((c) => c.postId === "s-move-post").map((c) => c.x);
    eq(move, [300], "só a hora atual tem posição");
    eq(r.body.unplaced, 1, "o antigo ficou sem posição");
  });
  await check("disputa: apurações com 2+ equipes, empates e decididas por poste", async () => {
    const dayOfH1 = Math.floor(H1 / DAY) * DAY;
    const r = await get(`/arena/stats/heatmap?${qs({ mode: "dispute", environmentId: "br-sa", from: iso(Math.min(dayOfH1, today)), to: iso(today + DAY) })}`);
    const p0 = r.body.cells.find((c) => c.postId === "s-p0-post");
    eq([p0.value, p0.ties], [1, 1], "p0 (H1 empate com 2 equipes)");
  });

  console.log("\n━━━ presença ━━━");
  await check("ingestão exige o canal assinado", async () => {
    const res = await fetch(base + "/arena/internal/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    eq(res.status, 401, "status");
  });
  await check("abas/shards/instâncias: a mesma conta conta uma vez; away não é ativo; retry não soma", async () => {
    const p = (u, env, state, x = 40) => ({ playerId: u.playerId, environmentId: env, state, x });
    const beatA = { instanceId: "inst-a", players: [p(users[0], "br-sa", "controlling"), p(users[0], "br-sa", "away"), p(users[1], "br-sa", "away")] };
    const beatB = { instanceId: "inst-b", players: [p(users[0], "br-sa", "controlling", 70), p(users[2], "br-sa", "controlling")] };
    eq((await internal("/arena/internal/presence", beatA)).status, 202, "A");
    eq((await internal("/arena/internal/presence", beatA)).status, 202, "retry");
    eq((await internal("/arena/internal/presence", beatB)).status, 202, "B");
    const m = await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_presence_member WHERE environment_id = 'br-sa'`);
    eq(m.rows[0].n, 2, "membros (u0 e u2; u1 só away)");
    const s = await pool.query(`SELECT SUM(controlling)::int AS c, SUM(away)::int AS a FROM public.tb_arena_presence_sample WHERE environment_id = 'br-sa'`);
    eq([s.rows[0].c, s.rows[0].a], [3, 1], "amostras (inst-a: u0; inst-b: u0+u2; away: u1)");
  });
  await check("cobertura: hora sem batida = sem dado (não zero); média só sobre minutos cobertos", async () => {
    // Hora H1 com 30 minutos cobertos, 6 jogadores em cada.
    for (let m = 0; m < 30; m++) {
      const t = iso(H1 + m * 60_000);
      await pool.query(`INSERT INTO public.tb_arena_presence_beat (minute_at, instance_id) VALUES ($1, 'inst-a')`, [t]);
      await pool.query(`INSERT INTO public.tb_arena_presence_sample (minute_at, instance_id, environment_id, chunk_index, controlling, away) VALUES ($1, 'inst-a', 'br-sb', 2, 6, 1)`, [t]);
    }
    Stats.clearCache();
    const r = await get(`/arena/stats/series?${qs({ metric: "online_avg", granularity: "hour", from: iso(H1 - 2 * HOUR), to: iso(H1 + HOUR) })}`);
    const at = (t) => r.body.buckets.find((b) => b.start === iso(t));
    eq([at(H1 - HOUR).state, at(H1 - HOUR).value], ["no_data", null], "sem batida");
    eq([at(H1).value, at(H1).state, at(H1).coverage], [6, "partial", 0.5], "média e cobertura");
    const res = await get(`/arena/stats/series?${qs({ metric: "resident_avg", granularity: "hour", from: iso(H1), to: iso(H1 + HOUR) })}`);
    eq(res.body.buckets[0].value, 7, "residentes incluem away");
  });
  await check("consolidação de únicos: idempotente; hora coberta sem ninguém = 0; antes dela, ao vivo e parcial", async () => {
    // Membros de H1 (hora encerrada) para br-sb: 6 contas.
    for (const i of [6, 7, 8, 9, 10, 11]) {
      await pool.query(`INSERT INTO public.tb_arena_presence_member (hour_start, environment_id, id_user) VALUES ($1, 'br-sb', $2)`, [iso(H1), users[i].id]);
    }
    // Hora coberta sem ninguém controlando.
    await pool.query(`INSERT INTO public.tb_arena_presence_beat (minute_at, instance_id) VALUES ($1, 'inst-a')`, [iso(H2 + 60_000)]);
    Stats.clearCache();
    const live = await get(`/arena/stats/series?${qs({ metric: "active_players", granularity: "hour", from: iso(H1), to: iso(H1 + HOUR) })}`);
    eq([live.body.buckets[0].value, live.body.buckets[0].state], [6, "partial"], "ao vivo antes de consolidar");
    const r1 = await Presence.rollup();
    const r2 = await Presence.rollup();
    ok(r1.hours >= 1 && r2.hours === 0, `idempotente ${JSON.stringify([r1, r2])}`);
    Stats.clearCache();
    const r = await get(`/arena/stats/series?${qs({ metric: "active_players", granularity: "hour", from: iso(H1), to: iso(H2 + HOUR) })}`);
    const at = (t) => r.body.buckets.find((b) => b.start === iso(t));
    eq(at(H1).value, 6, "consolidado");
    eq(at(H2).value, 0, "coberta sem ninguém = 0");
  });
  await check("ativos por UF só para UM bucket (únicos não se somam)", async () => {
    const r = await get(`/arena/stats/environments?${qs({ metric: "active_players", granularity: "hour", from: iso(H1), to: iso(H1 + 2 * HOUR) })}`);
    eq([r.status, r.body.code], [400, "not_additive"], "status");
  });
  await check("mapa de presença: célula pequena suprimida, sem identidade", async () => {
    await pool.query(
      `INSERT INTO public.tb_arena_presence_sample (minute_at, instance_id, environment_id, chunk_index, controlling, away)
       VALUES ($1, 'inst-a', 'br-sb', 9, 1, 0)`,
      [iso(H1 + 3 * 60_000 + 7)]
    ).catch(() => {});
    await pool.query(
      `INSERT INTO public.tb_arena_presence_sample (minute_at, instance_id, environment_id, chunk_index, controlling, away)
       VALUES ($1, 'inst-a', 'br-sb', 9, 1, 0) ON CONFLICT DO NOTHING`,
      [iso(H1 + 3 * 60_000)]
    );
    // Terceira célula, maior: com uma só pequena, o complemento oculta a MENOR
    // das visíveis (chunk 2) e a maior (chunk 5) segue visível.
    for (let m = 0; m < 40; m++) {
      await pool.query(
        `INSERT INTO public.tb_arena_presence_sample (minute_at, instance_id, environment_id, chunk_index, controlling, away)
         VALUES ($1, 'inst-a', 'br-sb', 5, 9, 0) ON CONFLICT DO NOTHING`,
        [iso(H1 + m * 60_000)]
      );
    }
    Stats.clearCache();
    const dayOfH1 = Math.floor(H1 / DAY) * DAY;
    const r = await get(`/arena/stats/heatmap?${qs({ mode: "presence", environmentId: "br-sb", from: iso(dayOfH1), to: iso(dayOfH1 + DAY) })}`);
    eq(r.status, 200, "status");
    const cells = Object.fromEntries(r.body.cells.map((c) => [c.chunk, c]));
    eq([cells[9].state, cells[2].state, cells[5].state], ["suppressed", "suppressed", "ok"], "primária + complementar");
    ok(!/id_user|pl_/.test(JSON.stringify(r.body)), "identidade no mapa");
  });

  console.log("\n━━━ preferência declarada ━━━");
  await check("só nacional, sem total, grupos pequenos suprimidos; Política fechada", async () => {
    for (let i = 0; i < 7; i++) {
      await pool.query(`INSERT INTO public.tb_arena_preference (id_user, category_id, team_id) VALUES ($1, 'futebol', 'st-azul') ON CONFLICT DO NOTHING`, [users[i].id]);
    }
    await pool.query(`INSERT INTO public.tb_arena_preference (id_user, category_id, team_id) VALUES ($1, 'futebol', 'st-verde') ON CONFLICT DO NOTHING`, [users[7].id]);
    Stats.clearCache();
    const r = await get(`/arena/stats/preferences?${qs({ categoryId: "futebol" })}`);
    eq(r.status, 200, `status ${JSON.stringify(r.body)}`);
    const by = Object.fromEntries(r.body.rows.map((x) => [x.teamId, x]));
    eq([by["st-azul"].value, by["st-verde"].state], [7, "suppressed"], "valores");
    ok(r.body.total === undefined, "total exposto");
    eq((await get(`/arena/stats/preferences?${qs({ categoryId: "futebol", environmentId: "br-sa" })}`)).status, 400, "por UF");
    eq((await get(`/arena/stats/preferences?${qs({ categoryId: "politica" })}`)).status, 422, "política");
  });

  console.log("\n━━━ custo SQL (volume representativo, banco isolado) ━━━");
  await check("50 mil fatos: série, ranking, UFs e mapa respondem rápido (plano registrado)", async () => {
    // Volume sintético em br-sd, 7 dias, 4 postes: dentro do índice único (conta×poste×hora).
    await pool.query(
      `INSERT INTO public.tb_arena_post (environment_id, post_id, map_version, generator_version, x, y, radius_m, competitive, valid_from)
       SELECT 'br-sd', 'v' || g || '-post', 1, 2, g * 32, -4, 2.5, TRUE, $1 FROM generate_series(1, 4) g ON CONFLICT DO NOTHING`,
      [iso(T0 - 7 * DAY)]
    );
    await pool.query(
      `INSERT INTO public.tb_arena_checkpoint (id_user, environment_id, post_id, category_id, team_id, window_start, accepted_at, request_id, request_hash)
       SELECT u.id_user, 'br-sd', 'v' || (1 + ((n / 12) % 4)) || '-post', 'futebol',
              (ARRAY['st-azul','st-verde','st-roxo'])[1 + (n % 3)],
              w, w + INTERVAL '1 minute', gen_random_uuid(), repeat('0', 64)
         FROM generate_series(0, 49999) n
         JOIN LATERAL (SELECT id_user FROM public.tb_user ORDER BY id_user OFFSET (n % 12) LIMIT 1) u ON TRUE
         CROSS JOIN LATERAL (SELECT date_trunc('hour', $1::timestamptz - (n / 48) * INTERVAL '1 hour') AS w) ww
        ON CONFLICT DO NOTHING`,
      [iso(nowH - DAY)]
    );
    const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_checkpoint WHERE environment_id = 'br-sd'`)).rows[0].n;
    Stats.clearCache();
    const timings = {};
    for (const [label, url] of [
      ["série 7 dias (dia)", `/arena/stats/series?${qs({ metric: "checkpoints", granularity: "day", from: iso(today - 7 * DAY), to: iso(today + DAY) })}`],
      ["participantes 7 dias", `/arena/stats/environments?${qs({ metric: "participants", granularity: "day", from: iso(today - 7 * DAY), to: iso(today + DAY) })}`],
      ["ranking 7 dias", `/arena/stats/ranking?${qs({ metric: "checkpoints", categoryId: "futebol", granularity: "day", from: iso(today - 7 * DAY), to: iso(today + DAY) })}`],
      ["mapa 7 dias", `/arena/stats/heatmap?${qs({ mode: "checkpoints", environmentId: "br-sd", from: iso(today - 7 * DAY), to: iso(today + DAY) })}`],
    ]) {
      const t0 = Date.now();
      const r = await get(url);
      timings[label] = Date.now() - t0;
      eq(r.status, 200, `${label}: ${JSON.stringify(r.body)}`);
    }
    const plan = await pool.query(
      `EXPLAIN SELECT COUNT(*) FROM public.tb_arena_checkpoint WHERE window_start >= $1 AND window_start < $2`,
      [iso(today - 7 * DAY), iso(today + DAY)]
    );
    console.log(`      fatos no volume: ${n}; tempos (ms): ${JSON.stringify(timings)}`);
    console.log(`      plano: ${plan.rows.map((r) => r["QUERY PLAN"]).join(" | ").slice(0, 220)}`);
    ok(Object.values(timings).every((ms) => ms < 3000), "consulta lenta demais");
  });

  server.close();
  await pool.end().catch(() => {});
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} verificações`);
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
