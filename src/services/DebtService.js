// src/services/DebtService.js
//
// FEED DE BOLETOS (A2, mig 338). A pessoa com a chave "Preciso pagar dívidas"
// posta um boleto; quem quiser ajudar paga no app do PRÓPRIO banco pela linha
// digitável.
//
// ⚠️ A FREELANDOO NÃO TOCA NO DINHEIRO: não há checkout, não há repasse, não
// há saldo. Isso é o que mantém a plataforma fora de intermediação de
// pagamento — e é por isso que a confirmação é do DONO do boleto (só ele vê o
// boleto baixar no banco dele), não nossa.
//
// ⚠️ LGPD: o feed mostra beneficiário (conferido pela moderação), valor e
// vencimento — os dois últimos lidos da linha (utils/boleto.js). Nada do dono
// (nem nome) e nada do pagador do boleto. Imagem do boleto nunca é publicada.
// O comprovante de quem pagou vai para R2 privado e é apagado na decisão.
//
// Contra golpe: CPF + 18 anos + chave ligada, até `max_open` boletos de até
// `max_amount_cents` (tb_debt_settings), moderação do beneficiário antes de
// entrar no feed, reserva de 30 min ("Vou pagar"), denúncia (3 tiram do feed).

const pool = require("../databases");
const DebtStorage = require("../storages/DebtStorage");
const ProofStorage = require("../integrations/r2/debtProofStorage");
const EmeraldService = require("./EmeraldService");
const { checkBill, formatLine } = require("../utils/boleto");
const { postError, reserveError, proofError, participantScopeFor } = require("../utils/vitrine");
const { vitrineContext } = require("../utils/vitrineCommunity");
const { hasUpload, ensureFileBuffer } = require("../utils/mediaProcessing");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("DebtService");

const MAX_BENEFICIARY = 120;
const MAX_REASON = 280;

/** O aviso fixo do feed. O front mostra o mesmo texto (i18n). */
const DISCLAIMER =
  "Ajuda voluntária entre pessoas. A Freelandoo não recebe nem repassa dinheiro e não garante que o boleto seja pago ou que a ajuda chegue. Pague só pelo app do seu banco e confira o beneficiário antes.";

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
}

function notify(fn) {
  // Aviso é best-effort: nunca derruba o fluxo do boleto.
  try {
    const NotificationService = require("./NotificationService");
    Promise.resolve(fn(NotificationService)).catch(() => {});
  } catch {
    /* ignora */
  }
}

// `actor` é ignorado de propósito: o aviso não revela quem é quem (ver
// NotificationService.notifyDebt).
// eslint-disable-next-line no-unused-vars
function debtNotice(N, { to, actor, type, id_bill, amount_cents }) {
  return N.notifyDebt({ recipient_user_id: to, type, id_bill, amount_cents });
}

class DebtService {
  static DISCLAIMER = DISCLAIMER;

  /* ------------------------------ leitura -------------------------------- */

  static async settings() {
    const s = await DebtStorage.getSettings(pool);
    return { settings: s, disclaimer: DISCLAIMER };
  }

  /** Feed nacional (Brasil todo). */
  static async feed(user, query) {
    return runWithLogs(log, "feed", () => ({ id_user: user?.id_user }), async () => {
      const bills = await DebtStorage.listFeed(pool, {
        viewer: user?.id_user,
        limit: query?.limit,
        offset: query?.offset,
      });
      return { bills, disclaimer: DISCLAIMER };
    });
  }

  /** Aba Dívidas de uma comunidade. Sem membresia = Brasil todo. */
  static async communityFeed(user, params, query) {
    return runWithLogs(log, "communityFeed", () => ({ id_user: user?.id_user }), async () => {
      const ctx = await vitrineContext(pool, user?.id_user, params.id_profile, { require: "member" });
      if (ctx.error) return ctx;
      const scope = participantScopeFor(ctx.community.kind);
      const bills = await DebtStorage.listFeed(pool, {
        viewer: user.id_user,
        id_community: ctx.community.id_profile,
        participantsOnly: scope === "participants",
        limit: query?.limit,
        offset: query?.offset,
      });
      return { bills, scope, disclaimer: DISCLAIMER };
    });
  }

  static async mine(user) {
    const [bills, helping, helped, settings, openCount] = await Promise.all([
      DebtStorage.listMine(pool, user.id_user),
      DebtStorage.listHelping(pool, user.id_user),
      DebtStorage.helpedCount(pool, user.id_user),
      DebtStorage.getSettings(pool),
      DebtStorage.countOpen(pool, user.id_user),
    ]);
    const fmt = (b) => (b.line_digits ? { ...b, line: formatLine(b.line_digits) } : b);
    return {
      bills: bills.map(fmt),
      helping: helping.map(fmt),
      helped,
      open_count: openCount,
      settings,
      disclaimer: DISCLAIMER,
    };
  }

  /* ------------------------------ postar --------------------------------- */

  static async create(user, body) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user }), async () => {
      const settings = await DebtStorage.getSettings(pool);
      const poster = await DebtStorage.getPoster(pool, user.id_user);
      const openCount = await DebtStorage.countOpen(pool, user.id_user);
      const denied = postError({ user: poster, openCount, settings });
      if (denied) return denied;

      const beneficiary = clean(body?.beneficiary, MAX_BENEFICIARY);
      if (!beneficiary || beneficiary.length < 3) {
        return { error: "Informe o beneficiário (quem recebe o pagamento), como está no boleto.", statusCode: 400 };
      }

      const bill = checkBill(body?.line, {
        due_date: body?.due_date,
        max_amount_cents: settings.max_amount_cents,
      });
      if (bill.error) return { error: bill.error, statusCode: 400, reason: bill.code };

      const row = await DebtStorage.create(pool, {
        id_user: user.id_user,
        line_digits: bill.digits,
        bill_kind: bill.kind,
        amount_cents: bill.amount_cents,
        due_date: bill.due_date,
        beneficiary,
      });
      if (!row) {
        return { error: "Este boleto já está no feed.", statusCode: 409, reason: "duplicate" };
      }
      return { bill: row, needs_review: true };
    });
  }

  static async cancel(user, params) {
    const ok = await DebtStorage.cancel(pool, params.id_bill, user.id_user);
    if (!ok) return { error: "Este boleto não pode mais ser retirado.", statusCode: 409 };
    return { ok: true };
  }

  /* ------------------------------ ajudar --------------------------------- */

  static async reserve(user, params) {
    return runWithLogs(log, "reserve", () => ({ id_user: user?.id_user, id_bill: params?.id_bill }), async () => {
      const bill = await DebtStorage.getById(pool, params.id_bill);
      if (bill?.expired) return { error: "Este boleto venceu.", statusCode: 409 };
      const denied = reserveError(bill, user.id_user);
      if (denied) return denied;
      const settings = await DebtStorage.getSettings(pool);
      const row = await DebtStorage.reserve(pool, params.id_bill, user.id_user, settings.reserve_minutes);
      // Perdeu a corrida para outra pessoa no mesmo segundo.
      if (!row) return { error: "Alguém já está pagando este boleto.", statusCode: 409 };
      return {
        bill: { ...row, line: formatLine(row.line_digits) },
        reserve_minutes: settings.reserve_minutes,
        disclaimer: DISCLAIMER,
      };
    });
  }

  static async release(user, params) {
    await DebtStorage.release(pool, params.id_bill, user.id_user);
    return { ok: true };
  }

  /** Quem pagou anexa o comprovante (multipart `file`). */
  static async submitProof(user, params, file) {
    return runWithLogs(log, "submitProof", () => ({ id_user: user?.id_user, id_bill: params?.id_bill }), async () => {
      if (!hasUpload(file)) return { error: "Envie o comprovante (PDF ou foto).", statusCode: 400 };
      const ext = ProofStorage.extForMime(file.mimetype);
      if (!ext) return { error: "Formato não aceito. Envie PDF, JPG, PNG ou WebP.", statusCode: 400 };

      const bill = await DebtStorage.getById(pool, params.id_bill);
      const denied = proofError(bill, user.id_user);
      if (denied) return denied;

      await ensureFileBuffer(file);
      const key = ProofStorage.buildKey(bill.id_bill, ext);
      await ProofStorage.putObject(key, file.buffer, file.mimetype);

      const row = await DebtStorage.claim(pool, bill.id_bill, user.id_user, key);
      if (!row) {
        // A reserva venceu entre a leitura e a gravação: não deixa arquivo órfão.
        await ProofStorage.deleteObject(key);
        return { error: "Sua reserva venceu. Reserve de novo para enviar.", statusCode: 409 };
      }
      notify((N) =>
        debtNotice(N, { to: row.id_user, actor: user.id_user, type: "debt_bill_claimed", id_bill: row.id_bill, amount_cents: row.amount_cents })
      );
      return { bill: row };
    });
  }

  /** URL de 5 min do comprovante: só o dono do boleto e a moderação. */
  static async proofUrl(user, params, { admin = false } = {}) {
    const bill = await DebtStorage.getById(pool, params.id_bill);
    if (!bill) return { error: "Boleto não encontrado.", statusCode: 404 };
    if (!admin && String(bill.id_user) !== String(user.id_user)) {
      return { error: "Só o dono do boleto vê o comprovante.", statusCode: 403 };
    }
    if (!bill.proof_key) return { error: "Não há comprovante para conferir.", statusCode: 404 };
    return { url: await ProofStorage.presignView(bill.proof_key) };
  }

  /** O dono viu o boleto baixar no banco dele: sai do feed, quem ajudou ganha. */
  static async confirm(user, params) {
    return runWithLogs(log, "confirm", () => ({ id_user: user?.id_user, id_bill: params?.id_bill }), async () => {
      const client = await pool.connect();
      let proofKey = null;
      let reward = null;
      let row = null;
      try {
        await client.query("BEGIN");
        const bill = await DebtStorage.getById(client, params.id_bill, { forUpdate: true });
        if (!bill || String(bill.id_user) !== String(user.id_user)) {
          await client.query("ROLLBACK");
          return { error: "Boleto não encontrado.", statusCode: 404 };
        }
        proofKey = bill.proof_key;
        row = await DebtStorage.confirm(client, bill.id_bill, user.id_user);
        if (!row) {
          await client.query("ROLLBACK");
          return { error: "Não há pagamento para confirmar neste boleto.", statusCode: 409 };
        }
        // Esmeralda para quem ajudou (A7): idempotente pelo boleto, e um par
        // (ajudante, ajudado) só rende uma vez — senão duas contas combinadas
        // fabricariam Esmeralda confirmando boletos uma da outra.
        const settings = await DebtStorage.getSettings(client);
        if (row.paid_by && settings.helper_emerald > 0) {
          const repeat = await DebtStorage.pairRewarded(client, row.paid_by, user.id_user, row.id_bill);
          if (!repeat) {
            reward = await EmeraldService.grant(client, {
              user_id: row.paid_by,
              amount: settings.helper_emerald,
              type: "earn_engagement",
              source: "debt_help",
              source_id: String(row.id_bill),
              metadata: { id_bill: row.id_bill },
            });
          }
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      if (proofKey) await ProofStorage.deleteObject(proofKey);
      notify((N) =>
        debtNotice(N, { to: row.paid_by, actor: user.id_user, type: "debt_bill_confirmed", id_bill: row.id_bill, amount_cents: row.amount_cents })
      );
      return { ok: true, emerald: reward ? reward.transaction?.amount || 0 : 0 };
    });
  }

  /** O dono não viu o boleto baixar: volta ao feed, comprovante apagado. */
  static async rejectProof(user, params) {
    const bill = await DebtStorage.getById(pool, params.id_bill);
    if (!bill || String(bill.id_user) !== String(user.id_user)) {
      return { error: "Boleto não encontrado.", statusCode: 404 };
    }
    const helper = bill.paid_by;
    const ok = await DebtStorage.rejectProof(pool, bill.id_bill, user.id_user);
    if (!ok) return { error: "Não há comprovante para recusar.", statusCode: 409 };
    await ProofStorage.deleteObject(bill.proof_key);
    notify((N) => debtNotice(N, { to: helper, actor: user.id_user, type: "debt_proof_rejected", id_bill: bill.id_bill }));
    return { ok: true };
  }

  static async report(user, params, body) {
    const reason = clean(body?.reason, MAX_REASON);
    if (!reason) return { error: "Conte o motivo da denúncia.", statusCode: 400 };
    const bill = await DebtStorage.getById(pool, params.id_bill);
    if (!bill) return { error: "Boleto não encontrado.", statusCode: 404 };
    if (String(bill.id_user) === String(user.id_user)) {
      return { error: "Você não pode denunciar o seu próprio boleto.", statusCode: 400 };
    }
    await DebtStorage.report(pool, bill.id_bill, user.id_user, reason);
    return { ok: true };
  }

  /* ------------------------------ moderação ------------------------------ */

  static async adminQueue() {
    const items = await DebtStorage.listQueue(pool);
    return { items: items.map((b) => ({ ...b, line: formatLine(b.line_digits) })) };
  }

  static async adminReview(admin, params, body) {
    const approve = body?.approve === true || body?.approve === "true";
    const row = await DebtStorage.review(
      pool,
      params.id_bill,
      {
        approve,
        beneficiary: clean(body?.beneficiary, MAX_BENEFICIARY),
        reason: clean(body?.reason, MAX_REASON),
      },
      admin.id_user
    );
    if (!row) return { error: "Este boleto não está esperando revisão.", statusCode: 409 };
    notify((N) => debtNotice(N, { to: row.id_user, actor: admin.id_user, type: "debt_bill_reviewed", id_bill: row.id_bill }));
    return { bill: row };
  }

  static async adminRemove(admin, params, body) {
    const row = await DebtStorage.remove(pool, params.id_bill, clean(body?.reason, MAX_REASON), admin.id_user);
    if (!row) return { error: "Este boleto não pode ser retirado.", statusCode: 409 };
    if (row.proof_key) {
      await ProofStorage.deleteObject(row.proof_key);
      await DebtStorage.clearProofKey(pool, row.id_bill);
    }
    await DebtStorage.resolveReports(pool, row.id_bill, admin.id_user);
    return { ok: true };
  }

  static async adminResolveReports(admin, params) {
    const n = await DebtStorage.resolveReports(pool, params.id_bill, admin.id_user);
    return { resolved: n };
  }

  static async adminSettings() {
    return { settings: await DebtStorage.getSettings(pool) };
  }

  static async adminUpdateSettings(admin, body) {
    return { settings: await DebtStorage.updateSettings(pool, body || {}, admin.id_user) };
  }
}

module.exports = DebtService;
