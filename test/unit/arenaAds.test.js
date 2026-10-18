// Regras puras dos outdoors e da reprodução elegível da Arena (M11).
const test = require("node:test");
const assert = require("node:assert/strict");
const A = require("../../src/utils/arenaAds");

const P = { environmentId: "br-sp", mapVersion: 1, generatorVersion: 2, instanceId: "q3-l2", slot: "art" };

test("id do espaço é derivado e estável da chave natural", () => {
  const a = A.placementIdFor(P);
  assert.match(a, /^ad-sp-[0-9a-f]{16}$/);
  assert.equal(A.placementIdFor({ ...P }), a);
  assert.notEqual(A.placementIdFor({ ...P, instanceId: "q3-l3" }), a, "outra instância do mesmo asset = outro espaço");
  assert.notEqual(A.placementIdFor({ ...P, mapVersion: 2 }), a, "outra revisão do mapa = outro espaço");
  assert.ok(A.isPlacementId(a));
});

test("CTA: só https, sem credencial, sem IP, sem protocolo perigoso", () => {
  assert.equal(A.validateCtaUrl("https://exemplo.com.br/promo?x=1"), "https://exemplo.com.br/promo?x=1");
  for (const bad of [
    "http://exemplo.com",
    "javascript:alert(1)",
    "data:text/html,oi",
    "https://user:senha@exemplo.com",
    "https://127.0.0.1/",
    "https://[::1]/",
    "https://localhost/",
    "https://exemplo.com:8443/",
    "https://exemplo .com",
    "//exemplo.com",
    "https://exemplo.com/<script>",
  ])
    assert.equal(A.validateCtaUrl(bad), null, bad);
});

const asset = (mime, w, h, extra = {}) => ({ mime, width: w, height: h, bytes: 1000, sha256: "a".repeat(64), ...extra });
const DOC = (over = {}) => ({
  campaignCode: "demo-arena",
  version: 1,
  kind: "image",
  farRef: "arena/v1/ads/0123456789abcdef.png",
  nearRef: "arena/v1/ads/fedcba9876543210.png",
  assets: {
    "arena/v1/ads/0123456789abcdef.png": asset("image/png", 600, 300),
    "arena/v1/ads/fedcba9876543210.png": asset("image/png", 1200, 600),
  },
  alt: "Arte da campanha",
  headline: "Demonstração",
  approvedBy: "Operador",
  ...over,
});

test("criativo de imagem válido normaliza e tem hash de conteúdo", () => {
  const v = A.validateCreativeDoc(DOC());
  assert.ok(v.value, JSON.stringify(v.errors));
  assert.match(v.value.contentHash, /^[a-f0-9]{64}$/);
  const v2 = A.validateCreativeDoc(DOC({ headline: "Outro texto" }));
  assert.notEqual(v2.value.contentHash, v.value.contentHash, "mudar texto muda o hash (mesma versão = conflito)");
});

test("criativo recusa sem aprovação, SVG, HTML no texto, CTA sem rótulo, vídeo sem poster", () => {
  assert.ok(A.validateCreativeDoc(DOC({ approvedBy: undefined })).errors);
  assert.ok(A.validateCreativeDoc(DOC({ farRef: "arena/v1/ads/0123456789abcdef.svg" })).errors);
  assert.ok(A.validateCreativeDoc(DOC({ headline: "<b>oi</b>" })).errors);
  assert.ok(A.validateCreativeDoc(DOC({ ctaUrl: "https://x.com.br" })).errors);
  assert.ok(A.validateCreativeDoc(DOC({ ctaUrl: "http://x.com.br", ctaLabel: "Ver" })).errors);
  assert.ok(A.validateCreativeDoc(DOC({ kind: "video", videoRef: "arena/v1/ads/1111111111111111.mp4" })).errors);
  const vid = DOC({
    kind: "video",
    posterRef: "arena/v1/ads/2222222222222222.jpg",
    videoRef: "arena/v1/ads/1111111111111111.mp4",
  });
  vid.assets["arena/v1/ads/2222222222222222.jpg"] = asset("image/jpeg", 1280, 720);
  vid.assets["arena/v1/ads/1111111111111111.mp4"] = asset("video/mp4", 1280, 720, { durationMs: 10_000 });
  const ok = A.validateCreativeDoc(vid);
  assert.ok(ok.value, JSON.stringify(ok.errors));
  assert.equal(ok.value.videoDurationMs, 10_000);
  vid.assets["arena/v1/ads/1111111111111111.mp4"].durationMs = 600_000;
  assert.ok(A.validateCreativeDoc(vid).errors, "duração fora do limite");
});

const NOW = Date.parse("2026-10-18T12:00:00Z");
const camp = (o = {}) => ({ approval_status: "approved", op_status: "active", starts_at: "2026-10-18T00:00:00Z", ends_at: "2026-10-19T00:00:00Z", ...o });
const book = (o = {}) => ({ status: "active", starts_at: "2026-10-18T00:00:00Z", ends_at: "2026-10-19T00:00:00Z", ...o });
const place = { is_active: true, slot_class: "commercial" };
const cr = { approval_status: "approved" };

test("entrega: início inclusivo, fim exclusivo, pausa, aprovação, criativo, reserva, decorativo", () => {
  const d = (o) => A.deliverability({ campaign: camp(), creative: cr, booking: book(), placement: place, ...o }, NOW);
  assert.equal(d({}), "deliverable");
  assert.equal(d({ campaign: camp({ starts_at: "2026-10-18T12:00:00Z" }) }), "deliverable", "no instante do início vale");
  assert.equal(d({ campaign: camp({ ends_at: "2026-10-18T12:00:00Z" }) }), "ended", "no instante do fim já não vale");
  assert.equal(d({ campaign: camp({ starts_at: "2026-10-18T12:00:01Z" }) }), "scheduled", "antes do início");
  assert.equal(d({ campaign: camp({ op_status: "paused" }) }), "paused");
  assert.equal(d({ campaign: camp({ approval_status: "pending" }) }), "not_approved");
  assert.equal(d({ creative: { approval_status: "withdrawn" } }), "creative_not_approved");
  assert.equal(d({ creative: null }), "no_creative");
  assert.equal(d({ booking: null }), "no_booking");
  assert.equal(d({ placement: { is_active: true, slot_class: "decorative" } }), "placement_not_commercial");
});

test("sobreposição com fim exclusivo: encostar não é conflito", () => {
  assert.equal(A.overlaps("2026-10-18T00:00Z", "2026-10-19T00:00Z", "2026-10-19T00:00Z", "2026-10-20T00:00Z"), false);
  assert.equal(A.overlaps("2026-10-18T00:00Z", "2026-10-19T00:00Z", "2026-10-18T23:59Z", "2026-10-20T00:00Z"), true);
});

const sig = (o = {}) => ({ seq: 2, playing: true, visible: true, rate: 1, mediaMs: 5000, flags: [], ...o });
const prev = (o = {}) => ({ playing: true, lastSignalAtMs: 0, lastMediaMs: 0, creditedMs: 0, maxMediaMs: 0, ...o });
const DUR = 10_000;

test("crédito = mín(tempo real do servidor, avanço da mídia, teto)", () => {
  assert.equal(A.creditInterval(prev(), sig(), 5000, DUR).credit, 5000);
  assert.equal(A.creditInterval(prev(), sig({ mediaMs: 9000 }), 5000, DUR).credit, 5000, "mídia não acelera o relógio do servidor");
  assert.equal(A.creditInterval(prev(), sig({ mediaMs: 2000 }), 5000, DUR).credit, 2000, "mídia atrasada (buffering) conta só o que andou");
  assert.equal(A.creditInterval(prev(), sig({ mediaMs: 60_000 }), 60_000, 120_000).credit, 15_000, "rede caída não vira crédito");
});

test("sem crédito: pausa, seek, buffering, aba oculta, velocidade alta, recuo, primeiro sinal", () => {
  for (const s of [sig({ flags: ["paused"] }), sig({ flags: ["seeked"] }), sig({ flags: ["stalled"] }), sig({ visible: false }), sig({ flags: ["hidden"] }), sig({ rate: 2 }), sig({ mediaMs: 0 }), sig({ rate: 0 })])
    assert.equal(A.creditInterval(prev({ lastMediaMs: 1000 }), s, 5000, DUR).credit, 0, JSON.stringify(s));
  assert.equal(A.creditInterval(prev({ playing: false }), sig(), 5000, DUR).credit, 0, "intervalo começou parado");
  assert.equal(A.creditInterval(prev({ lastSignalAtMs: null }), sig(), 5000, DUR).credit, 0, "primeiro sinal não credita");
});

test("conclusão exige crédito ≥ 90% E posição ≥ 95%; 'ended' sozinho não conclui", () => {
  const endedOnly = A.creditInterval(prev({ playing: false }), sig({ mediaMs: DUR, flags: ["ended"], playing: false }), 1000, DUR);
  assert.equal(endedOnly.completed, false);
  const seekToEnd = A.creditInterval(prev({ creditedMs: 1000 }), sig({ mediaMs: DUR, flags: ["seeked"] }), 15000, DUR);
  assert.equal(seekToEnd.completed, false, "pular para o fim não vira assistido");
  const real = A.creditInterval(prev({ creditedMs: 4500, lastMediaMs: 5000, lastSignalAtMs: 0, maxMediaMs: 5000 }), sig({ mediaMs: 9600 }), 5000, DUR);
  assert.equal(real.creditedMs, 9100);
  assert.equal(real.completed, true);
});

test("sinal de vídeo: chave a mais e flag desconhecida são recusadas", () => {
  const good = { seq: 1, nonce: "x".repeat(43), playing: true, visible: true, rate: 1, mediaMs: 0, flags: [] };
  assert.ok(A.parseVideoSignal(good).value);
  assert.ok(A.parseVideoSignal({ ...good, creditedMs: 9999 }).error, "o cliente não manda tempo assistido");
  assert.ok(A.parseVideoSignal({ ...good, flags: ["completed"] }).error);
  assert.equal(A.parseVideoSignal(good).hash, A.parseVideoSignal({ ...good }).hash);
});
