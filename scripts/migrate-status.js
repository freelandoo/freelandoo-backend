// Lista status de cada migration contra o banco corrente.
// Saída legível em stdout + exit 0 sempre que conseguir conectar.
//
// Estados:
//   applied              — checksum bate, OK.
//   pending              — arquivo existe, não foi aplicado.
//   checksum_mismatch    — aplicado, mas arquivo mudou desde então.
//                          (boot vai abortar quando rodar.)

require("dotenv").config();

const { listStatus } = require("../src/migrations/runner");

(async () => {
  try {
    const rows = await listStatus();
    const counts = { applied: 0, pending: 0, checksum_mismatch: 0 };
    for (const row of rows) counts[row.state] = (counts[row.state] || 0) + 1;

    console.log("migration status:");
    for (const row of rows) {
      const tag = row.state.padEnd(18, " ");
      console.log(`  [${tag}] ${row.file}`);
    }
    console.log("");
    console.log(
      `summary: applied=${counts.applied} pending=${counts.pending} ` +
        `mismatch=${counts.checksum_mismatch}`
    );
    process.exit(0);
  } catch (err) {
    console.error("migrate-status fatal:", err.message);
    process.exit(1);
  }
})();
