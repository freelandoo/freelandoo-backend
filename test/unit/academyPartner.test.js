// test/unit/academyPartner.test.js
// Peças puras da API de parceiro de academia (mig 296): validação do corpo do
// POST /partner/v1/members, username nome.sobrenome, chave/token e a régua de
// validade dos treinos (30/60/90). O fluxo HTTP inteiro, contra Postgres, está
// em test/academy-partner.e2e.js.
const test = require("node:test");
const assert = require("node:assert");

const { validateMemberBody } = require("../../src/services/PartnerMemberService");
const { usernameBaseFromName, usernameCandidate } = require("../../src/utils/academyUsername");
const partnerKey = require("../../src/utils/partnerKey");
const validity = require("../../src/utils/workoutValidity");
const { notPendingAcademyUserSql } = require("../../src/utils/academyOnboarding");

const CPF_OK = "52998224725";
const base = { cpf: CPF_OK, nome: "Ana Souza", email: "ana@x.test", data_nascimento: "1990-04-02" };

test("corpo válido normaliza CPF, e-mail e telefone", () => {
  const r = validateMemberBody({ ...base, cpf: "529.982.247-25", email: " ANA@X.test ", telefone: "+55 (11) 99999-8888", ref_externa: 42 });
  assert.deepStrictEqual(r.data, {
    cpf: CPF_OK,
    nome: "Ana Souza",
    email: "ana@x.test",
    data_nascimento: "1990-04-02",
    telefone: "5511999998888",
    ref_externa: "42",
  });
});

test("cpf_invalido vem antes de qualquer outro erro", () => {
  assert.deepStrictEqual(validateMemberBody({ ...base, cpf: "11111111111" }), { status: 422, body: { erro: "cpf_invalido" } });
  assert.strictEqual(validateMemberBody({ cpf: "123" }).body.erro, "cpf_invalido");
});

test("dados_incompletos: falta nome, e-mail ou nascimento, ou formato ruim", () => {
  for (const patch of [{ nome: "" }, { email: undefined }, { data_nascimento: "" }, { email: "sem-arroba" }, { data_nascimento: "02/04/1990" }, { data_nascimento: "1990-02-31" }]) {
    assert.strictEqual(validateMemberBody({ ...base, ...patch }).body?.erro, "dados_incompletos", JSON.stringify(patch));
  }
});

test("menor_de_idade abaixo de 18", () => {
  const y = new Date().getFullYear();
  assert.strictEqual(validateMemberBody({ ...base, data_nascimento: `${y - 17}-01-01` }).body?.erro, "menor_de_idade");
  assert.ok(validateMemberBody({ ...base, data_nascimento: `${y - 19}-01-01` }).data);
});

test("telefone inválido é ignorado (não derruba a criação)", () => {
  assert.strictEqual(validateMemberBody({ ...base, telefone: "123" }).data.telefone, null);
});

test("username: primeiro.último em ASCII, cabe no CHECK do banco", () => {
  const re = /^[a-z0-9][a-z0-9_.]{2,29}$/;
  assert.strictEqual(usernameBaseFromName("Maria José da Silva"), "maria.silva");
  assert.strictEqual(usernameBaseFromName("João"), "joao");
  assert.strictEqual(usernameBaseFromName("Li"), "li.fit");
  assert.strictEqual(usernameBaseFromName("   "), "aluno");
  const longo = usernameBaseFromName("Maximiliano Bartolomeu Wolfeschlegelsteinhausenberger");
  for (const n of [0, 2, 99, 12345]) assert.match(usernameCandidate(longo, n), re);
  assert.strictEqual(usernameCandidate("maria.silva", 2), "maria.silva2");
});

test("chave de parceiro: prefixo, formato e comparação constante", () => {
  const k = partnerKey.generatePartnerKey();
  assert.ok(k.startsWith("flnd_parc_"));
  assert.ok(partnerKey.isPartnerKeyFormat(k));
  assert.ok(!partnerKey.isPartnerKeyFormat("flnd_atd_xxx"));
  const h = partnerKey.sha256Hex(k);
  assert.strictEqual(h.length, 64);
  assert.ok(partnerKey.hashesEqual(h, partnerKey.sha256Hex(k)));
  assert.ok(!partnerKey.hashesEqual(h, partnerKey.sha256Hex(k + "x")));
  assert.ok(!partnerKey.hashesEqual(h, "curto"));
  assert.match(partnerKey.generateFirstAccessToken(), /^[0-9a-f]{64}$/);
});

test("validade: só 30/60/90; ausente cai no fallback", () => {
  assert.deepStrictEqual(validity.parseValidadeDias(undefined, 60), { value: 60 });
  assert.deepStrictEqual(validity.parseValidadeDias(undefined), { value: undefined });
  assert.deepStrictEqual(validity.parseValidadeDias("30"), { value: 30 });
  assert.deepStrictEqual(validity.parseValidadeDias(90), { value: 90 });
  assert.ok(validity.parseValidadeDias(45).error);
  assert.ok(validity.parseValidadeDias("abc").error);
});

test("validade: vence_em = created_at + validade; dias restantes", () => {
  const created = "2026-01-01T00:00:00.000Z";
  assert.strictEqual(validity.venceEm(created, 30).toISOString(), "2026-01-31T00:00:00.000Z");
  const now = Date.parse("2026-01-21T00:00:00.000Z");
  assert.strictEqual(validity.diasRestantes(created, 30, now), 10);
  assert.strictEqual(validity.diasRestantes(created, 30, Date.parse("2026-02-05T00:00:00.000Z")), -5);
});

test("predicado de conta pendente", () => {
  assert.strictEqual(notPendingAcademyUserSql("u"), "u.academy_onboarding_state IS DISTINCT FROM 'aguardando_aceite'");
});
