// Contas sintéticas para TESTE DE CARGA da Freelandoo Arena (banco de TESTE).
//
//   node test/arena-load-fixtures.js seed <n>   → cria n contas ativas + jogador
//                                                 da Arena; imprime {ids:[...]}
//   node test/arena-load-fixtures.js clean      → apaga as contas de carga
//
// Em lote (uma instrução), sem bcrypt por conta: quem conecta usa JWT assinado
// com o segredo DESCARTÁVEL do servidor de teste. Recusa banco de produção.

const crypto = require("node:crypto");
const { Client } = require("pg");

const DB = process.env.TEST_DATABASE_URL || "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";
if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB)) {
  console.error("[guard] TEST_DATABASE_URL parece produção. Abortando.");
  process.exit(1);
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  const db = new Client({ connectionString: DB });
  await db.connect();
  try {
    if (cmd === "clean") {
      const r = await db.query(`DELETE FROM public.tb_user WHERE email LIKE 'arena.load.%@teste.invalid'`);
      console.log(JSON.stringify({ deleted: r.rowCount }));
      return;
    }
    if (cmd !== "seed") throw new Error("uso: seed <n> | clean");
    const n = Math.max(1, Math.min(5000, Number(arg) || 0));
    const stamp = Date.now().toString(36);
    const hash = "$2b$04$" + crypto.randomBytes(40).toString("base64").replace(/[^A-Za-z0-9./]/g, "").slice(0, 53);
    const r = await db.query(
      `INSERT INTO public.tb_user (nome, username, email, senha, ativo, onboarding_tour_done)
       SELECT 'Carga ' || g, 'ld' || $2 || g, 'arena.load.' || $2 || '.' || g || '@teste.invalid', $3, TRUE, TRUE
         FROM generate_series(1, $1) g
       RETURNING id_user`,
      [n, stamp, hash]
    );
    const ids = r.rows.map((x) => x.id_user);
    await db.query(
      `INSERT INTO public.tb_user_action_consent (id_user, action_key, terms_version)
       SELECT u, 'signup', COALESCE((SELECT MAX(terms_version) FROM public.tb_user_action_consent), 1) FROM unnest($1::uuid[]) u
       ON CONFLICT DO NOTHING`,
      [ids]
    );
    console.log(JSON.stringify({ ids }));
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
