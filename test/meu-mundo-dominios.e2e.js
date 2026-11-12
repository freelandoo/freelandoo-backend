// test/meu-mundo-dominios.e2e.js — lore v2 D1: motor dos Domínios.
//
// O SERVIDOR decide tudo: o portal só abre o Domínio com o nível do treinador E a
// travessia (setor 10 do anterior vencido); o setor N só depois do N−1; o monstro e o
// nível vêm do setor; o progresso só sobe pela luta re-simulada (origem "domain"), na
// mesma transação do recibo — reenvio, abandono e derrota não abrem setor; vencer o
// setor 10 abre a passagem. Administrador passa direto (MM_ADMIN_LOCKS=1 desliga).
//
// Roda: TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/freelandoo_test npm run test:meu-mundo-dominios
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
  await pool.query(`DROP TABLE IF EXISTS tb_mm_loot_first, tb_mm_domain_pact, tb_mm_domain_progress, tb_mm_video, tb_mm_archive, tb_mm_trainer, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight, tb_mm_receipt, tb_mm_char_adventure, tb_mm_adventure, tb_mm_artifact, tb_mm_clan,
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
  // a migration roda duas vezes sem erro (idempotente)
  const mig = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/444_meu_mundo_dominios.sql"), "utf8");
  await pool.query(mig);
  await pool.query(mig);
  check("mig 444 idempotente (rodou 3×)", true);
  const mig445 = fs.readFileSync(path.join(__dirname, "../src/databases/migrations/445_meu_mundo_pacto.sql"), "utf8");
  await pool.query(mig445);
  await pool.query(mig445);
  check("mig 445 idempotente (rodou 3×)", true);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Dom = require("../src/services/MeuMundoDomainService");
  const Adv = require("../src/services/MeuMundoAdventureService");
  const Ctl = require("../src/controllers/MeuMundoController");
  const Trainer = require("../src/utils/meuMundoTrainer");
  const D = require("../src/utils/meuMundoDomains");
  const F = require("../src/utils/meuMundoFight");

  const user = async (name) => {
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO tb_user VALUES ($1, $2, $3)`, [id, name, `${name}@mm.test`]);
    await Life.peek(id);
    return id;
  };
  const setLevel = (id, L) =>
    pool.query(`INSERT INTO tb_mm_trainer (id_user, xp, level) VALUES ($1, $2, $3) ON CONFLICT (id_user) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level`, [id, Trainer.xpForLevel(L), L]);
  const setBest = (id, domain, s) =>
    pool.query(`INSERT INTO tb_mm_domain_progress (id_user, domain, best_sector) VALUES ($1, $2, $3) ON CONFLICT (id_user, domain) DO UPDATE SET best_sector = EXCLUDED.best_sector`, [id, domain, s]);
  const best = async (id, domain) => {
    const r = (await pool.query(`SELECT best_sector, wins, crossed_at FROM tb_mm_domain_progress WHERE id_user = $1 AND domain = $2`, [id, domain])).rows[0];
    return r ? { best: Number(r.best_sector), wins: Number(r.wins), crossed: !!r.crossed_at } : { best: 0, wins: 0, crossed: false };
  };
  // forte de verdade: a luta de teste termina em vitória
  const XP150 = (() => { const A = require("../src/utils/meuMundoAdventure"); let t = 0; for (let n = 1; n < 150; n++) t += Math.round(A.XP.BASE * Math.pow(n, A.XP.EXP)); return t; })();
  // S14: os deuses viraram o muro de meses (Noctis nv. 97): o forte do teste tem nível de aventura 150
  const strong = async (id) => {
    await pool.query(`UPDATE tb_mm_character SET strength = 10000, speed = 10000, intelligence = 10000, dexterity = 10000, energy = 100, stress = 0 WHERE id_user = $1 AND status = 'alive'`, [id]);
    await pool.query(`INSERT INTO tb_mm_char_adventure (id_character, id_user, xp, level) SELECT id_character, id_user, $2, 150 FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ON CONFLICT (id_character) DO UPDATE SET xp = EXCLUDED.xp, level = 150`, [id, XP150]);
  };
  const call = async (fn, id, { params = {}, body = {} } = {}) => {
    const { res, out } = fakeRes();
    await Ctl[fn]({ user: { id_user: id }, params, body }, res);
    return out;
  };
  /** Joga a luta do ticket como o aparelho (entrada quantizada) e fecha pelo servidor. */
  const play = async (id, ticket) => {
    const su = ticket.setup;
    const fight = new F.Fight({ kind: su.kind, level: su.level, hero: su.hero || undefined, peer: su.peer || undefined, tier: su.tier || undefined, body: su.body || undefined, seed: su.seed, stats: su.stats, style: su.style || undefined, gear: su.gear || undefined, temper: su.temper || undefined, affection: su.affection || undefined, boss: su.boss || undefined });
    const frames = [];
    for (let i = 0; i < 40000 && !fight.over; i++) {
      const q = F.quantizeInput({ mx: Math.sin(i / 45) * 0.5, mz: 0.85, run: false, attack: i % 9 === 0, dodge: i % 61 === 0 });
      F.pushFrame(frames, q);
      fight.step(q);
    }
    await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '30 minutes' WHERE id_fight = $1`, [ticket.ticket]);
    return { win: !!(fight.over && fight.over.win), frames, done: await Adv.fightFinish(id, { ticket: ticket.ticket, frames }) };
  };

  /**
   * D4: o chefão com fases às vezes derruba a entrada roteirizada (semente sorteada pelo servidor):
   * abre e joga de novo até vencer (no máximo 5 lutas). Derrota nunca abre setor nem pacto.
   */
  const playBoss = async (id, domain = "floresta") => {
    let last = null;
    for (let k = 0; k < 5; k++) {
      const t = (await call("fightStart", id, { body: { origin: "domain", domain, sector: 10 } })).body.fight;
      last = { ticket: t, ...(await play(id, t)) };
      if (last.win) return last;
      if (last.done.receipt && last.done.receipt.pact) throw new Error("derrota abriu pacto");
    }
    return last;
  };
  /** E12: luta o setor até vencer (no máximo 5). */
  const playWin = async (id, domain, sector) => {
    let last = null;
    for (let k = 0; k < 5; k++) {
      const t = (await call("fightStart", id, { body: { origin: "domain", domain, sector } })).body.fight;
      last = { ticket: t, ...(await play(id, t)) };
      if (last.win) return last;
    }
    return last;
  };
  const qtyOf = (rec, id) => ((rec && rec.items) || []).filter((x) => x.id === id).reduce((a, x) => a + x.qty, 0);

  // ── conta nova: nível 1 ──
  const nu = await user("mmd_novo");
  let st = await Dom.state(nu);
  check("GET /domains: os seis na ordem da travessia", st.domains.map((d) => d.id).join() === D.DOMAIN_IDS.join(), JSON.stringify(st.domains.map((d) => d.id)));
  check("nível 1: Floresta fechada pelo treinador (abre no 5)", !st.domains[0].open && st.domains[0].lock.code === "trainer" && st.domains[0].lock.level === 5, JSON.stringify(st.domains[0].lock));
  check("nível 1: Cânion fechado pela travessia", st.domains[1].lock.code === "crossing" && st.domains[1].lock.from === "floresta");
  let r = await call("domainsGet", nu);
  check("rota GET /domains responde 200 com o treinador", r.status === 200 && r.body.trainer === 1 && r.body.bypass === false && r.body.sectors === 10);
  r = await call("domainsEnter", nu, { body: { domain: "floresta" } });
  check("POST /domains/enter no nível 1 → 403 com o nível que abre", r.status === 403 && r.body.code === "closed" && r.body.level === 5, JSON.stringify(r));
  r = await call("domainsEnter", nu, { body: { domain: "atlantida" } });
  check("Domínio desconhecido → 404", r.status === 404 && r.body.code === "domain");
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 1 } });
  check("luta no setor 1 no nível 1 → 403 (o servidor recusa)", r.status === 403 && r.body.code === "closed", JSON.stringify(r));

  // ── DV1: 3 cenas de mundo aberto; a passagem abre com o chefe da cena anterior ──
  {
    const cu = await user("mmd_cenas");
    await setLevel(cu, 5);
    let q = await call("domainsEnter", cu, { body: { domain: "floresta" } });
    check("DV1: entrar sem cena = cena 1 (floresta-1, setores 1–3, chefe 3)", q.status === 200 && q.body.scene && q.body.scene.name === "floresta-1" && q.body.scene.boss === 3 && q.body.scene.sectors.join() === "1,2,3", JSON.stringify(q.body.scene));
    check("DV1: a tela manda as 3 cenas e a cena de cada setor", q.body.domain.scenes.map((c) => c.name).join() === "floresta-1,floresta-2,floresta-3" && q.body.domain.sectors.map((x) => x.scene).join() === "1,1,1,2,2,2,2,3,3,3");
    check("DV1: passagem da cena 1 fechada com o chefe de pé", q.body.domain.scenes[0].passage.open === false);
    q = await call("domainsEnter", cu, { body: { domain: "floresta", scene: 2 } });
    check("DV1: cena 2 antes do chefe da cena 1 → 403 scene (o servidor recusa)", q.status === 403 && q.body.code === "scene", JSON.stringify(q));
    await setBest(cu, "floresta", 3);
    q = await call("domainsEnter", cu, { body: { domain: "floresta", scene: 2 } });
    check("DV1: chefe da cena 1 vencido → entra na cena 2", q.status === 200 && q.body.scene.name === "floresta-2" && q.body.domain.scenes[0].passage.open === true && q.body.domain.scenes[0].cleared === true, JSON.stringify(q.body.scene));
    q = await call("domainsEnter", cu, { body: { domain: "floresta", scene: 3 } });
    check("DV1: cena 3 com o chefe da cena 2 de pé → 403", q.status === 403 && q.body.code === "scene");
    await setBest(cu, "floresta", 7);
    q = await call("domainsEnter", cu, { body: { domain: "floresta", scene: "3" } });
    check("DV1: chefe da cena 2 vencido → cena 3 (guardião 9, deus 10)", q.status === 200 && q.body.scene.name === "floresta-3" && q.body.scene.boss === 9 && q.body.scene.god === 10 && q.body.scene.passage === null);
    q = await call("domainsEnter", cu, { body: { domain: "floresta", scene: 4 } });
    check("DV1: cena que não existe → 403 scene", q.status === 403 && q.body.code === "scene");
    q = await call("domainsEnter", cu, { body: { domain: "canion", scene: 1 } });
    check("DV1: Domínio fechado continua 403 closed (antes da cena)", q.status === 403 && q.body.code === "closed");
  }

  // ── nível 5: a Floresta abre, só o setor 1 ──
  await setLevel(nu, 5);
  r = await call("domainsEnter", nu, { body: { domain: "floresta" } });
  check("nível 5: entra na Floresta", r.status === 200 && r.body.domain.id === "floresta" && r.body.domain.sectors[0].open && !r.body.domain.sectors[1].open);
  {
    const fl = r.body.domain;
    check("D2: a tela manda a criatura da lore e o corpo de cada setor", fl.sectors.map((s) => s.foe && s.foe.id).join() === "mariposa,mariposa,cervo,coruja,sonambulo,sonambulo,lobo,lobo,selene,noctis" && fl.sectors[9].foe.body === "noctis" && fl.sectors[9].foe.rig === true, JSON.stringify(fl.sectors.map((s) => s.foe)).slice(0, 200));
    check("D2: níveis calibrados na tela (2 → 7)", fl.sectors.map((s) => s.level).join() === D.LEVELS_BY_DOMAIN.floresta.join());
    check("D2: Pedraverde na cena (setor 6)", Array.isArray(fl.places) && fl.places.length === 1 && fl.places[0].id === "pedraverde" && fl.places[0].sector === 6);
  }
  r = await call("domainsEnter", nu, { body: { domain: "canion" } });
  check("nível 5: Cânion segue fechado (travessia)", r.status === 403 && r.body.need === "crossing" && r.body.code === "closed");

  // ── C5: Pedraverde e o Golem (POST /domains/place) ──
  {
    const visits = async (id, place) => Number((await pool.query(`SELECT COUNT(*)::int AS n FROM tb_mm_character_event e JOIN tb_mm_character ch ON ch.id_character = e.id_character WHERE ch.id_user = $1 AND e.kind = 'visit' AND e.data->>'place' = $2`, [id, place])).rows[0].n);
    check("C5: a tela manda o ponto do Golem dentro de Pedraverde", JSON.stringify(D.view(5, {}, false)[0].places) === JSON.stringify([{ id: "pedraverde", sector: 6, spots: ["golem"] }]));
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde" } });
    check("C5: Pedraverde com o setor 5 ainda fechado → 403 (o servidor recusa)", r.status === 403 && r.body.code === "sector", JSON.stringify(r));
    check("C5: ...e não grava a visita", (await visits(nu, "pedraverde")) === 0);
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "ninho" } });
    check("C5: lugar que não existe no Domínio → 404", r.status === 404 && r.body.code === "place");
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde", spot: "porta" } });
    check("C5: ponto que não existe no lugar → 404", r.status === 404 && r.body.code === "place");
    r = await call("domainsPlace", nu, { body: { domain: "canion", place: "pedraverde" } });
    check("C5: Pedraverde não é lugar do Cânion → 404", r.status === 404 && r.body.code === "place");
    const lone = await user("mmd_pedra_n1");
    r = await call("domainsPlace", lone, { body: { domain: "floresta", place: "pedraverde" } });
    check("C5: nível 1 → 403 com o nível que abre", r.status === 403 && r.body.code === "closed" && r.body.level === 5);

    await setBest(nu, "floresta", 5);
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde", spot: "golem" } });
    check("C5: o Golem antes de chegar à clareira → 409", r.status === 409 && r.body.code === "placeFar", JSON.stringify(r));
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde" } });
    check("C5: setor 5 vencido → chega a Pedraverde e grava visit:pedraverde", r.status === 200 && r.body.recorded === true && r.body.spot === null && (await visits(nu, "pedraverde")) === 1, JSON.stringify(r));
    await pool.query(`INSERT INTO tb_mm_equip (id_user, slot, item_id) VALUES ($1, 'weapon', 'w_test') ON CONFLICT (id_user, slot) DO UPDATE SET item_id = EXCLUDED.item_id`, [nu]);
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde", spot: "golem" } });
    check("C5: armado → o Golem manda largar o ferro e o passo não conta", r.status === 200 && r.body.armed === true && r.body.recorded === false && (await visits(nu, "golem")) === 0, JSON.stringify(r));
    await pool.query(`DELETE FROM tb_mm_equip WHERE id_user = $1 AND slot = 'weapon'`, [nu]);
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde", spot: "golem" } });
    check("C5: sem arma → grava visit:golem", r.status === 200 && r.body.armed === false && r.body.recorded === true && (await visits(nu, "golem")) === 1, JSON.stringify(r));
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde", spot: "golem" } });
    check("C5: de novo no Golem (a última visita é ele) → grava de novo", r.status === 200 && r.body.recorded === true);
    await pool.query(`UPDATE tb_mm_character_event SET at = at - INTERVAL '2 hours' WHERE kind = 'visit' AND id_character IN (SELECT id_character FROM tb_mm_character WHERE id_user = $1)`, [nu]);
    r = await call("domainsPlace", nu, { body: { domain: "floresta", place: "pedraverde", spot: "golem" } });
    check("C5: visita velha (> 1 h) → 409, precisa chegar de novo", r.status === 409 && r.body.code === "placeFar");
    await pool.query(`DELETE FROM tb_mm_domain_progress WHERE id_user = $1`, [nu]);
  }
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 2 } });
  check("setor 2 antes de vencer o 1 → 403 sector", r.status === 403 && r.body.code === "sector", JSON.stringify(r));
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 1, kind: "brute", level: 3 } });
  const t1 = r.body && r.body.fight;
  check("setor 1: o servidor escolhe monstro e nível (ignora o que o aparelho manda)", r.status === 200 && t1.setup.kind === D.kindOf("floresta", 1) && t1.setup.level === D.sectorLevel("floresta", 1), JSON.stringify(t1 && t1.setup).slice(0, 200));
  check("ticket com tier domain e o setor gravado", t1.setup.tier === "domain" && t1.setup.domain === "floresta" && t1.setup.sector === 1);
  const row = (await pool.query(`SELECT origin, setup FROM tb_mm_fight WHERE id_fight = $1`, [t1.ticket])).rows[0];
  check("tb_mm_fight: origem 'domain' (CHECK da mig 444) e setor no setup", row.origin === "domain" && row.setup.domain === "floresta" && row.setup.sector === 1);

  // abandono (abrir outra luta) não sobe o setor
  await strong(nu);
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 1 } });
  check("abrir outra luta conta a anterior como abandono", r.status === 200 && r.body.abandoned.length === 1 && r.body.abandoned[0].result.abandoned === true);
  check("abandono não abre setor", (await best(nu, "floresta")).best === 0);

  // vitória conferida: sobe o setor, recibo com o domínio
  const p1 = await play(nu, r.body.fight);
  check("a luta de teste termina em vitória", p1.win, JSON.stringify(p1.done).slice(0, 200));
  const rec = p1.done.receipt;
  check("recibo da luta do Domínio (origem, setor e progresso)", rec && rec.result.origin === "domain" && rec.result.domain === "floresta" && rec.result.sector === 1 && rec.domain && rec.domain.best === 1 && rec.domain.opened === 2, JSON.stringify(p1.done).slice(0, 300));
  check("tb_mm_domain_progress: setor 1 vencido", (await best(nu, "floresta")).best === 1);
  // E12: a vitória no setor paga pela tabela do setor (não mais a das Lâminas)
  check("E12: setor 1 paga pela tabela domain:floresta:1 (1 Pó de Lua, sem material das Lâminas)", rec.result.loot === "domain:floresta:1" && qtyOf(rec, "po_de_lua") === 1 && qtyOf(rec, "fragmento_lamina") === 0 && !rec.result.lootFirst, JSON.stringify({ loot: rec.result.loot, items: rec.items }));
  {
    const s1 = (await Dom.state(nu)).domains[0].sectors;
    check("E12: GET /domains manda a tabela de cada setor (consultável na tela)", s1.every((x) => x.loot && x.loot.table === `domain:floresta:${x.n}`) && s1[9].loot.sure.some((x) => x.id === "selo_dominio") && s1[9].loot.first.some((x) => x.id === "receita_garras_lunares") && s1[9].loot.firstDone === false && s1[7].loot.chance.some((x) => x.id === "catalisador_refino" && x.p === 0.1) && !s1[6].loot.chance.some((x) => x.id === "catalisador_refino"), JSON.stringify(s1[9].loot).slice(0, 300));
  }
  const again = await Adv.fightFinish(nu, { ticket: r.body.fight.ticket, frames: p1.frames });
  check("reenvio = o mesmo recibo, sem subir de novo", again.replay === true && again.receipt.eventId === rec.eventId);
  const b1 = await best(nu, "floresta");
  check("reenvio não conta outra vitória", b1.best === 1 && b1.wins === 1, JSON.stringify(b1));
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 2 } });
  check("setor 2 abre depois de vencer o 1", r.status === 200 && r.body.fight.setup.sector === 2);
  // gravação falsa (o "venci" do aparelho) não vale
  const fake = await Adv.fightFinish(nu, { ticket: r.body.fight.ticket, frames: [[200, 0, 127, 0]] });
  check("gravação falsa não fecha a luta nem sobe o setor", fake.code === "replay" && (await best(nu, "floresta")).best === 1, JSON.stringify(fake));
  // derrota: o mais fraco possível, sem apertar nada
  await pool.query(`UPDATE tb_mm_character SET strength = 1, speed = 1, intelligence = 1, dexterity = 1 WHERE id_user = $1 AND status = 'alive'`, [nu]);
  await pool.query(`UPDATE tb_mm_char_adventure SET xp = 0, level = 1 WHERE id_user = $1`, [nu]);
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 2 } });
  {
    const su = r.body.fight.setup;
    const fight = new F.Fight({ kind: su.kind, level: su.level, hero: su.hero || undefined, tier: su.tier || undefined, body: su.body || undefined, seed: su.seed, stats: su.stats, style: su.style || undefined, gear: su.gear || undefined, temper: su.temper || undefined, affection: su.affection || undefined });
    const frames = [];
    for (let i = 0; i < 60000 && !fight.over; i++) {
      const q = F.quantizeInput({ mx: 0, mz: 0, run: false, attack: false, dodge: false });
      F.pushFrame(frames, q);
      fight.step(q);
    }
    await pool.query(`UPDATE tb_mm_fight SET started_at = NOW() - INTERVAL '60 minutes', expires_at = NOW() + INTERVAL '5 minutes' WHERE id_fight = $1`, [r.body.fight.ticket]);
    const lost = await Adv.fightFinish(nu, { ticket: r.body.fight.ticket, frames });
    check("derrota no setor 2: recibo sem progresso", fight.over && !fight.over.win && lost.receipt && lost.receipt.result.win === false && !lost.receipt.domain, JSON.stringify(lost).slice(0, 200));
    check("E12: derrota não paga a tabela do setor (no máximo a das Lâminas)", lost.receipt && qtyOf(lost.receipt, "po_de_lua") === 0 && (lost.receipt.result.loot === undefined || lost.receipt.result.loot === "fight:laminas"), JSON.stringify(lost.receipt && { loot: lost.receipt.result.loot, items: lost.receipt.items }));
    check("derrota não abre o setor 3", (await best(nu, "floresta")).best === 1);
  }

  // ── setor 10: a travessia ──
  await strong(nu);
  await setBest(nu, "floresta", 9);
  // D4: o povo da conta (o pacto vai para ele)
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'm')`, [nu]);
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 10 } });
  check("D4: o ticket do setor 10 traz o chefão com fases (Noctis)", r.status === 200 && r.body.fight.setup.boss === "noctis", JSON.stringify(r.body.fight && r.body.fight.setup.boss));
  {
    const t = (await pool.query(`SELECT setup FROM tb_mm_fight WHERE id_fight = $1`, [r.body.fight.ticket])).rows[0];
    check("D4: o chefão fica gravado no ticket (a re-simulação lê dele)", t && t.setup.boss === "noctis");
  }
  check("setor 10 = Noctis (regra do Ciborgue, D2), nível calibrado, palco do palácio", r.status === 200 && r.body.fight.setup.kind === "ciborgue" && r.body.fight.setup.level === D.LEVELS_BY_DOMAIN.floresta[9] && D.stageOf(10) === "palacio", JSON.stringify(r.body.fight && r.body.fight.setup).slice(0, 160));
  let p10 = await play(nu, r.body.fight);
  if (!p10.win) {
    check("D4: derrota contra o chefão não abre pacto", !p10.done.receipt.pact);
    p10 = await playBoss(nu);
    r = { body: { fight: p10.ticket } };
  }
  check("vitória no setor 10 marca a travessia", p10.win && p10.done.receipt.domain && p10.done.receipt.domain.crossed === true && p10.done.receipt.domain.crossedNow === true, JSON.stringify(p10.done.receipt && p10.done.receipt.domain));
  check("crossed_at gravado", (await best(nu, "floresta")).crossed === true);
  {
    const rc = p10.done.receipt;
    check("E12: setor 10 entrega o Selo, a Seiva e os fragmentos de Garras Lunares (3 a 5 + 10 na primeira) e a receita", qtyOf(rc, "selo_dominio") === 1 && qtyOf(rc, "seiva_de_prata") === 1 && qtyOf(rc, "frag_garras_lunares") >= 13 && qtyOf(rc, "frag_garras_lunares") <= 15 && qtyOf(rc, "receita_garras_lunares") === 1 && qtyOf(rc, "po_de_lua") === 4 && rc.result.lootFirst === true, JSON.stringify({ items: rc.items, first: rc.result.lootFirst }));
    const lf = (await pool.query(`SELECT id_fight FROM tb_mm_loot_first WHERE id_user = $1 AND loot_table = 'domain:floresta:10'`, [nu])).rows;
    check("E12: tb_mm_loot_first grava a primeira vitória (mig 449)", lf.length === 1 && !!lf[0].id_fight, JSON.stringify(lf));
    check("E12: nenhum fragmento de deus no saque (A1)", !(rc.items || []).some((x) => x.id.startsWith("frag_deus")));
    check("E12: a tela marca a primeira vitória do setor 10 como paga", (await Dom.state(nu)).domains[0].sectors[9].loot.firstDone === true);
  }
  // D4: o pacto de 7 dias para as Raposas no Rolê Noturno (jogável de Noctis)
  {
    const pact = p10.done.receipt.pact;
    check("D4: vitória sobre o chefão abre o pacto do povo", pact && pact.fresh === true && pact.clan === "raposa" && pact.domain === "floresta" && pact.god === "noctis" && pact.game === "noturno", JSON.stringify(pact));
    check("D4: o pacto dura 7 dias", pact && Date.parse(pact.endsAt) - Date.parse(pact.startsAt) === 7 * 24 * 3600 * 1000);
    const again = await Adv.fightFinish(nu, { ticket: r.body.fight.ticket, frames: p10.frames });
    check("D4: reenvio do mesmo ticket não abre outro pacto", again.replay === true && Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_domain_pact`)).rows[0].count) === 1);
    st = await Dom.state(nu);
    check("D4: GET /domains mostra o pacto de pé", st.pacts.length === 1 && st.pacts[0].clan === "raposa" && st.pacts[0].game === "noturno", JSON.stringify(st.pacts));
    // outra Raposa vence enquanto o pacto está de pé: não estica
    const r2 = await user("mmd_raposa2");
    await setLevel(r2, 5);
    await strong(r2);
    await setBest(r2, "floresta", 9);
    await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'f')`, [r2]);
    const q2 = await playBoss(r2);
    check("D4: outra vitória do mesmo povo com pacto de pé não estica", q2.win && q2.done.receipt.pact && q2.done.receipt.pact.fresh === false && q2.done.receipt.pact.endsAt === pact.endsAt, JSON.stringify(q2.done.receipt.pact));
    // um Vampiro vence: o outro povo ganha o seu pacto
    const v = await user("mmd_vamp");
    await setLevel(v, 5);
    await strong(v);
    await setBest(v, "floresta", 9);
    await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm')`, [v]);
    const qv = await playBoss(v);
    check("D4: os dois povos podem ter pacto com o mesmo deus", qv.win && qv.done.receipt.pact && qv.done.receipt.pact.fresh === true && qv.done.receipt.pact.clan === "vampiro");
    check("D4: dois pactos gravados (um por povo)", Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_domain_pact`)).rows[0].count) === 2);
    // derrota contra o chefão não abre pacto; setor que não é o 10 também não
    const sem = await user("mmd_semclan");
    await setLevel(sem, 5);
    await strong(sem);
    await setBest(sem, "floresta", 9);
    const qs = await playBoss(sem);
    check("D4: conta sem povo vence e não abre pacto", qs.win && !qs.done.receipt.pact, JSON.stringify({ win: qs.win, pact: qs.done.receipt && qs.done.receipt.pact, clan: (await pool.query(`SELECT clan FROM tb_mm_clan WHERE id_user = $1`, [sem])).rows }));
  }
  st = await Dom.state(nu);
  check("nível 5 atravessou: a passagem existe, mas o Cânion pede o nível 9", st.domains[0].passage && st.domains[0].passage.to === "canion" && st.domains[0].passage.open === false && st.domains[1].lock.code === "trainer" && st.domains[1].lock.level === 9, JSON.stringify(st.domains[1].lock));
  await setLevel(nu, 9);
  r = await call("domainsEnter", nu, { body: { domain: "canion" } });
  check("nível 9 e Floresta atravessada: entra no Cânion", r.status === 200 && r.body.domain.id === "canion");
  r = await call("domainsEnter", nu, { body: { domain: "floresta" } });
  check("quem atravessou volta direto ao começo da Floresta", r.status === 200 && r.body.domain.sectors.every((s) => s.open));
  r = await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 3 } });
  check("setor vencido fica livre para lutar de novo", r.status === 200);
  check("D4: setor que não é o 10 não tem chefão", r.body.fight.setup.boss === null);
  r = await call("domainsEnter", nu, { body: { domain: "gelo" } });
  check("Mar de Gelo segue fechado (o Cânion não foi atravessado)", r.status === 403 && r.body.need === "crossing");
  // um setor mais baixo vencido depois não desce o progresso
  const p3 = await play(nu, (await call("fightStart", nu, { body: { origin: "domain", domain: "floresta", sector: 3 } })).body.fight);
  check("vencer um setor antigo não desce o progresso", p3.win && p3.done.receipt.domain.best === 10 && p3.done.receipt.domain.opened === null);
  // E12: o chefão de novo — sem bônus da primeira; o setor 7 paga o projeto da Vigília uma vez
  {
    const b2 = await playBoss(nu);
    const rc = b2.done.receipt;
    check("E12: segunda vitória no 10: 3 a 5 fragmentos e o Selo, sem receita", b2.win && qtyOf(rc, "selo_dominio") === 1 && qtyOf(rc, "frag_garras_lunares") >= 3 && qtyOf(rc, "frag_garras_lunares") <= 5 && qtyOf(rc, "receita_garras_lunares") === 0 && !rc.result.lootFirst, JSON.stringify({ win: b2.win, items: rc && rc.items }));
    const s7 = await playWin(nu, "floresta", 7);
    check("E12: primeira vitória no setor 7 dá o projeto da Vigília e 2 a 3 fragmentos do conjunto", s7.win && qtyOf(s7.done.receipt, "projeto_vigilia") === 1 && qtyOf(s7.done.receipt, "frag_vigilia") >= 2 && qtyOf(s7.done.receipt, "frag_vigilia") <= 3 && qtyOf(s7.done.receipt, "po_de_lua") === 3, JSON.stringify({ win: s7.win, items: s7.done.receipt && s7.done.receipt.items }));
    const s7b = await playWin(nu, "floresta", 7);
    check("E12: a segunda vitória no 7 não repete o projeto", s7b.win && qtyOf(s7b.done.receipt, "projeto_vigilia") === 0 && qtyOf(s7b.done.receipt, "frag_vigilia") >= 2, JSON.stringify(s7b.done.receipt && s7b.done.receipt.items));
    const again = await Adv.fightFinish(nu, { ticket: s7.ticket.ticket, frames: s7.frames });
    check("E12: reenvio do ticket não paga de novo", again.replay === true && Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_loot_first WHERE id_user = $1`, [nu])).rows[0].count) === 2);
  }

  // ── D5: o Cânion das Tempestades (a conta é Raposa, nível 9, Floresta atravessada) ──
  {
    r = await call("domainsEnter", nu, { body: { domain: "canion" } });
    const cn = r.body.domain;
    check("D5: a tela do Cânion manda as criaturas da lore", cn.sectors.map((s) => s.foe && s.foe.id).join() === "abutre,abutre,chacal,mensageiro,mensageiro,escorpiao,harpia,harpia,carta,zephyra" && cn.sectors[9].foe.body === "zephyra" && cn.sectors[9].foe.rig === true, JSON.stringify(cn.sectors.map((s) => s.foe && s.foe.id)));
    check("D5: níveis calibrados na tela (5 → 12) e só o 1 aberto", cn.sectors.map((s) => s.level).join() === D.LEVELS_BY_DOMAIN.canion.join() && cn.sectors[0].open && !cn.sectors[1].open);
    check("D5: Zéphyra é o chefão do setor 10 (tela)", cn.sectors[9].boss === "zephyra" && cn.sectors.slice(0, 9).every((s) => s.boss === null));
    r = await call("fightStart", nu, { body: { origin: "domain", domain: "canion", sector: 2 } });
    check("D5: setor 2 fechado antes do 1", r.status === 403);
    r = await call("fightStart", nu, { body: { origin: "domain", domain: "canion", sector: 1 } });
    check("D5: setor 1 = Abutres (regra do Cavaleiro) no nível calibrado, sem chefão", r.status === 200 && r.body.fight.setup.kind === "cavaleiro" && r.body.fight.setup.level === D.LEVELS_BY_DOMAIN.canion[0] && r.body.fight.setup.boss === null, JSON.stringify(r.body.fight && r.body.fight.setup).slice(0, 160));
    const c1 = await play(nu, r.body.fight);
    check("D5: vencer o setor 1 do Cânion abre o 2", c1.win && c1.done.receipt.domain && c1.done.receipt.domain.domain === "canion" && (await best(nu, "canion")).best === 1, JSON.stringify(c1.done.receipt && c1.done.receipt.domain));
    await setBest(nu, "canion", 9);
    r = await call("fightStart", nu, { body: { origin: "domain", domain: "canion", sector: 10 } });
    check("D5: o ticket do setor 10 traz Zéphyra com fases (regra do Cavaleiro, nível 12)", r.status === 200 && r.body.fight.setup.boss === "zephyra" && r.body.fight.setup.kind === "cavaleiro" && r.body.fight.setup.level === D.LEVELS_BY_DOMAIN.canion[9], JSON.stringify(r.body.fight && r.body.fight.setup).slice(0, 160));
    let z = await play(nu, r.body.fight);
    if (!z.win) z = await playBoss(nu, "canion");
    check("D5: vencer Zéphyra atravessa o Cânion", z.win && z.done.receipt.domain && z.done.receipt.domain.crossedNow === true && (await best(nu, "canion")).crossed === true, JSON.stringify(z.done.receipt && z.done.receipt.domain));
    const pact = z.done.receipt.pact;
    check("D5: pacto de Zéphyra para as Raposas na Antigravidade (corrida)", pact && pact.fresh === true && pact.domain === "canion" && pact.god === "zephyra" && pact.game === "corrida" && pact.clan === "raposa", JSON.stringify(pact));
    st = await Dom.state(nu);
    check("D5: atravessou o Cânion — a passagem leva ao Mar de Gelo (que pede o nível 13)", st.domains[1].passage && st.domains[1].passage.to === "gelo" && st.domains[2].lock.code === "trainer" && st.domains[2].lock.level === 13, JSON.stringify(st.domains[2].lock));
  }

  // ── administrador passa direto ──
  const adm = await user("mmd_admin");
  await pool.query(`INSERT INTO tb_user_role (id_user, id_role) SELECT $1, id_role FROM tb_role WHERE desc_role = 'Administrator'`, [adm]);
  st = await Dom.state(adm);
  check("admin no nível 1: os seis abertos, todos os setores", st.bypass === true && st.domains.every((d) => d.open && d.sectors.every((s) => s.open)));
  r = await call("fightStart", adm, { body: { origin: "domain", domain: "orbital", sector: 10 } });
  check("admin luta no setor 10 da Orbital", r.status === 200 && r.body.fight.setup.level === D.sectorLevel("orbital", 10));
  process.env.MM_ADMIN_LOCKS = "1";
  r = await call("domainsEnter", adm, { body: { domain: "floresta" } });
  check("MM_ADMIN_LOCKS=1: o admin vê a trava", r.status === 403 && r.body.level === 5);
  delete process.env.MM_ADMIN_LOCKS;

  // ── as outras lutas seguem iguais ──
  // (a Arena abre no nível 10 pela trava do prédio: aqui direto no serviço)
  const tr = await Adv.fightStart(nu, { origin: "laminas", kind: "cavaleiro" });
  check("luta de treino sem domain no ticket", tr.fight && tr.fight.setup.domain === null && tr.fight.setup.tier === "arena", JSON.stringify(tr).slice(0, 200));

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
