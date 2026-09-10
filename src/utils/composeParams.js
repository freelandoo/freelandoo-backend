// src/utils/composeParams.js
//
// Fronteira de confiança da composição no servidor: valida o que o cliente
// manda no campo `compose` do multipart antes que qualquer número disso vire
// argumento de filtro do ffmpeg.
//
// ⚠️ POR QUE ISTO É UM ARQUIVO PRÓPRIO, e não umas linhas no service: estes
// valores terminam INTERPOLADOS numa string de filtro (`crop=...`,
// `overlay=x=main_w*...`). Coeridos na hora do uso, um `NaN` vindo de fora
// produziria um grafo inválido e o erro apareceria como "não foi possível
// otimizar esse vídeo", falando do encoder em vez do pedido. Validando aqui,
// tudo que chega ao ffmpeg é número finito e dentro de faixa, por construção.

// Proporções que o composer oferece — 9:16 (0.5625) até 16:9 (1.778). A faixa
// é generosa de propósito (o front pode ganhar uma proporção nova sem migração
// aqui), mas fechada: aspect fora dela não é enquadramento, é entrada torta.
const MIN_ASPECT = 0.2;
const MAX_ASPECT = 5;
const MAX_ZOOM = 10;

function finite(value, fallback) {
  // ⚠️ AUSENTE NÃO É ZERO. `Number(null)` e `Number("")` valem 0 e passam no
  // isFinite, então sem esta guarda um `tint: [1, 1, null]` viraria multiplicar
  // o azul por ZERO — o canal sumia e a foto saía amarela — em vez de cair no
  // neutro 1. Nos outros campos o neutro é o próprio 0 e o defeito ficaria
  // escondido; no tint ele aparece na cara.
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(n, lo, hi) {
  return n < lo ? lo : n > hi ? hi : n;
}

/** Normaliza o FilterState do composer. Tudo que não for número vira neutro. */
function normalizeFilter(raw) {
  if (!raw || typeof raw !== "object") return null;
  const tintRaw = Array.isArray(raw.tint) ? raw.tint : [1, 1, 1];
  return {
    brightness: clamp(finite(raw.brightness, 0), -1, 1),
    contrast: clamp(finite(raw.contrast, 0), -1, 1),
    saturation: clamp(finite(raw.saturation, 0), -1, 1),
    temperature: clamp(finite(raw.temperature, 0), -1, 1),
    // Vinheta NÃO é usada aqui: ela é espacial e vem assada no PNG de
    // sobreposição (multiplicar por `vig` é o mesmo que compor preto com alfa
    // `1-vig`). Fica no objeto só para o formato bater com o do front.
    vignette: clamp(finite(raw.vignette, 0), 0, 1),
    grain: clamp(finite(raw.grain, 0), 0, 1),
    mono: clamp(finite(raw.mono, 0), 0, 1),
    tint: [
      clamp(finite(tintRaw[0], 1), 0, 4),
      clamp(finite(tintRaw[1], 1), 0, 4),
      clamp(finite(tintRaw[2], 1), 0, 4),
    ],
    tintStrength: clamp(finite(raw.tintStrength, 0), 0, 1),
  };
}

/**
 * Lê o campo `compose` do corpo multipart.
 *
 * @returns `null` quando ausente (o upload segue pelo caminho de sempre),
 *          `{ error }` quando inválido, ou os parâmetros já normalizados.
 */
function parseComposeParams(raw) {
  if (raw === undefined || raw === null || raw === "") return null;

  let data = raw;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      return { error: "compose inválido" };
    }
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { error: "compose inválido" };
  }

  // ⚠️ Aspect é RECUSADO, não corrigido para um padrão: ele decide o formato do
  // vídeo publicado, e cair no 9:16 em silêncio entregaria uma peça com
  // enquadramento diferente do que a pessoa viu no editor.
  const aspect = Number(data.aspect);
  if (!Number.isFinite(aspect) || aspect < MIN_ASPECT || aspect > MAX_ASPECT) {
    return { error: "aspect inválido" };
  }

  const out = {
    aspect,
    zoom: clamp(finite(data.zoom, 1), 1, MAX_ZOOM),
    panX: clamp(finite(data.panX, 0), -1, 1),
    panY: clamp(finite(data.panY, 0), -1, 1),
    filter: normalizeFilter(data.filter),
    pip: null,
  };

  if (data.pip && typeof data.pip === "object") {
    out.pip = {
      x: clamp(finite(data.pip.x, 0.5), 0, 1),
      y: clamp(finite(data.pip.y, 0.5), 0, 1),
      scale: clamp(finite(data.pip.scale, 0.4), 0.05, 1),
    };
  }

  return out;
}

module.exports = { parseComposeParams, normalizeFilter, MIN_ASPECT, MAX_ASPECT, MAX_ZOOM };
