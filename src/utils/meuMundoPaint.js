// GERADO por scripts/build-paint-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/paint/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── sim/tuning.ts ────────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/tuning.ts — PAINT (mm3d-35): os números do jogo.
//
// Regra única: o navegador e a sala (src/utils/meuMundoPaint.js, GERADO deste
// diretório por scripts/build-paint-sim.js no back) usam os mesmos valores.
// Unidades: metros, segundos, m/s. y para cima; o chão das ilhas é o topo.

/** As três tintas. O índice é o que viaja na rede. */
const PAINT = {
  /** Turquesa: plataforma (ponte). */
  BRIDGE: 0,
  /** Vermelho escuro: dano; apaga a tinta do outro time. */
  HARM: 1,
  /** Amarelo: degrau (sobe). */
  STEP: 2,
}         
                                  

const PAINT_COLORS = ["#1FC8C0", "#9E1B2B", "#F2C230"]         

const TUNING = {
  /** Passo fixo da física do corpo. */
  step: 1 / 60,
  gravity: 22,
  walk: 4.4,
  run: 6.6,
  /** Pulo: 7,6 m/s com g 22 → ~1,31 m de altura, ~0,69 s no ar. */
  jumpV: 7.6,
  /** Controle no ar (fração da aceleração no chão). */
  airControl: 0.55,
  accel: 30,
  /** Quanto o corpo sobe sozinho num degrau (sem pular). */
  stepUp: 0.42,
  /** Raio e altura do corpo (cápsula). */
  bodyR: 0.4,
  bodyH: 1.75,
  /** Abaixo disto caiu nas nuvens: volta à base. */
  fallY: -26,
  /** Tolerância de "pisando" para pular logo depois de sair da borda. */
  coyote: 0.12,

  /** Munição por cor: começa, máximo, recarga da cápsula. */
  ammoStart: 24,
  ammoMax: 40,
  capsuleGive: 20,
  capsuleRespawn: 10,
  capsuleR: 1.1,
  /** Tiros por segundo segurando o botão (índice = cor). */
  fireRate: [7, 6, 3.5]                     ,
  /** Custo em munição de cada tiro (índice = cor). */
  cost: [1, 1, 2]                     ,
  /** Alcance (m) do raio de cada cor. */
  range: [13, 24, 9]                     ,

  /** Ponte (turquesa): disco achatado. */
  bridgeR: 1.25,
  bridgeH: 0.34,
  /** A ponte cresce até esta distância horizontal de quem atira. */
  bridgeReach: 12,
  /** Degrau (amarelo): cilindro alto. */
  stepR: 0.85,
  stepH: 1.0,
  /** Tinta some depois de (s) e cada jogador tem no máximo N manchas. */
  blobLife: 45,
  blobsPerPlayer: 60,

  /** Corações, soco e dano. */
  hearts: 5,
  punchRange: 1.8,
  punchCos: 0.5, // cone de 60° para cada lado
  punchCooldown: 0.6,
  punchKnock: 8.5,
  punchLift: 4.5,
  harmKnock: 3.2,
  harmLift: 2,
  /** Raio do alvo do tiro (cápsula do outro jogador). */
  hitR: 0.55,
  /** Nocaute: s até voltar à base; depois de voltar, s sem tomar dano. */
  koTime: 3,
  shield: 2,

  /** Gatinhos. */
  catR: 1.3,
  catsToPortal: 20,
  portalR: 1.8,

  /** Chefão (provisório até a etapa do chefão). */
  bossHp: 4000,
  bossHarm: 20,
  bossPunch: 10,
  bossR: 2.6,
  bossH: 6,

  /** Partida. */
  matchTime: 600,
  countdown: 5,
}         

/** Modos de partida: jogadores por time. */
const PAINT_MODES = { solo: 1, "1v1": 1, "2v2": 2, "3v3": 3 }         
                                                
function modeTeams(mode           ) {
  return mode === "solo" ? 1 : 2
}
function modeCapacity(mode           ) {
  return PAINT_MODES[mode] * modeTeams(mode)
}

// ── sim/map.ts ───────────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/map.ts — PAINT (mm3d-35): o mapa das ilhas.
//
// UM mapa fixo (igual em toda partida, navegador e sala). Dois lados
// espelhados em x: o time 0 nasce a oeste (x < 0), o time 1 a leste.
//
//  - Cada lado é uma TORRE: a ilha-base (y 0) e 11 ilhas em espiral em volta
//    dela, cada uma mais alta, até o TOPO sobre a base (onde abre o portal do
//    time). Entre uma ilha e a próxima há um vão (precisa de ponte turquesa)
//    e/ou um degrau alto demais para o pulo (precisa de degrau amarelo).
//  - No meio (x = 0) a COLUNA DISPUTADA: 4 ilhas com mais gatinhos, longe das
//    duas torres (ponte comprida).
//  - Ilhotas laterais com um gatinho cada.
//  - A ilha do chefão fica longe (z 320), fora da vista da arena.
//
// Gatinhos: 18 de cada lado + 12 no meio = 48; o portal pede 20 do time, então
// quem só ficar no próprio lado não chega lá.

/** Cilindro vertical (ilha, pilar, mancha de tinta) — `y1` é o topo (o chão). */
                           
      
           
           
            
            
           
                                                                                             
            
            
               
 
/** Caixa alinhada aos eixos (caixote, muro). */
                           
      
           
           
            
            
            
            
 
                                       

                                                                                  
                         
            
                  
                                              
              
           
           
           
           
                                                                                
               
 
                            
                          
           
           
           
                                                
           
           
             
 
                           
            
           
           
           
                                                               
             
                
 
                               
            
              
           
           
           
 
                            
              
                
                                                                   
                                                               
 
                           
                   
                    
                                                                                       
                 
                  
                          
                    
                 
                                                                                                                          
 

/** A pedra que colide embaixo do topo (o desenho desce mais). */
const COLLIDER_DEPTH = 2.6

const COLUMN_X = 34
const SPIRAL_R = 14
const SPIRAL_STEP = 0.95
/** Subida de cada ilha da espiral: alterna "vão com pulo" e "degrau alto". */
const SPIRAL_DY = [1.2, 3.0, 1.4, 3.4, 1.2, 3.2, 1.6, 3.6, 1.2, 3.4, 1.6]
const SPIRAL_RADII = [4.2, 3.6, 4.4, 3.4, 4.0, 3.6, 4.4, 3.4, 4.0, 3.6, 4.2]
const BRANCH_AT = [2, 5, 8, 10]
const SUMMIT_Y = 30
const CENTER_Y = [7, 14, 21, 28]
const CENTER_Z = [5, -5, 5, -5]
const BOSS = { x: 0, y: 60, z: 320, r: 18 }

const round = (v        ) => Math.round(v * 1000) / 1000

/** Pseudo-aleatório fixo por número (enfeites do mapa). */
function hash01(n        ) {
  let h = (n * 2654435761) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 2246822519) >>> 0
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

function buildPaintMap()           {
  const islands           = []
  const props              = []
  const cats             = []
  const capsules                 = []
  const bases              = []
  const portals         = []
  let catSeq = 0
  let capSeq = 0

  const island = (kind            , team        , x        , y        , z        , r        ) => {
    const isl         = { id: islands.length, kind, team, x: round(x), y: round(y), z: round(z), r, depth: round(r * 1.25 + 1.5) }
    islands.push(isl)
    return isl
  }
  /** Ponto no topo da ilha: ângulo e fração do raio. */
  const on = (isl        , ang        , f        )       => ({ x: round(isl.x + Math.sin(ang) * isl.r * f), y: isl.y, z: round(isl.z + Math.cos(ang) * isl.r * f) })
  const cat = (isl        , ang        , f        ) => {
    const p = on(isl, ang, f)
    cats.push({ id: catSeq++, ...p, skin: (catSeq % 3 === 0 ? 1 : 0)         , facing: round(hash01(catSeq * 7 + 3) * Math.PI * 2) })
  }
  const capsule = (isl        , c           , ang        , f        ) => {
    const p = on(isl, ang, f)
    capsules.push({ id: capSeq++, c, ...p })
  }
  /** Enfeites na borda (pilar com corda, caixote) — longe do meio, onde ficam gatinho e cápsula. */
  const decorate = (isl        ) => {
    const n = isl.r >= 8 ? 4 : isl.r >= 4 ? 2 : 1
    for (let i = 0; i < n; i++) {
      const a = hash01(isl.id * 31 + i * 7) * Math.PI * 2
      const p = on(isl, a, 0.78)
      if (hash01(isl.id * 13 + i) < 0.6) props.push({ kind: "pillar", ...p, s: 0.32, h: 1.3 + round(hash01(isl.id + i * 5) * 0.5), rot: 0 })
      else props.push({ kind: "crate", ...p, s: 0.45, h: 0.9, rot: round(a) })
    }
  }

  for (const team of [0, 1]) {
    const sx = team === 0 ? -1 : 1
    const cx = COLUMN_X * sx
    // A espiral começa virada para o meio do mapa e gira no sentido que
    // espelha entre os times.
    const a0 = team === 0 ? Math.PI / 2 : -Math.PI / 2
    const turn = team === 0 ? 1 : -1

    const base = island("base", team, cx, 0, 0, 9)
    decorate(base)
    const facingIn = round(Math.atan2(-sx, 0))
    const spawns = [0, 1, 2].map((i) => ({ x: round(cx - sx * 2.5), y: 0, z: round((i - 1) * 2.2), facing: facingIn }))
    bases.push({ team, island: base.id, spawns })
    cat(base, a0 + Math.PI * 0.8, 0.55)
    cat(base, a0 - Math.PI * 0.8, 0.55)
    capsule(base, 0, a0 + Math.PI * 0.35, 0.6)
    capsule(base, 1, a0 + Math.PI, 0.45)
    capsule(base, 2, a0 - Math.PI * 0.35, 0.6)

    let y = 0
    for (let i = 0; i < SPIRAL_DY.length; i++) {
      y += SPIRAL_DY[i]
      const ang = a0 + turn * SPIRAL_STEP * (i + 1)
      const r = SPIRAL_RADII[i]
      const isl = island("path", team, cx + Math.sin(ang) * SPIRAL_R, y, Math.cos(ang) * SPIRAL_R, r)
      decorate(isl)
      cat(isl, ang + Math.PI * 0.5, 0.35)
      capsule(isl, (i % 3)             , ang - Math.PI * 0.5, 0.4)
      if (BRANCH_AT.includes(i)) {
        const br = island("branch", team, cx + Math.sin(ang) * (SPIRAL_R + r + 6.5), y + 1.4, Math.cos(ang) * (SPIRAL_R + r + 6.5), 2.4)
        cat(br, 0, 0)
      }
    }
    const summit = island("summit", team, cx, SUMMIT_Y, 0, 6)
    decorate(summit)
    cat(summit, a0 + Math.PI, 0.5)
    portals.push({ x: round(cx), y: SUMMIT_Y, z: 0 })
  }

  // Coluna disputada no meio.
  for (let i = 0; i < CENTER_Y.length; i++) {
    const isl = island("center", -1, 0, CENTER_Y[i], CENTER_Z[i], 5)
    decorate(isl)
    for (let k = 0; k < 3; k++) cat(isl, (k / 3) * Math.PI * 2 + i, 0.55)
    capsule(isl, (i % 3)             , i * 1.3 + Math.PI / 3, 0.15)
  }

  // Ilha do chefão (provisório até a etapa do chefão).
  const bossIsl = island("boss", -1, BOSS.x, BOSS.y, BOSS.z, BOSS.r)
  const bossSpawns = [0, 1].flatMap((team) => {
    const sx = team === 0 ? -1 : 1
    return [0, 1, 2].map((i) => ({ x: round(BOSS.x + sx * 12), y: BOSS.y, z: round(BOSS.z + (i - 1) * 2.2), facing: round(Math.atan2(-sx, 0)) }))
  })
  for (const [i, c] of ([0, 1, 2, 1, 1, 2]         ).entries()) {
    const a = (i / 6) * Math.PI * 2 + 0.4
    capsules.push({ id: capSeq++, c, x: round(BOSS.x + Math.sin(a) * 13), y: BOSS.y, z: round(BOSS.z + Math.cos(a) * 13) })
  }

  const solids          = []
  for (const isl of islands) solids.push({ k: 0, x: isl.x, z: isl.z, y0: round(isl.y - COLLIDER_DEPTH), y1: isl.y, r: isl.r })
  for (const p of props) {
    if (p.kind === "pillar") solids.push({ k: 0, x: p.x, z: p.z, y0: p.y, y1: round(p.y + p.h), r: p.s })
    else solids.push({ k: 1, x: p.x, z: p.z, y0: p.y, y1: round(p.y + p.h), hx: p.s, hz: p.s })
  }

  return {
    islands,
    props,
    solids,
    cats,
    capsules,
    bases,
    portals,
    boss: { x: BOSS.x, y: BOSS.y, z: BOSS.z, island: bossIsl.id, spawns: bossSpawns },
  }
}

/** Caiu nas nuvens? (abaixo da arena, ou abaixo da ilha do chefão estando lá.) */
function fellOut(y        , inBoss         ) {
  return y < (inBoss ? BOSS.y : 0) + TUNING.fallY
}

/** Lugar de nascer: base do time (ou ilha do chefão), vaga dentro do time. */
function spawnPoint(map          , team        , slotInTeam        , inBoss         ) {
  if (inBoss) return map.boss.spawns[team * 3 + (slotInTeam % 3)]
  return map.bases[team].spawns[slotInTeam % 3]
}

// ── sim/collide.ts ───────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/collide.ts — PAINT (mm3d-35): perguntas ao mundo.
//
// O mundo é uma lista de sólidos verticais (cilindros e caixas alinhadas): as
// ilhas, os enfeites e a TINTA (ponte e degrau são cilindros). Três perguntas:
//  - apoio: qual o chão mais alto sob um ponto, até uma altura;
//  - empurrão: tirar o corpo de dentro de um sólido de lado;
//  - raio: onde o tiro bate (ponto, normal, sólido).

                                        

/** Raio do "pé": anda até a borda sem cair antes (menor que o corpo). */
const FOOT_R = 0.18

function inside(s       , x        , z        , pad        ) {
  if (s.k === 0) {
    const dx = x - s.x
    const dz = z - s.z
    const r = s.r + pad
    return dx * dx + dz * dz <= r * r
  }
  return Math.abs(x - s.x) <= s.hx + pad && Math.abs(z - s.z) <= s.hz + pad
}

/**
 * Chão mais alto sob (x, z) com topo até `maxY` (pé + subida tolerada).
 * -Infinity = nada embaixo (vão). `skip` = sólido ignorado (o próprio degrau
 * que está nascendo, por exemplo).
 */
function supportAt(solids                  , x        , z        , maxY        , pad = FOOT_R) {
  let best = -Infinity
  for (const s of solids) {
    if (s.y1 > maxY || s.y1 <= best) continue
    if (inside(s, x, z, pad)) best = s.y1
  }
  return best
}

/**
 * Tira o corpo (círculo de raio r, de `y` a `y + h`) de dentro dos sólidos que
 * ele não consegue subir (topo acima de `y + up`). Mexe em `p` e devolve se
 * encostou em algo.
 */
function pushOut(solids                  , p                                     , r        , h        , up        ) {
  let hit = false
  for (let pass = 0; pass < 2; pass++) {
    for (const s of solids) {
      if (s.y1 <= p.y + up || s.y0 >= p.y + h) continue
      if (s.k === 0) {
        const dx = p.x - s.x
        const dz = p.z - s.z
        const R = s.r + r
        const d2 = dx * dx + dz * dz
        if (d2 >= R * R) continue
        const d = Math.sqrt(d2)
        if (d < 1e-6) {
          p.x = s.x + R
        } else {
          p.x = s.x + (dx / d) * R
          p.z = s.z + (dz / d) * R
        }
        hit = true
      } else {
        const ox = s.hx + r - Math.abs(p.x - s.x)
        const oz = s.hz + r - Math.abs(p.z - s.z)
        if (ox <= 0 || oz <= 0) continue
        if (ox < oz) p.x += Math.sign(p.x - s.x || 1) * ox
        else p.z += Math.sign(p.z - s.z || 1) * oz
        hit = true
      }
    }
  }
  return hit
}

/** Teto: o sólido mais baixo cuja base está entre `fromY` e `toY` sobre (x, z). */
function ceilingAt(solids                  , x        , z        , fromY        , toY        , pad        ) {
  let best = Infinity
  for (const s of solids) {
    if (s.y0 < fromY || s.y0 > toY || s.y0 >= best) continue
    if (inside(s, x, z, pad)) best = s.y0
  }
  return best
}

                         
           
             
              
                                   
               
 

/** Raio × cilindro vertical finito: menor t em [0, maxT]. */
function rayCyl(o      , d      , s                                                             , maxT        )                                {
  let best                                = null
  // tampas
  if (Math.abs(d.y) > 1e-9) {
    for (const [cy, ny] of [[s.y1, 1], [s.y0, -1]]         ) {
      const t = (cy - o.y) / d.y
      if (t < 0 || t > maxT || (best && t >= best.t)) continue
      // só a tampa que o raio atravessa de fora para dentro
      if ((ny === 1 && d.y >= 0) || (ny === -1 && d.y <= 0)) continue
      const x = o.x + d.x * t - s.x
      const z = o.z + d.z * t - s.z
      if (x * x + z * z <= s.r * s.r) best = { t, n: { x: 0, y: ny, z: 0 } }
    }
  }
  // lado
  const a = d.x * d.x + d.z * d.z
  if (a > 1e-12) {
    const fx = o.x - s.x
    const fz = o.z - s.z
    const b = 2 * (fx * d.x + fz * d.z)
    const c = fx * fx + fz * fz - s.r * s.r
    const disc = b * b - 4 * a * c
    if (disc >= 0) {
      const t = (-b - Math.sqrt(disc)) / (2 * a)
      if (t >= 0 && t <= maxT && (!best || t < best.t)) {
        const y = o.y + d.y * t
        if (y >= s.y0 && y <= s.y1) {
          const nx = fx + d.x * t
          const nz = fz + d.z * t
          const nl = Math.hypot(nx, nz) || 1
          best = { t, n: { x: nx / nl, y: 0, z: nz / nl } }
        }
      }
    }
  }
  return best
}

/** Raio × caixa alinhada (slabs). */
function rayBox(o      , d      , s                                                                          , maxT        )                                {
  const mins = [s.x - s.hx, s.y0, s.z - s.hz]
  const maxs = [s.x + s.hx, s.y1, s.z + s.hz]
  const oo = [o.x, o.y, o.z]
  const dd = [d.x, d.y, d.z]
  let t0 = 0
  let t1 = maxT
  let axis = -1
  let sign = 0
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dd[i]) < 1e-12) {
      if (oo[i] < mins[i] || oo[i] > maxs[i]) return null
      continue
    }
    let ta = (mins[i] - oo[i]) / dd[i]
    let tb = (maxs[i] - oo[i]) / dd[i]
    let sg = -1
    if (ta > tb) {
      const tmp = ta
      ta = tb
      tb = tmp
      sg = 1
    }
    if (ta > t0) {
      t0 = ta
      axis = i
      sign = sg
    }
    t1 = Math.min(t1, tb)
    if (t0 > t1) return null
  }
  if (axis < 0) return null // começou dentro
  const n = { x: 0, y: 0, z: 0 }
  if (axis === 0) n.x = sign
  else if (axis === 1) n.y = sign
  else n.z = sign
  return { t: t0, n }
}

/** Primeiro sólido que o raio (d unitário) toca até `maxT`. */
function raycast(solids                  , o      , d      , maxT        )                {
  let best                = null
  let limit = maxT
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    const h = s.k === 0 ? rayCyl(o, d, s, limit) : rayBox(o, d, s, limit)
    if (!h) continue
    limit = h.t
    best = { t: h.t, point: { x: o.x + d.x * h.t, y: o.y + d.y * h.t, z: o.z + d.z * h.t }, normal: h.n, index: i }
  }
  return best
}

/** Raio × cápsula de jogador (cilindro de `y` a `y + h`, raio r). t ou null. */
function rayBody(o      , d      , b                                     , r        , h        , maxT        ) {
  const hit = rayCyl(o, d, { x: b.x, z: b.z, y0: b.y, y1: b.y + h, r }, maxT)
  return hit ? hit.t : null
}

// ── sim/body.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/body.ts — PAINT (mm3d-35): o corpo de quem joga.
//
// Passo fixo (TUNING.step). Anda pela intenção (direção no mundo, 0–1),
// corre, pula (com uma folga logo depois de sair da borda), cai, sobe sozinho
// degraus baixos, para no teto e é empurrado de lado pelo que não sobe. O
// empurrão de soco/tiro entra como velocidade (`knock`) e se desfaz pela
// própria aceleração de andar.
//
// O movimento é do aparelho (a sala só confere a velocidade); a regra mora
// aqui para os dois lados concordarem sobre o que dá e o que não dá.

function newBody(x        , y        , z        , facing        )            {
  return { x, y, z, vx: 0, vy: 0, vz: 0, ground: true, air: 0, gy: y, facing }
}

/** Movimento para a animação: 0 parado, 1 andando, 2 correndo, 5 no ar. */
                                    

function stepBody(b           , it            , solids                  , dt = TUNING.step)           {
  const T = TUNING
  let mx = it.mx
  let mz = it.mz
  const m = Math.hypot(mx, mz)
  if (m > 1) {
    mx /= m
    mz /= m
  }
  const speed = it.run ? T.run : T.walk
  const tx = mx * speed
  const tz = mz * speed
  const a = T.accel * (b.ground ? 1 : T.airControl) * dt
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

  if (it.jump && (b.ground || b.air < T.coyote) && b.vy <= 0.01) {
    b.vy = T.jumpV
    b.ground = false
    b.air = T.coyote
  }

  // horizontal + empurrão de lado
  b.x += b.vx * dt
  b.z += b.vz * dt
  pushOut(solids, b, T.bodyR, T.bodyH, T.stepUp)

  // vertical
  const wasGround = b.ground
  if (!b.ground) b.vy -= T.gravity * dt
  const prevY = b.y
  b.y += b.vy * dt
  if (b.vy > 0) {
    const ceil = ceilingAt(solids, b.x, b.z, prevY + T.bodyH - 0.05, b.y + T.bodyH, T.bodyR * 0.6)
    if (ceil < Infinity) {
      b.y = ceil - T.bodyH
      b.vy = 0
    }
  }
  // chão: o mais alto até o pé (+ subida, se já estava pisando)
  const reach = wasGround ? Math.max(prevY, b.y) + T.stepUp : Math.max(prevY, b.y) + 0.02
  const floor = supportAt(solids, b.x, b.z, reach)
  if (b.vy <= 0 && floor > -Infinity && b.y <= floor + (wasGround ? 0.06 : 0)) {
    b.y = floor
    b.vy = 0
    b.ground = true
    b.air = 0
    b.gy = floor
  } else if (wasGround && b.vy <= 0 && floor > -Infinity && b.y - floor <= 0.25) {
    // descendo rampa/degrau baixo: gruda
    b.y = floor
    b.vy = 0
    b.gy = floor
  } else {
    if (b.ground) b.vy = Math.min(b.vy, 0)
    b.ground = false
    b.air += dt
  }

  if (!b.ground) return 5
  const hs = Math.hypot(b.vx, b.vz)
  return hs < 0.3 ? 0 : hs > (T.walk + T.run) / 2 ? 2 : 1
}

/**
 * Empurrão (soco, tiro): soma na velocidade e tira do chão. Quem leva um soco
 * na beira pode cair da ilha — é o jogo.
 */
function knockBody(b           , kx        , ky        , kz        ) {
  b.vx += kx
  b.vz += kz
  if (ky > 0) {
    b.vy = Math.max(b.vy, ky)
    b.ground = false
    b.air = TUNING.coyote
  }
}

/** Um degrau nasceu embaixo de quem está aqui: sobe para o topo (até 1,1 m). */
function liftOnto(b           , x        , z        , r        , top        ) {
  if (Math.hypot(b.x - x, b.z - z) > r + TUNING.bodyR * 0.5) return false
  if (top <= b.y || top - b.y > 1.1) return false
  b.y = top
  b.vy = Math.max(0, b.vy)
  b.ground = b.vy <= 0
  b.gy = top
  return true
}

// ── sim/paint.ts ─────────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/paint.ts — PAINT (mm3d-35): o que cada tiro faz.
//
// Um tiro é instantâneo (raio). A MESMA função roda no aparelho (para a tinta
// aparecer na hora) e na sala (que decide): mesmo mundo + mesmo tiro = mesmo
// resultado. O aparelho manda a origem e a direção; a sala confere que a
// origem está perto de onde ela sabe que o jogador está.
//
//  - TURQUESA (ponte): bateu no TOPO de algo ao alcance → poça-plataforma ali.
//    Senão (mirando o vão, ou o lado de uma ilha) → a ponte CRESCE: acha a
//    borda do chão na direção da mira, na altura do último chão pisado, e põe
//    um disco logo depois dela. Segurando o botão, disco atrás de disco.
//  - AMARELO (degrau): no ar → degrau embaixo do pé (empilha). No chão →
//    onde a mira bate (perto), ou logo à frente.
//  - VERMELHO ESCURO (dano): acerta o jogador do OUTRO time, o chefão, ou
//    apaga tinta do outro time; no chão vira só respingo.

/** Mancha nova (sem id: quem guarda dá). */
                          
               
           
           
            
            
           
 

                        
                                   
                                                 
                                 
                                                
                                                
                    

/** Boca da arma: um pouco à direita e na altura do peito de quem atira. */
function muzzleOf(s                                     , yaw        )       {
  return { x: s.x + Math.cos(yaw) * 0.32, y: s.y + 1.25, z: s.z - Math.sin(yaw) * 0.32 }
}

const r3 = (v        ) => Math.round(v * 1000) / 1000

function blobOf(c            , x        , z        , y0        )          {
  const r = c === PAINT.STEP ? TUNING.stepR : TUNING.bridgeR
  const h = c === PAINT.STEP ? TUNING.stepH : TUNING.bridgeH
  return { c, x: r3(x), z: r3(z), y0: r3(y0), y1: r3(y0 + h), r }
}

function unit(d      )       {
  const l = Math.hypot(d.x, d.y, d.z) || 1
  return { x: d.x / l, y: d.y / l, z: d.z / l }
}

/**
 * Resolve um tiro. `o` = boca da arma, `dir` = mira (não precisa ser
 * unitária). Não mexe no mundo: quem chama aplica o resultado.
 */
function resolveShot(world           , s         , c            , o      , dir      )             {
  const d = unit(dir)
  const T = TUNING
  if (c === PAINT.HARM) {
    const range = T.range[PAINT.HARM]
    const wall = raycast(world.solids, o, d, range)
    let best                    = null
    let bestT = wall ? wall.t : range
    for (const b of world.bodies) {
      if (b.slot === s.slot || b.team === s.team) continue
      const t = rayBody(o, d, b, T.hitR, T.bodyH, bestT)
      if (t !== null && t < bestT) {
        bestT = t
        best = { kind: "player", slot: b.slot, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } }
      }
    }
    if (world.boss) {
      const t = rayBody(o, d, world.boss, world.boss.r, world.boss.h, bestT)
      if (t !== null && t < bestT) {
        bestT = t
        best = { kind: "boss", point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t } }
      }
    }
    if (best) return best
    if (!wall) return { kind: "miss" }
    const hit = world.solids[wall.index]            
    if (hit.b !== undefined && hit.team !== s.team) return { kind: "erase", blob: hit.b, point: wall.point }
    return { kind: "splat", point: wall.point, normal: wall.normal }
  }

  if (c === PAINT.STEP) {
    if (!s.ground) {
      // Embaixo do pé: apoia no chão de baixo se estiver perto; senão flutua
      // logo abaixo da sola (é assim que se sobe empilhando).
      const below = supportAt(world.solids, s.x, s.z, s.y + 0.05, 0.05)
      const y0 = below > s.y - T.stepH - 0.02 ? below : s.y - T.stepH - 0.02
      return { kind: "blob", blob: blobOf(c, s.x, s.z, y0) }
    }
    const hit = raycast(world.solids, o, d, T.range[PAINT.STEP])
    if (hit && hit.normal.y > 0.5 && Math.hypot(hit.point.x - s.x, hit.point.z - s.z) > T.stepR + T.bodyR * 0.6) {
      return { kind: "blob", blob: blobOf(c, hit.point.x, hit.point.z, hit.point.y) }
    }
    // Logo à frente, no chão em que está.
    const fx = s.x + Math.sin(s.facing) * 1.35
    const fz = s.z + Math.cos(s.facing) * 1.35
    const floor = supportAt(world.solids, fx, fz, s.y + 0.3, 0.05)
    return { kind: "blob", blob: blobOf(c, fx, fz, floor > s.y - 1.5 ? floor : s.gy) }
  }

  // PONTE
  const hit = raycast(world.solids, o, d, T.range[PAINT.BRIDGE])
  if (hit && hit.normal.y > 0.5 && Math.hypot(hit.point.x - s.x, hit.point.z - s.z) <= T.bridgeReach) {
    return { kind: "blob", blob: blobOf(c, hit.point.x, hit.point.z, hit.point.y - T.bridgeH * 0.5) }
  }
  // Crescer: a borda na direção da mira, na altura do último chão.
  let hx = d.x
  let hz = d.z
  const hl = Math.hypot(hx, hz)
  if (hl < 0.2) {
    hx = Math.sin(s.facing)
    hz = Math.cos(s.facing)
  } else {
    hx /= hl
    hz /= hl
  }
  const footY = Math.min(s.y, s.gy)
  for (let k = 0.6; k <= T.bridgeReach; k += 0.35) {
    const px = s.x + hx * k
    const pz = s.z + hz * k
    const sup = supportAt(world.solids, px, pz, footY + 0.3, 0.02)
    if (sup < footY - 0.6) {
      const ahead = k + T.bridgeR * 0.55
      return { kind: "blob", blob: blobOf(c, s.x + hx * ahead, s.z + hz * ahead, footY - T.bridgeH) }
    }
  }
  return { kind: "miss" }
}

/** Tiro conta como mancha nova em `solids` (cilindro com id, cor e time). */
function blobSolid(b         , id        , team        )           {
  return { k: 0, x: b.x, z: b.z, y0: b.y0, y1: b.y1, r: b.r, b: id, c: b.c, team }
}

/** Quem o soco pega: na frente (cone), perto, na mesma altura; do outro time. */
function punchTargets(a                                                                                 , bodies                           ) {
  const out                                             = []
  const fx = Math.sin(a.facing)
  const fz = Math.cos(a.facing)
  for (const b of bodies) {
    if (b.slot === a.slot || b.team === a.team) continue
    const dx = b.x - a.x
    const dz = b.z - a.z
    const d = Math.hypot(dx, dz)
    if (d > TUNING.punchRange || Math.abs(b.y - a.y) > 1.2) continue
    if (d > 0.05 && (dx * fx + dz * fz) / d < TUNING.punchCos) continue
    const ux = d > 0.05 ? dx / d : fx
    const uz = d > 0.05 ? dz / d : fz
    out.push({ slot: b.slot, kx: ux * TUNING.punchKnock, kz: uz * TUNING.punchKnock })
  }
  return out
}

/** O soco alcança o chefão? */
function punchReachesBoss(a                                     , boss                                                           ) {
  return Math.hypot(a.x - boss.x, a.z - boss.z) <= boss.r + TUNING.punchRange && a.y >= boss.y - 1 && a.y <= boss.y + boss.h
}

// ── sim/match.ts ─────────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/match.ts — PAINT (mm3d-35): a partida.
//
// O ESTADO do jogo (não o movimento): munição, cápsulas, corações, nocaute,
// tinta no mundo, gatinhos, portal de cada time, chefão, tempo e resultado.
// A sala (PaintRoom) roda esta classe e é a autoridade; o treino sem sala
// roda a mesma no aparelho. Quem usa: `pose()` com o que o aparelho diz,
// `fire()`/`punch()` nos botões, `tick(dt)` no relógio e `drain()` para os
// acontecimentos (o que aparece/some, quem levou dano, quem pegou o quê).
//
// O movimento é do aparelho; `pose()` só recusa o impossível (velocidade
// acima do que soco + corrida explicam) e devolve "volte para onde estava".
// Depois de um renascimento a época sobe: pose de época velha é ignorada (é
// do caminho de antes do teleporte).

const POSE_SPEED = 13
const POSE_SLACK = 1.6
/** A boca da arma que o aparelho diz pode estar até isto longe da que a sala calcula. */
const MUZZLE_SLACK = 2.6

class PaintMatch {
           map          
           mode           
  phase             = "countdown"
  /** s desde o "vai" (negativo na contagem). */
  time        
           players = new Map                     ()
           blobs = new Map                   ()
  /** gatinho → time que pegou. */
           catsTaken = new Map                ()
  /** cápsula → volta em (s); ausente = disponível. */
           capsuleBack = new Map                ()
           teamCats                   = [0, 0]
           portalOpen                     = [false, false]
  bossHp         = TUNING.bossHp
  result                     = null
          events               = []
          blobSeq = 1
          solidsCache                 = null
          poseAt = new Map                ()

  constructor(mode           , seats                                               , map           = buildPaintMap()) {
    this.map = map
    this.mode = mode
    this.time = -TUNING.countdown
    const teams = modeTeams(mode)
    for (const s of seats) {
      const team = Math.min(s.team, teams - 1)
      const sp = spawnPoint(map, team, s.sit, false)
      this.players.set(s.slot, {
        slot: s.slot,
        team,
        sit: s.sit,
        hp: TUNING.hearts,
        ammo: [TUNING.ammoStart, TUNING.ammoStart, TUNING.ammoStart],
        cats: 0,
        dmg: 0,
        ko: 0,
        shield: 0,
        inBoss: false,
        epoch: 0,
        pose: { x: sp.x, y: sp.y, z: sp.z, facing: sp.facing, ground: true, gy: sp.y, e: 0 },
        nextFire: [0, 0, 0],
        nextPunch: 0,
        blobs: [],
        online: true,
      })
    }
  }

  /** Mundo para tiro e para o corpo: o mapa parado + a tinta viva. */
  solids()          {
    if (!this.solidsCache) {
      const out = this.map.solids.slice()
      for (const b of this.blobs.values()) out.push(b.solid)
      this.solidsCache = out
    }
    return this.solidsCache
  }

  bossAlive() {
    return this.bossHp > 0
  }

  bossBody() {
    const b = this.map.boss
    return { x: b.x, y: b.y, z: b.z, r: TUNING.bossR, h: TUNING.bossH }
  }

  drain()               {
    const out = this.events
    this.events = []
    return out
  }

          emit(e            ) {
    this.events.push(e)
  }

          standing(p             ) {
    return this.phase === "play" && !p.ko
  }

  /** Corpos alvo (de pé, no mesmo lugar — arena ou chefão — de quem atira). */
          bodies(inBoss         )                   {
    const out                   = []
    for (const p of this.players.values()) {
      if (p.ko || p.inBoss !== inBoss || !p.online) continue
      out.push({ slot: p.slot, team: p.team, x: p.pose.x, y: p.pose.y, z: p.pose.z })
    }
    return out
  }

  // ── movimento ─────────────────────────────────────────────────────────────

  /** O aparelho diz onde está. false = recusado (a sala manda o `fix`). */
  pose(slot        , next           , now = this.time)          {
    const p = this.players.get(slot)
    if (!p) return false
    if (next.e !== p.epoch) return true // caminho de antes do renascimento: ignora
    if (![next.x, next.y, next.z, next.facing, next.gy].every(Number.isFinite)) return false
    const last = this.poseAt.get(slot)
    const dt = last === undefined ? 1 : Math.max(0.03, now - last)
    const cur = p.pose
    const dh = Math.hypot(next.x - cur.x, next.z - cur.z)
    const up = next.y - cur.y
    if (this.phase !== "countdown" && (dh > POSE_SPEED * dt + POSE_SLACK || up > 9 * dt + POSE_SLACK)) {
      this.emit({ type: "fix", slot, pose: { ...cur } })
      return false
    }
    // Na contagem ninguém sai do lugar.
    if (this.phase === "countdown" && dh > 0.5) {
      this.emit({ type: "fix", slot, pose: { ...cur } })
      return false
    }
    p.pose = { ...next }
    this.poseAt.set(slot, now)
    return true
  }

  // ── tiro e soco ───────────────────────────────────────────────────────────

  /**
   * Tiro de `slot` com a cor `c`. `o` = boca da arma no aparelho, `dir` = mira,
   * `q` = número do tiro no aparelho (para ele trocar a tinta prevista pela
   * confirmada, ou desfazer).
   */
  fire(slot        , c            , o      , dir      , q        ) {
    const p = this.players.get(slot)
    if (!p || !this.standing(p) || !(c === 0 || c === 1 || c === 2)) return this.deny(slot, q)
    if (![o.x, o.y, o.z, dir.x, dir.y, dir.z].every(Number.isFinite)) return this.deny(slot, q)
    const cost = TUNING.cost[c]
    // folga de 30 ms no ritmo (o relógio do aparelho não é o da sala)
    if (p.ammo[c] < cost || this.time + 0.03 < p.nextFire[c]) return this.deny(slot, q)
    const m = muzzleOf(p.pose, p.pose.facing)
    if (Math.hypot(o.x - m.x, o.y - m.y, o.z - m.z) > MUZZLE_SLACK) return this.deny(slot, q)
    p.ammo[c] -= cost
    p.nextFire[c] = Math.max(p.nextFire[c], this.time) + 1 / TUNING.fireRate[c]
    const res = resolveShot(
      { solids: this.solids(), bodies: this.bodies(p.inBoss), boss: p.inBoss && this.bossAlive() ? this.bossBody() : null },
      { slot, team: p.team, x: p.pose.x, y: p.pose.y, z: p.pose.z, ground: p.pose.ground, gy: p.pose.gy, facing: p.pose.facing },
      c,
      o,
      dir,
    )
    let to       = { x: o.x + dir.x * 6, y: o.y + dir.y * 6, z: o.z + dir.z * 6 }
    if (res.kind === "blob") {
      const id = this.blobSeq++
      const solid = blobSolid(res.blob, id, p.team)
      this.blobs.set(id, { id, owner: slot, team: p.team, born: this.time, solid, blob: res.blob })
      this.solidsCache = null
      p.blobs.push(id)
      while (p.blobs.length > TUNING.blobsPerPlayer) this.removeBlob(p.blobs[0])
      to = { x: res.blob.x, y: res.blob.y1, z: res.blob.z }
      this.emit({ type: "blob", id, owner: slot, team: p.team, blob: res.blob, q })
    } else {
      if (q) this.emit({ type: "deny", slot, q }) // não virou tinta: o aparelho apaga a prevista, se houver
      if (res.kind === "player") {
        to = res.point
        this.damage(res.slot, slot, "harm")
      } else if (res.kind === "boss") {
        to = res.point
        this.hitBoss(slot, TUNING.bossHarm)
      } else if (res.kind === "erase") {
        to = res.point
        this.removeBlob(res.blob)
      } else if (res.kind === "splat") {
        to = res.point
        this.emit({ type: "splat", point: res.point, normal: res.normal })
      }
    }
    this.emit({ type: "shot", slot, c, o, to, q })
  }

          deny(slot        , q        ) {
    if (q) this.emit({ type: "deny", slot, q })
  }

  punch(slot        ) {
    const p = this.players.get(slot)
    if (!p || !this.standing(p) || this.time + 0.03 < p.nextPunch) return
    p.nextPunch = this.time + TUNING.punchCooldown
    this.emit({ type: "punch", slot })
    const a = { slot, team: p.team, x: p.pose.x, y: p.pose.y, z: p.pose.z, facing: p.pose.facing }
    for (const t of punchTargets(a, this.bodies(p.inBoss))) this.damage(t.slot, slot, "punch", t.kx, t.kz)
    if (p.inBoss && this.bossAlive() && punchReachesBoss(a, this.bossBody())) this.hitBoss(slot, TUNING.bossPunch)
  }

          damage(slot        , by        , how                  , kx = 0, kz = 0) {
    const v = this.players.get(slot)
    const a = this.players.get(by)
    if (!v || !a || v.ko || this.time < v.shield) return
    if (how === "harm") {
      const dx = v.pose.x - a.pose.x
      const dz = v.pose.z - a.pose.z
      const d = Math.hypot(dx, dz) || 1
      kx = (dx / d) * TUNING.harmKnock
      kz = (dz / d) * TUNING.harmKnock
    }
    v.hp = Math.max(0, v.hp - 1)
    this.emit({ type: "hit", slot, by, hp: v.hp, kx, ky: how === "punch" ? TUNING.punchLift : TUNING.harmLift, kz, how })
    if (v.hp === 0) {
      v.ko = this.time + TUNING.koTime
      this.emit({ type: "ko", slot, by })
    }
  }

          hitBoss(slot        , dmg        ) {
    const p = this.players.get(slot)
    if (!p || !this.bossAlive()) return
    const real = Math.min(dmg, this.bossHp)
    this.bossHp -= real
    p.dmg += real
    this.emit({ type: "boss", slot, dmg: real, hp: this.bossHp })
    if (!this.bossAlive()) this.finish("boss")
  }

          removeBlob(id        ) {
    const b = this.blobs.get(id)
    if (!b) return
    this.blobs.delete(id)
    this.solidsCache = null
    const owner = this.players.get(b.owner)
    if (owner) {
      const i = owner.blobs.indexOf(id)
      if (i >= 0) owner.blobs.splice(i, 1)
    }
    this.emit({ type: "unblob", id })
  }

          respawn(p             ) {
    const sp = spawnPoint(this.map, p.team, p.sit, p.inBoss)
    p.epoch++
    p.ko = 0
    p.hp = TUNING.hearts
    p.shield = this.time + TUNING.shield
    p.pose = { x: sp.x, y: sp.y, z: sp.z, facing: sp.facing, ground: true, gy: sp.y, e: p.epoch }
    this.poseAt.delete(p.slot)
    this.emit({ type: "respawn", slot: p.slot, x: sp.x, y: sp.y, z: sp.z, facing: sp.facing, e: p.epoch, inBoss: p.inBoss })
  }

  // ── relógio ───────────────────────────────────────────────────────────────

  tick(dt        ) {
    if (this.phase === "end") return
    this.time += dt
    if (this.phase === "countdown") {
      if (this.time >= 0) this.phase = "play"
      else return
    }
    const T = TUNING
    // tinta vencida
    for (const b of this.blobs.values()) if (this.time - b.born > T.blobLife) this.removeBlob(b.id)
    // cápsulas que voltam
    for (const [id, at] of this.capsuleBack) {
      if (this.time >= at) {
        this.capsuleBack.delete(id)
        this.emit({ type: "capsuleBack", id })
      }
    }
    for (const p of this.players.values()) {
      if (p.ko) {
        if (this.time >= p.ko) this.respawn(p)
        continue
      }
      const q = p.pose
      if (fellOut(q.y, p.inBoss)) {
        this.respawn(p)
        continue
      }
      // gatinhos (só na arena)
      if (!p.inBoss) {
        for (const c of this.map.cats) {
          if (this.catsTaken.has(c.id)) continue
          if (Math.abs(q.y - c.y) > 1.6 || Math.hypot(q.x - c.x, q.z - c.z) > T.catR) continue
          this.catsTaken.set(c.id, p.team)
          p.cats++
          this.teamCats[p.team]++
          this.emit({ type: "cat", id: c.id, slot: p.slot, team: p.team })
          if (!this.portalOpen[p.team] && this.teamCats[p.team] >= T.catsToPortal) {
            this.portalOpen[p.team] = true
            this.emit({ type: "portal", team: p.team })
          }
        }
        const portal = this.map.portals[p.team]
        if (this.portalOpen[p.team] && Math.abs(q.y - portal.y) < 2 && Math.hypot(q.x - portal.x, q.z - portal.z) <= T.portalR) {
          p.inBoss = true
          this.respawn(p)
          p.hp = T.hearts
          continue
        }
      }
      // cápsulas
      for (const cap of this.map.capsules) {
        if (this.capsuleBack.has(cap.id) || p.ammo[cap.c] >= T.ammoMax) continue
        if (Math.abs(q.y - cap.y) > 1.6 || Math.hypot(q.x - cap.x, q.z - cap.z) > T.capsuleR) continue
        p.ammo[cap.c] = Math.min(T.ammoMax, p.ammo[cap.c] + T.capsuleGive)
        this.capsuleBack.set(cap.id, this.time + T.capsuleRespawn)
        this.emit({ type: "capsule", id: cap.id, slot: p.slot, c: cap.c })
      }
    }
    if (this.time >= T.matchTime) this.finish("time")
  }

  finish(reason                 ) {
    if (this.phase === "end") return
    this.phase = "end"
    const rows = [...this.players.values()].map((p) => ({ slot: p.slot, team: p.team, dmg: p.dmg, cats: p.cats }))
    let winnerSlot = -1
    let best = 0
    for (const r of rows) {
      if (r.dmg > best) {
        best = r.dmg
        winnerSlot = r.slot
      }
    }
    let winnerTeam = -1
    if (winnerSlot >= 0) winnerTeam = this.players.get(winnerSlot) .team
    else if (this.teamCats[0] !== this.teamCats[1]) winnerTeam = this.teamCats[0] > this.teamCats[1] ? 0 : 1
    this.result = { winnerSlot, winnerTeam, rows }
    this.emit({ type: "end", reason })
  }

  /** Cópia da partida (rede): a mancha que a sala criou (ou a prevista, id negativo). */
  putBlob(id        , owner        , team        , blob         ) {
    this.blobs.set(id, { id, owner, team, born: this.time, solid: blobSolid(blob, id, team), blob })
    this.solidsCache = null
  }

  /** Cópia da partida (rede): a mancha sumiu na sala (ou a prevista foi trocada/recusada). */
  takeBlob(id        ) {
    if (this.blobs.delete(id)) this.solidsCache = null
  }

  /** Saiu da sala: some dos alvos (a tinta dele fica até vencer). */
  setOnline(slot        , on         ) {
    const p = this.players.get(slot)
    if (p) p.online = on
  }
}

/** Atalho para quem só precisa saber se a pose está fora (cliente). */
const PAINT_FIRE_COLORS                        = [PAINT.BRIDGE, PAINT.HARM, PAINT.STEP]

module.exports = { PAINT, PAINT_COLORS, TUNING, PAINT_MODES, modeTeams, modeCapacity, buildPaintMap, fellOut, spawnPoint, FOOT_R, supportAt, pushOut, ceilingAt, raycast, rayBody, newBody, stepBody, knockBody, liftOnto, muzzleOf, resolveShot, blobSolid, punchTargets, punchReachesBoss, PaintMatch, PAINT_FIRE_COLORS };
