// test/asaas-payments.e2e.js
//
// Exercita o SQL da migração para o Asaas: a mig 236 (cliente do Asaas na
// conta) e os caminhos de escrita/leitura de tb_payment_intent (mig 231) com o
// provedor novo.
//
// ⚠️ ESTA SUÍTE PODE APONTAR PARA PRODUÇÃO porque NÃO EXISTE UM `COMMIT` NELA.
// Tudo roda dentro de uma transação que termina em ROLLBACK, e no fim a suíte
// confere que produção ficou intocada. As outras suítes e2e exigem
// TEST_DATABASE_URL justamente porque comitam. Não acrescente COMMIT aqui.
require("dotenv").config();
const fs = require("fs");
const path = require("path");
// ⚠️ Usa o POOL do projeto, não um Client novo: é ele que normaliza o SSL do
// Railway (a connection string vem com sslmode que o pg 9 passou a tratar como
// verify-full, e a cadeia do proxy é autoassinada).
const pool = require("../src/databases");

let pass = 0;
let fail = 0;

function check(label, cond, extra) {
  if (cond) {
    pass++;
    console.log("  ok   " + label);
  } else {
    fail++;
    console.error("  FAIL " + label + (extra !== undefined ? " :: " + JSON.stringify(extra) : ""));
  }
}

// ⚠️ Guarda contra função async passada por engano: ela devolveria uma Promise
// (sempre truthy) e o teste imprimiria sucesso sem ter verificado nada. O bug
// real que a suíte de community-site pagou.
function checkNoAsync(fn) {
  if (fn && fn.constructor && fn.constructor.name === "AsyncFunction") {
    throw new Error("check() não aceita função async");
  }
}

let savepointSeq = 0;

/**
 * ⚠️ O SAVEPOINT não é preciosismo: no Postgres, uma constraint violada ABORTA
 * a transação inteira, e todo comando seguinte falha com "current transaction
 * is aborted". Sem ele, o primeiro teste de violação cega todos os que vêm
 * depois — e eles apareceriam como erro do código, não do teste.
 */
async function violates(client, fn, constraintName) {
  checkNoAsync(fn);
  const sp = "sp_" + ++savepointSeq;
  await client.query(`SAVEPOINT ${sp}`);
  try {
    await fn();
    await client.query(`RELEASE SAVEPOINT ${sp}`);
    return { ok: false, reason: "não levantou erro" };
  } catch (e) {
    await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
    // ⚠️ Conferir pelo NOME da constraint, não só "deu erro": um NOT NULL
    // esquecido faria o teste passar como se a regra certa estivesse de pé.
    const hit = String(e.constraint || "") === constraintName ||
                String(e.message || "").includes(constraintName);
    return { ok: hit, reason: e.constraint || e.message };
  }
}

async function main() {
  const url = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
  if (!url) {
    console.error("Defina DATABASE_URL ou TEST_DATABASE_URL");
    process.exit(1);
  }

  const client = await pool.connect();

  const mig = fs.readFileSync(
    path.join(__dirname, "..", "src", "databases", "migrations", "236_asaas_customer.sql"),
    "utf8"
  );

  console.log("\n== mig 236: o cliente do Asaas na conta ==");
  await client.query("BEGIN");
  try {
    await client.query(mig);
    check("migration aplica", true);

    // ⚠️ Idempotente: o runner reaplica no boot de todo deploy.
    await client.query(mig);
    check("2ª aplicação não quebra (idempotente)", true);

    const col = await client.query(
      `SELECT data_type, is_nullable FROM information_schema.columns
        WHERE table_name='tb_user' AND column_name='asaas_customer_id'`
    );
    check("coluna existe", col.rowCount === 1);
    check("é TEXT e NULLABLE", col.rows[0].data_type === "text" && col.rows[0].is_nullable === "YES", col.rows[0]);

    const idx = await client.query(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename='tb_user' AND indexname='ux_tb_user_asaas_customer'`
    );
    check("índice único existe", idx.rowCount === 1);
    check(
      "é PARCIAL (WHERE ... IS NOT NULL)",
      /WHERE .*asaas_customer_id IS NOT NULL/i.test(idx.rows[0].indexdef),
      idx.rows[0].indexdef
    );

    // SEM backfill: ninguém tem cliente no Asaas ainda.
    const preenchidos = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_user WHERE asaas_customer_id IS NOT NULL`
    );
    check("nasce vazia para todo mundo (sem backfill)", preenchidos.rows[0].n === 0, preenchidos.rows[0]);

    // Duas contas de verdade para exercitar a unicidade.
    const users = await client.query(
      `SELECT id_user, nome, cpf FROM public.tb_user ORDER BY created_at LIMIT 2`
    );
    check("há ao menos 2 contas para testar", users.rowCount === 2);
    const [u1, u2] = users.rows;

    const AsaasCustomerStorage = require("../src/storages/AsaasCustomerStorage");

    const ident = await AsaasCustomerStorage.getPayerIdentity(client, u1.id_user);
    check("getPayerIdentity devolve o que o Asaas exige (nome)", !!ident && !!ident.nome, {
      temNome: !!(ident && ident.nome),
      temCpf: !!(ident && ident.cpf),
    });

    const first = await AsaasCustomerStorage.attachCustomerId(client, u1.id_user, "cus_TESTE_1");
    check("carimba o cliente na conta", first && first.asaas_customer_id === "cus_TESTE_1", first);

    // ⚠️ A corrida: o segundo carimbo NÃO sobrescreve o primeiro. Sem isto, dois
    // checkouts simultâneos deixariam um cliente órfão no Asaas com cobranças
    // penduradas que ninguém mais acha.
    const second = await AsaasCustomerStorage.attachCustomerId(client, u1.id_user, "cus_TESTE_2");
    check("2º carimbo é recusado (guarda IS NULL)", second === null, second);
    const still = await AsaasCustomerStorage.getPayerIdentity(client, u1.id_user);
    check("o id do vencedor continua de pé", still.asaas_customer_id === "cus_TESTE_1", still.asaas_customer_id);

    // Duas contas SEM cliente convivem (é o que o índice parcial garante).
    const bothNull = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_user WHERE asaas_customer_id IS NULL`
    );
    check("muitas contas com NULL convivem (índice é parcial)", bothNull.rows[0].n > 1, bothNull.rows[0]);

    // O MESMO cliente em duas contas é recusado — pelo NOME do índice.
    const dup = await violates(
      client,
      () => client.query(`UPDATE public.tb_user SET asaas_customer_id = $1 WHERE id_user = $2`, ["cus_TESTE_1", u2.id_user]),
      "ux_tb_user_asaas_customer"
    );
    check("o mesmo cliente em 2 contas é recusado pelo índice", dup.ok, dup.reason);

    await client.query("ROLLBACK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("  ERRO no bloco da mig 236:", e.message);
    fail++;
  }

  console.log("\n== tb_payment_intent (mig 231) com o provedor novo ==");
  await client.query("BEGIN");
  try {
    const PaymentIntentStorage = require("../src/storages/PaymentIntentStorage");

    const users = await client.query(`SELECT id_user FROM public.tb_user ORDER BY created_at LIMIT 1`);
    const idUser = users.rows[0].id_user;

    const intent = await PaymentIntentStorage.create(client, {
      provider: "asaas",
      flow: "polen_purchase",
      id_user: idUser,
      payload: { type: "polen_purchase", user_id: idUser, polens_amount: "500" },
      amount_cents: 1990,
    });
    check("cria intenção com provider asaas", !!intent && intent.provider === "asaas", intent && intent.provider);
    check("nasce 'created' e SEM referência do gateway", intent.status === "created" && intent.provider_ref === null, {
      status: intent.status, ref: intent.provider_ref,
    });
    check("o payload guarda o antigo metadata", intent.payload && intent.payload.type === "polen_purchase", intent.payload);

    // Provedor inventado é recusado pelo CHECK — pelo NOME da constraint.
    const badProvider = await violates(
      client,
      () => client.query(
        `INSERT INTO public.tb_payment_intent (provider, flow, amount_cents) VALUES ('pagseguro','polen_purchase',100)`
      ),
      "tb_payment_intent_provider_check"
    );
    check("provedor fora da lista é recusado", badProvider.ok, badProvider.reason);

    // Fluxo torto é barrado no JS ANTES do banco (a lista fechada mora lá).
    let flowBarrado = false;
    try {
      await PaymentIntentStorage.create(client, {
        provider: "asaas", flow: "fluxo_que_nao_existe", amount_cents: 100,
      });
    } catch (e) {
      flowBarrado = /desconhecido/i.test(e.message);
    }
    check("fluxo desconhecido é barrado antes do banco", flowBarrado);

    const attached = await PaymentIntentStorage.attachProviderRef(client, intent.id_payment_intent, {
      provider_ref: "pay_TESTE_1",
      provider_customer_id: "cus_TESTE_1",
    });
    check("carimba a referência do gateway", attached && attached.provider_ref === "pay_TESTE_1", attached && attached.provider_ref);

    const second = await PaymentIntentStorage.attachProviderRef(client, intent.id_payment_intent, {
      provider_ref: "pay_OUTRO",
    });
    check("2º carimbo é recusado (retry não sequestra a 1ª cobrança)", second === null, second);

    // O caminho do webhook: da referência de volta ao significado.
    const found = await PaymentIntentStorage.getByProviderRef(client, "asaas", "pay_TESTE_1");
    check("webhook acha a intenção pela referência", found && found.id_payment_intent === intent.id_payment_intent);

    // ⚠️ Os espaços de id dos dois provedores são independentes e nada garante
    // que não colidam: a mesma referência NÃO pode vazar entre eles.
    const crossed = await PaymentIntentStorage.getByProviderRef(client, "stripe", "pay_TESTE_1");
    check("referência não vaza entre provedores", crossed === null, crossed);

    const paid = await PaymentIntentStorage.setStatus(client, intent.id_payment_intent, "paid");
    check("created → paid", paid && paid.status === "paid", paid && paid.status);

    // ⚠️ A reentrega FORA DE ORDEM do Asaas: um PAYMENT_CREATED que chega
    // depois do RECEIVED não pode devolver uma cobrança paga para 'created'.
    const regress = await PaymentIntentStorage.setStatus(client, intent.id_payment_intent, "created");
    check("estado final NÃO regride (paid ✗→ created)", regress === null, regress);

    // Reembolso é posterior ao pagamento por definição: é a única exceção.
    const refunded = await PaymentIntentStorage.setStatus(client, intent.id_payment_intent, "refunded");
    check("paid → refunded é permitido", refunded && refunded.status === "refunded", refunded && refunded.status);

    console.log("\n== telemetria de webhook aceita o provedor novo ==");
    const ev = await client.query(
      `INSERT INTO public.tb_stripe_webhook_event (event_id, event_type, payload, status, attempts, provider)
       VALUES ('evt_TESTE_asaas','PAYMENT_RECEIVED','{}'::jsonb,'pending',1,'asaas')
       RETURNING provider`
    );
    check("evento do Asaas é gravado", ev.rows[0].provider === "asaas");

    const badEvProvider = await violates(
      client,
      () => client.query(
        `INSERT INTO public.tb_stripe_webhook_event (event_id, event_type, payload, status, attempts, provider)
         VALUES ('evt_TESTE_x','X','{}'::jsonb,'pending',1,'mercadopago')`
      ),
      "tb_stripe_webhook_event_provider_check"
    );
    check("provedor inventado é recusado na telemetria", badEvProvider.ok, badEvProvider.reason);

    await client.query("ROLLBACK");
  } catch (e) {
    await client.query("ROLLBACK");
    console.error("  ERRO no bloco da mig 231:", e.message);
    fail++;
  }

  // ─── produção intocada ────────────────────────────────────────────────────
  console.log("\n== produção intocada depois do rollback ==");
  const after = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM information_schema.columns
        WHERE table_name='tb_user' AND column_name='asaas_customer_id') AS col_existe,
      (SELECT COUNT(*)::int FROM public.tb_payment_intent) AS intents,
      (SELECT COUNT(*)::int FROM public.tb_stripe_webhook_event WHERE event_id LIKE 'evt_TESTE%') AS eventos_teste
  `);
  const a = after.rows[0];
  check("a coluna da mig 236 NÃO ficou em produção (rollback)", a.col_existe === 0, a);
  check("nenhuma intenção de teste sobrou", a.intents === 0, a);
  check("nenhum evento de teste sobrou", a.eventos_teste === 0, a);

  client.release();
  await pool.end();

  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
