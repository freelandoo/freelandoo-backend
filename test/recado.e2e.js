// test/recado.e2e.js — Recado (post SÓ-TEXTO) ponta a ponta.
//
//   npm run test:recado
//
// O recado (mig 209) é um item de portfólio com feed_kind='recado' e ZERO
// mídia. Como ele reaproveita o post inteiro, o que esta suíte verifica não é
// "o texto salva", e sim as costuras onde o reaproveitamento poderia vazar:
//   1. o banco recusa recado sem texto e feed_kind inventado;
//   2. o service recusa mídia em recado — e o upload também;
//   3. o feed global aceita recado SEM afrouxar o gate que segura item órfão
//      de upload que morreu no meio (a razão de o kind ser explícito);
//   4. o filtro 'feed' abraça recado (texto é post) e 'bees' não;
//   5. a grade do perfil segue a mesma regra do feed.

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

const FEED_ARGS = {
  id_machine: null,
  id_category: null,
  estado: null,
  id_region: null,
  exclude_ids: null,
  viewer_id_user: null,
  level_min: null,
  country: null,
  limit: 50,
};

async function main() {
  console.log("━━━ migrations ━━━");
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: DB_URL },
    stdio: "inherit",
  });

  const PortfolioService = require("../src/services/PortfolioService");
  const PortfolioStorage = require("../src/storages/PortfolioStorage");
  const PortfolioFeedStorage = require("../src/storages/PortfolioFeedStorage");
  const { normalizeFeedKind, feedKindMatches } = require("../src/utils/feedKind");
  const pool = require("../src/databases");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // ═══ 1. util puro — a regra "feed abraça recado" mora num lugar só ════
  console.log("\n━━━ 1. utils/feedKind ━━━");

  check("normaliza os três kinds", () => {
    assert.strictEqual(normalizeFeedKind("feed"), "feed");
    assert.strictEqual(normalizeFeedKind("bees"), "bees");
    assert.strictEqual(normalizeFeedKind("recado"), "recado");
  });
  check("kind desconhecido cai no fallback", () => {
    assert.strictEqual(normalizeFeedKind("xpto"), null);
    assert.strictEqual(normalizeFeedKind("xpto", "feed"), "feed");
  });
  check("filtro 'feed' abraça recado e não abraça bees", () => {
    assert.strictEqual(feedKindMatches("feed", "recado"), true);
    assert.strictEqual(feedKindMatches("feed", "bees"), false);
  });
  check("filtro 'recado' traz só recado; null traz tudo", () => {
    assert.strictEqual(feedKindMatches("recado", "feed"), false);
    assert.strictEqual(feedKindMatches(null, "bees"), true);
  });

  // ── fixture ────────────────────────────────────────────────────────────
  const stamp = Date.now();
  const u = await db.query(
    `INSERT INTO public.tb_user (nome, email, senha, username, ativo, data_nascimento)
          VALUES ('Recado Tester', $1, 'x', $2, TRUE, '1990-01-01')
       RETURNING id_user`,
    [`recado_${stamp}@ex.com`, `recado_${stamp}`]
  );
  const id_user = u.rows[0].id_user;
  const user = { id_user };

  // Perfil-CONTA: dispensa assinatura no feed, então o teste isola o gate de
  // mídia em vez de esbarrar na elegibilidade de vitrine.
  // A categoria vem do CHECK chk_profile_clan_taxonomy (mig 016): perfil não-clan
  // precisa de uma — é a "categoria fantasma" que o perfil-conta ganha no signup.
  const cat = await db.query(
    `SELECT id_category FROM public.tb_category ORDER BY id_category LIMIT 1`
  );
  const p = await db.query(
    `INSERT INTO public.tb_profile
            (id_user, display_name, sub_profile_slug, id_category,
             is_user_account, is_visible, is_active)
          VALUES ($1, 'Recado Tester', $2, $3, TRUE, FALSE, TRUE)
       RETURNING id_profile`,
    [id_user, `recado-tester-${stamp}`, cat.rows[0].id_category]
  );
  const id_profile = p.rows[0].id_profile;

  // ═══ 2. CHECKs da mig 209 ═════════════════════════════════════════════
  console.log("\n━━━ 2. CHECKs da migration ━━━");

  let code = null;
  try {
    await db.query(
      `INSERT INTO public.tb_profile_portfolio_item (id_profile, feed_kind, description, published_at)
            VALUES ($1, 'recado', NULL, NOW())`,
      [id_profile]
    );
  } catch (e) {
    code = e.code;
  }
  check("banco recusa recado sem texto", () => assert.strictEqual(code, "23514"));

  code = null;
  try {
    await db.query(
      `INSERT INTO public.tb_profile_portfolio_item (id_profile, feed_kind, description, published_at)
            VALUES ($1, 'recado', '   ', NOW())`,
      [id_profile]
    );
  } catch (e) {
    code = e.code;
  }
  check("banco recusa recado só com espaços", () => assert.strictEqual(code, "23514"));

  code = null;
  try {
    await db.query(
      `INSERT INTO public.tb_profile_portfolio_item (id_profile, feed_kind, description, published_at)
            VALUES ($1, 'xpto', 'oi', NOW())`,
      [id_profile]
    );
  } catch (e) {
    code = e.code;
  }
  check("banco recusa feed_kind inventado", () => assert.strictEqual(code, "23514"));

  // ═══ 3. criação pelo service ══════════════════════════════════════════
  console.log("\n━━━ 3. criação ━━━");

  const created = await PortfolioService.createItem(user, { id_profile }, {
    feed_kind: "recado",
    description: "Primeiro recado da plataforma. Só texto, sem foto.",
  });
  check("service cria o recado", () => {
    assert.ok(!created.error, created.error);
    assert.ok(created.item?.id_portfolio_item);
  });
  const recadoId = created.item?.id_portfolio_item;

  check("nasce com feed_kind='recado' e sem mídia", () => {
    assert.strictEqual(created.item.feed_kind, "recado");
    assert.strictEqual((created.item.media || []).length, 0);
  });

  const noText = await PortfolioService.createItem(user, { id_profile }, { feed_kind: "recado" });
  check("service recusa recado sem texto", () => assert.ok(noText.error));

  const withMedia = await PortfolioService.createItem(user, { id_profile }, {
    feed_kind: "recado",
    description: "com foto",
    media: [{ media_url: "https://x/y.webp", media_type: "image" }],
  });
  check("service recusa mídia junto do recado", () => assert.ok(withMedia.error));

  const addM = await PortfolioService.addMedia(
    user,
    { id_profile, id_portfolio_item: recadoId },
    { media_url: "https://x/z.webp", media_type: "image" }
  );
  check("addMedia recusa colar mídia num recado existente", () => assert.ok(addM.error));

  const post = await PortfolioService.createItem(user, { id_profile }, {
    feed_kind: "feed",
    description: "post com foto",
    media: [{ media_url: "https://x/foto.webp", media_type: "image" }],
  });
  check("post normal continua funcionando", () => {
    assert.ok(!post.error, post.error);
    assert.strictEqual(post.item.feed_kind, "feed");
  });
  const postId = post.item?.id_portfolio_item;

  // Item 'feed' sem mídia = upload que morreu no meio. NÃO pode aparecer.
  const orphan = await db.query(
    `INSERT INTO public.tb_profile_portfolio_item
            (id_profile, feed_kind, description, published_at, status)
          VALUES ($1, 'feed', 'upload que morreu no meio', NOW(), 'published')
       RETURNING id_portfolio_item`,
    [id_profile]
  );
  const orphanId = orphan.rows[0].id_portfolio_item;

  // ═══ 4. feed global ═══════════════════════════════════════════════════
  console.log("\n━━━ 4. feed global ━━━");

  const all = (await PortfolioFeedStorage.listNewCandidates(pool, { ...FEED_ARGS, feed_kind: null }))
    .map((r) => r.post_id);
  check("recado entra no feed global", () => assert.ok(all.includes(recadoId)));
  check("post com mídia continua no feed", () => assert.ok(all.includes(postId)));
  check("item sem mídia que NÃO é recado fica fora do feed", () =>
    assert.ok(!all.includes(orphanId))
  );

  const onlyFeed = (await PortfolioFeedStorage.listNewCandidates(pool, { ...FEED_ARGS, feed_kind: "feed" }))
    .map((r) => r.post_id);
  check("filtro kind=feed traz post E recado", () => {
    assert.ok(onlyFeed.includes(postId));
    assert.ok(onlyFeed.includes(recadoId));
  });

  const onlyBees = (await PortfolioFeedStorage.listNewCandidates(pool, { ...FEED_ARGS, feed_kind: "bees" }))
    .map((r) => r.post_id);
  check("filtro kind=bees não traz recado", () => assert.ok(!onlyBees.includes(recadoId)));

  const onlyRecado = (await PortfolioFeedStorage.listNewCandidates(pool, { ...FEED_ARGS, feed_kind: "recado" }))
    .map((r) => r.post_id);
  check("filtro kind=recado traz só recado", () => {
    assert.ok(onlyRecado.includes(recadoId));
    assert.ok(!onlyRecado.includes(postId));
  });

  // ═══ 5. grade do perfil ═══════════════════════════════════════════════
  console.log("\n━━━ 5. grade do perfil ━━━");

  const gridFeed = (await PortfolioStorage.listItemsWithMediaPublic(pool, id_profile, null, "feed"))
    .map((r) => r.id_portfolio_item);
  check("aba Portfólio lista post e recado", () => {
    assert.ok(gridFeed.includes(postId));
    assert.ok(gridFeed.includes(recadoId));
  });

  const gridBees = (await PortfolioStorage.listItemsWithMediaPublic(pool, id_profile, null, "bees"))
    .map((r) => r.id_portfolio_item);
  check("aba Curtos não lista recado", () => assert.ok(!gridBees.includes(recadoId)));

  // ── limpeza ────────────────────────────────────────────────────────────
  await db.query(`DELETE FROM public.tb_profile WHERE id_user = $1`, [id_user]);
  await db.query(`DELETE FROM public.tb_user WHERE id_user = $1`, [id_user]);
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
