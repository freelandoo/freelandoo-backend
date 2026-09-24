/**
 * LER O CABEÇALHO DE UM VÍDEO SEM DECODIFICÁ-LO.
 *
 * ⚠️ POR QUE ISTO EXISTE: a sondagem antiga rodava `ffmpeg -i x -f null -`, que
 * DECODIFICA O VÍDEO INTEIRO só para ler largura, altura e duração — num 4K de
 * 70s, quase o custo de um encode. E rodava DUAS vezes por montagem (uma para as
 * dimensões, outra para a duração). Tudo isso está no cabeçalho do arquivo:
 * `ffmpeg -i x` sem saída imprime o que sabe e termina em milissegundos (com
 * código 1, "At least one output file must be specified" — esperado, não erro).
 *
 * `ffmpeg-static` não traz ffprobe, por isso a leitura é do stderr. Ela mora numa
 * função PURA (`parseProbe`) justamente para poder ser testada sem ffmpeg.
 */
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");

const PROBE_TIMEOUT_MS = 20_000;

/**
 * @param {string} stderr  a saída de `ffmpeg -hide_banner -i arquivo`
 * @returns {{duration:number|null,width:number|null,height:number|null,
 *            rotation:number,videoCodec:string|null,pixFmt:string|null,
 *            audioCodec:string|null,hasAudio:boolean}}
 */
function parseProbe(stderr) {
  const text = String(stderr || "");
  const lines = text.split(/\r?\n/);

  // "Duration: N/A" (webm do MediaRecorder) continua sendo "não sei" — é o que
  // a leitura antiga fazia, e quem chama já trata a ausência.
  const d = text.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : null;

  const videoLine = lines.find((l) => /Stream #\d+:\d+.*Video:/.test(l)) || null;
  const audioLine = lines.find((l) => /Stream #\d+:\d+.*Audio:/.test(l)) || null;

  let width = null;
  let height = null;
  let videoCodec = null;
  let pixFmt = null;
  if (videoLine) {
    const c = videoLine.match(/Video:\s*([a-z0-9_]+)/i);
    videoCodec = c ? c[1].toLowerCase() : null;
    // O 1º segmento depois de "Video:" é o codec com as tags entre parênteses
    // (sem vírgula); o 2º começa pelo formato de pixel: "yuv420p(tv, bt709)".
    const p = videoLine.match(/Video:[^,]*,\s*([a-z0-9_]+)/i);
    pixFmt = p ? p[1].toLowerCase() : null;
    // Exige 2+ dígitos dos dois lados para não casar com tag tipo "0x1f".
    const m = videoLine.match(/(?:^|[\s,])(\d{2,5})x(\d{2,5})(?:[\s,\]]|$)/);
    if (m) {
      width = Number(m[1]);
      height = Number(m[2]);
    }
  }

  // Vídeo de celular guarda a rotação em side data e o ffmpeg a aplica no
  // decode: em 90/270 o WxH do stream vem invertido em relação ao que se VÊ.
  const r = text.match(/rotation of (-?\d+(?:\.\d+)?) degrees/);
  const rotation = r ? Number(r[1]) : 0;
  if (width && height && Math.abs(rotation) % 180 === 90) {
    const swap = width;
    width = height;
    height = swap;
  }

  let audioCodec = null;
  if (audioLine) {
    const a = audioLine.match(/Audio:\s*([a-z0-9_]+)/i);
    audioCodec = a ? a[1].toLowerCase() : null;
  }

  return {
    duration: Number.isFinite(duration) ? duration : null,
    width: width > 0 ? width : null,
    height: height > 0 ? height : null,
    rotation: Number.isFinite(rotation) ? rotation : 0,
    videoCodec,
    pixFmt,
    audioCodec,
    hasAudio: !!audioLine,
  };
}

/** Roda a sondagem. Nunca rejeita: arquivo ilegível devolve campos nulos. */
function probeMedia(filePath) {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      resolve(parseProbe(""));
      return;
    }
    const child = spawn(ffmpegPath, ["-hide_banner", "-i", filePath], { windowsHide: true });
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), PROBE_TIMEOUT_MS);
    child.stderr.on("data", (c) => {
      stderr += c.toString();
      if (stderr.length > 40_000) stderr = stderr.slice(-40_000);
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(parseProbe(""));
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve(parseProbe(stderr));
    });
  });
}

module.exports = { parseProbe, probeMedia };
