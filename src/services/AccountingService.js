// src/services/AccountingService.js
// Painel de Contabilidade dos admins (mig 277): empresas, livro caixa, guias e
// obrigações, calendário, estimativa de DAS e de acréscimos de guia vencida.
//
// Ele NÃO transmite nada a órgão nenhum. Organiza, calcula e lembra; quem
// declara e paga é o admin, nos portais oficiais.

const pool = require("../databases");
const AccountingStorage = require("../storages/AccountingStorage");
const receipts = require("../integrations/r2/accountingReceiptStorage");
const {
  SIMPLES_ANEXOS,
  estimateDas,
  computeLateCharges,
} = require("../utils/accountingTax");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AccountingService");

const REGIMES = new Set(["mei", "simples", "presumido", "real"]);
const ENTRY_TYPES = new Set(["revenue", "other_in", "expense", "prolabore", "payroll", "tax", "other_out"]);
const IN_TYPES = new Set(["revenue", "other_in"]);
const KINDS = new Set(["payment", "declaration"]);
const SPHERES = new Set(["federal", "estadual", "municipal"]);
const STATUSES = new Set(["pending", "paid", "filed", "canceled"]);
const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

// ─── helpers ─────────────────────────────────────────────────────────────────
/** "Hoje" no fuso de São Paulo — vencimento é data civil, não instante. */
function todaySP() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function addMonths(iso, n) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function lastDayOfMonth(iso) {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

function validDate(v) {
  if (typeof v !== "string" || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

function str(v, max) {
  if (v == null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Aceita centavos inteiros (`amount_cents`) ou reais (`amount`, "1.234,56"). */
function parseCents(body, centsKey, reaisKey) {
  if (body[centsKey] != null && body[centsKey] !== "") {
    const n = Number(body[centsKey]);
    return Number.isInteger(n) ? n : NaN;
  }
  if (body[reaisKey] != null && body[reaisKey] !== "") {
    let s = String(body[reaisKey]).trim().replace(/[R$\s]/g, "");
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    const n = Number(s);
    return Number.isFinite(n) ? Math.round(n * 100) : NaN;
  }
  return null;
}

function bad(error) {
  return { error, statusCode: 400 };
}

async function selicMap() {
  const rows = await AccountingStorage.listSelic(pool);
  const map = {};
  for (const r of rows) map[r.month] = Number(r.rate);
  return map;
}

/** Acrescenta à guia pendente e vencida a estimativa de multa + juros para hoje. */
function withCharges(ob, today, selic) {
  const overdue = ob.status === "pending" && ob.due_date < today;
  const out = { ...ob, overdue };
  if (overdue && ob.kind === "payment" && ob.amount_cents != null) {
    out.late_charges = computeLateCharges({
      amountCents: ob.amount_cents,
      dueDate: ob.due_date,
      payDate: today,
      selicByMonth: selic,
    });
  }
  return out;
}

class AccountingService {
  // ─── Empresas ──────────────────────────────────────────────────────────────
  static _companyInput(body) {
    const name = str(body.name, 160);
    if (!name) return bad("Nome da empresa é obrigatório");
    const cnpj = body.cnpj ? String(body.cnpj).replace(/\D/g, "") : null;
    if (cnpj && cnpj.length !== 14) return bad("CNPJ inválido (precisa de 14 dígitos)");
    const regime = body.regime || "simples";
    if (!REGIMES.has(regime)) return bad("Regime inválido");
    // O anexo só faz sentido no Simples; nos outros regimes ele é descartado
    // em vez de recusado, para trocar de regime não exigir limpar o campo antes.
    let simples_anexo = regime === "simples" ? body.simples_anexo || null : null;
    if (simples_anexo && !SIMPLES_ANEXOS.includes(simples_anexo)) return bad("Anexo do Simples inválido");
    const uf = body.uf ? String(body.uf).toUpperCase() : null;
    if (uf && !UFS.has(uf)) return bad("UF inválida");
    return {
      data: {
        name,
        cnpj,
        regime,
        simples_anexo,
        municipio: str(body.municipio, 120),
        uf,
        notes: str(body.notes, 4000),
      },
    };
  }

  static listCompanies() {
    return runWithLogs(log, "listCompanies", () => ({}), async () => ({
      companies: await AccountingStorage.listCompanies(pool),
    }));
  }

  static createCompany(user, body = {}) {
    return runWithLogs(log, "createCompany", () => ({ by: user?.id_user }), async () => {
      const v = this._companyInput(body);
      if (v.error) return v;
      const company = await AccountingStorage.createCompany(pool, { ...v.data, created_by: user?.id_user || null });
      return { company };
    });
  }

  static updateCompany(id_company, body = {}) {
    return runWithLogs(log, "updateCompany", () => ({ id_company }), async () => {
      if (!UUID_RE.test(String(id_company))) return { error: "Empresa não encontrada", statusCode: 404 };
      const v = this._companyInput(body);
      if (v.error) return v;
      const company = await AccountingStorage.updateCompany(pool, id_company, v.data);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };
      return { company };
    });
  }

  static deleteCompany(id_company) {
    return runWithLogs(log, "deleteCompany", () => ({ id_company }), async () => {
      if (!UUID_RE.test(String(id_company))) return { error: "Empresa não encontrada", statusCode: 404 };
      const ok = await AccountingStorage.softDeleteCompany(pool, id_company);
      if (!ok) return { error: "Empresa não encontrada", statusCode: 404 };
      return { ok: true };
    });
  }

  static async _company(id_company) {
    if (!UUID_RE.test(String(id_company))) return null;
    return AccountingStorage.getCompany(pool, id_company);
  }

  // ─── Painel da empresa ─────────────────────────────────────────────────────
  static dashboard(id_company) {
    return runWithLogs(log, "dashboard", () => ({ id_company }), async () => {
      const company = await this._company(id_company);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };

      const today = todaySP();
      const monthStart = `${today.slice(0, 7)}-01`;
      const selic = await selicMap();

      const [obligations, monthTotals, series] = await Promise.all([
        AccountingStorage.listObligations(pool, id_company, { status: "pending" }),
        AccountingStorage.sumByType(pool, id_company, monthStart, today),
        AccountingStorage.monthlySeries(pool, id_company, addMonths(monthStart, -11)),
      ]);

      const pending = obligations.map((o) => withCharges(o, today, selic));
      const overdue = pending.filter((o) => o.overdue);
      const in30 = addDays(today, 30);
      const upcoming = pending.filter((o) => !o.overdue && o.due_date <= in30);

      const overdueTotal = overdue.reduce(
        (acc, o) => {
          acc.principal += o.amount_cents || 0;
          acc.with_charges += o.late_charges ? o.late_charges.total_cents : o.amount_cents || 0;
          if (o.late_charges?.estimated) acc.estimated = true;
          return acc;
        },
        { principal: 0, with_charges: 0, estimated: false },
      );

      const totals = splitTotals(monthTotals);
      return {
        company,
        today,
        overdue,
        upcoming,
        overdue_total: overdueTotal,
        month: { start: monthStart, ...totals },
        series: foldSeries(series),
        das: company.regime === "simples" && company.simples_anexo
          ? await this._dasForCompetence(company, addMonths(monthStart, -1))
          : null,
      };
    });
  }

  // ─── DAS ───────────────────────────────────────────────────────────────────
  /**
   * DAS de uma competência a partir do livro caixa: faturamento do mês, RBT12
   * = os 12 meses ANTERIORES à competência, folha (pró-labore + salários) dos
   * mesmos 12 meses para o Fator R.
   */
  static async _dasForCompetence(company, competenceFirstDay, override = {}) {
    const rbtFrom = addMonths(competenceFirstDay, -12);
    const rbtTo = lastDayOfMonth(addMonths(competenceFirstDay, -1));
    const [month, prev12] = await Promise.all([
      AccountingStorage.sumByType(pool, company.id_company, competenceFirstDay, lastDayOfMonth(competenceFirstDay)),
      AccountingStorage.sumByType(pool, company.id_company, rbtFrom, rbtTo),
    ]);
    const revenue = override.revenue_cents ?? (month.revenue || 0);
    const rbt12 = override.rbt12_cents ?? (prev12.revenue || 0);
    const payroll = override.payroll12_cents ?? ((prev12.prolabore || 0) + (prev12.payroll || 0));
    const est = estimateDas({
      anexo: override.anexo || company.simples_anexo,
      revenueMonthCents: revenue,
      rbt12Cents: rbt12,
      payroll12Cents: payroll,
    });
    if (est.error) return est;
    return {
      competence: competenceFirstDay.slice(0, 7),
      due_date: `${addMonths(competenceFirstDay, 1).slice(0, 7)}-20`,
      payroll12_cents: payroll,
      ...est,
    };
  }

  static estimateDas(id_company, query = {}) {
    return runWithLogs(log, "estimateDas", () => ({ id_company }), async () => {
      const company = await this._company(id_company);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };
      const competence = query.competence;
      if (!competence || !MONTH_RE.test(competence)) return bad("Competência inválida (use AAAA-MM)");
      const anexo = query.anexo || company.simples_anexo;
      if (!anexo) return bad("Defina o anexo do Simples da empresa (ou escolha um aqui)");
      const override = { anexo };
      for (const k of ["revenue_cents", "rbt12_cents", "payroll12_cents"]) {
        if (query[k] != null && query[k] !== "") {
          const n = Number(query[k]);
          if (!Number.isInteger(n) || n < 0) return bad(`${k} inválido`);
          override[k] = n;
        }
      }
      const das = await this._dasForCompetence(company, `${competence}-01`, override);
      if (das.error) return bad(das.error);
      return { das };
    });
  }

  // ─── Livro caixa ───────────────────────────────────────────────────────────
  static _entryInput(body) {
    if (!validDate(body.entry_date)) return bad("Data do lançamento inválida");
    if (!ENTRY_TYPES.has(body.entry_type)) return bad("Tipo de lançamento inválido");
    const amount = parseCents(body, "amount_cents", "amount");
    if (amount == null || Number.isNaN(amount) || amount <= 0) return bad("Valor inválido (precisa ser maior que zero)");
    const description = str(body.description, 240);
    if (!description) return bad("Descrição é obrigatória");
    return {
      data: {
        entry_date: body.entry_date,
        entry_type: body.entry_type,
        amount_cents: amount,
        description,
        counterparty: str(body.counterparty, 160),
        document_ref: str(body.document_ref, 80),
      },
    };
  }

  static listEntries(id_company, query = {}) {
    return runWithLogs(log, "listEntries", () => ({ id_company }), async () => {
      const company = await this._company(id_company);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };
      const from = validDate(query.from) ? query.from : null;
      const to = validDate(query.to) ? query.to : null;
      const entries = await AccountingStorage.listEntries(pool, id_company, { from, to });
      let totalIn = 0;
      let totalOut = 0;
      for (const e of entries) {
        if (IN_TYPES.has(e.entry_type)) totalIn += e.amount_cents;
        else totalOut += e.amount_cents;
      }
      return { entries, totals: { in: totalIn, out: totalOut, balance: totalIn - totalOut } };
    });
  }

  static createEntry(user, id_company, body = {}) {
    return runWithLogs(log, "createEntry", () => ({ id_company }), async () => {
      const company = await this._company(id_company);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };
      const v = this._entryInput(body);
      if (v.error) return v;
      const entry = await AccountingStorage.createEntry(pool, {
        ...v.data,
        id_company,
        id_obligation: null,
        created_by: user?.id_user || null,
      });
      return { entry };
    });
  }

  static updateEntry(id_company, id_entry, body = {}) {
    return runWithLogs(log, "updateEntry", () => ({ id_company, id_entry }), async () => {
      if (!UUID_RE.test(String(id_company)) || !UUID_RE.test(String(id_entry))) {
        return { error: "Lançamento não encontrado", statusCode: 404 };
      }
      const v = this._entryInput(body);
      if (v.error) return v;
      const entry = await AccountingStorage.updateEntry(pool, id_company, id_entry, v.data);
      if (!entry) return { error: "Lançamento não encontrado", statusCode: 404 };
      return { entry };
    });
  }

  static deleteEntry(id_company, id_entry) {
    return runWithLogs(log, "deleteEntry", () => ({ id_company, id_entry }), async () => {
      if (!UUID_RE.test(String(id_company)) || !UUID_RE.test(String(id_entry))) {
        return { error: "Lançamento não encontrado", statusCode: 404 };
      }
      const ok = await AccountingStorage.deleteEntry(pool, id_company, id_entry);
      if (!ok) return { error: "Lançamento não encontrado", statusCode: 404 };
      return { ok: true };
    });
  }

  // ─── Guias e obrigações ────────────────────────────────────────────────────
  static _obligationInput(body) {
    const kind = body.kind || "payment";
    if (!KINDS.has(kind)) return bad("Tipo de obrigação inválido");
    const name = str(body.name, 120);
    if (!name) return bad("Nome da guia/obrigação é obrigatório");
    const sphere = body.sphere || "federal";
    if (!SPHERES.has(sphere)) return bad("Esfera inválida");
    if (!validDate(body.due_date)) return bad("Vencimento inválido");
    let competence = null;
    if (body.competence) {
      const c = MONTH_RE.test(body.competence) ? `${body.competence}-01` : body.competence;
      if (!validDate(c)) return bad("Competência inválida (use AAAA-MM)");
      competence = `${c.slice(0, 7)}-01`;
    }
    let amount = parseCents(body, "amount_cents", "amount");
    if (Number.isNaN(amount) || (amount != null && amount < 0)) return bad("Valor inválido");
    // Declaração não tem valor: guardar um aqui faria ela entrar na soma do que
    // está em atraso.
    if (kind === "declaration") amount = null;
    return {
      data: { kind, name, sphere, competence, due_date: body.due_date, amount_cents: amount, notes: str(body.notes, 4000) },
    };
  }

  static listObligations(id_company, query = {}) {
    return runWithLogs(log, "listObligations", () => ({ id_company }), async () => {
      const company = await this._company(id_company);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };
      const status = STATUSES.has(query.status) ? query.status : null;
      const from = validDate(query.from) ? query.from : null;
      const to = validDate(query.to) ? query.to : null;
      const today = todaySP();
      const selic = await selicMap();
      const rows = await AccountingStorage.listObligations(pool, id_company, { status, from, to });
      return { obligations: rows.map((o) => withCharges(o, today, selic)), today };
    });
  }

  static createObligation(user, id_company, body = {}) {
    return runWithLogs(log, "createObligation", () => ({ id_company }), async () => {
      const company = await this._company(id_company);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };
      const v = this._obligationInput(body);
      if (v.error) return v;
      const obligation = await AccountingStorage.createObligation(pool, {
        ...v.data,
        id_company,
        source: "manual",
        created_by: user?.id_user || null,
      });
      return { obligation };
    });
  }

  static updateObligation(id_company, id_obligation, body = {}) {
    return runWithLogs(log, "updateObligation", () => ({ id_company, id_obligation }), async () => {
      if (!UUID_RE.test(String(id_company)) || !UUID_RE.test(String(id_obligation))) {
        return { error: "Obrigação não encontrada", statusCode: 404 };
      }
      const v = this._obligationInput(body);
      if (v.error) return v;
      const obligation = await AccountingStorage.updateObligation(pool, id_company, id_obligation, v.data);
      if (!obligation) return { error: "Obrigação não encontrada", statusCode: 404 };
      return { obligation };
    });
  }

  /**
   * Muda o status. Marcar uma GUIA como paga pode lançar a saída no livro
   * caixa na mesma transação (`register_entry`, padrão true) — sem isso o caixa
   * e as guias contariam histórias diferentes sobre o mesmo dinheiro.
   */
  static setStatus(user, id_company, id_obligation, body = {}) {
    return runWithLogs(log, "setStatus", () => ({ id_company, id_obligation, status: body.status }), async () => {
      if (!UUID_RE.test(String(id_company)) || !UUID_RE.test(String(id_obligation))) {
        return { error: "Obrigação não encontrada", statusCode: 404 };
      }
      const status = body.status;
      if (!STATUSES.has(status)) return bad("Status inválido");

      const current = await AccountingStorage.getObligation(pool, id_company, id_obligation);
      if (!current) return { error: "Obrigação não encontrada", statusCode: 404 };
      if (status === "paid" && current.kind !== "payment") return bad("Declaração é marcada como entregue, não paga");
      if (status === "filed" && current.kind !== "declaration") return bad("Guia é marcada como paga, não entregue");

      let paid_at = null;
      let paid_amount_cents = null;
      if (status === "paid" || status === "filed") {
        paid_at = body.paid_at || todaySP();
        if (!validDate(paid_at)) return bad("Data de pagamento inválida");
      }
      if (status === "paid") {
        const amt = parseCents(body, "paid_amount_cents", "paid_amount");
        if (Number.isNaN(amt) || (amt != null && amt <= 0)) return bad("Valor pago inválido");
        paid_amount_cents = amt ?? current.amount_cents;
        if (paid_amount_cents == null) return bad("Informe o valor pago");
      }

      const registerEntry = status === "paid" && current.status !== "paid" && body.register_entry !== false;
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        const obligation = await AccountingStorage.setObligationStatus(conn, id_company, id_obligation, {
          status,
          paid_at,
          paid_amount_cents,
        });
        let entry = null;
        if (registerEntry) {
          entry = await AccountingStorage.createEntry(conn, {
            id_company,
            entry_date: paid_at,
            entry_type: "tax",
            amount_cents: paid_amount_cents,
            description: `Pagamento: ${current.name}${current.competence ? ` (${current.competence.slice(0, 7)})` : ""}`,
            counterparty: current.sphere === "municipal" ? "Prefeitura" : current.sphere === "estadual" ? "Estado" : "Receita Federal",
            document_ref: null,
            id_obligation,
            created_by: user?.id_user || null,
          });
        }
        await conn.query("COMMIT");
        return { obligation, entry };
      } catch (err) {
        await conn.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        conn.release();
      }
    });
  }

  static deleteObligation(id_company, id_obligation) {
    return runWithLogs(log, "deleteObligation", () => ({ id_company, id_obligation }), async () => {
      if (!UUID_RE.test(String(id_company)) || !UUID_RE.test(String(id_obligation))) {
        return { error: "Obrigação não encontrada", statusCode: 404 };
      }
      const row = await AccountingStorage.deleteObligation(pool, id_company, id_obligation);
      if (!row) return { error: "Obrigação não encontrada", statusCode: 404 };
      if (row.receipt_key) await receipts.deleteObject(row.receipt_key);
      return { ok: true };
    });
  }

  static uploadReceipt(id_company, id_obligation, file) {
    return runWithLogs(log, "uploadReceipt", () => ({ id_company, id_obligation }), async () => {
      if (!UUID_RE.test(String(id_company)) || !UUID_RE.test(String(id_obligation))) {
        return { error: "Obrigação não encontrada", statusCode: 404 };
      }
      if (!file?.buffer) return bad("Arquivo não enviado");
      const ext = receipts.extForMime(file.mimetype);
      if (!ext) return bad("Formato não aceito. Envie PDF, JPG, PNG ou WebP.");
      // Confere a guia ANTES de mandar bytes ao R2 — subir primeiro e perguntar
      // depois deixaria objeto órfão pago no bucket a cada id errado.
      const current = await AccountingStorage.getObligation(pool, id_company, id_obligation);
      if (!current) return { error: "Obrigação não encontrada", statusCode: 404 };

      const key = receipts.buildKey(id_company, ext);
      await receipts.putObject(key, file.buffer, file.mimetype);
      const obligation = await AccountingStorage.setReceipt(pool, id_company, id_obligation, {
        receipt_key: key,
        receipt_mime: file.mimetype,
      });
      if (current.receipt_key) await receipts.deleteObject(current.receipt_key);
      return { obligation };
    });
  }

  static receiptUrl(id_company, id_obligation) {
    return runWithLogs(log, "receiptUrl", () => ({ id_company, id_obligation }), async () => {
      if (!UUID_RE.test(String(id_company)) || !UUID_RE.test(String(id_obligation))) {
        return { error: "Obrigação não encontrada", statusCode: 404 };
      }
      const ob = await AccountingStorage.getObligation(pool, id_company, id_obligation);
      if (!ob) return { error: "Obrigação não encontrada", statusCode: 404 };
      if (!ob.receipt_key) return { error: "Esta guia não tem comprovante", statusCode: 404 };
      return { url: await receipts.presignView(ob.receipt_key), expires_in: 300 };
    });
  }

  // ─── Calendário ────────────────────────────────────────────────────────────
  /**
   * Gera as obrigações RECORRENTES de um ano pelo regime da empresa.
   * Idempotente (índice parcial de `generated`): rodar de novo só preenche o
   * que falta. Taxas municipais (TFE, IPTU) não entram — o vencimento delas
   * muda por cidade e por ano, e uma data inventada é pior que nenhuma.
   */
  static generateCalendar(user, id_company, body = {}) {
    return runWithLogs(log, "generateCalendar", () => ({ id_company, year: body.year }), async () => {
      const company = await this._company(id_company);
      if (!company) return { error: "Empresa não encontrada", statusCode: 404 };
      const year = Number(body.year);
      if (!Number.isInteger(year) || year < 2020 || year > 2100) return bad("Ano inválido");

      const items = calendarFor(company.regime, year, { dctfweb: body.dctfweb === true });
      let created = 0;
      for (const it of items) {
        const ok = await AccountingStorage.createGeneratedObligation(pool, {
          ...it,
          id_company,
          created_by: user?.id_user || null,
        });
        if (ok) created += 1;
      }
      return { created, skipped: items.length - created, total: items.length };
    });
  }

  // ─── Selic ─────────────────────────────────────────────────────────────────
  static listSelic() {
    return runWithLogs(log, "listSelic", () => ({}), async () => ({ selic: await AccountingStorage.listSelic(pool) }));
  }

  /** `rate_percent` vem em PORCENTAGEM (1,15 = 1,15% no mês), que é como o BCB publica. */
  static upsertSelic(body = {}) {
    return runWithLogs(log, "upsertSelic", () => ({ month: body.month }), async () => {
      if (!body.month || !MONTH_RE.test(body.month)) return bad("Mês inválido (use AAAA-MM)");
      const pct = Number(String(body.rate_percent ?? "").replace(",", "."));
      if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return bad("Taxa inválida");
      const row = await AccountingStorage.upsertSelic(pool, `${body.month}-01`, pct / 100);
      return { selic: row };
    });
  }

  static deleteSelic(month) {
    return runWithLogs(log, "deleteSelic", () => ({ month }), async () => {
      if (!month || !MONTH_RE.test(month)) return bad("Mês inválido (use AAAA-MM)");
      const ok = await AccountingStorage.deleteSelic(pool, `${month}-01`);
      if (!ok) return { error: "Mês não encontrado", statusCode: 404 };
      return { ok: true };
    });
  }
}

// ─── funções de apoio (fora da classe: puras) ────────────────────────────────
function addDays(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function splitTotals(byType) {
  let inT = 0;
  let outT = 0;
  for (const [type, total] of Object.entries(byType)) {
    if (IN_TYPES.has(type)) inT += total;
    else outT += total;
  }
  return { in: inT, out: outT, balance: inT - outT, revenue: byType.revenue || 0, by_type: byType };
}

function foldSeries(rows) {
  const map = new Map();
  for (const r of rows) {
    const m = map.get(r.month) || { month: r.month, in: 0, out: 0, revenue: 0 };
    if (IN_TYPES.has(r.entry_type)) m.in += r.total;
    else m.out += r.total;
    if (r.entry_type === "revenue") m.revenue += r.total;
    map.set(r.month, m);
  }
  return [...map.values()];
}

/**
 * Datas-base das obrigações recorrentes. Não ajusta feriado/fim de semana:
 * a regra de prorrogação varia por tributo, e a tela avisa para conferir no
 * portal. É calendário de LEMBRETE, não de prazo legal.
 */
function calendarFor(regime, year, { dctfweb = false } = {}) {
  const items = [];
  const pad = (n) => String(n).padStart(2, "0");
  for (let m = 1; m <= 12; m += 1) {
    const competence = `${year}-${pad(m)}-01`;
    const next = m === 12 ? `${year + 1}-01` : `${year}-${pad(m + 1)}`;
    if (regime === "mei") {
      items.push({ kind: "payment", name: "DAS-MEI", sphere: "federal", competence, due_date: `${next}-20`, amount_cents: null, notes: "Valor fixo mensal do MEI." });
    } else if (regime === "simples") {
      items.push({
        kind: "payment", name: "DAS (PGDAS-D)", sphere: "federal", competence, due_date: `${next}-20`, amount_cents: null,
        notes: "Declare o PGDAS-D mesmo sem faturamento (valor zero) e pague o DAS se houver.",
      });
    }
    if (dctfweb && regime !== "mei") {
      items.push({
        kind: "declaration", name: "DCTFWeb", sphere: "federal", competence, due_date: `${next}-15`, amount_cents: null,
        notes: "Com pró-labore ou funcionário, a DCTFWeb gera o DARF (vencimento dia 20). Sem movimento, entregar 'sem movimento'.",
      });
    }
  }
  if (regime === "simples") {
    items.push({ kind: "declaration", name: "DEFIS", sphere: "federal", competence: `${year}-01-01`, due_date: `${year + 1}-03-31`, amount_cents: null, notes: `Declaração anual do Simples referente a ${year}.` });
  }
  if (regime === "mei") {
    items.push({ kind: "declaration", name: "DASN-SIMEI", sphere: "federal", competence: `${year}-01-01`, due_date: `${year + 1}-05-31`, amount_cents: null, notes: `Declaração anual do MEI referente a ${year}.` });
  }
  return items;
}

AccountingService._calendarFor = calendarFor;
module.exports = AccountingService;
