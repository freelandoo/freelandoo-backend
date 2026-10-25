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
const { rowToState } = require("../storages/MeuMundoLifeStorage");
const Life = require("../utils/meuMundoLife");
const Skins = require("../utils/meuMundoSkins");
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
  alive: ["Seu hóspede está vivo", 409],
  empty: ["Acabou na geladeira", 409],
  stack: ["A geladeira não cabe mais desse item", 409],
  qty: ["Quantidade inválida", 400],
  key: ["Pedido inválido", 400],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

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
        wallet: { coins: Math.floor(Math.max(0, ctx.coins)) },
        avatar,
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
        // Avisos com retrato e fôlego de corrida (2026-10-24).
        needs: snap.needs,
        stamina: snap.stamina,
      });
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
  static async setActivity(idUser, rawKind, rawHours) {
    const kind = String(rawKind || "");
    if (!REST_ROUTE_KINDS.includes(kind)) return fail(kind === "lying" || kind === "sleeping" ? "bed" : "activity");
    return MeuMundoLifeService.withLife(idUser, (s, ctx) => {
      // Parar de dormir/deitar pela rota = levantar: a sala solta da cama.
      const r = Life.startActivity(s, kind, rawHours, ctx.now);
      if (!r.ok) return fail(r.code);
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

  /** Mercado → geladeira: cobra `qty` × preço e guarda (não come). */
  static async buy(idUser, rawItem, rawQty = 1) {
    const item = Life.ITEM_BY_ID.get(String(rawItem || ""));
    if (!item) return fail("item");
    const qty = Number(rawQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > Life.FRIDGE.MAX_BUY) return fail("qty");
    return MeuMundoLifeService.withLife(idUser, (s, ctx) => {
      const cost = item.price * qty;
      if (ctx.coins < cost) return fail("coins");
      const have = ctx.pantry[item.id] || 0;
      if (have + qty > Life.FRIDGE.MAX_STACK) return fail("stack");
      ctx.coins -= cost;
      ctx.pantry[item.id] = have + qty;
      ctx.events.push({ at: ctx.now, kind: "buy", data: { item: item.id, qty, price: cost } });
      return { bought: { item: item.id, qty, price: cost } };
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

  // ═══ VESTUÁRIO (mm3d-16, mig 300) ═══
  // Comprar e vestir passam pelo núcleo da vida: a carteira é a mesma (trava,
  // simula até agora, cobra) e a sala recebe o corpo novo no fim, como recebe
  // a mudança de condição física.

  static async wardrobeOf(db, idUser) {
    const [w, admin] = await Promise.all([MeuMundoStorage.getWardrobe(db, idUser), MeuMundoStorage.isAdmin(db, idUser)]);
    return { condition: w.condition, admin, skins: Skins.publicCatalog(w.owned, w.equipped, admin) };
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
        if (ctx.coins < cost) return fail("coins");
        bought = await MeuMundoStorage.addSkin(ctx.client, idUser, skin.id, cost);
        if (bought) {
          ctx.coins -= cost;
          ctx.events.push({ at: ctx.now, kind: "skin_bought", data: { skin: skin.id, price: cost } });
        }
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
   * Novo hóspede: só depois da morte. O antigo fica no banco (histórico,
   * morte vista); o novo nasce com geração + 1. A casa e a carteira são da
   * pessoa e continuam.
   */
  static async newcomer(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      if (s.status !== "dead") return fail("alive");
      await MeuMundoLifeStorage.markDeathSeen(ctx.client, ctx.row.id_character);
      const n = Life.birth(crypto.randomInt(1, 2 ** 31 - 1), ctx.now);
      ctx.newRow = await MeuMundoLifeStorage.insert(ctx.client, idUser, ctx.row.generation + 1, n);
      ctx.newState = n;
      ctx.newEvents = [{ at: ctx.now, kind: "born", data: { generation: ctx.row.generation + 1 } }];
      return { newcomer: true };
    });
  }
}

module.exports = MeuMundoLifeService;
