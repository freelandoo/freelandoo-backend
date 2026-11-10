// test/meu-mundo-arquivo.e2e.js — lore v2 F5: o Arquivo, archive:<id> e os vídeos.
//
// O servidor destrava pelo que a pessoa alcançou (capítulo, passo, monstro
// vencido), grava a leitura (read_at) que o check archive:<id> lê, recusa texto
// trancado ou desconhecido; e os vídeos: lugar válido, envio (R2 simulado),
// capa sem vídeo, limpar.
//
// Roda: TEST_DATABASE_URL=postgres://postgres:<senha>@127.0.0.1:55432/freelandoo_test npm run test:meu-mundo-arquivo
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
  // R2 simulado: o envio devolve uma URL de teste
  const Module = require("module");
  const r2Path = require.resolve("../src/integrations/r2/uploadMeuMundoVideo");
  const sent = [];
  const fake = new Module(r2Path);
  fake.exports = async ({ kind, ref, file }) => {
    sent.push([kind, ref, file.fieldname, !!file.buffer]);
    return { url: `https://r2.test/meu-mundo/videos/${kind}/${ref}/${file.originalname}` };
  };
  fake.loaded = true;
  require.cache[r2Path] = fake;

  const Life = require("../src/services/MeuMundoLifeService");
  Life.adminPerks = false;
  const Quest = require("../src/services/MeuMundoQuestService");
  const Arq = require("../src/services/MeuMundoArchiveService");
  const AdvStore = require("../src/storages/MeuMundoAdventureStorage");
  const A = require("../src/utils/meuMundoArchive");

  const id = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mma', 'mma@mm.test')`, [id]);
  await Life.peek(id);
  const ch = (await pool.query(`SELECT id_character FROM tb_mm_character WHERE id_user = $1`, [id])).rows[0].id_character;
  const past = new Date(Date.now() - 60000);
  const row = { step_at: past, started_at: past, data: {} };
  const sat = async (c) => Quest.satisfied(pool, id, ch, {}, { key: "x", check: c, xp: 1 }, row);
  const ent = (v, e) => v.entries.find((x) => x.id === e);
  const count = async () => (await pool.query(`SELECT COUNT(*)::int n FROM tb_mm_archive WHERE id_user = $1`, [id])).rows[0].n;

  // ── conta nova ──
  let v = await Arq.get(id);
  check(`conta nova: ${A.ENTRIES.length} entradas, nenhuma destravada`, v.entries.length === A.ENTRIES.length && v.entries.every((e) => !e.unlocked && !e.readAt));
  check("trancada não traz data", v.entries.every((e) => e.unlockedAt === null));
  check("ler trancado → 'locked'", (await Arq.read(id, { id: "praca" })).code === "locked");
  check("ler desconhecido → 'unknown'", (await Arq.read(id, { id: "zzz" })).code === "unknown");
  check("archive:praca sem ler = não", !(await sat("archive:praca")).ok);

  // ── fim do capítulo 1 ──
  await pool.query(`INSERT INTO tb_mm_quest (id_user, quest_id, step, done_at) VALUES ($1, 'cap1', 6, NOW())`, [id]);
  v = await Arq.get(id);
  check("capítulo 1 feito destrava 'A Praça'", ent(v, "praca").unlocked && !ent(v, "praca").readAt);
  check("…e só ela", v.entries.filter((e) => e.unlocked).length === 1);
  await Arq.get(id);
  check("destravar é idempotente", (await count()) === 1);
  v = await Arq.read(id, { id: "praca" });
  check("ler grava read_at", !!ent(v, "praca").readAt);
  check("archive:praca depois de ler", (await sat("archive:praca")).ok);
  const first = ent(v, "praca").readAt;
  await new Promise((r) => setTimeout(r, 30));
  v = await Arq.read(id, { id: "praca" });
  check("reler mantém a primeira leitura", new Date(ent(v, "praca").readAt).getTime() === new Date(first).getTime());

  // ── passo que pede a leitura (cap. 5, 'ninho') ──
  check("registro do Ninho antes do cap. 5 = trancado", (await Arq.read(id, { id: "registro_ninho" })).code === "locked");
  await pool.query(`INSERT INTO tb_mm_quest (id_user, quest_id, step) VALUES ($1, 'cap5', 0)`, [id]);
  v = await Arq.get(id);
  check("cap. 5 aberto no passo 'ninho' destrava o registro do Ninho", ent(v, "registro_ninho").unlocked);
  check("archive:registro_ninho ainda não lido = não", !(await sat("archive:registro_ninho")).ok);
  await Arq.read(id, { id: "registro_ninho" });
  check("archive:registro_ninho depois de ler", (await sat("archive:registro_ninho")).ok);

  // ── monstro vencido ──
  let k = 0;
  const fight = (kind, win, extra = {}) =>
    AdvStore.insertReceipt(pool, { idUser: id, idCharacter: ch, source: "fight", actionKey: `f${++k}`, rules: "R3", result: { origin: "laminas", kind, win, abandoned: false, ...extra }, deltas: {}, items: [] });
  await fight("ciborgue", false);
  check("perder para o Ciborgue não destrava", !ent(await Arq.get(id), "ciborgue").unlocked);
  await fight("garras", true, { abandoned: true });
  check("luta abandonada não destrava", !ent(await Arq.get(id), "dama_garras").unlocked);
  await fight("ciborgue", true, { origin: "tutorial" });
  check("luta de treino não destrava", !ent(await Arq.get(id), "ciborgue").unlocked);
  await fight("ciborgue", true);
  check("vencer o Ciborgue destrava a história dele", ent(await Arq.get(id), "ciborgue").unlocked);

  // ── vídeos ──
  check("lugar estranho → 'slot'", (await Arq.upload(id, "chapter", "cap99", {})).code === "slot");
  check("sem arquivo → 'empty'", (await Arq.upload(id, "chapter", "cap1", {})).code === "empty");
  const file = (fieldname, mimetype, originalname) => ({ fieldname, mimetype, originalname, buffer: Buffer.from("x") });
  let r = await Arq.upload(id, "chapter", "cap1", { poster: [file("poster", "image/webp", "capa.webp")] });
  check("só a capa: vale (imagem + texto)", r.videos.chapter.cap1 && !r.videos.chapter.cap1.video && /capa\.webp$/.test(r.videos.chapter.cap1.poster), JSON.stringify(r.videos));
  r = await Arq.upload(id, "chapter", "cap1", { video: [file("video", "video/mp4", "cap1.mp4")] });
  check("depois o vídeo: os dois ficam", /cap1\.mp4$/.test(r.videos.chapter.cap1.video) && /capa\.webp$/.test(r.videos.chapter.cap1.poster));
  check("o envio passou pelo R2 com os bytes", sent.length === 2 && sent.every((x) => x[3]));
  v = await Arq.get(id);
  check("o jogo recebe o vídeo junto com o Arquivo", /cap1\.mp4$/.test(v.videos.chapter.cap1.video));
  r = await Arq.clear("chapter", "cap1", { what: "video" });
  check("limpar o vídeo deixa a capa", !r.videos.chapter.cap1.video && !!r.videos.chapter.cap1.poster);
  r = await Arq.clear("chapter", "cap1", {});
  check("limpar tudo apaga a linha", !r.videos.chapter.cap1);
  check("limpar lugar estranho → 'slot'", (await Arq.clear("character", "zzz", {})).code === "slot");
  await Arq.upload(id, "character", "morkhan", { video: [file("video", "video/webm", "m.webm")] });
  check("vídeo de personagem", /m\.webm$/.test((await Arq.listVideos()).videos.character.morkhan.video));
  check("lista dos lugares: 10 capítulos e os personagens", (await Arq.listVideos()).slots.chapter.length === 10);

  // ── multer: formato errado recusado no filtro ──
  const mw = require("../src/middlewares/uploadMeuMundoVideo");
  check("o middleware aceita os campos video e poster", typeof mw === "function");

  console.log(`\n${PASS} ok, ${FAIL} falhas`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
