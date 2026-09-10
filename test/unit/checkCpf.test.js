// test/unit/checkCpf.test.js
//
// A disponibilidade do CPF no cadastro. É *unit* de propósito: `checkCpf` só
// precisa de um `conn` com `query`, e o SELECT que ele dispara é o mesmo
// `AuthStorage.findUserIdByCpf` que o signup já exercita contra o Postgres.
//
// O que estes casos seguram é a metade que erra calada:
//   - a FORMA da resposta (`available` + `reason`), que é o que o campo lê para
//     dizer "já existe uma conta" em vez de só ficar vermelho;
//   - CPF torto respondendo `cpf_invalid` e NÃO indo ao banco — perguntar por
//     número que não existe em conta nenhuma seria consulta à toa, e devolver
//     "disponível" para ele mentiria sobre um CPF que o signup vai recusar;
//   - e a recusa de máscara: o campo manda "000.000.000-00", então normalizar
//     antes de consultar é o que evita responder "disponível" para um CPF que
//     está no banco em outra forma.
const test = require("node:test");
const assert = require("node:assert");

const AuthService = require("../../src/services/AuthService");

// CPF sintético com dígito verificador válido (não é de ninguém: a sequência
// base é 111.444.777 e os verificadores saem da própria conta).
const VALID_CPF = "11144477735";
const VALID_MASKED = "111.444.777-35";

/** Conn de mentira: diz se AQUELE cpf tem dono, e registra o que foi consultado. */
function connWith(ownerId, seen = []) {
  return {
    async query(_sql, params) {
      seen.push(params[0]);
      if (ownerId === null) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ id_user: ownerId }] };
    },
  };
}

test("CPF livre volta disponível, sem motivo", async () => {
  const res = await AuthService.checkCpf({ cpf: VALID_CPF }, connWith(null));
  assert.deepStrictEqual(res, { available: true });
});

test("CPF que já tem conta volta indisponível com o motivo que o campo lê", async () => {
  const res = await AuthService.checkCpf({ cpf: VALID_CPF }, connWith(42));
  assert.strictEqual(res.available, false);
  assert.strictEqual(res.reason, "cpf_taken");
});

test("não devolve quem é o dono do CPF", async () => {
  const res = await AuthService.checkCpf({ cpf: VALID_CPF }, connWith(42));
  assert.ok(!("id_user" in res), "a resposta não pode identificar a conta existente");
  assert.ok(!JSON.stringify(res).includes("42"));
});

test("CPF mascarado é normalizado antes de consultar", async () => {
  const seen = [];
  const res = await AuthService.checkCpf({ cpf: VALID_MASKED }, connWith(null, seen));
  assert.strictEqual(res.available, true);
  assert.deepStrictEqual(seen, [VALID_CPF], "o banco tem que ver só os 11 dígitos");
});

test("dígito verificador errado é recusado sem ir ao banco", async () => {
  const seen = [];
  const res = await AuthService.checkCpf({ cpf: "11144477700" }, connWith(null, seen));
  assert.deepStrictEqual(res, { available: false, reason: "cpf_invalid" });
  assert.strictEqual(seen.length, 0, "CPF inválido não consulta o banco");
});

test("sequência repetida não passa como disponível", async () => {
  const res = await AuthService.checkCpf({ cpf: "11111111111" }, connWith(null));
  assert.strictEqual(res.available, false);
  assert.strictEqual(res.reason, "cpf_invalid");
});

test("vazio e ausente são recusados como inválidos, não como disponíveis", async () => {
  for (const payload of [{ cpf: "" }, {}, null]) {
    const res = await AuthService.checkCpf(payload, connWith(null));
    assert.strictEqual(res.available, false);
    assert.strictEqual(res.reason, "cpf_invalid");
  }
});
