// src/utils/meuMundoDriveSync.js — MEU MUNDO 3D: volante marcado pelo passo (mm3d-22)
//
// O PROBLEMA: a sala simula a 20 Hz (blocos de 3 passos de física) e aplicava
// o volante no bloco em que a mensagem chegava; o cliente já tinha aplicado
// em outro passo. Numa curva os dois trajetos se afastavam (~0,3 m) e a
// reconciliação do cliente puxava o veículo de lado 10×/s — o "empurrado
// para o lado nas curvas" de carro, bike, skate e patins.
//
// COMO FICOU: o cliente só muda o volante a cada DRIVE_EVERY passos e manda
// a mudança com o passo `k` (contado desde que montou) em que ela passou a
// valer nele. A sala converte para o próprio passo com uma folga (`off`):
// na primeira mensagem, folga = DRIVE_MARGIN passos; chegou tarde, vale já e
// a folga cresce o quanto faltou; folga sobrando muito, encolhe 1 passo por
// mensagem. Como a física é determinística, os dois trajetos ficam iguais e a
// reconciliação não tem o que corrigir. Cliente antigo (sem `k`): como antes.

const { STEP, MAX_STEPS, stepVehicle } = require("./meuMundoVehicle");

/** Passos entre mudanças de volante no cliente (20 Hz). */
const DRIVE_EVERY = 3;
/** Folga inicial da sala (passos de 1/60 s ≈ 100 ms). */
const DRIVE_MARGIN = 6;
/** Folga acima disto (passos) encolhe aos poucos. */
const DRIVE_SLACK = 30;
const QUEUE_MAX = 64;

/** Mudança de volante recebida (`d` já higienizado). `k` = passo do cliente. */
function queueDrive(v, d, k) {
  if (!v) return;
  if (!Number.isInteger(k) || k < 0) {
    v.dq = null;
    v.drive = d;
    return;
  }
  const n = v.dn || 0;
  const next = n + 1;
  if (typeof v.doff !== "number") v.doff = next - k + DRIVE_MARGIN;
  let at = k + v.doff;
  if (at < next) {
    v.doff += next - at;
    at = next;
  } else if (at > next + DRIVE_SLACK) {
    v.doff -= 1;
    at -= 1;
  }
  const q = v.dq || (v.dq = []);
  q.push({ at, d });
  if (q.length > 1 && q[q.length - 2].at > at) q.sort((a, b) => a.at - b.at);
  if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
}

/**
 * Avança o veículo pelo tempo real `dt` em passos fixos, trocando o volante
 * no passo marcado. `fallback` = volante de cliente antigo (sem fila).
 */
function advanceDriven(v, fallback, dt, boxes, limit, P) {
  v.acc = Math.min(v.acc + Math.max(0, dt), STEP * MAX_STEPS);
  let n = 0;
  while (v.acc >= STEP) {
    const q = v.dq;
    while (q && q.length && q[0].at <= (v.dn || 0) + 1) v.drive = q.shift().d;
    stepVehicle(v, q ? v.drive || fallback : fallback, boxes, limit, P);
    v.dn = (v.dn || 0) + 1;
    v.acc -= STEP;
    n++;
  }
  return n;
}

module.exports = { DRIVE_EVERY, DRIVE_MARGIN, queueDrive, advanceDriven };
