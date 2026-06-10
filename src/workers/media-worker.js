// src/workers/media-worker.js — F4.S1
//
// Processo FILHO (child_process.fork a partir de src/utils/mediaJobs.js).
// Executa todo o trabalho pesado de mídia (ffmpeg/sharp) fora do processo da
// API, pra encode de vídeo não competir com requests (ex.: GET /search).
//
// Protocolo IPC (somente metadados — bytes vão por arquivo em tmp):
//   pai → filho:  { type: "job", jobId, fn, dir }
//   filho → pai:  { type: "start", jobId }
//                 { type: "done",  jobId }
//                 { type: "error", jobId, message, statusCode }
//
// O pai escreve `args.json` (com Buffers substituídos por { __mjbuf }) no dir
// do job; o filho revive, executa a função real de src/utils/mediaProcessing
// (ou processCourseVideo) e grava `result.json` no mesmo formato. Concorrência
// é 1 de propósito: encodes enfileiram em vez de disputar a CPU do container.

const fs = require("fs/promises");
const path = require("path");
const mediaProcessing = require("../utils/mediaProcessing");
const processCourseVideo = require("../integrations/ffmpeg/processCourseVideo");
const { createLogger } = require("../utils/logger");

const log = createLogger("media-worker");

const FUNCTIONS = {
  processPortfolioMedia: (args) =>
    mediaProcessing.processPortfolioMedia(args[0], args[1], args[2] || {}),
  processUserMedia: (args) => mediaProcessing.processUserMedia(args[0]),
  processVideo: (args) => mediaProcessing.processVideo(args[0], args[1] || {}),
  processPostImage: (args) => mediaProcessing.processPostImage(args[0]),
  splitVideoIntoChunks: (args) =>
    mediaProcessing.splitVideoIntoChunks(args[0], args[1] || 60),
  processConversationAudio: (args) =>
    mediaProcessing.processConversationAudio(args[0]),
  processCourseVideo: (args) => processCourseVideo(args[0]),
};

// ─── (De)serialização genérica: Buffer ↔ arquivo no dir do job ─────────────

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

async function dumpBuffers(value, dir, counter) {
  if (value === null || typeof value !== "object") return value;
  if (Buffer.isBuffer(value)) {
    const name = `out-${counter.n++}.bin`;
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

// ─── Fila FIFO com concorrência 1 ──────────────────────────────────────────

const queue = [];
let running = false;

async function runJob({ jobId, fn, dir }) {
  process.send?.({ type: "start", jobId });
  try {
    const impl = FUNCTIONS[fn];
    if (!impl) throw new Error(`Função de mídia desconhecida: ${fn}`);

    const rawArgs = JSON.parse(await fs.readFile(path.join(dir, "args.json"), "utf8"));
    const args = await reviveBuffers(rawArgs, dir);

    const result = await impl(args);

    const serialized = await dumpBuffers(result, dir, { n: 0 });
    await fs.writeFile(path.join(dir, "result.json"), JSON.stringify(serialized));
    process.send?.({ type: "done", jobId });
  } catch (err) {
    log.error("job.failed", { jobId, fn, message: err?.message });
    process.send?.({
      type: "error",
      jobId,
      message: err?.message || "Falha ao processar mídia",
      statusCode: err?.statusCode || 500,
    });
  }
}

async function drain() {
  if (running) return;
  running = true;
  while (queue.length) {
    const job = queue.shift();
    // Erros já viram mensagem IPC dentro de runJob; aqui nunca derruba o loop.
    await runJob(job).catch((err) => log.error("job.loop_error", { message: err?.message }));
  }
  running = false;
}

process.on("message", (msg) => {
  if (msg?.type === "job") {
    queue.push(msg);
    void drain();
  }
});

process.on("uncaughtException", (err) => {
  log.error("uncaught", { message: err?.message, stack: err?.stack });
  process.exit(1);
});

log.info("worker.ready", { pid: process.pid });
