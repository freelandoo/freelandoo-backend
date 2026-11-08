// Gera src/utils/meuMundoCharacters.js a partir da regra TS dos PERSONAGENS no front
// (B3, 2026-11-08): espécies, altura pela vida ativa, cápsula e fusão — o servidor roda
// a MESMA conta que o navegador mostra. Molde do build-power-sim.
//
//   node scripts/build-characters-sim.js          (grava)
//   node scripts/build-characters-sim.js --check  (sai com 1 se o arquivo estiver desatualizado)
//   MM_FRONT=<pasta do front> troca o caminho padrão (worktree)
//
// O teste test/unit/meuMundoCharacters.test.js também confere que está atualizado.
"use strict";

const fs = require("fs");
const path = require("path");
const { stripTypeScriptTypes } = require("node:module");

const FRONT = process.env.MM_FRONT || path.resolve(__dirname, "../../freelandoo frontend/freelandoo-website-main");
const SIM = path.join(FRONT, "features/meu-mundo/characters");
const OUT = path.resolve(__dirname, "../src/utils/meuMundoCharacters.js");
const MODULES = ["rules"];

function build() {
  const exported = [];
  const parts = [];
  for (const m of MODULES) {
    let src = stripTypeScriptTypes(fs.readFileSync(path.join(SIM, `${m}.ts`), "utf8"), { mode: "strip" });
    src = src.replace(/^export\s+(?=(const|function|class|let)\s)/gm, (s0, kind, off) => {
      const name = /^(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/.exec(src.slice(off + s0.length))[1];
      exported.push(name);
      return "";
    });
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${m}.ts: import/export que o gerador não entende (o módulo dos personagens é puro)`);
    parts.push(`// ── characters/${m}.ts ${"─".repeat(Math.max(4, 64 - m.length))}\n${src.replace(/\n{3,}/g, "\n\n").trim()}\n`);
  }
  return (
    "// GERADO por scripts/build-characters-sim.js a partir de\n" +
    "// freelandoo frontend/.../features/meu-mundo/characters/*.ts — NÃO EDITAR AQUI.\n" +
    "// Mudou a regra dos personagens no front? Rode o script e commite os dois repos juntos.\n" +
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
      console.error("src/utils/meuMundoCharacters.js desatualizado: rode node scripts/build-characters-sim.js");
      process.exit(1);
    }
    console.log("meuMundoCharacters.js em dia");
  } else {
    fs.writeFileSync(OUT, next);
    console.log("gravado", path.relative(process.cwd(), OUT), next.length, "bytes");
  }
}

module.exports = { build, SIM, OUT };
