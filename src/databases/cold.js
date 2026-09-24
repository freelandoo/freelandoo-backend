/**
 * O POOL DO BANCO FRIO — o catálogo de leads.
 *
 * ⚠️ A REGRA QUE DECIDE O QUE MORA AQUI é uma pergunta só:
 *
 *     "Uma requisição de usuário toca isso?"
 *
 * Sim  -> banco QUENTE (`../databases`), que precisa caber no cache.
 * Não  -> banco FRIO (este), que pode ser enorme porque ninguém espera por ele.
 *
 * O motivo não é disco, é CACHE. O `shared_buffers` do Postgres é 128 MB e é
 * COMPARTILHADO por todas as tabelas da instância. Com os leads no mesmo banco,
 * cada busca de lead puxa páginas de `tb_company` (a tabela mais varrida da
 * base, 545 mil varreduras por índice) e EXPULSA de lá `tb_user`, `tb_profile`
 * e o feed. Aí a requisição do usuário comum vai ao disco em vez da memória,
 * fica lenta, e as 25 conexões do pool quente ficam presas numa fila. É assim
 * que um pico de audiência derruba o site — e é isso que a separação evita.
 *
 * ⚠️ SEM `DATABASE_URL_COLD` ELE **É** O POOL QUENTE — o mesmo objeto, não uma
 * cópia. É deliberado, e é o que torna o deploy seguro:
 *
 *   - subir este código sem a variável não muda NADA (um pool só, como antes);
 *   - definir a variável é a virada de chave;
 *   - APAGAR a variável é o rollback, sem deploy.
 *
 * Criar um segundo pool apontando para o MESMO banco seria o pior dos mundos:
 * dobraria as conexões para não separar nada.
 *
 * ⚠️ NÃO EXISTE TRANSAÇÃO ENTRE BANCOS. Quem escrever num e noutro na mesma
 * operação precisa aguentar falhar no meio. Hoje isso acontece em UM lugar só —
 * salvar um lead numa lista — e por isso `tb_lead_list_item` guarda um SNAPSHOT
 * dos campos da empresa em vez de uma FK para `tb_company`.
 */
const { createPool } = require("./pool");
const hotPool = require("./index");

const COLD_URL = process.env.DATABASE_URL_COLD;

// ⚠️ Timeout maior que o do quente DE PROPÓSITO. Aqui roda ingestão em lote
// (INSERT de até 400 empresas por instrução), e os 8s do pool quente — que
// existem para nenhuma tela ficar pendurada — matariam um reabastecimento no
// meio. Ninguém está olhando para uma tela esperando este pool.
const cold = COLD_URL
  ? createPool({
      name: "db.cold",
      connectionString: COLD_URL,
      maxEnv: "DATABASE_COLD_POOL_MAX",
      maxDefault: 10,
      timeoutEnv: "DATABASE_COLD_STATEMENT_TIMEOUT_MS",
      timeoutDefault: 60_000,
    })
  : hotPool;

/** `true` quando os leads estão mesmo num banco à parte. */
cold.isSeparate = Boolean(COLD_URL);

module.exports = cold;
