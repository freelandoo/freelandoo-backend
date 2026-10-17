// Catálogo e posse de avatares da Freelandoo Arena (mig 285).
//
//   node scripts/arena-avatars.js                       → SIMULA a sincronização
//   node scripts/arena-avatars.js --apply               → grava o catálogo
//   node scripts/arena-avatars.js --file outro.json
//   node scripts/arena-avatars.js --grant <username> <modelId> --ref <motivo> --apply
//   node scripts/arena-avatars.js --revoke <username> <modelId> --apply
//
// O arquivo padrão é gerado no repositório freelandoo-arena por
// `npm run avatars:export`. Concessão manual tem origem 'admin' e uma
// referência única (--ref): repetir com a mesma referência não concede duas
// vezes. Usa DATABASE_URL. ⚠️ Com o .env do backend isso é PRODUÇÃO: rodar
// sem --apply primeiro, sempre.

require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { syncAvatars } = require("../src/services/ArenaAvatarSync");
const ArenaAvatarStorage = require("../src/storages/ArenaAvatarStorage");

async function userIdOf(client, username) {
  const r = await client.query("SELECT id_user FROM public.tb_user WHERE username = $1", [username.replace(/^@/, "")]);
  if (!r.rows[0]) throw new Error(`usuário não encontrado: ${username}`);
  return r.rows[0].id_user;
}

async function main() {
  const args = process.argv.slice(2);
  const val = (flag, k = 1) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + k] : null;
  };
  const apply = args.includes("--apply");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    if (args.includes("--grant") || args.includes("--revoke")) {
      const flag = args.includes("--grant") ? "--grant" : "--revoke";
      const id_user = await userIdOf(client, val(flag, 1));
      const modelId = val(flag, 2);
      await client.query("BEGIN");
      let out;
      if (flag === "--grant") {
        const ref = val("--ref");
        if (!ref) throw new Error("--grant exige --ref <motivo único>");
        out = await ArenaAvatarStorage.grantAdmin(client, id_user, modelId, `admin:${ref}`);
      } else {
        out = await ArenaAvatarStorage.revoke(client, id_user, modelId);
      }
      await client.query(apply ? "COMMIT" : "ROLLBACK");
      console.log(`${apply ? "APLICADO" : "SIMULAÇÃO (nada gravado)"}:`, flag, modelId, out ? "ok" : "sem efeito (já estava assim)");
      return;
    }
    const file = val("--file") ? path.resolve(val("--file")) : path.join(__dirname, "..", "src", "databases", "seeds", "arena-avatars.json");
    const doc = JSON.parse(fs.readFileSync(file, "utf8"));
    const out = await syncAvatars(client, doc, { apply });
    if (!out.ok) {
      console.error("Documento inválido:\n  - " + out.errors.join("\n  - "));
      process.exitCode = 1;
      return;
    }
    console.log(`${apply ? "APLICADO" : "SIMULAÇÃO (nada gravado)"}:`, out.summary);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});
