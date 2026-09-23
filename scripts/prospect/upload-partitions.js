#!/usr/bin/env node
// scripts/prospect/upload-partitions.js
// Sobe as partições geradas para o R2.
//
//   node scripts/prospect/upload-partitions.js            (tudo que existe)
//   node scripts/prospect/upload-partitions.js --uf SP
//   node scripts/prospect/upload-partitions.js --dry-run
//
// ⚠️ O PREFIXO E VERSIONADO POR MES (`prospect/osm/2026-09/...`), e nao fixo.
// A substituicao no lugar teria uma janela — entre apagar o velho e terminar
// de gravar o novo — em que a busca de alguem leria um arquivo pela metade ou
// um 404. Com versao, o mes novo sobe inteiro ao lado do antigo e a troca e
// uma linha de configuracao; e se o lote sair errado, voltar e apontar de volta
// para o mes anterior, que continua intacto.

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const r2 = require("../../src/services/r2Client");
const { currentPrefix } = require("../../src/integrations/companyProvider/r2Partition");

const OUT = path.resolve(__dirname, "../../.prospect-out");

function log(...a) {
  console.log(new Date().toISOString().slice(11, 19), ...a);
}

async function main() {
  const args = process.argv.slice(2);
  const get = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : null;
  };
  const onlyUf = (get("--uf") || "").toUpperCase();
  const dry = args.includes("--dry-run");
  const prefix = get("--prefix") || currentPrefix();

  if (!process.env.R2_BUCKET_NAME) throw new Error("R2_BUCKET_NAME ausente");
  if (!fs.existsSync(OUT)) throw new Error("nada gerado ainda: rode build-partitions.js");

  const files = [];
  for (const dir of fs.readdirSync(OUT)) {
    if (!dir.startsWith("uf=")) continue;
    const uf = dir.slice(3);
    if (onlyUf && uf !== onlyUf) continue;
    for (const f of fs.readdirSync(path.join(OUT, dir))) {
      if (!f.endsWith(".ndjson.gz")) continue;
      files.push({ uf, name: f, local: path.join(OUT, dir, f) });
    }
  }

  log("prefixo: " + prefix);
  log("arquivos: " + files.length + (dry ? " (DRY RUN)" : ""));

  let bytes = 0;
  for (const f of files) {
    const body = fs.readFileSync(f.local);
    const key = prefix + "/uf=" + f.uf + "/" + f.name;
    bytes += body.length;
    if (dry) {
      log("  [dry] " + key + " (" + (body.length / 1024).toFixed(0) + " KB)");
      continue;
    }
    await r2.send(
      new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: body,
        ContentType: "application/x-ndjson",
        ContentEncoding: "gzip",
        // Imutavel: o conteudo de um mes nunca muda, entao cache longo e seguro
        // e o proximo lote sobe num prefixo diferente.
        CacheControl: "public, max-age=31536000, immutable",
      })
    );
    log("  ok " + key + " (" + (body.length / 1024).toFixed(0) + " KB)");
  }

  log("total: " + (bytes / 1024 / 1024).toFixed(1) + " MB em " + files.length + " objetos");
  if (!dry) {
    log("");
    log("para o backend usar este lote, defina no Railway:");
    log("  PROSPECT_R2_PREFIX=" + prefix);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
