// Backfill do PODER do Meu Mundo (T3, mig 334): calcula tb_mm_character.power
// das linhas NULL pelo estado gravado. O boot já faz isso sozinho
// (index.js → MeuMundoPowerService.backfill); este script é para rodar à mão.
//
//   node scripts/backfill-mm-power.js
require("dotenv").config();
const MeuMundoPowerService = require("../src/services/MeuMundoPowerService");
const pool = require("../src/databases");

MeuMundoPowerService.backfill()
  .then((n) => console.log(`poder calculado em ${n} hóspedes`))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
