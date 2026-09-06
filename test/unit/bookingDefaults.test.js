// test/unit/bookingDefaults.test.js
//
// A disponibilidade padrão (09:00–18:00, todo dia, para quem nunca configurou)
// e o predicado que decide quando ela vale. É *unit* e não e2e de propósito:
// `getRuleForDate` só precisa de um `conn` com `query`, então dá para exercitar
// a decisão inteira sem Postgres.
const test = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_START_TIME,
  DEFAULT_END_TIME,
  defaultRuleForWeekday,
  defaultWeeklyRules,
} = require("../../src/utils/bookingDefaults");
const BookingAvailabilityStorage = require("../../src/storages/BookingAvailabilityStorage");

const PROFILE = "11111111-1111-1111-1111-111111111111";

/**
 * Conn de mentira: responde cada SELECT pelo que a consulta pergunta.
 *  - overrides: linha de exceção da data, ou nenhuma
 *  - regra do dia: linha daquele weekday, ou nenhuma
 *  - "tem alguma regra?": derivado das regras passadas
 */
function fakeConn({ overrides = {}, rules = [] } = {}) {
  return {
    async query(sql, params) {
      if (sql.includes("tb_profile_availability_overrides")) {
        const ov = overrides[params[1]];
        return { rows: ov ? [ov] : [], rowCount: ov ? 1 : 0 };
      }
      if (sql.includes("AND weekday =")) {
        const row = rules.find((r) => r.weekday === params[1]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      // LIMIT 1 sem weekday = o "existe alguma regra?"
      return { rows: rules.length ? [{ "?column?": 1 }] : [], rowCount: rules.length ? 1 : 0 };
    },
  };
}

test("padrão: 09:00 às 18:00, todos os sete dias, ligados", () => {
  const rules = defaultWeeklyRules(PROFILE);
  assert.strictEqual(rules.length, 7);
  assert.deepStrictEqual(rules.map((r) => r.weekday), [0, 1, 2, 3, 4, 5, 6]);
  assert.ok(rules.every((r) => r.is_enabled === true));
  assert.ok(rules.every((r) => r.start_time === "09:00" && r.end_time === "18:00"));
  assert.strictEqual(DEFAULT_START_TIME, "09:00");
  assert.strictEqual(DEFAULT_END_TIME, "18:00");
});

test("padrão vem marcado como padrão (não é linha do banco)", () => {
  assert.strictEqual(defaultRuleForWeekday(PROFILE, 3).is_default, true);
});

test("perfil sem NENHUMA regra recebe o padrão em qualquer dia", async () => {
  const conn = fakeConn();
  for (let weekday = 0; weekday < 7; weekday++) {
    const r = await BookingAvailabilityStorage.getRuleForDate(conn, PROFILE, "2026-09-09", weekday);
    assert.strictEqual(r.type, "weekly", `weekday ${weekday}`);
    assert.strictEqual(r.data.is_enabled, true);
    assert.strictEqual(r.data.start_time, "09:00");
    assert.strictEqual(r.data.end_time, "18:00");
  }
});

test("quem configurou segunda a sexta NÃO reabre sábado e domingo", async () => {
  // A tela grava as sete linhas; desligar sábado/domingo é escolha explícita.
  const rules = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    is_enabled: weekday >= 1 && weekday <= 5,
    start_time: "08:00",
    end_time: "17:00",
    slot_duration_minutes: 30,
    buffer_minutes: 0,
  }));
  const conn = fakeConn({ rules });
  const sunday = await BookingAvailabilityStorage.getRuleForDate(conn, PROFILE, "2026-09-06", 0);
  assert.strictEqual(sunday.type, "weekly");
  assert.strictEqual(sunday.data.is_enabled, false);
  const monday = await BookingAvailabilityStorage.getRuleForDate(conn, PROFILE, "2026-09-07", 1);
  assert.strictEqual(monday.data.start_time, "08:00", "a regra do dono vence o padrão");
});

test("dia SEM linha num perfil que já configurou continua sem horário", async () => {
  // Base antiga pode ter só alguns dias gravados. Ali a ausência é a resposta.
  const conn = fakeConn({ rules: [{ weekday: 1, is_enabled: true, start_time: "10:00", end_time: "12:00" }] });
  const saturday = await BookingAvailabilityStorage.getRuleForDate(conn, PROFILE, "2026-09-12", 6);
  assert.strictEqual(saturday.type, "none");
  assert.strictEqual(saturday.data, null);
});

test("exceção por data vence o padrão", async () => {
  const conn = fakeConn({ overrides: { "2026-09-09": { is_day_blocked: true } } });
  const r = await BookingAvailabilityStorage.getRuleForDate(conn, PROFILE, "2026-09-09", 3);
  assert.strictEqual(r.type, "override");
  assert.strictEqual(r.data.is_day_blocked, true);
});
