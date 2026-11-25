/**
 * MEU MUNDO 3D, lore v2 N2: o NÉCTAR DA SEMANA (mig 441).
 *
 * Fechamento: depois do sábado 23:59 de Brasília (decisão D6), uma tarefa do
 * servidor fecha a semana anterior UMA vez — numa transação com trava
 * (`pg_advisory_xact_lock`), lê o placar inteiro de cada jogável, dá os litros
 * pela posição (utils/meuMundoNectar.js), grava o recibo conta × semana × jogo
 * (chave única: rodar de novo nunca credita de novo), soma na carteira "néctar
 * para entregar" da conta e avisa no sino. Robô não tem conta: nunca rende.
 *
 * Lutas (Lâminas, Boxe, Hall): contam vitória conferida sem peso por nível,
 * porque não existe luta fácil para escolher — nas Lâminas o monstro entra no
 * nível de aventura de quem joga, no Boxe o adversário copia quem joga e no
 * Hall a ficha é a do campeão congelado. O freio de volume é a energia.
 */
const pool = require("../databases");
const Store = require("../storages/MeuMundoNectarStorage");
const Inbox = require("../storages/MeuMundoInboxStorage");
const S = require("../utils/meuMundoScores");
const N = require("../utils/meuMundoNectar");
const Pact = require("../utils/meuMundoPact");
const PactStore = require("../storages/MeuMundoPactStorage");
const TrainerStore = require("../storages/MeuMundoTrainerStorage");
const Trainer = require("../utils/meuMundoTrainer");
const Adv = require("../utils/meuMundoAdventure");
const { createLogger } = require("../utils/logger");
const WeekPrize = require("../utils/mmItems/catalog/weekPrize");
const GearService = () => require("./MeuMundoGearService");

const log = createLogger("meuMundo.nectar");

/** Namespace do advisory lock do fechamento (fixo; não colide com outros). */
const LOCK_NS = 44102;
/** Primeira semana com placar (a N1 entrou no ar em 2026-11-11): antes dela não fecha. */
const START_WEEK = "2026-11-08";

const lockKey = (week) => Number(week.replace(/-/g, "")) % 2147483647;

function push(idUser, notice) {
  if (!notice) return;
  try {
    require("../realtime/meuMundo").pushNotice(idUser, notice);
  } catch (err) {
    log.warn("push_fail", { message: err.message });
  }
}

class MeuMundoNectarService {
  /**
   * Fecha `week` (padrão: a anterior à de agora). Idempotente: semana já
   * fechada ou ainda aberta devolve sem creditar. Devolve um resumo.
   */
  static async closeWeek(week = null, now = Date.now()) {
    const w = week || N.weekToClose(now);
    if (!S.isWeekId(w)) return { week: w, skipped: "invalid" };
    if (w < START_WEEK) return { week: w, skipped: "before_start" };
    if (!N.isClosable(w, now)) return { week: w, skipped: "open" };
    const c = await pool.connect();
    const notices = [];
    try {
      await c.query("BEGIN");
      await c.query("SELECT pg_advisory_xact_lock($1, $2)", [LOCK_NS, lockKey(w)]);
      if (await Store.weekClosed(c, w)) {
        await c.query("ROLLBACK");
        return { week: w, skipped: "closed" };
      }
      const boards = [];
      for (const g of S.GAMES) boards.push([g, await Store.standings(c, g.id, w)]);
      // D4: pactos dos deuses que cruzam a semana → fração do bônus por jogo × povo
      const range = S.weekRange(w);
      const groups = new Map();
      for (const p of await PactStore.overlapping(c, range.start, range.end)) {
        const k = `${p.game}:${p.clan}`;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push({ startsAt: p.start, endsAt: p.end });
      }
      const shares = new Map([...groups].map(([k, list]) => [k, Pact.weekShare(w, list)]));
      const pactGames = new Set([...shares.keys()].map((k) => k.split(":")[0]));
      const clans = await PactStore.clansOf(c, [...new Set(boards.filter(([g]) => pactGames.has(g.id)).flatMap(([, rows]) => rows.map((r) => r.idUser)))]);
      // conta → prêmios novos desta semana
      const byUser = new Map();
      for (const [g, rows] of boards) {
        for (const r of rows) {
          const base = N.mlFor(r.position, r.scored);
          if (base <= 0) continue;
          const pactMl = Pact.bonusMl(base, shares.get(`${g.id}:${clans.get(r.idUser)}`) || 0);
          const ml = base + pactMl;
          const fresh = await Store.insertAward(c, { idUser: r.idUser, week: w, game: g.id, position: r.position, value: r.value, ml, pactMl });
          if (!fresh) continue;
          if (!byUser.has(r.idUser)) byUser.set(r.idUser, []);
          byUser.get(r.idUser).push({ game: g.id, position: r.position, ml, pactMl });
        }
      }
      let total = 0;
      for (const [idUser, awards] of byUser) {
        const ml = N.totalMl(awards);
        total += ml;
        const wallet = await Store.credit(c, idUser, ml);
        const best = awards.reduce((a, x) => (x.position < a.position ? x : a), awards[0]);
        const n = await Inbox.insertNotice(c, idUser, {
          kind: "life",
          code: "nectar_week",
          priority: 2,
          data: { week: w, ml, games: awards.length, best: { game: best.game, position: best.position }, pendingMl: wallet.pendingMl, pactMl: N.totalMl(awards.map((a) => ({ ml: a.pactMl }))) || undefined },
          dedupeKey: `nectar:${w}`,
        });
        if (n) notices.push([idUser, n]);
      }
      // legend-v1 (24/11/2026): o 1º lugar de cada minijogo leva o prêmio Lendário (uma vez: chave conta × semana × jogo)
      let prizes = 0;
      if (w >= WeekPrize.PRIZE_START_WEEK) {
        for (const [g, rows] of boards) {
          const items = WeekPrize.prizeOf(g.id);
          const top = items && rows.find((r) => r.position === 1);
          if (!top) continue;
          if (!(await Store.insertPrize(c, { idUser: top.idUser, week: w, game: g.id, value: top.value, items }))) continue;
          await GearService().deliver(c, top.idUser, items.map((x) => ({ ...x })), null);
          prizes++;
          const n = await Inbox.insertNotice(c, top.idUser, {
            kind: "life",
            code: "legend_week",
            priority: 3,
            data: { week: w, game: g.id, items },
            dedupeKey: `legend:${w}:${g.id}`,
          });
          if (n) notices.push([top.idUser, n]);
        }
      }
      await Store.markClosed(c, { week: w, accounts: byUser.size, totalMl: total });
      await c.query("COMMIT");
      for (const [idUser, n] of notices) push(idUser, n);
      log.info("week_closed", { week: w, accounts: byUser.size, totalMl: total, prizes });
      return { week: w, accounts: byUser.size, totalMl: total, prizes };
    } catch (err) {
      await c.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      c.release();
    }
  }

  /** A carteira de néctar da pessoa + a tabela + o que rendeu a semana passada. */
  static async wallet(idUser, now = Date.now()) {
    const current = S.weekOf(now);
    const last = S.previousWeek(current);
    const [w, closed, awards, pacts, trainer, thefts, nivea, adv] = await Promise.all([Store.wallet(pool, idUser), Store.weekClosed(pool, last), Store.awards(pool, idUser, last), PactStore.active(pool, now), TrainerStore.get(pool, idUser), Store.thefts(pool, idUser), Store.nivea(pool), Store.bestCharacterXp(pool, idUser)]);
    // 19/11 (Alex): "quando o PRIMEIRO personagem chega ao 5 já ganha o coletor" — vale o maior
    // nível que QUALQUER personagem da conta já teve (vivo ou não) ou o do treinador; não volta atrás.
    const level = Math.max(Trainer.trainerLevelOf(Number(trainer.xp) || 0).level, Adv.levelOf(adv).level);
    return {
      pendingMl: w.pendingMl,
      earnedMl: w.earnedMl,
      table: N.TABLE,
      week: current,
      closesAt: new Date(N.closesAt(current)).toISOString(),
      last: { week: last, closed: !!closed, ml: N.totalMl(awards), awards },
      // D4: os pactos de pé (os dois povos) e quanto valem
      pacts,
      pactBonus: Pact.PACT_BONUS,
      // o coletor de néctar (nível 5): a tela de equipar mostra `earnedMl`, sem limite
      collector: { unlocked: N.collectorUnlocked(level), level: N.COLLECTOR_LEVEL },
      // o roubo da Nívea (mig 462): o contador de tudo o que os monstros levaram + o extrato da conta
      nivea,
      thefts,
      theft: { pct: N.THEFT_PCT, minMl: N.THEFT_MIN_ML, maxMl: N.THEFT_MAX_ML },
    };
  }
}

let sweeper = null;
/** Tenta fechar a semana anterior de tempos em tempos (a trava segura duas réplicas). */
MeuMundoNectarService.startSweeper = (ms = 10 * 60 * 1000) => {
  if (sweeper) return;
  const tick = () => MeuMundoNectarService.closeWeek().catch((err) => log.error("close_fail", { message: err.message }));
  setTimeout(tick, 60 * 1000).unref?.();
  sweeper = setInterval(tick, ms);
  sweeper.unref?.();
};
MeuMundoNectarService.stopSweeper = () => {
  if (sweeper) clearInterval(sweeper);
  sweeper = null;
};
MeuMundoNectarService.START_WEEK = START_WEEK;

module.exports = MeuMundoNectarService;
