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

/** Os lugares do backend que sabem ENVIAR mensagem de WhatsApp. */
const SENDERS = [
  path.join(SRC, "integrations", "whatsappProvider", "index.js"),
  path.join(SRC, "integrations", "whatsappProvider", "cloud.js"),
  // O Service é quem envia; alcançá-lo daria ao Ingest um caminho indireto.
  path.join(SRC, "services", "WhatsappService.js"),
];

// ⚠️ A LISTA É POR PROVEDOR, e cada ingestão nova entra aqui. O invariante vale
// para o canal, não para um arquivo: uma segunda porta de entrada que pudesse
// enviar reabriria exatamente o caminho que a primeira fecha — e o teste da
// primeira continuaria passando, verde, enquanto a garantia já não existe.
//
// Na Cloud API isso pesa MAIS: o número está no nosso Business Portfolio, então
// um disparo automático nosso seria, perante a Meta, a plataforma operando
// ferramenta de automação — com o portfólio inteiro, e portanto o número de
// todos os clientes, no mesmo risco.
const INGESTS = [path.join(SRC, "services", "WhatsappCloudIngestService.js")];

for (const entry of INGESTS) {
  const name = path.basename(entry, ".js");

  test(`${name} não alcança nenhum módulo de envio`, () => {
    const reachable = reachableLocalModules(entry);

    for (const sender of SENDERS) {
      assert.ok(
        !reachable.has(sender),
        `${name} alcança ${path.relative(SRC, sender)} — isso abre um ` +
          `caminho de código de "mensagem que chega" para "mensagem que sai". ` +
          `Se a ingestão precisa mesmo falar com o provedor, é uma decisão a tomar ` +
          `de olhos abertos, não um require acrescentado de passagem.`
      );
    }
  });
}

for (const parser of ["whatsappCloudPayload"]) {
  test(`o parser ${parser} também não alcança envio`, () => {
    // O parser é a primeira coisa que toca o corpo vindo de fora. Se ele puder
    // enviar, o isolamento do Ingest não vale nada.
    const reachable = reachableLocalModules(path.join(SRC, "utils", `${parser}.js`));

    for (const sender of SENDERS) {
      assert.ok(
        !reachable.has(sender),
        `${parser} alcança ${path.relative(SRC, sender)}`
      );
    }
  });
}

test("o módulo de assinatura do webhook é puro — só criptografia", () => {
  // Ele decide se um corpo vindo da internet é aceito. Alcançar banco, rede ou
  // provedor daqui transformaria a checagem de autenticidade numa superfície
  // com efeitos colaterais, executada ANTES de qualquer autenticação.
  const entry = path.join(SRC, "utils", "whatsappCloudSignature.js");
  const reachable = reachableLocalModules(entry);

  assert.deepStrictEqual(
    [...reachable],
    [entry],
    "whatsappCloudSignature deixou de ser autocontido"
  );
});

test("o registry conhece SÓ a Cloud — a Evolution foi removida", () => {
  const wp = require(path.join(SRC, "integrations", "whatsappProvider"));
  const names = wp.all().map((p) => p.provider).sort();

  // ⚠️ A lista é FECHADA e não espelha mais o CHECK do banco, de propósito: o
  // CHECK da mig 240 continua aceitando `'evolution'` como valor HISTÓRICO (o
  // mesmo tipo de legado que o nome da coluna `evolution_instance`, que hoje
  // guarda o `phone_number_id` da Cloud). Apertar o CHECK exigiria uma
  // migration que falharia o boot se alguma linha antiga existisse — e o ganho
  // seria zero, porque quem decide é este registry.
  //
  // Provedor NOVO entra aqui E numa migration. Só aqui, a gravação estoura; só
  // no banco, a linha fica sem adaptador e a pessoa sem canal.
  assert.deepStrictEqual(names, ["cloud"]);
});

test("provedor desconhecido não resolve, e linha sem provider é da Cloud", () => {
  const wp = require(path.join(SRC, "integrations", "whatsappProvider"));

  assert.strictEqual(wp.get("telegram"), null, "provedor inventado tem que devolver null");
  assert.strictEqual(wp.get(undefined), null);

  // ⚠️ `'evolution'` devolve `null` — e é isso que queremos: `null` faz o
  // service responder "não configurado", que é a verdade, em vez de estourar
  // com TypeError no meio de uma requisição. Em produção não existe linha
  // assim (conferido antes da remoção).
  assert.strictEqual(wp.get("evolution"), null);

  // Projeção que não trouxe a coluna cai na Cloud, que é o único provedor.
  assert.strictEqual(wp.forInstance({}).provider, "cloud");
  assert.strictEqual(wp.forInstance({ provider: "cloud" }).provider, "cloud");
});

test("a Cloud não pareia por QR, e a janela de 24h é dela", () => {
  const wp = require(path.join(SRC, "integrations", "whatsappProvider"));
  const cloud = wp.get("cloud");

  // A tela decide o que desenhar por estas capabilities, nunca pelo nome do
  // provedor: desenhar QR para a Cloud mostraria uma caixa vazia para sempre.
  assert.strictEqual(cloud.capabilities.qrPairing, false);
  assert.strictEqual(cloud.capabilities.numberRegistration, true);

  // A janela de 24h e a nota de qualidade são regras da Meta.
  assert.strictEqual(cloud.capabilities.serviceWindow, true);

  // ⚠️ `idleSession` false é o que tirou o sweeper da mig 224 do boot: ele
  // existia porque a sessão Baileys ficava de pé custando memória. A Cloud é
  // STATELESS — desconectar quem não abre a caixa arrancaria a integração de
  // alguém sem motivo nenhum, 30 dias depois de conectar.
  assert.strictEqual(cloud.capabilities.idleSession, false);
});
