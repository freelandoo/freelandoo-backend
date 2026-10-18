// test/arena-directory.e2e.js — Freelandoo Arena, diretório de salas entre
// servidores de jogo (mig 288), pela HTTP DE VERDADE contra um Postgres de TESTE.
//
//   npm run test:arena-directory
//
// Exercita: assinatura do canal, registro e época nova a cada boot, admissão
// com overflow (sala cheia → sala nova), sem overbooking com admissões
// CONCORRENTES pela última vaga, teto do processo levando a outro processo,
// escolha estrita x preferência, ticket de uso único (outra conta, outro
// processo, vencido, repetido), controle único entre processos (lease da
// conta), revogação para trocar de processo, fencing de época antiga,
// processo sem batida perdendo as salas e listagem sem identidade.

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
process.env.JWT_SECRET = `arena-dir-${crypto.randomBytes(16).toString("hex")}`;
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

  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcrypt");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const { sign: signSvc, sha256Hex } = require("../src/middlewares/arenaServiceAuth");
  const Dir = require("../src/services/ArenaDirectoryService");

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;

  const call = async (method, p, { token, body, service = false } = {}) => {
    const headers = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const raw = body === undefined ? "" : JSON.stringify(body);
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (service) {
      const ts = String(Date.now());
      const nonce = crypto.randomBytes(18).toString("base64url");
      headers["X-Arena-Service-Timestamp"] = ts;
      headers["X-Arena-Service-Nonce"] = nonce;
      headers["X-Arena-Service-Signature"] = signSvc(process.env.ARENA_SERVICE_SECRET, { method, url: p, ts, nonce, bodyHash: sha256Hex(Buffer.from(raw)) });
    }
    const res = await fetch(base + p, { method, headers, body: body === undefined ? undefined : raw });
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
  for (let i = 0; i < 9; i++) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo) VALUES ($1, $2, $3, $4, TRUE) RETURNING id_user`,
      [`Dir ${i}`, `dir${i}${stamp}`.slice(0, 30), `arena.dir.${i}.${stamp}@teste.invalid`, hash]
    );
    const id = r.rows[0].id_user;
    const playerId = `pl_dir${stamp}${i}`.padEnd(14, "0").slice(0, 32).replace(/[^A-Za-z0-9_]/g, "0");
    await pool.query(`INSERT INTO public.tb_arena_player (id_user, player_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, playerId]);
    users.push({ id, playerId, token: jwt.sign({ id_user: id, email: "x@teste.invalid" }, process.env.JWT_SECRET, { expiresIn: "1h" }) });
  }
  const ENV = "br-zz";
  const W1 = `w1-${stamp}`;
  const W2 = `w2-${stamp}`;
  // Ambiente sintético limpo; processos de execuções anteriores saem do caminho.
  await pool.query(`DELETE FROM public.tb_arena_room WHERE environment_id IN ('br-zz','br-zy')`);
  await pool.query(`DELETE FROM public.tb_arena_admission WHERE environment_id IN ('br-zz','br-zy')`);
  await pool.query(`UPDATE public.tb_arena_worker SET state = 'unavailable', lease_until = NOW() - interval '1 minute'`);
  const PV = 3;
  const reg = (workerId, extra = {}) =>
    call("POST", "/arena/internal/workers/register", {
      service: true,
      body: { workerId, endpoint: `http://127.0.0.1:9${workerId === W1 ? "001" : "002"}`, protocolVersion: PV, maxPlayers: 4, maxRooms: 10, roomCapacity: 2, ...extra },
    });
  const beat = (workerId, epoch, rooms = [], accounts = [], players = accounts.length, state = "available") =>
    call("POST", "/arena/internal/workers/heartbeat", { service: true, body: { workerId, epoch, state, players, rooms, accounts } });
  const admit = (u, body = {}) => call("POST", "/arena/rooms/admission", { token: u.token, body: { environmentId: ENV, protocolVersion: PV, ...body } });
  const consume = (u, ticket, workerId, epoch) => call("POST", "/arena/internal/admissions/consume", { service: true, token: u.token, body: { ticket, workerId, epoch } });

  console.log("━━━ canal e registro ━━━");
  let e1 = 0;
  let e2 = 0;
  await check("registro sem assinatura do serviço é recusado", async () => {
    const r = await call("POST", "/arena/internal/workers/register", { body: { workerId: W1 } });
    ok(r.status === 401 || r.status === 503, `status ${r.status}`);
  });
  await check("registro devolve época; registrar de novo (novo boot) sobe a época", async () => {
    const a = await reg(W1);
    eq(a.status, 200, "1º registro");
    const b = await reg(W1);
    ok(b.body.epoch === a.body.epoch + 1, `época ${a.body.epoch} → ${b.body.epoch}`);
    e1 = b.body.epoch;
    e2 = (await reg(W2)).body.epoch;
  });
  await check("endpoint com caminho, credencial ou querystring é recusado", async () => {
    eq((await reg(`bad-${stamp}`, { endpoint: "http://127.0.0.1:9/ws?x=1" })).status, 400, "query");
    eq((await reg(`bad-${stamp}`, { endpoint: "http://u:p@127.0.0.1:9" })).status, 400, "credencial");
  });

  console.log("━━━ admissão e capacidade ━━━");
  const t = [];
  await check("sem admissão para protocolo incompatível (nenhum processo da versão)", async () => {
    const r = await admit(users[0], { protocolVersion: 99 });
    eq(r.status, 503, "status");
    eq(r.body.code, "no_server", "code");
  });
  await check("a primeira admissão cria a Sala 1 num processo e entrega o endereço REGISTRADO", async () => {
    const r = await admit(users[0]);
    eq(r.status, 200, `status ${JSON.stringify(r.body)}`);
    eq(r.body.shard, 0, "sala");
    ok(/^http:\/\/127\.0\.0\.1:900[12]$/.test(r.body.endpoint), `endpoint ${r.body.endpoint}`);
    ok(/^[A-Za-z0-9_-]{43}$/.test(r.body.ticket), "ticket");
    t[0] = r.body;
  });
  await check("ticket NÃO pode ser usado por outra conta, outro processo nem outra época", async () => {
    const { ticket, workerId, epoch } = t[0];
    eq((await consume(users[1], ticket, workerId, epoch)).body.code, "admission_invalid", "outra conta");
    eq((await consume(users[0], ticket, workerId === W1 ? W2 : W1, epoch)).body.code, "admission_invalid", "outro processo");
    eq((await consume(users[0], ticket, workerId, epoch + 7)).body.code, "admission_invalid", "outra época");
  });
  await check("consumo devolve ambiente+sala; repetir o mesmo ticket é recusado (uso único)", async () => {
    const { ticket, workerId, epoch } = t[0];
    const r = await consume(users[0], ticket, workerId, epoch);
    eq([r.status, r.body.environmentId, r.body.shard], [200, ENV, 0], "consumo");
    eq((await consume(users[0], ticket, workerId, epoch)).body.code, "admission_invalid", "repetido");
  });
  await check("ticket pendente reserva vaga: a Sala 1 (2 vagas) lota com 1 presente + 1 reservado", async () => {
    const r = await admit(users[1]);
    eq(r.body.shard, 0, "segunda pessoa na Sala 1");
    const third = await admit(users[2]);
    eq(third.body.shard, 1, "terceira vai para a Sala 2");
    t[1] = r.body;
    t[2] = third.body;
  });
  await check("concorrência pela última vaga: 6 admissões simultâneas, nenhuma sala além da capacidade", async () => {
    const rs = await Promise.all(users.slice(3, 9).map((u) => admit(u)));
    const okRs = rs.filter((r) => r.status === 200);
    const perRoom = new Map();
    for (const r of okRs) perRoom.set(r.body.shard, (perRoom.get(r.body.shard) ?? 0) + 1);
    const rooms = (await pool.query(`SELECT shard, occupancy, (SELECT COUNT(*) FROM public.tb_arena_admission a WHERE a.environment_id = r.environment_id AND a.shard = r.shard AND ((a.consumed_at IS NULL AND a.expires_at > NOW()) OR a.consumed_at > r.reported_at))::int AS pend, capacity FROM public.tb_arena_room r WHERE environment_id = $1`, [ENV])).rows;
    for (const r of rooms) ok(r.occupancy + r.pend <= r.capacity, `sala ${r.shard}: ${r.occupancy}+${r.pend} > ${r.capacity}`);
    // Teto dos processos: 4 + 4 = 8 jogadores no total (reservas contam).
    const total = rooms.reduce((n, r) => n + r.occupancy + r.pend, 0);
    ok(total <= 8, `total ${total} > 8`);
    const refused = rs.filter((r) => r.status === 503);
    ok(refused.every((r) => r.body.code === "server_full"), "recusa honesta");
  });
  await check("listagem das salas: ocupação com reservas, vagas, sem identidade", async () => {
    const r = await call("GET", `/arena/rooms?environmentId=${ENV}`);
    eq(r.status, 200, "status");
    ok(r.body.rooms.length >= 2 && r.body.rooms[0].full === true, JSON.stringify(r.body));
    ok(!JSON.stringify(r.body).match(/pl_|id_user|worker|endpoint/), "vazou identidade/infra");
  });

  console.log("━━━ controle único entre processos ━━━");
  // Reinicia o cenário: processos novos (época nova), salas e tickets limpos.
  await pool.query(`DELETE FROM public.tb_arena_room WHERE environment_id = $1`, [ENV]);
  await pool.query(`DELETE FROM public.tb_arena_admission WHERE environment_id = $1`, [ENV]);
  await pool.query(`DELETE FROM public.tb_arena_account_lease WHERE id_user = ANY($1::uuid[])`, [users.map((u) => u.id)]);
  e1 = (await reg(W1, { maxPlayers: 10 })).body.epoch;
  e2 = (await reg(W2, { maxPlayers: 10 })).body.epoch;
  const ana = users[0];
  let anaAdm;
  await check("conta presente num processo: admissão nova vai para O MESMO processo", async () => {
    anaAdm = (await admit(ana)).body;
    await consume(ana, anaAdm.ticket, anaAdm.workerId, anaAdm.epoch);
    const other = anaAdm.workerId === W1 ? W2 : W1;
    // Ocupa o outro processo para tentar "puxar" a conta para lá.
    const again = await admit(ana);
    eq(again.body.workerId, anaAdm.workerId, "mesmo processo");
    void other;
  });
  await check("sala ESTRITA cheia é recusada (room_full); preferência cheia é atendida noutra sala ('moved')", async () => {
    // Enche a sala da Ana com mais um presente.
    const bia = users[1];
    const ab = (await admit(bia, { shard: anaAdm.shard, strict: true })).body;
    await consume(bia, ab.ticket, ab.workerId, ab.epoch);
    const ep = ab.workerId === W1 ? e1 : e2;
    await beat(ab.workerId, ep, [{ environmentId: ENV, shard: ab.shard, occupancy: 2 }], [{ playerId: ana.playerId, environmentId: ENV, shard: ab.shard }, { playerId: bia.playerId, environmentId: ENV, shard: ab.shard }]);
    const cris = users[2];
    const st = await admit(cris, { shard: ab.shard, strict: true });
    eq(st.body.code, "room_full", `estrita (ana ${anaAdm.shard}/${anaAdm.workerId}, bia ${ab.shard}/${ab.workerId}) ${JSON.stringify(st.body)}`);
    const pref = await admit(cris, { shard: ab.shard, strict: false });
    ok(pref.status === 200 && pref.body.shard !== ab.shard && pref.body.moved === true, JSON.stringify(pref.body));
  });
  await check("trocar para sala de OUTRO processo: o dono larga a conta (revogação) antes — nunca dois controladores", async () => {
    const cur = anaAdm.workerId;
    const curEpoch = cur === W1 ? e1 : e2;
    const other = cur === W1 ? W2 : W1;
    const otherEpoch = other === W1 ? e1 : e2;
    // Sala existente no OUTRO processo.
    const dani = users[3];
    const dp = (await call("POST", "/arena/rooms/admission", { token: dani.token, body: { environmentId: "br-zy", protocolVersion: PV } })).body;
    // Força a sala de Dani para o outro processo, se não caiu lá.
    ok(Number.isInteger(dp.shard), `admissão de Dani: ${JSON.stringify(dp)}`);
    await pool.query(`UPDATE public.tb_arena_room SET worker_id = $1, worker_epoch = $2 WHERE environment_id = 'br-zy' AND shard = $3`, [other, otherEpoch, dp.shard]);
    await pool.query(`UPDATE public.tb_arena_admission SET worker_id = $1, worker_epoch = $2 WHERE environment_id = 'br-zy'`, [other, otherEpoch]);
    const moving = await call("POST", "/arena/rooms/admission", { token: ana.token, body: { environmentId: "br-zy", shard: dp.shard, strict: true, protocolVersion: PV } });
    eq(moving.body.code, "moving", `pede para largar: ${JSON.stringify(moving.body)}`);
    // Na próxima batida o dono atual recebe a ordem de largar a Ana…
    const hb = await beat(cur, curEpoch, [], [{ playerId: ana.playerId, environmentId: ENV, shard: anaAdm.shard }]);
    ok(hb.body.revoke.includes(ana.playerId), `revoke: ${JSON.stringify(hb.body)}`);
    // …larga (próxima batida sem ela) e a admissão no outro processo sai.
    await beat(cur, curEpoch, [], []);
    const moved = await call("POST", "/arena/rooms/admission", { token: ana.token, body: { environmentId: "br-zy", shard: dp.shard, strict: true, protocolVersion: PV } });
    eq([moved.status, moved.body.workerId], [200, other], `admitida no outro: ${JSON.stringify(moved.body)}`);
  });

  console.log("━━━ fencing e vida ━━━");
  await check("processo reinicia (época nova): batida da época ANTIGA é recusada e manda largar tudo", async () => {
    const old = e1;
    e1 = (await reg(W1, { maxPlayers: 10 })).body.epoch;
    const hb = await beat(W1, old, [{ environmentId: ENV, shard: 0, occupancy: 1 }], []);
    eq(hb.body.fenced, true, "fenced");
    eq(hb.body.dropRooms.length, 1, "larga a sala");
  });
  await check("sala que o diretório não deu ao processo: a batida manda largar", async () => {
    const hb = await beat(W1, e1, [{ environmentId: "br-zx", shard: 42, occupancy: 3 }], []);
    eq(hb.body.dropRooms, [{ environmentId: "br-zx", shard: 42 }], "largar");
  });
  await check("processo sem batida no prazo: deixa de receber admissão e perde as salas", async () => {
    await pool.query(`UPDATE public.tb_arena_worker SET lease_until = NOW() - interval '1 second' WHERE worker_id = $1`, [W2]);
    const r = await admit(users[4], { environmentId: "br-zy" });
    eq(r.body.workerId, W1, "foi para o vivo");
    const left = (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_room WHERE worker_id = $1`, [W2])).rows[0].n;
    eq(left, 0, "salas do morto");
  });
  await check("drenando: não recebe admissão nova", async () => {
    await beat(W1, e1, [], [], 0, "draining");
    const r = await admit(users[5]);
    eq(r.body.code, "no_server", JSON.stringify(r.body));
  });
  await check("batida malformada é recusada (400)", async () => {
    eq((await beat(W1, e1, [{ environmentId: "x", shard: -1, occupancy: 0 }])).status, 400, "sala torta");
    eq((await call("POST", "/arena/internal/workers/heartbeat", { service: true, body: { workerId: W1, epoch: e1, state: "available", players: 0, rooms: [], accounts: [], extra: 1 } })).status, 400, "campo extra");
  });
  void Dir;

  server.close();
  await pool.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
