// GERADO por scripts/build-corrida-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/corrida/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── sim/track.ts ─────────────────────────────────────────────────────────────
// features/meu-mundo/corrida/sim/track.ts — CORRIDA ANTIGRAVIDADE (mm3d-39): a pista.
//
// A pista é desenhada como uma tartaruga: uma lista de peças (reta, curva,
// rampa, vão) a partir da largada; a última peça é uma curva de Hermite que
// fecha o circuito de volta na largada. Depois tudo é reamostrado a cada
// STEP metros pelo comprimento: o resto do jogo só enxerga amostras.
//
// Convenções do Meu Mundo: +x leste, +z norte, y para cima; rumo (yaw) 0 =
// olhando para +z, crescendo vira para a DIREITA (frente = (sin, cos),
// direita = (cos, −sin)). `u` = metros para a direita do eixo da pista.
//
// Sem Babylon (testável no node; nada de enum nem parâmetro-propriedade).

const STEP = 2
/** Inclinação lateral máxima (rad, 30°) e o ganho sobre a curvatura (mm3d-73). */
const BANK_MAX = 0.52
const BANK_K = 46

/**
 * mm3d-74: "loop" = volta vertical inteira (360°) com um deslocamento de lado
 * (`side`), a nave fica PRESA à pista; "drop" = estrada (descida/subida
 * íngreme, espiral) em que a nave não decola — a antigravidade segura.
 */
                                                                 

                        
             
                                   
               
                                                                     
             
                  
                                                                                               
                           
                                                                 
                           
                                                    
                  
                                                                              
               
                                                       
                  
 

                           
            
               
                
                                                               
                
                 
 

                      
           
             
            
            
 
                      
            
           
           
 
                      
                                                
            
            
                                                
               
                                                               
              
 

/** Trecho (início e fim em s). */
                       
            
            
 

                        
            
               
                                                 
                
           
                 
                 
                 
                   
                                    
                     
                                                                                      
                    
                                                       
                    
                                                                                             
                  
                                                                                                               
                    
                                                        
                 
                                 
                
             
             
             
                 
                                              
                                                                                    
 

                             
           
           
           
             
               
              
              
              
               
                                                                
               
                                 
              
                 
 

const DEG = Math.PI / 180
const smooth = (t        ) => t * t * (3 - 2 * t)

function wrapAngle(a        )         {
  while (a > Math.PI) a -= 2 * Math.PI
  while (a < -Math.PI) a += 2 * Math.PI
  return a
}

/** s dentro de [0, length). */
function wrapS(t       , s        )         {
  const L = t.length
  return ((s % L) + L) % L
}

                 
           
           
           
              
                                                                       
              
                                 
            
 

function buildTrack(def          )        {
  // ── 1. tartaruga em passos finos ─────────────────────────────────────────
  const fine = 0.5
  const dense          = []
  const marks                                            = []
  let x = 0
  let z = 0
  let y = def.startY
  let yaw = 0
  let run = 0
  const pieceStart           = []
  def.pieces.forEach((p, i) => {
    pieceStart.push(run)
    marks.push({ at: run, piece: p, i })
    const n = Math.max(1, Math.round(p.len / fine))
    const kind = p.kind ?? "road"
    const turn = (p.turn ?? 0) * DEG
    const dy = p.dy ?? 0
    const y0 = y
    if (kind === "loop") {
      // volta vertical: frente R·senθ, cima R·(1−cosθ), de lado suave até `side`
      const R = p.len / (2 * Math.PI)
      const side = p.side ?? 22
      const x0 = x
      const z0 = z
      const fx = Math.sin(yaw)
      const fz = Math.cos(yaw)
      const rx = Math.cos(yaw)
      const rz = -Math.sin(yaw)
      for (let k = 0; k < n; k++) {
        const tt = (k + 1) / n
        const th = 2 * Math.PI * tt
        const lat = side * smooth(tt)
        x = x0 + fx * R * Math.sin(th) + rx * lat
        z = z0 + fz * R * Math.sin(th) + rz * lat
        y = y0 + R * (1 - Math.cos(th))
        dense.push({ x, z, y, flag: 3, head: yaw, la: wrapAngle(th) })
      }
      y = y0
      run += n * fine
      return
    }
    for (let k = 0; k < n; k++) {
      yaw += turn / n
      x += Math.sin(yaw) * fine
      z += Math.cos(yaw) * fine
      const tt = (k + 1) / n
      // estrada: sobe/desce suave (inclinação zero nas pontas); rampa: cada vez mais
      // íngreme (decola no fim); vão: linha reta até o pouso (só para referência).
      y = kind === "ramp" ? y0 + dy * tt * tt : kind === "gap" ? y0 + dy * tt : y0 + dy * smooth(tt)
      dense.push({ x, z, y, flag: kind === "gap" ? 1 : kind === "ramp" ? 2 : kind === "drop" ? 4 : 0, head: yaw, la: 0 })
    }
    run += n * fine
  })
  // ── 2. fecho: Hermite do fim de volta à largada ──────────────────────────
  {
    const ex = x
    const ez = z
    const ey = y
    const dist = Math.hypot(-ex, -ez)
    const k = dist * 1.1
    const t0 = { x: Math.sin(yaw) * k, z: Math.cos(yaw) * k }
    const t1 = { x: 0, z: k } // a largada olha para +z
    const n = Math.max(8, Math.round((dist * 1.15) / fine))
    for (let i = 1; i <= n; i++) {
      const t = i / n
      const h00 = 2 * t ** 3 - 3 * t * t + 1
      const h10 = t ** 3 - 2 * t * t + t
      const h01 = -2 * t ** 3 + 3 * t * t
      const h11 = t ** 3 - t * t
      dense.push({
        x: h00 * ex + h10 * t0.x + h11 * t1.x,
        z: h00 * ez + h10 * t0.z + h11 * t1.z,
        y: ey + (def.startY - ey) * smooth(t),
        flag: 0,
        head: Math.atan2(
          (6 * t * t - 6 * t) * ex + (3 * t * t - 4 * t + 1) * t0.x + (3 * t * t - 2 * t) * t1.x,
          (6 * t * t - 6 * t) * ez + (3 * t * t - 4 * t + 1) * t0.z + (3 * t * t - 2 * t) * t1.z,
        ),
        la: 0,
      })
    }
  }
  // ── 3. reamostra pelo comprimento ────────────────────────────────────────
  const cum = new Float64Array(dense.length + 1)
  let px = 0
  let pz = 0
  let py = def.startY
  for (let i = 0; i < dense.length; i++) {
    const d = dense[i]
    // no loop o comprimento é o de verdade (a pista sobe na vertical)
    cum[i + 1] = cum[i] + (d.flag === 3 ? Math.hypot(d.x - px, d.z - pz, d.y - py) : Math.hypot(d.x - px, d.z - pz))
    px = d.x
    pz = d.z
    py = d.y
  }
  const total = cum[dense.length]
  const n = Math.round(total / STEP)
  const length = n * STEP
  const scale = total / length
  const T        = {
    id: def.id,
    width: def.width,
    length,
    n,
    x: new Float32Array(n),
    z: new Float32Array(n),
    y: new Float32Array(n),
    yaw: new Float32Array(n),
    slope: new Float32Array(n),
    bank: new Float32Array(n),
    curv: new Float32Array(n),
    flag: new Uint8Array(n),
    loop: new Float32Array(n),
    tunnels: [],
    loops: [],
    startS: def.startS,
    pads: [],
    orbs: [],
    gaps: [],
    gates: [],
    bounds: { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity },
  }
  /** Posição na volta (m) de uma distância da tartaruga (antes da reamostragem). */
  const toS = (d        ) => Math.min(length - STEP, d / scale)
  let j = 0
  const head = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const want = i * STEP * scale
    while (j < dense.length - 1 && cum[j + 1] < want) j++
    const a = j === 0 ? { x: 0, z: 0, y: def.startY, flag: dense[0].flag, head: 0, la: 0 } : dense[j - 1]
    const b = dense[j]
    const span = cum[j + 1] - cum[j] || 1
    const f = Math.min(1, Math.max(0, (want - cum[j]) / span))
    T.x[i] = a.x + (b.x - a.x) * f
    T.z[i] = a.z + (b.z - a.z) * f
    T.y[i] = a.y + (b.y - a.y) * f
    T.flag[i] = b.flag
    head[i] = a.head + wrapAngle(b.head - a.head) * f
    T.loop[i] = b.flag === 3 ? a.la + wrapAngle(b.la - a.la) * f : 0
  }
  // rumo, inclinação e curvatura por diferenças centradas
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    const q = (i + 1) % n
    T.yaw[i] = Math.atan2(T.x[q] - T.x[p], T.z[q] - T.z[p])
    T.slope[i] = (T.y[q] - T.y[p]) / (2 * STEP)
  }
  // mm3d-74: no loop (e encostado nele) o rumo é o da tartaruga — a tangente
  // vira para trás no alto — e a inclinação "da estrada" não existe
  const nearLoop = (i        , m        ) => {
    for (let k = -m; k <= m; k++) if (T.flag[(i + k + n) % n] === 3) return true
    return false
  }
  for (let i = 0; i < n; i++)
    if (nearLoop(i, 2)) {
      T.yaw[i] = head[i]
      if (T.flag[i] === 3) T.slope[i] = 0
    }
  // na ponta da rampa a diferença é para trás (a da frente já é o vão) e, no
  // vão, a inclinação "da pista" é a da rampa que acabou (o voo é balístico)
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    if (T.flag[i] === 1) T.slope[i] = T.slope[p]
    else if (T.flag[(i + 1) % n] === 1) T.slope[i] = (T.y[i] - T.y[p]) / STEP
  }
  for (let i = 0; i < n; i++) {
    const p = (i - 1 + n) % n
    const q = (i + 1) % n
    T.curv[i] = wrapAngle(T.yaw[q] - T.yaw[p]) / (2 * STEP)
  }
  // inclinação lateral (mm3d-73): curvatura suavizada numa janela de 60 m, que
  // faz a entrada e a saída da curva irem aos poucos; reta ≈ 0°, curva de 90°
  // em 150 m ≈ 26°, teto BANK_MAX (30°). Mudou → regerar o back (build-corrida-sim).
  const win = Math.round(30 / STEP)
  const raw = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let c = 0
    for (let k = -win; k <= win; k++) c += T.curv[(i + k + n) % n]
    raw[i] = Math.max(-BANK_MAX, Math.min(BANK_MAX, (c / (2 * win + 1)) * BANK_K))
  }
  // segunda passada curta: tira a quina onde o teto corta
  const win2 = Math.round(8 / STEP)
  for (let i = 0; i < n; i++) {
    let c = 0
    for (let k = -win2; k <= win2; k++) c += raw[(i + k + n) % n]
    T.bank[i] = c / (2 * win2 + 1)
  }
  // o loop é reto (sem inclinação lateral); some aos poucos na entrada e na saída
  for (let i = 0; i < n; i++) {
    let d = 99
    for (let k = -15; k <= 15; k++) if (T.flag[(i + k + n) % n] === 3) d = Math.min(d, Math.abs(k))
    if (d < 99) T.bank[i] *= Math.min(1, d / 15)
  }
  for (let i = 0; i < n; i++) {
    const b = T.bounds
    b.x0 = Math.min(b.x0, T.x[i])
    b.x1 = Math.max(b.x1, T.x[i])
    b.z0 = Math.min(b.z0, T.z[i])
    b.z1 = Math.max(b.z1, T.z[i])
    b.y0 = Math.min(b.y0, T.y[i])
    b.y1 = Math.max(b.y1, T.y[i])
  }
  // ── 4. o que mora nas peças: faixas, cápsulas, arcos, vãos ───────────────
  const half = def.width / 2
  let orbId = 0
  for (const m of marks) {
    const p = m.piece
    const base = m.at
    for (const [at, side] of p.pads ?? []) {
      const w = def.width / 3
      const u0 = side < 0 ? -half + 0.8 : side > 0 ? half - 0.8 - w : -w / 2
      T.pads.push({ s: toS(base + at), len: 9, u0, u1: u0 + w })
    }
    for (const [at, u] of p.orbs ?? []) T.orbs.push({ id: orbId++, s: toS(base + at), u })
    for (const at of p.gates ?? []) T.gates.push(toS(base + at))
    if (p.tunnel) T.tunnels.push({ s0: toS(base), s1: toS(base + p.len) })
    if (p.kind === "loop") T.loops.push({ s0: toS(base), s1: toS(base + p.len), r: p.len / (2 * Math.PI) })
    if (p.kind === "gap") {
      const prev = def.pieces[m.i - 1]
      const ramp = prev && prev.kind === "ramp" ? prev.len : 0
      const s0 = toS(base)
      const s1 = toS(base + p.len)
      T.gaps.push({ s0, s1, landY: T.y[Math.round(s1 / STEP) % n], ramp: ramp / scale })
    }
  }
  return T
}

/** Ponto da pista em s (interpolado entre amostras). */
function trackAt(t       , s        , out             )             {
  const ss = wrapS(t, s) / STEP
  const i = Math.floor(ss) % t.n
  const k = (i + 1) % t.n
  const f = ss - Math.floor(ss)
  const o = out ?? ({}              )
  o.x = t.x[i] + (t.x[k] - t.x[i]) * f
  o.z = t.z[i] + (t.z[k] - t.z[i]) * f
  o.y = t.y[i] + (t.y[k] - t.y[i]) * f
  o.yaw = t.yaw[i] + wrapAngle(t.yaw[k] - t.yaw[i]) * f
  o.slope = t.slope[i] + (t.slope[k] - t.slope[i]) * f
  o.bank = t.bank[i] + (t.bank[k] - t.bank[i]) * f
  o.curv = t.curv[i] + (t.curv[k] - t.curv[i]) * f
  // vão: só quando as duas amostras são vão (as bordas ainda têm chão)
  o.gap = t.flag[i] === 1 && t.flag[k] === 1
  o.ramp = t.flag[i] === 2
  o.inLoop = t.flag[i] === 3 || t.flag[k] === 3
  o.glue = o.inLoop || t.flag[i] === 4 || t.flag[k] === 4
  o.loop = o.inLoop ? t.loop[i] + wrapAngle(t.loop[k] - t.loop[i]) * f : 0
  return o
}

/** Altura do chão em (s, u): a inclinação lateral abaixa o lado de dentro da curva. */
function surfaceY(p            , u        )         {
  return p.y - u * Math.sin(p.bank)
}

/** Ponto do mundo em (s, u, altura acima do eixo). */
function worldAt(p            , u        )                           {
  const c = Math.cos(p.bank)
  return { x: p.x + Math.cos(p.yaw) * u * c, z: p.z - Math.sin(p.yaw) * u * c }
}

// ═══ O CIRCUITO ══════════════════════════════════════════════════════════════
// "Baía Suspensa": pista elevada sobre a baía, com dois penhascos — um pulo
// médio depois da subida e o VOO grande (faixa de turbo antes da rampa).
const BAIA           = {
  id: "baia-suspensa",
  width: 18,
  startY: 30,
  startS: 40,
  pieces: [
    { len: 150, pads: [[105, 0]], gates: [40], orbs: [[70, -5], [70, 5]] },
    { len: 150, turn: 90, orbs: [[75, 3]] },
    { len: 90, dy: 10, orbs: [[50, -4], [50, 4]] },
    { len: 45, dy: 6, kind: "ramp" },
    { len: 55, dy: -16, kind: "gap" },
    { len: 70, gates: [25] },
    { len: 180, turn: 100, dy: -6, pads: [[120, 1]] },
    { len: 110, turn: -55, orbs: [[55, -4]] },
    { len: 110, turn: 55, orbs: [[55, 4]] },
    { len: 80, pads: [[20, 0], [55, -1], [55, 1]] },
    { len: 50, dy: 9, kind: "ramp" },
    { len: 120, dy: -24, kind: "gap" },
    { len: 90, gates: [40], orbs: [[60, 0]] },
    { len: 200, turn: 120, dy: 20, pads: [[150, -1]] },
    { len: 110, dy: 10, orbs: [[40, -5], [40, 5]] },
    { len: 150, turn: 50 },
  ],
}

// ── sim/circuits.ts ──────────────────────────────────────────────────────────
// features/meu-mundo/corrida/sim/circuits.ts — CORRIDA (mm3d-74): o CATÁLOGO de circuitos.
//
// Pedido do Alex (prompt da expansão + referências em Downloads/PISTAS): 6
// pistas — a Baía Suspensa de sempre e mais 5, com quedas grandes, loops,
// túneis holográficos, espirais e saltos. Aqui só a REGRA de cada uma (peças
// da tartaruga de track.ts); nome, ambiente, cores e cartão ficam no desenho
// (engine/circuit-art.ts). O servidor roda este mesmo arquivo (gerado por
// scripts/build-corrida-sim.js no back): mudou → regerar e commitar os dois.
//
// Todas com 18 m de largura e as mesmas regras de nave. Curvas com raio ≥ ~55
// m onde se passa rápido; loop sempre depois de reta (a nave entra alinhada).

/** Abismo Vermelho — cânion: curvas na borda, túnel suspenso, a grande descida e o salto. */
const ABISMO           = {
  id: "abismo-vermelho",
  width: 18,
  startY: 70,
  startS: 40,
  pieces: [
    { len: 170, pads: [[110, 0]], gates: [40], orbs: [[75, -5], [75, 5]] },
    { len: 270, turn: 117 },
    { len: 70, turn: -48, orbs: [[35, -4]] },
    { len: 120, turn: 95, orbs: [[60, 4]] },
    { len: 120, tunnel: true, pads: [[60, 0]] },
    { len: 100, tunnel: true, gates: [50] },
    { len: 230, dy: -62, kind: "drop", orbs: [[120, 0]] },
    { len: 90, pads: [[20, -1], [20, 1]] },
    { len: 55, dy: 9, kind: "ramp" },
    { len: 125, dy: -14, kind: "gap" },
    { len: 90, gates: [45] },
    { len: 155, turn: 125, dy: 30, pads: [[110, 0]] },
    { len: 310, dy: 26, orbs: [[150, -5], [150, 5]] },
    { len: 360, turn: 71, dy: 12 },
  ],
}

/** Floresta Espectral — túnel largo entre as árvores, pontes no alto e a espiral que desce. */
const FLORESTA           = {
  id: "floresta-espectral",
  width: 18,
  startY: 46,
  startS: 40,
  pieces: [
    { len: 160, pads: [[100, 0]], gates: [40], orbs: [[70, -5], [70, 5]] },
    { len: 116, turn: -92 },
    { len: 170, tunnel: true, orbs: [[85, 0]] },
    { len: 72, tunnel: true, turn: -49 },
    { len: 140, dy: 18, gates: [70] },
    { len: 85, turn: 5, orbs: [[40, 4]] },
    // a espiral: uma volta inteira descendo (a pista passa por baixo dela mesma)
    { len: 480, turn: -360, dy: -44, kind: "drop", pads: [[240, 0]] },
    { len: 110, orbs: [[55, -4], [55, 4]] },
    { len: 170, dy: -26, kind: "drop" },
    { len: 217, turn: -115, pads: [[120, -1]] },
    { len: 324, dy: 22, orbs: [[160, 0]] },
    { len: 426, turn: -109, dy: 30 },
  ],
}

/** Neon Overdrive — megacidade: o loop entre os prédios, túnel e a descida rumo ao centro. */
const NEON           = {
  id: "neon-overdrive",
  width: 18,
  startY: 80,
  startS: 40,
  pieces: [
    { len: 190, pads: [[120, 0]], gates: [40], orbs: [[80, -5], [80, 5]] },
    { len: 170, turn: 85 },
    { len: 110, pads: [[30, 0]] },
    { len: 150, kind: "loop", side: 22 },
    { len: 110, tunnel: true, orbs: [[55, 0]] },
    { len: 160, turn: 80, tunnel: true },
    { len: 240, dy: -58, kind: "drop", pads: [[170, 0]] },
    { len: 140, gates: [70], orbs: [[60, -5], [60, 5]] },
    { len: 160, turn: 90 },
    { len: 230, dy: 48, orbs: [[110, 0]] },
    { len: 200, turn: 95, dy: 10 },
  ],
}

/** Tempestade Oceânica — longas curvas sobre o mar, plataformas ligadas por saltos, túnel. */
const TEMPESTADE           = {
  id: "tempestade-oceanica",
  width: 18,
  startY: 26,
  startS: 40,
  pieces: [
    { len: 170, pads: [[110, 0]], gates: [40], orbs: [[75, -5], [75, 5]] },
    // a grande curva inclinada exposta ao mar
    { len: 330, turn: 175, dy: 8, orbs: [[165, 4]] },
    { len: 140, tunnel: true, pads: [[70, 0]] },
    { len: 120, turn: -50 },
    { len: 120, turn: 50, orbs: [[60, -4]] },
    { len: 70, pads: [[10, -1], [10, 1]] },
    { len: 45, dy: 6, kind: "ramp" },
    { len: 75, dy: -10, kind: "gap" },
    { len: 90, gates: [45] },
    { len: 180, turn: 90, dy: -4 },
    { len: 150, tunnel: true, orbs: [[75, 0]] },
    { len: 180, turn: 92 },
  ],
}

/** Forja Infinita — dentro da máquina: túnel interno, o loop gigante, subida e a queda. */
const FORJA           = {
  id: "forja-infinita",
  width: 18,
  startY: 56,
  startS: 40,
  pieces: [
    { len: 160, pads: [[100, 0]], gates: [40], orbs: [[70, -5], [70, 5]] },
    { len: 160, turn: -85, tunnel: true },
    { len: 130, tunnel: true, pads: [[90, 0]] },
    { len: 200, kind: "loop", side: -24 },
    { len: 100, gates: [50], orbs: [[50, 0]] },
    { len: 180, dy: 40 },
    { len: 170, turn: -90 },
    { len: 210, dy: -66, kind: "drop", pads: [[150, 0]] },
    { len: 110, orbs: [[55, -5], [55, 5]] },
    { len: 170, turn: -85, tunnel: true },
    { len: 60, pads: [[10, 0]] },
    { len: 50, dy: 8, kind: "ramp" },
    { len: 90, dy: -12, kind: "gap" },
    { len: 200, turn: -95, dy: 10 },
  ],
}

/** As 6 pistas na ordem do cardápio. A primeira é a padrão (a Baía Suspensa). */
const TRACK_DEFS                      = [BAIA, ABISMO, FLORESTA, NEON, TEMPESTADE, FORJA]
const DEFAULT_TRACK = BAIA.id

/** Definição pelo id (desconhecido = a padrão). */
function trackDefOf(id                           )           {
  return TRACK_DEFS.find((d) => d.id === id) ?? BAIA
}

const builtTracks = new Map               ()
/** Pista montada (uma vez por id). */
function trackOf(id                           )        {
  const def = trackDefOf(id)
  let t = builtTracks.get(def.id)
  if (!t) {
    t = buildTrack(def)
    builtTracks.set(def.id, t)
  }
  return t
}

// ── sim/race.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/corrida/sim/race.ts — CORRIDA ANTIGRAVIDADE (mm3d-39): a partida.
//
// Naves em coordenadas da pista: `dist` (metros andados ao longo do eixo, sem
// dar a volta — a volta sai dele), `u` (metros para a direita) e a altura Y
// absoluta. O rumo é do MUNDO: na curva a pista gira por baixo e é preciso
// esterçar (com uma ajuda leve que alinha a nave quando ninguém mexe).
//
// No chão a nave flutua colada à pista e herda a inclinação; quando o chão
// some (fim da rampa, crista) vira voo balístico. Segurar o acelerador no ar
// é a antigravidade: a queda fica mais lenta (planar). Caiu no vão = volta
// no pouso, parada por um instante.
//
// Turbo: faixas na pista (na hora) e cápsulas (cargas, até 3, usadas pelo
// botão). Rivais seguem a linha de corrida com uma habilidade cada.
//
// Três tipos de nave (mm3d-39b, multiplayer): "local" (a deste aparelho, pela
// entrada), "bot" (o computador dirige) e "remote" (outro jogador: o estado
// vem de fora, por `applyRemote`, e a regra só conta as voltas dela). Sozinho
// = 1 local + 5 bots; no servidor = jogadores remote + bots; no aparelho de
// quem joga em grupo = 1 local + o resto remote (os bots vêm do servidor).
//
// Passo fixo de 1/120 s; sem Babylon.

const TUNING = {
  step: 1 / 120,
  laps: 3,
  countdown: 3,
  vmax: 62,
  boostMax: 94,
  accel: 26,
  boostAccel: 70,
  brake: 48,
  coast: 7,
  /** rad/s parado → em velocidade máxima. */
  turnLow: 2.1,
  turnHigh: 1.15,
  /** Ajuda que alinha a nave com a pista sem volante (1/s). */
  assist: 0.7,
  gravity: 26,
  /** Gravidade segurando o acelerador no ar (antigravidade). */
  glideGravity: 16,
  airTurn: 0.55,
  /** Metade da largura da nave (parede). */
  half: 1.25,
  wallKeep: 0.9,
  /** Faixa de turbo e carga do botão (s). */
  padBoost: 1.25,
  turboBoost: 1.8,
  padKick: 16,
  maxCharges: 3,
  orbBack: 5,
  /** Caiu: tempo parado antes de voltar e velocidade de volta. */
  respawn: 1.4,
  respawnV: 34,
  /** Fora da pista tantos metros abaixo do pouso = caiu. */
  fallDepth: 14,
  /** Tempo máximo depois que o jogador cruza a chegada. */
  tail: 12,
}         

                           
                                 
               
             
                  
             
               
                                     
                
 

                                                

                      
            
              
               
               
                                                                                       
               
                                                         
              
           
             
           
           
            
              
               
                 
                                                
              
                                             
                
                         
                  
                
                                                                     
                  
                                                                           
               
              
              
               
                                                     
                  
                     
                                                    
              
                  
 

                       
                                
                                  
                                             
                                    
                                                
                                 
                                 
                                          
                                                                          
                                                                
                  
                   

                                                    

/**
 * As naves da garagem (mm3d-49). Cada uma ganha num ponto e perde em outro
 * (os desvios somam zero, nenhum passa de 10%): `speed` = teto (normal e
 * turbo), `accel` = arrancada, `turn` = curva, `turbo` = quanto dura cada
 * turbo (faixa e carga). Teto de `speed` ≤ 1,05: a sala aceita até 1,2× o
 * turbo. A primeira é a nave do mm3d-41 (o padrão).
 */
                            
               
               
              
               
 
const SHIPS                                          = [
  { id: "brasa", speed: 1, accel: 1, turn: 1, turbo: 1 },
  { id: "corisco", speed: 1.05, accel: 0.97, turn: 0.96, turbo: 1.02 },
  { id: "rubi", speed: 1.02, accel: 1.05, turn: 0.98, turbo: 0.95 },
  { id: "aurora", speed: 0.98, accel: 1, turn: 1.07, turbo: 0.95 },
  { id: "tita", speed: 0.96, accel: 1.03, turn: 0.95, turbo: 1.06 },
  { id: "vespa", speed: 1.03, accel: 1.04, turn: 1, turbo: 0.93 },
]
const DEFAULT_SHIP = "brasa"
/** A nave pelo id (id desconhecido = a padrão). */
function shipOf(id                           ) {
  return SHIPS.find((s) => s.id === id) ?? SHIPS[0]
}

const CAR_COLORS = ["#C8102E", "#1F7AE0", "#F2B705", "#16A37F", "#8E44D9", "#F26B1D"]         
const RIVALS = ["Faísca", "Cometa", "Vulcão", "Neblina", "Trovão"]         

                           
              
               
                                                                    
               
 

                              
              
                                                             
                 
                                                                                           
                    
                                                                 
             
               
                     
               
                                                                                                      
                   
 

/** Estado de uma nave que veio da rede. */
                            
              
           
           
             
           
            
              
                
               
               
                  
 

/** Gerador pequeno e determinístico (os rivais variam igual em toda partida com a mesma semente). */
function rng(seed        ) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) % 100000) / 100000
  }
}

class Race {
           track       
           laps        
           cars        = []
  phase            = "countdown"
  /** s desde a largada (negativo na contagem). */
  time        
  /** Cápsulas fora (id → s até voltar). */
           orbOut = new Map                ()
                   rand              
                   p             = {}              
                   q             = {}              
          padCool = new Map                ()
          endAt                = null
          finishedCount = 0
           me        
           autoEnd         
  bestLap                = null

  constructor(opts             ) {
    this.track = opts.track
    this.laps = opts.laps ?? TUNING.laps
    this.time = -TUNING.countdown
    this.rand = rng(opts.seed ?? 7)
    this.me = opts.me ?? 0
    this.autoEnd = opts.autoEnd ?? true
    let bots = 0
    const seats             =
      opts.seats ?? [{ name: opts.playerName ?? "Você", kind: "local" }, ...Array.from({ length: opts.rivals ?? 0 }, ()           => ({ name: "", kind: "bot" }))]
    const n = seats.length
    const W = this.track.width
    for (let i = 0; i < n; i++) {
      const seat = seats[i]
      // grid em duas colunas atrás da linha; o jogador larga no fim do pelotão
      const slot = n - 1 - i
      const row = Math.floor(slot / 2)
      const col = slot % 2 === 0 ? -1 : 1
      const dist = this.track.startS - 8 - row * 9 - (col > 0 ? 4 : 0)
      const pt = trackAt(this.track, dist, this.p)
      const u = col * W * 0.2
      const bot = seat.kind === "bot"
      const base = bot ? 0.9 + 0.075 * (i / Math.max(1, n - 1)) + this.rand() * 0.02 : 1
      const ship = shipOf(seat.ship ?? SHIPS[i % SHIPS.length].id)
      this.cars.push({
        id: i,
        name: bot ? seat.name || RIVALS[bots++ % RIVALS.length] : seat.name,
        color: CAR_COLORS[i % CAR_COLORS.length],
        kind: seat.kind,
        gone: false,
        dist,
        u,
        yaw: pt.yaw,
        v: 0,
        Y: surfaceY(pt, u),
        vy: 0,
        air: false,
        boost: 0,
        charges: bot ? 0 : 1,
        down: 0,
        scrape: 0,
        finished: null,
        lapStart: 0,
        laps: [],
        safeDist: dist,
        skill: base,
        base,
        lane: (this.rand() - 0.5) * 6,
        laneT: 0,
        steerNow: 0,
        throttleNow: 0,
        ship: ship.id,
        stats: ship,
      })
    }
  }

  /** A nave deste aparelho (no servidor não há: a primeira). */
  get player()      {
    return this.cars[Math.max(0, this.me)]
  }

  /** Volta em andamento (1…laps) de uma nave. */
  lapOf(c     )         {
    return Math.min(this.laps, Math.max(1, Math.floor((c.dist - this.track.startS) / this.track.length) + 1))
  }

  /** Progresso para a classificação (quem terminou vem antes, pela ordem de chegada). */
          score(c     )         {
    if (c.gone && c.finished === null) return -1e9 + c.dist
    return c.finished !== null ? 1e9 - c.finished : c.dist
  }

  standings()        {
    return [...this.cars].sort((a, b) => this.score(b) - this.score(a))
  }

  placeOf(c     )         {
    return this.standings().indexOf(c) + 1
  }

  step(input          , out             ) {
    const dt = TUNING.step
    this.time += dt
    if (this.phase === "countdown" && this.time >= 0) {
      this.phase = "race"
      out.push({ type: "go" })
    }
    if (this.phase === "countdown") return
    for (const [id, t] of this.orbOut) {
      if (t - dt <= 0) this.orbOut.delete(id)
      else this.orbOut.set(id, t - dt)
    }
    for (const [k, t] of this.padCool) {
      if (t - dt <= 0) this.padCool.delete(k)
      else this.padCool.set(k, t - dt)
    }
    for (const c of this.cars) {
      if (c.kind === "remote" || c.gone) continue
      const inp = c.finished !== null ? FINISHED_INPUT : c.kind === "bot" ? this.drive(c) : input
      this.move(c, inp, dt, out)
    }
    this.collide(out)
    if (this.phase === "race" && this.endAt !== null && this.time >= this.endAt) {
      this.phase = "end"
      out.push({ type: "end" })
    }
  }

  // ── uma nave ──────────────────────────────────────────────────────────────
          move(c     , inp          , dt        , out             ) {
    const T = this.track
    c.steerNow = inp.steer
    c.throttleNow = inp.throttle
    if (c.scrape > 0) c.scrape = Math.max(0, c.scrape - dt)
    if (c.down > 0) {
      c.down -= dt
      if (c.down <= 0) this.respawn(c)
      return
    }
    const p = trackAt(T, c.dist, this.p)
    const halfW = T.width / 2 - TUNING.half
    // turbo pelo botão (carga)
    if (inp.turbo && c.charges > 0 && c.boost < 0.3) {
      c.charges--
      c.boost = TUNING.turboBoost * c.stats.turbo
      c.v = Math.min(TUNING.boostMax * c.stats.speed, c.v + TUNING.padKick * 0.6)
      out.push({ type: "turbo", car: c.id })
    }
    if (c.boost > 0) c.boost = Math.max(0, c.boost - dt)
    const st = c.stats
    const vmax = (c.boost > 0 ? TUNING.boostMax : TUNING.vmax) * c.skill * st.speed
    // velocidade
    if (c.boost > 0) c.v += TUNING.boostAccel * st.accel * dt * (1 - c.v / (TUNING.boostMax * st.speed))
    else if (inp.throttle > 0) c.v += TUNING.accel * st.accel * inp.throttle * dt * Math.max(0, 1 - c.v / vmax) * 1.6
    if (c.v > vmax) c.v = Math.max(vmax, c.v - TUNING.coast * 3 * dt)
    if (inp.brake > 0) c.v = Math.max(0, c.v - TUNING.brake * inp.brake * dt)
    if (inp.throttle <= 0 && c.boost <= 0 && !c.air) c.v = Math.max(0, c.v - TUNING.coast * dt)
    // direção
    const t = Math.min(1, c.v / TUNING.vmax)
    const rate = (TUNING.turnLow + (TUNING.turnHigh - TUNING.turnLow) * t) * (c.air ? TUNING.airTurn : 1) * st.turn
    if (c.v > 0.5) c.yaw += inp.steer * rate * dt * Math.min(1, c.v / 8)
    let a = wrapAngle(c.yaw - p.yaw)
    if (!c.air && Math.abs(inp.steer) < 0.05) a -= a * Math.min(1, TUNING.assist * dt)
    c.yaw = p.yaw + a
    // avança
    const uFrom = c.u
    const ds = c.v * Math.cos(a) * dt
    c.dist += ds
    c.u += c.v * Math.sin(a) * dt
    // parede (também no ar: os vãos têm a mesma largura)
    if (Math.abs(c.u) > halfW) {
      c.u = Math.sign(c.u) * halfW
      const hit = Math.abs(a) > 0.05
      a = -a * 0.35
      c.yaw = p.yaw + a
      if (hit && c.scrape <= 0) {
        c.v *= TUNING.wallKeep
        out.push({ type: "wall", car: c.id })
      }
      c.scrape = 0.25
    }
    const q = trackAt(T, c.dist, this.q)
    const ground = surfaceY(q, c.u)
    if (c.air) {
      const g = inp.throttle > 0 ? TUNING.glideGravity : TUNING.gravity
      c.vy -= g * dt
      c.Y += c.vy * dt
      // mm3d-74: entrar no ar num trecho preso (loop, queda) = a pista puxa a nave
      if (!q.gap && (c.Y <= ground || q.glue)) {
        if (!q.glue && c.Y < ground - 2.2) {
          this.fall(c, out) // passou por baixo da pista
          return
        }
        const hard = c.vy < -14
        c.air = false
        c.Y = ground
        c.vy = c.v * q.slope
        c.v *= hard ? 0.9 : 0.97
        c.safeDist = c.dist
        out.push({ type: "land", car: c.id, hard })
      } else if (c.Y < this.fallFloor(c.dist)) {
        this.fall(c, out)
        return
      }
    } else {
      // crista ou fim da rampa: o balístico fica acima do chão → decola.
      // mm3d-73: o que o chão desce só pela inclinação lateral (entrar/sair da
      // curva inclinada, ir para o lado de dentro) não é crista: a nave segue
      // colada. Só a subida/descida do EIXO decide a decolagem.
      const vy = c.v * p.slope
      const bankDrop = surfaceY(q, c.u) - q.y - (surfaceY(p, uFrom) - p.y)
      const next = c.Y + vy * dt - 0.5 * TUNING.gravity * dt * dt + Math.min(0, bankDrop)
      if (!q.glue && (q.gap || next > ground + 0.04)) {
        c.air = true
        c.vy = vy
        c.Y = next
        out.push({ type: "takeoff", car: c.id })
      } else {
        c.Y = ground
        c.vy = c.v * q.slope
        if (!q.ramp) c.safeDist = c.dist
      }
    }
    if (!c.air) this.pickups(c, out)
    this.laps_(c, out)
  }

  /** Abaixo disto a nave não volta mais (pouso do vão menos a folga, ou o chão). */
          fallFloor(dist        )         {
    const s = wrapS(this.track, dist)
    for (const g of this.track.gaps) {
      if (s >= g.s0 - STEP && s <= g.s1 + STEP) return g.landY - TUNING.fallDepth
    }
    return trackAt(this.track, dist, this.q).y - TUNING.fallDepth
  }

          fall(c     , out             ) {
    c.down = TUNING.respawn
    c.v = 0
    c.boost = 0
    out.push({ type: "fell", car: c.id })
  }

  /** Volta no pouso do vão onde caiu (ou no último chão firme). */
          respawn(c     ) {
    const T = this.track
    const s = wrapS(T, c.dist)
    let to = c.safeDist
    for (const g of T.gaps) {
      if (s >= g.s0 - g.ramp - STEP * 2 && s <= g.s1 + 40) {
        const lapBase = c.dist - s
        to = lapBase + g.s1 + 12
        break
      }
    }
    c.down = 0
    c.dist = to
    const p = trackAt(T, to, this.p)
    c.u = 0
    c.yaw = p.yaw
    c.v = TUNING.respawnV
    c.Y = p.y
    c.vy = 0
    c.air = false
    c.safeDist = to
  }

          pickups(c     , out             ) {
    const T = this.track
    const s = wrapS(T, c.dist)
    for (let i = 0; i < T.pads.length; i++) {
      const pd = T.pads[i]
      const ds = s - pd.s
      if (ds < 0 || ds > pd.len || c.u < pd.u0 - 0.6 || c.u > pd.u1 + 0.6) continue
      const k = `${c.id}:${i}`
      if (this.padCool.has(k)) continue
      this.padCool.set(k, 1)
      c.boost = Math.max(c.boost, TUNING.padBoost * c.stats.turbo)
      c.v = Math.min(TUNING.boostMax * c.stats.speed, c.v + TUNING.padKick)
      out.push({ type: "pad", car: c.id })
    }
    for (const o of T.orbs) {
      if (this.orbOut.has(o.id)) continue
      let ds = Math.abs(s - o.s)
      ds = Math.min(ds, T.length - ds)
      if (ds > 2.6 || Math.abs(c.u - o.u) > 2.2) continue
      this.orbOut.set(o.id, TUNING.orbBack)
      if (c.charges < TUNING.maxCharges) c.charges++
      out.push({ type: "orb", car: c.id, orb: o.id })
    }
  }

          laps_(c     , out             ) {
    if (c.finished !== null) return
    const T = this.track
    const done = Math.floor((c.dist - T.startS) / T.length)
    while (c.laps.length < done && c.laps.length < this.laps) {
      const lapTime = this.time - c.lapStart
      c.lapStart = this.time
      c.laps.push(lapTime)
      let best = false
      if (c.id === this.me && (this.bestLap === null || lapTime < this.bestLap)) {
        this.bestLap = lapTime
        best = true
      }
      out.push({ type: "lap", car: c.id, lap: c.laps.length, time: lapTime, best })
      if (c.laps.length >= this.laps) {
        c.finished = this.time
        this.finishedCount++
        out.push({ type: "finish", car: c.id, place: this.finishedCount, time: this.time })
        this.checkEnd()
      }
    }
  }

  /** Todos os jogadores terminaram (ou saíram): mais um tempo para os bots; todo mundo: fim logo. */
          checkEnd() {
    if (!this.autoEnd) return
    const live = this.cars.filter((c) => !c.gone)
    if (live.length && live.every((c) => c.finished !== null)) {
      this.endAt = Math.min(this.endAt ?? Infinity, this.time + 1.5)
      return
    }
    const humans = this.cars.filter((c) => c.kind !== "bot")
    if (humans.every((c) => c.finished !== null || c.gone) && this.endAt === null) this.endAt = this.time + TUNING.tail
  }

  // ── multiplayer ──────────────────────────────────────────────────────────
  /** Estado de outro jogador (ou de um bot do servidor) que chegou pela rede; conta as voltas. */
  applyRemote(id        , r           , out             ) {
    const c = this.cars[id]
    if (!c || c.kind !== "remote" || c.gone) return
    c.dist = r.dist
    c.u = r.u
    c.Y = r.Y
    c.yaw = r.yaw
    c.v = r.v
    c.vy = r.vy
    c.air = r.air
    c.boost = r.boost ? Math.max(c.boost, 0.1) : 0
    c.down = r.down ? Math.max(c.down, 0.1) : 0
    c.steerNow = r.steer
    c.throttleNow = r.throttle
    if (this.phase === "race") this.laps_(c, out)
  }

  /** Estado para mandar pela rede. */
  remoteOf(c     )            {
    return { dist: c.dist, u: c.u, Y: c.Y, yaw: c.yaw, v: c.v, vy: c.vy, air: c.air, boost: c.boost > 0, down: c.down > 0, steer: c.steerNow, throttle: c.throttleNow }
  }

  /** O jogador saiu no meio: some da pista e vai para o fim da classificação. */
  markGone(id        ) {
    const c = this.cars[id]
    if (!c || c.gone) return
    c.gone = true
    c.v = 0
    this.checkEnd()
  }

  /** Cápsula pedida por um jogador remoto (o servidor decide quem leva). */
  claimOrb(car        , orb        , out             )          {
    const c = this.cars[car]
    const o = this.track.orbs.find((k) => k.id === orb)
    if (!c || !o || this.orbOut.has(orb)) return false
    let ds = Math.abs(wrapS(this.track, c.dist) - o.s)
    ds = Math.min(ds, this.track.length - ds)
    if (ds > 40) return false // longe demais da cápsula (atraso cabe; teletransporte não)
    this.orbOut.set(orb, TUNING.orbBack)
    out.push({ type: "orb", car, orb })
    return true
  }

  /** O fim decidido de fora (a sala mandou o resultado). */
  end(out             ) {
    if (this.phase === "end") return
    this.phase = "end"
    out.push({ type: "end" })
  }

  // ── encostar: empurra de lado e quem vem atrás perde um pouco ─────────────
          collide(out             ) {
    const cs = this.cars
    for (let i = 0; i < cs.length; i++) {
      const a = cs[i]
      if (a.down > 0 || a.gone) continue
      for (let j = i + 1; j < cs.length; j++) {
        const b = cs[j]
        if (b.down > 0 || b.gone || a.air !== b.air) continue
        // a nave que vem da rede não se mexe aqui: quem empurra é só a simulada
        const ma = a.kind !== "remote"
        const mb = b.kind !== "remote"
        if (!ma && !mb) continue
        const ds = b.dist - a.dist
        const du = b.u - a.u
        if (Math.abs(ds) > 4.2 || Math.abs(du) > 2.4) continue
        if (Math.abs(a.Y - b.Y) > 1.6) continue
        const push = (2.4 - Math.abs(du)) / (ma && mb ? 2 : 1)
        const dir = du === 0 ? (j % 2 ? 1 : -1) : Math.sign(du)
        if (ma) a.u -= dir * push
        if (mb) b.u += dir * push
        const back = ds > 0 ? a : b
        const front = ds > 0 ? b : a
        if (Math.abs(du) < 1.6) {
          if (back.kind !== "remote") back.v = Math.max(0, back.v - 3)
          if (front.kind !== "remote") front.v += 1
        }
        out.push({ type: "bump", a: a.id, b: b.id })
      }
    }
  }

  // ── piloto dos rivais ────────────────────────────────────────────────────
          drive(c     )           {
    const T = this.track
    const dt = TUNING.step
    c.laneT -= dt
    if (c.laneT <= 0) {
      c.laneT = 2 + this.rand() * 3
      c.lane = (this.rand() - 0.5) * 7
    }
    const look = 16 + c.v * 0.45
    const ahead = trackAt(T, c.dist + look, this.q)
    // linha de corrida: por dentro da curva; perto de vão/faixa de turbo, no meio
    let curv = 0
    for (let k = 1; k <= 4; k++) curv += trackAt(T, c.dist + k * 14, this.p).curv
    curv /= 4
    const halfW = T.width / 2 - TUNING.half - 1
    let target = Math.max(-halfW, Math.min(halfW, curv * 650 + c.lane))
    const s = wrapS(T, c.dist)
    for (const g of T.gaps) {
      const before = g.s0 - g.ramp - 160
      if (s > before && s < g.s1) target = 0
    }
    // de olho numa faixa de turbo logo à frente
    for (const pd of T.pads) {
      const d = pd.s - s
      if (d > 0 && d < 70) target = (pd.u0 + pd.u1) / 2
    }
    // não bater em quem está logo à frente
    for (const o of this.cars) {
      if (o === c || o.down > 0) continue
      const d = o.dist - c.dist
      if (d > 0 && d < 14 && Math.abs(o.u - target) < 2.6) target = o.u + (o.u > 0 ? -3.2 : 3.2)
    }
    const want = ahead.yaw + Math.atan2(target - c.u, look)
    const err = wrapAngle(want - c.yaw)
    const steer = Math.max(-1, Math.min(1, err * 3.2))
    // elástico: muito à frente do melhor jogador segura; muito atrás do último acelera
    let lead = -Infinity
    let last = Infinity
    for (const o of this.cars) {
      if (o.kind === "bot" || o.gone) continue
      lead = Math.max(lead, o.dist)
      last = Math.min(last, o.dist)
    }
    const band = !Number.isFinite(lead) ? 1 : c.dist - lead > 160 ? 0.95 : c.dist - last < -160 ? 1.05 : 1
    c.skill += (c.base * band - c.skill) * Math.min(1, 0.5 * dt)
    const turbo = c.charges > 0 && Math.abs(curv) < 0.002 && this.rand() < 0.004
    return { steer, throttle: 1, brake: Math.abs(err) > 0.6 && c.v > 30 ? 0.4 : 0, turbo }
  }
}

const FINISHED_INPUT           = { steer: 0, throttle: 0.6, brake: 0, turbo: false }

/** Mundo de uma nave (desenho): posição, rumo, arfagem e rolagem. */
                          
           
           
           
             
               
              
 

const POSE_P             = {}              
function carPose(race      , c     , out         )          {
  const p = trackAt(race.track, c.dist, POSE_P)
  const w = worldAt(p, c.u)
  out.x = w.x
  out.z = w.z
  out.y = c.Y
  out.yaw = c.yaw
  // mm3d-74: no loop a nave gira junto com a pista (nariz para cima até a volta inteira)
  out.pitch = p.inLoop ? p.loop : c.air ? Math.max(-0.45, Math.min(0.35, Math.atan2(c.vy, Math.max(8, c.v)) * 0.7)) : Math.atan(p.slope)
  out.roll = (c.air ? 0 : p.bank) + c.steerNow * Math.min(1, c.v / 30) * 0.16
  return out
}

module.exports = { STEP, BANK_MAX, BANK_K, wrapAngle, wrapS, buildTrack, trackAt, surfaceY, worldAt, BAIA, ABISMO, FLORESTA, NEON, TEMPESTADE, FORJA, TRACK_DEFS, DEFAULT_TRACK, trackDefOf, trackOf, TUNING, SHIPS, DEFAULT_SHIP, shipOf, CAR_COLORS, Race, carPose };
