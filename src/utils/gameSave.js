// src/utils/gameSave.js — regras puras dos saves do EVO Brazil (mig 279).

const SLOTS = 5;
// Um save de meses de jogo dá ~200 KB; o teto folgado barra lixo sem barrar jogo.
const MAX_BYTES = 1024 * 1024;
const SUMMARY_KEYS = ["nome", "ficha", "ano", "mes", "semana", "creditos", "ranking", "idade"];

function parseSlot(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= SLOTS ? n : null;
}

// O resumo vem do jogo, mas só os campos conhecidos e só valores simples: ele
// é mostrado na tela de slots e não pode virar depósito de outra coisa.
function cleanSummary(s) {
  const out = {};
  if (!s || typeof s !== "object" || Array.isArray(s)) return out;
  for (const k of SUMMARY_KEYS) {
    const v = s[k];
    if (typeof v === "string") out[k] = v.slice(0, 80);
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

function validateSave(body) {
  const data = body && body.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "Save inválido." };
  }
  const bytes = Buffer.byteLength(JSON.stringify(data), "utf8");
  if (bytes > MAX_BYTES) return { error: "Save grande demais." };
  const v = Number(data.versao);
  return {
    data,
    summary: cleanSummary(body.summary),
    game_version: Number.isInteger(v) && v >= 0 ? v : 0,
  };
}

module.exports = { SLOTS, MAX_BYTES, parseSlot, cleanSummary, validateSave };
