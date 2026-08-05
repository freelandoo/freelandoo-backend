// src/storages/CondoListingStorage.js
// SQL dos anúncios internos do condomínio e das vagas de publicação (mig 198).
//
// Cota = free (condo_settings, com override por condomínio em tb_condo_config)
// + vagas compradas. O que conta contra a cota são os anúncios ATIVOS: ao
// arquivar um, a vaga volta a ficar disponível.

class CondoListingStorage {
  /* ------------------------------- anúncios ------------------------------ */

  static async create(conn, { id_condo, id_user, kind, title, description, price_cents, contact, image_url }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_listing
         (id_condo, id_user, kind, title, description, price_cents, contact, image_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id_listing, id_condo, id_user, kind, title, description,
                 price_cents, contact, image_url, status, created_at`,
      [
        id_condo,
        id_user,
        kind,
        title,
        description ?? null,
        price_cents ?? null,
        contact ?? null,
        image_url ?? null,
      ]
    );
    return r.rows[0];
  }

  static async getById(conn, id_condo, id_listing) {
    const r = await conn.query(
      `SELECT id_listing, id_condo, id_user, kind, title, description,
              price_cents, contact, image_url, status, created_at
         FROM public.tb_condo_listing
        WHERE id_condo = $1 AND id_listing = $2
        LIMIT 1`,
      [id_condo, id_listing]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // O quadro do condomínio nunca expõe a unidade de quem anuncia — só o nome
  // e o @ do morador. Onde a pessoa mora não vaza por aqui.
  static async list(conn, id_condo, { kind, id_user = null, status = "active", limit = 50, offset = 0 } = {}) {
    const params = [id_condo];
    let filter = "";
    if (kind) {
      params.push(kind);
      filter += ` AND l.kind = $${params.length}`;
    }
    if (id_user) {
      params.push(id_user);
      filter += ` AND l.id_user = $${params.length}`;
    }
    if (status && status !== "all") {
      params.push(status);
      filter += ` AND l.status = $${params.length}`;
    }
    params.push(Math.min(Number(limit) || 50, 100));
    params.push(Number(offset) || 0);

    const r = await conn.query(
      `SELECT l.id_listing, l.id_user, l.kind, l.title, l.description,
              l.price_cents, l.contact, l.image_url, l.status, l.created_at,
              u.username AS owner_username,
              u.nome     AS owner_name,
              hp.avatar_url AS owner_avatar
         FROM public.tb_condo_listing l
         JOIN public.tb_user u ON u.id_user = l.id_user
         LEFT JOIN LATERAL (
           SELECT avatar_url
             FROM public.tb_profile
            WHERE id_user = l.id_user
              AND is_clan = FALSE AND is_community = FALSE
              AND deleted_at IS NULL
            ORDER BY xp_total DESC
            LIMIT 1
         ) hp ON TRUE
        WHERE l.id_condo = $1 ${filter}
        ORDER BY l.created_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async setStatus(conn, id_condo, id_listing, status) {
    // archived_at calculado no JS ($4): o mesmo parâmetro em coluna e em CASE
    // deduz tipos inconsistentes (text × varchar).
    const r = await conn.query(
      `UPDATE public.tb_condo_listing
          SET status      = $3,
              archived_at = $4,
              updated_at  = NOW()
        WHERE id_condo = $1 AND id_listing = $2
        RETURNING id_listing, status`,
      [id_condo, id_listing, status, status === "archived" ? new Date() : null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async update(conn, id_condo, id_listing, fields) {
    const sets = ["updated_at = NOW()"];
    const vals = [id_condo, id_listing];
    let i = 3;
    for (const key of ["title", "description", "price_cents", "contact", "image_url"]) {
      if (fields[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        vals.push(fields[key]);
      }
    }
    const r = await conn.query(
      `UPDATE public.tb_condo_listing SET ${sets.join(", ")}
        WHERE id_condo = $1 AND id_listing = $2
        RETURNING id_listing, kind, title, description, price_cents, contact,
                  image_url, status`,
      vals
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async countActive(conn, id_condo, id_user, kind) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_condo_listing
        WHERE id_condo = $1 AND id_user = $2 AND kind = $3 AND status = 'active'`,
      [id_condo, id_user, kind]
    );
    return r.rows[0]?.n || 0;
  }

  /* --------------------------- cota e configuração ----------------------- */

  // Global (condo_settings id=1) com override por condomínio (tb_condo_config).
  // COALESCE resolve os dois numa consulta só — NULL no override = herda.
  static async getEffectiveSettings(conn, id_condo) {
    const r = await conn.query(
      `SELECT COALESCE(c.free_service_listings,   s.free_service_listings)   AS free_service_listings,
              COALESCE(c.free_product_listings,   s.free_product_listings)   AS free_product_listings,
              COALESCE(c.extra_slot_price_cents,  s.extra_slot_price_cents)  AS extra_slot_price_cents,
              COALESCE(c.extra_slot_price_polens, s.extra_slot_price_polens) AS extra_slot_price_polens
         FROM public.condo_settings s
         LEFT JOIN public.tb_condo_config c ON c.id_condo = $1
        WHERE s.id = 1
        LIMIT 1`,
      [id_condo]
    );
    const row = r.rows[0] || {};
    return {
      free_service_listings: Number(row.free_service_listings ?? 2),
      free_product_listings: Number(row.free_product_listings ?? 2),
      extra_slot_price_cents: Number(row.extra_slot_price_cents ?? 990),
      extra_slot_price_polens: Number(row.extra_slot_price_polens ?? 0),
    };
  }

  static async upsertConfig(conn, id_condo, fields) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_config
         (id_condo, free_service_listings, free_product_listings,
          extra_slot_price_cents, extra_slot_price_polens)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (id_condo) DO UPDATE
         SET free_service_listings   = EXCLUDED.free_service_listings,
             free_product_listings   = EXCLUDED.free_product_listings,
             extra_slot_price_cents  = EXCLUDED.extra_slot_price_cents,
             extra_slot_price_polens = EXCLUDED.extra_slot_price_polens,
             updated_at              = NOW()
       RETURNING *`,
      [
        id_condo,
        fields.free_service_listings ?? null,
        fields.free_product_listings ?? null,
        fields.extra_slot_price_cents ?? null,
        fields.extra_slot_price_polens ?? null,
      ]
    );
    return r.rows[0];
  }

  /* ------------------------------- vagas --------------------------------- */

  static async countPaidSlots(conn, id_condo, id_user, kind) {
    const r = await conn.query(
      `SELECT COALESCE(SUM(quantity), 0)::int AS n
         FROM public.tb_condo_listing_slot
        WHERE id_condo = $1 AND id_user = $2 AND kind = $3
          AND status = 'paid' AND refunded_at IS NULL`,
      [id_condo, id_user, kind]
    );
    return r.rows[0]?.n || 0;
  }

  static async createSlotPurchase(conn, {
    id_condo,
    id_user,
    kind,
    quantity = 1,
    payment_provider = "stripe",
    amount_cents = 0,
    amount_polens = 0,
    status = "pending",
    stripe_session_id = null,
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_listing_slot
         (id_condo, id_user, kind, quantity, payment_provider, amount_cents,
          amount_polens, status, stripe_session_id, paid_at)
       -- paid_at vem pronto do JS ($10): reusar $8 dentro de um CASE faz o
       -- Postgres deduzir tipos inconsistentes para o mesmo parâmetro.
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id_slot, id_condo, id_user, kind, quantity, payment_provider,
                 amount_cents, amount_polens, status, stripe_session_id, created_at`,
      [
        id_condo,
        id_user,
        kind,
        quantity,
        payment_provider,
        amount_cents,
        amount_polens,
        status,
        stripe_session_id,
        status === "paid" ? new Date() : null,
      ]
    );
    return r.rows[0];
  }

  static async getSlotBySession(conn, stripe_session_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_condo_listing_slot
        WHERE stripe_session_id = $1
        LIMIT 1`,
      [stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Idempotente: só sai de 'pending'. Devolve null quando já estava paga.
  static async markSlotPaid(conn, stripe_session_id, stripe_payment_intent_id = null) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing_slot
          SET status = 'paid',
              paid_at = NOW(),
              stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id)
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_slot, id_condo, id_user, kind, quantity, amount_cents`,
      [stripe_session_id, stripe_payment_intent_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getSlotByPaymentIntent(conn, stripe_payment_intent_id) {
    const r = await conn.query(
      `SELECT * FROM public.tb_condo_listing_slot
        WHERE stripe_payment_intent_id = $1
        LIMIT 1`,
      [stripe_payment_intent_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async markSlotRefundedById(conn, id_slot) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing_slot
          SET status = 'refunded', refunded_at = NOW()
        WHERE id_slot = $1 AND refunded_at IS NULL
        RETURNING id_slot, id_condo, id_user, kind, quantity`,
      [id_slot]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async markSlotCanceled(conn, stripe_session_id) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing_slot
          SET status = 'canceled'
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING id_slot`,
      [stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Estorno total: a vaga some do saldo. Anúncios já publicados NÃO são
  // apagados — quem tira do ar é a administração/o próprio morador.
  static async markSlotRefunded(conn, stripe_session_id) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing_slot
          SET status = 'refunded', refunded_at = NOW()
        WHERE stripe_session_id = $1 AND refunded_at IS NULL
        RETURNING id_slot, id_condo, id_user, kind, quantity`,
      [stripe_session_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listSlotPurchases(conn, id_condo, id_user) {
    const r = await conn.query(
      `SELECT id_slot, kind, quantity, payment_provider, amount_cents,
              amount_polens, status, created_at, paid_at
         FROM public.tb_condo_listing_slot
        WHERE id_condo = $1 AND id_user = $2
        ORDER BY created_at DESC
        LIMIT 50`,
      [id_condo, id_user]
    );
    return r.rows;
  }
}

module.exports = CondoListingStorage;
