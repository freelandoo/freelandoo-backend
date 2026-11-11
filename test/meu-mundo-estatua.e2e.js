// test/meu-mundo-estatua.e2e.js — MEU MUNDO 3D lore v2 N3 (mig 442): DOMINGO NA ESTÁTUA.
// Entrega só no domingo, na estátua do próprio deus (última visita gravada pela
// sala), debita a carteira da N2 com recibo pela chave do pedido; corrida
// Raposas × Vampiros com meta pelos ativos (D4) e estágio; estátua cheia
// grava full_at; check nectar:N da missão.
//
// Roda: TEST_DATABASE_URL=postgres://...@127.0.0.1:55432/... node test/meu-mundo-estatua.e2e.js
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_nectar_delivery, tb_mm_statue_week, tb_mm_statue_config,
                    tb_mm_nectar_award, tb_mm_nectar_wallet, tb_mm_nectar_week, tb_mm_score, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
  const Statue = require("../src/services/MeuMundoStatueService");
  const { satisfied } = require("../src/services/MeuMundoQuestService");

  const mk = async (name, clan) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3, FALSE)`, [id, name, `${name}@mm.test`]);
    await pool.query(`INSERT INTO tb_profile (id_user, display_name, is_user_account) VALUES ($1, $2, TRUE)`, [id, name.toUpperCase()]);
    await Life.peek(id);
    if (clan) await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, $2, 'f')`, [id, clan]);
    return id;
  };
  const W = "2026-11-08"; // a semana que fecha
  const SUN = "2026-11-15"; // o domingo da entrega
  const t0 = Date.parse("2026-11-10T12:00:00Z");
  const sun = (hhmm) => Date.parse(`2026-11-15T${hhmm}:00Z`) + 3 * 3600e3; // hora de Brasília → UTC
  const score = (id, game, best, atMs) =>
    pool.query(`INSERT INTO tb_mm_score (id_user, game, week, best, plays, best_at) VALUES ($1, $2, $3, $4, 1, $5)`, [id, game, W, best, new Date(atMs)]);
  const visit = (id, place, atMs) =>
    pool.query(
      `INSERT INTO tb_mm_character_event (id_character, at, kind, data)
       SELECT id_character, $3, 'visit', jsonb_build_object('place', $2::text) FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ORDER BY born_at DESC LIMIT 1`,
      [id, place, new Date(atMs)]
    );
  const pending = async (id) => Number(((await pool.query(`SELECT pending_ml FROM tb_mm_nectar_wallet WHERE id_user = $1`, [id])).rows[0] || { pending_ml: 0 }).pending_ml);
  const raceRow = async (clan) => (await pool.query(`SELECT * FROM tb_mm_statue_week WHERE week = $1 AND clan = $2`, [SUN, clan])).rows[0];

  // Raposas: r1 1º no Jetpack (10 L), r2 2º (4 L), r3 sem nada. Vampiro v1 1º no Rolê (10 L). Sem classe: nc.
  const r1 = await mk("r1", "raposa");
  const r2 = await mk("r2", "raposa");
  const r3 = await mk("r3", "raposa");
  const v1 = await mk("v1", "vampiro");
  const nc = await mk("nc", null);
  await score(r1, "jetpack", 900, t0);
  await score(r2, "jetpack", 800, t0);
  await score(v1, "noturno", 500, t0);
  // sem Poder ao vivo (senão todo mundo entra no top 10 do Poder)
  await pool.query(`UPDATE tb_mm_character SET power = NULL`);

  const cfg0 = await Statue.getConfig(sun("10:00"));
  check("meta padrão no admin: base 30 L, 6 L por ativo", cfg0.baseL === 30 && cfg0.perActiveL === 6, JSON.stringify(cfg0));

  // ── travas ──
  const wed = Date.parse("2026-11-11T15:00:00Z");
  await visit(r1, "estatua_aurion", wed - 60e3);
  const notSun = await Statue.deliver(r1, { key: "wed-r1-0001" }, wed);
  check("quarta-feira: a estátua não recebe", notSun.code === "sunday", JSON.stringify(notSun));
  const sat = await Statue.deliver(r1, { key: "sat-r1-0001" }, Date.parse("2026-11-15T02:59:00Z"));
  check("sábado 23:59 (Brasília): ainda não", sat.code === "sunday", JSON.stringify(sat));
  check("sem classe: escolha a classe", (await Statue.deliver(nc, { key: "nc-000001" }, sun("10:00"))).code === "clan");
  check("chave do pedido inválida", (await Statue.deliver(r1, { key: "a b" }, sun("10:00"))).code === "key");
  await visit(r1, "estatua_morkhan", sun("09:59"));
  check("Raposa no pé de Morkhan: não vale", (await Statue.deliver(r1, { key: "r1-morkhan-01" }, sun("10:00"))).code === "far");
  await visit(r1, "estatua_aurion", sun("09:40"));
  check("visita à estátua de 20 min atrás: chegue de novo", (await Statue.deliver(r1, { key: "r1-old-0001" }, sun("10:00"))).code === "far");
  check("nada entregue ainda, carteira intacta", (await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_nectar_delivery`)).rows[0].n === 0);

  // ── a primeira entrega do domingo fecha a semana que faltava e entrega tudo ──
  await visit(r1, "estatua_aurion", sun("10:09"));
  const before = await Statue.race(r1, sun("10:10"));
  check("tela: domingo, estou na estátua, ainda sem néctar creditado", before.sunday && before.me.atStatue && before.me.clan === "raposa" && before.me.god === "aurion", JSON.stringify(before.me));
  const d1 = await Statue.deliver(r1, { key: "r1-first-0001" }, sun("10:10"));
  check("entrega no domingo: 10 L (a semana fechou antes)", !d1.error && d1.delivery && d1.delivery.ml === 10000 && d1.replay === false, JSON.stringify(d1.error || d1.delivery));
  check("carteira de r1 zerada", (await pending(r1)) === 0);
  const rr = await raceRow("raposa");
  check("corrida das Raposas: 10 L de 30 L (2 ativos × 6 L < base)", rr && Number(rr.delivered_ml) === 10000 && Number(rr.goal_ml) === 30000 && rr.active === 2 && rr.donors === 1, JSON.stringify(rr));
  check("estágio 1 (racha) com 33%", d1.race.raposa.stage === 1 && d1.race.raposa.deliveredMl === 10000, JSON.stringify(d1.race.raposa));
  check("Vampiros ainda zerados, com a meta virtual", d1.race.vampiro.deliveredMl === 0 && d1.race.vampiro.goalMl === 30000 && !(await raceRow("vampiro")));

  // repetir o pedido (resposta perdida) devolve o mesmo recibo, sem debitar de novo
  const d1b = await Statue.deliver(r1, { key: "r1-first-0001" }, sun("10:11"));
  check("mesmo pedido repetido = mesmo recibo", d1b.replay === true && d1b.delivery.id === d1.delivery.id, JSON.stringify(d1b.error || d1b.delivery));
  check("corrida não soma de novo", Number((await raceRow("raposa")).delivered_ml) === 10000);
  check("de novo com outra chave e carteira vazia: nada para entregar", (await Statue.deliver(r1, { key: "r1-second-001" }, sun("10:12"))).code === "empty");
  await visit(r3, "estatua_aurion", sun("10:12"));
  check("Raposa sem néctar nenhum: nada para entregar", (await Statue.deliver(r3, { key: "r3-0000001" }, sun("10:13"))).code === "empty");

  // dois pedidos juntos da mesma pessoa: só um entrega
  await visit(r2, "estatua_aurion", sun("11:00"));
  const [x, y] = await Promise.all([Statue.deliver(r2, { key: "r2-par-a-0001" }, sun("11:01")), Statue.deliver(r2, { key: "r2-par-b-0001" }, sun("11:01"))]);
  const ok = [x, y].filter((z) => !z.error);
  check("dois pedidos juntos: um entrega 4 L, o outro fica sem néctar", ok.length === 1 && ok[0].delivery.ml === 4000 && [x, y].some((z) => z.code === "empty"), JSON.stringify([x.error || x.delivery, y.error || y.delivery]));
  const rr2 = await raceRow("raposa");
  check("corrida: 14 L, 2 doadores", Number(rr2.delivered_ml) === 14000 && rr2.donors === 2, JSON.stringify(rr2));

  // ── nectar:N da missão ──
  const row = { started_at: new Date(sun("09:00")).toISOString(), step_at: new Date(sun("09:00")).toISOString() };
  const sat1 = await satisfied(pool, r1, null, {}, { check: "nectar:1" }, row);
  check("nectar:1 cumprido com 10 L entregues desde o capítulo", sat1.ok && sat1.have === 1, JSON.stringify(sat1));
  const sat11 = await satisfied(pool, r1, null, {}, { check: "nectar:11" }, row);
  check("nectar:11 ainda não (10 de 11)", !sat11.ok && sat11.have === 10 && sat11.need === 11, JSON.stringify(sat11));
  const late = { started_at: new Date(sun("12:00")).toISOString(), step_at: new Date(sun("12:00")).toISOString() };
  check("entrega de antes do capítulo começar não conta", !(await satisfied(pool, r1, null, {}, { check: "nectar:1" }, late)).ok);
  check("quem não entregou: nectar:1 = não", !(await satisfied(pool, r3, null, {}, { check: "nectar:1" }, row)).ok);

  // ── Vampiro na praça ──
  await visit(v1, "estatua_aurion", sun("12:00"));
  check("Vampiro no pé de Aurion: não vale", (await Statue.deliver(v1, { key: "v1-aurion-01" }, sun("12:01"))).code === "far");
  await visit(v1, "estatua_morkhan", sun("12:02"));
  const dv = await Statue.deliver(v1, { key: "v1-morkhan-01" }, sun("12:03"));
  check("Vampiro entrega 10 L no pé de Morkhan", !dv.error && dv.delivery.ml === 10000 && dv.delivery.place === "estatua_morkhan" && dv.delivery.clan === "vampiro", JSON.stringify(dv.error || dv.delivery));
  check("placar: Raposas 14 L × Vampiros 10 L", dv.race.raposa.deliveredMl === 14000 && dv.race.vampiro.deliveredMl === 10000);
  const rv = await raceRow("vampiro");
  check("meta dos Vampiros pela base (1 ativo)", Number(rv.goal_ml) === 30000 && rv.active === 1, JSON.stringify(rv));

  // ── admin: meta menor → estátua das Raposas enche (full_at para a N4) ──
  check("config inválida recusada", (await Statue.saveConfig(r1, { baseL: 0, perActiveL: 1 }, sun("13:00"))).code === "config");
  const cfg = await Statue.saveConfig(r1, { baseL: 12, perActiveL: 6 }, sun("13:00"));
  check("admin grava 12 L de base", cfg.baseL === 12 && cfg.perActiveL === 6, JSON.stringify(cfg));
  const fullR = await raceRow("raposa");
  const fullV = await raceRow("vampiro");
  check("Raposas: meta 12 L e 14 L entregues = CHEIA (full_at)", Number(fullR.goal_ml) === 12000 && !!fullR.full_at, JSON.stringify(fullR));
  check("Vampiros: meta 12 L, 10 L = ainda não", Number(fullV.goal_ml) === 12000 && !fullV.full_at, JSON.stringify(fullV));
  check("estágios: Raposas 4 (cheia), Vampiros 3 (olhos acesos)", cfg.race.raposa.stage === 4 && cfg.race.vampiro.stage === 3, JSON.stringify(cfg.race));
  // estátua cheia não volta a meta: o admin muda de novo e ela segue cheia
  await Statue.saveConfig(r1, { baseL: 50, perActiveL: 6 }, sun("13:05"));
  const keep = await raceRow("raposa");
  check("estátua já cheia não perde o full_at quando o admin muda a meta", Number(keep.goal_ml) === 12000 && !!keep.full_at, JSON.stringify(keep));
  check("a aberta segue a meta nova (50 L)", Number((await raceRow("vampiro")).goal_ml) === 50000);

  // a entrega que ENCHE: Vampiro com mais néctar
  await Statue.saveConfig(r1, { baseL: 12, perActiveL: 6 }, sun("13:06"));
  await pool.query(`UPDATE tb_mm_nectar_wallet SET pending_ml = 3000 WHERE id_user = $1`, [v1]);
  await visit(v1, "estatua_morkhan", sun("13:10"));
  const dfill = await Statue.deliver(v1, { key: "v1-fill-00001" }, sun("13:11"));
  check("a entrega que passa da meta enche a estátua (filled)", dfill.filled === true && dfill.race.vampiro.stage === 4 && !!dfill.race.vampiro.fullAt, JSON.stringify(dfill.race && dfill.race.vampiro));
  check("doador repetido não conta duas vezes", (await raceRow("vampiro")).donors === 1);

  // ── segunda-feira ──
  const mon = sun("10:00") + 24 * 3600e3;
  await pool.query(`UPDATE tb_mm_nectar_wallet SET pending_ml = 1000 WHERE id_user = $1`, [r1]);
  await visit(r1, "estatua_aurion", mon - 60e3);
  check("segunda-feira: não recebe mais", (await Statue.deliver(r1, { key: "r1-mon-00001" }, mon)).code === "sunday");
  const rep = await Statue.deliver(r1, { key: "r1-first-0001" }, mon);
  check("o recibo antigo ainda responde na segunda (resposta perdida)", rep.replay === true && rep.delivery.id === d1.delivery.id);
  const monRace = await Statue.race(r1, mon);
  check("segunda: a tela mostra o resultado do domingo e quando abre o próximo", !monRace.sunday && monRace.week === SUN && monRace.race.raposa.fullAt && monRace.opensAt === new Date(Date.parse("2026-11-22T03:00:00Z")).toISOString(), JSON.stringify({ w: monRace.week, o: monRace.opensAt }));
  check("tela: o que entreguei neste domingo", monRace.me.deliveredMl === 10000 && monRace.me.pendingMl === 1000);

  // migration de novo (idempotente) não apaga nada
  await pool.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations/442_meu_mundo_estatua.sql"), "utf8"));
  check("mig 442 de novo: dados intactos e a config do admin fica", (await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_nectar_delivery`)).rows[0].n === 4 && Number((await pool.query(`SELECT base_ml FROM tb_mm_statue_config`)).rows[0].base_ml) === 12000);

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
