// test/upload-compose-door.e2e.js
//
// Exercita a PORTA da composição no servidor: um multipart real chegando ao
// middleware `uploadPortfolioMedia.withComposeParts` com os três campos
// (`file`, `overlay`, `pip`), mais a validação de `compose`.
//
// ⚠️ O que este teste protege é a FIAÇÃO, que é o que quebra calado: se
// `req.overlayFile` deixar de ser preenchido, a composição continua rodando —
// só que sem o texto que a pessoa escreveu, e ninguém percebe até ver o post
// publicado. E se os temporários pararem de ser apagados, o /tmp do container
// enche em silêncio até o dia em que nada mais sobe.
//
// Não precisa de Postgres nem de token: monta um Express mínimo só com o
// middleware. Rodar com: npm run test:compose

const fs = require("fs");
const http = require("http");
const express = require("express");
const uploadPortfolioMedia = require("../src/middlewares/uploadPortfolioMedia");
const { parseComposeParams } = require("../src/utils/composeParams");

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (cond && typeof cond.then === "function") {
    throw new Error(`check("${name}") recebeu Promise — use await`);
  }
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${extra ? " — " + extra : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${extra ? " — " + extra : ""}`);
  }
}

// PNG 1x1 transparente e um "mp4" mínimo (só o header ftyp — o middleware
// confia no mimetype declarado; quem valida o conteúdo de verdade é o ffmpeg).
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);
const FAKE_MP4 = Buffer.concat([
  Buffer.from([0, 0, 0, 0x18]),
  Buffer.from("ftypisom"),
  Buffer.alloc(16, 0),
]);

async function main() {
  const app = express();
  const seen = [];

  app.post("/upload", uploadPortfolioMedia.withComposeParts, (req, res) => {
    const snapshot = {
      file: req.file
        ? {
            field: req.file.fieldname,
            name: req.file.originalname,
            path: req.file.path,
            size: req.file.size,
            hasBuffer: !!req.file.buffer,
          }
        : null,
      overlay: req.overlayFile
        ? { name: req.overlayFile.originalname, path: req.overlayFile.path }
        : null,
      pip: req.pipFile ? { name: req.pipFile.originalname, path: req.pipFile.path } : null,
      compose: req.body?.compose ?? null,
      media_type: req.body?.media_type ?? null,
      sort_order: req.body?.sort_order ?? null,
    };
    seen.push(snapshot);
    res.status(201).json(snapshot);
  });

  app.use((err, req, res, _next) => {
    res.status(400).json({ error: err.message });
  });

  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;

  // ── 1. os três campos juntos ────────────────────────────────────────────
  console.log("\n[1] multipart com file + overlay + pip");
  {
    const fd = new FormData();
    fd.append("file", new Blob([FAKE_MP4], { type: "video/mp4" }), "clipe.mp4");
    fd.append("overlay", new Blob([PNG_1X1], { type: "image/png" }), "ov.png");
    fd.append("pip", new Blob([FAKE_MP4], { type: "video/mp4" }), "pip.mp4");
    fd.append("media_type", "video");
    fd.append("sort_order", "0");
    fd.append(
      "compose",
      JSON.stringify({ aspect: 0.5625, zoom: 1.4, panX: -0.2, panY: 0, filter: { mono: 1 } })
    );

    const res = await fetch(`${base}/upload`, { method: "POST", body: fd });
    const body = await res.json();

    check("respondeu 201", res.status === 201, String(res.status));
    check("req.file é o campo `file`", body.file?.field === "file", body.file?.field);
    check("nome do arquivo preservado", body.file?.name === "clipe.mp4", body.file?.name);
    check("req.overlayFile preenchido", !!body.overlay, body.overlay?.name);
    check("req.pipFile preenchido", !!body.pip, body.pip?.name);
    check("campos de texto continuam no body", body.media_type === "video" && body.sort_order === "0");
    check("compose chegou como string JSON", typeof body.compose === "string");

    const parsed = parseComposeParams(body.compose);
    check(
      "compose sobrevive à ida e volta",
      parsed?.aspect === 0.5625 && parsed?.zoom === 1.4 && parsed?.filter?.mono === 1
    );

    // ⚠️ Os bytes foram para o DISCO, não para o heap. É essa linha que separa
    // esta porta da anterior: com memoryStorage, um 4K de celular ficaria
    // inteiro na memória do processo.
    check(
      "o arquivo foi para o disco (tem path)",
      typeof body.file?.path === "string" && body.file.path.length > 0
    );
    check("nada de buffer em memória", body.file?.hasBuffer === false);
    check("tamanho registrado", body.file?.size === FAKE_MP4.length, `${body.file?.size}B`);
  }

  // ── 2. limpeza dos temporários ──────────────────────────────────────────
  console.log("\n[2] temporários apagados quando a resposta fecha");
  {
    await new Promise((r) => setTimeout(r, 200));
    const s = seen[0];
    check("temporário do `file` foi apagado", !fs.existsSync(s.file.path));
    check("temporário do `overlay` foi apagado", !fs.existsSync(s.overlay.path));
    check("temporário do `pip` foi apagado", !fs.existsSync(s.pip.path));
  }

  // ── 3. cliente antigo: só `file`, sem compose ───────────────────────────
  console.log("\n[3] cliente ANTIGO (só `file`, sem compose) continua entrando");
  {
    const fd = new FormData();
    fd.append("file", new Blob([PNG_1X1], { type: "image/png" }), "foto.png");
    fd.append("media_type", "image");
    const res = await fetch(`${base}/upload`, { method: "POST", body: fd });
    const body = await res.json();
    check("respondeu 201", res.status === 201, String(res.status));
    check("req.file preenchido", body.file?.name === "foto.png");
    check("overlay ausente vira null", body.overlay === null);
    check("pip ausente vira null", body.pip === null);
    check("sem compose, parseComposeParams devolve null", parseComposeParams(body.compose) === null);
  }

  // ── 4. regra de tipo aceito ─────────────────────────────────────────────
  //
  // ⚠️ Exercitada DIRETO, e não por HTTP: quando o fileFilter recusa, o multer
  // ABORTA o stream do multipart, e no Windows esse aborto corre com o
  // encerramento do processo — o teste imprimia tudo verde e saía 127, que se
  // lê como falha e não é. A regra é um predicado, e testá-la como predicado
  // cobre a mesma coisa sem o risco de harness. A fiação dos campos, que é o
  // que esta entrega mudou de verdade, continua sendo exercitada por HTTP.
  console.log("\n[4] regra de tipo aceito (fileFilter)");
  {
    const ok = uploadPortfolioMedia.isAllowedUploadType;
    check("aceita mp4", ok("video/mp4"));
    check("aceita quicktime (o .mov do iPhone)", ok("video/quicktime"));
    check("aceita webm", ok("video/webm"));
    check("aceita png (o overlay chega assim)", ok("image/png"));
    check("aceita jpeg e webp", ok("image/jpeg") && ok("image/webp"));
    check("recusa pdf", !ok("application/pdf"));
    check("recusa executável", !ok("application/x-msdownload"));
    check("recusa vazio, indefinido e nulo", !ok("") && !ok(undefined) && !ok(null));
    check("é insensível a maiúsculas", ok("VIDEO/MP4"));
  }

  server.closeAllConnections?.();
  await new Promise((r) => server.close(r));
  console.log(`\n${pass}/${pass + fail} checks`);
  process.exitCode = fail === 0 ? 0 : 1;
}

main().catch((e) => {
  console.error("ERRO:", e.message);
  process.exitCode = 1;
});
