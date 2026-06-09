// src/services/WalletFinanceService.js
//
// Vida Financeira: orçamento manual mensal do user. Entradas/saídas, fixas
// (recorrentes, entram todo mês automático) e do dia (variáveis). Fechamento
// do mês = entradas - saídas.

const pool = require("../databases");
const WalletFinanceStorage = require("../storages/WalletFinanceStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("WalletFinanceService");

const DIRECTIONS = ["in", "out"];
const RECURRENCES = ["recurring", "oneoff"];

function pad2(n) {
  return String(n).padStart(2, "0");
}
function currentYm() {
  const d = new Date();
  return d.getUTCFullYear() * 100 + (d.getUTCMonth() + 1);
}
function ymValid(ym) {
  if (!Number.isInteger(ym)) return false;
  const m = ym % 100;
  return ym >= 200001 && ym <= 209912 && m >= 1 && m <= 12;
}
function ymParts(ym) {
  const year = Math.floor(ym / 100);
  const month = ym % 100;
  const from = `${year}-${pad2(month)}-01`;
  const to = month === 12 ? `${year + 1}-01-01` : `${year}-${pad2(month + 1)}-01`;
  return { year, month, from, to };
}
function cleanStr(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, max);
}
function toCents(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

class WalletFinanceService {
  static async getMonth(user, query = {}) {
    return runWithLogs(
      log,
      "getMonth",
      () => ({ user_id: user?.id_user, ym: query.ym }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        let ym = parseInt(query.ym, 10);
        if (!ymValid(ym)) ym = currentYm();
        const { from, to } = ymParts(ym);

        const rows = await WalletFinanceStorage.monthEntries(pool, user.id_user, { ym, from, to });

        const totals = { in_cents: 0, out_cents: 0, net_cents: 0 };
        const entries = { recurring_in: [], oneoff_in: [], recurring_out: [], oneoff_out: [] };
        for (const r of rows) {
          const cents = Number(r.amount_cents) || 0;
          if (r.direction === "in") totals.in_cents += cents;
          else totals.out_cents += cents;
          const bucket = `${r.recurrence}_${r.direction}`;
          if (entries[bucket]) entries[bucket].push(r);
        }
        totals.net_cents = totals.in_cents - totals.out_cents;

        return { ym, totals, entries };
      }
    );
  }

  static async createEntry(user, body = {}) {
    return runWithLogs(
      log,
      "createEntry",
      () => ({ user_id: user?.id_user, direction: body.direction, recurrence: body.recurrence }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const direction = DIRECTIONS.includes(body.direction) ? body.direction : null;
        const recurrence = RECURRENCES.includes(body.recurrence) ? body.recurrence : null;
        const title = cleanStr(body.title, 120);
        const category = cleanStr(body.category, 60);
        const amount_cents = toCents(body.amount_cents);

        if (!direction || !recurrence) return { error: "Tipo inválido", status: 400 };
        if (!title) return { error: "Informe um título", status: 400 };
        if (amount_cents == null) return { error: "Valor inválido", status: 400 };

        const entry = { direction, recurrence, title, category, amount_cents };

        if (recurrence === "recurring") {
          let ym = parseInt(body.ym, 10);
          if (!ymValid(ym)) ym = currentYm();
          let dueDay = parseInt(body.due_day, 10);
          if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) dueDay = 1;
          entry.start_ym = ym;
          entry.due_day = dueDay;
          entry.entry_date = null;
        } else {
          // oneoff: data do lançamento (default hoje)
          let date = cleanStr(body.entry_date, 10);
          if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            const d = new Date();
            date = `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
          }
          entry.entry_date = date;
          entry.due_day = null;
          entry.start_ym = null;
        }

        const created = await WalletFinanceStorage.createEntry(pool, user.id_user, entry);
        return { entry: created };
      }
    );
  }

  static async updateEntry(user, id, body = {}) {
    return runWithLogs(
      log,
      "updateEntry",
      () => ({ user_id: user?.id_user, id }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const entryId = parseInt(id, 10);
        if (!Number.isInteger(entryId)) return { error: "ID inválido", status: 400 };

        const patch = {};
        if (body.title !== undefined) patch.title = cleanStr(body.title, 120);
        if (body.category !== undefined) patch.category = cleanStr(body.category, 60);
        if (body.amount_cents !== undefined) {
          const c = toCents(body.amount_cents);
          if (c == null) return { error: "Valor inválido", status: 400 };
          patch.amount_cents = c;
        }
        if (body.due_day !== undefined) {
          const d = parseInt(body.due_day, 10);
          if (Number.isInteger(d) && d >= 1 && d <= 31) patch.due_day = d;
        }
        if (typeof body.active === "boolean") patch.active = body.active;

        const updated = await WalletFinanceStorage.updateEntry(pool, user.id_user, entryId, patch);
        if (!updated) return { error: "Lançamento não encontrado", status: 404 };
        return { entry: updated };
      }
    );
  }

  static async deleteEntry(user, id) {
    return runWithLogs(
      log,
      "deleteEntry",
      () => ({ user_id: user?.id_user, id }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const entryId = parseInt(id, 10);
        if (!Number.isInteger(entryId)) return { error: "ID inválido", status: 400 };
        const ok = await WalletFinanceStorage.deleteEntry(pool, user.id_user, entryId);
        if (!ok) return { error: "Lançamento não encontrado", status: 404 };
        return { ok: true };
      }
    );
  }

  static async listCategories(user, query = {}) {
    return runWithLogs(
      log,
      "listCategories",
      () => ({ user_id: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const direction = DIRECTIONS.includes(query.direction) ? query.direction : null;
        const recurrence = RECURRENCES.includes(query.recurrence) ? query.recurrence : null;
        const [categories, recent] = await Promise.all([
          WalletFinanceStorage.listCategories(pool, user.id_user, { direction, recurrence }),
          direction && recurrence
            ? WalletFinanceStorage.recentTitles(pool, user.id_user, { direction, recurrence })
            : Promise.resolve([]),
        ]);
        return { categories, recent };
      }
    );
  }

  static async createCategory(user, body = {}) {
    return runWithLogs(
      log,
      "createCategory",
      () => ({ user_id: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const direction = DIRECTIONS.includes(body.direction) ? body.direction : null;
        const recurrence = RECURRENCES.includes(body.recurrence) ? body.recurrence : null;
        const label = cleanStr(body.label, 60);
        if (!direction || !recurrence) return { error: "Tipo inválido", status: 400 };
        if (!label) return { error: "Informe o nome da categoria", status: 400 };
        const category = await WalletFinanceStorage.createCategory(pool, user.id_user, {
          direction,
          recurrence,
          label,
        });
        return { category };
      }
    );
  }
}

module.exports = WalletFinanceService;
