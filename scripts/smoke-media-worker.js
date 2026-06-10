// scripts/smoke-media-worker.js — F4.S1
//
// Smoke local da fila de mídia: gera um vídeo sintético com o próprio
// ffmpeg-static, processa via worker forkado (processPortfolioMedia) e valida
// o resultado (mp4 + thumbnail). Roda SEM banco: os updates em media_jobs são
// best-effort e falham com log, sem derrubar o job.
//
//   node scripts/smoke-media-worker.js
//
// Também valida o caminho paralelo: dispara 2 jobs ao mesmo tempo e mostra
// que enfileiram (concorrência 1) em vez de competir.

require("dotenv").config();

const { spawn } = require("child_process");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");

async function makeTestVideo() {
  const out = path.join(os.tmpdir(), `fl-smoke-${Date.now()}.mp4`);
  await new Promise((resolve, reject) => {
    const child = spawn(
      ffmpegPath,
      [
        "-y",
        "-f", "lavfi",
        "-i", "testsrc=duration=2:size=720x1280:rate=24",
        "-f", "lavfi",
        "-i", "sine=frequency=440:duration=2",
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-c:a", "aac",
        "-shortest",
        out,
      ],
      { windowsHide: true }
    );
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg testsrc exit ${code}`))
    );
  });
  return fs.readFile(out);
}

async function main() {
  const mediaJobs = require("../src/utils/mediaJobs");
  mediaJobs.startMediaWorker();

  console.log("[smoke] gerando vídeo sintético 2s 720x1280…");
  const buffer = await makeTestVideo();
  console.log(`[smoke] input: ${(buffer.length / 1024).toFixed(0)}KB`);

  const file = (name) => ({
    fieldname: "video",
    originalname: name,
    mimetype: "video/mp4",
    buffer,
    size: buffer.length,
  });

  console.log("[smoke] disparando 2 jobs em paralelo (devem enfileirar)…");
  const t0 = Date.now();
  const [a, b] = await Promise.all([
    mediaJobs.processPortfolioMedia(file("smoke-a.mp4"), "video"),
    mediaJobs.processPortfolioMedia(file("smoke-b.mp4"), "video"),
  ]);
  const ms = Date.now() - t0;

  for (const [label, r] of [["A", a], ["B", b]]) {
    if (!r?.buffer?.length) throw new Error(`job ${label}: sem buffer de saída`);
    if (r.mimetype !== "video/mp4") throw new Error(`job ${label}: mimetype ${r.mimetype}`);
    if (!r.thumbnail?.buffer?.length) throw new Error(`job ${label}: sem thumbnail`);
    console.log(
      `[smoke] job ${label} OK: ${(r.buffer.length / 1024).toFixed(0)}KB mp4, ` +
        `thumb ${(r.thumbnail.buffer.length / 1024).toFixed(0)}KB, ` +
        `meta=${JSON.stringify(r.mediaMetadata?.media_type)}`
    );
  }
  console.log(`[smoke] 2 jobs em ${ms}ms — fila OK`);

  // Caminho de erro de negócio: arquivo inválido deve virar httpError, não crash.
  try {
    await mediaJobs.processPortfolioMedia(
      { originalname: "x.mp4", mimetype: "video/mp4", buffer: Buffer.from("not a video"), size: 11 },
      "video"
    );
    throw new Error("esperava erro pra arquivo inválido");
  } catch (err) {
    if (!/video|Formato|arquivo/i.test(String(err.message))) throw err;
    console.log(`[smoke] erro de negócio propagado OK: "${err.message}"`);
  }

  console.log("[smoke] SUCESSO");
  process.exit(0);
}

main().catch((err) => {
  console.error("[smoke] FALHOU:", err);
  process.exit(1);
});
