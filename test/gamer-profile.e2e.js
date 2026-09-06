// test/gamer-profile.e2e.js — Perfil gamer (mig 220) ponta a ponta.
//
//   npm run test:gamer
//
// O que esta suíte protege NÃO é "salvou a estante" — é o punhado de lugares
// onde o reaproveitamento e a integração poderiam vazar em silêncio:
//
//   1. uma conta de plataforma pertence a UMA pessoa, e uma pessoa tem UMA
//      conta por plataforma (as duas metades do índice parcial). Sem isso,
//      "conquista verificada" não significa nada;
//   2. desconectar LEVA EMBORA a biblioteca — e libera o par para o dono de
//      verdade, sem apagar o histórico;
//   3. o catálogo dedupe por slug (é o que faz a comparação existir) e NÃO
//      reescreve o nome a cada sync;
//   4. re-sincronizar não apaga o cache de conquistas (que custa uma chamada
//      por jogo e é o único ponto caro do módulo);
//   5. a estante nunca soma provedores;
//   6. o CHECK recusa conquista maior que o total, provider fora da lista e
//      status inventado.
//
// A Steam é substituída por um dublê: a suíte não pode depender da internet,
// nem de uma chave de API, nem gastar cota a cada execução.

require("dotenv").config();

const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const { Client } = require("pg");

const DB_URL =
  process.env.TEST_DATABASE_URL ||
  "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";

// Mesmo guard das outras suítes: ela cria e apaga linhas à vontade, e apontar
// para produção seria irreversível.
if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção (railway). Abortando.");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;

const results = [];
function check(name, fn) {
  if (fn.constructor.name === "AsyncFunction") {
    // O harness da suíte de community-site já foi mordido por isto: função
    // async aqui imprime sucesso e falha depois, solta, fora da contagem.
    throw new Error(`check("${name}") recebeu função async — resolva antes de chamar`);
  }
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err: err.message });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

async function expectReject(name, promiseFn, code) {
  try {
    await promiseFn();
    results.push({ name, ok: false, err: "deixou passar" });
    console.log(`  ✗ ${name}\n      deixou passar`);
  } catch (err) {
    const ok = !code || err.code === code;
    results.push({ name, ok, err: ok ? null : `código ${err.code}` });
    console.log(ok ? `  ✓ ${name} (${err.code})` : `  ✗ ${name}\n      código ${err.code}`);
  }
}

const Storage = require("../src/storages/GameProfileStorage");
const { slugify } = require("../src/utils/slug");

const stamp = Date.now().toString(36);

async function makeUser(db, tag) {
  const u = await db.query(
    `INSERT INTO public.tb_user (nome, email, senha, username, ativo, data_nascimento)
          VALUES ($1, $2, 'x', $3, TRUE, '1990-01-01')
       RETURNING id_user`,
    [`Gamer ${tag}`, `gamer_${tag}_${stamp}@ex.com`, `gamer_${tag}_${stamp}`]
  );
  return u.rows[0].id_user;
}

/** Biblioteca falsa no formato que o adaptador da Steam devolve. */
function lib(entries) {
  return entries.map(([external_id, name, minutes]) => ({
    external_id,
    name,
    slug: slugify(name),
    cover_url: `https://cdn.example/${external_id}.jpg`,
    playtime_minutes: minutes,
    playtime_2w_minutes: 0,
    last_played_at: null,
  }));
}

async function shelfRows(db, provider, games, minutesByExternal) {
  const map = await Storage.upsertGames(db, provider, games);
  return games.map((g) => ({
    id_game: map.get(g.external_id),
    playtime_minutes: minutesByExternal[g.external_id] ?? g.playtime_minutes,
    playtime_2w_minutes: 0,
    last_played_at: null,
  }));
}

(async () => {
  console.log("→ migrations");
  execFileSync(process.execPath, ["run-migrations.js"], {
    cwd: __dirname + "/..",
    stdio: "ignore",
    env: { ...process.env, DATABASE_URL: DB_URL },
  });

  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  try {
    console.log("\n── esquema ──");
    const t = await db.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN
          ('tb_user_game_account','tb_game','tb_game_provider_ref','tb_user_game')`
    );
    check("as 4 tabelas da mig 220 existem", () => assert.equal(t.rowCount, 4));

    const f = await db.query(`SELECT is_enabled FROM tb_feature_flag WHERE flag_key='games_conexao'`);
    check("a flag games_conexao nasce ligada", () => {
      assert.equal(f.rowCount, 1);
      assert.equal(f.rows[0].is_enabled, true);
    });
    const fOld = await db.query(`SELECT 1 FROM tb_feature_flag WHERE flag_key='games'`);
    check("a flag da COMUNIDADE de games continua existindo (são duas)", () =>
      assert.equal(fOld.rowCount, 1));

    const A = await makeUser(db, "a");
    const B = await makeUser(db, "b");
    const C = await makeUser(db, "c");

    console.log("\n── a conta conectada ──");
    const acc = await Storage.connectAccount(db, {
      id_user: A, provider: "steam", external_id: "76561198000000001", handle: "alex",
    });
    check("conecta com visibilidade pública e status connected", () => {
      assert.equal(acc.visibility, "public");
      assert.equal(acc.status, "connected");
    });

    await Storage.setVisibility(db, A, "steam", "private");
    const re = await Storage.connectAccount(db, {
      id_user: A, provider: "steam", external_id: "76561198000000001", handle: "alex2",
    });
    check("reconectar atualiza a MESMA linha", () => assert.equal(re.id_account, acc.id_account));
    check("reconectar preserva a visibilidade escolhida", () => assert.equal(re.visibility, "private"));
    await Storage.setVisibility(db, A, "steam", "public");

    await expectReject("uma pessoa não tem duas contas da mesma plataforma", () =>
      db.query(`INSERT INTO tb_user_game_account (id_user, provider, external_id)
                VALUES ($1,'steam','76561198000000009')`, [A]), "23505");

    await expectReject("um SteamID não pertence a duas pessoas", () =>
      db.query(`INSERT INTO tb_user_game_account (id_user, provider, external_id)
                VALUES ($1,'steam','76561198000000001')`, [B]), "23505");

    await expectReject("provider fora da lista é recusado", () =>
      db.query(`INSERT INTO tb_user_game_account (id_user, provider, external_id)
                VALUES ($1,'psn','1')`, [B]), "23514");

    await expectReject("status inventado é recusado", () =>
      db.query(`UPDATE tb_user_game_account SET status='blz' WHERE id_account=$1`,
        [acc.id_account]), "23514");

    console.log("\n── catálogo ──");
    const g1 = lib([["1245620", "ELDEN RING", 9000], ["292030", "The Witcher 3", 3000], ["570", "Dota 2", 60]]);
    const map = await Storage.upsertGames(db, "steam", g1);
    check("o mapa cobre a biblioteca inteira", () => assert.equal(map.size, 3));

    const map2 = await Storage.upsertGames(db, "steam", g1);
    check("2ª passada devolve os mesmos ids (ON CONFLICT devolve o que já existe)", () =>
      assert.deepEqual([...map.values()].sort(), [...map2.values()].sort()));

    const outroCaso = lib([["outra-plataforma-elden", "Elden Ring", 10]]);
    const mapX = await Storage.upsertGames(db, "steam", outroCaso);
    check("nome escrito diferente cai no MESMO jogo (dedupe por slug)", () =>
      assert.equal(mapX.get("outra-plataforma-elden"), map.get("1245620")));

    const nome = await db.query(`SELECT name FROM tb_game WHERE id_game=$1`, [map.get("1245620")]);
    check("o nome do catálogo não é reescrito pelo sync seguinte", () =>
      assert.equal(nome.rows[0].name, "ELDEN RING"));

    console.log("\n── a estante ──");
    const rows = await shelfRows(db, "steam", g1, {});
    await Storage.replaceShelf(db, A, "steam", rows);
    let shelf = await Storage.listShelf(db, A, {});
    check("a estante tem os 3 jogos, do mais jogado para o menos", () => {
      assert.equal(shelf.length, 3);
      assert.equal(shelf[0].name, "ELDEN RING");
    });

    await Storage.setAchievements(db, {
      id_user: A, id_game: map.get("1245620"), provider: "steam", unlocked: 34, total: 42,
    });

    // Re-sync: horas novas e um jogo a menos (reembolso / fim de compartilhamento).
    const rows2 = await shelfRows(db, "steam", g1.slice(0, 2), { 1245620: 9100 });
    await Storage.replaceShelf(db, A, "steam", rows2);
    shelf = await Storage.listShelf(db, A, {});
    check("re-sync atualiza horas e remove o que saiu da biblioteca", () => {
      assert.equal(shelf.length, 2);
      assert.equal(shelf[0].playtime_minutes, 9100);
    });

    const ug = await Storage.getUserGame(db, A, map.get("1245620"), "steam");
    check("re-sync PRESERVA o cache de conquistas", () => {
      assert.equal(ug.ach_unlocked, 34);
      assert.equal(ug.ach_total, 42);
    });
    check("getUserGame resolve o external_id pela ponte", () =>
      assert.equal(ug.external_id, "1245620"));

    await expectReject("conquista maior que o total é recusada", () =>
      db.query(`UPDATE tb_user_game SET ach_unlocked=99, ach_total=42
                 WHERE id_user=$1 AND id_game=$2 AND provider='steam'`,
        [A, map.get("1245620")]), "23514");

    console.log("\n── nunca somar provedores ──");
    // A mesma pessoa, o mesmo jogo, duas plataformas: DUAS linhas. O dia em que
    // isto virar uma linha só é o dia em que a tela passa a somar horas de
    // fontes que medem de jeitos diferentes.
    await db.query(
      `INSERT INTO tb_game_provider_ref (provider, external_id, id_game) VALUES ('steam','fake-xbox',$1)
       ON CONFLICT DO NOTHING`, [map.get("1245620")]);
    await db.query(
      `INSERT INTO tb_user_game (id_user, id_game, provider, playtime_minutes)
       VALUES ($1,$2,'steam',1)
       ON CONFLICT (id_user, id_game, provider) DO NOTHING`, [B, map.get("1245620")]);
    const chave = await db.query(
      `SELECT a.attname FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = 'public.tb_user_game'::regclass AND i.indisprimary
        ORDER BY a.attname`);
    check("provider faz parte da CHAVE da estante", () =>
      assert.deepEqual(chave.rows.map((r) => r.attname), ["id_game", "id_user", "provider"]));

    console.log("\n── frente a frente ──");
    await Storage.connectAccount(db, {
      id_user: B, provider: "steam", external_id: "76561198000000002", handle: "outro",
    });
    await Storage.replaceShelf(db, B, "steam", [
      { id_game: map.get("1245620"), playtime_minutes: 2000, playtime_2w_minutes: 0, last_played_at: null },
      { id_game: map.get("570"), playtime_minutes: 50000, playtime_2w_minutes: 0, last_played_at: null },
    ]);
    const common = await Storage.listCommon(db, A, B);
    check("só o que os dois têm entra na comparação", () => {
      assert.equal(common.length, 1);
      assert.equal(common[0].name, "ELDEN RING");
    });
    check("os dois lados vêm no mesmo registro", () => {
      assert.equal(common[0].a_minutes, 9100);
      assert.equal(common[0].b_minutes, 2000);
    });
    check("conquista de quem tem vem preenchida; de quem não tem, null", () => {
      assert.equal(common[0].a_ach_unlocked, 34);
      assert.equal(common[0].b_ach_unlocked, null);
    });

    console.log("\n── desconectar ──");
    await Storage.revokeAccount(db, A, "steam");
    const viva = await Storage.getAccount(db, A, "steam");
    const estante = await Storage.listShelf(db, A, {});
    const outraEstante = await Storage.listShelf(db, B, {});
    const hist = await db.query(
      `SELECT revoked_at FROM tb_user_game_account WHERE id_user=$1 AND provider='steam'`, [A]);
    check("a conta some das vivas", () => assert.equal(viva, null));
    check("a biblioteca daquele provedor vai junto", () => assert.equal(estante.length, 0));
    check("a estante de outra pessoa fica intacta", () => assert.equal(outraEstante.length, 2));
    check("a linha vira histórico em vez de sumir", () => {
      assert.equal(hist.rowCount, 1);
      assert.ok(hist.rows[0].revoked_at);
    });

    const relink = await db.query(
      `INSERT INTO tb_user_game_account (id_user, provider, external_id)
       VALUES ($1,'steam','76561198000000001') RETURNING id_account`, [C]);
    check("o SteamID liberado pode ser reivindicado pelo dono de verdade", () =>
      assert.equal(relink.rowCount, 1));

    const cat = await db.query(`SELECT 1 FROM tb_game WHERE id_game=$1`, [map.get("1245620")]);
    check("o catálogo é compartilhado e não é apagado junto", () => assert.equal(cat.rowCount, 1));
  } finally {
    // Limpa o que a suíte criou (ela roda num banco de teste, mas deixar lixo
    // faria a próxima execução medir outra coisa).
    await db.query(`DELETE FROM tb_user WHERE email LIKE $1`, [`gamer_%_${stamp}@ex.com`]).catch(() => {});
    await db.end();
  }

  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} checks`);
  process.exit(ok === results.length ? 0 : 1);
})().catch((err) => {
  console.error("ERRO", err);
  process.exit(1);
});
