// test/meu-mundo-inbox-history.e2e.js — MEU MUNDO 3D: o que FICA no histórico do sino.
//
// Pedido do Alex (2026-11-10): "não precisa guardar histórico de notificação,
// serão apenas interações; só se for algo como foi ao médico ou caiu muito a
// energia". O filtro é de LEITURA (lista e contador): nada é apagado.
//
// Roda: TEST_DATABASE_URL=postgres://...localhost.../teste node test/meu-mundo-inbox-history.e2e.js
// Só Postgres LOCAL e descartável (a tabela tb_user é recriada).

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

(async () => {
  const pool = require("../src/databases");
  const Inbox = require("../src/services/MeuMundoInboxService");
  const Store = require("../src/storages/MeuMundoInboxStorage");

  await pool.query(`DROP TABLE IF EXISTS tb_mm_notice, tb_mm_mail, tb_mm_notice_pref, tb_user CASCADE`);
  await pool.query(`CREATE TABLE tb_user (id_user UUID PRIMARY KEY, username TEXT, email TEXT)`);
  await pool.query(fs.readFileSync(path.join(__dirname, "../src/databases/migrations/302_meu_mundo_inbox.sql"), "utf8"));

  const bia = crypto.randomUUID();
  const ana = crypto.randomUUID();
  await pool.query(`INSERT INTO tb_user VALUES ($1, 'mmh_bia', 'bia@mm.test'), ($2, 'mmh_ana', 'ana@mm.test')`, [bia, ana]);
  await pool.query(
    `INSERT INTO tb_mm_notice (id_user, kind, code, priority, data) VALUES
       ($1, 'need', 'hungry', 4, '{}'), ($1, 'need', 'sleep', 4, '{}'), ($1, 'need', 'tired', 4, '{}'),
       ($1, 'need', 'stressed', 3, '{}'), ($1, 'need', 'aging', 4, '{}'), ($1, 'need', 'fridge_empty', 4, '{}'),
       ($1, 'need', 'exhausted', 1, '{}'), ($1, 'need', 'unwell', 2, '{}'), ($1, 'need', 'hospital', 1, '{}'), ($1, 'need', 'starving', 1, '{}'),
       ($1, 'life', 'wish', 3, '{}'), ($1, 'life', 'wish_ok', 3, '{}'), ($1, 'life', 'wish_fail', 2, '{}'), ($1, 'life', 'colors_hint', 4, '{}'),
       ($1, 'life', 'hospital_in', 1, '{}'), ($1, 'life', 'hospital_out', 2, '{}'), ($1, 'life', 'death', 1, '{}'), ($1, 'life', 'hall_lost', 2, '{}'),
       ($1, 'official', 'official', 2, '{}'), ($1, 'gift', 'gift', 2, '{}'),
       ($2, 'need', 'exhausted', 1, '{}')`,
    [bia, ana]
  );

  const hist = await Inbox.notices(bia, { limit: 50 });
  const codes = hist.items.map((n) => n.code).sort().join(",");
  check(
    "histórico guarda médico, energia no chão, vida importante e correio",
    codes === "death,exhausted,gift,hall_lost,hospital,hospital_in,hospital_out,official,starving,unwell",
    codes
  );
  check("contador do sino conta só o que fica no histórico", hist.counts.notices === 10, JSON.stringify(hist.counts));

  const mine = await Inbox.notices(bia, { filter: "character", limit: 50 });
  check("filtro do personagem segue a mesma regra", mine.items.length === 8, String(mine.items.length));
  const unread = await Inbox.notices(bia, { filter: "unread", limit: 50 });
  check("filtro de não lidas segue a mesma regra", unread.items.length === 10, String(unread.items.length));

  const all = (await pool.query(`SELECT COUNT(*)::int AS n FROM tb_mm_notice WHERE id_user = $1`, [bia])).rows[0].n;
  check("as interações continuam gravadas (nada é apagado)", all === 20, String(all));

  const other = await Inbox.notices(ana, {});
  check("o histórico de outra pessoa não entra", other.items.length === 1 && other.counts.notices === 1);

  const read = await Inbox.readNotices(bia, { all: true });
  check("marcar todas como lidas zera o sino", read.counts.notices === 0, JSON.stringify(read.counts));

  check("as listas do filtro são públicas para a tela e os testes", Store.NEED_HISTORY.includes("exhausted") && Store.LIFE_INTERACTION.includes("wish"));

  console.log(`\n${PASS} ok, ${FAIL} falha(s)`);
  await pool.end();
  process.exit(FAIL ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
