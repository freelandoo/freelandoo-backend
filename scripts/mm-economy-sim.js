#!/usr/bin/env node
// scripts/mm-economy-sim.js — trilha E, fatia E20: SIMULADOR DA ECONOMIA do Meu Mundo (regra REAL).
//
//   node scripts/mm-economy-sim.js            três perfis (5, 15 e 40 vitórias por dia), 120 dias, em texto
//   node scripts/mm-economy-sim.js --md       as tabelas do GDD (seção N)
//   node scripts/mm-economy-sim.js --json     tudo em JSON (o teste meuMundoEquidade.test.js usa `simulate`)
//   node scripts/mm-economy-sim.js --days 90  outro horizonte
//
// Um dia de jogo, para cada vitória: XP (Adv.fightXp) e Esmeraldas (B.income) contra monstro do nível de
// quem joga (rua e Domínios: o nível é o do monstro); atributo pelo drop de adulto (15 por vitória, pesos
// FIGHT_DROP) com o freio da régua (Adv.dropPace, A14); saque sorteado pela TABELA REAL (Items.rollTable,
// semente fixa): o melhor setor de Domínio aberto cujo Poder recomendado o jogador já tem, senão a rua.
// Gasta como um jogador cuidadoso: fabrica pelo fragmento assim que pode (raro = peça de conjunto, épico =
// amuleto, lendário = arma de linha) e aprimora o kit de 8 peças pelo custo garantido (forge-v2: Esmeraldas,
// Pedras e a Ascensão no +10 com Selos). Poder = powerOf (a mesma régua do servidor, sem o peso da skin).
// Não muda nenhuma regra: só mede. Limites: luta sempre vencida (o perfil já é "vitórias por dia"),
// disposição cheia, sem minijogo (fichas) e sem baú.
"use strict";

const A = require("../src/utils/meuMundoAdventure");
const F = require("../src/utils/meuMundoFight");
const Items = require("../src/utils/mmItems");
const Gear = require("../src/utils/meuMundoGear");
const B = require("../src/utils/mmItems/rules/budget");
const Upgrade = require("../src/utils/mmItems/rules/upgrade");
const Ascend = require("../src/utils/mmItems/rules/ascend");
const Power = require("../src/utils/meuMundoPower");
const Domains = require("../src/utils/meuMundoDomains");

const PROFILES = Object.freeze([5, 15, 40]);
const KIT_SLOTS = Object.freeze(["weapon", "offhand", "helm", "chest", "gloves", "boots", "amulet", "relic"]);
const XP_KIND = "cavaleiro";

/** Sorteio determinístico (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** O kit de 8 peças do jogador: começa nas comuns (T1) e troca pela melhor fabricada de cada raridade. */
function starterKit() {
  const pick = (slot) => Items.GEAR.find((g) => g.slot === slot && g.keys && g.rarity === "common") || Items.GEAR.find((g) => g.slot === slot && g.keys);
  return Object.fromEntries(KIT_SLOTS.map((s) => [s, { item: pick(s), plus: 0, ascended: false }]).filter(([, p]) => p.item));
}

const powerOf = (s, naked = false) => Power.powerOf(F, {
  attrs: s.attrs, level: s.level,
  gear: naked ? {} : Gear.gearBonus(Object.fromEntries(Object.entries(s.kit).map(([slot, p]) => [slot, { id: p.item.id, level: p.plus, grade: 1 }]))),
});

/** A tabela que o jogador farma hoje: o melhor setor aberto cujo Poder recomendado ele tem; senão a rua. */
function tableFor(s) {
  let best = null;
  for (const d of Domains.DOMAINS) {
    if (s.level < d.need) continue;
    for (let sec = 1; sec <= 10; sec++) if (Domains.recommendedPower(d.id, sec) <= s.power) best = { table: `domain:${d.id}:${sec}`, domain: d.id, sector: sec };
  }
  return best || { table: "mob:common", domain: null, sector: null };
}

/** Receitas de fabricar por fragmento, por raridade da saída (as que dão uma peça do kit). */
const CRAFT = Items.RECIPES.filter((r) => r.kind === "fragment" && Items.GEAR_BY_ID.get(r.out)?.slot);

function tryCraft(s, day) {
  for (const r of CRAFT) {
    const out = Items.GEAR_BY_ID.get(r.out);
    if (s.made.has(out.id)) continue;
    if (r.recipe && !(s.bag[r.recipe] > 0)) continue;
    if (Object.entries(r.needs).some(([id, n]) => (s.bag[id] || 0) < n) || s.coins < r.coins) continue;
    for (const [id, n] of Object.entries(r.needs)) s.bag[id] -= n;
    s.coins -= r.coins;
    s.made.add(out.id);
    if (s.first[out.rarity] == null) s.first[out.rarity] = day;
    const cur = s.kit[out.slot];
    if (!cur || B.TIER[out.rarity] > B.TIER[cur.item.rarity]) s.kit[out.slot] = { item: out, plus: cur ? cur.plus : 0, ascended: cur ? cur.ascended : false };
  }
}

/** Aprimora o kit: sempre o passo mais barato (a peça de menor +). Devolve true se o kit está todo no +15. */
function tryUpgrade(s) {
  for (let guard = 0; guard < 200; guard++) {
    const list = Object.values(s.kit).filter((p) => p.plus < Upgrade.MAX_PLUS).sort((a, b) => a.plus - b.plus);
    if (!list.length) return true;
    const p = list[0];
    const cost = Upgrade.upgradeCost(p.item, p.plus);
    if (cost.ascension && !p.ascended) {
      const asc = Ascend.ascendCost(p.item, { plus: p.plus, ascended: false });
      if (asc.error || (s.bag.selo_dominio || 0) < asc.needs.selo_dominio) return false;
      s.bag.selo_dominio -= asc.needs.selo_dominio;
      p.ascended = true;
      continue;
    }
    const stones = cost.needs[Upgrade.STONE];
    if (s.coins < cost.coins || (s.bag[Upgrade.STONE] || 0) < stones) return false;
    s.coins -= cost.coins;
    s.bag[Upgrade.STONE] -= stones;
    p.plus = cost.to;
  }
  return false;
}

/**
 * Simula `days` dias de `perDay` vitórias. Devolve a série diária e os marcos:
 * { first: { rare, epic, legendary }, kit15, powerAt: { dia: Poder }, reach: { "<domínio>:<setor>": dia } }.
 */
function simulate(perDay, days = 120, seed = 7, whatIf = {}) {
  const R = seeded(seed * 1000 + perDay);
  const s = { xp: 0, level: 1, attrs: { strength: 100, speed: 100, intelligence: 100, dexterity: 100 }, coins: 0, bag: {}, kit: starterKit(), made: new Set(), first: {}, kit15: null, reach: {}, power: 0 };
  s.power = powerOf(s);
  const series = [];
  const weights = A.FIGHT_DROP.weights;
  for (let day = 1; day <= days; day++) {
    for (let w = 0; w < perDay; w++) {
      const where = tableFor(s);
      if (where.domain && s.reach[`${where.domain}:${where.sector}`] == null) s.reach[`${where.domain}:${where.sector}`] = day;
      // hipótese (não é regra): XP e drop de atributo da vitória além da `after`-ésima do dia valem `mult`
      const tired = whatIf.after != null && w >= whatIf.after ? whatIf.mult : 1;
      s.xp += A.fightXp(XP_KIND, s.level, true) * tired;
      s.coins += B.income(s.level);
      for (const [k, wt] of Object.entries(weights)) s.attrs[k] = (s.attrs[k] || 0) + A.FIGHT_DROP.adult * wt * A.dropPace(s.attrs[k] || 0, s.level) * tired;
      for (const d of Items.rollTable(where.table, { win: true, activeMs: 180000, first: !s.bag[`first:${where.table}`] }, R)) s.bag[d.id] = (s.bag[d.id] || 0) + d.qty;
      s.bag[`first:${where.table}`] = 1;
      s.level = A.levelOf(s.xp).level;
    }
    tryCraft(s, day);
    if (tryUpgrade(s) && s.kit15 == null) s.kit15 = day;
    s.power = powerOf(s);
    series.push({ day, level: s.level, power: s.power, naked: powerOf(s, true), coins: Math.round(s.coins), plus: Math.round(Object.values(s.kit).reduce((a, p) => a + p.plus, 0) / Object.keys(s.kit).length * 10) / 10 });
  }
  return { perDay, days, series, first: s.first, kit15: s.kit15, reach: s.reach, powerAt: Object.fromEntries([30, 60, 90, days].filter((d) => d <= days).map((d) => [d, series[d - 1].power])) };
}

/** A razão de Poder entre o perfil mais ativo e o menos ativo, nos dias pedidos (alvo ≤ 1,6). */
function powerRatio(days = [30, 90], horizon = Math.max(...days), whatIf = {}) {
  const lo = simulate(PROFILES[0], horizon, 7, whatIf), hi = simulate(PROFILES[PROFILES.length - 1], horizon, 7, whatIf);
  return Object.fromEntries(days.map((d) => [d, Math.round((hi.series[d - 1].power / lo.series[d - 1].power) * 100) / 100]));
}

/**
 * Quanto o EQUIPAMENTO abre a distância: (Poder com o kit ÷ Poder sem ele) do perfil mais ativo dividido
 * pelo do menos ativo. 1 = o equipamento multiplica os dois igual; a distância de Poder que sobra vem do
 * nível e do atributo (XP por vitória, sem teto por dia).
 */
function gearAmp(days = [30, 90], horizon = Math.max(...days)) {
  const lo = simulate(PROFILES[0], horizon), hi = simulate(PROFILES[PROFILES.length - 1], horizon);
  const m = (r, d) => r.series[d - 1].power / r.series[d - 1].naked;
  return Object.fromEntries(days.map((d) => [d, Math.round((m(hi, d) / m(lo, d)) * 100) / 100]));
}

function all(days = 120) {
  const runs = PROFILES.map((p) => simulate(p, days));
  const at = [30, 90].filter((d) => d <= days);
  return { runs, ratio: powerRatio(at, days), gearAmp: gearAmp(at, days) };
}

function printText(x) {
  for (const r of x.runs) {
    console.log(`\n== ${r.perDay} vitórias por dia (${r.days} dias) ==`);
    console.log(`primeiro raro: dia ${r.first.rare ?? "—"} · épico: dia ${r.first.epic ?? "—"} · lendário: dia ${r.first.legendary ?? "—"} · kit +15: dia ${r.kit15 ?? "—"}`);
    console.log(`Poder: ${Object.entries(r.powerAt).map(([d, p]) => `dia ${d} = ${p}`).join(" · ")}`);
    const rc = Object.entries(r.reach).filter(([k]) => /:(1|5|10)$/.test(k)).map(([k, d]) => `${k} dia ${d}`);
    console.log(`setores alcançados: ${rc.join(" · ") || "nenhum"}`);
  }
  console.log(`\no equipamento abre a distância em: ${Object.entries(x.gearAmp).map(([d, v]) => `dia ${d} = ×${v}`).join(" · ")} (com kit ÷ sem kit, 40 ÷ 5)`);
  console.log(`razão de Poder 40 ÷ 5 vitórias: ${Object.entries(x.ratio).map(([d, v]) => `dia ${d} = ${v}`).join(" · ")} (alvo ≤ 1,6)`);
}

function printMd(x) {
  const cell = (v) => (v == null ? "—" : String(v));
  console.log("| Perfil | 1º raro | 1º épico | 1º lendário | kit +15 | Poder dia 30 | Poder dia 90 |");
  console.log("|---|---|---|---|---|---|---|");
  for (const r of x.runs) console.log(`| ${r.perDay}/dia | ${cell(r.first.rare)} | ${cell(r.first.epic)} | ${cell(r.first.legendary)} | ${cell(r.kit15)} | ${cell(r.powerAt[30])} | ${cell(r.powerAt[90])} |`);
  console.log(`\nO equipamento abre a distância em ${Object.entries(x.gearAmp).map(([d, v]) => `×${String(v).replace(".", ",")} no dia ${d}`).join(" e ")} (Poder com kit ÷ sem kit, do perfil de 40 sobre o de 5).`);
  console.log(`\nRazão de Poder (40 ÷ 5 vitórias por dia): ${Object.entries(x.ratio).map(([d, v]) => `dia ${d} = ${String(v).replace(".", ",")}`).join(" · ")} (alvo ≤ 1,6).\n`);
  console.log("| Setor | Poder recomendado | " + x.runs.map((r) => `${r.perDay}/dia`).join(" | ") + " |");
  console.log("|---|---|" + x.runs.map(() => "---").join("|") + "|");
  for (const d of Domains.DOMAINS) for (const sec of [1, 5, 10]) {
    console.log(`| ${d.id} ${sec} | ${Domains.recommendedPower(d.id, sec)} | ${x.runs.map((r) => cell(r.reach[`${d.id}:${sec}`])).join(" | ")} |`);
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--days");
  const days = i >= 0 ? Math.max(1, Number(args[i + 1]) || 120) : 120;
  const x = all(days);
  if (args.includes("--json")) console.log(JSON.stringify(x, null, 2));
  else if (args.includes("--md")) printMd(x);
  else printText(x);
}

module.exports = { PROFILES, simulate, powerRatio, gearAmp, all };
