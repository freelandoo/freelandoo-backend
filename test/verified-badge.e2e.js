/**
 * SELO VERIFICADO (mig 268) — contra o Postgres dentro de transação com
 * ROLLBACK. Seguro para apontar para produção PORQUE NÃO EXISTE `COMMIT` NESTE
 * ARQUIVO.
 *
 *   node test/verified-badge.e2e.js
 *
 * Confere: a migration (idempotente), o selo lazy por data, o selo do admin
 * pelo PAPEL, a renovação deduplicada pela fatura, o estorno que devolve o mês
 * sem dar 30 dias de graça, e as QUATRO projeções que mostram o selo (perfil,
 * feed, vitrine e /users/me) rodando sem erro de SQL.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/268_verified_badge.sql");
const Storage = require(path.join(BE, "src/storages/VerificationStorage"));
const ProfileStorage = require(path.join(BE, "src/storages/ProfileStorage"));
const UserStorage = require(path.join(BE, "src/storages/UserStorage"));
const SearchStorage = require(path.join(BE, "src/storages/SearchStorage"));
const FeedStorage = require(path.join(BE, "src/storages/PortfolioFeedStorage"));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond === true) {
    pass++;
    console.log("  ok  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name + (extra ? " -> " + extra : typeof cond !== "boolean" ? " (nao-booleano)" : ""));
  }
}

async function attempt(c, fn) {
  const sp = "sp_" + Math.random().toString(36).slice(2, 10);
  await c.query("SAVEPOINT " + sp);
  try {
    const value = await fn();
    await c.query("RELEASE SAVEPOINT " + sp);
    return { ok: true, value };
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT " + sp);
    await c.query("RELEASE SAVEPOINT " + sp);
    return { ok: false, error: err };
  }
}

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();

  const antes = (
    await c.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'tb_%verification%'`
    )
  ).rows[0].n;

  await c.query("BEGIN");
  try {
    const sql = fs.readFileSync(MIG, "utf8");
    await c.query(sql);
    await c.query(sql);
    check("mig 268 aplica duas vezes (idempotente)", true);

    const settings = await Storage.getSettings(c);
    check("preço nasce em R$9,90", settings.monthly_cents === 990, JSON.stringify(settings));
    const flag = (await c.query(`SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key='selo_verificado'`)).rows[0];
    check("flag selo_verificado nasce ligada", flag?.is_enabled === true);

    // Um usuário comum (sem papel de admin) e um admin de verdade.
    const comum = (
      await c.query(
        `SELECT u.id_user FROM public.tb_user u
          WHERE NOT EXISTS (
            SELECT 1 FROM public.tb_user_role ur JOIN public.tb_role r ON r.id_role = ur.id_role
             WHERE ur.id_user = u.id_user AND r.desc_role = 'Administrator')
            AND EXISTS (SELECT 1 FROM public.tb_profile p WHERE p.id_user = u.id_user AND p.deleted_at IS NULL)
          LIMIT 1`
      )
    ).rows[0].id_user;
    const admin = (
      await c.query(
        `SELECT ur.id_user FROM public.tb_user_role ur JOIN public.tb_role r ON r.id_role = ur.id_role
          WHERE r.desc_role = 'Administrator' AND ur.is_active = TRUE AND r.is_active = TRUE LIMIT 1`
      )
    ).rows[0]?.id_user;

    let st = await Storage.getStatus(c, comum);
    check("usuário comum nasce SEM selo", st.is_verified === false);

    st = await Storage.getStatus(c, admin);
    check("admin tem o selo pelo PAPEL, sem linha paga", st.is_verified === true && st.is_admin === true && !st.paid_until);

    // Primeiro mês.
    const pay = await Storage.createPayment(c, {
      id_user: comum, method: "pix", payment_provider: "mercadopago", amount_cents: 990,
      stripe_session_id: "test_sess_" + Date.now(),
    });
    const paid = await Storage.markPaymentPaid(c, pay.stripe_session_id, "pi_test_" + Date.now());
    check("pagamento marca pago", paid?.status === "paid");
    const repeat = await Storage.markPaymentPaid(c, pay.stripe_session_id, null);
    check("re-entrega do webhook não confirma de novo", repeat === null);
    const live = await Storage.extendPaidUntil(c, comum, 1);
    st = await Storage.getStatus(c, comum);
    check("pagou → selo aceso", st.is_verified === true);
    const dias = (new Date(live.paid_until) - Date.now()) / 86400000;
    check("vigência de ~1 mês", dias > 27 && dias < 32, String(dias));

    // Renovação no meio do mês SOMA (GREATEST), não recomeça do zero.
    const live2 = await Storage.extendPaidUntil(c, comum, 1);
    const dias2 = (new Date(live2.paid_until) - Date.now()) / 86400000;
    check("renovar antes de vencer soma o mês (não perde o que falta)", dias2 > 56 && dias2 < 63, String(dias2));

    // Dedupe da fatura.
    await Storage.attachSubscription(c, comum, { ref: "sub_test_x", provider: "mercadopago", status: "active" });
    const r1 = await Storage.recordRenewalOnce(c, { id_user: comum, amount_cents: 990, invoice_ref: "inv_test_1" });
    const r2 = await Storage.recordRenewalOnce(c, { id_user: comum, amount_cents: 990, invoice_ref: "inv_test_1" });
    check("a mesma fatura não é registrada duas vezes", !!r1 && r2 === null);
    const bySub = await Storage.getBySubscriptionRef(c, "sub_test_x");
    check("a renovação acha a pessoa pela assinatura", String(bySub?.id_user) === String(comum));

    // Estorno devolve o mês — e NÃO estende.
    const before = (await Storage.getByUser(c, comum)).paid_until;
    await Storage.shrinkPaidUntil(c, comum, 1);
    const after = (await Storage.getByUser(c, comum)).paid_until;
    check("estorno RECUA a vigência (nunca dá mês de graça)", new Date(after) < new Date(before));

    // Vencido → sem selo, sem job.
    await c.query(`UPDATE public.tb_user_verification SET paid_until = NOW() - INTERVAL '1 day' WHERE id_user = $1`, [comum]);
    st = await Storage.getStatus(c, comum);
    check("vencido → selo apagado na leitura seguinte (lazy)", st.is_verified === false);

    // Cancelar solta a renovação e mantém a data.
    await c.query(`UPDATE public.tb_user_verification SET paid_until = NOW() + INTERVAL '10 days' WHERE id_user = $1`, [comum]);
    const det = await Storage.detachSubscription(c, comum);
    check("cancelar solta a assinatura", det.subscription_ref === null && det.subscription_status === "canceled");
    st = await Storage.getStatus(c, comum);
    check("…e o selo fica até a data paga", st.is_verified === true);

    // As QUATRO projeções.
    const prof = (await c.query(`SELECT id_profile FROM public.tb_profile WHERE id_user = $1 AND deleted_at IS NULL LIMIT 1`, [comum])).rows[0];
    const p = await attempt(c, () => ProfileStorage.getProfileById(c, prof.id_profile));
    check("perfil: getProfileById devolve is_verified", p.ok && p.value?.is_verified === true, p.error?.message);

    const me = await attempt(c, () => UserStorage.getUserWithSocialById(c, comum));
    check("/users/me devolve is_verified", me.ok && me.value?.is_verified === true, me.error?.message);

    const s = await attempt(c, () => SearchStorage.searchCreators(c, { limit: 5, offset: 0 }));
    check("vitrine: a busca roda com o selo na projeção", s.ok, s.error?.message);

    const f = await attempt(c, () => FeedStorage.listTopCandidates(c, { limit: 5 }));
    check("feed: a consulta roda com o selo na projeção", f.ok, f.error?.message);
    const fa = await attempt(c, () => FeedStorage.listNewCandidates(c, { limit: 5 }));
    check("feed (novos): a consulta roda com o selo na projeção", fa.ok, fa.error?.message);

    const adminProf = (await c.query(`SELECT id_profile FROM public.tb_profile WHERE id_user = $1 AND deleted_at IS NULL LIMIT 1`, [admin])).rows[0];
    if (adminProf) {
      const ap = await ProfileStorage.getProfileById(c, adminProf.id_profile);
      check("perfil do admin sai com o selo", ap?.is_verified === true);
    }
  } catch (err) {
    fail++;
    console.log("FAIL  erro inesperado -> " + (err.stack || err.message));
  } finally {
    await c.query("ROLLBACK");
  }

  const depois = (
    await c.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables
        WHERE table_schema='public' AND table_name LIKE 'tb_%verification%'`
    )
  ).rows[0].n;
  check("PRODUÇÃO INTOCADA: tabelas voltaram ao estado de antes", depois === antes, `${antes} -> ${depois}`);
  await c.end();
  console.log(`\n${pass}/${pass + fail} checks`);
  process.exit(fail ? 1 : 0);
})();
