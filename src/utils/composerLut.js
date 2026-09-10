// src/utils/composerLut.js
//
// Gera uma LUT 3D (.cube) a partir do FilterState do composer.
//
// ⚠️ ISTO É A TRANSCRIÇÃO LITERAL do FRAG do editor (front,
// lib/camera/renderer.ts) — mesma ordem, mesmas constantes. É o que faz o
// PREVIEW e o EXPORT baterem: o celular mostra o shader, o servidor aplica a
// MESMA função, ponto a ponto. Reescrever "aproximando" com `eq`/`colorbalance`
// daria duas cores para a mesma foto, e a divergência só apareceria depois de
// publicado.
//
// ⚠️ VINHETA E GRÃO FICAM DE FORA, e não por esquecimento: os dois dependem da
// POSIÇÃO do pixel, e uma LUT só sabe converter cor→cor. A vinheta vai no PNG
// de sobreposição (multiplicar por `vig` é o mesmo que compor preto com alfa
// `1-vig` — ver overlay-png.ts no front) e o grão vira o filtro `noise` do
// ffmpeg, que precisa mudar a cada quadro: assado num PNG viraria sujeira
// parada na lente.

const LUT_SIZE = 33; // 33³ = 35937 amostras — o padrão da indústria.

/** Filtro neutro: nada a aplicar. */
function isNeutralFilter(f) {
  if (!f) return true;
  const tint = Array.isArray(f.tint) ? f.tint : [1, 1, 1];
  const tintIsNeutral = tint[0] === 1 && tint[1] === 1 && tint[2] === 1;
  return (
    !num(f.brightness) &&
    !num(f.contrast) &&
    !num(f.saturation) &&
    !num(f.temperature) &&
    !num(f.mono) &&
    (!num(f.tintStrength) || tintIsNeutral)
  );
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Aplica a cadeia do shader a um RGB em 0..1. Ordem idêntica ao FRAG. */
function applyChain(r, g, b, f) {
  const temperature = num(f.temperature);
  const brightness = num(f.brightness);
  const contrast = num(f.contrast);
  const saturation = num(f.saturation);
  const mono = num(f.mono);
  const tint = Array.isArray(f.tint) ? f.tint.map(num) : [1, 1, 1];
  const tintStrength = num(f.tintStrength);

  // temperatura (desloca R/B)
  r += temperature * 0.12;
  b -= temperature * 0.12;

  // brilho
  r += brightness * 0.3;
  g += brightness * 0.3;
  b += brightness * 0.3;

  // contraste
  r = (r - 0.5) * (1 + contrast) + 0.5;
  g = (g - 0.5) * (1 + contrast) + 0.5;
  b = (b - 0.5) * (1 + contrast) + 0.5;

  // saturação + mono
  // ⚠️ `lum` é calculado UMA vez e as duas misturas usam esse mesmo escalar —
  // é o que o shader faz. Recalcular entre as duas mudaria o resultado do P&B.
  const lum = r * 0.299 + g * 0.587 + b * 0.114;
  const sat = 1 + saturation;
  r = lum + (r - lum) * sat;
  g = lum + (g - lum) * sat;
  b = lum + (b - lum) * sat;
  r = r + (lum - r) * mono;
  g = g + (lum - g) * mono;
  b = b + (lum - b) * mono;

  // tint (papel/sépia)
  r = r + (r * (tint[0] ?? 1) - r) * tintStrength;
  g = g + (g * (tint[1] ?? 1) - g) * tintStrength;
  b = b + (b * (tint[2] ?? 1) - b) * tintStrength;

  return [clamp01(r), clamp01(g), clamp01(b)];
}

/**
 * Monta o conteúdo de um arquivo .cube para o filtro `lut3d` do ffmpeg.
 * Devolve `null` quando o filtro é neutro — assim o chamador simplesmente não
 * acrescenta o `lut3d` ao grafo em vez de pagar por uma LUT identidade.
 */
function buildCubeLut(filter) {
  if (isNeutralFilter(filter)) return null;

  const lines = [
    "# Freelandoo composer LUT",
    `LUT_3D_SIZE ${LUT_SIZE}`,
    "DOMAIN_MIN 0.0 0.0 0.0",
    "DOMAIN_MAX 1.0 1.0 1.0",
  ];

  const last = LUT_SIZE - 1;
  // Ordem do .cube: o vermelho varia primeiro (índice mais rápido).
  for (let bi = 0; bi <= last; bi++) {
    for (let gi = 0; gi <= last; gi++) {
      for (let ri = 0; ri <= last; ri++) {
        const [r, g, b] = applyChain(ri / last, gi / last, bi / last, filter);
        lines.push(`${r.toFixed(6)} ${g.toFixed(6)} ${b.toFixed(6)}`);
      }
    }
  }
  return lines.join("\n") + "\n";
}

module.exports = { buildCubeLut, isNeutralFilter, applyChain, LUT_SIZE };
