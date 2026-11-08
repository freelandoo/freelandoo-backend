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

/**
 * As quatro tintas. O índice é o que viaja na rede. mm3d-46 (pedido do Alex):
 * a ponte virou LARANJA, o dano PRETO, a cama elástica VERMELHA e entrou o
 * MURO (amarelo holográfico, mm3d-46b) — munição só pelo ícone da Freelandoo.
 */
const PAINT = {
  /** Laranja: plataforma (ponte). */
  BRIDGE: 0,
  /** Preto: dano; apaga a tinta do outro time (o muro aguenta `wallHits`). */
  HARM: 1,
  /** Vermelho: cama elástica (mm3d-35e: quem pisa é lançado para cima). */
  STEP: 2,
  /**
   * Turquesa (mm3d-62, pedido do Alex): muro de gelatina em pé, igual à cama
   * elástica vermelha — quem bate nele é EMPURRADO para trás. Jogado num
   * adversário (de preferência no ar) ele voa longe.
   */
  WALL: 3,
}         
                                      

const PAINT_COLORS = ["#FF7A1A", "#1A161D", "#E5222E", "#16D6C4"]         

const TUNING = {
  /** Passo fixo da física do corpo. */
  step: 1 / 60,
  gravity: 22,
  walk: 4.4,
  run: 6.6,
  /** Pulo: 7,6 m/s com g 22 → ~1,31 m de altura, ~0,69 s no ar. */
  jumpV: 7.6,
  /** Pulo duplo (mm3d-35c, pedido do Alex): mais um pulo no ar, um pouco mais baixo. */
  maxJumps: 2,
  airJumpV: 7.0,
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
  ammoStart: 45,
  ammoMax: 90,
  capsuleGive: 35,
  capsuleRespawn: 10,
  capsuleR: 1.1,
  /** Tiros por segundo segurando o botão (índice = cor). */
  fireRate: [7, 6, 3.5, 4]                     ,
  /** Custo em munição de cada tiro (índice = cor). */
  cost: [1, 1, 2, 1]                     ,
  /** Alcance (m) do raio de cada cor. */
  range: [13, 24, 9, 48]                     ,

  /**
   * Ponte (laranja): placa QUADRADA (mm3d-62c, pedido do Alex: laranja,
   * vermelha e turquesa quadradas e do mesmo tamanho — a laranja de base com
   * as pontas completas). `bridgeR` = meio lado; gira para a mira.
   */
  bridgeR: 1.25,
  bridgeH: 0.34,
  /** A ponte cresce até esta distância horizontal de quem atira. */
  bridgeReach: 12,
  /** Cama elástica (amarelo, mm3d-35e): almofada baixa (dá para entrar andando) que lança para cima. */
  stepR: 1.25,
  stepH: 0.34,
  /** Velocidade do lançamento: ~4,6 m de altura (+ o pulo no ar; o topo pede 5,2 m). */
  bounceV: 14.6, // mm3d-62c: a placa ficou 6 cm mais baixa — ~4,85 m
  /**
   * Muro (mm3d-46): placa em pé atravessada na mira, nasce no chão onde ela
   * bate (ou logo à frente). Comprimento, espessura e altura (o pulo duplo
   * não passa por cima; a cama elástica passa). Começa sem munição: o ícone
   * da Freelandoo dá `wallGive`.
   */
  wallLen: 2.5,
  wallT: 0.34,
  wallH: 2.5,
  wallReach: 46, // mm3d-62b: o muro vai longe (ilha de cima, do outro lado do vão)
  /** Tiros pretos do outro time até o muro cair. */
  wallHits: 3,
  wallStart: 0,
  wallGive: 15,
  wallMax: 30,
  /**
   * Empurrão do muro (mm3d-62): quem encosta sai para trás (horizontal) e um
   * pouco para cima; o tiro do muro que pega o adversário em cheio empurra
   * para longe de quem atirou (no ar quase não há controle: cai da ilha).
   */
  wallBounce: 11,
  wallBounceLift: 5,
  wallShove: 12.5,
  wallShoveLift: 6,
  /** O ícone volta depois de (s). */
  logoRespawn: 18,
  /** Tinta some depois de (s) e cada jogador tem no máximo N manchas. */
  blobLife: 45,
  blobsPerPlayer: 60,

  /** Sangue (mm3d-38: barra no lugar dos 5 corações), soco e dano. */
  hpMax: 100,
  harmDmg: 20,
  punchDmg: 15,
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

  /** Chefão (mm3d-38: gato-gorila de porcelana, 10 m — o Alex pediu +5 m; anda apoiado nas mãos). */
  bossHp: 4000,
  bossHarm: 20,
  bossPunch: 10,
  bossR: 3.8,
  bossH: 10,
  /** Anda até a vítima (m/s), vira (rad/s) e não sai deste raio do centro da ilha. */
  bossWalk: 3.6,
  bossTurn: 2.2,
  bossLeash: 16,
  /** Pausa entre um golpe e outro (s). */
  bossRest: 1.1,
  /**
   * Golpes: `hit` = s depois do começo em que acerta, `dur` = duração toda.
   * Patada: cone na frente. Tapa no chão: círculo à frente dele (pula e bate
   * as duas mãos). Rugido: sem dano (quando o primeiro chega e na metade da vida).
   */
  bossSwipe: { reach: 9, cos: 0.35, hit: 0.75, dur: 1.7, dmg: 30, knock: 7, lift: 4.5 },
  bossSlam: { ahead: 6, r: 7.5, hit: 1.15, dur: 2.4, dmg: 45, knock: 5.5, lift: 6.5 },
  bossRoar: { dur: 2.2 },

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
/** Teto de munição da cor (o muro tem o dele). */
function ammoCap(c            ) {
  return c === PAINT.WALL ? TUNING.wallMax : TUNING.ammoMax
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
//
// mm3d-46 (pedido do Alex): o DOBRO de ilhas com os mesmos gatinhos — galho
// em toda ilha da espiral, duas ASAS por torre (cadeia baixa no norte e no sul
// indo até o meio) e mais ilhas no meio. As ilhas novas entram DEPOIS das
// antigas (ids, enfeites e gatinhos de antes não mudam). Gatinhos por modo:
// 2×2 tem o dobro e 3×3 o triplo (mais gente pegando). Ícones da Freelandoo
// (cápsula da cor MURO) nas bases e nas asas.
//
// mm3d-76 (pedido do Alex): este é o mapa 1 do catálogo, a CIDADE SUSPENSA
// (`buildCidadeMap`, igual ao de antes). Os outros 5 mapas e a escolha ficam
// em sim/maps.ts; daqui saem os tipos, o prisma convexo das ilhas de forma
// (`polySolid`), a ilha do chefão (a mesma em todo mapa) e a colisão parada.

/** Cilindro vertical (ilha, pilar, mancha de tinta) — `y1` é o topo (o chão). */
                           
      
           
           
            
            
           
                                                                                             
            
            
               
 
/** Caixa alinhada aos eixos (caixote). */
                           
      
           
           
            
            
            
            
 
/**
 * Caixa girada em y (o MURO, mm3d-46): `hx` ao longo do muro, `hz` a meia
 * espessura, `a` = para onde a frente olha (como `facing`). Sempre tinta.
 */
                            
      
           
           
            
            
            
            
           
            
            
               
 
/**
 * Prisma CONVEXO vertical (mm3d-76: ilhas hexagonais, triangulares, em folha,
 * em pedaço de arco...). `pts` = contorno no chão (x, z, x, z, ...), `n` = a
 * normal de fora de cada lado e `d` o limite (n·p ≤ d dentro), `r` = raio que
 * envolve tudo a partir de (x, z) (descarte rápido). Monte com `polySolid`.
 */
                            
      
           
           
            
            
           
               
             
             
            
            
               
 
                                                               

/** Centro de área de um contorno convexo (a média dos cantos puxaria para o lado com mais cantos — o arco). */
function polyCenter(pts                   ) {
  const n = pts.length / 2
  let ax = 0
  let az = 0
  for (let i = 0; i < n; i++) {
    ax += pts[i * 2]
    az += pts[i * 2 + 1]
  }
  ax /= n
  az /= n
  let area = 0
  let x = 0
  let z = 0
  for (let i = 0; i < n; i++) {
    const x0 = pts[i * 2] - ax
    const z0 = pts[i * 2 + 1] - az
    const x1 = pts[((i + 1) % n) * 2] - ax
    const z1 = pts[((i + 1) % n) * 2 + 1] - az
    const cr = x0 * z1 - x1 * z0
    area += cr
    x += (x0 + x1) * cr
    z += (z0 + z1) * cr
  }
  if (Math.abs(area) < 1e-9) return { x: ax, z: az }
  return { x: ax + x / (3 * area), z: az + z / (3 * area) }
}

/** Prisma convexo de y0 a y1: normais de cada lado viradas para FORA (qualquer sentido do contorno). */
function polySolid(pts                   , y0        , y1        )            {
  const c = polyCenter(pts)
  const n           = []
  const d           = []
  const m = pts.length / 2
  let r = 0
  for (let i = 0; i < m; i++) {
    const ax = pts[i * 2]
    const az = pts[i * 2 + 1]
    const bx = pts[((i + 1) % m) * 2]
    const bz = pts[((i + 1) % m) * 2 + 1]
    let nx = bz - az
    let nz = -(bx - ax)
    const l = Math.hypot(nx, nz) || 1
    nx /= l
    nz /= l
    if (nx * (c.x - ax) + nz * (c.z - az) > 0) {
      nx = -nx
      nz = -nz
    }
    n.push(Math.round(nx * 1e6) / 1e6, Math.round(nz * 1e6) / 1e6)
    d.push(Math.round((nx * ax + nz * az) * 1e6) / 1e6)
    r = Math.max(r, Math.hypot(ax - c.x, az - c.z))
  }
  return { k: 3, x: Math.round(c.x * 1000) / 1000, z: Math.round(c.z * 1000) / 1000, y0, y1, r: Math.round(r * 1000 + 1) / 1000, pts: pts.slice(), n, d }
}

                                                                                           
                         
            
                  
                                              
              
           
           
           
           
                                                                                
               
     
                                                                          
                                                                              
                                                                         
                                                                           
     
                 
                                                                                                    
              
 
                            
                          
           
           
           
                                                
           
           
             
                                                                                                               
            
                                                                                
              
 
                           
            
           
           
           
                                                               
             
                
 
                               
            
                                                   
                  
           
           
           
 
                            
              
                
                                                                   
                                                               
 
                           
                                                                                                
            
           
                   
                    
                                                                                       
                 
                  
                          
                    
                 
                                                                                                                          
                                                                                                                       
                    
 

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
const BOSS = { x: 0, y: 60, z: 320, r: 24 } // mm3d-38c: maior para o chefão de 10 m
/**
 * Asa (mm3d-46): cadeia baixa do lado norte de cada torre até o meio, em
 * coordenadas do time 0 (x espelha para o time 1, z espelha para o sul).
 * A última ilha é do meio (time -1) e só nasce uma vez por lado.
 */
const WING                                     = [
  [-41, 33, 2, 3.6],
  [-32, 38, 3.6, 3.2],
  [-23, 34, 5.4, 3.6],
  [-14.5, 39, 3.8, 3],
  [-7, 33.5, 6.4, 3.4],
]
const WING_JOINT                                   = [0, 39, 8.2, 4.2]
/** Ilhas novas do meio (mm3d-46): duas baixas e duas médias, norte e sul. */
const CENTER_EXTRA                             = [
  [2.5, 16.5, 4],
  [12, 22, 3.4],
]

const round = (v        ) => Math.round(v * 1000) / 1000

/** Pseudo-aleatório fixo por número (enfeites do mapa). */
function hash01(n        ) {
  let h = (n * 2654435761) >>> 0
  h ^= h >>> 16
  h = Math.imul(h, 2246822519) >>> 0
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

/**
 * A ilha do chefão (a mesma em todo mapa, mm3d-76: só o desenho muda pelo
 * tema) com os nascimentos e as cápsulas dela. Entra DEPOIS das outras ilhas.
 */
function bossIsland(islands          , capsules                ) {
  const bossIsl         = { id: islands.length, kind: "boss", team: -1, x: BOSS.x, y: BOSS.y, z: BOSS.z, r: BOSS.r, depth: round(BOSS.r * 1.25 + 1.5) }
  islands.push(bossIsl)
  const spawns = [0, 1].flatMap((team) => {
    const sx = team === 0 ? -1 : 1
    return [0, 1, 2].map((i) => ({ x: round(BOSS.x + sx * 12), y: BOSS.y, z: round(BOSS.z + (i - 1) * 2.2), facing: round(Math.atan2(-sx, 0)) }))
  })
  let capSeq = capsules.length
  for (const [i, c] of ([0, 1, 2, 1, 1, 2]         ).entries()) {
    const a = (i / 6) * Math.PI * 2 + 0.4
    capsules.push({ id: capSeq++, c, x: round(BOSS.x + Math.sin(a) * 17), y: BOSS.y, z: round(BOSS.z + Math.cos(a) * 17) })
  }
  return { x: BOSS.x, y: BOSS.y, z: BOSS.z, island: bossIsl.id, spawns }
}

/** Colisão parada: ilhas (cilindro ou prisma) + pilares + caixotes. */
function staticSolids(islands                   , props                      )          {
  const solids          = []
  for (const isl of islands) {
    if (isl.poly) solids.push(polySolid(isl.poly, round(isl.y - COLLIDER_DEPTH), isl.y))
    else solids.push({ k: 0, x: isl.x, z: isl.z, y0: round(isl.y - COLLIDER_DEPTH), y1: isl.y, r: isl.r })
  }
  for (const p of props) {
    if (p.kind === "pillar") solids.push({ k: 0, x: p.x, z: p.z, y0: p.y, y1: round(p.y + p.h), r: p.s })
    else if (p.rot) solids.push({ k: 2, x: p.x, z: p.z, y0: p.y, y1: round(p.y + p.h), hx: p.w ?? p.s, hz: p.s, a: p.rot })
    else solids.push({ k: 1, x: p.x, z: p.z, y0: p.y, y1: round(p.y + p.h), hx: p.w ?? p.s, hz: p.s })
  }
  return solids
}

/** A Cidade Suspensa (o mapa de sempre, mm3d-35/46): quem chama é o catálogo (sim/maps.ts). */
function buildCidadeMap(mode            = "solo")           {
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
  const capsule = (isl        , c                   , ang        , f        ) => {
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

  // ── mm3d-46: o dobro de ilhas (depois das antigas: nada de antes muda) ──
  for (const team of [0, 1]) {
    const sx = team === 0 ? -1 : 1
    const cx = COLUMN_X * sx
    const a0 = team === 0 ? Math.PI / 2 : -Math.PI / 2
    const turn = team === 0 ? 1 : -1
    // galho em toda ilha da espiral que ainda não tinha
    let y = 0
    for (let i = 0; i < SPIRAL_DY.length; i++) {
      y += SPIRAL_DY[i]
      if (BRANCH_AT.includes(i)) continue
      const ang = a0 + turn * SPIRAL_STEP * (i + 1)
      const d = SPIRAL_R + SPIRAL_RADII[i] + 6.5
      const br = island("branch", team, cx + Math.sin(ang) * d, y + 1.4, Math.cos(ang) * d, 2.4)
      decorate(br)
    }
    // asas norte e sul
    const base = islands[bases[team].island]
    capsule(base, 3, a0, 0.7)
    for (const sz of [1, -1]) {
      WING.forEach(([wx, wz, wy, wr], i) => {
        const isl = island("wing", team, -wx * sx, wy, wz * sz, wr)
        decorate(isl)
        if (i === 2) capsule(isl, 3, 0, 0)
        else capsule(isl, (i % 3)             , Math.PI * (0.25 + i * 0.4), 0.45)
      })
    }
  }
  for (const sz of [1, -1]) {
    const [jx, jz, jy, jr] = WING_JOINT
    const joint = island("center", -1, jx, jy, jz * sz, jr)
    decorate(joint)
    capsule(joint, 3, 0, 0)
    for (const [ey, ez, er] of CENTER_EXTRA) {
      const isl = island("center", -1, 0, ey, ez * sz, er)
      decorate(isl)
      capsule(isl, ((ey | 0) % 3)             , Math.PI / 2, 0.4)
    }
  }

  // Gatinhos a mais por modo (mm3d-46): cada rodada põe outros 48 (18 por lado
  // + 12 no meio, espelhados) espalhados pelas ilhas, inclusive as novas.
  const rounds = PAINT_MODES[mode]
  const side = [0, 1].map((team) => islands.filter((i) => i.team === team && i.kind !== "base"))
  const middle = islands.filter((i) => i.kind === "center")
  for (let k = 1; k < rounds; k++) {
    for (let j = 0; j < 18; j++) {
      const at = (k * 5 + j * 2) % side[0].length
      const ang = j * 2.39996 + k * 1.1
      cat(side[0][at], ang, 0.42)
      cat(side[1][at], -ang, 0.42)
    }
    for (let j = 0; j < 12; j++) cat(middle[(k * 3 + j) % middle.length], j * 2.39996 + k * 0.7, 0.45)
  }

  // Ilha do chefão (provisório até a etapa do chefão).
  const bossIsl = island("boss", -1, BOSS.x, BOSS.y, BOSS.z, BOSS.r)
  const bossSpawns = [0, 1].flatMap((team) => {
    const sx = team === 0 ? -1 : 1
    return [0, 1, 2].map((i) => ({ x: round(BOSS.x + sx * 12), y: BOSS.y, z: round(BOSS.z + (i - 1) * 2.2), facing: round(Math.atan2(-sx, 0)) }))
  })
  for (const [i, c] of ([0, 1, 2, 1, 1, 2]         ).entries()) {
    const a = (i / 6) * Math.PI * 2 + 0.4
    capsules.push({ id: capSeq++, c, x: round(BOSS.x + Math.sin(a) * 17), y: BOSS.y, z: round(BOSS.z + Math.cos(a) * 17) })
  }

  const solids          = []
  for (const isl of islands) solids.push({ k: 0, x: isl.x, z: isl.z, y0: round(isl.y - COLLIDER_DEPTH), y1: isl.y, r: isl.r })
  for (const p of props) {
    if (p.kind === "pillar") solids.push({ k: 0, x: p.x, z: p.z, y0: p.y, y1: round(p.y + p.h), r: p.s })
    else solids.push({ k: 1, x: p.x, z: p.z, y0: p.y, y1: round(p.y + p.h), hx: p.s, hz: p.s })
  }

  // mm3d-76: a rota de cada time = base → espiral → topo (o que o robô sobe)
  const routes = [0, 1].map((team) => [bases[team].island, ...islands.filter((i) => i.team === team && (i.kind === "path" || i.kind === "summit")).map((i) => i.id)])

  return {
    id: "cidade",
    v: 1,
    islands,
    props,
    solids,
    cats,
    capsules,
    bases,
    portals,
    boss: { x: BOSS.x, y: BOSS.y, z: BOSS.z, island: bossIsl.id, spawns: bossSpawns },
    routes,
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

// ── sim/maps.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/maps.ts — PAINT (mm3d-76): o CATÁLOGO de mapas.
//
// Pedido do Alex (prompt da expansão + referências em Downloads/fases paint):
// a Cidade Suspensa de sempre e mais 5 mapas, cada um com ilhas de FORMA
// própria (hexágono, triângulo, retângulo, folha, pedaço de arco/meia-lua),
// subida de verdade e as quatro tintas úteis. Aqui só a REGRA de cada um
// (onde fica cada ilha, gatinho, cápsula, portal, enfeite que colide); nome,
// cores, cartão e o desenho do tema ficam em engine/paint-map-art.ts e
// engine/arena-view.ts. O servidor roda este mesmo arquivo (gerado por
// scripts/build-paint-sim.js no back): mudou → regerar e commitar os dois.
//
// Regras de desenho de fase (as mesmas da Cidade, conferidas no teste):
//  - lado do time 0 em x < 0; o do time 1 é o ESPELHO (x → −x) — nenhum time
//    começa com vantagem; o meio (time −1) é simétrico (peça em x = 0 ou par);
//  - 18 gatinhos de cada lado + 12 no meio = 48 (o portal pede 20: quem não
//    sai do próprio lado não chega lá); 2×2 e 3×3 ganham rodadas a mais;
//  - na ROTA de cada time (base → portal) todo degrau para cima tem até 3,8 m
//    (cama elástica + pulo no ar), todo vão até ~11 m (ponte), e quem sobe
//    chega por um LADO da ilha (não por uma ponta);
//  - os dois portais ficam no alto do meio (em cada mapa novo os times se
//    encontram lá em cima); a ilha do chefão é a mesma em todos.
//
// Formas (todas convexas — a colisão é o prisma `SolidPoly`):
//  { c }            círculo de raio c
//  { n, r, rot?, sx?, sz?, j? }  polígono regular (6 = hexágono, 3 = triângulo,
//                   10 = engrenagem/folha com sx/sz esticando antes de girar;
//                   j = cantos fora do lugar no círculo — rocha irregular)
//  { w, d, rot? }   retângulo (rot em graus)
//  { arc: [R0, R1, a0, a1] }  pedaço de anel em volta de (x, z) da peça (graus,
//                   0 = +z, 90 = +x); a borda de dentro é reta (fica convexo)

/** Enfeite que colide: tipo, deslocamento do centro da ilha, altura, tamanho, giro (graus), meia-largura, desenho. */
                                                                                             

                 
               
           
           
           
          
              
                                                                                             
                                    
                            
                   
                                                                                             
                
 

                    
            
           
                                                     
               
                        
              
                                                                                 
              
                                                                                                           
                 
 

const D2R = Math.PI / 180

/** Contorno (no chão, em volta de 0,0 — o arco em volta do centro da peça). */
function outline(s       )           {
  const pts           = []
  if ("c" in s) {
    const n = Math.max(14, Math.min(40, Math.round(s.c * 4)))
    for (let i = 0; i < n; i++) pts.push(Math.sin((i / n) * Math.PI * 2) * s.c, Math.cos((i / n) * Math.PI * 2) * s.c)
  } else if ("arc" in s) {
    const [R0, R1, a0, a1] = s.arc
    const steps = Math.max(2, Math.ceil((a1 - a0) / 6))
    for (let i = 0; i <= steps; i++) {
      const a = (a0 + ((a1 - a0) * i) / steps) * D2R
      pts.push(Math.sin(a) * R1, Math.cos(a) * R1)
    }
    pts.push(Math.sin(a1 * D2R) * R0, Math.cos(a1 * D2R) * R0, Math.sin(a0 * D2R) * R0, Math.cos(a0 * D2R) * R0)
  } else if ("w" in s) {
    const r = (s.rot ?? 0) * D2R
    const c = Math.cos(r)
    const n = Math.sin(r)
    for (const [lx, lz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const x = (lx * s.w) / 2
      const z = (lz * s.d) / 2
      pts.push(x * c + z * n, -x * n + z * c)
    }
  } else {
    // estica (sx, sz) e depois gira (rot), como o retângulo; j = cantos
    // deslocados NO círculo (continua convexo)
    const r = (s.rot ?? 0) * D2R
    const c = Math.cos(r)
    const sn = Math.sin(r)
    const sx = s.sx ?? 1
    const sz = s.sz ?? 1
    for (let i = 0; i < s.n; i++) {
      const a = ((i + (s.j ? (hash01(i * 13 + s.n * 7 + Math.round(s.r * 10)) - 0.5) * s.j : 0)) / s.n) * Math.PI * 2
      const x = Math.sin(a) * s.r * sx
      const z = Math.cos(a) * s.r * sz
      pts.push(x * c + z * sn, -x * sn + z * c)
    }
  }
  return pts.map(round)
}

/** Raio do círculo que cabe dentro do contorno, em volta do centro dele. */
function inradius(pts                   ) {
  const s = polySolid(pts, 0, 1)
  let r = Infinity
  for (let i = 0; i < s.d.length; i++) r = Math.min(r, s.d[i] - (s.n[i * 2] * s.x + s.n[i * 2 + 1] * s.z))
  return round(r)
}

function buildArena(def          , mode           )           {
  const islands           = []
  const props              = []
  const cats             = []
  const capsules                 = []
  const bases              = []
  const portals         = []

  /** Cria a ilha da peça (espelhada em x quando `mirror`). */
  const make = (p       , team        , mirror         )         => {
    const sx = mirror ? -1 : 1
    const local = outline(p.s)
    const pts           = []
    for (let i = 0; i < local.length; i += 2) pts.push(round((p.x + local[i]) * sx), round(p.z + local[i + 1]))
    const c = polyCenter(pts)
    const r = inradius(pts)
    const isl         = {
      id: islands.length,
      kind: p.k,
      team,
      x: round(c.x),
      y: p.y,
      z: round(c.z),
      r,
      depth: round(Math.min(r * 2.2, polySolid(pts, 0, 1).r) * 1.15 + 1.6),
      poly: pts,
    }
    if (p.tag) isl.tag = p.tag
    islands.push(isl)
    // enfeites que colidem (deslocamento do centro do contorno)
    for (const [kind, dx, dz, h, s, rot, w, tag] of p.props ?? []) {
      const pr            = { kind, x: round(isl.x + dx * sx), y: p.y, z: round(isl.z + dz), s, h, rot: round((rot ?? 0) * D2R * sx) }
      if (w) pr.w = w
      if (tag) pr.tag = tag
      props.push(pr)
    }
    // gatinhos e cápsulas: no círculo de dentro (nunca no ar nem na borda)
    const seed = islands.length * 7 + 3
    const spots = Array.isArray(p.cats)
      ? p.cats.map(([dx, dz]) => ({ x: isl.x + dx * sx, z: isl.z + dz }))
      : Array.from({ length: p.cats ?? 0 }, (_, i) => {
          const a = i * 2.39996 + seed * 0.37
          return { x: isl.x + Math.sin(a) * r * 0.45 * sx, z: isl.z + Math.cos(a) * r * 0.45 }
        })
    for (const q of spots) cats.push({ id: cats.length, x: round(q.x), y: p.y, z: round(q.z), skin: ((cats.length + 1) % 3 === 0 ? 1 : 0)         , facing: round(hash01(cats.length * 7 + 10) * Math.PI * 2) })
    ;(p.caps ?? []).forEach((cc, i) => {
      const a = i * 2.1 + seed * 0.53 + 1.2
      capsules.push({ id: capsules.length, c: cc, x: round(isl.x + Math.sin(a) * r * 0.62 * sx), y: p.y, z: round(isl.z + Math.cos(a) * r * 0.62) })
    })
    return isl
  }

  // os dois lados (o time 1 é o espelho), depois o meio
  const sideIds             = [[], []]
  for (const team of [0, 1]) {
    def.side.forEach((p, i) => {
      const isl = make(p, team, team === 1)
      sideIds[team].push(isl.id)
      if (i === 0) {
        const sx = team === 0 ? -1 : 1
        const facing = round(Math.atan2(-sx, 0))
        const spawns = [0, 1, 2].map((k) => ({ x: round(isl.x - sx * 2.5), y: isl.y, z: round(isl.z + (k - 1) * 2.2), facing }))
        bases.push({ team, island: isl.id, spawns })
      }
    })
  }
  const midIds             = [[], []]
  for (const p of def.mid) {
    const a = make(p, -1, false)
    const b = p.pair ? make(p, -1, true) : a
    midIds[0].push(a.id)
    midIds[1].push(b.id)
  }
  portals.push({ x: def.portal.x, y: def.portal.y, z: def.portal.z }, { x: -def.portal.x, y: def.portal.y, z: def.portal.z })

  // rodadas a mais de gatinhos (2×2, 3×3): mesma conta da Cidade
  const rounds = PAINT_MODES[mode]
  const side = [0, 1].map((team) => sideIds[team].slice(1).map((id) => islands[id]))
  const middle = islands.filter((i) => i.team === -1)
  const extra = (isl        , ang        , mirror         ) => {
    const s = mirror ? -1 : 1
    cats.push({ id: cats.length, x: round(isl.x + Math.sin(ang) * isl.r * 0.42 * s), y: isl.y, z: round(isl.z + Math.cos(ang) * isl.r * 0.42), skin: ((cats.length + 1) % 3 === 0 ? 1 : 0)         , facing: round(hash01(cats.length * 7 + 10) * Math.PI * 2) })
  }
  for (let k = 1; k < rounds; k++) {
    for (let j = 0; j < 18; j++) {
      const at = (k * 5 + j * 2) % side[0].length
      const ang = j * 2.39996 + k * 1.1
      extra(side[0][at], ang, false)
      extra(side[1][at], ang, true)
    }
    for (let j = 0; j < 12; j++) extra(middle[(k * 3 + j) % middle.length], j * 2.39996 + k * 0.7, false)
  }

  const boss = bossIsland(islands, capsules)
  const ref = (team        , r        ) => (r[0] === "s" ? sideIds[team][Number(r.slice(1))] : midIds[team][Number(r.slice(1))])
  return {
    id: def.id,
    v: def.v,
    islands,
    props,
    solids: staticSolids(islands, props),
    cats,
    capsules,
    bases,
    portals,
    boss,
    routes: [0, 1].map((team) => def.route.map((r) => ref(team, r))),
  }
}

/** Pedaços de anel em volta de (cx, cz), de `a0` a `a1` (graus), com vão entre eles e subindo `dy` a cada um. */
function arcRun(cx        , cz        , R0        , R1        , a0        , span        , gap        , n        , y0        , dy        , extra                 = {})          {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + i * (span + gap)
    return { k: "path"              , x: cx, z: cz, y: round(y0 + i * dy), s: { arc: [R0, R1, a, a + span]                                     }, ...extra }
  })
}

/** Ponto no anel de raio R (graus, 0 = +z). */
const onRing = (R        , deg        ) => ({ x: round(Math.sin(deg * D2R) * R), z: round(Math.cos(deg * D2R) * R) })

// ═══ 2. JARDIM ESPIRAL ═══════════════════════════════════════════════════════
// Ruínas brancas sobre as nuvens. Cada time sobe a MEIA-LUA de terraços em
// volta da base (5 pedaços de anel, 2,6 m cada), atravessa o abismo até o
// anel de fora da grande ESPIRAL do meio e sobe: anel de fora até o patamar
// NORTE (os dois times se encontram ali), anel de dentro até o patamar SUL e
// o templo no alto (os dois portais). Embaixo, rota alternativa pelo sul:
// meia-lua baixa, o terraço com corredor de ruínas (muro azul fecha) e os
// jardins soltos.
const JR = (deg        , R        , y        , extra                 = {})        => ({ k: "center", ...onRing(R, deg), y, s: { n: 6, r: 3.6, rot: 30 }, tag: "plinth", ...extra })
const JARDIM           = {
  id: "jardim",
  v: 1,
  side: [
    // s0 base hexagonal
    { k: "base", x: -46, y: 0, z: 0, s: { n: 6, r: 10, rot: 30 }, tag: "garden", cats: [[3, 5.5], [3, -5.5]], caps: [0, 1, 2, 3], props: [["pillar", -6.2, 3.6, 2.4, 0.42, 0, 0, "column"], ["pillar", -6.2, -3.6, 2.4, 0.42, 0, 0, "column"]] },
    // s1–s5 a meia-lua norte subindo (rota)
    ...arcRun(-46, 0, 13, 18.5, -70, 20, 8, 5, 1.2, 2.6, { tag: "terrace", cats: 1, caps: [0] }),
    // s6–s8 meia-lua sul, baixa (rota alternativa)
    ...arcRun(-46, 0, 13, 18, 118, 20, 9, 3, 1.0, 1.5, { k: "wing", tag: "terrace", cats: 1, caps: [2] }),
    // s9 terraço com corredor de ruínas (dois muros baixos: o muro de tinta fecha a passagem)
    { k: "branch", x: -27, y: 5.4, z: -15, s: { w: 13, d: 7 }, tag: "ruins", cats: [[-5.6, 0], [5, 0]], props: [["crate", -1.5, 2.6, 1.6, 0.35, 0, 3.4, "ruinwall"], ["crate", -1.5, -2.6, 1.6, 0.35, 0, 3.4, "ruinwall"]] },
    // s10 ruínas hexagonais (ícone da Freelandoo)
    { k: "branch", x: -18, y: 8.2, z: -26, s: { n: 6, r: 4.6 }, tag: "ruins", cats: 2, caps: [3, 1], props: [["pillar", 2.4, 1.6, 2.2, 0.4, 0, 0, "column"]] },
    // s11–s13 jardins soltos (só de ponte ou cama elástica)
    { k: "wing", x: -60, y: 4.5, z: -14, s: { c: 2.6 }, tag: "garden", cats: 1 },
    { k: "wing", x: -34, y: 10.5, z: 26, s: { n: 5, r: 3 }, tag: "garden", cats: 2, caps: [2] },
    { k: "wing", x: -64, y: 7.5, z: 16, s: { c: 2.4 }, tag: "garden", cats: 1 },
  ],
  mid: [
    // m0–m1 anel de fora (pares), m2 patamar NORTE
    JR(-90, 19, 14.2, { pair: true, caps: [1] }),
    JR(-45, 19, 16.8, { pair: true }),
    { k: "center", x: 0, y: 19.4, z: 19, s: { n: 6, r: 4.6, rot: 30 }, tag: "plinth", cats: 2, caps: [3] },
    // m3–m5 anel de dentro (pares), m6 patamar SUL
    JR(45, 11, 22, { pair: true, cats: 1 }),
    JR(90, 11, 24.6, { pair: true, cats: 1, caps: [2] }),
    JR(135, 11, 27.2, { pair: true, cats: 1 }),
    { k: "center", x: 0, y: 29.8, z: -11, s: { n: 6, r: 4.2, rot: 30 }, tag: "plinth", cats: 2, caps: [0] },
    // m7 o templo no alto (os dois portais)
    { k: "summit", x: 0, y: 32.4, z: 0, s: { n: 8, r: 5.6, rot: 22.5 }, tag: "temple" },
    // m8 jardins do meio, embaixo (norte e sul)
    { k: "center", x: 0, y: 6, z: 31, s: { n: 6, r: 3.4 }, tag: "garden", cats: 1 },
    { k: "center", x: 0, y: 7, z: -29, s: { n: 6, r: 3.4, rot: 30 }, tag: "garden", cats: 1 },
  ],
  portal: { x: -2.6, y: 32.4, z: 0 },
  route: ["s0", "s1", "s2", "s3", "s4", "s5", "m0", "m1", "m2", "m3", "m4", "m5", "m6", "m7"],
}

// ═══ 3. FÁBRICA SUSPENSA ═════════════════════════════════════════════════════
// Uma máquina colossal no vazio. Cada time sobe o ANDAIME de chapas
// retangulares empilhadas (zigue-zague norte/sul, uma chapa em cima da outra:
// 6,8 m — dá para ficar embaixo da de cima), corre a ESTEIRA estreita até o
// meio e sobe as chapas presas por correntes até a grande ENGRENAGEM do alto
// (os dois portais). Embaixo, o pátio da engrenagem grande do meio e as pistas
// de esteira norte/sul (rotas alternativas e os gatinhos disputados).
const FABRICA           = {
  id: "fabrica",
  v: 1,
  side: [
    // s0 doca (base)
    { k: "base", x: -48, y: 0, z: 0, s: { w: 20, d: 16 }, tag: "dock", cats: [[-4, 5], [-4, -5]], caps: [0, 1, 2, 3], props: [["crate", -8, 6, 1.2, 0.6, 0, 0, "crate"], ["crate", -8, -6, 1.2, 0.6, 0, 0, "crate"]] },
    // s1–s5 o andaime em zigue-zague (rota)
    { k: "path", x: -30, y: 2.4, z: 13, s: { w: 8, d: 6 }, tag: "plate", cats: 1, caps: [0] },
    { k: "path", x: -30, y: 5.8, z: -3, s: { w: 8, d: 6 }, tag: "plate", cats: 1, caps: [2] },
    { k: "path", x: -30, y: 9.2, z: 13, s: { w: 8, d: 6 }, tag: "plate", cats: 1 },
    { k: "path", x: -30, y: 12.6, z: -3, s: { w: 8, d: 6 }, tag: "plate", cats: 1, caps: [1] },
    { k: "path", x: -30, y: 16, z: 13, s: { w: 8, d: 6 }, tag: "plate", cats: 1, caps: [2] },
    // s6 a esteira estreita até o meio
    { k: "path", x: -18, y: 18.4, z: 13, s: { w: 12, d: 3.6 }, tag: "conveyor", cats: 1 },
    // s7–s12 pistas de baixo, engrenagens e chapas de manutenção
    { k: "wing", x: -38, y: 2, z: 26, s: { w: 10, d: 3.6 }, tag: "conveyor", cats: 1 },
    { k: "wing", x: -24, y: 4.2, z: 28, s: { n: 10, r: 4 }, tag: "gear", cats: 2, caps: [3] },
    { k: "wing", x: -36, y: 1.5, z: -18, s: { w: 8, d: 8 }, tag: "plate", cats: [[-2, -2], [2, 2]], props: [["crate", -2.6, 2.6, 1.1, 0.55, 0, 0, "crate"]] },
    { k: "wing", x: -22, y: 5, z: -24, s: { w: 7, d: 5 }, tag: "chain", cats: 2, caps: [2] },
    { k: "branch", x: -58, y: 3.4, z: -18, s: { w: 6, d: 5 }, tag: "plate", cats: 1 },
    { k: "branch", x: -44, y: 7.5, z: -14, s: { n: 10, r: 3.2 }, tag: "gear", cats: 2, caps: [1] },
  ],
  mid: [
    // m0 pátio da engrenagem grande (o centro de baixo)
    { k: "center", x: 0, y: 8, z: 0, s: { n: 12, r: 8 }, tag: "gear", cats: 4, caps: [3, 0] },
    // m1 chapas presas por correntes (par), m2 a engrenagem do alto (portais)
    { k: "center", x: -6.5, y: 21.6, z: 6, s: { w: 6, d: 6 }, tag: "chain", pair: true, cats: 1, caps: [1] },
    { k: "summit", x: 0, y: 25, z: -6, s: { n: 12, r: 6.2 }, tag: "ring" },
    // m3–m5 pistas de baixo (pares) e a engrenagem norte
    { k: "center", x: -11, y: 6, z: 26, s: { w: 6, d: 4 }, tag: "conveyor", pair: true, cats: 1 },
    { k: "center", x: -11, y: 5, z: -22, s: { w: 5, d: 5 }, tag: "plate", pair: true, cats: 1, caps: [2] },
    { k: "center", x: 0, y: 9, z: 30, s: { n: 10, r: 3.2 }, tag: "gear", cats: 2 },
  ],
  portal: { x: -2.8, y: 25, z: -6 },
  route: ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "m1", "m2"],
}

// ═══ 4. FLORESTA DE CRISTAL ══════════════════════════════════════════════════
// A ÁRVORE colossal no meio (o tronco colide) com folhas gigantes em volta,
// subindo. Cada time atravessa as raízes, sobe as folhas do seu lado do tronco
// até o galho NORTE (encontro), vai para as folhas de fora e para o galho SUL,
// e chega à copa (os dois portais). Em volta, ilhotas de cristal e cogumelo.
const FL = (deg        , R        , y        , r        , extra                 = {})        => ({ k: "center", ...onRing(R, deg), y, s: { n: 10, r, sz: 1.3, rot: deg }, tag: "leaf", ...extra })
const FLORESTA           = {
  id: "floresta",
  v: 1,
  side: [
    // s0 a folha da base
    { k: "base", x: -46, y: 0, z: 0, s: { n: 12, r: 9, sx: 1.15 }, tag: "leafbase", cats: [[3, 5], [3, -5]], caps: [0, 1, 2, 3] },
    // s1 raiz, s2 folha (rota)
    { k: "path", x: -29.5, y: 1.6, z: -3, s: { w: 7, d: 4, rot: -10 }, tag: "root", cats: 1, caps: [2] },
    { k: "path", x: -19.5, y: 3.6, z: -7, s: { n: 10, r: 3.4, sx: 1.25 }, tag: "leaf", cats: 1, caps: [0] },
    // s3–s9 cristais, cogumelos e galhos soltos
    { k: "wing", x: -56, y: 3.5, z: 18, s: { n: 5, r: 3 }, tag: "crystal", cats: 2 },
    { k: "wing", x: -40, y: 6.5, z: 22, s: { n: 10, r: 3, sx: 1.3, rot: 30 }, tag: "leaf", cats: 2, caps: [3] },
    { k: "wing", x: -26, y: 9.5, z: 18, s: { n: 10, r: 3, sx: 1.3, rot: -20 }, tag: "leaf", cats: 2 },
    { k: "wing", x: -58, y: 4, z: -16, s: { n: 7, r: 2.8 }, tag: "mushroom", cats: 2 },
    { k: "wing", x: -42, y: 7.8, z: -22, s: { n: 10, r: 3, sx: 1.3, rot: 60 }, tag: "leaf", cats: 2, caps: [2] },
    { k: "branch", x: -26, y: 11, z: -20, s: { n: 5, r: 2.8 }, tag: "crystal", cats: 2, caps: [1] },
    { k: "branch", x: -34, y: 14.5, z: 9, s: { n: 10, r: 3, sx: 1.3 }, tag: "leaf", cats: 2 },
  ],
  mid: [
    // m0 o chão de raízes com o TRONCO (pilar que colide, até embaixo da copa)
    { k: "center", x: 0, y: 2, z: 0, s: { n: 9, r: 9.5 }, tag: "roots", cats: [[0, 7], [0, -7], [-6.5, 2.5], [6.5, 2.5]], caps: [3], props: [["pillar", 0, 0, 26, 4.5, 0, 0, "trunk"]] },
    // m1–m3 folhas de baixo (pares), m4 galho NORTE
    FL(-130, 9.6, 6.4, 3, { pair: true }),
    FL(-85, 9.6, 9.8, 3, { pair: true, cats: 1, caps: [1] }),
    FL(-40, 9.6, 13.2, 3, { pair: true }),
    { k: "center", x: 0, y: 16.8, z: 11.6, s: { n: 10, r: 3.4 }, tag: "leaf", cats: 2, caps: [2] },
    // m5–m6 folhas de fora (pares), m7 galho SUL, m8 a copa (portais)
    FL(-60, 15, 20.4, 3.4, { pair: true, cats: 1 }),
    FL(-120, 15, 23.8, 3.4, { pair: true, caps: [0] }),
    { k: "center", ...onRing(12, 180), y: 27.2, s: { n: 10, r: 4, sx: 1.25 }, tag: "leaf", cats: 2 },
    { k: "summit", x: 0, y: 30.8, z: 0, s: { n: 10, r: 6.4 }, tag: "canopy" },
  ],
  portal: { x: -2.8, y: 30.8, z: 0 },
  route: ["s0", "s1", "s2", "m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"],
}

// ═══ 5. TEMPLO DA TEMPESTADE ═════════════════════════════════════════════════
// Ruínas dentro da tempestade. A base é um TRIÂNGULO apontado para o meio;
// a escadaria partida (degraus de verdade, sobe andando) leva aos terraços
// triangulares; dali, os fragmentos da TORRE em volta do núcleo (cada time
// sobe o seu lado até o fragmento NORTE) e o anel de colunas no alto (os dois
// portais). Ao sul, a outra escadaria e as ruínas de colunas.
const TF = (deg        , y        , extra                 = {})        => ({ k: "center", ...onRing(11, deg), y, s: { w: 4, d: 5.6, rot: deg + 90 }, tag: "fragment", ...extra })
const stair = (x        , z        , y        , extra                 = {})        => ({ k: "path", x, y, z, s: { w: 3.2, d: 5 }, tag: "stair", ...extra })
const TEMPLO           = {
  id: "templo",
  v: 1,
  side: [
    // s0 base triangular (ponta para o meio)
    { k: "base", x: -48, y: 0, z: 0, s: { n: 3, r: 12, rot: 90 }, tag: "triangle", cats: [[-3, 4], [-3, -4]], caps: [0, 1, 2, 3], props: [["pillar", -4.5, 7, 3.2, 0.5, 0, 0, "column"], ["pillar", -4.5, -7, 3.2, 0.5, 0, 0, "column"]] },
    // s1–s4 a escadaria norte (degraus colados: sobe andando)
    stair(-42.4, 10, 0.8, { cats: 1 }),
    stair(-39.2, 10, 1.1),
    stair(-36, 10, 1.4),
    stair(-32.8, 10, 1.7, { cats: 1, caps: [2] }),
    // s5–s6 terraços triangulares (rota)
    { k: "path", x: -24, y: 5.4, z: 12, s: { n: 3, r: 4.8, rot: 90 }, tag: "triangle", cats: 2, caps: [0] },
    { k: "path", x: -21, y: 8.8, z: 0, s: { n: 3, r: 4.4, rot: 90 }, tag: "triangle", cats: 1 },
    // s7–s9 ruínas de colunas (norte/sul)
    { k: "wing", x: -58, y: 3, z: 16, s: { n: 3, r: 3.6, rot: -90 }, tag: "triangle", cats: 2 },
    { k: "wing", x: -40, y: 6.4, z: 22, s: { w: 5, d: 4 }, tag: "ruins", cats: 2, caps: [3] },
    { k: "wing", x: -60, y: 4.2, z: -14, s: { n: 3, r: 3.6, rot: -90 }, tag: "triangle", cats: 2 },
    // s10–s12 a escadaria sul (partida)
    stair(-41, -14, 0.9, { k: "wing" }),
    stair(-37.8, -14, 1.2, { k: "wing" }),
    stair(-34.6, -14, 1.5, { k: "wing", cats: 1 }),
    // s13–s14 terraço e ruína alta do sul
    { k: "branch", x: -24, y: 5, z: -16, s: { n: 3, r: 4, rot: 90 }, tag: "triangle", cats: 2, caps: [2] },
    { k: "branch", x: -30, y: 9.6, z: -26, s: { w: 5, d: 5 }, tag: "ruins", cats: [[-1.4, -1.4], [1.4, -1.4]], caps: [1], props: [["pillar", 1.9, 1.9, 2.6, 0.45, 0, 0, "column"]] },
  ],
  mid: [
    // m0 a praça do núcleo (a coluna partida no meio colide)
    { k: "center", x: 0, y: 4, z: 0, s: { n: 6, r: 7, rot: 30 }, tag: "plaza", cats: [[0, 4.5], [-4, -2.5], [4, -2.5]], props: [["pillar", 0, 0, 14.6, 2.4, 0, 0, "core"]] },
    // m1–m2 fragmentos da torre (pares), m3 fragmento NORTE, m4 o anel de colunas (portais)
    TF(-90, 12.4, { pair: true, cats: 1 }),
    TF(-45, 16, { pair: true, cats: 1, caps: [2] }),
    { k: "center", x: 0, y: 19.6, z: 10.5, s: { w: 5.6, d: 4 }, tag: "fragment", cats: 2, caps: [3] },
    {
      k: "summit",
      x: 0,
      y: 23.2,
      z: 0,
      s: { n: 8, r: 6, rot: 22.5 },
      tag: "colonnade",
      props: [
        ["pillar", 0, 4.6, 3.4, 0.5, 0, 0, "column"],
        ["pillar", 0, -4.6, 3.4, 0.5, 0, 0, "column"],
        ["pillar", -3.3, 3.3, 3.4, 0.5, 0, 0, "column"],
        ["pillar", 3.3, 3.3, 3.4, 0.5, 0, 0, "column"],
        ["pillar", -3.3, -3.3, 3.4, 0.5, 0, 0, "column"],
        ["pillar", 3.3, -3.3, 3.4, 0.5, 0, 0, "column"],
      ],
    },
    // m5–m6 fragmentos do sul
    { k: "center", x: 0, y: 6, z: -11, s: { w: 5.6, d: 4 }, tag: "fragment", cats: 1 },
    TF(-135, 9, { pair: true, cats: 1, caps: [0] }),
  ],
  portal: { x: -2.4, y: 23.2, z: 0 },
  route: ["s0", "s1", "s4", "s5", "s6", "m1", "m2", "m3", "m4"],
}

// ═══ 6. FORJA VULCÂNICA ══════════════════════════════════════════════════════
// Basalto preto, chapas de metal e lava lá embaixo. Cada time sai da rocha
// irregular, passa pela laje comprida de basalto e pelas plataformas
// hexagonais de metal e chega à FORJA do meio: a coluna da fornalha (colide)
// com plataformas presas nas faces, subindo em volta dela até a bigorna no
// alto (os dois portais). Em volta, rochas soltas, a bigorna e o guindaste.
const FORJA           = {
  id: "forja",
  v: 1,
  side: [
    // s0 base de basalto irregular
    { k: "base", x: -48, y: 0, z: 0, s: { n: 9, r: 10, j: 0.5 }, tag: "basalt", cats: [[3, 5], [3, -5]], caps: [0, 1, 2, 3] },
    // s1 laje comprida, s2–s3 plataformas hexagonais de metal (rota)
    { k: "path", x: -33, y: 1.8, z: 8, s: { w: 12, d: 4.5, rot: 10 }, tag: "basaltlong", cats: 1, caps: [2] },
    { k: "path", x: -22, y: 5.4, z: 14, s: { n: 6, r: 3.6 }, tag: "hexpad", cats: 1, caps: [0] },
    { k: "path", x: -16, y: 8.8, z: 6, s: { n: 6, r: 3.4 }, tag: "hexpad", cats: 1 },
    // s4–s10 rochas soltas, bigorna, guindaste
    { k: "wing", x: -58, y: 2.5, z: 16, s: { n: 7, r: 3.5, j: 0.5 }, tag: "basalt", cats: 2 },
    { k: "wing", x: -44, y: 5.6, z: 22, s: { n: 6, r: 3.2 }, tag: "hexpad", cats: 2, caps: [3] },
    { k: "wing", x: -30, y: 8.4, z: 26, s: { w: 6, d: 4 }, tag: "anvil", cats: 2 },
    { k: "wing", x: -56, y: 3.2, z: -18, s: { n: 8, r: 3.6, j: 0.5 }, tag: "basalt", cats: 2 },
    { k: "wing", x: -40, y: 1.6, z: -16, s: { w: 10, d: 4, rot: -15 }, tag: "basaltlong", cats: [[-2.5, 0], [2.5, 0]], caps: [2] },
    { k: "branch", x: -26, y: 4.8, z: -20, s: { n: 6, r: 3.2 }, tag: "hexpad", cats: 2, caps: [1] },
    { k: "branch", x: -30, y: 9.8, z: -8, s: { w: 4, d: 4 }, tag: "crane", cats: 1 },
  ],
  mid: [
    // m0 o chão da forja com a FORNALHA (caixa que colide no meio)
    { k: "center", x: 0, y: 3, z: 0, s: { n: 8, r: 9, rot: 22.5 }, tag: "forgefloor", cats: [[0, 6.2], [0, -6.2], [-6.2, 0], [6.2, 0]], props: [["crate", 0, 0, 20, 3, 0, 3, "furnace"]] },
    // m1 face oeste embaixo (par), m2 face NORTE, m3 face oeste em cima (par), m4 face SUL, m5 a bigorna do alto (portais)
    { k: "center", x: -7, y: 12.2, z: 1, s: { w: 4, d: 6 }, tag: "grate", pair: true, cats: 1, caps: [1] },
    { k: "center", x: 0, y: 15.6, z: 7.5, s: { w: 6, d: 4 }, tag: "grate", cats: 2, caps: [2, 3] },
    { k: "center", x: -7, y: 19, z: 1, s: { w: 4, d: 6 }, tag: "grate", pair: true, cats: 1 },
    { k: "center", x: 0, y: 22.4, z: -10, s: { w: 6, d: 4 }, tag: "grate", cats: 2, caps: [0] },
    { k: "summit", x: 0, y: 25.8, z: 0, s: { n: 8, r: 6.5, rot: 22.5 }, tag: "forgetop" },
  ],
  portal: { x: -2.8, y: 25.8, z: 0 },
  route: ["s0", "s1", "s2", "s3", "m1", "m2", "m3", "m4", "m5"],
}

// ═══ catálogo ═════════════════════════════════════════════════════════════════

/** Os mapas, na ordem do cartão. A Cidade é o mapa de antes (sim/map.ts). */
const PAINT_MAPS = [
  { id: "cidade", v: 1 },
  { id: "jardim", v: 1 },
  { id: "fabrica", v: 1 },
  { id: "floresta", v: 1 },
  { id: "templo", v: 1 },
  { id: "forja", v: 1 },
]         
                                                          

const ARENAS                           = { jardim: JARDIM, fabrica: FABRICA, floresta: FLORESTA, templo: TEMPLO, forja: FORJA }

/** Id conhecido (senão a Cidade). */
function paintMapId(id         )             {
  return (PAINT_MAPS.find((m) => m.id === id) ?? PAINT_MAPS[0]).id
}

/** Versão da regra do mapa (a sala manda; aparelho com outra versão está desatualizado). */
function paintMapVersion(id        ) {
  return (PAINT_MAPS.find((m) => m.id === id) ?? PAINT_MAPS[0]).v
}

/** O mapa da partida (o do modo: 2×2 e 3×3 com mais gatinhos). */
function buildPaintMap(mode            = "solo", id         = "cidade")           {
  const arena = ARENAS[paintMapId(id)]
  return arena ? buildArena(arena, mode) : buildCidadeMap(mode)
}

/** Apuração da votação (mm3d-76): mais votado; empate = sorteio entre os empatados (`rand` em [0, 1) vem da sala). */
function tallyPaintVotes(votes                   , rand        )             {
  const n = new Map                ()
  for (const v of votes) {
    const id = paintMapId(v)
    n.set(id, (n.get(id) ?? 0) + 1)
  }
  if (!n.size) return PAINT_MAPS[0].id
  const top = Math.max(...n.values())
  const tied = PAINT_MAPS.map((m) => m.id).filter((id) => n.get(id) === top)
  return tied[Math.min(tied.length - 1, Math.floor(rand * tied.length))]
}

/** A ilha do chefão é a mesma em todo mapa. */
const PAINT_BOSS_AT = BOSS

// ── sim/collide.ts ───────────────────────────────────────────────────────────
// features/meu-mundo/paint/sim/collide.ts — PAINT (mm3d-35): perguntas ao mundo.
//
// O mundo é uma lista de sólidos verticais (cilindros e caixas alinhadas): as
// ilhas, os enfeites e a TINTA (ponte e degrau são cilindros; o MURO, mm3d-46,
// é uma caixa girada — as perguntas giram o ponto para o lado dele). Três perguntas:
//  - apoio: qual o chão mais alto sob um ponto, até uma altura;
//  - empurrão: tirar o corpo de dentro de um sólido de lado;
//  - raio: onde o tiro bate (ponto, normal, sólido).

                                                              

/** Raio do "pé": anda até a borda sem cair antes (menor que o corpo). */
const FOOT_R = 0.18

/** Ponto do mundo → eixos do muro (x ao longo dele, z para a frente). */
function wallLocal(s           , x        , z        ) {
  const dx = x - s.x
  const dz = z - s.z
  const c = Math.cos(s.a)
  const n = Math.sin(s.a)
  return { lx: dx * c - dz * n, lz: dx * n + dz * c }
}

/** Eixos do muro → direção no mundo. */
function wallWorld(s           , lx        , lz        ) {
  const c = Math.cos(s.a)
  const n = Math.sin(s.a)
  return { x: lx * c + lz * n, z: -lx * n + lz * c }
}

/** Prisma convexo (mm3d-76): quanto o ponto passa do lado mais "de fora" (≤ 0 = dentro) e qual lado. */
function polyDepth(s           , x        , z        ) {
  let best = -Infinity
  let at = 0
  for (let i = 0; i < s.d.length; i++) {
    const v = s.n[i * 2] * x + s.n[i * 2 + 1] * z - s.d[i]
    if (v > best) {
      best = v
      at = i
    }
  }
  return { v: best, at }
}

/** Ponto do contorno do prisma mais perto de (x, z). */
function polyClosest(s           , x        , z        ) {
  const m = s.pts.length / 2
  let bx = s.x
  let bz = s.z
  let bd = Infinity
  for (let i = 0; i < m; i++) {
    const ax = s.pts[i * 2]
    const az = s.pts[i * 2 + 1]
    const ex = s.pts[((i + 1) % m) * 2] - ax
    const ez = s.pts[((i + 1) % m) * 2 + 1] - az
    const l2 = ex * ex + ez * ez || 1
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / l2))
    const px = ax + ex * t
    const pz = az + ez * t
    const dd = (px - x) * (px - x) + (pz - z) * (pz - z)
    if (dd < bd) {
      bd = dd
      bx = px
      bz = pz
    }
  }
  return { x: bx, z: bz, d: Math.sqrt(bd) }
}

function inside(s       , x        , z        , pad        ) {
  if (s.k === 3) {
    const dx = x - s.x
    const dz = z - s.z
    const R = s.r + pad
    if (dx * dx + dz * dz > R * R) return false
    return polyDepth(s, x, z).v <= pad
  }
  if (s.k === 0) {
    const dx = x - s.x
    const dz = z - s.z
    const r = s.r + pad
    return dx * dx + dz * dz <= r * r
  }
  if (s.k === 2) {
    const l = wallLocal(s, x, z)
    return Math.abs(l.lx) <= s.hx + pad && Math.abs(l.lz) <= s.hz + pad
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

/** Índice do sólido que dá o chão de `supportAt` (-1 = nenhum). */
function supportIndex(solids                  , x        , z        , maxY        , pad = FOOT_R) {
  let best = -Infinity
  let idx = -1
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    if (s.y1 > maxY || s.y1 <= best) continue
    if (inside(s, x, z, pad)) {
      best = s.y1
      idx = i
    }
  }
  return idx
}

/**
 * Tira o corpo (círculo de raio r, de `y` a `y + h`) de dentro dos sólidos que
 * ele não consegue subir (topo acima de `y + up`). Mexe em `p` e devolve se
 * encostou em algo.
 */
function pushOut(
  solids                  ,
  p                                     ,
  r        ,
  h        ,
  up        ,
  /** mm3d-62: encostou num muro de tinta → para onde ele empurrou (unitário) e o id da mancha. */
  wall                                        ,
) {
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
      } else if (s.k === 3) {
        const dx = p.x - s.x
        const dz = p.z - s.z
        const R = s.r + r
        if (dx * dx + dz * dz >= R * R) continue
        const dep = polyDepth(s, p.x, p.z)
        if (dep.v >= r) continue
        if (dep.v <= 0) {
          // centro dentro: sai pelo lado mais perto
          const k = r - dep.v
          p.x += s.n[dep.at * 2] * k
          p.z += s.n[dep.at * 2 + 1] * k
        } else {
          const c = polyClosest(s, p.x, p.z)
          if (c.d >= r) continue
          if (c.d < 1e-6) {
            p.x += s.n[dep.at * 2] * r
            p.z += s.n[dep.at * 2 + 1] * r
          } else {
            p.x = c.x + ((p.x - c.x) / c.d) * r
            p.z = c.z + ((p.z - c.z) / c.d) * r
          }
        }
        hit = true
      } else if (s.k === 2) {
        const l = wallLocal(s, p.x, p.z)
        const ox = s.hx + r - Math.abs(l.lx)
        const oz = s.hz + r - Math.abs(l.lz)
        if (ox <= 0 || oz <= 0) continue
        const w = ox < oz ? wallWorld(s, Math.sign(l.lx || 1) * ox, 0) : wallWorld(s, 0, Math.sign(l.lz || 1) * oz)
        p.x += w.x
        p.z += w.z
        hit = true
        if (wall && s.b !== undefined && s.c === 3) {
          const wl = Math.hypot(w.x, w.z) || 1
          wall.nx = w.x / wl
          wall.nz = w.z / wl
          wall.b = s.b
        }
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

/** Raio × muro: gira o raio para os eixos do muro e usa a caixa. */
function rayWall(o      , d      , s           , maxT        )                                {
  const lo = wallLocal(s, o.x, o.z)
  const c = Math.cos(s.a)
  const n = Math.sin(s.a)
  const ld = { x: d.x * c - d.z * n, y: d.y, z: d.x * n + d.z * c }
  const h = rayBox({ x: lo.lx, y: o.y, z: lo.lz }, ld, { x: 0, z: 0, y0: s.y0, y1: s.y1, hx: s.hx, hz: s.hz }, maxT)
  if (!h) return null
  const w = wallWorld(s, h.n.x, h.n.z)
  return { t: h.t, n: { x: w.x, y: h.n.y, z: w.z } }
}

/** Raio × prisma convexo (mm3d-76): recorte pelos planos dos lados + tampas. */
function rayPoly(o      , d      , s           , maxT        )                                {
  let t0 = 0
  let t1 = maxT
  let n              = null
  // tampas
  if (Math.abs(d.y) < 1e-12) {
    if (o.y < s.y0 || o.y > s.y1) return null
  } else {
    let ta = (s.y0 - o.y) / d.y
    let tb = (s.y1 - o.y) / d.y
    let ny = -1
    if (ta > tb) {
      const tmp = ta
      ta = tb
      tb = tmp
      ny = 1
    }
    if (ta > t0) {
      t0 = ta
      n = { x: 0, y: ny, z: 0 }
    }
    t1 = Math.min(t1, tb)
    if (t0 > t1) return null
  }
  for (let i = 0; i < s.d.length; i++) {
    const nx = s.n[i * 2]
    const nz = s.n[i * 2 + 1]
    const den = nx * d.x + nz * d.z
    const num = s.d[i] - (nx * o.x + nz * o.z)
    if (Math.abs(den) < 1e-12) {
      if (num < 0) return null
      continue
    }
    const t = num / den
    if (den < 0) {
      if (t > t0) {
        t0 = t
        n = { x: nx, y: 0, z: nz }
      }
    } else t1 = Math.min(t1, t)
    if (t0 > t1) return null
  }
  if (!n) return null // começou dentro
  return { t: t0, n }
}

/** Primeiro sólido que o raio (d unitário) toca até `maxT`. */
function raycast(solids                  , o      , d      , maxT        )                {
  let best                = null
  let limit = maxT
  for (let i = 0; i < solids.length; i++) {
    const s = solids[i]
    const h = s.k === 0 ? rayCyl(o, d, s, limit) : s.k === 2 ? rayWall(o, d, s, limit) : s.k === 3 ? rayPoly(o, d, s, limit) : rayBox(o, d, s, limit)
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
  return { x, y, z, vx: 0, vy: 0, vz: 0, ground: true, air: 0, gy: y, facing, jumps: 0, bounce: null, shove: null }
}

/** Movimento para a animação: 0 parado, 1 andando, 2 correndo, 5 no ar. */
                                    

function stepBody(b           , it            , solids                  , dt = TUNING.step)           {
  const T = TUNING
  b.bounce = null
  b.shove = null
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

  if (it.jump) {
    if ((b.ground || b.air < T.coyote) && b.vy <= 0.01) {
      b.vy = T.jumpV
      b.ground = false
      b.air = T.coyote
      b.jumps = 1
    } else if (!b.ground && b.jumps < T.maxJumps) {
      // pulo no ar (mm3d-35c): saiu da borda sem pular também tem um
      b.vy = T.airJumpV
      b.jumps = T.maxJumps
    }
  }

  // horizontal + empurrão de lado
  b.x += b.vx * dt
  b.z += b.vz * dt
  const wall = { nx: 0, nz: 0, b: NaN }
  pushOut(solids, b, T.bodyR, T.bodyH, T.stepUp, wall)
  if (!Number.isNaN(wall.b) && b.vx * wall.nx + b.vz * wall.nz < T.wallBounce * 0.5) {
    // muro de gelatina (mm3d-62): quem bate é jogado para trás e para cima
    b.vx = wall.nx * T.wallBounce
    b.vz = wall.nz * T.wallBounce
    b.vy = Math.max(b.vy, T.wallBounceLift)
    b.ground = false
    b.air = T.coyote
    b.shove = wall.b
  }

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
  const fi = supportIndex(solids, b.x, b.z, reach)
  const fs = fi >= 0 ? solids[fi] : null
  const floor = fs ? fs.y1 : -Infinity
  if (b.vy <= 0 && fs && b.y <= floor + (wasGround ? 0.06 : 0)) {
    b.y = floor
    b.gy = floor
    if (fs.k !== 1 && fs.c === PAINT.STEP && fs.b !== undefined) {
      // cama elástica (mm3d-35e): lança para cima; no ar ainda tem um pulo
      b.vy = T.bounceV
      b.ground = false
      b.air = T.coyote
      b.jumps = 1
      b.bounce = fs.b ?? -1
      return 5
    }
    b.vy = 0
    b.ground = true
    b.air = 0
    b.jumps = 0
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

/** Uma mancha nasceu embaixo de quem está aqui: sobe para o topo (até 1,1 m). */
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
// mm3d-46: as cores mudaram (ponte LARANJA, dano PRETO, cama elástica
// VERMELHA) e entrou o MURO (turquesa).
//
//  - LARANJA (ponte): bateu no TOPO de algo ao alcance → poça-plataforma ali.
//    Senão (mirando o vão, ou o lado de uma ilha) → a ponte CRESCE: acha a
//    borda do chão na direção da mira, na altura do PÉ de quem atira (no ar,
//    a ponte nasce onde ele está — pular serve para isso, mm3d-35f), e põe
//    um disco logo depois dela. Segurando o botão, disco atrás de disco.
//  - VERMELHO (cama elástica, mm3d-35e): no ar → embaixo do pé (cai nela e é
//    lançado). No chão →
//    onde a mira bate (perto), ou logo à frente.
//  - PRETO (dano): acerta o jogador do OUTRO time, o chefão, ou apaga tinta
//    do outro time (o muro aguenta alguns tiros — quem conta é a partida);
//    no chão vira só respingo.
//  - TURQUESA (muro): placa em pé atravessada na mira, no chão onde a mira
//    bate (perto) ou logo à frente; mirando o topo de um muro, empilha. Barra
//    o corpo e o tiro (é sólido como a ilha) e EMPURRA quem bate (mm3d-62).
//    mm3d-62c: fica NO AR onde a mira aponta (não sobe do chão); ponte,
//    cama elástica e muro são placas QUADRADAS do mesmo tamanho (2,5 m).
//    Pegou um adversário em cheio: nasce na frente dele e ele voa para trás.

/** Mancha nova (sem id: quem guarda dá). No muro `r` é meio comprimento e `a` para onde olha. */
                          
               
           
           
            
            
           
            
 

                        
                                   
                                                 
                                                                                                         
                                                               
                                 
                                                
                                                
                    

/** Boca da arma: um pouco à direita e na altura do peito de quem atira. */
function muzzleOf(s                                     , yaw        )       {
  return { x: s.x + Math.cos(yaw) * 0.32, y: s.y + 1.25, z: s.z - Math.sin(yaw) * 0.32 }
}

const r3 = (v        ) => Math.round(v * 1000) / 1000

/** Placa quadrada (ponte/cama elástica, mm3d-62c) girada para `a`. */
function blobOf(c            , x        , z        , y0        , a        )          {
  const r = c === PAINT.STEP ? TUNING.stepR : TUNING.bridgeR
  const h = c === PAINT.STEP ? TUNING.stepH : TUNING.bridgeH
  return { c, x: r3(x), z: r3(z), y0: r3(y0), y1: r3(y0 + h), r, a: r3(a) }
}

/** Para onde a mira olha no chão (ou o corpo, mirando reto para cima/baixo). */
function yawOf(d      , s         ) {
  const hl = Math.hypot(d.x, d.z)
  if (hl < 0.2) return { hx: Math.sin(s.facing), hz: Math.cos(s.facing), a: s.facing }
  return { hx: d.x / hl, hz: d.z / hl, a: Math.atan2(d.x, d.z) }
}

function wallOf(x        , z        , y0        , a        )          {
  return { c: PAINT.WALL, x: r3(x), z: r3(z), y0: r3(y0), y1: r3(y0 + TUNING.wallH), r: TUNING.wallLen / 2, a: r3(a) }
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
  const { a: yaw } = yawOf(d, s)
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

  if (c === PAINT.WALL) {
    // de frente para quem atira (atravessado na mira)
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
    const a = Math.atan2(hx, hz)
    const hit = raycast(world.solids, o, d, T.range[PAINT.WALL])
    // adversário na mira antes da parede/chão: o muro nasce colado na frente
    // dele (do lado de quem atirou) e ele é empurrado para longe
    let near                    = null
    let nearT = hit ? hit.t : T.range[PAINT.WALL]
    for (const b of world.bodies) {
      if (b.slot === s.slot || b.team === s.team) continue
      const t = rayBody(o, d, b, T.hitR, T.bodyH, nearT)
      if (t === null || t >= nearT) continue
      nearT = t
      const back = T.bodyR + T.wallT / 2 + 0.08
      near = { kind: "shove", slot: b.slot, point: { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t }, blob: wallOf(b.x - hx * back, b.z - hz * back, b.y - 0.4, a) }
    }
    if (near) return near
    // mm3d-62c (pedido do Alex): o muro não nasce do chão — fica NO AR, bem
    // onde a mira aponta. O comprimento de `dir` é a distância da mira (o
    // aparelho manda boca → ponto mirado); bateu em algo antes, fica ali.
    const L = Math.max(1.6, Math.min(T.wallReach, Math.hypot(dir.x, dir.y, dir.z)))
    let cx = o.x + d.x * L
    let cy = o.y + d.y * L
    let cz = o.z + d.z * L
    let y0                = null
    // só conta o que a arma bate PERTO do ponto mirado (a superfície que a mira
    // viu); algo no meio do caminho da arma não desvia o muro (mm3d-62d)
    if (hit && hit.t >= L - 0.6 && hit.t <= L + 0.5) {
      if (hit.normal.y > 0.5) {
        // mirou um chão: em pé em cima dele
        cx = hit.point.x
        cz = hit.point.z
        y0 = hit.point.y
      } else {
        // mirou um lado (ilha, outro muro): encostado, do lado de quem atirou
        const back = T.wallT / 2 + 0.05
        cx = hit.point.x + hit.normal.x * back
        cy = hit.point.y
        cz = hit.point.z + hit.normal.z * back
      }
    }
    // nunca em cima de quem atira (senão empurra o próprio dono)
    const min = T.bodyR + T.wallT / 2 + 0.35
    const ox = cx - s.x
    const oz = cz - s.z
    const along = ox * hx + oz * hz
    if (along < min) {
      cx += hx * (min - along)
      cz += hz * (min - along)
    }
    return { kind: "blob", blob: wallOf(cx, cz, y0 ?? cy - T.wallH / 2, a) }
  }

  if (c === PAINT.STEP) {
    if (!s.ground) {
      // Embaixo do pé: apoia no chão de baixo se estiver perto; senão flutua
      // logo abaixo da sola (é assim que se sobe empilhando).
      const below = supportAt(world.solids, s.x, s.z, s.y + 0.05, 0.05)
      const y0 = below > s.y - T.stepH - 0.02 ? below : s.y - T.stepH - 0.02
      return { kind: "blob", blob: blobOf(c, s.x, s.z, y0, yaw) }
    }
    const hit = raycast(world.solids, o, d, T.range[PAINT.STEP])
    if (hit && hit.normal.y > 0.5 && Math.hypot(hit.point.x - s.x, hit.point.z - s.z) > T.stepR + T.bodyR * 0.6) {
      return { kind: "blob", blob: blobOf(c, hit.point.x, hit.point.z, hit.point.y, yaw) }
    }
    // Logo à frente, no chão em que está.
    const fx = s.x + Math.sin(s.facing) * 1.6
    const fz = s.z + Math.cos(s.facing) * 1.6
    const floor = supportAt(world.solids, fx, fz, s.y + 0.3, 0.05)
    return { kind: "blob", blob: blobOf(c, fx, fz, floor > s.y - 1.5 ? floor : s.gy, yaw) }
  }

  // PONTE
  const hit = raycast(world.solids, o, d, T.range[PAINT.BRIDGE])
  if (hit && hit.normal.y > 0.5 && Math.hypot(hit.point.x - s.x, hit.point.z - s.z) <= T.bridgeReach) {
    return { kind: "blob", blob: blobOf(c, hit.point.x, hit.point.z, hit.point.y - T.bridgeH * 0.5, yaw) }
  }
  // Crescer: a borda na direção da mira, na altura do pé (no ar também: pulou, a ponte sai lá em cima).
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
  const footY = s.y
  for (let k = 0.6; k <= T.bridgeReach; k += 0.35) {
    const px = s.x + hx * k
    const pz = s.z + hz * k
    const sup = supportAt(world.solids, px, pz, footY + 0.3, 0.02)
    if (sup < footY - 0.6) {
      const ahead = k + T.bridgeR * 0.55
      return { kind: "blob", blob: blobOf(c, s.x + hx * ahead, s.z + hz * ahead, footY - T.bridgeH, yaw) }
    }
  }
  return { kind: "miss" }
}

/** Tiro conta como mancha nova em `solids` (cilindro, ou muro girado, com id, cor e time). */
function blobSolid(b         , id        , team        )            {
  // mm3d-62c: tudo caixa girada — o muro em pé (fino), ponte e cama elástica deitadas (quadradas)
  const hz = b.c === PAINT.WALL ? TUNING.wallT / 2 : b.r
  return { k: 2, x: b.x, z: b.z, y0: b.y0, y1: b.y1, hx: b.r, hz, a: b.a ?? 0, b: id, c: b.c, team }
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
// O ESTADO do jogo (não o movimento): munição, cápsulas, sangue, nocaute,
// tinta no mundo, gatinhos, portal de cada time, chefão, tempo e resultado.
//
// mm3d-38 (pedido do Alex): sangue 0–100 no lugar dos corações; nocaute por
// outro jogador passa os gatinhos para quem derrubou; cair nas nuvens devolve
// os gatinhos ao mapa; na ilha do chefão não se perde gatinho nem há dano
// entre jogadores — lá só o chefão bate (ele anda, dá patada e tapa no chão).
// A sala (PaintRoom) roda esta classe e é a autoridade; o treino sem sala
// roda a mesma no aparelho. Quem usa: `pose()` com o que o aparelho diz,
// `fire()`/`punch()` nos botões, `tick(dt)` no relógio e `drain()` para os
// acontecimentos (o que aparece/some, quem levou dano, quem pegou o quê).
//
// O movimento é do aparelho; `pose()` só recusa o impossível (velocidade
// acima do que soco + corrida explicam) e devolve "volte para onde estava".
// Depois de um renascimento a época sobe: pose de época velha é ignorada (é
// do caminho de antes do teleporte).
//
// mm3d-62 (pedido do Alex): o muro virou gelatina TURQUESA que empurra quem
// bate; o tiro dele num adversário o joga longe (na ilha do guardião também).
// Perder para o guardião (nocaute dele ou cair da ilha dele) tira a pessoa da
// partida; ninguém mais de pé = fim ("wiped").
//
// mm3d-46: quarta cor, o MURO — começa sem munição, o ícone da Freelandoo
// (cápsula da cor 3) dá 10; o tiro preto do outro time derruba o muro no
// terceiro acerto. O mapa sai do modo (2×2 e 3×3 com mais gatinhos).

/** O chefão (a sala decide; o aparelho só desenha). `at` = s de partida em que o ato começou. */
                            
           
           
                
              
            
                                                            
                
                                  
                 
                                     
              
                                                  
               
                 
                     
 

/** Ângulo `a` virado para `b` pelo caminho curto, no máximo `max`. */
function turnToward(a        , b        , max        ) {
  let d = b - a
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return a + Math.max(-max, Math.min(max, d))
}

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
  /** muro → tiros pretos que já levou. */
           wallHits = new Map                ()
           teamCats                   = [0, 0]
           portalOpen                     = [false, false]
  bossHp         = TUNING.bossHp
           boss           
  result                     = null
          events               = []
          blobSeq = 1
          solidsCache                 = null
          poseAt = new Map                ()

  constructor(mode           , seats                                               , map           = buildPaintMap(mode)) {
    this.map = map
    this.mode = mode
    this.time = -TUNING.countdown
    this.boss = {
      x: map.boss.x,
      z: map.boss.z,
      facing: Math.PI,
      act: "idle",
      at: 0,
      target: -1,
      struck: false,
      next: 0,
      count: 0,
      roared: false,
      roaredHalf: false,
    }
    const teams = modeTeams(mode)
    for (const s of seats) {
      const team = Math.min(s.team, teams - 1)
      const sp = spawnPoint(map, team, s.sit, false)
      this.players.set(s.slot, {
        slot: s.slot,
        team,
        sit: s.sit,
        hp: TUNING.hpMax,
        ammo: [TUNING.ammoStart, TUNING.ammoStart, TUNING.ammoStart, TUNING.wallStart],
        cats: 0,
        catIds: [],
        dmg: 0,
        ko: 0,
        shield: 0,
        inBoss: false,
        out: false,
        epoch: 0,
        pose: { x: sp.x, y: sp.y, z: sp.z, facing: sp.facing, ground: true, gy: sp.y, e: 0 },
        nextFire: [0, 0, 0, 0],
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
    return { x: this.boss.x, y: this.map.boss.y, z: this.boss.z, r: TUNING.bossR, h: TUNING.bossH }
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
    return this.phase === "play" && !p.ko && !p.out
  }

  /** Corpos alvo (de pé, na arena). Na ilha do chefão jogador não atinge jogador. */
          bodies(inBoss         )                   {
    const out                   = []
    if (inBoss) return out
    for (const p of this.players.values()) {
      if (p.ko || p.out || p.inBoss !== inBoss || !p.online) continue
      out.push({ slot: p.slot, team: p.team, x: p.pose.x, y: p.pose.y, z: p.pose.z })
    }
    return out
  }

  /** Quem o muro pode empurrar: de pé, no mesmo lugar (na ilha do guardião também — mm3d-62). */
          shoveBodies(inBoss         )                   {
    const out                   = []
    for (const p of this.players.values()) {
      if (p.ko || p.out || p.inBoss !== inBoss || !p.online) continue
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
    if (!p || !this.standing(p) || !(c === 0 || c === 1 || c === 2 || c === 3)) return this.deny(slot, q)
    if (![o.x, o.y, o.z, dir.x, dir.y, dir.z].every(Number.isFinite)) return this.deny(slot, q)
    const cost = TUNING.cost[c]
    // folga de 30 ms no ritmo (o relógio do aparelho não é o da sala)
    if (p.ammo[c] < cost || this.time + 0.03 < p.nextFire[c]) return this.deny(slot, q)
    const m = muzzleOf(p.pose, p.pose.facing)
    if (Math.hypot(o.x - m.x, o.y - m.y, o.z - m.z) > MUZZLE_SLACK) return this.deny(slot, q)
    p.ammo[c] -= cost
    p.nextFire[c] = Math.max(p.nextFire[c], this.time) + 1 / TUNING.fireRate[c]
    const res = resolveShot(
      { solids: this.solids(), bodies: c === PAINT.WALL ? this.shoveBodies(p.inBoss) : this.bodies(p.inBoss), boss: p.inBoss && this.bossAlive() ? this.bossBody() : null },
      { slot, team: p.team, x: p.pose.x, y: p.pose.y, z: p.pose.z, ground: p.pose.ground, gy: p.pose.gy, facing: p.pose.facing },
      c,
      o,
      dir,
    )
    let to       = { x: o.x + dir.x * 6, y: o.y + dir.y * 6, z: o.z + dir.z * 6 }
    if (res.kind === "blob" || res.kind === "shove") {
      const id = this.blobSeq++
      const solid = blobSolid(res.blob, id, p.team)
      this.blobs.set(id, { id, owner: slot, team: p.team, born: this.time, solid, blob: res.blob })
      this.solidsCache = null
      p.blobs.push(id)
      while (p.blobs.length > TUNING.blobsPerPlayer) this.removeBlob(p.blobs[0])
      to = { x: res.blob.x, y: res.blob.y1, z: res.blob.z }
      this.emit({ type: "blob", id, owner: slot, team: p.team, blob: res.blob, q })
      if (res.kind === "shove") {
        to = res.point
        const l = Math.hypot(dir.x, dir.z) || 1
        this.shove(res.slot, dir.x / l, dir.z / l, slot)
      }
    } else {
      if (q) this.emit({ type: "deny", slot, q }) // não virou tinta: o aparelho apaga a prevista, se houver
      if (res.kind === "player") {
        to = res.point
        this.damage(res.slot, slot, "harm")
      } else if (res.kind === "boss") {
        to = res.point
        this.hitBoss(slot, TUNING.bossHarm, res.point)
      } else if (res.kind === "erase") {
        to = res.point
        const wall = this.blobs.get(res.blob)
        const hits = (this.wallHits.get(res.blob) ?? 0) + 1
        if (wall && wall.blob.c === PAINT.WALL && hits < TUNING.wallHits) {
          // o muro aguenta: só respinga (de frente para quem atirou)
          this.wallHits.set(res.blob, hits)
          const l = Math.hypot(dir.x, dir.z) || 1
          this.emit({ type: "splat", point: res.point, normal: { x: -dir.x / l, y: 0, z: -dir.z / l } })
        } else this.removeBlob(res.blob)
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
    if (p.inBoss && this.bossAlive() && punchReachesBoss(a, this.bossBody())) {
      // o clarão nasce na pele do chefão, do lado de quem bateu
      const b = this.boss
      const dx = p.pose.x - b.x
      const dz = p.pose.z - b.z
      const d = Math.hypot(dx, dz) || 1
      this.hitBoss(slot, TUNING.bossPunch, { x: b.x + (dx / d) * TUNING.bossR, y: p.pose.y + 1.3, z: b.z + (dz / d) * TUNING.bossR })
    }
  }

          damage(slot        , by        , how                  , kx = 0, kz = 0) {
    const v = this.players.get(slot)
    const a = this.players.get(by)
    if (!v || !a || v.ko || v.inBoss || this.time < v.shield) return
    if (how === "harm") {
      const dx = v.pose.x - a.pose.x
      const dz = v.pose.z - a.pose.z
      const d = Math.hypot(dx, dz) || 1
      kx = (dx / d) * TUNING.harmKnock
      kz = (dz / d) * TUNING.harmKnock
    }
    v.hp = Math.max(0, v.hp - (how === "punch" ? TUNING.punchDmg : TUNING.harmDmg))
    this.emit({ type: "hit", slot, by, hp: v.hp, kx, ky: how === "punch" ? TUNING.punchLift : TUNING.harmLift, kz, how })
    if (v.hp === 0) {
      v.ko = this.time + TUNING.koTime
      this.emit({ type: "ko", slot, by })
      this.steal(v, a)
    }
  }

  /**
   * O muro pegou `slot` em cheio (mm3d-62): sem dano, voa na direção do tiro.
   * Vale na ilha do guardião também — jogar o outro para cima dele é o jogo.
   */
          shove(slot        , ux        , uz        , by        ) {
    const v = this.players.get(slot)
    if (!v || v.ko || v.out) return
    const T = TUNING
    this.emit({ type: "hit", slot, by, hp: v.hp, kx: ux * T.wallShove, ky: T.wallShoveLift, kz: uz * T.wallShove, how: "wall" })
  }

  /** Golpe do chefão: lá em cima ninguém perde gatinho; nocaute dele = fora da partida (mm3d-62). */
          bossDamage(v             , dmg        , kx        , ky        , kz        ) {
    if (v.ko || v.out || this.time < v.shield) return
    v.hp = Math.max(0, v.hp - dmg)
    this.emit({ type: "hit", slot: v.slot, by: -1, hp: v.hp, kx, ky, kz, how: "boss" })
    if (v.hp === 0) {
      v.ko = this.time + TUNING.koTime
      this.emit({ type: "ko", slot: v.slot, by: -1 })
      this.eliminate(v, "boss")
    }
  }

  /** Perdeu para o guardião: fora; se não sobrou ninguém de pé, a partida acaba. */
          eliminate(v             , why                 ) {
    if (v.out) return
    v.out = true
    this.emit({ type: "out", slot: v.slot, why })
    for (const p of this.players.values()) if (p.online && !p.out) return
    this.finish("wiped")
  }

  /**
   * Quem derrubou fica com os gatinhos de quem caiu (pedido do Alex, como no
   * Cat Demon). Muda o placar dos dois times; o portal de quem ganhou pode abrir.
   */
          steal(v             , a             ) {
    const n = v.cats
    if (n <= 0 || v.slot === a.slot) return
    v.cats = 0
    a.cats += n
    a.catIds.push(...v.catIds)
    for (const id of v.catIds) this.catsTaken.set(id, a.team)
    v.catIds = []
    this.teamCats[v.team] = Math.max(0, this.teamCats[v.team] - n)
    this.teamCats[a.team] += n
    this.emit({ type: "steal", from: v.slot, to: a.slot, n })
    if (!this.portalOpen[a.team] && this.teamCats[a.team] >= TUNING.catsToPortal) {
      this.portalOpen[a.team] = true
      this.emit({ type: "portal", team: a.team })
    }
  }

          hitBoss(slot        , dmg        , at      ) {
    const p = this.players.get(slot)
    if (!p || !this.bossAlive()) return
    const real = Math.min(dmg, this.bossHp)
    this.bossHp -= real
    p.dmg += real
    const r2 = (v        ) => Math.round(v * 100) / 100
    this.emit({ type: "boss", slot, dmg: real, hp: this.bossHp, x: r2(at.x), y: r2(at.y), z: r2(at.z) })
    if (!this.bossAlive()) this.finish("boss")
  }

  /** Caiu nas nuvens: os gatinhos dele voltam ao mapa (o portal que já abriu fica aberto). */
          dropCats(p             ) {
    if (p.inBoss || p.cats <= 0) return
    this.emit({ type: "drop", slot: p.slot, n: p.cats })
    this.teamCats[p.team] = Math.max(0, this.teamCats[p.team] - p.cats)
    for (const id of p.catIds) {
      this.catsTaken.delete(id)
      this.emit({ type: "catBack", id })
    }
    p.cats = 0
    p.catIds = []
  }

  // ── chefão ────────────────────────────────────────────────────────────────

          bossStart(act         , target        ) {
    const b = this.boss
    b.act = act
    b.at = this.time
    b.struck = false
    if (act === "swipe" || act === "slam" || act === "roar") this.emit({ type: "bossAct", act, slot: target })
  }

  /** Quem está lá em cima e pode apanhar. */
          bossVictims() {
    const out                = []
    for (const p of this.players.values()) if (p.inBoss && !p.ko && !p.out && p.online) out.push(p)
    return out
  }

          bossStrike(victims               ) {
    const T = TUNING
    const b = this.boss
    const by = this.map.boss.y
    const fx = Math.sin(b.facing)
    const fz = Math.cos(b.facing)
    for (const v of victims) {
      const q = v.pose
      if (q.y > by + 3.2 || q.y < by - 1) continue // pulou por cima / já caiu da ilha
      if (b.act === "swipe") {
        const dx = q.x - b.x
        const dz = q.z - b.z
        const d = Math.hypot(dx, dz)
        if (d > T.bossSwipe.reach + T.bossR * 0.5) continue
        if (d > 0.3 && (dx * fx + dz * fz) / d < T.bossSwipe.cos) continue
        const ux = d > 0.3 ? dx / d : fx
        const uz = d > 0.3 ? dz / d : fz
        this.bossDamage(v, T.bossSwipe.dmg, ux * T.bossSwipe.knock, T.bossSwipe.lift, uz * T.bossSwipe.knock)
      } else {
        // tapa no chão: círculo à frente; quem está no ar escapa do tremor
        const dx = q.x - (b.x + fx * T.bossSlam.ahead)
        const dz = q.z - (b.z + fz * T.bossSlam.ahead)
        const d = Math.hypot(dx, dz)
        if (d > T.bossSlam.r || !q.ground) continue
        const ux = d > 0.3 ? dx / d : fx
        const uz = d > 0.3 ? dz / d : fz
        const k = 1 - (d / T.bossSlam.r) * 0.4
        this.bossDamage(v, Math.round(T.bossSlam.dmg * k), ux * T.bossSlam.knock, T.bossSlam.lift, uz * T.bossSlam.knock)
      }
    }
  }

          bossTick(dt        ) {
    const T = TUNING
    const b = this.boss
    const home = this.map.boss
    const victims = this.bossVictims()
    // golpe/rugido em andamento: acerta no tempo certo e termina
    if (b.act === "swipe" || b.act === "slam" || b.act === "roar") {
      const since = this.time - b.at
      const spec = b.act === "swipe" ? T.bossSwipe : b.act === "slam" ? T.bossSlam : null
      if (spec && !b.struck && since >= spec.hit) {
        b.struck = true
        this.bossStrike(victims)
      }
      if (since < (spec ? spec.dur : T.bossRoar.dur)) return
      this.bossStart("idle", b.target)
      b.next = this.time + T.bossRest
    }
    // de olho em quem está mais perto
    let tgt                     = null
    let best = Infinity
    for (const v of victims) {
      const d = Math.hypot(v.pose.x - b.x, v.pose.z - b.z)
      if (d < best) {
        best = d
        tgt = v
      }
    }
    b.target = tgt ? tgt.slot : -1
    let goX = home.x
    let goZ = home.z
    if (tgt) {
      // ruge quando o primeiro chega e quando perde metade da vida
      if (!b.roared || (!b.roaredHalf && this.bossHp <= T.bossHp / 2)) {
        if (b.roared) b.roaredHalf = true
        b.roared = true
        b.facing = Math.atan2(tgt.pose.x - b.x, tgt.pose.z - b.z)
        this.bossStart("roar", tgt.slot)
        return
      }
      goX = tgt.pose.x
      goZ = tgt.pose.z
    }
    const dx = goX - b.x
    const dz = goZ - b.z
    const d = Math.hypot(dx, dz)
    const want = Math.atan2(dx, dz)
    if (d > 0.05) b.facing = turnToward(b.facing, want, T.bossTurn * dt)
    let off = Math.abs(want - b.facing) % (Math.PI * 2)
    if (off > Math.PI) off = Math.PI * 2 - off
    if (tgt && this.time >= b.next && off < 0.5) {
      // o terceiro golpe é tapa no chão; também se dois estão juntos na frente dele
      const fx = Math.sin(b.facing)
      const fz = Math.cos(b.facing)
      const near = victims.filter((v) => Math.hypot(v.pose.x - (b.x + fx * T.bossSlam.ahead), v.pose.z - (b.z + fz * T.bossSlam.ahead)) < T.bossSlam.r).length
      const slam = near >= 2 || b.count % 3 === 2
      if (slam ? near >= 1 : d <= T.bossSwipe.reach) {
        b.count++
        this.bossStart(slam ? "slam" : "swipe", tgt.slot)
        return
      }
    }
    // anda até a vítima (ou volta para o meio), sem sair da ilha
    const stop = tgt ? T.bossSwipe.reach - 1.2 : 0.3
    let moved = false
    if (d > stop && off < 1.2) {
      const step = Math.min(T.bossWalk * dt, d - stop)
      let nx = b.x + Math.sin(b.facing) * step
      let nz = b.z + Math.cos(b.facing) * step
      const hx = nx - home.x
      const hz = nz - home.z
      const hd = Math.hypot(hx, hz)
      if (hd > T.bossLeash) {
        nx = home.x + (hx / hd) * T.bossLeash
        nz = home.z + (hz / hd) * T.bossLeash
      }
      moved = Math.hypot(nx - b.x, nz - b.z) > 1e-4
      b.x = nx
      b.z = nz
    }
    const act          = moved || (d > stop && off >= 1.2) ? "walk" : "idle"
    if (b.act !== act) this.bossStart(act, b.target)
  }

          removeBlob(id        ) {
    const b = this.blobs.get(id)
    if (!b) return
    this.blobs.delete(id)
    this.wallHits.delete(id)
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
    p.hp = TUNING.hpMax
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
      if (p.out) continue
      if (p.ko) {
        if (this.time >= p.ko) this.respawn(p)
        continue
      }
      const q = p.pose
      if (fellOut(q.y, p.inBoss)) {
        // caiu da ilha do guardião: perdeu para ele (mm3d-62)
        if (p.inBoss) {
          this.eliminate(p, "fell")
          if (this.result) return // era o último de pé: acabou
          continue
        }
        this.dropCats(p)
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
          p.catIds.push(c.id)
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
          continue
        }
      }
      // cápsulas
      for (const cap of this.map.capsules) {
        if (this.capsuleBack.has(cap.id) || p.ammo[cap.c] >= ammoCap(cap.c)) continue
        if (Math.abs(q.y - cap.y) > 1.6 || Math.hypot(q.x - cap.x, q.z - cap.z) > T.capsuleR) continue
        p.ammo[cap.c] = Math.min(ammoCap(cap.c), p.ammo[cap.c] + capsuleGive(cap.c))
        this.capsuleBack.set(cap.id, this.time + capsuleRespawn(cap.c))
        this.emit({ type: "capsule", id: cap.id, slot: p.slot, c: cap.c })
      }
    }
    if (this.bossAlive()) this.bossTick(dt)
    if (this.time >= T.matchTime) this.finish("time")
  }

  finish(reason                           ) {
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

/** Quanto a cápsula da cor dá (o ícone da Freelandoo dá muros). */
function capsuleGive(c            ) {
  return c === PAINT.WALL ? TUNING.wallGive : TUNING.capsuleGive
}

/** Em quanto tempo a cápsula da cor volta (s). */
function capsuleRespawn(c            ) {
  return c === PAINT.WALL ? TUNING.logoRespawn : TUNING.capsuleRespawn
}

/** Atalho para quem só precisa saber se a pose está fora (cliente). */
const PAINT_FIRE_COLORS                        = [PAINT.BRIDGE, PAINT.HARM, PAINT.STEP, PAINT.WALL]

module.exports = { PAINT, PAINT_COLORS, TUNING, PAINT_MODES, modeTeams, modeCapacity, ammoCap, polyCenter, polySolid, COLLIDER_DEPTH, BOSS, round, hash01, bossIsland, staticSolids, buildCidadeMap, fellOut, spawnPoint, JARDIM, FABRICA, FLORESTA, TEMPLO, FORJA, PAINT_MAPS, paintMapId, paintMapVersion, buildPaintMap, tallyPaintVotes, PAINT_BOSS_AT, FOOT_R, supportAt, supportIndex, pushOut, ceilingAt, raycast, rayBody, newBody, stepBody, knockBody, liftOnto, muzzleOf, resolveShot, blobSolid, punchTargets, punchReachesBoss, PaintMatch, capsuleGive, capsuleRespawn, PAINT_FIRE_COLORS };
