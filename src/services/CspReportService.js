// src/services/CspReportService.js — Segurança A4 (CSP): guarda os relatórios de violação da CSP
// do front, AGREGADOS, para decidir o enforce com dado de verdade (mig 453).
//
// Aceita os dois formatos que o navegador manda:
//   • report-uri  (application/csp-report): { "csp-report": { "effective-directive", "blocked-uri", "document-uri" } }
//   • Reporting API (application/reports+json): [ { type: "csp-violation", body: { effectiveDirective, blockedURL, documentURL } } ]
// Sem dado pessoal: da URL bloqueada fica só a ORIGEM (ou a palavra-chave: inline, eval, data…), da
// página só o CAMINHO. Teto de MAX_ROWS chaves distintas (quem inventa relatório não enche o banco:
// passado o teto, só soma em chave que já existe).
const pool = require("../databases");

const MAX_ROWS = 5000;
const KEYWORDS = new Set(["inline", "eval", "wasm-eval", "data", "blob", "self", "trusted-types-policy", "trusted-types-sink"]);

function clip(s, n = 200) {
  return String(s || "").slice(0, n);
}

/** Origem da URL bloqueada (ou a palavra-chave do navegador). */
function blockedOf(raw) {
  const s = String(raw || "").trim();
  if (!s) return "(vazio)";
  if (KEYWORDS.has(s)) return s;
  try {
    const u = new URL(s);
    if (u.protocol === "data:" || u.protocol === "blob:") return u.protocol.replace(":", "");
    return clip(u.origin, 120);
  } catch {
    return clip(s.split(/[?#]/)[0], 60);
  }
}

/** Caminho da página (sem query nem fragmento); ids longos viram `:id` para agregar. */
function pageOf(raw) {
  try {
    const u = new URL(String(raw || ""));
    return clip(
      u.pathname
        .split("/")
        .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^\d{4,}$/.test(seg) ? ":id" : seg))
        .join("/"),
      160
    );
  } catch {
    return "(desconhecida)";
  }
}

function normalize(body) {
  const out = [];
  const list = Array.isArray(body) ? body : [body];
  for (const item of list.slice(0, 20)) {
    if (!item || typeof item !== "object") continue;
    const r = item["csp-report"] || (item.type === "csp-violation" ? item.body : null);
    if (!r || typeof r !== "object") continue;
    const directive = clip(r["effective-directive"] || r.effectiveDirective || r["violated-directive"] || r.violatedDirective || "", 60)
      .split(" ")[0];
    if (!directive) continue;
    out.push({
      directive,
      blocked: blockedOf(r["blocked-uri"] ?? r.blockedURL),
      page: pageOf(r["document-uri"] ?? r.documentURL),
    });
  }
  return out;
}

class CspReportService {
  static normalize = normalize;

  static async record(body) {
    const items = normalize(body);
    if (!items.length) return { stored: 0 };
    const full = (await pool.query(`SELECT COUNT(*)::int AS n FROM public.tb_csp_report`)).rows[0].n >= MAX_ROWS;
    let stored = 0;
    for (const it of items) {
      const sql = full
        ? `UPDATE public.tb_csp_report SET hits = hits + 1, last_seen = NOW()
            WHERE directive = $1 AND blocked = $2 AND page = $3`
        : `INSERT INTO public.tb_csp_report (directive, blocked, page) VALUES ($1, $2, $3)
           ON CONFLICT ON CONSTRAINT tb_csp_report_key
           DO UPDATE SET hits = public.tb_csp_report.hits + 1, last_seen = NOW()`;
      const r = await pool.query(sql, [it.directive, it.blocked, it.page]);
      stored += r.rowCount;
    }
    return { stored };
  }

  /** Para o admin: as violações mais frequentes (agrupadas por diretiva + origem, com as páginas). */
  static async listAdmin({ days = 14 } = {}) {
    const d = Math.min(90, Math.max(1, Number(days) || 14));
    const { rows } = await pool.query(
      `SELECT directive, blocked, SUM(hits)::int AS hits, MAX(last_seen) AS last_seen,
              (ARRAY_AGG(page ORDER BY hits DESC))[1:5] AS pages
         FROM public.tb_csp_report
        WHERE last_seen >= NOW() - ($1::int * INTERVAL '1 day')
        GROUP BY directive, blocked
        ORDER BY hits DESC
        LIMIT 300`,
      [d]
    );
    return { days: d, items: rows };
  }
}

module.exports = CspReportService;
