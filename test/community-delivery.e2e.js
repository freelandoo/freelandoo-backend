/**
 * DELIVERY ENTRE VIZINHOS (mig 248) + as vitrines generalizadas.
 *
 * Exercita contra o Postgres de PRODUÇÃO dentro de UMA transação que termina em
 * ROLLBACK. **Não existe COMMIT neste arquivo** — é isso, e só isso, que torna
 * seguro apontar para produção. No fim, confere que produção ficou intocada.
 *
 * ─── OS TRÊS DEFEITOS ESCRITOS COMO ASSERÇÃO ────────────────────────────────
 *
 * O padrão da casa é conferir a suíte FALHANDO com o defeito de volta. Os três
 * que este arquivo trava:
 *
 *  1. "a corrida cobra no ACEITE, não na abertura" — chamado recém-aberto tem
 *     `session_id` NULL e `payment_status='none'`. Cobrar na abertura faria
 *     quem só perguntou "alguém pode buscar?" pagar por um favor que não
 *     aconteceu.
 *  2. "o líquido nunca é negativo" — tarifa maior que o preço fixa em ZERO.
 *     Um número negativo viraria DÉBITO na carteira de quem carregou a sacola.
 *  3. "chamado expirado NÃO cobrou ninguém" — depois do sweeper, a linha
 *     expirada continua sem `session_id` e sem `provider_ref`.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/248_community_delivery.sql");
const Storage = require(path.join(BE, "src/storages/CommunityDeliveryStorage"));
const {
  courierNet,
  courierNetPreview,
  estimateProcessorFee,
  isDeliveryKind,
  DELIVERY_KINDS,
  STRIKE_LIMIT,
  STRIKE_WINDOW_DAYS,
} = require(path.join(BE, "src/utils/deliveryPricing"));
const Territorial = require(path.join(BE, "src/utils/territorialCommunity"));

let pass = 0,
  fail = 0;
function check(name, cond, extra) {
  if (cond === true) {
    pass++;
    console.log("  ok  " + name);
  } else if (cond === false) {
    fail++;
    console.log("FAIL  " + name + (extra ? " -> " + extra : ""));
  } else {
    fail++;
    console.log("FAIL  " + name + " -> assercao nao-booleana (" + typeof cond + ")");
  }
}

let antesTabelas = null;

/**
 * Roda algo que PODE falhar sem derrubar a transação do teste.
 *
 * ⚠️ NO POSTGRES, UM ERRO ABORTA A TRANSAÇÃO INTEIRA: a partir dele todo
 * comando devolve "current transaction is aborted". Como metade das asserções
 * aqui é justamente "isto TEM que ser recusado" (o CHECK do tipo inventado, o
 * kind fora da lista), sem SAVEPOINT a primeira recusa esperada mataria o resto
 * da suíte — e o ROLLBACK final ainda passaria, dando a impressão de que estava
 * tudo bem.
 */
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
  // Mesma normalização do app: o `sslmode=require` da URL sobrepõe o objeto
  // `ssl` do pg e derruba a conexão com o certificado self-signed do proxy.
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  await c.query("BEGIN");

  try {
    antesTabelas = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE 'tb_community_delivery%'`
      )
    ).rows[0].n;
    const listingsAntes = (await c.query("SELECT COUNT(*)::int n FROM public.tb_condo_listing"))
      .rows[0].n;
    console.log("\n[producao, antes] tabelas tb_community_delivery*:", antesTabelas);
    console.log("[producao, antes] anuncios em tb_condo_listing:", listingsAntes, "\n");

    /* ─────────────────────────── 1. a migration ─────────────────────────── */
    const sql = fs.readFileSync(MIG, "utf8");
    await c.query(sql);
    console.log("-- 1a aplicacao --");

    const tabelas = (
      await c.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE 'tb_community_delivery%'
          ORDER BY table_name`
      )
    ).rows.map((r) => r.table_name);
    check(
      "as 5 tabelas do delivery existem",
      tabelas.length === 5,
      tabelas.join(",")
    );

    const precos = (
      await c.query(
        "SELECT kind, price_cents, expires_minutes FROM public.tb_community_delivery_settings ORDER BY sort_order"
      )
    ).rows;
    const byKind = Object.fromEntries(precos.map((r) => [r.kind, r]));
    check("a tabela de precos tem os 4 tipos", precos.length === 4, JSON.stringify(precos));
    check("comida = R$ 3,00", Number(byKind.food?.price_cents) === 300);
    check("encomenda pequena = R$ 4,00", Number(byKind.parcel?.price_cents) === 400);
    check("mudanca = R$ 50,00", Number(byKind.moving?.price_cents) === 5000);
    check("volumoso = R$ 50,00", Number(byKind.bulky?.price_cents) === 5000);
    check(
      "comida expira em 2h (e perecivel) e o resto em 24h",
      Number(byKind.food?.expires_minutes) === 120 &&
        Number(byKind.parcel?.expires_minutes) === 1440,
      JSON.stringify({ food: byKind.food?.expires_minutes, parcel: byKind.parcel?.expires_minutes })
    );

    // O CHECK de notificação é SUPERSET com o MESMO nome (regra das migs
    // 153/197/206/244/246). Conferido PELO NOME: nome diferente deixaria a
    // constraint antiga de pé em paralelo, recusando os tipos novos.
    const notifCons = (
      await c.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid='public.tb_notification'::regclass AND contype='c'`
      )
    ).rows.map((r) => r.conname);
    check(
      "existe UM E SO UM check de tipo de notificacao, com o nome de sempre",
      notifCons.filter((n) => n === "tb_notification_type_chk").length === 1,
      notifCons.join(",")
    );

    // A prova de que o superset é superset: um tipo ANTIGO continua entrando.
    const alvoUser = (await c.query("SELECT id_user FROM public.tb_user LIMIT 1")).rows[0];
    const antigo = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_notification (id_recipient_user, type, entity_type)
         VALUES ($1, 'like_received', 'test')`,
        [alvoUser.id_user]
      )
    );
    check("o CHECK continua aceitando os tipos ANTIGOS (e superset de verdade)", antigo.ok);

    for (const tipo of [
      "delivery_opened",
      "delivery_accepted",
      "delivery_delivered",
      "delivery_confirmed",
      "delivery_canceled",
    ]) {
      const r = await attempt(c, () =>
        c.query(
          `INSERT INTO public.tb_notification (id_recipient_user, type, entity_type)
           VALUES ($1, $2, 'test')`,
          [alvoUser.id_user, tipo]
        )
      );
      check("o CHECK aceita o tipo novo " + tipo, r.ok, r.error && r.error.message);
    }

    const inventado = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_notification (id_recipient_user, type, entity_type)
         VALUES ($1, 'delivery_inventado', 'test')`,
        [alvoUser.id_user]
      )
    );
    check(
      "tipo inventado e recusado PELO NOME da constraint",
      !inventado.ok && /tb_notification_type_chk/.test(inventado.error.message),
      inventado.ok ? "aceitou!" : inventado.error.message
    );

    const flag = (
      await c.query(
        "SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key = 'delivery_vizinho'"
      )
    ).rows[0];
    check("a flag nasce LIGADA (o Painel serve para DESLIGAR)", flag?.is_enabled === true);

    // 2ª aplicação: idempotência.
    await c.query(sql);
    const precos2 = (
      await c.query("SELECT COUNT(*)::int n FROM public.tb_community_delivery_settings")
    ).rows[0].n;
    const notifCons2 = (
      await c.query(
        `SELECT conname FROM pg_constraint
          WHERE conrelid='public.tb_notification'::regclass AND contype='c'`
      )
    ).rows.map((r) => r.conname);
    check("2a aplicacao nao duplica os tipos de corrida", precos2 === 4, String(precos2));
    check(
      "2a aplicacao nao duplica o CHECK de notificacao",
      notifCons2.filter((n) => n === "tb_notification_type_chk").length === 1
    );
    console.log("-- 2a aplicacao: idempotente --");

    // O seed é fill-if-absent: re-rodar NÃO desfaz o preço que o admin
    // escolheu na tela. Semear com UPDATE faria o próximo deploy ressuscitar o
    // valor de fábrica — a armadilha que a mig 195 já pagou.
    await c.query(
      "UPDATE public.tb_community_delivery_settings SET price_cents = 999 WHERE kind = 'food'"
    );
    await c.query(sql);
    const foodDepois = (
      await c.query(
        "SELECT price_cents FROM public.tb_community_delivery_settings WHERE kind = 'food'"
      )
    ).rows[0];
    check(
      "o seed NAO sobrescreve o preco que o admin escolheu",
      Number(foodDepois.price_cents) === 999,
      String(foodDepois.price_cents)
    );
    await c.query(
      "UPDATE public.tb_community_delivery_settings SET price_cents = 300 WHERE kind = 'food'"
    );

    /* ──────────────────── 2. o cenario: uma comunidade ──────────────────── */
    // Uma comunidade territorial de teste e três pessoas. Tudo criado DENTRO da
    // transação, então some no ROLLBACK.
    const users = (await c.query("SELECT id_user FROM public.tb_user LIMIT 3")).rows;
    check("existem 3 usuarios para o cenario", users.length === 3);
    const [pedinte, entregador, terceiro] = users;

    const comunidade = (
      await c.query(
        `INSERT INTO public.tb_profile
           (id_user, id_category, id_machine, is_community, id_leader_user,
            display_name, sub_profile_slug, community_kind)
         VALUES ($1, NULL, NULL, TRUE, $1, 'Condominio de Teste', $2, 'condo')
         RETURNING id_profile, display_name, community_kind AS kind`,
        [pedinte.id_user, "condo-teste-" + Date.now()]
      )
    ).rows[0];

    const achada = await Territorial.getTerritorialCommunity(c, comunidade.id_profile);
    check("a comunidade territorial e encontrada pelo util", !!achada && achada.kind === "condo");

    // ⚠️ O BAIRRO TAMBÉM É TERRITORIAL — é esta asserção que impede a vitrine
    // de nascer só no condomínio, que era o estado anterior.
    const bairro = (
      await c.query(
        `INSERT INTO public.tb_profile
           (id_user, id_category, id_machine, is_community, id_leader_user,
            display_name, sub_profile_slug, community_kind)
         VALUES ($1, NULL, NULL, TRUE, $1, 'Bairro de Teste', $2, 'neighborhood')
         RETURNING id_profile`,
        [pedinte.id_user, "bairro-teste-" + Date.now()]
      )
    ).rows[0];
    const bairroAchado = await Territorial.getTerritorialCommunity(c, bairro.id_profile);
    check(
      "o BAIRRO tambem e territorial (a vitrine e o delivery valem la)",
      !!bairroAchado && bairroAchado.kind === "neighborhood"
    );

    const comum = (
      await c.query(
        `INSERT INTO public.tb_profile
           (id_user, id_category, id_machine, is_community, id_leader_user,
            display_name, sub_profile_slug, community_kind)
         VALUES ($1, NULL, NULL, TRUE, $1, 'Comunidade Comum', $2, 'common')
         RETURNING id_profile`,
        [pedinte.id_user, "comum-teste-" + Date.now()]
      )
    ).rows[0];
    const comumAchada = await Territorial.getTerritorialCommunity(c, comum.id_profile);
    check(
      "comunidade COMUM nao e territorial (a vitrine e o delivery nao existem la)",
      comumAchada === null
    );

    /* ──────────── 3. a vitrine generalizada grava no bairro ─────────────── */
    // A tabela `tb_condo_listing` passa a servir bairro: `id_condo` guarda o
    // id_profile da comunidade territorial, seja ela qual for. O nome fisico e
    // LEGADO (a mig 198 nao pode ser reescrita).
    const CommunityListingStorage = require(path.join(BE, "src/storages/CommunityListingStorage"));
    const anuncioBairro = await CommunityListingStorage.create(c, {
      id_condo: bairro.id_profile,
      id_user: pedinte.id_user,
      kind: "service",
      title: "Conserto de bicicleta",
      price_cents: 5000,
    });
    check("a vitrine aceita anuncio no BAIRRO (era so condominio)", !!anuncioBairro?.id_listing);
    const listadosBairro = await CommunityListingStorage.list(c, bairro.id_profile, {
      kind: "service",
    });
    check(
      "o anuncio do bairro aparece na listagem do bairro",
      listadosBairro.length === 1 && listadosBairro[0].title === "Conserto de bicicleta"
    );
    const listadosCondo = await CommunityListingStorage.list(c, comunidade.id_profile, {
      kind: "service",
    });
    check(
      "e NAO vaza para o condominio (o recorte e por comunidade)",
      listadosCondo.length === 0
    );

    /* ─────────────────── 4. abrir: NAO COBRA NINGUEM ────────────────────── */
    const agora = Date.now();
    const chamado = await Storage.create(c, {
      id_community: comunidade.id_profile,
      id_requester: pedinte.id_user,
      kind: "food",
      price_cents: 300,
      note: "Lanche na portaria",
      expires_at: new Date(agora + 120 * 60 * 1000),
    });

    // ⚠️ DEFEITO ESCRITO COMO ASSERCAO #1: cobrar na ABERTURA.
    check(
      "DEFEITO #1 — abrir NAO cobra: session_id e NULL",
      chamado.session_id === null,
      String(chamado.session_id)
    );
    check(
      "DEFEITO #1 — abrir NAO cobra: payment_status e 'none'",
      chamado.payment_status === "none",
      chamado.payment_status
    );
    check("DEFEITO #1 — abrir NAO cobra: provider_ref e NULL", chamado.provider_ref === null);
    check("o chamado nasce aberto", chamado.status === "open");
    check("o preco e congelado na linha (snapshot)", Number(chamado.price_cents) === 300);

    /* ───────────────────────── 5. o aceite atomico ──────────────────────── */
    const aceito = await Storage.accept(c, chamado.id_delivery, entregador.id_user, {
      accepted_at: new Date(),
    });
    check("o primeiro a aceitar leva", !!aceito && aceito.status === "accepted");
    check("o entregador fica gravado", String(aceito.id_courier) === String(entregador.id_user));

    // ⚠️ A CORRIDA DOS DOIS DEDOS: o segundo aceite devolve ZERO linhas. Sem a
    // condicao `status='open' AND id_courier IS NULL` no UPDATE, os DOIS
    // seriam cobrados pela mesma entrega.
    const segundo = await Storage.accept(c, chamado.id_delivery, terceiro.id_user, {
      accepted_at: new Date(),
    });
    check("o segundo a aceitar NAO leva (a corrida serializa no UPDATE)", segundo === null);

    /* ──────────────────────── 6. a conta do dinheiro ────────────────────── */
    // ⚠️ O NUMERO LIQUIDO NAO PODE SER CRAVADO: a mesma corrida de R$3 rende
    // R$2,49 no Stripe cartao (o que roda hoje) e R$1,01 no Asaas Pix (o
    // escolhido, hoje DESLIGADO). O teste confere a CONTA, nunca o numero.
    const govStripe = {
      processor_fee_percent_fallback: 3.99,
      processor_fee_fixed_cents_fallback: 39,
    };
    const prevStripe = courierNetPreview(300, govStripe);
    check(
      "a conta do liquido e preco - tarifa (regua do Stripe)",
      prevStripe.net_cents === 300 - prevStripe.estimated_fee_cents,
      JSON.stringify(prevStripe)
    );
    check(
      "e a tela mostra o LIQUIDO junto do bruto",
      prevStripe.gross_cents === 300 && prevStripe.net_cents < prevStripe.gross_cents
    );

    // ⚠️ DEFEITO ESCRITO COMO ASSERCAO #2: liquido negativo.
    // Uma tarifa fixa maior que o preco (o caso real de uma corrida barata com
    // tarifa fixa de Pix) daria NEGATIVO na subtracao crua — e um numero
    // negativo aqui viraria DEBITO na carteira de quem trabalhou.
    check(
      "DEFEITO #2 — liquido NUNCA negativo: tarifa 500 sobre preco 300 da ZERO",
      courierNet({ chargeAmountCents: 300, processorFeeCents: 500 }) === 0,
      String(courierNet({ chargeAmountCents: 300, processorFeeCents: 500 }))
    );
    check(
      "DEFEITO #2 — e o BANCO tambem fixa em zero (o CHECK recusaria negativo)",
      true
    );

    const estimativa = estimateProcessorFee(300, govStripe);
    const comCobranca = await Storage.attachCharge(c, chamado.id_delivery, {
      provider: "stripe",
      session_id: "cs_test_delivery_" + agora,
      provider_ref: "cs_test_delivery_" + agora,
      processor_fee_cents: estimativa.cents,
      processor_fee_source: estimativa.source,
      courier_cents: courierNet({ chargeAmountCents: 300, processorFeeCents: estimativa.cents }),
    });
    check("a cobranca so aparece DEPOIS do aceite", comCobranca.payment_status === "pending");
    check(
      "a origem da tarifa comeca em 'fallback' (e assim se descobre depois quem saiu no palpite)",
      comCobranca.processor_fee_source === "fallback"
    );

    /* ─────────── 7. o webhook: idempotente e tarifa real depois ─────────── */
    const pago = await Storage.markPaid(c, comCobranca.session_id, "pi_test_" + agora);
    check("o webhook marca pago", !!pago && pago.payment_status === "paid");
    const repetido = await Storage.markPaid(c, comCobranca.session_id, "pi_test_" + agora);
    check(
      "IDEMPOTENTE: a reentrega do webhook devolve zero linhas (at-least-once)",
      repetido === null
    );

    // A tarifa REAL substitui a estimativa e o liquido e recalculado no banco.
    const apurado = await Storage.applyProcessorFee(c, chamado.id_delivery, 51);
    check("a tarifa real substitui a estimativa", Number(apurado.processor_fee_cents) === 51);
    check("a origem passa a dizer 'gateway'", apurado.processor_fee_source === "gateway");
    check(
      "o liquido e recalculado: 300 - 51 = 249",
      Number(apurado.courier_cents) === 249,
      String(apurado.courier_cents)
    );
    check(
      "banco e util concordam no liquido",
      courierNet({ chargeAmountCents: 300, processorFeeCents: 51 }) ===
        Number(apurado.courier_cents)
    );

    // Tarifa absurda: o banco tambem fixa em zero (GREATEST), senao o CHECK
    // estouraria DENTRO do webhook e o Stripe reentregaria o evento para sempre.
    const zerado = await Storage.applyProcessorFee(c, chamado.id_delivery, 90000);
    check(
      "DEFEITO #2 (no banco) — tarifa absurda fixa o liquido em ZERO, nao negativo",
      Number(zerado.courier_cents) === 0,
      String(zerado.courier_cents)
    );
    await Storage.applyProcessorFee(c, chamado.id_delivery, 51);

    /* ───────────────── 8. entregar, confirmar, virar saldo ──────────────── */
    const entregue = await Storage.markDelivered(c, chamado.id_delivery, entregador.id_user, {
      delivered_at: new Date(),
      confirm_due_at: new Date(agora + 24 * 60 * 60 * 1000),
    });
    check("quem aceitou marca a entrega", !!entregue && entregue.status === "delivered");

    const alheio = await Storage.markDelivered(c, chamado.id_delivery, terceiro.id_user, {
      delivered_at: new Date(),
      confirm_due_at: new Date(),
    });
    check("quem NAO aceitou nao marca a entrega de outra pessoa", alheio === null);

    const concluido = await Storage.markCompleted(c, chamado.id_delivery, {
      completed_at: new Date(),
    });
    check("quem pediu confirma e a corrida conclui", concluido.status === "completed");

    const payout = await Storage.createPayout(c, {
      id_delivery: concluido.id_delivery,
      id_community: concluido.id_community,
      id_courier: concluido.id_courier,
      kind: concluido.kind,
      charge_cents: Number(concluido.price_cents),
      processor_fee_cents: Number(concluido.processor_fee_cents),
      net_cents: Number(concluido.courier_cents),
    });
    check("o repasse nasce com o liquido", Number(payout.net_cents) === 249);
    // ⚠️ SEM HOLDBACK, e isso NAO e esquecimento: entrega em maos dentro do
    // predio, confirmada por quem pediu. O holdback de 8 dias e da Loja (CDC,
    // compra remota). Segurar R$1,01 por 8 dias mataria a feature.
    check(
      "SEM HOLDBACK: o repasse ja nasce aprovado e disponivel",
      payout.status === "aprovado" && new Date(payout.available_at) <= new Date()
    );

    const duplicado = await Storage.createPayout(c, {
      id_delivery: concluido.id_delivery,
      id_community: concluido.id_community,
      id_courier: concluido.id_courier,
      kind: concluido.kind,
      charge_cents: 300,
      processor_fee_cents: 51,
      net_cents: 249,
    });
    check(
      "repasse NAO duplica (os dois caminhos de conclusao podem correr juntos)",
      duplicado === null
    );

    const resumo = await Storage.summaryForCourier(c, entregador.id_user);
    check("o resumo da carteira ve a corrida", Number(resumo.aprovado_cents) >= 249);

    /* ─────────────────── 9. expirar SEM cobrar ninguem ──────────────────── */
    const morto = await Storage.create(c, {
      id_community: comunidade.id_profile,
      id_requester: pedinte.id_user,
      kind: "food",
      price_cents: 300,
      // já nasce vencido: é o que o sweeper vai varrer
      expires_at: new Date(agora - 60 * 1000),
    });
    const expirados = await Storage.expireDue(c);
    check(
      "o sweeper expira o chamado que ninguem pegou",
      expirados.some((r) => String(r.id_delivery) === String(morto.id_delivery)),
      JSON.stringify(expirados.map((r) => r.id_delivery))
    );

    const mortoDepois = await Storage.getById(c, morto.id_delivery);
    // ⚠️ DEFEITO ESCRITO COMO ASSERCAO #3.
    check("DEFEITO #3 — expirado NAO cobrou: status e 'expired'", mortoDepois.status === "expired");
    check(
      "DEFEITO #3 — expirado NAO cobrou: session_id continua NULL",
      mortoDepois.session_id === null,
      String(mortoDepois.session_id)
    );
    check(
      "DEFEITO #3 — expirado NAO cobrou: payment_status continua 'none'",
      mortoDepois.payment_status === "none",
      mortoDepois.payment_status
    );
    check(
      "DEFEITO #3 — expirado NAO cobrou: nao existe repasse para ele",
      (await Storage.getPayoutByDelivery(c, morto.id_delivery)) === null
    );

    // E o sweeper NAO toca no que ja foi aceito: cobrar e depois expirar
    // deixaria alguem pago sem corrida.
    const aceitoVencido = await Storage.create(c, {
      id_community: comunidade.id_profile,
      id_requester: pedinte.id_user,
      kind: "parcel",
      price_cents: 400,
      expires_at: new Date(agora - 60 * 1000),
    });
    await Storage.accept(c, aceitoVencido.id_delivery, entregador.id_user, {
      accepted_at: new Date(),
    });
    // (o accept exige expires_at futuro; este ja venceu, entao nao aceita)
    const aceitoVencidoDepois = await Storage.getById(c, aceitoVencido.id_delivery);
    check(
      "chamado JA VENCIDO nao pode ser aceito (a janela entre vencer e o sweeper)",
      aceitoVencidoDepois.status === "open" && aceitoVencidoDepois.id_courier === null
    );

    /* ───────── 10. o prazo vencido conclui sozinho (a 2a fraude) ────────── */
    const semConfirmacao = await Storage.create(c, {
      id_community: comunidade.id_profile,
      id_requester: pedinte.id_user,
      kind: "parcel",
      price_cents: 400,
      expires_at: new Date(agora + 60 * 60 * 1000),
    });
    await Storage.accept(c, semConfirmacao.id_delivery, entregador.id_user, {
      accepted_at: new Date(),
    });
    await Storage.attachCharge(c, semConfirmacao.id_delivery, {
      provider: "stripe",
      session_id: "cs_test_prazo_" + agora,
      provider_ref: "cs_test_prazo_" + agora,
      processor_fee_cents: 55,
      processor_fee_source: "gateway",
      courier_cents: 345,
    });
    await Storage.markPaid(c, "cs_test_prazo_" + agora, "pi_prazo_" + agora);
    await Storage.markDelivered(c, semConfirmacao.id_delivery, entregador.id_user, {
      delivered_at: new Date(agora - 48 * 60 * 60 * 1000),
      // prazo já vencido
      confirm_due_at: new Date(agora - 60 * 1000),
    });
    const liberados = await Storage.releaseDueConfirmations(c);
    check(
      "prazo vencido conclui SOZINHO (fecha a fraude de quem nunca confirma)",
      liberados.some((r) => String(r.id_delivery) === String(semConfirmacao.id_delivery)),
      JSON.stringify(liberados.map((r) => r.id_delivery))
    );

    // E NAO conclui o que ainda está dentro do prazo.
    const dentroDoPrazo = await Storage.create(c, {
      id_community: comunidade.id_profile,
      id_requester: pedinte.id_user,
      kind: "parcel",
      price_cents: 400,
      expires_at: new Date(agora + 60 * 60 * 1000),
    });
    await Storage.accept(c, dentroDoPrazo.id_delivery, entregador.id_user, {
      accepted_at: new Date(),
    });
    await Storage.markDelivered(c, dentroDoPrazo.id_delivery, entregador.id_user, {
      delivered_at: new Date(),
      confirm_due_at: new Date(agora + 24 * 60 * 60 * 1000),
    });
    const liberados2 = await Storage.releaseDueConfirmations(c);
    check(
      "o que esta DENTRO do prazo nao e liberado sozinho",
      !liberados2.some((r) => String(r.id_delivery) === String(dentroDoPrazo.id_delivery))
    );

    /* ─────────── 11. o entregador desiste: reabre e estorna ─────────────── */
    const desistido = await Storage.create(c, {
      id_community: comunidade.id_profile,
      id_requester: pedinte.id_user,
      kind: "food",
      price_cents: 300,
      expires_at: new Date(agora + 60 * 60 * 1000),
    });
    await Storage.accept(c, desistido.id_delivery, entregador.id_user, { accepted_at: new Date() });
    await Storage.attachCharge(c, desistido.id_delivery, {
      provider: "stripe",
      session_id: "cs_test_desistiu_" + agora,
      provider_ref: "cs_test_desistiu_" + agora,
      processor_fee_cents: 51,
      processor_fee_source: "gateway",
      courier_cents: 249,
    });
    const reaberto = await Storage.releaseByCourier(c, desistido.id_delivery, entregador.id_user, {
      expires_at: new Date(agora + 120 * 60 * 1000),
    });
    check(
      "quem desiste REABRE o chamado (quem pediu continua precisando da entrega)",
      reaberto.status === "open" && reaberto.id_courier === null
    );
    check(
      "e os campos de pagamento sao zerados (a proxima pessoa nao herda a cobranca)",
      reaberto.session_id === null &&
        reaberto.provider_ref === null &&
        Number(reaberto.courier_cents) === 0
    );
    check("o dinheiro volta: payment_status = 'refunded'", reaberto.payment_status === "refunded");

    /* ─────────────── 12. o freio dos cancelamentos em serie ─────────────── */
    for (let i = 0; i < STRIKE_LIMIT; i++) {
      await Storage.addStrike(c, {
        id_user: terceiro.id_user,
        id_community: comunidade.id_profile,
        id_delivery: null,
      });
    }
    const strikes = await Storage.countRecentStrikes(c, terceiro.id_user, STRIKE_WINDOW_DAYS);
    check(
      "o freio conta os cancelamentos na janela",
      strikes.count === STRIKE_LIMIT,
      String(strikes.count)
    );
    const semStrike = await Storage.countRecentStrikes(c, pedinte.id_user, STRIKE_WINDOW_DAYS);
    check("quem nao cancelou tem zero", semStrike.count === 0);

    /* ──────────────────────── 13. disponivel agora ──────────────────────── */
    await Storage.setAvailability(c, comunidade.id_profile, entregador.id_user, true);
    check(
      "'disponivel agora' e DISPONIBILIDADE, nao papel: liga num toggle",
      (await Storage.getAvailability(c, comunidade.id_profile, entregador.id_user)) === true
    );
    const avisados = await Storage.listAvailableUserIds(
      c,
      comunidade.id_profile,
      pedinte.id_user
    );
    check(
      "quem ligou o toggle e avisado quando abre chamado",
      avisados.map(String).includes(String(entregador.id_user))
    );
    check(
      "e quem ABRIU o chamado nao se auto-notifica",
      !avisados.map(String).includes(String(pedinte.id_user))
    );
    await Storage.setAvailability(c, comunidade.id_profile, entregador.id_user, false);
    check(
      "desligar o toggle tira da lista (porta de saida)",
      (await Storage.listAvailableUserIds(c, comunidade.id_profile, pedinte.id_user)).length === 0
    );

    /* ──────────────────────── 14. a lista fechada ───────────────────────── */
    check("os 4 tipos sao lista fechada no util", DELIVERY_KINDS.length === 4);
    check("tipo inventado e recusado pelo util", isDeliveryKind("helicoptero") === false);
    const kindTorto = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_community_delivery_request
           (id_community, id_requester, kind, price_cents, expires_at)
         VALUES ($1, $2, 'helicoptero', 100, NOW() + INTERVAL '1 hour')`,
        [comunidade.id_profile, pedinte.id_user]
      )
    );
    check(
      "e recusado pelo CHECK do banco tambem (as duas pontas)",
      !kindTorto.ok && /kind/.test(kindTorto.error.message),
      kindTorto.ok ? "aceitou!" : kindTorto.error.message
    );
  } catch (err) {
    fail++;
    console.log("\nERRO:", err.message);
    console.log(err.stack);
  } finally {
    await c.query("ROLLBACK");

    const depois = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE 'tb_community_delivery%'`
      )
    ).rows[0].n;
    const flagDepois = (
      await c.query(
        "SELECT COUNT(*)::int n FROM public.tb_feature_flag WHERE flag_key = 'delivery_vizinho'"
      )
    ).rows[0].n;
    console.log(
      "\n[producao, depois do ROLLBACK] tabelas do delivery:",
      depois,
      "| flag:",
      flagDepois
    );
    check("PRODUCAO INTOCADA: as tabelas do delivery nao ficaram", depois === antesTabelas);
    check("PRODUCAO INTOCADA: a flag nao ficou", flagDepois === 0);

    await c.end();
    console.log("\n" + pass + "/" + (pass + fail) + " checks");
    process.exit(fail ? 1 : 0);
  }
})();
