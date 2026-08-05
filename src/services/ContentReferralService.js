const pool = require("../databases");
const AffiliateStorage = require("../storages/AffiliateStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ContentReferralService");

const ITEM_TYPES = new Set(["product", "course", "service"]);

/**
 * Cupom de conteúdo (mig 194) — regime USUÁRIO.
 *
 * Quem compartilha o produto/curso/serviço de outro leva a comissão daquele
 * item, e essa atribuição **sobrepõe o vínculo vitalício**: foi quem divulgou
 * aquele conteúdo que trabalhou pela venda.
 *
 * Não expira e não depende de aba aberta — o oposto do sessionStorage que
 * existia antes. Último toque vence.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Converte o identificador que veio da URL no MESMO identificador que o
 * webhook usa na venda. Devolve null quando o item não existe.
 */
async function canonicalItemId(item_type, raw) {
  if (item_type === "course") {
    if (UUID_RE.test(raw)) return raw;
    const { rows } = await pool.query(
      `SELECT id FROM public.courses WHERE slug = $1 LIMIT 1`,
      [String(raw).toLowerCase()]
    );
    return rows[0]?.id || null;
  }
  // Produto e serviço: id numérico nas duas pontas.
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? String(n) : null;
}

function normalizeToken(raw) {
  const t = String(raw || "").trim();
  if (!t || t.length > 64) return null;
  return /^[A-Za-z0-9_-]{8,64}$/.test(t) ? t : null;
}

/**
 * Registra que o visitante abriu um conteúdo por um link com ?cupom=.
 * Chamado pelo front SÓ quando a URL traz o cupom — navegação normal não
 * escreve nada.
 */
async function touch({ user, body }) {
  return runWithLogs(
    log,
    "touch",
    () => ({ item_type: body?.item_type, has_user: !!user?.id_user }),
    async () => {
      const item_type = String(body?.item_type || "").trim();
      const item_id = String(body?.item_id || "").trim();
      const code = String(body?.coupon_code || "").trim().toUpperCase();
      const visitor_token = normalizeToken(body?.visitor_token);
      const id_user = user?.id_user || null;

      if (!ITEM_TYPES.has(item_type)) return { error: "item_type inválido" };
      if (!item_id || item_id.length > 64) return { error: "item_id inválido" };

      // A URL pública do curso traz o SLUG, mas o webhook conhece o curso pelo
      // UUID. Sem normalizar aqui, a atribuição gravada nunca casaria com a
      // venda. Produto e serviço já usam id numérico nas duas pontas.
      const canonicalId = await canonicalItemId(item_type, item_id);
      if (!canonicalId) return { ok: true, attributed: false };
      if (!code) return { error: "coupon_code obrigatório" };
      if (!id_user && !visitor_token) return { error: "visitor_token obrigatório" };

      const { rows } = await pool.query(
        `SELECT c.id_coupon, c.owner_user_id, a.id_affiliate
           FROM tb_coupon c
           JOIN tb_affiliate a ON a.id_user = c.owner_user_id
          WHERE c.code = $1
            AND c.is_active = TRUE
            AND (c.expires_at IS NULL OR c.expires_at > NOW())
            AND a.status = 'ACTIVE'
          LIMIT 1`,
        [code]
      );
      const coupon = rows[0];
      // Cupom inexistente/expirado ou dono não-afiliado: silêncio, não é erro
      // do visitante.
      if (!coupon) return { ok: true, attributed: false };

      // Ninguém se auto-atribui.
      if (id_user && String(coupon.owner_user_id) === String(id_user)) {
        return { ok: true, attributed: false };
      }

      if (id_user) {
        await pool.query(
          `INSERT INTO tb_content_referral
             (id_user_visitor, item_type, item_id, id_coupon, id_affiliate)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id_user_visitor, item_type, item_id)
             WHERE id_user_visitor IS NOT NULL
           DO UPDATE SET id_coupon = EXCLUDED.id_coupon,
                         id_affiliate = EXCLUDED.id_affiliate,
                         last_seen_at = NOW()`,
          [id_user, item_type, canonicalId, coupon.id_coupon, coupon.id_affiliate]
        );
      } else {
        await pool.query(
          `INSERT INTO tb_content_referral
             (visitor_token, item_type, item_id, id_coupon, id_affiliate)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (visitor_token, item_type, item_id)
             WHERE id_user_visitor IS NULL
           DO UPDATE SET id_coupon = EXCLUDED.id_coupon,
                         id_affiliate = EXCLUDED.id_affiliate,
                         last_seen_at = NOW()`,
          [visitor_token, item_type, canonicalId, coupon.id_coupon, coupon.id_affiliate]
        );
      }

      return { ok: true, attributed: true };
    }
  );
}

/**
 * Casa as atribuições anônimas com a conta, no login/cadastro. Sem isto, quem
 * clica deslogado, cria conta e compra depois some da atribuição.
 *
 * Conflito (a conta já tinha atribuição para o mesmo item): a do USUÁRIO vence
 * — ela é mais recente ou mais confiável que a do dispositivo.
 */
async function claimVisitorToken(id_user, rawToken) {
  const visitor_token = normalizeToken(rawToken);
  if (!id_user || !visitor_token) return { claimed: 0 };
  try {
    const { rowCount } = await pool.query(
      `UPDATE tb_content_referral t
          SET id_user_visitor = $1, visitor_token = NULL, last_seen_at = NOW()
        WHERE t.visitor_token = $2
          AND t.id_user_visitor IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM tb_content_referral u
             WHERE u.id_user_visitor = $1
               AND u.item_type = t.item_type
               AND u.item_id = t.item_id
          )`,
      [id_user, visitor_token]
    );
    // O que sobrou (conflito) é lixo do dispositivo — remove.
    await pool.query(
      `DELETE FROM tb_content_referral
        WHERE visitor_token = $1 AND id_user_visitor IS NULL`,
      [visitor_token]
    );
    if (rowCount > 0) log.info("content_referral.claimed", { id_user, count: rowCount });
    return { claimed: rowCount };
  } catch (err) {
    log.error("content_referral.claim.fail", { message: err.message });
    return { claimed: 0 };
  }
}

/**
 * Atribuição de conteúdo do comprador para um item. É o que sobrepõe o vínculo
 * no regime usuário.
 */
async function resolveForItem(conn, { id_user, item_type, item_id }) {
  try {
    if (!id_user || !ITEM_TYPES.has(item_type) || !item_id) return null;
    const { rows } = await conn.query(
      `SELECT t.*, c.code
         FROM tb_content_referral t
         JOIN tb_coupon c ON c.id_coupon = t.id_coupon
         JOIN tb_affiliate a ON a.id_affiliate = t.id_affiliate
        WHERE t.id_user_visitor = $1
          AND t.item_type = $2
          AND t.item_id = $3
          AND c.is_active = TRUE
          AND a.status = 'ACTIVE'
        LIMIT 1`,
      [id_user, item_type, String(item_id)]
    );
    const row = rows[0] || null;
    if (!row) return null;
    // Dono do item não ganha do próprio item — checado no webhook, que conhece
    // o vendedor. Aqui só devolvemos a atribuição.
    return row;
  } catch (err) {
    log.error("content_referral.resolve.fail", { message: err.message });
    return null;
  }
}

/** Item vendido, no vocabulário desta tabela. */
function itemFromMeta(meta) {
  if (meta?.type === "profile_product_order" && meta.id_profile_product) {
    return { item_type: "product", item_id: String(meta.id_profile_product) };
  }
  if (meta?.type === "course_purchase" && meta.course_id) {
    return { item_type: "course", item_id: String(meta.course_id) };
  }
  if (meta?.type === "booking_deposit" && meta.id_profile_service) {
    return { item_type: "service", item_id: String(meta.id_profile_service) };
  }
  return null;
}

module.exports = {
  touch,
  claimVisitorToken,
  resolveForItem,
  itemFromMeta,
  __test: { normalizeToken },
};

// Reexport para quem precisar checar afiliado ativo sem importar o storage.
module.exports.getAffiliateById = AffiliateStorage.getAffiliateById;
