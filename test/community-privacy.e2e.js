// test/community-privacy.e2e.js — Subsistema 1: blindagem de privacidade.
//
//   npm run test:privacy
//
// Pré-requisito: Postgres de TESTE (a suíte RECUSA hosts que pareçam produção).
//   docker run -d --name fl-test-pg -e POSTGRES_PASSWORD=test \
//     -e POSTGRES_DB=freelandoo_test -p 55432:5432 postgres:16-alpine
//
// O que ela cobre, chamando os SERVICES direto (sem HTTP, sem Stripe):
//   1. listagem pública não devolve contadores de privada nem de condomínio;
//   2. temática pública segue devolvendo contadores para anônimo;
//   3. membro vê os contadores da própria comunidade;
//   4. busca por rua NÃO acha o condomínio; busca por bairro acha;
//   5. /members de privada recusa forasteiro e libera membro;
//   6. /members de condomínio recusa membro-não-morador e libera morador;
//   7. /goal recusa anônimo e forasteiro em privada e em condomínio;
//   8. /goal segue aberto em temática pública;
//   9. getById esconde contadores e mascara o endereço conforme o tier.

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

  const CommunityService = require("../src/services/CommunityService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now();
  const mk = (s) => `${s}_${stamp}`;

  // ─── fixtures ────────────────────────────────────────────────────────────
  const { rows: machines } = await db.query(
    `SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`
  );
  const id_machine = machines[0].id_machine;

  async function mkUser(tag) {
    const r = await db.query(
      `INSERT INTO public.tb_user (nome, email, senha, username, ativo)
            VALUES ($1, $2, 'x', $3, TRUE)
         RETURNING id_user`,
      [`User ${tag}`, `${mk(tag)}@ex.com`, mk(tag)]
    );
    return r.rows[0].id_user;
  }

  // Usa a storage REAL de criação: tb_profile tem colunas NOT NULL derivadas
  // (sub_profile_slug) que um INSERT cru quebraria, e assim o teste exercita o
  // mesmo caminho da aplicação.
  async function mkCommunity(owner, { kind, privacy, name }) {
    const community = await CommunityStorage.createCommunity(pool, {
      id_user: owner,
      id_machine,
      display_name: name,
      bio: null,
      avatar_url: null,
      theme: null,
      kind,
      address: {
        street: "Rua Secreta",
        number: "100",
        complement: null,
        neighborhood: "Bairro Publico",
        cep: "01310100",
        estado: "SP",
        municipio: "Sao Paulo",
      },
    });
    const id = community.id_profile;
    if (privacy === "private") {
      await CommunityStorage.setPrivacy(pool, id, { privacy: "private", monthly_cents: 1000 });
    }
    // XP fixo para tornar determinística a asserção de vazamento de contadores.
    await db.query(
      `UPDATE public.tb_profile SET xp_total = 500, xp_level = 3 WHERE id_profile = $1`,
      [id]
    );
    await CommunityStorage.addMember(pool, id, owner, "leader");
    return id;
  }

  const leader = await mkUser("leader");
  const memberU = await mkUser("member");
  const outsider = await mkUser("outsider");

  const pub = await mkCommunity(leader, { kind: "common", privacy: "public", name: mk("Publica") });
  const priv = await mkCommunity(leader, { kind: "common", privacy: "private", name: mk("Privada") });
  const condo = await mkCommunity(leader, { kind: "condo", privacy: "public", name: mk("Condo") });

  await CommunityStorage.addMember(pool, priv, memberU, "member");
  await CommunityStorage.addMember(pool, condo, memberU, "member");

  const V = (id) => (id ? { id_user: id } : null);
  const byId = (list, id) =>
    list.communities.find((c) => String(c.id_profile) === String(id));

  console.log("\n━━━ 1. listagem pública ━━━");
  const listAnon = await CommunityService.listPublic({ q: String(stamp) }, null);

  check("temática pública mantém member_count para anônimo", () => {
    assert.ok("member_count" in byId(listAnon, pub));
  });
  check("temática privada esconde member_count de anônimo", () => {
    assert.strictEqual("member_count" in byId(listAnon, priv), false);
  });
  check("condomínio esconde member_count de anônimo", () => {
    assert.strictEqual("member_count" in byId(listAnon, condo), false);
  });
  check("condomínio esconde xp_total e xp_level de anônimo", () => {
    const row = byId(listAnon, condo);
    assert.strictEqual("xp_total" in row, false);
    assert.strictEqual("xp_level" in row, false);
  });

  const listMember = await CommunityService.listPublic({ q: String(stamp) }, V(memberU));
  check("membro vê member_count da própria comunidade privada", () => {
    assert.ok("member_count" in byId(listMember, priv));
  });

  const listOutsider = await CommunityService.listPublic({ q: String(stamp) }, V(outsider));
  check("forasteiro logado NÃO vê member_count de privada onde não entrou", () => {
    assert.strictEqual("member_count" in byId(listOutsider, priv), false);
  });
  check("forasteiro logado NÃO vê member_count do condomínio", () => {
    assert.strictEqual("member_count" in byId(listOutsider, condo), false);
  });

  console.log("\n━━━ 2. busca por endereço ━━━");
  const byStreet = await CommunityService.listPublic({ q: "Rua Secreta" }, null);
  check("busca por rua NÃO encontra o condomínio (C4)", () => {
    assert.strictEqual(byId(byStreet, condo), undefined);
  });
  const byHood = await CommunityService.listPublic({ q: "Bairro Publico" }, null);
  check("busca por bairro ENCONTRA o condomínio", () => {
    assert.ok(byId(byHood, condo));
  });

  console.log("\n━━━ 3. lista de membros ━━━");
  const mPrivOut = await CommunityService.getMembers({ id_profile: priv }, V(outsider));
  check("privada recusa forasteiro na lista de membros (C3)", () => {
    assert.strictEqual(mPrivOut.statusCode, 403);
  });
  const mPrivMember = await CommunityService.getMembers({ id_profile: priv }, V(memberU));
  check("privada libera membro na lista de membros", () => {
    assert.ok(Array.isArray(mPrivMember.members));
  });
  const mPubAnon = await CommunityService.getMembers({ id_profile: pub }, null);
  check("temática pública segue com lista aberta", () => {
    assert.ok(Array.isArray(mPubAnon.members));
  });
  const mCondoMember = await CommunityService.getMembers({ id_profile: condo }, V(memberU));
  check("condomínio recusa membro que não é morador", () => {
    assert.strictEqual(mCondoMember.statusCode, 403);
  });

  // Promove memberU a morador confirmado do condomínio.
  //
  // Pelo caminho REAL (migs 205/207), não por `setUnitHolder`: a titularidade
  // única de `tb_condo_unit` deixou de ser a verdade sobre quem mora onde, e um
  // fixture que continuasse escrevendo lá testaria um caminho que produção não
  // usa mais — passaria verde enquanto o site quebrava.
  const CondoResidenceService = require("../src/services/CondoResidenceService");
  const plantBlock = await CondoResidenceService.createBlock(
    { id_user: leader },
    { id_condo: condo },
    { name: "Torre A", floors: 1, units_per_floor: 1, first_floor: 1 }
  );
  assert.ok(!plantBlock.error, `planta: ${plantBlock.error}`);
  const condoPlant = await CondoResidenceService.getPlant(
    { id_user: leader },
    { id_condo: condo }
  );
  const claimed = await CondoResidenceService.claimUnit(
    { id_user: memberU },
    { id_condo: condo },
    { id_unit: condoPlant.units[0].id_unit }
  );
  assert.ok(!claimed.error, `claim: ${claimed.error}`);
  const mCondoResident = await CommunityService.getMembers({ id_profile: condo }, V(memberU));
  check("condomínio libera morador confirmado", () => {
    assert.ok(Array.isArray(mCondoResident.members));
  });

  console.log("\n━━━ 4. metas e benchmark ━━━");
  const gPrivAnon = await CommunityService.getGoal({ id_profile: priv }, null);
  check("/goal recusa anônimo em privada (C2)", () => {
    assert.strictEqual(gPrivAnon.statusCode, 403);
  });
  const gPrivOut = await CommunityService.getGoal({ id_profile: priv }, V(outsider));
  check("/goal recusa forasteiro em privada", () => {
    assert.strictEqual(gPrivOut.statusCode, 403);
  });
  const gCondoOut = await CommunityService.getGoal({ id_profile: condo }, V(outsider));
  check("/goal recusa forasteiro em condomínio", () => {
    assert.strictEqual(gCondoOut.statusCode, 403);
  });
  const gCondoResident = await CommunityService.getGoal({ id_profile: condo }, V(memberU));
  check("/goal libera morador confirmado do condomínio", () => {
    assert.strictEqual(gCondoResident.statusCode, undefined);
  });
  const gPubAnon = await CommunityService.getGoal({ id_profile: pub }, null);
  check("/goal segue aberto em temática pública", () => {
    assert.strictEqual(gPubAnon.statusCode, undefined);
  });
  const bPrivAnon = await CommunityService.getBenchmark({ id_profile: priv }, null);
  check("/benchmark recusa anônimo em privada", () => {
    assert.strictEqual(bPrivAnon.statusCode, 403);
  });

  console.log("\n━━━ 5. getById ━━━");
  const cCondoAnon = await CommunityService.getById({ id_profile: condo }, null);
  check("getById de condomínio esconde contadores de anônimo", () => {
    assert.strictEqual("member_count" in cCondoAnon.community, false);
  });
  check("getById de condomínio ainda devolve bairro/cidade", () => {
    assert.strictEqual(cCondoAnon.community.address.neighborhood, "Bairro Publico");
    assert.strictEqual(cCondoAnon.community.address.street, undefined);
  });
  const cCondoRes = await CommunityService.getById({ id_profile: condo }, V(memberU));
  check("getById de condomínio devolve rua ao morador", () => {
    assert.strictEqual(cCondoRes.community.address.street, "Rua Secreta");
  });

  // ─── limpeza + relatório ────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_profile WHERE id_profile = ANY($1::uuid[])`, [
    [pub, priv, condo],
  ]);
  await db.query(`DELETE FROM public.tb_user WHERE id_user = ANY($1::uuid[])`, [
    [leader, memberU, outsider],
  ]);
  await db.end();
  await pool.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n━━━ RESULTADO ━━━\n  ${results.length - failed.length}/${results.length} OK`);
  if (failed.length) {
    for (const f of failed) console.log(`  ✗ ${f.name}: ${f.err}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
