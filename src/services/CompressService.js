// src/services/CompressService.js
//
// Backend da ferramenta /comprimir (aba Vídeo). Fluxo em 2 passos pra não
// estourar a memória do Railway com vídeos grandes:
//   1) createUploadUrl  → presigned PUT pro R2 (temp-compress/), o cliente sobe direto.
//   2) processFromUpload → backend baixa do R2 pro disco, roda ffmpeg, sobe a
//      saída (também em temp-compress/) e devolve a URL pública de download.
// O lifecycle do bucket R2 expira o prefixo temp-compress/ em ~3h (config do Alex).
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const presign = require("../integrations/r2/presignCompressUpload");
const { compressVideoFile } = require("../utils/mediaProcessing");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CompressService");

const MB = 1024 * 1024;
const MAX_INPUT_BYTES = 500 * MB; // teto de entrada (o ponto é comprimir o que é grande)
const ALLOWED_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

function err(message) {
  return { error: message };
}

class CompressService {
  // Passo 1 — gera a URL de upload direto pro R2.
  static async createUploadUrl(user, body = {}) {
    return runWithLogs(
      log,
      "createUploadUrl",
      () => ({ id_user: user?.id_user, content_type: body?.content_type }),
      async () => {
        const contentType = String(body?.content_type || "").toLowerCase();
        if (!ALLOWED_TYPES.has(contentType)) {
          return err("Formato de vídeo não aceito. Envie MP4, WebM ou MOV.");
        }
        const ext = presign.extForType(contentType);
        if (!ext) return err("Formato de vídeo não aceito. Envie MP4, WebM ou MOV.");

        const { base } = presign.buildJob(user.id_user);
        const key = presign.inputKey(base, ext);
        const url = await presign.presignPut(key, contentType);

        return {
          expires_in: presign.DEFAULT_EXPIRES,
          max_bytes: MAX_INPUT_BYTES,
          input: { key, url, content_type: contentType, max_bytes: MAX_INPUT_BYTES },
        };
      }
    );
  }

  // Passo 2 — comprime o objeto já enviado pro R2 e devolve link de download.
  static async processFromUpload(user, body = {}) {
    return runWithLogs(
      log,
      "processFromUpload",
      () => ({ id_user: user?.id_user, storage_key: body?.storage_key }),
      async () => {
        const storageKey = body?.storage_key;
        if (!presign.keyBelongsToUser(storageKey, user.id_user) || !/\/input\.(mp4|webm|mov)$/.test(storageKey)) {
          return err("storage_key inválido");
        }

        const head = await presign.headObject(storageKey);
        if (!head.exists) {
          return err("Upload do vídeo não encontrado. Tente novamente.");
        }
        if (head.size > MAX_INPUT_BYTES) {
          await presign.deleteObject(storageKey);
          return err("O vídeo excede o limite de 500MB.");
        }
        const originalBytes = head.size;

        // temp-compress/<id_user>/<uuid> — a saída mora na mesma pasta do input.
        const base = storageKey.replace(/\/input\.(mp4|webm|mov)$/, "");
        const outKey = presign.outputKey(base);

        const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "fl-compress-"));
        const inputPath = path.join(tempDir, "input");
        try {
          await presign.downloadToFile(storageKey, inputPath);

          let outputPath, size;
          try {
            ({ outputPath, size } = await compressVideoFile(inputPath, tempDir));
          } catch (e) {
            log.warn("ffmpeg_failed", { id_user: user.id_user, message: e?.message });
            return err(
              e?.message?.includes("demorou")
                ? "A compressão demorou demais. Tente um vídeo menor."
                : "Não foi possível comprimir esse vídeo. Tente outro arquivo."
            );
          }

          const baseName = String(body?.file_name || "video")
            .replace(/\.[^.]+$/, "")
            .replace(/[^a-zA-Z0-9._-]/g, "_")
            .slice(0, 60) || "video";
          await presign.uploadFile(outKey, outputPath, "video/mp4", `comprimido-${baseName}.mp4`);

          // O input não serve mais — apaga já (o lifecycle pega o resto em 3h).
          await presign.deleteObject(storageKey);

          return {
            download_url: presign.publicUrl(outKey),
            size_bytes: size,
            original_bytes: originalBytes,
            saved_percent:
              originalBytes > 0 ? Math.max(0, Math.round((1 - size / originalBytes) * 100)) : 0,
          };
        } finally {
          await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    );
  }
}

module.exports = CompressService;
