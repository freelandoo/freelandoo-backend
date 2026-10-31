// test/unit/availabilityBreak.test.js
// O intervalo (almoço) da regra semanal — mig 316. Nenhum horário oferecido
// encosta no intervalo, e a tarde recomeça no fim dele.
const test = require("node:test");
const assert = require("node:assert");
const { breakOf, generateSlots } = require("../../src/services/BookingAvailabilityService");

const starts = (slots) => slots.map((s) => s.start);

test("sem intervalo: o comportamento de antes", () => {
  assert.deepStrictEqual(starts(generateSlots("09:00", "11:00", 30, 0)), ["09:00", "09:30", "10:00", "10:30"]);
  assert.strictEqual(breakOf({ break_start: null, break_end: null }), null);
  assert.strictEqual(breakOf({ break_start: "12:00", break_end: null }), null);
  assert.strictEqual(breakOf({ break_start: "13:00", break_end: "12:00" }), null);
});

test("almoço 12–13 com slots de 30 min", () => {
  const brk = breakOf({ break_start: "12:00:00", break_end: "13:00:00" });
  const s = starts(generateSlots("11:00", "14:00", 30, 0, brk));
  assert.deepStrictEqual(s, ["11:00", "11:30", "13:00", "13:30"]);
});

test("slot que CRUZARIA o almoço é pulado e a tarde nasce às 13:00", () => {
  const brk = breakOf({ break_start: "12:00", break_end: "13:00" });
  const s = starts(generateSlots("09:00", "15:00", 45, 0, brk));
  assert.deepStrictEqual(s, ["09:00", "09:45", "10:30", "11:15", "13:00", "13:45"]);
  for (const slot of generateSlots("09:00", "15:00", 45, 0, brk)) {
    const [a, b] = [slot.start, slot.end].map((t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)));
    assert.ok(b <= 12 * 60 || a >= 13 * 60, `${slot.start}-${slot.end} encosta no almoço`);
  }
});
