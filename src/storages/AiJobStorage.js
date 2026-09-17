// src/storages/AiJobStorage.js
// SQL puro da fila de resposta e do medidor de tokens (mig 253).
//
// ─── ⚠️ O ENQUEUE É A ÚNICA COISA QUE A INGESTÃO DE WHATSAPP PODE TOCAR ─────
//
// `WhatsappCloudIngestService` importa ESTE arquivo e nada mais do subsistema
// de IA. É o que mantém de pé o invariante provado por
// `test/unit/whatsappIngestIsolation.test.js`: da ingestão não existe caminho
// de `require` até quem ENVIA. Escrever uma linha numa fila não é enviar.
//
// ⚠️ NÃO acrescentar aqui nenhum import de service que responda, envie ou fale
// com provedor — o `require` de passagem seria transitivo e quebraria a
// garantia sem quebrar nenhum teste funcional.

class AiJobStorage {
  /**
   * Enfileira uma resposta. Devolve `null` quando a mensagem já estava na fila.
   *
   * ⚠️ `ON CONFLICT DO NOTHING` sobre o índice parcial `ux_ai_reply_job_trigger`
   * é o que segura o webhook at-least-once da Meta: a mesma mensagem re-entregue
   * três vezes enfileira UMA resposta. Sem isso o cliente receberia o mesmo
   * texto três vezes e a plataforma pagaria três chamadas de LLM por ele.
   */
  static async enqueue(conn, { id_user, channel, ref_id, trigger_message_id, trigger_text }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_ai_reply_job
         (id_user, channel, ref_id, trigger_message_id, trigger_text)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (channel, trigger_message_id)
         WHERE trigger_message_id IS NOT NULL DO NOTHING
       RETURNING id_job, id_user, channel, ref_id, status, created_at`,
      [id_user, channel, String(ref_id), trigger_message_id || null, trigger_text || null]
    );
    return rows[0] || null;
  }

  /**
   * Enfileira resolvendo o DONO a partir de um perfil, na mesma instrução.
   *
   * Serve os canais de dentro da plataforma (DM e O.S.), onde quem deve
   * responder é o dono do perfil destinatário — e quem chama (o
   * `ConversationService`) tem o perfil em mãos, não o usuário.
   *
   * ⚠️ RESOLVER EM SQL, e não com um SELECT antes do INSERT, mantém o enfileirar
   * com UMA ida ao banco no caminho mais quente da plataforma: toda mensagem
   * direta passa por aqui.
   *
   * Devolve `null` quando o perfil não existe OU quando a mensagem já estava na
   * fila — os dois casos são "não há nada a fazer".
   */
  static async enqueueForProfileOwner(conn, { id_profile, channel, ref_id, trigger_message_id, trigger_text }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_ai_reply_job
         (id_user, channel, ref_id, trigger_message_id, trigger_text)
       SELECT p.id_user, $2, $3, $4, $5
         FROM public.tb_profile p
        WHERE p.id_profile = $1 AND p.deleted_at IS NULL
       ON CONFLICT (channel, trigger_message_id)
         WHERE trigger_message_id IS NOT NULL DO NOTHING
       RETURNING id_job, id_user, channel, ref_id`,
      [id_profile, channel, String(ref_id), trigger_message_id || null, trigger_text || null]
    );
    return rows[0] || null;
  }

  static async get(conn, id_job) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_ai_reply_job WHERE id_job = $1 LIMIT 1`,
      [id_job]
    );
    return rows[0] || null;
  }

  /**
   * Varre da fila o que já terminou e envelheceu.
   *
   * ⚠️ A fila recebe uma linha por mensagem que CHEGA, inclusive as que não vão
   * ser respondidas (o motivo fica em `skip_reason`, e é ele que responde
   * "por que a IA não respondeu?"). Sem esta poda ela vira a maior tabela do
   * banco guardando "pulei" de conversas de meses atrás.
   */
  static async purgeOld(conn, days = 30) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_ai_reply_job
        WHERE status IN ('done','skipped','failed')
          AND updated_at < NOW() - ($1 || ' days')::interval`,
      [String(Number(days) || 30)]
    );
    return rowCount;
  }

  /**
   * Reivindica até `limit` trabalhos devidos, marcando-os `running` na MESMA
   * instrução.
   *
   * ⚠️ `FOR UPDATE SKIP LOCKED` é o que permite mais de uma instância do
   * backend sem que duas respondam a mesma conversa. Sem ele, dois workers
   * leriam a mesma linha `pending` e o cliente receberia duas respostas — e o
   * sintoma só apareceria em produção, onde há mais de um processo.
   */
  static async claimDue(conn, limit = 3) {
    const { rows } = await conn.query(
      `UPDATE public.tb_ai_reply_job j
          SET status = 'running', attempts = j.attempts + 1, updated_at = NOW()
        WHERE j.id_job IN (
                SELECT id_job FROM public.tb_ai_reply_job
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

  static async finish(conn, id_job, { status, answer, skip_reason, last_error, next_attempt_at }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_ai_reply_job
          SET status          = $2,
              answer          = COALESCE($3, answer),
              skip_reason     = $4,
              last_error      = $5,
              next_attempt_at = COALESCE($6, next_attempt_at),
              updated_at      = NOW()
        WHERE id_job = $1
        RETURNING *`,
      [
        id_job,
        status,
        answer ?? null,
        skip_reason ? String(skip_reason).slice(0, 300) : null,
        last_error ? String(last_error).slice(0, 500) : null,
        next_attempt_at ?? null,
      ]
    );
    return rows[0] || null;
  }

  /**
   * Devolve à fila para nova tentativa.
   *
   * ⚠️ Volta para `pending`, e não fica em `running`: linha travada em
   * `running` nunca mais é reivindicada pelo `claimDue` e o trabalho morre ali,
   * sem erro nenhum — é a fila que para de andar em silêncio.
   */
  static async retryLater(conn, id_job, { seconds, last_error }) {
    await conn.query(
      `UPDATE public.tb_ai_reply_job
          SET status          = 'pending',
              next_attempt_at = NOW() + ($2 || ' seconds')::interval,
              last_error      = $3,
              updated_at      = NOW()
        WHERE id_job = $1`,
      [id_job, String(Number(seconds) || 60), last_error ? String(last_error).slice(0, 500) : null]
    );
  }

  /**
   * Solta trabalhos presos em `running` (queda do processo no meio).
   *
   * ⚠️ Sem isto, um restart durante uma chamada de LLM deixa a linha `running`
   * para sempre: ela não é reivindicada de novo e aquela conversa fica sem
   * resposta, sem nada indicando o porquê.
   */
  static async releaseStuck(conn, minutes = 10) {
    const { rowCount } = await conn.query(
      `UPDATE public.tb_ai_reply_job
          SET status = 'pending', updated_at = NOW()
        WHERE status = 'running'
          AND updated_at < NOW() - ($1 || ' minutes')::interval`,
      [String(Number(minutes) || 10)]
    );
    return rowCount;
  }

  static async listRecent(conn, { limit = 50, status } = {}) {
    const { rows } = await conn.query(
      `SELECT j.id_job, j.id_user, j.channel, j.ref_id, j.status, j.attempts,
              j.trigger_text, j.answer, j.skip_reason, j.last_error,
              j.created_at, j.updated_at, u.username
         FROM public.tb_ai_reply_job j
         LEFT JOIN public.tb_user u ON u.id_user = j.id_user
        WHERE ($2::text IS NULL OR j.status = $2)
        ORDER BY j.created_at DESC
        LIMIT $1`,
      [Math.min(Number(limit) || 50, 200), status || null]
    );
    return rows;
  }

  // ─── Medidor ───────────────────────────────────────────────────────────────

  /**
   * ⚠️ `cost_usd` NULL não é zero — é "não sei quanto custou", e é o que
   * acontece quando o admin não informou o preço do modelo. A tela diferencia
   * os dois; somar zero faria o painel afirmar gasto que não mediu.
   */
  static async recordUsage(conn, { id_user, id_job, provider, model, channel, input_tokens, output_tokens, cost_usd }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_ai_usage
         (id_user, id_job, provider, model, channel, input_tokens, output_tokens, cost_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING id_usage`,
      [
        id_user || null,
        id_job || null,
        provider,
        model,
        channel || null,
        Number(input_tokens) || 0,
        Number(output_tokens) || 0,
        cost_usd === null || cost_usd === undefined ? null : Number(cost_usd),
      ]
    );
    return rows[0];
  }

  /** Resumo do período para o painel: tokens, custo apurado e o que ficou sem. */
  static async usageSummary(conn, { days = 30 } = {}) {
    const { rows } = await conn.query(
      `SELECT provider,
              model,
              COUNT(*)::int                       AS calls,
              SUM(input_tokens)::bigint           AS input_tokens,
              SUM(output_tokens)::bigint          AS output_tokens,
              SUM(cost_usd)                       AS cost_usd,
              COUNT(*) FILTER (WHERE cost_usd IS NULL)::int AS calls_without_price
         FROM public.tb_ai_usage
        WHERE created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY provider, model
        ORDER BY SUM(input_tokens + output_tokens) DESC`,
      [String(Number(days) || 30)]
    );
    return rows;
  }
}

module.exports = AiJobStorage;
