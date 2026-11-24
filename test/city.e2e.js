// test/city.e2e.js — Minha cidade (mig 468) ponta a ponta.
//
//   npm run test:city
//
// O que importa aqui não é "a preferência salva" — é que ela NÃO vire acesso:
//   1. a migration é idempotente e o CHECK recusa valor inventado;
//   2. o PUT é parcial e por pessoa (um não escreve na preferência do outro);
//   3. o GET devolve os vínculos que JÁ existem (bairro por residência,
//      condomínio por membresia) e nada de comunidade alheia;
//   4. escolher "condomínio" não dá membresia, residência nem leitura de membros;
//   5. trocar a preferência não encerra residência nem membresia.

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
// CEP PRÓPRIO desta suíte: as de bairro/residência criam a comunidade da Bela
// Vista e esperam ser as primeiras — dividir o território quebraria as duas.
const CEP = "30130010"; // Centro, Belo Horizonte (dublê)
viacep.lookupZipcode = async (raw) => {
  const d = String(raw || "").replace(/\D/g, "");
  if (d === CEP) {
    return { cep: CEP, logradouro: "Avenida Afonso Pena", bairro: "Centro City E2E", localidade: "Belo Horizonte", uf: "MG" };
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
  console.log("━━━ migrations (2×: idempotente) ━━━");
  for (let i = 0; i < 2; i++) {
    execFileSync(process.execPath, ["run-migrations.js"], {
      cwd: path.join(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: DB_URL },
      stdio: i === 0 ? "inherit" : "ignore",
    });
  }

  const CityService = require("../src/services/CityService");
  const ResidenceService = require("../src/services/ResidenceService");
  const NeighborhoodService = require("../src/services/NeighborhoodService");
  const CommunityService = require("../src/services/CommunityService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
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
      [`City ${tag}`, `${mk(tag)}@ex.com`, mk(tag)]
    );
    users.push(r.rows[0].id_user);
    return r.rows[0].id_user;
  }
  const U = (id) => ({ id_user: id });

  const casa = await mkUser("casa"); // mora em casa na Bela Vista
  const sindico = await mkUser("sindico"); // cadastrou o condomínio
  const estranho = await mkUser("estranho"); // sem vínculo nenhum

  // ═══ 1. CHECK ═══════════════════════════════════════════════════════════
  console.log("\n━━━ 1. CHECK da migration ━━━");
  let code = null;
  try {
    await db.query(`INSERT INTO public.tb_user_city_pref (id_user, housing_kind) VALUES ($1, 'apartamento')`, [estranho]);
  } catch (e) {
    code = e.code;
  }
  check("housing_kind inventado é recusado pelo banco", () => assert.strictEqual(code, "23514"));

  // ═══ 2. PUT parcial e por pessoa ═════════════════════════════════════════
  console.log("\n━━━ 2. preferência ━━━");
  const vazio = await CityService.getMine(U(estranho));
  check("quem nunca escolheu recebe preferência nula", () => {
    assert.deepStrictEqual(vazio.preference, { housing_kind: null, last_tab: null });
    assert.deepStrictEqual(vazio.bairros, []);
    assert.deepStrictEqual(vazio.condos, []);
  });

  const semLogin = await CityService.getMine(null);
  check("sem usuário: 401", () => assert.strictEqual(semLogin.statusCode, 401));

  const ruim = await CityService.setMine(U(casa), { housing_kind: "mansao" });
  check("valor fora da lista: 400", () => assert.strictEqual(ruim.statusCode, 400));

  const s1 = await CityService.setMine(U(casa), { housing_kind: "house" });
  const s2 = await CityService.setMine(U(casa), { last_tab: "condominio" });
  check("PUT parcial mantém o campo que não veio", () => {
    assert.strictEqual(s1.preference.housing_kind, "house");
    assert.deepStrictEqual(s2.preference, { housing_kind: "house", last_tab: "condominio" });
  });

  await Promise.all([
    CityService.setMine(U(sindico), { housing_kind: "condo" }),
    CityService.setMine(U(sindico), { last_tab: "condominio" }),
  ]);
  const sAfter = await CityService.getMine(U(sindico));
  const casaAfter = await CityService.getMine(U(casa));
  check("dois PUTs simultâneos não perdem campo nem dão chave duplicada", () =>
    assert.deepStrictEqual(sAfter.preference, { housing_kind: "condo", last_tab: "condominio" })
  );
  check("a preferência de um não mexe na do outro", () =>
    assert.strictEqual(casaAfter.preference.housing_kind, "house")
  );

  // ═══ 3. vínculos que já existem ══════════════════════════════════════════
  console.log("\n━━━ 3. vínculos ━━━");
  await ResidenceService.claim({ id_user: casa, cep: CEP, numero: String(stamp % 100000) });
  const comRes = await CityService.getMine(U(casa));
  check("residência sem comunidade aparece como bairro (território)", () => {
    assert.strictEqual(comRes.bairros.length, 1);
    assert.strictEqual(comRes.bairros[0].id_profile, null);
    assert.strictEqual(comRes.bairros[0].bairro_label, "Centro City E2E");
    assert.ok(["recognized", "pending", "unrecognized"].includes(comRes.bairros[0].residence_status));
  });

  // O primeiro morador da unidade é reconhecido de cara (regra da residência),
  // então ele pode criar a comunidade do bairro.
  let hoodId = null;
  if (comRes.bairros[0].residence_status === "recognized") {
    const created = await NeighborhoodService.create(U(casa), {});
    hoodId = created?.community?.id_profile || null;
  }
  const comHood = await CityService.getMine(U(casa));
  check("depois de criada, a comunidade do bairro vem com o id real", () => {
    assert.ok(hoodId, "comunidade criada");
    assert.strictEqual(comHood.bairros.length, 1);
    assert.strictEqual(String(comHood.bairros[0].id_profile), String(hoodId));
    assert.strictEqual(comHood.bairros[0].is_member, true);
  });

  const { rows: machines } = await db.query(`SELECT id_machine FROM public.tb_machine ORDER BY id_machine LIMIT 1`);
  const condo = await CommunityStorage.createCommunity(pool, {
    id_user: sindico,
    id_machine: machines[0].id_machine,
    display_name: mk("Condominio City"),
    bio: null,
    avatar_url: null,
    theme: null,
    kind: "condo",
    address: { street: "Avenida Afonso Pena", number: "1000", complement: null, neighborhood: "Centro City E2E", cep: CEP, estado: "MG", municipio: "Belo Horizonte" },
  });
  await CommunityStorage.addMember(pool, condo.id_profile, sindico, "leader");

  const sindicoCity = await CityService.getMine(U(sindico));
  check("o condomínio de quem é membro aparece com o papel", () => {
    assert.strictEqual(sindicoCity.condos.length, 1);
    assert.strictEqual(String(sindicoCity.condos[0].id_profile), String(condo.id_profile));
    assert.strictEqual(sindicoCity.condos[0].role, "leader");
  });
  check("o GET não devolve endereço do condomínio nem da residência", () => {
    const txt = JSON.stringify([sindicoCity, comHood]);
    assert.ok(!/Afonso Pena|30130010|"1000"/.test(txt), txt);
  });

  // ═══ 4. preferência não vira acesso ═════════════════════════════════════
  console.log("\n━━━ 4. preferência ≠ acesso ━━━");
  await CityService.setMine(U(estranho), { housing_kind: "condo", last_tab: "condominio" });
  const estranhoCity = await CityService.getMine(U(estranho));
  check("escolher condomínio não cria vínculo", () => {
    assert.deepStrictEqual(estranhoCity.condos, []);
    assert.deepStrictEqual(estranhoCity.bairros, []);
  });
  const membros = await CommunityService.getMembers({ id_profile: condo.id_profile }, U(estranho));
  check("e não libera a lista de moradores do condomínio", () => {
    const list = membros?.members || [];
    assert.ok(membros?.error || list.length === 0, JSON.stringify(membros).slice(0, 200));
  });
  const membrosBairro = hoodId
    ? await CommunityService.getMembers({ id_profile: hoodId }, U(estranho))
    : { error: "sem bairro" };
  check("nem a dos vizinhos do bairro", () => {
    const list = membrosBairro?.members || [];
    assert.ok(membrosBairro?.error || list.length === 0);
  });

  // ═══ 5. trocar preferência não encerra nada ═════════════════════════════
  console.log("\n━━━ 5. troca de moradia ━━━");
  await CityService.setMine(U(casa), { housing_kind: "condo" });
  const trocou = await CityService.getMine(U(casa));
  const { rows: res } = await db.query(
    `SELECT count(*)::int AS n FROM public.tb_residence_member WHERE id_user = $1 AND ended_at IS NULL`,
    [casa]
  );
  check("casa → condomínio mantém a residência e a comunidade do bairro", () => {
    assert.strictEqual(trocou.preference.housing_kind, "condo");
    assert.strictEqual(res[0].n, 1);
    assert.strictEqual(trocou.bairros.length, 1);
    assert.strictEqual(trocou.bairros[0].is_member, true);
  });

  // ═══ 6. prévia do CEP ═══════════════════════════════════════════════════
  console.log("\n━━━ 6. prévia do CEP ━━━");
  const TerritoryService = require("../src/services/TerritoryService");
  const prev = await TerritoryService.previewCep("30130-010");
  const naoAchou = await TerritoryService.previewCep("99999999");
  const ruimCep = await TerritoryService.previewCep("123");
  check("prévia mostra rua, bairro e cidade do CEP (o mesmo bairro da declaração)", () => {
    assert.deepStrictEqual(prev.preview, {
      logradouro: "Avenida Afonso Pena",
      bairro: "Centro City E2E",
      municipio: "Belo Horizonte",
      uf: "MG",
      is_city_wide: false,
    });
  });
  check("ViaCEP sem resposta: prévia vazia, sem bairro inventado", () => {
    assert.strictEqual(naoAchou.preview, null);
    assert.strictEqual(naoAchou.unavailable, true);
  });
  check("CEP malformado: 400", () => assert.strictEqual(ruimCep.statusCode, 400));

  // ── limpeza ─────────────────────────────────────────────────────────────
  const ids = [hoodId, condo.id_profile].filter(Boolean);
  await db.query(`DELETE FROM public.tb_community_member WHERE id_community_profile = ANY($1::uuid[])`, [ids]);
  await db.query(`UPDATE public.tb_profile SET deleted_at = NOW() WHERE id_profile = ANY($1::uuid[])`, [ids]);
  await db.query(`UPDATE public.tb_residence_member SET status = 'ended', ended_at = NOW(), end_reason = 'left' WHERE ended_at IS NULL AND id_user = ANY($1::uuid[])`, [users]);
  await db.query(`DELETE FROM public.tb_user_city_pref WHERE id_user = ANY($1::uuid[])`, [users]);
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
