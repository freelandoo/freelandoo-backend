// src/utils/statementParse.js
//
// Extrato importado (OFX ou CSV) → transações normalizadas para a Vida
// Financeira (mig 462, `source = 'ofx'`). É o caminho GRÁTIS da Carteira: todo
// banco exporta OFX, e quem não assina os bancos conectados usa este.
//
// Saída: [{ external_id, date: 'YYYY-MM-DD', amount_cents (com sinal), title }]
//
// ⚠️ `external_id` é o que impede o mesmo extrato importado duas vezes de
// dobrar os gastos (UNIQUE em user_id+source+external_id). No OFX é o FITID do
// banco; sem FITID (e no CSV) é um hash de data+valor+descrição+ocorrência — a
// ocorrência entra porque duas compras iguais no mesmo dia são DUAS compras.
const crypto = require("crypto");

const MAX_ROWS = 5000;

function hashId(parts) {
  return "h_" + crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 24);
}

/** "1.234,56" | "1234.56" | "-12,3" | "R$ 10,00" → centavos (com sinal). */
function parseAmountToCents(raw) {
  let s = String(raw ?? "").trim().replace(/R\$\s?/i, "").replace(/\s/g, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    neg = true;
    s = s.slice(0, -1);
  }
  if (s.startsWith("-")) {
    neg = !neg;
    s = s.slice(1);
  } else if (s.startsWith("+")) {
    s = s.slice(1);
  }
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const cents = Math.round(Number(s) * 100);
  if (!Number.isFinite(cents)) return null;
  return neg ? -cents : cents;
}

/** "20261121..." | "21/11/2026" | "2026-11-21" | "21-11-2026" → "2026-11-21". */
function parseDate(raw) {
  const s = String(raw ?? "").trim();
  let y, m, d;
  let mm = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (mm) [, y, m, d] = mm;
  else if ((mm = s.match(/^(\d{4})-(\d{2})-(\d{2})/))) [, y, m, d] = mm;
  else if ((mm = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/))) {
    [, d, m, y] = mm;
    if (y.length === 2) y = "20" + y;
  } else return null;
  const dt = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (dt.getUTCFullYear() !== Number(y) || dt.getUTCMonth() !== Number(m) - 1 || dt.getUTCDate() !== Number(d)) {
    return null;
  }
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function cleanTitle(s) {
  return String(s ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
}

// ─── OFX (SGML 1.x sem fechamento de tag, e XML 2.x) ───────────────────────
function ofxTag(block, tag) {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function parseOfx(text) {
  const out = [];
  const blocks = String(text).split(/<STMTTRN>/i).slice(1);
  const seen = new Map();
  for (const raw of blocks.slice(0, MAX_ROWS)) {
    const block = raw.split(/<\/STMTTRN>/i)[0];
    const date = parseDate(ofxTag(block, "DTPOSTED"));
    const cents = parseAmountToCents(ofxTag(block, "TRNAMT"));
    if (!date || cents == null || cents === 0) continue;
    const title = cleanTitle(ofxTag(block, "MEMO") || ofxTag(block, "NAME") || ofxTag(block, "TRNTYPE") || "Lançamento");
    const fitid = ofxTag(block, "FITID");
    let external_id;
    if (fitid) {
      external_id = "f_" + fitid.slice(0, 80);
    } else {
      const key = `${date}|${cents}|${title}`;
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      external_id = hashId([key, String(n)]);
    }
    out.push({ external_id, date, amount_cents: cents, title: title || "Lançamento" });
  }
  return out;
}

// ─── CSV (cabeçalho com data, descrição e valor; ; ou , ou tab) ─────────────
function splitCsvLine(line, sep) {
  const cells = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) {
      cells.push(cur);
      cur = "";
    } else cur += ch;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const norm = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

function findCol(header, names) {
  const h = header.map(norm);
  for (const n of names) {
    const i = h.findIndex((c) => c === n || c.startsWith(n));
    if (i >= 0) return i;
  }
  return -1;
}

function parseCsv(text) {
  const lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const first = lines[0];
  const sep = [";", "\t", ","].map((s) => [s, first.split(s).length]).sort((a, b) => b[1] - a[1])[0][0];
  const header = splitCsvLine(first, sep);
  const iDate = findCol(header, ["data", "date", "dt"]);
  const iDesc = findCol(header, ["descricao", "historico", "lancamento", "description", "memo", "titulo", "estabelecimento"]);
  const iAmount = findCol(header, ["valor", "amount", "value", "quantia"]);
  const iIn = findCol(header, ["entrada", "credito"]);
  const iOut = findCol(header, ["saida", "debito"]);
  if (iDate < 0 || (iAmount < 0 && iIn < 0 && iOut < 0)) return [];

  const out = [];
  const seen = new Map();
  for (const line of lines.slice(1, MAX_ROWS + 1)) {
    const c = splitCsvLine(line, sep);
    const date = parseDate(c[iDate]);
    let cents = null;
    if (iAmount >= 0) cents = parseAmountToCents(c[iAmount]);
    if (cents == null && (iIn >= 0 || iOut >= 0)) {
      const vin = iIn >= 0 ? parseAmountToCents(c[iIn]) : null;
      const vout = iOut >= 0 ? parseAmountToCents(c[iOut]) : null;
      if (vin) cents = Math.abs(vin);
      else if (vout) cents = -Math.abs(vout);
    }
    if (!date || cents == null || cents === 0) continue;
    const title = cleanTitle(iDesc >= 0 ? c[iDesc] : "") || "Lançamento";
    const key = `${date}|${cents}|${title}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    out.push({ external_id: hashId([key, String(n)]), date, amount_cents: cents, title });
  }
  return out;
}

/** Detecta o formato pelo conteúdo, não pela extensão (o nome do arquivo mente). */
function parseStatement(text) {
  const s = String(text || "");
  if (/<OFX>|OFXHEADER|<STMTTRN>/i.test(s)) return { format: "ofx", rows: parseOfx(s) };
  return { format: "csv", rows: parseCsv(s) };
}

module.exports = { parseStatement, parseOfx, parseCsv, parseAmountToCents, parseDate };
