/**
 * AS DECISÕES DO POOL DE MÍDIA — puras, para serem testadas sem fork nenhum.
 *
 * `mediaJobs` sobe N processos de ffmpeg em vez de um. Aqui mora o que decide
 * QUANTOS (a CPU do container) e QUAL trabalho vai primeiro (a prioridade).
 */
const fs = require("fs");
const os = require("os");

/**
 * Núcleos que o CONTAINER pode usar, a partir do cgroup.
 *
 * ⚠️ `os.cpus()` NO RAILWAY DEVOLVE OS NÚCLEOS DO HOST, não os do container. O
 * limite de verdade (8 vCPU no Hobby) está no cgroup; confiar no `os.cpus()`
 * abriria dezenas de ffmpeg numa máquina de 8 e cada um rodaria mais devagar
 * que sozinho.
 *
 * @param {string|null} v2  conteúdo de /sys/fs/cgroup/cpu.max ("800000 100000" ou "max 100000")
 * @param {string|null} v1q conteúdo de cpu.cfs_quota_us (v1)
 * @param {string|null} v1p conteúdo de cpu.cfs_period_us (v1)
 * @returns {number|null} núcleos (pode ser fracionário) ou null se não há limite
 */
function parseCgroupCpu(v2, v1q, v1p) {
  if (v2) {
    const [quota, period] = String(v2).trim().split(/\s+/);
    if (quota && quota !== "max") {
      const q = Number(quota);
      const p = Number(period) || 100000;
      if (q > 0 && p > 0) return q / p;
    }
    return null;
  }
  const q = Number(String(v1q || "").trim());
  const p = Number(String(v1p || "").trim());
  if (q > 0 && p > 0) return q / p;
  return null;
}

function readOrNull(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

/** Núcleos disponíveis: cgroup quando houver, senão o que o SO diz. */
function containerCpus() {
  const fromCgroup = parseCgroupCpu(
    readOrNull("/sys/fs/cgroup/cpu.max"),
    readOrNull("/sys/fs/cgroup/cpu/cpu.cfs_quota_us"),
    readOrNull("/sys/fs/cgroup/cpu/cpu.cfs_period_us")
  );
  const host =
    typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  const n = fromCgroup != null ? Math.min(fromCgroup, host) : host;
  return Math.max(1, Math.floor(n));
}

/**
 * Tamanho do pool e threads por ffmpeg.
 *
 * Padrão: metade dos núcleos, entre 1 e 4. Metade porque a API divide a mesma
 * máquina — vídeo não pode deixar o site sem CPU. 4 no máximo porque cada
 * ffmpeg de 4K ocupa memória de verdade, e 8 GB é o teto do container.
 * `MEDIA_WORKER_CONCURRENCY` sobrescreve (1 volta ao comportamento antigo).
 */
function poolSize(cpus, envValue) {
  const fromEnv = Number.parseInt(envValue || "", 10);
  const size =
    Number.isFinite(fromEnv) && fromEnv > 0
      ? Math.min(fromEnv, 16)
      : Math.max(1, Math.min(4, Math.floor(cpus / 2)));
  const threads = Math.max(1, Math.floor(cpus / size));
  return { size, threads };
}

/**
 * PRIORIDADE: menor número vai primeiro.
 *
 * Quem espera na tela agora (áudio no chat, foto) passa na frente do vídeo; o
 * vídeo de post passa na frente da aula de curso, que é longa e não tem ninguém
 * olhando para uma tela esperando por ela.
 */
const PRIORITY = {
  processConversationAudio: 0,
  processUserMedia: 1,
  processPortfolioMedia: 2,
  composeVideoFromFile: 2,
  splitVideoIntoChunks: 2,
  processCourseVideo: 9,
};

/** Tipos que nunca ocupam mais que N vagas ao mesmo tempo. */
const MAX_RUNNING = { processCourseVideo: 1 };

/**
 * Qual trabalho da fila roda agora.
 *
 * ⚠️ O teto por tipo é o que impede uma leva de aulas de 20 minutos de ocupar
 * TODAS as vagas — aí até o áudio do chat esperaria uma aula terminar. Dentro
 * da mesma prioridade, quem chegou antes vai antes.
 *
 * @param {{fn:string, seq:number}[]} queue
 * @param {Record<string, number>} runningByFn  quantos de cada tipo já rodam
 * @returns {number} índice na fila, ou -1 se nada pode rodar agora
 */
function pickNext(queue, runningByFn = {}) {
  let best = -1;
  for (let i = 0; i < queue.length; i++) {
    const job = queue[i];
    const cap = MAX_RUNNING[job.fn];
    if (cap != null && (runningByFn[job.fn] || 0) >= cap) continue;
    if (best === -1) {
      best = i;
      continue;
    }
    const pa = PRIORITY[job.fn] ?? 5;
    const pb = PRIORITY[queue[best].fn] ?? 5;
    if (pa < pb || (pa === pb && job.seq < queue[best].seq)) best = i;
  }
  return best;
}

module.exports = {
  parseCgroupCpu,
  containerCpus,
  poolSize,
  pickNext,
  PRIORITY,
  MAX_RUNNING,
};
