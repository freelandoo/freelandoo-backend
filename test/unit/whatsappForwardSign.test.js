// O CONTRATO da assinatura do repasse de WhatsApp (mig 307) com o sistema da
// academia. O Coliseu verifica com o MESMO vetor em
// src/lib/whatsapp/oficial/assinatura.test.ts — mudar o formato aqui sem mudar
// lá faz toda mensagem ser recusada do outro lado, em silêncio.
const test = require("node:test");
const assert = require("node:assert/strict");
const { sign } = require("../../src/services/WhatsappForwardDispatcher");

test("HMAC-SHA256 hex de `${timestamp}.${corpo}`", () => {
  assert.equal(
    sign("segredo-de-teste", "1761500000", '{"tipo":"mensagem"}'),
    "802af5eff1b77b1103eb9e42df8421fa20f414e44d382735285a01b65a4bae1f"
  );
});
