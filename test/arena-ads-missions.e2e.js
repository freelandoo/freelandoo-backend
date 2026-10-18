// test/arena-ads-missions.e2e.js — Freelandoo Arena, Módulos 11 + 12, pela
// HTTP DE VERDADE contra um Postgres de TESTE (recusa produção).
//
//   npm run test:arena-ads
//
// M11: registro de espaços (id derivado, classes de slot), importação de
// campanhas/criativos (versão imutável), operação (aprovar ≠ ativar, agendar,
// pausar, encerrar, reservar com conflito recusado, trocar criativo), entrega
// pública (início inclusivo, fim exclusivo, dois espaços do mesmo asset com
// campanhas diferentes, nada pendente exposto), sinais do cliente (dedupe),
// sessão de vídeo (nonce, outra conta, sequência, replay, duas abas, `ended`
// isolado, expiração, campanha retirada no meio, rápido demais, conclusão
// pelo relógio do servidor).
// M12: visita a poste pelo canal assinado, checkpoint aceito (e recusado sem
// fato), missão distinta, concessão única (sequencial e concorrente), falha
// entre etapas sem perda nem duplicação, recuperação de pendentes, versão nova
// sem reabrir o prêmio, mesma chave com conteúdo diferente = conflito, virada
// de dia UTC, processamento atrasado, isolamento entre contas, x2 (desligado,
// ligado, só XP elegível, sem retroatividade, sem empilhar, cota entre
// sessões, sem Poléns/XP global/território).

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
process.env.JWT_SECRET = `arena-ads-${crypto.randomBytes(16).toString("hex")}`;
process.env.ARENA_SERVICE_SECRET = `svc-${crypto.randomBytes(24).toString("hex")}`;
process.env.DATABASE_URL_COLD = "";
delete process.env.ARENA_BOOST_ENABLED;

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
const sleep = (n) => new Promise((r) => setTimeout(r, n));

async function main() {
  console.log("━━━ migrations (banco de teste) ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env }, stdio: "ignore" });

  const jwt = require("jsonwebtoken");
  const bcrypt = require("bcrypt");
  const pool = require("../src/databases");
  const app = require("../src/app");
  const rules = require("../src/utils/arenaAds");
  const { syncCatalog } = require("../src/services/ArenaCatalogSync");
  const { syncPosts } = require("../src/services/ArenaPostSync");
  const { syncPlacements, syncAds } = require("../src/services/ArenaAdSync");
  const { syncMissions } = require("../src/services/ArenaMissionSync");
  const ops = require("../src/services/ArenaAdOps");
  const MissionService = require("../src/services/ArenaMissionService");
  const { sign: signSvc, sha256Hex } = require("../src/middlewares/arenaServiceAuth");
  const missionsDoc = require("../src/databases/seeds/arena-missions.json");

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
    return { status: res.status, body: json, headers: res.headers };
  };

  // ─── fixtures sintéticas ───────────────────────────────────────────────────
  const stamp = Date.now().toString(36);
  const hash = await bcrypt.hash("senha-de-teste-123", 4);
  async function mkUser(tag, extra = {}) {
    const r = await pool.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo, is_minor)
       VALUES ($1, $2, $3, $4, TRUE, $5) RETURNING id_user`,
      [`Teste ${tag}`, `ad${tag}${stamp}`.slice(0, 30), `arena.ads.${tag}.${stamp}@teste.invalid`, hash, extra.is_minor ?? false]
    );
    return r.rows[0].id_user;
  }
  const tok = (id) => jwt.sign({ id_user: id, email: "x@teste.invalid" }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const U = {};
  const T = {};
  for (const tag of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
    U[tag] = await mkUser(tag);
    T[tag] = tok(U[tag]);
  }
  U.minor = await mkUser("m", { is_minor: true });
  // Menor com vínculo ATIVO (o guard da Arena exige).
  await pool.query(`INSERT INTO public.supervised_accounts (minor_user_id, responsible_user_id, status) VALUES ($1, $2, 'active')`, [U.minor, U.h]);
  T.minor = tok(U.minor);
  U.admin = await mkUser("adm");
  T.admin = tok(U.admin);
  await pool.query(`INSERT INTO public.tb_user_role (id_user, id_role, is_active) SELECT $1, id_role, TRUE FROM public.tb_role WHERE desc_role = 'Administrator'`, [U.admin]);

  const c0 = await pool.connect();
  try {
    ok((await syncCatalog(c0, require("../src/databases/seeds/arena-catalog.json"), { apply: true })).ok, "catálogo");
    const ms = await syncMissions(c0, missionsDoc, { apply: true });
    ok(ms.ok, `missões: ${JSON.stringify(ms.errors)}`);
  } finally {
    c0.release();
  }
  await pool.query(
    `INSERT INTO public.tb_arena_team (category_id, team_id, labels, is_synthetic) VALUES ('futebol', 'teste-azul', '{"pt-BR":"Azul"}'::jsonb, TRUE)
     ON CONFLICT (category_id, team_id) DO UPDATE SET is_active = TRUE`
  );

  // Postes do ambiente sintético (br-zw), NÃO competitivos, valendo já.
  const ENV = "br-zw";
  for (const tbl of ["tb_arena_checkpoint", "tb_arena_territory_count", "tb_arena_territory_state", "tb_arena_territory_tally"]) {
    await pool.query(`DELETE FROM public.${tbl} WHERE environment_id = $1`, [ENV]);
  }
  const posts = [0, 1, 2, 3].map((i) => ({ environmentId: ENV, postId: `w-p${i}-post`, mapVersion: 1, generatorVersion: 2, x: 10 + i * 64, y: -4.4, radiusM: 2.5 }));
  const pc = await pool.connect();
  try {
    ok((await syncPosts(pc, { posts }, { apply: true, competitive: false, validFromNow: true })).ok, "postes");
  } finally {
    pc.release();
  }
  // Outros testes deixam postes competitivos no banco de teste: guardados e restaurados no fim.
  const prevCompetitive = (await pool.query(`SELECT environment_id, post_id FROM public.tb_arena_post WHERE competitive`)).rows;
  await pool.query(`UPDATE public.tb_arena_post SET competitive = FALSE WHERE competitive`);

  // Espaços do ambiente sintético: dois do MESMO asset + uma tela + um decorativo.
  const mkP = (instanceId, slot, assetId, slotClass, x) => {
    const p = { environmentId: ENV, mapVersion: 1, generatorVersion: 2, instanceId, slot, assetId, slotClass, x, y: 1.2, aspect: 2 };
    return { ...p, placementId: rules.placementIdFor(p) };
  };
  const P1 = mkP("q1-l0", "art", "billboard", "commercial", 40);
  const P2 = mkP("q2-l0", "art", "billboard", "commercial", 104);
  const P3 = mkP("q3-pz-screen", "screen", "digital-screen", "commercial", 160);
  const PD = mkP("q3-banner", "art", "banner-stand", "decorative", 170);
  const placementsDoc = { placements: [P1, P2, P3, PD] };
  // Rodada anterior interrompida não pode deixar campanha de teste no ar.
  await pool.query(`UPDATE public.tb_arena_ad_campaign SET op_status = 'ended' WHERE code LIKE 't-%'`);
  await pool.query(
    `UPDATE public.tb_arena_ad_booking SET status = 'cancelled', cancelled_at = NOW()
      WHERE status = 'active' AND placement_id IN (SELECT placement_id FROM public.tb_arena_ad_placement WHERE environment_id = $1)`,
    [ENV]
  );

  console.log("\n━━━ M11 — registro de espaços ━━━");
  await check("id que não bate com a chave natural é recusado; colisão também", async () => {
    const c = await pool.connect();
    try {
      const bad = await syncPlacements(c, { placements: [{ ...P1, placementId: "ad-zw-0000000000000000" }] });
      ok(!bad.ok && bad.errors.some((e) => e.includes("chave natural")), JSON.stringify(bad));
      const dup = await syncPlacements(c, { placements: [P1, P1] });
      ok(!dup.ok && dup.errors.some((e) => e.includes("colisão")), JSON.stringify(dup));
    } finally {
      c.release();
    }
  });
  await check("simulação não grava; aplicar grava só os COMERCIAIS (decorativo fica fora)", async () => {
    const c = await pool.connect();
    try {
      const dry = await syncPlacements(c, placementsDoc, { apply: false });
      ok(dry.ok && dry.summary.ignoredNonCommercial === 1, JSON.stringify(dry));
      const n0 = (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_ad_placement WHERE environment_id = $1`, [ENV])).rows[0].n;
      const out = await syncPlacements(c, placementsDoc, { apply: true });
      ok(out.ok, JSON.stringify(out));
      const rows = (await pool.query(`SELECT placement_id, slot_class FROM public.tb_arena_ad_placement WHERE environment_id = $1 AND is_active`, [ENV])).rows;
      eq(rows.length, 3, "três comerciais");
      ok(!rows.some((r) => r.placement_id === PD.placementId), "decorativo não entrou");
      ok(n0 === 0 || n0 === 3, "simulação não gravou");
    } finally {
      c.release();
    }
  });

  console.log("\n━━━ M11 — campanhas e criativos ━━━");
  const hex = (s) => crypto.createHash("sha256").update(s + stamp).digest("hex").slice(0, 16);
  const img = (name, w, h) => [`arena/v1/ads/${hex(name)}.png`, { mime: "image/png", width: w, height: h, bytes: 4096, sha256: crypto.createHash("sha256").update(name).digest("hex") }];
  const IMG = `t-img-${stamp}`;
  const VID = `t-vid-${stamp}`;
  const [far1, far1a] = img("far1", 600, 300);
  const [near1, near1a] = img("near1", 1200, 600);
  const [far2, far2a] = img("far2", 600, 300);
  const [near2, near2a] = img("near2", 1200, 600);
  const [vfar, vfara] = img("vfar", 600, 300);
  const [vnear, vneara] = img("vnear", 1200, 600);
  const [poster, postera] = img("poster", 1280, 720);
  const vref = `arena/v1/ads/${hex("video")}.mp4`;
  const longWindow = { startsAt: "2026-01-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" };
  const adsDoc = {
    campaigns: [
      { code: IMG, sponsorLabel: "Demonstração Freelandoo Arena", responsible: "Equipe Arena (teste)", isDemo: true, ...longWindow },
      { code: VID, sponsorLabel: "Demonstração Freelandoo Arena", responsible: "Equipe Arena (teste)", isDemo: true, ...longWindow },
    ],
    creatives: [
      { campaignCode: IMG, version: 1, kind: "image", farRef: far1, nearRef: near1, assets: { [far1]: far1a, [near1]: near1a }, alt: "Arte 1", headline: "Imagem v1", ctaLabel: "Saiba mais", ctaUrl: "https://www.freelandoo.com.br/", approvedBy: "Operador de teste" },
      { campaignCode: IMG, version: 2, kind: "image", farRef: far2, nearRef: near2, assets: { [far2]: far2a, [near2]: near2a }, alt: "Arte 2", headline: "Imagem v2", approvedBy: "Operador de teste" },
      {
        campaignCode: VID,
        version: 1,
        kind: "video",
        farRef: vfar,
        nearRef: vnear,
        posterRef: poster,
        videoRef: vref,
        assets: { [vfar]: vfara, [vnear]: vneara, [poster]: postera, [vref]: { mime: "video/mp4", width: 1280, height: 720, bytes: 50_000, durationMs: 3000, sha256: "c".repeat(64) } },
        alt: "Vídeo de teste",
        headline: "Vídeo v1",
        approvedBy: "Operador de teste",
      },
    ],
  };
  const sc = await pool.connect();
  const run = async (fn) => {
    const c = await pool.connect();
    try {
      return await fn(c);
    } finally {
      c.release();
    }
  };
  try {
    await check("importar cria campanhas em rascunho e aprovação pendente; repetir não duplica", async () => {
      const a = await syncAds(sc, adsDoc, { apply: true });
      ok(a.ok && a.summary.campaignsCreated === 2 && a.summary.creativesCreated === 3, JSON.stringify(a));
      const b = await syncAds(sc, adsDoc, { apply: true });
      ok(b.ok && b.summary.creativesUnchanged === 3 && b.summary.campaignsCreated === 0, JSON.stringify(b));
      const st = await ops.status(sc, { code: IMG });
      eq([st.campaign.approval, st.campaign.op], ["pending", "draft"], "estado inicial");
    });
    await check("versão publicada é imutável (importação recusa; o banco recusa UPDATE)", async () => {
      const changed = JSON.parse(JSON.stringify(adsDoc));
      changed.creatives[0].headline = "Outro texto";
      const r = await syncAds(sc, changed, { apply: true });
      ok(!r.ok && r.errors[0].includes("imutável"), JSON.stringify(r));
      let blocked = false;
      try {
        await pool.query(`UPDATE public.tb_arena_ad_creative SET headline = 'x' WHERE far_ref = $1`, [far1]);
      } catch (e) {
        blocked = /immutable/.test(e.message);
      }
      ok(blocked, "trigger");
    });
    await check("ativar sem aprovação é recusado (aprovar ≠ ativar)", async () => {
      await ops.setCreative(sc, { code: IMG, version: 1 }, true);
      const r = await ops.activate(sc, { code: IMG }, true);
      eq(r.code, "not_approved", "recusa");
    });
    await check("criativo pendente nunca é exposto na entrega pública", async () => {
      await ops.book(sc, { code: IMG, placementId: P1.placementId }, true);
      const r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      eq(r.status, 200, "status");
      ok(r.body.placements.every((p) => p.content === null), "nada no ar");
      ok(!r.body.placements.some((p) => p.placementId === PD.placementId), "decorativo não aparece");
      const m = await call("GET", `/arena/ads/placements/${P1.placementId}`);
      eq(m.body.content, null, "modal sem conteúdo pendente");
    });
    await check("aprovar + ativar: entra no ar; simulação não muda nada", async () => {
      const dry = await ops.approve(sc, { code: IMG, by: "Operador" }, false);
      ok(dry.ok && !dry.applied, "simulação");
      eq((await ops.status(sc, { code: IMG })).campaign.approval, "pending", "simulação não gravou");
      ok((await ops.approve(sc, { code: IMG, by: "Operador" }, true)).ok, "aprovar");
      ok((await ops.activate(sc, { code: IMG }, true)).ok, "ativar");
      const r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      const p1 = r.body.placements.find((p) => p.placementId === P1.placementId);
      ok(p1.content && p1.content.creativeVersion === 1 && p1.content.demo === true, JSON.stringify(p1));
      ok(r.headers.get("cache-control").includes("max-age=30"), "cache curto");
      ok(Date.parse(r.body.validUntil) > Date.parse(r.body.serverTime), "validUntil no futuro");
    });
    await check("dois espaços do MESMO asset com campanhas diferentes", async () => {
      ok((await ops.approve(sc, { code: VID, by: "Operador" }, true)).ok, "aprovar vídeo");
      await ops.setCreative(sc, { code: VID, version: 1 }, true);
      ok((await ops.book(sc, { code: VID, placementId: P2.placementId }, true)).ok, "reservar P2");
      ok((await ops.activate(sc, { code: VID }, true)).ok, "ativar vídeo");
      const r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      const a = r.body.placements.find((p) => p.placementId === P1.placementId).content;
      const b = r.body.placements.find((p) => p.placementId === P2.placementId).content;
      ok(a && b && a.campaignId !== b.campaignId && a.contentKey !== b.contentKey, "conteúdos diferentes");
      eq(r.body.placements.find((p) => p.placementId === P1.placementId).assetId, r.body.placements.find((p) => p.placementId === P2.placementId).assetId, "mesmo asset");
    });
    await check("reserva conflitante é RECUSADA (sem sorteio)", async () => {
      const r = await ops.book(sc, { code: VID, placementId: P1.placementId }, true);
      eq(r.code, "booking_conflict", "conflito");
      const enc = await ops.book(sc, { code: VID, placementId: P1.placementId, startsAt: "2030-01-01T00:00:00Z", endsAt: "2030-02-01T00:00:00Z" }, true);
      ok(enc.ok, "encostar no fim (exclusivo) não é conflito");
    });
    await check("antes do início não entrega; no instante do início entrega", async () => {
      const now = Date.parse((await pool.query(`SELECT clock_timestamp() AS n`)).rows[0].n);
      const start = new Date(now + 1500).toISOString();
      ok((await ops.schedule(sc, { code: IMG, startsAt: start, endsAt: "2030-01-01T00:00:00Z" }, true)).ok, "agendar");
      const st = await ops.status(sc, { code: IMG });
      eq(st.derived, "scheduled", "derivado agendada");
      let r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      eq(r.body.placements.find((p) => p.placementId === P1.placementId).content, null, "antes do início");
      ok(Date.parse(r.body.validUntil) <= Date.parse(start) + 30_000, "o cliente pergunta de novo perto do início");
      await sleep(1700);
      r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      ok(r.body.placements.find((p) => p.placementId === P1.placementId).content, "depois do início");
    });
    await check("campanha encerrada pela janela (fim exclusivo) não entrega", async () => {
      const now = Date.parse((await pool.query(`SELECT clock_timestamp() AS n`)).rows[0].n);
      ok((await ops.schedule(sc, { code: IMG, startsAt: "2026-01-01T00:00:00Z", endsAt: new Date(now - 1).toISOString() }, true)).ok, "fim no passado");
      let r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      eq(r.body.placements.find((p) => p.placementId === P1.placementId).content, null, "fim passou");
      await ops.schedule(sc, { code: IMG, startsAt: "2026-01-01T00:00:00Z", endsAt: "2030-01-01T00:00:00Z" }, true);
      r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      ok(r.body.placements.find((p) => p.placementId === P1.placementId).content, "volta");
    });
    await check("pausa tira do ar; reativar devolve", async () => {
      ok((await ops.pause(sc, { code: IMG }, true)).ok, "pausar");
      let r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      eq(r.body.placements.find((p) => p.placementId === P1.placementId).content, null, "pausada");
      ok((await ops.activate(sc, { code: IMG }, true)).ok, "reativar");
      r = await call("GET", `/arena/ads/placements?environmentId=${ENV}`);
      ok(r.body.placements.find((p) => p.placementId === P1.placementId).content, "de volta");
    });
    await check("substituir criativo: nova versão, chave de conteúdo nova; retirar a versão tira do ar", async () => {
      const before = (await call("GET", `/arena/ads/placements?environmentId=${ENV}`)).body.placements.find((p) => p.placementId === P1.placementId).content;
      ok((await ops.setCreative(sc, { code: IMG, version: 2 }, true)).ok, "v2");
      const after = (await call("GET", `/arena/ads/placements?environmentId=${ENV}`)).body.placements.find((p) => p.placementId === P1.placementId).content;
      ok(after.creativeVersion === 2 && after.contentKey !== before.contentKey, "versão 2");
      ok((await ops.withdrawCreative(sc, { code: IMG, version: 2 }, true)).ok, "retirar v2");
      eq((await call("GET", `/arena/ads/placements?environmentId=${ENV}`)).body.placements.find((p) => p.placementId === P1.placementId).content, null, "sem criativo aprovado");
      ok((await ops.setCreative(sc, { code: IMG, version: 1 }, true)).ok, "volta à v1");
    });
    await check("modal: conteúdo do anunciante + CTA validado; espaço desconhecido = 404", async () => {
      const m = await call("GET", `/arena/ads/placements/${P1.placementId}`);
      ok(m.body.content.headline === "Imagem v1" && m.body.content.cta.url === "https://www.freelandoo.com.br/" && m.body.content.hasVideo === false, JSON.stringify(m.body));
      const v = await call("GET", `/arena/ads/placements/${P2.placementId}`);
      ok(v.body.content.hasVideo && v.body.content.videoDurationMs === 3000 && !("videoRef" in v.body.content), "vídeo sem ref antes da sessão");
      eq((await call("GET", `/arena/ads/placements/ad-zw-ffffffffffffffff`)).status, 404, "desconhecido");
      eq((await call("GET", `/arena/ads/placements/QUALQUER`)).status, 400, "torto");
    });
    await check("ausência de campanha válida: espaço sem reserva fica neutro", async () => {
      eq((await call("GET", `/arena/ads/placements?environmentId=${ENV}`)).body.placements.find((p) => p.placementId === P3.placementId).content, null, "P3");
    });

    console.log("\n━━━ M11 — sinais do cliente ━━━");
    const cont = (await call("GET", `/arena/ads/placements?environmentId=${ENV}`)).body.placements.find((p) => p.placementId === P1.placementId).content;
    await check("sinais exigem sessão; deduplicam por hora; incoerentes são recusados", async () => {
      const ev = { type: "exposure", placementId: P1.placementId, creativeId: cont.creativeId, creativeVersion: cont.creativeVersion };
      eq((await call("POST", "/arena/ads/signals", { body: { events: [ev] } })).status, 401, "sem token");
      const a = await call("POST", "/arena/ads/signals", { token: T.a, body: { events: [ev, ev, { ...ev, type: "rendered" }] } });
      eq(a.body, { accepted: 2, duplicates: 1, rejected: 0 }, "dedupe");
      const b = await call("POST", "/arena/ads/signals", { token: T.a, body: { events: [{ ...ev, placementId: P3.placementId }, { ...ev, type: "watched" }, { ...ev, userId: "x" }] } });
      eq(b.body, { accepted: 0, duplicates: 0, rejected: 3 }, "recusados");
      eq((await call("POST", "/arena/ads/signals", { token: T.a, body: { events: new Array(21).fill(ev) } })).status, 400, "lote grande");
    });

    console.log("\n━━━ M11 — sessão de vídeo ━━━");
    const start = (token, requestId = crypto.randomUUID(), placementId = P2.placementId) => call("POST", "/arena/ads/video-sessions", { token, body: { placementId, requestId } });
    const sig = (token, s, seq, o = {}) =>
      call("POST", `/arena/ads/video-sessions/${s.sessionId}/signals`, {
        token,
        body: { seq, nonce: s.nonce, playing: true, visible: true, rate: 1, mediaMs: 0, flags: [], ...o },
      });
    const watch = async (token, s) => {
      ok((await sig(token, s, 1, { mediaMs: 0 })).status === 200, "seq1");
      await sleep(1550);
      ok((await sig(token, s, 2, { mediaMs: 1500 })).status === 200, "seq2");
      await sleep(1550);
      return sig(token, s, 3, { mediaMs: 3000, playing: false, flags: ["ended"] });
    };
    await check("espaço só com imagem não abre sessão de vídeo", async () => {
      eq((await start(T.a, crypto.randomUUID(), P1.placementId)).body.code, "no_video", "sem vídeo");
    });
    let sA;
    await check("criar sessão: nonce, recompensa oferecida; repetir o pedido devolve a MESMA sessão", async () => {
      const rid = crypto.randomUUID();
      const r = await start(T.a, rid);
      eq(r.status, 201, `status ${JSON.stringify(r.body)}`);
      ok(r.body.nonce && r.body.videoRef === vref && r.body.reward.offered === true && r.body.reward.xp === 30, JSON.stringify(r.body));
      const again = await start(T.a, rid);
      ok(again.status === 200 && again.body.sessionId === r.body.sessionId && again.body.nonce === r.body.nonce, "idempotente");
      sA = r.body;
    });
    await check("outra conta não usa a sessão; nonce errado também não", async () => {
      eq((await sig(T.b, sA, 1)).status, 404, "outra conta");
      eq((await sig(T.a, { ...sA, nonce: "x".repeat(43) }, 1)).status, 404, "nonce errado");
    });
    await check("'ended' isolado não conclui; sequência repetida/pulada é recusada; replay idêntico é idempotente", async () => {
      ok((await sig(T.a, sA, 1, { mediaMs: 0 })).status === 200, "seq1");
      await sleep(300);
      const end = await sig(T.a, sA, 2, { mediaMs: 3000, playing: false, flags: ["ended"] });
      ok(end.status === 200 && end.body.state === "open" && end.body.creditedMs < 1000, JSON.stringify(end.body));
      const same = await sig(T.a, sA, 2, { mediaMs: 3000, playing: false, flags: ["ended"] });
      ok(same.status === 200 && same.body.replayed === true, "replay idêntico");
      eq((await sig(T.a, sA, 2, { mediaMs: 100 })).body.code, "sequence_replay", "mesmo seq, outro conteúdo");
      eq((await sig(T.a, sA, 5)).body.code, "sequence_gap", "pulo");
    });
    await check("sinais rápidos demais são recusados sem consumir a sequência", async () => {
      const r = await sig(T.a, sA, 3, { mediaMs: 0, playing: true });
      ok(r.status === 200 || r.status === 429, "primeiro");
      if (r.status === 200) {
        const fast = await sig(T.a, sA, 4, { mediaMs: 0 });
        eq(fast.body.code, "too_fast", "rápido");
      }
    });
    await check("duas abas: a sessão nova supersede a anterior (não acumula)", async () => {
      const r = await start(T.a);
      ok(r.status === 201, "segunda aba");
      eq((await sig(T.a, sA, 5)).body.code, "session_superseded", "a primeira encerrou");
      sA = r.body;
    });
    await check("conclusão pelo relógio do servidor gera UM fato e UMA concessão; callback repetido não duplica", async () => {
      const done = await watch(T.a, sA);
      ok(done.status === 200 && done.body.state === "completed", JSON.stringify(done.body));
      ok(done.body.boost && done.body.boost.activated === false && done.body.boost.reason === "disabled", "x2 desligado por padrão");
      const again = await sig(T.a, sA, 3, { mediaMs: 3000, playing: false, flags: ["ended"] });
      ok(again.body.replayed === true, "callback repetido");
      await MissionService.processPending({ db: pool, id_user: U.a });
      const facts = (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE id_user = $1 AND fact_type = 'video_completed'`, [U.a])).rows[0].n;
      eq(facts, 1, "um fato");
      const mine = (await call("GET", "/arena/me/missions", { token: T.a })).body;
      const vm = mine.missions.find((m) => m.missionKey === "sponsored-video");
      ok(vm.status === "completed" && vm.progress === 1, JSON.stringify(vm));
      eq(mine.progression.xpTotal, 30, "30 XP da Arena");
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_boost WHERE id_user = $1`, [U.a])).rows[0].n, 0, "sem bônus");
    });
    await check("depois da missão do dia, a recompensa deixa de ser oferecida (vídeo continua voluntário)", async () => {
      const r = await start(T.a);
      ok(r.status === 201 && r.body.reward.offered === false && r.body.reward.reason === "already_completed", JSON.stringify(r.body.reward));
      await call("POST", `/arena/ads/video-sessions/${r.body.sessionId}/close`, { token: T.a, body: { nonce: r.body.nonce } });
    });
    await check("campanha retirada durante a sessão: cancelada, sem recompensa", async () => {
      const r = await start(T.b);
      ok((await sig(T.b, r.body, 1)).status === 200, "seq1");
      await ops.pause(sc, { code: VID }, true);
      await sleep(300);
      const x = await sig(T.b, r.body, 2, { mediaMs: 300 });
      ok(x.body.code === "campaign_unavailable" && x.body.session.state === "cancelled", JSON.stringify(x.body));
      await ops.activate(sc, { code: VID }, true);
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE id_user = $1`, [U.b])).rows[0].n, 0, "sem fato");
    });
    await check("sessão expirada: 410 e nenhum crédito", async () => {
      const r = await start(T.b);
      await pool.query(`UPDATE public.tb_arena_ad_video_session SET expires_at = clock_timestamp() - INTERVAL '1 second' WHERE id_session = $1`, [r.body.sessionId]);
      const x = await sig(T.b, r.body, 1);
      eq(x.status, 410, "expirada");
    });
    await check("conta supervisionada: vídeo sem recompensa oferecida", async () => {
      const r = await start(T.minor);
      ok(r.status === 201 && r.body.reward.offered === false && r.body.reward.reason === "minor_restricted", JSON.stringify(r.body));
    });

    console.log("\n━━━ M12 — visitas, checkpoints e missões ━━━");
    const visit = (token, postId, pos) => call("POST", "/arena/internal/visits", { token, service: true, body: { environmentId: ENV, postId, position: pos ?? { x: posts.find((p) => p.postId === postId).x + 0.5, y: -4.2 } } });
    await check("visita exige o canal assinado; navegador direto é recusado", async () => {
      const r = await call("POST", "/arena/internal/visits", { token: T.c, body: { environmentId: ENV, postId: "w-p0-post", position: { x: 10, y: -4.4 } } });
      ok(r.status === 401 || r.status === 403, `status ${r.status}`);
    });
    await check("visita fora do raio é recusada e não vira fato", async () => {
      eq((await visit(T.c, "w-p0-post", { x: 30, y: -4.4 })).body.code, "out_of_range", "longe");
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE id_user = $1`, [U.c])).rows[0].n, 0, "sem fato");
    });
    await check("missão distinta: 3 postes diferentes = UMA concessão; repetir poste não conta", async () => {
      ok((await visit(T.c, "w-p0-post")).body.result === "recorded", "p0");
      eq((await visit(T.c, "w-p0-post")).body.result, "already_recorded", "p0 de novo");
      await visit(T.c, "w-p1-post");
      let mine = (await call("GET", "/arena/me/missions", { token: T.c })).body;
      eq(mine.missions.find((m) => m.missionKey === "explore-posts").progress, 2, "dois distintos");
      await visit(T.c, "w-p2-post");
      await visit(T.c, "w-p3-post");
      mine = (await call("GET", "/arena/me/missions", { token: T.c })).body;
      const ex = mine.missions.find((m) => m.missionKey === "explore-posts");
      ok(ex.status === "completed" && ex.progress === 3, JSON.stringify(ex));
      eq(mine.progression.xpTotal, 60, "60 XP");
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_xp_grant WHERE id_user = $1`, [U.c])).rows[0].n, 1, "uma concessão");
    });
    await check("checkpoint: indisponível enquanto nenhum poste é competitivo (sem ativar postes)", async () => {
      const mine = (await call("GET", "/arena/me/missions", { token: T.c })).body;
      eq(mine.missions.find((m) => m.missionKey === "checkpoint-daily").status, "competitive_closed", "fechada");
      const r = await call("POST", "/arena/internal/checkpoints", {
        token: T.c,
        service: true,
        body: { requestId: crypto.randomUUID(), environmentId: ENV, postId: "w-p0-post", windowStart: new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString(), expectedCategoryId: null, position: { x: 10.5, y: -4.2 } },
      });
      eq(r.body.code, "not_competitive", "não competitivo");
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE id_user = $1 AND fact_type = 'checkpoint_accepted'`, [U.c])).rows[0].n, 0, "negação não é fato");
    });
    await check("checkpoint ACEITO (poste competitivo só neste banco) vira fato; already_done não", async () => {
      await pool.query(`UPDATE public.tb_arena_post SET competitive = TRUE WHERE environment_id = $1 AND post_id = 'w-p3-post'`, [ENV]);
      await call("POST", "/arena/session", { token: T.d });
      const st = (await call("GET", "/arena/me/preferences", { token: T.d })).body;
      const p = await call("PUT", "/arena/me/preferences/futebol", { token: T.d, body: { teamId: "teste-azul", expectedRevision: st.revision, activate: true } });
      ok(p.status === 200, `preferência ${p.status}`);
      const ws = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
      const body = () => ({ requestId: crypto.randomUUID(), environmentId: ENV, postId: "w-p3-post", windowStart: ws, expectedCategoryId: null, position: { x: 202.5, y: -4.2 } });
      const a = await call("POST", "/arena/internal/checkpoints", { token: T.d, service: true, body: body() });
      eq(a.body.result, "accepted", `aceito ${JSON.stringify(a.body)}`);
      const b = await call("POST", "/arena/internal/checkpoints", { token: T.d, service: true, body: body() });
      eq(b.body.result, "already_done", "cota");
      await MissionService.processPending({ db: pool, id_user: U.d });
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_fact WHERE id_user = $1 AND fact_type = 'checkpoint_accepted'`, [U.d])).rows[0].n, 1, "um fato");
      const fact = (await pool.query(`SELECT payload FROM public.tb_arena_fact WHERE id_user = $1 AND fact_type = 'checkpoint_accepted'`, [U.d])).rows[0];
      ok(!JSON.stringify(fact.payload).includes("futebol") && !JSON.stringify(fact.payload).includes("teste-azul"), "fato sem preferência");
      const mine = (await call("GET", "/arena/me/missions", { token: T.d })).body;
      eq(mine.missions.find((m) => m.missionKey === "checkpoint-daily").status, "completed", "concluída");
      await pool.query(`UPDATE public.tb_arena_post SET competitive = FALSE WHERE environment_id = $1`, [ENV]);
    });

    // Fatos inseridos direto (o que a autoridade faria), para os casos de borda.
    const insertFact = (id_user, type, ref, at, payload = {}) =>
      pool.query(
        `INSERT INTO public.tb_arena_fact (id_user, fact_type, source_ref, environment_id, occurred_at, payload) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id_fact`,
        [id_user, type, ref, ENV, at, JSON.stringify(payload)]
      );
    await check("concorrência: cinco processadores ao mesmo tempo = UMA concessão", async () => {
      for (const i of [0, 1, 2]) await insertFact(U.e, "post_visited", `${ENV}/w-p${i}-post/c`, new Date(), { postId: `w-p${i}-post` });
      await Promise.all([1, 2, 3, 4, 5].map(() => MissionService.processPending({ db: pool, id_user: U.e })));
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_xp_grant WHERE id_user = $1`, [U.e])).rows[0].n, 1, "uma");
      eq((await pool.query(`SELECT xp_total FROM public.tb_arena_progression WHERE id_user = $1`, [U.e])).rows[0].xp_total, 60, "saldo");
    });
    await check("falha entre etapas: nada perdido, nada duplicado; reprocessar conclui", async () => {
      const f = (await insertFact(U.f, "video_completed", crypto.randomUUID(), new Date())).rows[0].id_fact;
      // Banco "cai" exatamente na escrita da concessão.
      const flaky = {
        connect: async () => {
          const c = await pool.connect();
          const q = c.query.bind(c);
          c.query = (sql, ...rest) => (typeof sql === "string" && sql.includes("INSERT INTO public.tb_arena_xp_grant") ? Promise.reject(Object.assign(new Error("conexão perdida"), { code: "ECONNRESET" })) : q(sql, ...rest));
          const rel = c.release.bind(c);
          c.release = (...a) => {
            c.query = q;
            c.release = rel;
            return rel(...a);
          };
          return c;
        },
        query: (...a) => pool.query(...a),
      };
      let threw = false;
      try {
        await MissionService.processFact(f, { db: flaky });
      } catch {
        threw = true;
      }
      ok(threw, "falha propagada (não é tratada como sucesso)");
      const row = (await pool.query(`SELECT processed_at, attempts, last_error FROM public.tb_arena_fact WHERE id_fact = $1`, [f])).rows[0];
      ok(row.processed_at === null && row.attempts === 1 && row.last_error === "ECONNRESET", JSON.stringify(row));
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_mission_contrib WHERE id_fact = $1`, [f])).rows[0].n, 0, "contribuição desfeita");
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_progression WHERE id_user = $1`, [U.f])).rows[0].n, 0, "sem XP");
      // "Reinício": a varredura acha o pendente.
      await MissionService.processPending({ db: pool });
      eq((await pool.query(`SELECT xp_total FROM public.tb_arena_progression WHERE id_user = $1`, [U.f])).rows[0].xp_total, 30, "concedido uma vez");
      await MissionService.processPending({ db: pool });
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_xp_grant WHERE id_user = $1`, [U.f])).rows[0].n, 1, "sem duplicar");
    });
    await check("mesma chave de concessão com conteúdo diferente = CONFLITO (fato fica pendente)", async () => {
      const g = await mkUser("conf");
      const other = (await insertFact(g, "post_visited", "x/y/z", new Date(), { postId: "zz" })).rows[0].id_fact;
      await pool.query(`UPDATE public.tb_arena_fact SET processed_at = clock_timestamp() WHERE id_fact = $1`, [other]);
      const today = new Date().toISOString().slice(0, 10);
      await pool.query(
        `INSERT INTO public.tb_arena_xp_grant (id_user, mission_key, mission_version, cycle_key, id_fact, fact_type, fact_at, base_xp, factor, xp, rule_version)
         VALUES ($1, 'sponsored-video', 1, $2, $3, 'video_completed', clock_timestamp(), 30, 1, 30, 1)`,
        [g, today, other]
      );
      const f = (await insertFact(g, "video_completed", crypto.randomUUID(), new Date())).rows[0].id_fact;
      let code = null;
      try {
        await MissionService.processFact(f, { db: pool });
      } catch (e) {
        code = e.code;
      }
      eq(code, "ARENA_GRANT_CONFLICT", "conflito");
      const row = (await pool.query(`SELECT processed_at, last_error FROM public.tb_arena_fact WHERE id_fact = $1`, [f])).rows[0];
      ok(row.processed_at === null && row.last_error === "ARENA_GRANT_CONFLICT", JSON.stringify(row));
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_progression WHERE id_user = $1`, [g])).rows[0].n, 0, "saldo intocado");
    });
    await check("virada de dia UTC e processamento atrasado: ciclo é o do FATO", async () => {
      const g = await mkUser("day");
      const y = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate()) - 1);
      const t0 = new Date(y.getTime() + 1);
      await insertFact(g, "video_completed", crypto.randomUUID(), y);
      await insertFact(g, "video_completed", crypto.randomUUID(), t0);
      await MissionService.processPending({ db: pool, id_user: g });
      const rows = (await pool.query(`SELECT to_char(cycle_key, 'YYYY-MM-DD') AS c FROM public.tb_arena_xp_grant WHERE id_user = $1 ORDER BY cycle_key`, [g])).rows.map((r) => r.c);
      eq(rows, [y.toISOString().slice(0, 10), t0.toISOString().slice(0, 10)], "dois ciclos");
    });
    await check("versão nova da missão não reabre o prêmio do mesmo ciclo", async () => {
      const key = `t-ver-${stamp}`;
      const g = await mkUser("ver");
      const def = (version, rewardXp) => ({ missionKey: key, version, status: "active", factType: "post_visited", objective: "count", target: 1, cycle: "daily_utc", rewardXp, x2Eligible: false, requirement: "none", voluntary: false, order: 99 });
      const doc = (m) => ({ ...missionsDoc, missions: [m] });
      ok((await run((c) => syncMissions(c, doc(def(1, 10)), { apply: true }))).ok, "v1");
      await insertFact(g, "post_visited", `${ENV}/a/v1`, new Date(), { postId: "a" });
      await MissionService.processPending({ db: pool, id_user: g });
      const changed = await run((c) => syncMissions(c, doc(def(1, 999)), { apply: true }));
      ok(!changed.ok && changed.errors[0].includes("imutável"), "mesma versão com outra regra é recusada");
      ok((await run((c) => syncMissions(c, doc(def(2, 999)), { apply: true }))).ok, "v2");
      await insertFact(g, "post_visited", `${ENV}/b/v2`, new Date(), { postId: "b" });
      await MissionService.processPending({ db: pool, id_user: g });
      const gr = (await pool.query(`SELECT mission_version, xp FROM public.tb_arena_xp_grant WHERE id_user = $1 AND mission_key = $2`, [g, key])).rows;
      eq(gr, [{ mission_version: 1, xp: 10 }], "uma, da v1");
      await pool.query(`UPDATE public.tb_arena_mission_def SET status = 'retired' WHERE mission_key = $1`, [key]);
    });
    await check("contas não se misturam", async () => {
      const mine = (await call("GET", "/arena/me/missions", { token: T.b })).body;
      eq(mine.progression.xpTotal, 0, "B segue em zero");
      ok(mine.missions.every((m) => m.progress === 0), "sem progresso alheio");
      eq((await call("GET", "/arena/me/missions")).status, 401, "sem token");
    });
    await check("histórico pessoal pagina e não expõe outras contas", async () => {
      const h = (await call("GET", "/arena/me/xp/grants?limit=1", { token: T.a })).body;
      ok(h.grants.length === 1 && h.grants[0].missionKey === "sponsored-video" && h.grants[0].xp === 30, JSON.stringify(h));
      eq((await call("GET", "/arena/me/xp/grants?before=nada", { token: T.a })).status, 400, "cursor torto");
    });

    console.log("\n━━━ M12 — aquecimento x2 ━━━");
    const xpBefore = (await pool.query(`SELECT COALESCE(SUM(xp_total), 0)::int AS s FROM public.tb_profile WHERE id_user = $1`, [U.g])).rows[0].s;
    await check("x2 ligado: a conclusão do vídeo ativa UM bônus; repetir a conclusão não cria outro", async () => {
      process.env.ARENA_BOOST_ENABLED = "true";
      const s = (await start(T.g)).body;
      const done = await watch(T.g, s);
      ok(done.body.state === "completed" && done.body.boost.activated === true, JSON.stringify(done.body));
      const again = await sig(T.g, s, 3, { mediaMs: 3000, playing: false, flags: ["ended"] });
      ok(again.body.replayed, "replay");
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_boost WHERE id_user = $1`, [U.g])).rows[0].n, 1, "um bônus");
      await MissionService.processPending({ db: pool, id_user: U.g });
      const vg = (await pool.query(`SELECT factor, xp FROM public.tb_arena_xp_grant WHERE id_user = $1 AND mission_key = 'sponsored-video'`, [U.g])).rows[0];
      eq(vg, { factor: 1, xp: 30 }, "o bônus não multiplica a própria ativação");
    });
    await check("x2 dobra SÓ o XP elegível da Arena, pelo instante do fato", async () => {
      for (const i of [0, 1, 2]) await visit(T.g, `w-p${i}-post`);
      const ex = (await pool.query(`SELECT factor, xp, base_xp, id_boost FROM public.tb_arena_xp_grant WHERE id_user = $1 AND mission_key = 'explore-posts'`, [U.g])).rows[0];
      ok(ex.factor === 2 && ex.xp === 120 && ex.base_xp === 60 && ex.id_boost, JSON.stringify(ex));
      const mine = (await call("GET", "/arena/me/missions", { token: T.g })).body;
      ok(mine.boost.enabled && mine.boost.active && mine.boost.usedToday === 1, JSON.stringify(mine.boost));
      eq(mine.progression.xpTotal, 150, "30 + 120");
    });
    await check("sem retroatividade: concessão antiga não muda com bônus novo", async () => {
      const old = (await pool.query(`SELECT factor, xp FROM public.tb_arena_xp_grant WHERE id_user = $1 AND mission_key = 'explore-posts'`, [U.c])).rows[0];
      eq(old, { factor: 1, xp: 60 }, "C continua 60");
    });
    await check("sem empilhar e cota entre sessões: duas ativações simultâneas = uma", async () => {
      const g = await mkUser("stack");
      const go = (id) =>
        run(async (c) => {
          await c.query("BEGIN");
          await c.query(`SELECT pg_advisory_xact_lock(73110, hashtext($1::text))`, [g]);
          const r = await MissionService.tryActivateBoost(c, { id_user: g, id_session: id, is_minor: false });
          await c.query("COMMIT");
          return r;
        });
      const out = await Promise.all([go(crypto.randomUUID()), go(crypto.randomUUID())]);
      eq(out.filter((r) => r.activated).length, 1, "uma ativa");
      ok(out.some((r) => r.reason === "already_active"), "a outra recusada");
      eq((await pool.query(`SELECT factor FROM public.tb_arena_boost WHERE id_user = $1`, [g])).rows.map((r) => r.factor), [2], "fator 2");
    });
    await check("sem Poléns, sem XP global/perfil, sem efeito no território", async () => {
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.polen_transactions t JOIN public.polen_wallets w ON w.id = t.wallet_id WHERE w.user_id = $1`, [U.g])).rows[0].n, 0, "Poléns");
      eq((await pool.query(`SELECT COALESCE(SUM(xp_total), 0)::int AS s FROM public.tb_profile WHERE id_user = $1`, [U.g])).rows[0].s, xpBefore, "XP de perfil");
      eq((await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_arena_checkpoint WHERE id_user = $1`, [U.g])).rows[0].n, 0, "nenhum checkpoint criado");
    });
    await check("x2 desligado de novo: nenhuma ativação nova", async () => {
      delete process.env.ARENA_BOOST_ENABLED;
      const g = await mkUser("off");
      const r = await run(async (c) => {
        await c.query("BEGIN");
        const x = await MissionService.tryActivateBoost(c, { id_user: g, id_session: crypto.randomUUID(), is_minor: false });
        await c.query("COMMIT");
        return x;
      });
      eq(r, { activated: false, reason: "disabled" }, "desligado");
    });

    console.log("\n━━━ M11 — métricas (administração) ━━━");
    await check("conta comum não lê métricas; administrador lê agregados com estados honestos", async () => {
      eq((await call("GET", `/admin/arena/ads/metrics?campaign=${VID}`, { token: T.a })).status, 403, "comum");
      const m = await call("GET", `/admin/arena/ads/metrics?campaign=${VID}`, { token: T.admin });
      eq(m.status, 200, `admin ${JSON.stringify(m.body)}`);
      ok(m.body.metrics.delivered.state === "unavailable", "entrega não medida");
      ok(m.body.metrics.videoCompletedEligible.incentivized.count >= 2, JSON.stringify(m.body.metrics.videoCompletedEligible));
      ok(m.body.metrics.rewardsGranted.count >= 2, "recompensas");
      ok(!JSON.stringify(m.body).includes(U.a) && !JSON.stringify(m.body).includes("@"), "sem identidade");
      const old = await call("GET", `/admin/arena/ads/metrics?campaign=${VID}&from=2020-01-01T00:00:00Z&to=2020-02-01T00:00:00Z`, { token: T.admin });
      eq(old.body.metrics.rendered.state, "no_data", "fora da janela = sem dados (não zero)");
      const st = await call("GET", `/admin/arena/ads/campaigns/${IMG}`, { token: T.admin });
      ok(st.status === 200 && st.body.bookings.length >= 1, "estado");
    });
  } finally {
    sc.release();
    for (const p of prevCompetitive) await pool.query(`UPDATE public.tb_arena_post SET competitive = TRUE WHERE environment_id = $1 AND post_id = $2`, [p.environment_id, p.post_id]);
    // Deixa as campanhas de teste encerradas (não poluem a próxima rodada).
    for (const code of [IMG, VID]) await run((c) => ops.end(c, { code }, true)).catch(() => {});
  }

  server.close();
  await pool.end();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} verificações passaram`);
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
