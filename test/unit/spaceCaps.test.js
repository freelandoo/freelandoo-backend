// test/unit/spaceCaps.test.js
//
// O teto de "um só" das modalidades territoriais e do carro (decisão do Alex,
// 2026-09-17): *"só pode uma de condomínio, e uma de rua, somente o pet pode
// ter mais de uma"*.
//
// É *unit* e não e2e de propósito: `assertSingleSpace` só precisa de um `conn`
// com `query`, então a decisão inteira — inclusive a folga de re-entrada, que é
// a parte que trancaria quem já está dentro — se exercita sem Postgres.
const test = require("node:test");
const assert = require("node:assert");

const SpaceCaps = require("../../src/utils/spaceCaps");

const USER = "11111111-1111-1111-1111-111111111111";
const MEU_PREDIO = "22222222-2222-2222-2222-222222222222";
const OUTRO_PREDIO = "33333333-3333-3333-3333-333333333333";

/**
 * Conn de mentira que devolve o espaço pedido — e CONTA as consultas, porque
 * "não perguntou ao banco" é parte do contrato nas modalidades sem teto.
 */
function fakeConn(rowByKind = {}) {
  const calls = [];
  return {
    calls,
    async query(_sql, params) {
      calls.push(params);
      const row = rowByKind[params[1]];
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    },
  };
}

const condoRow = { id_profile: MEU_PREDIO, display_name: "Residencial", kind: "condo", role: "member" };

test("a tabela de tetos declara o que o Alex pediu", () => {
  assert.strictEqual(SpaceCaps.limitFor("condo"), 1);
  assert.strictEqual(SpaceCaps.limitFor("neighborhood"), 1);
  assert.strictEqual(SpaceCaps.limitFor("car"), 1);
  assert.strictEqual(SpaceCaps.limitFor("pet"), Infinity);
  // Modalidade sem linha na tabela não ganha teto por aqui (a comunidade
  // temática já é limitada pelo ingresso vendido).
  assert.strictEqual(SpaceCaps.limitFor("common"), Infinity);
});

test("pet pode ter mais de um — nem chega a perguntar ao banco", async () => {
  const conn = fakeConn({ pet: { id_profile: "x", display_name: "Bidu" } });
  const cap = await SpaceCaps.assertSingleSpace(conn, { id_user: USER, kind: "pet" });
  assert.strictEqual(cap, null);
  assert.strictEqual(conn.calls.length, 0, "modalidade sem teto não consulta o banco");
});

test("quem não tem condomínio passa", async () => {
  const conn = fakeConn({});
  assert.strictEqual(
    await SpaceCaps.assertSingleSpace(conn, { id_user: USER, kind: "condo" }),
    null
  );
});

test("quem já tem condomínio é recusado — e a recusa APONTA o que é dele", async () => {
  const conn = fakeConn({ condo: condoRow });
  const cap = await SpaceCaps.assertSingleSpace(conn, { id_user: USER, kind: "condo" });
  assert.ok(cap, "deveria recusar o segundo condomínio");
  // 409 e não 403: "isso já existe e é seu" é o que faz a tela oferecer abrir.
  assert.strictEqual(cap.statusCode, 409);
  assert.strictEqual(cap.existing_community.id_profile, MEU_PREDIO);
  assert.strictEqual(cap.existing_community.display_name, "Residencial");
});

test("re-entrada no MESMO espaço passa (trocar de apartamento no próprio prédio)", async () => {
  const conn = fakeConn({ condo: condoRow });
  const cap = await SpaceCaps.assertSingleSpace(conn, {
    id_user: USER,
    kind: "condo",
    allow_id_profile: MEU_PREDIO,
  });
  assert.strictEqual(cap, null);
});

test("a folga da re-entrada NÃO vale para outro prédio", async () => {
  const conn = fakeConn({ condo: condoRow });
  const cap = await SpaceCaps.assertSingleSpace(conn, {
    id_user: USER,
    kind: "condo",
    allow_id_profile: OUTRO_PREDIO,
  });
  assert.ok(cap, "entrar em outro condomínio continua sendo um segundo condomínio");
  assert.strictEqual(cap.existing_community.id_profile, MEU_PREDIO);
});

test("bairro e carro obedecem ao mesmo teto", async () => {
  const bairro = await SpaceCaps.assertSingleSpace(
    fakeConn({ neighborhood: { id_profile: "n1", display_name: "Centro" } }),
    { id_user: USER, kind: "neighborhood" }
  );
  assert.strictEqual(bairro.statusCode, 409);

  const carro = await SpaceCaps.assertSingleSpace(
    fakeConn({ car: { id_profile: "c1", display_name: "Civic" } }),
    { id_user: USER, kind: "car" }
  );
  assert.strictEqual(carro.statusCode, 409);
});

test("sem usuário o teto não decide nada — quem autentica é o chamador", async () => {
  const conn = fakeConn({ condo: condoRow });
  assert.strictEqual(
    await SpaceCaps.assertSingleSpace(conn, { id_user: null, kind: "condo" }),
    null
  );
  assert.strictEqual(conn.calls.length, 0);
});

test("o espelho do front é a mesma lista", () => {
  const single = ["condo", "neighborhood", "car"].every((k) => SpaceCaps.isSingleSpaceKind(k));
  assert.ok(single);
  assert.strictEqual(SpaceCaps.isSingleSpaceKind("pet"), false);
});
