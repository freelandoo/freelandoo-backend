// test/subscription-end.e2e.js
//
// Exercita a mig 251: a fila de "cancelar no fim do ciclo".
//
// ⚠️ ESTA SUÍTE PODE APONTAR PARA PRODUÇÃO porque NÃO EXISTE UM `COMMIT` NELA.
// Tudo roda dentro de uma transação que termina em ROLLBACK, e no fim ela
// confere que a tabela voltou ao estado de antes. Não acrescente COMMIT.
//
// ─── O QUE ESTES CASOS SEGURAM ──────────────────────────────────────────────
//
// O defeito que a mig 251 fecha tira MÊS PAGO de assinante, e a correção tem
// duas peças frágeis:
//
//   1. o `ON CONFLICT (…) WHERE status = 'scheduled'` INFERINDO um índice
//      PARCIAL. Se essa inferência estiver errada, o segundo pedido de
//      cancelamento (o duplo-clique, que é o caso comum) vira 500 de
//      unicidade na cara de quem acabou de pedir para sair.
//   2. o `attempts` que para de insistir. Sem ele, uma assinatura apagada à mão
//      no painel do gateway viraria erro a cada volta do sweeper, para sempre.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");
const SubscriptionEndStorage = require("../src/storages/SubscriptionEndStorage");

let pass = 0;
let fail = 0;

function check(label, cond, extra) {
  if (typeof cond !== "boolean") {
    fail++;
    console.error(`  FAIL ${label} :: condição não é booleana (${typeof cond})`);
    return;
  }
  if (cond) {
    pass++;
    console.log("  ok   " + label);
  } else {
    fail++;
    console.error("  FAIL " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  }
}

let sp = 0;
async function violates(client, fn, constraintName) {
  const name = "sp_" + ++sp;
  await client.query(`SAVEPOINT ${name}`);
  try {
    await fn();
    await client.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: false, reason: "não levantou erro" };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
    const hit = String(e.constraint || "") === constraintName;
    return { ok: hit, reason: e.constraint || e.message };
  }
}

const FUTURE = new Date(Date.now() + 15 * 86400000);
const PAST = new Date(Date.now() - 60 * 1000);

async function main() {
  if (!(process.env.TEST_DATABASE_URL || process.env.DATABASE_URL)) {
    console.error("Defina DATABASE_URL ou TEST_DATABASE_URL");
    process.exit(1);
  }
  const client = await pool.connect();
  const mig = fs.readFileSync(
    path.join(__dirname, "..", "src", "databases", "migrations", "251_subscription_end.sql"),
    "utf8"
  );

  const existedBefore = await client.query(
    `SELECT to_regclass('public.tb_subscription_end') IS NOT NULL AS ok`
  );
  const tableExistedBefore = existedBefore.rows[0].ok === true;
  const countBefore = tableExistedBefore
    ? (await client.query(`SELECT COUNT(*)::int n FROM public.tb_subscription_end`)).rows[0].n
    : 0;

  console.log("\n== mig 251: a fila de cancelamento ==");
  await client.query("BEGIN");
  try {
    await client.query(mig);
    check("migration aplica", true);
    await client.query(mig);
    check("2ª aplicação não quebra (idempotente)", true);

    // ── Estrutura ─────────────────────────────────────────────────────────
    const cols = await client.query(
      `SELECT column_name, is_nullable, data_type
         FROM information_schema.columns
        WHERE table_schema='public' AND table_name='tb_subscription_end'`
    );
    const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));
    for (const c of ["provider", "provider_ref", "cancel_at", "status", "attempts"]) {
      check(`coluna ${c} é NOT NULL`, byName[c] && byName[c].is_nullable === "NO", byName[c]);
    }
    check("id_user é NULL-able (apagar a conta não apaga a ordem de parar de cobrar)",
      byName.id_user && byName.id_user.is_nullable === "YES", byName.id_user);

    const idx = await client.query(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename='tb_subscription_end' ORDER BY indexname`
    );
    const live = idx.rows.find((r) => r.indexname === "ux_subscription_end_live");
    check("o UNIQUE de agenda viva existe", !!live);
    check("⚠️ e ele é PARCIAL — senão o 2º cancelamento da MESMA assinatura seria recusado",
      !!live && /WHERE \(status = 'scheduled'/i.test(live.indexdef), live && live.indexdef);
    check("o radar do sweeper (cancel_at, parcial) existe",
      idx.rows.some((r) => r.indexname === "ix_subscription_end_due"));

    // ── Os CHECKs, pelo NOME ──────────────────────────────────────────────
    const badProvider = await violates(
      client,
      () =>
        client.query(
          `INSERT INTO public.tb_subscription_end (provider, provider_ref, cancel_at)
           VALUES ('inventado', 'x', NOW())`
        ),
      "tb_subscription_end_provider_chk"
    );
    check("provedor inventado é recusado PELO NOME", badProvider.ok, badProvider.reason);

    const badStatus = await violates(
      client,
      () =>
        client.query(
          `INSERT INTO public.tb_subscription_end (provider, provider_ref, cancel_at, status)
           VALUES ('mercadopago', 'x', NOW(), 'inventado')`
        ),
      "tb_subscription_end_status_chk"
    );
    check("status inventado é recusado PELO NOME", badStatus.ok, badStatus.reason);

    // ── Agendar, e agendar DE NOVO (o duplo-clique) ───────────────────────
    const first = await SubscriptionEndStorage.schedule(client, {
      provider: "mercadopago",
      provider_ref: "preapp_teste_1",
      id_user: null,
      cancel_at: FUTURE,
      reason: "teste",
    });
    check("agenda nasce 'scheduled'", first.status === "scheduled", first.status);
    check("attempts nasce em zero", first.attempts === 0, first.attempts);

    const laterDate = new Date(FUTURE.getTime() + 86400000);
    const second = await SubscriptionEndStorage.schedule(client, {
      provider: "mercadopago",
      provider_ref: "preapp_teste_1",
      cancel_at: laterDate,
      reason: null,
    });
    // ⚠️ O caso que importa: o 2º pedido NÃO pode ser 500 de unicidade.
    check("⚠️ agendar de novo é no-op, não erro (o duplo-clique)",
      !!second && second.id_subscription_end === first.id_subscription_end,
      { first: first.id_subscription_end, second: second && second.id_subscription_end });
    check("e a data ACOMPANHA o ciclo novo",
      new Date(second.cancel_at).getTime() === laterDate.getTime(),
      { esperado: laterDate.toISOString(), veio: second.cancel_at });
    check("e a razão anterior é preservada quando a nova vem vazia",
      second.reason === "teste", second.reason);

    const onlyOne = await client.query(
      `SELECT COUNT(*)::int n FROM public.tb_subscription_end
        WHERE provider_ref='preapp_teste_1' AND status='scheduled'`
    );
    check("existe UMA agenda viva por assinatura", onlyOne.rows[0].n === 1, onlyOne.rows[0]);

    // ── A fila do sweeper: só o que VENCEU ────────────────────────────────
    let due = await SubscriptionEndStorage.listDue(client, { limit: 50 });
    check("⚠️ agenda FUTURA não entra na fila (senão o mês pago é cortado na hora)",
      !due.some((r) => r.provider_ref === "preapp_teste_1"),
      due.map((r) => r.provider_ref));

    const vencida = await SubscriptionEndStorage.schedule(client, {
      provider: "mercadopago",
      provider_ref: "preapp_teste_2",
      cancel_at: PAST,
      reason: "vencida",
    });
    due = await SubscriptionEndStorage.listDue(client, { limit: 50 });
    check("agenda VENCIDA entra na fila",
      due.some((r) => r.id_subscription_end === vencida.id_subscription_end));

    // ── markDone e a corrida do sweeper ───────────────────────────────────
    const done = await SubscriptionEndStorage.markDone(client, vencida.id_subscription_end);
    check("markDone marca 'done' e carimba executed_at",
      done.status === "done" && !!done.executed_at, done && done.status);
    const again = await SubscriptionEndStorage.markDone(client, vencida.id_subscription_end);
    // ⚠️ Duas voltas do sweeper podem pegar a mesma linha. A 2ª tem que ser
    // no-op, senão o cancelamento seria pedido duas vezes ao gateway.
    check("⚠️ markDone é no-op na 2ª vez (duas voltas do sweeper)", again === null, again);

    due = await SubscriptionEndStorage.listDue(client, { limit: 50 });
    check("o que virou 'done' sai da fila",
      !due.some((r) => r.id_subscription_end === vencida.id_subscription_end));

    // ── attempts: para de insistir ────────────────────────────────────────
    const teimosa = await SubscriptionEndStorage.schedule(client, {
      provider: "mercadopago",
      provider_ref: "preapp_teste_3",
      cancel_at: PAST,
      reason: "vai falhar",
    });
    let state = null;
    for (let i = 1; i <= SubscriptionEndStorage.MAX_ATTEMPTS; i++) {
      state = await SubscriptionEndStorage.markAttemptFailed(
        client,
        teimosa.id_subscription_end,
        `falha ${i}`
      );
      if (i < SubscriptionEndStorage.MAX_ATTEMPTS) {
        check(`tentativa ${i} mantém 'scheduled' (gateway fora do ar é retry, não desistência)`,
          state.status === "scheduled", state.status);
      }
    }
    check("no último fôlego vira 'failed'", state.status === "failed", state.status);
    check("e o erro fica gravado", typeof state.last_error === "string" && state.last_error.length > 0);

    due = await SubscriptionEndStorage.listDue(client, { limit: 50 });
    check("⚠️ 'failed' SAI da fila — senão o log se enche para sempre",
      !due.some((r) => r.id_subscription_end === teimosa.id_subscription_end));

    // ── release: a pessoa voltou atrás ────────────────────────────────────
    const arrependida = await SubscriptionEndStorage.schedule(client, {
      provider: "mercadopago",
      provider_ref: "preapp_teste_4",
      cancel_at: FUTURE,
    });
    const released = await SubscriptionEndStorage.release(client, "mercadopago", "preapp_teste_4");
    check("release tira a agenda de cena sem cancelar nada", released.status === "canceled");
    check("e depois do release dá para agendar de novo",
      !!(await SubscriptionEndStorage.schedule(client, {
        provider: "mercadopago",
        provider_ref: "preapp_teste_4",
        cancel_at: FUTURE,
      })),
      arrependida.id_subscription_end);

    // ── getLive ───────────────────────────────────────────────────────────
    const viva = await SubscriptionEndStorage.getLive(client, "mercadopago", "preapp_teste_1");
    check("getLive acha a agenda viva", !!viva && viva.status === "scheduled");
    const morta = await SubscriptionEndStorage.getLive(client, "mercadopago", "preapp_teste_2");
    check("getLive NÃO devolve a que já foi executada", morta === null, morta);

    // ── o provedor é GUARDADO, não derivado ───────────────────────────────
    //
    // ⚠️ Uma assinatura criada no Stripe tem que ser cancelada no Stripe mesmo
    // depois de a plataforma inteira migrar.
    const legada = await SubscriptionEndStorage.schedule(client, {
      provider: "stripe",
      provider_ref: "sub_legado_1",
      cancel_at: PAST,
    });
    due = await SubscriptionEndStorage.listDue(client, { limit: 50 });
    const found = due.find((r) => r.id_subscription_end === legada.id_subscription_end);
    check("a fila carrega o provedor de CADA linha", !!found && found.provider === "stripe",
      found && found.provider);
  } finally {
    await client.query("ROLLBACK");
  }

  console.log("\n== produção voltou ao estado de antes ==");
  const existsAfter = await client.query(
    `SELECT to_regclass('public.tb_subscription_end') IS NOT NULL AS ok`
  );
  check("a tabela voltou ao estado de antes do BEGIN",
    existsAfter.rows[0].ok === tableExistedBefore,
    { antes: tableExistedBefore, depois: existsAfter.rows[0].ok });

  if (tableExistedBefore) {
    const countAfter = (
      await client.query(`SELECT COUNT(*)::int n FROM public.tb_subscription_end`)
    ).rows[0].n;
    check("nenhuma linha de teste sobrou", countAfter === countBefore,
      { antes: countBefore, depois: countAfter });
  } else {
    console.log("  --   (a tabela não existia antes: o ROLLBACK a desfez inteira)");
  }

  client.release();
  await pool.end();
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
