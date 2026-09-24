// src/utils/mediaJobs.js — F4.S1
//
// Cliente da fila de mídia: expõe as MESMAS funções de utils/mediaProcessing
// (mesma assinatura, mesmo retorno), mas executa o trabalho pesado num POOL
// de workers forkados (src/workers/media-worker.js) — encode de vídeo não
// compete com a API, e a fila tem prioridade (ver utils/mediaPool).
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
const { containerCpus, poolSize, pickNext } = require("./mediaPool");

const log = createLogger("media-jobs");

const WORKER_PATH = path.join(__dirname, "..", "workers", "media-worker.js");
const JOBS_TMP_ROOT = path.join(os.tmpdir(), "fl-media-jobs");
const JOB_TIMEOUT_MS = 10 * 60 * 1000;
const REFORK_BASE_DELAY_MS = 2000;
const RETENTION_DAYS = 30;

const DISABLED = process.env.MEDIA_WORKER_DISABLED === "1";


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

// ─── Pool de processos ──────────────────────────────────────────────────────
//
// ⚠️ ERA UM PROCESSO, UM TRABALHO POR VEZ: 50 pessoas postando juntas faziam a
// 50ª esperar as outras 49. Agora são até N processos (ver utils/mediaPool),
// com a fila e a prioridade no PAI — o filho recebe um trabalho por vez.
//
// ⚠️ OS EXTRAS SÃO PREGUIÇOSOS, e isso é custo, não detalhe: cada processo Node
// parado ocupa ~50 MB, e o Railway cobra memória por minuto. A vaga 0 fica
// sempre de pé (como antes); as outras nascem quando há fila e morrem depois
// de IDLE_MS sem trabalho. Parado, o pool custa o mesmo que o processo único.

const CPUS = containerCpus();
const { size: POOL_SIZE, threads: FFMPEG_THREADS } = poolSize(
  CPUS,
  process.env.MEDIA_WORKER_CONCURRENCY
);
const IDLE_MS = 5 * 60 * 1000;
// Espera na fila tem teto próprio: sem ele a requisição ficaria pendurada até
// o cliente desistir, sem ninguém dizer por quê.
const QUEUE_WAIT_MS = 15 * 60 * 1000;

const slots = []; // { id, proc, alive, job, idleTimer, reforkAttempts, retiring }
const queue = []; // { jobId, fn, dir, seq, resolve, reject, waitTimer, timer }
let seq = 0;

function aliveSlots() {
  return slots.filter((s) => s && s.alive && s.proc?.connected);
}

function spawnSlot(id) {
  const slot = slots[id] || { id, reforkAttempts: 0 };
  slots[id] = slot;
  slot.job = null;
  slot.retiring = false;
  try {
    slot.proc = fork(WORKER_PATH, [], {
      stdio: "inherit",
      // A fatia de CPU de cada ffmpeg (utils/mediaProcessing.ffmpegThreadArgs).
      env: { ...process.env, MEDIA_FFMPEG_THREADS: String(FFMPEG_THREADS) },
    });
  } catch (err) {
    log.error("worker.fork_failed", { slot: id, message: err?.message });
    slot.alive = false;
    return;
  }
  slot.alive = true;
  const proc = slot.proc;

  proc.on("message", (msg) => {
    if (!msg?.jobId || !slot.job || slot.job.jobId !== msg.jobId) return;
    if (msg.type === "start") {
      void dbUpdate(msg.jobId, { status: "processing", started_at: new Date() });
      return;
    }
    const job = slot.job;
    finishSlotJob(slot);
    if (msg.type === "done") {
      slot.reforkAttempts = 0;
      job.resolve();
    } else if (msg.type === "error") {
      const err = new Error(msg.message || "Falha ao processar mídia");
      err.statusCode = msg.statusCode || 500;
      job.reject(err);
    }
    pump();
  });

  proc.on("exit", (code, signal) => {
    // Um processo antigo que morre depois de a vaga já ter sido reaberta não
    // pode derrubar o trabalho do processo novo.
    if (slot.proc !== proc) return;
    slot.alive = false;
    const retiring = slot.retiring;
    // Só o trabalho DESTA vaga fica sem quem processe; as outras seguem.
    if (slot.job) {
      const job = slot.job;
      finishSlotJob(slot);
      const err = new Error("Processamento de mídia interrompido. Tente novamente.");
      err.statusCode = 503;
      job.reject(err);
      void dbUpdate(job.jobId, { status: "error", error: "worker exited", finished_at: new Date() });
    }
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    if (retiring) {
      log.info("worker.retired", { slot: id });
      pump();
      return;
    }
    log.error("worker.exited", { slot: id, code, signal });
    // A vaga 0 é a de sempre: volta com backoff. As extras renascem sob demanda.
    if (id === 0) {
      const delay = Math.min(REFORK_BASE_DELAY_MS * 2 ** slot.reforkAttempts, 60_000);
      slot.reforkAttempts += 1;
      setTimeout(() => {
        // `pump` pode ter reaberto a vaga 0 no intervalo, sob demanda: abrir de
        // novo deixaria um processo órfão vivo, fora do controle do pool.
        if (!slots[0]?.alive) spawnSlot(0);
        pump();
      }, delay).unref?.();
    }
    pump();
  });
}

function finishSlotJob(slot) {
  if (slot.job?.timer) clearTimeout(slot.job.timer);
  slot.job = null;
  armIdle(slot);
}

function armIdle(slot) {
  if (slot.idleTimer) clearTimeout(slot.idleTimer);
  slot.idleTimer = null;
  if (slot.id === 0 || !slot.alive) return;
  slot.idleTimer = setTimeout(() => {
    if (slot.job || !slot.alive) return;
    slot.retiring = true;
    try {
      slot.proc.kill();
    } catch {
      /* já saiu */
    }
  }, IDLE_MS);
  slot.idleTimer.unref?.();
}

/** Despacha o que der: vaga livre + trabalho que a prioridade deixa rodar. */
function pump() {
  while (queue.length) {
    const running = {};
    for (const s of slots) if (s?.job) running[s.job.fn] = (running[s.job.fn] || 0) + 1;
    const idx = pickNext(queue, running);
    if (idx === -1) return;

    let slot = aliveSlots().find((s) => !s.job);
    if (!slot) {
      // Todas ocupadas: abre uma vaga extra, se ainda couber no pool.
      let free = -1;
      for (let i = 0; i < POOL_SIZE; i++) {
        if (!slots[i] || !slots[i].alive) {
          free = i;
          break;
        }
      }
      if (free === -1) return;
      spawnSlot(free);
      slot = slots[free];
      if (!slot?.alive) return;
    }

    const [job] = queue.splice(idx, 1);
    clearTimeout(job.waitTimer);
    if (slot.idleTimer) clearTimeout(slot.idleTimer);
    // ⚠️ O prazo conta do DESPACHO, não da entrada na fila. Antes ele corria
    // durante a espera, e um vídeo podia estourar sem nunca ter rodado.
    job.timer = setTimeout(() => {
      if (slot.job !== job) return;
      void dbUpdate(job.jobId, { status: "error", error: "timeout", finished_at: new Date() });
      const err = new Error("O processamento da mídia demorou demais. Tente um arquivo menor.");
      err.statusCode = 408;
      slot.job = null;
      job.reject(err);
      // O ffmpeg daquela vaga pode seguir preso: recicla o processo.
      try {
        slot.proc.kill("SIGKILL");
      } catch {
        /* já saiu */
      }
    }, JOB_TIMEOUT_MS);
    slot.job = job;
    slot.proc.send({ type: "job", jobId: job.jobId, fn: job.fn, dir: job.dir });
  }
}

/**
 * Sobe a vaga 0 + marca como órfãos jobs de um boot anterior + agenda a
 * retenção. Chamar uma vez no boot do servidor (index.js).
 */
function startMediaWorker() {
  if (DISABLED) {
    log.info("worker.disabled", { reason: "MEDIA_WORKER_DISABLED=1" });
    return;
  }
  log.info("pool.configured", { cpus: CPUS, size: POOL_SIZE, ffmpegThreads: FFMPEG_THREADS });
  spawnSlot(0);

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
      const job = { jobId, fn, dir, seq: seq++, resolve, reject, timer: null };
      job.waitTimer = setTimeout(() => {
        const i = queue.indexOf(job);
        if (i === -1) return;
        queue.splice(i, 1);
        void dbUpdate(jobId, { status: "error", error: "queue wait", finished_at: new Date() });
        const err = new Error("Muitos envios agora. Tente de novo em alguns minutos.");
        err.statusCode = 503;
        reject(err);
      }, QUEUE_WAIT_MS);
      job.waitTimer.unref?.();
      queue.push(job);
      pump();
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
  if (DISABLED || !aliveSlots().length) {
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

// Compoe o video no servidor a partir do arquivo ORIGINAL em disco.
// ⚠️ O 1o argumento e um CAMINHO, nao um Buffer: e isso que mantem os bytes do
// celular (um 4K de 70s passa de 200MB) fora da memoria do Node. O
// serializador do worker so desvia Buffers para arquivo; string passa direto, e
// pai e filho leem o mesmo disco.
async function composeVideoFromFile(inputPath, params = {}) {
  return run(
    "composeVideoFromFile",
    [inputPath, params],
    { aspect: params.aspect, has_overlay: !!params.overlayPath, has_pip: !!params.pipPath },
    () => mediaProcessing.composeVideoFromFile(inputPath, params)
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
  composeVideoFromFile,
  splitVideoIntoChunks,
  processConversationAudio,
  processCourseVideo,
};
