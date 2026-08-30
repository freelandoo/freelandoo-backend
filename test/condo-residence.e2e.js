// test/condo-residence.e2e.js — Subsistema 5: condomínio no núcleo territorial.
//
//   npm run test:condo-residence
//
// Pré-requisito: Postgres de TESTE (a suíte RECUSA hosts que pareçam produção).
//
// O que ela cobre, e por quê:
//
//   1. NÃO EXISTE VISITANTE — o `join` genérico de comunidade recusa condomínio;
//      a única porta é escolher o apartamento na planta.
//   2. O GERADOR (D10) — o gestor declara torre × andares × aptos e a planta
//      nasce; rodar de novo não duplica; o teto recusa erro de digitação.
//   3. Apartamento VAZIO reconhece na hora; OCUPADO vira pendência.
//   4. ACEITAR COMO FAMÍLIA — os dois passam a morar, e ninguém foi removido.
//   5. REJEITAR E COMPETIR — vira disputa, com conversa de três, e — o ponto
//      que mais importa — o morador contestado CONTINUA morador (§7.1, o
//      conflito E1 que a mig 196 tinha).
//   6. O comprovante é do REIVINDICANTE e a decisão é do SÍNDICO.
//   7. A projeção da planta: quem não é morador não vê contagem por porta.
//   8. Deletar apartamento com morador é RECUSADO (a FK é CASCADE em cadeia).
//   9. O RESTO do condomínio (avisos, enquetes, situação do morador) lê a fonte
//      NOVA. Esta seção nasceu de uma regressão real: essas três superfícies
//      ainda perguntavam quem era o TITULAR à tabela legada, e como o fluxo
//      novo só escreve em `tb_residence_member`, o morador novo publicava mas
//      não recebia nada — falha silenciosa, a pior espécie.

require("dotenv").config();

const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";

if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;

const CEP = "01310100";

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

async function main() {
  console.log("━━━ migrations ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "inherit",
  });

  const CondoResidenceService = require("../src/services/CondoResidenceService");
  const CondoResidenceStorage = require("../src/storages/CondoResidenceStorage");
  const CommunityService = require("../src/services/CommunityService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const ResidenceStorage = require("../src/storages/ResidenceStorage");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now();
  const mk = (s) => `${s}_${stamp}`;
  const created = [];

  // O usuário nasce COM perfil-conta, como no signup real (AuthStorage
  // .ensureUserAccountProfile). Sem ele a conversa da disputa não teria com
  // qual perfil falar — e um teste que não reproduz isso não prova nada sobre
  // o caminho que roda em produção.
  async function mkUser(tag) {
    const r = await db.query(
      `INSERT INTO public.tb_user (nome, email, senha, username, ativo, data_nascimento)
            VALUES ($1, $2, 'x', $3, TRUE, '1990-01-01')
         RETURNING id_user`,
      [`User ${tag}`, `${mk(tag)}@ex.com`, mk(tag)]
    );
    const id_user = r.rows[0].id_user;
    await db.query(
      `INSERT INTO public.tb_profile
         (id_user, display_name, sub_profile_slug, is_user_account, id_category)
       VALUES ($1, $2, $3, TRUE,
               (SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1))`,
      // O slug é kebab-case estrito (chk_tb_profile_sub_profile_slug_format).
      [id_user, `User ${tag}`, `${tag}-${stamp}`]
    );
    created.push(id_user);
    return id_user;
  }
  const U = (id) => ({ id_user: id });

  const sindico = await mkUser("sindico");
  const ana = await mkUser("ana");
  const bruno = await mkUser("bruno");
  const carla = await mkUser("carla");
  const forasteiro = await mkUser("forasteiro");

  const { rows: machines } = await db.query(
    `SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`
  );
  const condo = await CommunityStorage.createCommunity(pool, {
    id_user: sindico,
    id_machine: machines[0].id_machine,
    display_name: mk("Edificio E2E"),
    bio: null,
    avatar_url: null,
    theme: null,
    kind: "condo",
    address: {
      street: "Avenida Paulista",
      number: "1578",
      complement: null,
      neighborhood: "Bela Vista",
      cep: CEP,
      estado: "SP",
      municipio: "São Paulo",
    },
  });
  await CommunityStorage.addMember(pool, condo.id_profile, sindico, "leader");
  const P = { id_condo: condo.id_profile };

  // ═══ 1. Não existe visitante ══════════════════════════════════════════════
  console.log("\n━━━ 1. não existe visitante ━━━");

  const joined = await CommunityService.join(U(forasteiro), {
    id_profile: condo.id_profile,
  });
  check("o botão genérico de Entrar RECUSA condomínio", () => {
    assert.ok(joined.error, "deveria recusar");
    assert.strictEqual(joined.needs_claim, true);
  });
  check("a recusa é 409 (conflito de fluxo), não 403", () => {
    assert.strictEqual(joined.statusCode, 409);
  });
  const mForasteiro = await CommunityStorage.getMembership(
    pool,
    condo.id_profile,
    forasteiro
  );
  check("nenhuma associação foi criada pela recusa", () => {
    assert.strictEqual(mForasteiro, null);
  });

  // ═══ 2. O gerador da planta (D10) ═════════════════════════════════════════
  console.log("\n━━━ 2. gerador da planta ━━━");

  const notLeader = await CondoResidenceService.createBlock(U(ana), P, {
    name: "Torre X",
    floors: 2,
    units_per_floor: 2,
  });
  check("só a administração monta a planta", () => {
    assert.ok(notLeader.error);
    assert.strictEqual(notLeader.statusCode, 403);
  });

  const tooBig = await CondoResidenceService.createBlock(U(sindico), P, {
    name: "Torre Gigante",
    floors: 200,
    units_per_floor: 100,
  });
  check("o teto recusa erro de digitação (20.000 aptos)", () => {
    assert.ok(tooBig.error);
    assert.match(tooBig.error, /limite/i);
  });

  const gen = await CondoResidenceService.createBlock(U(sindico), P, {
    name: "Torre A",
    floors: 3,
    units_per_floor: 4,
    first_floor: 1,
  });
  check("a planta nasce com andares × apartamentos", () => {
    assert.strictEqual(gen.generated, 12);
    assert.strictEqual(gen.block.floors, 3);
    assert.strictEqual(gen.block.units_per_floor, 4);
  });

  const again = await CondoResidenceService.createBlock(U(sindico), P, {
    name: "Torre A",
    floors: 3,
    units_per_floor: 4,
    first_floor: 1,
  });
  const plantAfter = await CondoResidenceService.getPlant(U(sindico), P);
  check("gerar de novo a mesma grade NÃO duplica apartamento", () => {
    assert.ok(!again.error, again.error);
    assert.strictEqual(plantAfter.units.length, 12);
  });
  check("o andar foi carimbado (101 é andar 1, 304 é andar 3)", () => {
    const u101 = plantAfter.units.find((u) => u.label === "101");
    const u304 = plantAfter.units.find((u) => u.label === "304");
    assert.strictEqual(u101.floor, 1);
    assert.strictEqual(u304.floor, 3);
  });

  const unit101 = plantAfter.units.find((u) => u.label === "101");
  const unit202 = plantAfter.units.find((u) => u.label === "202");

  // ═══ 3. Vazio reconhece; ocupado vira pendência ═══════════════════════════
  console.log("\n━━━ 3. entrar é escolher o apartamento ━━━");

  const c1 = await CondoResidenceService.claimUnit(U(ana), P, {
    id_unit: unit101.id_unit,
  });
  check("apartamento vazio reconhece na hora", () => {
    assert.strictEqual(c1.status, "recognized");
  });
  const mAna = await CommunityStorage.getMembership(pool, condo.id_profile, ana);
  check("reivindicar É a entrada: virou membro da comunidade", () => {
    assert.ok(mAna, "deveria ter associação");
  });

  const c2 = await CondoResidenceService.claimUnit(U(bruno), P, {
    id_unit: unit101.id_unit,
  });
  check("apartamento ocupado vira pendência", () => {
    assert.strictEqual(c2.status, "pending");
  });

  const foreignUnit = await CondoResidenceService.claimUnit(U(carla), P, {
    id_unit: 999999,
  });
  check("id de apartamento de fora do prédio é recusado", () => {
    assert.ok(foreignUnit.error);
    assert.strictEqual(foreignUnit.statusCode, 404);
  });

  // ═══ 4. Aceitar como família ══════════════════════════════════════════════
  console.log("\n━━━ 4. aceitar como família ━━━");

  const notNeighbor = await CondoResidenceService.respondToClaim(
    U(forasteiro),
    { ...P, id_residence: c2.residence.id_residence },
    { action: "family" }
  );
  check("quem não mora na unidade não decide", () => {
    assert.ok(notNeighbor.error);
    assert.strictEqual(notNeighbor.statusCode, 403);
  });

  const fam = await CondoResidenceService.respondToClaim(
    U(ana),
    { ...P, id_residence: c2.residence.id_residence },
    { action: "family" }
  );
  check("o morador atual aceita e o outro vira morador", () => {
    assert.ok(!fam.error, fam.error);
    assert.strictEqual(fam.residence.status, "recognized");
  });

  const both = await CondoResidenceStorage.listUnitResidents(pool, unit101.id_unit);
  check("os DOIS moram no mesmo apartamento (N:N — o fim do E1)", () => {
    assert.strictEqual(both.length, 2);
    assert.ok(both.every((r) => r.status === "recognized"));
  });

  // ═══ 5. Rejeitar e competir ═══════════════════════════════════════════════
  console.log("\n━━━ 5. rejeitar e competir ━━━");

  const c3 = await CondoResidenceService.claimUnit(U(carla), P, {
    id_unit: unit202.id_unit,
  });
  const c4 = await CondoResidenceService.claimUnit(U(forasteiro), P, {
    id_unit: unit202.id_unit,
  });
  check("carla entrou no 202 vazio; forasteiro ficou pendente", () => {
    assert.strictEqual(c3.status, "recognized");
    assert.strictEqual(c4.status, "pending");
  });

  const disp = await CondoResidenceService.respondToClaim(
    U(carla),
    { ...P, id_residence: c4.residence.id_residence },
    { action: "contest", reason: "não conheço essa pessoa" }
  );
  check("contestar abre a disputa", () => {
    assert.ok(!disp.error, disp.error);
    assert.ok(disp.dispute, "deveria abrir disputa");
    assert.strictEqual(disp.dispute.status, "open");
  });
  check("a conversa dos três foi criada", () => {
    assert.ok(disp.dispute.id_conversation, "deveria ter conversa");
  });

  const parts = await db.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_conversation_participant
      WHERE id_conversation = $1 AND deleted_at IS NULL`,
    [disp.dispute.id_conversation]
  );
  check("a conversa tem exatamente três participantes", () => {
    assert.strictEqual(parts.rows[0].n, 3);
  });

  const carlaStill = await ResidenceStorage.getActiveForUserInUnit(pool, {
    id_unit: unit202.id_unit,
    id_user: carla,
  });
  check("§7.1 — contestar NÃO removeu o morador que contestou", () => {
    assert.ok(carlaStill);
    assert.strictEqual(carlaStill.status, "recognized");
    assert.strictEqual(carlaStill.ended_at, null);
  });

  const contestedLink = await ResidenceStorage.getById(
    pool,
    c4.residence.id_residence
  );
  check("§7.1 — nem removeu quem foi contestado (só marcou divergência)", () => {
    assert.strictEqual(contestedLink.status, "contested");
    assert.strictEqual(contestedLink.ended_at, null);
  });

  const dispAgain = await CondoResidenceService.respondToClaim(
    U(carla),
    { ...P, id_residence: c4.residence.id_residence },
    { action: "contest", reason: "de novo" }
  );
  check("contestar duas vezes continua a MESMA disputa", () => {
    assert.strictEqual(
      String(dispAgain.dispute.id_dispute),
      String(disp.dispute.id_dispute)
    );
  });

  // ═══ 6. Comprovante e veredito ════════════════════════════════════════════
  console.log("\n━━━ 6. comprovante e veredito ━━━");

  const video = {
    buffer: Buffer.from("fake-mp4-bytes"),
    mimetype: "video/mp4",
    size: 14,
  };

  const proofByWrongUser = await CondoResidenceService.submitProof(
    U(carla),
    { ...P, id_dispute: disp.dispute.id_dispute },
    video
  );
  check("só quem reivindica envia o comprovante", () => {
    assert.ok(proofByWrongUser.error);
    assert.strictEqual(proofByWrongUser.statusCode, 403);
  });

  const notVideo = await CondoResidenceService.submitProof(
    U(forasteiro),
    { ...P, id_dispute: disp.dispute.id_dispute },
    { buffer: Buffer.from("x"), mimetype: "image/png", size: 1 }
  );
  check("comprovante tem que ser FILMADO (foto é recusada)", () => {
    assert.ok(notVideo.error);
    assert.match(notVideo.error, /v[íi]deo/i);
  });

  const decideByResident = await CondoResidenceService.decideDispute(
    U(carla),
    { ...P, id_dispute: disp.dispute.id_dispute },
    { action: "approve" }
  );
  check("morador comum não decide disputa — só o síndico", () => {
    assert.ok(decideByResident.error);
    assert.strictEqual(decideByResident.statusCode, 403);
  });

  const verdict = await CondoResidenceService.decideDispute(
    U(sindico),
    { ...P, id_dispute: disp.dispute.id_dispute },
    { action: "approve", note: "comprovante confere" }
  );
  check("o síndico aprova", () => {
    assert.ok(!verdict.error, verdict.error);
    assert.strictEqual(verdict.status, "approved");
  });

  const afterVerdict = await CondoResidenceStorage.listUnitResidents(
    pool,
    unit202.id_unit
  );
  check("aprovar um NÃO expulsa o outro: os dois moram no 202", () => {
    assert.strictEqual(afterVerdict.length, 2);
    assert.ok(afterVerdict.every((r) => r.status === "recognized"));
  });

  const dRow = await CondoResidenceStorage.getDisputeById(
    pool,
    disp.dispute.id_dispute
  );
  check("o veredito grava QUEM decidiu (nunca um job)", () => {
    assert.strictEqual(String(dRow.decided_by), String(sindico));
    assert.ok(dRow.decided_at);
  });

  const twice = await CondoResidenceService.decideDispute(
    U(sindico),
    { ...P, id_dispute: disp.dispute.id_dispute },
    { action: "reject" }
  );
  check("disputa decidida não é decidida de novo", () => {
    assert.ok(twice.error);
    assert.strictEqual(twice.statusCode, 409);
  });

  // ═══ 7. Projeção da planta por papel ══════════════════════════════════════
  console.log("\n━━━ 7. projeção por papel ━━━");

  const plantOutsider = await CondoResidenceService.getPlant(U(forasteiro), P);
  // (forasteiro virou morador do 202 no passo 6 — usamos um usuário novo)
  const ze = await mkUser("ze");
  const plantZe = await CondoResidenceService.getPlant(U(ze), P);
  check("quem não é morador vê 'ocupado', não a contagem por porta", () => {
    const u = plantZe.units.find((x) => x.label === "101");
    assert.strictEqual(u.occupied, true);
    assert.strictEqual(u.residents_count, undefined);
  });
  check("morador vê a contagem", () => {
    const u = plantOutsider.units.find((x) => x.label === "101");
    assert.strictEqual(u.residents_count, 2);
  });

  const neighborsForZe = await CondoResidenceService.listResidents(U(ze), P);
  check("a lista de vizinhos exige ser morador", () => {
    assert.ok(neighborsForZe.error);
    assert.strictEqual(neighborsForZe.needs_claim, true);
  });

  const neighborsForAna = await CondoResidenceService.listResidents(U(ana), P);
  check("morador vê os vizinhos, sem a unidade de cada um", () => {
    assert.ok(neighborsForAna.residents.length >= 3);
    assert.strictEqual(neighborsForAna.residents[0].unit_label, undefined);
  });

  const neighborsForSindico = await CondoResidenceService.listResidents(
    U(sindico),
    P
  );
  check("a administração vê quem mora em qual apartamento", () => {
    assert.ok(
      neighborsForSindico.residents.some((r) => r.unit_label !== undefined)
    );
  });

  // ═══ 8. Excluir apartamento com morador ═══════════════════════════════════
  console.log("\n━━━ 8. exclusão em cadeia ━━━");

  const del = await CondoResidenceService.deleteUnit(U(sindico), {
    ...P,
    id_unit: unit101.id_unit,
  });
  check("apagar apartamento com morador é RECUSADO (FK CASCADE em cadeia)", () => {
    assert.ok(del.error);
    assert.strictEqual(del.statusCode, 409);
    assert.strictEqual(del.residents, 2);
  });

  const emptyUnit = plantAfter.units.find((u) => u.label === "304");
  const delEmpty = await CondoResidenceService.deleteUnit(U(sindico), {
    ...P,
    id_unit: emptyUnit.id_unit,
  });
  check("apartamento vazio pode ser removido da planta", () => {
    assert.strictEqual(delEmpty.ok, true);
  });

  // ═══ 9. O resto do condomínio segue a fonte nova ══════════════════════════
  // Esta seção existe por causa de uma regressão real: avisos, enquetes e a
  // lista de moradores ainda perguntavam "quem é o TITULAR desta unidade?" à
  // tabela legada. Como o fluxo novo só escreve em `tb_residence_member`, o
  // morador novo publicava, mas não RECEBIA nada — e falha silenciosa é a pior
  // espécie.
  console.log("\n━━━ 9. avisos, enquetes e moradores na fonte nova ━━━")

  const CondoStorage = require("../src/storages/CondoStorage")
  const CondoNoticeService = require("../src/services/CondoNoticeService")
  const CondoPollStorage = require("../src/storages/CondoPollStorage")

  const statusAna = await CondoStorage.getResidentStatus(pool, condo.id_profile, ana)
  check("getResidentStatus enxerga o morador do fluxo NOVO", () => {
    assert.strictEqual(statusAna.confirmed, true)
    assert.ok(statusAna.units.length >= 1)
  })

  const statusZe = await CondoStorage.getResidentStatus(pool, condo.id_profile, ze)
  check("e não promove quem nunca confirmou apartamento", () => {
    assert.strictEqual(statusZe.confirmed, false)
  })

  const notice = await CondoNoticeService.create(
    U(sindico),
    P,
    {
      scope: "unit",
      id_unit: unit101.id_unit,
      title: "Vazamento",
      body: "Cano do 101 está pingando na garagem.",
    }
  )
  check("aviso direcionado encontra o apartamento na planta nova", () => {
    assert.ok(!notice.error, notice.error)
    assert.strictEqual(notice.notice.scope, "unit")
  })
  check("e é entregue aos DOIS moradores, não só ao primeiro", () => {
    assert.strictEqual(notice.delivered_count, 2)
  })

  const anaNotices = await CondoNoticeService.list(U(ana), P, { scope: "mine" })
  check("o morador do fluxo novo RECEBE o aviso da unidade dele", () => {
    assert.ok(!anaNotices.error, anaNotices.error)
    const ids = (anaNotices.notices || []).map((n) => String(n.id_notice))
    assert.ok(ids.includes(String(notice.notice.id_notice)))
  })

  const carlaNotices = await CondoNoticeService.list(U(carla), P, { scope: "mine" })
  check("e o vizinho de outro apartamento NÃO recebe", () => {
    const ids = (carlaNotices.notices || []).map((n) => String(n.id_notice))
    assert.ok(!ids.includes(String(notice.notice.id_notice)))
  })

  const voters = await CondoPollStorage.listResidentUserIds(pool, condo.id_profile)
  check("o universo da enquete são os moradores da árvore nova", () => {
    const set = new Set(voters.map(String))
    assert.ok(set.has(String(ana)), "ana deveria votar")
    assert.ok(set.has(String(bruno)), "bruno deveria votar")
    assert.ok(!set.has(String(ze)), "ze não é morador")
  })
  check("quem tem duas unidades conta uma vez só", () => {
    assert.strictEqual(voters.length, new Set(voters.map(String)).size)
  })

  const CondoService = require("../src/services/CondoService")
  const legacyClaim = await CondoService.claimUnit(U(ze), P, { number: "103" })
  check("a reivindicação LEGADA foi aposentada (não cria segunda verdade)", () => {
    assert.ok(legacyClaim.error)
    assert.strictEqual(legacyClaim.moved_to, "residence_claim")
  })

  // ─── limpeza ─────────────────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_profile WHERE id_profile = $1`, [
    condo.id_profile,
  ]);
  await db.query(`DELETE FROM public.tb_user WHERE id_user = ANY($1::uuid[])`, [
    created,
  ]);
  await db.query(`DELETE FROM public.tb_address WHERE cep = $1`, [CEP]);
  await db.query(`DELETE FROM public.tb_cep_cache WHERE cep = $1`, [CEP]);
  await db.query(
    `DELETE FROM public.tb_territory
      WHERE municipio_norm = 'sao paulo' AND bairro_norm = 'bela vista'`
  );
  await db.end();
  await pool.end();

  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n━━━ RESULTADO ━━━\n  ${results.length - failed.length}/${results.length} OK`
  );
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
