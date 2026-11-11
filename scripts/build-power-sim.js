// Gera src/utils/meuMundoPower.js a partir da regra TS do PODER no front (T3,
// 2026-11-08): o servidor grava o MESMO número que o navegador calcula. Os tipos
// saem com o stripTypeScriptTypes do Node (o mesmo molde do build-paint-sim).
//
//   node scripts/build-power-sim.js          (grava)
//   node scripts/build-power-sim.js --check  (sai com 1 se o arquivo estiver desatualizado)
//
// O teste test/unit/meuMundoPower.test.js também confere que está atualizado.
"use strict";

const fs = require("fs");
const path = require("path");
const { stripTypeScriptTypes } = require("node:module");

// MM_FRONT = raiz do front (worktree), como nos outros geradores
const SIM = path.join(process.env.MM_FRONT || path.resolve(__dirname, "../../freelandoo frontend/freelandoo-website-main"), "features/meu-mundo/power");
const OUT = path.resolve(__dirname, "../src/utils/meuMundoPower.js");
const MODULES = ["power"];

function build() {
  const exported = [];
  const parts = [];
  for (const m of MODULES) {
    // fim de linha do front (CRLF no Windows) não pode mudar a cópia
    let src = stripTypeScriptTypes(fs.readFileSync(path.join(SIM, `${m}.ts`), "utf8").replace(/\r\n/g, "\n"), { mode: "strip" });
    src = src.replace(/^export\s+(?=(const|function|class|let)\s)/gm, (s0, kind, off) => {
      const name = /^(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/.exec(src.slice(off + s0.length))[1];
      exported.push(name);
      return "";
    });
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${m}.ts: import/export que o gerador não entende (o módulo do poder é puro)`);
    parts.push(`// ── power/${m}.ts ${"─".repeat(Math.max(4, 64 - m.length))}\n${src.replace(/\n{3,}/g, "\n\n").trim()}\n`);
  }
  return (
    "// GERADO por scripts/build-power-sim.js a partir de\n" +
    "// freelandoo frontend/.../features/meu-mundo/power/*.ts — NÃO EDITAR AQUI.\n" +
    "// Mudou a regra do poder no front? Rode o script e commite os dois repos juntos.\n" +
    "/* eslint-disable */\n\"use strict\";\n\n" +
    parts.join("\n") +
    `\nmodule.exports = { ${exported.join(", ")} };\n`
  );
}

if (require.main === module) {
  const next = build();
  if (process.argv.includes("--check")) {
    const cur = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n") : "";
    if (cur !== next) {
      console.error("src/utils/meuMundoPower.js desatualizado: rode node scripts/build-power-sim.js");
      process.exit(1);
    }
    console.log("meuMundoPower.js em dia");
  } else {
    fs.writeFileSync(OUT, next);
    console.log("gravado", path.relative(process.cwd(), OUT), next.length, "bytes");
  }
}

module.exports = { build, SIM, OUT };
