/**
 * O POOL DO BANCO QUENTE — a plataforma.
 *
 * Usuários, perfis, posts, comunidades, pagamentos, mensagens, agendamentos.
 * Tudo que uma requisição de usuário toca.
 *
 * ⚠️ ELE PRECISA FICAR PEQUENO, e isso não é estética. O `shared_buffers` é de
 * 128 MB: enquanto a plataforma couber nele, quase toda leitura é memória. Foi
 * por isso que o catálogo de leads (269 MB, e a tabela mais varrida do banco)
 * saiu daqui para `./cold` — ele expulsava do cache justamente `tb_user`,
 * `tb_profile` e o feed.
 *
 * Tabela nova responde a mesma pergunta: **uma requisição de usuário toca
 * isso?** Se não toca, ela nasce em `./cold`.
 */
const { createPool } = require("./pool");

module.exports = createPool({
  name: "db",
  connectionString: process.env.DATABASE_URL,
});
