/**
 * BANCOS CONECTADOS (mig 462).
 *
 *   node test/bank-connections.e2e.js
 *
 * Parte A — no Postgres, dentro de transação com ROLLBACK (não grava nada):
 *   migration idempotente, acesso pago com renovação deduplicada e estorno sem
 *   mês de graça, lançamento importado sem duplicar, lançamento do banco que
 *   não se apaga nem tem o valor editado.
 *
 * Parte B — contra o SANDBOX da Malvo (só roda com MALVO_ENV=sandbox e as
 *   credenciais no ambiente): cria um Item no banco de teste, registra pelo
 *   dono certo (e recusa o dono errado), sincroniza (contas, fatura, extrato
 *   na Vida Financeira), aceita webhook assinado e recusa o falsificado, e
 *   desconecta apagando tudo. Limpa o que criou no banco local no final.
 *   ⚠️ NUNCA aponte a parte B para produção: ela grava (e apaga) linhas reais.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/462_bank_connections.sql");

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond === true) {
    pass++;
    console.log("  ok  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name + (extra ? " -> " + extra : ""));
  }
}

async function partA() {
  const Access = require(path.join(BE, "src/storages/BankAccessStorage"));
  const Conn = require(path.join(BE, "src/storages/BankConnectionStorage"));
  const Fin = require(path.join(BE, "src/storages/WalletFinanceStorage"));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  await c.query("BEGIN");
  try {
    const sql = fs.readFileSync(MIG, "utf8");
    await c.query(sql);
    await c.query(sql);
    check("mig 462 aplica duas vezes (idempotente)", true);

    const s = await Access.getSettings(c);
    check("régua nasce em R$ 20, 2 bancos, 3 conexões/mês", s.monthly_cents === 2000 && s.max_banks === 2 && s.connects_per_month === 3, JSON.stringify(s));
    const flag = (await c.query(`SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key='bancos_conectados'`)).rows[0];
    check("flag bancos_conectados nasce DESLIGADA", flag?.is_enabled === false);

    const u = (
      await c.query(
        `SELECT u.id_user FROM public.tb_user u
          WHERE NOT EXISTS (SELECT 1 FROM public.tb_user_role ur JOIN public.tb_role r ON r.id_role = ur.id_role
                             WHERE ur.id_user = u.id_user AND r.desc_role = 'Administrator' AND ur.is_active)
          LIMIT 1`
      )
    ).rows[0];
    if (!u) throw new Error("sem usuário comum no banco local");
    const id = u.id_user;

    check("sem pagar, sem acesso", (await Access.getStatus(c, id)).has_access === false);
    await Access.extendPaidUntil(c, id, 1);
    check("pagou 1 mês: tem acesso", (await Access.getStatus(c, id)).has_access === true);

    const r1 = await Access.recordRenewalOnce(c, { id_user: id, amount_cents: 2000, invoice_ref: "inv_e2e_1" });
    const r2 = await Access.recordRenewalOnce(c, { id_user: id, amount_cents: 2000, invoice_ref: "inv_e2e_1" });
    check("renovação com a mesma fatura grava uma vez só", !!r1 && r2 === null);

    await Access.shrinkPaidUntil(c, id, 1);
    check("estorno devolve o mês (sem 30 dias de graça)", (await Access.getStatus(c, id)).has_access === false);

    // Lançamentos importados: OFX duas vezes não duplica.
    const rows = [
      { external_id: "e2e_1", direction: "out", title: "Padaria", category: null, amount_cents: 850, date: "2026-11-20" },
      { external_id: "e2e_2", direction: "in", title: "Pix", category: null, amount_cents: 10000, date: "2026-11-21" },
    ];
    const a = await Conn.insertEntries(c, id, "ofx", rows);
    const b = await Conn.insertEntries(c, id, "ofx", rows);
    check("OFX importado duas vezes: 2 e depois 0", a === 2 && b === 0, `${a}/${b}`);

    // Lançamento do banco: valor não se edita, e não se apaga.
    const ins = await Conn.insertEntries(c, id, "bank", [
      { external_id: "e2e_bank_1", direction: "out", title: "Mercado", category: "Mercado", amount_cents: 7312, date: "2026-11-20" },
    ]);
    const bankRow = (
      await c.query(`SELECT id FROM public.tb_wallet_finance_entry WHERE user_id=$1 AND external_id='e2e_bank_1'`, [id])
    ).rows[0];
    check("lançamento do banco entrou", ins === 1 && !!bankRow);
    const upd = await Fin.updateEntry(c, id, bankRow.id, { amount_cents: 1, category: "Lazer" });
    check("valor do banco não muda; categoria muda", Number(upd.amount_cents) === 7312 && upd.category === "Lazer", JSON.stringify(upd));
    check("lançamento do banco não se apaga", (await Fin.deleteEntry(c, id, bankRow.id)) === false);

    const month = await Fin.monthEntries(c, id, { ym: 202611, from: "2026-11-01", to: "2026-12-01" });
    check("o mês traz a origem de cada lançamento", month.some((e) => e.source === "bank") && month.some((e) => e.source === "ofx"));
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}

async function partB() {
  if (String(process.env.MALVO_ENV).toLowerCase() !== "sandbox" || !process.env.MALVO_CLIENT_ID) {
    console.log("  --  parte B pulada (MALVO_ENV=sandbox e credenciais não definidos)");
    return;
  }
  if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL || "")) {
    console.log("  --  parte B pulada: DATABASE_URL não é local");
    return;
  }
  const pool = require(path.join(BE, "src/databases"));
  const Malvo = require(path.join(BE, "src/utils/malvoClient"));
  const { sign } = require(path.join(BE, "src/utils/malvoSignature"));
  const Svc = require(path.join(BE, "src/services/BankConnectionService"));
  const Access = require(path.join(BE, "src/storages/BankAccessStorage"));

  const [owner, other] = (await pool.query(`SELECT id_user FROM public.tb_user ORDER BY id_user LIMIT 2`)).rows.map((r) => r.id_user);
  const before = await Access.getByUser(pool, owner);
  let itemId = null;
  try {
    await Access.extendPaidUntil(pool, owner, 1);

    const item = await Malvo.createItem({ connectorId: 7, parameters: { cpf: "529.982.247-25" }, clientUserId: owner });
    itemId = item.id;
    check("sandbox: Item criado", !!itemId);

    const wrong = await Svc.registerItem({ id_user: other }, { item_id: itemId });
    check("registrar Item de outra pessoa é recusado (404)", wrong.statusCode === 404 || wrong.error !== undefined);

    for (let i = 0; i < 30; i++) {
      const it = await Malvo.getItem(itemId);
      if (!["CREATING", "UPDATING", "LOGIN_IN_PROGRESS"].includes(it.status)) break;
      await new Promise((ok) => setTimeout(ok, 2000));
    }
    const reg = await Svc.registerItem({ id_user: owner }, { item_id: itemId });
    check("registrar pelo dono certo", reg.ok === true, JSON.stringify(reg));
    // O registro já dispara uma sincronização em segundo plano: o que importa
    // é o que ficou no banco depois das duas.
    const sync = await Svc.syncItem(itemId);
    await new Promise((ok) => setTimeout(ok, 1500));
    const got = (
      await pool.query(
        `SELECT COUNT(*)::int n FROM public.tb_wallet_finance_entry e JOIN public.tb_bank_account a ON a.id_account = e.id_bank_account
          WHERE a.id_connection = $1 AND e.source = 'bank'`,
        [reg.id_connection]
      )
    ).rows[0].n;
    check("sincronizou contas e lançamentos", sync.ok === true && sync.accounts >= 1 && got > 0, JSON.stringify({ ...sync, got }));
    const again = await Svc.syncItem(itemId);
    check("sincronizar de novo não duplica", again.inserted === 0, JSON.stringify(again));

    const mine = await Svc.getMine({ id_user: owner });
    const conn = mine.connections.find((x) => x.id_connection === reg.id_connection);
    check("a tela mostra a conexão com conta e cartão", !!conn && conn.accounts.length >= 2, JSON.stringify(conn?.accounts?.length));
    const card = conn?.accounts.find((x) => x.type === "CREDIT");
    check("cartão traz a fatura", !!card && card.bill_amount_cents > 0 && !!card.bill_due_date);
    check("conexão contou no limite do mês", mine.limits.connects_used >= 1);

    // Webhook: assinado passa; falsificado não; repetido é no-op.
    process.env.MALVO_WEBHOOK_SECRET = "whsec_e2e";
    const body = Buffer.from(JSON.stringify({ event: "item/updated", eventId: "e2e-" + Date.now(), itemId }));
    const t = Math.floor(Date.now() / 1000);
    const good = await Svc.handleWebhook(body, { "malvo-signature": `t=${t},v1=${sign("whsec_e2e", t, body)}` });
    check("webhook assinado: 200", good.status === 200 && good.body.received === true);
    const dup = await Svc.handleWebhook(body, { "malvo-signature": `t=${t},v1=${sign("whsec_e2e", t, body)}` });
    check("webhook repetido: no-op", dup.body.duplicate === true);
    const bad = await Svc.handleWebhook(body, { "malvo-signature": `t=${t},v1=${"a".repeat(64)}` });
    check("webhook falsificado: 401", bad.status === 401);
    await new Promise((ok) => setTimeout(ok, 3000));

    const out = await Svc.disconnect({ id_user: owner }, reg.id_connection);
    check("desconectar", out.ok === true);
    const left = (
      await pool.query(
        `SELECT COUNT(*)::int n FROM public.tb_wallet_finance_entry e JOIN public.tb_bank_account a ON a.id_account = e.id_bank_account
          WHERE a.id_connection = $1`,
        [reg.id_connection]
      )
    ).rows[0].n;
    check("desconectar apaga os lançamentos do banco", left === 0);
    let gone = false;
    try {
      await Malvo.getItem(itemId);
    } catch (e) {
      gone = e.status === 404;
    }
    check("Item revogado na Malvo", gone);
    itemId = null;
  } finally {
    if (itemId) await Malvo.deleteItem(itemId).catch(() => {});
    await pool.query(
      `DELETE FROM public.tb_bank_connection WHERE id_user = $1 AND malvo_item_id IN (SELECT malvo_item_id FROM public.tb_bank_connection WHERE id_user = $1)`,
      [owner]
    );
    await pool.query(`DELETE FROM public.tb_bank_connect_event WHERE id_user = $1 AND created_at > NOW() - INTERVAL '1 hour'`, [owner]);
    await pool.query(`DELETE FROM public.tb_bank_webhook_event WHERE event_id LIKE 'e2e-%'`);
    if (!before) await pool.query(`DELETE FROM public.tb_user_bank_access WHERE id_user = $1`, [owner]);
    else await pool.query(`UPDATE public.tb_user_bank_access SET paid_until = $2 WHERE id_user = $1`, [owner, before.paid_until]);
    await pool.end();
  }
}

(async () => {
  console.log("Parte A — Postgres (rollback)");
  await partA();
  console.log("Parte B — sandbox da Malvo");
  await partB();
  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
