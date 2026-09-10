/**
 * Suíte dos PLANOS MENSAIS (mig 225).
 *
 * ═══ POR QUE ELA RODA DENTRO DE UMA TRANSAÇÃO ═══
 *
 * Não há Postgres local nesta máquina. A regra central desta entrega é a que só
 * o banco de verdade responde — o índice parcial que impede a segunda
 * assinatura viva, o CHECK dos status, a cascata do plano para as chaves. Então
 * a suíte abre UMA transação no banco apontado por DATABASE_URL, faz tudo
 * dentro dela e termina em ROLLBACK: nenhuma linha sobrevive, nem em caso de
 * falha (o `finally` faz o rollback).
 *
 * O `pool.query` do processo é redirecionado para o cliente dessa transação
 * ANTES de qualquer service ser carregado — é o que permite exercitar as regras
 * do PlanService de verdade, sem escrever nada.
 *
 * ═══ O QUE ESTA SUÍTE EXISTE PARA PROTEGER ═══
 *
 * O terceiro estado de posse. Antes da mig 225 havia dois, e eram a mesma
 * coluna: `is_for_sale = FALSE` significava GRÁTIS PARA TODO MUNDO. Tirar
 * Comunidade e Agenda da venda avulsa sem o estado novo daria o oposto do
 * pedido — as duas cairiam de presente no colo da base inteira. Os casos 8 a 13
 * são exatamente essa fronteira.
 *
 * ═══ MIG 234 (2026-09-10): O PLANO VIROU O "NEGÓCIO" ═══
 *
 * A 225 prendia a chave `communities` inteira no plano. A 234 inverte: o
 * negócio e o site são de todo mundo, e o plano passa a liberar três PORTAS —
 * `community_members`, `site_share` e `atendimento_ia`. Esta suíte aplica as
 * DUAS migrations (é o mundo que a produção tem) e os casos de posse descrevem
 * o estado depois da 234. As portas em si (join, publicar, IA incluída) estão
 * em `business-plan.e2e.js`.
 *
 * Uso: `npm run test:plans` (transacional: BEGIN → ROLLBACK, por isso pode
 * rodar contra o banco de produção sem deixar linha)
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

let pass = 0;
let fail = 0;

function check(name, cond, extra) {
  // Recusa função async: uma promessa é sempre "verdadeira" e o caso passaria
  // sem ter sido avaliado (armadilha real, já paga na suíte do site).
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

    const PlanStorage = require("../src/storages/PlanStorage");
    const PlanService = require("../src/services/PlanService");
    const FunctionStoreService = require("../src/services/FunctionStoreService");
    const { USER_FEATURE_KEYS } = require("../src/utils/userFeatureKeys");

    // ─── 1. A migration ───────────────────────────────────────────────────
    const sqlPath = path.join(__dirname, "..", "src", "databases", "migrations", "225_plans.sql");
    const sql = fs.readFileSync(sqlPath, "utf8");
    await client.query(sql);
    console.log("\n[1] Migration");
    check("225 aplicada", true);

    // Idempotência: o runner reaplica no boot, e uma segunda passada que
    // estourasse derrubaria a produção inteira (exit 1 no prestart).
    await client.query(sql);
    check("225 é idempotente (2ª aplicação não estoura)", true);

    // A 234 vem em cima — e também tem que aguentar a segunda passada.
    const sql234 = fs.readFileSync(
      path.join(__dirname, "..", "src", "databases", "migrations", "234_business_plan.sql"),
      "utf8"
    );
    await client.query(sql234);
    await client.query(sql234);
    check("234 aplicada e idempotente", true);

    const planCount = await client.query("SELECT COUNT(*)::int AS n FROM public.tb_plan WHERE slug = 'profissional'");
    check("2ª passada não duplicou o plano", planCount.rows[0].n === 1, `n=${planCount.rows[0].n}`);

    // ─── 2. O plano semeado ───────────────────────────────────────────────
    console.log("\n[2] Plano de entrada");
    const plan = await PlanStorage.getPlanBySlug(pool, "profissional");
    check("plano 'profissional' existe e está ativo", !!plan && plan.is_active === true);
    check("preço é R$50 em centavos", plan && plan.price_cents === 5000, plan && String(plan.price_cents));

    const plans = await PlanStorage.listPlans(pool);
    const seeded = plans.find((p) => p.slug === "profissional");
    const feats = seeded ? seeded.features.slice().sort() : [];
    check("o plano se chama Negócio (mig 234)", seeded && seeded.name === "Negócio", seeded && seeded.name);
    check(
      "inclui exatamente agenda, atendimento_ia, community_members, site_share e whatsapp",
      JSON.stringify(feats) ===
        JSON.stringify(["agenda", "atendimento_ia", "community_members", "site_share", "whatsapp"]),
      JSON.stringify(feats)
    );
    check("communities SAIU do plano (o negócio é de todo mundo)", !feats.includes("communities"));

    // ⚠️ O que NÃO pode entrar: as funções que HOJE são grátis (migs 216/217/
    // 222). Pô-las no pacote tiraria da base o que ela já tem — regressão
    // vestida de empacotamento.
    const gratis = ["services", "wallet", "vitrine", "vaquinha", "fitness_academias"];
    check(
      "nenhuma função já-grátis foi puxada para dentro do plano",
      gratis.every((k) => !feats.includes(k)),
      JSON.stringify(feats)
    );

    // ─── 3. As funções saem da venda avulsa ───────────────────────────────
    console.log("\n[3] Saída da venda avulsa");
    const sale = await client.query(
      `SELECT feature_key, is_for_sale, price_cents, price_polens
         FROM public.tb_function_product
        WHERE feature_key IN ('communities', 'agenda')
        ORDER BY feature_key`
    );
    check("as 2 linhas continuam no catálogo (nada apagado)", sale.rowCount === 2, `rows=${sale.rowCount}`);
    check("communities e agenda saíram da vitrine", sale.rows.every((r) => r.is_for_sale === false));
    // Pela regra da mig 195, price_polens NULL é "nunca configurado" e o seed do
    // boot repõe 1000. Zerar "para limpar" faria voltarem a ter preço no próximo
    // deploy — com is_for_sale FALSE, o preço é inerte e fica como está.
    check(
      "preços preservados (inertes, não zerados)",
      sale.rows.every((r) => r.price_cents !== null),
      JSON.stringify(sale.rows)
    );

    const others = await client.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_function_product
        WHERE feature_key IN ('courses', 'store', 'profiles') AND is_for_sale = TRUE`
    );
    check("courses, store e profiles seguem à venda", others.rows[0].n === 3, `n=${others.rows[0].n}`);

    // ─── 4. Quem assinar: os dois usuários da vez ─────────────────────────
    console.log("\n[4] Assinatura");
    const users = await client.query(
      `SELECT id_user FROM public.tb_user WHERE ativo = TRUE ORDER BY created_at ASC LIMIT 2`
    );
    if (users.rowCount < 2) throw new Error("Preciso de 2 usuários para exercitar posse.");
    const assinante = users.rows[0].id_user;
    const forasteiro = users.rows[1].id_user;

    const pending = await PlanStorage.createPending(pool, {
      id_user: assinante,
      id_plan: plan.id_plan,
      price_cents: plan.price_cents,
      stripe_session_id: "cs_test_plan_e2e",
    });
    check("linha pendente criada", !!pending.id_subscription);

    // Pendente NÃO dá acesso: quem libera é o dinheiro, não o clique.
    const antesDoPagamento = await PlanService.hasFeature(assinante, "whatsapp");
    check("pendente NÃO libera a função", antesDoPagamento === false);

    await PlanStorage.activate(pool, pending.id_subscription, {
      stripe_subscription_id: "sub_test_plan_e2e",
      stripe_customer_id: "cus_test_plan_e2e",
      current_period_end: new Date(Date.now() + 30 * 864e5),
    });
    const ativa = await PlanStorage.getActiveSubscription(pool, assinante);
    check("assinatura ficou ativa", !!ativa && ativa.status === "active");

    // ─── 5. Uma assinatura viva por pessoa ────────────────────────────────
    //
    // ⚠️ Todo caso que ESPERA erro roda dentro de um SAVEPOINT: no Postgres um
    // erro aborta a transação inteira, e sem o savepoint o primeiro caso
    // negativo derrubaria todos os seguintes com "current transaction is
    // aborted" — que parece falha da suíte, não do que ela testa.
    console.log("\n[5] Unicidade viva");
    let segundaBarrada = false;
    let nomeDoIndice = null;
    await client.query("SAVEPOINT sp_unica");
    try {
      const outra = await PlanStorage.createPending(pool, {
        id_user: assinante,
        id_plan: plan.id_plan,
        price_cents: plan.price_cents,
        stripe_session_id: "cs_test_plan_e2e_2",
      });
      await PlanStorage.activate(pool, outra.id_subscription, {
        stripe_subscription_id: "sub_test_plan_e2e_2",
        stripe_customer_id: null,
        current_period_end: null,
      });
    } catch (e) {
      segundaBarrada = true;
      nomeDoIndice = e.constraint || null;
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_unica");
    check("segunda assinatura viva é recusada", segundaBarrada);
    // Conferir pelo NOME: sem isso, um NOT NULL qualquer passaria por
    // "protegido" (armadilha real, paga 2× nas migs anteriores).
    check(
      "recusada pelo índice certo (ux_user_plan_active)",
      nomeDoIndice === "ux_user_plan_active",
      String(nomeDoIndice)
    );

    // Encerrada, a pessoa pode assinar de novo — o histórico fica na tabela.
    await client.query("SAVEPOINT sp_reassina");
    await PlanStorage.setStatus(pool, pending.id_subscription, "canceled");
    const reassina = await PlanStorage.createPending(pool, {
      id_user: assinante,
      id_plan: plan.id_plan,
      price_cents: plan.price_cents,
      stripe_session_id: "cs_test_plan_e2e_3",
    });
    let reativou = false;
    try {
      await PlanStorage.activate(pool, reassina.id_subscription, {
        stripe_subscription_id: "sub_test_plan_e2e_3",
        stripe_customer_id: null,
        current_period_end: null,
      });
      reativou = true;
    } catch {
      reativou = false;
    }
    check("quem cancelou consegue assinar de novo", reativou);
    const historico = await client.query(
      "SELECT COUNT(*)::int AS n FROM public.tb_user_plan_subscription WHERE id_user = $1",
      [assinante]
    );
    check("o histórico de assinaturas é preservado", historico.rows[0].n >= 2, `n=${historico.rows[0].n}`);
    await client.query("ROLLBACK TO SAVEPOINT sp_reassina");

    // ─── 6. O CHECK dos status ────────────────────────────────────────────
    console.log("\n[6] Vocabulário do status");
    let statusBarrado = null;
    await client.query("SAVEPOINT sp_status");
    try {
      await client.query(
        `INSERT INTO public.tb_user_plan_subscription (id_user, id_plan, status, price_cents)
              VALUES ($1, $2, 'vitalicio', 100)`,
        [forasteiro, plan.id_plan]
      );
    } catch (e) {
      statusBarrado = e.constraint || null;
    }
    await client.query("ROLLBACK TO SAVEPOINT sp_status");
    check("status fora do vocabulário é recusado", statusBarrado === "chk_plan_sub_status", String(statusBarrado));

    // ─── 7. A POSSE — o terceiro estado ───────────────────────────────────
    //
    // O coração da entrega. Antes da mig 225 a conta era
    // `!is_for_sale || comprou`, e `is_for_sale = FALSE` queria dizer GRÁTIS.
    // Se isso ainda valesse, os dois casos seguintes passariam invertidos: o
    // forasteiro teria comunidade e agenda de graça.
    console.log("\n[7] Posse: assinante × forasteiro");
    const mapAssinante = await PlanService.ownershipMap(assinante, USER_FEATURE_KEYS);
    const mapForasteiro = await PlanService.ownershipMap(forasteiro, USER_FEATURE_KEYS);

    check("assinante TEM whatsapp", mapAssinante.whatsapp === true);
    check("assinante TEM communities", mapAssinante.communities === true);
    check("assinante TEM agenda", mapAssinante.agenda === true);
    check("assinante TEM community_members", mapAssinante.community_members === true);
    check("assinante TEM site_share", mapAssinante.site_share === true);
    check("assinante TEM atendimento_ia", mapAssinante.atendimento_ia === true);

    check("forasteiro NÃO tem whatsapp", mapForasteiro.whatsapp === false);
    // Mig 234: fora do plano E fora da vitrine, communities cai no terceiro
    // ramo — GRÁTIS. É o "todos têm acesso ao meus negócios".
    check("forasteiro TEM communities (o negócio é grátis, mig 234)", mapForasteiro.communities === true);
    check("forasteiro NÃO tem community_members", mapForasteiro.community_members === false);
    check("forasteiro NÃO tem site_share", mapForasteiro.site_share === false);
    check("forasteiro NÃO tem atendimento_ia", mapForasteiro.atendimento_ia === false);
    check("forasteiro NÃO tem agenda", mapForasteiro.agenda === false);

    // O que é grátis continua grátis para os dois — o pacote não pode ter
    // levado embora o que a base já tinha.
    check("carteira segue grátis para o forasteiro", mapForasteiro.wallet === true);
    check("serviços seguem grátis para o forasteiro", mapForasteiro.services === true);
    check("academia segue grátis para o forasteiro", mapForasteiro.fitness_academias === true);

    // E o que continua à venda avulsa segue exigindo compra.
    check("courses continua exigindo compra", mapForasteiro.courses === false);
    check("store continua exigindo compra", mapForasteiro.store === false);

    // O FunctionStoreService tem que responder o MESMO: ele delega ao
    // PlanService justamente para não existirem duas contas de posse.
    const viaLoja = await FunctionStoreService.ownershipMap(forasteiro);
    check(
      "a Loja de Funções devolve a mesma posse (fonte única)",
      viaLoja.communities === mapForasteiro.communities &&
        viaLoja.whatsapp === mapForasteiro.whatsapp &&
        viaLoja.wallet === mapForasteiro.wallet
    );

    // ─── 8. Compra vitalícia vence o plano ────────────────────────────────
    //
    // Vender vitalício e depois exigir assinatura da mesma pessoa seria retomar
    // o que já foi pago. Em produção existe UMA compra assim (communities).
    console.log("\n[8] Grandfather do vitalício");
    await client.query("SAVEPOINT sp_vitalicio");
    await client.query(
      `INSERT INTO public.tb_user_function_purchase
              (id_user, feature_key, status, amount_cents, payment_provider, paid_at)
            VALUES ($1, 'communities', 'paid', 990, 'admin_grant', NOW())`,
      [forasteiro]
    );
    const comVitalicio = await PlanService.hasFeature(forasteiro, "communities");
    check("quem comprou vitalício mantém a função sem assinar", comVitalicio === true);
    const mapVitalicio = await PlanService.ownershipMap(forasteiro, USER_FEATURE_KEYS);
    check("e o mapa concorda", mapVitalicio.communities === true);
    check("mas isso não lhe dá o resto do plano", mapVitalicio.whatsapp === false && mapVitalicio.site_share === false);
    await client.query("ROLLBACK TO SAVEPOINT sp_vitalicio");

    // ─── 9. Plano desativado solta as chaves ──────────────────────────────
    //
    // Plano desligado no admin não pode deixar a função inalcançável para todo
    // mundo — inclusive para quem assinava. A chave volta ao estado anterior.
    console.log("\n[9] Plano desativado");
    await client.query("SAVEPOINT sp_off");
    await client.query("UPDATE public.tb_plan SET is_active = FALSE WHERE slug = 'profissional'");
    const semPlanoAtivo = await PlanStorage.featureKeysInAnyPlan(pool);
    check("nenhuma chave fica presa a plano inativo", semPlanoAtivo.length === 0, JSON.stringify(semPlanoAtivo));
    const mapSemPlano = await PlanService.ownershipMap(forasteiro, USER_FEATURE_KEYS);
    check(
      "communities volta a seguir o is_for_sale (fora de venda = grátis)",
      mapSemPlano.communities === true
    );
    await client.query("ROLLBACK TO SAVEPOINT sp_off");

    // ─── 10. A recusa diz o que fazer ─────────────────────────────────────
    console.log("\n[10] Recusa com caminho");
    const vendedor = await PlanService.planSellingFeature("whatsapp");
    check("a porta sabe qual plano vende a função", !!vendedor && vendedor.slug === "profissional");
    check("e sabe o preço para escrever na tela", vendedor && vendedor.price_cents === 5000);
    const semVendedor = await PlanService.planSellingFeature("courses");
    check("função fora de plano não inventa vendedor", semVendedor === null);

    // ─── 11. Visitante ────────────────────────────────────────────────────
    console.log("\n[11] Sem sessão");
    const anon = await PlanService.ownershipMap(null, USER_FEATURE_KEYS);
    check("visitante não tem o que é de plano", anon.whatsapp === false && anon.site_share === false);
    check("visitante vê o negócio como grátis", anon.communities === true);
    check("visitante vê o que é grátis", anon.wallet === true);
    check("visitante nunca é 'dono' do que está à venda", anon.courses === false);
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
