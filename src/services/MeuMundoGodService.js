/**
 * MEU MUNDO 3D, lore v2 N4 — O DEUS SOLTO (mig 447).
 *
 * Estátua cheia no domingo (N3) → na semana seguinte o deus daquele povo anda e
 * caça a raça oposta, na rua (as salas do bairro e do centro: MobDirector em
 * modo deus) e nos Domínios (a cena é do aparelho). Alcançou = luta das Lâminas
 * com origem "god" (ficha do deus = 2× a de quem enfrenta: GOD_PEER na regra).
 * Perder só tira energia. A primeira vitória conferida derruba o deus para
 * todos, na MESMA transação do recibo da luta (`settle`).
 *
 * O estado fica numa cópia em memória (`current`), relida a cada REFRESH_MS e
 * logo depois de uma queda: as salas leem dela sem esperar o banco. O aviso de
 * "o deus soltou" sai uma vez por caçada (announced_at), mesmo com reinício.
 */
const pool = require("../databases");
const Store = require("../storages/MeuMundoGodStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const G = require("../utils/meuMundoGodHunt");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.god");

const REFRESH_MS = 30_000;

const ERRORS = {
  god: ["Esse deus não está solto", 409],
  prey: ["Esse deus não caça o seu povo", 403],
  where: ["O deus não te alcançou", 409],
  clan: ["Escolha a sua classe antes", 409],
};
const fail = (code, extra = {}) => {
  const [error, statusCode] = ERRORS[code];
  return { error, statusCode, code, ...extra };
};

/** Estado em memória (o que as salas e a tela leem). */
let cache = { loose: [], at: 0 };
let timer = null;
let refreshing = null;

/** O que vai para a sala e para o socket (sem dado de ninguém). */
const wireHunt = (h) => ({ id: h.id, god: h.god, clan: h.clan, prey: h.prey, looseAt: h.looseAt });

function emit(payload) {
  try {
    require("../realtime/socket").emitToAll("mm:god", payload);
  } catch (err) {
    log.warn("emit_fail", { message: err.message });
  }
}

function pushRooms() {
  try {
    require("../realtime/meuMundo").setGods(cache.loose.map(wireHunt));
  } catch (err) {
    log.warn("rooms_fail", { message: err.message });
  }
}

class MeuMundoGodService {
  /** Caçadas soltas agora (cópia em memória; sem banco). */
  static current() {
    return cache.loose;
  }

  /**
   * Relê do banco: estátuas cheias viram caçadas, as soltas vão para as salas e
   * as recém-soltas são avisadas (uma vez). Nunca dois ao mesmo tempo.
   */
  static async refresh(now = Date.now(), db = pool) {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        await Store.syncFromStatues(db);
        const loose = await Store.loose(db, now);
        cache = { loose, at: now };
        pushRooms();
        const fresh = await Store.announce(
          db,
          loose.map((h) => h.id),
          now
        );
        for (const h of fresh) {
          emit({ e: "loose", ...wireHunt(h) });
          log.info("god_loose", { god: h.god, source: h.source });
        }
        return loose;
      } finally {
        refreshing = null;
      }
    })();
    return refreshing;
  }

  /** Liga a releitura periódica (boot do servidor). */
  static start() {
    if (timer) return;
    const run = () => MeuMundoGodService.refresh().catch((err) => log.warn("refresh_fail", { message: err.message }));
    run();
    timer = setInterval(run, REFRESH_MS);
    timer.unref?.();
  }

  static stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** GET /deus — soltos, próximos e as últimas quedas. */
  static async state(idUser, now = Date.now(), db = pool) {
    await Store.syncFromStatues(db);
    const [loose, upcoming, fallen, clan] = await Promise.all([Store.loose(db, now), Store.upcoming(db, now), Store.fallen(db, 4), MeuMundoStorage.getClan(db, idUser)]);
    const mine = clan && clan.clan ? clan.clan : null;
    return {
      loose: loose.map((h) => ({ ...wireHunt(h), huntsMe: G.isPrey(h.god, mine) })),
      upcoming: upcoming.map(wireHunt),
      fallen: fallen.map((h) => ({ god: h.god, clan: h.clan, defeatedAt: h.defeatedAt, winner: h.winner })),
      me: { clan: mine },
      peer: G.GOD_PEER,
    };
  }

  /**
   * A luta contra o deus pode abrir? (chamado pelo fightStart, fora do withLife)
   * `where` "street" = a sala viu o deus alcançar a pessoa; "domain" = a pessoa
   * está num Domínio aberto para ela (a cena é do aparelho). Devolve { god, kind }.
   */
  static async gate(idUser, body = {}, db = pool, now = Date.now()) {
    const g = G.godOf(body.god);
    if (!g) return fail("god");
    const loose = await Store.loose(db, now);
    if (!loose.some((h) => h.god === g.id)) return fail("god");
    const clan = (await MeuMundoStorage.getClan(db, idUser)).clan;
    if (!clan) return fail("clan");
    if (!G.isPrey(g.id, clan)) return fail("prey");
    const where = String(body.where || "");
    if (where === "street") {
      if (!require("../realtime/meuMundo").godEngaged(idUser, g.id)) return fail("where");
    } else if (where === "domain") {
      const err = await require("./MeuMundoDomainService").canBeIn(idUser, body.domain, db);
      if (err) return err;
    } else return fail("where");
    return { god: g.id, kind: g.kind, where, domain: where === "domain" ? String(body.domain) : undefined };
  }

  /**
   * Vitória conferida contra o deus (dentro do withLife, recibo NOVO): derruba
   * para todos. Já caído (outro venceu antes) = `fresh: false`. Devolve o resumo.
   */
  static async settle(c, idUser, god, idFight, now) {
    const rows = await Store.defeat(c, { god, idUser, idFight, now });
    return { god, fresh: rows.length > 0 };
  }

  /** Depois do COMMIT de uma queda: avisa todos e tira o deus das salas. */
  static async fell(god, name, now = Date.now()) {
    cache = { loose: cache.loose.filter((h) => h.god !== god), at: now };
    pushRooms();
    emit({ e: "down", god, name: name || "" });
    log.info("god_down", { god });
    MeuMundoGodService.refresh(now).catch(() => {});
  }

  /** Admin: solta o deus de um povo agora (conferência). */
  static async adminRelease(idUser, body = {}, now = Date.now()) {
    const clan = String(body.clan || "");
    if (!G.godOfClan(clan)) return { error: "Povo inválido", statusCode: 400 };
    const c = await pool.connect();
    let out;
    try {
      await c.query("BEGIN");
      out = await Store.adminRelease(c, clan, now);
      await c.query("COMMIT");
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
    await MeuMundoGodService.refresh(now);
    log.info("god_admin_release", { clan, fresh: out.fresh });
    return { hunt: wireHunt(out.hunt), fresh: out.fresh };
  }
}

MeuMundoGodService.ERRORS = ERRORS;
module.exports = MeuMundoGodService;
