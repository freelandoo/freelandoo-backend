// test/meu-mundo-chat.e2e.js — MEU MUNDO 3D mm3d-32: chat do jogo no banco.
//
// Global grava na sala meu_mundo (mig 303) com o perfil-conta; o histórico de
// quem tem bloqueio com o autor não mostra a linha; o 1:1 é UMA conversa entre
// perfis-conta (a mesma que aparece em /mensagens) e bloqueio não abre.
//
// Roda: TEST_DATABASE_URL=postgres://...127.0.0.1.../freelandoo_mm32 npm run test:meu-mundo-chat
// Só Postgres LOCAL e descartável, com TODAS as migrations aplicadas (até a 303).
// Os usuários do teste são criados aqui e apagados no fim.

const url = process.env.TEST_DATABASE_URL;
if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("TEST_DATABASE_URL precisa apontar para um Postgres LOCAL e descartável.");
  process.exit(2);
}
process.env.DATABASE_URL = url;
process.env.DATABASE_SSL = "false";

const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

const pool = require("../src/databases");
const MeuMundoChatService = require("../src/services/MeuMundoChatService");
const ConversationService = require("../src/services/ConversationService");
const ProfileStorage = require("../src/storages/ProfileStorage");

const made = [];
async function mkUser(tag) {
  const id_user = crypto.randomUUID();
  const suffix = id_user.slice(0, 8);
  await pool.query(
    `INSERT INTO tb_user (id_user, nome, email, username, ativo) VALUES ($1, $2, $3, $4, TRUE)`,
    [id_user, `MM ${tag}`, `${id_user}@mm32.test`, `mm32_${tag}_${suffix}`]
  );
  await pool.query(
    `INSERT INTO tb_user_role (id_user, id_role) SELECT $1, id_role FROM tb_role WHERE desc_role = 'Administrator'`,
    [id_user]
  );
  made.push(id_user);
  await ProfileStorage.getUserAccountProfileId(pool, id_user); // perfil-conta
  return { id_user };
}

let alice;
let bob;

test.before(async () => {
  alice = await mkUser("alice");
  bob = await mkUser("bob");
});

test.after(async () => {
  if (made.length) {
    const ids = made;
    await pool.query(`DELETE FROM tb_chat_message WHERE id_user = ANY($1::uuid[])`, [ids]);
    await pool.query(
      `DELETE FROM tb_conversation c USING tb_profile p
        WHERE p.id_user = ANY($1::uuid[]) AND (c.entity_a_id = p.id_profile OR c.entity_b_id = p.id_profile)`,
      [ids]
    ).catch(() => {});
    await pool.query(`DELETE FROM tb_user WHERE id_user = ANY($1::uuid[])`, [ids]);
  }
  await pool.end();
});

test("Global: grava na sala meu_mundo com o perfil-conta", async () => {
  const r = await MeuMundoChatService.send(alice.id_user, { text: "olá centro" });
  assert.ok(r.line, JSON.stringify(r));
  assert.equal(r.line.text, "olá centro");
  assert.equal(r.line.mine, true);
  const row = await pool.query(
    `SELECT m.id_profile, p.is_user_account, r.type FROM tb_chat_message m
       JOIN tb_chat_room r USING (id_chat_room) JOIN tb_profile p ON p.id_profile = m.id_profile
      WHERE m.id_chat_message = $1`, [r.line.id]);
  assert.equal(row.rows[0].type, "meu_mundo");
  assert.equal(row.rows[0].is_user_account, true);
  const h = await MeuMundoChatService.history(bob.id_user, {});
  const seen = h.items.find((l) => l.id === r.line.id);
  assert.ok(seen, "bob vê a linha");
  assert.equal(seen.mine, false);
  assert.equal(JSON.stringify(seen).includes(alice.id_user), false, "nenhum id de usuário na linha");
});

test("Global: histórico de quem bloqueou não mostra a linha", async () => {
  await pool.query(`INSERT INTO tb_user_block (blocker_user_id, blocked_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [bob.id_user, alice.id_user]);
  const h = await MeuMundoChatService.history(bob.id_user, {});
  assert.equal(h.items.some((l) => l.text === "olá centro"), false);
  const hA = await MeuMundoChatService.history(alice.id_user, {});
  assert.equal(hA.items.some((l) => l.text === "olá centro"), true, "a autora segue vendo a própria linha");
  await pool.query(`DELETE FROM tb_user_block WHERE blocker_user_id=$1 AND blocked_user_id=$2`, [bob.id_user, alice.id_user]);
});

test("1:1: abrir pelo profileId cria UMA conversa entre perfis-conta (aparece em /conversations)", async () => {
  const bobAcc = await ProfileStorage.getUserAccountProfileId(pool, bob.id_user);
  const a = await MeuMundoChatService.openDirect(alice.id_user, { profileId: bobAcc });
  assert.ok(a.conversation, JSON.stringify(a));
  const b = await MeuMundoChatService.openDirect(alice.id_user, { profileId: bobAcc });
  assert.equal(a.conversation.id_conversation, b.conversation.id_conversation);
  // listMine pede o ator (perfil-conta de quem lista).
  const list = await ConversationService.listMine({ id_user: bob.id_user }, { actor_id: bobAcc, actor_type: "profile" });
  assert.ok((list.items || []).some((c) => c.id_conversation === a.conversation.id_conversation), JSON.stringify(list).slice(0, 300));
});

test("1:1: bloqueado não abre", async () => {
  await pool.query(`INSERT INTO tb_user_block (blocker_user_id, blocked_user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [bob.id_user, alice.id_user]);
  const bobAcc = await ProfileStorage.getUserAccountProfileId(pool, bob.id_user);
  const r = await MeuMundoChatService.openDirect(alice.id_user, { profileId: bobAcc });
  assert.equal(r.code, "blocked", JSON.stringify(r));
});
