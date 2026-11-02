// src/services/MeuMundoGearService.js — MEU MUNDO 3D mm3d-59 (slice 3):
// Armeiro (comprar), mochila (equipar), forja (receitas, aprimorar, reciclar)
// e a arma inicial da classe.
//
// Tudo dentro de `MeuMundoLifeService.withLife` — a mesma transação e o mesmo
// lock da carteira — e cada operação que mexe em moedas/itens grava um RECIBO
// com a chave do pedido (`key`, gerada pelo aparelho a cada clique): o mesmo
// pedido repetido (duplo clique, duas abas, resposta perdida) devolve o mesmo
// recibo e não cobra/entrega de novo. Saldo nunca fica negativo (a carteira
// tem CHECK ≥ 0 e a conta confere antes).

const crypto = require("crypto");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const Gear = require("../utils/meuMundoGear");
const Adv = require("../utils/meuMundoAdventure");
const GearStore = require("../storages/MeuMundoGearStorage");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");

const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERRORS = {
  key: ["Pedido sem chave", 400],
  item: ["Item desconhecido", 404],
  forsale: ["Esse item não está à venda", 409],
  coins: ["Moedas insuficientes", 402],
  level: ["Nível de aventura insuficiente", 403],
  clan: ["Essa arma é de outra classe", 403],
  owned: ["Você não tem esse item", 409],
  slot: ["Esse item não se equipa", 400],
  recipe: ["Receita desconhecida", 404],
  needs: ["Faltam materiais", 409],
  norecipe: ["Você ainda não aprendeu essa receita", 403],
  max: ["Já está no máximo", 409],
  equipped: ["Tire o item antes de reciclar", 409],
  noclan: ["Escolha a classe primeiro", 409],
  dead: ["Hóspede sem vida", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

const levelOf = async (c, idUser) => Adv.levelOf(Number((await AdvStore.getAdventure(c, idUser)).xp)).level;

/** Equipado como a regra quer: { slot: { id, level } } (arma de outra classe não vale). */
async function equippedFull(c, idUser, clan) {
  const eq = await GearStore.equipped(c, idUser);
  const owned = await GearStore.owned(c, idUser);
  const out = {};
  for (const [slot, id] of Object.entries(eq)) {
    const it = Gear.GEAR_BY_ID.get(id);
    if (!it || !owned[id] || (it.clan && it.clan !== clan)) continue;
    out[slot] = { id, level: owned[id].level };
  }
  return out;
}

/** O estado da mochila (posse, equipado, nível, classe, moedas). */
async function bagState(c, idUser, coins) {
  const clan = (await MeuMundoStorage.getClan(c, idUser)).clan;
  const owned = await GearStore.owned(c, idUser);
  const equipped = await GearStore.equipped(c, idUser);
  const level = await levelOf(c, idUser);
  const full = await equippedFull(c, idUser, clan);
  return { clan, level, coins: Math.floor(coins), owned, equipped, bonus: Gear.gearBonus(full) };
}

/**
 * Roda `fn` com recibo idempotente: se a chave já tem recibo, devolve ele.
 * `fn(s, ctx)` devolve { error } ou { result, deltas, items }.
 */
function withReceipt(idUser, source, rawKey, fn) {
  const key = String(rawKey || "");
  if (!KEY.test(key)) return Promise.resolve(fail("key"));
  return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
    const c = ctx.client;
    const same = await AdvStore.findReceipt(c, ctx.row.id_character, source, key);
    if (same) return { receipt: same, replay: true, bag: await bagState(c, idUser, ctx.coins) };
    if (s.status !== "alive") return fail("dead");
    const r = await fn(s, ctx);
    if (r.error) return r;
    const rec = await AdvStore.insertReceipt(c, {
      idUser,
      idCharacter: ctx.row.id_character,
      source,
      actionKey: key,
      rules: Adv.RULES_VERSION,
      result: r.result || {},
      deltas: r.deltas || {},
      items: r.items || [],
    });
    if (!rec) return fail("key"); // outra aba gravou no mesmo instante (o lock impede; é só defesa)
    return { receipt: rec, replay: false, bag: await bagState(c, idUser, ctx.coins) };
  });
}

/** Itens entregues/removidos → linhas do recibo. */
const lines = (m) => Object.entries(m).map(([id, qty]) => ({ id, qty, rarity: Gear.GEAR_BY_ID.get(id)?.rarity || "common" }));

class MeuMundoGearService {
  /** GET /gear — catálogo + mochila. */
  static async get(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => ({
      gear: Gear.publicGear(),
      bag: await bagState(ctx.client, idUser, ctx.coins),
    }));
  }

  /**
   * Arma inicial da classe (grátis, uma vez): entra na mochila e já equipada.
   * Chamada pelo prólogo; quem já tem classe e nunca recebeu também recebe.
   */
  static async grantStarter(idUser, ctx) {
    const c = ctx.client;
    const clan = (await MeuMundoStorage.getClan(c, idUser)).clan;
    const id = Gear.starterOf(clan);
    if (!id) return null;
    const owned = await GearStore.owned(c, idUser);
    if (owned[id]) return null;
    await GearStore.add(c, idUser, id, 1);
    const eq = await GearStore.equipped(c, idUser);
    if (!eq.weapon) await GearStore.equip(c, idUser, "weapon", id);
    return { id, qty: 1, rarity: Gear.GEAR_BY_ID.get(id).rarity };
  }

  /** Armeiro: compra um item à venda (moedas do jogo). */
  static async buy(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it) return fail("item");
    if (it.price == null) return fail("forsale");
    return withReceipt(idUser, "shop", body.key, async (s, ctx) => {
      const c = ctx.client;
      if ((await levelOf(c, idUser)) < it.level) return fail("level");
      const owned = await GearStore.owned(c, idUser);
      if (!it.stack && owned[it.id]) return fail("max");
      if (ctx.coins < it.price) return fail("coins");
      ctx.coins -= it.price;
      await GearStore.add(c, idUser, it.id, 1);
      return { result: { item: it.id }, deltas: { coins: -it.price }, items: lines({ [it.id]: 1 }) };
    });
  }

  /** Mochila: equipa (ou tira, com item vazio) um slot. */
  static async equip(idUser, body = {}) {
    const slot = String(body.slot || "");
    if (!Gear.SLOTS.includes(slot)) return fail("slot");
    const id = body.item ? String(body.item) : null;
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      if (!id) {
        await GearStore.unequip(c, idUser, slot);
        return { bag: await bagState(c, idUser, ctx.coins) };
      }
      const it = Gear.GEAR_BY_ID.get(id);
      if (!it) return fail("item");
      if (!Gear.slotsFor(it).includes(slot)) return fail("slot");
      const clan = (await MeuMundoStorage.getClan(c, idUser)).clan;
      const owned = await GearStore.owned(c, idUser);
      const why = Gear.canEquip(it, { clan, level: await levelOf(c, idUser), owned: !!owned[id] });
      if (why) return fail(why);
      // o mesmo acessório não ocupa os dois slots
      const eq = await GearStore.equipped(c, idUser);
      for (const [other, oid] of Object.entries(eq)) if (other !== slot && oid === id) await GearStore.unequip(c, idUser, other);
      await GearStore.equip(c, idUser, slot, id);
      return { bag: await bagState(c, idUser, ctx.coins) };
    });
  }

  /** Forja: receita fixa (prévia = RECIPES). */
  static async forge(idUser, body = {}) {
    const rc = Gear.RECIPE_BY_ID.get(String(body.recipe || ""));
    if (!rc) return fail("recipe");
    return withReceipt(idUser, "forge", body.key, async (s, ctx) => {
      const c = ctx.client;
      if ((await levelOf(c, idUser)) < rc.level) return fail("level");
      const owned = await GearStore.owned(c, idUser);
      if (rc.recipe && !owned[rc.recipe]) return fail("norecipe");
      const out = Gear.GEAR_BY_ID.get(rc.out);
      if (!out.stack && owned[rc.out]) return fail("max");
      for (const [m, n] of Object.entries(rc.needs)) if (!owned[m] || owned[m].qty < n) return fail("needs");
      if (ctx.coins < rc.coins) return fail("coins");
      ctx.coins -= rc.coins;
      for (const [m, n] of Object.entries(rc.needs)) if ((await GearStore.add(c, idUser, m, -n)) == null) return fail("needs");
      await GearStore.add(c, idUser, rc.out, 1);
      return {
        result: { recipe: rc.id, out: rc.out, spent: rc.needs },
        deltas: { coins: -rc.coins },
        items: lines({ [rc.out]: 1 }),
      };
    });
  }

  /** Forja: aprimora arma/proteção (+1 nível, custo previsível). */
  static async upgrade(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it) return fail("item");
    return withReceipt(idUser, "upgrade", body.key, async (s, ctx) => {
      const c = ctx.client;
      const owned = await GearStore.owned(c, idUser);
      if (!owned[it.id]) return fail("owned");
      const cost = Gear.upgradeCost(it, owned[it.id].level);
      if (!cost) return fail("max");
      for (const [m, n] of Object.entries(cost.needs)) if (!owned[m] || owned[m].qty < n) return fail("needs");
      if (ctx.coins < cost.coins) return fail("coins");
      ctx.coins -= cost.coins;
      for (const [m, n] of Object.entries(cost.needs)) await GearStore.add(c, idUser, m, -n);
      await GearStore.setLevel(c, idUser, it.id, cost.to);
      return { result: { item: it.id, level: cost.to, spent: cost.needs }, deltas: { coins: -cost.coins }, items: [] };
    });
  }

  /** Forja: recicla (materiais excedentes e equipamento que não está em uso) em moedas. */
  static async recycle(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it) return fail("item");
    const qty = Math.max(1, Math.min(999, Math.floor(Number(body.qty) || 1)));
    if (!it.sell) return fail("forsale");
    return withReceipt(idUser, "recycle", body.key, async (s, ctx) => {
      const c = ctx.client;
      const owned = await GearStore.owned(c, idUser);
      if (!owned[it.id] || owned[it.id].qty < qty) return fail("owned");
      const eq = await GearStore.equipped(c, idUser);
      if (Object.values(eq).includes(it.id) && owned[it.id].qty - qty < 1) return fail("equipped");
      if ((await GearStore.add(c, idUser, it.id, -qty)) == null) return fail("owned");
      const coins = it.sell * qty;
      ctx.coins += coins;
      return { result: { item: it.id, qty }, deltas: { coins }, items: lines({ [it.id]: -qty }) };
    });
  }
}

/** Para a luta: o equipamento que vale (bônus com teto). */
MeuMundoGearService.fightGear = async (c, idUser, clan) => Gear.gearBonus(await equippedFull(c, idUser, clan));
/** Entrega uma lista de drops (respeita a pilha; o excedente vira moedas). */
MeuMundoGearService.deliver = async (c, idUser, drops, ctx) => {
  const out = [];
  for (const d of drops) {
    const before = (await GearStore.owned(c, idUser))[d.id]?.qty || 0;
    const after = await GearStore.add(c, idUser, d.id, d.qty, Gear.STACK_MAX);
    const got = Math.max(0, (after ?? before) - before);
    const over = d.qty - got;
    if (over > 0 && ctx) ctx.coins += over * (Gear.GEAR_BY_ID.get(d.id)?.sell || 0);
    out.push({ ...d, qty: got, overflowCoins: over > 0 ? over * (Gear.GEAR_BY_ID.get(d.id)?.sell || 0) : 0 });
  }
  return out;
};
MeuMundoGearService.R = () => crypto.randomInt(0, 1_000_000) / 1_000_000;

module.exports = MeuMundoGearService;
