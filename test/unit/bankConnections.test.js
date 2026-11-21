// Bancos conectados (mig 462): assinatura do webhook, extrato OFX/CSV,
// mapa de categorias e a conversão transação → lançamento.
const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyMalvoSignature, sign } = require("../../src/utils/malvoSignature");
const { parseStatement, parseAmountToCents, parseDate } = require("../../src/utils/statementParse");
const { mapBankCategory } = require("../../src/utils/bankCategoryMap");
const { itemNeedsAction, toCents } = require("../../src/storages/BankConnectionStorage");
const { _internals } = require("../../src/services/BankConnectionService");

// Vetor oficial da doc da Malvo (docs.malvo.io/webhooks/security).
const VEC = {
  secret: "whsec_testsecret",
  t: "1700000000",
  body: '{"event":"item/created","eventId":"evt_1","link":"https://a.test/?x=1&y=2"}',
  v1: "dcaf77c8756a00f70a8dd760e8c84b6d7f165f6ab0b697bfa3b13c240634e6f2",
};

test("assinatura: confere com o vetor oficial da Malvo", () => {
  assert.equal(sign(VEC.secret, VEC.t, VEC.body), VEC.v1);
  const r = verifyMalvoSignature(Buffer.from(VEC.body), `t=${VEC.t},v1=${VEC.v1}`, VEC.secret, {
    now: Number(VEC.t) * 1000,
  });
  assert.deepEqual(r, { ok: true });
});

test("assinatura: recusa corpo alterado, segredo errado, sem header e fora da janela", () => {
  const now = Number(VEC.t) * 1000;
  const h = `t=${VEC.t},v1=${VEC.v1}`;
  assert.equal(verifyMalvoSignature(Buffer.from(VEC.body + " "), h, VEC.secret, { now }).ok, false);
  assert.equal(verifyMalvoSignature(Buffer.from(VEC.body), h, "whsec_outro", { now }).ok, false);
  assert.equal(verifyMalvoSignature(Buffer.from(VEC.body), undefined, VEC.secret, { now }).ok, false);
  assert.equal(verifyMalvoSignature(Buffer.from(VEC.body), h, [], { now }).reason, "sem_segredo");
  assert.equal(
    verifyMalvoSignature(Buffer.from(VEC.body), h, VEC.secret, { now: now + 10 * 60 * 1000 }).reason,
    "fora_da_janela"
  );
});

test("assinatura: na rotação vale qualquer v1 e qualquer segredo da lista", () => {
  const now = Number(VEC.t) * 1000;
  const h = `t=${VEC.t},v1=${"0".repeat(64)},v1=${VEC.v1}`;
  assert.equal(verifyMalvoSignature(VEC.body, h, ["whsec_novo", VEC.secret], { now }).ok, true);
});

test("valor: formatos brasileiros e internacionais viram centavos com sinal", () => {
  assert.equal(parseAmountToCents("1.234,56"), 123456);
  assert.equal(parseAmountToCents("-12,30"), -1230);
  assert.equal(parseAmountToCents("1234.5"), 123450);
  assert.equal(parseAmountToCents("R$ 10,00"), 1000);
  assert.equal(parseAmountToCents("(5,00)"), -500);
  assert.equal(parseAmountToCents("abc"), null);
});

test("data: OFX, BR e ISO; data impossível é recusada", () => {
  assert.equal(parseDate("20261121120000[-3:BRT]"), "2026-11-21");
  assert.equal(parseDate("21/11/2026"), "2026-11-21");
  assert.equal(parseDate("2026-11-21T10:00:00Z"), "2026-11-21");
  assert.equal(parseDate("31/02/2026"), null);
});

test("OFX SGML: lê lançamentos e usa o FITID como identidade", () => {
  const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20261120<TRNAMT>-73.12<FITID>A1<MEMO>Compra Carrefour
</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20261105<TRNAMT>3500.00<FITID>A2<NAME>Salario
</STMTTRN>
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
  const { format, rows } = parseStatement(ofx);
  assert.equal(format, "ofx");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { external_id: "f_A1", date: "2026-11-20", amount_cents: -7312, title: "Compra Carrefour" });
  assert.equal(rows[1].amount_cents, 350000);
});

test("CSV: separador ;, decimal com vírgula e duas compras iguais no mesmo dia são duas", () => {
  const csv = "Data;Descrição;Valor\n20/11/2026;Padaria;-8,50\n20/11/2026;Padaria;-8,50\n21/11/2026;Pix recebido;100,00\n";
  const { format, rows } = parseStatement(csv);
  assert.equal(format, "csv");
  assert.equal(rows.length, 3);
  assert.notEqual(rows[0].external_id, rows[1].external_id);
  // Importar de novo dá os MESMOS ids (é o que impede duplicar).
  assert.deepEqual(parseStatement(csv).rows.map((r) => r.external_id), rows.map((r) => r.external_id));
  assert.equal(rows[2].amount_cents, 10000);
});

test("CSV: colunas de entrada e saída separadas", () => {
  const csv = "data,historico,entrada,saida\n2026-11-01,Salário,5000,\n2026-11-02,Luz,,180.40\n";
  const { rows } = parseStatement(csv);
  assert.deepEqual(rows.map((r) => r.amount_cents), [500000, -18040]);
});

test("CSV sem coluna de data não é reconhecido", () => {
  assert.equal(parseStatement("nome,valor\nx,1\n").rows.length, 0);
});

test("categorias: transferência entre contas próprias e pagamento de fatura NÃO entram", () => {
  assert.deepEqual(mapBankCategory({ categoryId: "04020000" }), { skip: true });
  assert.deepEqual(mapBankCategory({ categoryId: "05090000" }), { skip: true });
  assert.deepEqual(mapBankCategory({ categoryId: "03010000" }), { skip: true });
});

test("categorias: mapa para os presets e o nome da Malvo quando não há par", () => {
  assert.equal(mapBankCategory({ categoryId: "10000000" }).label, "Mercado");
  assert.equal(mapBankCategory({ categoryId: "01010000" }).label, "Salário");
  assert.equal(mapBankCategory({ categoryId: "03060000" }).label, "Renda de investimentos");
  assert.equal(mapBankCategory({ categoryId: "05100400", category: "PIX" }).label, "Transferências");
  assert.equal(mapBankCategory({ categoryId: "99000000", category: "Algo novo" }).label, "Algo novo");
  assert.equal(mapBankCategory({}).label, "Outros");
});

test("transação → lançamento: direção pelo tipo, valor absoluto, pendente fica de fora", () => {
  const out = _internals.txToEntry(
    { id: "t1", date: "2026-11-20T14:00:00Z", amount: -73.12, type: "DEBIT", status: "POSTED", description: "Carrefour", categoryId: "10000000" },
    "acc-1"
  );
  assert.deepEqual(out, {
    external_id: "t1",
    direction: "out",
    title: "Carrefour",
    category: "Mercado",
    amount_cents: 7312,
    date: "2026-11-20",
    id_bank_account: "acc-1",
  });
  assert.equal(_internals.txToEntry({ id: "t2", date: "2026-11-20", amount: 10, status: "PENDING" }, "a"), null);
  assert.equal(_internals.txToEntry({ id: "t3", date: "2026-11-20", amount: -500, categoryId: "05090000" }, "a"), null);
  assert.equal(_internals.txToEntry({ id: "t4", date: "2026-11-20", amount: 50, type: "CREDIT" }, "a").direction, "in");
});

test("fatura: a próxima a vencer; sem ela, a mais recente", () => {
  const future = new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10);
  const bills = [
    { dueDate: "2026-01-15", totalAmount: 1 },
    { dueDate: future, totalAmount: 2 },
    { dueDate: "2026-02-15", totalAmount: 3 },
  ];
  assert.equal(_internals.pickCurrentBill(bills).totalAmount, 2);
  assert.equal(_internals.pickCurrentBill([{ dueDate: "2025-01-01", totalAmount: 9 }]).totalAmount, 9);
  assert.equal(_internals.pickCurrentBill([]), null);
});

test("item precisa de ação: espera do usuário, erro de login e consentimento vencido", () => {
  assert.equal(itemNeedsAction({ status: "UPDATED", executionStatus: "SUCCESS" }), false);
  assert.equal(itemNeedsAction({ status: "WAITING_USER_INPUT" }), true);
  assert.equal(itemNeedsAction({ status: "LOGIN_ERROR" }), true);
  assert.equal(itemNeedsAction({ status: "OUTDATED", executionStatus: "CONSENT_EXPIRED" }), true);
  assert.equal(itemNeedsAction({ status: "LOGIN_IN_PROGRESS", executionStatus: "USER_AUTHORIZATION_PENDING" }), false);
});

test("centavos: decimal da Malvo → inteiro; vazio fica null", () => {
  assert.equal(toCents(254196.15), 25419615);
  assert.equal(toCents(null), null);
  assert.equal(toCents("x"), null);
});
