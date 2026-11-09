// test/meu-mundo-personagens.e2e.js — MEU MUNDO 3D B3 (mig 340): personagens no lugar das
// skins. Conversão das skins em personagens (idempotente), cápsula (trocar congela e
// descongela), vagas, fusão de dois adultos e o certificado público.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/b3 npm run test:meu-mundo-personagens
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

const MIG = path.join(__dirname, "../src/databases/migrations");

async function bootstrap(pool) {
  await pool.query(`DROP TABLE IF EXISTS tb_mm_genetics, tb_mm_character_grant, tb_mm_character_owner, tb_mm_player, tb_mm_refine_proposal, tb_mm_gear_unlock, tb_mm_quest, tb_mm_equip, tb_mm_gear, tb_mm_fight,
                    tb_mm_receipt, tb_mm_adventure, tb_mm_artifact, tb_mm_clan, tb_mm_car_paint_owned, tb_mm_consume_key, tb_mm_pantry, tb_mm_skin_owned,
                    tb_mm_character_event, tb_mm_character_day, tb_mm_character, tb_mm_wallet, tb_mm_notice, tb_mm_mail, tb_mm_visit, tb_mm_avatar_pref,
                    tb_mm_residence, tb_mm_house, tb_mm_lot, tb_mm_neighborhood, tb_profile, tb_user_role, tb_role, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT, is_minor BOOLEAN NOT NULL DEFAULT FALSE)`);
  await pool.query(`CREATE TABLE tb_profile (id_profile UUID PRIMARY KEY DEFAULT gen_random_uuid(), id_user UUID, display_name TEXT,
                    avatar_url TEXT, is_user_account BOOLEAN DEFAULT FALSE, deleted_at TIMESTAMPTZ NULL)`);
  await pool.query(`CREATE TABLE tb_role (id_role SERIAL PRIMARY KEY, desc_role TEXT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`CREATE TABLE tb_user_role (id_user UUID, id_role INT, is_active BOOLEAN DEFAULT TRUE)`);
  await pool.query(`INSERT INTO tb_role (desc_role) VALUES ('Administrator')`);
  await require("./helpers/mmPolens").polenTables(pool);
  const all = fs
    .readdirSync(MIG)
    .filter((f) => /^\d{3}_meu_mundo/.test(f) && Number(f.slice(0, 3)) >= 291 && !/^(303|312)_/.test(f))
    .sort();
  for (const f of all) await pool.query(fs.readFileSync(path.join(MIG, f), "utf8"));
}

async function main() {
  const pool = require("../src/databases");
  await bootstrap(pool);
  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Chars = require("../src/services/MeuMundoCharacterService");

  const A = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'ana', 'ana@mm.test', FALSE)`, [A]);
  await pool.query(`INSERT INTO tb_user_role (id_user, id_role) VALUES ($1, 1)`, [A]);
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'raposa', 'f') ON CONFLICT DO NOTHING`, [A]);

  // ── conversão das skins: quem tinha skin ganha o personagem (idempotente)
  await Life.peek(A);
  await pool.query(`INSERT INTO tb_mm_skin_owned (id_user, skin) VALUES ($1, 'aurion'), ($1, 'vampira-adulta'), ($1, 'feminina') ON CONFLICT DO NOTHING`, [A]);
  const m340 = fs.readFileSync(path.join(MIG, "340_meu_mundo_personagens.sql"), "utf8");
  await pool.query(m340);
  await pool.query(m340); // de novo: não duplica
  const l0 = await Chars.list(A);
  const caps = l0.characters.list.filter((c) => c.status === "capsule");
  check("skins viram personagens na cápsula (feminina fica de fora)", caps.length === 2 && caps.some((c) => c.species === "aurion") && caps.some((c) => c.species === "vampiro" && c.sex === "f"), JSON.stringify(caps.map((c) => [c.species, c.sex])));
  check("o hóspede de antes é o ativo", l0.characters.list[0].status === "alive" && l0.characters.list[0].species === "raposa");
  check("vagas: 2 de 5", l0.characters.capsule.used === 2 && l0.characters.capsule.slots === 5);
  check("nasce com 1 m", caps.every((c) => c.height === 1), JSON.stringify(caps.map((c) => c.height)));
  check("número de série e código do certificado", caps.every((c) => /^MM-\d{6}$/.test(c.serialText) && /^[0-9a-f]{12}$/.test(c.certCode)));

  // ── trocar: o ativo congela, o outro descongela
  const active0 = l0.characters.list[0];
  const aur = caps.find((c) => c.species === "aurion");
  await pool.query(`UPDATE tb_mm_character SET strength = 400 WHERE id_character = $1`, [active0.id]);
  // nível POR PERSONAGEM (mig 435): o ativo sobe, o outro começa do 1
  const AdvStore = require("../src/storages/MeuMundoAdventureStorage");
  const AdvRule = require("../src/utils/meuMundoAdventure");
  {
    const c0 = await pool.connect();
    try {
      await AdvStore.lockAdventure(c0, A);
      await AdvStore.saveAdventure(c0, A, { xp: 50000, level: AdvRule.levelOf(50000).level, losses: 0, lossesDay: null });
    } finally {
      c0.release();
    }
  }
  const lvHigh = AdvRule.levelOf(Number((await AdvStore.getAdventure(pool, A)).xp)).level;
  const sw = await Chars.use(A, aur.id);
  const lvNew = AdvRule.levelOf(Number((await AdvStore.getAdventure(pool, A)).xp)).level;
  check("nível: o personagem trocado começa do nível 1", lvHigh > 1 && lvNew === 1, `${lvHigh} → ${lvNew}`);
  check("troca: Aurion vira o ativo", !sw.error && sw.characters.list[0].id === aur.id && sw.characters.list[0].status === "alive", JSON.stringify(sw.error || sw.swapped));
  check("troca: o antigo vai para a cápsula", sw.characters.list.some((c) => c.id === active0.id && c.status === "capsule"));
  const alive = Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`, [A])).rows[0].count);
  check("um vivo por pessoa", alive === 1);
  // 30 dias guardado não muda nada
  await pool.query(`UPDATE tb_mm_character SET sim_at = sim_at - INTERVAL '30 days', frozen_at = frozen_at - INTERVAL '30 days' WHERE id_character = $1`, [active0.id]);
  const back = await Chars.use(A, active0.id);
  const r0 = back.characters.list.find((c) => c.id === active0.id);
  check("volta da cápsula com o mesmo atributo (congelado não perde)", r0 && r0.status === "alive" && r0.attrs.strength === 400, JSON.stringify(r0 && r0.attrs));
  check("volta da cápsula com a mesma idade ativa", r0 && r0.activeDays === active0.activeDays, `${r0 && r0.activeDays} vs ${active0.activeDays}`);
  check("nível: quem volta da cápsula volta com o nível dele", AdvRule.levelOf(Number((await AdvStore.getAdventure(pool, A)).xp)).level === lvHigh);
  check("trocar com quem não está na cápsula é recusado", (await Chars.use(A, active0.id)).code === "notCapsule");

  // ── vagas: até 5 na cápsula pelo grant de teste
  for (let i = 0; i < 4; i++) await Chars.testGrant(A, { species: "golem" });
  const full = await Chars.testGrant(A, { species: "golem" });
  check("cápsula cheia recusa (5 vagas)", full.code === "full", JSON.stringify(full));

  // ── fusão (mistura): só adultos; 20% do maior pico; espécie SORTEADA entre as dos pais
  const notAdult = await Chars.fuse(A, { a: active0.id, b: aur.id });
  check("fusão de jovens é recusada", notAdult.code === "adult", JSON.stringify(notAdult));
  const adult = JSON.stringify({ stage: "adult", from: Date.now() - 100 * 86400000, at: Date.now() - 50 * 86400000 });
  await pool.query(`UPDATE tb_mm_character SET growth = $2::jsonb WHERE id_character = ANY($1::uuid[])`, [[active0.id, aur.id], adult]);
  await pool.query(`UPDATE tb_mm_character SET intelligence = 900, attr_peaks = attr_peaks || '{"intelligence": 900}'::jsonb WHERE id_character = $1`, [aur.id]);
  check("mistura sem o segundo é recusada", (await Chars.fuse(A, { a: active0.id })).code === "pair");
  check("mistura com dois segundos é recusada", (await Chars.fuse(A, { a: active0.id, b: aur.id, gene: aur.id })).code === "pair");
  await pool.query(`UPDATE tb_mm_character SET power = 300 WHERE id_character = $1`, [aur.id]);
  await pool.query(`UPDATE tb_mm_character SET power = 100 WHERE id_character = $1`, [active0.id]);
  const fz = await Chars.fuse(A, { a: active0.id, b: aur.id });
  check("mistura gera o filho de uma das duas espécies", !fz.error && fz.fused && ["aurion", "raposa"].includes(fz.fused.species), JSON.stringify(fz.error || fz.fused));
  check("chance mostrada = a da regra (Poder 100 × 300)", fz.fused && fz.fused.chance === (fz.fused.drawn === "a" ? 0.25 : 0.75), JSON.stringify(fz.fused && [fz.fused.drawn, fz.fused.chance]));
  check("filho herda 20% do maior pico", fz.fused && fz.fused.inherited.intelligence === 180 && fz.fused.inherited.strength === 80, JSON.stringify(fz.fused && fz.fused.inherited));
  const kids = fz.characters ? fz.characters.list : [];
  const kid = kids.find((c) => c.id === fz.fused.child);
  check("o ativo era pai: o filho vira o ativo, com 1 m", kid && kid.status === "alive" && kid.height === 1 && kid.lineage === 2, JSON.stringify(kid && [kid.status, kid.height, kid.lineage]));
  const fused = (await pool.query(`SELECT status FROM tb_mm_character WHERE id_character = ANY($1::uuid[])`, [[active0.id, aur.id]])).rows;
  check("os pais ficam como histórico (fused)", fused.length === 2 && fused.every((r) => r.status === "fused"));

  // ── certificado público
  const cert = await Chars.certificate(kid.certCode);
  const c = cert.certificate;
  check("certificado: série, espécie, genética e pais", c && c.serialText === kid.serialText && c.species === "aurion" && c.genetics && c.genetics.seed > 0 && c.parents.length === 2, JSON.stringify(c && { s: c.serialText, p: c.parents.length }));
  const mx = c && c.genetics && c.genetics.mix;
  check("certidão da mistura: contagem, chances, mais forte e de quem veio", mx && mx.count === 1 && mx.odds.a === 0.25 && mx.odds.b === 0.75 && mx.stronger === "b" && mx.inheritFrom.intelligence === "b" && mx.a.kind === "character" && mx.b.serialText === aur.serialText && mx.temper.from === "b", JSON.stringify(mx));
  check("certificado sem dados do dono além do apelido", c && !("id_user" in c) && !("email" in c) && !JSON.stringify(cert).includes(A));
  check("código inválido = não encontrado", (await Chars.certificate("zzz")).code === "notFound");

  // ── B12: Laboratório de Criogenia — embrião e acelerador
  const B = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'bia', 'bia@mm.test', FALSE)`, [B]);
  await pool.query(`INSERT INTO tb_mm_clan (id_user, clan, sex) VALUES ($1, 'vampiro', 'm') ON CONFLICT DO NOTHING`, [B]);
  await Life.peek(B);
  const bal = async () => Number((await pool.query(`SELECT balance FROM emerald_wallets WHERE user_id = $1`, [B])).rows[0]?.balance ?? 0);
  const lb = await Chars.list(B);
  const lab = lb.characters.lab;
  check("laboratório: preço do embrião por espécie", lab && lab.embryos.find((e) => e.species === "raposa").price === 10000 && lab.embryos.find((e) => e.species === "aurion").price === 900000 && !lab.free && lab.accelPrice === 5000, JSON.stringify(lab && lab.embryos.slice(0, 3)));
  await pool.query(`UPDATE emerald_wallets SET balance = 0 WHERE user_id = $1`, [B]);
  const poor = await Chars.buyEmbryo(B, { species: "raposa", sex: "f", key: "pedido-0001" });
  check("embrião sem Esmeralda é recusado", poor.code === "coins" || /Moedas/.test(poor.error || ""), JSON.stringify(poor));
  const nGrant0 = Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_character_grant WHERE id_user = $1`, [B])).rows[0].count);
  check("recusa não deixa grant", nGrant0 === 0, String(nGrant0));
  await pool.query(`UPDATE emerald_wallets SET balance = 20000 WHERE user_id = $1`, [B]);
  const buy = await Chars.buyEmbryo(B, { species: "raposa", sex: "f", key: "pedido-0002" });
  const emb = buy.characters && buy.characters.list.find((c) => c.id === (buy.granted || [])[0]);
  check("embrião comprado entra na cápsula com 1 m e 0 dia", !buy.error && emb && emb.status === "capsule" && emb.height === 1 && emb.activeDays === 0 && emb.origin === "lab" && emb.species === "raposa" && emb.sex === "f", JSON.stringify(buy.error || emb));
  check("cobrou 10.000 Esmeralda", (await bal()) === 10000, String(await bal()));
  const again = await Chars.buyEmbryo(B, { species: "raposa", sex: "f", key: "pedido-0002" });
  check("mesmo pedido de novo não compra duas vezes", !again.error && again.repeat === true && (await bal()) === 10000 && again.characters.capsule.used === 1, JSON.stringify(again.error || again.repeat) + " " + (await bal()));
  check("embrião aceita o acelerador", emb && emb.canAccel === true);
  const acc = await Chars.accelerate(B, emb.id);
  const embA = acc.characters && acc.characters.list.find((c) => c.id === emb.id);
  check("acelerador: 15 anos (fase de jovem completa) na cápsula", !acc.error && embA && embA.activeDays === 30 && embA.height === 1.65 && embA.canAccel === false, JSON.stringify(acc.error || (embA && [embA.activeDays, embA.height])));
  check("acelerador cobrou 5.000", (await bal()) === 5000, String(await bal()));
  check("acelerar de novo é recusado", (await Chars.accelerate(B, emb.id)).code === "accel");
  const buy2 = await Chars.buyEmbryo(B, { species: "vampiro", key: "pedido-0003" });
  check("sem saldo para o segundo embrião", buy2.code === "coins", JSON.stringify(buy2));
  await pool.query(`UPDATE emerald_wallets SET balance = 20000 WHERE user_id = $1`, [B]);
  const buy3 = await Chars.buyEmbryo(B, { species: "vampiro", key: "pedido-0004" });
  const id3 = (buy3.granted || [])[0];
  const sw3 = await Chars.use(B, id3);
  check("embrião vira o ativo pela troca", !sw3.error, JSON.stringify(sw3.error));
  const acc2 = await Chars.accelerate(B, id3);
  const act = acc2.characters && acc2.characters.list.find((c) => c.id === id3);
  check("acelerador no ativo: vira jovem de 15 anos", !acc2.error && act && act.status === "alive" && act.activeDays === 30 && act.height === 1.7, JSON.stringify(acc2.error || (act && [act.status, act.activeDays, act.height])));
  const evs = Number((await pool.query(`SELECT COUNT(*) FROM tb_mm_character_event WHERE kind = 'accelerated'`)).rows[0].count);
  check("evento 'accelerated' gravado nos dois", evs === 2, String(evs));
  // ── genética (09/11): compra, guarda e mistura com um adulto
  await pool.query(`UPDATE emerald_wallets SET balance = 5000 WHERE user_id = $1`, [B]);
  const lg = (await Chars.list(B)).characters.lab;
  check("genética à venda: metade do embrião", lg.genes.find((g) => g.species === "raposa").price === 5000 && lg.genes.find((g) => g.species === "aurion").price === 450000 && lg.mutation === 0.15, JSON.stringify(lg.genes.slice(0, 2)));
  check("genética cara sem saldo é recusada", (await Chars.buyGenetics(B, { species: "aurion", key: "gene-0001" })).code === "coins");
  const g1 = await Chars.buyGenetics(B, { species: "raposa", sex: "f", key: "gene-0002" });
  check("genética comprada fica guardada", !g1.error && g1.gene && g1.characters.genetics.length === 1 && g1.characters.genetics[0].species === "raposa" && (await bal()) === 0, JSON.stringify(g1.error || g1.characters.genetics));
  const g1b = await Chars.buyGenetics(B, { species: "raposa", sex: "f", key: "gene-0002" });
  check("mesmo pedido da genética não compra duas vezes", !g1b.error && g1b.repeat === true && g1b.characters.genetics.length === 1);
  check("genética com jovem é recusada", (await Chars.fuse(B, { a: id3, gene: g1.gene })).code === "adult");
  await pool.query(`UPDATE tb_mm_character SET growth = $2::jsonb, power = 450, strength = 500, attr_peaks = attr_peaks || '{"strength": 500}'::jsonb WHERE id_character = $1`, [id3, adult]);
  const fg = await Chars.fuse(B, { a: id3, gene: g1.gene });
  check("mistura com genética gera o filho", !fg.error && fg.fused && ["vampiro", "raposa"].includes(fg.fused.species) && fg.fused.active === true, JSON.stringify(fg.error || fg.fused));
  check("chance da genética pelo Poder (450 × 150)", fg.fused && fg.fused.chance === (fg.fused.drawn === "a" ? 0.75 : 0.25), JSON.stringify(fg.fused && [fg.fused.drawn, fg.fused.chance]));
  check("filho herda 20% da força do pai (a genética não tem atributo)", fg.fused && fg.fused.inherited.strength === 100, JSON.stringify(fg.fused && fg.fused.inherited));
  check("a genética foi usada", fg.characters && fg.characters.genetics.length === 0);
  check("genética usada não mistura de novo", (await Chars.fuse(B, { a: fg.fused.child, gene: g1.gene })).code !== undefined);
  const cg = (await Chars.certificate(fg.fused.certCode)).certificate;
  check("certidão: o outro lado é a genética", cg && cg.genetics.mix.b.kind === "genetics" && cg.genetics.mix.b.species === "raposa" && cg.genetics.mix.stronger === "a" && cg.parents.length === 1, JSON.stringify(cg && cg.genetics.mix));
  check("admin compra de graça", (await Chars.list(A)).characters.lab.free === true && (await Chars.list(A)).characters.lab.embryos[0].price === 0);

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
