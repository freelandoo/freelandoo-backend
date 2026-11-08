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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
  // B5 (mig 365): a luta entra UMA vez no inventário de monstros (as duas abas e o reenvio não somam)
  const inv1 = (await Adv.monsters(id)).monsters
  const sol = inv1.find((m) => m.kind === "soldier")
  check("inventário: a luta da Arena conta uma vez", sol.wins + sol.losses === 1 && sol.wins === (rec.result.win ? 1 : 0), JSON.stringify(sol))
  check("inventário: lista todas as espécies, zero no resto", inv1.length === 6 && inv1.filter((m) => m.kind !== "soldier").every((m) => m.wins === 0 && m.losses === 0))
  check("inventário: maior nível vencido", sol.bestLevel === (rec.result.win ? 1 : 0), JSON.stringify(sol))

  // abandono: abre e não fecha; a próxima abre e cobra a derrota uma vez
  const s2 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  const s3 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  check("luta abandonada vira derrota (uma vez)", s3.abandoned.length === 1 && s3.abandoned[0].result.abandoned && s3.abandoned[0].actionKey === s2.fight.ticket);
  const s4 = await Adv.fightStart(id, { origin: "laminas", kind: "golem", level: 1 });
  check("inventário: abandono não conta", (await Adv.monsters(id)).monsters.find((m) => m.kind === "golem").losses === 0)
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

  // Armas compostas agora são montadas, não compradas inteiras.
  const k = () => crypto.randomUUID();
  const noWeaponShortcut = await Gear.buy(id, { item: "espada_latao", key: k() });
  check("arma composta não tem atalho de compra", noWeaponShortcut.code === "forsale");
  // nível 1 não compra a couraça rebitada (nível 3)
  const low = await Gear.buy(id, { item: "couraca_rebitada", key: k() });
  check("requisito de nível no servidor", low.code === "level", JSON.stringify(low));
  await pool2.query(`UPDATE tb_mm_adventure SET xp = 500 WHERE id_user = $1`, [id]);
  await pool2.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 1000) ON CONFLICT (user_id) DO UPDATE SET balance = 1000`, [id]); // A7: moedas do jogo = Esmeralda

  // mesmo pedido em duas abas: cobra uma vez
  const key1 = k();
  const [p1, p2] = await Promise.all([Gear.buy(id, { item: "couraca_rebitada", key: key1 }), Gear.buy(id, { item: "couraca_rebitada", key: key1 })]);
  check("compra repetida = mesmo recibo", p1.receipt && p2.receipt && p1.receipt.eventId === p2.receipt.eventId, JSON.stringify([p1.error, p2.error]));
  const coinsA = Number((await pool2.query(`SELECT balance FROM emerald_wallets WHERE user_id = $1`, [id])).rows[0].balance);
  check("cobrou 700 uma vez", Math.round(coinsA) === 300, String(coinsA));

  // duas compras DIFERENTES com saldo para uma só: nunca negativo
  const [c1, c2] = await Promise.all([Gear.buy(id, { item: "colete_couro", key: k() }), Gear.buy(id, { item: "relogio_bolso", key: k() })]);
  const coinsB = Number((await pool2.query(`SELECT balance FROM emerald_wallets WHERE user_id = $1`, [id])).rows[0].balance);
  check("saldo nunca negativo em compras concorrentes", coinsB >= 0 && [c1, c2].filter((x) => x.code === "coins").length === 1, JSON.stringify([c1.code, c2.code, coinsB]));

  // equipar: arma de outra classe recusada
  // Uma arma antiga permanece válida depois da introdução da montagem.
  await pool2.query(`INSERT INTO tb_mm_gear (id_user, item_id, qty) VALUES ($1, 'espada_latao', 1)`, [id]);
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
  await pool2.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 500) ON CONFLICT (user_id) DO UPDATE SET balance = 500`, [id]); // A7: moedas do jogo = Esmeralda
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

  // ── mm3d-66: Loja de Armas — espada é de guerreiro, os golpes são da skin ──
  const su = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mms', 'mms@mm.test')`, [su]);
  await Life.peek(su);
  await pool.query(`INSERT INTO emerald_wallets (user_id, balance) VALUES ($1, 100000) ON CONFLICT (user_id) DO UPDATE SET balance = 100000`, [su]); // A7: moedas do jogo = Esmeralda
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'f') ON CONFLICT DO NOTHING`, [su]);
  // B3 (mig 340): as skins viraram ESPÉCIES de personagem — "vestir" = o personagem ativo ser daquela espécie.
  const wear = (skin) => pool.query(`UPDATE tb_mm_character SET species = $2 WHERE id_user = $1 AND status = 'alive'`, [su, skin]);
  const fightKit = async () => (await Adv.fightStart(su, { origin: "laminas", kind: "soldier", level: 1 })).fight.setup;
  const fox = await Gear.buy(su, { item: "espada_aco", key: k() });
  check("raposa não compra espada", fox.code === "clan", JSON.stringify(fox));
  check("mochila da raposa: não é guerreira", (await Gear.get(su)).bag.warrior === false);
  check("raposa segue maga na luta", (await fightKit()).style === "mage");
  await wear("aurion");
  const aurion = await Gear.buy(su, { item: "espada_aco", key: k() });
  check("conta raposa vestindo Aurion compra espada", !aurion.error, JSON.stringify(aurion));
  const auEq = await Gear.equip(su, { slot: "weapon", item: "espada_aco" });
  check("Aurion equipa a espada da loja (+2% dano)", auEq.bag && auEq.bag.warrior === true && auEq.bag.bonus.dmg === 0.02, JSON.stringify(auEq.bag && auEq.bag.bonus));
  const auKit = await fightKit();
  check("Aurion luta com kit de espada e a espada comprada", !auKit.style && auKit.appearance.weaponId === "espada_aco", JSON.stringify(auKit.appearance));
  await wear("iris");
  const iris = await Gear.buy(su, { item: "espada_viajante", key: k() });
  check("skin que não é guerreira não compra espada", iris.code === "clan", JSON.stringify(iris));
  const irisKit = await fightKit();
  check("a espada equipada não vale fora do guerreiro", irisKit.appearance.weaponId === null && irisKit.style === "mage", JSON.stringify(irisKit.appearance));

  // ── mm3d-67: aba Hammers — Soldado de Pedra, Marú e Kragor ──
  const irisHam = await Gear.buy(su, { item: "pesada_ferreiro", key: k() });
  check("quem não é das skins de martelo não compra arma pesada", irisHam.code === "clan", JSON.stringify(irisHam));
  await wear("kragor");
  const krBuy = await Gear.buy(su, { item: "pesada_ferreiro", key: k() });
  check("conta raposa vestindo Kragor compra arma pesada", !krBuy.error, JSON.stringify(krBuy));
  const krSword = await Gear.equip(su, { slot: "weapon", item: "espada_aco" });
  check("Kragor não equipa espada", krSword.code === "clan", JSON.stringify(krSword));
  const krEq = await Gear.equip(su, { slot: "weapon", item: "pesada_ferreiro" });
  check("Kragor equipa o machado (+2% dano)", krEq.bag && krEq.bag.hammer === true && krEq.bag.bonus.dmg === 0.02, JSON.stringify(krEq.bag && krEq.bag.bonus));
  const krKit = await fightKit();
  check("Kragor luta com o kit do Brutamontes e a arma comprada", krKit.kit === "hammer" && !krKit.style && krKit.appearance.weaponId === "pesada_ferreiro", JSON.stringify(krKit));
  await wear("aurion");
  const auHam = await fightKit();
  check("a arma pesada equipada não vale no Aurion", auHam.appearance.weaponId === null && auHam.kit === null, JSON.stringify(auHam.appearance));

  // ═══ B8 (mig 375): Lâminas = Hall — desafio contra a ficha congelada ═══
  await pool.query(`ALTER TABLE tb_user ADD COLUMN IF NOT EXISTS is_minor BOOLEAN NOT NULL DEFAULT FALSE`);
  await pool.query(`CREATE TABLE IF NOT EXISTS tb_profile (id_user UUID, display_name TEXT, avatar_url TEXT, is_user_account BOOLEAN DEFAULT TRUE, deleted_at TIMESTAMPTZ)`);
  const Hall = require("../src/services/MeuMundoHallService");
  await pool.query(`DELETE FROM tb_mm_hall_challenge; DELETE FROM tb_mm_hall_seat`);
  const ch = crypto.randomUUID();
  const df = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'desafiante', 'd@mm.test'), ($2, 'defensor', 'f@mm.test')`, [ch, df]);
  await Life.peek(ch);
  await Life.peek(df);
  await pool.query(`UPDATE tb_mm_character SET power = 1000 WHERE id_user = $1`, [ch]);
  await pool.query(`UPDATE tb_mm_character SET power = 1500 WHERE id_user = $1`, [df]);
  await pool.query(`INSERT INTO tb_mm_hall_seat (seat, id_user) VALUES (1, $1)`, [df]);
  const fromClient = await Adv.fightStart(ch, { origin: "hall" });
  check("hall: o aparelho não abre a origem hall sozinho", fromClient.code === "origin", JSON.stringify(fromClient));
  const outsider = await Hall.challenge(ch, { defender: crypto.randomUUID() });
  check("hall: quem não está no Hall nem no top não é desafiável", outsider.code === "eligible", JSON.stringify(outsider));
  const hc1 = await Hall.challenge(ch, { defender: df });
  check("hall: abre a luta com a ficha congelada (peer 1,5, Campeão)", hc1.fight && hc1.fight.setup.peer === 1.5 && hc1.fight.setup.kind === "brute", JSON.stringify(hc1).slice(0, 300));
  let hWon = null;
  if (hc1.fight) {
    const su = hc1.fight.setup;
    const fh = new F.Fight({ kind: su.kind, level: su.level, hero: su.hero || undefined, peer: su.peer || undefined, body: su.body || undefined, seed: su.seed, stats: su.stats, style: su.style || undefined, gear: su.gear || undefined, temper: su.temper || undefined, affection: su.affection || undefined });
    const fr = [];
    for (let i = 0; i < 40000 && !fh.over; i++) {
      const q = F.quantizeInput({ mx: Math.sin(i / 45) * 0.5, mz: 0.85, run: false, attack: i % 17 === 0, dodge: i % 53 === 0 });
      F.pushFrame(fr, q);
      fh.step(q);
    }
    await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '30 minutes' WHERE id_fight = $1`, [hc1.fight.ticket]);
    const done = await Adv.fightFinish(ch, { ticket: hc1.fight.ticket, frames: fr });
    check("hall: a luta fecha pelo servidor com o desafio", done.receipt && done.receipt.hall && ["won", "lost"].includes(done.receipt.hall.status), JSON.stringify(done.error || (done.receipt && done.receipt.hall)));
    hWon = !!(done.receipt && done.receipt.hall && done.receipt.hall.status === "won");
  }
  const seat1 = (await pool.query(`SELECT id_user FROM tb_mm_hall_seat WHERE seat = 1`)).rows[0];
  check("hall: cadeira certa depois do resultado", hWon ? seat1.id_user === ch : seat1.id_user === df, JSON.stringify({ hWon, seat1 }));
  const nt = (await pool.query(`SELECT code FROM tb_mm_notice WHERE id_user = $1 AND code LIKE 'hall_%'`, [df])).rows;
  check("hall: o defensor recebe aviso no sino", nt.length === 1 && nt[0].code === (hWon ? "hall_lost" : "hall_defended"), JSON.stringify(nt));
  const hAgain = await Hall.challenge(ch, { defender: df });
  check("hall: o mesmo defensor só 1× a cada 24 h", hAgain.code === "again", JSON.stringify(hAgain).slice(0, 200));
  const opens = [];
  for (let i = 0; i < 3; i++) {
    const other = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [other, "rival" + i, `r${i}@mm.test`]);
    await Life.peek(other);
    await pool.query(`UPDATE tb_mm_character SET power = 900 WHERE id_user = $1`, [other]);
    await pool.query(`INSERT INTO tb_mm_hall_seat (seat, id_user) VALUES ($1, $2)`, [5 + i, other]);
    opens.push(await Hall.challenge(ch, { defender: other }));
  }
  check("hall: 3 desafios por dia (o 4º recusa)", !opens[0].error && !opens[1].error && opens[2].code === "daily", JSON.stringify(opens.map((o) => o.code || "ok")));
  const sts = (await pool.query(`SELECT status FROM tb_mm_hall_challenge WHERE challenger = $1 ORDER BY created_at`, [ch])).rows.map((r) => r.status);
  check("hall: abrir outra luta fecha a anterior como derrota", sts.length === 3 && sts[1] === "lost" && sts[2] === "open", JSON.stringify(sts));
  try {
    const b = await Hall.board(ch);
    check("hall: o quadro lista as cadeiras e os limites", b.hall.length >= 4 && b.me.left === 0 && b.history.length >= 3, JSON.stringify({ seats: b.hall.length, me: b.me, h: b.history.length }));
    // Hall da Fama na Arena (mig 425): top 10 = cadeiras + vagas pelo Poder; cada posição na sua casa
    const seatAt = new Map(b.hall.map((x) => [x.seat, x.id]));
    check("hall: cada pessoa do top 10 traz a foto do perfil (ou null)", b.top.every((e) => !e.person || "photo" in e.person));
    const ghost = await require("../src/services/MeuMundoPlayerService").hallProfile(ch, crypto.randomUUID());
    check("hall: o card de perfil só abre para quem está no top 10", ghost.code === "gone", JSON.stringify(ghost));
    check("hall: top 10 com as cadeiras no lugar", b.top.length === 10 && b.top.every((e) => e.pos >= 1 && (!seatAt.has(e.pos) || (e.seated && e.person && e.person.id === seatAt.get(e.pos)))), JSON.stringify(b.top.map((e) => [e.pos, e.seated, e.person && e.person.name])));
  } catch (e) {
    check("hall: o quadro lê sem erro", false, e.message);
  }

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
