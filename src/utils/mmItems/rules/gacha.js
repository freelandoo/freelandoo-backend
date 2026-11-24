// src/utils/mmItems/rules/gacha.js — CONVOCAÇÕES (gachas de fragmentos), gacha-v1 (24/11/2026).
//
// Decisões do Alex (24/11/2026, `MEU MUNDO 3D/planos/2026-11-24-gachas-fragmentos-proposta.md`):
//   • três banners — Armas, Proteções e Personagens — que entregam SÓ fragmentos;
//   • o giro custa 1 FAÍSCA DE ÉTER (só se ganha jogando; nunca sai de Gold/Esmeralda); 10 giros = 10;
//   • cada prêmio vale 1/10 da peça daquela classe; faixas Comum 73% · Raro 18% · Épico 7% · Topo 2%;
//   • Raro-ou-melhor garantido a cada 10 giros; Topo garantido no 40º ("mais generoso");
//   • Personagens: o Topo dá 20 fragmentos — 50% do ALVO escolhido, 50% de outro jogável; errou, o próximo
//     Topo é garantido no alvo (a marca fica no banner).
// Contadores POR BANNER, no servidor (tb_mm_gacha_state); não zeram quando a versão muda.
// Módulo PURO: o sorteio recebe `ri(n)` → inteiro em [0, n) (crypto.randomInt no serviço; fixo nos testes).
"use strict";

const { RANKS } = require("./rank");
const WP = require("./weaponProgress");
const Protections = require("../catalog/protections");
const Bestiary = require("../catalog/bestiary");

const GACHA_VERSION = "gacha-v1";
/** O item que paga o giro e quanto custa cada um. */
const CURRENCY = "faisca_eter";
const COST_PER_PULL = 1;
/** Quantos giros cabem num pedido: 1 ou 10. */
const BATCH = 10;
const TIMES = Object.freeze([1, BATCH]);
/** Garantias: Raro+ a cada 10; Topo no 40º. */
const PITY = Object.freeze({ rare: 10, top: 40 });
const TIERS = Object.freeze(["common", "rare", "epic", "top"]);
const TIER_RANK = Object.freeze({ common: 0, rare: 1, epic: 2, top: 3 });

/** Peso (em milésimos) de cada classe nos banners de Armas e Proteções: soma 1000. */
const CLASS_WEIGHT = Object.freeze({ E: 220, D: 200, C: 170, B: 140, A: 100, S: 80, SS: 40, SSR: 30, legendary: 15, divine: 5 });
const CLASS_TIER = Object.freeze({ E: "common", D: "common", C: "common", B: "common", A: "rare", S: "rare", SS: "epic", SSR: "epic", legendary: "top", divine: "top" });
/** 1/10 do que a peça pede, arredondado (Armas: 20…200 → 2…20; Proteções: 20…200 pela tabela delas). */
const tenth = (n) => Math.max(1, Math.round(n / 10));
const WEAPON_QTY = Object.freeze(Object.fromEntries(RANKS.map((r) => [r, tenth(WP.FRAGMENT_NEED[r])])));
const PROTECTION_QTY = Object.freeze(Object.fromEntries(RANKS.map((r) => [r, tenth(Protections.NEED[r])])));

/** Personagens: peso por faixa (milésimos, soma 1000) e o que cada faixa entrega. */
const CHARACTER_WEIGHT = Object.freeze({ common: 800, rare: 150, epic: 40, top: 10 });
const CHARACTER_QTY = Object.freeze({ common: 1, rare: 5, epic: 5, top: 20 });

// ── os pools (só o que vira peça/personagem de verdade) ──
const PROTECTION_POOL = Object.freeze(Object.fromEntries(RANKS.map((r) => [r, Object.freeze(Protections.FORGEABLE.filter((p) => p.rank === r).map((p) => `frag_${p.id}`))])));
/** Os 12 jogáveis: os especiais que são espécie (os guardiões que não são espécie ficam fora) + os 7 deuses. */
const PLAYABLE_SPECIAL = Object.freeze(["ciborgue", "cavaleiro", "golem", "garras", "brutamontes"]);
const SPECIALS = Object.freeze(Bestiary.CHARACTERS.filter((c) => PLAYABLE_SPECIAL.includes(c.id)).map((c) => Object.freeze({ id: c.id, name: c.name, kind: "special", frag: `frag_personagem_${c.id}`, capsule: `embriao_${c.id}` })));
const GODS = Object.freeze(Bestiary.GODS.map((g) => Object.freeze({ id: g.id, name: g.name, kind: "god", frag: `frag_deus_${g.id}`, capsule: `embriao_${g.id}` })));
const CHARACTERS = Object.freeze([...SPECIALS, ...GODS]);
const CHARACTER_BY_ID = new Map(CHARACTERS.map((c) => [c.id, c]));
const PROTECTION_TARGETS = new Set(Protections.FORGEABLE.map((p) => p.id));
const PROTECTION_RANK = new Map(Protections.FORGEABLE.map((p) => [p.id, p.rank]));

const BANNERS = Object.freeze(["weapons", "protections", "characters"]);
/** Alvo: obrigatório nos Personagens, opcional nas Proteções, não existe nas Armas. */
const TARGET = Object.freeze({ weapons: "none", protections: "optional", characters: "required" });

/** Sorteio ponderado sem viés: `ri(total)` cai num intervalo [acumulado, acumulado + peso). */
function pickWeighted(entries, ri) {
  const total = entries.reduce((s, [, w]) => s + w, 0);
  if (!(total > 0)) throw new Error("gacha: pool vazio");
  let x = ri(total);
  for (const [k, w] of entries) {
    if (x < w) return k;
    x -= w;
  }
  return entries[entries.length - 1][0];
}
const pickUniform = (list, ri) => list[ri(list.length)];

/** Alvo válido do banner (null = sem alvo; undefined = inválido). */
function normalizeTarget(banner, raw) {
  const v = raw == null || raw === "" ? null : String(raw);
  if (TARGET[banner] === "none") return v == null ? null : undefined;
  if (v == null) return TARGET[banner] === "required" ? undefined : null;
  if (banner === "protections") return PROTECTION_TARGETS.has(v) ? v : undefined;
  return CHARACTER_BY_ID.has(v) ? v : undefined;
}

/** A faixa deste giro pela garantia: "top" no 40º sem Topo, "rare" (Raro+) no 10º sem Raro+, senão null. */
function forcedTier(state) {
  if (state.sinceTop + 1 >= PITY.top) return "top";
  if (state.sinceRare + 1 >= PITY.rare) return "rare";
  return null;
}

function classEntries(minTier) {
  return RANKS.filter((r) => TIER_RANK[CLASS_TIER[r]] >= TIER_RANK[minTier]).map((r) => [r, CLASS_WEIGHT[r]]);
}

/**
 * UM giro. `state` = { sinceRare, sinceTop, guaranteed } (é devolvido um novo). Resultado:
 * { item, qty, tier, rank?, character?, pity: "rare"|"top"|null, featured?: true|false }.
 */
function rollOne(banner, target, state, ri) {
  const forced = forcedTier(state);
  let out;
  let next = { ...state };
  if (banner === "characters") {
    const tier = forced === "top" ? "top" : pickWeighted(TIERS.filter((t) => TIER_RANK[t] >= TIER_RANK[forced || "common"]).map((t) => [t, CHARACTER_WEIGHT[t]]), ri);
    let who;
    let featured;
    if (tier === "top") {
      const tgt = CHARACTER_BY_ID.get(target);
      // 50/50: com a marca "garantido" vem o alvo; sem ela, ri(2) decide
      if (state.guaranteed || ri(2) === 0) {
        who = tgt;
        featured = true;
        next.guaranteed = false;
      } else {
        who = pickUniform(CHARACTERS.filter((c) => c.id !== tgt.id), ri);
        featured = false;
        next.guaranteed = true;
      }
    } else who = pickUniform(tier === "epic" ? GODS : SPECIALS, ri);
    out = { item: who.frag, qty: CHARACTER_QTY[tier], tier, character: who.id, ...(featured != null ? { featured } : {}) };
  } else {
    const rank = pickWeighted(classEntries(forced || "common"), ri);
    const tier = CLASS_TIER[rank];
    let item;
    if (banner === "weapons") item = WP.fragmentOf(rank);
    else item = target && PROTECTION_RANK.get(target) === rank ? `frag_${target}` : pickUniform(PROTECTION_POOL[rank], ri);
    const qty = banner === "weapons" ? WEAPON_QTY[rank] : PROTECTION_QTY[rank];
    out = { item, qty, tier, rank, ...(banner === "protections" && target && PROTECTION_RANK.get(target) === rank ? { featured: true } : {}) };
  }
  if (out.tier === "top") next = { ...next, sinceTop: 0, sinceRare: 0 };
  else if (TIER_RANK[out.tier] >= TIER_RANK.rare) next = { ...next, sinceTop: next.sinceTop + 1, sinceRare: 0 };
  else next = { ...next, sinceTop: next.sinceTop + 1, sinceRare: next.sinceRare + 1 };
  out.pity = forced;
  return { result: out, state: next };
}

/** N giros em ordem (a garantia vale giro a giro). */
function rollMany(banner, target, state, times, ri) {
  const results = [];
  let st = { sinceRare: state.sinceRare | 0, sinceTop: state.sinceTop | 0, guaranteed: !!state.guaranteed };
  for (let i = 0; i < times; i++) {
    const r = rollOne(banner, target, st, ri);
    results.push(r.result);
    st = r.state;
  }
  return { results, state: st };
}

/** Taxa consolidada da faixa Topo com a garantia (1 / giros esperados até o Topo). */
function consolidatedTop(p) {
  // giros esperados com teto T: Σ_{k=0}^{T-1} (1-p)^k
  let e = 0;
  for (let k = 0; k < PITY.top; k++) e += (1 - p) ** k;
  return 1 / e;
}
const pct = (x) => Math.round(x * 100000) / 1000;

/** O que a tela publica: chances BASE (sem garantia), garantias e a taxa consolidada do Topo. */
function publicRules() {
  const classRates = RANKS.map((r) => ({ rank: r, tier: CLASS_TIER[r], base: pct(CLASS_WEIGHT[r] / 1000) }));
  const topClass = (CLASS_WEIGHT.legendary + CLASS_WEIGHT.divine) / 1000;
  return {
    version: GACHA_VERSION,
    currency: CURRENCY,
    costPerPull: COST_PER_PULL,
    times: TIMES,
    pity: PITY,
    banners: [
      { id: "weapons", target: TARGET.weapons, rates: classRates.map((x) => ({ ...x, qty: WEAPON_QTY[x.rank], item: WP.fragmentOf(x.rank) })), topConsolidated: pct(consolidatedTop(topClass)) },
      { id: "protections", target: TARGET.protections, rates: classRates.map((x) => ({ ...x, qty: PROTECTION_QTY[x.rank], pieces: PROTECTION_POOL[x.rank].length })), topConsolidated: pct(consolidatedTop(topClass)), targets: Protections.FORGEABLE.map((p) => ({ id: p.id, rank: p.rank, frag: `frag_${p.id}` })) },
      {
        id: "characters", target: TARGET.characters,
        rates: TIERS.map((t) => ({ tier: t, base: pct(CHARACTER_WEIGHT[t] / 1000), qty: CHARACTER_QTY[t], from: t === "top" ? "target50" : t === "epic" ? "gods" : "specials" })),
        topConsolidated: pct(consolidatedTop(CHARACTER_WEIGHT.top / 1000)),
        targets: CHARACTERS.map((c) => ({ id: c.id, kind: c.kind, frag: c.frag, capsule: c.capsule })),
      },
    ],
  };
}

/** Confere a regra (unit + boot): pesos, ids existentes e só fragmentos. */
function validate(itemById) {
  const errs = [];
  const sum = (o) => Object.values(o).reduce((s, n) => s + n, 0);
  if (sum(CLASS_WEIGHT) !== 1000) errs.push("CLASS_WEIGHT != 1000");
  if (sum(CHARACTER_WEIGHT) !== 1000) errs.push("CHARACTER_WEIGHT != 1000");
  for (const r of RANKS) if (!(CLASS_WEIGHT[r] > 0) || !Number.isInteger(CLASS_WEIGHT[r])) errs.push(`peso ${r}`);
  const ids = [...RANKS.map(WP.fragmentOf), ...Object.values(PROTECTION_POOL).flat(), ...CHARACTERS.map((c) => c.frag)];
  for (const r of RANKS) if (!PROTECTION_POOL[r].length) errs.push(`proteções sem peça ${r}`);
  for (const id of ids) {
    const it = itemById(id);
    if (!it) errs.push(`não existe ${id}`);
    else if (it.category !== "fragment") errs.push(`não é fragmento ${id}`);
  }
  for (const c of CHARACTERS) if (!itemById(c.capsule)) errs.push(`sem cápsula ${c.capsule}`);
  if (!itemById(CURRENCY)) errs.push(`sem ${CURRENCY}`);
  return errs;
}

module.exports = {
  GACHA_VERSION, CURRENCY, COST_PER_PULL, BATCH, TIMES, PITY, TIERS, CLASS_WEIGHT, CLASS_TIER, CHARACTER_WEIGHT, CHARACTER_QTY,
  WEAPON_QTY, PROTECTION_QTY, PROTECTION_POOL, CHARACTERS, CHARACTER_BY_ID, SPECIALS, GODS, BANNERS, TARGET,
  pickWeighted, normalizeTarget, forcedTier, rollOne, rollMany, consolidatedTop, publicRules, validate,
};
