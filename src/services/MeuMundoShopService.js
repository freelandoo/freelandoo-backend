// src/services/MeuMundoShopService.js
//
// MEU MUNDO 3D — o VENDEDOR do centro (mm3d-37e): casas (nível da casa da
// residência) e cores do carro, em moedas do jogo. A conversa só acontece com
// a pessoa na sala dele (o supermercado, segundo a sala do centro). O débito
// e a troca vão na MESMA transação da vida (carteira travada); a sala viva do
// bairro recebe a casa/cor nova depois do COMMIT.

const pool = require("../databases");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const Shop = require("../utils/meuMundoShop");
const { MAX_LEVEL, isSelectableLevel } = require("../utils/meuMundoLayout");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.shop");
// O vendedor fica na sala "Imóveis e Veículos" do supermercado.
const SELLER_PLACE = "supermercado";

const ERR = {
  away: ["Converse com o vendedor na sala dele, no supermercado do centro", 409],
  noHouse: ["Você ainda não tem casa no bairro", 409],
  level: ["Esse nível de casa não existe", 400],
  same: ["A sua casa já é desse nível", 409],
  occupied: ["Peça para todos saírem da sua casa antes de trocar", 409],
  paint: ["Essa cor não existe", 400],
  coins: ["Moedas insuficientes", 402],
};
const fail = (code) => {
  const [error, statusCode] = ERR[code];
  return { error, statusCode, code };
};

const realtime = () => require("../realtime/meuMundo");

class MeuMundoShopService {
  /** O que o vendedor oferece, com o que a pessoa já tem. */
  static async catalog(idUser) {
    const res = await MeuMundoStorage.getActiveResidence(pool, idUser);
    const house = res ? await MeuMundoStorage.carPaintOf(pool, res.id_house) : null;
    const owned = new Set([Shop.DEFAULT_PAINT, ...(await MeuMundoStorage.ownedPaints(pool, idUser))]);
    const level = house ? Number(house.level) : null;
    const life = await MeuMundoLifeService.peek(idUser);
    return {
      coins: life && !life.error ? life.wallet.coins : null,
      house: house ? { level, paint: Shop.paintOf(house.car_paint) } : null,
      houses: Object.keys(Shop.HOUSE_PRICES)
        .map(Number)
        .filter((n) => n <= MAX_LEVEL && isSelectableLevel(n))
        .map((n) => ({ level: n, price: Shop.housePrice(level ?? 1, n), current: n === level })),
      paints: Shop.CAR_PAINTS.map((p) => ({ id: p.id, hex: p.hex, price: owned.has(p.id) ? 0 : p.price, owned: owned.has(p.id) })),
    };
  }

  /** Trocar o nível da casa: subir paga o preço do nível novo; descer é de graça. */
  static async buyHouse(idUser, rawLevel) {
    if (!realtime().atCenterPlace(idUser, SELLER_PLACE)) return fail("away");
    const to = Number(rawLevel);
    if (!Number.isInteger(to) || to < 1 || to > MAX_LEVEL || !isSelectableLevel(to) || Shop.HOUSE_PRICES[to] == null) return fail("level");
    const res = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (!res) return fail("noHouse");
    if (realtime().houseOccupants(res.id_house) > 0) return fail("occupied");
    let saved = null;
    const out = await MeuMundoLifeService.withLife(idUser, async (_s, ctx) => {
      const cur = await MeuMundoStorage.carPaintOf(ctx.client, res.id_house);
      const from = Number(cur.level);
      if (from === to) return fail("same");
      const price = Shop.housePrice(from, to);
      if (ctx.coins < price) return fail("coins");
      ctx.coins -= price;
      saved = await MeuMundoStorage.setHouseLevel(ctx.client, res.id_house, to);
      ctx.events.push({ at: ctx.now, kind: "house_bought", data: { from, to, price } });
      return { house: { level: to, price } };
    });
    if (saved) {
      try {
        realtime().applyHouseLevel(res.id_neighborhood, res.lot_number, saved.level, saved.level_rev);
      } catch (err) {
        log.error("house_level.broadcast_fail", { message: err.message });
      }
    }
    return out;
  }

  /** Comprar (uma vez) e/ou pôr a cor no carro da casa. */
  static async paintCar(idUser, rawPaint) {
    if (!realtime().atCenterPlace(idUser, SELLER_PLACE)) return fail("away");
    const paint = Shop.PAINT_BY_ID.get(String(rawPaint || ""));
    if (!paint) return fail("paint");
    const res = await MeuMundoStorage.getActiveResidence(pool, idUser);
    if (!res) return fail("noHouse");
    let done = false;
    const out = await MeuMundoLifeService.withLife(idUser, async (_s, ctx) => {
      const owned = paint.id === Shop.DEFAULT_PAINT || (await MeuMundoStorage.ownedPaints(ctx.client, idUser)).includes(paint.id);
      if (!owned) {
        if (ctx.coins < paint.price) return fail("coins");
        ctx.coins -= paint.price;
        await MeuMundoStorage.addOwnedPaint(ctx.client, idUser, paint.id, paint.price);
        ctx.events.push({ at: ctx.now, kind: "paint_bought", data: { paint: paint.id, price: paint.price } });
      }
      await MeuMundoStorage.setCarPaint(ctx.client, res.id_house, paint.id === Shop.DEFAULT_PAINT ? null : paint.id);
      done = true;
      return { paint: { id: paint.id, bought: !owned, price: owned ? 0 : paint.price } };
    });
    if (done) {
      try {
        realtime().applyCarPaint(res.id_neighborhood, res.lot_number, paint.id === Shop.DEFAULT_PAINT ? "" : paint.id);
      } catch (err) {
        log.error("car_paint.broadcast_fail", { message: err.message });
      }
    }
    return out;
  }
}

module.exports = MeuMundoShopService;
