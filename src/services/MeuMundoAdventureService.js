// src/services/MeuMundoAdventureService.js — MEU MUNDO 3D mm3d-59: lutas
// conferidas pelo servidor, RECIBOS e XP de aventura.
//
// Toda concessão (XP, atributo, moedas, itens) passa por um recibo único por
// (personagem, origem, ação). Tudo roda dentro de `MeuMundoLifeService.withLife`
// — a mesma transação e o mesmo advisory lock que a vida, a carteira e a
// geladeira — então duas abas, reconexão ou reenvio nunca concedem duas vezes:
// o segundo pedido recebe o MESMO recibo (mesmo eventId) com `replay: true`.
//
// Luta: o servidor sorteia a semente e guarda o ticket; o fim re-simula a
// entrada gravada pela cópia gerada da regra (src/utils/meuMundoFight.js). O
// "venci" do aparelho não vale nada.

const crypto = require("crypto");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const Store = require("../storages/MeuMundoAdventureStorage");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const Life = require("../utils/meuMundoLife");
const Adv = require("../utils/meuMundoAdventure");
const FightSim = require("../utils/meuMundoFight");

const ORIGINS = Object.freeze(["laminas", "boxe", "mob", "tutorial"]);
const TICKET_TTL_MS = 8 * 60 * 1000;
/** Folga entre o tempo da luta gravada e o relógio do servidor (rede, carregamento). */
const CLOCK_SLACK_MS = 3000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ERRORS = {
  kind: ["Inimigo desconhecido", 400],
  origin: ["Origem da luta inválida", 400],
  mob: ["Esse monstro não está lutando com você", 409],
  ticket: ["Luta não encontrada", 404],
  expired: ["A luta expirou", 410],
  closed: ["Essa luta já terminou", 409],
  replay: ["Não foi possível conferir a luta", 422],
  clock: ["A gravação da luta não bate com o tempo", 422],
  dead: ["Hóspede sem vida", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

const r2 = (v) => Math.round(v * 100) / 100;

/** Atributos que a luta usa (sem o benefício de admin: a vida já é a mesma). */
const fightStats = (s) => ({ strength: s.strength, speed: s.speed, intelligence: s.intelligence, dexterity: s.dexterity });

/** Soma XP na linha da aventura (já travada) e devolve o antes/depois. */
function addXp(adv, xp) {
  const before = Adv.levelOf(Number(adv.xp));
  const total = Number(adv.xp) + Math.max(0, Math.round(xp));
  const after = Adv.levelOf(total);
  adv.xp = total;
  adv.level = after.level;
  return {
    xp: Math.max(0, Math.round(xp)),
    total,
    from: before.level,
    to: after.level,
    into: after.into,
    need: after.need,
    unlocks: Object.entries(Adv.UNLOCKS)
      .filter(([lv]) => Number(lv) > before.level && Number(lv) <= after.level)
      .flatMap(([, u]) => u),
  };
}

/** Derrotas seguidas no dia de Brasília de `now`. */
function lossesToday(adv, now) {
  const day = Life.localParts(now).day;
  const d = adv.losses_day ? new Date(adv.losses_day).toISOString().slice(0, 10) : null;
  return d === day ? adv.losses : 0;
}

/**
 * Fecha uma luta conferida (ou abandonada) dentro do withLife: custo, prática,
 * XP e recibo. Devolve o recibo público.
 */
async function settleFight(s, ctx, idUser, fight, verdict) {
  const c = ctx.client;
  const setup = fight.setup;
  const origin = fight.origin;
  const tutorial = origin === "tutorial";
  const adv = await Store.lockAdventure(c, idUser);
  const before = { energy: s.energy, stress: s.stress };
  const streak = lossesToday(adv, ctx.now);
  const cost = Adv.applyFightCost(s, verdict.win, streak, tutorial);
  // Prática: tempo ATIVO conferido, terminando agora (a luta acabou agora).
  const activeMs = Math.round(verdict.activeSteps * FightSim.DT * 1000);
  const activity = origin === "boxe" ? "boxe" : "laminas";
  const practice = verdict.abandoned ? { attrs: {}, base: {}, activeMs: 0 } : Adv.practice(s, activity, [{ from: ctx.now - activeMs, to: ctx.now }]);
  const xpGain = verdict.abandoned ? 0 : Adv.fightXp(setup.kind, setup.level, verdict.win);
  const level = addXp(adv, xpGain);
  const day = Life.localParts(ctx.now).day;
  adv.losses = verdict.win ? 0 : streak + 1;
  adv.losses_day = day;
  await Store.saveAdventure(c, idUser, { xp: adv.xp, level: adv.level, losses: adv.losses, lossesDay: adv.losses_day });
  await Store.closeFight(c, fight.id_fight);
  const rec = await Store.insertReceipt(c, {
    idUser,
    idCharacter: ctx.row.id_character,
    source: "fight",
    actionKey: fight.id_fight,
    rules: Adv.RULES_VERSION,
    activeMs: practice.activeMs,
    result: {
      origin,
      kind: setup.kind,
      level: setup.level,
      win: verdict.win,
      abandoned: !!verdict.abandoned,
      steps: verdict.steps || 0,
      hits: verdict.hits || 0,
      hitsTaken: verdict.hitsTaken || 0,
      mobId: setup.mobId ?? null,
    },
    deltas: {
      xp: level,
      attrs: practice.attrs,
      // delta EFETIVO (depois dos limites 0–100)
      vitals: { energy: r2(s.energy - before.energy), stress: r2(s.stress - before.stress) },
      cost,
    },
    items: [],
  });
  ctx.events.push({ at: ctx.now, kind: "fight", data: { origin, kind: setup.kind, win: verdict.win, abandoned: !!verdict.abandoned, xp: level.xp } });
  return rec;
}

class MeuMundoAdventureService {
  /** GET /adventure — nível, XP e os últimos recibos. */
  static async get(idUser) {
    const pool = require("../databases");
    const adv = await Store.getAdventure(pool, idUser);
    const lv = Adv.levelOf(Number(adv.xp));
    return {
      adventure: { ...lv, unlocks: Adv.UNLOCKS, rules: Adv.RULES_VERSION },
      receipts: await Store.recentReceipts(pool, idUser, 20),
    };
  }

  /**
   * Abre uma luta: o servidor sorteia a semente, lê os atributos e a classe e
   * guarda o ticket. Monstro da rua só se a sala viu esse monstro pegar a pessoa.
   * Uma luta aberta antes e nunca fechada conta como abandono (derrota, uma vez).
   */
  static async fightStart(idUser, body = {}) {
    const origin = String(body.origin || "");
    if (!ORIGINS.includes(origin)) return fail("origin");
    let kind = String(body.kind || "");
    let level = Math.max(1, Math.min(3, Math.round(Number(body.level) || 1)));
    let mobId = null;
    if (origin === "mob") {
      mobId = Number(body.mobId);
      const m = require("../realtime/meuMundo").mobEngaged(idUser, mobId);
      if (!m) return fail("mob");
      kind = m.kind;
      level = 1;
    }
    if (origin === "tutorial") {
      kind = "soldier";
      level = 1;
    }
    if (!FightSim.MOB_KINDS.includes(kind)) return fail("kind");
    if (kind === "soldier") level = Math.min(level, 2);
    const clan = (await MeuMundoStorage.getClan(require("../databases"), idUser)).clan;
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      if (s.status !== "alive") return fail("dead");
      const c = ctx.client;
      const abandoned = [];
      for (const old of await Store.openFights(c, idUser)) {
        abandoned.push(await settleFight(s, ctx, idUser, old, { win: false, abandoned: true, activeSteps: 0 }));
      }
      const setup = {
        kind,
        level,
        seed: crypto.randomInt(1, 2 ** 31 - 1),
        stats: fightStats(s),
        // Kit pela CLASSE (mm3d-59): raposa = maga; o ringue do Boxe é sempre de luvas.
        style: origin !== "boxe" && clan === "raposa" ? "mage" : undefined,
        mobId,
      };
      // tutorial: o inimigo entra enfraquecido (pedido do prólogo)
      if (origin === "tutorial") setup.stats = { ...setup.stats, strength: Math.max(setup.stats.strength, 400) };
      const t = await Store.insertFight(c, { idUser, idCharacter: ctx.row.id_character, origin, setup, ttlMs: TICKET_TTL_MS });
      return {
        fight: {
          ticket: t.id_fight,
          origin,
          setup: { kind, level, seed: setup.seed, stats: setup.stats, style: setup.style ?? null },
          expiresAt: new Date(t.expires_at).toISOString(),
        },
        abandoned,
      };
    });
  }

  /**
   * Fecha a luta: re-simula a gravação e concede pelo resultado do SERVIDOR.
   * Reenvio do mesmo ticket = o mesmo recibo (`replay: true`), sem conceder de novo.
   */
  static async fightFinish(idUser, body = {}) {
    const ticket = String(body.ticket || "");
    if (!UUID.test(ticket)) return fail("ticket");
    let mobVerdict = null;
    const out = await MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const fight = await Store.lockFight(c, idUser, ticket);
      if (!fight) return fail("ticket");
      const same = await Store.findReceipt(c, fight.id_character, "fight", fight.id_fight);
      if (same) return { receipt: same, replay: true };
      if (fight.closed_at) return fail("closed");
      if (fight.id_character !== ctx.row.id_character) return fail("closed");
      const setup = fight.setup;
      const verdict = FightSim.replayFight(
        { kind: setup.kind, level: setup.level, seed: setup.seed, stats: setup.stats, style: setup.style || undefined },
        body.frames
      );
      if (!verdict.ok) return fail("replay");
      const elapsed = ctx.now - new Date(fight.started_at).getTime();
      if (verdict.steps * FightSim.DT * 1000 > elapsed + CLOCK_SLACK_MS) return fail("clock");
      if (ctx.now > new Date(fight.expires_at).getTime() + CLOCK_SLACK_MS) return fail("expired");
      const receipt = await settleFight(s, ctx, idUser, fight, verdict);
      if (fight.origin === "mob") mobVerdict = { mobId: setup.mobId, win: verdict.win };
      return { receipt, replay: false };
    });
    // Depois do COMMIT: a sala tira o monstro (vitória) ou o solta (derrota).
    if (mobVerdict && !out.error) {
      try {
        require("../realtime/meuMundo").mobVerdict(idUser, mobVerdict.mobId, mobVerdict.win);
      } catch {
        /* sala fora do ar: o monstro some sozinho pelo tempo */
      }
    }
    return out;
  }
}

module.exports = MeuMundoAdventureService;
module.exports.addXp = addXp;
