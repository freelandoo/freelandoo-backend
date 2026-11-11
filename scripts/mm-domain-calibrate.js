#!/usr/bin/env node
// scripts/mm-domain-calibrate.js — MEU MUNDO 3D, lore v2 D2: calibra os setores de
// um Domínio com ROBÔ lutando a regra de verdade (a cópia gerada da luta,
// utils/meuMundoFight.js — a mesma que o servidor re-simula).
//
// O robô: anda até o monstro mais perto, ataca, esquiva quando um golpe vem
// (aviso dentro do alcance), usa Corte/Investida/Escudo quando a recarga deixa e
// solta o Poder Máximo com a barra cheia. Não é um jogador bom: é um jogador
// médio e sempre igual, para comparar setores entre si.
//
// Quem luta: uma ficha com Poder P (régua do B7: atributos + HP do nível), no
// nível de aventura `hero`, com os 5 atributos iguais. Para cada setor e cada
// nível de monstro mede a taxa de vitória em N sementes.
//
//   node scripts/mm-domain-calibrate.js [domínio] [--n 40] [--json saida.json]
//
// A tabela que sai daqui foi colada em utils/meuMundoDomains.js (LEVELS_BY_DOMAIN
// e o Poder recomendado medido). Não roda no servidor.
"use strict";

const F = require("../src/utils/meuMundoFight");
const D = require("../src/utils/meuMundoDomains");

const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : d;
};
const domain = args.find((a) => !a.startsWith("--") && D.domainOf(a)) || "floresta";
const N = Number(opt("--n", 40));

const MAX_STEPS = 4 * 60 * 60; // 4 min de luta

/** Um robô médio: decide a entrada de um passo olhando a luta. */
function botInput(f, mem) {
  const me = f.me;
  const alive = f.mobs.filter((m) => m.state !== "dead" && m.hp > 0);
  const inp = { mx: 0, mz: 0, run: false, attack: false, dodge: false, power: false, slash: false, dash: false, shield: false };
  if (!alive.length) return inp;
  let t = alive[0];
  let best = Infinity;
  for (const m of alive) {
    const d = Math.hypot(m.x - me.x, m.z - me.z);
    if (d < best) {
      best = d;
      t = m;
    }
  }
  const dx = t.x - me.x;
  const dz = t.z - me.z;
  const len = Math.hypot(dx, dz) || 1;
  // golpe vindo: esquiva para o lado (um aviso por vez, com tempo de reação)
  const threat = alive.find((m) => m.state === "windup" && Math.hypot(m.x - me.x, m.z - me.z) < 5);
  if (threat && mem.react <= 0 && f.R() < 0.55) {
    mem.react = 0.5;
    const s = f.R() < 0.5 ? 1 : -1;
    inp.mx = (-dz / len) * s;
    inp.mz = (dx / len) * s;
    inp.dodge = mem.toggle = !mem.toggle;
    return inp;
  }
  mem.react -= F.DT;
  const cd = me.cd || {};
  if (me.power >= (F.POWER ? F.POWER.max : 100) && best < 3.5) inp.power = (mem.p = !mem.p);
  else if (me.hp < me.hpMax * 0.5 && !cd.shield) inp.shield = (mem.s = !mem.s);
  else if (best > 3 && best < 7 && !cd.slash) inp.slash = (mem.c = !mem.c);
  else if (best > 3 && best < 8 && !cd.dash) inp.dash = (mem.d = !mem.d);
  if (best > 1.6) {
    inp.mx = dx / len;
    inp.mz = dz / len;
    inp.run = best > 4;
  } else {
    inp.mx = (dx / len) * 0.2;
    inp.mz = (dz / len) * 0.2;
    inp.attack = (mem.a = !mem.a);
  }
  return inp;
}

/** Ficha com Poder P no nível de aventura `hero` (atributos iguais; acurácia conta no Poder). */
function persona(P, hero) {
  const hp = F.heroLevelScale(hero).hp;
  const each = Math.max(0, (P - hp) / 5);
  return { strength: each, speed: each, intelligence: each, dexterity: each };
}

function winRate(kind, level, P, hero, n = N) {
  let wins = 0;
  for (let i = 0; i < n; i++) {
    const f = new F.Fight({ kind, level, hero, tier: "domain", seed: 1000 + i * 7919, stats: persona(P, hero), body: null });
    const mem = { react: 0 };
    for (let k = 0; k < MAX_STEPS && !f.over; k++) f.step(botInput(f, mem));
    if (f.over && f.over.win) wins++;
  }
  return wins / n;
}

/** Menor Poder (passo de 25) em que o robô vence pelo menos `target` das lutas. */
function powerFor(kind, level, hero, target, lo = 100, hi = 4000) {
  for (let P = lo; P <= hi; P += 25) if (winRate(kind, level, P, hero) >= target) return P;
  return null;
}

/**
 * --fit: o MAIOR nível (sem descer do setor anterior) em que a ficha com o Poder recomendado
 * do setor ainda vence a fração TARGET do setor. Busca subindo de 1 em 1 (a taxa cai com o nível).
 */
function fit(domainId, n = N) {
  const out = [];
  let prev = 1;
  for (let s = 1; s <= D.SECTORS; s++) {
    const kind = D.kindOf(domainId, s);
    const hero = D.heroOf(domainId, s);
    const P = D.recommendedPower(domainId, s);
    const want = D.TARGET[s - 1];
    let L = prev;
    let w = winRate(kind, L, P, hero, n);
    while (L < 120) {
      const next = winRate(kind, L + 1, P, hero, n);
      if (next < want) break;
      L++;
      w = next;
    }
    out.push({ sector: s, kind, hero, power: P, target: want, level: L, win: w });
    prev = L;
  }
  return out;
}

module.exports = { botInput, persona, winRate, powerFor, fit };

if (require.main === module && args.includes("--fit")) {
  const rows = fit(domain);
  for (const r of rows) console.log(`setor ${String(r.sector).padStart(2)} ${r.kind.padEnd(9)} herói ${r.hero} Poder ${r.power} alvo ${Math.round(r.target * 100)}% → nv ${r.level} (robô vence ${Math.round(r.win * 100)}%)`);
  console.log(`LEVELS ${domain}: [${rows.map((r) => r.level).join(", ")}]`);
} else if (require.main === module) {
  const out = [];
  console.log(`domínio ${domain} · ${N} lutas por ponto`);
  for (let s = 1; s <= D.SECTORS; s++) {
    const kind = D.kindOf(domain, s);
    const level = D.sectorLevel(domain, s);
    const hero = D.heroOf ? D.heroOf(domain, s) : 1;
    const shown = D.recommendedPower(domain, s);
    const w = winRate(kind, level, shown, hero);
    const p60 = powerFor(kind, level, hero, 0.6);
    out.push({ sector: s, kind, level, hero, shown, winAtShown: w, power60: p60 });
    console.log(`setor ${String(s).padStart(2)} ${kind.padEnd(9)} nv ${String(level).padStart(2)} herói ${hero} · Poder mostrado ${shown} → robô vence ${(w * 100).toFixed(0)}% · 60% a partir de ${p60}`);
  }
  const j = opt("--json", null);
  if (j) require("fs").writeFileSync(j, JSON.stringify(out, null, 2));
}
