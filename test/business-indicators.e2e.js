// test/business-indicators.e2e.js — INDICADORES DO NEGÓCIO (mig 235)
//
// Roda: npm run test:indicators
//
// ─── POR QUE ESTE TESTE PODE APONTAR PARA PRODUÇÃO ──────────────────────────
//
// As outras suítes e2e exigem `TEST_DATABASE_URL` e RECUSAM a URL de produção,
// porque elas comitam o que criam. Esta não comita nada: tudo acontece dentro
// de UMA transação que termina em ROLLBACK, incluindo a aplicação da migration.
// O `COMMIT` não existe neste arquivo — e o passo final confere, já fora da
// transação, que a tabela criada pelo teste não ficou no banco.
//
// É o caminho que esta casa já usou nas migs 205-234 quando não há Postgres na
// máquina: exercitar o SQL de verdade contra o schema de verdade, sem deixar
// rastro. Um mock de `pg` testaria o mock.
//
// ─── COMO O SERVICE ENTRA NA TRANSAÇÃO ──────────────────────────────────────
//
// `BusinessIndicatorsService` importa o pool direto (padrão da casa), e uma
// consulta pelo pool pegaria OUTRA conexão — que não enxerga nada do que esta
// transação criou, e devolveria zeros convincentes. Por isso o módulo do pool é
// trocado no `require.cache` pelo client da transação ANTES do primeiro
// require do service. Mesma técnica que `test/spaces.e2e.js` usa para dublar a
// FIPE.

require("dotenv").config();

// O `.env` local aponta para um Postgres gerenciado com certificado
// self-signed; sem isto o driver recusa a conexão antes do primeiro SELECT.
process.env.DATABASE_SSL = "true";
process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";

const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");

let PASS = 0;
let FAIL = 0;

/**
 * ⚠️ RECUSA FUNÇÃO ASSYNC de propósito. Uma promise é sempre verdadeira, então
 * `check("x", algoAsync())` passaria sem olhar para nada — o defeito que a
 * suíte de `community-site` teve de consertar depois de três testes verdes
 * mentirem. Quem precisa de await faz o await antes.
 */
function check(label, cond, extra = "") {
  if (typeof cond === "function" || (cond && typeof cond.then === "function")) {
    FAIL++;
    console.log(`✗ ${label} — condição assíncrona (faça o await antes)`);
    return;
  }
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}

/** Insere e devolve a primeira coluna da primeira linha. */
async function one(c, sql, params = []) {
  const r = await c.query(sql, params);
  return r.rows[0];
}

(async () => {
  const c = await pool.connect();
  let service;

  try {
    await c.query("BEGIN");

    // ── o pool que o service enxerga passa a ser esta transação ─────────────
    const poolPath = require.resolve("../src/databases");
    require.cache[poolPath].exports = c;
    service = require("../src/services/BusinessIndicatorsService");
    const storage = require("../src/storages/BusinessIndicatorsStorage");

    // ── 1. a migration ──────────────────────────────────────────────────────
    const sql = fs.readFileSync(
      path.join(__dirname, "../src/databases/migrations/235_business_indicators.sql"),
      "utf8"
    );
    await c.query(sql);
    check("migration 235 aplica", true);
    await c.query(sql);
    check("migration 235 é idempotente (2ª aplicação não falha)", true);

    const cols = await one(
      c,
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
        WHERE table_name = 'tb_community_site_event_daily'`
    );
    check("tabela do contador criada", cols.n >= 4, `colunas=${cols.n}`);

    const idx = await one(
      c,
      `SELECT COUNT(*)::int AS n FROM pg_indexes
        WHERE tablename = 'tb_profile_bookings'
          AND indexname = 'ix_bookings_origin_community_created'`
    );
    check("índice de origem do agendamento criado", idx.n === 1);

    // ── 2. o elenco ─────────────────────────────────────────────────────────
    // Dois formatos, porque o banco cobra os dois: slug de perfil obedece
    // `^[a-z0-9]+(-[a-z0-9]+)*$` (mig 020) e username, `^[a-z0-9][a-z0-9_.]{2,29}$`
    // (mig 006) — um aceita hífen e o outro não.
    let seq = 0;
    const stamp = Date.now();
    const mk = (p) => `ind-${p}-${stamp}-${++seq}`;
    const mkUser = (p) => `ind${p}${stamp}${++seq}`;
    const leader = await one(
      c,
      `INSERT INTO public.tb_user (nome, email, username)
       VALUES ('Líder Teste', $1, $2) RETURNING id_user`,
      [`${mkUser("l")}@t.test`, mkUser("l")]
    );
    const client = await one(
      c,
      `INSERT INTO public.tb_user (nome, email, username)
       VALUES ('Cliente Teste', $1, $2) RETURNING id_user`,
      [`${mkUser("c")}@t.test`, mkUser("c")]
    );

    // O perfil pessoal do líder — é por ele que a O.S. de serviço pendura.
    // `id_category` não é decoração: o CHECK `chk_profile_clan_taxonomy` exige
    // categoria em perfil que não é clan nem comunidade.
    const machine = await one(c, `SELECT id_machine FROM public.tb_machine LIMIT 1`);
    const category = await one(c, `SELECT id_category FROM public.tb_category LIMIT 1`);
    const leaderProfile = await one(
      c,
      `INSERT INTO public.tb_profile (id_user, sub_profile_slug, display_name, id_category)
       VALUES ($1, $2, 'Perfil do líder', $3) RETURNING id_profile`,
      [leader.id_user, mk("p"), category.id_category]
    );

    const mkCommunity = async (kind, name) =>
      one(
        c,
        `INSERT INTO public.tb_profile
           (id_user, sub_profile_slug, display_name, is_community, community_kind, id_leader_user)
         VALUES ($1, $2, $3, TRUE, $4, $1) RETURNING id_profile`,
        [leader.id_user, mk("cm"), name, kind]
      );

    const biz = await mkCommunity("common", "Negócio com site");
    const draft = await mkCommunity("common", "Negócio sem site publicado");
    const pet = await mkCommunity("pet", "Pet");

    await c.query(
      `INSERT INTO public.tb_community_site (id_profile, is_published)
       VALUES ($1, TRUE)`,
      [biz.id_profile]
    );
    await c.query(
      `INSERT INTO public.tb_community_site (id_profile, is_published)
       VALUES ($1, FALSE)`,
      [draft.id_profile]
    );

    // ── 3. o contador do site ───────────────────────────────────────────────
    await service.recordSiteEvent(biz.id_profile, "view");
    await service.recordSiteEvent(biz.id_profile, "view");
    await service.recordSiteEvent(biz.id_profile, "booking_click");
    await service.recordSiteEvent(biz.id_profile, "whatsapp_click");

    const counted = await c.query(
      `SELECT kind, events FROM public.tb_community_site_event_daily
        WHERE id_profile = $1 ORDER BY kind`,
      [biz.id_profile]
    );
    const byKind = Object.fromEntries(counted.rows.map((r) => [r.kind, r.events]));
    check("duas visualizações somam na MESMA linha do dia", byKind.view === 2, JSON.stringify(byKind));
    check("clique de agendar contado", byKind.booking_click === 1);
    check("clique de WhatsApp contado", byKind.whatsapp_click === 1);

    await service.recordSiteEvent(biz.id_profile, "clique_inventado");
    const bogus = await one(
      c,
      `SELECT COUNT(*)::int AS n FROM public.tb_community_site_event_daily
        WHERE id_profile = $1 AND kind = 'clique_inventado'`,
      [biz.id_profile]
    );
    check("tipo de evento fora da lista NÃO grava", bogus.n === 0);

    // A trava do CHECK existe mesmo que alguém escreva por SQL cru — e ela é
    // conferida pelo NOME da constraint: um NOT NULL qualquer também falharia,
    // e o teste passaria achando que estava protegido.
    let checkName = null;
    try {
      await c.query("SAVEPOINT s1");
      await c.query(
        `INSERT INTO public.tb_community_site_event_daily (id_profile, day, kind, events)
         VALUES ($1, CURRENT_DATE, 'nao_existe', 1)`,
        [biz.id_profile]
      );
    } catch (err) {
      checkName = err.constraint;
    } finally {
      await c.query("ROLLBACK TO SAVEPOINT s1");
    }
    check(
      "CHECK recusa kind desconhecido (pelo nome da constraint)",
      checkName === "chk_community_site_event_kind",
      `constraint=${checkName}`
    );

    await service.recordSiteEvent(draft.id_profile, "view");
    await service.recordSiteEvent(pet.id_profile, "view");
    const blocked = await one(
      c,
      `SELECT COUNT(*)::int AS n FROM public.tb_community_site_event_daily
        WHERE id_profile = ANY($1::uuid[])`,
      [[draft.id_profile, pet.id_profile]]
    );
    check("site não publicado e modalidade sem site NÃO contam", blocked.n === 0);

    // ── 4. leads do WhatsApp ────────────────────────────────────────────────
    const inst = await one(
      c,
      `INSERT INTO public.tb_whatsapp_instance (id_user, evolution_instance, status)
       VALUES ($1, $2, 'connected') RETURNING id_instance`,
      [leader.id_user, mk("wa")]
    );
    const mkConv = async (jid, isGroup) =>
      one(
        c,
        `INSERT INTO public.tb_whatsapp_conversation (id_instance, remote_jid, is_group)
         VALUES ($1, $2, $3) RETURNING id_conversation`,
        [inst.id_instance, jid, isGroup]
      );
    const convA = await mkConv("5511999@s.whatsapp.net", false);
    const convB = await mkConv("5511888@s.whatsapp.net", false);
    const convG = await mkConv("120363@g.us", true);

    const mkMsg = async (conv, direction, daysAgo) =>
      c.query(
        `INSERT INTO public.tb_whatsapp_message (id_conversation, direction, body, sent_at)
         VALUES ($1, $2, 'oi', NOW() - ($3 || ' days')::interval)`,
        [conv, direction, daysAgo]
      );
    await mkMsg(convA.id_conversation, "in", 0);
    await mkMsg(convA.id_conversation, "in", 1); // mesma pessoa, outro dia
    await mkMsg(convB.id_conversation, "in", 2);
    await mkMsg(convA.id_conversation, "out", 0); // resposta do líder
    await mkMsg(convG.id_conversation, "in", 0); // grupo
    await mkMsg(convB.id_conversation, "in", 200); // fora da janela

    // ── 5. leads da O.S. ────────────────────────────────────────────────────
    const req = await one(
      c,
      `INSERT INTO public.tb_service_request (id_user, id_machine, id_category, description)
       VALUES ($1, $2, $3, 'preciso de um orçamento') RETURNING id_request`,
      [client.id_user, machine.id_machine, category.id_category]
    );
    const resp = await one(
      c,
      `INSERT INTO public.tb_service_request_response (id_request, id_profile)
       VALUES ($1, $2) RETURNING id_response`,
      [req.id_request, leaderProfile.id_profile]
    );
    await c.query(
      `INSERT INTO public.tb_service_request_message (id_response, sender, content)
       VALUES ($1, 'USER', 'oi'), ($1, 'USER', 'ainda ai?'), ($1, 'PRO', 'opa')`,
      [resp.id_response]
    );

    const pcat = await one(
      c,
      `SELECT id_product_category FROM public.tb_product_category LIMIT 1`
    );
    const preq = await one(
      c,
      `INSERT INTO public.tb_product_request
         (id_buyer_user, id_product_category, title, description, city, state)
       VALUES ($1, $2, 'quero', 'um produto', 'São Paulo', 'SP')
       RETURNING id_product_request`,
      [client.id_user, pcat.id_product_category]
    );
    const presp = await one(
      c,
      `INSERT INTO public.tb_product_request_response
         (id_product_request, id_seller_user, id_profile, message)
       VALUES ($1, $2, $3, 'tenho') RETURNING id_response`,
      [preq.id_product_request, leader.id_user, leaderProfile.id_profile]
    );
    await c.query(
      `INSERT INTO public.tb_product_request_message (id_response, sender, content)
       VALUES ($1, 'USER', 'quanto?'), ($1, 'PRO', 'cem')`,
      [presp.id_response]
    );

    // ── 6. agendamentos e mensalidade ───────────────────────────────────────
    // A hora muda a cada chamada: `idx_booking_unique_active_slot` impede dois
    // agendamentos vivos no mesmo horário do mesmo perfil.
    let hour = 8;
    const mkBooking = async (origin, paymentStatus, deposit, professional) => {
      const h = String(hour++).padStart(2, "0");
      return c.query(
        `INSERT INTO public.tb_profile_bookings
           (id_profile, profile_owner_user_id, client_name, client_email,
            booking_date, start_time, end_time, deposit_amount,
            professional_amount, payment_status, id_origin_community)
         VALUES ($1, $2, 'Cliente', 'c@t.test', CURRENT_DATE, $7::time, $8::time,
                 $3, $4, $5, $6)`,
        [
          leaderProfile.id_profile,
          leader.id_user,
          deposit,
          professional,
          paymentStatus,
          origin,
          `${h}:00`,
          `${h}:45`,
        ]
      );
    };
    await mkBooking(biz.id_profile, "paid", 5000, 4000);
    await mkBooking(biz.id_profile, "pending", 5000, 4000);
    await mkBooking(null, "paid", 9900, 8900); // agendado fora do site

    const sub = await one(
      c,
      `INSERT INTO public.tb_community_member_sub
         (id_community_profile, id_user, monthly_cents)
       VALUES ($1, $2, 1000) RETURNING id_sub`,
      [biz.id_profile, client.id_user]
    );
    await c.query(
      `INSERT INTO public.tb_community_member_payment
         (id_sub, id_community_profile, id_owner_user, gross_cents, net_cents,
          status, stripe_invoice_id, available_at)
       VALUES ($1, $2, $3, 1000, 900, 'aprovado', $4, NOW()),
              ($1, $2, $3, 1000, 900, 'revertido', $5, NOW())`,
      [sub.id_sub, biz.id_profile, leader.id_user, mk("inv1"), mk("inv2")]
    );

    // ── 7. o painel ─────────────────────────────────────────────────────────
    const r = await service.getIndicators({ id_user: leader.id_user }, biz.id_profile, 30);
    check("painel responde sem erro", !r.error, JSON.stringify(r.error));

    check("janela normalizada para 30 dias", r.range.days === 30);
    check("série tem um ponto por dia", r.series.length === 30, `len=${r.series.length}`);

    check("visualizações somadas", r.site.views === 2, JSON.stringify(r.site));
    check("cliques de agendar somados", r.site.booking_clicks === 1);
    check("cliques de WhatsApp somados", r.site.whatsapp_clicks === 1);

    check(
      "WhatsApp: 3 mensagens recebidas na janela (grupo, 'out' e a antiga fora)",
      r.leads.whatsapp.messages === 3,
      JSON.stringify(r.leads.whatsapp)
    );
    check(
      "WhatsApp: 2 pessoas — quem escreveu em dois dias conta UMA vez",
      r.leads.whatsapp.people === 2,
      JSON.stringify(r.leads.whatsapp)
    );
    check("WhatsApp conectado é declarado", r.leads.whatsapp.connected === true);

    check(
      "O.S.: 3 mensagens do cliente (serviço + produto), nenhuma do PRO",
      r.leads.os.messages === 3,
      JSON.stringify(r.leads.os)
    );
    check("O.S.: 2 conversas", r.leads.os.people === 2);
    check("leads: total de gente é a soma dos canais", r.leads.people === 4);
    check("leads são declarados como da CONTA, não da comunidade", r.leads.scope === "account");

    check("agendamentos do site contados", r.bookings.total === 2, JSON.stringify(r.bookings));
    check("só um foi pago", r.bookings.paid === 1);

    check(
      "faturamento = sinal pago do site + mensalidade não revertida",
      r.revenue.net_cents === 4900,
      JSON.stringify(r.revenue)
    );
    check("bruto idem", r.revenue.gross_cents === 6000, JSON.stringify(r.revenue));
    check(
      "agendamento SEM origem no site fica de fora",
      r.revenue.sources.bookings.net_cents === 4000
    );
    check("mensalidade revertida fica de fora", r.revenue.sources.memberships.count === 1);

    const hoje = r.series[r.series.length - 1];
    check("o último ponto da série é hoje", hoje.day === r.range.until);
    check("hoje tem as duas visualizações", hoje.views === 2, JSON.stringify(hoje));

    // ── 8. os guards ────────────────────────────────────────────────────────
    const asStranger = await service.getIndicators(
      { id_user: client.id_user },
      biz.id_profile,
      30
    );
    check("quem não é líder recebe 403", asStranger.statusCode === 403, JSON.stringify(asStranger));

    const asPet = await service.getIndicators({ id_user: leader.id_user }, pet.id_profile, 30);
    check("modalidade sem negócio recebe 403", asPet.statusCode === 403, JSON.stringify(asPet));

    const anon = await service.getIndicators({}, biz.id_profile, 30);
    check("sem sessão recebe 401", anon.statusCode === 401);

    const wide = await service.getIndicators(
      { id_user: leader.id_user },
      biz.id_profile,
      100000
    );
    check("janela fora da lista cai no padrão de 30", wide.range.days === 30);

    // ── 9. a storage responde sobre um negócio sem nada ─────────────────────
    const empty = await service.getIndicators({ id_user: leader.id_user }, draft.id_profile, 7);
    check("negócio sem site responde zerado, não quebra", !empty.error && empty.site.views === 0);
    check("janela de 7 dias tem 7 pontos", empty.series.length === 7);
    check(
      "leads da conta aparecem mesmo no negócio sem site (são da conta)",
      empty.leads.whatsapp.messages === 3
    );

    void storage;
  } catch (err) {
    FAIL++;
    console.log("✗ ERRO FATAL:", err.message);
    console.log(err.stack);
  } finally {
    await c.query("ROLLBACK");
    c.release();
  }

  // ── 10. produção intocada ────────────────────────────────────────────────
  const after = await pool.query(
    `SELECT COUNT(*)::int AS n FROM information_schema.tables
      WHERE table_name = 'tb_community_site_event_daily'`
  );
  check(
    "depois do ROLLBACK a tabela do teste NÃO existe no banco",
    after.rows[0].n === 0,
    `encontradas=${after.rows[0].n}`
  );

  await pool.end();
  console.log(`\nPASS=${PASS} FAIL=${FAIL}`);
  process.exit(FAIL ? 1 : 0);
})();
