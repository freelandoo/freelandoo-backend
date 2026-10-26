// src/services/MeuMundoLifeService.js — MEU MUNDO 3D: vida do hóspede (mig 295, mm3d-13).
//
// Quem chama já passou por auth + papel Administrator (rotas) ou é a sala
// Colyseus, que reconferiu o usuário no join.
//
// ═══ UMA TRANSAÇÃO POR LEITURA OU AÇÃO ═══
// trava a carteira e o hóspede mais recente → (nasce o primeiro, se não
// houver) → simula até AGORA → aplica a ação → grava o hóspede, o diário
// (dias fechados + o dia de hoje), os eventos e a carteira. A simulação é
// preguiçosa (src/utils/meuMundoLife.js): ler também grava, porque o tempo
// passou. O advisory lock por usuário serializa leituras simultâneas (duas
// abas não simulam o mesmo intervalo duas vezes nem fazem nascer dois).
//
// Deitar e dormir NÃO entram pela rota: precisam de cama, e quem sabe onde a
// pessoa está é a sala da casa (src/realtime/meuMundo.js, mensagem `bed`).

const crypto = require("crypto");
const pool = require("../databases");
const MeuMundoLifeStorage = require("../storages/MeuMundoLifeStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const MeuMundoVehicleStorage = require("../storages/MeuMundoVehicleStorage");
const Inbox = require("../storages/MeuMundoInboxStorage");
const PolenStorage = require("../storages/PolenStorage");
const { rowToState } = require("../storages/MeuMundoLifeStorage");
const Cars = require("../utils/meuMundoCars");
const Life = require("../utils/meuMundoLife");
const Skins = require("../utils/meuMundoSkins");
const Colors = require("../utils/meuMundoColors");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.life");

const REST_ROUTE_KINDS = ["idle", "studying", "training", "working"];

const ERRORS = {
  item: ["Item não encontrado", 404],
  dead: ["Seu hóspede morreu", 409],
  hospital: ["Ele está internado no hospital", 409],
  sleeping: ["Ele está dormindo", 409],
  full: ["Ele está cheio", 409],
  activity: ["Atividade inválida", 400],
  hours: ["Quantidade de horas inválida", 400],
  bed: ["Para deitar ou dormir, vá até uma cama", 409],
  stimulated: ["Com estimulante no corpo ele não consegue dormir", 409],
  coins: ["Moedas insuficientes", 402],
  skin: ["Skin não encontrada", 404],
  notOwned: ["Você ainda não tem essa skin", 409],
  noColors: ["Este personagem tem visual próprio", 400],
  alive: ["Seu hóspede está vivo", 409],
  empty: ["Acabou na geladeira", 409],
  stack: ["A geladeira não cabe mais desse item", 409],
  qty: ["Quantidade inválida", 400],
  key: ["Pedido inválido", 400],
  polens: ["Poléns insuficientes", 402],
  currency: ["Este produto é exclusivo de Poléns", 409],
  mail: ["Presente não encontrado", 404],
  place: ["Treino é na academia; estudo, na universidade, biblioteca ou escola do centro", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

// ═══ HISTÓRICO DO SINO (mm3d-30) ═══
// Necessidade entra no histórico quando aparece, e a mesma só volta depois de
// NEED_QUIET_H horas (o card temporário segue a regra do cliente,
// needs-logic.ts; o histórico não vira uma fila de "fome" a cada minuto).
const NEED_QUIET_H = 3;
// Eventos da vida que viram notificação (prioridade 1 = mais urgente).
const LIFE_NOTICES = {
  death: 1,
  heart_attack: 1,
  hospital_in: 1,
  hospital_out: 2,
  diabetes: 2,
  hypertension: 2,
  born: 3,
  funeral: 2,
};

async function recordNotices(c, idUser, idCharacter, needs, events) {
  const out = [];
  for (const n of needs) {
    const row = await Inbox.insertNeed(c, idUser, {
      code: n.id,
      priority: Math.min(5, Math.max(1, n.level)),
      data: n.hours != null ? { hours: n.hours } : {},
      quietH: NEED_QUIET_H,
    });
    if (row) out.push(row);
  }
  for (const e of events) {
    const pr = LIFE_NOTICES[e.kind];
    if (!pr || (e.kind === "born" && !(e.data && e.data.generation > 1))) continue;
    const row = await Inbox.insertNotice(c, idUser, {
      kind: "life",
      code: e.kind,
      priority: pr,
      data: e.data || {},
      dedupeKey: `life:${idCharacter}:${e.kind}:${e.at}`,
    });
    if (row) out.push(row);
  }
  return out;
}

/**
 * Cobra um produto na moeda DELE. Moedas do jogo saem de `ctx.coins` (gravadas
 * no fim da transação da vida); Poléns saem da carteira oficial da Freelandoo
 * (polen_wallets) na MESMA transação — se a entrega falhar, o débito volta
 * junto. `ref` é a origem única do débito: a mesma ref de novo (clique duplo,
 * retry, outra aba) bate no índice único de polen_transactions e não cobra.
 */
async function charge(ctx, idUser, { currency, amount, ref, what }) {
  if (amount <= 0) return null;
  if (currency !== "polens") {
    if (ctx.coins < amount) return fail("coins");
    ctx.coins -= amount;
    return null;
  }
  const c = ctx.client;
  const wallet = await PolenStorage.getOrCreateWallet(c, idUser);
  await c.query(`SAVEPOINT mm_polens`);
  try {
    const r = await PolenStorage.debit(c, {
      user_id: idUser,
      wallet_id: wallet.id,
      amount,
      type: "spend_meu_mundo",
      source: "meu_mundo_shop",
      source_id: ref,
      metadata: what,
    });
    await c.query(`RELEASE SAVEPOINT mm_polens`);
    if (!r) return fail("polens");
    ctx.polens = Number(r.wallet.balance);
    return null;
  } catch (err) {
    await c.query(`ROLLBACK TO SAVEPOINT mm_polens`);
    if (err.code === "23505") return fail("key"); // a mesma ref já foi cobrada
    throw err;
  }
}

/** Avisa a sala (ritmo, cama) depois do COMMIT. Require tardio: a sala também usa este serviço. */
function notifyRoom(idUser, snap) {
  try {
    require("../realtime/meuMundo").applyLife(idUser, snap);
  } catch (err) {
    log.warn("notify_fail", { message: err.message });
  }
}

class MeuMundoLifeService {
  /**
   * Núcleo: abre a transação, traz o hóspede até agora e roda `act` (que
   * pode mexer no estado e na carteira). `act` devolve { error } para
   * desfazer tudo, ou dados extras para a resposta.
   */
  static async withLife(idUser, act = null, { history = false } = {}) {
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`meu_mundo:vida:${idUser}`]);
      const now = Date.now();
      let coins = await MeuMundoLifeStorage.lockWallet(c, idUser, Life.RULES.START_COINS);
      let row = await MeuMundoLifeStorage.lockLatest(c, idUser);
      // Geladeira (mig 301): travada junto (a carteira já serializa a pessoa).
      const pantry0 = await MeuMundoLifeStorage.pantry(c, idUser);
      const pantry = { ...pantry0 };
      if (await MeuMundoLifeStorage.claimPantrySeed(c, idUser)) {
        for (const [id, n] of Object.entries(Life.FRIDGE.STARTER)) pantry[id] = Math.min(Life.FRIDGE.MAX_STACK, (pantry[id] || 0) + n);
      }
      const events = [];
      if (!row) {
        const s0 = Life.birth(crypto.randomInt(1, 2 ** 31 - 1), now);
        row = await MeuMundoLifeStorage.insert(c, idUser, 1, s0);
        events.push({ at: now, kind: "born", data: { generation: 1 } });
      }
      const s = rowToState(row);
      // A carteira entra na simulação: o trabalho rende e a rotina compra comida.
      const wallet = { coins };
      const sim = Life.simulate(s, now, wallet, pantry);
      events.push(...sim.events);
      coins = wallet.coins;
      const ctx = { now, row, coins, events, client: c, pantry };
      const extra = act ? await act(s, ctx) : {};
      if (extra && extra.error) {
        await c.query("ROLLBACK");
        return extra;
      }
      const idCharacter = ctx.newRow ? ctx.newRow.id_character : row.id_character;
      const state = ctx.newState || s;
      const notices = await recordNotices(c, idUser, row.id_character, Life.snapshot(state, now).needs, [
        ...events,
        ...(ctx.newEvents || []),
      ]);
      // O hóspede da linha travada sempre é gravado (vivo, ou como estava ao
      // morrer); o novo (newcomer) já nasceu gravado pelo insert.
      await MeuMundoLifeStorage.save(c, row.id_character, s);
      for (const d of sim.days) await MeuMundoLifeStorage.upsertDay(c, row.id_character, d, d.condition, true);
      await MeuMundoLifeStorage.upsertDay(c, row.id_character, s.dayAcc, Life.dayCondition(s.dayAcc), false);
      if (ctx.newRow) await MeuMundoLifeStorage.upsertDay(c, idCharacter, state.dayAcc, Life.dayCondition(state.dayAcc), false);
      await MeuMundoLifeStorage.insertEvents(c, row.id_character, events);
      if (ctx.newEvents) await MeuMundoLifeStorage.insertEvents(c, idCharacter, ctx.newEvents);
      await MeuMundoLifeStorage.setCoins(c, idUser, Math.max(0, ctx.coins));
      await MeuMundoLifeStorage.savePantry(c, idUser, pantry0, pantry);
      // O tipo físico do avatar É o corpo da vida (não se escolhe desde
      // 2026-10-21): gravado só quando muda — é o que as entradas leem.
      await MeuMundoStorage.setBody(c, idUser, Life.bodyHint(state));
      // O que a sala desenha: a skin vestida ou a condição (mig 300).
      const avatar = await MeuMundoStorage.getBody(c, idUser);
      // Cores da skin vestida (mm3d-36, mig 304): "" = visual próprio.
      const look = await MeuMundoStorage.getLook(c, idUser);
      await c.query("COMMIT");
      const cur = ctx.newRow || row;
      const snap = {
        generation: cur.generation,
        bornAt: new Date(cur.born_at).toISOString(),
        deathSeen: !!cur.death_seen_at || !!ctx.deathSeen,
        ...Life.snapshot(state, now),
      };
      const out = {
        now: new Date(now).toISOString(),
        character: snap,
        wallet: { coins: Math.floor(Math.max(0, ctx.coins)), ...(ctx.polens != null ? { polens: ctx.polens } : {}) },
        avatar,
        look,
        fridge: Object.fromEntries(Object.entries(pantry).filter(([, n]) => n > 0)),
        ...(extra || {}),
      };
      if (history) {
        out.days = await MeuMundoLifeStorage.recentDays(pool, idCharacter);
        out.events = await MeuMundoLifeStorage.recentEvents(pool, idCharacter);
      }
      notifyRoom(idUser, {
        pace: snap.pace,
        status: snap.status,
        activity: snap.activity.kind,
        bed: state.activity.bed,
        body: avatar,
        look,
        // Avisos com retrato e fôlego de corrida (2026-10-24).
        needs: snap.needs,
        stamina: snap.stamina,
      });
      for (const n of notices) require("./MeuMundoInboxService").push(idUser, n);
      return out;
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  /** GET /life — estado de agora + diário e linha do tempo + catálogo. */
  static async get(idUser) {
    const out = await MeuMundoLifeService.withLife(idUser, null, { history: true });
    return { ...out, catalog: Life.publicCatalog() };
  }

  /** Resumo para os payloads de entrada e para a sala. */
  static async peek(idUser) {
    return MeuMundoLifeService.withLife(idUser);
  }

  /** Estudar, treinar, trabalhar (com horas) ou parar (idle). */
  static async setActivity(idUser, rawKind, rawHours, rawPlace = null) {
    const kind = String(rawKind || "");
    if (!REST_ROUTE_KINDS.includes(kind)) return fail(kind === "lying" || kind === "sleeping" ? "bed" : "activity");
    // Treino e estudo só no prédio (mm3d-37b): o lugar certo E a pessoa lá,
    // segundo a sala do centro (o navegador não escolhe onde está).
    const place = Life.PLACES[kind] ? String(rawPlace || "") : null;
    if (place !== null && (!Life.PLACES[kind].includes(place) || !require("../realtime/meuMundo").atCenterPlace(idUser, place))) return fail("place");
    return MeuMundoLifeService.withLife(idUser, (s, ctx) => {
      // Parar de dormir/deitar pela rota = levantar: a sala solta da cama.
      const r = Life.startActivity(s, kind, rawHours, ctx.now, null, place);
      if (!r.ok) return fail(r.code);
      // Hora de aula da universidade (moedas do jogo, na largada).
      const fee = Life.placeFee(kind, place, r.hours);
      if (fee > 0) {
        if (ctx.coins < fee) return fail("coins");
        ctx.coins -= fee;
        ctx.events.push({ at: ctx.now, kind: "fee", data: { place, kind, hours: r.hours, price: fee } });
      }
      ctx.events.push(...r.events);
      return {};
    });
  }

  /** Deitar / dormir numa cama já conferida pela sala da casa. */
  static async rest(idUser, kind, hours, bed) {
    if (kind !== "lying" && kind !== "sleeping") return fail("activity");
    return MeuMundoLifeService.withLife(idUser, (s, ctx) => {
      const r = Life.startActivity(s, kind, hours, ctx.now, bed);
      if (!r.ok) return fail(r.code);
      ctx.events.push(...r.events);
      return {};
    });
  }

  /** Levantar da cama (a sala chama quando a pessoa levanta). */
  static async getUp(idUser) {
    return MeuMundoLifeService.withLife(idUser, (s, ctx) => {
      if (s.status !== "alive" || (s.activity.kind !== "lying" && s.activity.kind !== "sleeping")) return {};
      const r = Life.startActivity(s, "idle", null, ctx.now);
      if (r.ok) ctx.events.push(...r.events);
      return {};
    });
  }

  /** Comer / tomar um item: cobra o preço da carteira do jogo. */
  static async consume(idUser, rawItem) {
    const itemId = String(rawItem || "");
    const item = Life.ITEM_BY_ID.get(itemId);
    if (!item) return fail("item");
    if (item.currency === "polens") return fail("currency");
    return MeuMundoLifeService.withLife(idUser, (s, ctx) => {
      if (ctx.coins < item.price) return fail("coins");
      const r = Life.consume(s, itemId, ctx.now);
      if (!r.ok) return fail(r.code);
      ctx.coins -= item.price;
      ctx.events.push(...r.events);
      return { consumed: { item: item.id, price: item.price } };
    });
  }

  // ═══ GELADEIRA (mm3d-28, mig 301) ═══

  /**
   * Mercado → geladeira: cobra `qty` × preço NA MOEDA DO PRODUTO e guarda
   * (não come). Produto de Poléns exige `key` (8–64, uma por pedido): a
   * mesma chave não cobra duas vezes.
   */
  static async buy(idUser, rawItem, rawQty = 1, rawKey = null) {
    const item = Life.ITEM_BY_ID.get(String(rawItem || ""));
    if (!item) return fail("item");
    const qty = Number(rawQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > Life.FRIDGE.MAX_BUY) return fail("qty");
    const key = String(rawKey || "");
    if (item.currency === "polens" && !/^[A-Za-z0-9_-]{8,64}$/.test(key)) return fail("key");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const cost = item.price * qty;
      const have = ctx.pantry[item.id] || 0;
      if (have + qty > Life.FRIDGE.MAX_STACK) return fail("stack");
      const err = await charge(ctx, idUser, {
        currency: item.currency,
        amount: cost,
        ref: `item:${idUser}:${key}`,
        what: { item: item.id, qty },
      });
      if (err) return err;
      ctx.pantry[item.id] = have + qty;
      ctx.events.push({ at: ctx.now, kind: "buy", data: { item: item.id, qty, price: cost, currency: item.currency } });
      return { bought: { item: item.id, qty, price: cost, currency: item.currency } };
    });
  }

  /**
   * Comer UMA unidade da geladeira. `key` (8–64, gerada pelo cliente por
   * pedido) torna o pedido idempotente: a mesma chave de novo (clique duplo,
   * retry, outra aba) devolve o resultado gravado sem comer outra vez. Duas
   * chaves diferentes para a última unidade: o lock por pessoa serializa e a
   * segunda recebe "empty". Quem chama (a sala da casa) já conferiu que a
   * pessoa é a dona e está na geladeira.
   */
  static async eatFromFridge(idUser, rawItem, rawKey) {
    const key = String(rawKey || "");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(key)) return fail("key");
    const item = Life.ITEM_BY_ID.get(String(rawItem || ""));
    if (!item) return fail("item");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const done = await MeuMundoLifeStorage.consumeKey(ctx.client, idUser, key);
      if (done) return { ate: done, replay: true };
      if (!((ctx.pantry[item.id] || 0) > 0)) return fail("empty");
      const r = Life.consume(s, item.id, ctx.now);
      if (!r.ok) return fail(r.code);
      ctx.pantry[item.id] -= 1;
      ctx.events.push(...r.events);
      const ate = { item: item.id, meal: r.meal };
      await MeuMundoLifeStorage.saveConsumeKey(ctx.client, idUser, key, ate);
      return { ate, replay: false };
    });
  }

  // ═══ PRESENTES E ITENS (mm3d-30, mig 302) ═══

  /**
   * Resgatar o presente de uma carta. Dentro da transação da vida: a carta é
   * travada, o presente vai para a geladeira / vestuário / carteira do jogo e
   * `claimed_at` é gravado UMA vez. Já resgatado = devolve o resultado gravado
   * (clique duplo, outra aba, reconexão) sem entregar de novo.
   */
  static async claimGift(idUser, rawMail) {
    if (!/^\d{1,18}$/.test(String(rawMail || ""))) return fail("mail");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const mail = await Inbox.lockMail(ctx.client, idUser, rawMail);
      if (!mail || mail.kind !== "gift" || !mail.gift) return fail("mail");
      if (mail.claimedAt) return { claim: { mailId: mail.id, ...mail.claimResult, replay: true } };
      const g = mail.gift;
      let result;
      if (g.type === "item") {
        if (!Life.ITEM_BY_ID.get(g.id)) return fail("item");
        const have = ctx.pantry[g.id] || 0;
        if (have + g.qty > Life.FRIDGE.MAX_STACK) return fail("stack");
        ctx.pantry[g.id] = have + g.qty;
        result = { type: "item", id: g.id, qty: g.qty, where: "fridge" };
      } else if (g.type === "skin") {
        const added = await MeuMundoStorage.addSkin(ctx.client, idUser, g.id, 0);
        result = { type: "skin", id: g.id, qty: 1, where: "wardrobe", alreadyOwned: !added };
      } else if (g.type === "coins") {
        ctx.coins += g.qty;
        result = { type: "coins", id: "coins", qty: g.qty, where: "wallet" };
      } else return fail("mail");
      if (!(await Inbox.markClaimed(ctx.client, idUser, mail.id, result))) return fail("mail");
      await Inbox.readMail(ctx.client, idUser, mail.id);
      ctx.events.push({ at: ctx.now, kind: "gift", data: { mail: mail.id, ...result } });
      return { claim: { mailId: mail.id, ...result, replay: false } };
    });
  }

  /**
   * Aba Itens: o inventário REAL, lido das fontes que já existem — geladeira
   * (tb_mm_pantry, depois da simulação até agora: a rotina pode ter comido),
   * vestuário (tb_mm_skin_owned), veículos e casa da residência. Sem estoque
   * paralelo: a geladeira e esta aba leem a mesma linha.
   */
  static async inventory(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const wardrobe = await MeuMundoLifeService.wardrobeOf(c, idUser);
      const residence = await MeuMundoStorage.getActiveResidence(c, idUser);
      const recentGifts = await Inbox.recentClaims(c, idUser);
      let vehicles = [];
      let house = null;
      if (residence) {
        const lot = Number(residence.lot_number);
        house = { level: Number(residence.level), lot, neighborhood: residence.name };
        const moved = await MeuMundoVehicleStorage.listByNeighborhood(c, residence.id_neighborhood);
        vehicles = Cars.KIND_NAMES.map((kind) => {
          const row = moved.find((v) => v.id === Cars.vehicleId(kind, lot));
          return { kind, where: !row ? "spot" : row.houseId ? "house" : "street" };
        });
      }
      return { items: Life.publicCatalog().items, inventory: { wardrobe, vehicles, house, recentGifts } };
    });
  }

  /** Os dois saldos, cada um da sua fonte. Poléns indisponível = null (nunca um zero inventado). */
  static async wallets(idUser) {
    const out = await MeuMundoLifeService.withLife(idUser);
    let polens = null;
    try {
      const w = await PolenStorage.getWallet(pool, idUser);
      polens = w ? Number(w.balance) : 0; // sem carteira ainda = saldo zero de verdade
    } catch (err) {
      log.warn("polens_wallet_fail", { message: err.message });
    }
    return { wallet: { coins: out.wallet.coins, polens } };
  }

  // ═══ VESTUÁRIO (mm3d-16, mig 300) ═══
  // Comprar e vestir passam pelo núcleo da vida: a carteira é a mesma (trava,
  // simula até agora, cobra) e a sala recebe o corpo novo no fim, como recebe
  // a mudança de condição física.

  static async wardrobeOf(db, idUser) {
    const [w, admin, colors] = await Promise.all([MeuMundoStorage.getWardrobe(db, idUser), MeuMundoStorage.isAdmin(db, idUser), MeuMundoStorage.getColors(db, idUser)]);
    // Cores de cada skin colorível (mm3d-36): o código de cada uma, já validado.
    const looks = Object.fromEntries([...Colors.COLORABLE_SKINS].map((id) => [id, Colors.lookFor(colors, id)]));
    return { condition: w.condition, admin, skins: Skins.publicCatalog(w.owned, w.equipped, admin), colors: looks };
  }

  /** GET /skins — catálogo com posse e o que está vestido + moedas. */
  static async skins(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => ({
      wardrobe: await MeuMundoLifeService.wardrobeOf(ctx.client, idUser),
    }));
  }

  /** Adquirir uma skin: moedas do jogo, de graça para administrador (já tinha = não cobra de novo). */
  static async buySkin(idUser, rawSkin) {
    const skin = Skins.skinById(rawSkin);
    if (!skin || skin.kind !== "skin") return fail("skin");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const w = await MeuMundoStorage.getWardrobe(ctx.client, idUser);
      let bought = false;
      if (!w.owned.includes(skin.id)) {
        const cost = Skins.costFor(skin, await MeuMundoStorage.isAdmin(ctx.client, idUser));
        // Posse conferida sob o lock da pessoa: uma skin, um débito (ref fixa por pessoa + skin).
        const err = await charge(ctx, idUser, {
          currency: skin.currency,
          amount: cost,
          ref: `skin:${idUser}:${skin.id}`,
          what: { skin: skin.id },
        });
        if (err) return err;
        bought = await MeuMundoStorage.addSkin(ctx.client, idUser, skin.id, cost);
        if (bought) ctx.events.push({ at: ctx.now, kind: "skin_bought", data: { skin: skin.id, price: cost, currency: skin.currency } });
      }
      return { bought, wardrobe: await MeuMundoLifeService.wardrobeOf(ctx.client, idUser) };
    });
  }

  /** Vestir uma skin que já é sua, ou voltar ao padrão ('standard'). */
  static async equipSkin(idUser, rawSkin) {
    const skin = Skins.skinById(rawSkin);
    if (!skin) return fail("skin");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      if (skin.kind === "skin") {
        const w = await MeuMundoStorage.getWardrobe(ctx.client, idUser);
        if (!w.owned.includes(skin.id)) return fail("notOwned");
      }
      await MeuMundoStorage.setSkin(ctx.client, idUser, skin.id);
      return { wardrobe: await MeuMundoLifeService.wardrobeOf(ctx.client, idUser) };
    });
  }

  /**
   * Cores do personagem (mm3d-36, mig 304): de graça, quantas vezes quiser,
   * só no padrão e na feminina. Passa pelo núcleo da vida como vestir: no fim
   * a sala recebe o look novo (todos veem).
   */
  static async setSkinColors(idUser, rawSkin, rawLook) {
    const skin = Skins.skinById(rawSkin);
    if (!skin) return fail("skin");
    if (!Colors.COLORABLE_SKINS.has(skin.id)) return fail("noColors");
    const look = Colors.normalizeLook(rawLook);
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      await MeuMundoStorage.setColors(ctx.client, idUser, skin.id, look);
      return { look, wardrobe: await MeuMundoLifeService.wardrobeOf(ctx.client, idUser) };
    });
  }

  /**
   * Novo hóspede: só depois da morte. O antigo fica no banco (histórico,
   * morte vista); o novo nasce com geração + 1. A casa e a carteira são da
   * pessoa e continuam. Funeral e herança (mm3d-34) saem de Life.afterlife:
   * velhice = Freelandoo paga e o novo herda 20%; outra causa = o jogador paga
   * (até o que tiver) e o novo começa do zero. Tudo na mesma transação.
   */
  static async newcomer(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      if (s.status !== "dead") return fail("alive");
      await MeuMundoLifeStorage.markDeathSeen(ctx.client, ctx.row.id_character);
      const after = Life.afterlife(s);
      const funeral = { paidBy: after.funeral.paidBy, coins: after.funeral.coins };
      if (funeral.paidBy === "player") {
        funeral.coins = Math.min(after.funeral.coins, Math.max(0, Math.floor(ctx.coins)));
        ctx.coins -= funeral.coins;
      }
      const n = Life.applyInheritance(Life.birth(crypto.randomInt(1, 2 ** 31 - 1), ctx.now), after.inherit);
      ctx.newRow = await MeuMundoLifeStorage.insert(ctx.client, idUser, ctx.row.generation + 1, n);
      ctx.newState = n;
      // O funeral é do hóspede que se foi (fica no histórico dele).
      ctx.events.push({ at: ctx.now, kind: "funeral", data: { ...funeral, cause: s.deathCause } });
      ctx.newEvents = [
        { at: ctx.now, kind: "born", data: { generation: ctx.row.generation + 1, ...(after.inherit ? { inherited: after.inherit } : {}) } },
      ];
      return { newcomer: true, funeral, inherited: after.inherit };
    });
  }
}

module.exports = MeuMundoLifeService;
