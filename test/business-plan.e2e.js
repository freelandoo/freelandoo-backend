/**
 * Suíte do PLANO NEGÓCIO (mig 234) — as três portas que o plano libera.
 *
 * ═══ O QUE ELA PROTEGE ═══
 *
 * O negócio (comunidade `common`) e o construtor do site são de todo mundo. O
 * que se paga é ter gente dentro, publicar o site e o atendente de IA:
 *
 *   1. `join` num negócio cujo líder NÃO assina → 402 (nem grátis, nem pago);
 *      com o plano do LÍDER ativo → entra. O gate é de quem RECEBE.
 *   2. `setPublished(true)` sem plano → 402; com plano → publica. DESPUBLICAR
 *      nunca é gateado (porta de saída).
 *   3. Ativar o plano ABRE a assinatura de Atendimento IA incluída (R$0, sem
 *      Stripe, marcada com `id_plan_subscription`); quem já PAGA o Atendimento
 *      IA não é tocado; o fim do plano derruba SÓ a incluída.
 *   4. A projeção da comunidade carrega `business_plan` lido do LÍDER — o que
 *      o visitante e o líder leem para saber o que está trancado.
 *
 * Transacional (BEGIN → ROLLBACK) como `plans.e2e.js`: pode rodar contra o
 * banco de produção sem deixar linha. O provisionamento do bot é DUBLADO —
 * ele agenda um push em `setImmediate`, que poderia correr depois do ROLLBACK.
 *
 * Uso: `npm run test:business-plan`
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  if (typeof cond === "function") {
    throw new Error(`check("${name}") recebeu função — passe o valor já avaliado.`);
  }
  if (cond) {
    pass += 1;
    console.log(`  ✓ ${name}`);
  } else {
    fail += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ""}`);
  }
}

async function main() {
  const url = (process.env.DATABASE_URL || "").split("?")[0];
  if (!url) throw new Error("DATABASE_URL ausente.");

  const client = new Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query("BEGIN");

  try {
    const pool = require("../src/databases");
    pool.query = (...args) => client.query(...args);
    // Os services de comunidade abrem transação própria com `pool.connect()`.
    // Dentro da NOSSA transação, o "client" deles é o mesmo cliente — e BEGIN/
    // COMMIT/ROLLBACK aninhados viram SAVEPOINTs para nada vazar.
    let depth = 0;
    pool.connect = async () => ({
      query: async (text, params) => {
        const t = String(text).trim().toUpperCase();
        if (t === "BEGIN") { depth += 1; return client.query(`SAVEPOINT svc_${depth}`); }
        if (t === "COMMIT") { const d = depth; depth -= 1; return client.query(`RELEASE SAVEPOINT svc_${d}`); }
        if (t === "ROLLBACK") { const d = depth; depth -= 1; return client.query(`ROLLBACK TO SAVEPOINT svc_${d}`); }
        return client.query(text, params);
      },
      release: () => {},
    });

    const AtendimentoIaProvisionService = require("../src/services/AtendimentoIaProvisionService");
    const provisionCalls = [];
    AtendimentoIaProvisionService.scheduleProvision = async (id_sub) => { provisionCalls.push(id_sub); };
    AtendimentoIaProvisionService.pushConfig = async () => ({ ok: true });
    AtendimentoIaProvisionService.pushDeprovision = async () => ({ ok: true });
    AtendimentoIaProvisionService.revokeConnections = async () => {};

    const PlanStorage = require("../src/storages/PlanStorage");
    const PlanService = require("../src/services/PlanService");
    const CommunityStorage = require("../src/storages/CommunityStorage");
    const CommunityService = require("../src/services/CommunityService");
    const CommunitySiteService = require("../src/services/CommunitySiteService");
    const CommunitySiteStorage = require("../src/storages/CommunitySiteStorage");
    const AtendimentoIaService = require("../src/services/AtendimentoIaService");
    const AtendimentoIaStorage = require("../src/storages/AtendimentoIaStorage");
    const { INCLUDED_AI_PLAN_NAME } = require("../src/utils/businessPlan");

    // ─── 1. Migrations ────────────────────────────────────────────────────
    console.log("\n[1] Migration 234");
    for (const f of ["225_plans.sql", "234_business_plan.sql"]) {
      const sql = fs.readFileSync(path.join(__dirname, "..", "src", "databases", "migrations", f), "utf8");
      await client.query(sql);
      await client.query(sql);
    }
    check("225 + 234 aplicadas duas vezes sem estourar", true);

    const included = await AtendimentoIaStorage.getPlanByName(pool, INCLUDED_AI_PLAN_NAME);
    check("plano de IA incluído existe", !!included);
    check("e NÃO está ativo (não aparece na vitrine nem aceita checkout)", included && included.is_active === false);
    check("e custa zero", included && Number(included.monthly_cents) === 0);
    const chk = await client.query(
      `SELECT conname FROM pg_constraint
        WHERE conname IN ('chk_atendimento_ia_plan_monthly_cents','chk_atendimento_ia_sub_monthly_cents')`
    );
    check("os dois CHECKs renomeados existem", chk.rowCount === 2, `n=${chk.rowCount}`);
    let negativoBarrado = null;
    await client.query("SAVEPOINT sp_neg");
    try {
      await client.query(
        `UPDATE public.tb_atendimento_ia_plan SET monthly_cents = -1 WHERE id_plan = $1`,
        [included.id_plan]
      );
    } catch (e) {
      negativoBarrado = e.constraint || null;
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_neg");
    check("preço negativo recusado PELO NOME da constraint", negativoBarrado === "chk_atendimento_ia_plan_monthly_cents", String(negativoBarrado));

    // ─── 2. Fixtures ──────────────────────────────────────────────────────
    const stamp = Date.now().toString(36);
    async function mkUser(tag) {
      const r = await client.query(
        `INSERT INTO public.tb_user (nome, email, senha, username, ativo)
              VALUES ($1, $2, 'x', $3, TRUE) RETURNING id_user`,
        [`User ${tag}`, `bp_${tag}_${stamp}@ex.com`, `bp_${tag}_${stamp}`]
      );
      return r.rows[0].id_user;
    }
    async function mkProfile(id_user, tag) {
      // O join exige "ao menos um perfil" — o perfil-conta basta.
      const cat = await client.query(`SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1`);
      const r = await client.query(
        `INSERT INTO public.tb_profile
              (id_user, id_category, display_name, sub_profile_slug, is_user_account, is_visible)
              VALUES ($1, $2, $3, $4, TRUE, FALSE) RETURNING id_profile`,
        [id_user, cat.rows[0].id_category, `Perfil ${tag}`, `bp-${tag}-${stamp}`]
      );
      return r.rows[0].id_profile;
    }
    const leader = await mkUser("leader");
    await mkProfile(leader, "leader");
    const visitor = await mkUser("visitor");
    await mkProfile(visitor, "visitor");
    const pagante = await mkUser("pagante");
    await mkProfile(pagante, "pagante");

    const machine = await client.query(`SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`);
    const community = await CommunityStorage.createCommunity(pool, {
      id_user: leader,
      id_machine: machine.rows[0].id_machine,
      display_name: `Negócio ${stamp}`,
      bio: null,
      avatar_url: null,
      theme: null,
      kind: "common",
      address: null,
    });
    const idc = community.id_profile;
    check("negócio criado SEM plano (criar é grátis)", !!idc);

    const plan = await PlanStorage.getPlanBySlug(pool, "profissional");

    // ─── 3. Sem plano: membro não entra, site não publica ─────────────────
    console.log("\n[3] Líder SEM plano");
    const proj0 = await CommunityService.getById({ id_profile: idc }, { id_user: visitor });
    check("projeção traz business_plan", !!proj0.community && !!proj0.community.business_plan);
    check(
      "as três portas trancadas",
      proj0.community.business_plan.members_enabled === false &&
        proj0.community.business_plan.site_share_enabled === false &&
        proj0.community.business_plan.ai_enabled === false
    );

    const join0 = await CommunityService.join({ id_user: visitor }, { id_profile: idc });
    check("join recusado com 402", join0.statusCode === 402, JSON.stringify(join0));
    check("a recusa nomeia o plano", /Negócio/.test(join0.error || ""), join0.error);
    const m0 = await CommunityStorage.getMembership(pool, idc, visitor);
    check("nenhuma membresia foi gravada", !m0);

    await CommunitySiteStorage.upsert(pool, idc, {
      siteName: "Site",
      tagline: "",
      theme: { primary: "#000000", background: "#ffffff", surface: "#eeeeee", text: "#000000" },
      sections: [],
    });
    const pub0 = await CommunitySiteService.setPublished({ id_user: leader }, { id_profile: idc }, { published: true });
    check("publicar recusado com 402", pub0.statusCode === 402, JSON.stringify(pub0));
    const site0 = await client.query(`SELECT is_published FROM public.tb_community_site WHERE id_profile = $1`, [idc]);
    check("site continua rascunho", site0.rows[0].is_published === false);
    const unpub0 = await CommunitySiteService.setPublished({ id_user: leader }, { id_profile: idc }, { published: false });
    check("DESPUBLICAR passa sem plano (porta de saída)", !unpub0.error, unpub0.error);

    // ─── 4. O líder assina ────────────────────────────────────────────────
    console.log("\n[4] Líder assina o Plano Negócio");
    const pending = await PlanStorage.createPending(pool, {
      id_user: leader,
      id_plan: plan.id_plan,
      price_cents: plan.price_cents,
      stripe_session_id: `cs_bp_${stamp}`,
    });
    const confirmed = await PlanService.confirmStripeSession({
      id: `cs_bp_${stamp}`,
      subscription: `sub_bp_${stamp}`,
      customer: `cus_bp_${stamp}`,
    });
    check("checkout confirmado ativa o plano", confirmed.activated === true, JSON.stringify(confirmed));

    const proj1 = await CommunityService.getById({ id_profile: idc }, { id_user: visitor });
    check(
      "as três portas abertas para o negócio dele",
      proj1.community.business_plan.members_enabled === true &&
        proj1.community.business_plan.site_share_enabled === true &&
        proj1.community.business_plan.ai_enabled === true
    );

    const join1 = await CommunityService.join({ id_user: visitor }, { id_profile: idc });
    check("visitante entra", join1.ok === true, JSON.stringify(join1));

    const pub1 = await CommunitySiteService.setPublished({ id_user: leader }, { id_profile: idc }, { published: true });
    check("site publica", pub1.is_published === true, JSON.stringify(pub1));
    check("e ganhou endereço", !!pub1.slug);

    // ─── 5. O atendente de IA incluído ────────────────────────────────────
    console.log("\n[5] Atendimento IA incluído");
    const ai = await AtendimentoIaStorage.getLiveSubByUser(pool, leader);
    check("assinatura de IA aberta junto com o plano", !!ai && ai.status === "active");
    check("marcada como incluída (id_plan_subscription)", ai && String(ai.id_plan_subscription) === String(pending.id_subscription));
    check("custa zero e não tem Stripe", ai && Number(ai.monthly_cents) === 0 && !ai.stripe_subscription_id);
    check("provisionamento agendado", provisionCalls.length === 1 && String(provisionCalls[0]) === String(ai.id_sub));

    // Renovação: a fatura nova empurra o ciclo, sem abrir segunda assinatura.
    const before = ai.current_period_start;
    await new Promise((r) => setTimeout(r, 20));
    const renewed = await PlanService.handleInvoicePaid(
      { id: `in_bp_${stamp}`, lines: { data: [{ period: { end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] } },
      `sub_bp_${stamp}`
    );
    check("renovação aplicada", renewed.renewed === true);
    const aiRenewed = await AtendimentoIaStorage.getLiveSubByUser(pool, leader);
    check("continua UMA assinatura de IA, a mesma", aiRenewed && Number(aiRenewed.id_sub) === Number(ai.id_sub));
    check("ciclo empurrado (zera a cota no bot)", new Date(aiRenewed.current_period_start) > new Date(before));
    check("não provisionou de novo", provisionCalls.length === 1);

    // Quem já PAGA o Atendimento IA não recebe a incluída.
    const paidPlan = (await AtendimentoIaStorage.listPlans(pool))[0];
    const paidSub = await AtendimentoIaStorage.createPendingSub(pool, {
      id_user: pagante,
      id_plan: paidPlan.id_plan,
      monthly_cents: Number(paidPlan.monthly_cents),
      token_limit_monthly: Number(paidPlan.token_limit_monthly),
    });
    await AtendimentoIaStorage.activateSub(pool, paidSub.id_sub, {
      stripe_subscription_id: `sub_ia_paid_${stamp}`,
      stripe_customer_id: null,
    });
    const sync = await AtendimentoIaService.syncIncluded(pagante, pending.id_subscription);
    check("assinante pagante do Atendimento IA é deixado em paz", sync.skipped === true && sync.reason === "paid_sub", JSON.stringify(sync));
    const stillPaid = await AtendimentoIaStorage.getLiveSubByUser(pool, pagante);
    check("a assinatura paga continua a mesma", stillPaid && Number(stillPaid.id_sub) === Number(paidSub.id_sub) && !stillPaid.id_plan_subscription);

    // ─── 6. O plano acaba ─────────────────────────────────────────────────
    console.log("\n[6] Fim do plano");
    const ended = await PlanService.handleSubscriptionDeleted({ id: `sub_bp_${stamp}` });
    check("plano encerrado", ended.canceled === true);
    const aiAfter = await AtendimentoIaStorage.getLiveSubByUser(pool, leader);
    check("a IA incluída caiu junto", !aiAfter);
    const paidAfter = await AtendimentoIaStorage.getLiveSubByUser(pool, pagante);
    check("a IA PAGA de outra pessoa não foi tocada", !!paidAfter);
    const proj2 = await CommunityService.getById({ id_profile: idc }, { id_user: visitor });
    check("portas trancam de novo", proj2.community.business_plan.members_enabled === false);
    const m2 = await CommunityStorage.getMembership(pool, idc, visitor);
    check("quem já entrou continua membro (perde a porta, não o que é dele)", !!m2);
    const site2 = await client.query(`SELECT is_published FROM public.tb_community_site WHERE id_profile = $1`, [idc]);
    check("site publicado continua no ar", site2.rows[0].is_published === true);
    const visitor2 = await mkUser("visitor2");
    await mkProfile(visitor2, "visitor2");
    const join2 = await CommunityService.join({ id_user: visitor2 }, { id_profile: idc });
    check("membro NOVO volta a ser recusado", join2.statusCode === 402);

    // ─── 7. Modalidade que não é negócio não passa pelo gate ──────────────
    console.log("\n[7] Fora do negócio");
    const proj3 = await CommunityService.getById({ id_profile: idc }, null);
    check("visitante anônimo também lê business_plan", !!proj3.community.business_plan);
    const gatesNoLeader = await PlanService.businessGates(null);
    check("plataforma sem líder: tudo trancado", gatesNoLeader.members_enabled === false);
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
