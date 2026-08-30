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

// ─── Orientacoes aceitas em POST (feed_kind='feed') ────────────────────────
// Retrato 4:5, quadrado 1:1 e paisagem 16:9 — as mesmas tres que o composer
// oferece no passo de corte. Regra: o lado CURTO da saida e sempre 1080, entao
// as tres tem a mesma "densidade" e o feed nunca recebe uma imagem menor que a
// outra so por ser deitada.
//
// Postar NUNCA recusa por proporcao: o que nao bate com nenhuma das tres e
// ENQUADRADO na mais proxima (crop centrado), igual ja acontecia com video.
// Recusar era o que quebrava as superficies sem editor de corte (vaquinha,
// mural da academia, upload direto do portfolio), onde o usuario escolhe o
// arquivo cru e nao tem como cortar antes de enviar.
const POST_ORIENTATIONS = [
  { id: "4:5", ratio: 4 / 5, width: 1080, height: 1350 },
  { id: "1:1", ratio: 1, width: 1080, height: 1080 },
  { id: "16:9", ratio: 16 / 9, width: 1920, height: 1080 },
];

// Distancia em escala log: 3:4 fica igualmente longe de 4:5 e de 1:1 medindo
// assim, o que casa com a percepcao. Em escala linear, ratios deitados (>1)
// dominariam a conta e quase tudo cairia em 16:9.
function pickPostOrientation(width, height) {
  if (!width || !height) return POST_ORIENTATIONS[0];
  const ratio = width / height;
  const exact = POST_ORIENTATIONS.find((o) => isAspectRatio(width, height, o.ratio));
  if (exact) return exact;
  // Empate acontece de verdade: 4:3 fica a MESMA distancia de 1:1 e de 16:9.
  // Nesses casos vence a orientacao que preserva o carater da foto — deitada
  // continua deitada — em vez da ordem em que a lista foi escrita.
  const ordered = ratio > 1 ? [...POST_ORIENTATIONS].reverse() : POST_ORIENTATIONS;
  let best = ordered[0];
  let bestDist = Infinity;
  for (const o of ordered) {
    const dist = Math.abs(Math.log(ratio / o.ratio));
    // Margem: um empate matematico (4:3) chega aqui com ruido de ponto
    // flutuante na 16a casa; sem ela o desempate pela ordem nao valeria nada.
    if (dist < bestDist - 1e-9) {
      bestDist = dist;
      best = o;
    }
  }
  return best;
}
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

// sharp.metadata() le o arquivo ORIGINAL: num JPG de celular com EXIF de
// rotacao (orientation 5..8) largura e altura vem trocadas em relacao ao que o
// .rotate() vai produzir. Sem isso, uma foto em pe seria classificada como
// paisagem e cortada em 16:9.
function orientedDimensions(metadata) {
  const width = metadata?.width || 0;
  const height = metadata?.height || 0;
  const swap = Number(metadata?.orientation) >= 5 && Number(metadata?.orientation) <= 8;
  return swap ? { width: height, height: width } : { width, height };
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

  // Enquadra na orientacao aceita mais proxima (4:5, 1:1 ou 16:9). Quando a
  // imagem ja chega em uma delas — o caso do composer, que exporta exatamente
  // nessas proporcoes — o "cover" so redimensiona e nada e cortado.
  const dims = orientedDimensions(metadata);
  const orientation = pickPostOrientation(dims.width, dims.height);

  const optimized = await compressSharpToMax(file.buffer, {
    outputWidth: orientation.width,
    outputHeight: orientation.height,
    resizeFit: "cover",
    maxSizeBytes: POST_IMAGE_MAX_BYTES,
    errorMessage: "A imagem do post precisa ter no maximo 3MB.",
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
      orientation: orientation.id,
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

// Le largura/altura do video a partir do stderr do ffmpeg — ffmpeg-static nao
// traz ffprobe, entao e o mesmo truque do getVideoDuration. Sem saber o
// enquadramento de origem so daria pra cortar todo video de post em 4:5 no
// escuro, que era exatamente o problema.
async function probeVideoDimensions(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegPath) { resolve(null); return; }
    const child = spawn(ffmpegPath, ["-i", filePath, "-f", "null", "-"], { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += c.toString();
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });
    child.on("error", () => resolve(null));
    child.on("close", () => {
      const line = stderr
        .split(/\r?\n/)
        .find((l) => /Stream #\d+:\d+.*Video:/.test(l));
      if (!line) { resolve(null); return; }
      // Exige 2+ digitos dos dois lados pra nao casar com codec tag tipo "0x1f".
      const m = line.match(/(?:^|[\s,])(\d{2,5})x(\d{2,5})(?:[\s,\]]|$)/);
      if (!m) { resolve(null); return; }
      let width = Number(m[1]);
      let height = Number(m[2]);
      // Video de celular guarda a rotacao em side data e o ffmpeg ja a aplica
      // no decode, entao em 90/270 o WxH do stream vem invertido.
      const rot = stderr.match(/rotation of (-?\d+(?:\.\d+)?) degrees/);
      if (rot && Math.abs(Number(rot[1])) % 180 === 90) {
        const swap = width; width = height; height = swap;
      }
      resolve(width > 0 && height > 0 ? { width, height } : null);
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
    // Vídeo de POST (options.aspect === "post"): mede o enquadramento de
    // origem, escolhe a orientação aceita mais próxima (4:5, 1:1 ou 16:9) e
    // corta centrado só o excedente. Antes isso era um crop 4:5 fixo, que
    // espremia qualquer vídeo deitado numa moldura em pé. Bees mantém o
    // pipeline antigo (escala preservando aspect; aspect vertical é validado
    // em outro lugar).
    let orientation = null;
    if (options.aspect === "post" || options.aspect === "4:5") {
      const probed = await probeVideoDimensions(inputPath);
      orientation = probed
        ? pickPostOrientation(probed.width, probed.height)
        : POST_ORIENTATIONS[0];
    }
    const filter = orientation
      ? [
          `crop=if(gt(a\\,${orientation.ratio})\\,trunc(ih*${orientation.ratio}/2)*2\\,iw)`,
          `:if(gt(a\\,${orientation.ratio})\\,ih\\,trunc(iw/${orientation.ratio}/2)*2)`,
          `,scale=${orientation.width}:${orientation.height}`,
        ].join("")
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

    // Sem isso a linha de midia do video nasce com width/height NULL e o feed
    // nao tem como saber em que orientacao desenhar o player.
    const outDimensions = orientation
      ? { width: orientation.width, height: orientation.height }
      : await probeVideoDimensions(outputPath);

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
        ...(outDimensions
          ? { width: outDimensions.width, height: outDimensions.height }
          : {}),
        ...(orientation ? { orientation: orientation.id } : {}),
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
    // feedKind='feed' → vídeo é enquadrado numa das 3 orientações de post
    // (4:5, 1:1, 16:9); 'bees' → mantém vertical.
    const aspect = options.feedKind === "feed" ? "post" : null;
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
  POST_ORIENTATIONS,
  pickPostOrientation,
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
