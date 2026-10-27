// Gera src/utils/meuMundoCorrida.js a partir da regra TS da Corrida no
// front (mm3d-39b): o servidor roda o MESMO código que o navegador. Os tipos
// saem com o stripTypeScriptTypes do Node; os módulos viram um arquivo
// CommonJS só (os nomes de topo não se repetem entre eles — o script confere).
//
//   node scripts/build-corrida-sim.js          (grava)
//   node scripts/build-corrida-sim.js --check  (sai com 1 se o arquivo estiver desatualizado)
//
// O teste test/unit/meuMundoCorrida.test.js também confere que está atualizado.
"use strict";

const fs = require("fs");
const path = require("path");
const { stripTypeScriptTypes } = require("node:module");

const SIM = path.resolve(__dirname, "../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/corrida/sim");
const OUT = path.resolve(__dirname, "../src/utils/meuMundoCorrida.js");
// Ordem de dependência (cada um só usa os de cima).
const MODULES = ["track", "race"];

function build() {
  const exported = [];
  const seen = new Set();
  const parts = [];
  for (const m of MODULES) {
    let src = stripTypeScriptTypes(fs.readFileSync(path.join(SIM, `${m}.ts`), "utf8"), { mode: "strip" });
    // imports entre os módulos somem (tudo vira um escopo só)
    src = src.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "");
    src = src.replace(/^export\s+\{[^}]*\}\s+from\s+['"][^'"]+['"];?\s*$/gm, "");
    src = src.replace(/^export\s+(?=(const|function|class|let)\s)/gm, (s0, kind, off) => {
      const name = /^(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/.exec(src.slice(off + s0.length))[1];
      exported.push(name);
      return "";
    });
    for (const [, name] of src.matchAll(/^(?:const|function|class|let)\s+([A-Za-z_$][\w$]*)/gm)) {
      if (seen.has(name)) throw new Error(`nome repetido entre módulos da sim: ${name} (${m}.ts)`);
      seen.add(name);
    }
    if (/^\s*(import|export)\b/m.test(src)) throw new Error(`${m}.ts: import/export que o gerador não entende`);
    parts.push(`// ── sim/${m}.ts ${"─".repeat(Math.max(4, 66 - m.length))}\n${src.replace(/\n{3,}/g, "\n\n").trim()}\n`);
  }
  return (
    "// GERADO por scripts/build-corrida-sim.js a partir de\n" +
    "// freelandoo frontend/.../features/meu-mundo/corrida/sim/*.ts — NÃO EDITAR AQUI.\n" +
    "// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.\n" +
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
      console.error("src/utils/meuMundoCorrida.js desatualizado: rode node scripts/build-corrida-sim.js");
      process.exit(1);
    }
    console.log("meuMundoCorrida.js em dia");
  } else {
    fs.writeFileSync(OUT, next);
    console.log("gravado", path.relative(process.cwd(), OUT), next.length, "bytes");
  }
}

module.exports = { build, SIM, OUT };
