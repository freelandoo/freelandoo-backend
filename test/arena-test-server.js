// Servidor do backend SÓ PARA TESTE de navegador da Arena (Módulos 04/05).
//
//   TEST_DATABASE_URL=postgres://...55432/freelandoo_test PORT=5055 node test/arena-test-server.js
//
// Sobe o `src/app.js` real (sem workers, sem socket, sem jobs) contra o banco
// de TESTE. Não carrega o .env (segredos e banco de produção ficam de fora):
// recebe tudo por variável e recusa host que pareça produção.

const crypto = require("node:crypto");

const DB_URL = process.env.TEST_DATABASE_URL || "postgres://postgres:test@127.0.0.1:55432/freelandoo_test";
if (/railway|rlwy\.net|proxy\.rlwy/i.test(DB_URL)) {
  console.error("[guard] TEST_DATABASE_URL parece produção. Abortando.");
  process.exit(1);
}
if (!process.env.ARENA_TEST_JWT_SECRET) {
  console.error("[guard] defina ARENA_TEST_JWT_SECRET (segredo descartável deste teste).");
  process.exit(1);
}
process.env.DATABASE_URL = DB_URL;
process.env.DATABASE_URL_COLD = "";
process.env.NODE_ENV = "test";
process.env.JWT_SECRET = process.env.ARENA_TEST_JWT_SECRET;
process.env.JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || "1h";

const app = require("../src/app");
const port = Number(process.env.PORT || 5055);
app.listen(port, "127.0.0.1", () => {
  console.log(`arena-test-server ready on ${port} (${crypto.createHash("sha256").update(DB_URL).digest("hex").slice(0, 8)})`);
});
