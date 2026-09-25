// test/business-results.e2e.js — INDICADORES REFORMULADOS (mig 261, 2026-09-25)
//
// Roda: npm run test:business-results
//
// O que a reformulação acrescentou ao painel da mig 235: o RESULTADO (receita ×
// custo × lucro, com os lançamentos da Vida Financeira marcados como "do
// negócio"), a AGENDA DA EQUIPE com os melhores horários, a COMUNIDADE (membros,
// novos, ativos, participantes) e o período anterior para as setas.
//
// ⚠️ PODE APONTAR PARA PRODUÇÃO pelo mesmo motivo da `business-indicators`:
// tudo acontece numa transação que termina em ROLLBACK, a migration inclusive.
// Não existe `COMMIT` neste arquivo. O pool é trocado no `require.cache` pelo
// client da transação ANTES do primeiro require dos services — senão eles
// pegariam outra conexão e devolveriam zeros convincentes.

require("dotenv").config();
process.env.DATABASE_SSL = "true";
process.env.DATABASE_SSL_REJECT_UNAUTHORIZED = "false";

const fs = require("fs");
const path = require("path");
const pool = require("../src/databases");

let PASS = 0;
let FAIL = 0;

/** Recusa condição assíncrona: uma promise é sempre verdadeira. */
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

async function one(c, sql, params = []) {
  const r = await c.query(sql, params);
  return r.rows[0];
}

(async () => {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const poolPath = require.resolve("../src/databases");
    require.cache[poolPath].exports = c;
    const Indicators = require("../src/services/BusinessIndicatorsService");
    const Finance = require("../src/services/WalletFinanceService");

    // ── 1. a migration ──────────────────────────────────────────────────────
    const sql = fs.readFileSync(
      path.join(__dirname, "../src/databases/migrations/261_finance_entry_business.sql"),
      "utf8"
    );
    await c.query(sql);
    await c.query(sql);
    check("migration 261 aplica e é idempotente", true);
    const col = await one(
      c,
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'tb_wallet_finance_entry' AND column_name = 'id_business_profile'`
    );
    check("coluna id_business_profile existe e aceita NULL", col && col.is_nullable === "YES");

    // ── 2. o elenco ─────────────────────────────────────────────────────────
    const stamp = Date.now();
    let seq = 0;
    const mk = (p) => `res-${p}-${stamp}-${++seq}`;
    const mkUser = (p) => `res${p}${stamp}${++seq}`;
    const newUser = async (p, name) =>
      one(
        c,
        `INSERT INTO public.tb_user (nome, email, username)
         VALUES ($1, $2, $3) RETURNING id_user`,
        [name, `${mkUser(p)}@t.test`, mkUser(p)]
      );
    const category = await one(c, `SELECT id_category FROM public.tb_category LIMIT 1`);
    const accountProfile = async (id_user) =>
      one(
        c,
        `INSERT INTO public.tb_profile (id_user, sub_profile_slug, display_name, id_category, is_user_account)
         VALUES ($1, $2, 'Conta', $3, TRUE) RETURNING id_profile`,
        [id_user, mk("acc"), category.id_category]
      );

    const leader = await newUser("l", "Líder");
    const pro = await newUser("p", "Profissional");
    const fresh = await newUser("n", "Membro novo");
    const old = await newUser("o", "Membro antigo");
    const stranger = await newUser("s", "Outro líder");

    const leaderAcc = await accountProfile(leader.id_user);
    const proAcc = await accountProfile(pro.id_user);

    const mkCommunity = async (owner, kind, name) =>
      one(
        c,
        `INSERT INTO public.tb_profile
           (id_user, sub_profile_slug, display_name, is_community, community_kind, id_leader_user)
         VALUES ($1, $2, $3, TRUE, $4, $1) RETURNING id_profile`,
        [owner, mk("cm"), name, kind]
      );
    const biz = await mkCommunity(leader.id_user, "common", "Barbearia teste");
    const pet = await mkCommunity(leader.id_user, "pet", "Pet teste");
    const alien = await mkCommunity(stranger.id_user, "common", "Negócio alheio");

    // Membros: o líder, o profissional, um que entrou hoje e esteve online, e
    // um que entrou há 40 dias (janela ANTERIOR) e nunca mais apareceu.
    await c.query(
      `INSERT INTO public.tb_community_member (id_community_profile, id_user, role, joined_at)
       VALUES ($1, $2, 'leader', NOW() - interval '100 days'),
              ($1, $3, 'member', NOW() - interval '90 days'),
              ($1, $4, 'member', NOW()),
              ($1, $5, 'member', NOW() - interval '40 days')`,
      [biz.id_profile, leader.id_user, pro.id_user, fresh.id_user, old.id_user]
    );
    await c.query(`UPDATE public.tb_user SET last_seen_at = NOW() WHERE id_user = ANY($1::uuid[])`, [
      [leader.id_user, fresh.id_user],
    ]);
    await c.query(`UPDATE public.tb_user SET last_seen_at = NULL WHERE id_user = ANY($1::uuid[])`, [
      [pro.id_user, old.id_user],
    ]);
    await c.query(
      `INSERT INTO public.tb_community_feed_item (id_community_profile, kind, body, id_author_user)
       VALUES ($1, 'recado', 'oi gente', $2), ($1, 'recado', 'de novo', $2)`,
      [biz.id_profile, fresh.id_user]
    );
    await c.query(
      `INSERT INTO public.tb_community_professional (id_profile, id_user, granted_by)
       VALUES ($1, $2, $3)`,
      [biz.id_profile, pro.id_user, leader.id_user]
    );

    // ── 3. agendamentos ─────────────────────────────────────────────────────
    const mkBooking = async ({ profile, owner, origin, status, pay, daysAhead, time, createdAgo = 0 }) =>
      c.query(
        `INSERT INTO public.tb_profile_bookings
           (id_profile, profile_owner_user_id, client_name, client_email,
            booking_date, start_time, end_time, status, deposit_amount,
            professional_amount, payment_status, id_origin_community, created_at)
         VALUES ($1, $2, 'Cliente', 'c@t.test',
                 CURRENT_DATE + $3::int, $4::time, ($4::time + interval '45 minutes')::time,
                 $5, 5000, 4000, $6, $7, NOW() - ($8 || ' days')::interval)`,
        [profile, owner, daysAhead, time, status, pay, origin, createdAgo]
      );
    // Pelo site, pago: entra no funil e no dinheiro.
    await mkBooking({ profile: leaderAcc.id_profile, owner: leader.id_user, origin: biz.id_profile,
      status: "confirmed", pay: "paid", daysAhead: -1, time: "10:00" });
    // Do profissional, fora do site: duas às 14h (o melhor horário) e uma cancelada.
    await mkBooking({ profile: proAcc.id_profile, owner: pro.id_user, origin: null,
      status: "completed", pay: "on_site", daysAhead: -2, time: "14:00" });
    await mkBooking({ profile: proAcc.id_profile, owner: pro.id_user, origin: null,
      status: "confirmed", pay: "on_site", daysAhead: -9, time: "14:00" });
    await mkBooking({ profile: proAcc.id_profile, owner: pro.id_user, origin: null,
      status: "canceled", pay: "canceled", daysAhead: -3, time: "16:00" });
    // Checkout abandonado: NÃO é agendamento.
    await mkBooking({ profile: proAcc.id_profile, owner: pro.id_user, origin: null,
      status: "pending_payment", pay: "pending", daysAhead: -4, time: "09:00" });
    // Criado na janela ANTERIOR.
    await mkBooking({ profile: proAcc.id_profile, owner: pro.id_user, origin: null,
      status: "completed", pay: "on_site", daysAhead: -40, time: "11:00", createdAgo: 40 });

    // ── 4. a Vida Financeira ────────────────────────────────────────────────
    const asLeader = { id_user: leader.id_user };
    const today = (await one(c, `SELECT (NOW() AT TIME ZONE 'America/Sao_Paulo')::date::text AS d`)).d;
    const shift = (n) => {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    };

    const rent = await Finance.createEntry(asLeader, {
      direction: "out", recurrence: "recurring", title: "Aluguel do salão", category: "Aluguel",
      amount_cents: 100000, due_day: 5, ym: 202601, id_business_profile: biz.id_profile,
    });
    check("lançamento recorrente do negócio grava", rent.entry && rent.entry.id_business_profile === biz.id_profile,
      JSON.stringify(rent));
    await Finance.createEntry(asLeader, {
      direction: "out", recurrence: "oneoff", title: "Lâminas", category: "Material",
      amount_cents: 20000, entry_date: shift(-3), id_business_profile: biz.id_profile,
    });
    await Finance.createEntry(asLeader, {
      direction: "in", recurrence: "oneoff", title: "Venda no balcão", category: "Vendas",
      amount_cents: 50000, entry_date: shift(-1), id_business_profile: biz.id_profile,
    });
    // Pessoal: NÃO pode aparecer nos Indicadores.
    const personal = await Finance.createEntry(asLeader, {
      direction: "out", recurrence: "oneoff", title: "Mercado de casa",
      amount_cents: 99999, entry_date: shift(-1),
    });
    check("lançamento sem negócio continua pessoal (NULL)", personal.entry && personal.entry.id_business_profile == null);

    const onPet = await Finance.createEntry(asLeader, {
      direction: "out", recurrence: "oneoff", title: "Ração", amount_cents: 100, id_business_profile: pet.id_profile,
    });
    check("não dá para lançar num pet (não é negócio)", onPet.status === 403, JSON.stringify(onPet));
    const onAlien = await Finance.createEntry(asLeader, {
      direction: "out", recurrence: "oneoff", title: "X", amount_cents: 100, id_business_profile: alien.id_profile,
    });
    check("não dá para lançar no negócio de outra pessoa", onAlien.status === 403);
    const onJunk = await Finance.createEntry(asLeader, {
      direction: "out", recurrence: "oneoff", title: "X", amount_cents: 100, id_business_profile: "nao-e-uuid",
    });
    check("id torto é recusado antes do banco", onJunk.status === 400);

    const biz2 = await Finance.listBusinesses(asLeader);
    check("lista de negócios traz só o common que ele lidera",
      biz2.businesses.length === 1 && biz2.businesses[0].id_profile === biz.id_profile,
      JSON.stringify(biz2));

    // PATCH tira e devolve o negócio (o NULL precisa passar, não é "não mexer").
    const detach = await Finance.updateEntry(asLeader, personal.entry.id, { id_business_profile: biz.id_profile });
    check("PATCH marca um lançamento pessoal como do negócio", detach.entry.id_business_profile === biz.id_profile);
    const back = await Finance.updateEntry(asLeader, personal.entry.id, { id_business_profile: null });
    check("PATCH com null devolve o lançamento para o pessoal", back.entry.id_business_profile == null);
    const untouched = await Finance.updateEntry(asLeader, rent.entry.id, { title: "Aluguel" });
    check("PATCH sem o campo não mexe no negócio", untouched.entry.id_business_profile === biz.id_profile);

    // ── 5. o painel ─────────────────────────────────────────────────────────
    const res = await Indicators.getIndicators(asLeader, biz.id_profile, 30);
    check("painel responde", !res.error, JSON.stringify(res).slice(0, 200));
    const { finance, members, bookings, site, series, range } = res;

    // Quantas vezes o dia 5 cai na janela — o aluguel entra uma vez por cada.
    let fifths = 0;
    for (let i = 0; i < 30; i++) if (shift(-i).endsWith("-05")) fifths++;
    const expectedCost = fifths * 100000 + 20000;
    check("custo = aluguel espalhado + material (o pessoal fica de fora)",
      finance.cost_cents === expectedCost, `cost=${finance.cost_cents} esperado=${expectedCost}`);
    check("receita = sinal pago pelo site (líquido) + venda lançada",
      finance.revenue_cents === 4000 + 50000, `revenue=${finance.revenue_cents}`);
    check("lucro = receita − custo", finance.profit_cents === finance.revenue_cents - finance.cost_cents);
    check("margem calculada", finance.margin_pct === Math.round((finance.profit_cents / finance.revenue_cents) * 100));
    check("custo fixo do mês = soma dos recorrentes", finance.fixed_monthly_cost_cents === 100000);
    check("maior custo por categoria vem primeiro",
      finance.top_costs[0] && finance.top_costs[0].label === "Aluguel" || fifths === 0);
    check("a série soma o mesmo custo do total",
      series.reduce((a, d) => a + d.cost_cents, 0) === finance.cost_cents);
    check("série tem 30 dias e termina hoje", series.length === 30 && series[29].day === range.until);

    check("agendamentos da equipe: 3 válidos (cancelado e abandonado fora)",
      bookings.team.valid === 3, JSON.stringify(bookings.team));
    check("cancelado contado à parte", bookings.team.canceled === 1);
    check("equipe = líder + profissional", bookings.team.people === 2);
    check("o criado há 40 dias vai para o período anterior", bookings.team.prev_valid === 1);
    check("melhor horário: 14h com 2", bookings.top_slots[0] &&
      bookings.top_slots[0].hour === 14 && bookings.top_slots[0].bookings === 2,
      JSON.stringify(bookings.top_slots));
    check("best_hour é 14", bookings.best_hour && bookings.best_hour.hour === 14);
    check("funil: 1 agendamento válido pelo site", site.bookings === 1 && site.paid === 1);

    check("membros: 4 no total", members.total === 4, JSON.stringify(members));
    check("novos na janela: 1; na anterior: 1", members.new === 1 && members.new_prev === 1);
    check("ativos = quem apareceu na janela (2)", members.active === 2);
    check("participantes = quem publicou no mural (1, contado uma vez)", members.participants === 1);

    // ── 6. a porta ──────────────────────────────────────────────────────────
    const asPro = await Indicators.getIndicators({ id_user: pro.id_user }, biz.id_profile, 30);
    check("profissional da equipe NÃO vê o painel", asPro.statusCode === 403);
    const onPetPanel = await Indicators.getIndicators(asLeader, pet.id_profile, 30);
    check("pet não tem painel", onPetPanel.statusCode === 403);
  } catch (err) {
    FAIL++;
    console.error("✗ erro inesperado:", err);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
  }

  // Fora da transação: a produção não pode ter ficado com nada.
  const left = await pool.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_user WHERE email LIKE $1`,
    [`res%@t.test`]
  );
  check("depois do ROLLBACK nenhum usuário de teste ficou", left.rows[0].n === 0);

  console.log(`\n${PASS} ok · ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
})();
