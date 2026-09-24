/**
 * AS DECISÕES DE CUSTO DA MONTAGEM DE VÍDEO — puras, para serem testadas.
 *
 * Mora fora de `mediaProcessing` porque lá tudo roda ffmpeg; aqui nada roda.
 */

/**
 * PODE COPIAR SEM RECODIFICAR?
 *
 * ⚠️ Medido antes desta regra: um vídeo de celular 1080x1920 sem edição entrava
 * com 8,3 MB e SAÍA com 8,7 MB — CPU gasta para devolver um arquivo maior e com
 * perda de geração. Quando nada muda, `-c copy` custa milissegundos.
 *
 * A regra é CONSERVADORA de propósito: qualquer dúvida vira encode, que é o
 * comportamento de sempre. Errar para "copiar" publicaria um arquivo que o
 * player não toca (HEVC num navegador sem suporte, 10 bits, rotação que o
 * player ignora); errar para "recodificar" só gasta CPU.
 *
 * @param {object} info   saída de `parseProbe`
 * @param {object} plan   o que a montagem ia fazer
 */
function canStreamCopy(info, plan) {
  if (!info || !plan) return false;
  // Formato que todo navegador toca. HEVC do iPhone, VP9 do webm e 10 bits
  // ficam de fora: é para isso que a montagem existe.
  if (info.videoCodec !== "h264") return false;
  if (info.pixFmt !== "yuv420p") return false;
  // A rotação do celular vive em side data; alguns players a ignoram, e o
  // encode é o que a "assa" no quadro.
  if (Number(info.rotation || 0) % 360 !== 0) return false;
  if (!info.width || !info.height) return false;

  const { crop, outW, outH } = plan;
  // O recorte é o quadro inteiro e a saída tem o tamanho da fonte — o que já
  // implica proporção exata e lado curto dentro do teto.
  if (!crop || crop.x !== 0 || crop.y !== 0) return false;
  if (crop.w !== info.width || crop.h !== info.height) return false;
  if (outW !== info.width || outH !== info.height) return false;

  // Qualquer coisa desenhada por cima ou mexida na cor exige encode.
  if (plan.hasLut || plan.hasOverlay || plan.hasPip) return false;
  if (Number(plan.grain || 0) > 0.001) return false;

  // Áudio: AAC passa copiado; outro codec (opus do webm) exigiria encode.
  if (info.hasAudio && info.audioCodec !== "aac") return false;

  // Sem corte de tempo: com cópia o corte cai no quadro-chave mais próximo, e o
  // story tem CHECK de duração no banco. Só copia o que já cabe no teto.
  if (info.duration == null) return false;
  if (info.duration > Number(plan.maxSeconds) + 0.05) return false;

  // O arquivo copiado é o arquivo de entrada: tem que caber no teto de saída.
  if (!(Number(plan.inputBytes) > 0) || Number(plan.inputBytes) > Number(plan.maxBytes)) {
    return false;
  }
  return true;
}

/**
 * TETO DE BITRATE PARA CABER NO LIMITE NUMA PASSADA SÓ.
 *
 * ⚠️ Sem teto, o vídeo longo e agitado passava de 50 MB e a montagem refazia o
 * encode INTEIRO com CRF 28 — o dobro de CPU exatamente no caso mais caro. O CRF
 * continua mandando no caso comum; o teto só morde quando o orçamento aperta.
 * 8% de folga cobre o contêiner e a oscilação do VBV.
 *
 * @returns {{maxrateK:number, bufsizeK:number}}
 */
function sizeCapBitrate(seconds, maxBytes, audioKbps = 128) {
  const s = Math.max(1, Number(seconds) || 1);
  const totalK = (Number(maxBytes) * 8 * 0.92) / s / 1000;
  const videoK = Math.max(500, Math.floor(totalK - audioKbps));
  return { maxrateK: videoK, bufsizeK: videoK * 2 };
}

module.exports = { canStreamCopy, sizeCapBitrate };
