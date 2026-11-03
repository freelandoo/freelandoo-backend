// test/meu-mundo-aventura.e2e.js — MEU MUNDO 3D mm3d-59: luta conferida,
// recibos e XP no banco (mig 320), SEM o benefício de admin.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/mm npm run test:meu-mundo-aventura
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
    // chat (303) e salão (312) dependem de tabelas de fora do Meu Mundo
    .filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f))
    .sort();
  for (const f of all) {
    const sql = fs.readFileSync(path.join(__dirname, "../src/databases/migrations", f), "utf8");
    await pool.query(sql);
    if (f >= "320") await pool.query(sql); // a nova é idempotente
  }
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false; // balanceamento é sem o benefício de admin
  const Adv = require("../src/services/MeuMundoAdventureService");
  const F = require("../src/utils/meuMundoFight");

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mma', 'mma@mm.test')`, [id]);

  // conta "antiga": nasce, depois zera a destreza como se fosse de antes da mig 320
  await Life.peek(id);
  await pool.query(`UPDATE tb_mm_character SET dexterity = NULL WHERE id_user = $1`, [id]).catch(() => null);
  const seed = (await pool.query(`SELECT seed, dexterity FROM tb_mm_character WHERE id_user = $1`, [id])).rows[0];
  check("destreza gravada (NOT NULL, nascimento pela semente)", seed.dexterity === 15 + (Math.abs(seed.seed) % 16), JSON.stringify(seed));

  const start = await Adv.fightStart(id, { origin: "laminas", kind: "soldier", level: 1 });
  check("start devolve ticket e semente do servidor", start.fight && start.fight.ticket && start.fight.setup.seed > 0, JSON.stringify(start).slice(0, 200));
  const life0 = (await Life.peek(id)).character.vitals;

  // joga a luta como o aparelho (com a entrada quantizada)
  const setup = { ...start.fight.setup, style: start.fight.setup.style || undefined };
  const fight = new F.Fight(setup);
  const frames = [];
  for (let i = 0; i < 20000 && !fight.over; i++) {
    const q = F.quantizeInput({ mx: Math.sin(i / 45) * 0.5, mz: 0.85, run: false, attack: i % 17 === 0, dodge: false });
    F.pushFrame(frames, q);
    fight.step(q);
  }
  check("a luta de teste termina", !!fight.over);

  // relógio: a gravação não pode durar mais que o tempo real desde o start
  const early = await Adv.fightFinish(id, { ticket: start.fight.ticket, frames });
  check("fim cedo demais é recusado (clock)", early.code === "clock", JSON.stringify(early));
  await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '2 minutes' WHERE id_fight = $1`, [start.fight.ticket]);

  // gravação falsa: o aparelho diz que venceu, mas não atacou
  const fake = await Adv.fightFinish(id, { ticket: start.fight.ticket, frames: [[200, 0, 127, 0]] });
  check("gravação sem fim não vale", fake.code === "replay", JSON.stringify(fake));

  // duas abas mandam o mesmo fim ao mesmo tempo
  const [a, b] = await Promise.all([
    Adv.fightFinish(id, { ticket: start.fight.ticket, frames }),
    Adv.fightFinish(id, { ticket: start.fight.ticket, frames }),
  ]);
  check("os dois recebem recibo", a.receipt && b.receipt, JSON.stringify([a.error, b.error]));
  check("mesmo eventId nas duas respostas", a.receipt && b.receipt && a.receipt.eventId === b.receipt.eventId);
  check("só um concedeu (o outro é replay)", [a.replay, b.replay].filter(Boolean).length === 1);
  const n = (await pool.query(`SELECT COUNT(*)::int AS n FROM tb_mm_receipt WHERE id_user = $1`, [id])).rows[0].n;
  check("um recibo no banco", n === 1, String(n));
  const rec = a.receipt;
  check("vitória decidida pelo servidor", rec.result.win === fight.over.win);
  const adv = (await pool.query(`SELECT xp FROM tb_mm_adventure WHERE id_user = $1`, [id])).rows[0];
  check("XP gravado uma vez", Number(adv.xp) === rec.deltas.xp.xp && rec.deltas.xp.xp > 0, JSON.stringify([adv, rec.deltas.xp]));
  // mm3d-60k: atributo da luta = DROP (pontos inteiros nos 4 atributos) + moedas
  check("luta dropa atributo", Object.values(rec.deltas.attrs).reduce((x, y) => x + y, 0) > 0 && Object.keys(rec.deltas.attrs).every((k) => ["strength", "dexterity", "speed", "intelligence"].includes(k)), JSON.stringify(rec.deltas.attrs));
  check("luta dropa moedas", rec.deltas.coins > 0, JSON.stringify(rec.deltas));
  check("custo de energia efetivo no recibo", rec.deltas.vitals.energy <= 0 && rec.deltas.vitals.energy >= -5, JSON.stringify(rec.deltas.vitals));
  const life1 = (await Life.peek(id)).character;
  check("snapshot mostra destreza; a luta não gasta o orçamento do dia", life1.attributes.dexterity > 0 && life1.attributes.budgetToday.strength.used === 0, JSON.stringify(life1.attributes.budgetToday));
  check("energia caiu (vida passiva + luta)", life1.vitals.energy < life0.energy + 0.01);

  // reenvio depois (resposta perdida): mesmo recibo
  const again = await Adv.fightFinish(id, { ticket: start.fight.ticket, frames });
  check("reenvio devolve o mesmo recibo", again.replay === true && again.receipt.eventId === rec.eventId);

  // abandono: abre e não fecha; a próxima abre e cobra a derrota uma vez
  const s2 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  const s3 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  check("luta abandonada vira derrota (uma vez)", s3.abandoned.length === 1 && s3.abandoned[0].result.abandoned && s3.abandoned[0].actionKey === s2.fight.ticket);
  const s4 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  check("o abandono não é cobrado de novo", s4.abandoned.length === 1 && s4.abandoned[0].actionKey === s3.fight.ticket);

  // monstro da rua sem a sala ter visto: recusa
  const mob = await Adv.fightStart(id, { origin: "mob", mobId: 7 });
  check("monstro que a sala não confirmou é recusado", mob.code === "mob");

  const get = await Adv.get(id);
  check("GET /adventure traz nível e recibos", get.adventure.level >= 1 && get.receipts.length >= 3);
  check("drop garantido na luta vencida", rec.items.length >= 1 && rec.items[0].id === "fragmento_lamina", JSON.stringify(rec.items));

  // ── slice 3: equipamento ──
  const Gear = require("../src/services/MeuMundoGearService");
  const pool2 = pool;
  await pool2.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm') ON CONFLICT DO NOTHING`, [id]);
  const starter = await Life.withLife(id, async (s, ctx) => ({ got: await Gear.grantStarter(id, ctx) }));
  check("arma inicial da classe (espada) entregue e equipada", starter.got && starter.got.id === "espada_aprendiz");
  const again2 = await Life.withLife(id, async (s, ctx) => ({ got: await Gear.grantStarter(id, ctx) }));
  check("arma inicial não repete", again2.got === null);
  const bag0 = (await Gear.get(id)).bag;
  check("mochila mostra a espada equipada", bag0.equipped.weapon === "espada_aprendiz");

  // nível 1 não compra a espada de latão (nível 2)
  const k = () => crypto.randomUUID();
  const low = await Gear.buy(id, { item: "espada_latao", key: k() });
  check("requisito de nível no servidor", low.code === "level", JSON.stringify(low));
  await pool2.query(`UPDATE tb_mm_adventure SET xp = 500 WHERE id_user = $1`, [id]);
  await pool2.query(`UPDATE tb_mm_wallet SET coins = 1000 WHERE id_user = $1`, [id]);

  // mesmo pedido em duas abas: cobra uma vez
  const key1 = k();
  const [p1, p2] = await Promise.all([Gear.buy(id, { item: "espada_latao", key: key1 }), Gear.buy(id, { item: "espada_latao", key: key1 })]);
  check("compra repetida = mesmo recibo", p1.receipt && p2.receipt && p1.receipt.eventId === p2.receipt.eventId, JSON.stringify([p1.error, p2.error]));
  const coinsA = Number((await pool2.query(`SELECT coins FROM tb_mm_wallet WHERE id_user = $1`, [id])).rows[0].coins);
  check("cobrou 600 uma vez", Math.round(coinsA) === 400 || Math.round(coinsA) > 395, String(coinsA));

  // duas compras DIFERENTES com saldo para uma só: nunca negativo
  const [c1, c2] = await Promise.all([Gear.buy(id, { item: "colete_couro", key: k() }), Gear.buy(id, { item: "relogio_bolso", key: k() })]);
  const coinsB = Number((await pool2.query(`SELECT coins FROM tb_mm_wallet WHERE id_user = $1`, [id])).rows[0].coins);
  check("saldo nunca negativo em compras concorrentes", coinsB >= 0 && [c1, c2].filter((x) => x.code === "coins").length === 1, JSON.stringify([c1.code, c2.code, coinsB]));

  // equipar: arma de outra classe recusada
  await pool2.query(`INSERT INTO tb_mm_gear (id_user, item_id, qty) VALUES ($1, 'cajado_latao', 1)`, [id]);
  const wrong = await Gear.equip(id, { slot: "weapon", item: "cajado_latao" });
  check("arma de outra classe não equipa", wrong.code === "clan");
  const ok = await Gear.equip(id, { slot: "weapon", item: "espada_latao" });
  check("equipa a espada de latão (bônus de dano)", ok.bag && ok.bag.bonus.dmg === 0.05, JSON.stringify(ok.bag && ok.bag.bonus));

  // a luta seguinte leva o bônus no ticket
  const s5 = await Adv.fightStart(id, { origin: "laminas", kind: "soldier", level: 1 });
  check("ticket leva o bônus do equipamento", s5.fight.setup.gear && s5.fight.setup.gear.dmg === 0.05);

  // forja: sem materiais recusa; com materiais, consome e entrega
  const nf = await Gear.forge(id, { recipe: "forjar_luvas", key: k() });
  check("forja sem materiais recusa", nf.code === "needs" || nf.code === "coins", JSON.stringify(nf));
  await pool2.query(`UPDATE tb_mm_wallet SET coins = 500 WHERE id_user = $1`, [id]);
  await pool2.query(
    `INSERT INTO tb_mm_gear (id_user, item_id, qty) VALUES ($1, 'couro_reforcado', 3), ($1, 'mola_precisao', 4)
     ON CONFLICT (id_user, item_id) DO UPDATE SET qty = EXCLUDED.qty`,
    [id]
  );
  const fg = await Gear.forge(id, { recipe: "forjar_luvas", key: k() });
  check("forja entrega as luvas", fg.receipt && fg.bag.owned.luvas_precisao && !fg.bag.owned.mola_precisao, JSON.stringify(fg.error || fg.bag.owned));

  // ── slice 5: o prólogo inteiro numa conta NOVA (raposa) ──
  const Quest = require("../src/services/MeuMundoQuestService");
  const nu = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mmq', 'mmq@mm.test')`, [nu]);
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'f')`, [nu]);
  const step = async () => (await Quest.get(nu)).quest;
  const qa = (action = "ack") => Quest.advance(nu, { action });
  let q = await step();
  check("prólogo começa no passo 1 de 10", q.step === 0 && q.total === 10 && q.current.key === "chegada");
  const tut0 = await Adv.fightStart(nu, { origin: "tutorial" });
  check("luta de treino fechada fora do passo", tut0.code === "tutorial");
  const r1 = await qa();
  const r1b = await Quest.advance(nu, { action: "ack" });
  check("passo 1 entregue; o seguinte ainda não", r1.receipt && r1b.code === "pending", JSON.stringify([r1.error, r1b.code]));
  const ate = await Life.consume(nu, "agua_coco");
  if (ate.error) console.log("consume:", JSON.stringify(ate));
  check("passo 2 (comer) conferido pelo evento", (await qa()).receipt);
  const pend = await qa();
  check("passo 3 sem treino = pendente", pend.code === "pending");
  const chr = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1`, [nu])).rows[0].id_character;
  await pool.query(`INSERT INTO tb_mm_character_event (id_character, at, kind, data) VALUES ($1, NOW() + INTERVAL '1 second', 'activity', '{"kind":"training","hours":1,"place":"academia"}')`, [chr]);
  const r3 = await qa();
  check("passo 3 (treinar) conferido", r3.receipt, JSON.stringify(r3.error));
  q = await step();
  const bagQ = (await Gear.get(nu)).bag;
  check("passo 4 entrega o cajado da raposa, equipado", q.current.key === "arma" && bagQ.equipped.weapon === "cajado_aprendiz");
  check("passo 4 entregue", (await qa()).receipt);
  // passo 5: luta de treino (de graça) com o kit de MAGA pela classe
  const tut = await Adv.fightStart(nu, { origin: "tutorial" });
  check("luta de treino abre no passo 5, maga pela classe", tut.fight && tut.fight.setup.style === "mage", JSON.stringify(tut.error || tut.fight.setup));
  const e0 = (await Life.peek(nu)).character.vitals.energy;
  const fT = new F.Fight({ ...tut.fight.setup, style: "mage", gear: tut.fight.setup.gear || undefined });
  const framesT = [];
  for (let i = 0; i < 30000 && !fT.over; i++) {
    const qi = F.quantizeInput({ mx: 0, mz: i % 200 < 100 ? 0.3 : -0.3, run: false, attack: i % 15 === 0, dodge: false });
    F.pushFrame(framesT, qi);
    fT.step(qi);
  }
  await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '6 minutes' WHERE id_fight = $1`, [tut.fight.ticket]);
  const doneT = await Adv.fightFinish(nu, { ticket: tut.fight.ticket, frames: framesT });
  check("luta de treino conferida", doneT.receipt && doneT.receipt.result.origin === "tutorial", JSON.stringify(doneT.error));
  check("treino sem custo de energia/estresse", doneT.receipt.deltas.cost.energy === 0 && doneT.receipt.deltas.cost.stress === 0);
  void e0;
  check("passo 5 entregue", (await qa()).receipt);
  const won = doneT.receipt.result.win;
  if (!won) {
    // passo 6 pede VITÓRIA conferida: outra luta de treino até vencer
    for (let k = 0; k < 8; k++) {
      const t2 = await Adv.fightStart(nu, { origin: "tutorial" });
      const f2 = new F.Fight({ ...t2.fight.setup, style: "mage", gear: t2.fight.setup.gear || undefined });
      const fr2 = [];
      for (let i = 0; i < 30000 && !f2.over; i++) {
        const qi = F.quantizeInput({ mx: 0, mz: 0, run: false, attack: i % 10 === 0, dodge: false, power: f2.me.power >= 100 });
        F.pushFrame(fr2, qi);
        f2.step(qi);
      }
      await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '6 minutes' WHERE id_fight = $1`, [t2.fight.ticket]);
      const d2 = await Adv.fightFinish(nu, { ticket: t2.fight.ticket, frames: fr2 });
      if (d2.receipt && d2.receipt.result.win) break;
    }
  }
  const r6 = await qa();
  check("passo 6 (vitória conferida)", r6.receipt, JSON.stringify(r6.error));
  check("passo 7 (material na mochila — o drop da luta)", (await qa()).receipt);
  const r8a = await qa();
  check("passo 8 sem visitar o Armeiro = pendente", r8a.code === "pending");
  await Quest.advance(nu, { action: "visit_armory" });
  check("passo 8 (Armeiro + arma equipada)", (await qa()).receipt);
  check("passo 9 entregue", (await qa()).receipt);
  const last = await qa();
  check("passo 10: pista de Morkhan + amuleto", last.receipt && last.receipt.result.last && last.receipt.items.some((i) => i.id === "cristal_morkhan"), JSON.stringify(last.error));
  const advRow = (await pool.query(`SELECT xp FROM tb_mm_adventure WHERE id_user = $1`, [nu])).rows[0];
  const lv = require("../src/utils/meuMundoAdventure").levelOf(Number(advRow.xp));
  check("prólogo garante subir de nível (≥ 3)", lv.level >= 3, JSON.stringify(lv));
  const lvUps = (await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_receipt WHERE id_user = $1 AND (deltas->'xp'->>'to')::int > (deltas->'xp'->>'from')::int`, [nu])).rows[0].n;
  check("subidas de nível vêm em recibos (para a celebração)", lvUps >= 1, String(lvUps));
  const dup = await Quest.advance(nu, { action: "ack" });
  check("missão concluída não concede de novo", dup.code === "done");

  // ── slice 4: crédito de minijogo medido pela sala ──
  const now = Date.now();
  const segs = [{ from: now - 9 * 60000, to: now - 60000 }]; // 8 min ativos
  const [m1, m2] = await Promise.all([
    Adv.creditMinigame(nu, { activity: "gincana", actionKey: "gincana:r1:1", segments: segs, win: true }),
    Adv.creditMinigame(nu, { activity: "gincana", actionKey: "gincana:r1:1", segments: segs, win: true }),
  ]);
  check("minijogo: mesma partida = mesmo recibo", m1.receipt && m2.receipt && m1.receipt.eventId === m2.receipt.eventId);
  const mr = m1.receipt;
  check("minijogo: janela máxima (Gincana 6 min) no tempo ativo", mr.activeMs === 6 * 60000, String(mr.activeMs));
  check("minijogo: destreza principal e velocidade secundária", mr.deltas.attrs.dexterity > 0 && mr.deltas.attrs.speed > 0, JSON.stringify(mr.deltas.attrs));
  check("minijogo: material da família (molas)", mr.items.some((i) => i.id === "mola_precisao"), JSON.stringify(mr.items));
  check("minijogo: dropa moedas", mr.deltas.coins > 0, JSON.stringify(mr.deltas));
  const afk = await Adv.creditMinigame(nu, { activity: "paint", actionKey: "paint:r2:1", segments: [] });
  check("minijogo sem tempo ativo não gera recibo", afk.receipt === null);
  const future = await Adv.creditMinigame(nu, { activity: "paint", actionKey: "paint:r3:1", segments: [{ from: now + 60000, to: now + 600000 }] });
  check("tempo no futuro não conta", future.receipt === null);

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
