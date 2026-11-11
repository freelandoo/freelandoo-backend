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
const { createLogger } = require("../utils/logger");

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
      // conta → prêmios novos desta semana
      const byUser = new Map();
      for (const g of S.GAMES) {
        for (const r of await Store.standings(c, g.id, w)) {
          const ml = N.mlFor(r.position, r.scored);
          if (ml <= 0) continue;
          const fresh = await Store.insertAward(c, { idUser: r.idUser, week: w, game: g.id, position: r.position, value: r.value, ml });
          if (!fresh) continue;
          if (!byUser.has(r.idUser)) byUser.set(r.idUser, []);
          byUser.get(r.idUser).push({ game: g.id, position: r.position, ml });
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
          data: { week: w, ml, games: awards.length, best: { game: best.game, position: best.position }, pendingMl: wallet.pendingMl },
          dedupeKey: `nectar:${w}`,
        });
        if (n) notices.push([idUser, n]);
      }
      await Store.markClosed(c, { week: w, accounts: byUser.size, totalMl: total });
      await c.query("COMMIT");
      for (const [idUser, n] of notices) push(idUser, n);
      log.info("week_closed", { week: w, accounts: byUser.size, totalMl: total });
      return { week: w, accounts: byUser.size, totalMl: total };
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
    const [w, closed, awards] = await Promise.all([Store.wallet(pool, idUser), Store.weekClosed(pool, last), Store.awards(pool, idUser, last)]);
    return {
      pendingMl: w.pendingMl,
      earnedMl: w.earnedMl,
      table: N.TABLE,
      week: current,
      closesAt: new Date(N.closesAt(current)).toISOString(),
      last: { week: last, closed: !!closed, ml: N.totalMl(awards), awards },
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
