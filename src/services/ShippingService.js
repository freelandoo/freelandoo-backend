const pool = require("../databases");
const ProfileProductStorage = require("../storages/ProfileProductStorage");
const { calculateShipping } = require("../integrations/melhorenvio/calculateShipping");
const { lookupZipcode } = require("../integrations/viacep/lookup");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ShippingService");

// Limites das transportadoras de encomenda comum (Correios PAC/SEDEX,
// Jadlog .Package/.Com). Acima disso, todas recusam e o produto cai pra
// "combine retirada com o vendedor".
const MAX_SUM_CM = 200;
const MAX_SIDE_CM = 105;
const MAX_WEIGHT_G = 30000;

function checkShippingLimits({ height_cm, width_cm, length_cm, weight_grams }) {
  const h = Number(height_cm) || 0;
  const w = Number(width_cm) || 0;
  const l = Number(length_cm) || 0;
  const g = Number(weight_grams) || 0;
  const sum = h + w + l;
  const biggest = Math.max(h, w, l);

  const reasons = [];
  if (sum > MAX_SUM_CM) reasons.push("sum");
  if (biggest > MAX_SIDE_CM) reasons.push("side");
  if (g > MAX_WEIGHT_G) reasons.push("weight");
  return {
    exceeded: reasons.length > 0,
    reasons,
    limits: { max_sum_cm: MAX_SUM_CM, max_side_cm: MAX_SIDE_CM, max_weight_g: MAX_WEIGHT_G },
    actual: { sum_cm: sum, biggest_side_cm: biggest, weight_g: g },
  };
}

const CACHE = new Map();
const TTL_MS = 5 * 60 * 1000;

function cacheKey({ id_profile_product, origin, destination, qty }) {
  return `${id_profile_product}|${origin}|${destination}|${qty}`;
}

function cacheGet(key) {
  const entry = CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    CACHE.delete(key);
    return null;
  }
  return entry.value;
}

function cacheSet(key, value) {
  CACHE.set(key, { ts: Date.now(), value });
}

function normalizeCep(z) {
  if (z == null) return null;
  const d = String(z).replace(/\D/g, "");
  return d.length === 8 ? d : null;
}

class ShippingService {
  static async quote({ id_profile, id_profile_product, destination_zipcode, quantity = 1 }) {
    return runWithLogs(log, "quote", () => ({ id_profile_product, destination_zipcode }), async () => {
      const destCep = normalizeCep(destination_zipcode);
      if (!destCep) return { error: "CEP de destino inválido (8 dígitos)" };

      const product = await ProfileProductStorage.getWithOwner(pool, Number(id_profile_product));
      if (!product || !product.is_active || product.deleted_at) {
        return { error: "Produto não encontrado" };
      }
      if (id_profile && String(product.id_profile) !== String(id_profile)) {
        return { error: "Produto não encontrado" };
      }
      if (product.profile_is_clan) return { error: "Produto não encontrado" };
      if (!product.profile_is_paid) return { error: "Loja indisponível" };

      // Retirada no local — vendedor combina entrega direto. Não consulta
      // transportadora, frontend mostra contato do vendedor.
      if (product.delivery_mode === "local_pickup") {
        return {
          mode: "local_pickup",
          origin_zipcode: null,
          destination_zipcode: destCep,
          destination_address: await lookupZipcode(destCep).catch(() => null),
          options: [],
        };
      }

      // Dimensões/peso fora dos limites das transportadoras — nem chama o
      // Melhor Envio (ia retornar erro em todos os carriers). Frontend mostra
      // "excedeu o limite, combine retirada com o vendedor".
      const limitCheck = checkShippingLimits({
        height_cm: product.height_cm,
        width_cm: product.width_cm,
        length_cm: product.length_cm,
        weight_grams: product.weight_grams,
      });
      if (limitCheck.exceeded) {
        return {
          mode: "shipping",
          exceeded_limits: true,
          exceeded_reasons: limitCheck.reasons,
          limits: limitCheck.limits,
          actual: limitCheck.actual,
          origin_zipcode: null,
          destination_zipcode: destCep,
          destination_address: await lookupZipcode(destCep).catch(() => null),
          options: [],
        };
      }

      const originCep = normalizeCep(product.origin_zipcode_override) ||
        normalizeCep(product.profile_origin_zipcode);
      if (!originCep) return { error: "Vendedor não configurou CEP de origem" };

      const qty = Math.max(1, Math.min(99, Number(quantity) || 1));
      const key = cacheKey({
        id_profile_product: product.id_profile_product,
        origin: originCep,
        destination: destCep,
        qty,
      });
      const hit = cacheGet(key);
      if (hit) return hit;

      const [destination_address, options] = await Promise.all([
        lookupZipcode(destCep),
        calculateShipping({
          origin_zipcode: originCep,
          destination_zipcode: destCep,
          product: {
            id_profile_product: product.id_profile_product,
            price_amount: product.price_amount,
            weight_grams: product.weight_grams,
            height_cm: product.height_cm,
            width_cm: product.width_cm,
            length_cm: product.length_cm,
            quantity: qty,
          },
        }),
      ]);

      const result = {
        mode: "shipping",
        origin_zipcode: originCep,
        destination_zipcode: destCep,
        destination_address,
        options,
      };
      cacheSet(key, result);
      return result;
    });
  }
}

module.exports = ShippingService;
