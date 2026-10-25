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
// valer nele. A sala converte para o próprio passo com uma folga FIXA (`doff`,
// medida na primeira mensagem: DRIVE_MARGIN passos à frente).
//
// mm3d-22b — CHEGOU TARDE (pico de rede no 4G, zigue-zague rápido): a sala
// VOLTA NO TEMPO só deste veículo. Ela guarda os últimos HIST passos (estado
// + volante); com uma mudança atrasada, restaura o passo anterior ao marcado,
// aplica a mudança e re-simula até agora. Antes, a mudança valia "já" e a
// folga crescia: o trajeto divergia (até ~1 m num pico de 1 s) e o celular
// era puxado. A folga não muda mais (mudar a folga também desalinha as
// mudanças seguintes); só se a mudança vier mais atrasada do que a história
// guardada, ela vale no passo mais antigo possível e a folga se reajusta.
//
// Como a física é determinística, os dois trajetos ficam iguais e a
// reconciliação não tem o que corrigir. Cliente antigo (sem `k`): como antes.
//
// mm3d-27 — ABA EM SEGUNDO PLANO: o navegador para o laço do celular (sem
// passos, sem mensagens) e a sala seguia com o último volante — acelerando,
// o carro andava ~70 m sozinho em 5 s e, na volta, o passo `k` velho caía no
// "chegou tarde" (volta 2 s no tempo com o volante errado). Agora:
// - o celular manda FREIO ao esconder a aba e repete o volante a cada
//   DRIVE_BEAT_MS enquanto dirige; sem notícia por DRIVE_STALE_MS a sala
//   freia sozinha (`expireDrive`) — vale também para celular que travou;
// - ao voltar, o celular assume o estado da sala e começa uma ÉPOCA nova
//   (`e`): o passo recomeça do zero e a sala mede a folga de novo, sem
//   voltar no tempo com mudanças da época anterior.

const { STEP, MAX_STEPS, stepVehicle } = require("./meuMundoVehicle");

/** Passos entre mudanças de volante no cliente (20 Hz). */
const DRIVE_EVERY = 3;
/** Folga da sala (passos de 1/60 s ≈ 200 ms): a oscilação normal chega antes. */
const DRIVE_MARGIN = 12;
/** Passos guardados para voltar no tempo (2 s). */
const HIST = 120;
/** Adiantada além disto (passos, 2 s): a folga encolhe (relógio do cliente atrasou). */
const DRIVE_EARLY = 120;
const QUEUE_MAX = 64;
/** Sem volante do motorista há tanto tempo (ms), a sala freia (aba escondida, celular travado). */
const DRIVE_STALE_MS = 1500;
/** Freio de quem sumiu: sem acelerador, freio cheio, volante reto. */
const STALE_DRIVE = Object.freeze({ t: 0, b: 1, s: 0, h: false });
/** Já parado: solta o freio (segurar o freio parado engata a ré). */
const PARKED_DRIVE = Object.freeze({ t: 0, b: 0, s: 0, h: false });

const FIELDS = ["x", "z", "yaw", "vx", "vz", "w", "steer", "thr", "hb", "ax", "ay", "u", "slip", "beta", "gear", "stopT"];

function snap(v) {
  const s = { dn: v.dn || 0, drive: v.drive };
  for (const f of FIELDS) s[f] = v[f];
  return s;
}

function restore(v, s) {
  for (const f of FIELDS) v[f] = s[f];
  v.dn = s.dn;
  v.drive = s.drive;
}

let seq = 0;

/**
 * Mudança de volante recebida (`d` já higienizado). `k` = passo do cliente;
 * `e` = época do cliente (mm3d-27): época nova = passo recomeça, folga medida
 * de novo, fila e "volta no tempo" da época anterior descartadas.
 */
function queueDrive(v, d, k, e) {
  if (!v) return;
  if (!Number.isInteger(k) || k < 0) {
    v.dq = null;
    v.drive = d;
    return;
  }
  if (Number.isInteger(e) && e !== v.de) {
    v.de = e;
    delete v.doff;
    v.dq = [];
    v.applied = [];
    v.rewind = null;
  }
  v.stale = false;
  const next = (v.dn || 0) + 1;
  if (typeof v.doff !== "number") v.doff = next - k + DRIVE_MARGIN;
  let at = k + v.doff;
  if (at < next) {
    // Tarde: volta no tempo, se ainda houver história desse passo.
    const oldest = v.hist && v.hist.length ? v.hist[0].dn + 1 : next;
    if (at < oldest) {
      v.doff += oldest - at;
      at = oldest;
    }
    if (at < next) v.rewind = Math.min(v.rewind ?? Infinity, at);
  } else if (at > next + DRIVE_EARLY) {
    v.doff -= at - next - DRIVE_MARGIN;
    at = next + DRIVE_MARGIN;
  }
  const q = v.dq || (v.dq = []);
  q.push({ at, d, seq: ++seq });
  if (q.length > 1 && q[q.length - 2].at > at) q.sort((a, b) => a.at - b.at || a.seq - b.seq);
  if (q.length > QUEUE_MAX) q.splice(0, q.length - QUEUE_MAX);
}

/** Um passo: troca o volante marcado para ele, simula e guarda a história. */
function stepOne(v, fallback, boxes, limit, P) {
  const q = v.dq;
  if (!v.hist) v.hist = [snap(v)];
  const at = (v.dn || 0) + 1;
  while (q && q.length && q[0].at <= at) {
    const m = q.shift();
    v.drive = m.d;
    (v.applied || (v.applied = [])).push(m);
  }
  if (v.stale && v.drive === STALE_DRIVE && v.stopT > 0.2) v.drive = PARKED_DRIVE;
  stepVehicle(v, q ? v.drive || fallback : fallback, boxes, limit, P);
  v.dn = at;
  v.hist.push(snap(v));
  if (v.hist.length > HIST) v.hist.shift();
  // Mudança anterior ao estado mais antigo guardado não volta mais à fila.
  while (v.applied && v.applied.length && v.applied[0].at <= v.hist[0].dn) v.applied.shift();
}

/** Volta ao passo anterior à mudança atrasada e re-simula até onde estava. */
function replay(v, fallback, boxes, limit, P) {
  const from = v.rewind - 1;
  v.rewind = null;
  const h = v.hist && v.hist.find((s) => s.dn === from);
  if (!h) return;
  const target = v.dn || 0;
  const back = (v.applied || []).filter((m) => m.at > from);
  v.applied = (v.applied || []).filter((m) => m.at <= from);
  v.dq = (v.dq || []).concat(back).sort((a, b) => a.at - b.at || a.seq - b.seq);
  v.hist = v.hist.filter((s) => s.dn <= from);
  restore(v, h);
  while ((v.dn || 0) < target) stepOne(v, fallback, boxes, limit, P);
}

/**
 * Avança o veículo pelo tempo real `dt` em passos fixos, trocando o volante
 * no passo marcado. `fallback` = volante de cliente antigo (sem fila).
 */
function advanceDriven(v, fallback, dt, boxes, limit, P) {
  if (v.rewind != null) replay(v, fallback, boxes, limit, P);
  v.acc = Math.min(v.acc + Math.max(0, dt), STEP * MAX_STEPS);
  let n = 0;
  while (v.acc >= STEP) {
    stepOne(v, fallback, boxes, limit, P);
    v.acc -= STEP;
    n++;
  }
  return n;
}

/**
 * Pedido para descer (mm3d-24): a sala anda atrás do celular (a folga do
 * volante), então quando a pessoa já parou lá, aqui o veículo ainda freia — a
 * descida era recusada ("moving") e, aceita, o veículo estacionava antes do
 * ponto em que a pessoa o viu parar. Numa CÓPIA, aplica as mudanças que já
 * chegaram e segue até parar (no máximo `max` passos). Devolve a cópia.
 */
function settleDriven(v, fallback, boxes, limit, P, max = 90) {
  const c = { acc: 0, dn: v.dn || 0, drive: v.drive };
  for (const f of FIELDS) c[f] = v[f];
  const q = (v.dq || []).slice();
  for (let i = 0; i < max; i++) {
    const at = c.dn + 1;
    while (q.length && q[0].at <= at) c.drive = q.shift().d;
    const d = v.dq ? c.drive || fallback : fallback;
    if (!q.length && Math.hypot(c.vx, c.vz) < 0.05 && !(d && d.t > 0)) break;
    stepVehicle(c, d, boxes, limit, P);
    c.dn = at;
  }
  return c;
}

/**
 * Motorista sem notícia há `quietMs` (mm3d-27): a partir do próximo passo o
 * veículo freia (fila descartada). Devolve true quando acabou de expirar.
 * Só para quem manda época (cliente que repete o volante); cliente antigo não.
 */
function expireDrive(v, quietMs) {
  if (!v || v.de == null || !(quietMs >= DRIVE_STALE_MS) || v.stale) return false;
  v.stale = true;
  v.drive = STALE_DRIVE;
  if (v.dq) v.dq = [];
  v.applied = [];
  v.rewind = null;
  return true;
}

module.exports = { DRIVE_EVERY, DRIVE_MARGIN, HIST, DRIVE_STALE_MS, STALE_DRIVE, queueDrive, advanceDriven, settleDriven, expireDrive };
