// test/unit/whatsappCloudWebhook.test.js
//
// W2 — o webhook da Meta Cloud API. Os dois módulos são PUROS (sem I/O), então
// isto é *unit* e roda sem Postgres.
//
// Cobre as duas metades que, erradas, não dão sintoma:
//
//   • a ASSINATURA — errar aqui deixa uma rota pública aceitando qualquer
//     corpo da internet, e tudo continua parecendo funcionar;
//   • o ROTEAMENTO por `phone_number_id` — errar aqui entrega a conversa de um
//     cliente na caixa de outro, sem erro nenhum.

const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");

const { isValidSignature, readVerification } = require("../../src/utils/whatsappCloudSignature");
const { readEnvelope, readMessage, namesOf } = require("../../src/utils/whatsappCloudPayload");

const SECRET = "app-secret-de-teste";

function sign(body, secret = SECRET) {
  return "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/* ─────────────────────────────── assinatura ──────────────────────────────── */

test("assinatura correta sobre os bytes crus é aceita", () => {
  const raw = Buffer.from(JSON.stringify({ object: "whatsapp_business_account" }), "utf8");
  assert.strictEqual(isValidSignature(raw, sign(raw), SECRET), true);
});

test("corpo adulterado por UM byte é recusado", () => {
  const raw = Buffer.from('{"a":1}', "utf8");
  const header = sign(raw);
  assert.strictEqual(isValidSignature(Buffer.from('{"a":2}', "utf8"), header, SECRET), false);
});

test("assinatura de OUTRO segredo é recusada", () => {
  const raw = Buffer.from('{"a":1}', "utf8");
  assert.strictEqual(isValidSignature(raw, sign(raw, "outro-segredo"), SECRET), false);
});

test("header ausente, vazio ou sem o prefixo sha256= é recusado", () => {
  const raw = Buffer.from('{"a":1}', "utf8");
  for (const header of [undefined, null, "", "abc", "sha1=deadbeef", "sha256="]) {
    assert.strictEqual(isValidSignature(raw, header, SECRET), false, `aceitou ${header}`);
  }
});

test("header com hex torto é recusado SEM lançar", () => {
  // `Buffer.from(hex, "hex")` ignora em silêncio o que não é hex e devolve um
  // buffer curto. Sem a validação do formato, a comparação passaria a ser
  // contra um buffer truncado — e `timingSafeEqual` LANÇARIA por tamanhos
  // diferentes, derrubando a rota com exceção em vez de responder 401.
  const raw = Buffer.from('{"a":1}', "utf8");
  assert.strictEqual(isValidSignature(raw, "sha256=zzzz", SECRET), false);
  assert.strictEqual(isValidSignature(raw, "sha256=" + "a".repeat(63), SECRET), false);
  assert.strictEqual(isValidSignature(raw, "sha256=" + "a".repeat(65), SECRET), false);
});

test("sem App Secret nada é aceito — nem uma assinatura bem formada", () => {
  const raw = Buffer.from('{"a":1}', "utf8");
  assert.strictEqual(isValidSignature(raw, sign(raw), ""), false);
  assert.strictEqual(isValidSignature(raw, sign(raw), undefined), false);
});

test("string e Buffer com os mesmos bytes assinam igual", () => {
  // O controller recebe Buffer; um teste ou um proxy pode entregar string.
  const text = '{"ola":"mundo com acento é"}';
  assert.strictEqual(isValidSignature(text, sign(Buffer.from(text, "utf8")), SECRET), true);
});

/* ──────────────────────────── GET de verificação ─────────────────────────── */

test("handshake devolve o challenge quando o token confere", () => {
  const r = readVerification(
    { "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1234" },
    "tok"
  );
  assert.deepStrictEqual(r, { ok: true, challenge: "1234" });
});

test("handshake recusa token errado, modo errado e challenge ausente", () => {
  const base = { "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1234" };
  assert.strictEqual(readVerification({ ...base, "hub.verify_token": "xxx" }, "tok").ok, false);
  assert.strictEqual(readVerification({ ...base, "hub.mode": "unsubscribe" }, "tok").ok, false);
  assert.strictEqual(readVerification({ ...base, "hub.challenge": "" }, "tok").ok, false);
});

test("sem verify token configurado o handshake FALHA — não aceita qualquer um", () => {
  // Cair para "aceita" aqui deixaria qualquer pessoa inscrever um endereço
  // nosso e passar a receber as conversas dos clientes.
  const q = { "hub.mode": "subscribe", "hub.verify_token": "", "hub.challenge": "1234" };
  assert.strictEqual(readVerification(q, "").ok, false);
  assert.strictEqual(readVerification(q, undefined).ok, false);
});

/* ─────────────────────── roteamento por phone_number_id ──────────────────── */

function envelopeWith(blocks) {
  return {
    object: "whatsapp_business_account",
    entry: blocks.map((b) => ({
      id: b.waba || "WABA1",
      changes: [
        {
          field: b.field || "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "551199", phone_number_id: b.phoneId },
            contacts: b.contacts || [],
            messages: b.messages || [],
          },
        },
      ],
    })),
  };
}

test("⚠️ um POST com DOIS números devolve os dois blocos, cada um com o seu dono", () => {
  // Este é o caso que faz a mensagem de um cliente cair na caixa de outro.
  // Ler só `entry[0].changes[0]` passa em todo teste manual — onde só existe
  // um número — e perde mensagens em produção, calado.
  const body = envelopeWith([
    { phoneId: "111", messages: [{ id: "wamid.A", from: "5511900000001", type: "text", text: { body: "oi" } }] },
    { phoneId: "222", messages: [{ id: "wamid.B", from: "5511900000002", type: "text", text: { body: "olá" } }] },
  ]);

  const blocks = readEnvelope(body);
  assert.strictEqual(blocks.length, 2, "perdeu um bloco — mensagens sumiriam em silêncio");
  assert.deepStrictEqual(
    blocks.map((b) => b.phoneNumberId),
    ["111", "222"]
  );
  assert.strictEqual(readMessage(blocks[0].messages[0], new Map()).body, "oi");
  assert.strictEqual(readMessage(blocks[1].messages[0], new Map()).body, "olá");
});

test("várias changes dentro da MESMA entry também são preservadas", () => {
  const body = {
    entry: [
      {
        id: "WABA1",
        changes: [
          { field: "messages", value: { metadata: { phone_number_id: "111" }, messages: [] } },
          { field: "messages", value: { metadata: { phone_number_id: "222" }, messages: [] } },
        ],
      },
    ],
  };
  assert.deepStrictEqual(
    readEnvelope(body).map((b) => b.phoneNumberId),
    ["111", "222"]
  );
});

test("envelope vazio, torto ou sem entry não lança", () => {
  for (const body of [null, undefined, {}, { entry: null }, { entry: "x" }, { entry: [null] }]) {
    assert.doesNotThrow(() => readEnvelope(body));
  }
  assert.deepStrictEqual(readEnvelope(null), []);
  // Entry sem `changes` não vira bloco fantasma sem número.
  assert.deepStrictEqual(readEnvelope({ entry: [{ id: "W" }] }), []);
});

test("o campo da mudança é preservado — é ele que separa conversa de qualidade", () => {
  const body = envelopeWith([{ phoneId: "111", field: "phone_number_quality_update" }]);
  assert.strictEqual(readEnvelope(body)[0].field, "phone_number_quality_update");
});

/* ──────────────────────────── leitura da mensagem ────────────────────────── */

test("texto simples vira corpo, telefone e JID sintetizado", () => {
  const m = readMessage(
    { id: "wamid.X", from: "5511988887777", timestamp: "1700000000", type: "text", text: { body: " bom dia " } },
    new Map()
  );
  assert.strictEqual(m.body, "bom dia");
  assert.strictEqual(m.phone, "5511988887777");
  // A conversa é modelada por JID desde a mig 223 e a Cloud API manda só o
  // número: sem sintetizar, a mesma tela teria que ler dois formatos.
  assert.strictEqual(m.remoteJid, "5511988887777@s.whatsapp.net");
  assert.strictEqual(m.mediaType, "text");
  assert.strictEqual(m.sentAt.getTime(), 1700000000 * 1000, "timestamp vem em SEGUNDOS");
});

test("nome de perfil vem de contacts[], não da mensagem", () => {
  const names = namesOf([{ wa_id: "5511988887777", profile: { name: "Maria" } }]);
  const m = readMessage({ id: "w1", from: "5511988887777", type: "text", text: { body: "oi" } }, names);
  assert.strictEqual(m.pushName, "Maria");
});

test("mensagem sem id ou sem remetente é descartada", () => {
  const base = { type: "text", text: { body: "oi" } };
  assert.strictEqual(readMessage({ ...base, from: "5511988887777" }, new Map()), null);
  assert.strictEqual(readMessage({ ...base, id: "w1" }, new Map()), null);
  assert.strictEqual(readMessage(null, new Map()), null);
});

test("texto vazio é descartado; mídia sem legenda NÃO é", () => {
  assert.strictEqual(
    readMessage({ id: "w1", from: "5511999999999", type: "text", text: { body: "   " } }, new Map()),
    null
  );
  const img = readMessage({ id: "w2", from: "5511999999999", type: "image", image: { id: "mid" } }, new Map());
  assert.strictEqual(img.mediaType, "image");
  assert.ok(img.body, "imagem sem legenda tem que virar rótulo, não sumir");
  assert.strictEqual(img.mediaId, "mid", "o id da mídia é o que o W4 usa para baixar o binário");
});

test("legenda vence rótulo; documento sem legenda usa o nome do arquivo", () => {
  const withCaption = readMessage(
    { id: "w1", from: "5511999999999", type: "image", image: { id: "m", caption: "a planta" } },
    new Map()
  );
  assert.strictEqual(withCaption.body, "a planta");

  const doc = readMessage(
    { id: "w2", from: "5511999999999", type: "document", document: { id: "m", filename: "orcamento.pdf" } },
    new Map()
  );
  assert.strictEqual(doc.body, "orcamento.pdf");
});

test("⚠️ todo media_type produzido está na lista FECHADA do CHECK da mig 223", () => {
  // `chk_whatsapp_message_media_type` aceita só estes seis. Um valor novo faria
  // a gravação estourar — e o erro apareceria em produção, no webhook.
  const allowed = new Set(["text", "image", "audio", "video", "document", "other"]);

  const samples = [
    { type: "text", text: { body: "oi" } },
    { type: "image", image: { id: "m" } },
    { type: "audio", audio: { id: "m" } },
    { type: "video", video: { id: "m" } },
    { type: "document", document: { id: "m" } },
    { type: "sticker", sticker: { id: "m" } },
    { type: "location", location: { name: "Obra" } },
    { type: "reaction", reaction: { emoji: "👍" } },
    { type: "contacts" },
    { type: "order" },
    { type: "button", button: { text: "Sim" } },
    { type: "interactive", interactive: { button_reply: { title: "Confirmar" } } },
    { type: "tipo_que_ainda_nao_existe" },
    {},
  ];

  for (const s of samples) {
    const m = readMessage({ id: "w1", from: "5511999999999", ...s }, new Map());
    assert.ok(m, `tipo ${s.type || "vazio"} sumiu — o cliente escreveu e a caixa ficaria em silêncio`);
    assert.ok(allowed.has(m.mediaType), `${s.type} produziu media_type inválido: ${m.mediaType}`);
  }
});

test("botão e lista guardam o que a pessoa ESCOLHEU", () => {
  const btn = readMessage(
    { id: "w1", from: "5511999999999", type: "button", button: { text: "Confirmo" } },
    new Map()
  );
  assert.strictEqual(btn.body, "Confirmo");

  const list = readMessage(
    { id: "w2", from: "5511999999999", type: "interactive", interactive: { list_reply: { title: "Orçamento" } } },
    new Map()
  );
  assert.strictEqual(list.body, "Orçamento");
});

test("localização carrega o nome do lugar quando ele vem", () => {
  const m = readMessage(
    { id: "w1", from: "5511999999999", type: "location", location: { name: "Rua X, 100" } },
    new Map()
  );
  assert.match(m.body, /Rua X, 100/);
  assert.strictEqual(m.mediaType, "other");
});

test("timestamp ausente ou torto cai para agora, sem lançar", () => {
  for (const ts of [undefined, "", "abc", "0", "-5"]) {
    const m = readMessage({ id: "w1", from: "5511999999999", timestamp: ts, type: "text", text: { body: "oi" } }, new Map());
    assert.ok(m.sentAt instanceof Date && !Number.isNaN(m.sentAt.getTime()));
  }
});
