const pool = require("../databases");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ProductRequestMatchingService");

/**
 * Matching de Pedidos de Produto → Subperfis vendedores compatíveis.
 *
 * Critérios (MVP):
 *  - Subperfil não-clan, não deletado, ativo, visível.
 *  - Assinatura ativa em tb_profile_subscription.
 *  - Tem pelo menos 1 tb_profile_product ativo (is_active, sem deleted_at)
 *    na MESMA categoria do pedido.
 *  - Cidade + UF coincidem quando o pedido informa local (case-insensitive
 *    UPPER e TRIM). Se o pedido NÃO informa city/state, é considerado
 *    nacional: todos os subperfis elegíveis do país recebem.
 *
 * Notas:
 *  - Notificação fire-and-forget: chamamos findEligibleSubprofiles após
 *    criar o pedido para enfileirar notifs.
 *  - Mural do subperfil: listMuralForProfile filtra os pedidos relevantes
 *    ao perfil (pedidos abertos onde ele é elegível e ainda não respondeu).
 */
class ProductRequestMatchingService {
  static async findEligibleSubprofiles(id_product_request) {
    return runWithLogs(log, "findEligibleSubprofiles", () => ({ id_product_request }), async () => {
      const r = await pool.query(
        `SELECT DISTINCT p.id_profile, p.id_user
           FROM public.tb_product_request pr
           JOIN public.tb_profile_product pp
             ON pp.id_product_category = pr.id_product_category
            AND pp.is_active = TRUE
            AND pp.moderation_status = 'active'
            AND pp.deleted_at IS NULL
           JOIN public.tb_profile p
             ON p.id_profile = pp.id_profile
            AND p.is_clan = FALSE
            AND p.is_active = TRUE
            AND COALESCE(p.is_visible, TRUE) = TRUE
            AND p.deleted_at IS NULL
            AND (pr.state IS NULL OR UPPER(TRIM(p.estado)) = UPPER(TRIM(pr.state)))
            AND (pr.city  IS NULL OR UPPER(TRIM(p.municipio)) = UPPER(TRIM(pr.city)))
           JOIN public.tb_profile_subscription ps
             ON ps.id_profile = p.id_profile
            AND ps.status = 'active'
          WHERE pr.id_product_request = $1
            AND pr.moderation_status = 'active'`,
        [id_product_request]
      );
      return r.rows;
    });
  }

  static async listMuralForProfile(id_profile) {
    return runWithLogs(log, "listMuralForProfile", () => ({ id_profile }), async () => {
      // Lazy expire (idempotente, barato — UPDATE com WHERE índice).
      await pool.query(
        `UPDATE public.tb_product_request
            SET status = 'expired', expired_at = NOW(), updated_at = NOW()
          WHERE status = 'open'
            AND created_at < NOW() - INTERVAL '30 days'`
      );
      const r = await pool.query(
        `SELECT pr.id_product_request,
                pr.id_buyer_user,
                pr.title,
                pr.description,
                pr.city,
                pr.state,
                pr.min_price_cents,
                pr.max_price_cents,
                pr.reference_image_url,
                pr.status,
                pr.created_at,
                pr.id_product_category,
                pc.name AS category_name,
                pc.slug AS category_slug,
                u.username AS buyer_username,
                (SELECT COUNT(*)::INT FROM public.tb_product_request_response prr_all
                  WHERE prr_all.id_product_request = pr.id_product_request
                    AND prr_all.status != 'canceled') AS responses_count
           FROM public.tb_product_request pr
           JOIN public.tb_product_category pc
             ON pc.id_product_category = pr.id_product_category
           JOIN public.tb_user u
             ON u.id_user = pr.id_buyer_user
           JOIN public.tb_profile p
             ON p.id_profile = $1
            AND p.is_clan = FALSE
            AND p.is_active = TRUE
            AND COALESCE(p.is_visible, TRUE) = TRUE
            AND p.deleted_at IS NULL
            AND (pr.state IS NULL OR UPPER(TRIM(p.estado)) = UPPER(TRIM(pr.state)))
            AND (pr.city  IS NULL OR UPPER(TRIM(p.municipio)) = UPPER(TRIM(pr.city)))
           JOIN public.tb_profile_subscription ps
             ON ps.id_profile = p.id_profile
            AND ps.status = 'active'
          WHERE pr.status IN ('open','answered','negotiating')
            AND pr.moderation_status = 'active'
            AND EXISTS (
              SELECT 1 FROM public.tb_profile_product pp
               WHERE pp.id_profile = p.id_profile
                 AND pp.id_product_category = pr.id_product_category
                 AND pp.is_active = TRUE
                 AND pp.moderation_status = 'active'
                 AND pp.deleted_at IS NULL
            )
            AND NOT EXISTS (
              SELECT 1 FROM public.tb_product_request_response prr
               WHERE prr.id_product_request = pr.id_product_request
                 AND prr.id_profile = p.id_profile
                 AND prr.status NOT IN ('canceled')
            )
          ORDER BY pr.created_at DESC
          LIMIT 100`,
        [id_profile]
      );
      return r.rows;
    });
  }

  /**
   * Produtos próprios do subperfil compatíveis com a categoria do pedido,
   * usado pela UI quando o vendedor escolhe "Sugerir produto da minha loja".
   */
  static async listEligibleProductsForRequest(id_profile, id_product_request) {
    return runWithLogs(log, "listEligibleProductsForRequest", () => ({ id_profile, id_product_request }), async () => {
      const r = await pool.query(
        `SELECT pp.id_profile_product, pp.name, pp.price_amount, pp.stock_quantity, pp.is_active
           FROM public.tb_profile_product pp
           JOIN public.tb_product_request pr
             ON pr.id_product_request = $2
            AND pr.id_product_category = pp.id_product_category
          WHERE pp.id_profile = $1
            AND pp.deleted_at IS NULL
            AND pp.is_active = TRUE
          ORDER BY pp.created_at DESC`,
        [id_profile, id_product_request]
      );
      return r.rows;
    });
  }
}

module.exports = ProductRequestMatchingService;
