const pool = require("../../databases");
const MeiStorage = require("../../storages/MeiStorage");
const EarningsStorage = require("../../storages/EarningsStorage");
const { createLogger, runWithLogs } = require("../../utils/logger");

const log = createLogger("MeiService");

// Teto do MEI: R$ 81.000,00 / ano (faturamento bruto). Constante pra ajuste fácil.
const MEI_ANNUAL_LIMIT_CENTS = 8100000;
// DAS-MEI vence no dia 20 de cada mês.
const DAS_DUE_DAY = 20;

function currentYear() {
  return new Date().getUTCFullYear();
}

class MeiService {
  /**
   * Visão geral do MEI: perfil fiscal + termômetro do teto do ano (faturamento
   * realizado via Freelandoo, mês a mês) + dados do DAS.
   */
  static async overview(user, query = {}) {
    return runWithLogs(
      log,
      "overview",
      () => ({ user_id: user?.id_user, year: query.year }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const year = Math.min(
          2100,
          Math.max(2020, parseInt(query.year, 10) || currentYear())
        );
        const from = new Date(Date.UTC(year, 0, 1)).toISOString();
        const to = new Date(Date.UTC(year + 1, 0, 1)).toISOString();

        const [rows, profile] = await Promise.all([
          EarningsStorage.monthlyRealizedForRange(pool, { userId: user.id_user, from, to }),
          MeiStorage.getProfile(pool, user.id_user),
        ]);

        const byMonth = new Map(rows.map((r) => [r.month, Number(r.net_cents) || 0]));
        const months = [];
        let gross = 0;
        for (let m = 0; m < 12; m++) {
          const key = `${year}-${String(m + 1).padStart(2, "0")}`;
          const cents = byMonth.get(key) || 0;
          months.push({ month: m + 1, cents });
          gross += cents;
        }

        return {
          year,
          gross_cents: gross,
          limit_cents: MEI_ANNUAL_LIMIT_CENTS,
          pct: MEI_ANNUAL_LIMIT_CENTS > 0 ? gross / MEI_ANNUAL_LIMIT_CENTS : 0,
          months,
          das_due_day: DAS_DUE_DAY,
          profile: profile || {
            id_user: user.id_user,
            is_mei: false,
            cnpj: null,
            provider_name: null,
            provider_doc: null,
            provider_address: null,
            das_reminder: true,
          },
        };
      }
    );
  }

  static async saveProfile(user, body = {}) {
    return runWithLogs(
      log,
      "saveProfile",
      () => ({ user_id: user?.id_user, is_mei: body.is_mei }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const profile = await MeiStorage.upsertProfile(pool, user.id_user, {
          is_mei: !!body.is_mei,
          cnpj: typeof body.cnpj === "string" ? body.cnpj.trim().slice(0, 20) : null,
          provider_name:
            typeof body.provider_name === "string" ? body.provider_name.trim().slice(0, 160) : null,
          provider_doc:
            typeof body.provider_doc === "string" ? body.provider_doc.trim().slice(0, 20) : null,
          provider_address:
            typeof body.provider_address === "string" ? body.provider_address.trim().slice(0, 2000) : null,
          das_reminder: body.das_reminder !== false,
        });
        return { profile };
      }
    );
  }

  static async listReceipts(user, query = {}) {
    return runWithLogs(
      log,
      "listReceipts",
      () => ({ user_id: user?.id_user, page: query.page }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const page = Math.max(1, parseInt(query.page, 10) || 1);
        const perPage = Math.min(50, Math.max(1, parseInt(query.per_page, 10) || 20));
        const { items, total } = await MeiStorage.listReceipts(pool, user.id_user, {
          limit: perPage,
          offset: (page - 1) * perPage,
        });
        return {
          items,
          pagination: {
            page,
            per_page: perPage,
            total,
            total_pages: Math.max(1, Math.ceil(total / perPage)),
          },
        };
      }
    );
  }

  static async getReceipt(user, id) {
    return runWithLogs(
      log,
      "getReceipt",
      () => ({ user_id: user?.id_user, id }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };
        const receipt = await MeiStorage.getReceipt(pool, user.id_user, id);
        if (!receipt) return { error: "Recibo não encontrado", status: 404 };
        return { receipt };
      }
    );
  }

  static async createReceipt(user, body = {}) {
    return runWithLogs(
      log,
      "createReceipt",
      () => ({ user_id: user?.id_user, amount: body.amount_cents }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado", status: 401 };

        const taker_name = typeof body.taker_name === "string" ? body.taker_name.trim() : "";
        const description = typeof body.description === "string" ? body.description.trim() : "";
        const amount_cents = Math.round(Number(body.amount_cents));

        if (!taker_name) return { error: "Informe o nome do cliente (tomador).", status: 400 };
        if (!description) return { error: "Descreva o serviço prestado.", status: 400 };
        if (!Number.isFinite(amount_cents) || amount_cents <= 0)
          return { error: "Informe um valor válido.", status: 400 };

        const allowedKinds = ["service", "product", "course", "affiliate", "manual"];
        const source_kind = allowedKinds.includes(body.source_kind) ? body.source_kind : "manual";

        const receipt = await MeiStorage.createReceipt(pool, user.id_user, {
          taker_name: taker_name.slice(0, 160),
          taker_doc: typeof body.taker_doc === "string" ? body.taker_doc.trim().slice(0, 30) : null,
          description: description.slice(0, 2000),
          amount_cents,
          issued_for: typeof body.issued_for === "string" && body.issued_for ? body.issued_for : null,
          source_kind,
          source_id: typeof body.source_id === "string" ? body.source_id.slice(0, 80) : null,
        });
        return { receipt };
      }
    );
  }
}

module.exports = MeiService;
