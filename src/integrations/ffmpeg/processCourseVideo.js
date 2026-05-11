// src/integrations/ffmpeg/processCourseVideo.js
//
// Slice 8 — pipeline ffmpeg síncrono para vídeo de aula:
//   1) salva o buffer original em /tmp
//   2) gera versão 4:5 padrão (1080x1350, fundo preto, libx264 + AAC)
//   3) extrai thumbnail JPG no segundo 1
//   4) lê duração do stderr da encoding pass
//   5) retorna buffers e duração; cleanup em try/finally
//
// Decisão registrada (memória): processamento síncrono no service.
// Cap de 100MB no multer + server.timeout=15min. Migrar para worker
// queue (BullMQ+Redis) se virar gargalo.

const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const ffmpegPath = require("ffmpeg-static");
const { createLogger } = require("../../utils/logger");

const log = createLogger("ffmpeg.processCourseVideo");

// 4:5 alvo. Resolução suficiente para o player do criador/aluno.
const TARGET_WIDTH = 1080;
const TARGET_HEIGHT = 1350;
const SCALE_PAD_FILTER =
  `scale=${TARGET_WIDTH}:${TARGET_HEIGHT}:force_original_aspect_ratio=decrease,` +
  `pad=${TARGET_WIDTH}:${TARGET_HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=black`;

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve({ stderr });
      const err = new Error(
        `ffmpeg saiu com código ${code}. stderr: ${stderr.slice(-1500)}`,
      );
      reject(err);
    });
  });
}

function parseDurationSeconds(stderr) {
  // Padrão: "Duration: 00:01:23.45"
  const m = stderr.match(/Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const seconds = parseFloat(m[3]);
  const total = hours * 3600 + minutes * 60 + seconds;
  return Number.isFinite(total) ? Math.round(total) : null;
}

function getFileExt(name = "") {
  const parts = String(name).split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

/**
 * @param {object} args
 * @param {Buffer} args.buffer — bytes do vídeo original (multer.file.buffer)
 * @param {string} args.originalName — para preservar extensão original
 * @returns {Promise<{ processedBuffer: Buffer, thumbnailBuffer: Buffer, durationSeconds: number | null }>}
 */
async function processCourseVideo({ buffer, originalName }) {
  const runId = crypto.randomUUID();
  const tmp = os.tmpdir();
  const inputExt = getFileExt(originalName) || "mp4";
  const inputPath = path.join(tmp, `course-input-${runId}.${inputExt}`);
  const processedPath = path.join(tmp, `course-processed-${runId}.mp4`);
  const thumbPath = path.join(tmp, `course-thumb-${runId}.jpg`);

  log.info("process.start", {
    input_bytes: buffer.length,
    input_ext: inputExt,
    run_id: runId,
  });

  try {
    await fs.writeFile(inputPath, buffer);

    // 1) Encoding pass — 4:5 com pad preto, libx264 fast/CRF 23, faststart.
    const encArgs = [
      "-y",
      "-i", inputPath,
      "-vf", SCALE_PAD_FILTER,
      "-c:v", "libx264",
      "-preset", "fast",
      "-crf", "23",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      processedPath,
    ];
    const enc = await runFfmpeg(encArgs);
    const durationSeconds = parseDurationSeconds(enc.stderr);

    // 2) Thumbnail — frame no segundo 1, com o mesmo pad 4:5.
    const thumbArgs = [
      "-y",
      "-ss", "00:00:01",
      "-i", inputPath,
      "-frames:v", "1",
      "-vf", SCALE_PAD_FILTER,
      "-q:v", "3",
      thumbPath,
    ];
    try {
      await runFfmpeg(thumbArgs);
    } catch (err) {
      // Vídeo pode ter <1s — tenta com o primeiro frame.
      log.warn("thumb.retry_first_frame", { message: err.message });
      const fallbackArgs = [
        "-y",
        "-i", inputPath,
        "-frames:v", "1",
        "-vf", SCALE_PAD_FILTER,
        "-q:v", "3",
        thumbPath,
      ];
      await runFfmpeg(fallbackArgs);
    }

    const [processedBuffer, thumbnailBuffer] = await Promise.all([
      fs.readFile(processedPath),
      fs.readFile(thumbPath),
    ]);

    log.info("process.ok", {
      run_id: runId,
      processed_bytes: processedBuffer.length,
      thumb_bytes: thumbnailBuffer.length,
      duration_seconds: durationSeconds,
    });

    return { processedBuffer, thumbnailBuffer, durationSeconds };
  } finally {
    // Cleanup — não falha se algum arquivo não existir.
    await Promise.all(
      [inputPath, processedPath, thumbPath].map((p) =>
        fs.unlink(p).catch(() => {}),
      ),
    );
  }
}

module.exports = processCourseVideo;
