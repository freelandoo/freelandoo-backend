const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");
const { buildCubeLut } = require("./composerLut");

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

// ⚠️ O upload de portfólio passou a chegar em DISCO (multer diskStorage), para
// que o arquivo original do celular — que pode passar de 200MB num 4K — nunca
// entre no heap do Node. Os processadores de sempre trabalham sobre Buffer,
// então quem NÃO vai pelo caminho de composição lê o arquivo aqui, num lugar
// só: espalhado pelos services, o caller que esquecesse receberia
// `file.buffer === undefined` e falharia com "Arquivo nao enviado", que é a
// mensagem errada para o problema certo.
/**
 * Veio arquivo nesta requisição?
 *
 * ⚠️ PERGUNTE ISTO, NUNCA `file.buffer`. Desde que o upload de portfólio
 * passou a chegar em DISCO (multer diskStorage, para o 4K do celular não
 * entrar no heap), o multer entrega `file.path` e `file.size` e o `buffer`
 * só aparece DEPOIS que alguém lê o arquivo — o que `processPortfolioMedia`
 * faz lá dentro. Um guard escrito como `if (!file.buffer)` recusa ANTES
 * disso e responde "Arquivo não enviado" com o arquivo ali, em disco.
 *
 * Foi exatamente o que aconteceu com as fotos de serviço, de produto, da
 * vaquinha e do mural da academia: os quatro ficaram para trás quando o
 * middleware virou disco, e o sintoma é uma recusa que culpa o usuário.
 */
function hasUpload(file) {
  return !!(file && (file.buffer?.length || file.path));
}

async function ensureFileBuffer(file) {
  if (!file || file.buffer || !file.path) return file;
  file.buffer = await fs.readFile(file.path);
  return file;
}
async function processPortfolioMedia(file, mediaType, options = {}) {
  await ensureFileBuffer(file);
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
  // A porta de story também passou a receber o arquivo em DISCO; sem isto o
  // assertRealVideo abaixo recusaria com "Arquivo nao enviado", que é a
  // mensagem errada para o problema certo.
  await ensureFileBuffer(file);
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
  await ensureFileBuffer(file);
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

// ─────────────────────────────────────────────────────────────────────────────
// COMPOSIÇÃO DE VÍDEO NO SERVIDOR
//
// O celular deixa de re-codificar: ele manda o ARQUIVO ORIGINAL mais os
// parâmetros de corte/cor e um PNG transparente com o que foi desenhado por
// cima (texto, vinheta, sobreposição de imagem). Aqui tudo vira UM passe de
// ffmpeg — corte → escala → cor → grão → sobreposição → H.264.
//
// ⚠️ POR QUE ISTO EXISTE: o caminho antigo codificava DUAS vezes (uma no
// aparelho, via canvas + WebCodecs/MediaRecorder, e outra aqui). A primeira já
// jogava qualidade fora, travava a linha do tempo no iOS (buraco preto, quadro
// congelado) e dependia de um encoder de navegador que o Safari implementa mal.
// Passando o original, nenhum aparelho codifica nada e o resultado sai ao mesmo
// tempo MELHOR e MENOR que o de antes.
//
// ⚠️ O ENQUADRAMENTO USA A MESMA CONTA DO PREVIEW (`uvWindow`, em
// lib/composer/renderer.ts no front). Ela precisa continuar idêntica nos dois
// lados: o que a pessoa vê no editor é o que sai publicado, e uma segunda régua
// aqui faria o vídeo sair deslocado do que ela enquadrou com o dedo.
const MAX_COMPOSE_SECONDS = 70;
const COMPOSE_SHORT_SIDE = 1080; // 4K, 1440p e 1080p descem todos para cá.

function evenDown(n) {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r - 1;
}

/** Espelho de `outSize` do front: `base` é o LADO CURTO, não a largura. */
function composeOutputSize(aspect, base = COMPOSE_SHORT_SIDE) {
  const short = evenDown(base);
  const w = aspect >= 1 ? evenDown(base * aspect) : short;
  const h = aspect >= 1 ? short : evenDown(base / aspect);
  return { w: Math.max(2, w), h: Math.max(2, h) };
}

/** Espelho de `uvWindow`: devolve o retângulo visível em PIXELS da fonte. */
function composeCropRect(srcW, srcH, aspect, zoom, panX, panY) {
  const sa = srcW / srcH || 1;
  const ta = aspect;
  let sx = 1;
  let sy = 1;
  if (sa > ta) sx = ta / sa;
  else sy = sa / ta;
  const z = Math.max(1, Number(zoom) || 1);
  sx /= z;
  sy /= z;
  const px = Math.max(-1, Math.min(1, Number(panX) || 0));
  const py = Math.max(-1, Math.min(1, Number(panY) || 0));
  const w = Math.max(2, Math.min(evenDown(sx * srcW), evenDown(srcW)));
  const h = Math.max(2, Math.min(evenDown(sy * srcH), evenDown(srcH)));
  // ⚠️ O deslocamento sai da largura JÁ ARREDONDADA, e não da fração crua. Com
  // a conta sobre `srcW` direto, pan +1 parava 1px antes da borda — a largura
  // tinha sido arredondada para baixo e o offset não acompanhava —, e sobrava
  // na tela uma faixa que a pessoa havia empurrado para fora com o dedo.
  // Com `(srcW - w)` os dois extremos encostam de verdade e pan 0 segue
  // centrado, que é a mesma coisa que `mx/2` dizia.
  const x = Math.max(0, Math.min(Math.round(((1 + px) / 2) * (srcW - w)), srcW - w));
  const y = Math.max(0, Math.min(Math.round(((1 + py) / 2) * (srcH - h)), srcH - h));
  return { w, h, x, y };
}

/** Escapa um caminho para uso DENTRO de um argumento de filtro do ffmpeg. */
function escapeFilterPath(p) {
  return String(p).replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

/**
 * Compõe o vídeo final a partir do arquivo ORIGINAL em disco.
 *
 * @param {string} inputPath  arquivo do celular, cru — nunca passa pela memória do Node
 * @param {object} params
 *   - aspect, zoom, panX, panY : enquadramento (mesma semântica do editor)
 *   - filter                   : FilterState do composer (vira LUT 3D)
 *   - overlayPath              : PNG RGBA no tamanho do alvo (texto/vinheta/PiP-imagem)
 *   - pipPath                  : vídeo de sobreposição (opcional)
 *   - pip                      : { x, y, scale } — centro em 0..1, largura relativa
 *   - originalname             : nome do arquivo, só para nomear a saída
 */
async function composeVideoFromFile(inputPath, params = {}) {
  const aspect = Number(params.aspect) > 0 ? Number(params.aspect) : 9 / 16;
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "freelandoo-compose-"));
  const outputPath = path.join(tempDir, "output.mp4");

  try {
    const probed = await probeVideoDimensions(inputPath);
    if (!probed) {
      throw httpError("Nao foi possivel ler este video. Tente outro arquivo.");
    }

    let duration = 0;
    try {
      duration = await getVideoDuration(inputPath);
    } catch {
      duration = 0;
    }
    // ⚠️ O TETO É POR SUPERFÍCIE, e não uma constante só. `tb_story` tem
    // `CHECK (duration_seconds <= 60)`: um story de 70s passaria por todo o
    // upload e todo o encode para só então bater na constraint do banco — a
    // falha mais cara possível. Cortar aqui faz o ARQUIVO e o número gravado
    // dizerem a mesma coisa.
    const cap = Math.max(1, Math.min(MAX_COMPOSE_SECONDS, Number(params.maxSeconds) || MAX_COMPOSE_SECONDS));
    const seconds =
      Number.isFinite(duration) && duration > 0 ? Math.min(cap, duration) : cap;

    const crop = composeCropRect(
      probed.width,
      probed.height,
      aspect,
      params.zoom,
      params.panX,
      params.panY
    );
    const target = composeOutputSize(aspect);
    // ⚠️ NUNCA AMPLIA: um vídeo de 720p enquadrado em 9:16 rende ~405x720, e
    // esticá-lo até 1080x1920 só acrescentaria bytes, nunca detalhe. Depois do
    // corte a proporção já é exata, então basta reduzir na mesma escala nos
    // dois eixos.
    const scale = Math.min(1, crop.w / target.w);
    const outW = Math.max(2, evenDown(target.w * scale));
    const outH = Math.max(2, evenDown(target.h * scale));

    // ─── grafo de filtros ──────────────────────────────────────────────────
    const inputs = ["-i", inputPath];
    const chain = [
      `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`,
      `scale=${outW}:${outH}:flags=lanczos`,
    ];

    const cube = buildCubeLut(params.filter);
    if (cube) {
      const lutPath = path.join(tempDir, "grade.cube");
      await fs.writeFile(lutPath, cube, "utf8");
      chain.push(`lut3d='${escapeFilterPath(lutPath)}'`);
    }

    // Grão: precisa mudar a cada quadro — assado num PNG viraria sujeira parada
    // na lente. É o único item da cadeia de cor que não cabe na LUT.
    const grain = Math.max(0, Math.min(1, Number(params.filter?.grain) || 0));
    if (grain > 0.001) {
      chain.push(`noise=alls=${Math.max(1, Math.round(grain * 100))}:allf=t+u`);
    }

    const parts = [`[0:v]${chain.join(",")}[base]`];
    let cur = "base";

    if (params.pipPath) {
      inputs.push("-i", params.pipPath);
      const idx = inputs.length / 2 - 1;
      const pip = params.pip || {};
      // ⚠️ `?? 0.5` NÃO pega NaN (só null/undefined), e `Number("abc")` é NaN:
      // sem `finiteOr`, um valor torto viraria `main_w*NaN` no grafo de
      // filtros e o ffmpeg falharia falando de sintaxe de filtro em vez do
      // pedido. Quem vem pela porta HTTP já passou por utils/composeParams;
      // isto protege quem chamar a função direto.
      const finiteOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      const pipScale = Math.max(0.05, Math.min(1, finiteOr(pip.scale, 0.4)));
      const px = Math.max(0, Math.min(1, finiteOr(pip.x, 0.5))).toFixed(4);
      const py = Math.max(0, Math.min(1, finiteOr(pip.y, 0.5))).toFixed(4);
      parts.push(`[${idx}:v]scale=${evenDown(outW * pipScale)}:-2[pip]`);
      // `eof_action=pass`: a sobreposição pode ser mais curta que o vídeo
      // principal — sem isso o resultado terminaria junto com ela.
      parts.push(
        `[${cur}][pip]overlay=x=main_w*${px}-overlay_w/2:y=main_h*${py}-overlay_h/2:eof_action=pass:shortest=0[withpip]`
      );
      cur = "withpip";
    }

    if (params.overlayPath) {
      inputs.push("-i", params.overlayPath);
      const idx = inputs.length / 2 - 1;
      // O PNG é rasterizado no tamanho-alvo pelo cliente; se a saída encolheu
      // (fonte menor que 1080), a escala aqui o acompanha.
      parts.push(`[${idx}:v]scale=${outW}:${outH}[ov]`);
      parts.push(`[${cur}][ov]overlay=0:0:format=auto[withov]`);
      cur = "withov";
    }

    parts.push(`[${cur}]format=yuv420p[v]`);
    const filterComplex = parts.join(";");

    async function encode(outPath, crf) {
      await runFfmpeg(
        [
          "-y",
          ...inputs,
          "-t",
          String(seconds),
          "-map_metadata",
          "-1",
          "-filter_complex",
          filterComplex,
          "-map",
          "[v]",
          // O áudio do original é PRESERVADO. O caminho antigo o perdia (o
          // canvas não carrega som), e Curto mudo é Curto quebrado. O `?` torna
          // o mapeamento opcional: vídeo sem trilha não falha.
          "-map",
          "0:a:0?",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          String(crf),
          "-profile:v",
          "high",
          "-level",
          "4.1",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-ac",
          "2",
          "-ar",
          "48000",
          "-movflags",
          "+faststart",
          outPath,
        ],
        9 * 60 * 1000
      );
    }

    await encode(outputPath, 23);
    let finalPath = outputPath;
    let size = (await fs.stat(outputPath)).size;

    if (size > MAX_VIDEO_OUTPUT_BYTES) {
      const secondPath = path.join(tempDir, "output-2.mp4");
      try {
        await encode(secondPath, 28);
        const secondSize = (await fs.stat(secondPath)).size;
        if (secondSize < size) {
          finalPath = secondPath;
          size = secondSize;
        }
      } catch {
        /* mantém a 1ª saída */
      }
    }
    if (size > MAX_VIDEO_OUTPUT_BYTES) {
      throw httpError(
        "O video ficou grande demais mesmo depois de comprimido. Tente um trecho mais curto."
      );
    }

    const buffer = await fs.readFile(finalPath);

    let thumbnail = null;
    try {
      thumbnail = await extractVideoThumbnail(finalPath, tempDir);
    } catch {
      thumbnail = null;
    }

    const baseFile = {
      originalname: params.originalname || "video.mp4",
      mimetype: "video/mp4",
    };
    const processed = buildProcessedFile(
      baseFile,
      buffer,
      "video/mp4",
      outputName(baseFile.originalname, "video/mp4"),
      {
        media_type: "video",
        width: outW,
        height: outH,
        duration_seconds: Math.max(1, Math.round(seconds)),
        composed_by: "server",
        ...(thumbnail
          ? { thumbnail_width: thumbnail.width, thumbnail_height: thumbnail.height }
          : {}),
      }
    );

    if (thumbnail) {
      processed.thumbnail = {
        buffer: thumbnail.buffer,
        mimetype: thumbnail.mimetype,
        originalname: outputName(baseFile.originalname, "image/webp"),
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
  ensureFileBuffer,
  hasUpload,
  composeVideoFromFile,
  composeCropRect,
  composeOutputSize,
  MAX_COMPOSE_SECONDS,
  COMPOSE_SHORT_SIDE,
};
