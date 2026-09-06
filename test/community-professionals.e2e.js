/**
 * Suíte da EQUIPE do site + agenda viva (mig 221).
 *
 * ═══ POR QUE ELA RODA DENTRO DE UMA TRANSAÇÃO ═══
 *
 * Não há Postgres local nesta máquina (Docker não sobe; o portátil sumiu), e a
 * regra que estes casos testam é justamente a que só o banco de verdade
 * responde: FKs, PK composta, CASCADE. Então a suíte abre UMA transação no
 * banco apontado por DATABASE_URL, faz tudo dentro dela e termina com ROLLBACK
 * — nenhuma linha sobrevive, nem em caso de falha (o `finally` faz o rollback).
 *
 * O `pool.query` do processo é redirecionado para o cliente dessa transação
 * ANTES de qualquer service ser carregado. É o que permite exercitar as regras
 * do service (só o líder, só membro, líder sempre primeiro) sem escrever nada.
 *
 * Uso: `npm run test:community-professionals` (transacional: abre BEGIN e termina em ROLLBACK, por isso pode rodar contra o banco de produção sem deixar linha)
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
    // Todo acesso ao banco desta execução passa pela transação.
    const pool = require("../src/databases");
    const realQuery = pool.query.bind(pool);
    pool.query = (...args) => client.query(...args);

    const CommunitySiteService = require("../src/services/CommunitySiteService");
    const CommunityProfessionalStorage = require("../src/storages/CommunityProfessionalStorage");

    // ─── 1. Migration ─────────────────────────────────────────────────────
    const sql = fs.readFileSync(
      path.join(__dirname, "../src/databases/migrations/221_community_professionals.sql"),
      "utf8"
    );
    await client.query(sql);
    await client.query(sql); // idempotente: a segunda passada não pode explodir
    check("mig 221 aplica duas vezes sem erro", true);

    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns
        WHERE table_name = 'tb_community_professional' ORDER BY column_name`
    );
    check(
      "colunas da tabela",
      cols.rows.map((r) => r.column_name).join(",") ===
        "created_at,granted_by,id_profile,id_user",
      cols.rows.map((r) => r.column_name).join(",")
    );

    const pk = await client.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'public.tb_community_professional'::regclass AND contype = 'p'`
    );
    check("tem chave primária composta", pk.rowCount === 1);

    // ─── 2. Cenário: uma comunidade com líder e um segundo usuário ────────
    const leader = await client.query(
      `SELECT p.id_profile, p.id_user
         FROM public.tb_profile p
        WHERE p.is_user_account = TRUE AND p.deleted_at IS NULL
        ORDER BY p.created_at ASC LIMIT 1`
    );
    const other = await client.query(
      `SELECT p.id_profile, p.id_user
         FROM public.tb_profile p
        WHERE p.is_user_account = TRUE AND p.deleted_at IS NULL
          AND p.id_user <> $1
        ORDER BY p.created_at ASC LIMIT 1`,
      [leader.rows[0].id_user]
    );
    if (!leader.rowCount || !other.rowCount) {
      throw new Error("Banco sem dois perfis-conta para o cenário.");
    }
    const leaderUser = leader.rows[0].id_user;
    const leaderProfile = leader.rows[0].id_profile;
    const otherUser = other.rows[0].id_user;
    const otherProfile = other.rows[0].id_profile;

    // Comunidade nova, dentro da transação.
    const community = await client.query(
      `INSERT INTO public.tb_profile
         (id_user, id_category, display_name, sub_profile_slug, is_active, is_visible,
          is_community, community_kind, id_leader_user, community_privacy)
       SELECT $1::uuid,
              NULL,
              'Equipe QA', 'equipe-qa-' || substring(md5(random()::text), 1, 8),
              TRUE, TRUE, TRUE, 'common', $1::uuid, 'public'
       RETURNING id_profile`,
      [leaderUser]
    );
    const idCommunity = community.rows[0].id_profile;

    // O líder entra como membro, como a criação de verdade faz: a trava de
    // comunidade privada (`canViewInside`, a mesma de `listBees`) pergunta pela
    // MEMBRESIA, não pela liderança.
    await client.query(
      `INSERT INTO public.tb_community_member (id_community_profile, id_user, role)
       VALUES ($1, $2, 'leader') ON CONFLICT DO NOTHING`,
      [idCommunity, leaderUser]
    );

    const asLeader = { id_user: leaderUser };
    const asOther = { id_user: otherUser };

    // ─── 3. Quem pode montar a equipe ────────────────────────────────────
    const byStranger = await CommunitySiteService.addProfessional(
      asOther,
      { id_profile: idCommunity },
      { username: "seja-quem-for" }
    );
    check("não-líder é recusado com 403", byStranger.statusCode === 403, JSON.stringify(byStranger));

    const anon = await CommunitySiteService.listProfessionals(null, { id_profile: idCommunity });
    check("anônimo não lista a equipe", anon.statusCode === 401);

    // ─── 4. O líder já é profissional, sozinho ───────────────────────────
    const solo = await CommunitySiteService.listProfessionals(asLeader, {
      id_profile: idCommunity,
    });
    check("equipe nasce com o líder dentro", solo.professionals?.length === 1);
    check("e ele vem marcado como líder", solo.professionals?.[0]?.is_leader === true);

    // ─── 5. Promover exige ser MEMBRO ────────────────────────────────────
    const username = (
      await client.query(`SELECT username FROM public.tb_user WHERE id_user = $1`, [otherUser])
    ).rows[0].username;

    const notMember = await CommunitySiteService.addProfessional(
      asLeader,
      { id_profile: idCommunity },
      { username }
    );
    check(
      "promover quem não é membro é recusado",
      typeof notMember.error === "string" && /membro/i.test(notMember.error),
      JSON.stringify(notMember)
    );

    await client.query(
      `INSERT INTO public.tb_community_member (id_community_profile, id_user, role)
       VALUES ($1, $2, 'member')
       ON CONFLICT DO NOTHING`,
      [idCommunity, otherUser]
    );

    const promoted = await CommunitySiteService.addProfessional(
      asLeader,
      { id_profile: idCommunity },
      { username }
    );
    check("membro é promovido", promoted.professionals?.length === 2, JSON.stringify(promoted.error));
    check("líder continua em primeiro", promoted.professionals?.[0]?.is_leader === true);
    check(
      "o promovido entra com o perfil-conta dele",
      promoted.professionals?.[1]?.id_profile === otherProfile
    );

    const twice = await CommunitySiteService.addProfessional(
      asLeader,
      { id_profile: idCommunity },
      { username }
    );
    check("promover de novo não duplica", twice.professionals?.length === 2);

    const selfPromote = await CommunitySiteService.addProfessional(
      asLeader,
      { id_profile: idCommunity },
      { username: (await client.query(`SELECT username FROM public.tb_user WHERE id_user=$1`, [leaderUser])).rows[0].username }
    );
    check(
      "promover o próprio líder é recusado",
      typeof selfPromote.error === "string",
      JSON.stringify(selfPromote)
    );

    // ─── 6. A vitrine agrega os serviços da equipe ───────────────────────
    await client.query(
      `INSERT INTO public.tb_profile_service
         (id_profile, name, description, duration_minutes, price_amount, is_active)
       VALUES ($1, 'Corte QA', 'teste', 30, 5000, TRUE),
              ($2, 'Barba QA', 'teste', 30, 3000, TRUE)`,
      [leaderProfile, otherProfile]
    );

    const site = await CommunitySiteService.get(asLeader, { id_profile: idCommunity });
    const names = (site.services || []).map((s) => s.name).sort();
    check(
      "serviços dos dois profissionais entram na vitrine",
      names.join(",") === "Barba QA,Corte QA",
      names.join(",")
    );
    check(
      "cada serviço diz de quem é",
      (site.services || []).every((s) => s.provider_profile_id),
      JSON.stringify(site.services?.[0])
    );
    check("o site devolve a equipe", (site.professionals || []).length === 2);
    check(
      "a régua de comissão NÃO vai no payload público",
      (site.services || []).every(
        (s) => !("affiliate_percent" in s) && !("created_by_user" in s)
      )
    );

    // ─── 7. Agenda viva ──────────────────────────────────────────────────
    // Quem NUNCA configurou agenda atende no padrão da casa: 09:00–18:00, todo
    // dia (`utils/bookingDefaults`, 2026-09-06). Antes desta decisão o cartão
    // não tinha o que mostrar até alguém abrir a configuração — e a tela não
    // dizia isso.
    const byDefault = await CommunitySiteService.getNextSlot(asLeader, { id_profile: idCommunity });
    check(
      "sem regra configurada, o padrão 09:00–18:00 responde",
      !!byDefault.slot,
      JSON.stringify(byDefault)
    );
    check(
      "e o horário padrão cai dentro da faixa",
      byDefault.slot?.start >= "09:00" && byDefault.slot?.start < "18:00",
      JSON.stringify(byDefault.slot)
    );

    // O caminho do `null` continua vivo, e é este: agenda CONFIGURADA e fechada.
    // O padrão só vale para quem nunca configurou — se valesse sempre, fechar a
    // agenda não fecharia nada.
    //
    // ⚠️ Fechar OS DOIS: a varredura passa por todo profissional do roster, e o
    // líder é profissional por construção. Fechar só um deixaria o outro
    // respondendo pelo padrão, e o teste mediria a coisa errada.
    const shut = async (idProfile, enabled, start, end) => {
      for (let weekday = 0; weekday <= 6; weekday += 1) {
        await client.query(
          `INSERT INTO public.tb_profile_availability_rules
             (id_profile, weekday, is_enabled, start_time, end_time, slot_duration_minutes)
           VALUES ($1, $2, $3, $4, $5, 60)
           ON CONFLICT (id_profile, weekday) DO UPDATE
              SET is_enabled = EXCLUDED.is_enabled,
                  start_time = EXCLUDED.start_time,
                  end_time   = EXCLUDED.end_time`,
          [idProfile, weekday, enabled, start, end]
        );
      }
    };
    await shut(leaderProfile, false, "09:00", "18:00");
    await shut(otherProfile, false, "09:00", "18:00");
    const shutAgenda = await CommunitySiteService.getNextSlot(asLeader, { id_profile: idCommunity });
    check("agenda configurada e fechada responde null", shutAgenda.slot === null, JSON.stringify(shutAgenda));

    // Só o promovido reabre, das 08h às 20h: qualquer que seja o dia em que a
    // suíte rodar, existe vaga — e ela é dele, com o líder de agenda fechada.
    await shut(otherProfile, true, "08:00", "20:00");

    const withSlot = await CommunitySiteService.getNextSlot(asLeader, {
      id_profile: idCommunity,
    });
    check("acha o próximo horário livre", !!withSlot.slot, JSON.stringify(withSlot));
    check(
      "e diz de quem é a agenda",
      withSlot.slot?.professional?.id_profile === otherProfile,
      JSON.stringify(withSlot.slot?.professional)
    );
    check(
      "o horário sai como HH:MM",
      /^\d{2}:\d{2}$/.test(withSlot.slot?.start || ""),
      withSlot.slot?.start
    );

    // ─── 8. Comunidade fechada não conta a agenda pelo site ──────────────
    await client.query(`UPDATE public.tb_profile SET community_privacy = 'private' WHERE id_profile = $1`, [
      idCommunity,
    ]);
    const closed = await CommunitySiteService.getNextSlot(null, { id_profile: idCommunity });
    check("forasteiro de comunidade privada não vê horário", closed.slot === null);
    const leaderStillSees = await CommunitySiteService.getNextSlot(asLeader, {
      id_profile: idCommunity,
    });
    check("mas o líder continua vendo", !!leaderStillSees.slot);
    await client.query(`UPDATE public.tb_profile SET community_privacy = 'public' WHERE id_profile = $1`, [
      idCommunity,
    ]);

    // ─── 9. Sair da equipe ───────────────────────────────────────────────
    const removed = await CommunitySiteService.removeProfessional(asLeader, {
      id_profile: idCommunity,
      id_user: otherUser,
    });
    check("remover devolve só o líder", removed.professionals?.length === 1);

    const afterRemoval = await CommunitySiteService.get(asLeader, { id_profile: idCommunity });
    check(
      "e o serviço dele sai da vitrine junto",
      (afterRemoval.services || []).map((s) => s.name).join(",") === "Corte QA",
      (afterRemoval.services || []).map((s) => s.name).join(",")
    );

    // ─── 10. CASCADE: apagar a comunidade leva a equipe ──────────────────
    await CommunityProfessionalStorage.add(client, idCommunity, otherUser, leaderUser);
    await client.query(`DELETE FROM public.tb_community_member WHERE id_community_profile = $1`, [
      idCommunity,
    ]);
    await client.query(`DELETE FROM public.tb_profile WHERE id_profile = $1`, [idCommunity]);
    const orphans = await client.query(
      `SELECT 1 FROM public.tb_community_professional WHERE id_profile = $1`,
      [idCommunity]
    );
    check("apagar a comunidade não deixa equipe órfã", orphans.rowCount === 0);

    pool.query = realQuery;
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${pass} passaram, ${fail} falharam`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exit(1);
});
