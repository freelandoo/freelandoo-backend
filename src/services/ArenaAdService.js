// Freelandoo Arena — outdoors e mídia (Módulo 11).
//
// Entrega (público, sem dado pessoal): o que cada espaço comercial mostra
// AGORA, pelo relógio do banco. Sem campanha válida: `content: null` e o jogo
// mostra arte neutra (nada de "anuncie aqui").
//
// Sessão de vídeo (pessoal): o servidor cria a sessão, guarda o hash do nonce,
// credita o tempo pelo SEU relógio e decide a conclusão. O navegador manda
// sinais (tocando? visível? velocidade? ponteiro da mídia? houve seek/pausa?),
// nunca o tempo assistido. Política em utils/arenaAds.VIDEO_POLICY.
//
// Sinais do cliente (renderizado/exposição/modal/CTA) são SINAIS, não prova de
// atenção nem faturamento: deduplicados por conta + espaço + criativo/versão +
// tipo + hora UTC, e sempre não incentivados.

const crypto = require("node:crypto");
const pool = require("../databases");
const Ads = require("../storages/ArenaAdStorage");
const Missions = require("../storages/ArenaMissionStorage");
const MissionService = require("./ArenaMissionService");
const rules = require("../utils/arenaAds");
const arenaRules = require("../utils/arenaRules");
const { createLogger } = require("../utils/logger");

const log = createLogger("ArenaAdService");
const P = rules.VIDEO_POLICY;

const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const ok = (body, status = 200) => ({ status, body });
const iso = (d) => (d ? new Date(d).toISOString() : null);
const ms = (d) => new Date(d).getTime();

/** Nonce DERIVADO (HMAC do id da sessão): a repetição idempotente da criação devolve o mesmo. */
function nonceFor(id_session) {
  const secret = process.env.ARENA_SERVICE_SECRET || process.env.JWT_SECRET || "";
  return crypto.createHmac("sha256", `arena-video:${secret}`).update(id_session).digest("base64url");
}
const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");
function sameSecret(a, b) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const contentDto = (d) =>
  d && d.id_creative
    ? {
        campaignId: d.id_campaign,
        creativeId: d.id_creative,
        creativeVersion: d.version,
        contentKey: d.content_hash.slice(0, 16),
        sponsor: d.sponsor_label,
        demo: d.is_demo,
        kind: d.kind,
        farRef: d.far_ref,
        nearRef: d.near_ref,
        alt: d.alt_text,
      }
    : null;

// ─── Entrega pública ────────────────────────────────────────────────────────

async function listPlacements(query, { db = pool } = {}) {
  const env = query?.environmentId;
  if (!rules.isEnvironmentId(env)) return fail(400, "invalid_input", "environmentId");
  const [rows, next, now] = await Promise.all([Ads.listDeliveries(db, env), Ads.nextChange(db, env), Ads.now(db)]);
  const nowMs = ms(now);
  // Próxima mudança conhecida (fim de algo entregue, início agendado), com teto
  // de 5 min e piso de 30 s: o cliente pergunta de novo nessa hora, não a cada quadro.
  let until = nowMs + 5 * 60_000;
  for (const r of rows) if (r.id_creative) until = Math.min(until, ms(r.booking_ends_at), ms(r.campaign_ends_at));
  if (next) until = Math.min(until, ms(next));
  until = Math.max(until, nowMs + 30_000);
  return ok({
    environmentId: env,
    serverTime: iso(now),
    validUntil: iso(new Date(until)),
    placements: rows.map((r) => ({
      placementId: r.placement_id,
      instanceId: r.instance_id,
      slot: r.slot,
      assetId: r.asset_id,
      mapVersion: r.map_version,
      generatorVersion: r.generator_version,
      content: contentDto(r),
    })),
  });
}

async function getPlacement(placementId, { db = pool } = {}) {
  if (!rules.isPlacementId(placementId)) return fail(400, "invalid_input", "placementId");
  const d = await Ads.getDelivery(db, placementId);
  if (!d || !d.is_active || d.slot_class !== "commercial") return fail(404, "unknown_placement", "Espaço desconhecido");
  const content = contentDto(d);
  return ok({
    placementId: d.placement_id,
    environmentId: d.environment_id,
    serverTime: iso(await Ads.now(db)),
    content: content
      ? {
          ...content,
          headline: d.headline,
          body: d.body,
          posterRef: d.poster_ref,
          hasVideo: d.kind === "video",
          videoDurationMs: d.kind === "video" ? d.video_duration_ms : null,
          cta: d.cta_url ? { label: d.cta_label, url: d.cta_url } : null,
        }
      : null,
  });
}

// ─── Sinais do cliente ──────────────────────────────────────────────────────

async function ingestSignals(ctx, body, { db = pool } = {}) {
  const picked = arenaRules.pickBody(body, ["events"]);
  if (!picked.ok) return fail(400, "invalid_input", `Campo não aceito: ${picked.field}`);
  const events = picked.value.events;
  if (!Array.isArray(events) || events.length < 1 || events.length > 20) return fail(400, "invalid_input", "events (1–20)");
  let accepted = 0;
  let duplicates = 0;
  let rejected = 0;
  for (const e of events) {
    const fine =
      e &&
      typeof e === "object" &&
      !Array.isArray(e) &&
      Object.keys(e).every((k) => ["type", "placementId", "creativeId", "creativeVersion"].includes(k)) &&
      rules.SIGNAL_TYPES.includes(e.type) &&
      rules.isPlacementId(e.placementId) &&
      arenaRules.isUuid(e.creativeId) &&
      Number.isInteger(e.creativeVersion) &&
      e.creativeVersion >= 1;
    if (!fine) {
      rejected++;
      continue;
    }
    const id_campaign = await Ads.signalTarget(db, e);
    if (!id_campaign) {
      rejected++;
      continue;
    }
    const inserted = await Ads.insertSignal(db, {
      id_user: ctx.id_user,
      placement_id: e.placementId,
      id_creative: e.creativeId,
      creative_version: e.creativeVersion,
      id_campaign,
      signal_type: e.type,
      incentivized: false,
    });
    if (inserted) accepted++;
    else duplicates++;
  }
  return ok({ accepted, duplicates, rejected });
}

// ─── Sessão de vídeo ────────────────────────────────────────────────────────

const sessionDto = (s, extra = {}) => ({
  sessionId: s.id_session,
  state: s.state,
  reason: s.terminal_reason,
  durationMs: s.duration_ms,
  creditedMs: s.credited_ms,
  expiresAt: iso(s.expires_at),
  lastSeq: s.last_seq,
  ...extra,
});

async function createVideoSession(ctx, body, { db = pool } = {}) {
  const picked = arenaRules.pickBody(body, ["placementId", "requestId"]);
  if (!picked.ok) return fail(400, "invalid_input", `Campo não aceito: ${picked.field}`);
  const { placementId, requestId } = picked.value;
  if (!rules.isPlacementId(placementId)) return fail(400, "invalid_input", "placementId");
  if (!arenaRules.isUuid(requestId)) return fail(400, "invalid_input", "requestId");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await Ads.lockAccount(client, ctx.id_user);
    const existing = await Ads.findSessionByRequest(client, ctx.id_user, requestId);
    if (existing) {
      await client.query("ROLLBACK");
      if (existing.placement_id !== placementId) return fail(409, "request_conflict", "Este pedido já foi usado com outro conteúdo");
      return ok(await sessionStart(db, existing, ctx));
    }
    if ((await Ads.countSessionsToday(client, ctx.id_user)) >= P.maxSessionsPerDay) {
      await client.query("ROLLBACK");
      return fail(429, "daily_limit", "Limite diário de reproduções atingido");
    }
    const d = await Ads.getDelivery(client, placementId);
    if (!d || !d.is_active || d.slot_class !== "commercial") {
      await client.query("ROLLBACK");
      return fail(404, "unknown_placement", "Espaço desconhecido");
    }
    if (!d.id_creative || d.kind !== "video") {
      await client.query("ROLLBACK");
      return fail(409, "no_video", "Este espaço não tem vídeo disponível agora");
    }
    // Duas abas não acumulam: a sessão anterior sai antes da nova existir.
    await Ads.supersedeOpen(client, ctx.id_user);
    const offer = await MissionService.videoRewardOffer(client, ctx);
    const id_session = crypto.randomUUID();
    const s = await Ads.insertSession(client, {
      id_session,
      id_user: ctx.id_user,
      request_id: requestId,
      placement_id: placementId,
      id_campaign: d.id_campaign,
      id_creative: d.id_creative,
      creative_version: d.version,
      policy_version: P.version,
      nonce_hash: sha(nonceFor(id_session)),
      duration_ms: d.video_duration_ms,
      incentivized: offer.offered,
      ttl_ms: d.video_duration_ms * P.expiryFactor + P.expirySlackMs,
    });
    await client.query("COMMIT");
    return ok(await sessionStart(db, s, ctx, d, offer), 201);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err?.code === "23505") return fail(409, "busy", "Outra reprodução começou ao mesmo tempo. Tente de novo.");
    throw err;
  } finally {
    client.release();
  }
}

async function sessionStart(db, s, ctx, d = null, offer = null) {
  const delivery = d || (await db.query(`SELECT video_ref, poster_ref FROM public.tb_arena_ad_creative WHERE id_creative = $1`, [s.id_creative])).rows[0];
  const reward = offer || (await (async () => {
    const c = await db.connect();
    try {
      return await MissionService.videoRewardOffer(c, ctx);
    } finally {
      c.release();
    }
  })());
  return {
    ...sessionDto(s),
    nonce: nonceFor(s.id_session),
    videoRef: delivery.video_ref,
    posterRef: delivery.poster_ref,
    creativeVersion: s.creative_version,
    policy: { version: P.version, heartbeatMs: P.heartbeatMs, creditRatio: P.creditRatio, positionRatio: P.positionRatio, maxRate: P.maxRate },
    reward: { offered: !!reward.offered && s.incentivized, missionKey: reward.missionKey ?? null, xp: reward.rewardXp ?? null, reason: reward.offered ? null : reward.reason },
  };
}

async function videoSignal(ctx, id_session, body, { db = pool } = {}) {
  if (!arenaRules.isUuid(id_session)) return fail(404, "unknown_session", "Sessão desconhecida");
  const parsed = rules.parseVideoSignal(body);
  if (parsed.error) return fail(400, "invalid_input", `Campo inválido: ${parsed.error}`);
  const sig = parsed.value;
  const client = await db.connect();
  let completed = false;
  let boostResult = null;
  try {
    await client.query("BEGIN");
    await Ads.lockAccount(client, ctx.id_user);
    // De OUTRA conta: não existe (mesma resposta de id inventado).
    const s = await Ads.getSession(client, ctx.id_user, id_session, { forUpdate: true });
    if (!s || !sameSecret(sha(sig.nonce), s.nonce_hash)) {
      await client.query("ROLLBACK");
      return fail(404, "unknown_session", "Sessão desconhecida");
    }
    // Mesmo sinal reenviado (rede): mesmo resultado, sem crédito novo.
    if (sig.seq === s.last_seq && parsed.hash === s.last_hash) {
      await client.query("ROLLBACK");
      return ok(sessionDto(s, { replayed: true }));
    }
    if (s.state !== "open") {
      await client.query("ROLLBACK");
      return fail(s.state === "expired" ? 410 : 409, `session_${s.state}`, "Esta reprodução já terminou", { session: sessionDto(s) });
    }
    if (sig.seq !== s.last_seq + 1) {
      await client.query("ROLLBACK");
      return fail(409, sig.seq <= s.last_seq ? "sequence_replay" : "sequence_gap", "Sinal fora de ordem", { session: sessionDto(s) });
    }
    const now = await Ads.now(client);
    const nowMs = ms(now);
    if (nowMs >= ms(s.expires_at)) {
      const x = await Ads.updateSession(client, s.id_session, { state: "expired", terminal_reason: "expired", ended_at: now });
      await client.query("COMMIT");
      return fail(410, "session_expired", "A reprodução expirou", { session: sessionDto(x) });
    }
    if (s.last_signal_at && nowMs - ms(s.last_signal_at) < P.minIntervalMs) {
      await client.query("ROLLBACK");
      return fail(429, "too_fast", "Sinais rápidos demais");
    }
    // Campanha pausada/encerrada/retirada no meio: sessão cancelada, sem recompensa.
    if (!(await Ads.isStillDeliverable(client, s))) {
      const x = await Ads.updateSession(client, s.id_session, { state: "cancelled", terminal_reason: "campaign_unavailable", ended_at: now, last_seq: sig.seq, last_hash: parsed.hash });
      await client.query("COMMIT");
      return fail(409, "campaign_unavailable", "Este conteúdo saiu do ar", { session: sessionDto(x) });
    }
    const c = rules.creditInterval(
      { playing: s.playing, lastSignalAtMs: s.last_signal_at ? ms(s.last_signal_at) : null, lastMediaMs: s.last_media_ms, creditedMs: s.credited_ms, maxMediaMs: s.max_media_ms },
      sig,
      nowMs,
      s.duration_ms
    );
    const patch = {
      last_seq: sig.seq,
      last_hash: parsed.hash,
      last_signal_at: now,
      last_media_ms: Math.min(sig.mediaMs, s.duration_ms + 5000),
      playing: c.playing,
      credited_ms: c.creditedMs,
      max_media_ms: c.maxMediaMs,
    };
    if (c.completed) Object.assign(patch, { state: "completed", terminal_reason: "eligible", completed_at: now, ended_at: now });
    const x = await Ads.updateSession(client, s.id_session, patch);
    if (c.completed) {
      completed = true;
      // O FATO entra na mesma transação que concluiu a sessão.
      await Missions.insertFact(client, {
        id_user: ctx.id_user,
        fact_type: "video_completed",
        source_ref: s.id_session,
        environment_id: null,
        occurred_at: now,
        payload: { placementId: s.placement_id, creativeVersion: s.creative_version, incentivized: s.incentivized },
      });
      // O x2 nasce da conclusão (mesma trava, mesma transação), nunca de um pedido do cliente.
      boostResult = s.incentivized ? await MissionService.tryActivateBoost(client, { id_user: ctx.id_user, id_session: s.id_session, is_minor: ctx.is_minor }) : { activated: false, reason: "not_incentivized" };
    }
    await client.query("COMMIT");
    if (completed) {
      log.info("video.completed", { incentivized: s.incentivized });
      await MissionService.kick(ctx.id_user, { db });
    }
    return ok(sessionDto(x, { credited: c.credit, ...(completed ? { boost: boostResult } : {}) }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function closeVideoSession(ctx, id_session, body, { db = pool } = {}) {
  if (!arenaRules.isUuid(id_session)) return fail(404, "unknown_session", "Sessão desconhecida");
  const picked = arenaRules.pickBody(body, ["nonce"]);
  if (!picked.ok || typeof picked.value.nonce !== "string") return fail(400, "invalid_input", "nonce");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await Ads.lockAccount(client, ctx.id_user);
    const s = await Ads.getSession(client, ctx.id_user, id_session, { forUpdate: true });
    if (!s || !sameSecret(sha(picked.value.nonce), s.nonce_hash)) {
      await client.query("ROLLBACK");
      return fail(404, "unknown_session", "Sessão desconhecida");
    }
    if (s.state !== "open") {
      await client.query("ROLLBACK");
      return ok(sessionDto(s));
    }
    const x = await Ads.updateSession(client, s.id_session, { state: "closed", terminal_reason: "closed_by_player", ended_at: await Ads.now(client), playing: false });
    await client.query("COMMIT");
    return ok(sessionDto(x));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// ─── Métricas operacionais (administração) ──────────────────────────────────

/**
 * Agregados de UMA campanha num intervalo [from, to). Cada métrica diz o
 * estado: `observed` (com contagem, que pode ser 0), `no_data` (a campanha não
 * esteve no ar no intervalo) ou `unavailable` (não medida na V1).
 */
async function metrics(query, { db = pool } = {}) {
  if (!rules.isCampaignCode(query?.campaign)) return fail(400, "invalid_input", "campaign");
  const from = query.from ? new Date(query.from) : new Date(Date.now() - 7 * 86_400_000);
  const to = query.to ? new Date(query.to) : new Date();
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from) return fail(400, "invalid_input", "from/to");
  const c = await Ads.getCampaignByCode(db, query.campaign);
  if (!c) return fail(404, "unknown_campaign", "Campanha desconhecida");
  const live = new Date(c.starts_at) < to && from < new Date(c.ends_at);
  const sig = (
    await db.query(
      `SELECT signal_type, incentivized, COUNT(*)::int AS n, COUNT(DISTINCT id_user)::int AS accounts
         FROM public.tb_arena_ad_signal
        WHERE id_campaign = $1 AND bucket_start >= date_trunc('hour', $2::timestamptz) AND bucket_start < $3
        GROUP BY signal_type, incentivized`,
      [c.id_campaign, from, to]
    )
  ).rows;
  const vid = (
    await db.query(
      `SELECT incentivized,
              COUNT(*)::int AS started,
              COALESCE(SUM(credited_ms), 0)::bigint AS eligible_ms,
              COUNT(*) FILTER (WHERE state = 'completed')::int AS completed
         FROM public.tb_arena_ad_video_session
        WHERE id_campaign = $1 AND started_at >= $2 AND started_at < $3
        GROUP BY incentivized`,
      [c.id_campaign, from, to]
    )
  ).rows;
  const rewards = (
    await db.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_arena_xp_grant g
         JOIN public.tb_arena_fact f ON f.id_fact = g.id_fact AND f.fact_type = 'video_completed'
         JOIN public.tb_arena_ad_video_session s ON s.id_session::text = f.source_ref
        WHERE s.id_campaign = $1 AND g.granted_at >= $2 AND g.granted_at < $3`,
      [c.id_campaign, from, to]
    )
  ).rows[0].n;
  const metric = (n, extra = {}) => (live ? { state: "observed", count: n, ...extra } : { state: "no_data" });
  const sum = (type, inc) => sig.filter((r) => r.signal_type === type && (inc === undefined || r.incentivized === inc)).reduce((a, r) => a + r.n, 0);
  const v = (inc) => vid.find((r) => r.incentivized === inc) || { started: 0, eligible_ms: 0, completed: 0 };
  return ok({
    campaign: { code: c.code, sponsor: c.sponsor_label, demo: c.is_demo },
    range: { from: from.toISOString(), to: to.toISOString() },
    note: "Sinais de cliente e sessões do servidor. Não é faturamento auditado nem prova de atenção humana.",
    metrics: {
      delivered: { state: "unavailable", reason: "a lista de espaços é pública e cacheada; não medida por espaço na V1" },
      rendered: metric(sum("rendered")),
      exposureEstimated: metric(sum("exposure"), { definition: "≥50% do slot visível na área do jogo por ≥1 s, aba visível, sem painel cobrindo; sem oclusão" }),
      modalOpened: metric(sum("modal_open")),
      ctaClicked: metric(sum("cta_click"), { note: "abrir o destino não comprova compra" }),
      videoStarted: { incentivized: metric(v(true).started), organic: metric(v(false).started) },
      videoEligibleMs: { incentivized: metric(Number(v(true).eligible_ms)), organic: metric(Number(v(false).eligible_ms)) },
      videoCompletedEligible: { incentivized: metric(v(true).completed), organic: metric(v(false).completed) },
      rewardsGranted: metric(rewards),
    },
  });
}

let sweeper = null;
function startSweeper({ intervalMs = 60_000 } = {}) {
  if (sweeper) return sweeper;
  let tick = 0;
  const run = async () => {
    try {
      await Ads.expireOpenSessions(pool);
      // Descarte de retenção uma vez por dia (1440 voltas de 1 min).
      if (tick++ % 1440 === 0) await Ads.purgeOld(pool, 90);
    } catch (err) {
      log.error("sweeper.fail", { message: err?.message });
    }
  };
  sweeper = setInterval(run, intervalMs);
  sweeper.unref?.();
  return sweeper;
}

module.exports = { listPlacements, getPlacement, ingestSignals, createVideoSession, videoSignal, closeVideoSession, metrics, startSweeper, nonceFor };
