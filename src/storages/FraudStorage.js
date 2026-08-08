// src/storages/FraudStorage.js
// SQL do painel de fraude (mig 201): contexto de cadastro, fatos pro score,
// fila de revisão e bloqueio de conta.

const { BURST_WINDOW_MINUTES } = require("../utils/fraudScore");

class FraudStorage {
  // ─── Contexto do cadastro ────────────────────────────────────────────────
  /**
   * Grava o contexto de um cadastro. Idempotente por usuário — o primeiro
   * registro vence (o cadastro só acontece uma vez; uma segunda chamada seria
   * um retry, e sobrescrever perderia o IP original).
   */
  static async recordSignupContext(
    conn,
    { id_user, signup_ip, user_agent, email_domain, signup_source },
  ) {
    await conn.query(
      `INSERT INTO public.tb_user_signup_context
         (id_user, signup_ip, user_agent, email_domain, signup_source)
       VALUES ($1, $2, $3, $4, COALESCE($5, 'email'))
       ON CONFLICT (id_user) DO NOTHING`,
      [
        id_user,
        signup_ip ? String(signup_ip).slice(0, 64) : null,
        user_agent ? String(user_agent).slice(0, 1000) : null,
        email_domain ? String(email_domain).toLowerCase().slice(0, 190) : null,
        signup_source || null,
      ],
    );
  }

  /**
   * Todos os fatos necessários pro fraudScore.evaluate, numa consulta só.
   * A UF vem do perfil-conta (onde o onboarding grava a cidade, mig 200) com
   * fallback pro tb_user.estado das contas antigas.
   */
  static async getFactsForUser(conn, id_user) {
    const r = await conn.query(
      `
      SELECT
        u.id_user,
        u.nome,
        u.cpf,
        u.email,
        COALESCE(acc.estado, u.estado)              AS uf,
        ctx.signup_ip,
        ctx.user_agent,
        ctx.signup_source,
        COALESCE(ctx.email_domain, LOWER(SPLIT_PART(u.email, '@', 2))) AS email_domain,

        -- Velocity: contas nascidas do MESMO IP (a própria inclusa). IP nulo
        -- não agrupa ninguém — contas antigas sem contexto ficam com 0.
        COALESCE((
          SELECT COUNT(*) FROM public.tb_user_signup_context c2
           WHERE c2.signup_ip IS NOT NULL
             AND c2.signup_ip = ctx.signup_ip
        ), 0)::int AS accounts_same_ip,

        COALESCE((
          SELECT COUNT(*) FROM public.tb_user_signup_context c3
           WHERE c3.signup_ip IS NOT NULL
             AND c3.signup_ip = ctx.signup_ip
             AND c3.created_at >= ctx.created_at - ($2 || ' minutes')::interval
             AND c3.created_at <= ctx.created_at + ($2 || ' minutes')::interval
        ), 0)::int AS accounts_same_ip_1h,

        -- Destino de repasse declarado (hoje só o afiliado tem campo próprio).
        aff.tax_id       AS payout_tax_id,
        aff.pix_key      AS payout_pix_key,
        aff.pix_key_type AS payout_pix_key_type
      FROM public.tb_user u
      LEFT JOIN public.tb_user_signup_context ctx ON ctx.id_user = u.id_user
      LEFT JOIN LATERAL (
        SELECT p.estado FROM public.tb_profile p
         WHERE p.id_user = u.id_user
           AND p.is_user_account = TRUE
           AND p.deleted_at IS NULL
         LIMIT 1
      ) acc ON TRUE
      LEFT JOIN public.tb_affiliate aff ON aff.id_user = u.id_user
      WHERE u.id_user = $1
      LIMIT 1
      `,
      [id_user, String(BURST_WINDOW_MINUTES)],
    );
    return r.rows[0] || null;
  }

  // ─── Fila de revisão ─────────────────────────────────────────────────────
  /**
   * Abre ou atualiza a revisão PENDENTE do usuário. Não reabre caso já
   * decidido: se um admin liberou a conta, uma reavaliação automática não pode
   * desfazer a decisão humana — só um novo bloqueio manual muda isso.
   */
  static async upsertPendingReview(conn, { id_user, score, reasons }) {
    const r = await conn.query(
      `
      INSERT INTO public.tb_fraud_review (id_user, score, reasons, status)
      VALUES ($1, $2, $3::jsonb, 'pending')
      ON CONFLICT (id_user) WHERE status = 'pending'
      DO UPDATE SET score      = EXCLUDED.score,
                    reasons    = EXCLUDED.reasons,
                    updated_at = NOW()
      RETURNING id_review, id_user, score, reasons, status, created_at
      `,
      [id_user, score, JSON.stringify(reasons || [])],
    );
    return r.rows[0];
  }

  /** Já existe decisão humana (cleared/watch/blocked) pra este usuário? */
  static async hasDecision(conn, id_user) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_fraud_review
        WHERE id_user = $1 AND status <> 'pending' LIMIT 1`,
      [id_user],
    );
    return r.rowCount > 0;
  }

  static async listQueue(conn, { status = "pending", q = null, limit = 50, offset = 0 }) {
    const r = await conn.query(
      `
      SELECT
        fr.id_review, fr.id_user, fr.score, fr.reasons, fr.status,
        fr.notes, fr.created_at, fr.decided_at,
        u.nome, u.username, u.email, u.created_at AS user_created_at,
        u.blocked_at,
        CASE WHEN u.cpf IS NULL THEN NULL ELSE
          SUBSTRING(u.cpf, 1, 3) || '.***.**' || SUBSTRING(u.cpf, 9, 1)
            || '-' || SUBSTRING(u.cpf, 10, 2)
        END AS cpf_masked,
        ctx.signup_ip, ctx.email_domain, ctx.signup_source,
        dec.username AS decided_by_username,
        COUNT(*) OVER () AS total_count
      FROM public.tb_fraud_review fr
      JOIN public.tb_user u ON u.id_user = fr.id_user
      LEFT JOIN public.tb_user_signup_context ctx ON ctx.id_user = fr.id_user
      LEFT JOIN public.tb_user dec ON dec.id_user = fr.decided_by
      WHERE ($1::text IS NULL OR fr.status = $1)
        AND (
          $2::text IS NULL
          OR u.username ILIKE '%' || $2 || '%'
          OR u.email    ILIKE '%' || $2 || '%'
          OR u.nome     ILIKE '%' || $2 || '%'
          OR ctx.signup_ip = $2
        )
      ORDER BY
        CASE WHEN fr.status = 'pending' THEN 0 ELSE 1 END,
        fr.score DESC,
        fr.created_at DESC
      LIMIT $3 OFFSET $4
      `,
      [status === "all" ? null : status, q || null, limit, offset],
    );
    const total = r.rows[0] ? Number(r.rows[0].total_count) : 0;
    return { rows: r.rows.map(({ total_count: _t, ...row }) => row), total };
  }

  static async getReview(conn, id_review) {
    const r = await conn.query(
      `
      SELECT
        fr.*,
        u.nome, u.username, u.email, u.created_at AS user_created_at,
        u.blocked_at, u.blocked_reason, u.data_nascimento,
        (u.cpf IS NOT NULL) AS has_cpf,
        CASE WHEN u.cpf IS NULL THEN NULL ELSE
          SUBSTRING(u.cpf, 1, 3) || '.***.**' || SUBSTRING(u.cpf, 9, 1)
            || '-' || SUBSTRING(u.cpf, 10, 2)
        END AS cpf_masked,
        ctx.signup_ip, ctx.user_agent, ctx.email_domain, ctx.signup_source,
        acc.estado AS uf, acc.municipio
      FROM public.tb_fraud_review fr
      JOIN public.tb_user u ON u.id_user = fr.id_user
      LEFT JOIN public.tb_user_signup_context ctx ON ctx.id_user = fr.id_user
      LEFT JOIN LATERAL (
        SELECT p.estado, p.municipio FROM public.tb_profile p
         WHERE p.id_user = fr.id_user AND p.is_user_account = TRUE
           AND p.deleted_at IS NULL LIMIT 1
      ) acc ON TRUE
      WHERE fr.id_review = $1
      LIMIT 1
      `,
      [id_review],
    );
    return r.rows[0] || null;
  }

  /** Vizinhos de IP — a evidência que o humano mais usa pra decidir. */
  static async listSameIpAccounts(conn, { signup_ip, exclude_user, limit = 25 }) {
    if (!signup_ip) return [];
    const r = await conn.query(
      `
      SELECT u.id_user, u.username, u.nome, u.email, u.created_at, u.blocked_at
        FROM public.tb_user_signup_context ctx
        JOIN public.tb_user u ON u.id_user = ctx.id_user
       WHERE ctx.signup_ip = $1
         AND ($2::uuid IS NULL OR u.id_user <> $2)
       ORDER BY u.created_at DESC
       LIMIT $3
      `,
      [signup_ip, exclude_user || null, limit],
    );
    return r.rows;
  }

  static async decideReview(conn, { id_review, status, notes, decided_by }) {
    const r = await conn.query(
      `UPDATE public.tb_fraud_review
          SET status     = $2,
              notes      = COALESCE($3, notes),
              decided_at = NOW(),
              decided_by = $4,
              updated_at = NOW()
        WHERE id_review = $1
        RETURNING id_review, id_user, status`,
      [id_review, status, notes || null, decided_by || null],
    );
    return r.rows[0] || null;
  }

  // ─── Bloqueio de conta ───────────────────────────────────────────────────
  static async setBlocked(conn, { id_user, blocked, reason, by_user }) {
    const r = await conn.query(
      `UPDATE public.tb_user
          SET blocked_at     = CASE WHEN $2 THEN NOW() ELSE NULL END,
              blocked_reason = CASE WHEN $2 THEN $3 ELSE NULL END,
              blocked_by     = CASE WHEN $2 THEN $4::uuid ELSE NULL END,
              updated_at     = NOW()
        WHERE id_user = $1
        RETURNING id_user, blocked_at`,
      [id_user, !!blocked, reason || null, by_user || null],
    );
    return r.rows[0] || null;
  }

  // ─── KPIs do painel ──────────────────────────────────────────────────────
  static async getDashboard(conn) {
    const r = await conn.query(
      `
      SELECT
        (SELECT COUNT(*) FROM public.tb_fraud_review WHERE status = 'pending')::int  AS pending,
        (SELECT COUNT(*) FROM public.tb_fraud_review WHERE status = 'watch')::int    AS watching,
        (SELECT COUNT(*) FROM public.tb_fraud_review
          WHERE status <> 'pending' AND decided_at >= NOW() - INTERVAL '30 days')::int AS decided_30d,
        (SELECT COUNT(*) FROM public.tb_user WHERE blocked_at IS NOT NULL)::int      AS blocked_total,
        (SELECT COALESCE(ROUND(AVG(score)), 0) FROM public.tb_fraud_review
          WHERE status = 'pending')::int                                             AS avg_pending_score,
        (SELECT COUNT(*) FROM public.tb_user u
          WHERE u.created_at >= NOW() - INTERVAL '7 days')::int                      AS signups_7d
      `,
    );
    return r.rows[0];
  }

  /**
   * Destinos de repasse divergentes — a aba que materializa a regra "o CPF que
   * recebe é o CPF da conta". Lista o que JÁ ESTÁ no banco fora da regra: o
   * gate novo barra escrita nova, mas o histórico precisa de olho humano.
   */
  static async listPayoutMismatches(conn, { limit = 100 }) {
    const r = await conn.query(
      `
      SELECT
        u.id_user, u.username, u.nome, u.email,
        (u.cpf IS NOT NULL) AS has_cpf,
        a.pix_key, a.pix_key_type, a.legal_name,
        REGEXP_REPLACE(COALESCE(a.tax_id, ''), '\\D', '', 'g') AS payout_digits,
        LENGTH(REGEXP_REPLACE(COALESCE(a.tax_id, ''), '\\D', '', 'g')) AS payout_len,
        a.updated_at
      FROM public.tb_affiliate a
      JOIN public.tb_user u ON u.id_user = a.id_user
      WHERE a.tax_id IS NOT NULL
        AND a.tax_id <> ''
        AND (
          -- CPF declarado que não é o da conta
          (LENGTH(REGEXP_REPLACE(a.tax_id, '\\D', '', 'g')) = 11
             AND REGEXP_REPLACE(a.tax_id, '\\D', '', 'g') IS DISTINCT FROM u.cpf)
          -- ou CNPJ: legítimo (MEI/empresa), mas não dá pra verificar offline
          OR LENGTH(REGEXP_REPLACE(a.tax_id, '\\D', '', 'g')) = 14
        )
      ORDER BY a.updated_at DESC
      LIMIT $1
      `,
      [limit],
    );
    return r.rows;
  }
}

module.exports = FraudStorage;
