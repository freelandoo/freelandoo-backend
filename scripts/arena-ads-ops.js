// Operação das campanhas da Freelandoo Arena (M11). SIMULA por padrão.
//
//   node scripts/arena-ads-ops.js status            --campaign <code>
//   node scripts/arena-ads-ops.js approve           --campaign <code> --by "Nome do aprovador" [--apply]
//   node scripts/arena-ads-ops.js schedule          --campaign <code> --from 2026-10-18T00:00:00Z --to 2026-10-25T00:00:00Z [--apply]
//   node scripts/arena-ads-ops.js set-creative      --campaign <code> --version 2 [--apply]
//   node scripts/arena-ads-ops.js book              --campaign <code> --placement ad-sp-xxxxxxxxxxxxxxxx [--from ..] [--to ..] [--apply]
//   node scripts/arena-ads-ops.js cancel-booking    --campaign <code> --booking <uuid> [--apply]
//   node scripts/arena-ads-ops.js activate          --campaign <code> [--apply]
//   node scripts/arena-ads-ops.js pause             --campaign <code> [--apply]
//   node scripts/arena-ads-ops.js end               --campaign <code> [--apply]
//   node scripts/arena-ads-ops.js withdraw          --campaign <code> [--apply]    (retirada de segurança)
//   node scripts/arena-ads-ops.js withdraw-creative --campaign <code> --version 1 [--apply]
//   node scripts/arena-ads-ops.js metrics           --campaign <code> [--from ..] [--to ..]
//
// Janela [início, fim): início inclusivo, fim EXCLUSIVO, UTC, relógio do banco.
// Usa DATABASE_URL. ⚠️ Com o .env do backend isso é PRODUÇÃO.

require("dotenv").config();
const { Client } = require("pg");
const ops = require("../src/services/ArenaAdOps");

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const val = (f) => (args.indexOf(f) >= 0 ? args[args.indexOf(f) + 1] : undefined);
  const apply = args.includes("--apply");
  const code = val("--campaign");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    let out;
    if (cmd === "status") out = await ops.status(client, { code });
    else if (cmd === "approve") out = await ops.approve(client, { code, by: val("--by") }, apply);
    else if (cmd === "schedule") out = await ops.schedule(client, { code, startsAt: val("--from"), endsAt: val("--to") }, apply);
    else if (cmd === "set-creative") out = await ops.setCreative(client, { code, version: val("--version") }, apply);
    else if (cmd === "book") out = await ops.book(client, { code, placementId: val("--placement"), startsAt: val("--from"), endsAt: val("--to") }, apply);
    else if (cmd === "cancel-booking") out = await ops.cancelBooking(client, { code, bookingId: val("--booking") }, apply);
    else if (cmd === "activate") out = await ops.activate(client, { code }, apply);
    else if (cmd === "pause") out = await ops.pause(client, { code }, apply);
    else if (cmd === "end") out = await ops.end(client, { code }, apply);
    else if (cmd === "withdraw") out = await ops.withdraw(client, { code }, apply);
    else if (cmd === "withdraw-creative") out = await ops.withdrawCreative(client, { code, version: val("--version") }, apply);
    else if (cmd === "metrics") {
      const { metrics } = require("../src/services/ArenaAdService");
      out = (await metrics({ campaign: code, from: val("--from"), to: val("--to") }, { db: client })).body;
    } else {
      console.error("comando desconhecido; veja o cabeçalho do arquivo");
      process.exitCode = 1;
      return;
    }
    if (out && out.ok === false) process.exitCode = 1;
    const tag = cmd === "status" || cmd === "metrics" ? "" : apply ? "APLICADO " : "SIMULAÇÃO (nada gravado) ";
    console.log(tag + JSON.stringify(out, null, 2));
  } finally {
    await client.end();
  }
}
main().then(() => process.exit(process.exitCode ?? 0)).catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
