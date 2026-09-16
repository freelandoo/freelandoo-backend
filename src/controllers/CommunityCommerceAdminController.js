// src/controllers/CommunityCommerceAdminController.js
// A tela de admin do comércio entre vizinhos: a tabela de preços do delivery
// (mig 248) e a régua da venda na vitrine (mig 249).
//
// ⚠️ ESTA TELA É A RAZÃO DE AS DUAS TABELAS EXISTIREM. Preço em constante no
// service é a armadilha da mig 244, e ela custou meses de uma tela de admin que
// escrevia num lugar que ninguém lia.

const pool = require("../databases");
const { listDeliveryTypes, isDeliveryKind } = require("../utils/deliveryPricing");
const { getListingSettings } = require("../utils/listingOrder");
const { sendServiceResult } = require("../utils/sendServiceResult");
const { createLogger } = require("../utils/logger");

const log = createLogger("CommunityCommerceAdmin");

class CommunityCommerceAdminController {
  static async getSettings(req, res) {
    // `onlyActive: false` de propósito: a tela de admin precisa VER o tipo
    // desligado para poder religá-lo. Só a tela do morador filtra.
    const [types, listing] = await Promise.all([
      listDeliveryTypes(pool, { onlyActive: false }),
      getListingSettings(pool),
    ]);
    return sendServiceResult(res, { delivery_types: types, listing_settings: listing });
  }

  static async updateDeliveryType(req, res) {
    const kind = req.params?.kind;
    if (!isDeliveryKind(kind)) {
      return sendServiceResult(res, { error: "Tipo inválido.", statusCode: 400 });
    }
    const b = req.body || {};
    const num = (v, min, max, fallback) => {
      const n = Math.round(Number(v));
      if (!Number.isFinite(n)) return fallback;
      return Math.min(max, Math.max(min, n));
    };

    const { rows } = await pool.query(
      `UPDATE public.tb_community_delivery_settings
          SET label            = COALESCE($2, label),
              price_cents      = COALESCE($3, price_cents),
              expires_minutes  = COALESCE($4, expires_minutes),
              confirm_hours    = COALESCE($5, confirm_hours),
              is_active        = COALESCE($6, is_active),
              updated_at       = NOW(),
              updated_by       = $7
        WHERE kind = $1
        RETURNING *`,
      [
        kind,
        b.label ? String(b.label).trim().slice(0, 80) : null,
        // Teto de R$ 1.000 por corrida: é conferência de digitação, não regra
        // de negócio — um zero a mais num campo de preço cobra do vizinho dez
        // vezes o combinado, e esse erro não tem desfazer.
        b.price_cents === undefined ? null : num(b.price_cents, 0, 100000, 0),
        b.expires_minutes === undefined ? null : num(b.expires_minutes, 5, 43200, 1440),
        b.confirm_hours === undefined ? null : num(b.confirm_hours, 1, 720, 24),
        b.is_active === undefined ? null : b.is_active !== false,
        req.user?.id_user || null,
      ]
    );
    if (!rows[0]) return sendServiceResult(res, { error: "Tipo não encontrado.", statusCode: 404 });
    log.info("delivery_type.updated", { kind, by: req.user?.id_user });
    return sendServiceResult(res, { delivery_type: rows[0] });
  }

  static async updateListingSettings(req, res) {
    const b = req.body || {};
    const { rows } = await pool.query(
      `UPDATE public.tb_community_listing_settings
          SET platform_fee_cents   = COALESCE($1, platform_fee_cents),
              platform_fee_percent = COALESCE($2, platform_fee_percent),
              holdback_days        = COALESCE($3, holdback_days),
              confirm_days         = COALESCE($4, confirm_days),
              is_active            = COALESCE($5, is_active),
              updated_at           = NOW(),
              updated_by           = $6
        WHERE id = 1
        RETURNING *`,
      [
        b.platform_fee_cents === undefined
          ? null
          : Math.max(0, Math.round(Number(b.platform_fee_cents) || 0)),
        b.platform_fee_percent === undefined
          ? null
          : Math.min(99, Math.max(0, Number(b.platform_fee_percent) || 0)),
        // ⚠️ O HOLDBACK PODE SER ENCURTADO MAS NÃO ZERADO SEM INTENÇÃO: ele
        // existe por causa do CDC (7 dias de arrependimento numa compra
        // remota). Zero é aceito — é decisão de quem administra —, mas o teto
        // de 60 evita o dedo escorregado que prenderia dinheiro por dois anos.
        b.holdback_days === undefined
          ? null
          : Math.min(60, Math.max(0, Math.round(Number(b.holdback_days) || 0))),
        b.confirm_days === undefined
          ? null
          : Math.min(60, Math.max(1, Math.round(Number(b.confirm_days) || 7))),
        b.is_active === undefined ? null : b.is_active !== false,
        req.user?.id_user || null,
      ]
    );
    log.info("listing_settings.updated", { by: req.user?.id_user });
    return sendServiceResult(res, { listing_settings: rows[0] });
  }
}

module.exports = CommunityCommerceAdminController;
