// src/storages/CompanyJobStorage.js
// SQL puro da fila de descoberta e enriquecimento (mig 254).
//
// A mecânica é a MESMA do `AiJobStorage` (mig 253), e de propósito: aquela fila
// já pagou o preço de aprender `FOR UPDATE SKIP LOCKED` e o backoff. Copiar o
// que funciona é mais barato que inventar uma segunda forma de enfileirar que
// vai divergir na primeira correção.

class CompanyJobStorage {
  /**
   * Enfileira. Devolve `null` quando já existe um trabalho VIVO com a mesma
   * chave.
   *
   * ⚠️ O `ON CONFLICT DO NOTHING` SOBRE `ux_company_job_live` É A ECONOMIA
   * INTEIRA DESTE SUBSISTEMA. Dez pessoas pedindo "academias em São Bernardo"
   * no mesmo minuto geram UMA varredura do Overpass. Sem ele, a plataforma se
   * auto-DDoSaria contra um serviço público e gratuito — que é exatamente como
   * se perde acesso a ele, e o sintoma seria a feature parar sem ninguém ter
   * mexido em código.
   *
   * ⚠️ `null` NÃO É ERRO. É "já tem alguém fazendo isso" — o chamador devolve
   * o trabalho existente e a tela diz "estamos procurando", que é a verdade.
   */
  static async enqueue(conn, { kind, dedupe_key, id_company, requested_by, id_profile, payload }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_company_job
         (kind, dedupe_key, id_company, requested_by, id_profile, payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       ON CONFLICT (dedupe_key) WHERE status IN ('pending','running') DO NOTHING
       RETURNING *`,
      [
        kind,
        String(dedupe_key).slice(0, 300),
        id_company || null,
        requested_by || null,
        id_profile || null,
        JSON.stringify(payload || {}),
      ]
    );
    return rows[0] || null;
  }

  /** O trabalho vivo daquela chave — é o que se devolve quando o enqueue dedupa. */
  static async findLive(conn, dedupe_key) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_company_job
        WHERE dedupe_key = $1 AND status IN ('pending','running')
        ORDER BY created_at DESC LIMIT 1`,
      [String(dedupe_key).slice(0, 300)]
    );
    return rows[0] || null;
  }

  static async get(conn, id_job) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_company_job WHERE id_job = $1 LIMIT 1`,
      [id_job]
    );
    return rows[0] || null;
  }

  /**
   * Reivindica até `limit` trabalhos devidos, marcando-os `running` na MESMA
   * instrução.
   *
   * ⚠️ `FOR UPDATE SKIP LOCKED` é o que permite mais de uma instância do
   * backend sem que duas varram a mesma cidade (pagando duas chamadas do
   * Overpass) ou crawleiem o mesmo site. Sem ele o sintoma só apareceria onde
   * há mais de um processo: em produção.
   *
   * ⚠️ `limit` PEQUENO DE PROPÓSITO. Cada trabalho é uma chamada de rede lenta
   * a um serviço de terceiro; reivindicar vinte de uma vez transformaria o tique
   * do worker numa rajada contra a Overpass.
   */
  static async claimDue(conn, limit = 2) {
    const { rows } = await conn.query(
      `UPDATE public.tb_company_job j
          SET status = 'running', attempts = j.attempts + 1, updated_at = NOW()
        WHERE j.id_job IN (
                SELECT id_job FROM public.tb_company_job
                 WHERE status = 'pending' AND next_attempt_at <= NOW()
                 ORDER BY next_attempt_at ASC
                 LIMIT $1
                 FOR UPDATE SKIP LOCKED
              )
        RETURNING j.*`,
      [limit]
    );
    return rows;
  }

  static async finish(conn, id_job, { status, result, skip_reason, last_error, next_attempt_at }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_company_job
          SET status          = $2,
              result          = COALESCE($3::jsonb, result),
              skip_reason     = $4,
              last_error      = $5,
              next_attempt_at = COALESCE($6, next_attempt_at),
              updated_at      = NOW()
        WHERE id_job = $1
        RETURNING *`,
      [
        id_job,
        status,
        result === undefined || result === null ? null : JSON.stringify(result),
        skip_reason ? String(skip_reason).slice(0, 300) : null,
        last_error ? String(last_error).slice(0, 500) : null,
        next_attempt_at ?? null,
      ]
    );
    return rows[0] || null;
  }

  /**
   * Devolve à fila o que ficou preso em `running`.
   *
   * ⚠️ SEM ISTO, UMA QUEDA NO MEIO DE UM CRAWL DEIXA A LINHA EM `running` PARA
   * SEMPRE: ela nunca mais é reivindicada e aquela busca fica eternamente
   * "procurando", sem nada indicando o porquê. Mesma rede de segurança que a
   * fila do atendente tem.
   */
  static async requeueStuck(conn, minutes = 20) {
    const { rows } = await conn.query(
      `UPDATE public.tb_company_job
          SET status = 'pending', next_attempt_at = NOW(), updated_at = NOW()
        WHERE status = 'running'
          AND updated_at < NOW() - ($1 || ' minutes')::interval
        RETURNING id_job`,
      [String(Number(minutes) || 20)]
    );
    return rows.length;
  }

  /**
   * Poda o que terminou e envelheceu.
   *
   * A fila recebe uma linha por PEDIDO, inclusive os que foram pulados (o
   * motivo fica em `skip_reason`, e é ele que responde "por que não achou
   * nada?"). Sem a poda ela vira a maior tabela do banco guardando "pulei" de
   * buscas de meses atrás.
   */
  static async purgeOld(conn, days = 30) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_company_job
        WHERE status IN ('done','failed','skipped')
          AND updated_at < NOW() - ($1 || ' days')::interval`,
      [String(Number(days) || 30)]
    );
    return rowCount;
  }

  /**
   * Quantos trabalhos daquele tipo esta pessoa pediu nas últimas 24h.
   *
   * ⚠️ É O FREIO DE USO, e ele não é preço: é o que impede uma conta de varrer
   * o Overpass e o Nominatim até a plataforma inteira ser bloqueada por eles.
   * Por isso ele nasce valendo, ao contrário dos custos em Polén, que nascem
   * em zero.
   */
  static async countToday(conn, { requested_by, kinds }) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS total
         FROM public.tb_company_job
        WHERE requested_by = $1
          AND kind = ANY($2::text[])
          AND created_at > NOW() - INTERVAL '24 hours'`,
      [requested_by, kinds]
    );
    return rows[0]?.total || 0;
  }

  /** Os últimos pedidos daquele negócio — a tela mostra o que está em curso. */
  static async listRecent(conn, { id_profile, limit = 10 }) {
    const { rows } = await conn.query(
      `SELECT id_job, kind, status, payload, result, skip_reason,
              created_at, updated_at
         FROM public.tb_company_job
        WHERE id_profile = $1
        ORDER BY created_at DESC
        LIMIT $2`,
      [id_profile, Math.max(1, Math.min(50, Number(limit) || 10))]
    );
    return rows;
  }
}

module.exports = CompanyJobStorage;
