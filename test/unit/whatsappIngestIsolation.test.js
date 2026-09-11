// test/unit/whatsappIngestIsolation.test.js
//
// ═══ O INVARIANTE MAIS IMPORTANTE DO MÓDULO DE WHATSAPP ═══
//
// `WhatsappIngestService` — o que recebe mensagem — NÃO pode alcançar nenhum
// módulo capaz de ENVIAR mensagem. Não existe caminho de código de uma mensagem
// que chega até uma que sai.
//
// Isso não é higiene de arquitetura:
//
//   • é o que garante que ninguém é respondido AUTOMATICAMENTE pelo WhatsApp de
//     um usuário da Freelandoo — toda saída nasce de um clique do dono;
//   • e é o que sustenta, perante a Meta, que a plataforma não opera ferramenta
//     de disparo automático ou em massa. Desde 07/12/2019 os Termos dizem que o
//     WhatsApp toma medidas legais contra quem faz isso **ou ajuda outros a
//     fazer** — e uma plataforma que conecta o WhatsApp de terceiros é
//     exatamente "ajudar outros". O isolamento é a prova estrutural.
//
// A migração para a Cloud API (mig 240) acrescentou o registry
// `integrations/whatsappProvider`, que é o novo lugar por onde se envia. Ele é
// importado pelo `WhatsappService` e NUNCA pelo Ingest — e é por isso que este
// teste existe: um `require` inocente acrescentado numa correção futura
// quebraria a garantia sem quebrar nenhum teste funcional.
//
// ⚠️ O teste lê os `require` DE VERDADE, não o texto do arquivo: o comentário
// do topo do Ingest CITA `integrations/evolution` para explicar a regra, e um
// grep ingênuo acusaria o próprio comentário que documenta o invariante.

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "..", "src");

/** Só os caminhos realmente exigidos por `require(...)`, sem comentários. */
function requiresOf(file) {
  const raw = fs.readFileSync(file, "utf8");
  const code = raw
    // comentário de bloco e de linha saem primeiro: é neles que o invariante
    // está DESCRITO, e descrever não é importar.
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return [...code.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)].map((m) => m[1]);
}

/** Fecho transitivo dos requires locais a partir de um arquivo. */
function reachableLocalModules(entry) {
  const seen = new Set();
  const stack = [entry];

  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);

    for (const spec of requiresOf(file)) {
      if (!spec.startsWith(".")) continue; // pacote do npm, não é nosso
      const base = path.resolve(path.dirname(file), spec);
      const candidates = [base, `${base}.js`, path.join(base, "index.js")];
      const resolved = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
      if (resolved) stack.push(resolved);
    }
  }
  return seen;
}

test("a ingestão do WhatsApp não alcança nenhum módulo de envio", () => {
  const entry = path.join(SRC, "services", "WhatsappIngestService.js");
  const reachable = reachableLocalModules(entry);

  // Os dois lugares do backend que sabem ENVIAR mensagem de WhatsApp.
  const senders = [
    path.join(SRC, "integrations", "evolution", "index.js"),
    path.join(SRC, "integrations", "whatsappProvider", "index.js"),
    path.join(SRC, "integrations", "whatsappProvider", "evolution.js"),
    path.join(SRC, "integrations", "whatsappProvider", "cloud.js"),
    // O Service é quem envia; alcançá-lo daria ao Ingest um caminho indireto.
    path.join(SRC, "services", "WhatsappService.js"),
  ];

  for (const sender of senders) {
    assert.ok(
      !reachable.has(sender),
      `WhatsappIngestService alcança ${path.relative(SRC, sender)} — isso abre um ` +
        `caminho de código de "mensagem que chega" para "mensagem que sai". ` +
        `Se a ingestão precisa mesmo falar com o provedor, é uma decisão a tomar ` +
        `de olhos abertos, não um require acrescentado de passagem.`
    );
  }
});

test("o parser de payload também não alcança envio", () => {
  // O parser é a primeira coisa que toca o corpo vindo de fora. Se ele puder
  // enviar, o isolamento do Ingest não vale nada.
  const entry = path.join(SRC, "utils", "whatsappPayload.js");
  const reachable = reachableLocalModules(entry);

  assert.ok(
    !reachable.has(path.join(SRC, "integrations", "evolution", "index.js")),
    "whatsappPayload alcança o cliente da Evolution"
  );
  assert.ok(
    !reachable.has(path.join(SRC, "integrations", "whatsappProvider", "index.js")),
    "whatsappPayload alcança o registry de provedores"
  );
});

test("o registry de provedores conhece evolution e cloud, e nada mais", () => {
  const wp = require(path.join(SRC, "integrations", "whatsappProvider"));
  const names = wp.all().map((p) => p.provider).sort();

  // A lista é FECHADA e espelha o CHECK `chk_whatsapp_instance_provider` da
  // mig 240. Provedor novo entra nos DOIS lugares: aqui e numa migration. Se
  // só entrar aqui, a gravação estoura; se só entrar no banco, a linha fica
  // sem adaptador e a pessoa sem canal.
  assert.deepStrictEqual(names, ["cloud", "evolution"]);
});

test("provedor desconhecido não resolve, e linha sem provider é da Evolution", () => {
  const wp = require(path.join(SRC, "integrations", "whatsappProvider"));

  assert.strictEqual(wp.get("telegram"), null, "provedor inventado tem que devolver null");
  assert.strictEqual(wp.get(undefined), null);

  // Linha anterior à mig 240 (ou projeção que não trouxe a coluna) é da
  // Evolution — é o que o DEFAULT da coluna afirma.
  assert.strictEqual(wp.forInstance({}).provider, "evolution");
  assert.strictEqual(wp.forInstance({ provider: "cloud" }).provider, "cloud");
});

test("só a Evolution declara sessão ociosa — é isso que governa o sweeper", () => {
  const wp = require(path.join(SRC, "integrations", "whatsappProvider"));

  // O sweeper da mig 224 desliga sessão parada porque a sessão Baileys custa
  // memória de pé. A Cloud API é stateless: desconectar um cliente oficial por
  // ociosidade arrancaria a integração dele sem motivo, em silêncio, 30 dias
  // depois de conectar.
  assert.strictEqual(wp.get("evolution").capabilities.idleSession, true);
  assert.strictEqual(wp.get("cloud").capabilities.idleSession, false);

  // E só a Evolution pareia por QR: a Cloud API cadastra número e confirma por
  // código. A tela decide o que desenhar por esta capability.
  assert.strictEqual(wp.get("evolution").capabilities.qrPairing, true);
  assert.strictEqual(wp.get("cloud").capabilities.qrPairing, false);

  // A janela de 24h e a nota de qualidade são da Meta, e só ela as tem.
  assert.strictEqual(wp.get("cloud").capabilities.serviceWindow, true);
  assert.strictEqual(wp.get("evolution").capabilities.serviceWindow, false);
});
