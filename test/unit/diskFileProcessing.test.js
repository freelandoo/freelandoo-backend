// test/unit/diskFileProcessing.test.js
//
// ⚠️ ESTE TESTE EXISTE POR CAUSA DE UM BUG REAL QUE PASSOU.
//
// Quando o upload de portfólio migrou de `memoryStorage` para `diskStorage` (o
// celular passou a mandar o arquivo ORIGINAL, que não pode ficar no heap), todo
// caller que trabalhava sobre `file.buffer` passou a receber `undefined`. O
// sintoma seria "Arquivo nao enviado" ao postar uma FOTO — mensagem que fala de
// arquivo ausente quando o arquivo está lá, em disco.
//
// Nada quebrava em revisão: os tipos são JS puro, o lint não vê e os testes de
// porta usam um handler dublado. O que pega isso é exatamente o que está aqui:
// entregar um arquivo SÓ COM `path` e exigir que os processadores funcionem.
//
// Regra que fica, e ela tem DUAS metades:
//   1. processador que lê `file.buffer` chama `ensureFileBuffer`;
//   2. GUARD de porta pergunta `hasUpload(file)`, NUNCA `file.buffer`.
//
// A segunda metade faltava, e custou: quatro portas — foto de SERVIÇO, foto de
// PRODUTO da loja, capa e post da VAQUINHA e post do mural da ACADEMIA —
// ficaram recusando com "Arquivo não enviado" porque o guard olhava um campo
// que só existe depois do processamento. Duas delas (capa da vaquinha e
// avatar/capa da academia) mandam o arquivo CRU para o R2, então além do guard
// precisam de `ensureFileBuffer` explícito: sem ele o `Body` do putObject
// seria `undefined` e subiria um objeto vazio, que é pior — não dá erro.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const {
  ensureFileBuffer,
  hasUpload,
  processPortfolioMedia,
} = require("../../src/utils/mediaProcessing");

/** Arquivo como o multer em disco entrega: tem `path`, NÃO tem `buffer`. */
async function diskFile(buffer, name, mimetype) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fl-disk-test-"));
  const p = path.join(dir, name);
  await fs.writeFile(p, buffer);
  return {
    fieldname: "file",
    originalname: name,
    mimetype,
    size: buffer.length,
    path: p,
    destination: dir,
    filename: name,
    _dir: dir,
  };
}

async function jpeg(w, h) {
  return sharp({
    create: { width: w, height: h, channels: 3, background: { r: 120, g: 90, b: 60 } },
  })
    .jpeg()
    .toBuffer();
}

test("ensureFileBuffer lê do disco quando não há buffer", async () => {
  const bytes = Buffer.from("conteudo qualquer");
  const f = await diskFile(bytes, "x.bin", "application/octet-stream");
  assert.equal(f.buffer, undefined, "o arquivo em disco não nasce com buffer");
  await ensureFileBuffer(f);
  assert.ok(Buffer.isBuffer(f.buffer));
  assert.equal(f.buffer.toString(), "conteudo qualquer");
  await fs.rm(f._dir, { recursive: true, force: true });
});

test("ensureFileBuffer não mexe em quem já veio da memória", async () => {
  const buf = Buffer.from("ja estava aqui");
  const f = { buffer: buf, path: "/caminho/que/nao/existe" };
  await ensureFileBuffer(f);
  assert.equal(f.buffer, buf, "o buffer original é preservado, sem ir ao disco");
});

test("ensureFileBuffer tolera arquivo ausente e nulo", async () => {
  assert.equal(await ensureFileBuffer(null), null);
  const semPath = { mimetype: "image/png" };
  assert.deepEqual(await ensureFileBuffer(semPath), semPath);
});

test("post de FOTO funciona com arquivo só em disco (a regressão)", async () => {
  // 1080x1350 é 4:5 — a orientação de post que não precisa de corte.
  const f = await diskFile(await jpeg(1080, 1350), "foto.jpg", "image/jpeg");
  const out = await processPortfolioMedia(f, "image", { feedKind: "feed" });
  assert.equal(out.mimetype, "image/webp");
  assert.equal(out.mediaMetadata.media_type, "image");
  assert.equal(out.mediaMetadata.orientation, "4:5");
  assert.ok(out.buffer.length > 0);
  await fs.rm(f._dir, { recursive: true, force: true });
});

test("Curto de FOTO (feedKind bees) também funciona só em disco", async () => {
  const f = await diskFile(await jpeg(1080, 1920), "curto.jpg", "image/jpeg");
  const out = await processPortfolioMedia(f, "image", { feedKind: "bees" });
  assert.equal(out.mimetype, "image/webp");
  assert.equal(out.mediaMetadata.width, 1080);
  assert.equal(out.mediaMetadata.height, 1920);
  await fs.rm(f._dir, { recursive: true, force: true });
});

// ─── Os guards de porta ─────────────────────────────────────────────────────

test("hasUpload aceita arquivo em DISCO (o guard antigo recusava)", async () => {
  const f = await diskFile(await jpeg(10, 10), "foto.jpg", "image/jpeg");
  assert.equal(f.buffer, undefined);

  // Como o guard era escrito, e por que ele mentia:
  assert.equal(!f.buffer, true, "o guard antigo recusaria este arquivo");
  assert.equal(hasUpload(f), true, "mas o arquivo ESTÁ aqui, em disco");

  await fs.rm(f._dir, { recursive: true, force: true });
});

test("hasUpload aceita arquivo em MEMÓRIA", () => {
  assert.equal(hasUpload({ buffer: Buffer.from("x") }), true);
});

test("hasUpload recusa ausência de verdade", () => {
  assert.equal(hasUpload(null), false);
  assert.equal(hasUpload(undefined), false);
  assert.equal(hasUpload({}), false, "campo nenhum = não veio arquivo");
  assert.equal(hasUpload({ buffer: Buffer.alloc(0) }), false, "buffer vazio não é arquivo");
});

test("foto de SERVIÇO: do arquivo em disco até a mídia processada", async () => {
  // O caminho real da porta: guard → processamento. É o fluxo que respondia
  // "Arquivo não enviado" com a foto ali.
  const f = await diskFile(await jpeg(1080, 1350), "servico.jpg", "image/jpeg");
  assert.equal(hasUpload(f), true);

  const mimetype = String(f.mimetype || "").toLowerCase();
  const mediaType = mimetype.startsWith("image/") ? "image" : null;
  assert.equal(mediaType, "image");

  const out = await processPortfolioMedia(f, mediaType);
  assert.equal(out.mimetype, "image/webp");
  assert.ok(out.buffer.length > 0, "o R2 recebe bytes de verdade");

  await fs.rm(f._dir, { recursive: true, force: true });
});

test("capa que vai CRUA para o R2 precisa de ensureFileBuffer", async () => {
  // Capa da vaquinha e avatar/capa da academia não passam por processador
  // nenhum: o objeto `file` é entregue direto ao uploader, que lê
  // `file.buffer`. Sem a leitura do disco, o upload sobe vazio EM SILÊNCIO.
  const bytes = await jpeg(400, 400);
  const f = await diskFile(bytes, "capa.jpg", "image/jpeg");

  assert.equal(hasUpload(f), true, "o guard deixa passar");
  assert.equal(f.buffer, undefined, "e o uploader ainda não teria o que enviar");

  await ensureFileBuffer(f);
  assert.ok(Buffer.isBuffer(f.buffer));
  assert.equal(f.buffer.length, bytes.length, "os bytes que chegam ao R2 são os do arquivo");

  await fs.rm(f._dir, { recursive: true, force: true });
});
