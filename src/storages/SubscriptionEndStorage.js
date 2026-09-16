// src/storages/SubscriptionEndStorage.js
// A fila de "cancelar no fim do ciclo" (mig 251).
//
// ⚠️ ESTA TABELA É UMA FILA, NÃO A VERDADE SOBRE A ASSINATURA. A verdade
// continua sendo o webhook (`SUBSCRIPTION_ENDED`), que é quem desliga o acesso.
// Sem essa separação, uma linha 'done' aqui e um cancelamento que falhou no
// gateway deixariam a plataforma jurando que a pessoa saiu enquanto o cartão
// dela segue sendo debitado.

/** Depois disso, parar de insistir: id que o gateway não reconhece mais. */
const MAX_ATTEMPTS = 5;

class SubscriptionEndStorage {
  /**
   * Agenda (ou reagenda) o cancelamento.
   *
   * ⚠️ O `ON CONFLICT` INFERE O ÍNDICE PARCIAL (`WHERE status = 'scheduled'`), e
   * é isso que torna "cancelar duas vezes" um no-op em vez de um 500 de
   * unicidade na cara de quem acabou de pedir para sair — o caso comum é o
   * duplo-clique.
   *
   * ⚠️ E ele ATUALIZA a data em vez de ignorar: se o ciclo vigente mudou (a
   * pessoa renovou entre um pedido e outro), a agenda tem que seguir o ciclo
   * novo, senão o cancelamento sairia ANTES do fim do mês que ela pagou.
   */
  static async schedule(conn, { provider, provider_ref, id_user = null, cancel_at, reason = null }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_subscription_end
         (provider, provider_ref, id_user, cancel_at, reason)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (provider, provider_ref) WHERE status = 'scheduled'
       DO UPDATE SET cancel_at  = EXCLUDED.cancel_at,
                     reason     = COALESCE(EXCLUDED.reason, public.tb_subscription_end.reason),
                     id_user    = COALESCE(EXCLUDED.id_user, public.tb_subscription_end.id_user),
                     updated_at = NOW()
       RETURNING *`,
      [provider, provider_ref, id_user, cancel_at, reason]
    );
    return rows[0] || null;
  }

  /** A agenda viva de uma assinatura, se houver. */
  static async getLive(conn, provider, provider_ref) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_subscription_end
        WHERE provider = $1 AND provider_ref = $2 AND status = 'scheduled'
        LIMIT 1`,
      [provider, provider_ref]
    );
    return rows[0] || null;
  }

  /**
   * O que já venceu e ainda não foi executado.
   *
   * ⚠️ `attempts < MAX_ATTEMPTS` está no WHERE, e não no JS: sem isso uma
   * assinatura apagada à mão no painel do gateway viraria erro a cada volta do
   * sweeper, para sempre, enchendo o log e escondendo as falhas reais.
   */
  static async listDue(conn, { limit = 50 } = {}) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_subscription_end
        WHERE status = 'scheduled'
          AND cancel_at <= NOW()
          AND attempts < $1
        ORDER BY cancel_at ASC
        LIMIT $2`,
      [MAX_ATTEMPTS, limit]
    );
    return rows;
  }

  static async markDone(conn, id_subscription_end) {
    const { rows } = await conn.query(
      `UPDATE public.tb_subscription_end
          SET status = 'done', executed_at = NOW(), updated_at = NOW(), last_error = NULL
        WHERE id_subscription_end = $1 AND status = 'scheduled'
        RETURNING *`,
      [id_subscription_end]
    );
    return rows[0] || null;
  }

  /**
   * Erro na tentativa.
   *
   * ⚠️ Só vira 'failed' no ÚLTIMO fôlego. Antes disso a linha continua
   * `scheduled` para o sweeper tentar de novo — um gateway fora do ar por meia
   * hora não pode transformar "pare de cobrar" em "desisti".
   */
  static async markAttemptFailed(conn, id_subscription_end, message) {
    const { rows } = await conn.query(
      `UPDATE public.tb_subscription_end
          SET attempts    = attempts + 1,
              last_error  = LEFT($2, 500),
              status      = CASE WHEN attempts + 1 >= $3 THEN 'failed' ELSE 'scheduled' END,
              updated_at  = NOW()
        WHERE id_subscription_end = $1
        RETURNING *`,
      [id_subscription_end, String(message || "erro desconhecido"), MAX_ATTEMPTS]
    );
    return rows[0] || null;
  }

  /** A pessoa voltou atrás: a agenda sai de cena sem cancelar nada. */
  static async release(conn, provider, provider_ref) {
    const { rows } = await conn.query(
      `UPDATE public.tb_subscription_end
          SET status = 'canceled', updated_at = NOW()
        WHERE provider = $1 AND provider_ref = $2 AND status = 'scheduled'
        RETURNING *`,
      [provider, provider_ref]
    );
    return rows[0] || null;
  }

  /** Para o radar de operação: quantas estão presas. */
  static async stuckCount(conn) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_subscription_end WHERE status = 'failed'`
    );
    return rows[0] ? rows[0].n : 0;
  }
}

SubscriptionEndStorage.MAX_ATTEMPTS = MAX_ATTEMPTS;

module.exports = SubscriptionEndStorage;
