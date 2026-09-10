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
// Regra que fica: processador que lê `file.buffer` chama `ensureFileBuffer`.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const sharp = require("sharp");
const { ensureFileBuffer, processPortfolioMedia } = require("../../src/utils/mediaProcessing");

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
