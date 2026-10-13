/**
 * VÍNCULO DO APP (mig 278) — contra o Postgres dentro de transação com
 * ROLLBACK. Seguro para apontar para produção PORQUE NÃO EXISTE `COMMIT` NESTE
 * ARQUIVO.
 *
 *   node test/app-link.e2e.js
 *
 * Confere: a migration (idempotente), os dois CHECKs pelo nome, o código de
 * uso único (2ª troca falha), o vencido que não troca, gerar outro matando o
 * anterior, a sessão revogável (por token e só pelo dono), e a projeção da
 * pessoa que o app recebe.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const BE = path.join(__dirname, "..");
const MIG = path.join(BE, "src/databases/migrations/278_app_link.sql");
const S = require(path.join(BE, "src/storages/AppLinkStorage"));
const C = require(path.join(BE, "src/utils/appLinkCode"));

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond === true) {
    pass++;
    console.log("  ok  " + name);
  } else {
    fail++;
    console.log("FAIL  " + name + (extra ? " -> " + extra : typeof cond !== "boolean" ? " (nao-booleano)" : ""));
  }
}

async function attempt(c, fn) {
  const sp = "sp_" + Math.random().toString(36).slice(2, 10);
  await c.query("SAVEPOINT " + sp);
  try {
    const value = await fn();
    await c.query("RELEASE SAVEPOINT " + sp);
    return { ok: true, value };
  } catch (err) {
    await c.query("ROLLBACK TO SAVEPOINT " + sp);
    await c.query("RELEASE SAVEPOINT " + sp);
    return { ok: false, error: err };
  }
}

async function existeTabela(c) {
  return (
    await c.query(
      `SELECT COUNT(*)::int n FROM information_schema.tables
        WHERE table_schema='public' AND table_name IN ('tb_app_link_code','tb_app_session')`
    )
  ).rows[0].n;
}

(async () => {
  const url = new URL(process.env.DATABASE_URL);
  url.searchParams.delete("sslmode");
  const c = new Client({ connectionString: url.toString(), ssl: { rejectUnauthorized: false } });
  await c.connect();
  const antes = await existeTabela(c);

  await c.query("BEGIN");
  try {
    const sql = fs.readFileSync(MIG, "utf8");
    await c.query(sql);
    await c.query(sql);
    check("mig 278 aplica duas vezes (idempotente)", true);
    check("as duas tabelas existem", (await existeTabela(c)) === 2);

    const u = await c.query(
      `INSERT INTO tb_user (nome, email, senha, username, ativo)
       VALUES ('Teste App', 'app-link-' || gen_random_uuid() || '@teste.local', 'x',
               'applink' || substr(md5(random()::text), 1, 8), TRUE)
       RETURNING id_user`
    );
    const id_user = u.rows[0].id_user;
    const u2 = await c.query(
      `INSERT INTO tb_user (nome, email, senha, username, ativo)
       VALUES ('Outro', 'app-link2-' || gen_random_uuid() || '@teste.local', 'x',
               'applink' || substr(md5(random()::text), 1, 8), TRUE)
       RETURNING id_user`
    );
    const outro = u2.rows[0].id_user;

    // CHECKs recusam hash torto — conferido pelo NOME da constraint.
    const torto = await attempt(c, () =>
      c.query(
        `INSERT INTO tb_app_link_code (id_user, code_hash, expires_at) VALUES ($1,'abc',NOW())`,
        [id_user]
      )
    );
    check("CHECK do hash do código recusa", !torto.ok && torto.error.constraint === "chk_app_link_code_hash");
    const torto2 = await attempt(c, () =>
      c.query(`INSERT INTO tb_app_session (id_user, token_hash) VALUES ($1,'abc')`, [id_user])
    );
    check("CHECK do hash da sessão recusa", !torto2.ok && torto2.error.constraint === "chk_app_session_hash");

    // Código vivo troca UMA vez.
    const code = C.generateCode();
    const row = await S.createCode(c, { id_user, code_hash: C.sha256(code), ttl_seconds: 300 });
    check("criar devolve validade no futuro", new Date(row.expires_at) > new Date());
    const quem = await S.consumeCode(c, C.sha256(C.normalizeCode(C.formatCode(code))));
    check("o código formatado troca pela pessoa certa", quem === id_user);
    check("a 2ª troca do mesmo código falha", (await S.consumeCode(c, C.sha256(code))) === null);

    // Código vencido não troca.
    const velho = C.generateCode();
    await c.query(
      `INSERT INTO tb_app_link_code (id_user, code_hash, expires_at) VALUES ($1,$2,NOW() - INTERVAL '1 second')`,
      [id_user, C.sha256(velho)]
    );
    check("código vencido não troca", (await S.consumeCode(c, C.sha256(velho))) === null);

    // Gerar outro mata o anterior.
    const a = C.generateCode();
    await S.createCode(c, { id_user, code_hash: C.sha256(a), ttl_seconds: 300 });
    await S.invalidateLiveCodes(c, id_user);
    const b = C.generateCode();
    await S.createCode(c, { id_user, code_hash: C.sha256(b), ttl_seconds: 300 });
    check("o código anterior morreu", (await S.consumeCode(c, C.sha256(a))) === null);
    check("o código novo vale", (await S.consumeCode(c, C.sha256(b))) === id_user);

    // Hash repetido é recusado pelo índice único.
    const dup = await attempt(c, () =>
      S.createCode(c, { id_user, code_hash: C.sha256(b), ttl_seconds: 300 })
    );
    check("o mesmo hash não é reemitido", !dup.ok && dup.error.code === "23505");

    // Sessão.
    const rt = C.generateSessionToken();
    const sess = await S.createSession(c, { id_user, token_hash: C.sha256(rt), device_label: "Teste" });
    const viva = await S.touchLiveSession(c, C.sha256(rt));
    check("a sessão viva renova", viva && viva.id_user === id_user);
    check("a lista do dono mostra a sessão", (await S.listLiveForUser(c, id_user)).some((s) => s.id_app_session === sess.id_app_session));
    check("outra pessoa não revoga a sessão", (await S.revokeForUser(c, outro, sess.id_app_session)) === false);
    check("o dono revoga a sessão", (await S.revokeForUser(c, id_user, sess.id_app_session)) === true);
    check("a sessão revogada não renova", (await S.touchLiveSession(c, C.sha256(rt))) === null);
    check("a lista some depois de revogar", (await S.listLiveForUser(c, id_user)).length === 0);

    const rt2 = C.generateSessionToken();
    await S.createSession(c, { id_user, token_hash: C.sha256(rt2) });
    check("logout pelo token revoga", (await S.revokeByToken(c, C.sha256(rt2))) === true);
    check("logout é idempotente", (await S.revokeByToken(c, C.sha256(rt2))) === false);

    const pessoa = await S.getUserForApp(c, id_user);
    check("a projeção da pessoa traz nome e e-mail", !!(pessoa && pessoa.nome === "Teste App" && pessoa.email));

    // CASCADE: apagar a pessoa leva códigos e sessões.
    await c.query(`DELETE FROM tb_user WHERE id_user = $1`, [outro]);
    check("apagar outra pessoa não mexe nesta", (await S.listLiveForUser(c, id_user)).length === 0);
  } catch (err) {
    fail++;
    console.log("ERRO", err);
  } finally {
    await c.query("ROLLBACK");
  }

  check("depois do ROLLBACK o banco voltou ao estado de antes", (await existeTabela(c)) === antes);
  await c.end();
  console.log(`\n${pass} ok, ${fail} falha(s)`);
  process.exit(fail ? 1 : 0);
})();
