// Regras PURAS dos outdoors da Freelandoo Arena (Módulo 11). Sem banco, sem
// rede: testadas em test/unit/arenaAds.test.js e compartilhadas pelo service,
// pela sincronização do registro e pela CLI de operação.
//
// Formatos ESPELHAM o repositório freelandoo-arena (`packages/contracts`,
// ads.ts). Mudou um lado, muda o outro.

const crypto = require("node:crypto");

const PLACEMENT_ID = /^ad-[a-z]{2}-[0-9a-f]{16}$/;
const ENV_ID = /^br-[a-z]{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLOT = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/;
const IMAGE_REF = /^arena\/v[0-9]+\/ads\/[a-f0-9]{16}\.(png|jpg|webp)$/;
const VIDEO_REF = /^arena\/v[0-9]+\/ads\/[a-f0-9]{16}\.mp4$/;
const SLOT_CLASSES = ["commercial", "institutional", "decorative", "reserved"];
const SIGNAL_TYPES = ["rendered", "exposure", "modal_open", "cta_click"];
const HOUR_MS = 3_600_000;

const isPlacementId = (v) => typeof v === "string" && PLACEMENT_ID.test(v);
const isEnvironmentId = (v) => typeof v === "string" && ENV_ID.test(v);
const isCampaignCode = (v) => typeof v === "string" && v.length >= 2 && v.length <= 48 && SLUG.test(v);

/** Chave natural do espaço — a identidade estável de verdade. */
function naturalKey(p) {
  return `${p.environmentId}:${p.mapVersion}:${p.generatorVersion}:${p.instanceId}:${p.slot}`;
}

/** Id público derivado: `ad-<uf>-<16 hex do sha256 da chave natural>`. */
function placementIdFor(p) {
  const uf = String(p.environmentId).slice(3);
  const h = crypto.createHash("sha256").update(naturalKey(p)).digest("hex").slice(0, 16);
  return `ad-${uf}-${h}`;
}

/**
 * Destino do CTA. Só HTTPS, host com ponto, sem credenciais, sem espaço, sem
 * porta exótica. Devolve a URL normalizada ou null. Nunca anexa nada.
 */
function validateCtaUrl(raw) {
  if (typeof raw !== "string" || raw.length > 500) return null;
  if (/[\s<>"'`\\]/.test(raw)) return null;
  let u;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  if (u.username || u.password) return null;
  if (!u.hostname || !u.hostname.includes(".") || u.hostname.endsWith(".")) return null;
  if (/^[0-9.]+$/.test(u.hostname) || u.hostname.includes(":")) return null; // IP literal
  if (u.port && u.port !== "443") return null;
  const out = u.toString();
  return out.length <= 500 ? out : null;
}

/** Texto do anunciante: curto, sem controle, sem marcação (não é traduzido). */
function cleanText(v, max, { required = false } = {}) {
  if (v === undefined || v === null || v === "") return required ? { error: true } : { value: null };
  if (typeof v !== "string") return { error: true };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f<>]/.test(v)) return { error: true };
  const t = v.trim();
  if (!t || t.length > max) return required || t.length > max ? { error: true } : { value: null };
  return { value: t };
}

/**
 * Valida UM criativo do documento de ingestão (seeds/arena-ad-creatives.json),
 * já com as medidas do arquivo feitas pela ingestão da Arena. Devolve
 * { value } normalizado ou { errors }.
 */
function validateCreativeDoc(c) {
  const errors = [];
  const add = (m) => errors.push(`${c?.campaignCode ?? "?"}@v${c?.version ?? "?"}: ${m}`);
  if (!c || typeof c !== "object") return { errors: ["criativo não é objeto"] };
  if (!isCampaignCode(c.campaignCode)) add("campaignCode");
  if (!Number.isInteger(c.version) || c.version < 1 || c.version > 10_000) add("version");
  if (c.kind !== "image" && c.kind !== "video") add("kind");
  const assets = c.assets && typeof c.assets === "object" && !Array.isArray(c.assets) ? c.assets : null;
  if (!assets) add("assets");
  const checkImage = (ref, name, { min = [64, 32], max = 4096, bytes = 2_000_000 } = {}) => {
    if (typeof ref !== "string" || !IMAGE_REF.test(ref)) return add(`${name}: referência`);
    const a = assets?.[ref];
    if (!a) return add(`${name}: sem medida da ingestão`);
    if (!["image/png", "image/jpeg", "image/webp"].includes(a.mime)) add(`${name}: tipo ${a.mime}`);
    if (!Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width < min[0] || a.height < min[1] || a.width > max || a.height > max) add(`${name}: dimensões`);
    if (!Number.isInteger(a.bytes) || a.bytes <= 0 || a.bytes > bytes) add(`${name}: tamanho`);
    if (typeof a.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(a.sha256)) add(`${name}: sha256`);
  };
  checkImage(c.farRef, "far");
  checkImage(c.nearRef, "near");
  if (c.kind === "video") {
    checkImage(c.posterRef, "poster");
    if (typeof c.videoRef !== "string" || !VIDEO_REF.test(c.videoRef)) add("video: referência");
    const v = assets?.[c.videoRef];
    if (!v || v.mime !== "video/mp4") add("video: tipo");
    else {
      if (!Number.isInteger(v.bytes) || v.bytes <= 0 || v.bytes > 25_000_000) add("video: tamanho");
      if (!Number.isInteger(v.durationMs) || v.durationMs < 3000 || v.durationMs > 120_000) add("video: duração");
      if (!Number.isInteger(v.width) || !Number.isInteger(v.height) || v.width > 1920 || v.height > 1920 || v.width < 160 || v.height < 90) add("video: dimensões");
      if (typeof v.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(v.sha256)) add("video: sha256");
    }
  } else if (c.posterRef != null || c.videoRef != null) add("imagem não leva poster/vídeo");
  const alt = cleanText(c.alt, 200, { required: true });
  const headline = cleanText(c.headline, 80, { required: true });
  const body = cleanText(c.body, 280);
  const ctaLabel = cleanText(c.ctaLabel, 32);
  if (alt.error) add("alt");
  if (headline.error) add("headline");
  if (body.error) add("body");
  if (ctaLabel.error) add("ctaLabel");
  let ctaUrl = null;
  if (c.ctaUrl != null) {
    ctaUrl = validateCtaUrl(c.ctaUrl);
    if (!ctaUrl) add("ctaUrl (só https, sem credenciais)");
  }
  if ((ctaUrl === null) !== (ctaLabel.value === null)) add("ctaUrl e ctaLabel andam juntos");
  if (c.approvedBy == null || cleanText(c.approvedBy, 120, { required: true }).error) add("approvedBy (a ingestão só aceita criativo aprovado)");
  if (errors.length) return { errors };
  const value = {
    campaignCode: c.campaignCode,
    version: c.version,
    kind: c.kind,
    farRef: c.farRef,
    nearRef: c.nearRef,
    posterRef: c.kind === "video" ? c.posterRef : null,
    videoRef: c.kind === "video" ? c.videoRef : null,
    videoDurationMs: c.kind === "video" ? assets[c.videoRef].durationMs : null,
    videoMime: c.kind === "video" ? "video/mp4" : null,
    assets,
    alt: alt.value,
    headline: headline.value,
    body: body.value,
    ctaLabel: ctaLabel.value,
    ctaUrl,
  };
  value.contentHash = creativeHash(value);
  return { value };
}

/** Hash do CONTEÚDO de uma versão: mesma versão com outro conteúdo = conflito. */
function creativeHash(v) {
  const stable = [v.kind, v.farRef, v.nearRef, v.posterRef, v.videoRef, v.videoDurationMs, v.alt, v.headline, v.body, v.ctaLabel, v.ctaUrl];
  const files = Object.keys(v.assets).sort().map((k) => [k, v.assets[k].sha256]);
  return crypto.createHash("sha256").update(JSON.stringify([stable, files])).digest("hex");
}

/**
 * Pode ser entregue AGORA? A primeira razão que falha é a que a operação vê.
 * `now` em ms do relógio do BANCO (nunca do navegador).
 */
function deliverability({ campaign, creative, booking, placement }, now) {
  if (!placement || !placement.is_active) return "placement_inactive";
  if (placement.slot_class !== "commercial") return "placement_not_commercial";
  if (!campaign) return "no_campaign";
  if (campaign.approval_status !== "approved") return "not_approved";
  if (campaign.op_status !== "active") return campaign.op_status === "paused" ? "paused" : campaign.op_status === "ended" ? "ended" : "not_active";
  const s = new Date(campaign.starts_at).getTime();
  const e = new Date(campaign.ends_at).getTime();
  if (now < s) return "scheduled";
  if (now >= e) return "ended";
  if (!booking || booking.status !== "active") return "no_booking";
  if (now < new Date(booking.starts_at).getTime() || now >= new Date(booking.ends_at).getTime()) return "outside_booking";
  if (!creative) return "no_creative";
  if (creative.approval_status !== "approved") return "creative_not_approved";
  return "deliverable";
}

/** Janelas [a, b) sobrepostas? (fim exclusivo: encostar não é conflito). */
const overlaps = (a0, a1, b0, b1) => new Date(a0) < new Date(b1) && new Date(b0) < new Date(a1);

const hourBucket = (ms) => new Date(Math.floor(ms / HOUR_MS) * HOUR_MS);

// ─── Reprodução elegível (política V1 proposta) ─────────────────────────────

const VIDEO_POLICY = Object.freeze({
  version: 1,
  heartbeatMs: 5000,
  /** Crédito máximo de UM intervalo entre sinais (rede caída não vira crédito). */
  maxIntervalMs: 15_000,
  /** Intervalo mínimo entre sinais aceitos (anti-martelo). */
  minIntervalMs: 250,
  maxRate: 1.1,
  creditRatio: 0.9,
  positionRatio: 0.95,
  /** Expiração = started + duração × fator + folga. */
  expiryFactor: 2,
  expirySlackMs: 120_000,
  maxSessionsPerDay: 20,
  maxEventsPerSignal: 8,
});

const SIGNAL_FLAGS = ["seeked", "paused", "stalled", "hidden", "rate", "ended", "error"];

/**
 * Valida o corpo de UM sinal de reprodução. O tempo que o cliente diz é só o
 * PONTEIRO da mídia; o tempo real vem do servidor.
 */
function parseVideoSignal(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "body" };
  const allowed = ["seq", "nonce", "playing", "visible", "rate", "mediaMs", "flags"];
  for (const k of Object.keys(body)) if (!allowed.includes(k)) return { error: k };
  const { seq, nonce, playing, visible, rate, mediaMs, flags } = body;
  if (!Number.isInteger(seq) || seq < 1 || seq > 100_000) return { error: "seq" };
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{32,64}$/.test(nonce)) return { error: "nonce" };
  if (typeof playing !== "boolean" || typeof visible !== "boolean") return { error: "playing/visible" };
  if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 16) return { error: "rate" };
  if (!Number.isInteger(mediaMs) || mediaMs < 0 || mediaMs > 600_000) return { error: "mediaMs" };
  if (!Array.isArray(flags) || flags.length > SIGNAL_FLAGS.length || flags.some((f) => !SIGNAL_FLAGS.includes(f))) return { error: "flags" };
  const value = { seq, playing, visible, rate, mediaMs, flags: [...new Set(flags)].sort() };
  const hash = crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  return { value: { ...value, nonce }, hash };
}

/**
 * Credita UM intervalo. Puro: o estado anterior é o que o SERVIDOR gravou.
 *   prev  { playing, lastSignalAtMs, lastMediaMs, creditedMs, maxMediaMs }
 *   sig   sinal validado
 *   nowMs relógio do servidor
 * Política: só conta intervalo inteiramente "tocando" (estado anterior e atual),
 * visível, velocidade ≤ 1,1×, sem seek/pausa/espera/aba oculta/erro no meio.
 * Crédito = mín(tempo real, avanço da mídia, teto do intervalo). Somar segundos
 * pedidos pelo cliente é impossível: o tempo real é medido aqui.
 */
function creditInterval(prev, sig, nowMs, durationMs, policy = VIDEO_POLICY) {
  const wall = prev.lastSignalAtMs == null ? 0 : Math.max(0, nowMs - prev.lastSignalAtMs);
  const media = sig.mediaMs - prev.lastMediaMs;
  const broken = sig.flags.some((f) => f !== "ended");
  const rateOk = sig.rate > 0 && sig.rate <= policy.maxRate;
  const eligible = prev.playing && sig.visible && rateOk && !broken && media >= 0 && prev.lastSignalAtMs != null;
  let credit = 0;
  if (eligible) credit = Math.max(0, Math.min(wall, media, policy.maxIntervalMs));
  const creditedMs = Math.min(durationMs, prev.creditedMs + credit);
  const maxMediaMs = credit > 0 ? Math.max(prev.maxMediaMs, Math.min(sig.mediaMs, durationMs)) : prev.maxMediaMs;
  const nowPlaying = sig.playing && sig.visible && rateOk && !sig.flags.includes("error") && !sig.flags.includes("ended");
  const completed = creditedMs >= Math.floor(durationMs * policy.creditRatio) && maxMediaMs >= Math.floor(durationMs * policy.positionRatio);
  return { credit, creditedMs, maxMediaMs, playing: nowPlaying, completed, reason: eligible ? "credited" : "not_eligible" };
}

module.exports = {
  SLOT_CLASSES,
  SIGNAL_TYPES,
  VIDEO_POLICY,
  SIGNAL_FLAGS,
  IMAGE_REF,
  VIDEO_REF,
  isPlacementId,
  isEnvironmentId,
  isCampaignCode,
  isSlot: (v) => typeof v === "string" && v.length <= 48 && SLOT.test(v),
  isSlug: (v, max = 64) => typeof v === "string" && v.length >= 2 && v.length <= max && SLUG.test(v),
  naturalKey,
  placementIdFor,
  validateCtaUrl,
  cleanText,
  validateCreativeDoc,
  creativeHash,
  deliverability,
  overlaps,
  hourBucket,
  parseVideoSignal,
  creditInterval,
};
