// scripts/sim-reforma-ritmo.js — mm3d-59: o RITMO da progressão com as regras R1.
//
// Usa as regras de verdade (meuMundoLife.gain + meuMundoAdventure.practice):
// orçamento diário por atributo, curva uma vez, memória até o pico. Não
// simula a vida inteira (fome, sono…): só a prática, que é o que a reforma
// mudou. Cenários: sessões diárias de minijogo/luta de 15/30/60/120 min, com
// e sem a rotina passiva (academia 4 h úteis + universidade 5 h), com e sem
// suplementos (multiplicador do base da academia), e dias de ausência.
//
//   node scripts/sim-reforma-ritmo.js
"use strict";

const Life = require("../src/utils/meuMundoLife");
const Adv = require("../src/utils/meuMundoAdventure");

const DAY = 24 * 3600 * 1000;
const T0 = Date.parse("2026-11-03T12:00:00Z"); // 9h em Brasília

function run({ minutes, routine, boost = 1, skipEvery = 0, days = 365 }) {
  const s = Life.birth(7, T0);
  const marks = {};
  let xp = 0;
  let adultDay = null;
  const start = { strength: s.strength, intelligence: s.intelligence };
  for (let d = 0; d < days; d++) {
    const t = T0 + d * DAY;
    if (skipEvery && d % skipEvery === skipEvery - 1) continue; // dia de ausência
    // minijogos/lutas: metade do tempo em luta (força), metade em jogos de destreza
    const half = (minutes / 2) * 60000;
    let at = t;
    for (const act of ["laminas", "gincana", "paint"]) {
      const ms = act === "laminas" ? half : half / 2;
      // partidas de até a janela máxima
      let left = ms;
      while (left > 0) {
        const chunk = Math.min(left, Adv.ACTIVITIES[act].maxMin * 60000);
        const r = Adv.practice(s, act, [{ from: at, to: at + chunk }]);
        xp += act === "laminas" ? 40 : Adv.minigameXp(r.activeMs);
        at += chunk + 60000;
        left -= chunk;
      }
    }
    if (routine) {
      // academia (4 h úteis: força 2/h, velocidade 1,4/h) e universidade (5 h: 1,6 × 1,5 /h)
      Life.gain(s, "strength", 2 * 4 * boost, t + 3 * 3600000);
      Life.gain(s, "speed", 1.4 * 4 * boost, t + 3 * 3600000);
      Life.gain(s, "intelligence", 1.6 * 1.5 * 5, t + 8 * 3600000);
    }
    const gs = s.peaks.strength - start.strength;
    const gi = s.peaks.intelligence - start.intelligence;
    if (adultDay === null && d >= Life.GROWTH.MIN_DAYS && gs >= Life.GROWTH.TARGET.strength && gi >= Life.GROWTH.TARGET.intelligence) adultDay = d;
    if ([29, 89, 364].includes(d)) marks[d + 1] = Object.fromEntries(Life.ATTRS.map((k) => [k, Math.round(s[k])]));
  }
  return { marks, adultDay, level: Adv.levelOf(xp).level };
}

const rows = [];
for (const minutes of [15, 30, 60, 120])
  for (const routine of [false, true])
    for (const boost of routine ? [1, 2.5] : [1]) {
      const r = run({ minutes, routine, boost });
      rows.push({ minutes, routine, boost, ...r });
    }
const absent = run({ minutes: 60, routine: true, boost: 1, skipEvery: 3 });

console.log("RITMO R1 (orçamento diário F12 I12 D12 V8, curva (1−v/1100)², memória até o pico)\n");
console.log("min/dia | rotina | suplem. | 30 d (F/I/D/V)        | 90 d               | 365 d              | adulto (dia) | nível aventura (1 ano)");
for (const r of rows) {
  const f = (m) => (m ? `${m.strength}/${m.intelligence}/${m.dexterity}/${m.speed}`.padEnd(18) : "-".padEnd(18));
  console.log(
    `${String(r.minutes).padStart(7)} | ${(r.routine ? "sim" : "não").padEnd(6)} | ${String(r.boost).padEnd(7)} | ${f(r.marks[30])}    | ${f(r.marks[90])} | ${f(r.marks[365])} | ${String(r.adultDay ?? "não").padEnd(12)} | ${r.level}`
  );
}
console.log(`\n60 min + rotina, faltando 1 dia a cada 3: 365 d = ${JSON.stringify(absent.marks[365])}, adulto no dia ${absent.adultDay ?? "não"}`);
