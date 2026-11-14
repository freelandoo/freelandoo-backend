// src/utils/meuMundoSoul.js — MEU MUNDO 3D: a "alma" do hóspede (mm3d-72, mig 327).
//
// Pedido do Alex (2026-11-07): "quero humanizar o personagem". Regra única (o
// cliente só mostra):
//  - PERSONALIDADE nova. Desde 2026-11-15 (pedido do Alex) é SÓ VOZ: não mexe
//    em luta, monstro, fome, gosto nem desejo — muda só as falas (front,
//    banter.ts). Treze: as cinco de antes + preguiçoso, vaidoso, rabugento,
//    palhaço, carente, pão-duro, fofoqueiro e narcisista. Os 6 números antigos (meuMundoLife `personality`) seguem por
//    baixo mexendo no corpo; o que aparece é o tipo. Quem já existia recebe o
//    tipo pela própria semente (fixo, sem sorteio novo).
//  - AFETO: quanto ele gosta do dono, de 0 sem teto (nasce em 50). Sobe quando o
//    dono cuida e faz o que ele quer; cai quando o deixa com fome, interna,
//    dá o que ele odeia, ignora o que ele pediu.
//  - GOSTA / ODEIA: uma comida e uma atividade de cada, sorteadas ao nascer.
//  - APELIDO: com afeto ≥ 200 ele chama o dono pelo que mais gosta; com afeto
//    zerado por mais de um dia, pelo que mais odeia; senão pelo apelido que o
//    dono escolheu (tb_mm_player).
//  - DESEJO: de tempos em tempos ele quer uma coisa (pela personalidade), com
//    prazo; atendeu = afeto sobe, deixou passar = afeto cai.

const HOUR = 3600 * 1000;

/** As cinco primeiras: quem nasceu antes de NEW_FROM sorteia SÓ entre elas (o sorteio pela semente não muda). */
const LEGACY_TEMPERS = Object.freeze(["psicopata", "covarde", "comilao", "bondoso", "competitivo"]);
/** Todas que existem (uma alma gravada com qualquer uma delas vale). */
const TEMPERS = Object.freeze([...LEGACY_TEMPERS, "preguicoso", "vaidoso", "rabugento", "palhaco", "carente", "paoduro", "fofoqueiro", "narcisista"]);
/**
 * As que um personagem NOVO pode tirar: só as que já têm as falas prontas no
 * front (cada fatia de falas acrescenta a dela aqui), para ninguém nascer mudo.
 */
const BORN_TEMPERS = Object.freeze([...LEGACY_TEMPERS]);
/** Nascido a partir daqui sorteia em BORN_TEMPERS (2026-11-15 00:00 de Brasília). */
const NEW_FROM = Date.UTC(2026, 10, 15, 3);

/** Comidas que entram no sorteio do gosto/ódio (ids de meuMundoLife ITEMS). */
const FOODS = Object.freeze([
  "salmao_legumes", "frango_salada", "prato_integral", "bowl_frutas", "omelete_legumes", "iogurte_aveia",
  "sopa_legumes", "prato_feito", "hamburguer", "pizza", "cachorro_quente", "coxinha", "chocolate", "miojo",
  "salgadinho", "biscoito_recheado", "refrigerante", "agua_coco",
]);
/** Atividades (as da vida + lutar e minijogo, que chegam por recibo). */
const ACTS = Object.freeze(["training", "studying", "working", "praying", "sleeping", "fight", "minigame"]);

const AFFECTION = Object.freeze({
  START: 50,
  /** A partir daqui ele chama o dono pelo que mais gosta. */
  NAME_AT: 200,
  /** Zerado há tanto tempo: chama pelo que mais odeia. */
  HATE_AFTER_H: 24,
  MEAL_ON_TIME: 2,
  MEAL_LATE: 0,
  MEAL_MISSED: -4,
  MEAL_LOST: -6,
  FAV_FOOD: 6,
  HATED_FOOD: -6,
  FAV_ACT: 4,
  HATED_ACT: -4,
  HOSPITAL: -10,
  WIN: 3,
  WISH_OK: 8,
  WISH_FAIL: -6,
});

/** Desejos: o que ele pede e em quanto tempo (h). Iguais para todos (a personalidade é só voz). */
const WISH_LIST = Object.freeze([
  { id: "fight", h: 6 },
  { id: "eat_more", h: 4 },
  { id: "fav_food", h: 8 },
  { id: "pray", h: 12 },
  { id: "rest", h: 10 },
  { id: "minigame", h: 6 },
]);
const WISHES = Object.freeze(Object.fromEntries(TEMPERS.map((k) => [k, WISH_LIST])));
/** Intervalo entre um desejo e o próximo (h). */
const WISH_GAP_H = 10;

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Sorteio da alma (mesma semente = mesma alma; não mexe no sorteio da vida).
 * `bornAt` (opcional): nascido a partir de NEW_FROM sorteia entre BORN_TEMPERS;
 * sem ele, ou antes, entre as cinco de sempre — quem já existia não muda.
 */
function bornSoul(seed, bornAt) {
  const r = rng((seed ^ 0x5f3759df) >>> 0);
  const pick = (list, not) => {
    let x;
    do x = list[Math.floor(r() * list.length)];
    while (x === not);
    return x;
  };
  const pool = Number(bornAt) >= NEW_FROM ? BORN_TEMPERS : LEGACY_TEMPERS;
  const temper = pool[Math.floor(r() * pool.length)];
  const likeFood = pick(FOODS);
  const hateFood = pick(FOODS, likeFood);
  // gostos sorteados para todos (antes o psicopata gostava de lutar etc.: saiu, é só voz)
  const likeAct = pick(ACTS);
  const hateAct = pick(ACTS, likeAct);
  return {
    temper,
    affection: AFFECTION.START,
    likes: { food: likeFood, act: likeAct },
    hates: { food: hateFood, act: hateAct },
    zeroSince: null,
    wish: null,
    nextWishAt: null,
    petName: null,
  };
}

/** A alma do hóspede (cria/completa; quem é de antes da mig 327 nasce aqui pela semente). */
function soulOf(s) {
  if (!s.soul || !TEMPERS.includes(s.soul.temper)) s.soul = { ...bornSoul(s.seed, s.bornAt), ...(s.soul && s.soul.petName ? { petName: s.soul.petName } : {}) };
  const so = s.soul;
  if (!(so.affection >= 0)) so.affection = AFFECTION.START;
  return so;
}

function feel(so, d, t) {
  if (!d) return;
  so.affection = Math.max(0, Math.round((so.affection + d) * 10) / 10);
  if (so.affection <= 0) {
    if (!so.zeroSince) so.zeroSince = t;
  } else so.zeroSince = null;
}

/**
 * Afeto pelos eventos da vida (simulação + o que a pessoa fez agora). Devolve
 * o quanto mudou (para a tela) e os eventos da alma (`wish_ok`/`wish_fail`/`wish`).
 */
function applyEvents(s, events, t) {
  const so = soulOf(s);
  const before = so.affection;
  const out = [];
  for (const e of events) {
    const d = e.data || {};
    const at = e.at || t;
    switch (e.kind) {
      case "meal":
        feel(so, d.late ? AFFECTION.MEAL_LATE : AFFECTION.MEAL_ON_TIME, at);
        break;
      case "meal_missed":
        feel(so, AFFECTION.MEAL_MISSED, at);
        break;
      case "meal_lost":
        feel(so, AFFECTION.MEAL_LOST, at);
        break;
      case "consume":
        if (d.item === so.likes.food) feel(so, AFFECTION.FAV_FOOD, at);
        else if (d.item === so.hates.food) feel(so, AFFECTION.HATED_FOOD, at);
        wishCheck(so, "consume", d, at, out);
        break;
      case "hospital_in":
        feel(so, AFFECTION.HOSPITAL, at);
        break;
      case "activity_end":
        if (d.kind === so.likes.act) feel(so, AFFECTION.FAV_ACT, at);
        else if (d.kind === so.hates.act) feel(so, AFFECTION.HATED_ACT, at);
        wishCheck(so, "activity", d, at, out);
        break;
      case "fight":
        // luta abandonada (ticket vencido, aba fechada) não conta
        if (d.abandoned) break;
        if (d.win) feel(so, AFFECTION.WIN, at);
        if (so.likes.act === "fight") feel(so, AFFECTION.FAV_ACT, at);
        else if (so.hates.act === "fight") feel(so, AFFECTION.HATED_ACT, at);
        cowardFought(so, at, out);
        wishCheck(so, "fight", d, at, out);
        break;
      case "minigame":
        if (so.likes.act === "minigame") feel(so, AFFECTION.FAV_ACT, at);
        else if (so.hates.act === "minigame") feel(so, AFFECTION.HATED_ACT, at);
        wishCheck(so, "minigame", d, at, out);
        break;
      default:
    }
  }
  wishTick(s, so, t, out);
  for (const e of out) {
    if (e.kind === "wish_ok") feel(so, AFFECTION.WISH_OK, e.at);
    if (e.kind === "wish_fail") feel(so, AFFECTION.WISH_FAIL, e.at);
  }
  return { delta: Math.round((so.affection - before) * 10) / 10, events: out };
}

/** O desejo foi atendido por este acontecimento? */
function wishCheck(so, what, d, at, out) {
  const w = so.wish;
  if (!w || at > w.until) return;
  const ok =
    (w.id === "fight" && what === "fight") ||
    (w.id === "minigame" && what === "minigame") ||
    (w.id === "eat_more" && what === "consume" && FOODS.includes(d.item)) ||
    (w.id === "fav_food" && what === "consume" && d.item === so.likes.food) ||
    (w.id === "pray" && what === "activity" && d.kind === "praying") ||
    (w.id === "rest" && what === "activity" && (d.kind === "sleeping" || d.kind === "lying"));
  if (!ok) return;
  out.push({ at, kind: "wish_ok", data: { wish: w.id } });
  so.wish = null;
  so.nextWishAt = at + WISH_GAP_H * HOUR;
}

/**
 * Prazo do desejo e o próximo. "home_night" (o antigo desejo do covarde) só
 * termina os que já estavam em curso; ninguém pede mais. Era: o desejo
 * dele é cumprido se não lutou até o prazo (luta conta como falha em wishCheck).
 */
function wishTick(s, so, t, out) {
  if (s.status && s.status !== "alive") return;
  const w = so.wish;
  if (w && t >= w.until) {
    out.push({ at: w.until, kind: w.id === "home_night" ? "wish_ok" : "wish_fail", data: { wish: w.id } });
    so.wish = null;
    so.nextWishAt = w.until + WISH_GAP_H * HOUR;
  }
  if (so.wish || (so.nextWishAt && t < so.nextWishAt)) return;
  const opts = WISH_LIST;
  const r = rng(Math.floor(t / HOUR) ^ (s.seed >>> 0));
  const pick = opts[Math.floor(r() * opts.length)];
  so.wish = { id: pick.id, at: t, until: t + pick.h * HOUR };
  out.push({ at: t, kind: "wish", data: { wish: pick.id, until: so.wish.until } });
}

/** Covarde que lutou durante o "ficar em casa": o desejo falha na hora. */
function cowardFought(so, at, out) {
  if (so.wish && so.wish.id === "home_night" && at <= so.wish.until) {
    out.push({ at, kind: "wish_fail", data: { wish: "home_night" } });
    so.wish = null;
    so.nextWishAt = at + WISH_GAP_H * HOUR;
  }
}

/**
 * Como ele chama o dono agora: `{ kind: "nick" }` (o apelido escolhido),
 * `{ kind: "like", food }` (afeto ≥ 200) ou `{ kind: "hate", food }` (afeto
 * zerado há mais de um dia).
 */
function callName(so, t) {
  if (so.affection >= AFFECTION.NAME_AT) return { kind: "like", food: so.likes.food };
  if (so.affection <= 0 && so.zeroSince && t - so.zeroSince >= AFFECTION.HATE_AFTER_H * HOUR) return { kind: "hate", food: so.hates.food };
  return { kind: "nick" };
}

/** Projeção para a tela. */
function view(s, t) {
  const so = soulOf(s);
  return {
    temper: so.temper,
    affection: Math.floor(so.affection),
    likes: so.likes,
    hates: so.hates,
    petName: so.petName || null,
    call: callName(so, t),
    wish: so.wish ? { id: so.wish.id, until: new Date(so.wish.until).toISOString() } : null,
  };
}

/** Lutador: a personalidade que a luta usa (vai no ticket). */
function temperOf(s) {
  return soulOf(s).temper;
}

module.exports = {
  TEMPERS,
  LEGACY_TEMPERS,
  BORN_TEMPERS,
  NEW_FROM,
  FOODS,
  ACTS,
  AFFECTION,
  WISHES,
  WISH_GAP_H,
  bornSoul,
  soulOf,
  applyEvents,
  cowardFought,
  callName,
  view,
  temperOf,
  feel,
};
