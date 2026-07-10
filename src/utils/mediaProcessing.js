const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");

const MB = 1024 * 1024;

const POST_IMAGE_RATIO = 4 / 5;
const CURTO_IMAGE_RATIO = 9 / 16;
const RATIO_TOLERANCE = 0.01;
const POST_IMAGE_MAX_BYTES = 3 * MB;
const AVATAR_IMAGE_MAX_BYTES = 2 * MB;
const MAX_IMAGE_INPUT_BYTES = 30 * MB;
const MAX_VIDEO_INPUT_BYTES = 100 * MB;
const MAX_VIDEO_OUTPUT_BYTES = 50 * MB;
const MIN_IMAGE_DIMENSION = 320;
const VIDEO_THUMB_MAX_WIDTH = 720;
const VIDEO_THUMB_QUALITY = 75;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);
const AUDIO_MIME_TYPES = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/m4a",
  "audio/aac",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
]);

const MAX_AUDIO_INPUT_BYTES = 5 * MB;
const MAX_AUDIO_DURATION_SECONDS = 120;
const AUDIO_TARGET_BITRATE_BPS = 24000; // 24 kbps

function httpError(message, statusCode = 400) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

async function detectFileType(buffer) {
  const { fileTypeFromBuffer } = await import("file-type");
  return fileTypeFromBuffer(buffer);
}

function isAspectRatio(width, height, targetRatio, tolerance = RATIO_TOLERANCE) {
  if (!width || !height) return false;
  return Math.abs(width / height - targetRatio) <= tolerance;
}

function assertUsableDimensions(metadata, label = "imagem") {
  if (!metadata?.width || !metadata?.height) {
    throw httpError("Nao foi possivel ler as dimensoes da imagem. Tente outro arquivo.");
  }
  if (metadata.width < MIN_IMAGE_DIMENSION || metadata.height < MIN_IMAGE_DIMENSION) {
    throw httpError(`Essa ${label} precisa ter pelo menos ${MIN_IMAGE_DIMENSION}px de largura e altura.`);
  }
}

function extForMime(mimeType) {
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "video/mp4") return "mp4";
  return "bin";
}

function outputName(originalName, mimeType) {
  const base = String(originalName || "media")
    .replace(/\.[^.]+$/, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .slice(0, 80) || "media";

  return `${base}-${crypto.randomUUID()}.${extForMime(mimeType)}`;
}

function buildProcessedFile(file, buffer, mimetype, originalname, metadata = {}) {
  return {
    ...file,
    buffer,
    mimetype,
    originalname,
    size: buffer.length,
    mediaMetadata: {
      original_filename: file.originalname,
      mime_type: mimetype,
      size_bytes: buffer.length,
      ...metadata,
    },
  };
}

async function assertRealImage(file) {
  if (!file?.buffer?.length) {
    throw httpError("Arquivo nao enviado");
  }
  if (file.buffer.length > MAX_IMAGE_INPUT_BYTES) {
    throw httpError("Essa imagem e muito grande para otimizar. Tente outra imagem.");
  }

  const detected = await detectFileType(file.buffer);
  if (!detected || !IMAGE_MIME_TYPES.has(detected.mime)) {
    throw httpError("Formato nao aceito. Envie JPG, PNG ou WebP.");
  }

  return detected.mime;
}

async function compressSharpToMax(input, options) {
  const {
    outputWidth,
    outputHeight,
    resizeFit,
    maxSizeBytes,
    errorMessage,
  } = options;

  const scales = [1, 0.9, 0.8, 0.7, 0.6, 0.55];
  const qualities = [82, 76, 70, 64, 58, 52];

  for (const scale of scales) {
    const width = Math.max(320, Math.round(outputWidth * scale));
    const height = outputHeight ? Math.max(320, Math.round(outputHeight * scale)) : undefined;

    for (const quality of qualities) {
      const pipeline = sharp(input, { failOn: "error" })
        .rotate()
        .resize({
          width,
          height,
          fit: resizeFit,
          withoutEnlargement: false,
        })
        .webp({ quality, effort: 4 });

      const buffer = await pipeline.toBuffer();
      if (buffer.length <= maxSizeBytes) {
        const metadata = await sharp(buffer).metadata();
        return {
          buffer,
          width: metadata.width,
          height: metadata.height,
        };
      }
    }
  }

  throw httpError(errorMessage);
}

async function processPostImage(file) {
  await assertRealImage(file);

  let metadata;
  try {
    metadata = await sharp(file.buffer, { failOn: "error" }).rotate().metadata();
  } catch {
    throw httpError("Nao foi possivel ler essa imagem. Tente outro arquivo.");
  }

  assertUsableDimensions(metadata, "imagem do post");

  if (!isAspectRatio(metadata.width, metadata.height, POST_IMAGE_RATIO)) {
    throw httpError("Essa imagem precisa ser cortada no formato 4:5 para aparecer no feed.");
  }

  const optimized = await compressSharpToMax(file.buffer, {
    outputWidth: 1080,
    outputHeight: 1350,
    resizeFit: "cover",
    maxSizeBytes: POST_IMAGE_MAX_BYTES,
    errorMessage: "A imagem do post precisa ter no maximo 3MB.",
  });

  if (!isAspectRatio(optimized.width, optimized.height, POST_IMAGE_RATIO)) {
    throw httpError("Essa imagem precisa ser cortada no formato 4:5 para aparecer no feed.");
  }

  return buildProcessedFile(
    file,
    optimized.buffer,
    "image/webp",
    outputName(file.originalname, "image/webp"),
    {
      media_type: "image",
      width: optimized.width,
      height: optimized.height,
    }
  );
}

// Imagem de Curto (feed_kind='bees'): aceita 9:16 (nativo da grade vertical)
// OU 4:5 (mesmo formato do feed). O feed segue 4:5 estrito (processPostImage).
async function processCurtoImage(file) {
  await assertRealImage(file);

  let metadata;
  try {
    metadata = await sharp(file.buffer, { failOn: "error" }).rotate().metadata();
  } catch {
    throw httpError("Nao foi possivel ler essa imagem. Tente outro arquivo.");
  }

  assertUsableDimensions(metadata, "imagem do Curto");

  const isVertical = isAspectRatio(metadata.width, metadata.height, CURTO_IMAGE_RATIO);
  const isFourFive = isAspectRatio(metadata.width, metadata.height, POST_IMAGE_RATIO);
  if (!isVertical && !isFourFive) {
    throw httpError("Essa imagem precisa estar em 9:16 ou 4:5 para virar um Curto.");
  }

  const optimized = await compressSharpToMax(file.buffer, {
    outputWidth: 1080,
    outputHeight: isVertical ? 1920 : 1350,
    resizeFit: "cover",
    maxSizeBytes: POST_IMAGE_MAX_BYTES,
    errorMessage: "A imagem do Curto precisa ter no maximo 3MB.",
  });

  return buildProcessedFile(
    file,
    optimized.buffer,
    "image/webp",
    outputName(file.originalname, "image/webp"),
    {
      media_type: "image",
      width: optimized.width,
      height: optimized.height,
    }
  );
}

async function processAvatarImage(file) {
  await assertRealImage(file);

  let metadata;
  try {
    metadata = await sharp(file.buffer, { failOn: "error" }).rotate().metadata();
  } catch {
    throw httpError("Nao foi possivel ler essa imagem. Tente outro arquivo.");
  }

  assertUsableDimensions(metadata, "foto de perfil");

  const optimized = await compressSharpToMax(file.buffer, {
    outputWidth: 800,
    outputHeight: 800,
    resizeFit: "cover",
    maxSizeBytes: AVATAR_IMAGE_MAX_BYTES,
    errorMessage: "A foto de perfil precisa ter no maximo 2MB.",
  });

  return buildProcessedFile(
    file,
    optimized.buffer,
    "image/webp",
    outputName(file.originalname, "image/webp"),
    {
      media_type: "image",
      width: optimized.width,
      height: optimized.height,
    }
  );
}

async function assertRealVideo(file) {
  if (!file?.buffer?.length) {
    throw httpError("Arquivo nao enviado");
  }
  if (file.buffer.length > MAX_VIDEO_INPUT_BYTES) {
    throw httpError("O video precisa ter no maximo 100MB.");
  }

  const detected = await detectFileType(file.buffer);
  if (!detected || !VIDEO_MIME_TYPES.has(detected.mime)) {
    throw httpError("Formato de video nao aceito. Envie MP4 ou WebM.");
  }
}

function runFfmpeg(args, timeoutMs = 180000) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) {
      reject(httpError("ffmpeg nao esta disponivel no servidor.", 500));
      return;
    }

    const child = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(httpError("A compressao do video demorou demais. Tente um arquivo menor."));
    }, timeoutMs);

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 6000) stderr = stderr.slice(-6000);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(httpError(`Nao foi possivel otimizar esse video. ${stderr}`.trim()));
    });
  });
}

async function extractVideoThumbnail(videoPath, tempDir) {
  const framePath = path.join(tempDir, `thumb-${crypto.randomUUID()}.png`);

  try {
    await runFfmpeg(
      [
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        videoPath,
        "-frames:v",
        "1",
        "-vf",
        "thumbnail",
        "-q:v",
        "2",
        framePath,
      ],
      30000
    );
  } catch {
    // Vídeo curto demais ou frame único — tenta a partir do primeiro frame.
    try {
      await runFfmpeg(
        [
          "-y",
          "-i",
          videoPath,
          "-frames:v",
          "1",
          "-vf",
          "thumbnail",
          "-q:v",
          "2",
          framePath,
        ],
        30000
      );
    } catch {
      return null;
    }
  }

  let raw;
  try {
    raw = await fs.readFile(framePath);
  } catch {
    return null;
  }

  const optimized = await sharp(raw)
    .resize({
      width: VIDEO_THUMB_MAX_WIDTH,
      withoutEnlargement: true,
    })
    .webp({ quality: VIDEO_THUMB_QUALITY, effort: 4 })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: optimized.data,
    mimetype: "image/webp",
    width: optimized.info.width,
    height: optimized.info.height,
  };
}

async function processVideo(file, options = {}) {
  await assertRealVideo(file);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "freelandoo-media-"));
  const inputPath = path.join(tempDir, `input-${crypto.randomUUID()}`);
  const outputPath = path.join(tempDir, "output.mp4");

  try {
    await fs.writeFile(inputPath, file.buffer);
    // Quando o vídeo é destinado ao feed clássico (4:5), forçamos crop centrado
    // para 1080x1350 — independente do aspect ratio original. Bees mantém o
    // pipeline antigo (escala preservando aspect; aspect vertical é validado em outro lugar).
    const force45 = options.aspect === "4:5";
    const filter = force45
      ? "crop=if(gt(a\\,0.8)\\,trunc(ih*4/5/2)*2\\,iw):if(gt(a\\,0.8)\\,ih\\,trunc(iw*5/4/2)*2),scale=1080:1350"
      : "scale=if(gt(a\\,0.8)\\,trunc(min(iw\\,1080)/2)*2\\,-2):if(gt(a\\,0.8)\\,-2\\,trunc(min(ih\\,1350)/2)*2)";

    await runFfmpeg([
      "-y",
      "-i",
      inputPath,
      "-map_metadata",
      "-1",
      "-vf",
      filter,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "28",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      outputPath,
    ]);

    const buffer = await fs.readFile(outputPath);
    if (buffer.length > MAX_VIDEO_OUTPUT_BYTES) {
      throw httpError("O video otimizado ficou grande demais. Tente um arquivo menor.");
    }

    let thumbnail = null;
    try {
      thumbnail = await extractVideoThumbnail(outputPath, tempDir);
    } catch {
      thumbnail = null;
    }

    const processed = buildProcessedFile(
      file,
      buffer,
      "video/mp4",
      outputName(file.originalname, "video/mp4"),
      {
        media_type: "video",
        ...(thumbnail
          ? {
              thumbnail_width: thumbnail.width,
              thumbnail_height: thumbnail.height,
            }
          : {}),
      }
    );

    if (thumbnail) {
      processed.thumbnail = {
        buffer: thumbnail.buffer,
        mimetype: thumbnail.mimetype,
        originalname: outputName(file.originalname, "image/webp"),
        size: thumbnail.buffer.length,
        width: thumbnail.width,
        height: thumbnail.height,
      };
    }

    return processed;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processPortfolioMedia(file, mediaType, options = {}) {
  // Curtos (feed_kind='bees') aceitam imagem 9:16 além de 4:5; feed é 4:5 estrito.
  if (mediaType === "image") {
    return options.feedKind === "bees" ? processCurtoImage(file) : processPostImage(file);
  }
  if (mediaType === "video") {
    // feedKind='feed' → vídeo é cropado pra 4:5; 'bees' → mantém vertical.
    const aspect = options.feedKind === "feed" ? "4:5" : null;
    return processVideo(file, aspect ? { aspect } : {});
  }
  throw httpError("Tipo de arquivo nao permitido");
}

/**
 * Lê a duração de um arquivo de vídeo (em segundos) usando ffmpeg.
 * Faz parse do stderr porque ffmpeg-static não vem com ffprobe.
 */
async function getVideoDuration(filePath) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) { reject(httpError("ffmpeg nao disponivel.", 500)); return; }
    const child = spawn(ffmpegPath, ["-i", filePath, "-f", "null", "-"], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (c) => { stderr += c.toString(); if (stderr.length > 8000) stderr = stderr.slice(-8000); });
    child.on("error", reject);
    child.on("close", () => {
      const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
      if (!m) { reject(httpError("Nao foi possivel ler a duracao do video.")); return; }
      const seconds = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      resolve(seconds);
    });
  });
}

/**
 * Divide um vídeo em chunks de até `chunkSeconds` segundos sem re-encode
 * (-c copy → rápido). Retorna array de { buffer, index, duration, originalname }.
 * Se a duração total for <= chunkSeconds, retorna [file] sem modificar.
 */
async function splitVideoIntoChunks(file, chunkSeconds = 60) {
  await assertRealVideo(file);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "freelandoo-split-"));
  const inputPath = path.join(tempDir, `input-${crypto.randomUUID()}`);
  try {
    await fs.writeFile(inputPath, file.buffer);
    const totalDuration = await getVideoDuration(inputPath);
    if (totalDuration <= chunkSeconds + 0.5) {
      return [{ buffer: file.buffer, index: 0, duration: totalDuration, originalname: file.originalname }];
    }
    const chunks = [];
    const count = Math.ceil(totalDuration / chunkSeconds);
    for (let i = 0; i < count; i++) {
      const start = i * chunkSeconds;
      const remaining = Math.min(chunkSeconds, totalDuration - start);
      if (remaining < 0.5) break;
      const outPath = path.join(tempDir, `chunk-${i}.mp4`);
      await runFfmpeg([
        "-y",
        "-ss", String(start),
        "-i", inputPath,
        "-t", String(remaining),
        "-c", "copy",
        "-movflags", "+faststart",
        outPath,
      ], 60000);
      const buffer = await fs.readFile(outPath);
      const baseName = (file.originalname || "video.mp4").replace(/\.[^.]+$/, "");
      chunks.push({
        buffer,
        index: i,
        duration: remaining,
        originalname: `${baseName}-parte-${i + 1}.mp4`,
      });
    }
    return chunks;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function assertRealAudio(file) {
  if (!file?.buffer?.length) throw httpError("Arquivo nao enviado");
  if (file.buffer.length > MAX_AUDIO_INPUT_BYTES) {
    throw httpError("O audio precisa ter no maximo 5MB.");
  }

  const detected = await detectFileType(file.buffer);
  // file-type detecta "audio/webm" como video/webm em alguns casos (container webm
  // não distingue). Aceitamos audio/* OU video/webm explicitamente — o ffmpeg
  // valida o stream de áudio na prática.
  const mime = (detected?.mime || "").toLowerCase();
  const ok = AUDIO_MIME_TYPES.has(mime) || mime === "video/webm" || mime === "video/ogg";
  if (!ok) {
    throw httpError("Formato de audio nao aceito.");
  }
  return mime;
}

/**
 * Recomprime áudio para WebM/Opus mono @ 24kbps. Se libopus não estiver
 * disponível no ffmpeg-static do servidor, faz fallback para AAC/M4A.
 *
 * Retorna { buffer, mimetype, extension, codec, bitrate, duration }.
 */
async function processConversationAudio(file) {
  await assertRealAudio(file);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "freelandoo-audio-"));
  const inputPath = path.join(tempDir, `input-${crypto.randomUUID()}`);
  const opusOutPath = path.join(tempDir, "out.webm");
  const aacOutPath = path.join(tempDir, "out.m4a");

  try {
    await fs.writeFile(inputPath, file.buffer);

    let duration = 0;
    try {
      duration = await getVideoDuration(inputPath); // ffmpeg lê Duration de áudio também
    } catch {
      duration = 0;
    }
    if (duration > MAX_AUDIO_DURATION_SECONDS + 1) {
      throw httpError(`O audio precisa ter no maximo ${MAX_AUDIO_DURATION_SECONDS} segundos.`);
    }

    // Tenta Opus/WebM primeiro
    let outputPath = opusOutPath;
    let mimetype = "audio/webm";
    let extension = "webm";
    let codec = "opus";
    let bitrate = AUDIO_TARGET_BITRATE_BPS;
    let usedFallback = false;

    try {
      await runFfmpeg(
        [
          "-y",
          "-i",
          inputPath,
          "-map_metadata",
          "-1",
          "-vn",
          "-ac",
          "1",
          "-ar",
          "16000",
          "-c:a",
          "libopus",
          "-b:a",
          "24k",
          "-application",
          "voip",
          opusOutPath,
        ],
        60000
      );
    } catch (err) {
      // libopus indisponível — fallback AAC/M4A 32k mono
      usedFallback = true;
      try {
        await runFfmpeg(
          [
            "-y",
            "-i",
            inputPath,
            "-map_metadata",
            "-1",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "aac",
            "-b:a",
            "32k",
            "-movflags",
            "+faststart",
            aacOutPath,
          ],
          60000
        );
        outputPath = aacOutPath;
        mimetype = "audio/mp4";
        extension = "m4a";
        codec = "aac";
        bitrate = 32000;
      } catch (innerErr) {
        throw httpError(`Nao foi possivel comprimir o audio. ${innerErr?.message || err?.message || ""}`.trim());
      }
    }

    const buffer = await fs.readFile(outputPath);
    if (!buffer.length) throw httpError("Saida vazia ao comprimir o audio.");
    if (buffer.length > MAX_AUDIO_INPUT_BYTES) {
      throw httpError("O audio otimizado ficou grande demais.");
    }

    return {
      buffer,
      mimetype,
      extension,
      codec,
      bitrate,
      duration: Math.max(1, Math.round(duration)),
      fallback: usedFallback,
    };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processUserMedia(file) {
  const mt = (file?.mimetype || "").toLowerCase();
  if (mt.startsWith("image/")) return processPostImage(file);
  if (mt.startsWith("video/")) return processVideo(file);
  throw httpError("Tipo de arquivo nao permitido");
}

/**
 * Comprime um vídeo já em disco (ferramenta /comprimir). Diferente de
 * processVideo, NÃO corta aspect ratio nem opera em buffer — só reduz peso
 * preservando o enquadramento (downscale do lado maior pra até `maxLongSide`).
 * Trabalha de arquivo→arquivo: o vídeo grande é baixado do R2 pro disco e o
 * ffmpeg roda num processo separado, então a memória do Node não segura os
 * bytes do vídeo. Retorna o caminho de saída + tamanho.
 *
 * Faz um 2º passe mais agressivo se a 1ª saída ainda passar de `targetBytes`.
 */
async function compressVideoFile(inputPath, outDir, options = {}) {
  const maxLongSide = options.maxLongSide || 1280;
  const targetBytes = options.targetBytes || 80 * MB;

  async function encode(outPath, crf, longSide) {
    // scale: limita o lado maior a `longSide` sem nunca ampliar (min() vs dims
    // originais) e força dimensões pares (force_divisible_by=2 — exigência do x264).
    const filter =
      `scale=min(${longSide}\\,iw):min(${longSide}\\,ih)` +
      `:force_original_aspect_ratio=decrease:force_divisible_by=2`;
    await runFfmpeg(
      [
        "-y",
        "-i",
        inputPath,
        "-map_metadata",
        "-1",
        "-vf",
        filter,
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        String(crf),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        outPath,
      ],
      9 * 60 * 1000
    );
  }

  const firstPath = path.join(outDir, "output.mp4");
  await encode(firstPath, 28, maxLongSide);
  let outputPath = firstPath;
  let size = (await fs.stat(firstPath)).size;

  if (size > targetBytes) {
    // Ainda grande — 2º passe com mais compressão e resolução menor.
    const secondPath = path.join(outDir, "output-2.mp4");
    try {
      await encode(secondPath, 32, Math.min(maxLongSide, 960));
      const secondSize = (await fs.stat(secondPath)).size;
      if (secondSize < size) {
        await fs.rm(firstPath, { force: true }).catch(() => {});
        outputPath = secondPath;
        size = secondSize;
      }
    } catch {
      // mantém a 1ª saída se o 2º passe falhar
    }
  }

  return { outputPath, size };
}

module.exports = {
  POST_IMAGE_MAX_BYTES,
  AVATAR_IMAGE_MAX_BYTES,
  MAX_VIDEO_INPUT_BYTES,
  MAX_AUDIO_INPUT_BYTES,
  MAX_AUDIO_DURATION_SECONDS,
  AUDIO_TARGET_BITRATE_BPS,
  processAvatarImage,
  processPortfolioMedia,
  processPostImage,
  processUserMedia,
  processVideo,
  processConversationAudio,
  getVideoDuration,
  splitVideoIntoChunks,
  compressVideoFile,
};
