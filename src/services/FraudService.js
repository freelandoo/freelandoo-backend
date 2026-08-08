// src/services/FraudService.js
// Painel de Fraude (mig 201). Duas metades:
//   - avaliação automática: junta os fatos, pontua (utils/fraudScore) e, se
//     passar do limiar, abre um caso na FILA. Nunca bloqueia sozinho.
//   - operação do admin: listar a fila, abrir um caso com toda a evidência,
//     decidir (liberar / observar / bloquear).

const pool = require("../databases");
const FraudStorage = require("../storages/FraudStorage");
const {
  evaluate,
  needsReview,
  REVIEW_THRESHOLD,
  WEIGHTS,
} = require("../utils/fraudScore");
const { normalizeCPF } = require("../utils/documents");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FraudService");

const DECISIONS = new Set(["cleared", "watch", "blocked"]);

class FraudService {
  /**
   * Reavalia um usuário e abre/atualiza o caso na fila se for o caso.
   * Chamada fire-and-forget depois do signup e do onboarding — NUNCA pode
   * derrubar esses fluxos, então todo erro é engolido e logado.
   *
   * Respeita decisão humana anterior: conta já liberada/bloqueada por um admin
   * não volta pra fila automaticamente.
   */
  static async evaluateUser(id_user, { force = false } = {}) {
    try {
      if (!id_user) return null;

      const facts = await FraudStorage.getFactsForUser(pool, id_user);
      if (!facts) return null;

      if (!force && (await FraudStorage.hasDecision(pool, id_user))) {
        return null;
      }

      const { score, reasons } = evaluate({
        nome: facts.nome,
        cpf: facts.cpf,
        uf: facts.uf,
        email_domain: facts.email_domain,
        accounts_same_ip: facts.accounts_same_ip,
        accounts_same_ip_1h: facts.accounts_same_ip_1h,
        ...this._payoutFacts(facts),
      });

      if (!needsReview(score)) return { score, reasons, queued: false };

      const review = await FraudStorage.upsertPendingReview(pool, {
        id_user,
        score,
        reasons,
      });
      log.info("fraud.queued", { id_user, score, codes: reasons.map((r) => r.code) });
      return { score, reasons, queued: true, id_review: review?.id_review };
    } catch (err) {
      log.error("evaluateUser.fail", { id_user, error: err?.message });
      return null;
    }
  }

  /**
   * Traduz o destino de repasse guardado em fatos pro score. CNPJ não é
   * irregular (MEI/empresa é legítimo) — é só não-verificável offline, então
   * pontua baixo em vez de acusar divergência.
   */
  static _payoutFacts(facts) {
    const digits = String(facts.payout_tax_id || "").replace(/\D/g, "");
    if (!digits) return {};
    if (digits.length === 14) return { payout_is_cnpj: true };
    if (digits.length === 11) {
      return { payout_cpf: digits === facts.cpf ? "match" : "mismatch" };
    }
    return {};
  }

  /** Grava o contexto do cadastro. Fire-and-forget, nunca derruba o signup. */
  static async recordSignupContext(conn, payload) {
    try {
      await FraudStorage.recordSignupContext(conn, payload);
    } catch (err) {
      log.error("recordSignupContext.fail", {
        id_user: payload?.id_user,
        error: err?.message,
      });
    }
  }

  // ─── Operação do admin ───────────────────────────────────────────────────
  static async dashboard() {
    return runWithLogs(log, "dashboard", () => ({}), async () => {
      const kpis = await FraudStorage.getDashboard(pool);
      return {
        kpis,
        settings: { review_threshold: REVIEW_THRESHOLD, weights: WEIGHTS },
      };
    });
  }

  static async listQueue({ status, q, page, per_page }) {
    return runWithLogs(log, "listQueue", () => ({ status }), async () => {
      const perPage = Math.min(Math.max(Number(per_page) || 50, 1), 200);
      const pageNum = Math.max(Number(page) || 1, 1);
      const allowed = new Set(["pending", "cleared", "watch", "blocked", "all"]);
      const st = allowed.has(status) ? status : "pending";

      const { rows, total } = await FraudStorage.listQueue(pool, {
        status: st,
        q: q || null,
        limit: perPage,
        offset: (pageNum - 1) * perPage,
      });
      return { reviews: rows, total, page: pageNum, per_page: perPage };
    });
  }

  static async getCase(id_review) {
    return runWithLogs(log, "getCase", () => ({ id_review }), async () => {
      const review = await FraudStorage.getReview(pool, id_review);
      if (!review) return { error: "Caso não encontrado", statusCode: 404 };

      const same_ip = await FraudStorage.listSameIpAccounts(pool, {
        signup_ip: review.signup_ip,
        exclude_user: review.id_user,
      });
      return { review, same_ip };
    });
  }

  /**
   * Decisão humana. 'blocked' também derruba o acesso da conta (tb_user
   * .blocked_at); 'cleared'/'watch' desbloqueiam, pra que reverter um engano
   * seja um clique — não uma ida ao banco.
   */
  static async decide(admin, { id_review, status, notes }) {
    return runWithLogs(
      log,
      "decide",
      () => ({ id_review, status }),
      async () => {
        if (!DECISIONS.has(status)) {
          return { error: "Decisão inválida", statusCode: 400 };
        }
        const review = await FraudStorage.getReview(pool, id_review);
        if (!review) return { error: "Caso não encontrado", statusCode: 404 };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const decided = await FraudStorage.decideReview(client, {
            id_review,
            status,
            notes,
            decided_by: admin?.id_user || null,
          });
          await FraudStorage.setBlocked(client, {
            id_user: review.id_user,
            blocked: status === "blocked",
            reason: status === "blocked" ? notes || "Bloqueado no painel de fraude" : null,
            by_user: admin?.id_user || null,
          });
          await client.query("COMMIT");
          return { ok: true, review: decided };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }

  /** Reavaliação manual de um caso (o admin mexeu nos dados e quer repontuar). */
  static async reevaluate(id_user) {
    return runWithLogs(log, "reevaluate", () => ({ id_user }), async () => {
      const result = await this.evaluateUser(id_user, { force: true });
      if (!result) return { error: "Usuário não encontrado", statusCode: 404 };
      return result;
    });
  }

  static async payoutMismatches() {
    return runWithLogs(log, "payoutMismatches", () => ({}), async () => {
      const rows = await FraudStorage.listPayoutMismatches(pool, { limit: 100 });
      return { mismatches: rows };
    });
  }

  /**
   * Gate do destino de repasse — a regra do Alex: "o CPF da conta que recebe o
   * dinheiro precisa ser o mesmo do cadastrado". Usado pelo AffiliateService e
   * OBRIGATÓRIO em qualquer destino de repasse novo.
   *
   * CNPJ passa (MEI/empresa é legítimo) mas vira sinal pro painel; CPF
   * diferente do da conta é recusa dura.
   */
  static async assertPayoutOwnership(conn, { id_user, tax_id, pix_key, pix_key_type }) {
    const u = await conn.query(
      `SELECT cpf FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
      [id_user],
    );
    const accountCpf = u.rows[0]?.cpf || null;
    if (!accountCpf) {
      return {
        error:
          "Cadastre seu CPF antes de configurar o recebimento — o dinheiro só sai para o CPF do titular da conta.",
        reason: "cpf_required",
      };
    }

    const digits = String(tax_id || "").replace(/\D/g, "");
    if (!digits) {
      return {
        error: "Informe o CPF do titular que vai receber o dinheiro.",
        reason: "payout_tax_id_required",
      };
    }
    if (digits.length === 11 && digits !== accountCpf) {
      return {
        error:
          "O CPF do recebedor precisa ser o mesmo CPF cadastrado na conta. Não é possível receber no CPF de outra pessoa.",
        reason: "payout_cpf_mismatch",
      };
    }
    if (digits.length !== 11 && digits.length !== 14) {
      return { error: "CPF/CNPJ do recebedor inválido.", reason: "payout_tax_id_invalid" };
    }

    // Chave Pix do tipo CPF tem que ser a mesma coisa — senão o titular do
    // tax_id e o da chave seriam pessoas diferentes.
    const keyDigits = String(pix_key || "").replace(/\D/g, "");
    const isCpfKey =
      String(pix_key_type || "").toLowerCase() === "cpf" ||
      (keyDigits.length === 11 && normalizeCPF(keyDigits));
    if (isCpfKey && keyDigits && keyDigits !== accountCpf) {
      return {
        error:
          "A chave Pix do tipo CPF precisa ser o CPF cadastrado na conta.",
        reason: "payout_pix_mismatch",
      };
    }

    return { ok: true, is_cnpj: digits.length === 14 };
  }
}

module.exports = FraudService;
