// test/meu-mundo-placar.e2e.js — MEU MUNDO 3D lore v2 N1 (mig 440): o PLACAR SEMANAL.
// Partida de minijogo com marca → placar da semana (maior pontuação / menor tempo),
// vitória de luta soma, partida repetida não conta duas vezes, menor de idade fora,
// semana passada/futura, Poder ao vivo.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/n1 npm run test:meu-mundo-placar
// Só Postgres LOCAL e descartável (derruba e recria as tabelas do Meu Mundo).

const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let PASS = 0;
let FAIL = 0;
function check(label, cond, extra = "") {
  if (cond) {
    PASS++;
    console.log(`✓ ${label}`);
  } else {
    FAIL++;
    console.log(`✗ ${label}${extra ? " — " + extra : ""}`);
  }
}

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_score, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
                    tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event,
                    tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_notice, tb_mm_mail,
                    tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_profile, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT, is_minor BOOLEAN NOT NULL DEFAULT FALSE)`);
  await pool.query(`CREATE TABLE tb_profile (id_profile UUID PRIMARY KEY DEFAULT gen_random_uuid(), id_user UUID, display_name TEXT,
                    avatar_url TEXT, is_user_account BOOLEAN DEFAULT FALSE, deleted_at TIMESTAMPTZ NULL)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  const all = fs
    .readdirSync(path.join(__dirname, "../src/databases/migrations"))
    .filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f))
    .sort();
  for (const f of all) {
    const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8");
    await pool.query(sql);
    if (f >= "335") await pool.query(sql); // a nova é idempotente
  }
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Adv = require("../src/services/MeuMundoAdventureService");
  const Poder = require("../src/services/MeuMundoPoderService");
  const S = require("../src/utils/meuMundoScores");
  const ScoreStore = require("../src/storages/MeuMundoScoreStorage");

  const mk = async (name, minor = false) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3, $4)`, [id, name, `${name}@mm.test`, minor]);
    await pool.query(`INSERT INTO tb_profile (id_user, display_name, is_user_account) VALUES ($1, $2, TRUE)`, [id, name.toUpperCase()]);
    await Life.peek(id);
    return id;
  };
  const A = await mk("ana");
  const B = await mk("bia");
  const K = await mk("kid", true);
  const week = S.weekOf(Date.now());
  const segs = () => [{ from: Date.now() - 90000, to: Date.now() - 1000 }];
  const play = (id, activity, key, score, win = false) => Adv.creditMinigame(id, { activity, actionKey: key, segments: segs(), win, score });
  const rowOf = async (id, game) => (await pool.query(`SELECT best, plays FROM tb_mm_score WHERE id_user = $1 AND game = $2 AND week = $3`, [id, game, week])).rows[0];

  // ── Jetpack: maior pontuação da semana
  const r1 = await play(A, "jetpack", "jp:1:A", 500);
  check("partida com marca gera recibo com a marca", r1.receipt && r1.receipt.result && r1.receipt.result.score === 500, JSON.stringify(r1.receipt && r1.receipt.result));
  check("placar da semana gravado (500, 1 partida)", JSON.stringify(await rowOf(A, "jetpack")) === JSON.stringify({ best: 500, plays: 1 }));
  const again = await play(A, "jetpack", "jp:1:A", 500);
  check("a MESMA partida de novo não conta (recibo repetido)", again.replay === true && (await rowOf(A, "jetpack")).plays === 1);
  await play(A, "jetpack", "jp:2:A", 300);
  check("marca pior não troca a da semana, mas conta a partida", JSON.stringify(await rowOf(A, "jetpack")) === JSON.stringify({ best: 500, plays: 2 }));
  await play(A, "jetpack", "jp:3:A", 700);
  check("marca melhor troca", (await rowOf(A, "jetpack")).best === 700);
  await play(B, "jetpack", "jp:3:B", 650, true);
  await play(K, "jetpack", "jp:3:K", 99999);
  await play(B, "jetpack", "jp:4:B", null);
  check("partida sem marca (saiu no meio) não mexe no placar", (await rowOf(B, "jetpack")).plays === 1);

  const rj = await Poder.weekly(A, "jetpack");
  check("ranking do Jetpack: ana 700 em 1º, bia 650 em 2º", rj.top.length === 2 && rj.top[0].idUser === A && rj.top[0].value === 700 && rj.top[1].idUser === B, JSON.stringify(rj.top.map((t) => [t.name, t.value])));
  check("ranking: menor de idade fica fora", !rj.top.some((t) => t.idUser === K));
  check(
    "ranking: minha linha, semana de agora e quando fecha",
    rj.me && rj.me.position === 1 && rj.me.plays === 3 && rj.week === week && rj.current === true && rj.endsAt === new Date(S.weekRange(week).end).toISOString(),
    JSON.stringify(rj.me)
  );
  check("ranking: nome do perfil-conta, corpo e a lista de jogos", rj.top[0].name === "ANA" && typeof rj.top[0].body === "string" && rj.games.length === 9 && rj.unit === "pts");
  const rb = await Poder.weekly(B, "jetpack");
  check("a linha da bia: 2º lugar", rb.me && rb.me.position === 2 && rb.me.value === 650);

  // ── Antigravidade: menor tempo; tempo zero não grava
  await play(A, "corrida", "co:1:A", 61000);
  await play(A, "corrida", "co:2:A", 59000);
  await play(B, "corrida", "co:2:B", 58000);
  await play(B, "corrida", "co:3:B", 0);
  const rc = await Poder.weekly(A, "corrida");
  check(
    "Antigravidade: menor tempo na frente (bia 58 s, ana 59 s)",
    rc.top[0].idUser === B && rc.top[0].value === 58000 && rc.top[1].value === 59000 && rc.dir === "asc" && rc.unit === "ms",
    JSON.stringify(rc.top.map((t) => [t.name, t.value]))
  );
  check("tempo zero não grava (e não conta partida)", (await rowOf(B, "corrida")).plays === 1);

  // ── empate: quem fez a marca primeiro fica na frente
  await play(A, "noturno", "nt:1:A", 400);
  await play(B, "noturno", "nt:1:B", 400);
  const rn = await Poder.weekly(B, "noturno");
  check("empate: quem chegou primeiro (ana) fica na frente", rn.top[0].idUser === A && rn.me.position === 2);

  // ── lutas: soma de vitórias (a mesma gravação que o fechamento da luta faz)
  const c = await pool.connect();
  try {
    await ScoreStore.record(c, { idUser: B, game: "hall", week, value: 1, at: Date.now() });
    await ScoreStore.record(c, { idUser: B, game: "hall", week, value: 1, at: Date.now() });
  } finally {
    c.release();
  }
  const rh = await Poder.weekly(A, "hall");
  check("Hall: vitórias somam (bia 2)", rh.top[0].idUser === B && rh.top[0].value === 2 && rh.top[0].plays === 2 && rh.me === null, JSON.stringify(rh.top));

  // ── semanas e erros
  const prev = await Poder.weekly(A, "jetpack", S.previousWeek(week));
  check("semana passada: vazia e marcada como não atual", prev.top.length === 0 && prev.current === false);
  const fut = await Poder.weekly(A, "jetpack", "2099-01-04");
  check("semana futura = 400", fut.error && fut.statusCode === 400);
  const badWeek = await Poder.weekly(A, "jetpack", "2026-11-10");
  check("dia que não é domingo = 400", badWeek.error && badWeek.statusCode === 400);
  const bad = await Poder.weekly(A, "xadrez");
  check("jogo desconhecido = 404", bad.error && bad.statusCode === 404);
  const live = await Poder.weekly(A, "poder");
  check("Poder: o número de agora (sem semana gravada)", live.kind === "live" && Array.isArray(live.top) && live.top.length === 2 && !live.top.some((t) => t.idUser === K));

  // ── a mig 440 roda de novo sem erro (idempotente; roda no boot)
  await pool.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations/440_meu_mundo_placar.sql"), "utf8"));
  check("mig 440 idempotente", true);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
