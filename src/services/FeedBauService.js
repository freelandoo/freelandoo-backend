// Baú de DOAÇÃO (Feed Interativo, mig 460).
//
// Quem doa compra um baú com o valor que quiser e escolhe só a região. O baú
// pago fica num "poço" da região e cai no feed de UMA pessoa sorteada que
// abrir o feed lá (chance por abertura, drop_chance_pct). Ao abrir, o valor —
// menos 5% da doação, a tarifa real do Mercado Pago e 5% do saque — vira
// repasse em Recebimentos, com holdback, no ciclo de sempre
// (aguardando → aprovado → pago | revertido | devido).
//
// Quem pode receber: conta ativa, adulta, com CPF (o saque é PIX), com estado
// no perfil-conta, que não é o doador, sem bloqueio social com ele, que não
// recebeu baú de doação nos últimos 7 dias e não tem outro fechado na mão.
// Baú que caiu e não foi aberto em claim_days volta ao poço (e não cai de
// novo na mesma pessoa). Sem ninguém na região, depois de widen_days vale o
// estado inteiro; depois de 2×, o Brasil.
//
// Pagamento (regra 15): confirmar (webhook) + expirar + estornar, todos
// idempotentes; o fluxo está em PaymentOpsStorage.SOURCES ('bau_doacao').

const crypto = require("node:crypto");
const pool = require("../databases");
const PaymentGateway = require("../integrations/payments");
const { isMinorUser } = require("../utils/supervision");
const { splitBau } = require("../utils/feedBauMoney");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FeedBauService");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UFS = new Set("AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" "));
const RECEIVE_COOLDOWN_DAYS = 7;
const SWEEP_MS = 10 * 60_000;
let sweepTimer = null;

function realtime() {
  return require("../realtime/socket");
}

async function settings(db = pool) {
  const r = await db.query(`SELECT * FROM public.tb_feed_bau_settings WHERE id = 1`);
  return (
    r.rows[0] || {
      donation_fee_bps: 500,
      withdraw_fee_bps: 500,
      min_cents: 100,
      max_cents: 100000000,
      holdback_days: 8,
      widen_days: 7,
      claim_days: 3,
      drop_chance_pct: 35,
    }
  );
}

function cleanMessage(raw) {
  if (typeof raw !== "string") return null;
  const v = raw
    // eslint-disable-next-line no-control-regex -- tirar caractere de controle é o objetivo
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return v ? v.slice(0, 140) : null;
}

class FeedBauService {
  static settings = settings;

  /** Público para a tela: limites e taxas (a pessoa vê quanto chega do outro lado). */
  static async publicSettings() {
    const s = await settings();
    return {
      min_cents: Number(s.min_cents),
      max_cents: Number(s.max_cents),
      donation_fee_bps: Number(s.donation_fee_bps),
      withdraw_fee_bps: Number(s.withdraw_fee_bps),
      holdback_days: Number(s.holdback_days),
    };
  }

  // ── doar ──────────────────────────────────────────────────────────────────
  static async create(user, body = {}) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user, uf: body?.uf }), async () => {
      if (!user?.id_user) return { error: "Usuário não autenticado", statusCode: 401 };
      if (await isMinorUser(user.id_user)) return { error: "Doação não está disponível para contas de menores", statusCode: 403 };
      const s = await settings();
      const amount = Math.round(Number(body.amount_cents));
      if (!Number.isFinite(amount) || amount < Number(s.min_cents)) {
        return { error: `O baú precisa ter pelo menos R$ ${(Number(s.min_cents) / 100).toFixed(2).replace(".", ",")}` };
      }
      if (amount > Number(s.max_cents)) return { error: "Valor acima do máximo de um baú" };
      const uf = String(body.uf || "").toUpperCase();
      if (!UFS.has(uf)) return { error: "Escolha o estado onde o baú vai cair" };
      let id_region = null;
      if (body.id_region != null && body.id_region !== "") {
        const rid = Number(body.id_region);
        const r = await pool.query(`SELECT id_region FROM public.tb_region WHERE id_region = $1 AND uf = $2`, [rid, uf]);
        if (!r.rowCount) return { error: "Região inválida para esse estado" };
        id_region = rid;
      }
      const open = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public.tb_feed_bau_donation
          WHERE id_donor = $1 AND status = 'pending_payment' AND created_at > NOW() - INTERVAL '1 hour'`,
        [user.id_user]
      );
      if (open.rows[0].n >= 10) return { error: "Você tem muitos pagamentos de baú abertos. Termine um antes.", statusCode: 429 };

      const ins = await pool.query(
        `INSERT INTO public.tb_feed_bau_donation (id_donor, amount_cents, uf, id_region, message, anonymous)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id_bau`,
        [user.id_user, amount, uf, id_region, cleanMessage(body.message), !!body.anonymous]
      );
      const id_bau = ins.rows[0].id_bau;
      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
      const session = await PaymentGateway.createCheckout({
        amount_cents: amount,
        currency: "BRL",
        productName: "Baú de doação — Freelandoo",
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/feed/bau?doacao=paga&bau=${id_bau}`,
        cancelUrl: `${frontend}/feed/bau?doacao=cancelada`,
        metadata: { type: "feed_bau", id_bau },
      });
      await pool.query(`UPDATE public.tb_feed_bau_donation SET session_id = $2 WHERE id_bau = $1`, [id_bau, session.id]);
      return { checkout_url: session.url, id_bau };
    });
  }

  static async listMine(user) {
    if (!user?.id_user) return { error: "Usuário não autenticado", statusCode: 401 };
    const r = await pool.query(
      `SELECT d.id_bau, d.amount_cents, d.uf, d.id_region, rg.name AS region_name, d.message, d.anonymous,
              d.status, d.created_at, d.paid_at, d.assigned_at, d.opened_at
         FROM public.tb_feed_bau_donation d
         LEFT JOIN public.tb_region rg ON rg.id_region = d.id_region
        WHERE d.id_donor = $1 AND d.status <> 'expired'
        ORDER BY d.created_at DESC LIMIT 50`,
      [user.id_user]
    );
    // Quem recebeu não é revelado ao doador: ele vê só que caiu / foi aberto.
    return { baus: r.rows.map((x) => ({ ...x, amount_cents: Number(x.amount_cents) })) };
  }

  // ── webhook (regra 15) ────────────────────────────────────────────────────
  static async confirmStripeSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "feed_bau") return { ignored: true };
    return runWithLogs(log, "confirm", () => ({ session: session?.id }), async () => {
      const paymentIntentId =
        typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
      let row = (await pool.query(`SELECT * FROM public.tb_feed_bau_donation WHERE session_id = $1`, [session.id])).rows[0];
      if (!row && meta.id_bau && UUID_RE.test(String(meta.id_bau))) {
        row = (await pool.query(`SELECT * FROM public.tb_feed_bau_donation WHERE id_bau = $1`, [meta.id_bau])).rows[0];
      }
      if (!row) return { error: "Baú não encontrado para esta sessão" };
      if (row.status !== "pending_payment") return { ok: true, already: true };

      let processor = null;
      try {
        const fee = await PaymentGateway.getChargeFee(paymentIntentId);
        if (fee?.fee_cents !== null && fee?.fee_cents !== undefined && Number.isFinite(Number(fee.fee_cents))) {
          processor = Math.round(Number(fee.fee_cents));
        } else {
          log.warn("bau.processor_fee.unavailable", { id_bau: row.id_bau });
        }
      } catch (err) {
        log.warn("bau.processor_fee.fail", { id_bau: row.id_bau, message: err?.message });
      }
      const up = await pool.query(
        `UPDATE public.tb_feed_bau_donation
            SET status = 'paid', paid_at = NOW(), provider_ref = COALESCE($2, provider_ref), processor_fee_cents = $3,
                session_id = COALESCE(session_id, $4)
          WHERE id_bau = $1 AND status = 'pending_payment'
          RETURNING id_bau, id_donor`,
        [row.id_bau, paymentIntentId, processor, session.id]
      );
      if (!up.rowCount) return { ok: true, already: true };
      realtime().emitToUser(up.rows[0].id_donor, "fi:notice", { type: "bau-paid", id_bau: row.id_bau });
      return { ok: true };
    });
  }

  static async expireBySession(session_id) {
    const r = await pool.query(
      `UPDATE public.tb_feed_bau_donation SET status = 'expired'
        WHERE session_id = $1 AND status = 'pending_payment' RETURNING id_bau`,
      [session_id]
    );
    return r.rowCount > 0;
  }

  /** Estorno: baú volta a nada; repasse revertido (ou 'devido' se já foi pago). Não é nosso → null. */
  static async handleChargeRefunded(charge) {
    const refs = [typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id, charge?.id].filter(Boolean);
    if (!refs.length) return null;
    const row = (
      await pool.query(
        `SELECT * FROM public.tb_feed_bau_donation WHERE provider_ref = ANY($1::text[]) AND status <> 'refunded' LIMIT 1`,
        [refs]
      )
    ).rows[0];
    if (!row) return null;
    return runWithLogs(log, "refund", () => ({ id_bau: row.id_bau }), async () => {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`UPDATE public.tb_feed_bau_donation SET status = 'refunded', refunded_at = NOW() WHERE id_bau = $1`, [row.id_bau]);
        await client.query(
          `UPDATE public.tb_feed_bau_payout
              SET status = CASE WHEN status = 'pago' THEN 'devido' ELSE 'revertido' END, reverted_at = NOW(), updated_at = NOW()
            WHERE id_bau = $1 AND status IN ('aguardando', 'aprovado', 'pago')`,
          [row.id_bau]
        );
        if (row.id_drop) {
          await client.query(`UPDATE public.tb_feed_drop SET status = 'failed' WHERE id_drop = $1 AND status IN ('delivered', 'seen')`, [row.id_drop]);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      return { reverted: true };
    });
  }

  // ── sorteio ───────────────────────────────────────────────────────────────
  /**
   * Chamado quando a pessoa abre o feed (inbox). Com a chance configurada,
   * tenta pôr UM baú do poço da região dela no feed. Devolve true se caiu.
   */
  static async tryAssign(id_user, { force = false } = {}) {
    const s = await settings();
    if (!force && crypto.randomInt(100) >= Number(s.drop_chance_pct)) return false;
    const me = (
      await pool.query(
        `SELECT tu.id_user, tu.ativo, tu.blocked_at, tu.cpf, tu.is_minor, pa.estado AS uf, pa.id_region
           FROM public.tb_user tu
           JOIN public.tb_profile pa ON pa.id_user = tu.id_user AND pa.is_user_account = TRUE AND pa.deleted_at IS NULL
          WHERE tu.id_user = $1
          LIMIT 1`,
        [id_user]
      )
    ).rows[0];
    if (!me || !me.ativo || me.blocked_at || me.is_minor || !me.cpf || !me.uf) return false;
    const recent = await pool.query(
      `SELECT 1 FROM public.tb_feed_bau_donation
        WHERE id_receiver = $1 AND (status = 'assigned' OR assigned_at > NOW() - make_interval(days => $2))
        LIMIT 1`,
      [id_user, RECEIVE_COOLDOWN_DAYS]
    );
    if (recent.rowCount) return false;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const pick = (
        await client.query(
          `SELECT d.* FROM public.tb_feed_bau_donation d
            WHERE d.status = 'paid' AND d.id_donor <> $1
              AND NOT EXISTS (SELECT 1 FROM public.tb_feed_bau_skip k WHERE k.id_bau = d.id_bau AND k.id_user = $1)
              AND NOT EXISTS (
                SELECT 1 FROM public.tb_user_block ub
                 WHERE (ub.blocker_user_id = d.id_donor AND ub.blocked_user_id = $1)
                    OR (ub.blocker_user_id = $1 AND ub.blocked_user_id = d.id_donor))
              AND (
                (d.uf = $2 AND (d.id_region IS NULL OR d.id_region = $3))
                OR (d.uf = $2 AND d.paid_at < NOW() - make_interval(days => $4))
                OR d.paid_at < NOW() - make_interval(days => $4 * 2)
              )
            ORDER BY (d.uf = $2 AND (d.id_region IS NULL OR d.id_region = $3)) DESC, d.paid_at
            LIMIT 1
            FOR UPDATE SKIP LOCKED`,
          [id_user, me.uf, me.id_region, Number(s.widen_days)]
        )
      ).rows[0];
      if (!pick) {
        await client.query("ROLLBACK");
        return false;
      }
      const drop = (
        await client.query(
          `INSERT INTO public.tb_feed_drop (kind, id_sender, id_receiver, payload, status, delivered_at)
           VALUES ('gift', $1, $2, $3::jsonb, 'delivered', NOW()) RETURNING id_drop`,
          [pick.id_donor, id_user, JSON.stringify({ doacao: true, id_bau: pick.id_bau, chest: "ouro", anonymous: !!pick.anonymous, message: pick.message })]
        )
      ).rows[0];
      await client.query(
        `UPDATE public.tb_feed_bau_donation
            SET status = 'assigned', id_receiver = $2, id_drop = $3, assigned_at = NOW()
          WHERE id_bau = $1`,
        [pick.id_bau, id_user, drop.id_drop]
      );
      await client.query("COMMIT");
      realtime().emitToUser(pick.id_donor, "fi:notice", { type: "bau-dropped", id_bau: pick.id_bau });
      return true;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      log.warn("bau.assign_fail", { message: err?.message });
      return false;
    } finally {
      client.release();
    }
  }

  /**
   * Dentro da transação do "abrir baú" (FeedInterativoService.openGift): o baú
   * de doação vira repasse com holdback. Devolve o recibo para a animação.
   */
  static async onOpened(client, drop, id_user) {
    const id_bau = drop.payload?.id_bau;
    if (!id_bau) return null;
    const up = (
      await client.query(
        `UPDATE public.tb_feed_bau_donation SET status = 'opened', opened_at = NOW()
          WHERE id_bau = $1 AND id_receiver = $2 AND status = 'assigned'
          RETURNING *`,
        [id_bau, id_user]
      )
    ).rows[0];
    if (!up) return null;
    const s = await settings(client);
    const money = splitBau({
      grossCents: Number(up.amount_cents),
      donationFeeBps: Number(s.donation_fee_bps),
      withdrawFeeBps: Number(s.withdraw_fee_bps),
      processorFeeCents: up.processor_fee_cents === null ? null : Number(up.processor_fee_cents),
    });
    if (money.processor_estimated) log.warn("bau.payout.processor_unknown", { id_bau });
    const available_at = new Date(Date.now() + Number(s.holdback_days) * 86400_000);
    await client.query(
      `INSERT INTO public.tb_feed_bau_payout
         (id_bau, id_receiver_user, gross_cents, platform_fee_cents, processor_fee_cents, withdraw_fee_cents, net_cents, available_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id_bau) DO NOTHING`,
      [id_bau, id_user, money.gross_cents, money.platform_fee_cents, money.processor_fee_cents, money.withdraw_fee_cents, money.net_cents, available_at]
    );
    return { ...money, available_at: available_at.toISOString(), donor_id: up.id_donor };
  }

  // ── varredura ─────────────────────────────────────────────────────────────
  /** Baú que caiu e não foi aberto volta ao poço; repasse vencido é liberado. */
  static async sweep() {
    const s = await settings();
    const stale = await pool.query(
      `WITH st AS (
         SELECT id_bau, id_receiver, id_drop FROM public.tb_feed_bau_donation
          WHERE status = 'assigned' AND assigned_at < NOW() - make_interval(days => $1)
          FOR UPDATE SKIP LOCKED
       ), sk AS (
         INSERT INTO public.tb_feed_bau_skip (id_bau, id_user)
         SELECT id_bau, id_receiver FROM st WHERE id_receiver IS NOT NULL
         ON CONFLICT DO NOTHING
       ), dr AS (
         UPDATE public.tb_feed_drop SET status = 'failed'
          WHERE id_drop IN (SELECT id_drop FROM st) AND status IN ('delivered', 'seen')
       )
       UPDATE public.tb_feed_bau_donation d
          SET status = 'paid', id_receiver = NULL, id_drop = NULL, assigned_at = NULL
         FROM st WHERE d.id_bau = st.id_bau
       RETURNING d.id_bau`,
      [Number(s.claim_days)]
    );
    const released = await pool.query(
      `UPDATE public.tb_feed_bau_payout SET status = 'aprovado', approved_at = NOW(), updated_at = NOW()
        WHERE status = 'aguardando' AND available_at <= NOW() RETURNING id_payout`
    );
    return { returned: stale.rowCount, released: released.rowCount };
  }

  static startSweeper() {
    if (sweepTimer) return;
    const tick = () => FeedBauService.sweep().catch((err) => log.warn("bau.sweep_fail", { message: err?.message }));
    sweepTimer = setInterval(tick, SWEEP_MS);
    sweepTimer.unref?.();
    setTimeout(tick, 60_000).unref?.();
  }

  // ── admin ─────────────────────────────────────────────────────────────────
  static async adminList(query = {}) {
    const status = ["aguardando", "aprovado", "pago", "revertido", "devido"].includes(query.status) ? query.status : "aprovado";
    const items = await pool.query(
      `SELECT p.*, u.username AS receiver_username, u.email AS receiver_email,
              COALESCE(pa.display_name, u.nome) AS receiver_display_name, d.uf, d.created_at AS donated_at
         FROM public.tb_feed_bau_payout p
         JOIN public.tb_user u ON u.id_user = p.id_receiver_user
         LEFT JOIN public.tb_profile pa ON pa.id_user = u.id_user AND pa.is_user_account = TRUE AND pa.deleted_at IS NULL
         JOIN public.tb_feed_bau_donation d ON d.id_bau = p.id_bau
        WHERE p.status = $1
        ORDER BY p.available_at
        LIMIT 200`,
      [status]
    );
    const sum = await pool.query(
      `SELECT
         COALESCE(SUM(net_cents) FILTER (WHERE status = 'aguardando'), 0) AS aguardando_cents,
         COALESCE(SUM(net_cents) FILTER (WHERE status = 'aprovado'), 0) AS aprovado_cents,
         COALESCE(SUM(net_cents) FILTER (WHERE status = 'pago'), 0) AS pago_cents
       FROM public.tb_feed_bau_payout`
    );
    return { items: items.rows, summary: sum.rows[0] };
  }

  static async adminMarkPaid(id_payout, note) {
    const id = Number(id_payout);
    if (!Number.isInteger(id)) return { error: "id_payout inválido" };
    const r = await pool.query(
      `UPDATE public.tb_feed_bau_payout
          SET status = 'pago', paid_out_at = NOW(), paid_out_note = $2, updated_at = NOW()
        WHERE id_payout = $1 AND status = 'aprovado' RETURNING *`,
      [id, note ? String(note).slice(0, 500) : null]
    );
    if (!r.rowCount) return { error: "Repasse não está liberado para pagamento", statusCode: 409 };
    return { payout: r.rows[0] };
  }
}

module.exports = FeedBauService;
