/**
 * Disponibilidade PADRÃO da agenda — a resposta para "quem nunca configurou
 * atende quando?".
 *
 * ═══ POR QUE ISTO EXISTE ═══
 *
 * Até aqui, perfil sem nenhuma linha em `tb_profile_availability_rules` não
 * tinha horário nenhum: `getRuleForDate` devolvia `type: "none"` e a tela dizia
 * "Sem horário livre neste dia" para SEMPRE. Quem chegava pelo site da
 * comunidade (mig 221) via um calendário que nunca oferecia nada — e não havia
 * como descobrir, pela tela, que faltava configurar.
 *
 * Decisão do Alex (2026-09-06): **das 09:00 às 18:00, todo dia, para todo
 * mundo** — enquanto ninguém disser o contrário.
 *
 * ═══ É PADRÃO, NÃO É TRAVA ═══
 *
 * O padrão vale só enquanto o dono NÃO configurou nada. Basta salvar a
 * disponibilidade semanal uma vez (a tela grava as SETE linhas, inclusive as
 * desligadas) para o padrão sair de cena de vez. É por isso que o predicado é
 * "o perfil não tem NENHUMA linha", e não "não tem linha para este dia": quem
 * configurou segunda a sexta desligou sábado e domingo de propósito, e reabrir
 * esses dois seria desfazer uma escolha explícita.
 *
 * ═══ FONTE ÚNICA ═══
 *
 * Duas perguntas diferentes leem daqui, e é isso que impede as duas verdades:
 *   • o público — `getRuleForDate`, que alimenta `/available-slots` e
 *     `/calendar/week` (e portanto o site e o modal do perfil);
 *   • o dono — `getWeeklyRules`, que é o que a tela de configuração desenha.
 * Se só o público tivesse o padrão, o dono abriria a agenda, veria outra coisa
 * e publicaria horário diferente do que a tela dele mostra.
 *
 * ⚠️ Isto NÃO dá permissão de agendar: quem decide se o perfil aceita
 * agendamento público continua sendo `allow_booking` das configurações de
 * agendamento, que nasce desligado. Aqui só se responde "em que horas", nunca
 * "pode".
 */

const DEFAULT_START_TIME = "09:00";
const DEFAULT_END_TIME = "18:00";
const DEFAULT_SLOT_MINUTES = 60;
const DEFAULT_BUFFER_MINUTES = 0;

/** Regra padrão de UM dia da semana (0=domingo … 6=sábado). */
function defaultRuleForWeekday(id_profile, weekday) {
  return {
    id_profile,
    weekday,
    is_enabled: true,
    start_time: DEFAULT_START_TIME,
    end_time: DEFAULT_END_TIME,
    slot_duration_minutes: DEFAULT_SLOT_MINUTES,
    buffer_minutes: DEFAULT_BUFFER_MINUTES,
    // Marca que a linha NÃO existe no banco — é o padrão respondendo. A tela de
    // configuração usa isso para dizer que ainda não foi configurado, e nada
    // aqui é gravado enquanto o dono não salvar.
    is_default: true,
  };
}

/** As sete regras padrão, na ordem dos dias. */
function defaultWeeklyRules(id_profile) {
  return Array.from({ length: 7 }, (_, weekday) =>
    defaultRuleForWeekday(id_profile, weekday)
  );
}

module.exports = {
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  DEFAULT_SLOT_MINUTES,
  DEFAULT_BUFFER_MINUTES,
  defaultRuleForWeekday,
  defaultWeeklyRules,
};
