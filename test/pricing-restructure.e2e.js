// test/pricing-restructure.e2e.js
// A tabela de preços nova (mig 263): Plano Site anual, Site Autoral pago no
// pedido, atendente de IA com camada grátis de 2 pessoas por dia.
//
// ⚠️ Roda DENTRO DE UMA TRANSAÇÃO COM ROLLBACK — é o que permite apontar para
// produção. Não existe `COMMIT` neste arquivo.
//
//   node test/pricing-restructure.e2e.js
require("dotenv").config({ quiet: true });
const DB_URL = String(process.env.DATABASE_URL || "").replace(/sslmode=[a-z-]+/, "sslmode=no-verify");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
// ⚠️ O pool do app NÃO é criado: os storages recebem a conexão por parâmetro, e
// um pool de pé abriria conexões próprias contra produção à toa. O módulo é
// trocado no require.cache antes do primeiro require que o puxaria.
require.cache[require.resolve("../src/databases")] = { exports: {} };

const PlanStorage = require("../src/storages/PlanStorage");
const ManagedSiteRequestStorage = require("../src/storages/ManagedSiteRequestStorage");
const aiQuota = require("../src/utils/aiQuota");
const CommunitySite = require("../src/utils/communitySite");

const MIG = path.join(__dirname, "../src/databases/migrations/263_pricing_restructure.sql");

let pass = 0;
let fail = 0;
async function check(name, fn) {
  try {
    const ok = await fn();
    if (ok !== true) throw new Error(`devolveu ${JSON.stringify(ok)}`);
    pass++;
    console.log(`  ok  ${name}`);
  } catch (e) {
    fail++;
    console.log(`  XX  ${name} — ${e.message}`);
  }
}

(async () => {
  const c = new Client({ connectionString: DB_URL, connectionTimeoutMillis: 45000 });
  await c.connect();
  const sql = fs.readFileSync(MIG, "utf8");

  const before = await c.query(`SELECT COUNT(*)::int AS n FROM public.tb_plan WHERE slug = 'site'`);

  await c.query("BEGIN");
  try {
    await c.query(sql);
    await check("a migration roda de novo sem erro (idempotente)", async () => {
      await c.query(sql);
      const r = await c.query(`SELECT COUNT(*)::int AS n FROM public.tb_plan WHERE slug = 'site'`);
      return r.rows[0].n === 1;
    });

    // ─── planos ──────────────────────────────────────────────────────────────
    const plans = await PlanStorage.listPlans(c, { onlyActive: false });
    const bySlug = Object.fromEntries(plans.map((p) => [p.slug, p]));

    await check("o Plano Negócio saiu de linha", async () => bySlug.profissional?.is_active === false);
    await check("Plano Site: R$49, anual, só site_share", async () => {
      const p = bySlug.site;
      return (
        p && p.is_active && p.price_cents === 4900 && p.billing_interval_months === 12 &&
        JSON.stringify(p.features) === JSON.stringify(["site_share"])
      );
    });
    await check("Site Autoral: R$29/mês + R$299 de criação, site_share e managed_site", async () => {
      const p = bySlug["site-freelandoo"];
      return (
        p && p.price_cents === 2900 && p.setup_fee_cents === 29900 &&
        p.billing_interval_months === 1 &&
        JSON.stringify(p.features) === JSON.stringify(["managed_site", "site_share"])
      );
    });
    await check("a recusa do Publicar aponta o plano de R$49, não o autoral", async () => {
      const active = await PlanStorage.listPlans(c, { onlyActive: true });
      const first = active.find((p) => p.features.includes("site_share"));
      return first?.slug === "site";
    });

    const inPlan = new Set(await PlanStorage.featureKeysInAnyPlan(c));
    for (const key of ["community_members", "agenda", "whatsapp", "atendimento_ia"]) {
      await check(`"${key}" não é mais de plano (vira grátis)`, async () => !inPlan.has(key));
    }
    await check("site_share continua de plano (é o que se paga)", async () => inPlan.has("site_share"));

    // ─── atendente de IA ─────────────────────────────────────────────────────
    const aiPlans = (await c.query(
      `SELECT name, monthly_cents, reply_limit_monthly FROM public.tb_atendimento_ia_plan WHERE is_active`
    )).rows;
    const ai = Object.fromEntries(aiPlans.map((p) => [p.name, p]));
    await check("IA: R$29 / R$59 / R$99 com cota de respostas", async () =>
      ai["Básico"]?.monthly_cents === 2900 && ai["Básico"]?.reply_limit_monthly === 300 &&
      ai["Profissional"]?.monthly_cents === 5900 && ai["Profissional"]?.reply_limit_monthly === 1000 &&
      ai["Turbo"]?.monthly_cents === 9900 && ai["Turbo"]?.reply_limit_monthly === 3000
    );
    await check("nenhuma assinatura 'incluída' continua viva", async () => {
      const r = await c.query(
        `SELECT COUNT(*)::int AS n FROM public.tb_atendimento_ia_sub
          WHERE id_plan_subscription IS NOT NULL AND status IN ('active','past_due','pending')`
      );
      return r.rows[0].n === 0;
    });
    await check("a venda da IA está ligada", async () => {
      const r = await c.query(`SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key = 'atendimento_ia_venda'`);
      return r.rows[0]?.is_enabled === true;
    });

    // Um usuário qualquer, só para os INSERTs — tudo some no ROLLBACK.
    const u = (await c.query(`SELECT id_user FROM public.tb_user ORDER BY created_at LIMIT 1`)).rows[0].id_user;
    await c.query(`DELETE FROM public.tb_ai_reply_job WHERE id_user = $1`, [u]);
    await c.query(
      `UPDATE public.tb_atendimento_ia_sub SET status = 'canceled' WHERE id_user = $1 AND status IN ('active','past_due')`,
      [u]
    );

    const done = (channel, ref, trig) =>
      c.query(
        `INSERT INTO public.tb_ai_reply_job (id_user, channel, ref_id, trigger_message_id, status, updated_at)
         VALUES ($1, $2, $3, $4, 'done', NOW())`,
        [u, channel, ref, trig]
      );

    await check("grátis: sem ninguém atendido, pode responder", async () =>
      (await aiQuota.canReply(c, u, "dm", "conv-a")).allowed === true
    );
    await done("dm", "conv-a", "t-test-1");
    await done("dm", "conv-a", "t-test-2");
    await done("whatsapp", "conv-b", "t-test-3");
    await check("grátis: 2 pessoas contadas (a mesma conversa conta uma vez)", async () => {
      const s = await aiQuota.getStatus(c, u);
      return s.tier === "free" && s.used === 2 && s.limit === 2;
    });
    await check("grátis: a 3ª pessoa do dia é recusada", async () =>
      (await aiQuota.canReply(c, u, "os", "conv-c")).allowed === false
    );
    await check("grátis: quem já foi atendido hoje continua sendo atendido", async () =>
      (await aiQuota.canReply(c, u, "dm", "conv-a")).allowed === true
    );
    await check("grátis: trabalho pulado não gasta vaga", async () => {
      await c.query(
        `INSERT INTO public.tb_ai_reply_job (id_user, channel, ref_id, trigger_message_id, status)
         VALUES ($1, 'os', 'conv-d', 't-test-4', 'skipped')`,
        [u]
      );
      return (await aiQuota.getStatus(c, u)).used === 2;
    });
    await check("grátis: resposta de ONTEM não conta hoje", async () => {
      await c.query(
        `INSERT INTO public.tb_ai_reply_job (id_user, channel, ref_id, trigger_message_id, status, updated_at)
         VALUES ($1, 'os', 'conv-old', 't-test-5', 'done', NOW() - INTERVAL '2 days')`,
        [u]
      );
      return (await aiQuota.getStatus(c, u)).used === 2;
    });

    const basico = (await c.query(`SELECT id_plan FROM public.tb_atendimento_ia_plan WHERE name = 'Básico'`)).rows[0];
    await c.query(
      `INSERT INTO public.tb_atendimento_ia_sub
         (id_user, id_plan, monthly_cents, token_limit_monthly, reply_limit_monthly, status, current_period_start, activated_at)
       VALUES ($1, $2, 2900, 300000, 3, 'active', NOW() - INTERVAL '1 day', NOW() - INTERVAL '1 day')`,
      [u, basico.id_plan]
    );
    await check("pago: conta respostas do ciclo, não pessoas", async () => {
      const s = await aiQuota.getStatus(c, u);
      return s.tier === "paid" && s.used === 3 && s.limit === 3;
    });
    await check("pago: cota esgotada recusa até a conversa já atendida", async () =>
      (await aiQuota.canReply(c, u, "dm", "conv-a")).allowed === false
    );

    await check("o aviso de cota cabe no CHECK de notificação", async () => {
      await c.query(
        `INSERT INTO public.tb_notification (id_recipient_user, type, entity_type, payload)
         VALUES ($1, 'ai_quota_reached', 'atendimento_ai', '{"tier":"free","limit":2}'::jsonb)`,
        [u]
      );
      return await aiQuota.alreadyWarnedToday(c, u);
    });

    // ─── pedido pago do site autoral ─────────────────────────────────────────
    const comm = (await c.query(
      `SELECT id_profile FROM public.tb_profile WHERE is_community = TRUE AND deleted_at IS NULL LIMIT 1`
    )).rows[0].id_profile;
    await c.query(`DELETE FROM public.tb_managed_site_request WHERE id_profile = $1`, [comm]);

    const r1 = await ManagedSiteRequestStorage.openAwaitingPayment(c, {
      id_profile: comm, requestedBy: u, note: "primeira", setup_cents: 29900,
    });
    const r2 = await ManagedSiteRequestStorage.openAwaitingPayment(c, {
      id_profile: comm, requestedBy: u, note: "segunda", setup_cents: 29900,
    });
    await check("o 2º clique reaproveita o pedido aguardando pagamento", async () =>
      r1 && r2 && r1.id_request === r2.id_request && r2.note === "segunda" && r2.status === "awaiting_payment"
    );
    await check("pedido não pago não aparece na fila", async () =>
      (await ManagedSiteRequestStorage.getPending(c, comm)) === null
    );
    await ManagedSiteRequestStorage.setSession(c, r1.id_request, "sess-test-263");
    const paid = await ManagedSiteRequestStorage.markPaid(c, r1.id_request, "pay-test-263");
    await check("pagou: o pedido entra na fila", async () =>
      paid?.status === "pending" && (await ManagedSiteRequestStorage.getPending(c, comm))?.id_request === r1.id_request
    );
    await check("re-entrega do webhook não faz nada", async () =>
      (await ManagedSiteRequestStorage.markPaid(c, r1.id_request, "pay-test-263")) === null
    );
    await check("o webhook acha o pedido pela sessão e pelo pagamento", async () =>
      (await ManagedSiteRequestStorage.getBySession(c, "sess-test-263"))?.id_request === r1.id_request &&
      (await ManagedSiteRequestStorage.getByPaymentRef(c, "pay-test-263"))?.id_request === r1.id_request
    );
    await ManagedSiteRequestStorage.markRefunded(c, r1.id_request);
    await check("estorno tira o pedido da fila", async () => {
      const row = await ManagedSiteRequestStorage.getByPaymentRef(c, "pay-test-263");
      return row.status === "dismissed" && !!row.refunded_at;
    });

    // ─── a seção Loja ────────────────────────────────────────────────────────
    await check("store_catalog é uma seção válida e sobrevive à normalização", async () => {
      const cfg = CommunitySite.normalizeConfig({
        sections: [{ id: "s1", kind: "store_catalog", enabled: true, title: "Loja", data: { columns: 4 } }],
      });
      const s = (cfg.sections || [])[0];
      return !!s && s.kind === "store_catalog" && s.data.columns === 4;
    });
  } finally {
    await c.query("ROLLBACK");
  }

  const after = await c.query(`SELECT COUNT(*)::int AS n FROM public.tb_plan WHERE slug = 'site'`);
  await check("produção intocada depois do ROLLBACK", async () => after.rows[0].n === before.rows[0].n);
  await c.end();

  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
