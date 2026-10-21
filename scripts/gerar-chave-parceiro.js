// Gera (ou ROTACIONA) a chave de parceiro de uma academia — mig 296.
//
//   node scripts/gerar-chave-parceiro.js <slug-da-academia>
//
// Usa o DATABASE_URL do ambiente (ou do .env). A chave crua é impressa UMA vez
// no stdout; o banco guarda só o SHA-256. Rodar de novo invalida a anterior na
// hora — quem usa a integração (ex.: FREELANDOO_PARTNER_KEY no Railway do
// Coliseu) precisa receber a nova.
//
// É o mesmo que o botão "Chave de parceiro (Coliseu)" na página da academia
// (dono logado), para quando o dono não tem acesso à tela ou a flag
// fitness_academias ainda está desligada.
require("dotenv").config();

const { Client } = require("pg");
const { generatePartnerKey, sha256Hex } = require("../src/utils/partnerKey");

function connectionConfig() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL ausente");
  if (process.env.DATABASE_SSL !== "true") return { connectionString: raw };
  const url = new URL(raw);
  url.searchParams.delete("sslmode");
  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" },
  };
}

(async () => {
  const slug = String(process.argv[2] || "").trim();
  if (!slug) {
    console.error("uso: node scripts/gerar-chave-parceiro.js <slug-da-academia>");
    process.exit(2);
  }
  const c = new Client(connectionConfig());
  await c.connect();
  try {
    const a = await c.query(
      `SELECT id_academy, nome, slug, is_active, partner_key_created_at FROM public.tb_academy WHERE slug = $1`,
      [slug]
    );
    if (!a.rowCount) {
      console.error(`academia não encontrada: ${slug}`);
      process.exit(1);
    }
    const academy = a.rows[0];
    const chave = generatePartnerKey();
    await c.query(
      `UPDATE public.tb_academy
          SET partner_key_hash = $2, partner_key_created_at = NOW(), updated_at = NOW()
        WHERE id_academy = $1`,
      [academy.id_academy, sha256Hex(chave)]
    );
    console.error(
      `${academy.partner_key_created_at ? "chave ROTACIONADA" : "chave gerada"} para "${academy.nome}" (${academy.slug})` +
        (academy.is_active ? "" : " — ATENÇÃO: academia inativa, a API recusa até reativar")
    );
    console.error("guarde agora — ela não será mostrada de novo:");
    // Só a chave vai para o stdout (dá para redirecionar para um arquivo/env).
    console.log(chave);
  } finally {
    await c.end();
  }
})().catch((err) => {
  console.error("falhou:", err.message);
  process.exit(1);
});
