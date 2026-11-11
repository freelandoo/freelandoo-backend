#!/usr/bin/env node
// scripts/mm-fight-bot.js — trilha E, fatia E4: robô que LUTA (cópia gerada da luta, a mesma do servidor)
// para medir vitórias com e sem equipamento. Entrada do robô = a do e2e dos Domínios (anda, bate a
// cada 9 passos, esquiva a cada 61). Não é o jogador humano: serve para COMPARAR equipamentos.
//
//   node scripts/mm-fight-bot.js                 níveis 1, 10, 30 × sem / lendária +10 de hoje / teto
//   node scripts/mm-fight-bot.js --n 400         lutas por célula (padrão 200)
//   node scripts/mm-fight-bot.js --kind garras   tipo do monstro (padrão brute; tier street no mesmo nível)
"use strict";

const F = require("../src/utils/meuMundoFight");

const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i > 0 ? process.argv[i + 1] : d;
};
const N = Number(arg("--n", 200));
const KIND = arg("--kind", "brute");

const NO = { dmg: 0, def: 0, stam: 0, warn: 0, power: 0 };
const GEARS = {
  sem: NO,
  "lendária +10 (hoje)": { ...NO, dmg: 0.33 },
  teto: { dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18, hp: 0.25, acc: 0.2, spd: 0.15, int: 0.15, dex: 0.15 },
};

/** Atributo na paridade com a velocidade do monstro do mesmo nível (a luta igual do I1). */
function parity(kind, L) {
  const ms = F.MOB_SHEETS[kind];
  const need = Math.max(0, (F.mobBase(L).rate * ms[4]) / 100 - 100 - 3 * (L - 1));
  return { strength: need, speed: need, intelligence: need, dexterity: need };
}

function fight(L, gear, seed) {
  const f = new F.Fight({ kind: KIND, level: L, hero: L, tier: "street", seed, stats: parity(KIND, L), gear });
  for (let i = 0; i < 40000 && !f.over; i++) {
    f.step(F.quantizeInput({ mx: Math.sin(i / 45) * 0.5, mz: 0.85, run: false, attack: i % 9 === 0, dodge: i % 61 === 0 }));
  }
  return { win: !!(f.over && f.over.win), hpLeft: f.me.hp / f.me.hpMax };
}

function measure() {
  const out = {};
  for (const L of [1, 10, 30]) {
    out[L] = {};
    for (const [name, gear] of Object.entries(GEARS)) {
      let wins = 0, hp = 0;
      for (let s = 1; s <= N; s++) {
        const r = fight(L, gear, s * 2654435761);
        if (r.win) wins++;
        hp += r.hpLeft;
      }
      out[L][name] = { wins: wins / N, hpLeft: Math.round((hp / N) * 1000) / 1000 };
    }
  }
  return out;
}

module.exports = { measure, fight, parity };

if (require.main === module) {
  const m = measure();
  console.log(`Robô × ${KIND} (rua, mesmo nível, atributo na paridade), ${N} lutas por célula`);
  for (const [L, row] of Object.entries(m)) {
    console.log(`nível ${L}: ` + Object.entries(row).map(([k, v]) => `${k} ${(v.wins * 100).toFixed(0)}% (vida ${(v.hpLeft * 100).toFixed(0)}%)`).join(" · "));
  }
}
