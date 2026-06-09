// src/storages/MarketStorage.js
//
// Leitura/escrita do cache de mercado (tb_market_snapshot / tb_market_news).
// O front só lê via getSnapshot; o scheduler escreve via upsertMany.

module.exports = {
  /**
   * UPSERT em lote dos itens de mercado.
   * @param {import('pg').Pool} db
   * @param {Array<{symbol,kind,label,price,change_pct,currency,logo_url,rank}>} items
   */
  async upsertMany(db, items) {
    if (!Array.isArray(items) || items.length === 0) return 0;
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      for (const it of items) {
        await client.query(
          `
          INSERT INTO public.tb_market_snapshot
            (symbol, kind, label, price, change_pct, currency, logo_url, rank, updated_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
          ON CONFLICT (symbol) DO UPDATE SET
            kind       = EXCLUDED.kind,
            label      = EXCLUDED.label,
            price      = EXCLUDED.price,
            change_pct = EXCLUDED.change_pct,
            currency   = EXCLUDED.currency,
            logo_url   = COALESCE(EXCLUDED.logo_url, public.tb_market_snapshot.logo_url),
            rank       = EXCLUDED.rank,
            updated_at = NOW()
          `,
          [
            it.symbol,
            it.kind || "stock",
            it.label,
            it.price ?? null,
            it.change_pct ?? null,
            it.currency || "BRL",
            it.logo_url ?? null,
            Number.isFinite(it.rank) ? it.rank : 0,
          ]
        );
      }
      await client.query("COMMIT");
      return items.length;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },

  /**
   * Snapshot completo para o widget: cotações (índices/moedas) + ações,
   * já ordenado por rank. Inclui o updated_at mais recente.
   */
  async getSnapshot(db) {
    const { rows } = await db.query(
      `
      SELECT symbol, kind, label,
             price::float8       AS price,
             change_pct::float8  AS change_pct,
             currency, logo_url, rank, updated_at
        FROM public.tb_market_snapshot
       ORDER BY kind, rank, symbol
      `
    );
    const quotes = rows.filter((r) => r.kind === "quote");
    const stocks = rows.filter((r) => r.kind === "stock");
    const updated_at = rows.reduce(
      (max, r) => (r.updated_at > max ? r.updated_at : max),
      null
    );
    return { quotes, stocks, updated_at };
  },

  /** Manchetes mais recentes (v2). Limite pequeno pro widget. */
  async listNews(db, limit = 8) {
    const { rows } = await db.query(
      `
      SELECT id, source, category, title, url, thumb_url, published_at
        FROM public.tb_market_news
       ORDER BY published_at DESC NULLS LAST, fetched_at DESC
       LIMIT $1
      `,
      [Math.min(20, Math.max(1, limit))]
    );
    return rows;
  },
};
