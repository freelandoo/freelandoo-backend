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
//
// Trilha E, fatia E2 (mig 446): todo EQUIPAMENTO (arma, escudo, proteção, acessório) é uma
// instância com o seu `plus`; o equipado é do PERSONAGEM vivo (tb_mm_loadout). Cada operação
// começa por `prepare` (materializa a pilha antiga, uma vez). Os pedidos aceitam `instance`;
// sem ele, vale a instância representante (a equipada; senão a de maior `plus`) — o aparelho
// antigo continua funcionando. Regra de bônus, slots e custos não mudam nesta fatia.

const crypto = require("crypto");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const Gear = require("../utils/meuMundoGear");
const Forge = require("../utils/meuMundoForge");
const Items = require("../utils/mmItems");
const Adv = require("../utils/meuMundoAdventure");
const GearStore = require("../storages/MeuMundoGearStorage");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const { clanOfBody, usesSword, usesHammer, usesBow, usesGun } = require("../utils/meuMundoClans");

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
  locked: ["Esse item aguarda uma decisão de refino", 409],
  quote: ["Confira a prévia atualizada antes de pagar pelo refino", 409],
  proposal: ["Proposta de refino não encontrada", 404],
  decision: ["Informe aceitar ou recusar", 400],
  resolved: ["Essa proposta já foi encerrada", 409],
  stale: ["O equipamento mudou; recuse a proposta e confira uma nova prévia", 409],
  key_conflict: ["Essa chave já foi usada para outra ação", 409],
  use: ["Use esse item na ação indicada no catálogo", 409],
  instance: ["Equipamento não encontrado", 404],
  twohanded: ["Sua arma usa as duas mãos", 409],
  notfragment: ["Esse item não é um fragmento", 400],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

const levelOf = async (c, idUser) => Adv.levelOf(Number((await AdvStore.getAdventure(c, idUser)).xp)).level;
const hash = (value) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
const iso = (value) => (value == null ? null : new Date(value).toISOString());

/** E2: o que vira instância (equipamento que não empilha). Recibo e cosmético seguem em pilha. */
const isInstanceItem = (it) => !!it && !it.stack && Gear.slotsFor(it).length > 0;
const INSTANCE_ITEMS = Gear.GEAR.filter(isInstanceItem).map((g) => g.id);
const TWO_HANDED = Gear.GEAR.filter((g) => g.twoHanded).map((g) => g.id);
/**
 * Começo de toda operação: a pilha antiga de equipamento vira instância (E2) e o loadout nos
 * slots de antes da E6 vai para os 8 slots (shield → offhand, armor → chest, acc1/acc2 → o slot
 * da peça; dois no mesmo slot: fica o primeiro). Arma de duas mãos tira o offhand. Uma vez só:
 * depois disso as consultas não acham nada para mexer.
 */
async function prepare(c, idUser) {
  const moved = await GearStore.materialize(c, idUser, INSTANCE_ITEMS);
  const legacy = await GearStore.legacyLoadout(c, idUser, Object.keys(Gear.LEGACY_SLOTS));
  for (const row of legacy) {
    const to = Gear.normalizeSlot(row.slot, Gear.GEAR_BY_ID.get(row.item_id));
    await GearStore.moveSlot(c, row.id_character, row.slot, to);
  }
  if (legacy.length) for (const ch of await GearStore.twoHandedClash(c, idUser, TWO_HANDED)) await GearStore.unequipSlot(c, ch, "offhand");
  return moved;
}

/**
 * A instância do pedido: `instance` explícita (tem de ser da pessoa e do item) ou, sem ela,
 * a representante do item. Devolve { inst } ou { error }.
 */
async function pickInstance(c, idUser, it, rawInstance, { lock = false } = {}) {
  if (rawInstance != null && rawInstance !== "") {
    if (!KEY.test(String(rawInstance))) return fail("instance");
    const inst = await GearStore.lockInstance(c, idUser, String(rawInstance));
    if (!inst || (it && inst.item !== it.id)) return fail("instance");
    return { inst };
  }
  if (!it) return fail("instance");
  const rep = ((await GearStore.instancesByItem(c, idUser))[it.id] || [])[0];
  if (!rep) return fail("owned");
  return { inst: lock ? await GearStore.lockInstance(c, idUser, rep.id) : rep };
}

/** Entra na mochila: instância (uma por unidade) ou pilha com livro. Devolve o que entrou. */
async function putItem(c, idUser, it, n, origin) {
  if (isInstanceItem(it)) {
    const ids = [];
    for (let i = 0; i < n; i++) ids.push(await GearStore.createInstance(c, idUser, it.id, origin));
    return { got: n, ids };
  }
  const before = (await GearStore.lockItem(c, idUser, it.id))?.qty || 0;
  const after = await GearStore.addStack(c, idUser, it.id, n, null, Gear.STACK_MAX);
  return { got: Math.max(0, (after ?? before) - before), ids: [] };
}

function itemBonus(item, level) {
  return Gear.gearBonus({ [Gear.slotsFor(item)[0]]: { id: item.id, level } });
}

function refinementQuote(item, owned, protect = false) {
  const quote = Forge.quote(item, owned.level, { failures: owned.refineFailures || 0, protected: protect });
  if (!quote) return null;
  const before = itemBonus(item, owned.level);
  const levels = [...new Set([Math.min(Forge.MAX_LEVEL, owned.level + 1), owned.level, Math.max(quote.floor, owned.level - 1)])];
  const candidates = levels.map((level) => {
    const bonus = itemBonus(item, level);
    return { level, bonus, delta: Object.fromEntries(Object.keys(before).map((k) => [k, Math.round((bonus[k] - before[k]) * 10000) / 10000])) };
  });
  const value = { ...quote, item: item.id, version: owned.version, rulesVersion: Forge.RULES_VERSION, pity: { ...quote.pity, guaranteeAt: 4 }, bonusBefore: before, candidates };
  return { ...value, id: hash(value) };
}
/** A instância na forma que o refino forge-v1 lê (`level` = `plus`). */
const asOwned = (inst) => ({ qty: 1, level: inst.plus, refineFailures: inst.refineFailures, version: inst.version });

function publicProposal(p) {
  const snap = p.snapshot || {};
  const quote = snap.quote || {};
  return {
    id: p.id_proposal, item: p.item_id, instance: p.id_instance || null, fromLevel: p.from_level, candidateLevel: p.candidate_level,
    status: p.status, createdAt: iso(p.created_at), expiresAt: iso(p.expires_at), resolvedAt: iso(p.resolved_at),
    rulesVersion: p.rules_version, cost: quote.cost, odds: quote.odds, pity: quote.pity,
    protection: quote.protection, beforeBonus: snap.beforeBonus, candidateBonus: snap.candidateBonus,
    failuresAfter: snap.failuresAfter,
  };
}

/** Há proposta pendente para algum destes itens (id de item OU de instância)? */
async function hasPending(c, idUser, ids, now) {
  const pending = await GearStore.pendingProposals(c, idUser, now);
  const set = new Set(ids.filter(Boolean));
  return pending.some((p) => set.has(p.item_id) || (p.id_instance && set.has(p.id_instance)));
}

/**
 * A classe que VALE agora: a do personagem vestido; sem skin de classe, a da
 * conta. É a mesma conta da luta (fightStart): loja, mochila e luta nunca
 * discordam sobre quem é guerreiro (mm3d-66).
 */
async function wornClan(c, idUser) {
  return clanOfBody(await MeuMundoStorage.getBody(c, idUser)) ?? (await MeuMundoStorage.getClan(c, idUser)).clan;
}

/**
 * Arma que o personagem vestido não usa. Espada e escudo da loja são de guerreiro; arma
 * pesada é das skins de martelo, e essas skins só usam arma pesada.
 */
function weaponBlocked(it, body) {
  if (it.shop === "weapons" || it.shop === "shields") return !usesSword(body);
  if (it.shop === "hammers") return !usesHammer(body);
  if (it.shop === "bows") return !usesBow(body);
  if (it.shop === "guns") return !usesGun(body);
  return it.category === "weapon" && (usesHammer(body) || usesBow(body) || usesGun(body));
}

/** Equipado do personagem vivo como a regra quer: { slot: { id, level } } (arma de outra classe não vale). */
async function equippedFull(c, idUser, clan) {
  const live = await GearStore.loadoutLive(c, idUser);
  const body = await MeuMundoStorage.getBody(c, idUser);
  const out = {};
  for (const [slot, x] of Object.entries(live)) {
    const it = Gear.GEAR_BY_ID.get(x.item);
    if (!it || (it.clan && it.clan !== clan) || weaponBlocked(it, body)) continue;
    out[slot] = { id: x.item, level: x.plus, grade: x.grade };
  }
  return out;
}

/** O estado da mochila (posse, equipado, nível, classe, moedas). */
async function bagState(c, idUser, coins, now = Date.now()) {
  await prepare(c, idUser);
  await GearStore.expireProposals(c, idUser, now);
  const clan = await wornClan(c, idUser);
  const owned = await GearStore.owned(c, idUser);
  const equipped = await GearStore.equipped(c, idUser);
  const level = await levelOf(c, idUser);
  const full = await equippedFull(c, idUser, clan);
  const pending = await GearStore.pendingProposals(c, idUser, now);
  const lockedItems = new Set(pending.map((p) => p.item_id));
  const lockedInst = new Set(pending.map((p) => p.id_instance).filter(Boolean));
  const all = await GearStore.instances(c, idUser);
  const live = await GearStore.loadoutLive(c, idUser);
  const liveIds = new Set(Object.values(live).map((x) => x.instance));
  const refinable = (it) => it && (it.category === "weapon" || it.category === "armor");
  const refinement = {};
  for (const [id, row] of Object.entries(owned)) {
    const it = Gear.GEAR_BY_ID.get(id);
    if (!refinable(it)) continue;
    refinement[id] = lockedItems.has(id) ? { standard: null, protected: null } : {
      standard: refinementQuote(it, row), protected: refinementQuote(it, row, true),
    };
  }
  const refinementInstances = {};
  for (const x of all) {
    const it = Gear.GEAR_BY_ID.get(x.item);
    if (!refinable(it)) continue;
    refinementInstances[x.id] = lockedInst.has(x.id) ? { standard: null, protected: null } : {
      standard: refinementQuote(it, asOwned(x)), protected: refinementQuote(it, asOwned(x), true),
    };
  }
  const stacks = {};
  for (const [id, row] of Object.entries(owned)) if (!isInstanceItem(Gear.GEAR_BY_ID.get(id))) stacks[id] = row.qty;
  const unlocks = await GearStore.unlocks(c, idUser);
  const body = await MeuMundoStorage.getBody(c, idUser);
  return { clan, warrior: usesSword(body), hammer: usesHammer(body), archer: usesBow(body), gunner: usesGun(body), level, coins: Math.floor(coins), owned, equipped, bonus: Gear.gearBonus(full), refinement,
    // E7: bônus de cada slot pela régua (plus e grau da cópia vestida), para a tela de equipar
    pieces: Object.fromEntries(Object.entries(full).map(([slot, e]) => [slot, Items.pieceBonus(Gear.GEAR_BY_ID.get(e.id), e.level || 0, e.grade || 1)])),
    instances: all.map((x) => ({
      id: x.id, item: x.item, plus: x.plus, grade: x.grade, locked: x.locked || lockedInst.has(x.id),
      equippedBy: x.equippedBy, equippedSlot: x.equippedSlot, equippedHere: liveIds.has(x.id),
    })),
    equippedInstances: Object.fromEntries(Object.entries(live).map(([slot, x]) => [slot, x.instance])),
    stacks, refinementInstances,
    pendingProposals: pending.map(publicProposal),
    learnedRecipes: unlocks.filter((u) => u.kind === "recipe").map((u) => u.item_id),
    unlockedEmotes: unlocks.filter((u) => u.kind === "emote").map((u) => u.item_id),
    activeCosmetic: unlocks.find((u) => u.kind === "cosmetic" && u.active)?.item_id || null,
  };
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
    await prepare(c, idUser);
    await GearStore.expireProposals(c, idUser, ctx.now);
    // Equipamentos e operações pertencem à conta, mesmo após novo hóspede.
    const same = await GearStore.accountReceipt(c, idUser, source, key);
    if (same) return { receipt: same, replay: true, bag: await bagState(c, idUser, ctx.coins) };
    if (s.status !== "alive") return fail("dead");
    const mark = await GearStore.ledgerMark(c, idUser);
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
    await GearStore.attachLedger(c, idUser, mark, rec.eventId);
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
    await prepare(c, idUser);
    const clan = (await MeuMundoStorage.getClan(c, idUser)).clan;
    const id = Gear.starterOf(clan);
    if (!id) return null;
    const owned = await GearStore.owned(c, idUser);
    if (owned[id]) return null;
    const inst = await GearStore.createInstance(c, idUser, id, "starter");
    const live = await GearStore.loadoutLive(c, idUser);
    if (!live.weapon && ctx.row && ctx.row.status === "alive") await GearStore.equipInstance(c, idUser, ctx.row.id_character, "weapon", inst);
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
      if (weaponBlocked(it, await MeuMundoStorage.getBody(c, idUser))) return fail("clan");
      const owned = await GearStore.owned(c, idUser);
      if (!it.stack && owned[it.id]) return fail("max");
      if (ctx.coins < it.price) return fail("coins");
      ctx.coins -= it.price;
      const { ids } = await putItem(c, idUser, it, 1, "shop");
      return { result: { item: it.id, instance: ids[0] || null }, deltas: { coins: -it.price }, items: lines({ [it.id]: 1 }) };
    });
  }

  /** Mochila: equipa (ou tira, com item vazio) um slot do personagem vivo. `instance` escolhe a cópia. */
  static async equip(idUser, body = {}) {
    const id = body.item ? String(body.item) : null;
    // E6: o aparelho antigo ainda manda shield/armor/acc1/acc2
    const slot = Gear.normalizeSlot(String(body.slot || ""), id ? Gear.GEAR_BY_ID.get(id) : null);
    if (!Gear.SLOTS.includes(slot)) return fail("slot");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      await prepare(c, idUser);
      await GearStore.expireProposals(c, idUser, ctx.now);
      if (!ctx.row || ctx.row.status !== "alive") return fail("dead");
      const idCharacter = ctx.row.id_character;
      const live = await GearStore.loadoutLive(c, idUser);
      const current = live[slot];
      if (!id && !body.instance) {
        if (current && (await hasPending(c, idUser, [current.instance], ctx.now))) return fail("locked");
        await GearStore.unequipSlot(c, idCharacter, slot);
        return { bag: await bagState(c, idUser, ctx.coins) };
      }
      let it = id ? Gear.GEAR_BY_ID.get(id) : null;
      if (id && !it) return fail("item");
      const owned = await GearStore.owned(c, idUser);
      let inst = null;
      if (it && (!isInstanceItem(it) || !Gear.slotsFor(it).includes(slot))) return fail("slot");
      if (it && !owned[it.id]) {
        const clan = await wornClan(c, idUser);
        const why = Gear.canEquip(it, { clan, level: await levelOf(c, idUser), owned: false });
        return fail(why || "owned");
      }
      const picked = await pickInstance(c, idUser, it, body.instance);
      if (picked.error) return picked;
      inst = picked.inst;
      it = Gear.GEAR_BY_ID.get(inst.item);
      if (!Gear.slotsFor(it).includes(slot)) return fail("slot");
      if (await hasPending(c, idUser, [inst.id, current && current.instance], ctx.now)) return fail("locked");
      const clan = await wornClan(c, idUser);
      const why = Gear.canEquip(it, { clan, level: await levelOf(c, idUser), owned: true });
      if (why) return fail(why);
      // E6 (A5): arma de duas mãos ocupa também o offhand (avisa isso antes do "outra classe")
      if (slot === "offhand" && live.weapon && Gear.GEAR_BY_ID.get(live.weapon.item)?.twoHanded) return fail("twohanded");
      if (weaponBlocked(it, await MeuMundoStorage.getBody(c, idUser))) return fail("clan");
      if (slot === "weapon" && it.twoHanded && live.offhand) {
        if (await hasPending(c, idUser, [live.offhand.instance], ctx.now)) return fail("locked");
        await GearStore.unequipSlot(c, idCharacter, "offhand");
      }
      // a mesma cópia não ocupa dois slots (equipInstance tira de onde estava)
      await GearStore.equipInstance(c, idUser, idCharacter, slot, inst.id);
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
      const learned = await GearStore.unlocks(c, idUser);
      if (rc.recipe && !owned[rc.recipe] && !learned.some((u) => u.kind === "recipe" && u.item_id === rc.recipe)) return fail("norecipe");
      const out = Gear.GEAR_BY_ID.get(rc.out);
      if (!out.stack && owned[rc.out]) return fail("max");
      if ((owned[rc.out]?.qty || 0) >= Gear.STACK_MAX) return fail("max");
      if (await hasPending(c, idUser, [...Object.keys(rc.needs), rc.out], ctx.now)) return fail("locked");
      for (const [m, n] of Object.entries(rc.needs)) if (!owned[m] || owned[m].qty < n) return fail("needs");
      if (ctx.coins < rc.coins) return fail("coins");
      ctx.coins -= rc.coins;
      for (const [m, n] of Object.entries(rc.needs)) if ((await GearStore.addStack(c, idUser, m, -n)) == null) return fail("needs");
      const { ids } = await putItem(c, idUser, out, 1, "forge");
      return {
        result: { recipe: rc.id, out: rc.out, spent: rc.needs, instance: ids[0] || null },
        deltas: { coins: -rc.coins },
        items: lines({ [rc.out]: 1 }),
      };
    });
  }

  /** Compatibilidade: o endpoint antigo também exige prévia e aceite separado. */
  static async upgrade(idUser, body = {}) {
    return MeuMundoGearService.refine(idUser, body);
  }

  /** Sorteia e PAGA a proposta. A peça permanece intacta até o aceite. `instance` escolhe a cópia. */
  static async refine(idUser, body = {}) {
    const key = String(body.key || "");
    if (!KEY.test(key)) return fail("key");
    if (body.protect !== undefined && typeof body.protect !== "boolean") return fail("decision");
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it || (it.category !== "weapon" && it.category !== "armor")) return fail("item");
    const protect = body.protect === true;
    const requestHash = hash(body.instance ? { item: it.id, instance: String(body.instance), protect, quote: body.quote } : { item: it.id, protect, quote: body.quote });
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      await prepare(c, idUser);
      await GearStore.expireProposals(c, idUser, ctx.now);
      const old = await GearStore.findProposalByKey(c, idUser, key);
      if (old) {
        if (old.request_hash !== requestHash) return fail("key_conflict");
        return { receipt: await GearStore.receipt(c, idUser, old.create_receipt), proposal: publicProposal(old), replay: true, bag: await bagState(c, idUser, ctx.coins, ctx.now) };
      }
      if (s.status !== "alive") return fail("dead");
      const picked = await pickInstance(c, idUser, it, body.instance, { lock: true });
      if (picked.error) return picked;
      const inst = picked.inst;
      if (await hasPending(c, idUser, [inst.id], ctx.now)) return fail("locked");
      const quote = refinementQuote(it, asOwned(inst), protect);
      if (!quote) return fail("max");
      if (typeof body.quote !== "string" || body.quote !== quote.id) return { ...fail("quote"), quote };
      const owned = await GearStore.owned(c, idUser);
      for (const [id, n] of Object.entries(quote.cost.needs)) if (!owned[id] || owned[id].qty < n) return fail("needs");
      if (ctx.coins < quote.cost.coins) return fail("coins");
      const mark = await GearStore.ledgerMark(c, idUser);
      ctx.coins -= quote.cost.coins;
      for (const [id, n] of Object.entries(quote.cost.needs)) if ((await GearStore.addStack(c, idUser, id, -n)) == null) return fail("needs");
      const candidate = Forge.roll(quote, MeuMundoGearService.R);
      if (!Number.isInteger(candidate) || candidate < Math.max(quote.floor, inst.plus - 1) || candidate > inst.plus + 1) throw new Error("Resultado de refino inválido");
      const failuresAfter = candidate > inst.plus ? 0 : Math.min(3, inst.refineFailures + 1);
      const version = await GearStore.setInstanceRefineFailures(c, idUser, inst.id, failuresAfter);
      const p = await GearStore.insertProposal(c, {
        id: crypto.randomUUID(), idUser, item: it.id, instance: inst.id, key, requestHash, rules: Forge.RULES_VERSION,
        version, fromLevel: inst.plus, candidateLevel: candidate, now: ctx.now, expiresAt: ctx.now + Forge.PROPOSAL_TTL_MS,
        snapshot: { quote, failuresAfter, beforeBonus: itemBonus(it, inst.plus), candidateBonus: itemBonus(it, candidate) },
      });
      const receipt = await AdvStore.insertReceipt(c, {
        idUser, idCharacter: ctx.row.id_character, source: "gear_refine", actionKey: key, rules: Forge.RULES_VERSION,
        result: { proposalId: p.id_proposal, item: it.id, instance: inst.id, fromLevel: inst.plus, candidateLevel: candidate, status: "pending", failuresAfter },
        deltas: { coins: -quote.cost.coins }, items: lines(Object.fromEntries(Object.entries(quote.cost.needs).map(([id, n]) => [id, -n]))),
      });
      if (!receipt) return fail("key_conflict");
      await GearStore.attachLedger(c, idUser, mark, receipt.eventId);
      await GearStore.attachProposalReceipt(c, idUser, p.id_proposal, receipt.eventId);
      return { receipt, proposal: publicProposal(p), replay: false, bag: await bagState(c, idUser, ctx.coins, ctx.now) };
    });
  }

  /** Aceitar/recusar nunca cobra de novo. Fechar/expirar mantém a peça anterior. */
  static async resolveRefine(idUser, body = {}) {
    const key = String(body.key || "");
    if (!KEY.test(key)) return fail("key");
    if (!KEY.test(String(body.proposalId || ""))) return fail("proposal");
    if (typeof body.accept !== "boolean") return fail("decision");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      await prepare(c, idUser);
      await GearStore.expireProposals(c, idUser, ctx.now);
      const p = await GearStore.lockProposal(c, idUser, body.proposalId);
      if (!p) return fail("proposal");
      const other = await GearStore.findResolutionByKey(c, idUser, key);
      if (other && other.id_proposal !== p.id_proposal) return fail("key_conflict");
      if (p.status !== "pending") {
        if (p.status !== "expired" && (p.status === "accepted") !== body.accept) return { ...fail("resolved"), proposal: publicProposal(p) };
        return { receipt: await GearStore.receipt(c, idUser, p.resolve_receipt || p.create_receipt), proposal: publicProposal(p), replay: true, bag: await bagState(c, idUser, ctx.coins, ctx.now) };
      }
      if (s.status !== "alive" && body.accept) return fail("dead");
      const inst = p.id_instance ? await GearStore.lockInstance(c, idUser, p.id_instance) : null;
      if (body.accept && (!inst || inst.plus !== p.from_level || inst.version !== Number(p.item_version))) return fail("stale");
      if (body.accept) await GearStore.setPlus(c, idUser, inst.id, p.candidate_level);
      const status = body.accept ? "accepted" : "discarded";
      const receipt = await AdvStore.insertReceipt(c, {
        idUser, idCharacter: ctx.row.id_character, source: "gear_refine_resolve", actionKey: key, rules: p.rules_version,
        result: { proposalId: p.id_proposal, item: p.item_id, instance: p.id_instance || null, status, accepted: body.accept, fromLevel: p.from_level, level: body.accept ? p.candidate_level : p.from_level },
        deltas: {}, items: [],
      });
      if (!receipt) return fail("key_conflict");
      const updated = await GearStore.resolveProposal(c, idUser, p.id_proposal, status, key, receipt.eventId, ctx.now);
      if (!updated) return fail("resolved");
      return { receipt, proposal: publicProposal(updated), replay: false, bag: await bagState(c, idUser, ctx.coins, ctx.now) };
    });
  }

  /**
   * E8: fragmento que sobra vira Pó de Refino (2 × tier por fragmento, §6.5). Só o servidor diz
   * quanto vale; a pilha do Pó não passa de 9.999 (o pedido que estouraria é recusado inteiro).
   */
  static async convertFragments(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it) return fail("item");
    if (it.category !== "fragment" || !it.fragment) return fail("notfragment");
    const qty = Math.floor(Number(body.qty));
    if (!Number.isInteger(qty) || qty < 1 || qty > Gear.STACK_MAX) return fail("owned");
    const powder = qty * it.fragment.powder;
    return withReceipt(idUser, "fragment_convert", body.key, async (s, ctx) => {
      const c = ctx.client;
      const owned = await GearStore.owned(c, idUser);
      if ((owned[it.id]?.qty || 0) < qty) return fail("owned");
      if ((owned.po_refino?.qty || 0) + powder > Gear.STACK_MAX) return fail("max");
      if ((await GearStore.addStack(c, idUser, it.id, -qty)) == null) return fail("owned");
      await GearStore.addStack(c, idUser, "po_refino", powder, null, Gear.STACK_MAX);
      return { result: { item: it.id, qty, powder }, deltas: {}, items: lines({ [it.id]: -qty, po_refino: powder }) };
    });
  }

  /** A ação é declarada no catálogo; nunca aceitar efeitos/atributos do cliente. */
  static async use(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it) return fail("item");
    return withReceipt(idUser, "gear_use", body.key, async (s, ctx) => {
      const c = ctx.client;
      const unlocks = await GearStore.unlocks(c, idUser);
      const learned = unlocks.some((u) => u.kind === "recipe" && u.item_id === it.id);
      const owned = await GearStore.owned(c, idUser);
      if (!owned[it.id] && !(it.use === "learn_recipe" && learned)) return fail("owned");
      if (await hasPending(c, idUser, [it.id], ctx.now)) return fail("locked");
      const items = [];
      if (it.use === "learn_recipe" && it.category === "recipe") {
        if (!learned) {
          if ((await GearStore.addStack(c, idUser, it.id, -1)) == null) return fail("owned");
          await GearStore.unlock(c, idUser, it.id, "recipe");
          items.push(...lines({ [it.id]: -1 }));
        }
      } else if (it.use === "apply_weapon_cosmetic" && it.category === "cosmetic") {
        await GearStore.unlock(c, idUser, it.id, "cosmetic", true);
      } else if (it.use === "unlock_emote" && it.category === "cosmetic") {
        await GearStore.unlock(c, idUser, it.id, "emote");
      } else if (it.use === "inspect_quest" && it.category === "quest") {
        await GearStore.unlock(c, idUser, it.id, "quest");
      } else return fail("use");
      return { result: { item: it.id, action: it.use, lore: it.lore || null, cosmeticEffect: it.cosmeticEffect || null }, deltas: {}, items };
    });
  }

  /**
   * Forja: recicla (materiais excedentes e equipamento que não está em uso) em moedas.
   * Equipamento: `instance` escolhe a cópia; sem ela, as cópias soltas de menor `plus`.
   */
  static async recycle(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it) return fail("item");
    const qty = Math.max(1, Math.min(999, Math.floor(Number(body.qty) || 1)));
    if (!it.sell) return fail("forsale");
    return withReceipt(idUser, "recycle", body.key, async (s, ctx) => {
      const c = ctx.client;
      const owned = await GearStore.owned(c, idUser);
      if (!owned[it.id] || owned[it.id].qty < qty) return fail("owned");
      if (await hasPending(c, idUser, [it.id], ctx.now)) return fail("locked");
      const removed = [];
      if (isInstanceItem(it)) {
        let pool;
        if (body.instance) {
          const picked = await pickInstance(c, idUser, it, body.instance, { lock: true });
          if (picked.error) return picked;
          if (qty !== 1) return fail("owned");
          pool = [(await GearStore.instancesByItem(c, idUser))[it.id].find((x) => x.id === picked.inst.id)];
        } else {
          pool = ((await GearStore.instancesByItem(c, idUser))[it.id] || []).slice().sort((a, b) => a.plus - b.plus);
        }
        const free = pool.filter((x) => !x.equippedBy);
        if (free.length < qty) return fail(pool.some((x) => x.equippedBy) ? "equipped" : "owned");
        for (const x of free.slice(0, qty)) {
          if (!(await GearStore.removeInstance(c, idUser, x.id))) return fail("owned");
          removed.push(x.id);
        }
      } else if ((await GearStore.addStack(c, idUser, it.id, -qty)) == null) return fail("owned");
      const coins = it.sell * qty;
      ctx.coins += coins;
      return { result: { item: it.id, qty, instances: removed }, deltas: { coins }, items: lines({ [it.id]: -qty }) };
    });
  }
}

/** Para a luta: o equipamento que vale (bônus com teto) — o do personagem vivo. */
MeuMundoGearService.fightGear = async (c, idUser, clan) => {
  await prepare(c, idUser);
  return Gear.gearBonus(await equippedFull(c, idUser, clan));
};
/** Aparência só visual, congelada no ticket; não altera a simulação da luta. */
MeuMundoGearService.fightAppearance = async (c, idUser, clan) => {
  await prepare(c, idUser);
  const { weapon, offhand: shield } = await equippedFull(c, idUser, clan);
  const cosmetic = (await GearStore.unlocks(c, idUser)).find((u) => u.kind === "cosmetic" && u.active);
  return { weaponId: weapon?.id || null, level: weapon?.level || 0, shieldId: shield?.id || null, cosmetic: cosmetic?.item_id || null };
};
/** Entrega uma lista de drops (respeita a pilha; o excedente vira moedas; equipamento nasce instância). */
MeuMundoGearService.deliver = async (c, idUser, drops, ctx) => {
  await prepare(c, idUser);
  const out = [];
  for (const d of drops) {
    const it = Gear.GEAR_BY_ID.get(d.id);
    const { got } = it ? await putItem(c, idUser, it, d.qty, "loot") : { got: 0 };
    const over = d.qty - got;
    if (over > 0 && ctx) ctx.coins += over * (it?.sell || 0);
    const line = { ...d, qty: got, overflowCoins: over > 0 ? over * (it?.sell || 0) : 0 };
    // E3: fragmento mostra o progresso até o item ("42/60") no recibo
    if (it && it.category === "fragment" && it.fragment) line.progress = { of: it.fragment.of, have: (await GearStore.lockItem(c, idUser, it.id))?.qty || 0, need: it.fragment.need };
    out.push(line);
  }
  return out;
};
MeuMundoGearService.R = () => crypto.randomInt(0, 1_000_000) / 1_000_000;
MeuMundoGearService.isInstanceItem = isInstanceItem;
MeuMundoGearService.prepare = prepare;

module.exports = MeuMundoGearService;
