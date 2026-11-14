// src/utils/adminAudit.js — trilha das ações de administração (Segurança A1 lote 7, 2026-11-14).
//
// Antes, só os enxames gravavam em `tb_admin_audit_log` (mig 004): promover/rebaixar
// administrador, ligar flag, trocar chave de IA, tarifas, moderação, apagar conteúdo…
// não deixavam rastro de QUEM fez. Agora a própria trava de papel
// (`roleMiddleware("Administrator")`) arma esta trilha: toda requisição que MUDA algo
// (não GET/HEAD/OPTIONS) e passou pela trava vira uma linha quando a resposta termina:
//
//   entity = 'admin_http' · action = método · entity_id = caminho (sem query)
//   after_state = { status, params, body (valores secretos trocados por "[oculto]",
//                   texto cortado), query } · actor_user_id = quem fez
//
// Nunca derruba a requisição: a gravação é depois da resposta e o erro só vai ao log.
// O corpo passa por `redact`: chave com cara de segredo (senha, token, api_key, cpf,
// pix…) nunca é gravada, e o total é limitado (a trilha não vira cópia de upload).
const pool = require("../databases");
const { createLogger } = require("./logger");

const log = createLogger("adminAudit");

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SECRET_KEY = /(senha|password|passwd|secret|token|api_?key|apikey|sealed|private|credential|authorization|cookie|cpf|cnpj|pix|holder_doc|card|cvv|signature)/i;
const MAX_STRING = 200;
const MAX_KEYS = 40;
const MAX_ARRAY = 20;
const MAX_DEPTH = 4;
const MAX_JSON = 8000;

function redact(value, depth = 0) {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Buffer.isBuffer(value)) return `[${value.length} bytes]`;
  if (depth >= MAX_DEPTH) return "[…]";
  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY).map((v) => redact(v, depth + 1));
    if (value.length > MAX_ARRAY) out.push(`[+${value.length - MAX_ARRAY}]`);
    return out;
  }
  if (typeof value === "object") {
    const out = {};
    const keys = Object.keys(value);
    for (const k of keys.slice(0, MAX_KEYS)) {
      out[k] = SECRET_KEY.test(k) ? "[oculto]" : redact(value[k], depth + 1);
    }
    if (keys.length > MAX_KEYS) out["…"] = `+${keys.length - MAX_KEYS} campos`;
    return out;
  }
  return String(value).slice(0, MAX_STRING);
}

function stateOf(req, res) {
  const state = {
    status: res.statusCode,
    params: redact(req.params || {}),
    query: redact(req.query || {}),
    body: redact(req.body && typeof req.body === "object" ? req.body : {}),
  };
  if (req.file) state.file = { field: req.file.fieldname, size: req.file.size, type: req.file.mimetype };
  if (Array.isArray(req.files)) state.files = req.files.length;
  let json = JSON.stringify(state);
  if (json.length > MAX_JSON) {
    state.body = "[corpo grande demais para a trilha]";
    json = JSON.stringify(state);
  }
  return json;
}

/** Grava a linha (exportado para o teste e para quem quiser registrar à mão). */
async function record(req, res) {
  const pathOnly = String(req.originalUrl || req.url || "").split("?")[0].slice(0, 500);
  await pool.query(
    `INSERT INTO public.tb_admin_audit_log (entity, entity_id, action, after_state, actor_user_id)
     VALUES ('admin_http', $1, $2, $3::jsonb, $4)`,
    [pathOnly, req.method, stateOf(req, res), req.user?.id_user || null]
  );
}

/**
 * Chamado pela trava de papel depois que ela deixa passar. Arma uma vez por
 * requisição (a trava pode aparecer no `router.use` e na rota).
 */
function arm(req, res) {
  if (!MUTATING.has(req.method) || req.__adminAuditArmed) return;
  req.__adminAuditArmed = true;
  res.once("finish", () => {
    record(req, res).catch((err) => log.error("record.fail", { message: err?.message, path: req.originalUrl }));
  });
}

module.exports = { arm, record, redact };
