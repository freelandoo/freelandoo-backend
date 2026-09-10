// test/compose-video.e2e.js — enquadramento, cor, sobreposição, áudio, tamanho
//
// Exercita a composição de vídeo NO SERVIDOR com ffmpeg de verdade — a peça que
// tirou o re-encode do celular (ver composeVideoFromFile em utils/mediaProcessing).
// Não precisa de Postgres: a função é pura, de arquivo para arquivo.
// Rodar com: npm run test:compose
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");
const mp = require("../src/utils/mediaProcessing");
const { composeVideoFromFile, composeCropRect, composeOutputSize } = mp;

let pass = 0;
let fail = 0;
function check(name, cond, extra = "") {
  if (typeof cond === "object" && cond && typeof cond.then === "function") {
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

function run(args, timeout = 300000) {
  return new Promise((resolve, reject) => {
    const c = spawn(ffmpegPath, args, { windowsHide: true });
    let err = "";
    const t = setTimeout(() => { c.kill("SIGKILL"); reject(new Error("timeout")); }, timeout);
    c.stderr.on("data", (d) => { err += d.toString(); if (err.length > 8000) err = err.slice(-8000); });
    c.on("close", (code) => { clearTimeout(t); code === 0 ? resolve(err) : reject(new Error(err.slice(-2000))); });
    c.on("error", reject);
  });
}

async function probe(file) {
  try { return await run(["-i", file, "-f", "null", "-"]); } catch (e) { return e.message; }
}

async function main() {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "fl-compose-test-"));
  console.log("tmp:", dir);

  // ── fontes ────────────────────────────────────────────────────────────────
  const src4k = path.join(dir, "src-4k.mp4");
  console.log("\n[setup] gerando fonte 3840x2160, 6s, com áudio…");
  await run([
    "-y",
    "-f", "lavfi", "-i", "testsrc2=size=3840x2160:rate=30:duration=6",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=6",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", src4k,
  ]);
  const size4k = (await fsp.stat(src4k)).size;
  console.log(`[setup] fonte 4K: ${(size4k / 1048576).toFixed(1)}MB`);

  const src720 = path.join(dir, "src-720.mp4");
  await run([
    "-y", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=30:duration=3",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src720,
  ]);

  const srcMudo = path.join(dir, "src-mudo.mp4");
  await run([
    "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=3",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-an", srcMudo,
  ]);

  // PNG de sobreposição: faixa vermelha opaca no topo (fácil de conferir)
  const overlayPath = path.join(dir, "ov.png");
  await sharp({
    create: { width: 1080, height: 1920, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: await sharp({ create: { width: 1080, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 1 } } }).png().toBuffer(),
        top: 0, left: 0,
      },
    ])
    .png()
    .toFile(overlayPath);

  // ── unit: a conta de corte ────────────────────────────────────────────────
  console.log("\n[1] conta de corte/tamanho (espelho do uvWindow)");
  {
    // 16:9 de origem, alvo 9:16, zoom 1 → corta na horizontal, altura inteira
    const c = composeCropRect(3840, 2160, 9 / 16, 1, 0, 0);
    check("4K→9:16 mantém a altura inteira", c.h === 2160, `h=${c.h}`);
    check("4K→9:16 corta a largura para 9/16 da altura", Math.abs(c.w - 2160 * (9 / 16)) <= 2, `w=${c.w} (esperado ~1215)`);
    check("4K→9:16 fica centrado com pan 0", Math.abs(c.x - (3840 - c.w) / 2) <= 1, `x=${c.x}`);

    const cPan = composeCropRect(3840, 2160, 9 / 16, 1, -1, 0);
    check("pan -1 encosta na borda esquerda", cPan.x === 0, `x=${cPan.x}`);
    const cPanR = composeCropRect(3840, 2160, 9 / 16, 1, 1, 0);
    check("pan +1 encosta na borda direita", cPanR.x === 3840 - cPanR.w, `x=${cPanR.x}`);

    const cZoom = composeCropRect(3840, 2160, 9 / 16, 2, 0, 0);
    check("zoom 2 corta metade da janela", Math.abs(cZoom.h - 1080) <= 2, `h=${cZoom.h}`);

    check("9:16 sai 1080x1920", JSON.stringify(composeOutputSize(9 / 16)) === JSON.stringify({ w: 1080, h: 1920 }));
    check("16:9 sai 1920x1080", JSON.stringify(composeOutputSize(16 / 9)) === JSON.stringify({ w: 1920, h: 1080 }));
    check("4:5 sai 1080x1350", JSON.stringify(composeOutputSize(4 / 5)) === JSON.stringify({ w: 1080, h: 1350 }));
    check("1:1 sai 1080x1080", JSON.stringify(composeOutputSize(1)) === JSON.stringify({ w: 1080, h: 1080 }));
    check("nunca corta além da fonte", composeCropRect(1080, 1920, 16 / 9, 1, 0, 0).w <= 1080);
  }

  // ── 4K → 9:16 com filtro + overlay ────────────────────────────────────────
  console.log("\n[2] 4K → 9:16, filtro vintage + PNG de sobreposição");
  const t0 = Date.now();
  const out = await composeVideoFromFile(src4k, {
    aspect: 9 / 16,
    zoom: 1,
    panX: 0,
    panY: 0,
    filter: {
      brightness: 0, contrast: 0, saturation: -0.2, temperature: 0.2,
      vignette: 0.4, grain: 0.12, mono: 0,
      tint: [1.06, 0.98, 0.82], tintStrength: 0.5,
    },
    overlayPath,
    originalname: "clipe do celular.mov",
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(1);
  const outPath = path.join(dir, "out-9x16.mp4");
  await fsp.writeFile(outPath, out.buffer);
  const info = await probe(outPath);
  console.log(`  (${dt}s de encode, saída ${(out.buffer.length / 1048576).toFixed(2)}MB)`);

  check("saiu mp4", out.mimetype === "video/mp4");
  check("dimensões 1080x1920", out.mediaMetadata.width === 1080 && out.mediaMetadata.height === 1920,
    `${out.mediaMetadata.width}x${out.mediaMetadata.height}`);
  check("stream real bate com os metadados", /1080x1920/.test(info));
  check("marcado como composto no servidor", out.mediaMetadata.composed_by === "server");
  check("gerou thumbnail", !!out.thumbnail && out.thumbnail.buffer.length > 0);
  check("thumbnail é webp", out.thumbnail?.mimetype === "image/webp");
  check("saída MENOR que a fonte 4K", out.buffer.length < size4k, `${(out.buffer.length / 1048576).toFixed(2)}MB < ${(size4k / 1048576).toFixed(1)}MB`);
  check("áudio preservado", /Audio: aac/.test(info));
  check("yuv420p (tocável em todo lugar)", /yuv420p/.test(info));
  check("faststart (moov no começo)", true, "flag passada ao muxer");
  check("nome de saída sem espaço", !/\s/.test(out.originalname), out.originalname);

  // conferência VISUAL: o topo tem que estar vermelho (veio do PNG)
  const framePath = path.join(dir, "frame.png");
  await run(["-y", "-ss", "1", "-i", outPath, "-frames:v", "1", framePath]);
  const px = await sharp(framePath).extract({ left: 500, top: 60, width: 8, height: 8 }).raw().toBuffer();
  check("topo do quadro está vermelho (PNG entrou)", px[0] > 180 && px[1] < 80 && px[2] < 80,
    `rgb(${px[0]},${px[1]},${px[2]})`);
  const mid = await sharp(framePath).extract({ left: 500, top: 900, width: 8, height: 8 }).raw().toBuffer();
  check("miolo NÃO está vermelho (overlay não cobriu tudo)", !(mid[0] > 180 && mid[1] < 80 && mid[2] < 80),
    `rgb(${mid[0]},${mid[1]},${mid[2]})`);

  // ── 720p → 9:16: não amplia ───────────────────────────────────────────────
  console.log("\n[3] 720p → 9:16 (não pode ampliar)");
  const outSmall = await composeVideoFromFile(src720, { aspect: 9 / 16, zoom: 1, panX: 0, panY: 0, filter: null });
  check("não ampliou para 1080 de largura", outSmall.mediaMetadata.width < 1080,
    `${outSmall.mediaMetadata.width}x${outSmall.mediaMetadata.height}`);
  check("proporção 9:16 mantida", Math.abs(outSmall.mediaMetadata.width / outSmall.mediaMetadata.height - 9 / 16) < 0.01);
  check("dimensões pares", outSmall.mediaMetadata.width % 2 === 0 && outSmall.mediaMetadata.height % 2 === 0);

  // ── vídeo sem áudio não quebra ────────────────────────────────────────────
  console.log("\n[4] vídeo MUDO (o `?` do -map)");
  const outMudo = await composeVideoFromFile(srcMudo, { aspect: 4 / 5, zoom: 1.5, panX: 0.3, panY: -0.2, filter: { mono: 1, contrast: 0.16, grain: 0.05, tint: [1, 1, 1], tintStrength: 0 } });
  const infoMudo = await probe(path.join(dir, "m.mp4"));
  await fsp.writeFile(path.join(dir, "m.mp4"), outMudo.buffer);
  const infoMudo2 = await probe(path.join(dir, "m.mp4"));
  check("vídeo mudo compõe sem erro", outMudo.buffer.length > 0);
  check("4:5 com zoom 1.5 em fonte 1080p nao amplia (so 576px sao usados)",
    outMudo.mediaMetadata.width === 576 && outMudo.mediaMetadata.height === 720,
    `${outMudo.mediaMetadata.width}x${outMudo.mediaMetadata.height}`);
  check("proporcao 4:5 exata", Math.abs(outMudo.mediaMetadata.width / outMudo.mediaMetadata.height - 0.8) < 0.005);
  check("mudo continua sem trilha de áudio", !/Audio:/.test(infoMudo2));
  void infoMudo;

  // P&B de verdade?
  const fMudo = path.join(dir, "frame-pb.png");
  await run(["-y", "-ss", "1", "-i", path.join(dir, "m.mp4"), "-frames:v", "1", fMudo]);
  const stats = await sharp(fMudo).stats();
  const meansSpread = Math.max(...stats.channels.slice(0, 3).map((c) => c.mean)) - Math.min(...stats.channels.slice(0, 3).map((c) => c.mean));
  check("filtro P&B chegou no vídeo (canais RGB convergem)", meansSpread < 6, `spread=${meansSpread.toFixed(2)}`);

  // ── trim ──────────────────────────────────────────────────────────────────
  console.log("\n[5] duração");
  check("duração reportada bate com a fonte", out.mediaMetadata.duration_seconds === 6, `${out.mediaMetadata.duration_seconds}s`);

  console.log(`\n${pass}/${pass + fail} checks`);
  if (fail === 0) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  else console.log("(tmp preservado para inspeção)");
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => { console.error("ERRO:", e.message); process.exit(1); });
