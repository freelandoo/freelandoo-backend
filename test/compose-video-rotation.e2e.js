// test/compose-video-rotation.e2e.js — matriz de exibição (celular em pé) e corte por duração
//
// Exercita a composição de vídeo NO SERVIDOR com ffmpeg de verdade — a peça que
// tirou o re-encode do celular (ver composeVideoFromFile em utils/mediaProcessing).
// Não precisa de Postgres: a função é pura, de arquivo para arquivo.
// Rodar com: npm run test:compose
const fsp = require("fs/promises");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");
const ffmpegPath = require("ffmpeg-static");
const { composeVideoFromFile } = require("../src/utils/mediaProcessing");

function run(args) {
  return new Promise((res, rej) => {
    const c = spawn(ffmpegPath, args, { windowsHide: true });
    let e = ""; c.stderr.on("data", d => { e += d; if (e.length > 9000) e = e.slice(-9000); });
    c.on("close", k => k === 0 ? res(e) : rej(new Error(e.slice(-1500))));
    c.on("error", rej);
  });
}
async function probe(f) { try { return await run(["-i", f, "-f", "null", "-"]); } catch (e) { return e.message; } }

(async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "fl-rot-"));
  let pass = 0, fail = 0;
  const ck = (n, c, x = "") => { c ? (pass++, console.log("  ok   " + n + (x ? " — " + x : ""))) : (fail++, console.log("  FAIL " + n + (x ? " — " + x : ""))); };

  // Celular em pé: sensor grava 1920x1080 LANDSCAPE + rotate=90 no metadado.
  // O reprodutor mostra 1080x1920 RETRATO.
  const base = path.join(dir, "base.mp4");
  await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=4",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", base]);
  const src = path.join(dir, "rot90.mp4");
  // -display_rotation grava a MATRIZ DE EXIBICAO, que e o que celular usa de
  // verdade. O -metadata rotate= e legado e o ffmpeg 6 ignora em silencio.
  await run(["-y", "-display_rotation", "90", "-i", base, "-c", "copy", src]);
  const info = await probe(src);
  console.log("[fonte] stream:", (info.match(/Stream #0:0.*/) || [""])[0].trim().slice(0, 110));
  console.log("[fonte] rotação:", /rotation of/.test(info) ? (info.match(/rotation of [-\d.]+ degrees/) || [""])[0] : "(nenhuma)");

  console.log("\n[rot 90] compondo em 9:16 (o enquadramento natural do celular em pé)");
  const out = await composeVideoFromFile(src, { aspect: 9 / 16, zoom: 1, panX: 0, panY: 0, filter: null });
  const w = out.mediaMetadata.width, h = out.mediaMetadata.height;
  console.log("  saída:", w + "x" + h);
  ck("saiu em RETRATO (não deitado)", h > w, w + "x" + h);
  // 1080x1920 exibido, cortado em 9:16 = já é 9:16 → usa tudo, sem cortar nada
  ck("9:16 sobre fonte já 9:16 usa a imagem inteira", w === 1080 && h === 1920, w + "x" + h);
  const outPath = path.join(dir, "o.mp4"); await fsp.writeFile(outPath, out.buffer);
  const oi = await probe(outPath);
  ck("stream de saída confirma 1080x1920", /1080x1920/.test(oi));
  ck("saída SEM rotação pendente (já aplicada)", !/rotation of/.test(oi));

  console.log("\n[rot 90] compondo em 16:9 (deitado a partir do vídeo em pé)");
  const out2 = await composeVideoFromFile(src, { aspect: 16 / 9, zoom: 1, panX: 0, panY: 0, filter: null });
  console.log("  saída:", out2.mediaMetadata.width + "x" + out2.mediaMetadata.height);
  ck("16:9 sai deitado", out2.mediaMetadata.width > out2.mediaMetadata.height,
    out2.mediaMetadata.width + "x" + out2.mediaMetadata.height);
  ck("não amplia: largura do recorte = 1080 da fonte em pé", out2.mediaMetadata.width === 1080,
    out2.mediaMetadata.width + "");

  console.log("\n[trim] fonte de 90s corta em MAX_COMPOSE_SECONDS");
  const long = path.join(dir, "long.mp4");
  await run(["-y", "-f", "lavfi", "-i", "testsrc2=size=640x360:rate=15:duration=90",
    "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", long]);
  const out3 = await composeVideoFromFile(long, { aspect: 16 / 9, zoom: 1, panX: 0, panY: 0, filter: null });
  const p3 = path.join(dir, "l.mp4"); await fsp.writeFile(p3, out3.buffer);
  const i3 = await probe(p3);
  const d = (i3.match(/Duration:\s*(\d+):(\d+):([\d.]+)/) || []);
  const secs = d.length ? (+d[1] * 3600 + +d[2] * 60 + +d[3]) : -1;
  ck("cortado em ~70s", Math.abs(secs - 70) < 1.5, secs + "s");
  ck("metadado diz 70s", out3.mediaMetadata.duration_seconds === 70, out3.mediaMetadata.duration_seconds + "");

  console.log("\n" + pass + "/" + (pass + fail) + " checks");
  if (!fail) await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error("ERRO:", e.message); process.exit(1); });
