// test/meu-mundo-nectar.e2e.js — MEU MUNDO 3D lore v2 N2 (mig 441): o NÉCTAR DA SEMANA.
// Placar da semana → litros pela posição (tabela do Alex), carteira "para entregar",
// fechamento com trava e recibo (duas chamadas juntas e rodar de novo creditam uma vez só),
// aviso no sino, Poder ao vivo, menor de idade fora.
//
// Roda: TEST_DATABASE_URL=postgres://...@127.0.0.1:55432/... node test/meu-mundo-nectar.e2e.js
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_nectar_award, tb_mm_nectar_wallet, tb_mm_nectar_week, tb_mm_score, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
  const Nectar = require("../src/services/MeuMundoNectarService");
  const N = require("../src/utils/meuMundoNectar");

  const mk = async (name, minor = false) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3, $4)`, [id, name, `${name}@mm.test`, minor]);
    await pool.query(`INSERT INTO tb_profile (id_user, display_name, is_user_account) VALUES ($1, $2, TRUE)`, [id, name.toUpperCase()]);
    await Life.peek(id);
    return id;
  };
  const W = "2026-11-08";
  const AFTER = Date.parse("2026-11-15T03:05:00Z");
  const t0 = Date.parse("2026-11-10T12:00:00Z");
  const score = (id, game, best, atMs) =>
    pool.query(`INSERT INTO tb_mm_score (id_user, game, week, best, plays, best_at) VALUES ($1, $2, $3, $4, 1, $5)`, [id, game, W, best, new Date(atMs)]);
  const wallet = async (id) => (await pool.query(`SELECT pending_ml, earned_ml FROM tb_mm_nectar_wallet WHERE id_user = $1`, [id])).rows[0];
  const award = async (id, game) => (await pool.query(`SELECT position, ml FROM tb_mm_nectar_award WHERE id_user = $1 AND week = $2 AND game = $3`, [id, W, game])).rows[0];

  // 12 pessoas no Jetpack (p0 = maior marca) e um menor de idade com a maior de todas
  const P = [];
  for (let i = 0; i < 12; i++) P.push(await mk(`p${i}`));
  const K = await mk("kid", true);
  for (let i = 0; i < 12; i++) await score(P[i], "jetpack", 1000 - i * 10, t0 + i);
  await score(K, "jetpack", 99999, t0);
  // empate no Rolê: p1 fez primeiro, p0 depois → p1 em 1º
  await score(P[0], "noturno", 400, t0 + 5000);
  await score(P[1], "noturno", 400, t0 + 1000);
  // Antigravidade: menor tempo na frente
  await score(P[2], "corrida", 61000, t0);
  await score(P[0], "corrida", 58000, t0);
  // Poder (ao vivo): p11 tem o maior; quem não jogou na semana e fica fora do top 10 não ganha
  await pool.query(`UPDATE tb_mm_character SET power = NULL`);
  for (let i = 0; i < 12; i++) await pool.query(`UPDATE tb_mm_character SET power = $2, power_at = NOW() WHERE id_user = $1`, [P[i], 100 + i * 10]);
  const idle = await mk("idle");
  await pool.query(`UPDATE tb_mm_character SET power = 1, power_at = NOW() WHERE id_user = $1`, [idle]);

  // semana aberta / antes do placar
  const open = await Nectar.closeWeek(W, Date.parse("2026-11-15T02:59:00Z"));
  check("semana ainda aberta (sábado 23:59) não fecha", open.skipped === "open", JSON.stringify(open));
  const early = await Nectar.closeWeek("2026-11-01", AFTER);
  check("semana antes do placar (N1) não fecha", early.skipped === "before_start");
  check("nada creditado ainda", (await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_nectar_award`)).rows[0].n === 0);

  // fecha com duas chamadas ao mesmo tempo: a trava deixa uma só creditar
  const [a, b] = await Promise.all([Nectar.closeWeek(null, AFTER), Nectar.closeWeek(null, AFTER)]);
  const done = a.skipped ? b : a;
  const other = a.skipped ? a : b;
  check("fechamento padrão = a semana anterior à de agora", done.week === W && !done.skipped, JSON.stringify([a, b]));
  check("a segunda chamada ao mesmo tempo não credita (semana já fechada)", other.skipped === "closed", JSON.stringify(other));

  // Jetpack: posições → litros
  check("Jetpack 1º = 10 L", (await award(P[0], "jetpack")).ml === 10000);
  check("Jetpack 2º = 4 L", (await award(P[1], "jetpack")).ml === 4000);
  const tenth = await award(P[9], "jetpack");
  check("Jetpack 10º = 2 L", tenth.ml === 2000 && tenth.position === 10);
  check("Jetpack 11º e 12º = 1 L (pontuaram)", (await award(P[10], "jetpack")).ml === 1000 && (await award(P[11], "jetpack")).ml === 1000);
  check("menor de idade não ganha (nem empurra a fila)", !(await award(K, "jetpack")));
  check("empate no Rolê: quem fez primeiro leva o 1º", (await award(P[1], "noturno")).ml === 10000 && (await award(P[0], "noturno")).ml === 4000);
  check("Antigravidade: menor tempo é o 1º", (await award(P[0], "corrida")).ml === 10000 && (await award(P[2], "corrida")).ml === 4000);
  check("Poder: maior número de agora = 1º", (await award(P[11], "poder")).ml === 10000 && (await award(P[10], "poder")).ml === 4000);
  check("Poder fora do top 10: só quem jogou na semana ganha 1 L", (await award(P[0], "poder")).ml === 1000 && !(await award(idle, "poder")));

  // carteira: os litros somam entre os jogos — p0: Jetpack 10 + Rolê 4 + Antigravidade 10 + Poder 1
  const w0 = await wallet(P[0]);
  check("carteira soma os jogos (p0 = 25 L para entregar)", Number(w0.pending_ml) === 25000 && Number(w0.earned_ml) === 25000, JSON.stringify(w0));
  const wk = (await pool.query(`SELECT accounts, total_ml FROM tb_mm_nectar_week WHERE week = $1`, [W])).rows[0];
  check("semana marcada como fechada com o total", wk && wk.accounts === 12 && Number(wk.total_ml) > 0, JSON.stringify(wk));

  // sino
  const notes = (await pool.query(`SELECT data FROM tb_mm_notice WHERE id_user = $1 AND code = 'nectar_week'`, [P[0]])).rows;
  check("aviso no sino com os litros da semana", notes.length === 1 && notes[0].data.ml === 25000 && notes[0].data.week === W && notes[0].data.games === 4, JSON.stringify(notes));

  // rodar de novo nunca credita de novo
  const again = await Nectar.closeWeek(W, AFTER + 3600e3);
  check("rodar de novo: semana já fechada", again.skipped === "closed");
  // mesmo sem a linha da semana, o recibo conta × semana × jogo segura
  await pool.query(`DELETE FROM tb_mm_nectar_week WHERE week = $1`, [W]);
  await Nectar.closeWeek(W, AFTER + 7200e3);
  check("recibo conta × semana × jogo segura o 2º crédito", Number((await wallet(P[0])).pending_ml) === 25000);
  check("sem segundo aviso no sino", (await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_notice WHERE id_user = $1 AND code = 'nectar_week'`, [P[0]])).rows[0].n === 1);

  // a tela: carteira + tabela + a semana passada
  const view = await Nectar.wallet(P[0], AFTER + 60e3);
  check(
    "carteira na tela: para entregar, tabela e a semana passada por jogo",
    view.pendingMl === 25000 && view.table.length === 11 && view.last.week === W && view.last.closed && view.last.ml === 25000 && view.last.awards[0].game === "jetpack" && view.last.awards.length === 4,
    JSON.stringify(view)
  );
  const empty = await Nectar.wallet(K, AFTER + 60e3);
  check("quem não ganhou: carteira zerada", empty.pendingMl === 0 && empty.last.ml === 0 && empty.last.awards.length === 0);

  // o placar semanal mostra quanto a posição vale
  const Poder = require("../src/services/MeuMundoPoderService");
  const rk = await Poder.weekly(P[0], "jetpack", W, AFTER);
  check("placar semanal: cada linha traz o néctar da posição", rk.top[0].ml === 10000 && rk.top[10].ml === 1000 && rk.me.ml === 10000, JSON.stringify(rk.top.slice(0, 2)));
  check("tabela pura confere", N.mlFor(5) === 3250);

  await pool.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations/441_meu_mundo_nectar.sql"), "utf8"));
  check("mig 441 idempotente", true);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
