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
const Items = require("../utils/mmItems");
const Upgrade = require("../utils/mmItems/rules/upgrade");
const Salvage = require("../utils/mmItems/rules/salvage");
const Runes = require("../utils/mmItems/rules/runes");
const Ascend = require("../utils/mmItems/rules/ascend");
const Enchant = require("../utils/mmItems/rules/enchant");
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
  ascend: ["A peça precisa da Ascensão para passar do +10", 409],
  gone: ["O refino sorteado acabou: use o aprimoramento garantido", 410],
  pinned: ["Peça travada: destrave antes de desmontar", 409],
  worn: ["Tire a peça de quem a veste antes de desmontar", 409],
  confirm: ["Confirme a desmontagem de uma peça rara ou acima", 400],
  transmute: ["Esses materiais não se transmutam um no outro", 400],
  rune: ["Isso não é uma runa", 400],
  socket: ["Essa peça não tem engaste livre", 409],
  nosocket: ["Esse engaste está vazio", 404],
  version: ["O equipamento mudou; confira e tente de novo", 409],
  socketed: ["Tire as runas antes de reciclar", 409],
  ascended: ["Essa peça já ascendeu", 409],
  plus: ["A Ascensão pede a peça no +10", 409],
  awakened: ["Essa peça já despertou", 409],
  notascended: ["O Despertar pede a peça ascendida", 409],
  noenchant: ["Essa peça não tem outra chave para encantar", 409],
  offer: ["Há um encanto sorteado esperando a sua escolha", 409],
  nooffer: ["Nenhum encanto esperando escolha", 404],
  choice: ["Essa opção não saiu no sorteio", 400],
  offerid: ["Essa troca não existe", 404],
  tokens: ["Fichas insuficientes", 402],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

const levelOf = async (c, idUser) => Adv.levelOf(Number((await AdvStore.getAdventure(c, idUser)).xp)).level;
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
  await GearStore.convertForgeV1(c, idUser); // E9 (A2): o que ainda está em forge-v1 vira +round(1,5 × N)
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

/** E9: o próximo passo de uma cópia, como a bancada mostra (custo fixo, bônus antes e depois). */
function upgradeView(it, inst) {
  const cost = Upgrade.upgradeCost(it, inst.plus);
  if (!cost) return null;
  return { ...cost, blocked: cost.ascension && !inst.ascended ? "ascend" : null,
    bonusBefore: Items.pieceBonus(it, inst.plus, inst.grade), bonusAfter: Items.pieceBonus(it, cost.to, inst.grade) };
}

/** E10: o próximo grau de uma cópia (custo fixo em Pó de Refino e Catalisador; bônus antes e depois). */
function gradeView(it, inst) {
  const cost = Upgrade.gradeCost(it, inst.grade);
  if (!cost) return null;
  return { ...cost, bonusBefore: Items.pieceBonus(it, inst.plus, inst.grade), bonusAfter: Items.pieceBonus(it, inst.plus, cost.to) };
}

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
    out[slot] = { id: x.item, level: x.plus, grade: x.grade, sockets: x.sockets || [], awakened: !!x.awakened, enchant: (x.affixes && x.affixes.enchant) || null };
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
  const lockedInst = new Set(pending.map((p) => p.id_instance).filter(Boolean));
  const all = await GearStore.instances(c, idUser);
  const live = await GearStore.loadoutLive(c, idUser);
  const liveIds = new Set(Object.values(live).map((x) => x.instance));
  // E9: a bancada mostra o custo FIXO do próximo passo de cada cópia e o bônus antes e depois
  const forge = {};
  for (const x of all) {
    const it = Gear.GEAR_BY_ID.get(x.item);
    if (!Upgrade.upgradable(it)) continue;
    forge[x.id] = { upgrade: upgradeView(it, x), grade: gradeView(it, x),
      // E11: o que a desmontagem devolve (o servidor recusa travada ou vestida)
      salvage: salvageBack(it, x),
      // E14: o que a Ascensão e o Despertar pedem (ou por que ainda não)
      ascend: Ascend.ascendCost(it, x), awaken: { ...Ascend.awakenCost(it, x), bonus: Ascend.awakenValue(it) },
      // E15: custo do sorteio do encanto e o sorteio esperando escolha (cada opção com o bônus que daria)
      enchant: { ...Enchant.enchantCost(it, enchantOf(x)), current: Enchant.effectiveKeys(it, enchantOf(x))[1] || null,
        offer: offerOf(x) ? offerOf(x).map((k) => ({ key: k, bonus: Items.pieceBonus(it, x.plus, x.grade, { sockets: x.sockets, awakened: x.awakened, enchant: k }) })) : null } };
  }
  const stacks = {};
  for (const [id, row] of Object.entries(owned)) if (!isInstanceItem(Gear.GEAR_BY_ID.get(id))) stacks[id] = row.qty;
  const unlocks = await GearStore.unlocks(c, idUser);
  const body = await MeuMundoStorage.getBody(c, idUser);
  return { clan, warrior: usesSword(body), hammer: usesHammer(body), archer: usesBow(body), gunner: usesGun(body), level, coins: Math.floor(coins), owned, equipped, bonus: Gear.gearBonus(full),
    // E7: bônus de cada slot pela régua (plus e grau da cópia vestida), para a tela de equipar
    pieces: Object.fromEntries(Object.entries(full).map(([slot, e]) => [slot, Items.pieceBonus(Gear.GEAR_BY_ID.get(e.id), e.level || 0, e.grade || 1, { sockets: e.sockets, awakened: e.awakened, enchant: e.enchant })])),
    instances: all.map((x) => ({
      id: x.id, item: x.item, plus: x.plus, grade: x.grade, ascended: !!x.ascended, awakened: !!x.awakened, enchant: enchantOf(x), locked: x.locked || lockedInst.has(x.id),
      // E13: runas engastadas e engastes da cópia; `version` confere o pedido de engaste
      sockets: x.sockets || [], socketsMax: Runes.socketsOf(Gear.GEAR_BY_ID.get(x.item), !!x.ascended), version: x.version,
      equippedBy: x.equippedBy, equippedSlot: x.equippedSlot, equippedHere: liveIds.has(x.id),
    })),
    equippedInstances: Object.fromEntries(Object.entries(live).map(([slot, x]) => [slot, x.instance])),
    stacks, forge,
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

/** E11 + E13: o que a desmontagem devolve — materiais e Pó da regra + as runas engastadas, inteiras. */
function salvageBack(it, inst) {
  const back = { ...(Salvage.salvageYield(it, inst.plus, Gear.RECIPES, Gear.GEAR_BY_ID) || {}) };
  for (const id of inst.sockets || []) if (Runes.parseRune(id)) back[id] = (back[id] || 0) + 1;
  return back;
}

/** E15: a chave encantada da cópia e o sorteio que espera escolha (em `affixes`). */
const enchantOf = (inst) => (inst.affixes && inst.affixes.enchant) || null;
const offerOf = (inst) => (inst.affixes && Array.isArray(inst.affixes.offer) && inst.affixes.offer.length ? inst.affixes.offer : null);

/** E13: confere o `version` que o aparelho viu (opcional; diferente = a cópia mudou noutra aba). */
const staleVersion = (body, inst) => body.version != null && body.version !== "" && Number(body.version) !== Number(inst.version);

/**
 * E14/E15: um passo de evolução de UMA cópia pago com itens: `costOf(it, inst)` → { needs } | { error };
 * `apply(c, inst)` grava; `story(it, inst)` vai no recibo. Trava a cópia, confere a versão e o saldo.
 */
function pieceStep(idUser, body, source, costOf, apply, story) {
  if (!KEY.test(String(body.instance || ""))) return Promise.resolve(fail("instance"));
  return withReceipt(idUser, source, body.key, async (s, ctx) => {
    const c = ctx.client;
    const inst = await GearStore.lockInstance(c, idUser, String(body.instance));
    if (!inst) return fail("instance");
    if (staleVersion(body, inst)) return fail("version");
    if (await hasPending(c, idUser, [inst.id], ctx.now)) return fail("locked");
    const it = Gear.GEAR_BY_ID.get(inst.item);
    const cost = costOf(it, inst);
    if (cost.error) return fail(cost.error);
    const owned = await GearStore.owned(c, idUser);
    for (const [id, n] of Object.entries(cost.needs)) if ((owned[id]?.qty || 0) < n) return fail("needs");
    if ((cost.coins || 0) > ctx.coins) return fail("coins");
    ctx.coins -= cost.coins || 0;
    for (const [id, n] of Object.entries(cost.needs)) if ((await GearStore.addStack(c, idUser, id, -n)) == null) return fail("needs");
    const extra = await apply(c, inst, cost);
    return {
      result: { item: it.id, instance: inst.id, ...story(it, inst, cost, extra) },
      deltas: cost.coins ? { coins: -cost.coins } : {},
      items: lines(Object.fromEntries(Object.entries(cost.needs).map(([id, n]) => [id, -n]))),
    };
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

  /**
   * E9 (forge-v2): APRIMORAMENTO GARANTIDO. Paga o custo fixo do próximo passo (Esmeraldas + Pedras
   * de Aprimoramento) e a cópia SOBE um. Do +11 em diante, só ascendida. `instance` escolhe a cópia
   * (sem ela, a representante do item). Mesma chave duas vezes = o mesmo recibo, cobra uma.
   */
  static async upgrade(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it || !Upgrade.upgradable(it)) return fail("item");
    return withReceipt(idUser, "gear_upgrade", body.key, async (s, ctx) => {
      const c = ctx.client;
      const picked = await pickInstance(c, idUser, it, body.instance, { lock: true });
      if (picked.error) return picked;
      const inst = picked.inst;
      if (await hasPending(c, idUser, [inst.id], ctx.now)) return fail("locked");
      const cost = Upgrade.upgradeCost(it, inst.plus);
      if (!cost) return fail("max");
      if (cost.ascension && !inst.ascended) return fail("ascend");
      const owned = await GearStore.owned(c, idUser);
      for (const [id, n] of Object.entries(cost.needs)) if ((owned[id]?.qty || 0) < n) return fail("needs");
      if (ctx.coins < cost.coins) return fail("coins");
      ctx.coins -= cost.coins;
      for (const [id, n] of Object.entries(cost.needs)) if ((await GearStore.addStack(c, idUser, id, -n)) == null) return fail("needs");
      await GearStore.setPlus(c, idUser, inst.id, cost.to);
      return {
        result: { item: it.id, instance: inst.id, from: cost.from, to: cost.to, rulesVersion: Upgrade.RULES_VERSION,
          bonusBefore: Items.pieceBonus(it, cost.from, inst.grade), bonusAfter: Items.pieceBonus(it, cost.to, inst.grade) },
        deltas: { coins: -cost.coins },
        items: lines(Object.fromEntries(Object.entries(cost.needs).map(([id, n]) => [id, -n]))),
      };
    });
  }

  /**
   * E10: REFINAMENTO I–V da cópia — grau de qualidade, separado do aprimoramento. Custo fixo do
   * próximo grau (Pó de Refino + Catalisador), sempre sobe, até o V. Recibo com a chave do pedido.
   */
  static async grade(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it || !Upgrade.upgradable(it)) return fail("item");
    return withReceipt(idUser, "gear_grade", body.key, async (s, ctx) => {
      const c = ctx.client;
      const picked = await pickInstance(c, idUser, it, body.instance, { lock: true });
      if (picked.error) return picked;
      const inst = picked.inst;
      if (await hasPending(c, idUser, [inst.id], ctx.now)) return fail("locked");
      const cost = Upgrade.gradeCost(it, inst.grade);
      if (!cost) return fail("max");
      const owned = await GearStore.owned(c, idUser);
      for (const [id, n] of Object.entries(cost.needs)) if ((owned[id]?.qty || 0) < n) return fail("needs");
      for (const [id, n] of Object.entries(cost.needs)) if ((await GearStore.addStack(c, idUser, id, -n)) == null) return fail("needs");
      await GearStore.setGrade(c, idUser, inst.id, cost.to);
      return {
        result: { item: it.id, instance: inst.id, fromGrade: cost.from, toGrade: cost.to, rulesVersion: Upgrade.RULES_VERSION,
          bonusBefore: Items.pieceBonus(it, inst.plus, cost.from), bonusAfter: Items.pieceBonus(it, inst.plus, cost.to) },
        deltas: {},
        items: lines(Object.fromEntries(Object.entries(cost.needs).map(([id, n]) => [id, -n]))),
      };
    });
  }

  /**
   * E11: DESMONTAR uma cópia: 35% dos materiais da receita + Pó de Refino (10 × tier × (1 + plus/5));
   * nunca Esmeralda. Travada, vestida por QUALQUER personagem da conta (vivo ou na cápsula) ou com
   * proposta aberta: recusa. Raro ou acima pede `confirm: true`. Pilha cheia: recusa inteiro.
   */
  static async salvage(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it || !isInstanceItem(it)) return fail("item");
    if (body.instance == null || body.instance === "") return fail("instance");
    if (it.tier >= Salvage.CONFIRM_TIER && body.confirm !== true) return fail("confirm");
    return withReceipt(idUser, "gear_salvage", body.key, async (s, ctx) => {
      const c = ctx.client;
      const picked = await pickInstance(c, idUser, it, body.instance, { lock: true });
      if (picked.error) return picked;
      const inst = picked.inst;
      if (inst.locked) return fail("pinned");
      const held = ((await GearStore.instancesByItem(c, idUser))[it.id] || []).find((x) => x.id === inst.id);
      if (held && held.equippedBy) return fail("worn");
      if (await hasPending(c, idUser, [inst.id], ctx.now)) return fail("locked");
      const back = salvageBack(it, inst);
      const owned = await GearStore.owned(c, idUser);
      for (const [id, n] of Object.entries(back)) if ((owned[id]?.qty || 0) + n > Gear.STACK_MAX) return fail("max");
      if (!(await GearStore.removeInstance(c, idUser, inst.id))) return fail("instance");
      for (const [id, n] of Object.entries(back)) await GearStore.addStack(c, idUser, id, n, null, Gear.STACK_MAX);
      return {
        result: { item: it.id, instance: inst.id, plus: inst.plus, grade: inst.grade, back },
        deltas: {},
        items: lines({ [it.id]: -1, ...back }),
      };
    });
  }

  /** E11: TRANSMUTAR `qty` vezes: 3 de `from` → 1 de `to` (mesmo tier e categoria) + 20 × tier Esmeraldas cada. */
  static async transmute(idUser, body = {}) {
    const from = Gear.GEAR_BY_ID.get(String(body.from || ""));
    const to = Gear.GEAR_BY_ID.get(String(body.to || ""));
    if (!from || !to) return fail("item");
    const cost = Salvage.transmuteCost(from, to, body.qty == null ? 1 : body.qty);
    if (cost.error) return fail(cost.error);
    return withReceipt(idUser, "gear_transmute", body.key, async (s, ctx) => {
      const c = ctx.client;
      const owned = await GearStore.owned(c, idUser);
      for (const [id, n] of Object.entries(cost.needs)) if ((owned[id]?.qty || 0) < n) return fail("needs");
      for (const [id, n] of Object.entries(cost.gives)) if ((owned[id]?.qty || 0) + n > Gear.STACK_MAX) return fail("max");
      if (ctx.coins < cost.coins) return fail("coins");
      ctx.coins -= cost.coins;
      for (const [id, n] of Object.entries(cost.needs)) if ((await GearStore.addStack(c, idUser, id, -n)) == null) return fail("needs");
      for (const [id, n] of Object.entries(cost.gives)) await GearStore.addStack(c, idUser, id, n, null, Gear.STACK_MAX);
      return {
        result: { from: from.id, to: to.id, qty: cost.gives[to.id] },
        deltas: { coins: -cost.coins },
        items: lines({ ...Object.fromEntries(Object.entries(cost.needs).map(([id, n]) => [id, -n])), ...cost.gives }),
      };
    });
  }

  /** E11: trava/destrava a cópia (protege de desmontar e reciclar). Não é prêmio: sem recibo. */
  static async lock(idUser, body = {}) {
    if (!KEY.test(String(body.instance || ""))) return fail("instance");
    if (typeof body.locked !== "boolean") return fail("decision");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      await prepare(c, idUser);
      if (!(await GearStore.setLocked(c, idUser, String(body.instance), body.locked))) return fail("instance");
      return { bag: await bagState(c, idUser, ctx.coins) };
    });
  }

  /**
   * E13: ENGASTAR uma runa da mochila num engaste livre da cópia. `version` (opcional) = a versão
   * da cópia que o aparelho viu: mudou noutra aba, recusa. Vale vestida (a próxima luta já conta).
   */
  static async socket(idUser, body = {}) {
    const rune = Gear.GEAR_BY_ID.get(String(body.rune || ""));
    if (!rune || rune.category !== "rune" || !Runes.parseRune(rune.id)) return fail("rune");
    if (!KEY.test(String(body.instance || ""))) return fail("instance");
    return withReceipt(idUser, "gear_socket", body.key, async (s, ctx) => {
      const c = ctx.client;
      const inst = await GearStore.lockInstance(c, idUser, String(body.instance));
      if (!inst) return fail("instance");
      if (staleVersion(body, inst)) return fail("version");
      const it = Gear.GEAR_BY_ID.get(inst.item);
      const sockets = (inst.sockets || []).slice();
      if (sockets.length >= Runes.socketsOf(it, inst.ascended)) return fail("socket");
      if ((await GearStore.addStack(c, idUser, rune.id, -1)) == null) return fail("owned");
      sockets.push(rune.id);
      await GearStore.setSockets(c, idUser, inst.id, sockets);
      return {
        result: { item: it.id, instance: inst.id, rune: rune.id, sockets,
          bonusBefore: Items.pieceBonus(it, inst.plus, inst.grade, { sockets: inst.sockets }), bonusAfter: Items.pieceBonus(it, inst.plus, inst.grade, { sockets }) },
        deltas: {}, items: lines({ [rune.id]: -1 }),
      };
    });
  }

  /** E13: TIRAR a runa do engaste `index` — ela volta inteira para a mochila. */
  static async unsocket(idUser, body = {}) {
    if (!KEY.test(String(body.instance || ""))) return fail("instance");
    const index = Math.floor(Number(body.index));
    if (!Number.isInteger(index) || index < 0 || index >= Runes.MAX_SOCKETS) return fail("nosocket");
    return withReceipt(idUser, "gear_unsocket", body.key, async (s, ctx) => {
      const c = ctx.client;
      const inst = await GearStore.lockInstance(c, idUser, String(body.instance));
      if (!inst) return fail("instance");
      if (staleVersion(body, inst)) return fail("version");
      const sockets = (inst.sockets || []).slice();
      const id = sockets[index];
      if (!id) return fail("nosocket");
      const owned = await GearStore.owned(c, idUser);
      if ((owned[id]?.qty || 0) + 1 > Gear.STACK_MAX) return fail("max");
      sockets.splice(index, 1);
      await GearStore.setSockets(c, idUser, inst.id, sockets);
      await GearStore.addStack(c, idUser, id, 1, null, Gear.STACK_MAX);
      const it = Gear.GEAR_BY_ID.get(inst.item);
      return { result: { item: inst.item, instance: inst.id, rune: id, sockets,
        bonusBefore: Items.pieceBonus(it, inst.plus, inst.grade, { sockets: inst.sockets }), bonusAfter: Items.pieceBonus(it, inst.plus, inst.grade, { sockets }) },
      deltas: {}, items: lines({ [id]: 1 }) };
    });
  }

  /** E13: FUNDIR `qty` vezes: 3 runas de grau N → 1 de grau N+1 (mesma chave). Sem moeda. */
  static async fuseRunes(idUser, body = {}) {
    const rune = Gear.GEAR_BY_ID.get(String(body.rune || ""));
    if (!rune || rune.category !== "rune") return fail("rune");
    const cost = Runes.fuseCost(rune.id, body.qty == null ? 1 : body.qty);
    if (cost.error) return fail(cost.error);
    return withReceipt(idUser, "rune_fuse", body.key, async (s, ctx) => {
      const c = ctx.client;
      const owned = await GearStore.owned(c, idUser);
      for (const [id, n] of Object.entries(cost.needs)) if ((owned[id]?.qty || 0) < n) return fail("needs");
      for (const [id, n] of Object.entries(cost.gives)) if ((owned[id]?.qty || 0) + n > Gear.STACK_MAX) return fail("max");
      for (const [id, n] of Object.entries(cost.needs)) if ((await GearStore.addStack(c, idUser, id, -n)) == null) return fail("needs");
      for (const [id, n] of Object.entries(cost.gives)) await GearStore.addStack(c, idUser, id, n, null, Gear.STACK_MAX);
      const [to, qty] = Object.entries(cost.gives)[0];
      return { result: { from: rune.id, to, qty }, deltas: {},
        items: lines({ ...Object.fromEntries(Object.entries(cost.needs).map(([id, n]) => [id, -n])), ...cost.gives }) };
    });
  }

  /** E14: ASCENSÃO da cópia no +10 (2 × tier Selos de Domínio): libera +11…+15 e um engaste. */
  static async ascend(idUser, body = {}) {
    return pieceStep(idUser, body, "gear_ascend", Ascend.ascendCost, (c, inst) => GearStore.setAscended(c, idUser, inst.id), (it, inst) => ({
      ascended: true, socketsBefore: Runes.socketsOf(it, false), socketsAfter: Runes.socketsOf(it, true), from: inst.plus,
    }));
  }

  /** E14: DESPERTAR a cópia ascendida (tier Essências + tier Selos): liga a passiva da chave principal. */
  static async awaken(idUser, body = {}) {
    return pieceStep(idUser, body, "gear_awaken", Ascend.awakenCost, (c, inst) => GearStore.setAwakened(c, idUser, inst.id), (it, inst) => ({
      awakened: true, bonusBefore: Items.pieceBonus(it, inst.plus, inst.grade, { sockets: inst.sockets }),
      bonusAfter: Items.pieceBonus(it, inst.plus, inst.grade, { sockets: inst.sockets, awakened: true }),
    }));
  }

  /**
   * E15: SORTEAR o encanto da cópia: paga 10 × tier Pó + tier Cristal e grava até 3 opções (chaves do
   * slot). Com sorteio esperando escolha, recusa (resolva antes). Mesma chave = o mesmo sorteio.
   */
  static async enchant(idUser, body = {}) {
    return pieceStep(idUser, body, "gear_enchant", (it, inst) => Enchant.enchantCost(it, enchantOf(inst), !!offerOf(inst)),
      async (c, inst) => {
        const it = Gear.GEAR_BY_ID.get(inst.item);
        const options = Enchant.rollOptions(it, enchantOf(inst), MeuMundoGearService.R);
        await GearStore.setAffixes(c, idUser, inst.id, { ...(inst.affixes || {}), offer: options });
        return options;
      },
      (it, inst, cost, options) => ({ current: Enchant.effectiveKeys(it, enchantOf(inst))[1] || null, options }));
  }

  /**
   * E15: ESCOLHER uma opção do sorteio (`choice` = a chave) ou manter a atual (`choice: null`).
   * Não cobra nada: o custo foi pago no sorteio. Manter não muda o bônus.
   */
  static async enchantResolve(idUser, body = {}) {
    if (!KEY.test(String(body.instance || ""))) return fail("instance");
    const choice = body.choice == null || body.choice === "" ? null : String(body.choice);
    return withReceipt(idUser, "gear_enchant_resolve", body.key, async (s, ctx) => {
      const c = ctx.client;
      const inst = await GearStore.lockInstance(c, idUser, String(body.instance));
      if (!inst) return fail("instance");
      const offer = offerOf(inst);
      if (!offer) return fail("nooffer");
      if (choice && !offer.includes(choice)) return fail("choice");
      const it = Gear.GEAR_BY_ID.get(inst.item);
      const before = enchantOf(inst);
      const rest = { ...(inst.affixes || {}) };
      delete rest.offer;
      await GearStore.setAffixes(c, idUser, inst.id, choice ? { ...rest, enchant: choice } : rest);
      const extra = { sockets: inst.sockets, awakened: inst.awakened };
      return {
        result: { item: it.id, instance: inst.id, kept: !choice, from: Enchant.effectiveKeys(it, before)[1] || null, to: Enchant.effectiveKeys(it, choice || before)[1] || null,
          bonusBefore: Items.pieceBonus(it, inst.plus, inst.grade, { ...extra, enchant: before }), bonusAfter: Items.pieceBonus(it, inst.plus, inst.grade, { ...extra, enchant: choice || before }) },
        deltas: {}, items: [],
      };
    });
  }

  /**
   * E17: LOJA DE TROCA — `qty` vezes a oferta `offer` (fichas → itens). Pilha cheia recusa inteiro.
   * Mesma chave = o mesmo recibo. A E19 acrescenta a loja de evento (só com o evento ligado).
   */
  static async exchange(idUser, body = {}) {
    const o = Items.EXCHANGE.OFFER_BY_ID.get(String(body.offer || ""));
    if (!o) return fail("offerid");
    const qty = body.qty == null ? 1 : Math.floor(Number(body.qty));
    if (!Number.isInteger(qty) || qty < 1 || qty > 999) return fail("owned");
    return withReceipt(idUser, "exchange", body.key, async (s, ctx) => {
      const c = ctx.client;
      if (o.event && !(await MeuMundoGearService.eventOpen(c, o.event, ctx.now))) return fail("offerid");
      const owned = await GearStore.owned(c, idUser);
      const cost = o.cost * qty;
      if ((owned[o.token]?.qty || 0) < cost) return fail("tokens");
      for (const [id, n] of Object.entries(o.gives)) if (!isInstanceItem(Gear.GEAR_BY_ID.get(id)) && (owned[id]?.qty || 0) + n * qty > Gear.STACK_MAX) return fail("max");
      if ((await GearStore.addStack(c, idUser, o.token, -cost)) == null) return fail("tokens");
      const got = {};
      for (const [id, n] of Object.entries(o.gives)) { await putItem(c, idUser, Gear.GEAR_BY_ID.get(id), n * qty, "exchange"); got[id] = n * qty; }
      return { result: { offer: o.id, qty, token: o.token, cost }, deltas: {}, items: lines({ [o.token]: -cost, ...got }) };
    });
  }

  /** E9: o refino sorteado (forge-v1) acabou — o aparelho antigo recebe 410 e recarrega. */
  static async refine() {
    return fail("gone");
  }

  /** E9: aceitar/recusar proposta da forge-v1 acabou (410). */
  static async resolveRefine() {
    return fail("gone");
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
        const free = pool.filter((x) => !x.equippedBy && !x.locked && !(x.sockets || []).length); // E11: travada não recicla · E13: com runa também não
        if (free.length < qty) return fail(pool.some((x) => x.equippedBy) ? "equipped" : pool.some((x) => x.locked) ? "pinned" : pool.some((x) => (x.sockets || []).length) ? "socketed" : "owned");
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
  // E14: arma desperta acende na cor do deus/Domínio dela (só visual, no ticket)
  const glow = weapon?.awakened ? Gear.GEAR_BY_ID.get(weapon.id)?.domain || "aether" : null;
  return { weaponId: weapon?.id || null, level: weapon?.level || 0, shieldId: shield?.id || null, cosmetic: cosmetic?.item_id || null, ...(glow ? { awakened: glow } : {}) };
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
/** E19 sobrescreve: a loja de evento só abre com o evento ligado pelo admin. */
MeuMundoGearService.eventOpen = async () => false;
MeuMundoGearService.isInstanceItem = isInstanceItem;
MeuMundoGearService.prepare = prepare;

module.exports = MeuMundoGearService;
