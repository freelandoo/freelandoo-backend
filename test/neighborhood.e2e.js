// test/neighborhood.e2e.js — Subsistema 4: bairro ponta a ponta.
//
//   npm run test:neighborhood
//
// É a primeira modalidade a usar o núcleo inteiro (território da mig 202 +
// residência da mig 203), então o que esta suíte realmente verifica é se as
// três peças se encaixam:
//   1. só morador reconhecido cria e entra;
//   2. UMA comunidade por bairro (índice, não código);
//   3. o bairro herda a blindagem de privacidade sem guard novo;
//   4. bairro não consome a cota de comunidades do usuário;
//   5. descoberta por (cidade, bairro) e nunca por rua;
//   6. bairro sem enxame — o CHECK relaxado (C5) sem taxonomia falsa.

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

const viacep = require("../src/integrations/viacep/lookup");
const CEP = "01310100"; // Bela Vista
const CEP_OUTRO = "04538133"; // Itaim Bibi
viacep.lookupZipcode = async (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  if (d === CEP) {
    return {
      cep: CEP,
      logradouro: "Avenida Paulista",
      bairro: "Bela Vista",
      localidade: "São Paulo",
      uf: "SP",
    };
  }
  if (d === CEP_OUTRO) {
    return {
      cep: CEP_OUTRO,
      logradouro: "Avenida Brigadeiro Faria Lima",
      bairro: "Itaim Bibi",
      localidade: "São Paulo",
      uf: "SP",
    };
  }
  return null;
};

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

  const NeighborhoodService = require("../src/services/NeighborhoodService");
  const ResidenceService = require("../src/services/ResidenceService");
  const CommunityService = require("../src/services/CommunityService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const CommunityPolicy = require("../src/utils/communityPolicy");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now();
  const mk = (s) => `${s}_${stamp}`;
  const users = [];
  async function mkUser(tag) {
    const r = await db.query(
      `INSERT INTO public.tb_user (nome, email, senha, username, ativo, data_nascimento)
            VALUES ($1, $2, 'x', $3, TRUE, '1990-01-01') RETURNING id_user`,
      [`User ${tag}`, `${mk(tag)}@ex.com`, mk(tag)]
    );
    users.push(r.rows[0].id_user);
    return r.rows[0].id_user;
  }

  const ana = await mkUser("ana"); // moradora da Bela Vista
  const bruno = await mkUser("bruno"); // vizinho de outra unidade
  const carla = await mkUser("carla"); // moradora do Itaim
  const davi = await mkUser("davi"); // não mora em lugar nenhum

  await ResidenceService.claim({ id_user: ana, cep: CEP, numero: "1578", complemento: "45" });
  await ResidenceService.claim({ id_user: bruno, cep: CEP, numero: "1600" });
  await ResidenceService.claim({ id_user: carla, cep: CEP_OUTRO, numero: "100" });

  // ═══ 1. criação ═══════════════════════════════════════════════════════
  console.log("\n━━━ 1. criação ━━━");

  const semResidencia = await NeighborhoodService.create({ id_user: davi }, {});
  check("quem não mora no bairro não cria a comunidade dele", () => {
    assert.strictEqual(semResidencia.statusCode, 403);
  });

  const criado = await NeighborhoodService.create({ id_user: ana }, {});
  check("morador reconhecido cria a comunidade do bairro", () => {
    assert.ok(criado.community?.id_profile);
    assert.strictEqual(criado.community.community_kind, "neighborhood");
  });
  check("nome padrão sai do território, não do fundador", () => {
    assert.match(criado.community.display_name, /Bela Vista/);
  });
  check("cidade e UF vêm do TERRITÓRIO", () => {
    assert.strictEqual(criado.community.estado, "SP");
    assert.strictEqual(criado.community.municipio, "São Paulo");
  });

  const semEnxame = await db.query(
    `SELECT id_machine, id_category FROM public.tb_profile WHERE id_profile = $1`,
    [criado.community.id_profile]
  );
  check("bairro não carrega enxame nem categoria fantasma (resolve C5)", () => {
    assert.strictEqual(semEnxame.rows[0].id_machine, null);
    assert.strictEqual(semEnxame.rows[0].id_category, null);
  });

  const duplicado = await NeighborhoodService.create({ id_user: bruno }, {});
  check("UMA comunidade por bairro (§4.3)", () => {
    assert.strictEqual(duplicado.statusCode, 409);
    assert.strictEqual(
      String(duplicado.id_profile),
      String(criado.community.id_profile)
    );
  });

  const outroBairro = await NeighborhoodService.create({ id_user: carla }, {});
  check("outro bairro tem comunidade própria", () => {
    assert.ok(outroBairro.community?.id_profile);
    assert.notStrictEqual(
      String(outroBairro.community.id_profile),
      String(criado.community.id_profile)
    );
  });

  // ═══ 2. entrada ═══════════════════════════════════════════════════════
  console.log("\n━━━ 2. entrada ━━━");

  const id_profile = criado.community.id_profile;

  const forasteiro = await NeighborhoodService.join({ id_user: davi }, { id_profile });
  check("forasteiro não entra no bairro", () => {
    assert.strictEqual(forasteiro.statusCode, 403);
  });

  const deOutroBairro = await NeighborhoodService.join({ id_user: carla }, { id_profile });
  check("morador de OUTRO bairro não entra", () => {
    assert.strictEqual(deOutroBairro.statusCode, 403);
  });

  const vizinho = await NeighborhoodService.join({ id_user: bruno }, { id_profile });
  check("morador reconhecido entra", () => {
    assert.strictEqual(vizinho.joined, true);
  });

  // Quem está esperando reconhecimento recebe mensagem DIFERENTE de quem não
  // mora ali — a espera não pode parecer recusa.
  const eva = await mkUser("eva");
  await ResidenceService.claim({ id_user: eva, cep: CEP, numero: "1578", complemento: "45" });
  const esperando = await NeighborhoodService.join({ id_user: eva }, { id_profile });
  check("quem aguarda reconhecimento recebe recusa com o motivo certo", () => {
    assert.strictEqual(esperando.statusCode, 403);
    assert.match(esperando.error, /ainda não foi reconhecida/i);
    assert.strictEqual(esperando.residence_status, "pending");
  });

  // ═══ 3. privacidade herdada ═══════════════════════════════════════════
  console.log("\n━━━ 3. privacidade herdada ━━━");

  const policy = CommunityPolicy.policyFor({ kind: "neighborhood" });
  check("bairro cai na política territorial sem guard novo", () => {
    assert.strictEqual(policy.id, "territorial");
    assert.strictEqual(policy.contentIsExclusive, true);
    assert.strictEqual(policy.feedRequiresMembership, true);
  });

  const anon = await CommunityService.getById({ id_profile }, null);
  check("anônimo não vê contagem de moradores do bairro", () => {
    assert.strictEqual("member_count" in anon.community, false);
    assert.strictEqual("xp_total" in anon.community, false);
  });
  check("anônimo ainda vê o nome do bairro (é como ele acha o lugar)", () => {
    assert.ok(anon.community.display_name);
  });

  const goalAnon = await CommunityService.getGoal({ id_profile }, null);
  check("/goal do bairro recusa anônimo", () => {
    assert.strictEqual(goalAnon.statusCode, 403);
  });
  const goalOutsider = await CommunityService.getGoal({ id_profile }, { id_user: davi });
  check("/goal do bairro recusa forasteiro logado", () => {
    assert.strictEqual(goalOutsider.statusCode, 403);
  });
  const goalResident = await CommunityService.getGoal({ id_profile }, { id_user: bruno });
  check("/goal do bairro libera morador", () => {
    assert.ok(!goalResident.statusCode);
  });

  const membersOutsider = await CommunityService.getMembers({ id_profile }, { id_user: davi });
  check("lista de vizinhos recusa forasteiro", () => {
    assert.strictEqual(membersOutsider.statusCode, 403);
  });
  const membersResident = await CommunityService.getMembers({ id_profile }, { id_user: ana });
  check("lista de vizinhos libera morador", () => {
    assert.ok(Array.isArray(membersResident.members));
  });

  const viewAna = await CommunityService.getById({ id_profile }, { id_user: ana });
  check("a tela sabe a posição do viewer no bairro", () => {
    assert.strictEqual(viewAna.community.viewer_is_resident, true);
    assert.strictEqual(viewAna.community.viewer_residence_status, "recognized");
  });
  const viewEva = await CommunityService.getById({ id_profile }, { id_user: eva });
  check("quem aguarda aparece como não-morador com status próprio", () => {
    assert.strictEqual(viewEva.community.viewer_is_resident, false);
    assert.strictEqual(viewEva.community.viewer_residence_status, "pending");
  });

  // ═══ 4. cotas e descoberta ════════════════════════════════════════════
  console.log("\n━━━ 4. cotas e descoberta ━━━");

  const owned = await CommunityStorage.countOwned(pool, ana);
  const memberships = await CommunityStorage.countMemberships(pool, bruno);
  check("bairro não consome a cota de comunidades criadas", () => {
    assert.strictEqual(owned, 0);
  });
  check("bairro não consome a cota de participação", () => {
    assert.strictEqual(memberships, 0);
  });

  const disc = await NeighborhoodService.discover({ uf: "SP", municipio: "Sao Paulo" });
  check("descoberta lista os bairros da cidade", () => {
    const labels = disc.neighborhoods.map((n) => n.bairro_label);
    assert.ok(labels.includes("Bela Vista"));
    assert.ok(labels.includes("Itaim Bibi"));
  });
  check("bairro sem comunidade aparece na descoberta (para poder ser criado)", () => {
    const row = disc.neighborhoods.find((n) => n.bairro_label === "Bela Vista");
    assert.ok(row.id_profile, "Bela Vista deveria ter comunidade");
  });
  check("descoberta NÃO devolve contagem nem endereço", () => {
    const row = disc.neighborhoods[0];
    assert.strictEqual("member_count" in row, false);
    assert.strictEqual("cep" in row, false);
    assert.strictEqual("numero" in row, false);
  });

  const porRua = await NeighborhoodService.discover({
    uf: "SP",
    municipio: "Sao Paulo",
    q: "Paulista",
  });
  check("não se acha bairro pelo nome da RUA (D5 / fecha C4)", () => {
    assert.strictEqual(porRua.neighborhoods.length, 0);
  });

  const semCidade = await NeighborhoodService.discover({ uf: "SP" });
  check("descoberta exige cidade (nunca varre o Brasil inteiro)", () => {
    assert.strictEqual(semCidade.statusCode, 400);
  });

  const mine = await NeighborhoodService.mine({ id_user: ana });
  check("'meus bairros' traz onde moro com a comunidade e meu papel", () => {
    const row = mine.neighborhoods.find((n) => n.bairro_label === "Bela Vista");
    assert.ok(row);
    assert.strictEqual(row.residence_status, "recognized");
    assert.strictEqual(row.is_member, true);
    assert.strictEqual(row.role, "leader");
  });

  // ─── limpeza ─────────────────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_user WHERE id_user = ANY($1::uuid[])`, [users]);
  await db.query(`DELETE FROM public.tb_address WHERE cep = ANY($1::bpchar[])`, [
    [CEP, CEP_OUTRO],
  ]);
  await db.query(`DELETE FROM public.tb_cep_cache WHERE cep = ANY($1::bpchar[])`, [
    [CEP, CEP_OUTRO],
  ]);
  await db.query(
    `DELETE FROM public.tb_territory
      WHERE municipio_norm = 'sao paulo' AND bairro_norm IN ('bela vista', 'itaim bibi')`
  );
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
