// test/spaces.e2e.js — Pet, Carro e Games (mig 210) ponta a ponta.
//
//   npm run test:spaces
//
// As três reaproveitam o perfil-comunidade inteiro, então o que esta suíte
// verifica não é "a comunidade salva" — é justamente onde o reaproveitamento
// poderia vazar:
//   1. o banco aceita as três SEM enxame e recusa modalidade inventada;
//   2. "uma comunidade por modelo de carro" é garantido pelo ÍNDICE, e a corrida
//      entre dois fundadores termina com o segundo ENTRANDO na do primeiro;
//   3. vira-lata é decidido pelo CATÁLOGO, não pelo cliente;
//   4. as três ficam fora dos tetos vendáveis de comunidade;
//   5. pet e games ficam fora do XP/ranking de comunidades, carro fica dentro;
//   6. a política de exposição as trata como públicas (sem isso elas cairiam no
//      default territorial e apareceriam sem contagem, como um condomínio);
//   7. a flag de cada modalidade barra a CRIAÇÃO sem sumir com o que já existe.
//
// A FIPE é substituída por um dublê: a suíte não pode depender da internet nem
// bater num serviço de terceiro a cada execução.

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

// ─── Dublê da FIPE ────────────────────────────────────────────────────────────
// Registrado no require.cache ANTES de o service ser carregado: assim o service
// real (com toda a sua lógica de corrida e catálogo) roda sem tocar a rede.
const FIPE_BRANDS = [
  { code: "21", label: "Honda" },
  { code: "59", label: "Volkswagen" },
];
const FIPE_MODELS = {
  21: [
    { code: "4321", label: "Civic LX 1.7" },
    { code: "4322", label: "Fit LX 1.4" },
  ],
  59: [{ code: "9001", label: "Gol 1.0" }],
};
let fipeOffline = false;

const fipePath = require.resolve("../src/integrations/fipe/catalog");
require.cache[fipePath] = {
  id: fipePath,
  filename: fipePath,
  loaded: true,
  exports: {
    async listBrands() {
      return fipeOffline ? [] : FIPE_BRANDS;
    },
    async listModels(brandCode) {
      if (fipeOffline) return [];
      return FIPE_MODELS[String(brandCode)] || [];
    },
    async verifyModel({ brand_code, model_code }) {
      if (fipeOffline) return { verified: null };
      const models = FIPE_MODELS[String(brand_code)] || [];
      const found = models.find((m) => m.code === String(model_code));
      if (!found) return { verified: false };
      const brand = FIPE_BRANDS.find((b) => b.code === String(brand_code));
      return {
        verified: true,
        brand_label: brand ? brand.label : null,
        model_label: found.label,
      };
    },
  },
};

async function main() {
  console.log("━━━ migrations ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "inherit",
  });

  const SubjectCommunityService = require("../src/services/SubjectCommunityService");
  const SubjectCommunityStorage = require("../src/storages/SubjectCommunityStorage");
  const CommunityService = require("../src/services/CommunityService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const CommunityPolicy = require("../src/utils/communityPolicy");
  const Subject = require("../src/utils/subjectCommunities");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // ── fixture: dois usuários (o segundo é quem disputa o mesmo carro) ─────
  const stamp = Date.now();
  const cat = await db.query(
    `SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1`
  );
  const id_category = cat.rows[0].id_category;

  async function makeUser(tag) {
    const u = await db.query(
      `INSERT INTO public.tb_user (nome, email, senha, username, ativo, data_nascimento)
            VALUES ($1, $2, 'x', $3, TRUE, '1990-01-01')
         RETURNING id_user`,
      [`Spaces ${tag}`, `spaces_${tag}_${stamp}@ex.com`, `spaces_${tag}_${stamp}`]
    );
    const id_user = u.rows[0].id_user;
    // Subperfil de verdade: entrar em comunidade exige ao menos um (é o gate do
    // CommunityService.join, e é ele que o carro reaproveita).
    await db.query(
      `INSERT INTO public.tb_profile
              (id_user, display_name, sub_profile_slug, id_category, is_visible, is_active)
            VALUES ($1, $2, $3, $4, TRUE, TRUE)`,
      [id_user, `Spaces ${tag}`, `spaces-${tag}-${stamp}`, id_category]
    );
    return { id_user };
  }

  const dono = await makeUser("dono");
  const outro = await makeUser("outro");

  // ═══ 1. modalidade no banco ═══════════════════════════════════════════
  console.log("\n━━━ 1. CHECKs da migration ━━━");

  let code = null;
  try {
    await db.query(
      `INSERT INTO public.tb_profile
              (id_user, display_name, sub_profile_slug, is_community, id_leader_user, community_kind)
            VALUES ($1, 'Inventada', $2, TRUE, $1, 'dinossauro')`,
      [dono.id_user, `inventada-${stamp}`]
    );
  } catch (e) {
    code = e.code;
  }
  check("banco recusa modalidade inventada", () => assert.strictEqual(code, "23514"));

  const breeds = await SubjectCommunityStorage.listBreeds(pool, "dog");
  check("catálogo de cães vem com vira-lata em primeiro", () => {
    assert.ok(breeds.length > 10);
    assert.strictEqual(breeds[0].is_mixed, true);
  });

  // ═══ 2. Pet ═══════════════════════════════════════════════════════════
  console.log("\n━━━ 2. Pet ━━━");

  const semNome = await SubjectCommunityService.createPet(dono, { species: "dog" });
  check("pet sem nome é recusado", () => assert.ok(semNome.error));

  const especieInvalida = await SubjectCommunityService.createPet(dono, {
    display_name: "Bicho",
    species: "dragao",
  });
  check("espécie inventada é recusada", () => assert.ok(especieInvalida.error));

  const rex = await SubjectCommunityService.createPet(dono, {
    display_name: "Rex",
    species: "dog",
    breed_slug: "vira-lata",
    bio: "O melhor cachorro do prédio.",
  });
  check("cria a comunidade do pet", () => {
    assert.ok(!rex.error, rex.error);
    assert.strictEqual(rex.community.community_kind, "pet");
  });
  check("pet nasce SEM enxame (nada de categoria fantasma)", () => {
    assert.strictEqual(rex.community.id_machine, null);
  });
  check("vira-lata sai do catálogo", () => {
    assert.strictEqual(rex.pet.is_mixed, true);
    assert.strictEqual(rex.pet.breed_label, "Vira-lata (SRD)");
  });

  const golden = await SubjectCommunityService.createPet(dono, {
    display_name: "Thor",
    species: "dog",
    breed_slug: "golden-retriever",
    // O cliente MENTE dizendo que é vira-lata: quem decide é o catálogo.
    is_mixed: true,
  });
  check("cliente não consegue declarar vira-lata por conta própria", () => {
    assert.strictEqual(golden.pet.is_mixed, false);
    assert.strictEqual(golden.pet.breed_label, "Golden Retriever");
  });
  check("o mesmo dono pode ter vários pets", () => {
    assert.notStrictEqual(rex.community.id_profile, golden.community.id_profile);
  });

  const semRaca = await SubjectCommunityService.createPet(dono, {
    display_name: "Resgatado",
    species: "other",
  });
  check("pet sem raça é aceito (quem resgatou não sabe a raça)", () => {
    assert.ok(!semRaca.error, semRaca.error);
    assert.strictEqual(semRaca.pet.id_breed, null);
  });

  // ═══ 3. Games ═════════════════════════════════════════════════════════
  console.log("\n━━━ 3. Games ━━━");

  const plataformaRuim = await SubjectCommunityService.createGame(dono, {
    game_title: "Minecraft",
    platform: "ps5",
  });
  check("plataforma fora da lista é recusada", () => assert.ok(plataformaRuim.error));

  const jogo = await SubjectCommunityService.createGame(dono, {
    game_title: "Minecraft",
    platform: "pc",
    gamertag: "alex",
  });
  check("cria a comunidade do jogo", () => {
    assert.ok(!jogo.error, jogo.error);
    assert.strictEqual(jogo.community.community_kind, "games");
  });
  check("sem nome próprio a comunidade se chama como o jogo", () => {
    assert.strictEqual(jogo.community.display_name, "Minecraft");
  });
  const jogoOutro = await SubjectCommunityService.createGame(outro, {
    game_title: "Minecraft",
    platform: "playstation",
  });
  check("games é pessoal: o segundo cria a dele", () => {
    assert.ok(!jogoOutro.error, jogoOutro.error);
    assert.notStrictEqual(jogo.community.id_profile, jogoOutro.community.id_profile);
  });

  // ═══ 4. Carro ═════════════════════════════════════════════════════════
  console.log("\n━━━ 4. Carro ━━━");

  const modeloInexistente = await SubjectCommunityService.createOrJoinCar(dono, {
    brand_code: "21",
    brand_label: "Honda",
    model_code: "0000",
    model_label: "Inventado",
  });
  check("modelo fora da FIPE é recusado", () => assert.ok(modeloInexistente.error));

  const civic = await SubjectCommunityService.createOrJoinCar(dono, {
    brand_code: "21",
    brand_label: "Honda",
    // Rótulo torto de propósito: o catálogo é quem manda.
    model_code: "4321",
    model_label: "civic velho",
  });
  check("funda a comunidade do modelo", () => {
    assert.ok(!civic.error, civic.error);
    assert.strictEqual(civic.created, true);
  });
  check("o nome vem do catálogo, não do cliente", () => {
    assert.strictEqual(civic.community.display_name, "Honda Civic LX 1.7");
  });

  const civic2 = await SubjectCommunityService.createOrJoinCar(outro, {
    brand_code: "21",
    brand_label: "Honda",
    model_code: "4321",
    model_label: "Civic LX 1.7",
  });
  check("o segundo NÃO cria: entra na comunidade do primeiro", () => {
    assert.ok(!civic2.error, civic2.error);
    assert.strictEqual(civic2.created, false);
    assert.strictEqual(civic2.joined, true);
    assert.strictEqual(
      String(civic2.community.id_profile),
      String(civic.community.id_profile)
    );
  });

  const membros = await db.query(
    `SELECT COUNT(*)::int AS n FROM public.tb_community_member WHERE id_community_profile = $1`,
    [civic.community.id_profile]
  );
  check("os dois estão dentro da mesma comunidade", () =>
    assert.strictEqual(membros.rows[0].n, 2)
  );

  // A garantia real é o índice — não o `if` do service.
  const idModel = (
    await db.query(
      `SELECT id_car_model FROM public.tb_profile WHERE id_profile = $1`,
      [civic.community.id_profile]
    )
  ).rows[0].id_car_model;
  code = null;
  try {
    await db.query(
      `INSERT INTO public.tb_profile
              (id_user, display_name, sub_profile_slug, is_community, id_leader_user,
               community_kind, id_car_model)
            VALUES ($1, 'Civic pirata', $2, TRUE, $1, 'car', $3)`,
      [outro.id_user, `civic-pirata-${stamp}`, idModel]
    );
  } catch (e) {
    code = e.code;
  }
  check("índice único impede uma segunda comunidade do mesmo modelo", () =>
    assert.strictEqual(code, "23505")
  );

  const gol = await SubjectCommunityService.createOrJoinCar(outro, {
    brand_code: "59",
    brand_label: "Volkswagen",
    model_code: "9001",
    model_label: "Gol 1.0",
  });
  check("outro modelo funda comunidade própria", () => {
    assert.strictEqual(gol.created, true);
  });

  // FIPE fora do ar não pode travar o cadastro (mesma regra do ViaCEP).
  fipeOffline = true;
  const offline = await SubjectCommunityService.createOrJoinCar(dono, {
    brand_code: "77",
    brand_label: "Marca Rara",
    model_code: "123",
    model_label: "Modelo Raro",
  });
  check("FIPE fora do ar não trava o cadastro", () => {
    assert.ok(!offline.error, offline.error);
    assert.strictEqual(offline.created, true);
  });
  const src = await db.query(
    `SELECT source FROM public.tb_car_model WHERE brand_code = '77' AND model_code = '123'`
  );
  check("modelo cadastrado sem a FIPE fica marcado como manual", () =>
    assert.strictEqual(src.rows[0].source, "manual")
  );
  fipeOffline = false;

  // ═══ 5. Tetos, XP e ranking ═══════════════════════════════════════════
  console.log("\n━━━ 5. Tetos e ranking ━━━");

  const owned = await CommunityStorage.countOwned(pool, dono.id_user);
  check("pet/carro/games não consomem o teto de criar", () =>
    assert.strictEqual(owned, 0)
  );
  const memberships = await CommunityStorage.countMemberships(pool, dono.id_user);
  check("pet/carro/games não consomem o teto de participar", () =>
    assert.strictEqual(memberships, 0)
  );

  const rankable = await db.query(
    `SELECT community_kind FROM public.tb_profile
      WHERE is_community = TRUE AND deleted_at IS NULL
        AND community_kind NOT IN ('condo', 'pet', 'games')
        AND id_leader_user = ANY($1::uuid[])`,
    [[dono.id_user, outro.id_user]]
  );
  check("só o carro entra no recorte de XP/ranking", () => {
    const kinds = new Set(rankable.rows.map((r) => r.community_kind));
    assert.ok(kinds.has("car"));
    assert.ok(!kinds.has("pet"));
    assert.ok(!kinds.has("games"));
  });

  // ═══ 6. Política de exposição ═════════════════════════════════════════
  console.log("\n━━━ 6. Exposição ━━━");

  for (const kind of Subject.SUBJECT_KINDS) {
    const policy = CommunityPolicy.policyFor({ kind, privacy: "public" });
    check(`${kind} é comunidade pública (não cai no default territorial)`, () => {
      assert.strictEqual(policy.id, "thematic_public");
      assert.strictEqual(
        CommunityPolicy.can(policy, "counters", CommunityPolicy.TIER.anonymous),
        true
      );
    });
  }

  const visao = await CommunityService.getById(
    { id_profile: rex.community.id_profile },
    null
  );
  check("visitante anônimo vê a comunidade do pet com o assunto", () => {
    assert.ok(!visao.error, visao.error);
    assert.strictEqual(visao.community.kind, "pet");
    assert.strictEqual(visao.community.subject.breed_label, "Vira-lata (SRD)");
    assert.ok(typeof visao.community.member_count === "number");
  });

  const visaoCarro = await CommunityService.getById(
    { id_profile: civic.community.id_profile },
    null
  );
  check("a comunidade do carro devolve marca e modelo", () => {
    assert.strictEqual(visaoCarro.community.subject.brand_label, "Honda");
    assert.strictEqual(visaoCarro.community.subject.model_label, "Civic LX 1.7");
  });

  const vitrine = await CommunityStorage.listPublic(pool, { kind: "pet", limit: 50 });
  check("vitrine filtra por modalidade e traz o rótulo do assunto", () => {
    const mine = vitrine.find(
      (c) => String(c.id_profile) === String(rex.community.id_profile)
    );
    assert.ok(mine, "pet não apareceu na vitrine");
    assert.strictEqual(mine.subject_label, "Vira-lata (SRD)");
  });

  // ═══ 7. Menu da foto de perfil ════════════════════════════════════════
  console.log("\n━━━ 7. /me/spaces ━━━");

  const spaces = await SubjectCommunityService.mySpaces(dono);
  check("agrupa os espaços por modalidade", () => {
    assert.ok(!spaces.error, spaces.error);
    assert.strictEqual(spaces.spaces.pet.length, 3);
    assert.strictEqual(spaces.spaces.games.length, 1);
    assert.strictEqual(spaces.spaces.car.length, 2);
    assert.strictEqual(spaces.spaces.common.length, 0);
  });
  check("o rótulo do assunto vem junto (o menu mostra a raça)", () => {
    const nomes = spaces.spaces.pet.map((p) => p.subject_label);
    assert.ok(nomes.includes("Vira-lata (SRD)"));
    assert.ok(nomes.includes("Golden Retriever"));
  });

  // ═══ 8. Kill-switch ═══════════════════════════════════════════════════
  console.log("\n━━━ 8. Flags ━━━");

  await db.query(`UPDATE public.tb_feature_flag SET is_enabled = FALSE WHERE flag_key = 'pet'`);
  require("../src/services/FeatureFlagService").invalidate();
  const bloqueado = await SubjectCommunityService.createPet(dono, {
    display_name: "Bloqueado",
    species: "cat",
  });
  check("flag desligada barra a criação", () => {
    assert.ok(bloqueado.error);
    assert.strictEqual(bloqueado.statusCode, 403);
  });
  const aindaVisivel = await CommunityService.getById(
    { id_profile: rex.community.id_profile },
    null
  );
  check("o que já existe continua abrindo com a flag desligada", () =>
    assert.ok(!aindaVisivel.error)
  );
  await db.query(`UPDATE public.tb_feature_flag SET is_enabled = TRUE WHERE flag_key = 'pet'`);
  require("../src/services/FeatureFlagService").invalidate();

  // ── limpeza ────────────────────────────────────────────────────────────
  const users = [dono.id_user, outro.id_user];
  await db.query(
    `DELETE FROM public.tb_community_member
      WHERE id_community_profile IN (SELECT id_profile FROM public.tb_profile WHERE id_user = ANY($1::uuid[]))`,
    [users]
  );
  await db.query(`DELETE FROM public.tb_profile WHERE id_user = ANY($1::uuid[])`, [users]);
  await db.query(`DELETE FROM public.tb_user WHERE id_user = ANY($1::uuid[])`, [users]);
  await db.query(`DELETE FROM public.tb_car_model WHERE brand_code IN ('21','59','77')`);
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
