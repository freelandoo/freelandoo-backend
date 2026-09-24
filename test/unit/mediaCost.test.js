// test/unit/mediaCost.test.js
// As decisões de CUSTO do processamento de vídeo — todas puras:
//   - ler o cabeçalho sem decodificar (videoProbe.parseProbe)
//   - copiar em vez de recodificar quando nada muda (composePlan.canStreamCopy)
//   - caber em 50 MB numa passada só (composePlan.sizeCapBitrate)
//   - quantos ffmpeg em paralelo e em que ordem (mediaPool)
const test = require("node:test");
const assert = require("node:assert");

const { parseProbe } = require("../../src/utils/videoProbe");
const { canStreamCopy, sizeCapBitrate } = require("../../src/utils/composePlan");
const { parseCgroupCpu, poolSize, pickNext } = require("../../src/utils/mediaPool");

// Saída real de `ffmpeg -hide_banner -i` (recortada), dos três casos que importam.
const IPHONE_HEVC = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'IMG_0001.MOV':
  Duration: 00:00:12.43, start: 0.000000, bitrate: 18234 kb/s
  Stream #0:0[0x1](und): Video: hevc (Main 10) (hvc1 / 0x31637668), yuv420p10le(tv, bt2020nc/bt2020/arib-std-b67), 3840x2160, 17960 kb/s, 29.98 fps, 30 tbr, 600 tbn (default)
      Side data:
        displaymatrix: rotation of -90.00 degrees
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, stereo, fltp, 173 kb/s (default)
At least one output file must be specified`;

const CELULAR_H264 = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'cel.mp4':
  Duration: 00:00:15.02, start: 0.000000, bitrate: 4400 kb/s
  Stream #0:0[0x1](und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1080x1920 [SAR 1:1 DAR 9:16], 4263 kb/s, 30 fps, 30 tbr, 15360 tbn (default)
  Stream #0:1[0x2](und): Audio: aac (LC) (mp4a / 0x6134706D), 44100 Hz, mono, fltp, 128 kb/s (default)
At least one output file must be specified`;

const WEBM_SEM_DURACAO = `Input #0, matroska,webm, from 'rec.webm':
  Duration: N/A, start: 0.000000, bitrate: N/A
  Stream #0:0: Video: vp9 (Profile 0), yuv420p(tv), 720x1280, SAR 1:1 DAR 9:16, 30 fps, 30 tbr, 1k tbn (default)
  Stream #0:1: Audio: opus, 48000 Hz, mono, fltp (default)`;

test("parseProbe: celular H.264 lê tudo do cabeçalho", () => {
  const p = parseProbe(CELULAR_H264);
  assert.strictEqual(p.duration, 15.02);
  assert.strictEqual(p.width, 1080);
  assert.strictEqual(p.height, 1920);
  assert.strictEqual(p.videoCodec, "h264");
  assert.strictEqual(p.pixFmt, "yuv420p");
  assert.strictEqual(p.audioCodec, "aac");
  assert.strictEqual(p.rotation, 0);
});

test("parseProbe: iPhone girado troca largura e altura, e lê HEVC 10 bits", () => {
  const p = parseProbe(IPHONE_HEVC);
  assert.strictEqual(p.width, 2160);
  assert.strictEqual(p.height, 3840);
  assert.strictEqual(p.rotation, -90);
  assert.strictEqual(p.videoCodec, "hevc");
  assert.strictEqual(p.pixFmt, "yuv420p10le");
  assert.ok(Math.abs(p.duration - 12.43) < 1e-9);
});

test("parseProbe: webm sem duração devolve null (é 'não sei', não zero)", () => {
  const p = parseProbe(WEBM_SEM_DURACAO);
  assert.strictEqual(p.duration, null);
  assert.strictEqual(p.videoCodec, "vp9");
  assert.strictEqual(p.audioCodec, "opus");
});

test("parseProbe: saída vazia não inventa nada", () => {
  const p = parseProbe("");
  assert.strictEqual(p.width, null);
  assert.strictEqual(p.duration, null);
  assert.strictEqual(p.hasAudio, false);
});

// ── cópia direta ────────────────────────────────────────────────────────────
const plano = (over = {}) => ({
  crop: { x: 0, y: 0, w: 1080, h: 1920 },
  outW: 1080,
  outH: 1920,
  hasLut: false,
  hasOverlay: false,
  hasPip: false,
  grain: 0,
  maxSeconds: 70,
  inputBytes: 8_000_000,
  maxBytes: 50 * 1024 * 1024,
  ...over,
});

test("canStreamCopy: celular sem edição COPIA", () => {
  assert.strictEqual(canStreamCopy(parseProbe(CELULAR_H264), plano()), true);
});

test("canStreamCopy: qualquer mudança obriga o encode", () => {
  const info = parseProbe(CELULAR_H264);
  const casos = {
    filtro: { hasLut: true },
    texto: { hasOverlay: true },
    pip: { hasPip: true },
    grao: { grain: 0.2 },
    recorte: { crop: { x: 10, y: 0, w: 1000, h: 1778 } },
    reducao: { outW: 720, outH: 1280 },
    "maior que o teto de tempo": { maxSeconds: 10 },
    "arquivo acima de 50 MB": { inputBytes: 60 * 1024 * 1024 },
    "tamanho desconhecido": { inputBytes: 0 },
  };
  for (const [nome, over] of Object.entries(casos)) {
    assert.strictEqual(canStreamCopy(info, plano(over)), false, nome);
  }
});

test("canStreamCopy: formato que o navegador não garante tocar vai para o encode", () => {
  const hevc = parseProbe(IPHONE_HEVC);
  assert.strictEqual(
    canStreamCopy(hevc, plano({ crop: { x: 0, y: 0, w: 2160, h: 3840 }, outW: 2160, outH: 3840 })),
    false
  );
  const webm = parseProbe(WEBM_SEM_DURACAO);
  assert.strictEqual(
    canStreamCopy(webm, plano({ crop: { x: 0, y: 0, w: 720, h: 1280 }, outW: 720, outH: 1280 })),
    false
  );
  const girado = { ...parseProbe(CELULAR_H264), rotation: 90 };
  assert.strictEqual(canStreamCopy(girado, plano()), false, "rotação em side data");
  const opus = { ...parseProbe(CELULAR_H264), audioCodec: "opus" };
  assert.strictEqual(canStreamCopy(opus, plano()), false, "áudio que não é AAC");
});

// ── teto de bitrate ─────────────────────────────────────────────────────────
test("sizeCapBitrate: 70 s cabem em 50 MB com áudio de 128k", () => {
  const max = 50 * 1024 * 1024;
  const { maxrateK, bufsizeK } = sizeCapBitrate(70, max);
  const bytes = ((maxrateK + 128) * 1000 * 70) / 8;
  assert.ok(bytes < max, `${bytes} >= ${max}`);
  assert.strictEqual(bufsizeK, maxrateK * 2);
});

test("sizeCapBitrate: nunca desce abaixo de 500k, nem com duração absurda", () => {
  assert.strictEqual(sizeCapBitrate(100000, 50 * 1024 * 1024).maxrateK, 500);
  assert.ok(sizeCapBitrate(0, 50 * 1024 * 1024).maxrateK > 0);
});

// ── pool ────────────────────────────────────────────────────────────────────
test("parseCgroupCpu: lê o limite do container, não o do host", () => {
  assert.strictEqual(parseCgroupCpu("800000 100000"), 8);
  assert.strictEqual(parseCgroupCpu("150000 100000"), 1.5);
  assert.strictEqual(parseCgroupCpu("max 100000"), null);
  assert.strictEqual(parseCgroupCpu(null, "400000", "100000"), 4);
  assert.strictEqual(parseCgroupCpu(null, "-1", "100000"), null);
  assert.strictEqual(parseCgroupCpu(null, null, null), null);
});

test("poolSize: metade dos núcleos, entre 1 e 4, com a CPU dividida entre os ffmpeg", () => {
  assert.deepStrictEqual(poolSize(8), { size: 4, threads: 2 });
  assert.deepStrictEqual(poolSize(2), { size: 1, threads: 2 });
  assert.deepStrictEqual(poolSize(1), { size: 1, threads: 1 });
  assert.deepStrictEqual(poolSize(32), { size: 4, threads: 8 });
  assert.deepStrictEqual(poolSize(8, "1"), { size: 1, threads: 8 }, "env 1 = comportamento antigo");
  assert.deepStrictEqual(poolSize(8, "lixo"), { size: 4, threads: 2 });
});

test("pickNext: o áudio do chat passa na frente do vídeo, e o vídeo na frente da aula", () => {
  const fila = [
    { fn: "processCourseVideo", seq: 0 },
    { fn: "composeVideoFromFile", seq: 1 },
    { fn: "processConversationAudio", seq: 2 },
  ];
  assert.strictEqual(pickNext(fila), 2);
  assert.strictEqual(pickNext(fila.slice(0, 2)), 1);
});

test("pickNext: mesma prioridade respeita a ordem de chegada", () => {
  const fila = [
    { fn: "composeVideoFromFile", seq: 7 },
    { fn: "processPortfolioMedia", seq: 3 },
  ];
  assert.strictEqual(pickNext(fila), 1);
});

test("pickNext: uma aula por vez — as outras vagas ficam para quem espera na tela", () => {
  const fila = [{ fn: "processCourseVideo", seq: 0 }];
  assert.strictEqual(pickNext(fila, { processCourseVideo: 1 }), -1);
  assert.strictEqual(pickNext(fila, {}), 0);
  const mista = [
    { fn: "processCourseVideo", seq: 0 },
    { fn: "composeVideoFromFile", seq: 1 },
  ];
  assert.strictEqual(pickNext(mista, { processCourseVideo: 1 }), 1);
});
