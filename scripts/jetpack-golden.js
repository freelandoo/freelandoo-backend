// Grava o fixture de ouro da simulação do jetpack (mm3d-21, S0).
// Rodar UMA vez, com a sim do mm3d-20 ainda intacta:  node scripts/jetpack-golden.js
// Depois disso o fixture só muda de propósito (mudança de regra do jogo).
"use strict";

const fs = require("fs");
const path = require("path");
const { loadFront } = require("../test/unit/_frontTs");
const { golden } = require("../test/unit/_jetpackScript");

(async () => {
  const { World } = await loadFront("sim/world.ts");
  const { autopilot } = await loadFront("sim/autopilot.ts");
  const g = golden(World, autopilot);
  const file = path.join(__dirname, "../test/fixtures/jetpack-golden.json");
  fs.writeFileSync(file, JSON.stringify(g));
  for (const [k, v] of Object.entries(g)) console.log(k.padEnd(12), "passos", v.ticks, v.state, "dist", v.distance, "eventos", v.events.length);
})();
