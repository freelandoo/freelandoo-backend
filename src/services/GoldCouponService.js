// A7 — cupom de desconto comprado com GOLD (mig 331).
//
// Comprar: 12 Gold (configurável) a cada R$ 10 de desconto, debitado da
// carteira de Gold na MESMA transação que cria o cupom. Esmeralda nunca compra
// cupom (não há caminho para isso).
//
// Usar: a compra em dinheiro recebe `gold_coupon_id` (um cupom do PRÓPRIO
// comprador). `prepare` reserva o cupom antes de abrir a cobrança, `bind`
// prende a reserva à sessão criada, `release` solta se a cobrança não nasceu
// ou expirou, e `redeem` marca como usado quando o pagamento é entregue
// (StripeWebhookService.fulfillCheckoutSession). Reserva vence em 3 h: uma
// cobrança abandonada não prende o cupom para sempre.
//
// Fluxos que aceitam hoje: function_purchase, premium, manifestation, xp_boost
// (receita da própria Freelandoo). Pacote de Gold NÃO aceita (cupom pago em
// Gold para comprar Gold). Venda de terceiros (loja, curso, agendamento) NÃO
// aceita: o desconto sairia do dinheiro do vendedor.
const crypto = require("crypto");
const pool = require("../databases");
const PolenStorage = require("../storages/PolenStorage");
const EmeraldStorage = require("../storages/EmeraldStorage");
const { couponGoldCost } = require("../utils/currency");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("GoldCouponService");
const FLOWS = Object.freeze(["function_purchase", "premium", "manifestation", "xp_boost"]);
const MAX_DISCOUNT_CENTS = 100000; // R$ 1.000 por cupom
const MIN_CHARGE_CENTS = 100;      // a cobrança com cupom fica em R$ 1,00 ou mais
const RESERVE = "3 hours";
const KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function publicCoupon(row) {
  if (!row) return null;
  const now = Date.now();
  return {
    id: row.id_coupon,
    code: row.code,
    discount_cents: Math.round(Number(row.value) || 0),
    gold_spent: row.gold_spent,
    created_at: row.created_at,
    redeemed_at: row.redeemed_at,
    status: row.redeemed_at
      ? "used"
      : row.reserved_until && new Date(row.reserved_until).getTime() > now
        ? "reserved"
        : "available",
  };
}

function newCode() {
  return `GOLD-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

class GoldCouponService {
  static FLOWS = FLOWS;

  /** Quanto custa: Gold a cada R$ 10. */
  static async quote() {
    const settings = await EmeraldStorage.getSettings(pool);
    return { gold_per_10_brl: Number(settings?.coupon_gold_per_10_brl) || 12, flows: FLOWS, max_discount_cents: MAX_DISCOUNT_CENTS };
  }

  static async listMine(user) {
    if (!user?.id_user) return { error: "Não autenticado" };
    const { rows } = await pool.query(
      `SELECT * FROM public.tb_coupon
        WHERE gold_owner_user_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [user.id_user]
    );
    const quote = await this.quote();
    return { coupons: rows.map(publicCoupon), ...quote };
  }

  /** Compra o cupom com Gold. body: { discount_cents (múltiplo de 1000), key }. */
  static async buy(user, body) {
    return runWithLogs(log, "buy", () => ({ id_user: user?.id_user, discount_cents: body?.discount_cents }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (body?.currency && String(body.currency).toLowerCase() !== "gold") {
        return { error: "Cupom só se compra com Gold", statusCode: 400 };
      }
      const discount = Number(body?.discount_cents);
      if (!Number.isInteger(discount) || discount <= 0 || discount > MAX_DISCOUNT_CENTS || discount % 1000 !== 0) {
        return { error: "Escolha um desconto em múltiplos de R$ 10 (até R$ 1.000)" };
      }
      const key = body?.key ? String(body.key) : crypto.randomUUID();
      if (!KEY_RE.test(key)) return { error: "Chave inválida" };
      const sourceId = `${user.id_user}:${key}`;

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const settings = await EmeraldStorage.getSettings(client);
        const cost = couponGoldCost(discount, Number(settings?.coupon_gold_per_10_brl) || 12);
        const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);
        // Replay (clique duplo): devolve o cupom já criado com a mesma chave.
        const prior = await client.query(
          `SELECT c.* FROM public.polen_transactions t
             JOIN public.tb_coupon c ON c.id_coupon::text = t.metadata->>'id_coupon'
            WHERE t.source = 'gold_coupon' AND t.source_id = $1 AND t.status = 'posted'
            LIMIT 1`,
          [sourceId]
        );
        if (prior.rows[0]) {
          await client.query("COMMIT");
          return { replay: true, coupon: publicCoupon(prior.rows[0]), wallet };
        }
        let coupon = null;
        for (let attempt = 0; attempt < 5 && !coupon; attempt++) {
          const { rows } = await client.query(
            `INSERT INTO public.tb_coupon
               (code, discount_type, scope, apply_mode, value, max_uses, is_active,
                gold_owner_user_id, gold_spent, created_by)
             VALUES ($1, 'amount', 'global', 'manual', $2, 1, TRUE, $3, $4, $3)
             ON CONFLICT (code) DO NOTHING
             RETURNING *`,
            [newCode(), discount, user.id_user, cost]
          );
          coupon = rows[0] || null;
        }
        if (!coupon) throw new Error("não gerou código único de cupom");
        const debit = await PolenStorage.debit(client, {
          user_id: user.id_user,
          wallet_id: wallet.id,
          amount: cost,
          type: "spend_gold_coupon",
          source: "gold_coupon",
          source_id: sourceId,
          metadata: { id_coupon: coupon.id_coupon, code: coupon.code, discount_cents: discount },
        });
        if (!debit) {
          await client.query("ROLLBACK");
          return { error: `Você precisa de ${cost} Gold para este cupom`, statusCode: 402, gold_cost: cost };
        }
        await client.query("COMMIT");
        return { replay: false, coupon: publicCoupon(coupon), wallet: debit.wallet, gold_cost: cost };
      } catch (err) {
        await client.query("ROLLBACK");
        if (err?.code === "23505") return { error: "Compra de cupom duplicada", statusCode: 409 };
        throw err;
      } finally {
        client.release();
      }
    });
  }

  /**
   * Reserva o cupom para uma cobrança que vai nascer. Sem `couponId` → null
   * (compra sem cupom). Devolve { error } ou { id, code, discount_cents, ref }.
   */
  static async prepare({ user_id, couponId, amount_cents, flow }) {
    if (!couponId) return null;
    if (!FLOWS.includes(flow)) return { error: "Esta compra não aceita cupom Gold" };
    if (!UUID_RE.test(String(couponId))) return { error: "Cupom inválido" };
    const ref = `pending:${crypto.randomUUID()}`;
    const { rows } = await pool.query(
      `UPDATE public.tb_coupon
          SET reserved_until = NOW() + INTERVAL '${RESERVE}', reserved_ref = $3, updated_at = NOW()
        WHERE id_coupon = $1
          AND gold_owner_user_id = $2
          AND is_active = TRUE
          AND redeemed_at IS NULL
          AND (expires_at IS NULL OR expires_at > NOW())
          AND (reserved_until IS NULL OR reserved_until < NOW())
        RETURNING *`,
      [couponId, user_id, ref]
    );
    const c = rows[0];
    if (!c) return { error: "Cupom indisponível (já usado, em outra compra aberta ou não é seu)" };
    const discount = Math.round(Number(c.value) || 0);
    if (Number(amount_cents) - discount < MIN_CHARGE_CENTS) {
      await this.release(c.id_coupon, ref);
      return { error: "O cupom é maior que esta compra" };
    }
    return { id: c.id_coupon, code: c.code, discount_cents: discount, ref };
  }

  /** Campos do cupom na metadata da cobrança (o webhook resgata por eles). */
  static meta(prep) {
    if (!prep || prep.error) return {};
    return { gold_coupon_id: String(prep.id), gold_coupon_discount_cents: String(prep.discount_cents) };
  }

  static async bind(prep, sessionId) {
    if (!prep || prep.error || !sessionId) return;
    await pool.query(
      `UPDATE public.tb_coupon SET reserved_ref = $3, updated_at = NOW()
        WHERE id_coupon = $1 AND reserved_ref = $2 AND redeemed_at IS NULL`,
      [prep.id, prep.ref, String(sessionId)]
    );
  }

  static async release(couponId, ref) {
    if (!couponId || !ref) return;
    await pool.query(
      `UPDATE public.tb_coupon SET reserved_until = NULL, reserved_ref = NULL, updated_at = NOW()
        WHERE id_coupon = $1 AND reserved_ref = $2 AND redeemed_at IS NULL`,
      [couponId, String(ref)]
    );
  }

  /** Pagamento entregue: o cupom vira usado (idempotente). */
  static async redeem(couponId, sessionId) {
    if (!couponId || !UUID_RE.test(String(couponId))) return null;
    const { rows } = await pool.query(
      `UPDATE public.tb_coupon
          SET redeemed_at = NOW(), redeemed_ref = $2, reserved_until = NULL, updated_at = NOW()
        WHERE id_coupon = $1 AND gold_owner_user_id IS NOT NULL AND redeemed_at IS NULL
        RETURNING id_coupon`,
      [couponId, String(sessionId)]
    );
    return rows[0] || null;
  }

  /**
   * Abre a cobrança com o cupom: reserva, chama `create(amount, meta)` com o
   * valor já descontado, prende a reserva à sessão e solta se der erro.
   */
  static async charge({ user_id, couponId, amount_cents, flow }, create) {
    const prep = await this.prepare({ user_id, couponId, amount_cents, flow });
    if (prep?.error) return { error: prep.error };
    const amount = prep ? Number(amount_cents) - prep.discount_cents : Number(amount_cents);
    try {
      const session = await create(amount, this.meta(prep));
      await this.bind(prep, session?.id);
      return { session, amount_cents: amount, coupon: prep ? { id: prep.id, code: prep.code, discount_cents: prep.discount_cents } : null };
    } catch (err) {
      if (prep) await this.release(prep.id, prep.ref);
      throw err;
    }
  }
}

module.exports = GoldCouponService;
