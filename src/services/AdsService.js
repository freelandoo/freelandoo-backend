// Freelandoo Ads — "Impulsionar" (mig 461). Ver o cabeçalho da migration.
//
//   estimate   público possível (contado de verdade) + visualizações e alcance
//   create     reserva crédito, abre o checkout (ou ativa na hora se o crédito
//              cobre tudo)
//   webhook    confirmar / expirar (devolve o crédito reservado) / estornar
//   feed       pickForViewer: campanhas da área do leitor, com limite por dia
//              por pessoa e ritmo (quem está atrasado vai antes)
//   eventos    impressão (na tela) e cliques (perfil / WhatsApp)
//   fim        meta batida, prazo, cancelada, post fora da régua: o que não foi
//              entregue vira crédito de anúncio (uma vez por campanha)
//
// A régua de quem vê é a do feed global: o post impulsionado passa por
// listEligibleByIds com o leitor (post de comunidade privada nunca vira anúncio).

const pool = require("../databases");
const PaymentGateway = require("../integrations/payments");
const PortfolioFeedStorage = require("../storages/PortfolioFeedStorage");
const { shapeRow } = require("./portfolioFeed/PortfolioFeedService");
const { isMinorUser } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AdsService");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIERS = ["cidade", "regiao", "estado", "brasil"];
const OBJECTIVES = ["views", "profile", "whatsapp"];
const AVG_FREQ = 1.6; // visualizações por pessoa, em média, para estimar alcance
const SWEEP_MS = 5 * 60_000;
const audienceCache = new Map();
let sweepTimer = null;

function notAuth() {
  return { error: "Usuário não autenticado", statusCode: 401 };
}

async function settings(db = pool) {
  const r = await db.query(`SELECT * FROM public.tb_ads_settings WHERE id = 1`);
  return r.rows[0];
}

function cpmFor(tier, s) {
  return Number(
    { cidade: s.cpm_city_cents, regiao: s.cpm_region_cents, estado: s.cpm_state_cents, brasil: s.cpm_brasil_cents }[tier]
  );
}

function goalFor(budget, cpm) {
  return Math.max(1, Math.floor((Number(budget) * 1000) / Number(cpm)));
}

/** Lugar congelado do post (mig 328) — de onde o "cidade/região/estado" parte. */
async function postPlace(db, id_portfolio_item) {
  const r = await db.query(
    `SELECT ppi.reach_city_key AS city_key, ppi.reach_city_name AS city_name, ppi.reach_region_id AS region_id,
            ppi.reach_uf AS uf, rg.name AS region_name, pro.id_user
       FROM public.tb_profile_portfolio_item ppi
       JOIN public.tb_profile pro ON pro.id_profile = ppi.id_profile
       LEFT JOIN public.tb_region rg ON rg.id_region = ppi.reach_region_id
      WHERE ppi.id_portfolio_item = $1`,
    [id_portfolio_item]
  );
  return r.rows[0] || null;
}

/** Quantas contas existem na área (o "público possível" do Meta). Cache 10 min. */
async function audienceSize(tier, place) {
  const key = `${tier}:${place.uf || ""}:${place.region_id || ""}:${place.city_key || ""}`;
  const hit = audienceCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.n;
  const r = await pool.query(
    `SELECT COUNT(*)::int AS n
       FROM public.tb_profile acc
       JOIN public.tb_user tu ON tu.id_user = acc.id_user AND tu.ativo = TRUE AND COALESCE(tu.is_minor, FALSE) = FALSE
       CROSS JOIN LATERAL fl_reach_place(acc.id_profile) pl
      WHERE acc.is_user_account = TRUE AND acc.deleted_at IS NULL
        AND (
          $1 = 'brasil'
          OR ($1 = 'estado' AND pl.uf = $2)
          OR ($1 = 'regiao' AND pl.region_id = $3)
          OR ($1 = 'cidade' AND pl.city_key = $4 AND pl.uf = $2)
        )`,
    [tier, place.uf, place.region_id, place.city_key]
  );
  const n = r.rows[0].n;
  audienceCache.set(key, { n, at: Date.now() });
  return n;
}

async function creditBalance(db, id_user) {
  const r = await db.query(`SELECT COALESCE(SUM(amount_cents), 0)::int AS c FROM public.tb_ads_credit WHERE id_user = $1`, [id_user]);
  return r.rows[0].c;
}

function publicCampaign(c) {
  return {
    id_campaign: c.id_campaign,
    post_id: c.id_portfolio_item,
    objective: c.objective,
    tier: c.tier,
    place: { city_name: c.city_name, uf: c.uf, region_name: c.region_name || null },
    budget_cents: c.budget_cents,
    credit_used_cents: c.credit_used_cents,
    paid_cents: c.paid_cents,
    cpm_cents: c.cpm_cents,
    goal_impressions: c.goal_impressions,
    days: c.days,
    status: c.status,
    start_at: c.start_at,
    end_at: c.end_at,
    impressions: c.impressions,
    reach: c.reach,
    clicks_profile: c.clicks_profile,
    clicks_whatsapp: c.clicks_whatsapp,
    spent_cents: Math.min(c.budget_cents, Math.round((c.impressions * c.cpm_cents) / 1000)),
    credited_back_cents: c.credited_back_cents,
    created_at: c.created_at,
    ended_at: c.ended_at,
    ended_reason: c.ended_reason,
    post: c.post || null,
  };
}

class AdsService {
  static TIERS = TIERS;

  static async config(user) {
    const s = await settings();
    return {
      tiers: TIERS.map((t) => ({ tier: t, cpm_cents: cpmFor(t, s) })),
      min_budget_cents: s.min_budget_cents,
      max_budget_cents: s.max_budget_cents,
      max_days: s.max_days,
      credit_cents: user?.id_user ? await creditBalance(pool, user.id_user) : 0,
    };
  }

  static async _validate(user, body) {
    if (!user?.id_user) return notAuth();
    if (await isMinorUser(user.id_user)) return { error: "Impulsionar não está disponível para contas de menores", statusCode: 403 };
    const post_id = String(body.post_id || "");
    if (!UUID_RE.test(post_id)) return { error: "Escolha o post" };
    const tier = TIERS.includes(body.tier) ? body.tier : null;
    if (!tier) return { error: "Escolha onde impulsionar" };
    const s = await settings();
    const budget = Math.round(Number(body.budget_cents));
    if (!Number.isFinite(budget) || budget < s.min_budget_cents) {
      return { error: `Orçamento mínimo de R$ ${(s.min_budget_cents / 100).toFixed(2).replace(".", ",")}` };
    }
    if (budget > s.max_budget_cents) return { error: "Orçamento acima do máximo" };
    const days = Math.round(Number(body.days));
    if (!Number.isFinite(days) || days < 1 || days > s.max_days) return { error: `Escolha de 1 a ${s.max_days} dias` };
    const place = await postPlace(pool, post_id);
    if (!place || place.id_user !== user.id_user) return { error: "Esse post não é seu", statusCode: 403 };
    if (tier !== "brasil" && !place.uf) return { error: "Esse post não tem lugar; impulsione para o Brasil", statusCode: 400 };
    if (tier === "cidade" && !place.city_key) return { error: "Esse post não tem cidade; escolha região, estado ou Brasil", statusCode: 400 };
    if (tier === "regiao" && !place.region_id) return { error: "Esse post não tem região; escolha estado ou Brasil", statusCode: 400 };
    const eligible = await PortfolioFeedStorage.listEligibleByIds(pool, { ids: [post_id] });
    if (!eligible.length) return { error: "Esse post não aparece no feed público, então não pode ser impulsionado", statusCode: 403 };
    const cpm = cpmFor(tier, s);
    return { post_id, tier, budget, days, place, cpm, goal: goalFor(budget, cpm), s, post: shapeRow(eligible[0]) };
  }

  /** O que o Meta mostra enquanto você mexe no orçamento. */
  static async estimate(user, query = {}) {
    const v = await AdsService._validate(user, query);
    if (v.error) return v;
    const audience = await audienceSize(v.tier, v.place);
    const people = Math.round(v.goal / AVG_FREQ);
    const cap = audience > 0 ? Math.min(people, audience) : people;
    return {
      cpm_cents: v.cpm,
      impressions: v.goal,
      reach_low: Math.max(1, Math.round(cap * 0.8)),
      reach_high: Math.max(1, Math.round(Math.min(audience || Infinity, people * 1.15))),
      audience,
      per_day: Math.ceil(v.goal / v.days),
      place: { city_name: v.place.city_name, uf: v.place.uf, region_name: v.place.region_name },
      saturated: audience > 0 && people > audience * 3,
    };
  }

  static async create(user, body = {}) {
    return runWithLogs(log, "create", () => ({ id_user: user?.id_user, tier: body?.tier }), async () => {
      const v = await AdsService._validate(user, body);
      if (v.error) return v;
      const objective = OBJECTIVES.includes(body.objective) ? body.objective : "views";
      if (objective === "whatsapp" && !v.post.whatsapp_url) {
        return { error: "Esse perfil não tem WhatsApp cadastrado; escolha outro objetivo" };
      }
      const open = await pool.query(
        `SELECT 1 FROM public.tb_ads_campaign WHERE id_portfolio_item = $1 AND status IN ('active', 'paused')`,
        [v.post_id]
      );
      if (open.rowCount) return { error: "Esse post já está sendo impulsionado", statusCode: 409 };
      const pending = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public.tb_ads_campaign
          WHERE id_user = $1 AND status = 'pending_payment' AND created_at > NOW() - INTERVAL '1 hour'`,
        [user.id_user]
      );
      if (pending.rows[0].n >= 10) return { error: "Muitas campanhas esperando pagamento. Termine uma antes.", statusCode: 429 };

      const client = await pool.connect();
      let campaign;
      let toPay;
      try {
        await client.query("BEGIN");
        // Trava o saldo do usuário enquanto reserva o crédito.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`ads-credit:${user.id_user}`]);
        const balance = await creditBalance(client, user.id_user);
        let creditUsed = Math.max(0, Math.min(balance, v.budget));
        toPay = v.budget - creditUsed;
        // O Mercado Pago não cobra menos de R$ 1.
        if (toPay > 0 && toPay < 100) {
          creditUsed = Math.max(0, v.budget - 100);
          toPay = v.budget - creditUsed;
        }
        const ins = await client.query(
          `INSERT INTO public.tb_ads_campaign
             (id_user, id_portfolio_item, objective, tier, city_key, city_name, region_id, uf,
              budget_cents, credit_used_cents, cpm_cents, goal_impressions, days)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            user.id_user, v.post_id, objective, v.tier,
            v.tier === "cidade" ? v.place.city_key : null,
            v.place.city_name || null,
            v.tier === "regiao" || v.tier === "cidade" ? v.place.region_id : null,
            v.tier === "brasil" ? null : v.place.uf,
            v.budget, creditUsed, v.cpm, v.goal, v.days,
          ]
        );
        campaign = ins.rows[0];
        if (creditUsed > 0) {
          await client.query(
            `INSERT INTO public.tb_ads_credit (id_user, amount_cents, reason, id_campaign) VALUES ($1, $2, 'spend', $3)`,
            [user.id_user, -creditUsed, campaign.id_campaign]
          );
        }
        if (toPay === 0) {
          await client.query(
            `UPDATE public.tb_ads_campaign SET status = 'active', start_at = NOW(), end_at = NOW() + make_interval(days => days)
              WHERE id_campaign = $1`,
            [campaign.id_campaign]
          );
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      if (toPay === 0) return { id_campaign: campaign.id_campaign, active: true };

      const frontend = String(process.env.FRONTEND_URL || "https://freelandoo.com.br").replace(/\/$/, "");
      const session = await PaymentGateway.createCheckout({
        amount_cents: toPay,
        currency: "BRL",
        productName: "Freelandoo Ads — impulsionar post",
        customerEmail: user.email || undefined,
        clientReferenceId: user.id_user,
        successUrl: `${frontend}/impulsionar/${campaign.id_campaign}?pago=1`,
        cancelUrl: `${frontend}/impulsionar/${campaign.id_campaign}?cancelado=1`,
        metadata: { type: "ads_impulso", id_campaign: campaign.id_campaign },
      });
      await pool.query(`UPDATE public.tb_ads_campaign SET session_id = $2 WHERE id_campaign = $1`, [campaign.id_campaign, session.id]);
      return { id_campaign: campaign.id_campaign, checkout_url: session.url };
    });
  }

  // ── webhook (regra 15) ────────────────────────────────────────────────────
  static async confirmStripeSession(session) {
    const meta = session?.metadata || {};
    if (meta.type !== "ads_impulso") return { ignored: true };
    const ref = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;
    // O valor cobrado é o que abrimos no checkout: orçamento − crédito usado
    // (não lemos amount_total: a unidade muda de provedor para provedor).
    const paid = null;
    const r = await pool.query(
      `UPDATE public.tb_ads_campaign
          SET status = 'active', start_at = NOW(), end_at = NOW() + make_interval(days => days),
              provider_ref = COALESCE($2, provider_ref), paid_cents = COALESCE($3, budget_cents - credit_used_cents),
              session_id = COALESCE(session_id, $4)
        WHERE (session_id = $4 OR id_campaign::text = $1) AND status = 'pending_payment'
        RETURNING id_campaign`,
      [String(meta.id_campaign || ""), ref, paid, session.id]
    );
    return r.rowCount ? { ok: true } : { ok: true, already: true };
  }

  static async expireBySession(session_id) {
    const r = await pool.query(
      `UPDATE public.tb_ads_campaign SET status = 'expired', ended_at = NOW(), ended_reason = 'checkout'
        WHERE session_id = $1 AND status = 'pending_payment' RETURNING id_campaign, id_user, credit_used_cents`,
      [session_id]
    );
    const c = r.rows[0];
    if (c && c.credit_used_cents > 0) {
      await pool.query(
        `INSERT INTO public.tb_ads_credit (id_user, amount_cents, reason, id_campaign) VALUES ($1, $2, 'restore', $3)
         ON CONFLICT DO NOTHING`,
        [c.id_user, c.credit_used_cents, c.id_campaign]
      );
    }
    return !!c;
  }

  /** Estorno do pagamento: para a entrega na hora. Não é nosso → null. */
  static async handleChargeRefunded(charge) {
    const refs = [typeof charge?.payment_intent === "string" ? charge.payment_intent : charge?.payment_intent?.id, charge?.id].filter(Boolean);
    if (!refs.length) return null;
    const r = await pool.query(
      `UPDATE public.tb_ads_campaign SET status = 'refunded', ended_at = NOW(), ended_reason = 'refund'
        WHERE provider_ref = ANY($1::text[]) AND status <> 'refunded' RETURNING id_campaign`,
      [refs]
    );
    return r.rowCount ? { reverted: true } : null;
  }

  // ── fim da campanha: o que não foi entregue vira crédito ──────────────────
  static async end(id_campaign, status, reason) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const c = (
        await client.query(
          `SELECT * FROM public.tb_ads_campaign WHERE id_campaign = $1 AND status IN ('active', 'paused') FOR UPDATE`,
          [id_campaign]
        )
      ).rows[0];
      if (!c) {
        await client.query("ROLLBACK");
        return null;
      }
      const delivered = Math.min(1, c.impressions / c.goal_impressions);
      const leftover = Math.max(0, Math.round(c.budget_cents * (1 - delivered)));
      if (leftover > 0) {
        await client.query(
          `INSERT INTO public.tb_ads_credit (id_user, amount_cents, reason, id_campaign) VALUES ($1, $2, 'leftover', $3)
           ON CONFLICT DO NOTHING`,
          [c.id_user, leftover, c.id_campaign]
        );
      }
      const up = await client.query(
        `UPDATE public.tb_ads_campaign SET status = $2, ended_at = NOW(), ended_reason = $3, credited_back_cents = $4
          WHERE id_campaign = $1 RETURNING *`,
        [id_campaign, status, reason, leftover]
      );
      await client.query("COMMIT");
      return up.rows[0];
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  static async act(user, id_campaign, action) {
    if (!user?.id_user) return notAuth();
    if (!UUID_RE.test(String(id_campaign || ""))) return { error: "Campanha inválida" };
    const c = (await pool.query(`SELECT * FROM public.tb_ads_campaign WHERE id_campaign = $1`, [id_campaign])).rows[0];
    if (!c || c.id_user !== user.id_user) return { error: "Campanha não encontrada", statusCode: 404 };
    if (action === "pause") {
      const r = await pool.query(`UPDATE public.tb_ads_campaign SET status = 'paused' WHERE id_campaign = $1 AND status = 'active' RETURNING id_campaign`, [id_campaign]);
      if (!r.rowCount) return { error: "Só dá para pausar campanha no ar", statusCode: 409 };
    } else if (action === "resume") {
      const r = await pool.query(
        `UPDATE public.tb_ads_campaign SET status = 'active' WHERE id_campaign = $1 AND status = 'paused' AND end_at > NOW() RETURNING id_campaign`,
        [id_campaign]
      );
      if (!r.rowCount) return { error: "Essa campanha não pode voltar", statusCode: 409 };
    } else if (action === "cancel") {
      const ended = await AdsService.end(id_campaign, "canceled", "owner");
      if (!ended) return { error: "Essa campanha não está no ar", statusCode: 409 };
    } else {
      return { error: "Ação inválida" };
    }
    return AdsService.detail(user, id_campaign);
  }

  static async sweep() {
    const goal = await pool.query(
      `SELECT id_campaign FROM public.tb_ads_campaign WHERE status IN ('active', 'paused') AND impressions >= goal_impressions`
    );
    for (const r of goal.rows) await AdsService.end(r.id_campaign, "completed", "goal");
    const time = await pool.query(
      `SELECT id_campaign FROM public.tb_ads_campaign WHERE status IN ('active', 'paused') AND end_at <= NOW()`
    );
    for (const r of time.rows) await AdsService.end(r.id_campaign, "completed", "time");
    // Post que saiu da régua (banido, ficou privado, apagado): sai do ar com crédito.
    const live = await pool.query(`SELECT id_campaign, id_portfolio_item FROM public.tb_ads_campaign WHERE status IN ('active', 'paused')`);
    if (live.rows.length) {
      const ok = new Set(
        (await PortfolioFeedStorage.listEligibleByIds(pool, { ids: live.rows.map((x) => x.id_portfolio_item) })).map((x) => x.post_id)
      );
      for (const r of live.rows) if (!ok.has(r.id_portfolio_item)) await AdsService.end(r.id_campaign, "rejected", "post");
    }
    return { goal: goal.rowCount, time: time.rowCount };
  }

  static startSweeper() {
    if (sweepTimer) return;
    const tick = () => AdsService.sweep().catch((err) => log.warn("ads.sweep_fail", { message: err?.message }));
    sweepTimer = setInterval(tick, SWEEP_MS);
    sweepTimer.unref?.();
    setTimeout(tick, 30_000).unref?.();
  }

  // ── feed ──────────────────────────────────────────────────────────────────
  /**
   * Até `count` posts impulsionados para ESTE leitor (logado, adulto, na área),
   * fora dos que já estão na página. Já no shape do card + `sponsored`.
   */
  static async pickForViewer({ viewer_id, place, excludeIds = [], count = 2 }) {
    if (!viewer_id || count <= 0) return [];
    try {
      const s = await settings();
      const r = await pool.query(
        `SELECT c.id_campaign, c.id_portfolio_item, c.objective
           FROM public.tb_ads_campaign c
           JOIN public.tb_user v ON v.id_user = $1 AND COALESCE(v.is_minor, FALSE) = FALSE
          WHERE c.status = 'active' AND c.end_at > NOW() AND c.impressions < c.goal_impressions
            AND c.id_user <> $1
            AND (
              c.tier = 'brasil'
              OR (c.tier = 'estado' AND c.uf = $2)
              OR (c.tier = 'regiao' AND c.region_id = $3)
              OR (c.tier = 'cidade' AND c.city_key = $4 AND c.uf = $2)
            )
            AND NOT (c.id_portfolio_item = ANY($5::uuid[]))
            AND NOT EXISTS (
              SELECT 1 FROM public.tb_ads_reach r
               WHERE r.id_campaign = c.id_campaign AND r.id_user = $1 AND r.day = CURRENT_DATE AND r.day_count >= $6)
            AND NOT EXISTS (
              SELECT 1 FROM public.tb_user_block ub
               WHERE (ub.blocker_user_id = c.id_user AND ub.blocked_user_id = $1)
                  OR (ub.blocker_user_id = $1 AND ub.blocked_user_id = c.id_user))
            AND COALESCE((SELECT d.impressions FROM public.tb_ads_daily d WHERE d.id_campaign = c.id_campaign AND d.day = CURRENT_DATE), 0)
                < CEIL(c.goal_impressions::numeric / c.days * 1.5)
          ORDER BY
            (c.impressions::numeric / c.goal_impressions)
              - LEAST(1, EXTRACT(EPOCH FROM (NOW() - c.start_at)) / GREATEST(1, EXTRACT(EPOCH FROM (c.end_at - c.start_at)))) ASC,
            random()
          LIMIT $7`,
        [viewer_id, place?.uf || null, place?.region_id || null, place?.city_key || null, excludeIds.filter((x) => UUID_RE.test(String(x))), s.freq_cap_day, count]
      );
      if (!r.rows.length) return [];
      const rows = await PortfolioFeedStorage.listEligibleByIds(pool, { ids: r.rows.map((x) => x.id_portfolio_item), viewer_id_user: viewer_id });
      const byPost = new Map(rows.map((x) => [x.post_id, x]));
      return r.rows
        .filter((c) => byPost.has(c.id_portfolio_item))
        .map((c) => ({ ...shapeRow(byPost.get(c.id_portfolio_item)), sponsored: { id_campaign: c.id_campaign, objective: c.objective } }));
    } catch (err) {
      log.warn("ads.pick_fail", { message: err?.message });
      return [];
    }
  }

  static async slotEvery() {
    const s = await settings();
    return Number(s.slot_every) || 6;
  }

  /** Impressão (card na tela) ou clique. Conta uma por pessoa por vez, até a meta. */
  static async recordEvent(user, body = {}) {
    if (!user?.id_user) return notAuth();
    const id = String(body.id_campaign || "");
    if (!UUID_RE.test(id)) return { error: "Campanha inválida" };
    const type = ["impression", "profile", "whatsapp"].includes(body.type) ? body.type : null;
    if (!type) return { error: "Evento inválido" };
    const s = await settings();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const c = (
        await client.query(`SELECT id_campaign, id_user, status, impressions, goal_impressions FROM public.tb_ads_campaign WHERE id_campaign = $1 FOR UPDATE`, [id])
      ).rows[0];
      if (!c || c.id_user === user.id_user) {
        await client.query("ROLLBACK");
        return { ok: true, counted: false };
      }
      if (type === "impression") {
        if (c.status !== "active" || c.impressions >= c.goal_impressions) {
          await client.query("ROLLBACK");
          return { ok: true, counted: false };
        }
        const prev = (
          await client.query(`SELECT day, day_count FROM public.tb_ads_reach WHERE id_campaign = $1 AND id_user = $2 FOR UPDATE`, [id, user.id_user])
        ).rows[0];
        const today = (await client.query(`SELECT CURRENT_DATE AS d`)).rows[0].d;
        const sameDay = prev && String(prev.day) === String(today);
        if (sameDay && prev.day_count >= s.freq_cap_day) {
          await client.query("ROLLBACK");
          return { ok: true, counted: false };
        }
        await client.query(
          `INSERT INTO public.tb_ads_reach (id_campaign, id_user, day, day_count, total)
           VALUES ($1, $2, CURRENT_DATE, 1, 1)
           ON CONFLICT (id_campaign, id_user) DO UPDATE
              SET day_count = CASE WHEN tb_ads_reach.day = CURRENT_DATE THEN tb_ads_reach.day_count + 1 ELSE 1 END,
                  day = CURRENT_DATE, total = tb_ads_reach.total + 1, last_at = NOW()`,
          [id, user.id_user]
        );
        await client.query(
          `UPDATE public.tb_ads_campaign SET impressions = impressions + 1, reach = reach + $2 WHERE id_campaign = $1`,
          [id, prev ? 0 : 1]
        );
        await client.query(
          `INSERT INTO public.tb_ads_daily (id_campaign, day, impressions) VALUES ($1, CURRENT_DATE, 1)
           ON CONFLICT (id_campaign, day) DO UPDATE SET impressions = tb_ads_daily.impressions + 1`,
          [id]
        );
        await client.query("COMMIT");
        if (c.impressions + 1 >= c.goal_impressions) AdsService.end(id, "completed", "goal").catch(() => {});
        return { ok: true, counted: true };
      }
      // clique: só de quem viu, uma vez por pessoa
      const seen = await client.query(
        `UPDATE public.tb_ads_reach SET clicked = TRUE WHERE id_campaign = $1 AND id_user = $2 AND clicked = FALSE RETURNING id_user`,
        [id, user.id_user]
      );
      if (!seen.rowCount) {
        await client.query("ROLLBACK");
        return { ok: true, counted: false };
      }
      const col = type === "profile" ? "clicks_profile" : "clicks_whatsapp";
      await client.query(`UPDATE public.tb_ads_campaign SET ${col} = ${col} + 1 WHERE id_campaign = $1`, [id]);
      await client.query(
        `INSERT INTO public.tb_ads_daily (id_campaign, day, clicks) VALUES ($1, CURRENT_DATE, 1)
         ON CONFLICT (id_campaign, day) DO UPDATE SET clicks = tb_ads_daily.clicks + 1`,
        [id]
      );
      await client.query("COMMIT");
      return { ok: true, counted: true };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  // ── painel ────────────────────────────────────────────────────────────────
  static async listMine(user) {
    if (!user?.id_user) return notAuth();
    const r = await pool.query(
      `SELECT c.*, rg.name AS region_name FROM public.tb_ads_campaign c
         LEFT JOIN public.tb_region rg ON rg.id_region = c.region_id
        WHERE c.id_user = $1 AND c.status <> 'expired'
        ORDER BY (c.status IN ('active', 'paused')) DESC, c.created_at DESC LIMIT 100`,
      [user.id_user]
    );
    const ids = [...new Set(r.rows.map((x) => x.id_portfolio_item))];
    const media = ids.length
      ? await pool.query(
          `SELECT DISTINCT ON (i.id_portfolio_item) i.id_portfolio_item, m.media_url, m.media_type, m.thumbnail_url, i.title
             FROM public.tb_profile_portfolio_item i
             LEFT JOIN public.tb_profile_portfolio_media m ON m.id_portfolio_item = i.id_portfolio_item AND m.is_active
            WHERE i.id_portfolio_item = ANY($1::uuid[])
            ORDER BY i.id_portfolio_item, m.sort_order NULLS LAST`,
          [ids]
        ).catch(() => ({ rows: [] }))
      : { rows: [] };
    const thumbs = new Map(media.rows.map((m) => [m.id_portfolio_item, m]));
    const totals = r.rows.reduce(
      (a, c) => ({
        impressions: a.impressions + c.impressions,
        reach: a.reach + c.reach,
        clicks: a.clicks + c.clicks_profile + c.clicks_whatsapp,
        spent_cents: a.spent_cents + Math.min(c.budget_cents, Math.round((c.impressions * c.cpm_cents) / 1000)),
        live: a.live + (c.status === "active" ? 1 : 0),
      }),
      { impressions: 0, reach: 0, clicks: 0, spent_cents: 0, live: 0 }
    );
    return {
      campaigns: r.rows.map((c) => {
        const m = thumbs.get(c.id_portfolio_item);
        return publicCampaign({
          ...c,
          post: m ? { title: m.title, thumb: m.media_type === "video" ? m.thumbnail_url : m.media_url } : null,
        });
      }),
      totals,
      credit_cents: await creditBalance(pool, user.id_user),
    };
  }

  static async detail(user, id_campaign) {
    if (!user?.id_user) return notAuth();
    if (!UUID_RE.test(String(id_campaign || ""))) return { error: "Campanha inválida" };
    const c = (
      await pool.query(
        `SELECT c.*, rg.name AS region_name FROM public.tb_ads_campaign c
           LEFT JOIN public.tb_region rg ON rg.id_region = c.region_id WHERE c.id_campaign = $1`,
        [id_campaign]
      )
    ).rows[0];
    if (!c || c.id_user !== user.id_user) return { error: "Campanha não encontrada", statusCode: 404 };
    const daily = await pool.query(
      `SELECT day, impressions, clicks FROM public.tb_ads_daily WHERE id_campaign = $1 ORDER BY day`,
      [id_campaign]
    );
    const rows = await PortfolioFeedStorage.listEligibleByIds(pool, { ids: [c.id_portfolio_item], viewer_id_user: user.id_user });
    return {
      campaign: publicCampaign({ ...c, post: rows[0] ? shapeRow(rows[0]) : null }),
      daily: daily.rows.map((d) => ({ day: d.day, impressions: d.impressions, clicks: d.clicks })),
      credit_cents: await creditBalance(pool, user.id_user),
    };
  }
}

module.exports = AdsService;
