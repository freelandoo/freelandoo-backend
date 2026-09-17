// src/storages/AiProviderStorage.js
// SQL puro das chaves de LLM do admin (mig 253).
//
// ⚠️ `api_key_sealed` NUNCA sai daqui em claro para quem lê. Os SELECTs
// públicos deste arquivo projetam campo a campo e OMITEM a coluna selada; quem
// precisa da chave para chamar o modelo usa `getSealedFor`, que existe
// separada justamente para que um `SELECT *` distraído não a carregue para
// dentro de uma resposta HTTP.

/** As colunas que podem ser vistas. A selada não está aqui, e é de propósito. */
const PUBLIC_COLS = `
  provider, label, key_hint, model, is_enabled, priority,
  price_in_mtok, price_out_mtok, last_ok_at, last_error,
  created_at, updated_at
`;

class AiProviderStorage {
  /** Todas as chaves cadastradas, na ordem em que serão tentadas. */
  static async list(conn) {
    const { rows } = await conn.query(
      `SELECT ${PUBLIC_COLS}
         FROM public.tb_ai_provider_key
        ORDER BY priority ASC, provider ASC`
    );
    return rows;
  }

  /**
   * As chaves utilizáveis, COM o segredo, na ordem de tentativa.
   *
   * ⚠️ A ordem é `priority` e depois `provider` — nunca a de inserção. Sem o
   * desempate pelo nome, dois provedores com a mesma prioridade trocariam de
   * lugar entre dois deploys e o custo mudaria sem ninguém ter mexido em nada.
   */
  static async listUsable(conn) {
    const { rows } = await conn.query(
      `SELECT provider, api_key_sealed, model, priority,
              price_in_mtok, price_out_mtok
         FROM public.tb_ai_provider_key
        WHERE is_enabled = TRUE
        ORDER BY priority ASC, provider ASC`
    );
    return rows;
  }

  static async get(conn, provider) {
    const { rows } = await conn.query(
      `SELECT ${PUBLIC_COLS}
         FROM public.tb_ai_provider_key WHERE provider = $1 LIMIT 1`,
      [provider]
    );
    return rows[0] || null;
  }

  /** A linha COM o segredo. Só para quem vai falar com o modelo. */
  static async getSealedFor(conn, provider) {
    const { rows } = await conn.query(
      `SELECT provider, api_key_sealed, model, price_in_mtok, price_out_mtok
         FROM public.tb_ai_provider_key WHERE provider = $1 LIMIT 1`,
      [provider]
    );
    return rows[0] || null;
  }

  /**
   * Grava a chave (upsert por provedor).
   *
   * ⚠️ `api_key_sealed` e `key_hint` só são tocados quando vem chave nova:
   * editar só o modelo não pode apagar o segredo.
   *
   * ⚠️ E O COALESCE DO `DO UPDATE` NÃO BASTA — foi um defeito real, pego pela
   * suíte. O Postgres monta a tupla proposta e confere o `NOT NULL` ANTES de
   * detectar o conflito: com `api_key_sealed` nulo o INSERT estoura e nunca
   * chega ao ramo do UPDATE. Por isso o valor antigo é resgatado por SUBSELECT
   * aqui dentro — o que também mantém o segredo dentro do banco numa edição,
   * em vez de trazê-lo ao JS só para devolvê-lo.
   *
   * ⚠️ O CAST `::varchar(16)` NOS SUBSELECTS NÃO É ENFEITE — é o 42P08 de
   * sempre: `$1` serve de VALOR da coluna e de COMPARAÇÃO dentro do subselect,
   * e o Postgres recusa com "inconsistent types deduced for parameter $1".
   * Mesma armadilha já paga nas migs 202–204 e 224.
   */
  static async upsert(conn, { provider, label, api_key_sealed, key_hint, model, is_enabled, priority, price_in_mtok, price_out_mtok, updated_by }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_ai_provider_key
         (provider, label, api_key_sealed, key_hint, model, is_enabled, priority,
          price_in_mtok, price_out_mtok, updated_by)
       VALUES (
         $1,
         $2,
         COALESCE($3, (SELECT k.api_key_sealed FROM public.tb_ai_provider_key k WHERE k.provider = $1::varchar(16))),
         COALESCE($4, (SELECT k.key_hint       FROM public.tb_ai_provider_key k WHERE k.provider = $1::varchar(16))),
         COALESCE($5, (SELECT k.model          FROM public.tb_ai_provider_key k WHERE k.provider = $1::varchar(16))),
         COALESCE($6, TRUE),
         COALESCE($7, 1),
         $8,$9,$10
       )
       ON CONFLICT (provider) DO UPDATE SET
         label          = COALESCE(EXCLUDED.label, public.tb_ai_provider_key.label),
         api_key_sealed = COALESCE(EXCLUDED.api_key_sealed, public.tb_ai_provider_key.api_key_sealed),
         key_hint       = COALESCE(EXCLUDED.key_hint, public.tb_ai_provider_key.key_hint),
         model          = COALESCE(EXCLUDED.model, public.tb_ai_provider_key.model),
         is_enabled     = COALESCE(EXCLUDED.is_enabled, public.tb_ai_provider_key.is_enabled),
         priority       = COALESCE(EXCLUDED.priority, public.tb_ai_provider_key.priority),
         -- ⚠️ PREÇO é ESTADO COMPLETO, e não COALESCE: é preciso poder LIMPAR
         -- o preço (voltar para "não informado"). Quem chama manda o valor
         -- desejado; o AiSettingsService funde com o que já existia antes de
         -- chegar aqui, para que a tela possa mandar só o que mudou.
         price_in_mtok  = EXCLUDED.price_in_mtok,
         price_out_mtok = EXCLUDED.price_out_mtok,
         updated_by     = EXCLUDED.updated_by,
         updated_at     = NOW()
       RETURNING ${PUBLIC_COLS}`,
      [
        provider,
        label ?? null,
        api_key_sealed ?? null,
        key_hint ?? null,
        model ?? null,
        is_enabled ?? null,
        priority ?? null,
        price_in_mtok ?? null,
        price_out_mtok ?? null,
        updated_by ?? null,
      ]
    );
    return rows[0];
  }

  static async remove(conn, provider) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_ai_provider_key WHERE provider = $1`,
      [provider]
    );
    return rowCount > 0;
  }

  /** Carimba o resultado da última chamada — é o que a tela mostra como saúde. */
  static async markResult(conn, provider, { ok, error }) {
    await conn.query(
      `UPDATE public.tb_ai_provider_key
          SET last_ok_at  = CASE WHEN $2::boolean THEN NOW() ELSE last_ok_at END,
              last_error  = $3,
              updated_at  = NOW()
        WHERE provider = $1`,
      [provider, !!ok, ok ? null : String(error || "").slice(0, 500)]
    );
  }
}

module.exports = AiProviderStorage;
