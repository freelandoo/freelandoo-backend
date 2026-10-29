// GERADO por scripts/build-gincana-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/gincana/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── sim/course.ts ────────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/course.ts — GINCANA (mm3d-47): o percurso.
//
// Corrida de obstáculos sobre o mar, do gênero do vídeo do Alex, com
// percurso próprio. Tudo aqui é FUNÇÃO DO TEMPO DA PROVA (`t`, s depois do
// "vai"): barras que giram, pêndulos, luvas e bolas que rolam ficam no mesmo
// lugar em todos os aparelhos e na sala — ninguém precisa mandar onde estão.
//
// Regra única: o navegador e a sala (src/utils/meuMundoGincana.js, GERADO
// deste diretório por scripts/build-gincana-sim.js no back) usam os mesmos
// números. Metros, segundos; y para cima; a prova corre para +z.
//
// Trechos:
//  1. Carrossel   — discos infláveis com barras girando (pule a barra baixa).
//  2. Passarelas  — vigas estreitas que se cruzam, bolas de pêndulo.
//  3. Luvas       — campo rosa com luvas de boxe socando dos lados.
//  4. Xadrez      — piso que treme e cai depois que alguém pisa.
//  5. Subida      — rampa com bolas gigantes rolando para baixo; chegada no topo.

/** Altura do tampo das plataformas; a água fica em y = 0. */
const DECK = 3

const GINCANA = {
  step: 1 / 60,
  // mm3d-47b: mais rápido e mais seco (o Alex achou lento e o pulo mole)
  gravity: 30,
  run: 8.2,
  accel: 58,
  /** Controle no ar (fração da aceleração do chão). */
  airControl: 0.72,
  /** Pulo: 9,6 m/s com g 30 → ~1,54 m de altura, 0,64 s no ar. */
  jumpV: 9.6,
  coyote: 0.12,
  /** Apertou pular um pouco antes de poder (no ar, chegando ao chão): vale por isto (s). */
  jumpBuffer: 0.15,
  bodyR: 0.4,
  bodyH: 1.7,
  stepUp: 0.45,
  /** Mergulho: para a frente, um pouco para cima; depois desliza e levanta. */
  diveV: 11.5,
  diveUp: 4.4,
  slideT: 0.45,
  riseT: 0.4,
  /** Derrubado por obstáculo: sem controle por isto (s); depois levanta. */
  stunT: 0.9,
  /** Abaixo disto caiu na água: volta ao último posto depois de `respawnT`. */
  waterY: -0.6,
  respawnT: 1.3,
  /** Depois de voltar: nada derruba por isto (s). */
  shieldT: 1.2,
  /** Logo da Freelandoo (mm3d-47b): turbo com brilho — velocidade ×boost por boostT s; o logo volta para quem pegou depois de logoBack s. */
  boost: 1.5,
  boostT: 3.5,
  logoR: 1.25,
  logoBack: 12,
  /** Prova: limite depois do "vai" e contagem antes. */
  timeLimit: 180,
  countdown: 3,
}         

/** Paleta (índice = cor do tampo; as bordas infláveis usam a cor do par). Turquesa (3) é a cor do mar: nunca no tampo. */
const GINCANA_COLORS = ["#FF6A13", "#FFD21F", "#FF5FA8", "#19C6D1", "#8A4DFF", "#63E05A", "#2F7BFF", "#FFFFFF"]         

/**
 * Plataforma: 0 = disco (r), 1 = caixa girada (hx, hz, rot), 2 = rampa
 * (caixa sem giro; o tampo sobe de `y` em z−hz até `y2` em z+hz).
 * `d` = espessura (abaixo do tampo é parede: empurra de lado).
 */
                      
              
           
           
           
            
            
             
           
            
           
                                                             
           
             
                                                
           
 

/** Coluna (pilar do carrossel, frade do campo, poste da luva): empurra de lado e dá para subir. */
                       
           
           
           
            
            
           
 

/** Barra girando em volta de (x, z); `both` = atravessa o disco inteiro. */
                          
           
           
           
             
           
           
            
               
 

/** Bola de pêndulo que balança no eixo x, pendurada em (x, py, z). */
                           
           
           
            
             
           
             
           
            
 

/** Luva de boxe que soca para dentro do campo a partir de x0 (dir = ±1). */
                        
            
           
           
             
               
           
                
            
 

/** Ladrilho do xadrez (cai `tileWarn` s depois de pisado, volta depois de `tileGone`). */
                       
           
           
           
           
 

/** Posto de volta (quem cai na água volta aqui). */
                             
           
           
           
                                               
           
 

const pads        = []
const posts         = []
const sweepers            = []
const pendulums             = []
const gloves          = []
const tiles         = []

function box(x        , z        , hx        , hz        , c        , rim        , s        , rot = 0, d = 1.4) {
  pads.push({ k: 1, x, z, r: 0, hx, hz, rot, y: DECK, y2: DECK, d, c, rim, s })
}
function disc(x        , z        , r        , c        , rim        , s        ) {
  pads.push({ k: 0, x, z, r, hx: r, hz: r, rot: 0, y: DECK, y2: DECK, d: 1.6, c, rim, s })
}
/** Viga de (x0, z0) a (x1, z1), largura `w`. */
function beam(x0        , z0        , x1        , z1        , w        , c        , rim        , s        ) {
  const L = Math.hypot(x1 - x0, z1 - z0)
  box((x0 + x1) / 2, (z0 + z1) / 2, w / 2, L / 2, c, rim, s, Math.atan2(x1 - x0, z1 - z0), 0.7)
}

// ── 0. largada ───────────────────────────────────────────────────────────────
box(0, 0, 10, 8, 6, 7, 0)
// ponte larga: quem larga na ponta e corre reto não cai na água
box(0, 11.5, 7, 3.6, 0, 1, 0)

// ── 1. carrossel ─────────────────────────────────────────────────────────────
const carousel = (x        , z        , r        , w        , a0        , both         , c        ) => {
  disc(x, z, r, c, 1, 1)
  posts.push({ x, z, r: 0.8, y0: DECK, y1: DECK + 2.4, c: 1 })
  sweepers.push({ x, z, y: DECK + 0.55, len: r + 0.3, r: 0.32, w, a0, both })
}
carousel(0, 24, 9, 1.15, 0, false, 0)
for (const s of [-1, 1]) box(4.5 * s, 35.2, 1.6, 4.3, 2, 7, 1)
carousel(-6.5, 46, 7, -1.4, 0.6, false, 4)
carousel(6.5, 46, 7, 1.7, 1.9, false, 4)
for (const s of [-1, 1]) box(4.5 * s, 55, 1.6, 3.2, 2, 7, 1)
carousel(0, 66, 9.5, 0.95, 0.4, true, 0)
box(0, 79, 2.2, 4, 6, 7, 1)

// ── 2. passarelas ────────────────────────────────────────────────────────────
box(0, 87, 8, 4, 1, 0, 2)
const LANES = [-5, 0, 5]
for (const x of LANES) beam(x, 90.6, x, 105, 1.5, 0, 1, 2)
for (const x of LANES) disc(x, 105, 1.7, 1, 0, 2)
beam(-5, 105, -5, 119, 1.5, 0, 1, 2)
beam(5, 105, 5, 119, 1.5, 0, 1, 2)
beam(0, 105, -5, 119, 1.5, 0, 1, 2)
beam(0, 105, 5, 119, 1.5, 0, 1, 2)
for (const x of LANES) disc(x, 119, 1.7, 1, 0, 2)
for (const x of LANES) beam(x, 119, x, 133.4, 1.5, 0, 1, 2)
const swing = (x        , z        , ph        ) => pendulums.push({ x, z, py: DECK + 9, len: 7.4, R: 1.1, amp: 0.95, w: 2.2, ph })
swing(-5, 98, 0)
swing(0, 98, 2.1)
swing(5, 98, 4.2)
swing(-5, 112, 1.1)
swing(-2.5, 112, 3.3)
swing(2.5, 112, 0.2)
swing(5, 112, 2.6)
swing(-5, 126, 3.9)
swing(0, 126, 1.6)
swing(5, 126, 5.0)

// ── 3. luvas ─────────────────────────────────────────────────────────────────
box(0, 137, 8, 4, 6, 7, 3)
box(0, 162, 7, 21, 2, 4, 3)
for (let i = 0; i < 7; i++) {
  const left = i % 2 === 0
  const z = 146 + i * 5
  const x0 = left ? -9.4 : 9.4
  gloves.push({ x0, z, y: DECK + 1.0, dir: left ? 1 : -1, reach: 8.2, R: 1.15, period: 2.6, ph: i * 0.83 })
  posts.push({ x: x0, z, r: 1.0, y0: -1, y1: DECK + 2.2, c: 6 })
}
for (const [x, z] of [[-3, 149], [3.5, 153], [0, 158], [-4, 164], [2.5, 168], [-1.5, 174], [4, 178]]                      ) {
  posts.push({ x, z, r: 0.55, y0: DECK, y1: DECK + 1.1, c: 4 })
}

// ── 4. xadrez ────────────────────────────────────────────────────────────────
box(0, 187.3, 7, 4.3, 1, 0, 4)
const TILE_COLS = 6
const TILE_ROWS = 7
const TILE_PITCH = 2.9
const TILE_HALF = 1.3
const TILE_Z0 = 193
for (let r = 0; r < TILE_ROWS; r++) {
  for (let c = 0; c < TILE_COLS; c++) {
    tiles.push({ x: (c - (TILE_COLS - 1) / 2) * TILE_PITCH, z: TILE_Z0 + r * TILE_PITCH, h: TILE_HALF, c: (r + c) % 2 === 0 ? 2 : 5 })
  }
}
box(0, 216.5, 7, 4.7, 6, 7, 4)

// ── 5. subida e chegada ──────────────────────────────────────────────────────
const RAMP = { z0: 221.2, z1: 257.2, y0: DECK, y1: DECK + 6, hx: 6 }         
pads.push({ k: 2, x: 0, z: (RAMP.z0 + RAMP.z1) / 2, r: 0, hx: RAMP.hx, hz: (RAMP.z1 - RAMP.z0) / 2, rot: 0, y: RAMP.y0, y2: RAMP.y1, d: 1.4, c: 0, rim: 1, s: 5 })
pads.push({ k: 1, x: 0, z: 265, r: 0, hx: 9, hz: 7.8, rot: 0, y: RAMP.y1, y2: RAMP.y1, d: 1.6, c: 1, rim: 0, s: 6 })
/** Cruzou esta linha no alto = chegou. */
const FINISH_Z = 266
const FINISH_Y = RAMP.y1
/** Bolas da subida: faixas, intervalo, velocidade, raio. */
const BALLS = { lanes: [-4.3, -1.45, 1.45, 4.3], every: 0.95, v: 7.5, R: 1.2, zEnd: RAMP.z0 - 3 }         

const PADS                 = pads
const POSTS                  = posts
const SWEEPERS                     = sweepers
const PENDULUMS                      = pendulums
const GLOVES                   = gloves
const TILES                  = tiles
/** Tempos do ladrilho: treme, cai e fica fora, depois volta. */
const TILE_TIME = { warn: 0.7, gone: 4 }         

const CHECKPOINTS                        = [
  { x: 0, z: -3.5, y: DECK, w: 7 },
  { x: 0, z: 87, y: DECK, w: 6 },
  { x: 0, z: 137, y: DECK, w: 6 },
  { x: 0, z: 187, y: DECK, w: 5.5 },
  { x: 0, z: 216, y: DECK, w: 5.5 },
]

/** Lugar de largada da vaga (2 filas de 4) e de volta a um posto. */
function spawnAt(cp        , slot        ) {
  const c = CHECKPOINTS[Math.max(0, Math.min(CHECKPOINTS.length - 1, cp))]
  const col = slot % 4
  const row = Math.floor(slot / 4) % 2
  return { x: c.x + (col - 1.5) * Math.min(3.4, (c.w * 2) / 4), z: c.z - row * 2.6, y: c.y }
}

// ── o que se mexe ────────────────────────────────────────────────────────────

function sweeperAngle(s         , t        ) {
  return s.a0 + s.w * t
}

/** Centro da bola do pêndulo e velocidade em x. */
function pendulumAt(p          , t        ) {
  const th = p.amp * Math.sin(p.w * t + p.ph)
  const thd = p.amp * p.w * Math.cos(p.w * t + p.ph)
  return { x: p.x + p.len * Math.sin(th), y: p.py - p.len * Math.cos(th), z: p.z, vx: p.len * Math.cos(th) * thd, th }
}

/**
 * Quanto a luva está para fora (0–1) e se está socando (indo ou parada lá fora).
 * Ciclo: descansa, soca rápido, segura, volta devagar.
 */
function gloveAt(g       , t        ) {
  const u = (((t + g.ph) / g.period) % 1 + 1) % 1
  let e = 0
  let hot = false
  if (u >= 0.55 && u < 0.62) {
    const k = (u - 0.55) / 0.07
    e = 1 - (1 - k) * (1 - k)
    hot = true
  } else if (u >= 0.62 && u < 0.74) {
    e = 1
    hot = true
  } else if (u >= 0.74) e = 1 - (u - 0.74) / 0.26
  return { x: g.x0 + g.dir * g.reach * e, e, hot, u }
}

/** Faixa do número sorteado (0–3) ou -1 = sem bola nesta vez. */
function ballLane(seed        , i        ) {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  h = (h ^ (h >>> 13)) >>> 0
  if (h % 5 === 0) return -1
  return (h >>> 3) % BALLS.lanes.length
}

/**
 * Logos da Freelandoo (mm3d-47b): nos lugares abertos do caminho. Cada um é
 * de cada corredor (quem pega não tira dos outros): nada disso viaja na rede.
 */
const LOGOS                                                 = [
  [-4, 12.5], [0, 12.5], [4, 12.5],
  [0, 79],
  [-5, 87], [5, 87],
  [-5, 105], [0, 105], [5, 105],
  [0, 137],
  [-3.5, 151], [3.5, 161], [-3.5, 171],
  [0, 187.5],
  [-2.9, 216.5], [2.9, 216.5],
  [-4.3, 233], [0, 241], [4.3, 249],
].map(([x, z]) => ({ x, z, y: (z > RAMP.z0 ? rampTop(z) : DECK) + 1.1 }))

/** Altura do tampo da rampa em z. */
function rampTop(z        ) {
  const u = Math.max(0, Math.min(1, (z - RAMP.z0) / (RAMP.z1 - RAMP.z0)))
  return RAMP.y0 + (RAMP.y1 - RAMP.y0) * u
}

/** Bolas rolando agora: [x, y, z, faixa, índice] por bola. */
function ballsAt(seed        , t        , out          ) {
  out.length = 0
  if (t < 0) return out
  const span = (RAMP.z1 - BALLS.zEnd) / BALLS.v
  const i1 = Math.floor(t / BALLS.every)
  const i0 = Math.max(0, Math.floor((t - span) / BALLS.every))
  for (let i = i0; i <= i1; i++) {
    const lane = ballLane(seed, i)
    if (lane < 0) continue
    const z = RAMP.z1 - BALLS.v * (t - i * BALLS.every)
    if (z < BALLS.zEnd || z > RAMP.z1) continue
    // depois do pé da rampa a bola cai na água
    const y = z >= RAMP.z0 ? rampTop(z) + BALLS.R : DECK + BALLS.R - ((RAMP.z0 - z) / BALLS.v) ** 2 * 12
    out.push(BALLS.lanes[lane], y, z, lane, i)
  }
  return out
}

/** Ladrilho em pé (pode pisar) no tempo t, sabendo quando foi pisado (−1 = nunca). */
function tileUp(stepped        , t        ) {
  return stepped < 0 || t - stepped < TILE_TIME.warn || t - stepped >= TILE_TIME.warn + TILE_TIME.gone
}

/** Trecho da prova em que z está (1–5; 0 largada, 6 chegada) — para a interface. */
function sectionAt(z        ) {
  if (z < 15) return 0
  if (z < 83) return 1
  if (z < 133.4) return 2
  if (z < 183) return 3
  if (z < 221.2) return 4
  if (z < FINISH_Z) return 5
  return 6
}

// ── sim/body.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/body.ts — GINCANA (mm3d-47): o corpo de quem corre.
//
// Passo fixo (GINCANA.step). Anda pela intenção (direção no mundo, 0–1),
// pula, MERGULHA (para a frente; desliza de barriga e levanta), é derrubado
// pelo que se mexe (barra, pêndulo, luva, bola: voa, cai, levanta), cai na
// água (volta ao último posto) e chega. Mesmo código no aparelho (o meu
// corpo e os computadores do treino) e na sala (os computadores da partida).

/** Estados do corpo. */
const MODE = {
  RUN: 0,
  /** Mergulho no ar. */
  DIVE: 1,
  /** De barriga no chão depois do mergulho. */
  SLIDE: 2,
  /** Levantando. */
  RISE: 3,
  /** Derrubado: voa e cai, sem controle. */
  KNOCK: 4,
  /** Na água, esperando voltar. */
  WATER: 5,
  /** Chegou. */
  DONE: 6,
}         

                         
              
           
           
           
            
            
            
                
                 
                                  
             
              
                                                                               
               
                                                      
                
                                                
                 
                                                        
            
                                                
             
                                                                          
                
                                                                                     
                 
                                                     
               
                                                   
                
                                                                      
            
            
            
 

                            
                                    
            
            
                                                       
               
               
 

/** O mundo num instante: tempo da prova, semente das bolas e os ladrilhos. */
                           
           
              
                                                                    
                     
                                                                 
                 
 

/** Acontecimentos de um passo (para som, aviso e animação). */
                      
                                  
                                  
                                                                         
                                                          
                                  
                                            
                                               
                               
                                             

const IDLE_INTENT            = { mx: 0, mz: 0, jump: false, dive: false }

function newRunner(slot        )         {
  const p = spawnAt(0, slot)
  return { slot, x: p.x, y: p.y, z: p.z, vx: 0, vy: 0, vz: 0, facing: 0, ground: true, air: 0, mode: MODE.RUN, timer: 0, shield: 0, hitCool: 0, cp: 0, fin: -1, launch: GINCANA.jumpV, jumpBuf: 0, boost: 0, took: LOGOS.map(() => -99), px: p.x, py: p.y, pz: p.z }
}

const EDGE = 0.12

/** Chão mais alto até `reach` sob (x, z): altura e ladrilho (−1 = não é ladrilho); y = −∞ sem chão. */
function groundUnder(w          , x        , z        , reach        ) {
  let best = -Infinity
  let tile = -1
  for (const p of PADS) {
    let top        
    if (p.k === 0) {
      if (Math.hypot(x - p.x, z - p.z) > p.r + EDGE) continue
      top = p.y
    } else {
      const dx = x - p.x
      const dz = z - p.z
      const c = Math.cos(p.rot)
      const s = Math.sin(p.rot)
      const lx = dx * c - dz * s
      const lz = dx * s + dz * c
      if (Math.abs(lx) > p.hx + EDGE || Math.abs(lz) > p.hz + EDGE) continue
      top = p.k === 2 ? rampTop(z) : p.y
    }
    if (top <= reach && top > best) {
      best = top
      tile = -1
    }
  }
  for (const q of POSTS) {
    if (q.y1 <= reach && q.y1 > best && Math.hypot(x - q.x, z - q.z) <= q.r) {
      best = q.y1
      tile = -1
    }
  }
  if (z > TILES[0].z - 2 && z < TILES[TILES.length - 1].z + 2) {
    for (let i = 0; i < TILES.length; i++) {
      const q = TILES[i]
      if (Math.abs(x - q.x) > q.h + EDGE || Math.abs(z - q.z) > q.h + EDGE) continue
      if (!tileUp(w.tiles[i], w.t)) continue
      if (DECK <= reach && DECK > best) {
        best = DECK
        tile = i
      }
    }
  }
  return { y: best, tile }
}

/** Empurra para fora das paredes (lado das plataformas acima do pé) e das colunas. */
function pushWalls(b        , w          ) {
  const R = GINCANA.bodyR
  const H = GINCANA.bodyH
  const lift = b.y + GINCANA.stepUp
  for (const p of PADS) {
    const top = p.k === 2 ? rampTop(b.z) : p.y
    if (top <= lift || top - p.d >= b.y + H) continue
    if (p.k === 0) {
      const dx = b.x - p.x
      const dz = b.z - p.z
      const d = Math.hypot(dx, dz)
      if (d >= p.r + R || d < 1e-6) continue
      // por dentro: só se veio de baixo (caiu ao lado) — empurra para fora
      b.x = p.x + (dx / d) * (p.r + R)
      b.z = p.z + (dz / d) * (p.r + R)
      continue
    }
    const c = Math.cos(p.rot)
    const s = Math.sin(p.rot)
    const dx = b.x - p.x
    const dz = b.z - p.z
    const lx = dx * c - dz * s
    const lz = dx * s + dz * c
    const ox = p.hx + R - Math.abs(lx)
    const oz = p.hz + R - Math.abs(lz)
    if (ox <= 0 || oz <= 0) continue
    let nx = lx
    let nz = lz
    if (ox < oz) nx = Math.sign(lx || 1) * (p.hx + R)
    else nz = Math.sign(lz || 1) * (p.hz + R)
    b.x = p.x + nx * c + nz * s
    b.z = p.z - nx * s + nz * c
  }
  for (const q of POSTS) {
    if (q.y1 <= lift || q.y0 >= b.y + H) continue
    const dx = b.x - q.x
    const dz = b.z - q.z
    const d = Math.hypot(dx, dz)
    if (d >= q.r + R || d < 1e-6) continue
    b.x = q.x + (dx / d) * (q.r + R)
    b.z = q.z + (dz / d) * (q.r + R)
  }
  // ladrilhos caídos não seguram, e os de pé têm lado
  if (b.z > TILES[0].z - 2 && b.z < TILES[TILES.length - 1].z + 2 && DECK > lift) {
    for (let i = 0; i < TILES.length; i++) {
      const q = TILES[i]
      if (!tileUp(w.tiles[i], w.t) || DECK - 0.6 >= b.y + H) continue
      const lx = b.x - q.x
      const lz = b.z - q.z
      const ox = q.h + R - Math.abs(lx)
      const oz = q.h + R - Math.abs(lz)
      if (ox <= 0 || oz <= 0) continue
      if (ox < oz) b.x = q.x + Math.sign(lx || 1) * (q.h + R)
      else b.z = q.z + Math.sign(lz || 1) * (q.h + R)
    }
  }
}

/** Distância do ponto ao segmento vertical do corpo (x, z, de y+R a y+H−R). */
function sphereGap(b        , x        , y        , z        ) {
  const R = GINCANA.bodyR
  const cy = Math.max(b.y + R, Math.min(b.y + GINCANA.bodyH - R, y))
  return Math.hypot(b.x - x, b.z - z, cy - y)
}

function knock(b        , kx        , ky        , kz        , by                                    , out                   ) {
  if (b.shield > 0 || b.hitCool > 0 || b.mode === MODE.WATER || b.mode === MODE.DONE) return
  b.vx = kx + b.vx * 0.15
  b.vz = kz + b.vz * 0.15
  b.vy = Math.max(b.vy, ky)
  b.ground = false
  b.air = GINCANA.coyote
  b.mode = MODE.KNOCK
  b.timer = GINCANA.stunT
  b.hitCool = 1.4
  out?.push({ type: "hit", slot: b.slot, by })
}

/** O que se mexe: barras, pêndulos, luvas e bolas. */
function hazards(b        , w          , out                   ) {
  const R = GINCANA.bodyR
  const H = GINCANA.bodyH
  const t = w.t
  if (b.z < 100) {
    for (const s of SWEEPERS) {
      const cx = b.x - s.x
      const cz = b.z - s.z
      if (Math.hypot(cx, cz) > s.len + R + s.r) continue
      if (b.y >= s.y + s.r || b.y + H <= s.y - s.r) continue
      // quem acabou de levar (ou voltou agora) deixa a barra passar: não é arrastado até a beira
      if (b.hitCool > 0 || b.shield > 0) continue
      const a = sweeperAngle(s, t)
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const along = Math.max(s.both ? -s.len : 0, Math.min(s.len, cx * dx + cz * dz))
      const px = s.x + dx * along
      const pz = s.z + dz * along
      const gap = Math.hypot(b.x - px, b.z - pz)
      if (gap >= R + s.r) continue
      // velocidade da barra no ponto: ω × r (perpendicular à barra)
      const sp = s.w * along
      let tx = Math.cos(a) * Math.sign(sp || 1)
      let tz = -Math.sin(a) * Math.sign(sp || 1)
      if (Math.abs(along) < 0.6) {
        const g = gap || 1
        tx = (b.x - px) / g
        tz = (b.z - pz) / g
      }
      const mag = Math.max(5, Math.abs(sp) * 0.75 + 2.5)
      knock(b, tx * mag, 4.5, tz * mag, "bar", out)
      // fora da barra de qualquer jeito (não atravessa)
      const g = gap || 1
      b.x = px + ((b.x - px) / g) * (R + s.r + 0.02)
      b.z = pz + ((b.z - pz) / g) * (R + s.r + 0.02)
    }
  }
  if (b.z > 85 && b.z < 140) {
    for (const p of PENDULUMS) {
      if (Math.abs(b.z - p.z) > p.R + R + 0.2) continue
      const q = pendulumAt(p, t)
      if (sphereGap(b, q.x, q.y, q.z) >= p.R + R) continue
      const dir = Math.abs(q.vx) > 1 ? Math.sign(q.vx) : Math.sign(b.x - q.x || 1)
      knock(b, dir * 9, 4.5, Math.sign(b.z - q.z || 1) * 1.5, "swing", out)
    }
  }
  if (b.z > 140 && b.z < 185) {
    for (const g of GLOVES) {
      if (Math.abs(b.z - g.z) > g.R + R + 0.2) continue
      const q = gloveAt(g, t)
      const gap = sphereGap(b, q.x, g.y, g.z)
      if (gap >= g.R + R) continue
      if (q.hot && q.e < 0.98) knock(b, g.dir * 12.5, 5, Math.sign(b.z - g.z || 1) * 1.2, "glove", out)
      else {
        // parada ou voltando: só não deixa atravessar
        const dx = b.x - q.x
        const dz = b.z - g.z
        const d = Math.hypot(dx, dz) || 1
        b.x = q.x + (dx / d) * (g.R + R)
        b.z = g.z + (dz / d) * (g.R + R)
      }
    }
  }
  if (b.z > 216 && w.balls.length) {
    const bl = w.balls
    for (let k = 0; k < bl.length; k += 5) {
      if (sphereGap(b, bl[k], bl[k + 1], bl[k + 2]) >= BALLS.R + R) continue
      knock(b, Math.sign(b.x - bl[k] || 1) * 3, 5, -9, "ball", out)
    }
  }
}

/** Volta ao último posto (caiu na água ou ficou preso). */
function respawn(b        ) {
  const p = spawnAt(b.cp, b.slot)
  b.x = p.x
  b.y = p.y
  b.z = p.z
  b.vx = b.vy = b.vz = 0
  b.facing = 0
  b.ground = true
  b.air = 0
  b.mode = MODE.RUN
  b.timer = 0
  b.shield = GINCANA.shieldT
  b.hitCool = 0
}

function stepRunner(b        , it           , w          , out                   , dt = GINCANA.step) {
  const T = GINCANA
  b.shield = Math.max(0, b.shield - dt)
  b.boost = Math.max(0, b.boost - dt)
  b.jumpBuf = it.jump ? T.jumpBuffer : Math.max(0, b.jumpBuf - dt)
  b.hitCool = Math.max(0, b.hitCool - dt)
  if (b.mode === MODE.WATER) {
    b.timer -= dt
    b.vy = Math.max(-3, b.vy - T.gravity * dt)
    b.y += b.vy * dt
    b.vx *= 0.9
    b.vz *= 0.9
    if (b.timer <= 0) {
      respawn(b)
      out?.push({ type: "back", slot: b.slot })
    }
    return
  }
  const done = b.mode === MODE.DONE
  const free = b.mode === MODE.RUN || done
  let mx = done ? 0 : it.mx
  let mz = done ? 0 : it.mz
  const m = Math.hypot(mx, mz)
  if (m > 1) {
    mx /= m
    mz /= m
  }

  if (free) {
    const run = T.run * (b.boost > 0 ? T.boost : 1)
    const tx = mx * run
    const tz = mz * run
    const a = T.accel * (b.boost > 0 ? 1.3 : 1) * (b.ground ? 1 : T.airControl) * dt
    const dvx = tx - b.vx
    const dvz = tz - b.vz
    const dl = Math.hypot(dvx, dvz)
    if (dl <= a) {
      b.vx = tx
      b.vz = tz
    } else {
      b.vx += (dvx / dl) * a
      b.vz += (dvz / dl) * a
    }
    if (m > 0.05) b.facing = Math.atan2(mx, mz)
    if (!done && b.jumpBuf > 0 && (b.ground || b.air < T.coyote) && b.vy <= 0.01) {
      b.jumpBuf = 0
      b.vy = T.jumpV
      b.launch = T.jumpV
      b.ground = false
      b.air = T.coyote
      out?.push({ type: "jump", slot: b.slot })
    } else if (!done && it.dive) {
      // mergulho: para onde olha, um pouco para cima
      const fx = Math.sin(b.facing)
      const fz = Math.cos(b.facing)
      const keep = Math.max(0, b.vx * fx + b.vz * fz)
      const v = Math.max(T.diveV, keep + 2.5)
      b.vx = fx * v
      b.vz = fz * v
      b.vy = b.ground ? T.diveUp : Math.max(b.vy, 2.2)
      b.launch = Math.max(2.2, b.vy)
      b.ground = false
      b.air = T.coyote
      b.mode = MODE.DIVE
      out?.push({ type: "dive", slot: b.slot })
    }
  } else if (b.ground) {
    // de barriga, levantando ou derrubado no chão: escorrega até parar
    const k = Math.max(0, 1 - (b.mode === MODE.SLIDE ? 5 : 9) * dt)
    b.vx *= k
    b.vz *= k
  }

  b.x += b.vx * dt
  b.z += b.vz * dt
  pushWalls(b, w)
  hazards(b, w, out)

  const wasGround = b.ground
  if (!b.ground) b.vy -= T.gravity * dt
  const prevY = b.y
  b.y += b.vy * dt
  const reach = wasGround ? Math.max(prevY, b.y) + T.stepUp : Math.max(prevY, b.y) + 0.02
  const g = groundUnder(w, b.x, b.z, reach)
  if (b.vy <= 0 && g.y > -Infinity && b.y <= g.y + (wasGround ? 0.06 : 0)) {
    b.y = g.y
    b.vy = 0
    if (!b.ground) {
      b.ground = true
      // pousou: mergulho vira deslize; derrubado fica no chão o resto do tempo
      if (b.mode === MODE.DIVE) {
        b.mode = MODE.SLIDE
        b.timer = T.slideT
      } else if (b.mode === MODE.KNOCK) b.timer = Math.max(b.timer, 0.35)
    }
    b.air = 0
    if (g.tile >= 0 && (w.tiles[g.tile] < 0 || w.t - w.tiles[g.tile] >= TILE_TIME.warn + TILE_TIME.gone)) {
      w.tiles[g.tile] = w.t
      out?.push({ type: "tile", i: g.tile })
    }
  } else if (wasGround && b.vy <= 0 && g.y > -Infinity && b.y - g.y <= 0.3) {
    // descendo a rampa: gruda
    b.y = g.y
    b.vy = 0
  } else {
    if (b.ground) b.vy = Math.min(b.vy, 0)
    b.ground = false
    b.air += dt
  }

  // relógio dos estados sem controle
  if (b.mode === MODE.SLIDE || b.mode === MODE.RISE || b.mode === MODE.KNOCK) {
    if (b.ground || b.mode !== MODE.KNOCK) b.timer -= dt
    if (b.timer <= 0) {
      if (b.mode === MODE.RISE) b.mode = MODE.RUN
      else {
        b.mode = MODE.RISE
        b.timer = T.riseT
      }
    }
  }

  if (b.y < T.waterY && b.mode !== MODE.DONE) {
    b.mode = MODE.WATER
    b.timer = T.respawnT
    b.vy = Math.min(b.vy, -2)
    out?.push({ type: "splash", slot: b.slot, x: b.x, z: b.z })
    return
  }
  if (b.mode === MODE.DONE) return
  // logo da Freelandoo: turbo com brilho (cada corredor tem os seus)
  for (let i = 0; i < LOGOS.length; i++) {
    const L = LOGOS[i]
    if (Math.abs(b.z - L.z) > T.logoR + 0.5 || w.t - b.took[i] < T.logoBack) continue
    if (Math.hypot(b.x - L.x, b.z - L.z) > T.logoR || b.y > L.y + 0.6 || b.y + T.bodyH < L.y - 0.6) continue
    b.took[i] = w.t
    b.boost = T.boostT
    out?.push({ type: "logo", slot: b.slot, i })
  }
  const next = CHECKPOINTS[b.cp + 1]
  if (next && b.ground && b.z >= next.z - 1.5) {
    b.cp++
    out?.push({ type: "cp", slot: b.slot, cp: b.cp })
  }
  if (b.z >= FINISH_Z && b.y >= FINISH_Y - 0.5) {
    b.fin = w.t
    b.mode = MODE.DONE
    b.timer = 0
    out?.push({ type: "finish", slot: b.slot, t: w.t })
  }
}

/** Dois corpos não ocupam o mesmo lugar: cada um sai metade (o que só aparece sai tudo). */
function separate(a        , b        , moveB         ) {
  if (a.mode === MODE.WATER || b.mode === MODE.WATER) return
  if (Math.abs(a.y - b.y) > GINCANA.bodyH * 0.8) return
  const dx = a.x - b.x
  const dz = a.z - b.z
  const d = Math.hypot(dx, dz)
  const min = GINCANA.bodyR * 1.8
  if (d >= min) return
  const nx = d > 1e-4 ? dx / d : 1
  const nz = d > 1e-4 ? dz / d : 0
  const push = min - d
  if (moveB) {
    a.x += nx * push * 0.5
    a.z += nz * push * 0.5
    b.x -= nx * push * 0.5
    b.z -= nz * push * 0.5
  } else {
    a.x += nx * push
    a.z += nz * push
  }
}

/** Código de animação que viaja na rede. */
const ANIM = { IDLE: 0, RUN: 1, AIR: 2, DIVE: 3, SLIDE: 4, KNOCK: 5, RISE: 6, WATER: 7, WIN: 8 }         

function runnerAnim(b        ) {
  switch (b.mode) {
    case MODE.DIVE:
      return ANIM.DIVE
    case MODE.SLIDE:
      return ANIM.SLIDE
    case MODE.RISE:
      return ANIM.RISE
    case MODE.KNOCK:
      return ANIM.KNOCK
    case MODE.WATER:
      return ANIM.WATER
    case MODE.DONE:
      return ANIM.WIN
    default:
      if (!b.ground) return ANIM.AIR
      return Math.hypot(b.vx, b.vz) > 0.6 ? ANIM.RUN : ANIM.IDLE
  }
}

// ── sim/bots.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/bots.ts — GINCANA (mm3d-47): os computadores.
//
// Cada computador tem uma rota sorteada pela semente (lado do carrossel, viga
// das passarelas, faixa do campo, coluna do xadrez), um passo e uma
// HABILIDADE (0,55–0,95) que decide quanto ele erra: pula a barra cedo ou
// tarde, às vezes não espera o pêndulo nem a luva. Tudo determinístico pela
// semente e pelo tempo — a sala e o treino no aparelho decidem igual.

/** 0–1 determinístico. */
function botRand(seed        , a        , b = 0) {
  let h = (Math.imul(a + 0x632be5ab, 0x9e3779b1) ^ Math.imul(b + 0x1b873593, 0x85ebca77) ^ Math.imul(seed | 0, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

const tileX = (c        ) => (c - (TILE_COLS - 1) / 2) * TILE_PITCH

function newBrain(seed        , slot        )           {
  const r = (k        ) => botRand(seed, slot, k)
  const side = r(1) < 0.5 ? -1 : 1
  const route                             = []
  const add = (x        , z        ) => route.push({ x, z })
  // largada e carrossel
  add(side * 1.2, 10)
  add(side * 0.8, 15.5)
  add(side * 2.5, 20)
  add(side * 4.5, 29)
  add(side * 4.5, 33)
  add(side * 4.5, 38.5)
  add(side * 4.5, 42)
  add(side * 4.6, 46)
  add(side * 4.5, 50)
  add(side * 4.5, 53)
  add(side * 4.5, 57.5)
  add(side * 3.5, 61)
  add(side * 3.2, 66)
  add(side * 2, 71)
  add(0, 75.8)
  add(0, 80)
  add(0, 84)
  // passarelas
  const L = [-5, 0, 5][Math.floor(r(2) * 3)]
  const D = L !== 0 ? L : r(3) < 0.5 ? -5 : 5
  add(L * 0.6, 88)
  add(L, 90.4)
  for (const z of [94, 98, 102, 105]) add(L, z)
  for (let k = 1; k <= 4; k++) add(L + (D - L) * (k / 4), 105 + 3.5 * k)
  for (const z of [122, 126, 130, 133.6]) add(D, z)
  add(D * 0.4, 137)
  // luvas
  const F = [-2.2, 2.2, -4.8, 4.8][Math.floor(r(4) * 4)]
  for (let z = 142; z <= 183; z += 3) add(F, z)
  // xadrez (a coluna muda no caminho; aqui só o eixo z)
  const col = Math.floor(r(5) * TILE_COLS)
  add(tileX(col) * 0.6, 187)
  add(tileX(col), 190.8)
  for (let k = 0; k < TILE_ROWS; k++) add(tileX(col), TILE_Z0 + k * TILE_PITCH)
  add(tileX(col) * 0.5, 213)
  add(0, 216.5)
  // subida e chegada
  for (let z = 222; z <= 256; z += 2.5) add(0, z)
  add(0, 259)
  add(0, 264)
  add(0, 269)
  const skill = 0.55 + r(6) * 0.4
  return { route, skill, pace: 0.86 + r(7) * 0.14, seed, slot, col, laneX: 0, jumpCool: 0, stuck: 0, lastZ: -99, waited: 0, divesFinish: r(8) < skill - 0.35 }
}

/** Intenção do computador neste passo. */
function botIntent(br          , b        , w          , dt = GINCANA.step)            {
  const it            = { mx: 0, mz: 0, jump: false, dive: false }
  br.jumpCool = Math.max(0, br.jumpCool - dt)
  if (b.mode !== MODE.RUN || w.t < 0) return it
  const t = w.t
  // próximo ponto: o primeiro adiante (as rotas só andam para +z)
  let wi = 0
  while (wi < br.route.length - 1 && br.route[wi].z < b.z + 0.6) wi++
  let tx = br.route[wi].x
  const tz = br.route[wi].z

  // xadrez: troca de coluna se o ladrilho da frente caiu ou está tremendo
  if (b.z > 189 && b.z < 212) {
    let row = 0
    while (row < TILE_ROWS - 1 && TILE_Z0 + row * TILE_PITCH < b.z + 0.8) row++
    const ok = (c        ) => {
      if (c < 0 || c >= TILE_COLS) return false
      const s = w.tiles[row * TILE_COLS + c]
      return tileUp(s, t + 0.35) && !(s >= 0 && t - s < 0.8)
    }
    if (!ok(br.col)) {
      const order = br.col < TILE_COLS / 2 ? [br.col + 1, br.col - 1, br.col + 2, br.col - 2] : [br.col - 1, br.col + 1, br.col - 2, br.col + 2]
      for (const c of order) {
        if (ok(c)) {
          br.col = c
          break
        }
      }
    }
    tx = tileX(br.col)
  }
  // subida: a faixa mais livre das bolas que vêm
  if (b.z > RAMP.z0 - 2 && b.z < RAMP.z1 + 0.5) {
    const gaps = [-5.4, -2.9, 0, 2.9, 5.4]
    let best = br.laneX
    let bestScore = -Infinity
    for (const gx of gaps) {
      let score = -Math.abs(gx - br.laneX) * 0.15 - Math.abs(gx) * 0.05
      const bl = w.balls
      for (let k = 0; k < bl.length; k += 5) {
        const ahead = bl[k + 2] - b.z
        if (ahead < -1 || ahead > 9) continue
        const dx = Math.abs(bl[k] - gx)
        if (dx < BALLS.R + 1) score -= (10 - ahead) * (BALLS.R + 1 - dx)
      }
      if (score > bestScore) {
        bestScore = score
        best = gx
      }
    }
    // os menos hábeis demoram a perceber
    if (botRand(br.seed, br.slot, Math.floor(t * 4)) < br.skill) br.laneX = best
    tx = br.laneX
  }

  let dx = tx - b.x
  let dz = tz - b.z
  const d = Math.hypot(dx, dz) || 1
  dx /= d
  dz /= d
  // desvia das colunas (pilar do carrossel, frades do campo)
  for (const q of POSTS) {
    if (q.y1 <= b.y + GINCANA.stepUp || q.y0 > b.y + 1) continue
    const ox = q.x - b.x
    const oz = q.z - b.z
    const ahead = ox * dx + oz * dz
    if (ahead < 0 || ahead > 2.6) continue
    const lat = ox * dz - oz * dx
    const need = q.r + GINCANA.bodyR + 0.35
    if (Math.abs(lat) > need) continue
    const s = lat >= 0 ? -1 : 1
    const k = (need - Math.abs(lat)) / need
    dx += dz * s * k * 1.6
    dz += -dx * s * k * 0.2
  }
  const m = Math.hypot(dx, dz) || 1
  let go = br.pace
  it.mx = (dx / m) * go
  it.mz = (dz / m) * go

  // pêndulo adiante na mesma linha: espera passar (os menos hábeis às vezes vão)
  if (b.z > 86 && b.z < 134) {
    for (let i = 0; i < PENDULUMS.length; i++) {
      const p = PENDULUMS[i]
      const ahead = p.z - b.z
      // decide entre 4,6 e 2,4 m (freia em ~0,6 m e fica fora do alcance); mais perto, vai
      // (a bola do vizinho também alcança: confere todos os que balançam até aqui)
      if (ahead < 2.4 || ahead > 4.6 || Math.abs(p.x - b.x) > p.len * Math.sin(p.amp) + 2) continue
      // a bola passa pela faixa enquanto eu atravesso? (entrar e sair do alcance dela)
      const reach = p.R + GINCANA.bodyR + 0.3
      // onde eu estarei (na viga diagonal o x muda no caminho)
      const slope = it.mx / Math.max(0.2, it.mz)
      let near = false
      for (let k = 0; k <= 4; k++) {
        const dz = ahead - reach + (2 * reach * k) / 4
        const q = pendulumAt(p, t + dz / (GINCANA.run * br.pace))
        if (Math.abs(q.x - (b.x + slope * dz)) < reach) near = true
      }
      if (near && botRand(br.seed, br.slot * 97 + i, Math.floor(t / 2.86)) < br.skill + 0.05) go = 0
    }
  }
  // luva prestes a socar na faixa por onde vai passar: espera
  if (b.z > 140 && b.z < 184) {
    for (let i = 0; i < GLOVES.length; i++) {
      const g = GLOVES[i]
      const ahead = g.z - b.z
      if (ahead < 1.3 || ahead > 3.4) continue
      const enter = (ahead - 1.6) / GINCANA.run
      const leave = (ahead + 1.6) / GINCANA.run
      let hot = false
      for (const f of [0, 0.5, 1]) {
        const q = gloveAt(g, t + Math.max(0, enter + (leave - enter) * f))
        if (q.hot || q.u > 0.5) hot = true
      }
      if (hot && botRand(br.seed, br.slot * 89 + i, Math.floor(t / 2.6)) < br.skill + 0.1) go = 0
    }
  }
  if (go === 0) br.waited += dt
  if (go === 0 && br.waited < 6 + br.skill * 4) {
    it.mx = 0
    it.mz = 0
  } else if (go > 0) br.waited = Math.max(0, br.waited - dt * 0.5)

  // barra do carrossel chegando: pula na hora (com o erro da habilidade)
  if (b.ground && br.jumpCool <= 0 && b.z < 80) {
    for (let i = 0; i < SWEEPERS.length; i++) {
      const s = SWEEPERS[i]
      const cx = b.x - s.x
      const cz = b.z - s.z
      const r = Math.hypot(cx, cz)
      if (r > s.len + 0.3 || r < 1.0) continue
      const span = s.both ? Math.PI : Math.PI * 2
      const ang = Math.atan2(cx, cz)
      const a = sweeperAngle(s, t)
      const delta = ((((ang - a) * Math.sign(s.w)) % span) + span) % span
      // contato antes do alinhamento: a grossura da barra e do corpo
      const ttr = (delta - (s.r + GINCANA.bodyR) / Math.max(r, 1)) / Math.abs(s.w)
      const pass = Math.floor((s.w * t + s.a0) / span)
      const err = (botRand(br.seed, br.slot * 31 + i, pass) - 0.5) * (1 - br.skill) * 0.7
      if (ttr < 0.22 + err && ttr > 0.02) {
        it.jump = true
        br.jumpCool = 0.7
      }
    }
  }
  // ladrilho tremendo embaixo: pula para o próximo
  if (b.ground && br.jumpCool <= 0 && b.z > 191 && b.z < 211) {
    for (let i = 0; i < TILES.length; i++) {
      const q = TILES[i]
      const s = w.tiles[i]
      if (s < 0 || Math.abs(b.x - q.x) > q.h || Math.abs(b.z - q.z) > q.h) continue
      if (t - s > 0.45 && botRand(br.seed, br.slot, i) < br.skill) {
        it.jump = true
        br.jumpCool = 0.6
      }
    }
  }
  // preso (parado sem esperar nada): pula
  if (Math.abs(b.z - br.lastZ) > 0.6) {
    br.lastZ = b.z
    br.stuck = 0
  } else if (go > 0) {
    br.stuck += dt
    if (br.stuck > 2.2 && b.ground) {
      it.jump = true
      br.stuck = 0
    }
  }
  // reta final: os melhores mergulham para a linha
  if (br.divesFinish && b.ground && b.z > 259 && b.z < 262 && Math.abs(b.facing) < 0.3) it.dive = true
  return it
}

// ── sim/race.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/race.ts — GINCANA (mm3d-47): a prova.
//
// Quem corre e como cada um é movido:
//  - "local": o corpo deste aparelho (intenção do controle);
//  - "bot": computador (bots.ts), rodado aqui;
//  - "remote": alguém de fora (a pose chega pela rede; aqui só pisa nos
//    ladrilhos e empurra os outros).
// No treino o aparelho tem o "local" e os computadores; na sala, os
// jogadores são "remote" e os computadores "bot"; no multiplayer, o aparelho
// tem o "local" e todo o resto é "remote" (os computadores vêm da sala).
//
// A ordem de chegada é de quem cruza primeiro; quem não chegou no tempo
// limite fica pela distância. A prova acaba quando todos que contam (os de
// fora e o local; computador não segura a prova) chegaram, caíram fora ou o
// tempo acabou.

/** Pose que viaja na rede (e que o "remote" recebe). */
                             
           
           
           
           
           
                         
            
                                          
             
 

                              
              
                                            
             
                                                       
              
 

class GincanaRace {
           seed        
  /** s da prova (negativo na contagem). */
  t        
           runners           = []
           ctl              = []
           brains                      = []
  /** Quem saiu (aba fechada, rede caiu): para de contar. */
           gone            = []
           world          
  /** Ordem de chegada (vagas). */
           order           = []
                   bySlot = new Map                ()

  constructor(seed        , seats               , countdown         = GINCANA.countdown) {
    this.seed = seed >>> 0
    this.t = -countdown
    this.world = { t: this.t, seed: this.seed, tiles: new Float64Array(TILES.length).fill(-1), balls: [] }
    for (const s of seats) {
      this.bySlot.set(s.slot, this.runners.length)
      this.runners.push(newRunner(s.slot))
      this.ctl.push(s.ctl)
      this.brains.push(s.ctl === "bot" ? newBrain(this.seed, s.slot) : null)
      this.gone.push(false)
    }
  }

  runner(slot        )                {
    const i = this.bySlot.get(slot)
    return i === undefined ? null : this.runners[i]
  }

  /** Um passo fixo; `local` = intenção do corpo deste aparelho. */
  step(local            = IDLE_INTENT, out                    = null, dt         = GINCANA.step) {
    this.t += dt
    const w = this.world
    w.t = this.t
    ballsAt(this.seed, this.t, w.balls)
    // ladrilhos que já voltaram
    for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] >= 0 && this.t - w.tiles[i] >= TILE_TIME.warn + TILE_TIME.gone) w.tiles[i] = -1
    for (const b of this.runners) {
      b.px = b.x
      b.py = b.y
      b.pz = b.z
    }
    if (this.t < 0) return
    for (let i = 0; i < this.runners.length; i++) {
      const b = this.runners[i]
      const c = this.ctl[i]
      if (this.gone[i]) continue
      if (c === "remote") continue
      const it = c === "local" ? local : botIntent(this.brains[i] , b, w, dt)
      const wasFin = b.fin >= 0
      stepRunner(b, it, w, out, dt)
      if (!wasFin && b.fin >= 0) this.order.push(b.slot)
    }
    // ninguém atravessa ninguém (quem é movido aqui sai; o de fora não)
    for (let i = 0; i < this.runners.length; i++) {
      if (this.ctl[i] === "remote" || this.gone[i]) continue
      for (let j = 0; j < this.runners.length; j++) {
        if (i === j || this.gone[j]) continue
        if (j < i && this.ctl[j] !== "remote") continue
        separate(this.runners[i], this.runners[j], this.ctl[j] !== "remote")
      }
    }
  }

  /** Avança até o tempo `to` em passos fixos (devolve quantos deu). */
  advance(to        , local            = IDLE_INTENT, out                    = null, maxSteps = 30) {
    let n = 0
    while (this.t + GINCANA.step <= to + 1e-9 && n < maxSteps) {
      this.step(n === 0 ? local : { ...local, jump: false, dive: false }, out)
      n++
    }
    return n
  }

  /** Pose de alguém de fora (rede). Pisa nos ladrilhos como os outros. */
  setRemote(slot        , p            ) {
    const i = this.bySlot.get(slot)
    if (i === undefined) return
    const b = this.runners[i]
    b.x = p.x
    b.y = p.y
    b.z = p.z
    b.facing = p.f
    b.cp = p.cp
    b.mode = p.a === ANIM.WATER ? MODE.WATER : p.a === ANIM.WIN ? MODE.DONE : p.a === ANIM.KNOCK ? MODE.KNOCK : MODE.RUN
    b.ground = p.a === ANIM.IDLE || p.a === ANIM.RUN || p.a === ANIM.WIN || p.a === ANIM.SLIDE || p.a === ANIM.RISE
    if (p.fin >= 0 && b.fin < 0) {
      b.fin = p.fin
      this.order.push(slot)
    }
    if (b.ground && b.z > TILES[0].z - 2 && b.z < TILES[TILES.length - 1].z + 2) {
      for (let k = 0; k < TILES.length; k++) {
        const q = TILES[k]
        if (Math.abs(b.x - q.x) <= q.h && Math.abs(b.z - q.z) <= q.h && this.world.tiles[k] < 0) this.world.tiles[k] = this.t
      }
    }
  }

  setGone(slot        ) {
    const i = this.bySlot.get(slot)
    if (i !== undefined) this.gone[i] = true
  }

  pose(slot        )                    {
    const b = this.runner(slot)
    if (!b) return null
    return { x: b.x, y: b.y, z: b.z, f: b.facing, a: runnerAnim(b), cp: b.cp, fin: b.fin }
  }

  /** Classificação: quem chegou pela ordem; o resto pela distância (posto e z). */
  standings()                {
    const rows                = []
    for (const slot of this.order) {
      const b = this.runner(slot) 
      rows.push({ slot, fin: b.fin, dist: FINISH_Z })
    }
    const rest = this.runners
      .filter((b) => b.fin < 0)
      .map((b) => ({ slot: b.slot, fin: -1, dist: Math.max(CHECKPOINTS[b.cp].z, Math.min(FINISH_Z, b.z)) + 0 }))
      .sort((a, b) => b.dist - a.dist || a.slot - b.slot)
    return rows.concat(rest)
  }

  /** Acabou: todos os que contam chegaram (ou saíram) ou o tempo acabou. */
  over()          {
    if (this.t >= GINCANA.timeLimit) return true
    let any = false
    for (let i = 0; i < this.runners.length; i++) {
      if (this.ctl[i] === "bot" || this.gone[i]) continue
      any = true
      if (this.runners[i].fin < 0) return false
    }
    return any
  }
}

module.exports = { DECK, GINCANA, GINCANA_COLORS, TILE_COLS, TILE_ROWS, TILE_PITCH, TILE_HALF, TILE_Z0, RAMP, FINISH_Z, FINISH_Y, BALLS, PADS, POSTS, SWEEPERS, PENDULUMS, GLOVES, TILES, TILE_TIME, CHECKPOINTS, spawnAt, sweeperAngle, pendulumAt, gloveAt, ballLane, LOGOS, rampTop, ballsAt, tileUp, sectionAt, MODE, IDLE_INTENT, newRunner, groundUnder, respawn, stepRunner, separate, ANIM, runnerAnim, botRand, newBrain, botIntent, GincanaRace };
