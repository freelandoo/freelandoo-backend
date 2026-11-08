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
const AuthStorage = require("../storages/AuthStorage");
const MeuMundoVehicleStorage = require("../storages/MeuMundoVehicleStorage");
const Inbox = require("../storages/MeuMundoInboxStorage");
const PolenStorage = require("../storages/PolenStorage");
const EmeraldStorage = require("../storages/EmeraldStorage");
const { rowToState } = require("../storages/MeuMundoLifeStorage");
const Cars = require("../utils/meuMundoCars");
const Life = require("../utils/meuMundoLife");
const Soul = require("../utils/meuMundoSoul");
const { grownHeight } = require("../utils/meuMundoHeights");
const Skins = require("../utils/meuMundoSkins");
const Colors = require("../utils/meuMundoColors");
const { createLogger } = require("../utils/logger");
const presence = require("../realtime/meuMundoPresence");

const log = createLogger("meuMundo.life");
/** Require tardio: o serviço do poder lê o equipamento, que usa o withLife. */
const MeuMundoPowerService = () => require("./MeuMundoPowerService");

const REST_ROUTE_KINDS = ["idle", "studying", "training", "working", "praying"];

const ERRORS = {
  item: ["Item não encontrado", 404],
  dead: ["Seu hóspede morreu", 409],
  hospital: ["Ele está internado no hospital", 409],
  jail: ["Ele está preso na delegacia", 409],
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
  place: ["Treino é na academia; estudo, na universidade, biblioteca ou escola; reza, na igreja — dentro do prédio", 409],
  menu: ["Isso não tem no cardápio", 404],
  away: ["Você precisa estar lá dentro", 409],
  market: ["Compras para a geladeira são no supermercado do centro", 409],
  nick: ["O apelido precisa ter de 2 a 20 letras", 400],
};

/** Apelido (mm3d-72): sem quebra de linha nem caractere de controle, espaços juntos, 2–20 letras. */
function cleanNick(raw) {
  const v = String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return v.length >= 2 && v.length <= 20 ? v : null;
}
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
  // mm3d-37f: multa e prisão.
  fined: 2,
  jailed: 1,
  // mm3d-58: virou adulto (+20% e saúde 100).
  adult: 2,
  // mm3d-72: o que ele quer (pela personalidade), e se o dono atendeu
  wish: 3,
  wish_ok: 3,
  wish_fail: 2,
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

/**
 * A7: abre a carteira de Esmeralda da pessoa (travada) junto da linha do jogo.
 * Jogador novo ganha as moedas de início; linha antiga ainda não migrada passa
 * o inteiro (o mesmo que a mig 332 faz). Devolve o saldo inicial, a fração e
 * o teto do trabalho.
 */
async function openEmerald(c, idUser) {
  const mm = await MeuMundoLifeStorage.lockWallet(c, idUser);
  let wallet = await EmeraldStorage.lockWallet(c, idUser);
  let frac = mm.coins;
  if (mm.fresh) {
    const g = await EmeraldStorage.credit(c, {
      user_id: idUser, wallet_id: wallet.id, amount: Life.RULES.START_COINS,
      type: "earn_meu_mundo", source: "mm_start", source_id: String(idUser), metadata: { reason: "start" },
    });
    if (g) wallet = g.wallet;
  } else if (!mm.migrated && Math.floor(mm.coins) > 0) {
    const g = await EmeraldStorage.credit(c, {
      user_id: idUser, wallet_id: wallet.id, amount: Math.floor(mm.coins),
      type: "earn_coin_migration", source: "mm_coins", source_id: String(idUser), metadata: { rule: "mm_coins_1_1", old_coins: mm.coins },
    });
    if (g) wallet = g.wallet;
    frac = mm.coins - Math.floor(mm.coins);
  }
  const settings = await EmeraldStorage.getSettings(c);
  const cap = Number(settings?.work_daily_cap);
  return {
    wallet,
    start: Number(wallet.balance) || 0,
    frac: Math.max(0, Math.min(0.999999, frac)),
    workCap: Number.isFinite(cap) && cap >= 0 ? cap : Life.RULES.WORK_COINS_DAY,
  };
}

/**
 * Fecha a carteira: o inteiro de `coins` é o saldo novo de Esmeralda. O que o
 * trabalho rendeu entra como `earn_meu_mundo_work`; o resto do movimento
 * (luta, minijogo, presente, compra, multa, funeral) é uma linha líquida
 * `earn_meu_mundo` / `spend_meu_mundo`. Saldo nunca negativo.
 */
async function settleEmerald(c, idUser, purse, coins, earned, what) {
  const balance = Math.max(0, Math.floor(coins + 1e-9));
  const frac = Math.max(0, coins - balance);
  const delta = balance - purse.start;
  if (delta === 0) return { balance, frac };
  const ref = `${idUser}:${Date.now()}:${crypto.randomUUID()}`;
  const meta = what ? { what } : {};
  const work = Math.max(0, Math.min(Math.floor(earned || 0), delta > 0 ? delta : Math.floor(earned || 0)));
  if (work > 0) {
    await EmeraldStorage.credit(c, {
      user_id: idUser, wallet_id: purse.wallet.id, amount: work,
      type: "earn_meu_mundo_work", source: "meu_mundo_work", source_id: ref, metadata: meta,
    });
  }
  const rest = delta - work;
  if (rest > 0) {
    await EmeraldStorage.credit(c, {
      user_id: idUser, wallet_id: purse.wallet.id, amount: rest,
      type: "earn_meu_mundo", source: "meu_mundo", source_id: ref, metadata: meta,
    });
  } else if (rest < 0) {
    const d = await EmeraldStorage.debit(c, {
      user_id: idUser, wallet_id: purse.wallet.id, amount: -rest,
      type: "spend_meu_mundo", source: "meu_mundo", source_id: ref, metadata: meta,
    });
    if (!d) throw new Error("Esmeralda do jogo ficaria negativa");
  }
  return { balance, frac };
}

/**
 * Recibo só de tela (2026-11-03): comeu, tomou remédio ou acordou — o aparelho
 * sobe o brilho e os números. Não credita nada: a mudança já está na vida.
 */
function careReceipt(action, at, felt) {
  const vitals = {};
  for (const [k, v] of Object.entries(felt)) if (Math.round(v)) vitals[k] = Math.round(v);
  return { eventId: `care:${action}`, source: "care", actionKey: action, rules: "", activeMs: 0, result: {}, deltas: { vitals }, items: [], at: new Date(at).toISOString() };
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
      // A7: as moedas do jogo SÃO a Verde Esmeralda (carteira da Freelandoo).
      // ctx.coins = saldo de Esmeralda + a fração guardada em tb_mm_wallet; no
      // fim, a diferença inteira vira linha no ledger (settleEmerald).
      const purse = await openEmerald(c, idUser);
      let coins = purse.start + purse.frac;
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
      // mm3d-72: a alma antes da simulação (o comilão tem o apetite do corpo no alto)
      Soul.soulOf(s);
      // Admin (testes): energia infinita, nunca exausto, fôlego sem fim (vale também no tempo fora do jogo).
      const admin = MeuMundoLifeService.adminPerks && (await AuthStorage.isAdmin(c, idUser));
      if (admin) Life.adminTopUp(s);
      // A carteira entra na simulação: o trabalho rende e a rotina compra comida.
      const wallet = { coins, workCap: purse.workCap };
      const sim = Life.simulate(s, now, wallet, pantry);
      events.push(...sim.events);
      if (admin) Life.adminTopUp(s);
      coins = wallet.coins;
      const ctx = { now, row, coins, events, client: c, pantry };
      const extra = act ? await act(s, ctx) : {};
      if (extra && extra.error) {
        await c.query("ROLLBACK");
        return extra;
      }
      const idCharacter = ctx.newRow ? ctx.newRow.id_character : row.id_character;
      const state = ctx.newState || s;
      // mm3d-72: a alma sente o que aconteceu (afeto, desejos) — eventos da simulação + o que a pessoa fez agora
      const soulRes = Soul.applyEvents(s, events, now);
      events.push(...soulRes.events);
      if (ctx.newState) Soul.soulOf(ctx.newState);
      const nickname = await MeuMundoLifeStorage.nickname(c, idUser);
      Life.noteSleep(s, now);
      const care = ctx.felt ? [careReceipt(`${idCharacter}:eat:${now}`, now, ctx.felt)] : [];
      // Acordou: fica guardado até a pessoa estar no jogo para ver.
      if (s.woke && presence.get(idUser)) {
        const { at, ...felt } = s.woke;
        care.push(careReceipt(`${idCharacter}:woke:${at}`, at, felt));
        delete s.woke;
      }
      const needs0 = Life.snapshot(state, now).needs;
      // mm3d-72 ("Putz! A geladeira tá vazia!"): sem comida nenhuma na geladeira
      const fridgeEmpty = state.status === "alive" && !Object.entries(pantry).some(([id, n]) => n > 0 && Soul.FOODS.includes(id));
      const needsNow = fridgeEmpty ? [...needs0, { id: "fridge_empty", level: 4 }].sort((x, y) => x.level - y.level) : needs0;
      const notices = await recordNotices(c, idUser, row.id_character, needsNow, [
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
      const emerald = await settleEmerald(c, idUser, purse, Math.max(0, ctx.coins), sim.earned, ctx.what);
      await MeuMundoLifeStorage.setCoins(c, idUser, emerald.frac);
      await MeuMundoLifeStorage.savePantry(c, idUser, pantry0, pantry);
      // O tipo físico do avatar É o corpo da vida (não se escolhe desde
      // 2026-10-21): gravado só quando muda — é o que as entradas leem.
      await MeuMundoStorage.setBody(c, idUser, Life.bodyHint(state));
      // O que a sala desenha: a skin vestida ou a condição (mig 300).
      const avatar = await MeuMundoStorage.getBody(c, idUser);
      // Cores da skin vestida (mm3d-36, mig 304): "" = visual próprio.
      const look = await MeuMundoStorage.getLook(c, idUser);
      // T3 (mig 334): o PODER do hóspede, recalculado a cada mudança da vida
      // (regra gerada do front: src/utils/meuMundoPower.js).
      const power = await MeuMundoPowerService().refresh(c, idUser, idCharacter, state, now);
      await c.query("COMMIT");
      const cur = ctx.newRow || row;
      const snap0 = {
        generation: cur.generation,
        bornAt: new Date(cur.born_at).toISOString(),
        deathSeen: !!cur.death_seen_at || !!ctx.deathSeen,
        ...Life.snapshot(state, now),
        needs: needsNow,
        // mm3d-72: personalidade, afeto, gosta/odeia, desejo e como ele chama o dono
        soul: { ...Soul.view(state, now), nickname, felt: soulRes.delta },
        power,
      };
      const snap = admin ? Life.adminView(snap0) : snap0;
      // Altura de agora (2026-11-02): o corpo desenhado + o crescimento da vida.
      const height = grownHeight(avatar, state.growth, now);
      const out = {
        now: new Date(now).toISOString(),
        character: snap,
        height,
        // `coins` = Esmeralda (nome antigo da chave mantido para o aparelho);
        // `polens` = Gold quando a ação mexeu nele.
        wallet: { coins: emerald.balance, emerald: emerald.balance, ...(ctx.polens != null ? { polens: ctx.polens, gold: ctx.polens } : {}) },
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
        // Fim da atividade (ISO): o cronômetro da cela (mm3d-37f).
        until: snap.activity.until,
        bed: state.activity.bed,
        body: avatar,
        look,
        height,
        // Avisos com retrato e fôlego de corrida (2026-10-24).
        needs: snap.needs,
        // mm3d-72: as falas no jogo usam a personalidade e o apelido
        soul: snap.soul,
        stamina: snap.stamina,
        // HUD do personagem (mm3d-60d): saúde/energia/estresse e o teto da saúde
        vitals: {
          health: snap.vitals.health,
          energy: snap.vitals.energy,
          stress: snap.vitals.stress,
          vitality: snap.vitals.vitality,
        },
      });
      for (const n of notices) require("./MeuMundoInboxService").push(idUser, n);
      for (const r of care) presence.send(idUser, "receipt", r);
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
      ctx.felt = r.felt;
      return { consumed: { item: item.id, price: item.price } };
    });
  }

  /**
   * Pedido no balcão da pizzaria/hamburgueria (mm3d-37c): item do cardápio
   * do lugar, a pessoa lá dentro (sala do centro); come na hora, pagando.
   */
  static async order(idUser, rawPlace, rawItem) {
    const place = String(rawPlace || "");
    const menu = Life.MENUS[place];
    if (!menu) return fail("away");
    const itemId = String(rawItem || "");
    if (!menu.includes(itemId)) return fail("menu");
    if (!require("../realtime/meuMundo").atCenterPlace(idUser, place)) return fail("away");
    return MeuMundoLifeService.consume(idUser, itemId);
  }

  /**
   * Crime visto pela sala do centro (mm3d-37f): multa (até o que tiver) ou
   * prisão. Devolve { jailed, minutes } para a sala tirar a pessoa do carro.
   */
  static async crime(idUser, kind) {
    if (kind !== "praca" && kind !== "atropelamento") return fail("activity");
    return MeuMundoLifeService.withLife(idUser, (s, ctx) => {
      const r = Life.crime(s, kind, ctx.now);
      if (!r.ok) return { crime: null };
      if (r.fine) {
        const paid = Math.min(Math.max(0, Math.floor(ctx.coins)), r.fine);
        ctx.coins -= paid;
        r.events[0].data.coins = paid;
      }
      ctx.events.push(...r.events);
      return { crime: { kind, fine: r.fine ? r.events[0].data.coins : 0, jailed: !!r.jailed, minutes: r.minutes || 0 } };
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
    // Só no supermercado do centro (mm3d-37c), segundo a sala do centro.
    if (!require("../realtime/meuMundo").atCenterPlace(idUser, Life.MARKET_PLACE)) return fail("market");
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
      ctx.felt = r.felt;
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
    const [w, admin, colors, clanBody] = await Promise.all([
      MeuMundoStorage.getWardrobe(db, idUser),
      MeuMundoStorage.isAdmin(db, idUser),
      MeuMundoStorage.getColors(db, idUser),
      MeuMundoStorage.getClanBody(db, idUser),
    ]);
    // Cores de cada skin colorível (mm3d-36): o código de cada uma, já validado.
    const looks = Object.fromEntries([...Colors.COLORABLE_SKINS].map((id) => [id, Colors.lookFor(colors, id)]));
    // mm3d-58: o "Padrão" do vestuário é o personagem da classe.
    return { condition: w.condition, clanBody, admin, skins: Skins.publicCatalog(w.owned, w.equipped, admin), colors: looks };
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
      if (skin.adminOnly && !(await MeuMundoStorage.isAdmin(ctx.client, idUser))) return fail("skin");
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
      if (skin.adminOnly) {
        // mm3d-58: skin de teste das classes — só administrador, sem compra.
        if (!(await MeuMundoStorage.isAdmin(ctx.client, idUser))) return fail("skin");
      } else if (skin.kind === "skin") {
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
  /** O apelido que a pessoa escolhe para si (mm3d-72): o hóspede chama o dono assim. */
  static async setNickname(idUser, raw) {
    const nick = cleanNick(raw);
    if (!nick) return fail("nick");
    await MeuMundoLifeStorage.setNickname(pool, idUser, nick);
    return MeuMundoLifeService.withLife(idUser);
  }

  /** O apelido que a pessoa dá ao hóspede (mm3d-72); vale para este hóspede. */
  static async setPetName(idUser, raw) {
    const nick = cleanNick(raw);
    if (!nick) return fail("nick");
    return MeuMundoLifeService.withLife(idUser, (s) => {
      Soul.soulOf(s).petName = nick;
      return { petName: nick };
    });
  }

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

/**
 * Admin com energia infinita, nunca exausto e fôlego sem fim (2026-10-28,
 * pedido do Alex para os testes). A suíte da vida desliga para testar a regra.
 */
MeuMundoLifeService.adminPerks = true;

module.exports = MeuMundoLifeService;
