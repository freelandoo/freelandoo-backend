// src/services/MeuMundoShareService.js
//
// A8 — botão "Compartilhar" do Meu Mundo. Devolve o código de afiliado da
// pessoa (o MESMO cupom da área de afiliados) e a % da regra do Meu Mundo
// (mig 350). Quem ainda não é afiliado vira agora; quem não tem cupom ganha um
// pelo caminho de sempre (CouponService.create). Afiliado suspenso não ganha
// link novo.

const pool = require("../databases");
const AffiliateStorage = require("../storages/AffiliateStorage");
const AffiliateProgramStorage = require("../storages/AffiliateProgramStorage");
const CouponStorage = require("../storages/CouponStorage");
const CouponService = require("./CouponService");
const { MM_AFFILIATE_CONTEXT, MM_AFFILIATE_DEFAULT_PERCENT } = require("../utils/meuMundoAffiliate");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("MeuMundoShareService");

async function link(id_user) {
  return runWithLogs(log, "link", () => ({ id_user }), async () => {
    if (!id_user) return { error: "Não autenticado", statusCode: 401 };

    let affiliate = await AffiliateStorage.getAffiliateByUserId(pool, id_user);
    if (!affiliate) {
      affiliate = await AffiliateStorage.upsertAffiliate(pool, {
        id_user,
        status: "ACTIVE",
        created_by: id_user,
      });
      log.info("affiliate.auto_registered_meu_mundo", { id_user });
    }
    if (!affiliate || affiliate.status !== "ACTIVE" || affiliate.is_active === false) {
      return { error: "Seu cadastro de afiliado está suspenso", statusCode: 403, code: "affiliate_blocked" };
    }

    const listed = await CouponStorage.listByUser(pool, id_user, { is_active: true, limit: 1, offset: 0 });
    let coupon = listed?.data?.[0] ?? null;
    if (!coupon) coupon = await CouponService.create({ id_user });
    if (!coupon?.code) return { error: "Não foi possível gerar seu código", statusCode: 500 };

    const rule = await AffiliateProgramStorage.getRule(pool, MM_AFFILIATE_CONTEXT).catch(() => null);
    const percent = rule ? Number(rule.percent) : MM_AFFILIATE_DEFAULT_PERCENT;

    return {
      code: coupon.code,
      percent,
      enabled: rule ? rule.is_enabled === true : false,
    };
  });
}

module.exports = { link };
