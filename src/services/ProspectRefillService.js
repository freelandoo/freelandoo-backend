// src/services/ProspectRefillService.js
// Traz uma partição (uf, categoria) da base fria do R2 para o Postgres.
//
// ─── O QUE ESTE ARQUIVO PROTEGE ─────────────────────────────────────────────
//
// Reabastecer é a ÚNICA operação cara deste subsistema — a busca em si é um
// SELECT indexado. E ela tem dois modos de derrubar o site inteiro, os dois
// invisíveis em teste com uma pessoa:
//
//   1. ESTOURO DE CONEXÃO. O pool é `max: 25` (src/databases/index.js) e é o
//      MESMO pool de toda a plataforma. `CompanyIngestService.ingestMany` abre
//      UMA transação para a lista inteira; com os 5.556 bares de SP isso
//      segura uma das 25 conexões por dezenas de segundos. Se 25 desses
//      coincidirem, o site inteiro passa a receber erro de conexão — não só a
//      prospecção. Daí o CHUNK.
//
//   2. ESTOURO DE TRABALHO REPETIDO (cache stampede). Cem pessoas pedindo a
//      mesma partição fria no mesmo segundo fariam cem downloads e cem
//      ingestões do mesmo conteúdo. Daí o LOCK.
//
// ⚠️ NENHUM DOS DOIS APARECE COM POUCA GENTE. É exatamente o tipo de defeito
// que só se manifesta no dia em que a plataforma cresce — que é o pior dia
// possível para descobri-lo.

const crypto = require("crypto");
// ⚠️ ESTE SERVICE FALA SÓ COM O BANCO FRIO. Ele mexe apenas no catálogo
// (tb_company*), que saiu do banco da plataforma para não disputar o cache
// de 128 MB com tb_user/tb_profile/feed. Sem DATABASE_URL_COLD este require
// devolve o MESMO pool de sempre, então nada muda até a variável existir.
const pool = require("../databases/cold");
const r2Partition = require("../integrations/companyProvider/r2Partition");
const CompanyIngestService = require("./CompanyIngestService");
const { createLogger } = require("../utils/logger");
const { runWithLogs } = require("../utils/logger");

const log = createLogger("ProspectRefillService");

/** Quantos rascunhos por transação. Ver "1. ESTOURO DE CONEXÃO" acima. */
const CHUNK = Number(process.env.PROSPECT_REFILL_CHUNK) || 200;

/**
 * Teto de reabastecimentos simultâneos NESTE processo.
 *
 * ⚠️ O LOCK IMPEDE DUAS PESSOAS NA MESMA PARTIÇÃO; este teto impede muitas
 * pessoas em partições DIFERENTES. Sem ele, dez estados pedidos ao mesmo tempo
 * ocupariam dez das 25 conexões por vez — sem repetir trabalho nenhum, e ainda
 * assim afogando o pool.
 */
const MAX_INFLIGHT = Number(process.env.PROSPECT_REFILL_INFLIGHT) || 3;
let inflight = 0;

/** Namespace do advisory lock. Número arbitrário e fixo, só não pode colidir. */
const LOCK_NS = 254001;

/**
 * (uf, categoria) → int32 estável para o segundo argumento do advisory lock.
 * Colisão aqui só faria duas partições diferentes se serializarem — lento, nunca
 * errado.
 */
function lockKey(uf, category) {
  const h = crypto.createHash("sha1").update(`${uf}:${category}`).digest();
  return h.readInt32BE(0);
}

class ProspectRefillService {
  /**
   * Esta partição deste lote já foi trazida por INTEIRO?
   *
   * ⚠️ NÃO CONFUNDIR COM "existe empresa desta categoria". Foi o que a primeira
   * versão fazia, e um reabastecimento interrompido (195 de 2.325 gravadas)
   * passava a se declarar pronto para sempre — a categoria congelava com 8% do
   * conteúdo, sem erro nenhum. A linha aqui só é escrita DEPOIS que a ingestão
   * termina; interrompida, não há linha e a próxima tentativa refaz.
   */
  static async _isFilled(conn, uf, category) {
    const { rows } = await conn.query(
      `SELECT filled_at, found, created FROM public.tb_company_partition
        WHERE prefix = $1 AND uf = $2 AND category_key = $3 LIMIT 1`,
      [r2Partition.currentPrefix(), String(uf).toUpperCase().slice(0, 2), category]
    );
    return rows[0] || null;
  }

  static async _markFilled(conn, uf, category, stats) {
    await conn.query(
      `INSERT INTO public.tb_company_partition
         (prefix, uf, category_key, found, created, updated, skipped, duration_ms)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (prefix, uf, category_key) DO UPDATE
         SET found = EXCLUDED.found, created = EXCLUDED.created,
             updated = EXCLUDED.updated, skipped = EXCLUDED.skipped,
             duration_ms = EXCLUDED.duration_ms, filled_at = NOW()`,
      [
        r2Partition.currentPrefix(),
        String(uf).toUpperCase().slice(0, 2),
        category,
        stats.found || 0,
        stats.created || 0,
        stats.updated || 0,
        stats.skipped || 0,
        stats.duration_ms || null,
      ]
    );
  }

  /**
   * Traz a partição para o Postgres, se ainda não estiver lá.
   *
   * Devolve `{ status }`:
   *   `filled`    trouxe agora (com os números)
   *   `warm`      já estava na base — nada a fazer
   *   `busy`      outra requisição está trazendo, ou o teto foi atingido
   *   `missing`   o lote não tem esta partição → cabe descoberta ao vivo
   *   `disabled`  base fria desligada por ambiente
   */
  /**
   * Dispara o reabastecimento SEM esperar por ele.
   *
   * ⚠️ ESTA É A PORTA QUE A BUSCA USA, e a razão é medida. Uma partição grande
   * leva segundos para ingerir mesmo com o banco ao lado (5.556 bares de SP),
   * e a busca é a tela mais usada do módulo: prendê-la nisso faria a primeira
   * pesquisa de cada estado parecer travada, e ainda seguraria uma das 25
   * conexões do pool durante toda a ingestão.
   *
   * Aqui a pessoa recebe o que a base já tem, agora, e o preenchimento corre
   * atrás — na busca seguinte, segundos depois, o resultado já está completo.
   *
   * ⚠️ PERDER ESTE DISPARO É INOFENSIVO, e é isso que o torna seguro num
   * processo web que pode ser reciclado a qualquer momento: sem a marca em
   * `tb_company_partition`, a próxima busca simplesmente dispara de novo.
   */
  static fireAndForget({ uf, category, city = null }) {
    this.ensure({ uf, category, city }).catch((err) => {
      log.warn("refill.background_fail", { uf, category, message: err?.message });
    });
  }

  static async ensure({ uf, category, city = null }) {
    return runWithLogs(log, "ensure", () => ({ uf, category }), async () => {
      if (!r2Partition.isConfigured()) return { status: "disabled" };

      // Barato e resolve a esmagadora maioria das chamadas: se a partição já
      // foi trazida, nem o lock nem o R2 entram no caminho.
      const already = await this._isFilled(pool, uf, category);
      if (already) return { status: "warm", filled_at: already.filled_at };

      if (inflight >= MAX_INFLIGHT) {
        log.warn("refill.busy_inflight", { uf, category, inflight });
        return { status: "busy" };
      }

      // ⚠️ O LOCK PRECISA DE UMA CONEXÃO DEDICADA. `pg_try_advisory_lock` é de
      // SESSÃO: pego e solto têm de sair da mesma conexão, e com o pool cada
      // `pool.query` pode cair numa diferente — o lock ficaria preso para
      // sempre, e a partição nunca mais seria reabastecida.
      const conn = await pool.connect();
      inflight += 1;
      let locked = false;
      try {
        const { rows } = await conn.query("SELECT pg_try_advisory_lock($1, $2) AS ok", [
          LOCK_NS,
          lockKey(uf, category),
        ]);
        locked = !!rows[0]?.ok;
        if (!locked) {
          log.info("refill.busy_locked", { uf, category });
          return { status: "busy" };
        }

        // Alguém pode ter terminado enquanto esperávamos o lock.
        const again = await this._isFilled(conn, uf, category);
        if (again) return { status: "warm", filled_at: again.filled_at };

        const t0 = Date.now();
        const drafts = await r2Partition.fetchPartition({ uf, category });
        if (drafts === null) return { status: "missing" };
        if (!drafts.length) {
          // Partição existe e está vazia é resposta legítima (categoria sem
          // nenhum ponto mapeado naquele estado): marca como trazida, senão
          // toda busca ali tentaria baixar de novo, para sempre.
          await this._markFilled(conn, uf, category, { found: 0, duration_ms: Date.now() - t0 });
          return { status: "filled", found: 0, created: 0, updated: 0 };
        }

        // ⚠️ GRAVA O ESTADO INTEIRO, e não só a cidade pedida. Um download
        // serve os 645 municípios de SP: quem pesquisar Santo André depois não
        // paga nada. Recortar aqui deixaria o Postgres menor e faria a próxima
        // cidade baixar o mesmo arquivo de novo.
        // ⚠️ A FONTE SAI DO PREFIXO DO LOTE, nunca de um literal. Ver
        // `r2Partition.sourceOfPrefix`: cravada, a particao do Overture
        // entraria no banco carimbada como OSM e com o peso de confianca
        // errado na disputa de campo.
        const src = r2Partition.sourceOfPrefix();
        const r = await CompanyIngestService.ingestPartition(drafts, src, { chunk: CHUNK });
        const duration_ms = Date.now() - t0;

        // ⚠️ A MARCA VEM DEPOIS DA INGESTÃO, nunca antes. Marcar primeiro
        // pareceria mais seguro contra concorrência (e o lock já cuida disso),
        // mas transformaria qualquer falha no meio numa partição eternamente
        // "pronta" e pela metade — exatamente o defeito que esta tabela existe
        // para evitar.
        await this._markFilled(conn, uf, category, { found: drafts.length, ...r, duration_ms });

        log.info("refill.filled", { uf, category, found: drafts.length, ...r, duration_ms });
        return { status: "filled", found: drafts.length, ...r, duration_ms, city };
      } finally {
        if (locked) {
          // Solta mesmo se a ingestão explodiu: lock preso é pior que partição
          // faltando, porque ninguém consegue reabastecer depois.
          await conn
            .query("SELECT pg_advisory_unlock($1, $2)", [LOCK_NS, lockKey(uf, category)])
            .catch(() => {});
        }
        inflight -= 1;
        conn.release();
      }
    });
  }
}

module.exports = ProspectRefillService;
