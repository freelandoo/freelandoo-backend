// src/storages/TerritoryStorage.js
// SQL puro da árvore da residência (mig 202): território → endereço → unidade.
//
// Convenção do projeto: métodos estáticos que recebem `conn` (pool ou client de
// transação). Nenhum método aqui decide permissão — quem decide é o service.
//
// ⚠️ Os casts ::text explícitos NÃO são decoração. Quando o MESMO parâmetro é
// consumido por uma coluna (varchar) e por uma função (text) na mesma query, o
// Postgres tenta deduzir um tipo só e falha com "inconsistent types deduced for
// parameter" (42P08). É a mesma armadilha paga na mig 196; aqui ela aparece em
// todo get-or-create, porque o valor cru e a forma normalizada dele viajam
// juntos. Não remover os casts.
//
// Duas coisas atravessam o arquivo:
//   * a NORMALIZAÇÃO é feita no SQL (fl_norm_city / fl_norm_token), não no JS —
//     assim o índice único e a busca usam exatamente a mesma regra, e não há
//     como divergirem;
//   * todo get-or-create é escrito como INSERT ... ON CONFLICT DO NOTHING
//     seguido de SELECT, para que duas requisições simultâneas convirjam para a
//     MESMA linha em vez de uma delas estourar violação de unicidade.

class TerritoryStorage {
  /* ------------------------------- território ---------------------------- */

  /**
   * Encontra ou cria o território (UF, município, bairro). A região sai da
   * tb_region_city (migs 121–123) e pode ficar NULL sem quebrar nada — é o
   * mesmo comportamento tolerante da mig 200.
   *
   * Território marcado como `merged` devolve o SUCESSOR: quem cadastrar um
   * endereço numa grafia antiga cai automaticamente no território vencedor.
   */
  static async getOrCreateTerritory(conn, { uf, municipio, bairro, is_city_wide = false }) {
    const UF = String(uf || "").trim().toUpperCase().slice(0, 2);
    const city = String(municipio || "").trim().slice(0, 160);
    const hood = String(bairro || "").trim().slice(0, 160);
    if (!UF || !city) return null;

    await conn.query(
      `INSERT INTO public.tb_territory
         (uf, municipio_norm, municipio_label, bairro_norm, bairro_label,
          id_region, is_city_wide)
       VALUES
         ($1::text, fl_norm_city($2::text), $2::text,
          fl_norm_city($3::text), $3::text,
          (SELECT rc.id_region FROM public.tb_region_city rc
            WHERE rc.uf = $1::text AND rc.municipio_norm = fl_norm_city($2::text)),
          $4)
       ON CONFLICT (uf, municipio_norm, bairro_norm) DO NOTHING`,
      [UF, city, hood, !!is_city_wide]
    );

    const r = await conn.query(
      `SELECT t.*, COALESCE(m.id_territory, t.id_territory) AS effective_id
         FROM public.tb_territory t
         LEFT JOIN public.tb_territory m ON m.id_territory = t.merged_into
        WHERE t.uf = $1
          AND t.municipio_norm = fl_norm_city($2)
          AND t.bairro_norm = fl_norm_city($3)
        LIMIT 1`,
      [UF, city, hood]
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    if (row.status === "merged" && row.merged_into) {
      return this.getTerritoryById(conn, row.merged_into);
    }
    return row;
  }

  static async getTerritoryById(conn, id_territory) {
    const r = await conn.query(
      `SELECT * FROM public.tb_territory WHERE id_territory = $1 LIMIT 1`,
      [id_territory]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Territórios de uma cidade — base da descoberta por (cidade, bairro) (D5). */
  static async listByCity(conn, { uf, municipio, q = null, limit = 50 }) {
    const params = [String(uf || "").toUpperCase().slice(0, 2), municipio || ""];
    let filter = "";
    if (q) {
      params.push(`%${q}%`);
      filter = ` AND t.bairro_label ILIKE $${params.length}`;
    }
    params.push(Math.min(Number(limit) || 50, 200));
    const r = await conn.query(
      `SELECT t.id_territory, t.uf, t.municipio_label, t.bairro_label,
              t.id_region, t.is_city_wide
         FROM public.tb_territory t
        WHERE t.uf = $1
          AND t.municipio_norm = fl_norm_city($2)
          AND t.status = 'active'${filter}
        ORDER BY t.bairro_label
        LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }

  /**
   * Curadoria do admin: funde `from` em `into`. Os endereços são reapontados na
   * mesma transação — senão ficariam órfãos apontando para um território morto.
   */
  static async mergeTerritory(conn, { from_id, into_id }) {
    if (String(from_id) === String(into_id)) return null;
    await conn.query(
      `UPDATE public.tb_address SET id_territory = $2 WHERE id_territory = $1`,
      [from_id, into_id]
    );
    const r = await conn.query(
      `UPDATE public.tb_territory
          SET status = 'merged', merged_into = $2, updated_at = NOW()
        WHERE id_territory = $1 AND status = 'active'
        RETURNING id_territory, merged_into`,
      [from_id, into_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /* -------------------------------- endereço ----------------------------- */

  static async getOrCreateAddress(conn, { id_territory, cep, numero }) {
    const digits = String(cep || "").replace(/\D/g, "");
    const num = String(numero || "").trim().slice(0, 20);
    if (digits.length !== 8 || !num || !id_territory) return null;

    await conn.query(
      `INSERT INTO public.tb_address (id_territory, cep, numero, numero_norm)
            VALUES ($1, $2, $3::text, fl_norm_token($3::text))
       ON CONFLICT (cep, numero_norm) DO NOTHING`,
      [id_territory, digits, num]
    );
    const r = await conn.query(
      `SELECT * FROM public.tb_address
        WHERE cep = $1 AND numero_norm = fl_norm_token($2)
        LIMIT 1`,
      [digits, num]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getAddressById(conn, id_address) {
    const r = await conn.query(
      `SELECT a.*, t.uf, t.municipio_label, t.bairro_label, t.id_region
         FROM public.tb_address a
         JOIN public.tb_territory t ON t.id_territory = a.id_territory
        WHERE a.id_address = $1
        LIMIT 1`,
      [id_address]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Liga (ou desliga, com NULL) o perfil-condomínio a um endereço. */
  static async setAddressCondo(conn, id_address, id_condo_profile) {
    const r = await conn.query(
      `UPDATE public.tb_address
          SET id_condo_profile = $2
        WHERE id_address = $1
        RETURNING id_address, id_condo_profile`,
      [id_address, id_condo_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getAddressByCondo(conn, id_condo_profile) {
    const r = await conn.query(
      `SELECT a.*, t.uf, t.municipio_label, t.bairro_label
         FROM public.tb_address a
         JOIN public.tb_territory t ON t.id_territory = a.id_territory
        WHERE a.id_condo_profile = $1
        LIMIT 1`,
      [id_condo_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /* --------------------------------- unidade ----------------------------- */

  /**
   * Encontra ou cria a unidade. `label` NULL/vazio = casa (unidade única do
   * endereço) — normalizada para string vazia, que é o que o índice único usa.
   */
  static async getOrCreateUnit(conn, { id_address, id_block = null, label = null, source = "claimed" }) {
    if (!id_address) return null;
    const lbl = label === null || label === undefined ? null : String(label).trim().slice(0, 40) || null;
    const src = source === "generated" ? "generated" : "claimed";

    await conn.query(
      `INSERT INTO public.tb_residence_unit
         (id_address, id_block, label, label_norm, source)
       VALUES ($1, $2, $3::text, fl_norm_token(COALESCE($3::text, '')), $4)
       ON CONFLICT (id_address, (COALESCE(id_block, 0)), label_norm) DO NOTHING`,
      [id_address, id_block, lbl, src]
    );
    const r = await conn.query(
      `SELECT * FROM public.tb_residence_unit
        WHERE id_address = $1
          AND COALESCE(id_block, 0) = COALESCE($2::bigint, 0)
          AND label_norm = fl_norm_token(COALESCE($3, ''))
        LIMIT 1`,
      [id_address, id_block, lbl]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getUnitById(conn, id_unit) {
    const r = await conn.query(
      `SELECT u.*, a.id_territory, a.cep, a.numero, a.id_condo_profile
         FROM public.tb_residence_unit u
         JOIN public.tb_address a ON a.id_address = u.id_address
        WHERE u.id_unit = $1
        LIMIT 1`,
      [id_unit]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listUnits(conn, id_address) {
    const r = await conn.query(
      `SELECT u.id_unit, u.id_block, u.label, u.source, b.name AS block_name
         FROM public.tb_residence_unit u
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
        WHERE u.id_address = $1
        ORDER BY b.name NULLS FIRST, u.label NULLS FIRST`,
      [id_address]
    );
    return r.rows;
  }

  /**
   * Geração em lote da planta do condomínio (D10). Uma única INSERT com
   * ON CONFLICT DO NOTHING — rodar de novo com a mesma grade não duplica nada,
   * o que torna o botão do gestor seguro de apertar duas vezes.
   */
  static async bulkCreateUnits(conn, id_address, entries) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    const values = [];
    const params = [id_address];
    for (const e of entries) {
      params.push(e.id_block ?? null, e.label ?? null);
      const b = `$${params.length - 1}`;
      const l = `$${params.length}`;
      values.push(
        `($1, ${b}::bigint, ${l}::text, fl_norm_token(COALESCE(${l}::text, '')), 'generated')`
      );
    }
    const r = await conn.query(
      `INSERT INTO public.tb_residence_unit
         (id_address, id_block, label, label_norm, source)
       VALUES ${values.join(", ")}
       ON CONFLICT (id_address, (COALESCE(id_block, 0)), label_norm) DO NOTHING`,
      params
    );
    return r.rowCount;
  }

  /* ------------------------------ cache de CEP --------------------------- */

  static async getCachedCep(conn, cep) {
    const digits = String(cep || "").replace(/\D/g, "");
    if (digits.length !== 8) return null;
    const r = await conn.query(
      `SELECT * FROM public.tb_cep_cache WHERE cep = $1 LIMIT 1`,
      [digits]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async putCachedCep(conn, { cep, logradouro, bairro, localidade, uf, not_found = false }) {
    const digits = String(cep || "").replace(/\D/g, "");
    if (digits.length !== 8) return null;
    const r = await conn.query(
      `INSERT INTO public.tb_cep_cache
         (cep, logradouro, bairro, localidade, uf, not_found, fetched_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT (cep) DO UPDATE
         SET logradouro = EXCLUDED.logradouro,
             bairro     = EXCLUDED.bairro,
             localidade = EXCLUDED.localidade,
             uf         = EXCLUDED.uf,
             not_found  = EXCLUDED.not_found,
             fetched_at = NOW()
       RETURNING *`,
      [
        digits,
        logradouro || null,
        bairro || null,
        localidade || null,
        uf ? String(uf).toUpperCase().slice(0, 2) : null,
        !!not_found,
      ]
    );
    return r.rows[0];
  }
}

module.exports = TerritoryStorage;
