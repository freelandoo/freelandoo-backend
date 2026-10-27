// src/services/AcademyStudentService.js
// O que o ALUNO lê da academia dele na "Minha academia" (mig 310): o
// calendário de frequência mês a mês e o histórico inteiro de mensalidades.
//
// Privacidade: o vínculo (`id_member`) tem que ser DO USUÁRIO que pergunta —
// id de outro aluno responde 404, igual a um id que não existe.
const pool = require("../databases");
const AcademyStorage = require("../storages/AcademyStorage");
const {
  localDay,
  isYm,
  monthBounds,
  shiftYm,
  monthSummary,
  currentStreak,
  shiftDay,
} = require("../utils/academyCalendar");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("academy-student");

// Quanto para trás a sequência olha. Mais de um ano seguido é recorde de
// verdade — a tela mostra "365+" e ninguém sente falta do resto.
const STREAK_LOOKBACK_DAYS = 366;

class AcademyStudentService {
  static async _member(id_user, id_member) {
    const member = await AcademyStorage.getMemberById(pool, id_member);
    if (!member || String(member.id_user) !== String(id_user)) {
      return { error: "Vínculo não encontrado.", statusCode: 404 };
    }
    return { member };
  }

  /**
   * Um mês do calendário. `ym` fora da janela [mês do vínculo, mês atual] é
   * puxado para a borda — a tela usa `min_ym`/`max_ym` para apagar as setas.
   */
  static async month(id_user, id_member, ymRaw) {
    return runWithLogs(log, "month", () => ({ id_user, id_member, ym: ymRaw }), async () => {
      const found = await this._member(id_user, id_member);
      if (found.error) return found;
      const { member } = found;

      const todayDay = localDay();
      const linkedDay = localDay(member.linked_at);
      const minYm = linkedDay.slice(0, 7);
      const maxYm = todayDay.slice(0, 7);
      let ym = isYm(ymRaw) ? ymRaw : maxYm;
      if (ym < minYm) ym = minYm;
      if (ym > maxYm) ym = maxYm;

      const { first, next } = monthBounds(ym);
      const streakFrom = shiftDay(todayDay, -STREAK_LOOKBACK_DAYS);
      const [days, recent] = await Promise.all([
        AcademyStorage.listLocalEventDays(pool, member.id_member, first, next),
        AcademyStorage.listLocalEventDays(pool, member.id_member, streakFrom, shiftDay(todayDay, 1)),
      ]);
      const summary = monthSummary({ ym, presentDays: days, linkedDay, todayDay });

      return {
        ym,
        min_ym: minYm,
        max_ym: maxYm,
        prev_ym: ym > minYm ? shiftYm(ym, -1) : null,
        next_ym: ym < maxYm ? shiftYm(ym, 1) : null,
        today: todayDay,
        linked_at: linkedDay,
        days,
        days_in_month: summary.days,
        present: summary.present,
        elapsed: summary.elapsed,
        streak: currentStreak(recent, todayDay),
      };
    });
  }

  /** Histórico INTEIRO das mensalidades (o espelho), com a marca do "Pagar". */
  static async payments(id_user, id_member) {
    return runWithLogs(log, "payments", () => ({ id_user, id_member }), async () => {
      const found = await this._member(id_user, id_member);
      if (found.error) return found;
      const academy = await AcademyStorage.getById(pool, found.member.id_academy);
      const AcademyFeeService = require("./AcademyFeeService");
      const [items, payEnabled, open] = await Promise.all([
        AcademyStorage.listPaymentsForMember(pool, found.member.id_member, 120),
        AcademyFeeService.payEnabled(academy),
        AcademyFeeService.openOrdersForMember(found.member.id_member),
      ]);
      return {
        pay_enabled: payEnabled,
        payments: items.map((p) => ({
          ...p,
          // Um checkout aberto para esta cobrança: a tela mostra "Aguardando
          // pagamento" com o link em vez de abrir um segundo.
          pending_checkout: open[p.external_id] || null,
        })),
      };
    });
  }
}

module.exports = AcademyStudentService;
