// *Unit*: `verifiedUserSql` é a régua ÚNICA do selo (mig 268) e interpola uma
// expressão no SQL — o guard contra valor vindo de requisição é o que se testa.
const test = require("node:test");
const assert = require("node:assert");
const { verifiedUserSql } = require("../../src/utils/verifiedBadge");

test("o selo sai de DOIS ramos: pagou no período OU é admin", () => {
  const sql = verifiedUserSql("p.id_user");
  assert.match(sql, /tb_user_verification/);
  assert.match(sql, /paid_until > NOW\(\)/);
  assert.match(sql, /'Administrator'/);
  assert.match(sql, /p\.id_user/);
});

test("só aceita expressão de coluna escrita no código — nunca valor externo", () => {
  for (const bad of ["1=1", "p.id_user; DROP TABLE x", "'abc'", "id_user", "p.id_user OR TRUE", ""]) {
    assert.throws(() => verifiedUserSql(bad), /inválida/, bad);
  }
  assert.doesNotThrow(() => verifiedUserSql("tu.id_user"));
});
