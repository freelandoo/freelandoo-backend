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
const Soul = require("../utils/meuMundoSoul");
const Adv = require("../utils/meuMundoAdventure");
const FightSim = require("../utils/meuMundoFight");
const Gear = require("../utils/meuMundoGear");
const { clanOfBody, usesHammer, usesBow, usesGun } = require("../utils/meuMundoClans");
/** Require tardio: o serviço de equipamento também usa o withLife. */
const GearService = () => require("./MeuMundoGearService");

/** Derrota só dá o drop garantido com esta participação (tempo ativo conferido); vitória sempre dá. */
const LOOT_MIN_ACTIVE_MS = 15000;

// B8: "hall" = desafio pela cadeira do Hall; só abre por dentro (MeuMundoHallService).
const ORIGINS = Object.freeze(["laminas", "boxe", "mob", "tutorial", "hall"]);
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
  tutorial: ["A luta de treino é só no prólogo", 403],
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
  const before = { energy: s.energy, stress: s.stress, health: s.health, vitality: s.vitality };
  const streak = lossesToday(adv, ctx.now);
  // resultado × disposição (energia/estresse de ANTES da luta) — mm3d-60b
  const mult = Adv.fightGainMult(verdict.win, before.energy, before.stress);
  const cost = Adv.applyFightCost(s, verdict.win, streak, tutorial);
  // Prática: tempo ATIVO conferido, terminando agora (a luta acabou agora).
  const activeMs = Math.round(verdict.activeSteps * FightSim.DT * 1000);
  const activity = origin === "boxe" ? "boxe" : "laminas";
  // mm3d-60k: o atributo da luta é um DROP (média pelo estágio da vida ×
  // saúde × estresse de ANTES da luta), fora do orçamento do dia.
  const R = GearService().R;
  const stage = Life.lifeStage(s, ctx.now);
  const drop = verdict.abandoned
    ? {}
    : Adv.rollFightDrop({ ageDays: stage.ageDays, adult: stage.adult, win: verdict.win, health: before.health, vitality: before.vitality, stress: before.stress }, R);
  const gained = {};
  for (const [k, n] of Object.entries(drop)) {
    const got = Life.dropAttr(s, k, n);
    if (got > 0) gained[k] = r2(got);
  }
  const practice = { attrs: gained, activeMs: verdict.abandoned ? 0 : activeMs };
  const coins = verdict.abandoned ? 0 : Adv.fightCoins(setup.kind, setup.level, verdict.win, R);
  ctx.coins += coins;
  const xpGain = verdict.abandoned ? 0 : Adv.fightXp(setup.kind, setup.level, verdict.win);
  // Drop: recompensa básica GARANTIDA com participação válida; vitória aumenta.
  const family = Adv.ACTIVITIES[activity].loot;
  const drops =
    verdict.abandoned || (!verdict.win && practice.activeMs < LOOT_MIN_ACTIVE_MS)
      ? []
      : await GearService().deliver(c, idUser, Gear.rollLoot(family, { win: verdict.win, activeMs: practice.activeMs }, GearService().R), ctx);
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
      gainMult: mult,
      condition: Adv.conditionFactor(before.energy, before.stress),
      dropCondition: Adv.dropCondition(before.health, before.vitality, before.stress),
      dropAvg: Adv.fightDropAvg(stage.ageDays, stage.adult),
    },
    deltas: {
      xp: level,
      attrs: practice.attrs,
      // delta EFETIVO (depois dos limites 0–100)
      vitals: { energy: r2(s.energy - before.energy), stress: r2(s.stress - before.stress) },
      cost,
      coins: coins + drops.reduce((a, d) => a + (d.overflowCoins || 0), 0) || undefined,
    },
    items: drops,
  });
  ctx.events.push({ at: ctx.now, kind: "fight", data: { origin, kind: setup.kind, win: verdict.win, abandoned: !!verdict.abandoned, xp: level.xp } });
  // B5: inventário de monstros (só luta de verdade; recibo repetido = já contou).
  const trophy = Adv.trophyKind(origin, setup.kind);
  if (rec && trophy && !verdict.abandoned) await Store.addTrophy(c, { idUser, kind: trophy, win: verdict.win, level: setup.level });
  // B8: o desafio do Hall fecha na mesma transação (abandono = derrota)
  if (origin === "hall" && rec) {
    const hall = await require("./MeuMundoHallService").settle(c, fight.id_fight, !!verdict.win && !verdict.abandoned);
    if (hall) rec.hall = hall;
  }
  return rec;
}

/** Minijogo: participação mínima (tempo ativo conferido pela sala) para o drop garantido. */
const MINIGAME_LOOT_MIN_MS = 60000;

class MeuMundoAdventureService {
  /**
   * Crédito de um MINIJOGO medido pela sala (mm3d-59 slice 4). A sala é quem
   * mede o tempo ativo (segmentos em epoch ms) — o aparelho não diz nada.
   * `actionKey` = sala + partida + pessoa: repetir não credita de novo.
   * Prática (orçamento do dia, janela máxima por partida), XP e o material da
   * família. Sem custo de energia (a vida já cobra o tempo acordado).
   */
  static async creditMinigame(idUser, { activity, actionKey, segments, win = false }) {
    const def = Adv.ACTIVITIES[activity];
    if (!def || !actionKey) return fail("origin");
    const source = `minigame:${activity}`;
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const same = await Store.findReceipt(c, ctx.row.id_character, source, String(actionKey));
      if (same) return { receipt: same, replay: true };
      if (s.status !== "alive") return fail("dead");
      // segmentos só do passado e de no máximo 1 dia atrás (relógio do servidor)
      const segs = (segments || [])
        .map((g) => ({ from: Math.max(Number(g.from), ctx.now - 24 * 3600 * 1000), to: Math.min(Number(g.to), ctx.now) }))
        .filter((g) => g.to > g.from);
      // disposição também vale nos minijogos (energia/estresse de agora)
      const condition = Adv.conditionFactor(s.energy, s.stress);
      const practice = Adv.practice(s, activity, segs, condition);
      if (practice.activeMs <= 0) return { receipt: null, replay: false };
      const adv = await Store.lockAdventure(c, idUser);
      const level = addXp(adv, Adv.minigameXp(practice.activeMs) + (win ? 5 : 0));
      await Store.saveAdventure(c, idUser, { xp: adv.xp, level: adv.level, losses: adv.losses, lossesDay: adv.losses_day });
      const drops =
        practice.activeMs >= MINIGAME_LOOT_MIN_MS
          ? await GearService().deliver(c, idUser, Gear.rollLoot(def.loot, { win, activeMs: practice.activeMs }, GearService().R), ctx)
          : [];
      // mm3d-60k: o minijogo também DROPA moedas (pelo tempo ativo conferido)
      const coins = Adv.minigameCoins(practice.activeMs, win, GearService().R);
      ctx.coins += coins;
      const receipt = await Store.insertReceipt(c, {
        idUser,
        idCharacter: ctx.row.id_character,
        source,
        actionKey: String(actionKey),
        rules: Adv.RULES_VERSION,
        activeMs: practice.activeMs,
        result: { activity, win: !!win, condition },
        deltas: { xp: level, attrs: practice.attrs, coins: coins + drops.reduce((a, d) => a + (d.overflowCoins || 0), 0) || undefined },
        items: drops,
      });
      ctx.events.push({ at: ctx.now, kind: "minigame", data: { activity, activeMs: practice.activeMs } });
      return { receipt, replay: false };
    });
  }

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

  /** B5: o inventário de monstros (todas as espécies, com zero no que nunca enfrentou). */
  static async monsters(idUser) {
    const pool = require("../databases");
    const rows = new Map((await Store.trophies(pool, idUser)).map((r) => [r.kind, r]));
    return {
      monsters: Adv.TROPHY_KINDS.map((kind) => {
        const r = rows.get(kind);
        return {
          kind,
          wins: r ? Number(r.wins) : 0,
          losses: r ? Number(r.losses) : 0,
          bestLevel: r ? Number(r.best_level) : 0,
          firstWinAt: r && r.first_win_at ? new Date(r.first_win_at).toISOString() : null,
          lastAt: r ? new Date(r.last_at).toISOString() : null,
        };
      }),
    };
  }

  /**
   * Abre uma luta: o servidor sorteia a semente, lê os atributos e a classe e
   * guarda o ticket. Monstro da rua só se a sala viu esse monstro pegar a pessoa.
   * Uma luta aberta antes e nunca fechada conta como abandono (derrota, uma vez).
   */
  static async fightStart(idUser, body = {}, internal = {}) {
    const origin = String(body.origin || "");
    if (!ORIGINS.includes(origin)) return fail("origin");
    // B8: o desafio do Hall só abre pelo serviço do Hall (a ficha congelada vem de lá)
    if (origin === "hall" && !(internal && internal.hall)) return fail("origin");
    let kind = String(body.kind || "");
    let level = Math.max(1, Math.min(3, Math.round(Number(body.level) || 1)));
    let mobId = null;
    if (origin === "mob") {
      mobId = Number(body.mobId);
      const m = require("../realtime/meuMundo").mobEngaged(idUser, mobId);
      if (!m) return fail("mob");
      kind = m.kind;
      // nível sorteado a partir do meu nível de aventura (uma vez por monstro)
      let lv = m.level;
      if (!lv) {
        const adv = await Store.getAdventure(require("../databases"), idUser);
        lv = Adv.rollMobLevel(Adv.levelOf(Number(adv.xp)).level, GearService().R);
        m.setLevel(lv);
      }
      level = lv;
    }
    if (origin === "tutorial") {
      kind = "cavaleiro";
      level = 1;
    }
    // B8: o defensor entra como o Campeão (humano), com a ficha congelada pelo `peer`
    if (origin === "hall") {
      kind = "brute";
      level = 1;
    }
    // aparelho com a página de antes da F1 ainda manda o id antigo; o "soldier" do menu da Arena era o Golem
    kind = kind === "soldier" && origin === "laminas" ? "stone" : FightSim.mobKindOf(kind) || kind;
    if (!FightSim.MOB_KINDS.includes(kind)) return fail("kind");
    // no menu todos entram com os status de quem joga: o nível só pesa no prêmio, e fica no 1
    if (origin === "boxe" || origin === "laminas") level = 1;
    // Kit da luta (2026-11-03, Alex: "a raposa está com espada e golpes de vampira"):
    // vestindo o personagem de uma classe (skin de classe, hoje só de admin), a
    // luta é a DELE — arma, golpes e equipamento; senão, a classe da conta.
    const db = require("../databases");
    const worn = await MeuMundoStorage.getBody(db, idUser);
    const clan = clanOfBody(worn) ?? (await MeuMundoStorage.getClan(db, idUser)).clan;
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      if (s.status !== "alive") return fail("dead");
      const c = ctx.client;
      // a luta de treino não cobra nada: só abre nos passos de luta do prólogo
      if (origin === "tutorial" && !(await require("./MeuMundoQuestService").tutorialOpen(c, idUser))) return fail("tutorial");
      const abandoned = [];
      for (const old of await Store.openFights(c, idUser)) {
        abandoned.push(await settleFight(s, ctx, idUser, old, { win: false, abandoned: true, activeSteps: 0 }));
      }
      // nível de AVENTURA de quem joga: vida, defesa, ataque e atributos crescem com ele
      const hero = Adv.levelOf(Number((await Store.getAdventure(c, idUser)).xp)).level;
      const hammer = usesHammer(worn);
      const bow = usesBow(worn);
      const gun = usesGun(worn);
      const setup = {
        kind,
        level,
        hero,
        // ringue: o adversário copia quem joga; Arena e rua: ficha do monstro; o prólogo fica de fora
        peer: origin === "boxe" ? FightSim.peerOf(kind) : origin === "hall" ? internal.hall.peer : undefined,
        tier: origin === "mob" ? "street" : origin === "laminas" ? "arena" : undefined,
        // o corpo vestido multiplica os status (pesos em BODY_SHEETS)
        body: worn,
        seed: crypto.randomInt(1, 2 ** 31 - 1),
        stats: fightStats(s),
        // Kit pela CLASSE (mm3d-59): raposa = maga; o ringue do Boxe é sempre de luvas.
        // arqueira e atirador atiram como a maga: a regra é a mesma, muda o desenho
        style: origin !== "boxe" && !hammer && (bow || gun || clan === "raposa") ? "mage" : undefined,
        // desenho da luta: golpes do Brutamontes (a regra é a do corpo a corpo)
        kit: origin === "boxe" ? undefined : hammer ? "hammer" : bow ? "bow" : gun ? "gun" : undefined,
        // equipamento (com teto somado); o ringue do Boxe é de luvas: sem arma
        gear: origin === "boxe" ? undefined : await GearService().fightGear(c, idUser, clan),
        appearance: origin === "boxe" ? undefined : await GearService().fightAppearance(c, idUser, clan),
        mobId,
        // mm3d-72: personalidade e afeto mexem na luta por probabilidade (psicopata, covarde)
        temper: origin === "tutorial" ? undefined : Soul.temperOf(s),
        affection: origin === "tutorial" ? undefined : Math.floor(Soul.soulOf(s).affection),
      };
      // tutorial: o inimigo entra enfraquecido (pedido do prólogo)
      if (origin === "tutorial") setup.stats = { ...setup.stats, strength: Math.max(setup.stats.strength, 400) };
      const t = await Store.insertFight(c, { idUser, idCharacter: ctx.row.id_character, origin, setup, ttlMs: TICKET_TTL_MS });
      // B8: o desafio é gravado junto do ticket (limites conferidos com a pessoa travada)
      if (origin === "hall") {
        const err = await internal.hall.onOpen(c, t.id_fight);
        if (err && err.error) return err;
      }
      return {
        fight: {
          ticket: t.id_fight,
          origin,
          setup: { kind, level, hero, peer: setup.peer ?? null, tier: setup.tier ?? null, body: worn, seed: setup.seed, stats: setup.stats, style: setup.style ?? null, kit: setup.kit ?? null, gear: setup.gear ?? null, appearance: setup.appearance ?? null, temper: setup.temper ?? null, affection: setup.affection ?? null },
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
        { kind: setup.kind, level: setup.level, hero: setup.hero || undefined, peer: setup.peer || undefined, tier: setup.tier || undefined, body: setup.body || undefined, seed: setup.seed, stats: setup.stats, style: setup.style || undefined, gear: setup.gear || undefined, temper: setup.temper || undefined, affection: setup.affection || undefined },
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
