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
const ClassStats = require("../utils/mmItems/rules/classStats");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const Gear = require("../utils/meuMundoGear");
const Items = require("../utils/mmItems");
const Runes = require("../utils/mmItems/rules/runes");
const Ascend = require("../utils/mmItems/rules/ascend");
// weapon-v1 (24/11/2026): nível 1–90 por pó, estrelas por cópia idêntica, forja por fragmento de classe
const WP = require("../utils/mmItems/rules/weaponProgress");
const Retired = require("../utils/mmItems/catalog/retired");
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
  chest: ["Baú desconhecido", 404],
  chestfar: ["Chegue perto do baú para abrir", 409],
  chestopen: ["Você já abriu esse baú", 409],
  tokens: ["Fichas insuficientes", 402],
  // weapon-v1
  retired: ["Essa ação saiu do jogo: as armas agora evoluem por refinamento com pó e estrelas na forja", 410],
  rules: ["O refinamento mudou: atualize a página", 410],
  notweapon: ["Só armas evoluem por nível e estrelas", 400],
  fragments: ["Faltam fragmentos dessa classe", 409],
  donor: ["Escolha a cópia que será consumida", 400],
  donorself: ["A cópia consumida não pode ser a própria arma", 400],
  donoritem: ["A cópia consumida precisa ser da mesma arma", 409],
  donorbuilt: ["Use como doadora uma cópia nova: nível 1, 1 estrela e sem investimento", 409],
  // weapon-v2
  powder: ["Falta o pó da classe desta arma", 409],
  pending: ["Aceite ou recuse o resultado do último refino antes de refinar de novo", 409],
  nopending: ["Nenhum resultado de refino esperando decisão", 404],
  times: ["Refine 1 ou 10 vezes", 400],
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
/** weapon-v1: armas (nível + estrelas) e pilhas aposentadas (viram pó/fragmento novo no `prepare`). */
const WEAPON_ITEMS = Gear.GEAR.filter((g) => WP.isWeapon(g)).map((g) => g.id);
const RETIRED_STACKS = Gear.GEAR.filter((g) => Retired.isRetiredStack(g)).map((g) => g.id);
const compensate = (id, qty) => Retired.compensation(Gear.GEAR_BY_ID.get(id), qty);
/** O "plus" da régua de uma cópia: arma = o nível convertido (fracionário); o resto = o +N que tinha. */
const plusOf = (it, x) => (WP.isWeapon(it) ? WP.plusEquiv(x.weaponLevel) : x.plus || 0);
/** Bônus de uma cópia (com o que já foi investido nela), opcionalmente com nível/estrelas trocados. */
const instBonus = (it, x, over = {}) => Items.pieceBonus(it, over.plus != null ? over.plus : plusOf(it, x), over.grade != null ? over.grade : x.grade,
  { sockets: x.sockets, awakened: x.awakened, enchant: (x.affixes && x.affixes.enchant) || null });
/**
 * Começo de toda operação: a pilha antiga de equipamento vira instância (E2) e o loadout nos
 * slots de antes da E6 vai para os 8 slots (shield → offhand, armor → chest, acc1/acc2 → o slot
 * da peça; dois no mesmo slot: fica o primeiro). Arma de duas mãos tira o offhand. Uma vez só:
 * depois disso as consultas não acham nada para mexer.
 */
async function prepare(c, idUser) {
  const moved = await GearStore.materialize(c, idUser, INSTANCE_ITEMS);
  await GearStore.convertForgeV1(c, idUser); // E9 (A2): o que ainda está em forge-v1 vira +round(1,5 × N)
  await GearStore.convertWeapons(c, idUser, WEAPON_ITEMS, WP.MAX_LEVEL); // weapon-v1: +N → nível, grau → estrelas
  await GearStore.convertRetired(c, idUser, RETIRED_STACKS, compensate); // weapon-v1: pilha aposentada → pó/fragmento
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
    for (let i = 0; i < n; i++) ids.push(await GearStore.createInstance(c, idUser, it.id, origin, WP.isWeapon(it) ? WP.INSTANCE_RULES : "forge-v2"));
    return { got: n, ids };
  }
  const before = (await GearStore.lockItem(c, idUser, it.id))?.qty || 0;
  const after = await GearStore.addStack(c, idUser, it.id, n, null, Gear.STACK_MAX);
  return { got: Math.max(0, (after ?? before) - before), ids: [] };
}

/** O que a tela vê da tentativa pendente (a chave fica só no banco). */
const pendingOut = (p) => (p ? { xp: p.xp, tier: p.tier, level: p.level, xpBefore: p.xpBefore, powder: p.powder } : null);

/** weapon-v2: a próxima tentativa da cópia (pó da classe, barra de XP, resultado esperando decisão, bônus do próximo nível). */
function refineView(it, inst) {
  const cost = WP.refineCost(it, inst.weaponLevel, inst.weaponXp);
  if (!cost) return null;
  return { ...cost, pending: pendingOut(inst.weaponPending), bonusBefore: instBonus(it, inst), bonusAfter: instBonus(it, inst, { plus: WP.plusEquiv(cost.level + 1) }) };
}

/** weapon-v1: a próxima estrela (cópias idênticas que servem de doadora e bônus antes/depois). */
function starsView(it, inst, all) {
  const cost = WP.starsCost(it, inst.grade);
  if (!cost) return null;
  const donors = all.filter((d) => d.item === inst.item && !WP.donorProblem(inst, d)).map((d) => d.id);
  return { ...cost, donors, bonusBefore: instBonus(it, inst), bonusAfter: instBonus(it, inst, { grade: cost.to }) };
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
    out[slot] = { id: x.item, level: plusOf(it, x), weaponLevel: x.weaponLevel, grade: x.grade, sockets: x.sockets || [], awakened: !!x.awakened, enchant: (x.affixes && x.affixes.enchant) || null };
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
  // weapon-v1: a bancada de refino e a forja mostram, por cópia de ARMA, a próxima tentativa e a próxima estrela
  const forge = {};
  for (const x of all) {
    const it = Gear.GEAR_BY_ID.get(x.item);
    if (!WP.isWeapon(it)) continue;
    forge[x.id] = { refine: refineView(it, x), stars: starsView(it, x, all), bonus: instBonus(it, x) };
  }
  const stacks = {};
  for (const [id, row] of Object.entries(owned)) if (!isInstanceItem(Gear.GEAR_BY_ID.get(id))) stacks[id] = row.qty;
  const unlocks = await GearStore.unlocks(c, idUser);
  const body = await MeuMundoStorage.getBody(c, idUser);
  return { clan, warrior: usesSword(body), hammer: usesHammer(body), archer: usesBow(body), gunner: usesGun(body), level, coins: Math.floor(coins), owned, equipped, bonus: Gear.gearBonus(full, { noBase: true }),
    // R3: status da classe somados das peças vestidas (número + %); o `bonus` acima é só o que se faz na peça
    classGear: ClassStats.classGearOf(Object.values(full).map((e) => Gear.GEAR_BY_ID.get(e.id))),
    // E7: bônus de cada slot pela régua (plus e grau da cópia vestida), para a tela de equipar
    pieces: Object.fromEntries(Object.entries(full).map(([slot, e]) => [slot, Items.pieceBonus(Gear.GEAR_BY_ID.get(e.id), e.level || 0, e.grade || 1, { sockets: e.sockets, awakened: e.awakened, enchant: e.enchant })])),
    // weapon-v1: regra em vigor (o aparelho confere a versão antes de pedir)
    progression: WP.publicRules(),
    instances: all.map((x) => ({
      id: x.id, item: x.item, plus: x.plus, grade: x.grade,
      ...(WP.isWeapon(Gear.GEAR_BY_ID.get(x.item)) ? { weaponLevel: x.weaponLevel, weaponXp: x.weaponXp, weaponPending: pendingOut(x.weaponPending), stars: x.grade } : {}), ascended: !!x.ascended, awakened: !!x.awakened, enchant: enchantOf(x), locked: x.locked || lockedInst.has(x.id),
      // E13: runas engastadas e engastes da cópia; `version` confere o pedido de engaste
      sockets: x.sockets || [], socketsMax: Runes.socketsOf(Gear.GEAR_BY_ID.get(x.item), !!x.ascended), version: x.version,
      equippedBy: x.equippedBy, equippedSlot: x.equippedSlot, equippedHere: liveIds.has(x.id),
    })),
    equippedInstances: Object.fromEntries(Object.entries(live).map(([slot, x]) => [slot, x.instance])),
    stacks, forge,
    // E19: eventos ligados agora (a loja de evento só mostra as ofertas deles)
    events: await require("./MeuMundoEventService").openIds(c, now),
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
function withReceipt(idUser, source, rawKey, fn, match = null) {
  const key = String(rawKey || "");
  if (!KEY.test(key)) return Promise.resolve(fail("key"));
  return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
    const c = ctx.client;
    await prepare(c, idUser);
    await GearStore.expireProposals(c, idUser, ctx.now);
    // Equipamentos e operações pertencem à conta, mesmo após novo hóspede.
    const same = await GearStore.accountReceipt(c, idUser, source, key);
    // a mesma chave só devolve o MESMO pedido (weapon-v1: não troca de cópia/doadora/arma para ressortear)
    if (same && match && !match(same.result || {})) return fail("key_conflict");
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

/** E15: a chave encantada da cópia e o sorteio que espera escolha (em `affixes`). */
const enchantOf = (inst) => (inst.affixes && inst.affixes.enchant) || null;

/** E13: confere o `version` que o aparelho viu (opcional; diferente = a cópia mudou noutra aba). */
const staleVersion = (body, inst) => body.version != null && body.version !== "" && Number(body.version) !== Number(inst.version);

/** Itens entregues/removidos → linhas do recibo. */
const lines = (m) => Object.entries(m).map(([id, qty]) => ({ id, qty, rarity: Gear.GEAR_BY_ID.get(id)?.rarity || "common", rank: Gear.GEAR_BY_ID.get(id)?.rank || "E" }));

class MeuMundoGearService {
  /** GET /gear — catálogo + mochila. */
  static async get(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const bag = await bagState(ctx.client, idUser, ctx.coins);
      // E18: a receita oculta só entra no catálogo de quem já a descobriu
      const found = await GearStore.collection(ctx.client, idUser);
      return { gear: Gear.publicGear({ reveal: (id) => !!found[id] }), bag };
    });
  }

  /**
   * E18: COLEÇÃO — todo item do catálogo, descoberto ou não (o oculto aparece como "???" até ser
   * achado), e os baús (onde ficam, abertos ou não). Liga ao Arquivo.
   */
  static async collection(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      await prepare(c, idUser);
      const found = await GearStore.collection(c, idUser);
      const opened = await GearStore.chestsOpened(c, idUser);
      const items = Gear.GEAR.map((g) => {
        const at = found[g.id] ? iso(found[g.id]) : null;
        return g.hidden && !at ? { id: null, hidden: true, category: g.category, rarity: g.rarity, rank: g.rank, found: false } : { id: g.id, category: g.category, rarity: g.rarity, rank: g.rank, found: !!at, at, ...(g.hidden ? { hidden: true, name: g.name } : {}) };
      });
      return {
        total: items.length, found: items.filter((x) => x.found).length, items,
        chests: Items.CHESTS.CHESTS.map((ch) => ({ id: ch.id, where: ch.where, places: ch.places, opened: !!opened[ch.id], openedAt: opened[ch.id] ? iso(opened[ch.id]) : null })),
      };
    });
  }

  /**
   * E18: ABRIR um baú: a última visita da pessoa foi ao ponto dele (há pouco) e ele nunca foi aberto
   * pela conta. Conteúdo fixo pela porta única do saque; mesma chave = o mesmo recibo; outra chave no
   * mesmo baú = "já abriu" (a chave primária impede a segunda entrega).
   */
  static async openChest(idUser, body = {}) {
    const ch = Items.CHESTS.CHEST_BY_ID.get(String(body.chest || ""));
    if (!ch) return fail("chest");
    return withReceipt(idUser, "chest", body.key, async (s, ctx) => {
      const c = ctx.client;
      if (!(await require("./MeuMundoPlaceService").isAt(c, idUser, ch.places, ctx.now))) return fail("chestfar");
      if (!(await GearStore.openChest(c, idUser, ch.id))) return fail("chestopen");
      const drops = await require("./MeuMundoRewardService").grant(c, idUser, { table: ch.table, ctx, R: MeuMundoGearService.R, roll: { win: true } });
      return { result: { chest: ch.id, where: ch.where }, deltas: {}, items: drops };
    });
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
    const inst = await GearStore.createInstance(c, idUser, id, "starter", WP.isWeapon(Gear.GEAR_BY_ID.get(id)) ? WP.INSTANCE_RULES : "forge-v2");
    const live = await GearStore.loadoutLive(c, idUser);
    if (!live.weapon && ctx.row && ctx.row.status === "alive") await GearStore.equipInstance(c, idUser, ctx.row.id_character, "weapon", inst);
    return { id, qty: 1, rarity: Gear.GEAR_BY_ID.get(id).rarity, rank: Gear.GEAR_BY_ID.get(id).rank };
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
   * weapon-v2: REFINAR a arma — cada tentativa gasta 1 PÓ DA CLASSE da arma e sorteia um XP (crypto, no servidor):
   *   • `times: 1` (padrão): o resultado fica ESPERANDO a pessoa aceitar ou recusar (`decideWeapon`); enquanto
   *     espera, a cópia não refina de novo;
   *   • `times: 10`: até 10 tentativas seguidas (para antes se o pó acabar ou a arma chegar ao teto), aceitando
   *     sozinho só as que AUMENTAM o XP e recusando as outras.
   * Trava a cópia, confere `version` e `rulesVersion`. Mesma chave = o mesmo recibo (o mesmo sorteio); a chave
   * usada noutra cópia ou com outro `times` é recusada.
   */
  static async refineWeapon(idUser, body = {}) {
    if (!KEY.test(String(body.instance || ""))) return fail("instance");
    if (body.rulesVersion != null && body.rulesVersion !== WP.RULES_VERSION) return fail("rules");
    const times = body.times == null ? 1 : Number(body.times);
    if (times !== 1 && times !== WP.BATCH) return fail("times");
    const instance = String(body.instance);
    return withReceipt(idUser, "weapon_refine", body.key, async (s, ctx) => {
      const c = ctx.client;
      const inst = await GearStore.lockInstance(c, idUser, instance);
      if (!inst) return fail("instance");
      const it = Gear.GEAR_BY_ID.get(inst.item);
      if (!WP.isWeapon(it)) return fail("notweapon");
      if (staleVersion(body, inst)) return fail("version");
      if (await hasPending(c, idUser, [inst.id], ctx.now)) return fail("locked");
      if (inst.weaponPending) return fail("pending");
      const first = WP.refineCost(it, inst.weaponLevel, inst.weaponXp);
      if (!first) return fail("max");
      const powder = first.powder;
      // nível/XP já normalizados pela curva atual (refineCost): a sobra gravada numa curva antiga conta
      const startLevel = first.level, startXp = first.xp;
      // conferir antes: addStack num item que a pessoa nunca teve cria a linha com 0 em vez de recusar
      let have = (await GearStore.lockItem(c, idUser, powder))?.qty || 0;
      if (have < 1) return fail("powder");
      const base = { item: it.id, instance: inst.id, rulesVersion: WP.RULES_VERSION, powder, times, levelBefore: startLevel, xpBefore: startXp };
      if (times === 1) {
        if ((await GearStore.addStack(c, idUser, powder, -1)) == null) return fail("powder");
        const roll = WP.rollXp(MeuMundoGearService.R(), MeuMundoGearService.R());
        const pending = { key: String(body.key), xp: roll.xp, tier: roll.tier, level: startLevel, xpBefore: startXp, powder, at: new Date(ctx.now).toISOString() };
        await GearStore.setWeaponProgress(c, idUser, inst.id, startLevel, startXp, pending);
        return {
          result: { ...base, rolls: [{ tier: roll.tier, xp: roll.xp }], pending: true, level: startLevel, xp: startXp, need: first.need },
          deltas: {},
          items: lines({ [powder]: -1 }),
        };
      }
      // 10 vezes: aceita sozinho o que sobe
      let level = startLevel, xp = startXp, used = 0;
      const rolls = [];
      for (let i = 0; i < times && level < WP.MAX_LEVEL && have > 0; i++) {
        if ((await GearStore.addStack(c, idUser, powder, -1)) == null) break;
        have--;
        used++;
        const roll = WP.rollXp(MeuMundoGearService.R(), MeuMundoGearService.R());
        const accepted = roll.xp > 0;
        if (accepted) ({ level, xp } = WP.applyXp(level, xp, roll.xp));
        rolls.push({ tier: roll.tier, xp: roll.xp, accepted, level, xpAfter: xp });
      }
      if (!used) return fail("powder");
      await GearStore.setWeaponProgress(c, idUser, inst.id, level, xp, null);
      return {
        result: { ...base, rolls, pending: false, level, xp, need: WP.xpNeed(level), used },
        deltas: {},
        items: lines({ [powder]: -used }),
      };
    }, (r) => r.instance === instance && Number(r.times || 1) === times);
  }

  /**
   * weapon-v2: ACEITAR ou RECUSAR o resultado que está esperando. Aceitar soma o XP (sobra passa de nível;
   * perda para no começo da barra, nunca desce de nível); recusar descarta (o pó já tinha sido gasto).
   */
  static async decideWeapon(idUser, body = {}) {
    if (!KEY.test(String(body.instance || ""))) return fail("instance");
    const decision = body.decision === "accept" ? "accept" : body.decision === "reject" ? "reject" : null;
    if (!decision) return fail("decision");
    const instance = String(body.instance);
    return withReceipt(idUser, "weapon_refine_decide", body.key, async (s, ctx) => {
      const c = ctx.client;
      const inst = await GearStore.lockInstance(c, idUser, instance);
      if (!inst) return fail("instance");
      const it = Gear.GEAR_BY_ID.get(inst.item);
      if (!WP.isWeapon(it)) return fail("notweapon");
      const p = inst.weaponPending;
      if (!p) return fail("nopending");
      const next = decision === "accept" ? WP.applyXp(inst.weaponLevel, inst.weaponXp, p.xp) : { level: inst.weaponLevel, xp: inst.weaponXp, up: 0 };
      await GearStore.setWeaponProgress(c, idUser, inst.id, next.level, next.xp, null);
      return {
        result: {
          item: it.id, instance: inst.id, rulesVersion: WP.RULES_VERSION, decision, rolled: p.xp, tier: p.tier, refineKey: p.key,
          levelBefore: inst.weaponLevel, xpBefore: inst.weaponXp, level: next.level, xp: next.xp, up: next.up, need: WP.xpNeed(next.level),
        },
        deltas: {},
        items: [],
      };
    }, (r) => r.instance === instance && r.decision === decision);
  }

  /**
   * weapon-v1: SUBIR ESTRELA — consome UMA cópia idêntica nova (nível 1, 1 estrela, sem nada investido,
   * sem trava, não vestida) e a arma ganha +1 estrela (máx. 5). Garantido. As duas cópias travam em
   * ordem fixa (id) para duas abas não se cruzarem.
   */
  static async starWeapon(idUser, body = {}) {
    if (!KEY.test(String(body.instance || ""))) return fail("instance");
    if (!KEY.test(String(body.donor || ""))) return fail("donor");
    const instance = String(body.instance), donor = String(body.donor);
    if (instance === donor) return fail("donorself");
    return withReceipt(idUser, "weapon_stars", body.key, async (s, ctx) => {
      const c = ctx.client;
      const [a, b] = [instance, donor].sort();
      const la = await GearStore.lockInstance(c, idUser, a);
      const lb = await GearStore.lockInstance(c, idUser, b);
      const inst = a === instance ? la : lb, don = a === instance ? lb : la;
      if (!inst) return fail("instance");
      if (!don) return fail("donor");
      const it = Gear.GEAR_BY_ID.get(inst.item);
      if (!WP.isWeapon(it)) return fail("notweapon");
      if (staleVersion(body, inst)) return fail("version");
      if (await hasPending(c, idUser, [inst.id, don.id], ctx.now)) return fail("locked");
      const cost = WP.starsCost(it, inst.grade);
      if (!cost) return fail("max");
      const held = (await GearStore.instancesByItem(c, idUser))[it.id] || [];
      const donView = held.find((x) => x.id === don.id) || don;
      const problem = WP.donorProblem(inst, donView);
      if (problem) return fail(problem);
      if (!(await GearStore.removeInstance(c, idUser, don.id))) return fail("donor");
      await GearStore.setGrade(c, idUser, inst.id, cost.to);
      return {
        result: { item: it.id, instance: inst.id, donor: don.id, rulesVersion: WP.RULES_VERSION, from: cost.from, to: cost.to, stars: cost.to },
        deltas: {},
        items: [],
      };
    }, (r) => r.instance === instance && r.donor === donor);
  }

  /**
   * weapon-v1: MONTAR ARMA — o jogador escolhe QUAL arma da classe quer; paga `need` fragmentos da classe
   * dela e ganha uma cópia nova (nível 1, 1 estrela), não vestida. Pode repetir arma que já tem.
   */
  static async assembleWeapon(idUser, body = {}) {
    const it = Gear.GEAR_BY_ID.get(String(body.item || ""));
    if (!it || !WP.isWeapon(it) || it.retired) return fail("item");
    const cost = WP.assemblyCost(it);
    if (!cost) return fail("item");
    return withReceipt(idUser, "weapon_assemble", body.key, async (s, ctx) => {
      const c = ctx.client;
      if (((await GearStore.lockItem(c, idUser, cost.fragment))?.qty || 0) < cost.need) return fail("fragments");
      if ((await GearStore.addStack(c, idUser, cost.fragment, -cost.need)) == null) return fail("fragments");
      const id = await GearStore.createInstance(c, idUser, it.id, "assemble", WP.INSTANCE_RULES);
      return {
        result: { item: it.id, instance: id, rulesVersion: WP.RULES_VERSION, rank: cost.rank, fragment: cost.fragment, need: cost.need },
        deltas: {},
        items: lines({ [cost.fragment]: -cost.need, [it.id]: 1 }),
      };
    }, (r) => r.item === it.id);
  }

  /** weapon-v1: o que saiu da forja/refino antigos responde 410 (o aparelho velho recarrega). */
  static async retired() {
    return fail("retired");
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
  // R3: a luta nova leva o status da classe em `classGear`; do bônus antigo fica só aprimoramento, refino,
  // conjunto, runas, despertar e encanto (o "base" pela raridade sai, senão a peça contaria duas vezes)
  return Gear.gearBonus(await equippedFull(c, idUser, clan), { noBase: true });
};
/** R2 (2026-11-17): status da CLASSE das peças vestidas (número + %), somados para a luta. */
MeuMundoGearService.fightClassGear = async (c, idUser, clan) => {
  await prepare(c, idUser);
  const worn = Object.values(await equippedFull(c, idUser, clan)).map((x) => Gear.GEAR_BY_ID.get(x.id));
  return ClassStats.classGearOf(worn);
};
/** Aparência só visual, congelada no ticket; não altera a simulação da luta. */
MeuMundoGearService.fightAppearance = async (c, idUser, clan) => {
  await prepare(c, idUser);
  const { weapon, offhand: shield } = await equippedFull(c, idUser, clan);
  const cosmetic = (await GearStore.unlocks(c, idUser)).find((u) => u.kind === "cosmetic" && u.active);
  // E14: arma desperta acende na cor do deus/Domínio dela (só visual, no ticket)
  const glow = weapon?.awakened ? Gear.GEAR_BY_ID.get(weapon.id)?.domain || "aether" : null;
  return { weaponId: weapon?.id || null, level: Math.round(weapon?.level || 0), weaponLevel: weapon?.weaponLevel || 1, stars: weapon?.grade || 1, shieldId: shield?.id || null, cosmetic: cosmetic?.item_id || null, ...(glow ? { awakened: glow } : {}) };
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
    // classe de raridade (E…Divina) na linha do recibo: a tela mostra a letra
    const line = { ...d, ...(it ? { rank: it.rank } : {}), qty: got, overflowCoins: over > 0 ? over * (it?.sell || 0) : 0 };
    // E3: fragmento mostra o progresso até o item ("42/60") no recibo
    if (it && it.category === "fragment" && it.fragment) line.progress = { ...(it.fragment.of ? { of: it.fragment.of } : { rank: it.fragment.rank }), have: (await GearStore.lockItem(c, idUser, it.id))?.qty || 0, need: it.fragment.need };
    out.push(line);
  }
  return out;
};
MeuMundoGearService.R = () => crypto.randomInt(0, 1_000_000) / 1_000_000;
/** E19: a loja de evento só abre com o evento ligado pelo admin. */
MeuMundoGearService.eventOpen = (c, event, now) => require("./MeuMundoEventService").isOpen(c, event, now);
MeuMundoGearService.isInstanceItem = isInstanceItem;
MeuMundoGearService.prepare = prepare;
// gacha-v1 (24/11/2026): as Convocações gravam o giro pelo mesmo recibo idempotente da Forja
MeuMundoGearService.withReceipt = withReceipt;

// weapon-v1 (24/11/2026): aprimoramento, graus, Ascensão, Despertar, encanto, runas, desmontar, transmutar e
// conversão de fragmento saíram do jogo; as rotas antigas respondem 410 em vez de sumir (aparelho velho).
for (const m of ["upgrade", "grade", "salvage", "transmute", "socket", "unsocket", "fuseRunes", "ascend", "awaken", "enchant", "enchantResolve", "convertFragments"]) {
  MeuMundoGearService[m] = MeuMundoGearService.retired;
}

module.exports = MeuMundoGearService;
