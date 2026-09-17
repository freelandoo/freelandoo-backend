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
const MIG249 = path.join(BE, "src/databases/migrations/249_community_listing_order.sql");
// ⚠️ A 252 entra aqui porque a VITRINE passou a ser mensal: `Storage.list`
// filtra por `paid_until`, e sem a coluna a leitura estoura dentro desta
// transação. Não é defeito do delivery — é a suite precisando do mundo novo,
// como a da 242 passou a aplicar a 243.
const MIG252 = path.join(BE, "src/databases/migrations/252_listing_monthly.sql");
const OrderStorage = require(path.join(BE, "src/storages/CommunityListingOrderStorage"));
const { computeOrder, platformFeeFor, splitProcessorFee } = require(
  path.join(BE, "src/utils/listingOrder")
);
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
let antesTabelas249 = null;
let antesFlags = null;

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
    // ⚠️ O ESTADO É MEDIDO ANTES, E NO FIM SE EXIGE VOLTAR A ELE — nunca
    // "a tabela não existe". A mig 248 SUBIU PARA PRODUÇÃO no meio desta
    // própria sessão, e uma asserção escrita como "depois do ROLLBACK não há
    // tabela de delivery" passou a ser FALSA por motivo legítimo. É a lição já
    // paga nas suítes das migs 241/246: asserção sobre "o banco não tem X"
    // nasce com prazo de validade quando X é uma migration que vai subir.
    antesTabelas = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE 'tb_community_delivery%'`
      )
    ).rows[0].n;
    antesTabelas249 = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE 'tb_community_listing%'`
      )
    ).rows[0].n;
    antesFlags = (
      await c.query(
        `SELECT COUNT(*)::int n FROM public.tb_feature_flag
          WHERE flag_key IN ('delivery_vizinho', 'vitrine_venda')`
      )
    ).rows[0].n;
    const listingsAntes = (await c.query("SELECT COUNT(*)::int n FROM public.tb_condo_listing"))
      .rows[0].n;
    console.log("\n[producao, antes] tabelas tb_community_delivery*:", antesTabelas);
    console.log("[producao, antes] anuncios em tb_condo_listing:", listingsAntes, "\n");

    /* ─────────────────────────── 1. a migration ─────────────────────────── */
    const sql = fs.readFileSync(MIG, "utf8");
    await c.query(sql);
    const sql249 = fs.readFileSync(MIG249, "utf8");
    await c.query(sql249);
    const sql252 = fs.readFileSync(MIG252, "utf8");
    await c.query(sql252);
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
    await c.query(sql249);
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
    // ⚠️ RE-APLICAR A 248 AQUI REVERTE O CHECK DE NOTIFICAÇÃO PARA O DELA.
    // O CHECK é um SUPERSET reescrito INTEIRO a cada migration que o toca, e a
    // 248 (mais velha) não conhece os tipos que a 249 acrescentou. Rodar a
    // velha depois da nova apaga a lista nova — e o sintoma é o INSERT de um
    // tipo novo sendo recusado por uma constraint que "deveria" aceitá-lo.
    //
    // Em PRODUÇÃO isso não acontece: o runner aplica cada migration UMA vez, em
    // ordem. Aqui acontece porque a suíte re-aplica de propósito, para provar
    // idempotência — então ela precisa refazer a ordem real logo em seguida.
    await c.query(sql249);
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

    // ⚠️ A MIG 252 FEZ ESTA ASSERÇÃO ENVELHECER, e nao e regressao: o anuncio
    // nasce RASCUNHO e so entra na vitrine quando a mensalidade e paga. A
    // suite passou a pagar antes de exigir que ele apareca — o que ela prova
    // (a vitrine serve o BAIRRO, nao so o condominio) continua igual, e de
    // quebra ela passa a provar que a cobranca vale nas duas modalidades.
    const rascunhoBairro = await CommunityListingStorage.list(c, bairro.id_profile, {
      kind: "service",
    });
    check(
      "no BAIRRO o anuncio tambem nasce fora da vitrine ate ser pago (mig 252)",
      rascunhoBairro.every((l) => String(l.id_listing) !== String(anuncioBairro.id_listing))
    );
    await CommunityListingStorage.extendPaidUntil(c, anuncioBairro.id_listing, 1);

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

    /* ═══════════ 15. SUB-PROJETO 3: VENDER DENTRO DA VITRINE ═══════════════ */

    // A regua da venda nasce com taxa ZERO — decisao registrada: o Alex pediu
    // o checkout e nunca falou em taxa sobre a venda entre vizinhos.
    const regua = (
      await c.query(
        `SELECT platform_fee_cents, platform_fee_percent, holdback_days, confirm_days, is_active
           FROM public.tb_community_listing_settings WHERE id = 1`
      )
    ).rows[0];
    check("a taxa da venda nasce em ZERO", Number(regua.platform_fee_cents) === 0 &&
      Number(regua.platform_fee_percent) === 0, JSON.stringify(regua));
    // ⚠️ AQUI O HOLDBACK VOLTA — e e o OPOSTO do delivery, de proposito (CDC).
    check("o HOLDBACK da venda e de 8 dias (CDC), ao contrario do delivery",
      Number(regua.holdback_days) === 8, String(regua.holdback_days));

    const flagVenda = (
      await c.query("SELECT is_enabled FROM public.tb_feature_flag WHERE flag_key = 'vitrine_venda'")
    ).rows[0];
    check("a flag da venda nasce LIGADA", flagVenda?.is_enabled === true);

    for (const tipo of [
      "listing_order_new", "listing_order_paid", "listing_order_confirmed",
      "listing_order_disputed", "listing_order_resolved",
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
    // O superset continua superset DEPOIS da 249: o tipo do delivery (248) tem
    // que seguir entrando.
    const aindaAceita = await attempt(c, () =>
      c.query(
        `INSERT INTO public.tb_notification (id_recipient_user, type, entity_type)
         VALUES ($1, 'delivery_opened', 'test')`,
        [alvoUser.id_user]
      )
    );
    check("a 249 NAO derrubou os tipos da 248 (superset em cadeia)", aindaAceita.ok);

    /* ── a conta do dinheiro, com o add-on "+R$3" ───────────────────────── */
    // ⚠️ AS QUATRO PARTES FECHAM O QUE O COMPRADOR PAGOU. E a identidade que
    // faz um erro de conta aparecer como numero em vez de sumir na diferenca.
    const contaComEntrega = computeOrder({
      priceCents: 5000, deliveryCents: 300, platformFeeCents: 0, processorFeeCents: 250,
    });
    check("o total cobrado e preco + entrega", contaComEntrega.amount_cents === 5300);
    check(
      "as QUATRO partes fecham o que o comprador pagou",
      contaComEntrega.platform_fee_cents +
        contaComEntrega.processor_fee_cents +
        contaComEntrega.seller_cents +
        contaComEntrega.courier_cents === contaComEntrega.amount_cents,
      JSON.stringify(contaComEntrega)
    );
    // A tarifa e RATEADA: jogada inteira no entregador, uma corrida de R$3
    // dentro de uma compra de R$200 viraria prejuizo.
    check(
      "a tarifa do gateway e RATEADA entre produto e entrega",
      contaComEntrega.delivery_fee_cents > 0 &&
        contaComEntrega.delivery_fee_cents < contaComEntrega.processor_fee_cents,
      JSON.stringify(contaComEntrega)
    );
    check(
      "e as duas partes da tarifa somam exatamente a tarifa (a sobra tem dono)",
      contaComEntrega.price_fee_cents + contaComEntrega.delivery_fee_cents ===
        contaComEntrega.processor_fee_cents
    );
    // Sem add-on, a tarifa inteira e do produto.
    const semEntrega = computeOrder({
      priceCents: 5000, deliveryCents: 0, platformFeeCents: 0, processorFeeCents: 250,
    });
    check("sem add-on, a tarifa inteira fica com o produto",
      semEntrega.delivery_fee_cents === 0 && semEntrega.price_fee_cents === 250);
    check("sem add-on nao ha entregador para pagar", semEntrega.courier_cents === 0);

    // ⚠️ NENHUM LIQUIDO NEGATIVO, tambem aqui.
    const precoBaixo = computeOrder({
      priceCents: 100, deliveryCents: 0, platformFeeCents: 0, processorFeeCents: 199,
    });
    check("produto de R$1 com tarifa de R$1,99 NAO deixa o vendedor devendo",
      precoBaixo.seller_cents === 0, String(precoBaixo.seller_cents));
    // A tarifa tambem e limitada ao que foi cobrado: o gateway nao pode ficar
    // com mais do que entrou. Sem esse teto, a conta registraria uma tarifa
    // maior que a venda e as quatro partes deixariam de fechar.
    check("a tarifa nunca passa do que o comprador pagou",
      precoBaixo.processor_fee_cents === 100, String(precoBaixo.processor_fee_cents));
    check("e as quatro partes continuam fechando mesmo no caso extremo",
      precoBaixo.platform_fee_cents + precoBaixo.processor_fee_cents +
        precoBaixo.seller_cents + precoBaixo.courier_cents === precoBaixo.amount_cents,
      JSON.stringify(precoBaixo));

    // A taxa nunca engole o preco inteiro.
    check("taxa maior que o preco e limitada ao preco",
      platformFeeFor(1000, { platform_fee_cents: 99999, platform_fee_percent: 0, is_active: true }) === 1000);
    check("taxa desligada e zero",
      platformFeeFor(1000, { platform_fee_cents: 500, platform_fee_percent: 0, is_active: false }) === 0);
    // O rateio de uma tarifa que nao divide redondo continua somando a tarifa.
    const rateio = splitProcessorFee({ processorFeeCents: 7, priceCents: 333, deliveryCents: 300 });
    check("o rateio com arredondamento ainda soma a tarifa exata",
      rateio.price_fee_cents + rateio.delivery_fee_cents === 7, JSON.stringify(rateio));

    /* ── o pedido, ponta a ponta ────────────────────────────────────────── */
    const anuncio = await CommunityListingStorage.create(c, {
      id_condo: comunidade.id_profile,
      id_user: entregador.id_user, // o vizinho VENDE
      kind: "product",
      title: "Bolo de cenoura",
      price_cents: 3000,
    });

    const real = computeOrder({
      priceCents: 3000, deliveryCents: 300, platformFeeCents: 0, processorFeeCents: 171,
    });

    const pedido = await OrderStorage.create(c, {
      id_listing: anuncio.id_listing,
      id_community: comunidade.id_profile,
      id_buyer: pedinte.id_user,
      id_seller: entregador.id_user,
      listing_title: anuncio.title,
      listing_kind: "product",
      price_cents: 3000,
      delivery_cents: 300,
      delivery_kind: "food",
      amount_cents: 3300,
      platform_fee_cents: 0,
      processor_fee_cents: 171,
      processor_fee_source: "fallback",
      seller_cents: real.seller_cents,
      courier_cents: real.courier_cents,
    });
    check("o pedido nasce pendente", pedido.status === "pending");
    check("o SNAPSHOT do titulo e do preco fica na linha",
      pedido.listing_title === "Bolo de cenoura" && Number(pedido.price_cents) === 3000);

    await OrderStorage.attachCharge(c, pedido.id_order, {
      provider: "stripe",
      session_id: "cs_test_order_" + agora,
      provider_ref: "cs_test_order_" + agora,
      checkout_url: "https://checkout.example/x",
    });
    const pagoPedido = await OrderStorage.markPaid(c, "cs_test_order_" + agora, "pi_order_" + agora);
    check("o webhook marca o pedido pago", !!pagoPedido && pagoPedido.status === "paid");
    const repetidoPedido = await OrderStorage.markPaid(c, "cs_test_order_" + agora, null);
    check("IDEMPOTENTE: a reentrega do webhook devolve zero linhas", repetidoPedido === null);

    // A tarifa real substitui a estimativa e OS DOIS liquidos sao recalculados.
    const ajustadoPedido = await OrderStorage.applyProcessorFee(c, pedido.id_order, {
      fee_cents: real.processor_fee_cents,
      seller_cents: real.seller_cents,
      courier_cents: real.courier_cents,
    });
    check("a origem da tarifa passa a dizer 'gateway'",
      ajustadoPedido.processor_fee_source === "gateway");
    check("os dois liquidos batem com o util",
      Number(ajustadoPedido.seller_cents) === real.seller_cents &&
      Number(ajustadoPedido.courier_cents) === real.courier_cents,
      JSON.stringify({ db: ajustadoPedido.seller_cents, util: real.seller_cents }));

    /* ── O REPASSE COM HOLDBACK (o oposto do delivery) ──────────────────── */
    const payoutVenda = await OrderStorage.createPayout(c, {
      id_order: pedido.id_order,
      id_community: comunidade.id_profile,
      id_seller: entregador.id_user,
      listing_title: "Bolo de cenoura",
      charge_cents: 3300,
      platform_fee_cents: 0,
      processor_fee_cents: real.processor_fee_cents,
      net_cents: real.seller_cents,
      available_at: new Date(agora + 8 * 86400000),
    });
    check("o repasse da VENDA nasce AGUARDANDO (holdback), nao aprovado",
      payoutVenda.status === "aguardando", payoutVenda.status);
    check("e a data de liberacao esta no FUTURO (8 dias) — o oposto do delivery",
      new Date(payoutVenda.available_at) > new Date(),
      String(payoutVenda.available_at));
    const payoutDup = await OrderStorage.createPayout(c, {
      id_order: pedido.id_order, id_community: comunidade.id_profile,
      id_seller: entregador.id_user, listing_title: "x", charge_cents: 1,
      platform_fee_cents: 0, processor_fee_cents: 0, net_cents: 1,
      available_at: new Date(),
    });
    check("repasse da venda NAO duplica", payoutDup === null);

    /* ── ⚠️ O "+R$3" ABRE UM CHAMADO JA PAGO ───────────────────────────── */
    const entregaDoPedido = await Storage.create(c, {
      id_community: comunidade.id_profile,
      id_requester: pedinte.id_user,
      kind: "food",
      price_cents: 300,
      expires_at: new Date(agora + 120 * 60 * 1000),
    });
    await c.query(
      `UPDATE public.tb_community_delivery_request
          SET id_listing_order = $2, payment_status = 'paid', provider_ref = $3,
              courier_cents = $4
        WHERE id_delivery = $1`,
      [entregaDoPedido.id_delivery, pedido.id_order, "pi_order_" + agora, real.courier_cents]
    );
    const preParaAceitar = await Storage.getById(c, entregaDoPedido.id_delivery);
    check("o chamado do add-on nasce JA PAGO", preParaAceitar.payment_status === "paid");
    check("e carrega o vinculo com o pedido",
      String(preParaAceitar.id_listing_order) === String(pedido.id_order));
    check("com o liquido ja calculado (a tarifa foi rateada no pedido)",
      Number(preParaAceitar.courier_cents) === real.courier_cents);

    // ⚠️ DEFEITO ESCRITO COMO ASSERCAO #4: cobrar DE NOVO a entrega ja paga.
    // O service sai do aceite ANTES de criar cobranca quando payment_status ja
    // e 'paid'; se alguem tirar essa saida, o vizinho paga a entrega DUAS VEZES.
    const aceitoPrePago = await Storage.accept(c, entregaDoPedido.id_delivery, entregador.id_user, {
      accepted_at: new Date(),
    });
    check("o chamado pre-pago pode ser aceito", !!aceitoPrePago);
    check(
      "DEFEITO #4 — aceite de chamado PRE-PAGO nao cria segunda cobranca: segue 'paid'",
      aceitoPrePago.payment_status === "paid",
      aceitoPrePago.payment_status
    );
    check(
      "DEFEITO #4 — e o session_id continua NULL (nao houve segundo checkout)",
      aceitoPrePago.session_id === null,
      String(aceitoPrePago.session_id)
    );

    // Devolver um chamado PRE-PAGO nao pode estornar: a cobranca e a do PEDIDO
    // inteiro, e estorna-la devolveria tambem o dinheiro do produto entregue.
    const devolvidoPrePago = await Storage.releasePrepaidByCourier(
      c, entregaDoPedido.id_delivery, entregador.id_user,
      { expires_at: new Date(agora + 120 * 60 * 1000) }
    );
    check("devolver um chamado pre-pago o reabre", devolvidoPrePago.status === "open");
    check(
      "e MANTEM o pagamento (a cobranca e a do pedido, nao da corrida)",
      devolvidoPrePago.payment_status === "paid" && devolvidoPrePago.provider_ref !== null,
      JSON.stringify({ ps: devolvidoPrePago.payment_status, ref: devolvidoPrePago.provider_ref })
    );

    /* ── a disputa CONGELA o repasse ────────────────────────────────────── */
    await OrderStorage.markDelivered(c, pedido.id_order, entregador.id_user, {
      delivered_at: new Date(agora - 60 * 1000),
      confirm_due_at: new Date(agora - 30 * 1000), // prazo ja vencido
    });
    const disputa = await OrderStorage.openDispute(c, {
      id_order: pedido.id_order,
      id_opener: pedinte.id_user,
      reason: "not_received",
      detail: "nao chegou",
    });
    check("a disputa abre", !!disputa && disputa.status === "open");
    const disputaDupla = await OrderStorage.openDispute(c, {
      id_order: pedido.id_order, id_opener: pedinte.id_user, reason: "other", detail: null,
    });
    check("apertar duas vezes NAO empilha casos (indice parcial + ON CONFLICT)",
      String(disputaDupla.id_dispute) === String(disputa.id_dispute));
    await OrderStorage.markDisputed(c, pedido.id_order);

    await c.query(
      "UPDATE public.tb_community_listing_payout SET available_at = NOW() - INTERVAL '1 day' WHERE id_order = $1",
      [pedido.id_order]
    );

    // Primeiro o caso simples: pedido em `disputed` nao e liberado porque o
    // sweeper exige `completed`.
    const liberadosVenda = await OrderStorage.releaseDuePayouts(c);
    check(
      "o sweeper NAO libera o repasse de um pedido EM DISPUTA",
      !liberadosVenda.some((r) => String(r.id_payout) === String(payoutVenda.id_payout)),
      JSON.stringify(liberadosVenda)
    );
    const autoConcluidos = await OrderStorage.releaseDueConfirmations(c);
    check(
      "e o prazo vencido tambem NAO conclui um pedido em disputa",
      !autoConcluidos.some((r) => String(r.id_order) === String(pedido.id_order))
    );

    // ⚠️ DEFEITO ESCRITO COMO ASSERCAO #5 — E O CASO CERTO E ESTE.
    //
    // O pedido CONCLUIDO com disputa VIVA. Ele existe porque a confirmacao
    // vence em 7 dias e o holdback em 8: no dia do meio o pedido ja concluiu
    // sozinho, o dinheiro AINDA esta retido, e o comprador — justo o que nao
    // confirmou porque nada chegou — abre a disputa. Se o sweeper do holdback
    // olhasse so `status = 'completed'`, ele pagaria o vendedor no dia
    // seguinte e a disputa viraria um formulario que nao segura nada.
    //
    // A primeira versao deste teste passava com o defeito de volta, porque o
    // pedido estava em `disputed` e a condicao `o.status = 'completed'` ja o
    // barrava — a assercao acertava pelo motivo errado. Este e o cenario que
    // so a clausula `NOT EXISTS` da disputa resolve.
    await OrderStorage.undispute(c, pedido.id_order);
    await OrderStorage.markCompleted(c, pedido.id_order, { completed_at: new Date() });
    const concluidoComBriga = await OrderStorage.getById(c, pedido.id_order);
    check("o pedido esta CONCLUIDO", concluidoComBriga.status === "completed");
    const brigaViva = await OrderStorage.getOpenDispute(c, pedido.id_order);
    check("e a disputa continua VIVA", !!brigaViva && brigaViva.status === "open");
    const liberadosComBriga = await OrderStorage.releaseDuePayouts(c);
    check(
      "DEFEITO #5 — holdback vencido NAO paga o vendedor com disputa aberta",
      !liberadosComBriga.some((r) => String(r.id_payout) === String(payoutVenda.id_payout)),
      JSON.stringify(liberadosComBriga)
    );
    const aindaAguardando = await OrderStorage.getPayoutByOrder(c, pedido.id_order);
    check(
      "DEFEITO #5 — o repasse segue AGUARDANDO ate alguem decidir",
      aindaAguardando.status === "aguardando",
      aindaAguardando.status
    );

    // O veredito "release": a venda segue e o repasse e liberado na hora.
    const decidida = await OrderStorage.decideDispute(c, disputa.id_dispute, {
      status: "released", decided_by: alvoUser.id_user, decision_note: "conferido",
    });
    check("o admin decide a disputa", decidida.status === "released");
    const aprovado = await OrderStorage.approvePayout(c, pedido.id_order);
    check("com a disputa resolvida, o repasse e liberado", aprovado.status === "aprovado");
    const semDisputa = await OrderStorage.getOpenDispute(c, pedido.id_order);
    check("e nao sobra disputa viva", semDisputa === null);

    /* ── o pedido sobrevive ao anuncio ──────────────────────────────────── */
    // ⚠️ SET NULL, e nao CASCADE: o pedido carrega dinheiro e historico.
    await c.query("DELETE FROM public.tb_condo_listing WHERE id_listing = $1", [anuncio.id_listing]);
    const orfao = await OrderStorage.getById(c, pedido.id_order);
    check("apagar o anuncio NAO apaga o pedido", !!orfao, "pedido sumiu junto!");
    check("e o SNAPSHOT continua dizendo o que foi comprado",
      !!orfao && orfao.listing_title === "Bolo de cenoura" && orfao.id_listing === null);
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
        `SELECT COUNT(*)::int n FROM public.tb_feature_flag
          WHERE flag_key IN ('delivery_vizinho', 'vitrine_venda')`
      )
    ).rows[0].n;
    console.log(
      "\n[producao, depois do ROLLBACK] tabelas do delivery:",
      depois,
      "| tabelas da venda:",
      "(abaixo)",
      "| flags:",
      flagDepois
    );
    const depois249 = (
      await c.query(
        `SELECT COUNT(*)::int n FROM information_schema.tables
          WHERE table_schema='public' AND table_name LIKE 'tb_community_listing%'`
      )
    ).rows[0].n;
    check(
      "PRODUCAO INTOCADA: as tabelas do delivery voltaram ao estado de antes",
      depois === antesTabelas,
      "antes=" + antesTabelas + " depois=" + depois
    );
    check(
      "PRODUCAO INTOCADA: as tabelas da venda voltaram ao estado de antes",
      depois249 === antesTabelas249,
      "antes=" + antesTabelas249 + " depois=" + depois249
    );
    check(
      "PRODUCAO INTOCADA: as flags voltaram ao estado de antes",
      flagDepois === antesFlags,
      "antes=" + antesFlags + " depois=" + flagDepois
    );

    await c.end();
    console.log("\n" + pass + "/" + (pass + fail) + " checks");
    process.exit(fail ? 1 : 0);
  }
})();
