// Freelandoo Arena — território (Módulo 07). Autoridade PERSISTENTE do
// checkpoint: conta, preferência ativa, cota da janela, agregado e apuração.
// A autoridade ESPACIAL (o jogador estava mesmo perto do poste?) é do servidor
// de jogo, que chega aqui pelo canal assinado (arenaServiceAuth) e ainda assim
// é conferido contra o registro canônico do poste.
//
// Regras V1 PROPOSTAS (aguardam validação do proprietário antes de valer em
// produção — o poste só pontua com `competitive = TRUE`):
//   A. uma participação por conta + ambiente + poste + categoria + hora UTC;
//   B. pedido explícito, dentro do raio do poste;
//   C. empate = sem líder único (status "tie");
//   D. zero participações = neutro;
//   E. nova hora = contagem nova (nada é herdado).
//
// Fluxo transacional (ordem de travas: jogador → disputa):
//   1. trava o jogador (mesma trava das escritas do M05 — troca de equipe e
//      checkpoint não se cruzam);
//   2. requestId já usado? mesmo conteúdo → devolve o resultado original;
//      conteúdo diferente → 409 request_conflict;
//   3. poste existe no ambiente, vigente, competitivo; posição atestada dentro
//      do raio REGISTRADO;
//   4. seleção ativa válida AGORA (catálogo, política, consentimento, menor);
//   5. janela pelo relógio do banco; tem que ser a janela pretendida;
//   6. trava a disputa; insere o fato se a cota deixar; incrementa e recalcula
//      líder/empate; nova revisão (feed de recuperação);
//   7. COMMIT — só então a resposta (que o servidor de jogo publica).

const crypto = require("node:crypto");
const pool = require("../databases");
const ArenaStorage = require("../storages/ArenaStorage");
const Territory = require("../storages/ArenaTerritoryStorage");
const Missions = require("../storages/ArenaMissionStorage");
const rules = require("../utils/arenaRules");
const { createLogger } = require("../utils/logger");

const log = createLogger("ArenaTerritoryService");

const RULE_VERSION = 1;
const HOUR_MS = 3_600_000;
/** Folga de medição entre o raio do jogo e o do registro (cm de arredondamento). */
const RANGE_TOLERANCE_M = 0.05;
const ENV_ID = /^br-[a-z]{2}$/;
const POST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const includeSynthetic = () => process.env.NODE_ENV !== "production";
const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const okRes = (body, status = 200) => ({ status, body });

const iso = (d) => new Date(d).toISOString();
const windowOf = (start) => ({ startsAt: iso(start), endsAt: iso(new Date(new Date(start).getTime() + HOUR_MS)) });

/** Líder ou empate a partir das contagens. Pura (testada em test/unit). */
function decide(counts) {
  let max = 0;
  let total = 0;
  for (const c of counts) {
    total += c.count;
    if (c.count > max) max = c.count;
  }
  if (max === 0) return { status: "neutral", leader_team_id: null, tied: [], total };
  const top = counts.filter((c) => c.count === max).map((c) => c.team_id).sort();
  if (top.length > 1) return { status: "tie", leader_team_id: null, tied: top, total };
  return { status: "leader", leader_team_id: top[0], tied: [], total };
}

/** DTO público: sem autor; em categoria sensível, sem contagens. */
function stateDto(row, counts, sensitive) {
  const list = counts.map((c) => ({ teamId: c.team_id ?? c.teamId, count: Number(c.count) })).filter((c) => c.count > 0);
  const d = decide(list.map((c) => ({ team_id: c.teamId, count: c.count })));
  return {
    environmentId: row.environment_id,
    postId: row.post_id,
    categoryId: row.category_id,
    window: windowOf(row.window_start),
    status: row.status,
    leaderTeamId: row.leader_team_id || null,
    tiedTeamIds: row.status === "tie" ? d.tied : [],
    counts: sensitive ? null : list,
    total: sensitive ? null : Number(row.total),
    revision: Number(row.revision),
  };
}

function requestHash(b) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify([b.environmentId, b.postId, b.windowStart, b.expectedCategoryId ?? null]))
    .digest("hex");
}

function parseBody(body) {
  const picked = rules.pickBody(body, ["requestId", "environmentId", "postId", "windowStart", "expectedCategoryId", "position"]);
  if (!picked.ok) return { error: `campo não aceito: ${picked.field}` };
  const b = picked.value;
  if (!rules.isUuid(b.requestId)) return { error: "requestId" };
  if (typeof b.environmentId !== "string" || !ENV_ID.test(b.environmentId)) return { error: "environmentId" };
  if (typeof b.postId !== "string" || b.postId.length > 64 || !POST_ID.test(b.postId)) return { error: "postId" };
  if (typeof b.windowStart !== "string" || Number.isNaN(Date.parse(b.windowStart)) || Date.parse(b.windowStart) % HOUR_MS !== 0) {
    return { error: "windowStart" };
  }
  if (b.expectedCategoryId !== null && !rules.isCategoryId(b.expectedCategoryId)) return { error: "expectedCategoryId" };
  const p = b.position;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).some((k) => k !== "x" && k !== "y")) return { error: "position" };
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 20_000 || Math.abs(p.y) > 20_000) return { error: "position" };
  return { value: { ...b, windowStart: iso(b.windowStart) } };
}

async function replyFromExisting(conn, existing, hash) {
  if (existing.request_hash !== hash) {
    return fail(409, "request_conflict", "Este pedido já foi usado com outro conteúdo");
  }
  const key = existing;
  const [state] = (
    await conn.query(
      `SELECT environment_id, post_id, category_id, window_start, status, leader_team_id, total, revision
         FROM public.tb_arena_territory_state
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    )
  ).rows;
  const counts = await Territory.getCounts(conn, key);
  const sensitive = await Territory.isSensitive(conn, key.category_id);
  return okRes({
    result: "accepted",
    requestId: undefined,
    categoryId: existing.category_id,
    teamId: existing.team_id,
    window: windowOf(existing.window_start),
    state: stateDto(state, counts, sensitive),
  });
}

async function checkpoint(ctx, body, { db = pool } = {}) {
  const parsed = parseBody(body);
  if (parsed.error) return fail(400, "invalid_input", `Campo inválido: ${parsed.error}`);
  const b = parsed.value;
  const hash = requestHash(b);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // 1. Jogador travado (precisa existir: quem pede checkpoint já abriu sessão).
    const player = await ArenaStorage.getPlayer(client, ctx.id_user, { forUpdate: true });
    // 2. Idempotência da operação.
    const existing = await Territory.findByRequest(client, ctx.id_user, b.requestId);
    if (existing) {
      const out = await replyFromExisting(client, existing, hash);
      await client.query("ROLLBACK");
      if (out.body.requestId === undefined) out.body.requestId = b.requestId;
      return out;
    }
    // 3. Poste canônico.
    const post = await Territory.getPost(client, b.environmentId, b.postId);
    if (!post || !post.is_active || !post.in_force) {
      await client.query("ROLLBACK");
      return fail(404, "unknown_post", "Este poste não existe neste ambiente");
    }
    if (!post.competitive) {
      await client.query("ROLLBACK");
      return fail(422, "not_competitive", "Este poste ainda não está valendo para a disputa");
    }
    if (Math.hypot(b.position.x - post.x, b.position.y - post.y) > post.radius_m + RANGE_TOLERANCE_M) {
      await client.query("ROLLBACK");
      return fail(422, "out_of_range", "Fora do alcance do poste");
    }
    // 4. Seleção ativa ATUAL e válida.
    if (!player || !player.active_category_id) {
      await client.query("ROLLBACK");
      return fail(422, "no_active", "Escolha uma equipe e ative a participação");
    }
    if (b.expectedCategoryId !== null && b.expectedCategoryId !== player.active_category_id) {
      await client.query("ROLLBACK");
      return fail(409, "category_mismatch", "Sua participação ativa mudou. Confira antes de marcar.", {
        activeCategoryId: player.active_category_id,
      });
    }
    const prefs = await ArenaStorage.listPreferences(client, ctx.id_user, { includeSynthetic: includeSynthetic() });
    const active = prefs.find((p) => p.category_id === player.active_category_id);
    if (!active || !active.valid) {
      await client.query("ROLLBACK");
      return fail(422, "category_unavailable", "Sua participação ativa não está valendo agora");
    }
    const sensitive = await Territory.isSensitive(client, active.category_id);
    if (sensitive && ctx.is_minor) {
      await client.query("ROLLBACK");
      return fail(403, "minor_restricted", "Contas supervisionadas não participam desta categoria");
    }
    // 5. Janela pelo relógio do banco.
    const clock = await Territory.clock(client);
    if (iso(clock.window_start) !== b.windowStart) {
      await client.query("ROLLBACK");
      return fail(409, "window_changed", "A hora virou. Marque de novo, se quiser, na janela nova.", {
        window: windowOf(clock.window_start),
      });
    }
    const key = { environment_id: b.environmentId, post_id: b.postId, category_id: active.category_id, window_start: clock.window_start };
    // 6. Disputa travada.
    const locked = await Territory.lockDispute(client, key);
    if (locked.closed_at || new Date(locked.now).getTime() >= new Date(clock.window_start).getTime() + HOUR_MS) {
      await client.query("ROLLBACK");
      return fail(409, "window_changed", "A hora virou. Marque de novo, se quiser, na janela nova.");
    }
    let inserted;
    try {
      inserted = await Territory.insertCheckpoint(client, {
        id_user: ctx.id_user,
        ...key,
        team_id: active.team_id,
        request_id: b.requestId,
        request_hash: hash,
        rule_version: RULE_VERSION,
      });
    } catch (err) {
      // A hora virou entre a trava e a inserção (CHECK da janela).
      if (err?.code === "23514") {
        await client.query("ROLLBACK");
        return fail(409, "window_changed", "A hora virou. Marque de novo, se quiser, na janela nova.");
      }
      throw err;
    }
    if (!inserted) {
      // Cota da janela já usada (outra aba, outro shard, outra equipe).
      const counts = await Territory.getCounts(client, key);
      const row = { ...locked };
      await client.query("ROLLBACK");
      return okRes({
        result: "already_done",
        requestId: b.requestId,
        categoryId: active.category_id,
        teamId: active.team_id,
        window: windowOf(key.window_start),
        state: stateDto(row, counts, sensitive),
      });
    }
    await Territory.incrementCount(client, key, active.team_id);
    const counts = await Territory.getCounts(client, key);
    const d = decide(counts);
    const updated = await Territory.updateState(client, key, d);
    // Fato para as missões (M12), NA MESMA transação do checkpoint aceito: não
    // se perde entre o commit e o processamento. Sem categoria nem equipe —
    // a missão não precisa da preferência (dado sensível) para contar.
    await Missions.insertFact(client, {
      id_user: ctx.id_user,
      fact_type: "checkpoint_accepted",
      source_ref: inserted.id_checkpoint,
      environment_id: key.environment_id,
      occurred_at: inserted.accepted_at,
      payload: { postId: key.post_id, windowStart: iso(key.window_start) },
    });
    await client.query("COMMIT");
    log.info("checkpoint.accepted", { environmentId: key.environment_id, postId: key.post_id, categoryId: key.category_id });
    void require("./ArenaMissionService").kick(ctx.id_user, { db });
    return okRes({
      result: "accepted",
      requestId: b.requestId,
      categoryId: active.category_id,
      teamId: active.team_id,
      window: windowOf(key.window_start),
      state: stateDto(updated, counts, sensitive),
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function feed(query, { db = pool } = {}) {
  const env = query?.environmentId;
  if (typeof env !== "string" || !ENV_ID.test(env)) return fail(400, "invalid_input", "environmentId");
  const sinceRaw = query?.since ?? "0";
  if (!/^\d{1,15}$/.test(String(sinceRaw))) return fail(400, "invalid_input", "since");
  const since = Number(sinceRaw);
  const [clock, rows, revision] = await Promise.all([Territory.clock(db), Territory.feed(db, env, since), Territory.maxRevision(db)]);
  return okRes({
    serverTime: iso(clock.now),
    currentWindow: windowOf(clock.window_start),
    revision,
    states: rows.map((r) => stateDto(r, r.counts, r.is_sensitive)),
  });
}

// ─── Apuração horária ───────────────────────────────────────────────────────

/** Fecha UMA disputa encerrada. Idempotente; dois finalizadores se serializam na trava. */
async function closeDispute(key, { db = pool } = {}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const r = await client.query(
      `SELECT closed_at, window_start + INTERVAL '1 hour' <= clock_timestamp() AS ended
         FROM public.tb_arena_territory_state
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4
        FOR UPDATE`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
    const row = r.rows[0];
    if (!row || row.closed_at || !row.ended) {
      await client.query("ROLLBACK");
      return false;
    }
    // A apuração usa os FATOS (fonte da verdade), não o agregado.
    const facts = await Territory.countsFromFacts(client, key);
    const d = decide(facts);
    const counts = Object.fromEntries(facts.map((c) => [c.team_id, c.count]));
    const inserted = await Territory.insertTally(client, key, { ...d, counts, rule_version: RULE_VERSION });
    await Territory.markClosed(client, key);
    await client.query("COMMIT");
    return inserted;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function closeEndedWindows({ db = pool, limit = 500 } = {}) {
  const ended = await Territory.listEnded(db, limit);
  let closed = 0;
  for (const key of ended) if (await closeDispute(key, { db })) closed++;
  return { scanned: ended.length, closed };
}

/**
 * Recomputa o agregado de uma disputa a partir dos fatos. Devolve se estava
 * consistente; com `fix`, corrige (contagem e estado) na mesma transação.
 */
async function recompute(key, { db = pool, fix = false } = {}) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `SELECT 1 FROM public.tb_arena_territory_state
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4 FOR UPDATE`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
    const facts = await Territory.countsFromFacts(client, key);
    const stored = await Territory.getCounts(client, key);
    const norm = (l) => JSON.stringify(l.filter((c) => c.count > 0).map((c) => [c.team_id, Number(c.count)]));
    const consistent = norm(facts) === norm(stored);
    if (!consistent && fix) {
      await Territory.replaceCounts(client, key, facts);
      await Territory.updateState(client, key, decide(facts));
      await client.query("COMMIT");
    } else {
      await client.query("ROLLBACK");
    }
    return { consistent, facts, stored };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

let sweeper = null;
function startSweeper({ intervalMs = 60_000 } = {}) {
  if (sweeper) return sweeper;
  const run = () =>
    closeEndedWindows().catch((err) => log.error("finalizer.fail", { message: err?.message, code: err?.code }));
  sweeper = setInterval(run, intervalMs);
  sweeper.unref?.();
  setTimeout(run, 5_000).unref?.();
  return sweeper;
}

module.exports = { checkpoint, feed, closeDispute, closeEndedWindows, recompute, startSweeper, decide, stateDto, RULE_VERSION };
