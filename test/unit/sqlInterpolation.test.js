// Segurança A4 (SQL): nenhum dado do pedido entra no TEXTO de uma consulta.
//
// A auditoria de 2026-11-14 leu as 628 interpolações `${...}` dentro de SQL do `src/`: todas são
// constante, lista fechada (mapa de ordenação, whitelist de coluna, `assertPlatformKind`), número
// de placeholder (`$${n}`) ou trecho montado pelo próprio código — valor de usuário vai sempre por
// `$n`. Este teste segura a regra para o código novo: `${req…}`, `${body…}`, `${query…}`,
// `${params…}` (e afins) dentro de um template com SELECT/UPDATE/INSERT/DELETE falha aqui.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");
const SQL = /\b(SELECT|UPDATE|INSERT|DELETE)\b/;
const RAW = /\$\{\s*(req|request|body|query|params|input|payload|args)\b[^}]*\}/g;

function walk(dir, out) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) {
      if (!/node_modules|migrations/.test(p)) walk(p, out);
    } else if (p.endsWith(".js")) out.push(p);
  }
  return out;
}

test("nenhum dado do pedido interpolado no texto de SQL", () => {
  const hits = [];
  for (const file of walk(SRC, [])) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/`([^`]*)`/g)) {
      if (!SQL.test(m[1])) continue;
      for (const e of m[1].matchAll(RAW)) {
        // `$${params.length}` é o NÚMERO do placeholder (o `$` antes do `${`), não um valor
        if (m[1][e.index - 1] === "$" || /\.length\b/.test(e[0])) continue;
        hits.push(`${path.relative(SRC, file)}: ${e[0]}`);
      }
    }
  }
  assert.deepStrictEqual(hits, [], `use $n e passe o valor nos parâmetros:\n${hits.join("\n")}`);
});

test("o detector pega o padrão proibido", () => {
  const sample = "`SELECT * FROM t WHERE id = ${req.params.id}`";
  const body = sample.slice(1, -1);
  assert.ok(SQL.test(body) && [...body.matchAll(RAW)].length === 1);
});
