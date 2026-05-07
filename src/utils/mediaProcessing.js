const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const sharp = require("sharp");
const ffmpegPath = require("ffmpeg-static");

const MB = 1024 * 1024;

const POST_IMAGE_RATIO = 4 / 5;
const RATIO_TOLERANCE = 0.01;
const POST_IMAGE_MAX_BYTES = 3 * MB;
const AVATAR_IMAGE_MAX_BYTES = 2 * MB;
const MAX_IMAGE_INPUT_BYTES = 30 * MB;
const MAX_VIDEO_INPUT_BYTES = 100 * MB;
const MAX_VIDEO_OUTPUT_BYTES = 50 * MB;
const MIN_IMAGE_DIMENSION = 320;

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const VIDEO_MIME_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

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

async function processVideo(file) {
  await assertRealVideo(file);

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "freelandoo-media-"));
  const inputPath = path.join(tempDir, `input-${crypto.randomUUID()}`);
  const outputPath = path.join(tempDir, "output.mp4");

  try {
    await fs.writeFile(inputPath, file.buffer);
    const filter = "scale=if(gt(a\\,0.8)\\,trunc(min(iw\\,1080)/2)*2\\,-2):if(gt(a\\,0.8)\\,-2\\,trunc(min(ih\\,1350)/2)*2)";

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

    return buildProcessedFile(
      file,
      buffer,
      "video/mp4",
      outputName(file.originalname, "video/mp4"),
      {
        media_type: "video",
      }
    );
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function processPortfolioMedia(file, mediaType) {
  if (mediaType === "image") return processPostImage(file);
  if (mediaType === "video") return processVideo(file);
  throw httpError("Tipo de arquivo nao permitido");
}

async function processUserMedia(file) {
  const mt = (file?.mimetype || "").toLowerCase();
  if (mt.startsWith("image/")) return processPostImage(file);
  if (mt.startsWith("video/")) return processVideo(file);
  throw httpError("Tipo de arquivo nao permitido");
}

module.exports = {
  POST_IMAGE_MAX_BYTES,
  AVATAR_IMAGE_MAX_BYTES,
  MAX_VIDEO_INPUT_BYTES,
  processAvatarImage,
  processPortfolioMedia,
  processPostImage,
  processUserMedia,
  processVideo,
};
