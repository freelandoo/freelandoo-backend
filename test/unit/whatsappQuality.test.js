// test/unit/whatsappQuality.test.js
//
// W6 — a leitura dos eventos de saúde do número.
//
// ═══ POR QUE ESTES CASOS, E NÃO OUTROS ═══
//
// Nenhum destes eventos pode ser provocado sob demanda: ninguém consegue pedir
// à Meta que sinalize um número ou restrinja uma conta para ver a tela reagir.
// Se não for exercitado aqui, o caminho inteiro só roda pela primeira vez no
// dia do problema real — que é o pior dia possível para descobrir um `if`
// trocado.
//
// O parser é puro de propósito para que isso seja possível.

const test = require("node:test");
const assert = require("node:assert");

const { readQualityEvent } = require("../../src/utils/whatsappCloudQuality");
const { readEnvelope } = require("../../src/utils/whatsappCloudPayload");

/** Monta o envelope como a Meta manda, e devolve o 1º bloco já parseado. */
function blockOf(field, value) {
  return readEnvelope({
    object: "whatsapp_business_account",
    entry: [{ id: "1745921236638169", changes: [{ field, value }] }],
  })[0];
}

/* ─────────────────────────── qualidade do número ─────────────────────────── */

test("número sinalizado avisa o dono e vira FLAGGED", () => {
  const ev = readQualityEvent(
    blockOf("phone_number_quality_update", {
      display_phone_number: "5511968128174",
      event: "FLAGGED",
      current_limit: "TIER_1K",
    })
  );
  assert.strictEqual(ev.kind, "quality");
  assert.strictEqual(ev.phone, "5511968128174");
  assert.strictEqual(ev.status, "FLAGGED");
  assert.strictEqual(ev.alert, true, "FLAGGED tem que acordar o dono");
});

test("rebaixamento também avisa", () => {
  const ev = readQualityEvent(
    blockOf("phone_number_quality_update", { display_phone_number: "5511968128174", event: "DOWNGRADE" })
  );
  assert.strictEqual(ev.alert, true);
});

test("boa notícia NÃO avisa — mas é gravada", () => {
  // Aviso que chega quando não há nada a fazer é o que ensina a pessoa a
  // ignorar o próximo, que é o que importa.
  const up = readQualityEvent(
    blockOf("phone_number_quality_update", { display_phone_number: "5511968128174", event: "UPGRADE" })
  );
  assert.strictEqual(up.alert, false);
  assert.strictEqual(up.status, null, "UPGRADE não afirma status nenhum");

  const un = readQualityEvent(
    blockOf("phone_number_quality_update", { display_phone_number: "5511968128174", event: "UNFLAGGED" })
  );
  assert.strictEqual(un.alert, false);
  assert.strictEqual(un.status, "CONNECTED", "desmarcado volta a estar conectado");
});

test("o evento de qualidade NUNCA devolve rating — a Meta não manda", () => {
  // Esta asserção existe para travar uma tentação: derivar GREEN/YELLOW/RED do
  // nome do evento e gravar num campo que o painel apresenta como medido.
  for (const event of ["FLAGGED", "UNFLAGGED", "UPGRADE", "DOWNGRADE", "ONBOARDING"]) {
    const ev = readQualityEvent(
      blockOf("phone_number_quality_update", { display_phone_number: "5511968128174", event })
    );
    assert.strictEqual(ev.rating, null, `${event} não pode inventar rating`);
  }
});

/* ───────────────────────────── conta em apuros ───────────────────────────── */

test("violação de conta avisa", () => {
  const ev = readQualityEvent(
    blockOf("account_update", { phone_number: "5511968128174", event: "ACCOUNT_VIOLATION" })
  );
  assert.strictEqual(ev.kind, "account");
  assert.strictEqual(ev.alert, true);
});

test("ban_info no corpo vale mais que o nome do evento", () => {
  // A Meta já renomeou estes eventos mais de uma vez. O objeto no corpo só
  // aparece quando há ban de verdade.
  const ev = readQualityEvent(
    blockOf("account_update", {
      phone_number: "5511968128174",
      event: "ALGO_QUE_AINDA_NAO_EXISTE",
      ban_info: { waba_ban_state: "SCHEDULE_FOR_DISABLE", waba_ban_date: "2026-10-01" },
    })
  );
  assert.strictEqual(ev.alert, true, "ban desconhecido ainda tem que avisar");
  assert.strictEqual(ev.status, "BANNED");
});

test("restrição em lista vira RESTRICTED", () => {
  const ev = readQualityEvent(
    blockOf("account_update", {
      phone_number: "5511968128174",
      event: "ACCOUNT_RESTRICTION",
      restriction_info: [{ restriction_type: "RESTRICTED_ADD_PHONE_NUMBER_ACTION" }],
    })
  );
  assert.strictEqual(ev.status, "RESTRICTED");
  assert.strictEqual(ev.alert, true);
});

test("conta verificada é notícia boa — não avisa", () => {
  const ev = readQualityEvent(
    blockOf("account_update", { phone_number: "5511968128174", event: "VERIFIED_ACCOUNT" })
  );
  assert.strictEqual(ev.alert, false);
  assert.strictEqual(ev.status, null);
});

/* ─────────────────────────────── fronteiras ──────────────────────────────── */

test("bloco de mensagem não é evento de qualidade", () => {
  // Quem chama trata `null` como "não é comigo" e segue para a ingestão de
  // conversa. Devolver um objeto aqui faria toda mensagem virar evento de
  // qualidade sem dono.
  assert.strictEqual(readQualityEvent(blockOf("messages", { messages: [] })), null);
  assert.strictEqual(readQualityEvent(blockOf("message_template_status_update", {})), null);
});

test("número formatado casa com o que está gravado", () => {
  // O cadastro grava dígitos (`5511968128174`); a Meta manda ora assim, ora
  // como `+55 11 96812-8174`. Comparar string crua perderia o evento por causa
  // de um hífen — e o sintoma seria o painel nunca mostrar nada.
  const ev = readQualityEvent(
    blockOf("phone_number_quality_update", { display_phone_number: "+55 11 96812-8174", event: "FLAGGED" })
  );
  assert.strictEqual(ev.phone, "5511968128174");
});

test("evento sem número não derruba nada", () => {
  const ev = readQualityEvent(blockOf("phone_number_quality_update", { event: "FLAGGED" }));
  assert.strictEqual(ev.phone, "");
  assert.strictEqual(ev.alert, true);
});
