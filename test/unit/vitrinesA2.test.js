// test/unit/vitrinesA2.test.js — A2/A3/A4 (mig 338): linha digitável, limites,
// reserva de 30 min e ordem por alcance nas vitrines.

const test = require("node:test");
const assert = require("node:assert/strict");
const B = require("../../src/utils/boleto");
const V = require("../../src/utils/vitrine");

// Boleto real do Banco do Brasil (exemplo público; código de barras conhecido).
const BB_LINE = "00190.50095 40144.816069 06809.350314 3 37370000000100";
const BB_BARCODE = "00193373700000001000500940144816060680935031";
// Conta de concessionária real (48 dígitos, módulo 10).
const UTIL_LINE = "836200000005 667800481000 180975657313 001589636081";

/** Monta uma linha bancária válida a partir de banco, fator e valor. */
function bankLine(bank, factor, cents, free = "1234567890123456789012345") {
  const head = bank + "9";
  const tail = String(factor).padStart(4, "0") + String(cents).padStart(10, "0");
  const body = head + tail + free; // código de barras sem o DV geral
  const dv = B.mod11Bank(body);
  const barcode = head + dv + tail + free;
  const f1 = barcode.slice(0, 4) + barcode.slice(19, 24);
  const f2 = barcode.slice(24, 34);
  const f3 = barcode.slice(34, 44);
  return f1 + B.mod10(f1) + f2 + B.mod10(f2) + f3 + B.mod10(f3) + dv + tail;
}

/* ───────────────────────────── linha digitável ──────────────────────────── */

test("boleto bancário real: DVs conferem, código de barras e valor saem da linha", () => {
  const r = B.parseLine(BB_LINE, { today: "2008-01-01" });
  assert.equal(r.ok, true);
  assert.equal(r.kind, "bank");
  assert.equal(r.barcode, BB_BARCODE);
  assert.equal(r.amount_cents, 100);
  assert.equal(r.due_date, "2007-12-31"); // fator 3737 na base de 1997
});

test("concessionária real: blocos módulo 10, valor do código, sem vencimento", () => {
  const r = B.parseLine(UTIL_LINE);
  assert.equal(r.ok, true);
  assert.equal(r.kind, "utility");
  assert.equal(r.amount_cents, 6678);
  assert.equal(r.due_date, null);
});

test("qualquer dígito trocado derruba a linha", () => {
  const digits = B.onlyDigits(BB_LINE);
  for (const pos of [0, 5, 9, 15, 20, 25, 31, 32, 40, 46]) {
    const swapped = digits.slice(0, pos) + ((Number(digits[pos]) + 1) % 10) + digits.slice(pos + 1);
    assert.ok(B.parseLine(swapped, { today: "2008-01-01" }).error, `posição ${pos}`);
  }
  const u = B.onlyDigits(UTIL_LINE);
  const bad = u.slice(0, 20) + ((Number(u[20]) + 1) % 10) + u.slice(21);
  assert.ok(B.parseLine(bad).error);
});

test("tamanho errado e concessionária com valor de referência são recusados", () => {
  assert.equal(B.parseLine("123").code, "invalid_length");
  assert.equal(B.parseLine("9".repeat(48)).code, "invalid_length"); // 48 sem começar com 8
});

test("fator de vencimento depois do reinício de 22/02/2025", () => {
  assert.equal(B.dueFromFactor(1000, "2025-03-01"), "2025-02-22");
  assert.equal(B.dueFromFactor(1100, "2025-06-01"), "2025-06-02");
  assert.equal(B.dueFromFactor(9999, "2025-02-20"), "2025-02-21");
  assert.equal(B.dueFromFactor(0, "2025-02-20"), null);
});

test("checkBill: vencido, teto, vencimento informado só na concessionária", () => {
  const today = "2026-11-09";
  // fator para 2026-11-20: 2025-02-22 + 636 dias → 1636
  const line = bankLine("237", 1636, 12345);
  const ok = B.checkBill(line, { today, max_amount_cents: 50000 });
  assert.equal(ok.ok, true);
  assert.equal(ok.due_date, "2026-11-20");
  assert.equal(ok.amount_cents, 12345);

  const expired = bankLine("237", 1500, 12345); // 2026-07-07
  assert.equal(B.checkBill(expired, { today }).code, "expired");

  const big = bankLine("237", 1636, 50001);
  assert.equal(B.checkBill(big, { today, max_amount_cents: 50000 }).code, "over_limit");

  const zero = bankLine("237", 1636, 0);
  assert.equal(B.checkBill(zero, { today }).code, "no_amount");

  // Concessionária: vencimento obrigatório e não pode ser passado.
  assert.equal(B.checkBill(UTIL_LINE, { today }).code, "due_required");
  assert.equal(B.checkBill(UTIL_LINE, { today, due_date: "2026-11-01" }).code, "expired");
  const u = B.checkBill(UTIL_LINE, { today, due_date: "2026-11-30" });
  assert.equal(u.ok, true);
  assert.equal(u.due_date, "2026-11-30");
});

test("formatLine agrupa como no papel", () => {
  assert.equal(B.formatLine(B.onlyDigits(BB_LINE)), "00190.50095 40144.816069 06809.350314 3 37370000000100");
});

/* ───────────────────────────── limites de postar ────────────────────────── */

const SETTINGS = { is_active: true, max_open: 3, max_amount_cents: 50000, reserve_minutes: 30 };
const OK_USER = { has_cpf: true, age: 30, needs_debt_help: true };

test("postar boleto: CPF, 18+, chave ligada e até 3 abertos", () => {
  assert.equal(V.postError({ user: OK_USER, openCount: 0, settings: SETTINGS }), null);
  assert.equal(V.postError({ user: OK_USER, openCount: 2, settings: SETTINGS }), null);
  assert.equal(V.postError({ user: OK_USER, openCount: 3, settings: SETTINGS }).reason, "max_open");
  assert.equal(V.postError({ user: { ...OK_USER, has_cpf: false }, openCount: 0, settings: SETTINGS }).reason, "cpf_required");
  assert.equal(V.postError({ user: { ...OK_USER, age: 17 }, openCount: 0, settings: SETTINGS }).reason, "adult_only");
  assert.equal(V.postError({ user: { ...OK_USER, age: null }, openCount: 0, settings: SETTINGS }).reason, "adult_only");
  assert.equal(V.postError({ user: { ...OK_USER, needs_debt_help: false }, openCount: 0, settings: SETTINGS }).reason, "flag_off");
  assert.ok(V.postError({ user: OK_USER, openCount: 0, settings: { ...SETTINGS, is_active: false } }));
  // O teto é configurável.
  assert.equal(V.postError({ user: OK_USER, openCount: 3, settings: { ...SETTINGS, max_open: 5 } }), null);
});

/* ───────────────────────────── reserva de 30 min ────────────────────────── */

test("reserva: vale 30 min, é de quem pegou, e vencida libera sozinha", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const in30 = new Date(now.getTime() + 30 * 60000);
  const bill = { id_user: "dono", status: "open", reserved_by: "ana", reserved_until: in30.toISOString() };

  assert.equal(V.isReserved(bill, now), true);
  assert.equal(V.reserveError(bill, "bia", now).statusCode, 409); // outra pessoa
  assert.equal(V.reserveError(bill, "ana", now), null); // renovar a própria
  assert.equal(V.reserveError(bill, "dono", now).statusCode, 400); // o próprio dono

  const later = new Date(in30.getTime() + 1000);
  assert.equal(V.isReserved(bill, later), false);
  assert.equal(V.reserveError(bill, "bia", later), null); // venceu: livre

  assert.equal(V.reserveError({ ...bill, status: "paid" }, "bia", later).statusCode, 409);
  assert.equal(V.reserveError(null, "bia", now).statusCode, 404);
});

test("comprovante só de quem segura a reserva viva", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const bill = {
    id_user: "dono",
    status: "open",
    reserved_by: "ana",
    reserved_until: new Date(now.getTime() + 60000).toISOString(),
  };
  assert.equal(V.proofError(bill, "ana", now), null);
  assert.ok(V.proofError(bill, "bia", now));
  assert.ok(V.proofError(bill, "ana", new Date(now.getTime() + 120000)));
});

/* ───────────────────────────── alcance nas vitrines ─────────────────────── */

test("alcance ORDENA e nunca esconde: cidade > área > região > estado > Brasil", () => {
  const viewer = { city_key: "campinas", uf: "SP", id_area: 7, id_region: 3 };
  const people = [
    { id: "rio", city_key: "rio", uf: "RJ", id_area: 90, id_region: 40, needs_job_at: "2026-11-08" },
    { id: "uf", city_key: "santos", uf: "SP", id_area: 12, id_region: 9, needs_job_at: "2026-11-08" },
    { id: "regiao", city_key: "sumare2", uf: "SP", id_area: 8, id_region: 3, needs_job_at: "2026-11-08" },
    { id: "area", city_key: "sumare", uf: "SP", id_area: 7, id_region: 3, needs_job_at: "2026-11-08" },
    { id: "cidade", city_key: "campinas", uf: "SP", id_area: 7, id_region: 3, needs_job_at: "2026-11-01" },
    { id: "semlugar", needs_job_at: "2026-11-09" },
  ];
  const ordered = V.orderByProximity(viewer, people).map((p) => p.id);
  assert.equal(ordered.length, people.length); // ninguém some
  assert.equal(ordered[0], "cidade");
  assert.equal(ordered[1], "area");
  assert.equal(ordered[2], "regiao");
  assert.equal(ordered[3], "uf");
  // Sem nada em comum: ordem por recência.
  assert.deepEqual(ordered.slice(4), ["semlugar", "rio"]);
});

test("mesmo nome de cidade em outro estado não conta como mesma cidade", () => {
  assert.equal(V.proximityRank({ city_key: "bonito", uf: "MS" }, { city_key: "bonito", uf: "PE" }), 0);
  assert.equal(V.proximityRank({ city_key: "bonito", uf: "MS" }, { city_key: "bonito", uf: "MS" }), 4);
});

test("leitor sem lugar: todos com rank 0 (vale a recência)", () => {
  assert.equal(V.proximityRank({}, { city_key: "x", uf: "SP" }), 0);
  assert.equal(V.proximityRank(null, { city_key: "x", uf: "SP" }), 0);
});

test("SQL de proximidade tem os mesmos degraus e recusa alias sujo", () => {
  const sql = V.proximitySql("v", "c");
  for (const n of ["THEN 4", "THEN 3", "THEN 2", "THEN 1", "ELSE 0"]) assert.ok(sql.includes(n));
  assert.throws(() => V.proximitySql("v; drop", "c"));
});

/* ───────────────────────────── quem está dentro ─────────────────────────── */

test("as quatro abas valem em todas as modalidades, com o acesso certo", () => {
  for (const k of ["common", "academy", "condo", "neighborhood", "pet", "car", "games"]) {
    assert.ok(V.VITRINE_KINDS.includes(k), k);
  }
  assert.equal(V.accessModeFor("condo"), "territorial");
  assert.equal(V.accessModeFor("neighborhood"), "territorial");
  assert.equal(V.accessModeFor("pet"), "open");
  assert.equal(V.accessModeFor("games"), "open");
  assert.equal(V.accessModeFor("common"), "member");
  assert.equal(V.accessModeFor("academy"), "member");
  assert.equal(V.participantScopeFor("car"), "national");
  assert.equal(V.participantScopeFor("common"), "participants");
});
