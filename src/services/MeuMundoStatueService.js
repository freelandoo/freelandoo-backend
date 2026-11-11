/**
 * MEU MUNDO 3D, lore v2 N3: DOMINGO NA ESTÁTUA (mig 442).
 *
 * Entrega: só no domingo (Brasília), na estátua do PRÓPRIO deus, conferida pela
 * última visita gravada pela sala (F4) — o aparelho não diz onde está. Leva
 * TODO o "néctar para entregar" da carteira (N2) numa transação: trava a
 * carteira, grava o recibo (conta × chave do pedido: repetir o pedido devolve o
 * mesmo recibo), debita e soma na corrida do povo. A corrida (Raposas ×
 * Vampiros) vai ao vivo por socket (`mm:statue`) e para as salas do jogo
 * (`statue`). Robô não tem conta: nunca entrega.
 *
 * Meta (decisão D4): max(base, ativos × por ativo), números no admin; congela na
 * primeira entrega do domingo (o admin pode recalcular as estátuas ainda não
 * cheias). Estátua cheia = `full_at` em tb_mm_statue_week (a N4 lê).
 */
const pool = require("../databases");
const Store = require("../storages/MeuMundoStatueStorage");
const NectarStore = require("../storages/MeuMundoNectarStorage");
const PlaceService = require("./MeuMundoPlaceService");
const S = require("../utils/meuMundoScores");
const St = require("../utils/meuMundoStatue");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.statue");

const ERRORS = {
  key: ["Ação inválida", 400],
  clan: ["Escolha a classe primeiro", 409],
  sunday: ["A estátua só recebe néctar no domingo", 409],
  far: ["Chegue ao pé da estátua do seu deus", 409],
  empty: ["Você não tem néctar para entregar", 409],
  config: ["Valores inválidos para a meta", 400],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code];
  return { error, statusCode, code };
};

const clanOf = async (db, idUser) => {
  const c = ((await db.query(`SELECT clan FROM tb_mm_clan WHERE id_user = $1`, [idUser])).rows[0] || {}).clan;
  return St.CLANS.includes(c) ? c : null;
};

const randomKey = () => `srv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** A corrida de um domingo, com a meta "virtual" de quem ainda não recebeu nada. */
async function raceOf(db, week) {
  const [rows, cfg, active] = await Promise.all([Store.races(db, week), Store.config(db), Store.activeByClan(db, S.previousWeek(week))]);
  const out = {};
  for (const clan of St.CLANS) {
    const r = rows.find((x) => x.clan === clan) || { deliveredMl: 0, goalMl: St.goalFor(active[clan], cfg), active: active[clan], donors: 0, fullAt: null };
    out[clan] = { god: St.GOD_OF[clan], deliveredMl: r.deliveredMl, goalMl: r.goalMl, active: r.active, donors: r.donors, stage: St.stageOf(r.deliveredMl, r.goalMl), fullAt: r.fullAt };
  }
  return out;
}

/** O que vai pelo socket (sem dado de ninguém). */
const wire = (week, race) => ({
  week,
  raposa: { d: race.raposa.deliveredMl, g: race.raposa.goalMl, s: race.raposa.stage, f: !!race.raposa.fullAt },
  vampiro: { d: race.vampiro.deliveredMl, g: race.vampiro.goalMl, s: race.vampiro.stage, f: !!race.vampiro.fullAt },
});

// ── ao vivo: no máximo um envio a cada BROADCAST_MS (o último sempre vai) ──
const BROADCAST_MS = 1500;
let lastSent = 0;
let pending = null;
let timer = null;
function send(payload) {
  lastSent = Date.now();
  try {
    require("../realtime/socket").emitToAll("mm:statue", payload);
  } catch (err) {
    log.warn("emit_fail", { message: err.message });
  }
  try {
    require("../realtime/meuMundo").broadcastStatue(payload);
  } catch (err) {
    log.warn("room_fail", { message: err.message });
  }
}
function broadcast(payload) {
  pending = payload;
  const wait = BROADCAST_MS - (Date.now() - lastSent);
  if (wait <= 0 && !timer) {
    pending = null;
    return send(payload);
  }
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    const p = pending;
    pending = null;
    if (p) send(p);
  }, Math.max(0, wait));
  timer.unref?.();
}

class MeuMundoStatueService {
  /** GET /estatua — a corrida deste domingo (ou a do último), a minha carteira e se posso entregar daqui. */
  static async race(idUser, now = Date.now()) {
    const week = St.raceWeek(now);
    const sunday = St.isSunday(now);
    const [race, clan, wallet, last] = await Promise.all([raceOf(pool, week), clanOf(pool, idUser), NectarStore.wallet(pool, idUser), PlaceService.lastVisit(pool, idUser)]);
    const mine = clan ? await Store.deliveredThisWeek(pool, idUser, week) : 0;
    return {
      week,
      sunday,
      opensAt: new Date(St.nextSundayAt(now)).toISOString(),
      endsAt: new Date(St.sundayEndsAt(week)).toISOString(),
      stages: St.STAGES,
      race,
      me: {
        clan,
        god: clan ? St.GOD_OF[clan] : null,
        pendingMl: wallet.pendingMl,
        deliveredMl: mine,
        // posso entregar AGORA? (domingo + última visita foi a estátua do meu deus)
        atStatue: !!clan && St.placeOk(clan, last, now),
      },
    };
  }

  /** POST /estatua/entregar { key } — entrega todo o néctar da carteira. */
  static async deliver(idUser, body = {}, now = Date.now()) {
    const key = body.key == null || body.key === "" ? randomKey() : String(body.key);
    if (!St.KEY_RE.test(key)) return fail("key");
    const clan = await clanOf(pool, idUser);
    if (!clan) return fail("clan");
    // o mesmo pedido repetido (resposta perdida) devolve o mesmo recibo, até depois do domingo
    const replay = await Store.findDelivery(pool, idUser, key);
    if (replay) return MeuMundoStatueService.answer(idUser, replay, true, now);
    if (!St.isSunday(now)) return fail("sunday");
    if (!St.placeOk(clan, await PlaceService.lastVisit(pool, idUser), now)) return fail("far");
    // a semana passada ainda não fechou (primeiros minutos do domingo)? fecha agora
    try {
      await require("./MeuMundoNectarService").closeWeek(null, now);
    } catch (err) {
      log.warn("close_before_deliver", { message: err.message });
    }
    const week = St.raceWeek(now);
    const c = await pool.connect();
    let delivery = null;
    let race = null;
    let filled = false;
    try {
      await c.query("BEGIN");
      const pendingMl = await Store.lockWallet(c, idUser);
      const again = await Store.findDelivery(c, idUser, key);
      if (again) {
        await c.query("ROLLBACK");
        return MeuMundoStatueService.answer(idUser, again, true, now);
      }
      if (pendingMl <= 0) {
        await c.query("ROLLBACK");
        return fail("empty");
      }
      const active = (await Store.activeByClan(c, S.previousWeek(week)))[clan];
      const before = await Store.lockRace(c, { week, clan, goalMl: St.goalFor(active, await Store.config(c)), active });
      const prior = await Store.deliveredThisWeek(c, idUser, week);
      delivery = await Store.insertDelivery(c, { idUser, key, week, clan, place: St.PLACE_OF[clan], ml: pendingMl, now });
      if ((await Store.debit(c, idUser, pendingMl)) == null) throw new Error("néctar: débito falhou com a carteira travada");
      race = await Store.addToRace(c, { week, clan, ml: pendingMl, newDonor: prior === 0, now });
      filled = !before.fullAt && !!race.fullAt;
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      if (err && err.code === "23505") {
        const same = await Store.findDelivery(pool, idUser, key);
        if (same) return MeuMundoStatueService.answer(idUser, same, true, now);
      }
      throw err;
    } finally {
      c.release();
    }
    log.info("delivered", { week, clan, ml: delivery.ml, total: race.deliveredMl, goal: race.goalMl, filled });
    if (filled) log.info("statue_full", { week, clan, at: race.fullAt });
    const out = await MeuMundoStatueService.answer(idUser, delivery, false, now);
    broadcast(wire(week, out.race));
    return { ...out, filled };
  }

  static async answer(idUser, delivery, replay, now) {
    const snap = await MeuMundoStatueService.race(idUser, now);
    return { delivery, replay, ...snap };
  }

  /** GET /estatua/config (admin) — os números da meta, em litros na tela. */
  static async getConfig(now = Date.now()) {
    const cfg = await Store.config(pool);
    const week = St.raceWeek(now);
    return { baseL: cfg.baseMl / 1000, perActiveL: cfg.perActiveMl / 1000, updatedAt: cfg.updatedAt, week, race: await raceOf(pool, week) };
  }

  /** POST /estatua/config (admin) { baseL, perActiveL } — grava e recalcula as estátuas ainda não cheias deste domingo. */
  static async saveConfig(idUser, body = {}, now = Date.now()) {
    const cfg = St.parseConfig(body);
    if (!cfg) return fail("config");
    const week = St.raceWeek(now);
    const c = await pool.connect();
    try {
      await c.query("BEGIN");
      await Store.saveConfig(c, cfg, idUser);
      await Store.regoal(c, week, cfg, now);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
    const out = await MeuMundoStatueService.getConfig(now);
    broadcast(wire(week, out.race));
    return out;
  }
}

MeuMundoStatueService.ERRORS = ERRORS;
module.exports = MeuMundoStatueService;
