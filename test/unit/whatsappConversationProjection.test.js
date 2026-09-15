// test/unit/whatsappConversationProjection.test.js
//
// ═══ A LISTA DA CAIXA TEM DOIS ALIMENTADORES E UMA SÓ VERDADE ═══
//
// A lista de conversas é preenchida por DOIS caminhos:
//
//   • a LEITURA  — `GET /whatsapp/conversations`, pelo `WhatsappService`;
//   • o PUSH     — evento `whatsapp:message`, pelo `WhatsappIngestService`.
//
// Enquanto cada um montava o objeto à mão, eles divergiram — e o defeito foi
// SILENCIOSO no pior sentido: nada quebrou, nenhum erro apareceu, e a mesma
// conversa tinha DUAS aparências. Chegando ao vivo, a tela mostrava "Contato
// sem nome"; depois de um F5, o nome certo. O dado estava correto no banco o
// tempo todo (`push_name: "Printtei"`); o que faltava era o push falar o mesmo
// idioma da leitura (`title` e `phone_display`).
//
// Foi encontrado no primeiro teste real com a Cloud API, em 15/09/2026.
//
// ⚠️ Estes casos NÃO testam a formatação (isso é do `whatsappJid`). Testam o
// CONTRATO: que os dois caminhos produzem as mesmas chaves, e que o campo que
// a tela usa como título existe nos dois.

const test = require("node:test");
const assert = require("node:assert");

const { publicConversation } = require("../../src/utils/whatsappConversation");

/** Uma linha de `tb_whatsapp_conversation` como o banco devolve. */
const ROW = Object.freeze({
  id_conversation: "5a1ea17b-6068-42bd-aea8-ab11a6eecbcb",
  id_instance: "0541d672-b4c6-4c0b-b040-c307f8e23a97",
  remote_jid: "5511953375995@s.whatsapp.net",
  phone: "5511953375995",
  push_name: "Printtei",
  is_group: false,
  unread_count: 1,
  last_message_at: "2026-09-15T20:11:06.033Z",
  last_message_preview: "Olá",
});

test("o título sai do nome de perfil quando ele existe", () => {
  const c = publicConversation(ROW);
  assert.strictEqual(c.title, "Printtei");
});

test("sem nome de perfil, o título é o telefone formatado — nunca vazio", () => {
  const c = publicConversation({ ...ROW, push_name: null });
  assert.notStrictEqual(c.title, "");
  assert.ok(c.title.includes("9533"), `título inesperado: ${c.title}`);
});

test("o telefone formatado é campo próprio, e a tela depende dele", () => {
  const c = publicConversation(ROW);
  assert.ok(c.phone_display, "phone_display não pode faltar");
  assert.strictEqual(c.phone, "5511953375995");
});

test("⚠️ o PUSH e a LEITURA entregam exatamente as mesmas chaves", () => {
  // O emit do Ingest acrescenta `last_message_*` da mensagem recém-chegada,
  // porque a linha lida pode ser anterior ao UPDATE — mas o CONJUNTO de chaves
  // tem que ser o mesmo, senão a tela só sabe desenhar um dos dois.
  const leitura = publicConversation(ROW);
  const push = {
    ...publicConversation(ROW),
    last_message_preview: "Olá",
    last_message_at: "2026-09-15T20:11:03.000Z",
  };
  assert.deepStrictEqual(Object.keys(push).sort(), Object.keys(leitura).sort());
});

test("⚠️ o defeito de volta: o objeto ANTIGO do push não tinha o que a tela lê", () => {
  // Era isto que o Ingest emitia. O front faz
  // `title || phone_display || ""` — os dois ausentes, e a linha nascia sem
  // nome. Este caso existe para que ninguém volte a montar o objeto à mão.
  const antigo = {
    id_conversation: ROW.id_conversation,
    remote_jid: ROW.remote_jid,
    phone: ROW.phone,
    push_name: ROW.push_name,
    is_group: ROW.is_group,
    last_message_preview: "Olá",
    last_message_at: ROW.last_message_at,
  };
  assert.strictEqual(antigo.title, undefined);
  assert.strictEqual(antigo.phone_display, undefined);

  const agora = publicConversation(ROW);
  assert.ok(agora.title && agora.phone_display, "a projeção precisa dos dois");
});

test("linha ausente vira null, e não um objeto de campos vazios", () => {
  assert.strictEqual(publicConversation(null), null);
});
