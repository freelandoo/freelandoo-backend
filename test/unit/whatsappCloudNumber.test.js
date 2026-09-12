// test/unit/whatsappCloudNumber.test.js
//
// W3 — cadastro de número na Cloud API. Cobre as duas peças puras, que são as
// que erram em silêncio:
//
//   • a separação DDI/resto — errar cadastra na Meta um número que não existe,
//     e o sintoma chega como "o código não veio";
//   • o PIN de duas etapas — ele não é guardado em lugar nenhum, então se a
//     derivação não for estável o número trava num re-registro futuro, e a Meta
//     leva 7 dias para limpar.

const test = require("node:test");
const assert = require("node:assert");

const { splitPhone } = require("../../src/utils/whatsappJid");
const cloud = require("../../src/integrations/whatsappProvider/cloud");

/* ────────────────────────── separação DDI / número ───────────────────────── */

test("celular com DDD e sem DDI recebe o 55", () => {
  // É assim que a pessoa escreve o próprio número.
  assert.deepStrictEqual(splitPhone("11988887777"), {
    cc: "55",
    number: "11988887777",
    full: "5511988887777",
  });
});

test("fixo com DDD (10 dígitos) também vale", () => {
  assert.deepStrictEqual(splitPhone("1133334444"), {
    cc: "55",
    number: "1133334444",
    full: "551133334444",
  });
});

test("⚠️ número que JÁ tem DDI não ganha um segundo", () => {
  // Sem a régua de comprimento, "5511988887777" viraria cc=55 + 5511988887777.
  assert.deepStrictEqual(splitPhone("5511988887777"), {
    cc: "55",
    number: "11988887777",
    full: "5511988887777",
  });
});

test("máscara, espaços e + são ignorados", () => {
  for (const v of ["+55 (11) 98888-7777", "55 11 98888 7777", "+5511988887777"]) {
    assert.strictEqual(splitPhone(v).full, "5511988887777", `falhou em ${v}`);
  }
});

test("curto demais, longo demais e vazio são RECUSADOS, não adivinhados", () => {
  // Recusar é melhor que inventar: um número de telefone errado cadastrado no
  // WABA gasta uma das vagas do portfólio e precisa ser removido à mão.
  for (const v of ["", null, undefined, "988887777", "119888", "1".repeat(16), "abc"]) {
    assert.strictEqual(splitPhone(v), null, `aceitou ${JSON.stringify(v)}`);
  }
});

test("DDI de outro país é respeitado quando informado", () => {
  const r = splitPhone("351912345678");
  assert.strictEqual(r.full, "351912345678");
  // Com 12 dígitos o número já é tratado como tendo DDI — não recebe 55.
  assert.ok(!r.full.startsWith("55"));
});

/* ──────────────────────────── PIN de duas etapas ─────────────────────────── */

const cfgA = { appSecret: "segredo-A" };
const cfgB = { appSecret: "segredo-B" };

test("o PIN é estável para o mesmo número e segredo", () => {
  // Ele não é guardado em lugar nenhum: se não for reprodutível, um
  // re-registro futuro fica impossível.
  const a = cloud.deriveTwoStepPin(cfgA, "123456789");
  const b = cloud.deriveTwoStepPin(cfgA, "123456789");
  assert.strictEqual(a, b);
});

test("o PIN tem SEMPRE 6 dígitos, inclusive com zeros à esquerda", () => {
  // `String(n)` sem padding devolveria "12345" para o valor 12345, e a Meta
  // recusa PIN com menos de 6 dígitos. Varre um espaço grande para pegar o
  // caso raro em vez de esperar que ele apareça em produção.
  for (let i = 0; i < 3000; i++) {
    const pin = cloud.deriveTwoStepPin(cfgA, `numero-${i}`);
    assert.match(pin, /^\d{6}$/, `PIN inválido para ${i}: ${pin}`);
  }
});

test("números diferentes têm PINs diferentes", () => {
  assert.notStrictEqual(
    cloud.deriveTwoStepPin(cfgA, "111111111"),
    cloud.deriveTwoStepPin(cfgA, "222222222")
  );
});

test("⚠️ trocar o App Secret muda o PIN — é a consequência a conhecer", () => {
  // Não é defeito: é o preço de derivar em vez de guardar. Está aqui como
  // asserção para que a consequência seja descoberta lendo o teste, e não no
  // dia de um re-registro.
  assert.notStrictEqual(
    cloud.deriveTwoStepPin(cfgA, "123456789"),
    cloud.deriveTwoStepPin(cfgB, "123456789")
  );
});

/* ──────────────────────────────── capabilities ───────────────────────────── */

test("a Cloud declara cadastro de número; a Evolution, QR", () => {
  // É por esta capability que o service escolhe o caminho — e não por
  // `provider === "cloud"` espalhado, que é como o gate de uma delas acabaria
  // ficando para trás.
  const wp = require("../../src/integrations/whatsappProvider");
  assert.strictEqual(wp.get("cloud").capabilities.numberRegistration, true);
  assert.strictEqual(wp.get("evolution").capabilities.numberRegistration, false);
});

test("o adaptador da Cloud expõe os três passos do cadastro", () => {
  for (const fn of ["addNumber", "requestCode", "confirmCode", "ensure", "connect"]) {
    assert.strictEqual(typeof cloud[fn], "function", `faltou ${fn}`);
  }
});

test("envio e mídia ainda RECUSAM em voz alta (são do W4)", () => {
  // Provedor que responde "ok" sem fazer nada é a falha que só aparece quando
  // o cliente reclama que ninguém respondeu.
  assert.rejects(() => cloud.sendText(), /não está disponível/);
  assert.rejects(() => cloud.fetchMedia(), /não está disponível/);
});
