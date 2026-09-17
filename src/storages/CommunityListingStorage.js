// src/storages/CommunityListingStorage.js
// SQL das VITRINES de serviços e produtos das comunidades territoriais
// (condomínio e bairro) e das vagas de publicação (mig 198).
//
// ─── ⚠️ A VITRINE É MENSAL (mig 252) ────────────────────────────────────────
//
// Quem tem prazo é o ANÚNCIO, não o morador: cada linha carrega `paid_until`,
// e a vitrine só mostra `status='active' AND paid_until > NOW()`. A vigência é
// LAZY, lida no SELECT — não existe job que expira anúncio, pela mesma razão
// que o bee não tem um: um sweeper seria uma segunda verdade sobre a mesma
// data, e falhando ele deixaria no ar o anúncio de quem parou de pagar.
//
// ⚠️ `paid_until IS NULL` É RASCUNHO (nunca pago), e rascunho não aparece para
// os vizinhos. Toda leitura pública passa por `paid: "live"`; só o dono, com
// `paid: "all"`, enxerga o que ainda não foi pago ou já venceu.
//
// A cota grátis (`free_*_listings`) continua existindo e hoje vale ZERO — é o
// kill-switch de um eventual período de cortesia, não código morto.
//
// ─── ⚠️ O NOME FÍSICO É LEGADO, E FICA ──────────────────────────────────────
//
// A tabela chama-se `tb_condo_listing` e a coluna de dono do quadro chama-se
// `id_condo` — os dois nomes da mig 198, de quando a vitrine só existia no
// condomínio. Hoje ela serve BAIRRO também, e `id_condo` guarda o
// `id_profile` da comunidade territorial, seja ela qual for.
//
// Renomear quebraria a mig 198, que o runner re-executa em banco virgem e
// cujo checksum ele confere no boot (erro = exit 1, produção fora do ar). É a
// mesma regra de `tb_machine` (guarda enxames), `tb_story` (guarda bees),
// `tb_games_presence` (guarda a presença do Financeiro) e `evolution_instance`
// (guarda o `phone_number_id` da Cloud API). O rename é só de APLICAÇÃO: o
// storage e o service falam "comunidade", o banco continua dizendo "condo".

class CommunityListingStorage {
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
              price_cents, contact, image_url, status, created_at,
              paid_until, subscription_ref, subscription_provider,
              subscription_status,
              -- COALESCE porque NULL > NOW() e NULL, nao FALSE: sem ele o
              -- rascunho (paid_until nulo) devolveria is_live nulo, e a tela
              -- que testasse === false nunca o reconheceria como fora do ar.
              -- (crase e proibida aqui: isto vive dentro de um template literal.)
              COALESCE(status = 'active' AND paid_until > NOW(), FALSE) AS is_live
         FROM public.tb_condo_listing
        WHERE id_condo = $1 AND id_listing = $2
        LIMIT 1`,
      [id_condo, id_listing]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Sem o id da comunidade: é por aqui que o WEBHOOK acha o anúncio, e ele só
  // tem o que veio na cobrança. Uso interno — a porta do morador continua
  // passando por `getById`, que escopa na comunidade.
  static async getByIdRaw(conn, id_listing) {
    const r = await conn.query(
      `SELECT id_listing, id_condo, id_user, kind, title, status, paid_until,
              subscription_ref, subscription_provider, subscription_status
         FROM public.tb_condo_listing
        WHERE id_listing = $1
        LIMIT 1`,
      [id_listing]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getBySubscriptionRef(conn, subscription_ref) {
    const r = await conn.query(
      `SELECT id_listing, id_condo, id_user, kind, title, status, paid_until,
              subscription_ref, subscription_provider, subscription_status
         FROM public.tb_condo_listing
        WHERE subscription_ref = $1
        LIMIT 1`,
      [subscription_ref]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // O quadro do condomínio nunca expõe a unidade de quem anuncia — só o nome
  // e o @ do morador. Onde a pessoa mora não vaza por aqui.
  //
  // ⚠️ `paid` É O FILTRO DE VIGÊNCIA E O DEFAULT É O SEGURO ("live"). Quem
  // esquecer de passá-lo publica para os vizinhos o anúncio que ninguém pagou
  // — e o sintoma não é erro nenhum, é a vitrine simplesmente deixar de cobrar.
  // Só a lista do próprio dono pede "all".
  static async list(
    conn,
    id_condo,
    { kind, id_user = null, status = "active", paid = "live", limit = 50, offset = 0 } = {}
  ) {
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
    // NOW() vai literal: é função do banco, não parâmetro. Comparar com um
    // instante mandado pelo cliente deixaria a vigência na mão de quem chama.
    if (paid === "live") filter += " AND l.paid_until > NOW()";
    params.push(Math.min(Number(limit) || 50, 100));
    params.push(Number(offset) || 0);

    const r = await conn.query(
      `SELECT l.id_listing, l.id_user, l.kind, l.title, l.description,
              l.price_cents, l.contact, l.image_url, l.status, l.created_at,
              l.paid_until, l.subscription_ref, l.subscription_status,
              COALESCE(l.status = 'active' AND l.paid_until > NOW(), FALSE) AS is_live,
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

  /* ----------------------------- vigência -------------------------------- */

  //
  // ⚠️ `GREATEST(paid_until, NOW())` É O CORAÇÃO DA RENOVAÇÃO, e errá-lo custa
  // dinheiro nos DOIS sentidos. Somando sempre a partir de NOW(), quem renova
  // faltando 20 dias PERDE esses 20 dias. Somando sempre a partir de
  // `paid_until`, quem voltou meses depois ganharia de graça todo o tempo em
  // que esteve fora do ar.
  //
  // O mês vem do banco (INTERVAL '1 month'), não de "30 dias" em JS: é ele que
  // acerta fevereiro e o horário de verão, e é a mesma data que a pessoa vê.
  static async extendPaidUntil(conn, id_listing, months = 1) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing
          SET paid_until = GREATEST(COALESCE(paid_until, NOW()), NOW())
                           + ($2::int * INTERVAL '1 month'),
              updated_at = NOW()
        WHERE id_listing = $1
        RETURNING id_listing, id_condo, id_user, kind, paid_until`,
      [id_listing, Math.max(1, Number(months) || 1)]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  //
  // Devolve o tempo que uma cobrança estornada tinha comprado.
  //
  // ⚠️ MÉTODO PRÓPRIO, E NÃO `extendPaidUntil(-1)`: aquele fixa o mínimo em 1
  // mês (`Math.max(1, …)`), então um mês negativo viraria positivo e o ESTORNO
  // daria mais trinta dias de graça a quem acabou de receber o dinheiro de
  // volta. Erro que não aparece em lugar nenhum — o anúncio simplesmente
  // continua no ar.
  static async shrinkPaidUntil(conn, id_listing, months = 1) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing
          SET paid_until = paid_until - ($2::int * INTERVAL '1 month'),
              updated_at = NOW()
        WHERE id_listing = $1 AND paid_until IS NOT NULL
        RETURNING id_listing, paid_until`,
      [id_listing, Math.max(1, Number(months) || 1)]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Grava a assinatura recém-autorizada no anúncio. Só o caminho do CARTÃO
  // chega aqui — Pix e Poléns deixam as três colunas em NULL de propósito.
  static async attachSubscription(conn, id_listing, { ref, provider, status = "active" }) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing
          SET subscription_ref      = $2,
              subscription_provider = $3,
              subscription_status   = $4,
              updated_at            = NOW()
        WHERE id_listing = $1
        RETURNING id_listing, subscription_ref, subscription_status`,
      [id_listing, ref, provider || null, status]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async setSubscriptionStatus(conn, id_listing, status) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing
          SET subscription_status = $2,
              updated_at          = NOW()
        WHERE id_listing = $1
        RETURNING id_listing, subscription_status, paid_until`,
      [id_listing, status]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  //
  // ⚠️ SOLTAR A ASSINATURA NÃO MEXE EM `paid_until`, E ISSO É A REGRA INTEIRA:
  // o mês já pago é de quem pagou. Cancelar tira a renovação automática, não o
  // anúncio do ar — ele sai sozinho quando a data vencer.
  static async detachSubscription(conn, id_listing) {
    const r = await conn.query(
      `UPDATE public.tb_condo_listing
          SET subscription_ref      = NULL,
              subscription_provider = NULL,
              subscription_status   = 'canceled',
              updated_at            = NOW()
        WHERE id_listing = $1
        RETURNING id_listing, paid_until`,
      [id_listing]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Quantos anúncios do morador estão de fato no ar (pagos e vigentes).
  static async countLive(conn, id_condo, id_user, kind) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_condo_listing
        WHERE id_condo = $1 AND id_user = $2 AND kind = $3
          AND status = 'active' AND paid_until > NOW()`,
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
              COALESCE(c.extra_slot_price_polens, s.extra_slot_price_polens) AS extra_slot_price_polens,
              COALESCE(c.listing_monthly_cents,   s.listing_monthly_cents)   AS listing_monthly_cents,
              COALESCE(c.listing_monthly_polens,  s.listing_monthly_polens)  AS listing_monthly_polens
         FROM public.condo_settings s
         LEFT JOIN public.tb_condo_config c ON c.id_condo = $1
        WHERE s.id = 1
        LIMIT 1`,
      [id_condo]
    );
    const row = r.rows[0] || {};
    // ⚠️ O default da cota aqui é ZERO, e não 2. Ele só vale quando a linha
    // global some do banco — e nesse caso o lado seguro é a vitrine COBRAR, não
    // dar dois anúncios de graça a todo mundo por causa de um SELECT vazio.
    return {
      free_service_listings: Number(row.free_service_listings ?? 0),
      free_product_listings: Number(row.free_product_listings ?? 0),
      extra_slot_price_cents: Number(row.extra_slot_price_cents ?? 990),
      extra_slot_price_polens: Number(row.extra_slot_price_polens ?? 0),
      listing_monthly_cents: Number(row.listing_monthly_cents ?? 350),
      listing_monthly_polens: Number(row.listing_monthly_polens ?? 350),
    };
  }

  static async upsertConfig(conn, id_condo, fields) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_config
         (id_condo, free_service_listings, free_product_listings,
          extra_slot_price_cents, extra_slot_price_polens,
          listing_monthly_cents, listing_monthly_polens)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id_condo) DO UPDATE
         SET free_service_listings   = EXCLUDED.free_service_listings,
             free_product_listings   = EXCLUDED.free_product_listings,
             extra_slot_price_cents  = EXCLUDED.extra_slot_price_cents,
             extra_slot_price_polens = EXCLUDED.extra_slot_price_polens,
             listing_monthly_cents   = EXCLUDED.listing_monthly_cents,
             listing_monthly_polens  = EXCLUDED.listing_monthly_polens,
             updated_at              = NOW()
       RETURNING *`,
      [
        id_condo,
        fields.free_service_listings ?? null,
        fields.free_product_listings ?? null,
        fields.extra_slot_price_cents ?? null,
        fields.extra_slot_price_polens ?? null,
        fields.listing_monthly_cents ?? null,
        fields.listing_monthly_polens ?? null,
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

  // Uma linha por COBRANÇA do anúncio (mig 252): a compra do primeiro mês, cada
  // renovação da assinatura e cada mês comprado por Pix ou Poléns.
  static async createSlotPurchase(conn, {
    id_condo,
    id_user,
    kind,
    id_listing = null,
    quantity = 1,
    payment_provider = "stripe",
    amount_cents = 0,
    amount_polens = 0,
    status = "pending",
    stripe_session_id = null,
    invoice_ref = null,
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_listing_slot
         (id_condo, id_user, kind, id_listing, quantity, payment_provider,
          amount_cents, amount_polens, status, stripe_session_id, invoice_ref,
          paid_at)
       -- paid_at vem pronto do JS ($12): reusar $9 dentro de um CASE faz o
       -- Postgres deduzir tipos inconsistentes para o mesmo parâmetro.
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id_slot, id_condo, id_user, kind, id_listing, quantity,
                 payment_provider, amount_cents, amount_polens, status,
                 stripe_session_id, invoice_ref, created_at`,
      [
        id_condo,
        id_user,
        kind,
        id_listing,
        quantity,
        payment_provider,
        amount_cents,
        amount_polens,
        status,
        stripe_session_id,
        invoice_ref,
        status === "paid" ? new Date() : null,
      ]
    );
    return r.rows[0];
  }

  //
  // ⚠️ A RENOVAÇÃO DO CARTÃO NÃO PASSA POR CHECKOUT — ela chega como fatura, e
  // o webhook é at-least-once. Sem este INSERT deduplicado por `invoice_ref`,
  // uma re-entrega empurraria o `paid_until` do assinante mais um mês de graça
  // a cada vez. O UNIQUE parcial é quem recusa; aqui o conflito vira `null`,
  // que o service lê como "esta fatura já foi creditada".
  static async recordRenewalOnce(conn, {
    id_condo,
    id_user,
    kind,
    id_listing,
    payment_provider,
    amount_cents = 0,
    invoice_ref,
  }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_listing_slot
         (id_condo, id_user, kind, id_listing, quantity, payment_provider,
          amount_cents, status, invoice_ref, paid_at)
       VALUES ($1, $2, $3, $4, 1, $5, $6, 'paid', $7, NOW())
       ON CONFLICT (invoice_ref) WHERE invoice_ref IS NOT NULL DO NOTHING
       RETURNING id_slot, id_listing`,
      [id_condo, id_user, kind, id_listing, payment_provider, amount_cents, invoice_ref]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Carimba o período que a cobrança cobriu, depois que a vigência foi empurrada.
  static async setSlotPeriod(conn, id_slot, { period_start, period_end }) {
    await conn.query(
      `UPDATE public.tb_condo_listing_slot
          SET period_start = $2, period_end = $3
        WHERE id_slot = $1`,
      [id_slot, period_start ?? null, period_end ?? null]
    );
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
        RETURNING id_slot, id_condo, id_user, kind, id_listing, quantity, amount_cents`,
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

module.exports = CommunityListingStorage;
