// test/meu-mundo-deus.e2e.js — lore v2 N4: o deus solto.
//
// Estátua cheia no domingo → a caçada nasce e solta no fim do domingo (segunda 00:00
// de Brasília); o aviso "solto" sai uma vez; só a raça oposta luta (rua: a sala viu o
// deus alcançar; Domínio: aberto para a pessoa); a ficha do deus é 2× a de quem
// enfrenta; perder só tira energia; a primeira vitória conferida derruba para todos
// (recibo na transação, reenvio não duplica, a segunda vitória não derruba de novo).
//
// Roda: TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/freelandoo_test npm run test:meu-mundo-deus
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_god_hunt, tb_mm_statue_week, tb_mm_domain_pact, tb_mm_domain_progress, tb_mm_video, tb_mm_archive, tb_mm_trainer, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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

function fakeRes() {
  const out = { status: 200, body: null };
  const res = {
    set() {
      return res;
    },
    status(n) {
      out.status = n;
      return res;
    },
    json(b) {
      out.body = b;
      return res;
    },
  };
  return { res, out };
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const mig = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/447_meu_mundo_deus_solto.sql"), "utf8");
  await pool.query(mig);
  await pool.query(mig);
  check("mig 447 idempotente (rodou 3×)", true);

  // o socket e as salas: capturados (nada de rede no teste)
  const sent = [];
  const socket = require("../src/realtime/socket");
  socket.emitToAll = (ev, p) => sent.push({ ev, p });
  const rooms = require("../src/realtime/meuMundo");
  let engaged = false;
  rooms.godEngaged = () => engaged;
  const verdicts = [];
  rooms.godVerdict = (u, g, w) => verdicts.push({ u, g, w });

  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const God = require("../src/services/MeuMundoGodService");
  const Adv = require("../src/services/MeuMundoAdventureService");
  const Ctl = require("../src/controllers/MeuMundoController");
  const Trainer = require("../src/utils/meuMundoTrainer");
  const F = require("../src/utils/meuMundoFight");

  const user = async (name, clan) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, name, `${name}@mm.test`]);
    await Life.peek(id);
    if (clan) await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, $2, 'm') ON CONFLICT (id_user) DO UPDATE SET clan = EXCLUDED.clan`, [id, clan]);
    return id;
  };
  const call = async (fn, id, { params = {}, body = {} } = {}) => {
    const { res, out } = fakeRes();
    await Ctl[fn]({ user: { id_user: id }, params, body }, res);
    return out;
  };
  const vitals = async (id) => (await pool.query(`SELECT energy::float, stress::float, strength::float, speed::float FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [id])).rows[0];
  const play = async (id, ticket) => {
    const su = ticket.setup;
    const fight = new F.Fight({ kind: su.kind, level: su.level, hero: su.hero || undefined, body: su.body || undefined, seed: su.seed, stats: su.stats, style: su.style || undefined, gear: su.gear || undefined, temper: su.temper || undefined, affection: su.affection || undefined, god: su.god || undefined });
    const frames = [];
    for (let i = 0; i < 40000 && !fight.over; i++) {
      const q = F.quantizeInput({ mx: Math.sin(i / 45) * 0.5, mz: 0.85, run: false, attack: i % 9 === 0, dodge: i % 61 === 0 });
      F.pushFrame(frames, q);
      fight.step(q);
    }
    await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '30 minutes' WHERE id_fight = $1`, [ticket.ticket]);
    return { win: !!(fight.over && fight.over.win), mobHp: fight.mobs[0].hpMax, myHp: fight.me.hpMax, done: await Adv.fightFinish(id, { ticket: ticket.ticket, frames }) };
  };
  const hunts = async () => (await pool.query(`SELECT * FROM tb_mm_god_hunt ORDER BY id_hunt`)).rows;

  // ── estátua cheia no domingo → caçada que solta na segunda ──
  const SUN = "2026-11-15";
  await pool.query(`INSERT INTO tb_mm_statue_week (week, clan, delivered_ml, goal_ml, full_at) VALUES ($1, 'raposa', 30000, 30000, $2)`, [SUN, "2026-11-15T18:00:00Z"]);
  await pool.query(`INSERT INTO tb_mm_statue_week (week, clan, delivered_ml, goal_ml) VALUES ($1, 'vampiro', 1000, 30000)`, [SUN]);
  const vamp = await user("mmg_vamp", "vampiro");
  const sunday = Date.parse("2026-11-15T23:00:00Z"); // 20:00 de domingo em Brasília
  let st = await God.state(vamp, sunday);
  check("domingo: Aurion ainda não solto (estátua cheia, solta na segunda)", st.loose.length === 0 && st.upcoming.length === 1 && st.upcoming[0].god === "aurion" && st.upcoming[0].looseAt === "2026-11-16T03:00:00.000Z", JSON.stringify(st));
  check("Morkhan: estátua não encheu, não há caçada", !st.upcoming.some((h) => h.god === "morkhan"));
  const monday = Date.parse("2026-11-16T04:00:00Z");
  st = await God.state(vamp, monday);
  check("segunda: Aurion solto e caça o vampiro", st.loose.length === 1 && st.loose[0].god === "aurion" && st.loose[0].prey === "vampiro" && st.loose[0].huntsMe === true && st.peer === 2, JSON.stringify(st.loose));
  check("a caçada nasce uma vez por domingo × povo", (await hunts()).length === 1);
  await God.state(vamp, monday);
  check("ler de novo não duplica a caçada", (await hunts()).length === 1);
  sent.length = 0;
  await God.refresh(monday);
  const loud = sent.filter((x) => x.ev === "mm:god");
  check("aviso 'solto' por socket (mm:god) uma vez", loud.length === 1 && loud[0].p.e === "loose" && loud[0].p.god === "aurion" && loud[0].p.prey === "vampiro", JSON.stringify(sent));
  check("cópia em memória das salas tem Aurion", God.current().length === 1 && God.current()[0].god === "aurion");
  sent.length = 0;
  await God.refresh(monday + 60000);
  check("reler não avisa de novo (announced_at)", sent.filter((x) => x.ev === "mm:god").length === 0);
  // a caçada do domingo solta só no futuro real: para lutar agora, o admin solta (mesma regra)
  // (a estátua sai também: senão a releitura recria a caçada do domingo, que solta no futuro)
  await pool.query(`DELETE FROM tb_mm_statue_week`);
  await pool.query(`DELETE FROM tb_mm_god_hunt`);
  God.stop();

  // ── nada solto: a luta não abre ──
  let r = await call("fightStart", vamp, { body: { origin: "god", god: "aurion", where: "street" } });
  check("deus não solto → 409", r.status === 409 && r.body.code === "god", JSON.stringify(r));
  r = await call("godRelease", vamp, { body: { clan: "raposa" } });
  check("admin solta Aurion (POST /deus/soltar)", r.status === 200 && r.body.fresh === true && r.body.hunt.god === "aurion", JSON.stringify(r));
  r = await call("godRelease", vamp, { body: { clan: "raposa" } });
  check("soltar de novo devolve o de pé", r.status === 200 && r.body.fresh === false);
  r = await call("godRelease", vamp, { body: { clan: "lobo" } });
  check("povo inválido → 400", r.status === 400);
  r = await call("godState", vamp);
  check("GET /deus responde com Aurion solto", r.status === 200 && r.body.loose.length === 1 && r.body.loose[0].god === "aurion");

  // ── quem pode lutar ──
  const fox = await user("mmg_fox", "raposa");
  const none = await user("mmg_none", null);
  r = await call("fightStart", fox, { body: { origin: "god", god: "aurion", where: "street" } });
  check("raposa não é presa de Aurion → 403", r.status === 403 && r.body.code === "prey", JSON.stringify(r));
  r = await call("fightStart", none, { body: { origin: "god", god: "aurion", where: "street" } });
  check("sem classe → 409", r.status === 409 && r.body.code === "clan");
  r = await call("fightStart", vamp, { body: { origin: "god", god: "morkhan", where: "street" } });
  check("Morkhan não está solto → 409", r.status === 409 && r.body.code === "god");
  engaged = false;
  r = await call("fightStart", vamp, { body: { origin: "god", god: "aurion", where: "street" } });
  check("rua sem a sala ver o deus alcançar → 409", r.status === 409 && r.body.code === "where");
  r = await call("fightStart", vamp, { body: { origin: "god", god: "aurion", where: "dominio" } });
  check("lugar desconhecido → 409", r.status === 409 && r.body.code === "where");
  r = await call("fightStart", vamp, { body: { origin: "god", god: "aurion", where: "domain", domain: "floresta" } });
  check("Domínio fechado para quem está no nível 1 → 403", r.status === 403 && r.body.code === "closed", JSON.stringify(r));
  await pool.query(`INSERT INTO tb_mm_trainer (id_user, xp, level) VALUES ($1, $2, 5)`, [vamp, Trainer.xpForLevel(5)]);
  r = await call("fightStart", vamp, { body: { origin: "god", god: "aurion", where: "domain", domain: "floresta" } });
  check("no Domínio aberto: a luta abre", r.status === 200 && r.body.fight.setup.god === "aurion" && r.body.fight.origin === "god", JSON.stringify(r).slice(0, 200));

  // ── derrota: só energia ──
  engaged = true;
  await pool.query(`UPDATE tb_mm_character SET energy = 100, stress = 20 WHERE id_user = $1 AND status = 'alive'`, [vamp]);
  r = await call("fightStart", vamp, { body: { origin: "god", god: "aurion", where: "street" } });
  check("a sala viu Aurion alcançar: a luta abre (Cavaleiro, nível 1, deus no ticket)", r.status === 200 && r.body.fight.setup.kind === "cavaleiro" && r.body.fight.setup.level === 1 && r.body.fight.setup.god === "aurion", JSON.stringify(r).slice(0, 300));
  check("a luta aberta no Domínio antes conta como abandono (uma vez)", r.body.abandoned.length === 1);
  const before = await vitals(vamp);
  const lost = await play(vamp, r.body.fight);
  check("a ficha do deus é 2× (vida)", lost.mobHp === Math.round(lost.myHp * 2), `${lost.mobHp} × ${lost.myHp}`);
  const rec = lost.done.receipt;
  check("o robô perde para 2× o status", !lost.win && rec && rec.result.win === false && rec.result.god === "aurion", JSON.stringify(lost.done).slice(0, 300));
  const after = await vitals(vamp);
  check("derrota: tira energia", after.energy < before.energy, `${before.energy} → ${after.energy}`);
  check("derrota: sem estresse", Math.abs(after.stress - before.stress) < 0.01, `${before.stress} → ${after.stress}`);
  check("derrota: sem XP, sem atributo, sem item, sem moeda", rec.deltas.xp.xp === 0 && Object.keys(rec.deltas.attrs || {}).length === 0 && (rec.items || []).length === 0 && !rec.deltas.coins, JSON.stringify(rec.deltas));
  check("derrota: o deus segue solto", (await hunts()).every((h) => !h.defeated_at));
  check("derrota: a sala deixa a pessoa em paz (veredito)", verdicts.length === 1 && verdicts[0].w === false && verdicts[0].g === "aurion");

  // ── vitória: derruba para todos ──
  const vamp2 = await user("mmg_vamp2", "vampiro");
  const t1 = (await call("fightStart", vamp, { body: { origin: "god", god: "aurion", where: "street" } })).body.fight;
  const t2 = (await call("fightStart", vamp2, { body: { origin: "god", god: "aurion", where: "street" } })).body.fight;
  check("dois vampiros com luta aberta contra Aurion", !!t1 && !!t2);
  const real = F.replayFight;
  F.replayFight = () => ({ ok: true, win: true, steps: 200, activeSteps: 200, hits: 9, hitsTaken: 2, mobHpLeft: 0 });
  for (const id of [vamp, vamp2]) await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '30 minutes' WHERE id_user = $1 AND closed_at IS NULL`, [id]);
  sent.length = 0;
  const w1 = await Adv.fightFinish(vamp, { ticket: t1.ticket, frames: [] });
  check("vitória conferida derruba Aurion (recibo com god.fresh)", w1.receipt && w1.receipt.god && w1.receipt.god.fresh === true && w1.receipt.result.win === true, JSON.stringify(w1).slice(0, 300));
  let hs = await hunts();
  check("caçada fechada com quem venceu e a luta", hs.length === 1 && hs[0].defeated_at && hs[0].id_user === vamp && hs[0].id_fight === t1.ticket);
  const down = sent.filter((x) => x.ev === "mm:god");
  check("aviso 'caiu' por socket com o nome", down.length === 1 && down[0].p.e === "down" && down[0].p.god === "aurion" && down[0].p.name === "mmg_vamp", JSON.stringify(sent));
  check("a cópia em memória tira Aurion das salas", God.current().length === 0);
  const again = await Adv.fightFinish(vamp, { ticket: t1.ticket, frames: [] });
  check("reenvio = o mesmo recibo, sem derrubar de novo", again.replay === true && (await hunts()).length === 1);
  sent.length = 0;
  const w2 = await Adv.fightFinish(vamp2, { ticket: t2.ticket, frames: [] });
  check("a segunda vitória (luta aberta antes da queda) não derruba de novo", w2.receipt && w2.receipt.god && w2.receipt.god.fresh === false && sent.filter((x) => x.ev === "mm:god").length === 0, JSON.stringify(w2.receipt && w2.receipt.god));
  hs = await hunts();
  check("a caçada segue com o primeiro vencedor", hs[0].id_user === vamp && hs[0].id_fight === t1.ticket);
  F.replayFight = real;
  r = await call("fightStart", vamp2, { body: { origin: "god", god: "aurion", where: "street" } });
  check("depois da queda a luta não abre", r.status === 409 && r.body.code === "god");
  r = await call("godState", vamp2);
  check("GET /deus mostra a queda com quem venceu", r.body.loose.length === 0 && r.body.fallen[0].god === "aurion" && r.body.fallen[0].winner === "mmg_vamp", JSON.stringify(r.body.fallen));
  // o admin pode soltar de novo depois da queda (nova caçada)
  r = await call("godRelease", vamp, { body: { clan: "raposa" } });
  check("depois da queda, soltar abre uma caçada nova", r.body.fresh === true && (await hunts()).length === 2);

  // ── as outras lutas seguem iguais ──
  const tr = await Adv.fightStart(fox, { origin: "laminas", kind: "cavaleiro" });
  check("luta de treino sem deus no ticket", tr.fight && tr.fight.setup.god === null && tr.fight.setup.tier === "arena", JSON.stringify(tr).slice(0, 200));

  God.stop();
  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
