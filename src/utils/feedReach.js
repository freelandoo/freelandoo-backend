// src/utils/feedReach.js
// ALCANCE REGIONAL do post (tópico A1 do cronograma 2026-11) — regra única.
//
// O post nasce na CIDADE do autor e sobe de degrau conforme ganha "pontos de
// alcance". Degraus: cidade → área → região → estado → Brasil. Só sobe.
// O lugar do autor (cidade/área/região/UF) é congelado no post na publicação
// (trigger da mig 328), então mudar de cidade depois não arrasta posts antigos.
//
// Este arquivo é a fonte da verdade de pesos, curva e limiares. Quem grava
// eventos chama ReachStorage (que usa daqui); a mig 328 faz o backfill com um
// espelho em SQL e o e2e `test:feed-reach` confere os dois lados.
//
// Também é a peça reutilizável para outros tópicos: A2 (vitrine "dívidas"
// fixa em Brasil → `REACH_LEVEL.COUNTRY`), A5 (anúncio que compra alcance numa
// região → `ReachStorage.raiseLevel`) e B2 (outdoors).

const REACH_LEVEL = Object.freeze({
  CITY: 0,
  AREA: 1,
  REGION: 2,
  STATE: 3,
  COUNTRY: 4,
});

const REACH_LEVEL_KEYS = Object.freeze(["city", "area", "region", "state", "country"]);

// Pontos por ação. "view" = pessoa distinta que viu o post (logado = usuário,
// anônimo = sessão), contada UMA vez para sempre. Clique no perfil, no
// WhatsApp e compartilhamento também valem uma vez por pessoa — senão um dedo
// nervoso no botão compra alcance. Curtida, salvo e "não gostei" são estados
// alternáveis (desfazer devolve os pontos). Comentário vale por comentário.
const REACH_WEIGHTS = Object.freeze({
  view: 1,
  like: 5,
  profile_click: 4,
  whatsapp_click: 6,
  comment: 10,
  save: 30,
  share: 40, // × velocidade (shareVelocity)
  dislike: -2,
});

// Retenção: +1 ponto a cada 10 s assistidos (portfolio_content_retention,
// teto de 3.600 s por sessão que já existe lá).
const RETENTION_SECONDS_PER_POINT = 10;

// Ações contadas uma vez por pessoa (tb_reach_action).
const UNIQUE_ACTIONS = Object.freeze(["view", "profile_click", "whatsapp_click", "share"]);

// ── Velocidade do compartilhamento ────────────────────────────────────────
// n = compartilhamentos do post nas últimas 6 h, CONTANDO o atual.
//   v(n) = min(2, 1 + sqrt((n − 1) / 25))
// 1 → 1,00 · 2 → 1,20 · 5 → 1,40 · 10 → 1,60 · 17 → 1,80 · 26+ → 2,00
// Raiz em vez de reta: os primeiros compartilhamentos em sequência já pesam
// (é o sinal de que o post "pegou"), e o teto chega num volume que um grupo
// de amigos sozinho não fabrica.
const SHARE_WINDOW_HOURS = 6;
const SHARE_VELOCITY_MAX = 2;
const SHARE_VELOCITY_SPAN = 25;

function shareVelocity(sharesInWindow) {
  const n = Math.max(1, Math.floor(Number(sharesInWindow) || 1));
  return Math.min(SHARE_VELOCITY_MAX, 1 + Math.sqrt((n - 1) / SHARE_VELOCITY_SPAN));
}

function sharePoints(sharesInWindow) {
  return Math.round(REACH_WEIGHTS.share * shareVelocity(sharesInWindow) * 100) / 100;
}

function retentionPoints(prevSeconds, newSeconds) {
  const a = Math.floor(Math.max(0, Number(prevSeconds) || 0) / RETENTION_SECONDS_PER_POINT);
  const b = Math.floor(Math.max(0, Number(newSeconds) || 0) / RETENTION_SECONDS_PER_POINT);
  return Math.max(0, b - a);
}

// ── Limiar nunca exato ────────────────────────────────────────────────────
// Metas-base por degrau (índice = degrau a alcançar).
const REACH_THRESHOLDS = Object.freeze([0, 1000, 10000, 100000, 300000]);
const FACTOR_MIN = 0.85;
const FACTOR_SPAN = 0.3; // → [0,85; 1,15]

// Fator do post, determinístico pelo id (sem nada sorteado guardado): os 8
// primeiros dígitos hexadecimais do uuid (aleatórios num v4) viram [0, 1].
// Espelho em SQL: fl_reach_factor(uuid) da mig 328.
function reachFactor(id) {
  const hex = String(id || "").replace(/-/g, "").slice(0, 8);
  const n = /^[0-9a-f]{8}$/i.test(hex) ? parseInt(hex, 16) : 0x7fffffff;
  return FACTOR_MIN + FACTOR_SPAN * (n / 0xffffffff);
}

function reachThreshold(level, id) {
  const base = REACH_THRESHOLDS[level];
  if (!base) return 0;
  return base * reachFactor(id);
}

// Degrau que os pontos dão. Degrau sem lugar (cidade sem sub-região, cidade
// sem região) é pulado: o post vai direto ao seguinte quando passa o limiar
// do degrau que não existe. `place` = { area_id, region_id, uf }.
function reachLevelFor(points, id, place = {}) {
  const p = Number(points) || 0;
  let level = REACH_LEVEL.CITY;
  for (let l = REACH_LEVEL.COUNTRY; l >= REACH_LEVEL.AREA; l--) {
    if (p >= reachThreshold(l, id)) {
      level = l;
      break;
    }
  }
  return skipMissingLevels(level, place);
}

// Post sem UF (autor sem lugar no perfil) não tem degrau local nenhum: fica
// no 0, que não cobre ninguém, até passar a meta do Brasil — pular direto ao
// nacional com 1 mil pontos seria prêmio para quem não preencheu a cidade.
function skipMissingLevels(level, place = {}) {
  if (!place.uf) return level >= REACH_LEVEL.COUNTRY ? REACH_LEVEL.COUNTRY : REACH_LEVEL.CITY;
  let l = level;
  if (l === REACH_LEVEL.AREA && !place.area_id) l = REACH_LEVEL.REGION;
  if (l === REACH_LEVEL.REGION && !place.region_id) l = REACH_LEVEL.STATE;
  return l;
}

// O alcance só sobe.
function nextReachLevel(currentLevel, points, id, place) {
  return Math.max(Number(currentLevel) || 0, reachLevelFor(points, id, place));
}

// ── Cobertura do leitor ───────────────────────────────────────────────────
// post: { reach_level, reach_city_key, reach_area_id, reach_region_id, reach_uf }
// viewer: { city_key, area_id, region_id, uf } (null = anônimo / sem lugar)
function reachCovers(post, viewer) {
  const lvl = Number(post?.reach_level) || 0;
  if (lvl >= REACH_LEVEL.COUNTRY) return true;
  if (!viewer) return false;
  if (lvl === REACH_LEVEL.STATE) return !!post.reach_uf && post.reach_uf === viewer.uf;
  if (lvl === REACH_LEVEL.REGION) return !!post.reach_region_id && post.reach_region_id === viewer.region_id;
  if (lvl === REACH_LEVEL.AREA) return !!post.reach_area_id && post.reach_area_id === viewer.area_id;
  return !!post.reach_city_key && post.reach_city_key === viewer.city_key && post.reach_uf === viewer.uf;
}

// Faixa do feed: 0 = o alcance cobre o leitor; depois, de fora, do mais perto
// ao mais longe: 1 mesma área, 2 mesma região, 3 mesmo estado, 4 o resto.
const REACH_BANDS = 5;

function reachBand(post, viewer) {
  if (reachCovers(post, viewer)) return 0;
  if (!viewer) return 4;
  if (post.reach_area_id && post.reach_area_id === viewer.area_id) return 1;
  if (post.reach_city_key && post.reach_city_key === viewer.city_key && post.reach_uf === viewer.uf) return 1;
  if (post.reach_region_id && post.reach_region_id === viewer.region_id) return 2;
  if (post.reach_uf && post.reach_uf === viewer.uf) return 3;
  return 4;
}

// A mesma faixa em SQL (o feed ordena por ela antes do LIMIT). `a` é o alias
// da tabela do post (colunas reach_*); `p` = números dos parâmetros
// { city, area, region, uf, mode } — mode 'off' (filtro manual do leitor)
// põe tudo na faixa 0, como era antes do alcance.
function reachBandSql(a, p) {
  const cover = `(
        ${a}.reach_level >= 4
     OR (${a}.reach_level = 3 AND ${a}.reach_uf = $${p.uf}::text)
     OR (${a}.reach_level = 2 AND ${a}.reach_region_id = $${p.region}::int)
     OR (${a}.reach_level = 1 AND ${a}.reach_area_id = $${p.area}::int)
     OR (${a}.reach_level = 0 AND ${a}.reach_city_key = $${p.city}::text AND ${a}.reach_uf = $${p.uf}::text)
  )`;
  return `(CASE
      WHEN $${p.mode}::text = 'off' THEN 0
      WHEN ${cover} THEN 0
      WHEN ${a}.reach_area_id = $${p.area}::int THEN 1
      WHEN ${a}.reach_city_key = $${p.city}::text AND ${a}.reach_uf = $${p.uf}::text THEN 1
      WHEN ${a}.reach_region_id = $${p.region}::int THEN 2
      WHEN ${a}.reach_uf = $${p.uf}::text THEN 3
      ELSE 4
    END)`;
}

// Valores dos parâmetros do reachBandSql, na ordem city, area, region, uf, mode.
function reachBandParams(viewerPlace, { off = false } = {}) {
  const v = viewerPlace || {};
  return [
    v.city_key || null,
    Number.isFinite(v.area_id) ? v.area_id : null,
    Number.isFinite(v.region_id) ? v.region_id : null,
    v.uf || null,
    off ? "off" : "reach",
  ];
}

// O que o DONO do post vê ("Seu post chegou ao ABC Paulista"). Os nomes vêm
// do lugar congelado no post; a tela traduz a frase pela chave do degrau.
function reachLabel(row) {
  if (!row) return null;
  const level = Math.min(Math.max(Number(row.reach_level) || 0, 0), REACH_LEVEL.COUNTRY);
  const key = REACH_LEVEL_KEYS[level];
  let place = null;
  if (level === REACH_LEVEL.CITY) place = row.reach_city_name || null;
  else if (level === REACH_LEVEL.AREA) place = row.reach_area_name || null;
  else if (level === REACH_LEVEL.REGION) place = row.reach_region_name || null;
  else if (level === REACH_LEVEL.STATE) place = row.reach_uf || null;
  return { level, key, place };
}

module.exports = {
  REACH_LEVEL,
  REACH_LEVEL_KEYS,
  REACH_WEIGHTS,
  REACH_THRESHOLDS,
  REACH_BANDS,
  UNIQUE_ACTIONS,
  RETENTION_SECONDS_PER_POINT,
  SHARE_WINDOW_HOURS,
  FACTOR_MIN,
  FACTOR_SPAN,
  shareVelocity,
  sharePoints,
  retentionPoints,
  reachFactor,
  reachThreshold,
  reachLevelFor,
  skipMissingLevels,
  nextReachLevel,
  reachCovers,
  reachBand,
  reachBandSql,
  reachBandParams,
  reachLabel,
};
