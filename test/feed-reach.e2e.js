// test/feed-reach.e2e.js — Alcance regional do feed (A1, mig 328), ponta a ponta.
//
//   npm run test:feed-reach
//
// Banco: TEST_DATABASE_URL (Postgres portátil na 55432; nunca produção).
// Confere:
//   1. espelho SQL × JS do fator do limiar (fl_reach_factor = reachFactor);
//   2. o lugar do autor congela no post (trigger) — cidade, área ABC, região,
//      UF; capital fica sem área; mudar o perfil depois não mexe no post;
//   3. pontos por evento: view uma vez por pessoa PARA SEMPRE, cliques,
//      compartilhamento × velocidade, curtida, salvo, comentário, retenção;
//   4. "não gostei": um por pessoa, alternável, exclusivo com a curtida;
//   5. promoção de degrau na gravação, limiar com o fator do post, só sobe;
//   6. feed do leitor por faixas (alcance → área → região → estado → resto),
//      anônimo, filtro manual que ignora o alcance, selo só para o dono;
//   7. bees: lugar congelado, view, "não gostei" e a timeline por faixas.

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
async function check(name, fn) {
  try {
    await fn();
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
    stdio: "ignore",
  });

  const pool = require("../src/databases");
  const R = require("../src/utils/feedReach");
  const ReachStorage = require("../src/storages/ReachStorage");
  const PortfolioEventStorage = require("../src/storages/PortfolioEventStorage");
  const RankingStorage = require("../src/storages/RankingStorage");
  const BookmarkStorage = require("../src/storages/BookmarkStorage");
  const PortfolioCommentStorage = require("../src/storages/PortfolioCommentStorage");
  const PortfolioFeedService = require("../src/services/portfolioFeed/PortfolioFeedService");
  const StoryStorage = require("../src/storages/StoryStorage");
  const BeeFeedService = require("../src/services/BeeFeedService");
  const BeeEngagementService = require("../src/services/BeeEngagementService");

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  const stamp = Date.now().toString(36);
  const cat = (await db.query(`SELECT id_category FROM tb_category ORDER BY id_category LIMIT 1`)).rows[0].id_category;

  // Pessoa com perfil-conta numa cidade.
  async function person(tag, municipio, estado) {
    const u = await db.query(
      `INSERT INTO tb_user (nome, email, senha, username, ativo, data_nascimento)
       VALUES ($1, $2, 'x', $3, TRUE, '1990-01-01') RETURNING id_user`,
      [tag, `${tag}_${stamp}@ex.com`, `${tag}_${stamp}`]
    );
    const id_user = u.rows[0].id_user;
    const region = await db.query(
      `SELECT id_region FROM tb_region_city WHERE uf = $1 AND municipio_norm = fl_norm_city($2)`,
      [estado, municipio]
    );
    const p = await db.query(
      `INSERT INTO tb_profile (id_user, display_name, sub_profile_slug, id_category,
                               is_user_account, is_visible, is_active, municipio, estado, id_region)
       VALUES ($1, $2, $3, $4, TRUE, FALSE, TRUE, $5, $6, $7) RETURNING id_profile`,
      [id_user, tag, `${tag.replace(/_/g, "-")}-${stamp}`, cat, municipio, estado, region.rows[0]?.id_region ?? null]
    );
    return { id_user, id_profile: p.rows[0].id_profile };
  }

  async function recado(who, text, hoursAgo = 100) {
    const r = await db.query(
      `INSERT INTO tb_profile_portfolio_item (id_profile, feed_kind, description, published_at)
       VALUES ($1, 'recado', $2, NOW() - make_interval(hours => $3)) RETURNING *`,
      [who.id_profile, text, hoursAgo]
    );
    return r.rows[0];
  }
  const row = async (id) =>
    (await db.query(`SELECT * FROM tb_profile_portfolio_item WHERE id_portfolio_item = $1`, [id])).rows[0];
  const pts = async (id) => Number((await row(id)).reach_points);

  // ═══ 1. espelho do fator ══════════════════════════════════════════════
  console.log("\n━━━ 1. fator do limiar: SQL = JS ━━━");
  await check("fl_reach_factor = reachFactor em 200 uuids", async () => {
    const r = await db.query(`SELECT g::text AS id, fl_reach_factor(g) AS f FROM (SELECT gen_random_uuid() g FROM generate_series(1,200)) x`);
    for (const { id, f } of r.rows) {
      assert.ok(Math.abs(Number(f) - R.reachFactor(id)) < 1e-9, `${id}: ${f} × ${R.reachFactor(id)}`);
    }
    const ext = await db.query(`SELECT fl_reach_factor('ffffffff-0000-4000-8000-000000000000') hi, fl_reach_factor('00000000-0000-4000-8000-000000000000') lo`);
    assert.ok(Math.abs(Number(ext.rows[0].hi) - 1.15) < 1e-9);
    assert.ok(Math.abs(Number(ext.rows[0].lo) - 0.85) < 1e-9);
  });

  // ═══ 2. lugar congelado ═══════════════════════════════════════════════
  console.log("\n━━━ 2. lugar do autor congelado ━━━");
  const abc = await person("ra_andre", "Santo André", "SP");
  const maua = await person("ra_maua", "Mauá", "SP");
  const capital = await person("ra_sp", "São Paulo", "SP");
  const campinas = await person("ra_camp", "Campinas", "SP");
  const bh = await person("ra_bh", "Belo Horizonte", "MG");
  const semLugar = await person("ra_nada", null, null);

  const abcArea = (await db.query(`SELECT id_area FROM tb_area WHERE uf='SP' AND name='ABC Paulista'`)).rows[0]?.id_area;
  const pAbc = await recado(abc, "post do ABC");
  await check("post de Santo André nasce na cidade, área ABC, região e SP", async () => {
    const r = await row(pAbc.id_portfolio_item);
    assert.strictEqual(r.reach_city_key, "santo andre");
    assert.strictEqual(r.reach_city_name, "Santo André");
    assert.ok(abcArea, "área ABC semeada");
    assert.strictEqual(r.reach_area_id, abcArea);
    assert.ok(r.reach_region_id, "região");
    assert.strictEqual(r.reach_uf, "SP");
    assert.strictEqual(Number(r.reach_level), 0);
    assert.ok(r.reach_frozen_at);
  });
  const pCapital = await recado(capital, "post da capital");
  await check("capital: integra todas as sub-regiões → sem área", async () => {
    const r = await row(pCapital.id_portfolio_item);
    assert.strictEqual(r.reach_area_id, null);
    assert.ok(r.reach_region_id);
  });
  await check("as 38 cidades das 5 sub-regiões estão na tabela", async () => {
    const r = await db.query(`SELECT COUNT(DISTINCT a.name) n_area, COUNT(*) n FROM tb_area_city c JOIN tb_area a USING (id_area) WHERE c.uf='SP'`);
    assert.strictEqual(Number(r.rows[0].n_area), 5);
    assert.ok(Number(r.rows[0].n) >= 38);
  });
  await check("mudar a cidade do perfil depois não arrasta o post", async () => {
    await db.query(`UPDATE tb_profile SET municipio='Campinas' WHERE id_profile=$1`, [abc.id_profile]);
    await db.query(`UPDATE tb_profile_portfolio_item SET status='published' WHERE id_portfolio_item=$1`, [pAbc.id_portfolio_item]);
    const r = await row(pAbc.id_portfolio_item);
    assert.strictEqual(r.reach_city_key, "santo andre");
    await db.query(`UPDATE tb_profile SET municipio='Santo André' WHERE id_profile=$1`, [abc.id_profile]);
  });

  // ═══ 3. pontos ════════════════════════════════════════════════════════
  console.log("\n━━━ 3. pontos por evento ━━━");
  const id = pAbc.id_portfolio_item;
  const ev = (event_type, extra = {}) =>
    PortfolioEventStorage.recordEvent(pool, { id_portfolio_item: id, event_type, ...extra });

  await check("view: uma vez por pessoa, para sempre (sessão e usuário)", async () => {
    await ev("impression", { session_id: "sess-a" });
    await ev("impression", { session_id: "sess-a" });
    await db.query(`UPDATE tb_portfolio_event SET created_at = NOW() - INTERVAL '2 days' WHERE id_portfolio_item=$1`, [id]);
    await ev("impression", { session_id: "sess-a" }); // fora da janela de 30 min: impressão conta, alcance não
    assert.strictEqual(await pts(id), 1);
    await ev("impression", { session_id: "sess-b", id_user: maua.id_user });
    await ev("impression", { session_id: "sess-c", id_user: maua.id_user });
    assert.strictEqual(await pts(id), 2);
    await ev("impression", {}); // sem pessoa: não conta
    assert.strictEqual(await pts(id), 2);
    // a impressão (métrica) segue a janela de 30 min e conta o sem-pessoa
    assert.strictEqual(Number((await row(id)).impressions_count), 5);
  });
  await check("perfil +4 e WhatsApp +6, uma vez por pessoa", async () => {
    await ev("profile_click", { id_user: maua.id_user });
    await ev("profile_click", { id_user: maua.id_user });
    await ev("whatsapp_click", { session_id: "sess-a" });
    assert.strictEqual(await pts(id), 2 + 4 + 6);
  });
  await check("compartilhamento 40 × velocidade (6 h)", async () => {
    const before = await pts(id);
    await ev("share", { session_id: "sh-1" }); // n=1 → 40
    await ev("share", { session_id: "sh-2" }); // n=2 → 48
    await ev("share", { session_id: "sh-2" }); // repetido: 0
    assert.strictEqual(await pts(id), before + 40 + 48);
  });
  await check("curtida +5 / descurtir −5; salvo +30 / −30; comentário +10 / −10", async () => {
    const before = await pts(id);
    await RankingStorage.toggleLike(pool, { id_portfolio_item: id, id_profile: abc.id_profile, id_user: maua.id_user });
    assert.strictEqual(await pts(id), before + 5);
    await RankingStorage.toggleLike(pool, { id_portfolio_item: id, id_profile: abc.id_profile, id_user: maua.id_user });
    assert.strictEqual(await pts(id), before);
    await BookmarkStorage.toggle(pool, { id_user: maua.id_user, id_portfolio_item: id });
    assert.strictEqual(await pts(id), before + 30);
    await BookmarkStorage.toggle(pool, { id_user: maua.id_user, id_portfolio_item: id });
    assert.strictEqual(await pts(id), before);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await PortfolioCommentStorage.bumpItemCounter(c, id, 1);
      await c.query("COMMIT");
    } finally { c.release(); }
    assert.strictEqual(await pts(id), before + 10);
    await PortfolioCommentStorage.bumpItemCounter(pool, id, -1);
    assert.strictEqual(await pts(id), before);
  });
  await check("retenção: +1 a cada 10 s, com o teto de 3.600 s", async () => {
    const before = await pts(id);
    const ret = (seq, s) => PortfolioEventStorage.recordRetention(pool, {
      id_portfolio_item: id, session_id: "ret-1", seconds_delta: s, sequence: seq,
    });
    await ret(1, 9);
    assert.strictEqual(await pts(id), before);
    await ret(2, 12); // 21 s → 2
    assert.strictEqual(await pts(id), before + 2);
    await db.query(`UPDATE portfolio_content_retention SET seconds_watched = 3590 WHERE session_id='ret-1'`);
    await ret(3, 60); // 3590 → 3600: 1 ponto, não 6
    assert.strictEqual(await pts(id), before + 3);
  });

  // ═══ 4. não gostei ════════════════════════════════════════════════════
  console.log("\n━━━ 4. não gostei ━━━");
  await check("não gostei −2, alternável, um por pessoa", async () => {
    const before = await pts(id);
    let r = await ReachStorage.toggleDislike(pool, "post", { id, id_user: bh.id_user });
    assert.strictEqual(r.disliked, true);
    assert.strictEqual(await pts(id), before - 2);
    assert.strictEqual(Number((await row(id)).dislikes_count), 1);
    r = await ReachStorage.toggleDislike(pool, "post", { id, id_user: bh.id_user });
    assert.strictEqual(r.disliked, false);
    assert.strictEqual(await pts(id), before);
    assert.strictEqual(Number((await row(id)).dislikes_count), 0);
  });
  await check("exclusivo com a curtida, dos dois lados", async () => {
    const before = await pts(id);
    await RankingStorage.toggleLike(pool, { id_portfolio_item: id, id_profile: abc.id_profile, id_user: bh.id_user });
    const r = await ReachStorage.toggleDislike(pool, "post", { id, id_user: bh.id_user });
    assert.strictEqual(r.liked, false);
    assert.strictEqual(r.likes_count, 0);
    assert.strictEqual(Number((await row(id)).likes_count), 0);
    assert.strictEqual(await pts(id), before - 2);
    const liked = await RankingStorage.toggleLike(pool, { id_portfolio_item: id, id_profile: abc.id_profile, id_user: bh.id_user });
    assert.strictEqual(liked.liked, true);
    const d = await db.query(`SELECT 1 FROM tb_portfolio_dislike WHERE id_portfolio_item=$1 AND id_user=$2`, [id, bh.id_user]);
    assert.strictEqual(d.rows.length, 0);
    assert.strictEqual(Number((await row(id)).dislikes_count), 0);
    assert.strictEqual(await pts(id), before + 5);
    await RankingStorage.toggleLike(pool, { id_portfolio_item: id, id_profile: abc.id_profile, id_user: bh.id_user });
  });

  // ═══ 5. promoção ══════════════════════════════════════════════════════
  console.log("\n━━━ 5. promoção de degrau ━━━");
  await check("passa o limiar com o fator do post → área; só sobe", async () => {
    const f = R.reachFactor(id);
    const goal = 1000 * f;
    await db.query(`UPDATE tb_profile_portfolio_item SET reach_points = $2 WHERE id_portfolio_item=$1`, [id, Math.ceil(goal) - 3]);
    await ev("impression", { session_id: "promo-1" });
    assert.strictEqual(Number((await row(id)).reach_level), 0, "ainda abaixo");
    await ev("whatsapp_click", { session_id: "promo-2" });
    const r = await row(id);
    assert.strictEqual(Number(r.reach_level), 1);
    assert.ok(r.reach_level_at);
    await ReachStorage.toggleDislike(pool, "post", { id, id_user: campinas.id_user });
    await db.query(`UPDATE tb_profile_portfolio_item SET reach_points = 0 WHERE id_portfolio_item=$1`, [id]);
    await ev("impression", { session_id: "promo-3" });
    assert.strictEqual(Number((await row(id)).reach_level), 1, "não desce");
  });
  await check("cidade sem área pula para a região no limiar da área", async () => {
    const pid = pCapital.id_portfolio_item;
    await db.query(`UPDATE tb_profile_portfolio_item SET reach_points = $2 WHERE id_portfolio_item=$1`, [pid, Math.ceil(1000 * R.reachFactor(pid))]);
    await ReachStorage.addPoints(pool, "post", pid, 1);
    assert.strictEqual(Number((await row(pid)).reach_level), 2);
  });
  await check("raiseLevel (A2/A5) só sobe", async () => {
    const pid = pCapital.id_portfolio_item;
    assert.strictEqual(await ReachStorage.raiseLevel(pool, "post", pid, 1), false);
    assert.strictEqual(await ReachStorage.raiseLevel(pool, "post", pid, 4), true);
    assert.strictEqual(Number((await row(pid)).reach_level), 4);
    await db.query(`UPDATE tb_profile_portfolio_item SET reach_level = 2 WHERE id_portfolio_item=$1`, [pid]);
  });

  // ═══ 6. feed por faixas ═══════════════════════════════════════════════
  console.log("\n━━━ 6. feed do leitor ━━━");
  // Isola o feed deste teste: tudo o que não é deste stamp sai do caminho.
  await db.query(
    `UPDATE tb_profile_portfolio_item SET is_active = FALSE
      WHERE id_profile NOT IN (SELECT id_profile FROM tb_profile WHERE sub_profile_slug LIKE '%-' || $1)`,
    [stamp]
  );
  // pAbc: área (1) → cobre Mauá. pCapital: região (2) → cobre Mauá.
  const pMaua = await recado(maua, "post de Mauá");           // cidade do leitor → 0
  const pAndre2 = await recado(abc, "outro do ABC");          // mesma área, ainda na cidade → 1
  const pCapital2 = await recado(capital, "capital nova");    // mesma região → 2
  const pCamp = await recado(campinas, "campinas");           // mesmo estado → 3
  const pBh = await recado(bh, "bh");                         // resto → 4
  const pBhNac = await recado(bh, "bh nacional");             // nacional → 0
  await db.query(`UPDATE tb_profile_portfolio_item SET reach_level = 4 WHERE id_portfolio_item=$1`, [pBhNac.id_portfolio_item]);
  const pNada = await recado(semLugar, "sem lugar");          // sem lugar → 4

  const expectBand = new Map([
    [pMaua.id_portfolio_item, 0], [pAbc.id_portfolio_item, 0], [pCapital.id_portfolio_item, 0],
    [pBhNac.id_portfolio_item, 0], [pAndre2.id_portfolio_item, 1], [pCapital2.id_portfolio_item, 2],
    [pCamp.id_portfolio_item, 3], [pBh.id_portfolio_item, 4], [pNada.id_portfolio_item, 4],
  ]);
  const feed = (viewer, filters = {}) =>
    PortfolioFeedService.getFeed({ db: pool, filters, pagination: { limit: 24 }, viewer });

  await check("leitor de Mauá: faixas em ordem crescente", async () => {
    const r = await feed({ id_user: maua.id_user });
    assert.ok(!r.error, r.error);
    const got = r.items.map((i) => i.post_id).filter((x) => expectBand.has(x));
    assert.strictEqual(got.length, expectBand.size, `veio ${got.length}`);
    const bands = got.map((x) => expectBand.get(x));
    for (let i = 1; i < bands.length; i++) assert.ok(bands[i] >= bands[i - 1], `ordem ${bands.join(",")}`);
  });
  await check("paginação por semente: duas páginas = a lista inteira, sem repetir", async () => {
    const all = (await feed({ id_user: maua.id_user })).items.map((i) => i.post_id);
    const p1 = await PortfolioFeedService.getFeed({ db: pool, filters: {}, pagination: { limit: 4 }, viewer: { id_user: maua.id_user } });
    const seed = p1.next_cursor.split(":")[0];
    const again = await PortfolioFeedService.getFeed({ db: pool, filters: {}, pagination: { limit: 4, cursor: `${seed}:0` }, viewer: { id_user: maua.id_user } });
    assert.deepStrictEqual(again.items.map((i) => i.post_id), p1.items.map((i) => i.post_id));
    const p2 = await PortfolioFeedService.getFeed({ db: pool, filters: {}, pagination: { limit: 24, cursor: p1.next_cursor }, viewer: { id_user: maua.id_user } });
    const ids = [...p1.items, ...p2.items].map((i) => i.post_id);
    assert.strictEqual(new Set(ids).size, ids.length);
    assert.strictEqual(ids.length, all.length);
  });
  await check("anônimo: o nacional primeiro, depois o resto", async () => {
    const r = await feed(null);
    const got = r.items.map((i) => i.post_id).filter((x) => expectBand.has(x));
    assert.strictEqual(got[0], pBhNac.id_portfolio_item);
    assert.strictEqual(got.length, expectBand.size);
  });
  await check("filtro manual de estado ignora o alcance", async () => {
    const r = await feed({ id_user: maua.id_user }, { estado: "MG" });
    const got = r.items.map((i) => i.post_id);
    assert.deepStrictEqual(new Set(got), new Set([pBh.id_portfolio_item, pBhNac.id_portfolio_item]));
  });
  await check("selo de alcance só no post do dono; 'não gostei' do leitor marcado", async () => {
    await ReachStorage.toggleDislike(pool, "post", { id: pBh.id_portfolio_item, id_user: maua.id_user });
    const asMaua = await feed({ id_user: maua.id_user });
    const mine = asMaua.items.find((i) => i.post_id === pMaua.id_portfolio_item);
    assert.deepStrictEqual(mine.my_reach, { level: 0, key: "city", place: "Mauá" });
    const other = asMaua.items.find((i) => i.post_id === pAbc.id_portfolio_item);
    assert.strictEqual(other.my_reach, null);
    assert.strictEqual("dislikes_count" in other, false, "contador não é público");
    assert.strictEqual(asMaua.items.find((i) => i.post_id === pBh.id_portfolio_item).viewer_has_disliked, true);
    const asAndre = await feed({ id_user: abc.id_user });
    const abcMine = asAndre.items.find((i) => i.post_id === pAbc.id_portfolio_item);
    assert.deepStrictEqual(abcMine.my_reach, { level: 1, key: "area", place: "ABC Paulista" });
    const anon = await feed(null);
    assert.ok(anon.items.every((i) => i.my_reach === null));
  });

  // ═══ 7. bees ══════════════════════════════════════════════════════════
  console.log("\n━━━ 7. bees ━━━");
  async function bee(who, caption) {
    const r = await db.query(
      `INSERT INTO tb_story (id_profile, id_user, kind, video_url, duration_seconds, caption, expires_at)
       VALUES ($1, (SELECT id_user FROM tb_profile WHERE id_profile=$1), 'bee', 'https://x/v.mp4', 10, $2, NOW() + INTERVAL '1 day')
       RETURNING *`,
      [who.id_profile, caption]
    );
    return r.rows[0];
  }
  let bMaua, bBh;
  await check("bee congela o lugar ao nascer", async () => {
    bMaua = await bee(maua, "bee de Mauá");
    bBh = await bee(bh, "bee de BH");
    assert.strictEqual(bMaua.reach_city_key, "maua");
    assert.strictEqual(bMaua.reach_area_id, abcArea);
    assert.strictEqual(bBh.reach_uf, "MG");
  });
  const beePts = async (sid) => Number((await db.query(`SELECT reach_points FROM tb_story WHERE id_story=$1`, [sid])).rows[0].reach_points);
  await check("bee: view +1 uma vez, curtida +5, não gostei exclusivo", async () => {
    await StoryStorage.markViewed(pool, { id_story: bBh.id_story, id_viewer_user: maua.id_user });
    await StoryStorage.markViewed(pool, { id_story: bBh.id_story, id_viewer_user: maua.id_user });
    assert.strictEqual(await beePts(bBh.id_story), 1);
    await BeeEngagementService.toggleLike({ id_user: maua.id_user }, { id_story: bBh.id_story });
    assert.strictEqual(await beePts(bBh.id_story), 6);
    const d = await BeeEngagementService.toggleDislike({ id_user: maua.id_user }, { id_story: bBh.id_story });
    assert.strictEqual(d.disliked, true);
    assert.strictEqual(d.likes_count, 0);
    // 6 − 2 (não gostei) − 5 (curtida tirada) = −1 → piso 0
    assert.strictEqual(await beePts(bBh.id_story), 0);
    const r = (await db.query(`SELECT likes_count, dislikes_count FROM tb_story WHERE id_story=$1`, [bBh.id_story])).rows[0];
    assert.strictEqual(Number(r.likes_count), 0);
    assert.strictEqual(Number(r.dislikes_count), 1);
  });
  await check("timeline dos bees: o da cidade do leitor antes do de outro estado", async () => {
    const r = await BeeFeedService.getTimeline({ id_user: maua.id_user }, { limit: 24 });
    assert.ok(!r.error, r.error);
    const ids = r.items.map((i) => i.id_story);
    assert.ok(ids.indexOf(bMaua.id_story) < ids.indexOf(bBh.id_story), ids.join(","));
    const mine = r.items.find((i) => i.id_story === bMaua.id_story);
    assert.deepStrictEqual(mine.my_reach, { level: 0, key: "city", place: "Mauá" });
    assert.strictEqual(r.items.find((i) => i.id_story === bBh.id_story).viewer_has_disliked, true);
  });

  await db.end();
  await pool.end();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} ok`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
