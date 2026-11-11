// test/meu-mundo-capitulos.e2e.js — lore v2 F3: os checks dos capítulos.
//
// Cada check de `utils/meuMundoQuests.js` lido do dado que o servidor grava
// (recibos, eventos da vida, atributos, Poder). O fluxo inteiro de um capítulo
// está em test/meu-mundo-aventura.e2e.js; aqui vai cada check sozinho.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/freelandoo_test npm run test:meu-mundo-capitulos
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_video, tb_mm_archive, tb_mm_trainer, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
                    tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned, tb_mm_character_event,
                    tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_notice, tb_mm_mail,
                    tb_mm_visit, tb_mm_avatar_pref, tb_mm_residence, tb_mm_house, tb_mm_lot,
                    tb_mm_neighborhood, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  const all = fs
    .readdirSync(path.join(__dirname, "../src/databases/migrations"))
    .filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f))
    .sort();
  for (const f of all) await pool.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8"));
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Quest = require("../src/services/MeuMundoQuestService");
  const AdvStore = require("../src/storages/MeuMundoAdventureStorage");
  const Q = require("../src/utils/meuMundoQuests");

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mmk', 'mmk@mm.test')`, [id]);
  await Life.peek(id);
  const ch = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1`, [id])).rows[0].id_character;
  const past = new Date(Date.now() - 60000);
  const row = { step_at: past, started_at: past, data: {} };
  const sat = async (check, count, s = {}) => Quest.satisfied(pool, id, ch, s, { key: "x", check, xp: 1, count }, row);
  let n = 0;
  const rec = (source, result) => AdvStore.insertReceipt(pool, { idUser: id, idCharacter: ch, source, actionKey: `k${++n}`, rules: "R3", result, deltas: {}, items: [] });
  const ev = (kind, data, at = "NOW()") => pool.query(`INSERT INTO tb_mm_character_event (id_character, at, kind, data) VALUES ($1, ${at}, $2, $3)`, [ch, kind, JSON.stringify(data)]);

  // ── catálogo ──
  check("10 capítulos, níveis 1/3/5/8/11/14/17/20/23/27", Q.CHAPTERS.length === 10 && Q.CHAPTERS.map((c) => c.minTrainerLevel).join() === "1,3,5,8,11,14,17,20,23,27");
  check("capítulos encadeados por next", Q.CHAPTERS.every((c, i) => c.next === (Q.CHAPTERS[i + 1] ? Q.CHAPTERS[i + 1].id : null)));
  const types = new Set(Q.CHAPTERS.flatMap((c) => c.steps.map((s) => Q.parseCheck(s.check).type)));
  const known = ["ack", "minigame", "clan", "ate", "practice", "sleep", "buy", "weapon", "material", "armory", "tutorialFight", "forge", "game", "games", "fightWin", "nightKill", "stat", "power", "hallChallenge", "mix", "certificate", "visit", "talk", "archive", "nectar", "paintTop", ...Q.PENDING_CHECKS];
  check("todo check dos capítulos é conhecido pelo servidor", [...types].every((t) => known.includes(t)), [...types].filter((t) => !known.includes(t)).join());
  const mobs = Q.CHAPTERS.flatMap((c) => c.steps).map((s) => Q.parseCheck(s.check)).filter((p) => (p.type === "fightWin" || p.type === "nightKill") && p.arg);
  check("monstros dos capítulos com os ids novos (F1)", mobs.every((p) => require("../src/utils/meuMundoAdventure").TROPHY_KINDS.includes(p.arg)), JSON.stringify(mobs));

  // ── jogos ──
  check("game:paint sem partida = não", !(await sat("game:paint")).ok);
  await rec("minigame:paint", { activity: "paint" });
  check("game:paint com recibo do Paint", (await sat("game:paint")).ok);
  check("game:jetpack não vale com Paint", !(await sat("game:jetpack")).ok);
  await rec("fight", { origin: "boxe", kind: "brute", win: false, abandoned: false });
  check("game:boxe = luta no ringue (até perdendo)", (await sat("game:boxe")).ok);
  let g = await sat("games:3");
  check("games:3 com Paint e Boxe = 2 de 3", !g.ok && g.have === 2 && g.need === 3, JSON.stringify(g));
  await rec("minigame:paint", { activity: "paint" });
  check("games:3 não conta o mesmo jogo duas vezes", (await sat("games:3")).have === 2);
  await rec("minigame:gincana", { activity: "gincana" });
  check("games:3 com três jogos diferentes", (await sat("games:3")).ok);
  await rec("fight", { origin: "laminas", kind: "wolf", win: false, abandoned: true });
  check("luta abandonada não conta como jogo", (await sat("game:laminas")).ok === false);

  // ── lutas ──
  check("fightWin sem vitória = não", !(await sat("fightWin")).ok);
  await rec("fight", { origin: "tutorial", kind: "cavaleiro", win: true, abandoned: false });
  check("vitória na luta de treino não conta", !(await sat("fightWin")).ok);
  await rec("fight", { origin: "laminas", kind: "ciborgue", win: true, abandoned: false });
  await rec("fight", { origin: "mob", kind: "wolf", win: true, abandoned: false });
  g = await sat("fightWin", 3);
  check("fightWin × 3 conta 2 de 3", !g.ok && g.have === 2 && g.need === 3, JSON.stringify(g));
  await rec("fight", { origin: "laminas", kind: "garras", win: true, abandoned: false });
  check("fightWin × 3 com três vitórias", (await sat("fightWin", 3)).ok);
  check("fightWin:ciborgue pelo tipo", (await sat("fightWin:ciborgue")).ok && !(await sat("fightWin:stone")).ok);
  check("nightKill:wolf só monstro da rua", (await sat("nightKill:wolf")).ok && !(await sat("nightKill:ciborgue")).ok);
  check("hallChallenge sem desafio = não", !(await sat("hallChallenge")).ok);
  await rec("fight", { origin: "hall", kind: "brute", win: false, abandoned: false });
  check("hallChallenge com desafio (perdendo vale)", (await sat("hallChallenge")).ok);
  const old = { step_at: new Date(Date.now() + 60000), started_at: new Date(Date.now() + 60000), data: {} };
  check("recibo de antes do passo abrir não conta", !(await Quest.satisfied(pool, id, ch, {}, { key: "x", check: "fightWin", xp: 1 }, old)).ok);

  // ── atributo e Poder ──
  g = await sat("stat:120", 1, { strength: 80, speed: 121.4, intelligence: 10, dexterity: 30 });
  check("stat:120 por qualquer atributo", g.ok && g.have === 120, JSON.stringify(g));
  check("stat:120 abaixo = não", !(await sat("stat:120", 1, { strength: 119.9 })).ok);
  await pool.query(`UPDATE tb_mm_character SET power = 1499 WHERE id_character = $1`, [ch]);
  check("power:1500 com 1.499 = não", !(await sat("power:1500")).ok);
  await pool.query(`UPDATE tb_mm_character SET power = 1500 WHERE id_character = $1`, [ch]);
  check("power:1500 com 1.500", (await sat("power:1500")).ok);

  // ── vida ──
  check("sleep sem dormir = não", !(await sat("sleep")).ok);
  await ev("activity", { kind: "sleeping", hours: 8 });
  check("sleep pelo evento de dormir", (await sat("sleep")).ok);
  await ev("buy", { item: "agua_coco", qty: 1 });
  const coco = require("../src/utils/meuMundoLife").ITEM_BY_ID.get("agua_coco");
  check(`buy:${coco.kind} pelo tipo do item`, (await sat(`buy:${coco.kind}`)).ok && !(await sat("buy:nada")).ok);
  check("mix sem mistura = não", !(await sat("mix")).ok);
  await ev("fused", { into: ch });
  check("mix pelo evento da mistura", (await sat("mix")).ok);

  // ── certidão: marca gravada pelo servidor ──
  check("certificate sem abrir = não", !(await sat("certificate")).ok);
  check("marca desconhecida recusada", (await Quest.mark(id, { mark: "dance" })).code === "action");
  const mk = await Quest.mark(id, { mark: "certificate" });
  check("POST /quest/mark certificate", mk.ok === true, JSON.stringify(mk.error));
  check("certificate depois de abrir", (await sat("certificate")).ok);

  // ── C3: paintTop = a sala do Paint gravou a chegada à ilha de Bastor ──
  check("paintTop sem partida = não", !(await sat("paintTop")).ok);
  await ev("paint_top", {}, "NOW() - interval '5 minutes'");
  check("paintTop de antes do passo abrir não vale", !(await sat("paintTop")).ok);
  await ev("paint_top", {});
  check("paintTop pelo evento da sala", (await sat("paintTop")).ok);
  check("nenhum check espera outra fatia", Q.PENDING_CHECKS.length === 0);
  check("nectar:1 sem entrega na estátua = não (N3)", !(await sat("nectar:1")).ok);

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
