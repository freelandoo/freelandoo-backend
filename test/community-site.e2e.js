// test/community-site.e2e.js — "Meu Site" da comunidade (mig 212).
//
//   npm run test:community-site
//
// Pré-requisito: Postgres de TESTE (a suíte RECUSA hosts que pareçam produção).
// Docker não sobe nesta máquina — usar o Postgres 16 portátil na porta 55432
// (ver memória `reference_freelandoo_local_postgres`).
//
// Chama os SERVICES direto (sem HTTP, sem R2). O que cobre:
//   Normalização (utils/communitySite — a válvula que paga o preço do JSONB)
//     1. kind de seção fora da lista fechada é DESCARTADO;
//     2. `javascript:` some de ctaUrl e de mapsUrl;
//     3. `data:` não vira imagem;
//     4. object-position com CSS injetado cai no default;
//     5. cor inválida cai no default, #abc vira #aabbcc, chave estranha some;
//     6. tetos de tamanho e de quantidade cortam;
//     7. ids duplicados são desempatados;
//     8. nota de depoimento é fixada entre 1 e 5.
//   Permissão e visibilidade
//     9. líder vê template com exists=false e NÃO grava linha;
//    10. não-líder não salva; anônimo não salva;
//    11. publicar antes de salvar recusa;
//    12. rascunho é invisível para visitante;
//    13. publicado é visível para anônimo em comunidade pública;
//    14. em comunidade PRIVADA, publicado ainda é `locked` para forasteiro;
//    15. membro de privada enxerga;
//    16. em CONDOMÍNIO, membro-não-morador é `locked`;
//    17. salvar não publica sozinho; publicar não é desfeito por um save;
//    18. published_at guarda a PRIMEIRA publicação (republicar não reescreve);
//    19. upload só é autorizado para o líder;
//    20. apagar a comunidade leva o site junto (CASCADE).

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

  const CommunitySite = require("../src/utils/communitySite");
  const CommunitySiteService = require("../src/services/CommunitySiteService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const CondoStorage = require("../src/storages/CondoStorage");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now();
  const mk = (s) => `${s}_${stamp}`;

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

  async function mkCommunity(owner, { kind, privacy, name }) {
    const community = await CommunityStorage.createCommunity(pool, {
      id_user: owner,
      id_machine,
      display_name: name,
      bio: "Bio da comunidade",
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
      await CommunityStorage.setPrivacy(pool, id, {
        privacy: "private",
        monthly_cents: 1000,
      });
    }
    await CommunityStorage.addMember(pool, id, owner, "leader");
    return id;
  }

  const leader = await mkUser("leader");
  const memberU = await mkUser("member");
  const outsider = await mkUser("outsider");

  const pub = await mkCommunity(leader, {
    kind: "common",
    privacy: "public",
    name: mk("Publica"),
  });
  const priv = await mkCommunity(leader, {
    kind: "common",
    privacy: "private",
    name: mk("Privada"),
  });
  const condo = await mkCommunity(leader, {
    kind: "condo",
    privacy: "public",
    name: mk("Condo"),
  });

  await CommunityStorage.addMember(pool, priv, memberU, "member");
  await CommunityStorage.addMember(pool, condo, memberU, "member");

  const U = (id) => ({ id_user: id });

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n━━━ normalização (a válvula que paga o preço do JSONB) ━━━");

  const hostile = CommunitySite.normalizeConfig({
    siteName: "n".repeat(500),
    tagline: 12345,
    theme: { primary: "não-é-cor", accent: "#abc", background: "#0F0F10", evil: "x" },
    sections: [
      { kind: "kind_inventado", data: {} },
      {
        id: "dup",
        kind: "hero",
        data: {
          slides: [
            {
              headline: "h".repeat(400),
              ctaUrl: "javascript:alert(1)",
              imageUrl: "data:image/png;base64,AAAA",
              objectPosition: "red;background:url(//evil)",
            },
          ],
        },
      },
      {
        id: "dup",
        kind: "contact",
        data: { mapsUrl: "javascript:alert(2)", socials: [{ label: "IG", url: "https://ig.com/x" }] },
      },
      { kind: "testimonials", data: { items: [{ rating: 99 }, { rating: "abc" }, { rating: -4 }] } },
      { kind: "gallery", data: { columns: 77, photos: Array(500).fill({ imageUrl: "https://cdn/x.jpg" }) } },
    ],
  });

  check("1. kind de seção fora da lista fechada é descartado", () => {
    assert.ok(!hostile.sections.some((s) => s.kind === "kind_inventado"));
    assert.deepStrictEqual(
      hostile.sections.map((s) => s.kind),
      ["hero", "contact", "testimonials", "gallery"]
    );
  });

  check("2. javascript: some de ctaUrl e de mapsUrl", () => {
    assert.strictEqual(hostile.sections[0].data.slides[0].ctaUrl, "");
    assert.strictEqual(hostile.sections[1].data.mapsUrl, "");
  });

  check("3. data: não vira imagem", () => {
    assert.strictEqual(hostile.sections[0].data.slides[0].imageUrl, "");
  });

  check("4. object-position com CSS injetado cai no default", () => {
    assert.strictEqual(hostile.sections[0].data.slides[0].objectPosition, "center");
  });

  check("5. cor inválida→default, #abc→#aabbcc, chave estranha some", () => {
    assert.strictEqual(hostile.theme.primary, CommunitySite.DEFAULT_THEME.primary);
    assert.strictEqual(hostile.theme.accent, "#aabbcc");
    assert.strictEqual(hostile.theme.background, "#0f0f10");
    assert.strictEqual(hostile.theme.evil, undefined);
  });

  check("6. tetos de tamanho e de quantidade cortam", () => {
    assert.strictEqual(hostile.siteName.length, CommunitySite.LIMITS.SITE_NAME);
    assert.strictEqual(hostile.tagline, "");
    assert.strictEqual(
      hostile.sections[0].data.slides[0].headline.length,
      CommunitySite.LIMITS.TITLE
    );
    assert.strictEqual(hostile.sections[3].data.photos.length, CommunitySite.LIMITS.GALLERY);
    assert.strictEqual(hostile.sections[3].data.columns, 3);
    const capped = CommunitySite.normalizeConfig({
      sections: Array(400).fill({ kind: "about" }),
    });
    assert.strictEqual(capped.sections.length, CommunitySite.LIMITS.SECTIONS);
  });

  check("7. ids duplicados são desempatados", () => {
    const ids = hostile.sections.map((s) => s.id);
    assert.strictEqual(new Set(ids).size, ids.length);
  });

  check("8. nota de depoimento fica entre 1 e 5", () => {
    assert.deepStrictEqual(
      hostile.sections[2].data.items.map((i) => i.rating),
      [5, 5, 1]
    );
  });

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n━━━ leitura, permissão e publicação ━━━");

  const firstGet = await CommunitySiteService.get(U(leader), { id_profile: pub });

  check("9. líder vê template com exists=false e nada é gravado ainda", async () => {
    assert.strictEqual(firstGet.exists, false);
    assert.strictEqual(firstGet.is_leader, true);
    assert.ok(firstGet.config, "template deveria vir preenchido");
    assert.ok(firstGet.config.sections.length > 0, "template deveria ter seções");
    assert.ok(firstGet.config.siteName.length > 0, "template deveria herdar o nome");
  });

  const { rows: noRow } = await db.query(
    `SELECT 1 FROM public.tb_community_site WHERE id_profile = $1`,
    [pub]
  );
  check("9b. GET do líder NÃO cria linha no banco", () => {
    assert.strictEqual(noRow.length, 0);
  });

  const denyOther = await CommunitySiteService.save(
    U(outsider),
    { id_profile: pub },
    { config: firstGet.config }
  );
  const denyAnon = await CommunitySiteService.save(
    {},
    { id_profile: pub },
    { config: firstGet.config }
  );
  check("10. não-líder e anônimo não salvam", () => {
    assert.ok(denyOther.error, "forasteiro deveria ser recusado");
    assert.ok(denyAnon.error, "anônimo deveria ser recusado");
    assert.strictEqual(denyAnon.statusCode, 401);
  });

  const earlyPublish = await CommunitySiteService.setPublished(
    U(leader),
    { id_profile: pub },
    { published: true }
  );
  check("11. publicar antes de salvar recusa", () => {
    assert.ok(earlyPublish.error);
    assert.strictEqual(earlyPublish.statusCode, 404);
  });

  const saved = await CommunitySiteService.save(
    U(leader),
    { id_profile: pub },
    {
      config: {
        ...firstGet.config,
        siteName: "Site da Publica",
        sections: [
          ...firstGet.config.sections,
          { id: "x", kind: "kind_falso", data: {} },
        ],
      },
    }
  );

  check("11b. save devolve o config NORMALIZADO (não o que chegou)", () => {
    assert.ok(!saved.error, saved.error);
    assert.strictEqual(saved.siteName, undefined, "resposta é envelope, não config cru");
    assert.strictEqual(saved.config.siteName, "Site da Publica");
    assert.ok(!saved.config.sections.some((s) => s.kind === "kind_falso"));
  });

  const draftForVisitor = await CommunitySiteService.get(U(outsider), { id_profile: pub });
  const draftForAnon = await CommunitySiteService.get({}, { id_profile: pub });
  check("12. rascunho é invisível para visitante e anônimo", () => {
    assert.strictEqual(draftForVisitor.config, null);
    assert.strictEqual(draftForVisitor.is_published, false);
    assert.strictEqual(draftForAnon.config, null);
  });

  check("17a. salvar NÃO publica sozinho", () => {
    assert.strictEqual(saved.is_published, false);
  });

  const published = await CommunitySiteService.setPublished(
    U(leader),
    { id_profile: pub },
    { published: true }
  );
  check("13. publicado é visível para anônimo em comunidade pública", async () => {
    assert.ok(!published.error, published.error);
    assert.strictEqual(published.is_published, true);
  });

  const anonSees = await CommunitySiteService.get({}, { id_profile: pub });
  check("13b. anônimo recebe o config do site publicado", () => {
    assert.ok(anonSees.config, "config deveria vir");
    assert.strictEqual(anonSees.config.siteName, "Site da Publica");
    assert.ok(!anonSees.locked);
  });

  const afterSave = await CommunitySiteService.save(
    U(leader),
    { id_profile: pub },
    { config: { ...saved.config, tagline: "editado depois de publicar" } }
  );
  check("17b. um save posterior NÃO despublica o site", () => {
    assert.strictEqual(afterSave.is_published, true);
    assert.strictEqual(afterSave.config.tagline, "editado depois de publicar");
  });

  const firstPublishedAt = published.published_at;
  const republished = await CommunitySiteService.setPublished(
    U(leader),
    { id_profile: pub },
    { published: true }
  );
  check("18. published_at guarda a PRIMEIRA publicação", () => {
    assert.strictEqual(
      new Date(republished.published_at).getTime(),
      new Date(firstPublishedAt).getTime()
    );
  });

  // ─── privada ──────────────────────────────────────────────────────────────
  const privDraft = await CommunitySiteService.get(U(leader), { id_profile: priv });
  await CommunitySiteService.save(U(leader), { id_profile: priv }, { config: privDraft.config });
  await CommunitySiteService.setPublished(U(leader), { id_profile: priv }, { published: true });

  const privOutsider = await CommunitySiteService.get(U(outsider), { id_profile: priv });
  const privAnon = await CommunitySiteService.get({}, { id_profile: priv });
  check("14. privada publicada continua trancada para forasteiro e anônimo", () => {
    assert.strictEqual(privOutsider.locked, true);
    assert.strictEqual(privOutsider.config, null);
    assert.strictEqual(privAnon.locked, true);
    assert.strictEqual(privAnon.config, null);
  });

  const privMember = await CommunitySiteService.get(U(memberU), { id_profile: priv });
  check("15. membro de privada enxerga o site", () => {
    assert.ok(!privMember.locked);
    assert.ok(privMember.config);
  });

  // ─── condomínio ───────────────────────────────────────────────────────────
  const condoDraft = await CommunitySiteService.get(U(leader), { id_profile: condo });
  await CommunitySiteService.save(U(leader), { id_profile: condo }, { config: condoDraft.config });
  await CommunitySiteService.setPublished(U(leader), { id_profile: condo }, { published: true });

  const condoMember = await CommunitySiteService.get(U(memberU), { id_profile: condo });
  check("16. condomínio: MEMBRO sem apartamento confirmado é locked", () => {
    // Entrar no condomínio não basta: quem lê o que é interno é o MORADOR.
    assert.strictEqual(condoMember.locked, true);
    assert.strictEqual(condoMember.config, null);
    // E o gate usado é o mesmo predicado de morador do resto do condomínio.
    assert.strictEqual(typeof CondoStorage.getResidentStatus, "function");
  });

  const condoLeader = await CommunitySiteService.get(U(leader), { id_profile: condo });
  check("16b. síndico (líder) enxerga o site do condomínio", () => {
    assert.ok(condoLeader.config);
  });

  // ─── upload ───────────────────────────────────────────────────────────────
  const upLeader = await CommunitySiteService.assertCanUpload(U(leader), { id_profile: pub });
  const upOther = await CommunitySiteService.assertCanUpload(U(outsider), { id_profile: pub });
  const upAnon = await CommunitySiteService.assertCanUpload({}, { id_profile: pub });
  check("19. upload autorizado só para o líder", () => {
    assert.strictEqual(upLeader.ok, true);
    assert.ok(upOther.error);
    assert.ok(upAnon.error);
  });

  // ─── has_site na projeção da comunidade ───────────────────────────────────
  const rowPub = await CommunityStorage.getById(pool, pub);
  const { rows: noSiteRows } = await db.query(
    `SELECT id_profile FROM public.tb_profile
      WHERE is_community = TRUE AND deleted_at IS NULL
        AND id_profile <> ALL($1::uuid[]) LIMIT 1`,
    [[pub, priv, condo]]
  );
  check("19b. has_site sai no getById da comunidade", async () => {
    assert.strictEqual(rowPub.has_site, true);
    if (noSiteRows.length) {
      const other = await CommunityStorage.getById(pool, noSiteRows[0].id_profile);
      assert.strictEqual(other.has_site, false);
    }
  });

  // ─── CASCADE ──────────────────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_profile WHERE id_profile = $1`, [condo]);
  const { rows: orphan } = await db.query(
    `SELECT 1 FROM public.tb_community_site WHERE id_profile = $1`,
    [condo]
  );
  check("20. apagar a comunidade leva o site junto (CASCADE)", () => {
    assert.strictEqual(orphan.length, 0);
  });

  // ─── limpeza + relatório ─────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_profile WHERE id_profile = ANY($1::uuid[])`, [
    [pub, priv],
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
