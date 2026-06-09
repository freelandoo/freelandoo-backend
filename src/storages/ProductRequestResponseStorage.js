class ProductRequestResponseStorage {
  static async create(conn, {
    id_product_request, id_seller_user, id_profile, id_profile_product,
    message, proposed_price_cents,
  }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_product_request_response
        (id_product_request, id_seller_user, id_profile, id_profile_product,
         message, proposed_price_cents)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id_product_request, id_profile) DO UPDATE
         SET message = EXCLUDED.message,
             proposed_price_cents = EXCLUDED.proposed_price_cents,
             id_profile_product = EXCLUDED.id_profile_product,
             status = CASE
               WHEN tb_product_request_response.status IN ('rejected','canceled')
                 THEN tb_product_request_response.status
               ELSE 'sent'
             END,
             updated_at = NOW()
       RETURNING *`,
      [
        id_product_request, id_seller_user, id_profile,
        id_profile_product || null,
        message,
        proposed_price_cents ?? null,
      ]
    );
    return rows[0];
  }

  static async getByPair(conn, id_product_request, id_profile) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_product_request_response
        WHERE id_product_request = $1 AND id_profile = $2
        LIMIT 1`,
      [id_product_request, id_profile]
    );
    return rows[0] || null;
  }

  static async listByRequest(conn, id_product_request) {
    const { rows } = await conn.query(
      `SELECT prr.*,
              p.display_name, p.avatar_url, p.sub_profile_slug,
              pp.name AS suggested_product_name, pp.price_amount AS suggested_product_price
         FROM public.tb_product_request_response prr
         JOIN public.tb_profile p ON p.id_profile = prr.id_profile
    LEFT JOIN public.tb_profile_product pp ON pp.id_profile_product = prr.id_profile_product
        WHERE prr.id_product_request = $1
        ORDER BY prr.created_at DESC`,
      [id_product_request]
    );
    return rows;
  }

  // Respostas enviadas por qualquer subperfil do vendedor (lado vendedor).
  static async listBySellerUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT prr.*,
              p.display_name AS my_profile_name,
              pp.name AS suggested_product_name,
              pp.price_amount AS suggested_product_price,
              pr.title AS request_title,
              pr.description AS request_description,
              pr.city AS request_city,
              pr.state AS request_state,
              pr.status AS request_status,
              pr.id_product_category,
              pcat.name AS category_name,
              buyer.username AS buyer_username
         FROM public.tb_product_request_response prr
         JOIN public.tb_profile p ON p.id_profile = prr.id_profile
         JOIN public.tb_product_request pr ON pr.id_product_request = prr.id_product_request
         JOIN public.tb_user buyer ON buyer.id_user = pr.id_buyer_user
    LEFT JOIN public.tb_profile_product pp ON pp.id_profile_product = prr.id_profile_product
    LEFT JOIN public.tb_product_category pcat ON pcat.id_product_category = pr.id_product_category
        WHERE prr.id_seller_user = $1
        ORDER BY prr.created_at DESC`,
      [id_user]
    );
    return rows;
  }

  static async getById(conn, id_response) {
    const { rows } = await conn.query(
      `SELECT * FROM public.tb_product_request_response WHERE id_response = $1 LIMIT 1`,
      [id_response]
    );
    return rows[0] || null;
  }

  // ── Thread de mensagens (chat na O.S.) ──────────────────────────────────────
  static async insertMessage(conn, { id_response, sender, content }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_product_request_message (id_response, sender, content)
       VALUES ($1, $2, $3)
       RETURNING id_message, id_response, sender, content, created_at`,
      [id_response, sender, content]
    );
    // Toca updated_at da resposta para reordenar a lista de O.S.
    await conn.query(
      `UPDATE public.tb_product_request_response SET updated_at = NOW() WHERE id_response = $1`,
      [id_response]
    );
    return rows[0];
  }

  static async listMessages(conn, id_response) {
    const { rows } = await conn.query(
      `SELECT id_message, id_response, sender, content, created_at
         FROM public.tb_product_request_message
        WHERE id_response = $1
        ORDER BY created_at ASC`,
      [id_response]
    );
    return rows;
  }

  static async markReadByBuyer(conn, id_response) {
    await conn.query(
      `UPDATE public.tb_product_request_response SET buyer_last_read_at = NOW() WHERE id_response = $1`,
      [id_response]
    );
  }

  static async markReadBySeller(conn, id_response) {
    await conn.query(
      `UPDATE public.tb_product_request_response SET seller_last_read_at = NOW() WHERE id_response = $1`,
      [id_response]
    );
  }

  // Lado COMPRADOR: 1 chat por resposta recebida nos pedidos do comprador.
  static async listChatsForBuyer(conn, id_buyer_user) {
    const { rows } = await conn.query(
      `SELECT prr.id_response,
              prr.status                AS response_status,
              prr.created_at            AS response_created_at,
              prr.message               AS seller_message,
              prr.proposed_price_cents,
              prr.updated_at,
              p.id_profile, p.display_name, p.avatar_url, p.sub_profile_slug,
              su.username               AS seller_username,
              p.is_clan,
              pr.id_product_request, pr.title, pr.description, pr.city, pr.state,
              pr.status                 AS request_status,
              pcat.name                 AS category_name,
              lm.content                AS last_message,
              lm.created_at             AS last_message_at,
              (SELECT COUNT(*)::INT FROM public.tb_product_request_message m
                WHERE m.id_response = prr.id_response AND m.sender = 'PRO'
                  AND (prr.buyer_last_read_at IS NULL OR m.created_at > prr.buyer_last_read_at)
              ) AS unread_count
         FROM public.tb_product_request_response prr
         JOIN public.tb_product_request pr ON pr.id_product_request = prr.id_product_request
         JOIN public.tb_profile p ON p.id_profile = prr.id_profile
         JOIN public.tb_user su ON su.id_user = prr.id_seller_user
    LEFT JOIN public.tb_product_category pcat ON pcat.id_product_category = pr.id_product_category
    LEFT JOIN LATERAL (
           SELECT content, created_at FROM public.tb_product_request_message
            WHERE id_response = prr.id_response ORDER BY created_at DESC LIMIT 1
         ) lm ON TRUE
        WHERE pr.id_buyer_user = $1 AND prr.status <> 'canceled'
        ORDER BY COALESCE(lm.created_at, prr.created_at) DESC`,
      [id_buyer_user]
    );
    return rows;
  }

  // Lado VENDEDOR: 1 chat por resposta enviada por qualquer subperfil do user.
  static async listChatsForSeller(conn, id_seller_user) {
    const { rows } = await conn.query(
      `SELECT prr.id_response,
              prr.status                AS response_status,
              prr.created_at            AS response_created_at,
              prr.message               AS seller_message,
              prr.proposed_price_cents,
              prr.updated_at,
              prr.id_profile,
              p.display_name            AS my_profile_name,
              pr.id_product_request, pr.title, pr.description, pr.city, pr.state,
              pr.status                 AS request_status,
              pcat.name                 AS category_name,
              buyer.username            AS buyer_username,
              lm.content                AS last_message,
              lm.created_at             AS last_message_at,
              (SELECT COUNT(*)::INT FROM public.tb_product_request_message m
                WHERE m.id_response = prr.id_response AND m.sender = 'USER'
                  AND (prr.seller_last_read_at IS NULL OR m.created_at > prr.seller_last_read_at)
              ) AS unread_count
         FROM public.tb_product_request_response prr
         JOIN public.tb_product_request pr ON pr.id_product_request = prr.id_product_request
         JOIN public.tb_profile p ON p.id_profile = prr.id_profile
         JOIN public.tb_user buyer ON buyer.id_user = pr.id_buyer_user
    LEFT JOIN public.tb_product_category pcat ON pcat.id_product_category = pr.id_product_category
    LEFT JOIN LATERAL (
           SELECT content, created_at FROM public.tb_product_request_message
            WHERE id_response = prr.id_response ORDER BY created_at DESC LIMIT 1
         ) lm ON TRUE
        WHERE prr.id_seller_user = $1 AND prr.status <> 'canceled'
        ORDER BY COALESCE(lm.created_at, prr.created_at) DESC`,
      [id_seller_user]
    );
    return rows;
  }

  static async countByRequest(conn, id_product_request) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::INT AS total
         FROM public.tb_product_request_response
        WHERE id_product_request = $1
          AND status != 'canceled'`,
      [id_product_request]
    );
    return rows[0]?.total || 0;
  }
}

module.exports = ProductRequestResponseStorage;
