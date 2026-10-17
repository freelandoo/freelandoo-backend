// Freelandoo Arena — coleta mínima de presença (Módulo 08, mig 284).
//
// Quem mede é o servidor de jogo (autoridade de movimento do M06): uma vez por
// minuto, FORA do tick, ele manda quem está controlando um avatar e quem está
// parado aguardando retomada, e o TRECHO (32 m) onde está. Aqui:
//   • o minuto é o do RELÓGIO DO BANCO (nunca o do servidor de jogo);
//   • a batida registra cobertura (tb_arena_presence_beat) — minuto sem batida
//     é "sem dado", nunca zero;
//   • as contagens vão sem identidade (tb_arena_presence_sample);
//   • os controladores entram em tb_arena_presence_member só para deduplicar os
//     únicos da hora/dia (abas, retomadas, shards e instâncias) e são apagados
//     depois de 48 h. Avatar "away" NUNCA entra como ativo.
// Repetir a mesma batida (retry) é inofensivo: tudo é UPSERT idempotente.

const pool = require("../databases");
const { createLogger } = require("../utils/logger");

const log = createLogger("ArenaPresenceService");

const ENV_ID = /^br-[a-z]{2}$/;
const PLAYER_ID = /^pl_[A-Za-z0-9]{10,32}$/;
const INSTANCE_ID = /^[A-Za-z0-9._-]{1,64}$/;
const CHUNK_M = 32;
const MAX_PLAYERS = 10_000;
const MEMBER_RETENTION = "48 hours";
const SAMPLE_RETENTION = "90 days";

const fail = (status, code, error) => ({ status, body: { error, code } });

function parse(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "corpo" };
  const keys = Object.keys(body);
  if (keys.some((k) => k !== "instanceId" && k !== "players")) return { error: "campo não aceito" };
  if (typeof body.instanceId !== "string" || !INSTANCE_ID.test(body.instanceId)) return { error: "instanceId" };
  if (!Array.isArray(body.players) || body.players.length > MAX_PLAYERS) return { error: "players" };
  const players = [];
  for (const p of body.players) {
    if (!p || typeof p !== "object" || Array.isArray(p)) return { error: "player" };
    if (Object.keys(p).some((k) => !["playerId", "environmentId", "state", "x"].includes(k))) return { error: "player.campo" };
    if (typeof p.playerId !== "string" || !PLAYER_ID.test(p.playerId)) return { error: "playerId" };
    if (typeof p.environmentId !== "string" || !ENV_ID.test(p.environmentId)) return { error: "environmentId" };
    if (p.state !== "controlling" && p.state !== "away") return { error: "state" };
    if (!Number.isFinite(p.x) || p.x < 0 || p.x > 3_200_000) return { error: "x" };
    players.push(p);
  }
  return { value: { instanceId: body.instanceId, players } };
}

async function ingest(body, { db = pool } = {}) {
  const parsed = parse(body);
  if (parsed.error) return fail(400, "invalid_input", `Campo inválido: ${parsed.error}`);
  const { instanceId, players } = parsed.value;
  // Deduplicação dentro da batida: a mesma conta aparece uma vez (a mais
  // forte: controlando vence parado).
  const byPlayer = new Map();
  for (const p of players) {
    const prev = byPlayer.get(p.playerId);
    if (!prev || (prev.state === "away" && p.state === "controlling")) byPlayer.set(p.playerId, p);
  }
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const clock = (await client.query(
      `SELECT date_trunc('minute', clock_timestamp()) AS minute_at,
              date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour_start`
    )).rows[0];
    await client.query(
      `INSERT INTO public.tb_arena_presence_beat (minute_at, instance_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [clock.minute_at, instanceId]
    );
    // Conta do playerId (só os que existem; desconhecido é ignorado).
    const ids = [...byPlayer.keys()];
    const owners = ids.length
      ? (await client.query(`SELECT player_id, id_user FROM public.tb_arena_player WHERE player_id = ANY($1::varchar[])`, [ids])).rows
      : [];
    const userOf = new Map(owners.map((r) => [r.player_id, r.id_user]));
    const cells = new Map();
    const members = [];
    for (const p of byPlayer.values()) {
      const idUser = userOf.get(p.playerId);
      if (!idUser) continue;
      const chunk = Math.floor(p.x / CHUNK_M);
      const key = `${p.environmentId}|${chunk}`;
      const c = cells.get(key) ?? { env: p.environmentId, chunk, controlling: 0, away: 0 };
      if (p.state === "controlling") {
        c.controlling++;
        members.push({ env: p.environmentId, idUser });
      } else c.away++;
      cells.set(key, c);
    }
    if (cells.size) {
      const list = [...cells.values()];
      // Retry da MESMA batida no mesmo minuto substitui (não soma).
      await client.query(
        `INSERT INTO public.tb_arena_presence_sample (minute_at, instance_id, environment_id, chunk_index, controlling, away)
         SELECT $1, $2, e, c, n, a FROM unnest($3::varchar[], $4::int[], $5::int[], $6::int[]) AS t(e, c, n, a)
         ON CONFLICT (minute_at, instance_id, environment_id, chunk_index)
         DO UPDATE SET controlling = EXCLUDED.controlling, away = EXCLUDED.away`,
        [clock.minute_at, instanceId, list.map((c) => c.env), list.map((c) => c.chunk), list.map((c) => c.controlling), list.map((c) => c.away)]
      );
    }
    if (members.length) {
      await client.query(
        `INSERT INTO public.tb_arena_presence_member (hour_start, environment_id, id_user)
         SELECT $1, e, u FROM unnest($2::varchar[], $3::uuid[]) AS t(e, u)
         ON CONFLICT DO NOTHING`,
        [clock.hour_start, members.map((m) => m.env), members.map((m) => m.idUser)]
      );
    }
    await client.query("COMMIT");
    return { status: 202, body: { minute: new Date(clock.minute_at).toISOString(), cells: cells.size, controlling: members.length } };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Consolida os únicos de horas e dias JÁ encerrados (UTC), por ambiente e
 * nacional. A BASE é a cobertura (batidas): toda hora/dia encerrado que teve
 * coleta ganha a linha nacional ('*'), inclusive com 0 — é essa linha que
 * marca "apurado". Ambiente sem linha num bucket apurado = 0. Bucket sem
 * linha nacional = não consolidado (a API diz "indisponível", nunca zero).
 * Idempotente (ON CONFLICT DO NOTHING): duas execuções ou duas réplicas não
 * mudam nada. Dia só é consolidado enquanto os membros (48 h) existem.
 */
async function rollup({ db = pool } = {}) {
  const hours = await db.query(
    `WITH ended AS (
       SELECT DISTINCT date_trunc('hour', b.minute_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour_start
         FROM public.tb_arena_presence_beat b
        WHERE b.minute_at >= clock_timestamp() - INTERVAL '${MEMBER_RETENTION}'
     ),
     todo AS (
       SELECT e.hour_start FROM ended e
        WHERE e.hour_start + INTERVAL '1 hour' <= clock_timestamp()
          AND NOT EXISTS (SELECT 1 FROM public.tb_arena_presence_unique u
                           WHERE u.granularity = 'hour' AND u.bucket_start = e.hour_start AND u.environment_id = '*')
     )
     INSERT INTO public.tb_arena_presence_unique (granularity, bucket_start, environment_id, unique_players)
     SELECT 'hour', m.hour_start, m.environment_id, COUNT(DISTINCT m.id_user)::int
       FROM public.tb_arena_presence_member m JOIN todo t ON t.hour_start = m.hour_start
      GROUP BY m.hour_start, m.environment_id
     UNION ALL
     SELECT 'hour', t.hour_start, '*',
            (SELECT COUNT(DISTINCT m.id_user)::int FROM public.tb_arena_presence_member m WHERE m.hour_start = t.hour_start)
       FROM todo t
     ON CONFLICT DO NOTHING`
  );
  const days = await db.query(
    `WITH ended AS (
       SELECT DISTINCT date_trunc('day', b.minute_at AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS day_start
         FROM public.tb_arena_presence_beat b
        WHERE b.minute_at >= clock_timestamp() - INTERVAL '${MEMBER_RETENTION}'
     ),
     todo AS (
       SELECT e.day_start FROM ended e
        WHERE e.day_start + INTERVAL '1 day' <= clock_timestamp()
          -- o dia inteiro ainda está dentro da retenção dos membros
          AND e.day_start >= clock_timestamp() - INTERVAL '${MEMBER_RETENTION}'
          AND NOT EXISTS (SELECT 1 FROM public.tb_arena_presence_unique u
                           WHERE u.granularity = 'day' AND u.bucket_start = e.day_start AND u.environment_id = '*')
     )
     INSERT INTO public.tb_arena_presence_unique (granularity, bucket_start, environment_id, unique_players)
     SELECT 'day', t.day_start, m.environment_id, COUNT(DISTINCT m.id_user)::int
       FROM public.tb_arena_presence_member m JOIN todo t
         ON m.hour_start >= t.day_start AND m.hour_start < t.day_start + INTERVAL '1 day'
      GROUP BY t.day_start, m.environment_id
     UNION ALL
     SELECT 'day', t.day_start, '*',
            (SELECT COUNT(DISTINCT m.id_user)::int FROM public.tb_arena_presence_member m
              WHERE m.hour_start >= t.day_start AND m.hour_start < t.day_start + INTERVAL '1 day')
       FROM todo t
     ON CONFLICT DO NOTHING`
  );
  const purgedMembers = await db.query(
    `DELETE FROM public.tb_arena_presence_member WHERE hour_start < clock_timestamp() - INTERVAL '${MEMBER_RETENTION}'`
  );
  const purgedSamples = await db.query(
    `DELETE FROM public.tb_arena_presence_sample WHERE minute_at < clock_timestamp() - INTERVAL '${SAMPLE_RETENTION}'`
  );
  await db.query(`DELETE FROM public.tb_arena_presence_beat WHERE minute_at < clock_timestamp() - INTERVAL '${SAMPLE_RETENTION}'`);
  return { hours: hours.rowCount, days: days.rowCount, purgedMembers: purgedMembers.rowCount, purgedSamples: purgedSamples.rowCount };
}

let sweeper = null;
function startSweeper({ intervalMs = 5 * 60_000 } = {}) {
  if (sweeper) return sweeper;
  const run = () => rollup().catch((err) => log.error("rollup.fail", { message: err?.message, code: err?.code }));
  sweeper = setInterval(run, intervalMs);
  sweeper.unref?.();
  setTimeout(run, 15_000).unref?.();
  return sweeper;
}

module.exports = { ingest, rollup, startSweeper, CHUNK_M, parse };
