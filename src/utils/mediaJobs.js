// src/utils/mediaJobs.js — F4.S1
//
// Cliente da fila de mídia: expõe as MESMAS funções de utils/mediaProcessing
// (mesma assinatura, mesmo retorno), mas executa o trabalho pesado no worker
// forkado (src/workers/media-worker.js) com concorrência 1 — encode de vídeo
// não compete com a API e uploads paralelos enfileiram em vez de disputar CPU.
//
// Cada job ganha uma linha em media_jobs (status queued→processing→done|error)
// pra observabilidade/histórico. Os bytes trafegam por arquivos em tmp (nunca
// por IPC). Se o worker estiver indisponível (crash em loop, env
// MEDIA_WORKER_DISABLED=1), cai pro processamento inline — comportamento
// idêntico ao anterior, só sem o isolamento.

const { fork } = require("child_process");
const crypto = require("crypto");
const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const pool = require("../databases");
const mediaProcessing = require("./mediaProcessing");
const processCourseVideoInline = require("../integrations/ffmpeg/processCourseVideo");
const { createLogger } = require("./logger");

const log = createLogger("media-jobs");

const WORKER_PATH = path.join(__dirname, "..", "workers", "media-worker.js");
const JOBS_TMP_ROOT = path.join(os.tmpdir(), "fl-media-jobs");
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const REFORK_BASE_DELAY_MS = 2000;
const RETENTION_DAYS = 30;

const DISABLED = process.env.MEDIA_WORKER_DISABLED === "1";

let worker = null;
let workerAlive = false;
let reforkAttempts = 0;
const pending = new Map(); // jobId → { resolve, reject, timer, dir }

// ─── (De)serialização: espelho exato do media-worker.js ────────────────────

async function dumpBuffers(value, dir, counter) {
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) {
    const name = `in-${counter.n++}.bin`;
    await fs.writeFile(path.join(dir, name), value);
    return { __mjbuf: name };
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await dumpBuffers(item, dir, counter));
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = await dumpBuffers(v, dir, counter);
  return out;
}

async function reviveBuffers(value, dir) {
  if (value === null || typeof value !== "object") return value;
  if (value.__mjbuf) {
    return fs.readFile(path.join(dir, String(value.__mjbuf)));
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await reviveBuffers(item, dir));
    return out;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = await reviveBuffers(v, dir);
  return out;
}

// ─── Status em media_jobs (best-effort: falha de DB não derruba o job) ─────

async function dbInsert(jobId, kind, payload) {
  try {
    await pool.query(
      `INSERT INTO media_jobs (id, kind, payload, status, attempts)
       VALUES ($1, $2, $3, 'queued', 1)`,
      [jobId, kind, JSON.stringify(payload || {})]
    );
  } catch (err) {
    log.error("db.insert_failed", { jobId, message: err?.message });
  }
}

async function dbUpdate(jobId, fields) {
  const sets = [];
  const values = [jobId];
  for (const [k, v] of Object.entries(fields)) {
    values.push(v);
    sets.push(`${k} = $${values.length}`);
  }
  try {
    await pool.query(`UPDATE media_jobs SET ${sets.join(", ")} WHERE id = $1`, values);
  } catch (err) {
    log.error("db.update_failed", { jobId, message: err?.message });
  }
}

// ─── Worker lifecycle ───────────────────────────────────────────────────────

function spawnWorker() {
  if (DISABLED) return;
  try {
    worker = fork(WORKER_PATH, [], { stdio: "inherit" });
  } catch (err) {
    log.error("worker.fork_failed", { message: err?.message });
    worker = null;
    workerAlive = false;
    return;
  }
  workerAlive = true;

  worker.on("message", (msg) => {
    if (!msg?.jobId) return;
    const entry = pending.get(msg.jobId);
    if (msg.type === "start") {
      void dbUpdate(msg.jobId, { status: "processing", started_at: new Date() });
      return;
    }
    if (!entry) return; // timeout já resolveu/rejeitou — ignora
    pending.delete(msg.jobId);
    clearTimeout(entry.timer);
    if (msg.type === "done") {
      reforkAttempts = 0;
      entry.resolve();
    } else if (msg.type === "error") {
      const err = new Error(msg.message || "Falha ao processar mídia");
      err.statusCode = msg.statusCode || 500;
      entry.reject(err);
    }
  });

  worker.on("exit", (code, signal) => {
    workerAlive = false;
    log.error("worker.exited", { code, signal, pending: pending.size });
    // Requests em voo não têm mais quem processe — rejeita todas.
    for (const [jobId, entry] of pending) {
      clearTimeout(entry.timer);
      const err = new Error("Processamento de mídia interrompido. Tente novamente.");
      err.statusCode = 503;
      entry.reject(err);
      void dbUpdate(jobId, { status: "error", error: "worker exited", finished_at: new Date() });
    }
    pending.clear();
    // Re-fork com backoff. Não desiste: o fallback inline cobre o intervalo.
    const delay = Math.min(REFORK_BASE_DELAY_MS * 2 ** reforkAttempts, 60_000);
    reforkAttempts += 1;
    setTimeout(spawnWorker, delay).unref?.();
  });
}

/**
 * Sobe o worker + marca como órfãos jobs de um boot anterior + agenda a
 * retenção. Chamar uma vez no boot do servidor (index.js).
 */
function startMediaWorker() {
  if (DISABLED) {
    log.info("worker.disabled", { reason: "MEDIA_WORKER_DISABLED=1" });
    return;
  }
  spawnWorker();

  // Jobs queued/processing de antes do restart: ninguém mais espera por eles.
  void pool
    .query(
      `UPDATE media_jobs
          SET status = 'error', error = 'orphaned by restart', finished_at = NOW()
        WHERE status IN ('queued', 'processing')`
    )
    .catch((err) => log.error("orphan_sweep_failed", { message: err?.message }));

  // Retenção: histórico de jobs > 30 dias sai da tabela (1x/dia).
  const purge = async () => {
    try {
      const r = await pool.query(
        `DELETE FROM media_jobs WHERE created_at < NOW() - INTERVAL '${RETENTION_DAYS} days'`
      );
      if (r.rowCount) log.info("retention.purged", { rows: r.rowCount });
    } catch (err) {
      log.error("retention_failed", { message: err?.message });
    }
  };
  setTimeout(purge, 10 * 60 * 1000).unref?.();
  setInterval(purge, 24 * 60 * 60 * 1000).unref?.();
}

// ─── Execução de um job ─────────────────────────────────────────────────────

async function runInWorker(fn, args, meta) {
  const jobId = crypto.randomUUID();
  const dir = path.join(JOBS_TMP_ROOT, jobId);
  await fs.mkdir(dir, { recursive: true });

  try {
    const serializedArgs = await dumpBuffers(args, dir, { n: 0 });
    await fs.writeFile(path.join(dir, "args.json"), JSON.stringify(serializedArgs));
    await dbInsert(jobId, fn, meta);

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(jobId);
        void dbUpdate(jobId, { status: "error", error: "timeout", finished_at: new Date() });
        const err = new Error("O processamento da mídia demorou demais. Tente um arquivo menor.");
        err.statusCode = 408;
        reject(err);
      }, JOB_TIMEOUT_MS);
      pending.set(jobId, { resolve, reject, timer, dir });
      worker.send({ type: "job", jobId, fn, dir });
    });

    const raw = JSON.parse(await fs.readFile(path.join(dir, "result.json"), "utf8"));
    const result = await reviveBuffers(raw, dir);
    void dbUpdate(jobId, { status: "done", finished_at: new Date() });
    return result;
  } catch (err) {
    if (err?.statusCode && err.statusCode !== 408 && err.statusCode !== 503) {
      // Erro "de negócio" vindo do worker (arquivo inválido etc.)
      void dbUpdate(jobId, {
        status: "error",
        error: String(err.message || "").slice(0, 500),
        finished_at: new Date(),
      });
    }
    throw err;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function run(fn, args, meta, inlineImpl) {
  if (DISABLED || !workerAlive || !worker?.connected) {
    if (!DISABLED) log.warn("fallback.inline", { fn });
    return inlineImpl();
  }
  return runInWorker(fn, args, meta);
}

function fileMeta(file) {
  return {
    original_filename: file?.originalname,
    mime_type: file?.mimetype,
    size_bytes: file?.buffer?.length ?? file?.size,
  };
}

// ─── API pública — mesmas assinaturas de utils/mediaProcessing ─────────────

async function processPortfolioMedia(file, mediaType, options = {}) {
  return run(
    "processPortfolioMedia",
    [file, mediaType, options],
    { ...fileMeta(file), media_type: mediaType, ...options },
    () => mediaProcessing.processPortfolioMedia(file, mediaType, options)
  );
}

async function processUserMedia(file) {
  return run("processUserMedia", [file], fileMeta(file), () =>
    mediaProcessing.processUserMedia(file)
  );
}

async function splitVideoIntoChunks(file, chunkSeconds = 60) {
  return run(
    "splitVideoIntoChunks",
    [file, chunkSeconds],
    { ...fileMeta(file), chunk_seconds: chunkSeconds },
    () => mediaProcessing.splitVideoIntoChunks(file, chunkSeconds)
  );
}

async function processConversationAudio(file) {
  return run("processConversationAudio", [file], fileMeta(file), () =>
    mediaProcessing.processConversationAudio(file)
  );
}

async function processCourseVideo({ buffer, originalName }) {
  return run(
    "processCourseVideo",
    [{ buffer, originalName }],
    { original_filename: originalName, size_bytes: buffer?.length },
    () => processCourseVideoInline({ buffer, originalName })
  );
}

module.exports = {
  startMediaWorker,
  processPortfolioMedia,
  processUserMedia,
  splitVideoIntoChunks,
  processConversationAudio,
  processCourseVideo,
};
