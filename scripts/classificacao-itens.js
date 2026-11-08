#!/usr/bin/env node
// A6 Classificação — o banco de itens da prova vira MIGRATION (nunca código, nunca
// INSERT direto em produção). Três entradas, um formato:
//
//   node scripts/classificacao-itens.js sql <NNN> <banco.json>...
//       → src/databases/migrations/NNN_classificacao_itens.sql (upsert por `code`)
//
//   node scripts/classificacao-itens.js opentdb <resposta-da-api.json> <saida.json>
//       Open Trivia DB (opentdb.com, CC BY-SA 4.0). A licença EXIGE atribuição: ela
//       vai em cada item (`attribution`) e a tela mostra. Texto em inglês → locale en.
//       Dificuldade easy/medium/hard → b −1 / 0 / 1, a = 1 (sem calibração própria).
//
//   node scripts/classificacao-itens.js enem <ITENS_PROVA_AAAA.csv> <textos.json> <saida.json>
//       Microdados do ENEM (INEP, dado público). O CSV traz os parâmetros da TRI
//       (NU_PARAM_A, NU_PARAM_B, NU_PARAM_C) e o gabarito, mas NÃO o enunciado —
//       `textos.json` = { "<CO_ITEM>": { "area": "...", "stem": "...", "options": ["A","B","C","D","E"] } }
//       transcrito da prova. O ENEM é 3PL; aqui fica o 2PL (a, b) e o c é descartado.
//
// Formato do banco (.json): { source, license, attribution, locale, items: [
//   { code, area, a, b, stem, options: [CERTA, errada, errada, ...] } ] }
// Ou, quando a ordem já vem pronta (ENEM), { ..., options, correct } por item.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const AREAS = ["economia", "financas", "historia", "geografia", "gerais"];
const SOURCES = ["freelandoo", "enem", "opentdb"];

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function seedOf(code) {
  return crypto.createHash("sha1").update(String(code)).digest().readUInt32LE(0);
}

function mulberry32(a) {
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Embaralha as opções de forma ESTÁVEL pelo código; devolve { options, correct }. */
function placeOptions(item) {
  if (Number.isInteger(item.correct)) return { options: item.options, correct: item.correct };
  const rng = mulberry32(seedOf(item.code));
  const idx = item.options.map((_, i) => i);
  for (let i = idx.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return { options: idx.map((i) => item.options[i]), correct: idx.indexOf(0) };
}

function validate(bank, file) {
  if (!SOURCES.includes(bank.source)) fail(`${file}: source inválido (${bank.source})`);
  if (!bank.license) fail(`${file}: license obrigatória`);
  if (bank.source === "opentdb" && !bank.attribution) fail(`${file}: Open Trivia DB exige atribuição`);
  const seen = new Set();
  for (const it of bank.items || []) {
    const where = `${file} ${it.code}`;
    if (!it.code || seen.has(it.code)) fail(`${where}: código vazio ou repetido`);
    seen.add(it.code);
    if (!AREAS.includes(it.area)) fail(`${where}: área inválida (${it.area})`);
    if (!it.stem || !Array.isArray(it.options) || it.options.length < 2 || it.options.length > 5) {
      fail(`${where}: enunciado ou opções inválidos`);
    }
    if (!(Number(it.a) > 0 && Number(it.a) <= 4)) fail(`${where}: a fora de (0, 4]`);
    if (!(Math.abs(Number(it.b)) <= 4)) fail(`${where}: b fora de [−4, 4]`);
  }
}

const q = (s) => (s == null ? "NULL" : `'${String(s).replace(/'/g, "''")}'`);

function toSql(num, files) {
  const lines = [];
  let total = 0;
  for (const file of files) {
    const bank = JSON.parse(fs.readFileSync(file, "utf8"));
    validate(bank, file);
    for (const it of bank.items) {
      const { options, correct } = placeOptions(it);
      total += 1;
      lines.push(
        `(${q(it.code)}, ${q(it.area)}, ${q(it.locale || bank.locale || "pt-BR")}, ${q(it.stem)}, ` +
          `${q(JSON.stringify(options))}::jsonb, ${correct}, ${Number(it.a)}, ${Number(it.b)}, ` +
          `${q(bank.source)}, ${q(it.source_ref || null)}, ${q(bank.license)}, ${q(it.attribution || bank.attribution || null)})`
      );
    }
  }
  const head = [
    `-- ${num} — A6 Classificação: banco de itens da prova (GERADO por scripts/classificacao-itens.js).`,
    `-- ${total} itens. Não editar à mão: mudar o .json e gerar uma migration NOVA.`,
    `-- Upsert por code: id_item fica estável (as provas antigas guardam o id).`,
    "",
    "INSERT INTO public.tb_quiz_item",
    "  (code, area, locale, stem, options, correct, a, b, source, source_ref, license, attribution)",
    "VALUES",
  ];
  const tail = [
    "ON CONFLICT (code) DO UPDATE SET",
    "  area = EXCLUDED.area, locale = EXCLUDED.locale, stem = EXCLUDED.stem,",
    "  options = EXCLUDED.options, correct = EXCLUDED.correct, a = EXCLUDED.a, b = EXCLUDED.b,",
    "  source = EXCLUDED.source, source_ref = EXCLUDED.source_ref, license = EXCLUDED.license,",
    "  attribution = EXCLUDED.attribution, is_active = TRUE;",
    "",
  ];
  return head.concat(lines.join(",\n")).concat(tail).join("\n");
}

function decodeHtml(s) {
  return String(s)
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&eacute;/g, "é")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function fromOpenTdb(apiFile) {
  const api = JSON.parse(fs.readFileSync(apiFile, "utf8"));
  const B = { easy: -1, medium: 0, hard: 1 };
  const items = (api.results || [])
    .filter((r) => r.type === "multiple")
    .map((r) => {
      const stem = decodeHtml(r.question);
      const cat = String(r.category || "");
      const area = /geograph/i.test(cat) ? "geografia" : /history/i.test(cat) ? "historia" : "gerais";
      return {
        code: `otdb-${crypto.createHash("sha1").update(stem).digest("hex").slice(0, 12)}`,
        area,
        a: 1,
        b: B[r.difficulty] ?? 0,
        stem,
        options: [r.correct_answer, ...r.incorrect_answers].map(decodeHtml),
        locale: "en",
        source_ref: cat,
      };
    });
  return {
    source: "opentdb",
    license: "CC BY-SA 4.0",
    attribution: "Open Trivia Database (opentdb.com), CC BY-SA 4.0",
    locale: "en",
    items,
  };
}

function fromEnem(csvFile, textsFile) {
  const texts = JSON.parse(fs.readFileSync(textsFile, "utf8"));
  const raw = fs.readFileSync(csvFile, "latin1").split(/\r?\n/).filter(Boolean);
  const head = raw[0].split(";").map((h) => h.replace(/"/g, "").trim());
  const col = (name) => head.indexOf(name);
  const need = ["CO_ITEM", "TX_GABARITO", "NU_PARAM_A", "NU_PARAM_B"];
  for (const n of need) if (col(n) < 0) fail(`${csvFile}: falta a coluna ${n}`);
  const seen = new Set();
  const items = [];
  for (const line of raw.slice(1)) {
    const c = line.split(";").map((v) => v.replace(/"/g, "").trim());
    const id = c[col("CO_ITEM")];
    if (seen.has(id) || !texts[id]) continue;
    const a = Number(String(c[col("NU_PARAM_A")]).replace(",", "."));
    const b = Number(String(c[col("NU_PARAM_B")]).replace(",", "."));
    if (!(a > 0) || !Number.isFinite(b)) continue; // item anulado / sem calibração
    seen.add(id);
    const t = texts[id];
    items.push({
      code: `enem-${id}`,
      area: t.area,
      a,
      b,
      stem: t.stem,
      options: t.options,
      correct: "ABCDE".indexOf(c[col("TX_GABARITO")]),
      source_ref: `ENEM CO_ITEM ${id}`,
    });
  }
  return {
    source: "enem",
    license: "Microdados do ENEM — INEP (dado público)",
    attribution: "Item do ENEM — INEP/MEC",
    locale: "pt-BR",
    items,
  };
}

function main() {
const [cmd, ...args] = process.argv.slice(2);
if (cmd === "sql") {
  const [num, ...files] = args;
  if (!/^\d{3}$/.test(num || "") || !files.length) fail("uso: sql <NNN> <banco.json>...");
  const out = path.join(__dirname, "../src/databases/migrations", `${num}_classificacao_itens.sql`);
  fs.writeFileSync(out, toSql(num, files));
  console.log("ok", out);
} else if (cmd === "opentdb") {
  const [inFile, outFile] = args;
  if (!inFile || !outFile) fail("uso: opentdb <api.json> <saida.json>");
  const bank = fromOpenTdb(inFile);
  validate(bank, inFile);
  fs.writeFileSync(outFile, JSON.stringify(bank, null, 2));
  console.log("ok", bank.items.length, "itens →", outFile);
} else if (cmd === "enem") {
  const [csvFile, textsFile, outFile] = args;
  if (!csvFile || !textsFile || !outFile) fail("uso: enem <ITENS_PROVA.csv> <textos.json> <saida.json>");
  const bank = fromEnem(csvFile, textsFile);
  validate(bank, csvFile);
  fs.writeFileSync(outFile, JSON.stringify(bank, null, 2));
  console.log("ok", bank.items.length, "itens →", outFile);
} else {
  fail("uso: sql | opentdb | enem (ver o cabeçalho do arquivo)");
}
}

if (require.main === module) main();

module.exports = { placeOptions, toSql, fromOpenTdb, decodeHtml };
