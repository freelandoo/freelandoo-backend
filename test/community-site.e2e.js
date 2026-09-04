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
//     8. nota de depoimento é fixada entre 1 e 5;
//     8b-8e. tamanhos manuais (alças): faixa, AUTO, chave torta, órfã e teto.
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

/**
 * `fn` tem que ser SÍNCRONA.
 *
 * Um `check` com função async passaria por aqui sem esperar: a promessa
 * rejeitada só apareceria depois, como erro solto, e o teste teria acabado de
 * imprimir um sucesso mentiroso. Aconteceu de verdade durante a escrita desta
 * suíte — por isso o harness agora RECUSA função async em vez de aceitá-la e
 * mentir. Quem precisa de I/O calcula o valor ANTES e afirma sobre ele aqui.
 */
function check(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === "function") {
      throw new Error(
        "check() nao aceita funcao async — calcule o valor antes e afirme sobre ele."
      );
    }
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
  const SiteSlug = require("../src/utils/communitySiteSlug");
  const Domain = require("../src/utils/communityDomain");
  const CommunityDomainService = require("../src/services/CommunityDomainService");
  const CommunitySiteService = require("../src/services/CommunitySiteService");
  const CommunityStorage = require("../src/storages/CommunityStorage");
  const CommunitySiteStorage = require("../src/storages/CommunitySiteStorage");
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

  // ─── tamanhos manuais (alças do construtor) ───────────────────────────────
  const sized = CommunitySite.normalizeConfig({
    sections: [
      { id: "s1", kind: "about", layout: { minHeight: 99999, maxWidth: 10 } },
      { id: "s2", kind: "gallery" },
    ],
    textStyles: {
      "site.name": { fontSize: 4000 },
      "sec:s1.title": { width: 1 },
      "sec:s2.body": { fontSize: 24, width: 60 },
      // órfã: nenhuma seção com esse id no payload
      "sec:fantasma.title": { fontSize: 30 },
      // chave torta (espaço e parêntese não entram no alfabeto fechado)
      "url(evil)": { fontSize: 30 },
      // sem nenhum tamanho de verdade
      "site.tagline": { fontSize: "abc" },
    },
  });

  check("8b. tamanho da seção: fora da faixa fixa na borda, ausente é AUTO", () => {
    assert.strictEqual(sized.sections[0].layout.minHeight, CommunitySite.SIZES.HEIGHT_MAX);
    assert.strictEqual(sized.sections[0].layout.maxWidth, CommunitySite.SIZES.MAXW_MIN);
    // Seção nunca redimensionada continua responsiva — null, não um número.
    assert.strictEqual(sized.sections[1].layout.minHeight, null);
    assert.strictEqual(sized.sections[1].layout.maxWidth, null);
  });

  check("8c. tamanho de caixa de texto: faixa, chave torta, órfã e vazia somem", () => {
    assert.strictEqual(sized.textStyles["site.name"].fontSize, CommunitySite.SIZES.FONT_MAX);
    assert.strictEqual(sized.textStyles["sec:s1.title"].width, CommunitySite.SIZES.WIDTH_MIN);
    assert.deepStrictEqual(sized.textStyles["sec:s2.body"], { fontSize: 24, width: 60 });
    assert.strictEqual(sized.textStyles["sec:fantasma.title"], undefined);
    assert.strictEqual(sized.textStyles["url(evil)"], undefined);
    assert.strictEqual(sized.textStyles["site.tagline"], undefined);
  });

  check("8d. teto de entradas de tamanho corta", () => {
    const many = {};
    for (let i = 0; i < 1000; i += 1) many[`site.k${i}`] = { fontSize: 20 };
    const out = CommunitySite.normalizeConfig({ textStyles: many });
    assert.strictEqual(
      Object.keys(out.textStyles).length,
      CommunitySite.LIMITS.TEXT_STYLES
    );
  });

  check("8e. tamanho de seção que perdeu o id (duplicado) não gruda na irmã", () => {
    const out = CommunitySite.normalizeConfig({
      sections: [
        { id: "dup", kind: "about" },
        { id: "dup", kind: "gallery" },
      ],
      textStyles: { "sec:dup.title": { fontSize: 40 } },
    });
    // A primeira mantém "dup"; a segunda ganhou id novo. O estilo continua
    // valendo para quem ficou com a chave — e não vazou para a outra.
    assert.strictEqual(out.sections[0].id, "dup");
    assert.notStrictEqual(out.sections[1].id, "dup");
    assert.strictEqual(out.textStyles["sec:dup.title"].fontSize, 40);
  });

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n━━━ leitura, permissão e publicação ━━━");

  const firstGet = await CommunitySiteService.get(U(leader), { id_profile: pub });

  check("9. líder vê template com exists=false e nada é gravado ainda", () => {
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
  check("13. publicado é visível para anônimo em comunidade pública", () => {
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
  // Comunidade PRÓPRIA sem site, criada aqui. Pescar "uma qualquer do banco"
  // fazia o teste depender de sobra de execução anterior — e ele quebrou de
  // verdade quando uma sobra tinha site publicado.
  const noSite = await mkCommunity(leader, {
    kind: "common",
    privacy: "public",
    name: mk("SemSite"),
  });
  const rowNoSite = await CommunityStorage.getById(pool, noSite);
  check("19b. has_site sai no getById da comunidade", () => {
    assert.strictEqual(rowPub.has_site, true);
    assert.strictEqual(rowNoSite.has_site, false);
  });

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n━━━ vitrine de serviços (lê o cadastro, 2026-09-04) ━━━");

  // A vitrine deixou de guardar texto e passou a mostrar os serviços REAIS do
  // líder. O que estes testes protegem é o contrário do óbvio: não é que a
  // lista apareça — é que ela NÃO apareça onde não deve, e que a projeção não
  // leve junto o que é do negócio de quem vende.

  const AuthStorage = require("../src/storages/AuthStorage");
  const ProfileStorage = require("../src/storages/ProfileStorage");
  const ProfileServiceStorage = require("../src/storages/ProfileServiceStorage");

  await AuthStorage.ensureUserAccountProfile(pool, leader, "User leader");
  const leaderProfile = await ProfileStorage.getUserAccountProfileId(pool, leader);

  await ProfileServiceStorage.create(pool, {
    id_profile: leaderProfile,
    name: "Corte de cabelo",
    description: "Inclui lavagem",
    duration_minutes: 90,
    price_amount: 12000,
    is_active: true,
    affiliates_allowed: true,
    affiliate_percent: 30,
  });
  await ProfileServiceStorage.create(pool, {
    id_profile: leaderProfile,
    name: "SERVICO DESLIGADO",
    description: "nao deve aparecer",
    duration_minutes: 30,
    price_amount: 5000,
    is_active: false,
  });

  const vitrineSlug = await CommunitySiteStorage.getSlug(pool, pub);
  const siteWithServices = await CommunitySiteService.getPublicBySlug({ slug: vitrineSlug });

  check("V1. a vitrine devolve os serviços cadastrados do líder", () => {
    assert.ok(Array.isArray(siteWithServices.services), "services deveria vir na resposta");
    assert.strictEqual(siteWithServices.services.length, 1, "só o ativo entra");
    const s0 = siteWithServices.services[0];
    assert.strictEqual(s0.name, "Corte de cabelo");
    // Centavos, e não texto pronto: quem formata é o front, que sabe o idioma.
    assert.strictEqual(Number(s0.price_amount), 12000);
    assert.strictEqual(Number(s0.duration_minutes), 90);
    assert.strictEqual(
      String(siteWithServices.provider_profile_id),
      String(leaderProfile),
      "o botão do card precisa saber para qual perfil apontar"
    );
  });

  check("V2. serviço desativado não aparece na vitrine", () => {
    const nomes = siteWithServices.services.map((s) => s.name);
    assert.ok(
      !nomes.includes("SERVICO DESLIGADO"),
      "desativar é como o líder tira um serviço da vitrine"
    );
  });

  check("V3. a projeção não vaza a régua de comissão do líder", () => {
    // Esta porta é ANÔNIMA e cacheada por 10 min na borda. Devolver a linha
    // inteira publicaria affiliate_percent/created_by_user em HTML público.
    const s0 = siteWithServices.services[0];
    for (const proibido of ["affiliate_percent", "affiliates_allowed", "created_by_user", "id_profile"]) {
      assert.ok(!(proibido in s0), proibido + " não pode sair na vitrine pública");
    }
  });

  const privVitrineSlug = await CommunitySiteStorage.getSlug(pool, priv);
  const privWithServices = privVitrineSlug
    ? await CommunitySiteService.getPublicBySlug({ slug: privVitrineSlug })
    : null;

  check("V4. comunidade fechada não vaza a vitrine do líder", () => {
    if (!privWithServices || !privWithServices.locked) return;
    assert.strictEqual(
      privWithServices.services,
      undefined,
      "o ramo trancado devolve zero conteúdo — e vitrine é conteúdo"
    );
  });

  check("V5. texto livre antigo é descartado pelo normalizador", () => {
    // Não há migration: a regra de "chave desconhecida some" limpa sozinha os
    // sites que já existem, no próximo save.
    const cfg = CommunitySite.normalizeConfig({
      sections: [
        {
          id: "s1",
          kind: "services_catalog",
          enabled: true,
          title: "t",
          subtitle: "st",
          data: { columns: 3, items: [{ id: "x", title: "FANTASMA", price: "R$ 99,00" }] },
        },
      ],
    });
    assert.strictEqual(cfg.sections[0].data.items, undefined, "items não pode sobreviver");
    assert.strictEqual(cfg.sections[0].data.columns, 3, "a apresentação continua");
  });

  console.log("\n━━━ endereço próprio (slug, mig 213) ━━━");

  check("21. reservados: www/api/admin não podem virar endereço", () => {
    for (const bad of ["www", "api", "admin", "mail", "login", "seguranca", "pix"]) {
      assert.strictEqual(SiteSlug.validateSlug(bad).ok, false, bad + " deveria ser recusado");
    }
  });

  check("22. formato de slug: DNS manda (63 chars, sem punycode, sem só-número)", () => {
    assert.strictEqual(SiteSlug.validateSlug("ab").ok, false, "curto demais");
    assert.strictEqual(SiteSlug.validateSlug("12345").ok, false, "só números");
    // "--" é colapsado pelo slugify ANTES da validação, então "xn--abc" chega
    // como "xn-abc" — que não é punycode e é inofensivo. O comportamento certo
    // aqui é aceitar já normalizado, não recusar.
    assert.strictEqual(SiteSlug.validateSlug("xn--abc").slug, "xn-abc");
    assert.strictEqual(SiteSlug.validateSlug("a".repeat(64)).ok, false, "passa de 63");
    assert.strictEqual(SiteSlug.validateSlug("Padaria do Ze").slug, "padaria-do-ze");
  });

  const slugAfterPublish = await CommunitySiteStorage.getSlug(pool, pub);
  check("23. publicar reserva o endereço automaticamente", () => {
    assert.ok(slugAfterPublish, "deveria ter slug depois de publicar");
    assert.ok(SiteSlug.validateSlug(slugAfterPublish).ok, "slug gerado deve ser válido");
  });

  const bySlug = await CommunitySiteService.getPublicBySlug({ slug: slugAfterPublish });
  check("24. porta pública /c/<slug> devolve o site sem sessão", () => {
    assert.ok(!bySlug.error, bySlug.error);
    assert.strictEqual(bySlug.locked, false);
    assert.strictEqual(bySlug.config.siteName, "Site da Publica");
  });

  const privSlug = await CommunitySiteStorage.getSlug(pool, priv);
  const bySlugPriv = await CommunitySiteService.getPublicBySlug({ slug: privSlug });
  check("25. porta pública NÃO vaza comunidade privada", () => {
    assert.strictEqual(bySlugPriv.locked, true);
    assert.strictEqual(bySlugPriv.config, null);
  });

  const ghost = await CommunitySiteService.getPublicBySlug({ slug: "nao-existe-mesmo" });
  check("26. endereço inexistente é 404", () => {
    assert.strictEqual(ghost.statusCode, 404);
  });

  const renameBad = await CommunitySiteService.renameSlug(U(leader), { id_profile: pub }, { slug: "api" });
  const renameOther = await CommunitySiteService.renameSlug(U(outsider), { id_profile: pub }, { slug: "qualquer-coisa" });
  const renameOk = await CommunitySiteService.renameSlug(U(leader), { id_profile: pub }, { slug: "Padaria do Ze" });
  const renameTaken = await CommunitySiteService.renameSlug(U(leader), { id_profile: priv }, { slug: "padaria-do-ze" });
  check("27. renomear endereço: reservado, alheio, válido e já tomado", () => {
    assert.ok(renameBad.error, "reservado deveria ser recusado");
    assert.ok(renameOther.error, "não-líder deveria ser recusado");
    assert.strictEqual(renameOk.slug, "padaria-do-ze");
    assert.strictEqual(renameTaken.statusCode, 409, "endereço tomado devolve 409");
  });

  // ══════════════════════════════════════════════════════════════════════════
  console.log("\n━━━ domínio próprio (mig 214) ━━━");

  check("28. normalização: protocolo, porta, caminho e ponto final somem", () => {
    assert.strictEqual(Domain.normalizeDomain("HTTPS://Padaria.COM.BR/loja?x=1"), "padaria.com.br");
    assert.strictEqual(Domain.normalizeDomain("padaria.com.br:443"), "padaria.com.br");
    assert.strictEqual(Domain.normalizeDomain("padaria.com.br."), "padaria.com.br");
    assert.strictEqual(Domain.normalizeDomain("  padaria.com.br  "), "padaria.com.br");
    // www É outro domínio — não pode ser "normalizado" para fora.
    assert.strictEqual(Domain.normalizeDomain("www.padaria.com.br"), "www.padaria.com.br");
  });

  check("29. domínio da PLATAFORMA não pode ser reivindicado", () => {
    for (const bad of [
      "freelandoo.com.br",
      "admin.freelandoo.com.br",
      "qualquer.coisa.freelandoo.com.br",
      "meu-projeto.vercel.app",
    ]) {
      const v = Domain.validateDomain(bad);
      assert.strictEqual(v.ok, false, bad + " deveria ser recusado");
      assert.strictEqual(v.reason, "platform");
    }
  });

  check("30. domínio inválido: sem ponto, IP, rótulo torto", () => {
    assert.strictEqual(Domain.validateDomain("localhost").ok, false);
    assert.strictEqual(Domain.validateDomain("192.168.0.1").ok, false);
    assert.strictEqual(Domain.validateDomain("-inicio.com").ok, false);
    assert.strictEqual(Domain.validateDomain("a.com").ok, true);
  });

  const domOther = await CommunityDomainService.create(
    U(outsider), { id_profile: pub }, { domain: "padariadoze.com.br" }
  );
  check("31. só o líder liga um domínio", () => {
    assert.ok(domOther.error);
  });

  const domCreated = await CommunityDomainService.create(
    U(leader), { id_profile: pub }, { domain: "  HTTPS://PadariaDoZe.com.br/  " }
  );
  check("32. criar domínio normaliza e devolve as instruções de DNS", () => {
    assert.ok(!domCreated.error, domCreated.error);
    assert.strictEqual(domCreated.domain.domain, "padariadoze.com.br");
    assert.strictEqual(domCreated.domain.status, "pending");
    assert.strictEqual(domCreated.domain.verification.type, "TXT");
    assert.strictEqual(domCreated.domain.verification.host, "_freelandoo.padariadoze.com.br");
    assert.ok(
      domCreated.domain.verification.value.startsWith("freelandoo-site-verification="),
      "valor do TXT deve vir prefixado"
    );
  });

  check("32b. o token NÃO é devolvido cru na listagem", () => {
    assert.strictEqual(domCreated.domain.verification_token, undefined);
  });

  const domDup = await CommunityDomainService.create(
    U(leader), { id_profile: priv }, { domain: "padariadoze.com.br" }
  );
  check("33. o mesmo domínio não vai para duas comunidades", () => {
    assert.strictEqual(domDup.statusCode, 409);
  });

  const verifyNoTxt = await CommunityDomainService.verify(U(leader), {
    id_profile: pub,
    id_domain: domCreated.domain.id_domain,
  });
  check("34. sem o TXT no DNS, volta para 'pending' (nunca para 'error')", () => {
    assert.strictEqual(verifyNoTxt.verified, false);
    assert.strictEqual(verifyNoTxt.domain.status, "pending");
    assert.ok(verifyNoTxt.domain.last_error, "deveria explicar o que falta");
  });

  const refreshEarly = await CommunityDomainService.refresh(U(leader), {
    id_profile: pub,
    id_domain: domCreated.domain.id_domain,
  });
  check("35. refresh antes da prova de posse é recusado", () => {
    assert.strictEqual(refreshEarly.statusCode, 409);
  });

  // Simula a posse provada, para exercitar o resto do ciclo sem depender do DNS
  // do mundo real (que o teste não controla).
  await db.query(
    `UPDATE public.tb_community_domain
        SET status = 'active', verified_at = NOW() WHERE id_domain = $1`,
    [domCreated.domain.id_domain]
  );
  const resolved = await CommunityDomainService.resolveHost({ host: "PadariaDoZe.com.br" });
  check("36. resolveHost devolve o slug do site (e aceita Host com maiúscula)", () => {
    assert.ok(!resolved.error, resolved.error);
    assert.strictEqual(resolved.domain, "padariadoze.com.br");
    assert.strictEqual(resolved.slug, "padaria-do-ze");
  });

  const resolvedGhost = await CommunityDomainService.resolveHost({ host: "nao-e-nosso.com" });
  check("37. Host desconhecido é 404 (não cai no site de ninguém)", () => {
    assert.strictEqual(resolvedGhost.statusCode, 404);
  });

  await CommunitySiteService.setPublished(U(leader), { id_profile: pub }, { published: false });
  const resolvedUnpublished = await CommunityDomainService.resolveHost({
    host: "padariadoze.com.br",
  });
  check("38. despublicar o site derruba o domínio junto", () => {
    assert.strictEqual(resolvedUnpublished.statusCode, 404);
  });

  const slugAfterUnpublish = await CommunitySiteStorage.getSlug(pool, pub);
  check("38b. despublicar NÃO devolve o endereço para o mundo", () => {
    assert.strictEqual(slugAfterUnpublish, "padaria-do-ze");
  });

  const domList = await CommunityDomainService.list(U(leader), { id_profile: pub });
  check("39. listagem traz domínios, slug, provedor e teto", () => {
    assert.strictEqual(domList.domains.length, 1);
    assert.strictEqual(domList.slug, "padaria-do-ze");
    assert.ok(["manual", "vercel"].includes(domList.provider));
    assert.strictEqual(domList.max_domains, CommunityDomainService.MAX_DOMAINS);
  });

  const domRemoved = await CommunityDomainService.remove(U(leader), {
    id_profile: pub,
    id_domain: domCreated.domain.id_domain,
  });
  check("40. remover domínio", () => {
    assert.strictEqual(domRemoved.removed, true);
  });

  const { rows: gone } = await db.query(
    `SELECT 1 FROM public.tb_community_domain WHERE id_domain = $1`,
    [domCreated.domain.id_domain]
  );
  check("40b. a linha some do banco", () => {
    assert.strictEqual(gone.length, 0);
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
    [pub, priv, noSite],
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
