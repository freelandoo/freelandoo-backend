// Freelandoo Arena — diretório de salas entre servidores de jogo (mig 288).
//
// Quem decide "em qual processo e em qual sala esta conta entra" é ESTE
// service, sob uma trava transacional única (pg_advisory_xact_lock). Os
// processos de jogo continuam donos do movimento (memória); aqui só passam:
//   • registro (boot)   → época nova; salas e leases da época anterior saem;
//   • batida (5 s)      → vida (lease), ocupação por sala, contas presentes;
//                         resposta diz quem largar (fencing / revogação);
//   • admissão          → o navegador pede; sai um ticket de USO ÚNICO e curto
//                         ligado a conta + ambiente + sala + processo + época;
//   • consumo           → o processo confere o ticket ANTES de aceitar o hello.
//
// Regras que este arquivo garante (e o teste test/arena-directory.e2e.js prova):
//   1. sem overbooking: vaga = ocupação reportada + tickets ainda não usados;
//   2. uma sala, um dono: (ambiente, sala) é chave primária;
//   3. conta com lease vivo vai SEMPRE para o processo que a tem — o controle
//      único/"Jogar aqui"/retomada continuam sendo do processo; trocar de
//      processo exige o dono largar (revogação) ou o prazo vencer;
//   4. processo sem batida no prazo não recebe admissão e perde as salas;
//      processo de época antiga é recusado (fencing) e larga tudo;
//   5. endereço entregue ao navegador vem SÓ do registro assinado.

const crypto = require("node:crypto");
const pool = require("../databases");
const { createLogger } = require("../utils/logger");

const log = createLogger("ArenaDirectoryService");

const ENV_ID = /^br-[a-z]{2}$/;
const WORKER_ID = /^[A-Za-z0-9._-]{1,64}$/;
const PLAYER_ID = /^pl_[A-Za-z0-9]{10,32}$/;
const TICKET = /^[A-Za-z0-9_-]{43}$/;
const STATES = ["available", "draining", "unavailable"];

const CONFIG = Object.freeze({
  /** Vida de um processo sem batida. A batida é a cada heartbeatMs. */
  workerLeaseMs: 15_000,
  heartbeatMs: 5_000,
  /** Lease de uma conta num processo (renovado a cada batida). */
  accountLeaseMs: 20_000,
  /** Prazo do ticket de admissão: o navegador conecta logo em seguida. */
  admissionTtlMs: 30_000,
  /** Sala vazia sem reserva some do diretório depois disto (o processo descarta antes). */
  emptyRoomTtlMs: 60_000,
  maxRoomsPerHeartbeat: 2_000,
  maxAccountsPerHeartbeat: 20_000,
});

const LOCK_KEY = 0x41524e41; // 'ARNA' — uma trava para todo o diretório.
const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const ok = (body) => ({ status: 200, body });
const sha256 = (s) => crypto.createHash("sha256").update(s).digest();

function onlyKeys(o, keys) {
  return o && typeof o === "object" && !Array.isArray(o) && Object.keys(o).every((k) => keys.includes(k));
}

function validEndpoint(s) {
  if (typeof s !== "string" || s.length > 300) return false;
  let u;
  try {
    u = new URL(s);
  } catch {
    return false;
  }
  if (u.username || u.password || u.search || u.hash) return false;
  if (u.pathname !== "/" && u.pathname !== "") return false;
  if (process.env.NODE_ENV === "production") return u.protocol === "https:";
  return u.protocol === "https:" || u.protocol === "http:";
}

const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

async function withLock(db, fn) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1)", [LOCK_KEY]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Limpeza barata, sempre dentro da trava: processos mortos e tickets velhos. */
async function sweep(client) {
  // Processo sem batida no prazo: perde as salas e as contas (a autoridade
  // acabou — os clientes reconectam e são admitidos em quem está vivo).
  const dead = await client.query(
    `UPDATE public.tb_arena_worker SET state = 'unavailable'
      WHERE state <> 'unavailable' AND lease_until < clock_timestamp()
      RETURNING worker_id`
  );
  if (dead.rowCount) {
    const ids = dead.rows.map((r) => r.worker_id);
    await client.query(`DELETE FROM public.tb_arena_room WHERE worker_id = ANY($1::varchar[])`, [ids]);
    await client.query(`DELETE FROM public.tb_arena_account_lease WHERE worker_id = ANY($1::varchar[])`, [ids]);
    log.warn("worker.expired", { workers: ids.length });
  }
  await client.query(`DELETE FROM public.tb_arena_admission WHERE expires_at < clock_timestamp() - interval '1 hour'`);
  await client.query(`DELETE FROM public.tb_arena_account_lease WHERE lease_until < clock_timestamp()`);
}

// ─── Processo de jogo (canal interno assinado) ───────────────────────────────

async function registerWorker(body, { db = pool } = {}) {
  const keys = ["workerId", "endpoint", "protocolVersion", "maxPlayers", "maxRooms", "roomCapacity"];
  if (!onlyKeys(body, keys)) return fail(400, "invalid_input", "Campo não aceito");
  const b = body;
  if (typeof b.workerId !== "string" || !WORKER_ID.test(b.workerId)) return fail(400, "invalid_input", "workerId");
  if (!validEndpoint(b.endpoint)) return fail(400, "invalid_input", "endpoint");
  if (!intIn(b.protocolVersion, 1, 1000)) return fail(400, "invalid_input", "protocolVersion");
  if (!intIn(b.maxPlayers, 1, 100_000) || !intIn(b.maxRooms, 1, 10_000) || !intIn(b.roomCapacity, 1, 10_000)) return fail(400, "invalid_input", "capacidade");
  const endpoint = b.endpoint.replace(/\/$/, "");
  return withLock(db, async (client) => {
    await sweep(client);
    // Época nova a cada registro: o processo que registrou ANTES (mesmo id)
    // é outra geração — o que ele dizia ter na memória não vale mais.
    const r = await client.query(
      `INSERT INTO public.tb_arena_worker
         (worker_id, epoch, endpoint, protocol_version, state, max_players, max_rooms, room_capacity, players, rooms, heartbeat_at, lease_until)
       VALUES ($1, 1, $2, $3, 'available', $4, $5, $6, 0, 0, clock_timestamp(), clock_timestamp() + ($7 || ' milliseconds')::interval)
       ON CONFLICT (worker_id) DO UPDATE SET
         epoch = public.tb_arena_worker.epoch + 1, endpoint = EXCLUDED.endpoint, protocol_version = EXCLUDED.protocol_version,
         state = 'available', max_players = EXCLUDED.max_players, max_rooms = EXCLUDED.max_rooms,
         room_capacity = EXCLUDED.room_capacity, players = 0, rooms = 0, registered_at = clock_timestamp(),
         heartbeat_at = clock_timestamp(), lease_until = EXCLUDED.lease_until
       RETURNING epoch`,
      [b.workerId, endpoint, b.protocolVersion, b.maxPlayers, b.maxRooms, b.roomCapacity, String(CONFIG.workerLeaseMs)]
    );
    const epoch = Number(r.rows[0].epoch);
    await client.query(`DELETE FROM public.tb_arena_room WHERE worker_id = $1 AND worker_epoch <> $2`, [b.workerId, epoch]);
    await client.query(`DELETE FROM public.tb_arena_account_lease WHERE worker_id = $1 AND worker_epoch <> $2`, [b.workerId, epoch]);
    await client.query(`UPDATE public.tb_arena_admission SET expires_at = clock_timestamp() WHERE worker_id = $1 AND worker_epoch <> $2 AND consumed_at IS NULL`, [b.workerId, epoch]);
    log.info("worker.registered", { workerId: b.workerId, epoch });
    return ok({ epoch, heartbeatMs: CONFIG.heartbeatMs, leaseMs: CONFIG.workerLeaseMs });
  });
}

function parseHeartbeat(body) {
  if (!onlyKeys(body, ["workerId", "epoch", "state", "players", "rooms", "accounts"])) return null;
  if (typeof body.workerId !== "string" || !WORKER_ID.test(body.workerId)) return null;
  if (!intIn(body.epoch, 1, Number.MAX_SAFE_INTEGER) || !STATES.includes(body.state) || !intIn(body.players, 0, 100_000)) return null;
  if (!Array.isArray(body.rooms) || body.rooms.length > CONFIG.maxRoomsPerHeartbeat) return null;
  if (!Array.isArray(body.accounts) || body.accounts.length > CONFIG.maxAccountsPerHeartbeat) return null;
  const rooms = [];
  for (const r of body.rooms) {
    if (!onlyKeys(r, ["environmentId", "shard", "occupancy"])) return null;
    if (typeof r.environmentId !== "string" || !ENV_ID.test(r.environmentId) || !intIn(r.shard, 0, 10_000) || !intIn(r.occupancy, 0, 10_000)) return null;
    rooms.push(r);
  }
  const accounts = [];
  for (const a of body.accounts) {
    if (!onlyKeys(a, ["playerId", "environmentId", "shard"])) return null;
    if (typeof a.playerId !== "string" || !PLAYER_ID.test(a.playerId) || typeof a.environmentId !== "string" || !ENV_ID.test(a.environmentId) || !intIn(a.shard, 0, 10_000)) return null;
    accounts.push(a);
  }
  return { ...body, rooms, accounts };
}

async function heartbeat(body, { db = pool } = {}) {
  const b = parseHeartbeat(body);
  if (!b) return fail(400, "invalid_input", "Batida inválida");
  return withLock(db, async (client) => {
    await sweep(client);
    const w = (await client.query(`SELECT epoch, state FROM public.tb_arena_worker WHERE worker_id = $1`, [b.workerId])).rows[0];
    // Fencing: época diferente (o processo foi substituído) ou já declarado
    // morto. A resposta manda largar TUDO — nunca dois donos da mesma sala.
    if (!w || Number(w.epoch) !== b.epoch || w.state === "unavailable") {
      return ok({ fenced: true, dropRooms: b.rooms.map((r) => ({ environmentId: r.environmentId, shard: r.shard })), revoke: [] });
    }
    await client.query(
      `UPDATE public.tb_arena_worker SET state = $2, players = $3, rooms = $4, heartbeat_at = clock_timestamp(),
              lease_until = clock_timestamp() + ($5 || ' milliseconds')::interval
        WHERE worker_id = $1`,
      [b.workerId, b.state, b.players, b.rooms.length, String(CONFIG.workerLeaseMs)]
    );
    // Salas: só as que o diretório deu a ESTE processo (e época). Sala
    // reportada que o diretório não reconhece = largar (não é dele).
    const owned = await client.query(`SELECT environment_id, shard FROM public.tb_arena_room WHERE worker_id = $1 AND worker_epoch = $2`, [b.workerId, b.epoch]);
    const key = (e, s) => `${e}#${s}`;
    const ownedSet = new Set(owned.rows.map((r) => key(r.environment_id, r.shard)));
    const dropRooms = [];
    const reported = new Set();
    for (const r of b.rooms) {
      const k = key(r.environmentId, r.shard);
      if (!ownedSet.has(k)) {
        dropRooms.push({ environmentId: r.environmentId, shard: r.shard });
        continue;
      }
      reported.add(k);
      await client.query(
        `UPDATE public.tb_arena_room SET occupancy = $3, reported_at = clock_timestamp() WHERE environment_id = $1 AND shard = $2`,
        [r.environmentId, r.shard, r.occupancy]
      );
    }
    // Salas do processo que ele NÃO reportou (já descartou na memória) e sem
    // reserva viva: saem do diretório depois de um prazo.
    await client.query(
      `DELETE FROM public.tb_arena_room r
        WHERE r.worker_id = $1 AND r.worker_epoch = $2 AND NOT (r.environment_id || '#' || r.shard = ANY($3::text[]))
          AND r.reported_at < clock_timestamp() - ($4 || ' milliseconds')::interval
          AND NOT EXISTS (SELECT 1 FROM public.tb_arena_admission a
                           WHERE a.environment_id = r.environment_id AND a.shard = r.shard
                             AND a.consumed_at IS NULL AND a.expires_at > clock_timestamp())`,
      [b.workerId, b.epoch, [...reported], String(CONFIG.emptyRoomTtlMs)]
    );
    // Contas presentes: renova o lease. Conta cujo lease vivo é de OUTRO
    // processo (não deveria acontecer) é revogada AQUI — o dono é o outro.
    const revoke = [];
    const ids = b.accounts.map((a) => a.playerId);
    const owners = ids.length
      ? (await client.query(`SELECT player_id, id_user FROM public.tb_arena_player WHERE player_id = ANY($1::varchar[])`, [ids])).rows
      : [];
    const userOf = new Map(owners.map((r) => [r.player_id, r.id_user]));
    const present = [];
    for (const a of b.accounts) {
      const idUser = userOf.get(a.playerId);
      if (!idUser) continue;
      const cur = (await client.query(
        `SELECT l.worker_id, l.worker_epoch, l.revoke_requested_at
           FROM public.tb_arena_account_lease l
          WHERE l.id_user = $1 AND l.lease_until > clock_timestamp()`,
        [idUser]
      )).rows[0];
      if (cur && (cur.worker_id !== b.workerId || Number(cur.worker_epoch) !== b.epoch)) {
        revoke.push(a.playerId);
        continue;
      }
      if (cur?.revoke_requested_at) {
        revoke.push(a.playerId);
        continue;
      }
      present.push(idUser);
      await client.query(
        `INSERT INTO public.tb_arena_account_lease (id_user, worker_id, worker_epoch, environment_id, shard, lease_until)
         VALUES ($1, $2, $3, $4, $5, clock_timestamp() + ($6 || ' milliseconds')::interval)
         ON CONFLICT (id_user) DO UPDATE SET worker_id = EXCLUDED.worker_id, worker_epoch = EXCLUDED.worker_epoch,
           environment_id = EXCLUDED.environment_id, shard = EXCLUDED.shard, lease_until = EXCLUDED.lease_until`,
        [idUser, b.workerId, b.epoch, a.environmentId, a.shard, String(CONFIG.accountLeaseMs)]
      );
    }
    // Quem este processo não reportou saiu dele: o lease acaba agora.
    await client.query(
      `DELETE FROM public.tb_arena_account_lease WHERE worker_id = $1 AND worker_epoch = $2 AND NOT (id_user = ANY($3::uuid[]))`,
      [b.workerId, b.epoch, present]
    );
    return ok({ fenced: false, dropRooms, revoke });
  });
}

/**
 * O processo confere o ticket que o navegador mandou no hello. Uso ÚNICO:
 * o UPDATE só acontece uma vez. Conta do ticket = conta do token (guard).
 */
async function consumeAdmission(ctx, body, { db = pool } = {}) {
  if (!onlyKeys(body, ["ticket", "workerId", "epoch"])) return fail(400, "invalid_input", "Campo não aceito");
  if (typeof body.ticket !== "string" || !TICKET.test(body.ticket)) return fail(400, "invalid_input", "ticket");
  if (typeof body.workerId !== "string" || !WORKER_ID.test(body.workerId) || !intIn(body.epoch, 1, Number.MAX_SAFE_INTEGER)) return fail(400, "invalid_input", "worker");
  return withLock(db, async (client) => {
    const r = await client.query(
      `UPDATE public.tb_arena_admission SET consumed_at = clock_timestamp()
        WHERE ticket_hash = $1 AND id_user = $2 AND worker_id = $3 AND worker_epoch = $4
          AND consumed_at IS NULL AND expires_at > clock_timestamp()
        RETURNING environment_id, shard`,
      [sha256(body.ticket), ctx.id_user, body.workerId, body.epoch]
    );
    if (!r.rowCount) return fail(409, "admission_invalid", "Ticket de admissão inválido, vencido ou já usado");
    const { environment_id: environmentId, shard } = r.rows[0];
    // O lease nasce JÁ (antes da próxima batida): uma segunda admissão da
    // mesma conta, um segundo depois, vem para cá.
    await client.query(
      `INSERT INTO public.tb_arena_account_lease (id_user, worker_id, worker_epoch, environment_id, shard, lease_until)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp() + ($6 || ' milliseconds')::interval)
       ON CONFLICT (id_user) DO UPDATE SET worker_id = EXCLUDED.worker_id, worker_epoch = EXCLUDED.worker_epoch,
         environment_id = EXCLUDED.environment_id, shard = EXCLUDED.shard, lease_until = EXCLUDED.lease_until, revoke_requested_at = NULL`,
      [ctx.id_user, body.workerId, body.epoch, environmentId, shard, String(CONFIG.accountLeaseMs)]
    );
    return ok({ environmentId, shard });
  });
}

// ─── Navegador ───────────────────────────────────────────────────────────────

/**
 * Ocupação de cada sala em CONTAS DISTINTAS: o maior entre o que o processo
 * reportou e o conjunto (contas com lease vivo na sala ∪ contas com ticket
 * pendente para ela). O lease nasce no consumo do ticket — então quem acabou
 * de entrar conta mesmo antes da próxima batida (sem overbooking) e a mesma
 * conta nunca conta duas vezes (presente + ticket novo). A conta que está
 * pedindo ($2) fica de fora: ela não ocupa duas vagas.
 */
const ROOMS_OF_ENV = `
  SELECT r.environment_id, r.shard, r.worker_id, r.worker_epoch, r.capacity, r.occupancy,
         GREATEST(
           r.occupancy - (CASE WHEN EXISTS (SELECT 1 FROM public.tb_arena_account_lease l0
                                             WHERE l0.id_user = $2 AND l0.environment_id = r.environment_id AND l0.shard = r.shard
                                               AND l0.lease_until > clock_timestamp()) THEN 1 ELSE 0 END),
           (SELECT COUNT(*)::int FROM (
              SELECT l.id_user FROM public.tb_arena_account_lease l
               WHERE l.environment_id = r.environment_id AND l.shard = r.shard AND l.lease_until > clock_timestamp() AND l.id_user <> $2
              UNION
              SELECT a.id_user FROM public.tb_arena_admission a
               WHERE a.environment_id = r.environment_id AND a.shard = r.shard
                 AND a.consumed_at IS NULL AND a.expires_at > clock_timestamp() AND a.id_user <> $2
           ) u)
         ) AS taken
    FROM public.tb_arena_room r WHERE r.environment_id = $1 ORDER BY r.shard`;

/** Mesma conta, por processo (teto de jogadores do processo). */
const WORKER_TAKEN = `
  SELECT worker_id, COUNT(DISTINCT id_user)::int AS n FROM (
    SELECT l.worker_id, l.id_user FROM public.tb_arena_account_lease l
     WHERE l.lease_until > clock_timestamp() AND l.id_user <> $1
    UNION ALL
    SELECT a.worker_id, a.id_user FROM public.tb_arena_admission a
     WHERE a.consumed_at IS NULL AND a.expires_at > clock_timestamp() AND a.id_user <> $1
  ) t GROUP BY worker_id`;

const LIVE_WORKERS = `SELECT worker_id, epoch, endpoint, max_players, max_rooms, room_capacity, players, rooms, state
                        FROM public.tb_arena_worker
                       WHERE state = 'available' AND lease_until > clock_timestamp() AND protocol_version = $1`;

/**
 * Admissão: escolhe processo e sala e emite o ticket. Ordem:
 *   - conta com lease vivo: SÓ o processo dela (controle único entre processos);
 *   - sala ESTRITA (escolha da pessoa): essa ou recusa; inexistente nasce no
 *     processo dela (ou no menos cheio, se a conta não tem processo);
 *   - preferência: essa se tiver vaga; senão a de menor número com vaga;
 *   - sem vaga: sala nova no processo menos carregado com espaço;
 *   - nada disso: 503 (fila/indisponibilidade honesta, com tempo de espera).
 */
async function admit(ctx, body, { db = pool } = {}) {
  if (!onlyKeys(body, ["environmentId", "shard", "strict", "protocolVersion"])) return fail(400, "invalid_input", "Campo não aceito");
  const b = body;
  if (typeof b.environmentId !== "string" || !ENV_ID.test(b.environmentId)) return fail(400, "invalid_input", "environmentId");
  if (b.shard !== null && b.shard !== undefined && !intIn(b.shard, 0, 10_000)) return fail(400, "invalid_input", "shard");
  if (b.strict !== undefined && typeof b.strict !== "boolean") return fail(400, "invalid_input", "strict");
  if (!intIn(b.protocolVersion, 1, 1000)) return fail(400, "invalid_input", "protocolVersion");
  const want = Number.isInteger(b.shard) ? { shard: b.shard, strict: b.strict === true } : null;
  const ticket = crypto.randomBytes(32).toString("base64url");

  return withLock(db, async (client) => {
    await sweep(client);
    const workers = (await client.query(LIVE_WORKERS, [b.protocolVersion])).rows;
    if (!workers.length) return fail(503, "no_server", "Nenhum servidor de jogo disponível agora", { retryAfterMs: 5_000 });
    // Uma conta não segura duas vagas: tickets anteriores dela não valem mais.
    await client.query(`UPDATE public.tb_arena_admission SET expires_at = clock_timestamp() WHERE id_user = $1 AND consumed_at IS NULL`, [ctx.id_user]);
    const lease = (await client.query(
      `SELECT worker_id, worker_epoch, environment_id, shard, revoke_requested_at FROM public.tb_arena_account_lease
        WHERE id_user = $1 AND lease_until > clock_timestamp()`,
      [ctx.id_user]
    )).rows[0];
    const leaseWorker = lease ? workers.find((w) => w.worker_id === lease.worker_id && Number(w.epoch) === Number(lease.worker_epoch)) : null;
    if (lease?.revoke_requested_at) return fail(409, "moving", "Saindo do servidor anterior — tente em instantes", { retryAfterMs: CONFIG.heartbeatMs });
    const candidates = leaseWorker ? [leaseWorker] : workers;
    const byId = new Map(workers.map((w) => [w.worker_id, w]));

    const rooms = (await client.query(ROOMS_OF_ENV, [b.environmentId, ctx.id_user])).rows;
    // `taken` já exclui a PRÓPRIA conta (ela não ocupa duas vagas).
    const effective = (r) => r.taken;
    const hasRoom = (r) => effective(r) < r.capacity;
    const onCandidate = (r) => candidates.some((w) => w.worker_id === r.worker_id && Number(w.epoch) === Number(r.worker_epoch));
    // Reservas vivas por processo: entram no teto de jogadores dele.
    const takenRows = (await client.query(WORKER_TAKEN, [ctx.id_user])).rows;
    const takenOf = new Map(takenRows.map((r) => [r.worker_id, r.n]));
    const loadOf = (w) => Math.max(w.players, takenOf.get(w.worker_id) ?? 0);
    const workerHasSpace = (w) => !!w && loadOf(w) < w.max_players;
    // Menos carregado pela carga EFETIVA (a reportada atrasa até a próxima batida).
    const leastLoaded = () => candidates.filter((x) => workerHasSpace(x) && x.rooms < x.max_rooms).sort((p, q) => loadOf(p) - loadOf(q) || p.worker_id.localeCompare(q.worker_id))[0];

    let room = null;
    let moved = false;
    if (want) {
      const asked = rooms.find((r) => r.shard === want.shard);
      if (asked && hasRoom(asked)) {
        if (!onCandidate(asked)) {
          // A sala existe noutro processo e a conta está presa a este: larga e tenta.
          if (leaseWorker) {
            await client.query(`UPDATE public.tb_arena_account_lease SET revoke_requested_at = clock_timestamp() WHERE id_user = $1`, [ctx.id_user]);
            return fail(409, "moving", "Trocando de servidor — tente em instantes", { retryAfterMs: CONFIG.heartbeatMs });
          }
        } else room = asked;
      } else if (want.strict) {
        if (asked) return fail(409, "room_full", "Esta sala está cheia");
      }
      if (!room && want.strict && !asked) {
        const w = leastLoaded();
        if (!w) return fail(503, "server_full", "Todas as salas estão cheias agora", { retryAfterMs: 10_000 });
        room = await createRoom(client, b.environmentId, want.shard, w);
      }
      if (!room) moved = true;
    }
    if (!room) {
      room = rooms.find((r) => hasRoom(r) && onCandidate(r) && workerHasSpace(byId.get(r.worker_id))) ?? null;
    }
    if (!room) {
      const w = leastLoaded();
      if (!w) {
        if (leaseWorker && workers.length > 1) {
          await client.query(`UPDATE public.tb_arena_account_lease SET revoke_requested_at = clock_timestamp() WHERE id_user = $1`, [ctx.id_user]);
          return fail(409, "moving", "Trocando de servidor — tente em instantes", { retryAfterMs: CONFIG.heartbeatMs });
        }
        return fail(503, "server_full", "Todas as salas estão cheias agora", { retryAfterMs: 10_000 });
      }
      let shard = 0;
      const used = new Set(rooms.map((r) => r.shard));
      while (used.has(shard)) shard++;
      room = await createRoom(client, b.environmentId, shard, w);
    }
    if (want && room.shard === want.shard) moved = false;
    const w = byId.get(room.worker_id);
    const exp = await client.query(
      `INSERT INTO public.tb_arena_admission (ticket_hash, id_user, environment_id, shard, worker_id, worker_epoch, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp() + ($7 || ' milliseconds')::interval) RETURNING expires_at`,
      [sha256(ticket), ctx.id_user, room.environment_id, room.shard, room.worker_id, room.worker_epoch, String(CONFIG.admissionTtlMs)]
    );
    return ok({
      ticket,
      endpoint: w.endpoint,
      workerId: room.worker_id,
      epoch: Number(room.worker_epoch),
      environmentId: room.environment_id,
      shard: room.shard,
      moved,
      expiresAt: exp.rows[0].expires_at.toISOString(),
    });
  });
}

async function createRoom(client, environmentId, shard, w) {
  const r = await client.query(
    `INSERT INTO public.tb_arena_room (environment_id, shard, worker_id, worker_epoch, capacity, occupancy)
     VALUES ($1, $2, $3, $4, $5, 0) RETURNING environment_id, shard, worker_id, worker_epoch, capacity, occupancy`,
    [environmentId, shard, w.worker_id, w.epoch, w.room_capacity]
  );
  w.rooms += 1;
  return { ...r.rows[0], taken: 0 };
}

/** Salas de um ambiente em processos vivos (ocupação + reservas). Ninguém identificado. */
async function listRooms(query, { db = pool } = {}) {
  const env = typeof query?.environmentId === "string" ? query.environmentId : "";
  if (!ENV_ID.test(env)) return fail(400, "invalid_input", "environmentId");
  const r = await db.query(
    `SELECT q.shard, q.capacity, q.taken AS occupancy, q.worker_id, q.worker_epoch FROM (${ROOMS_OF_ENV}) q
       JOIN public.tb_arena_worker w ON w.worker_id = q.worker_id AND w.epoch = q.worker_epoch
      WHERE w.state = 'available' AND w.lease_until > clock_timestamp()
      ORDER BY q.shard`,
    [env, "00000000-0000-0000-0000-000000000000"]
  );
  const rooms = r.rows.map((x) => ({ shard: x.shard, occupancy: Math.min(x.occupancy, x.capacity), capacity: x.capacity, full: x.occupancy >= x.capacity }));
  const capacity = rooms[0]?.capacity ?? null;
  return ok({ worldId: env, rooms, capacity });
}

module.exports = { registerWorker, heartbeat, consumeAdmission, admit, listRooms, CONFIG };
