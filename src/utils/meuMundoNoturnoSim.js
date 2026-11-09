// GERADO por scripts/build-noturno-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/noturno/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── sim/track.ts ─────────────────────────────────────────────────────────────
// features/meu-mundo/noturno/sim/track.ts — ROLÊ NOTURNO 2.0: o TRAÇADO da pista.
//
// A regra (run.ts) continua numa pista reta de coordenadas próprias: x = lado
// (as três faixas), y = altura acima do piso, z = distância percorrida. Este
// módulo dá a essa pista uma FORMA no mundo — curvas, S, subidas, descidas,
// inclinação lateral (banking) e loops de 360° — sem mudar uma vírgula da
// regra: quem está em (x, y, z) na regra fica, no mundo, em
//
//     P(z) + R(z)·x + U(z)·y
//
// onde P é a linha do meio, T a direção da corrida, U o "cima" da pista e
// R = U × T o lado direito. Tudo por distância de verdade (comprimento de
// arco), em amostras de DS metros.
//
//  - O traçado é uma lista de TRECHOS gerada pela semente e pela fase (a
//    mesma em todos os aparelhos e no computador da sala). A fase "classica"
//    não tem traçado: é a rua reta de sempre, idêntica.
//  - O "cima" fora dos loops é o vertical do mundo projetado (sem flip: a
//    pista nunca fica em pé fora do loop) girado pelo banking, que segue a
//    curvatura (contínuo). Dentro do loop ele é TRANSPORTADO amostra a
//    amostra (acompanha a volta inteira, de cabeça para baixo no alto) e a
//    pequena torção que sobra no fim (o loop sai deslocado para o lado, para
//    a saída não bater na entrada) é distribuída pelo trecho.
//  - Loop é ZONA TRANQUILA: o gerador da regra não põe obstáculo do começo
//    da placa até a saída — só uma fileira de moedas (o "loop guiado" do
//    prompt; as faixas continuam valendo).
//
// Sem Babylon: roda no node (servidor, testes) e no jogo. O backend usa a
// cópia GERADA (scripts/build-noturno-sim.js) para o computador saber onde
// ficam os loops.

                                                                                           
/** Ordem do menu (a Clássica fica por último: é a rua de antes). */
const RUN_PHASES                      = ["floresta", "canion", "orbital", "forja", "fabrica", "classica"]

function isRunPhase(p         )                {
  return typeof p === "string" && (RUN_PHASES                     ).includes(p)
}

                                                              
/** Para o cenário (a regra não lê): ponte, túnel, beira de penhasco, portal de descida… */
                                                                                                            

                           
               
                                                      
            
             
                                                                               
              
                                              
               
                                                              
              
             
 

                 
           
                                
                                 
                                  
 

/** Como a pista de cada fase se comporta (formato; a regra do jogo não muda entre fases). */
                             
                                                    
            
              
              
                 
              
               
                                  
             
                                           
               
                                                                       
                 
               
                                                    
                   
                                      
                                                                   
                 
                   
                                                             
                                        
                    
                                                           
                                              
                                                                                         
                
 

const R = (w        , len                  , turn                   = [0, 0], climb                   = [0, 0])        => ({ w, len, turn, climb })

const TRACK_RULES                                                    = {
  floresta: {
    y0: 0, yMin: -48, yMax: 30,
    straight: R(0.8, [50, 110]),
    curve: R(1.6, [110, 190], [0.45, 1.0], [-6, 6]),
    scurve: R(1.1, [150, 230], [0.35, 0.6]),
    hill: R(0.7, [90, 150], [0, 0], [5, 12]),
    spiral: R(0.55, [200, 260], [1.3, 1.8], [-22, -14]),
    bankMax: 0.36, bankK: 20,
    loopFirst: 680, loopEvery: [1500, 2100], loopLen: 96, loopShift: 10,
    portalEvery: [1100, 1500], portalDrop: 16,
    tags: [["", 3], ["bridge", 1.4], ["tunnel", 1.2], ["recovery", 0.4]],
    yawMax: 0.95,
  },
  canion: {
    y0: 12, yMin: -30, yMax: 55,
    straight: R(0.7, [50, 100]),
    curve: R(1.5, [100, 180], [0.4, 0.95], [-8, 8]),
    scurve: R(1.2, [160, 240], [0.3, 0.55]),
    hill: R(0.9, [90, 160], [0, 0], [8, 16]),
    spiral: R(0.3, [200, 260], [1.1, 1.5], [-18, -10]),
    bankMax: 0.42, bankK: 26,
    loopFirst: 620, loopEvery: [1200, 1700], loopLen: 104, loopShift: 10,
    portalEvery: [1000, 1400], portalDrop: 18,
    tags: [["", 2.4], ["edge", 1.6], ["bridge", 1.6], ["tunnel", 0.8]],
    yawMax: 1.0,
  },
  orbital: {
    y0: 20, yMin: -50, yMax: 45,
    straight: R(0.8, [60, 120]),
    curve: R(1.4, [140, 230], [0.5, 1.15], [-6, 6]),
    scurve: R(0.9, [180, 260], [0.3, 0.55]),
    hill: R(0.6, [100, 160], [0, 0], [6, 12]),
    spiral: R(0.35, [220, 280], [1.2, 1.7], [-20, -12]),
    bankMax: 0.5, bankK: 32,
    loopFirst: 600, loopEvery: [1100, 1500], loopLen: 110, loopShift: 10,
    portalEvery: [900, 1300], portalDrop: 20,
    tags: [["", 2], ["glass", 2.2], ["bridge", 1], ["tunnel", 1]],
    yawMax: 1.0,
  },
  forja: {
    y0: 8, yMin: -12, yMax: 34,
    straight: R(0.9, [50, 110]),
    curve: R(1.4, [100, 170], [0.4, 0.9], [-5, 5]),
    scurve: R(0.9, [150, 220], [0.3, 0.5]),
    hill: R(1.0, [90, 140], [0, 0], [6, 11]),
    spiral: R(0.25, [200, 250], [1.0, 1.4], [-14, -8]),
    bankMax: 0.34, bankK: 20,
    loopFirst: 700, loopEvery: [1400, 1900], loopLen: 100, loopShift: 10,
    portalEvery: [1000, 1400], portalDrop: 12,
    tags: [["", 2.2], ["bridge", 1.6], ["tunnel", 1.4]],
    yawMax: 0.9,
  },
  fabrica: {
    y0: 6, yMin: -20, yMax: 30,
    straight: R(1.6, [70, 140]),
    curve: R(1.2, [110, 170], [0.45, 0.9], [-4, 4]),
    scurve: R(0.6, [150, 210], [0.3, 0.5]),
    hill: R(1.0, [90, 150], [0, 0], [6, 12]),
    spiral: R(0.2, [200, 240], [1.0, 1.3], [-12, -8]),
    bankMax: 0.3, bankK: 18,
    loopFirst: 650, loopEvery: [1300, 1800], loopLen: 100, loopShift: 10,
    portalEvery: [1000, 1400], portalDrop: 14,
    tags: [["", 2], ["tunnel", 1.8], ["bridge", 1.2]],
    yawMax: 0.85,
  },
}

/** Reta inicial (m): a largada e o começo da corrida ficam retos em toda fase. */
const TRACK_LEAD = 150
/** Zona tranquila: antes da entrada do loop (placa, alinhar) e depois da saída. */
const QUIET_BEFORE = 45
const QUIET_AFTER = 25
/** Passo das amostras (m). */
const DS = 0.5

const TAU = Math.PI * 2
/** Suave nos dois lados (derivada zero nas pontas: curvatura contínua). */
const ease = (t        ) => t * t * (3 - 2 * t)
const dease = (t        ) => 6 * t * (1 - t)
const clamp = (v        , a        , b        ) => (v < a ? a : v > b ? b : v)

function trackRng(seed        ) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Os TRECHOS da pista (só o plano: barato, roda também no servidor). Cresce
 * sob demanda (`ensure`); trechos que ficaram muito para trás são soltos.
 */
class TrackPlan {
           phase          
           rules                   
  segs             = []
          end = 0
                   rnd              
  /** Estado do planejador (rumo e altura acumulados, para manter a pista nos limites). */
          yaw = 0
          y = 0
          nextLoop = 0
          nextPortal = 0

  constructor(phase          , seed        ) {
    this.phase = phase
    this.rules = phase === "classica" ? null : TRACK_RULES[phase]
    this.rnd = trackRng((seed ^ 0x5bd1e995) >>> 0 || 1)
    if (this.rules) {
      this.y = this.rules.y0
      this.nextLoop = this.rules.loopFirst
      this.nextPortal = this.rules.loopFirst + this.between(this.rules.portalEvery) * 0.5
    }
    this.push({ kind: "straight", s0: 0, len: TRACK_LEAD, turn: 0, climb: 0, side: 1, tag: "recovery" })
  }

  get length() {
    return this.end
  }

          between(r                           ) {
    return r[0] + (r[1] - r[0]) * this.rnd()
  }

          push(s          ) {
    s.s0 = this.end
    this.segs.push(s)
    this.end += s.len
    if (s.kind === "curve") this.yaw += s.turn
    this.y += s.climb
  }

  /** Gera trechos até cobrir `s`. */
  ensure(s        ) {
    const r = this.rules
    if (!r) {
      if (this.end < s) this.push({ kind: "straight", s0: 0, len: Math.max(500, s - this.end + 500), turn: 0, climb: 0, side: 1, tag: "" })
      return
    }
    while (this.end < s) {
      if (this.end >= this.nextLoop) {
        // o momento de destaque: placa e reta de alinhamento, o loop, reta de recuperação
        this.push({ kind: "straight", s0: 0, len: QUIET_BEFORE, turn: 0, climb: 0, side: 1, tag: "hero" })
        this.push({ kind: "loop", s0: 0, len: r.loopLen, turn: 0, climb: 0, side: this.rnd() < 0.5 ? -1 : 1, tag: "hero" })
        this.push({ kind: "straight", s0: 0, len: QUIET_AFTER + 30, turn: 0, climb: 0, side: 1, tag: "recovery" })
        this.nextLoop = this.end + this.between(r.loopEvery)
        continue
      }
      if (this.end >= this.nextPortal && this.y - r.portalDrop > r.yMin) {
        // portal de descida: o portal na boca e uma descida reta e suave (sem teletransporte)
        this.push({ kind: "straight", s0: 0, len: 30, turn: 0, climb: 0, side: 1, tag: "portal" })
        this.push({ kind: "straight", s0: 0, len: 120, turn: 0, climb: -r.portalDrop, side: 1, tag: "portal" })
        this.nextPortal = this.end + this.between(r.portalEvery)
        continue
      }
      this.pickSegment(r)
    }
  }

          pickSegment(r            ) {
    const opts                     = [
      ["straight", r.straight.w],
      ["curve", r.curve.w],
      ["scurve", r.scurve.w],
      ["hill", r.hill.w],
      ["spiral", this.y - 10 > r.yMin ? r.spiral.w : 0],
    ]
    let total = 0
    for (const [, w] of opts) total += w
    let pick = this.rnd() * total
    let kind = "straight"
    for (const [k, w] of opts) {
      pick -= w
      if (pick <= 0) {
        kind = k
        break
      }
    }
    const tag = this.tag(r)
    // lado da curva: volta para o rumo médio quando já se afastou dele
    const sideTurn = () => (Math.abs(this.yaw) > r.yawMax * 0.45 ? -Math.sign(this.yaw) : this.rnd() < 0.5 ? -1 : 1)
    const fitTurn = (want        ) => clamp(this.yaw + want, -r.yawMax, r.yawMax) - this.yaw
    const fitClimb = (want        ) => clamp(this.y + want, r.yMin, r.yMax) - this.y
    switch (kind) {
      case "curve": {
        const len = this.between(r.curve.len)
        const turn = fitTurn(sideTurn() * this.between(r.curve.turn))
        const climb = fitClimb(this.between(r.curve.climb))
        if (Math.abs(turn) < 0.12) return this.push({ kind: "straight", s0: 0, len, turn: 0, climb, side: 1, tag })
        return this.push({ kind: "curve", s0: 0, len, turn, climb, side: 1, tag })
      }
      case "scurve": {
        const len = this.between(r.scurve.len)
        return this.push({ kind: "scurve", s0: 0, len, turn: (this.rnd() < 0.5 ? -1 : 1) * this.between(r.scurve.turn), climb: 0, side: 1, tag: tag === "tunnel" ? "bridge" : tag })
      }
      case "hill": {
        const len = this.between(r.hill.len)
        const up = this.y < (r.yMin + r.yMax) / 2 ? 1 : -1
        const climb = fitClimb((this.rnd() < 0.7 ? up : -up) * this.between(r.hill.climb))
        return this.push({ kind: "straight", s0: 0, len, turn: 0, climb, side: 1, tag })
      }
      case "spiral": {
        const len = this.between(r.spiral.len)
        // espiral de verdade gira mais do que o rumo deixa: ela gira e o trecho seguinte desfaz
        const turn = sideTurn() * this.between(r.spiral.turn)
        const climb = fitClimb(this.between(r.spiral.climb))
        this.push({ kind: "curve", s0: 0, len, turn, climb, side: 1, tag: "spiral" })
        const back = clamp(this.yaw, -r.yawMax, r.yawMax) - this.yaw
        if (Math.abs(back) > 0.05) this.push({ kind: "curve", s0: 0, len: Math.max(110, Math.abs(back) * 120), turn: back, climb: 0, side: 1, tag: "" })
        return
      }
      default:
        return this.push({ kind: "straight", s0: 0, len: this.between(r.straight.len), turn: 0, climb: 0, side: 1, tag })
    }
  }

          tag(r            )         {
    let total = 0
    for (const [, w] of r.tags) total += w
    let pick = this.rnd() * total
    for (const [t, w] of r.tags) {
      pick -= w
      if (pick <= 0) return t
    }
    return ""
  }

  /** O trecho que contém `s` (cresce o plano se precisar). */
  segAt(s        )           {
    this.ensure(s + 1)
    let lo = 0
    let hi = this.segs.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.segs[mid].s0 <= s) lo = mid
      else hi = mid - 1
    }
    return this.segs[lo]
  }

  /**
   * A primeira zona tranquila (loop com a sua margem) que toca [z0, z1], ou
   * null. A regra usa para não pôr obstáculo nela.
   */
  quiet(z0        , z1        )                                      {
    if (!this.rules) return null
    this.ensure(z1 + 200)
    for (const s of this.segs) {
      if (s.kind !== "loop") continue
      const from = s.s0 - QUIET_BEFORE
      const to = s.s0 + s.len + QUIET_AFTER
      if (to <= z0) continue
      if (from >= z1) return null
      return { from, to }
    }
    return null
  }

  /** Solta os trechos que acabaram antes de `s` (fica sempre um). */
  forget(s        ) {
    let n = 0
    while (n < this.segs.length - 1 && this.segs[n].s0 + this.segs[n].len < s) n++
    if (n > 0) this.segs.splice(0, n)
  }
}

/** Um ponto da pista: posição, direção (T), cima (U) e lado direito (R = U × T). */
                             
            
            
            
            
            
            
            
            
            
            
            
            
                                                                       
              
 

function newFrame()             {
  return { px: 0, py: 0, pz: 0, tx: 0, ty: 0, tz: 1, ux: 0, uy: 1, uz: 0, rx: 1, ry: 0, rz: 0, bank: 0 }
}

/**
 * A GEOMETRIA da pista: amostras a cada DS metros com P, T, U e o banking.
 * Gerada sob demanda a partir do plano; amostras muito para trás são soltas.
 */
class TrackGeom {
           plan           
  /** Índice da 1ª amostra guardada (s = (base + i)·DS). */
          base = 0
          P           = []
          T           = []
          U           = []
          B           = []
  /** Estado do integrador: posição e rumo da próxima amostra. */
          pos = [0, 0, 0]
          yaw = 0
          segIndex = 0
          built = 0
          segCursor                  = null

  constructor(plan           ) {
    this.plan = plan
    this.pos[1] = plan.rules?.y0 ?? 0
  }

  /** Quantos metros já existem em amostras. */
  get extent() {
    return (this.base + this.P.length / 3 - 1) * DS
  }

  /** Garante amostras até `s`. */
  ensure(s        ) {
    while (this.extent < s + DS) this.buildNext()
  }

  /** Solta amostras antes de `s` (em blocos, para não mexer a cada quadro). */
  forget(s        ) {
    const keep = Math.floor(s / DS) - this.base
    if (keep < 4000) return
    const n = keep - 400
    this.P.splice(0, n * 3)
    this.T.splice(0, n * 3)
    this.U.splice(0, n * 3)
    this.B.splice(0, n)
    this.base += n
    this.plan.forget(s - 400)
    this.segIndex = Math.max(0, this.plan.segs.indexOf(this.segCursor            ))
  }

  /** Gera o próximo trecho inteiro em amostras. */
          buildNext() {
    const plan = this.plan
    // o próximo trecho depois do que já foi construído
    plan.ensure(this.built + 1)
    let seg                  = null
    for (let i = Math.max(0, this.segIndex - 1); i < plan.segs.length; i++) {
      if (plan.segs[i].s0 >= this.built - 1e-6) {
        seg = plan.segs[i]
        this.segIndex = i
        break
      }
    }
    if (!seg) {
      plan.ensure(this.built + 600)
      return
    }
    this.segCursor = seg
    const first = this.P.length === 0
    const n = Math.round(seg.len / DS)
    if (seg.kind === "loop") this.buildLoop(seg, n, first)
    else this.buildPlain(seg, n, first)
    this.built = seg.s0 + seg.len
  }

          emit(px        , py        , pz        , tx        , ty        , tz        , ux        , uy        , uz        , bank        ) {
    this.P.push(px, py, pz)
    this.T.push(tx, ty, tz)
    this.U.push(ux, uy, uz)
    this.B.push(bank)
  }

  /** Reta, curva, S, subida/descida: rumo e altura suaves, cima = vertical projetado + banking. */
          buildPlain(seg          , n        , first         ) {
    const rules = this.plan.rules
    const bankMax = rules?.bankMax ?? 0
    const bankK = rules?.bankK ?? 0
    const yaw0 = this.yaw
    const dir = (t        , out          ) => {
      let yaw = yaw0
      let yawRate = 0
      if (seg.kind === "curve") {
        yaw += seg.turn * ease(t)
        yawRate = (seg.turn * dease(t)) / seg.len
      } else if (seg.kind === "scurve") {
        if (t < 0.5) {
          yaw += seg.turn * ease(2 * t)
          yawRate = (seg.turn * dease(2 * t) * 2) / seg.len
        } else {
          yaw += seg.turn * (1 - ease(2 * t - 1))
          yawRate = (-seg.turn * dease(2 * t - 1) * 2) / seg.len
        }
      }
      const slope = clamp((seg.climb * dease(t)) / seg.len, -0.55, 0.55)
      const k = 1 / Math.sqrt(1 + slope * slope)
      out[0] = Math.sin(yaw) * k
      out[1] = slope * k
      out[2] = Math.cos(yaw) * k
      out[3] = clamp(bankK * yawRate, -bankMax, bankMax)
      out[4] = yaw
    }
    const d = [0, 0, 0, 0, 0]
    const m = [0, 0, 0, 0, 0]
    for (let i = first ? 0 : 1; i <= n; i++) {
      const t = i / n
      if (i > 0) {
        // passo pelo meio do intervalo (ponto médio): comprimento de arco certo
        dir((i - 0.5) / n, m)
        const ds = seg.len / n
        this.pos[0] += m[0] * ds
        this.pos[1] += m[1] * ds
        this.pos[2] += m[2] * ds
      }
      dir(t, d)
      const [ux, uy, uz] = upOf(d[0], d[1], d[2], d[3])
      this.emit(this.pos[0], this.pos[1], this.pos[2], d[0], d[1], d[2], ux, uy, uz, d[3])
      if (i === n) this.yaw = d[4]
    }
  }

  /**
   * Loop 360°: o ângulo de subida vai de 0 a 2π pela curva suave (entrada e
   * saída abertas, apertado no alto — a gota dos loops de verdade) e a pista
   * escorrega para o lado `shift` metros (a saída passa ao lado da entrada).
   * O cima é transportado (sem flip) e a torção que sobra vai sendo desfeita.
   */
          buildLoop(seg          , n        , first         ) {
    const shift = (this.plan.rules?.loopShift ?? 10) * seg.side
    const fx = Math.sin(this.yaw)
    const fz = Math.cos(this.yaw)
    // direita horizontal: U × T com U = (0,1,0) → (tz, 0, −tx)
    const rx = fz
    const rz = -fx
    const dir = (t        , out          ) => {
      const th = TAU * ease(t)
      const w = clamp((shift * dease(t)) / seg.len, -0.6, 0.6)
      const k = Math.sqrt(1 - w * w)
      const c = Math.cos(th) * k
      const s = Math.sin(th) * k
      out[0] = c * fx + w * rx
      out[1] = s
      out[2] = c * fz + w * rz
    }
    const pts           = []
    const tan           = []
    const ups           = []
    const d = [0, 0, 0]
    const m = [0, 0, 0]
    let ux = 0
    let uy = 1
    let uz = 0
    for (let i = 0; i <= n; i++) {
      if (i > 0) {
        dir((i - 0.5) / n, m)
        const ds = seg.len / n
        this.pos[0] += m[0] * ds
        this.pos[1] += m[1] * ds
        this.pos[2] += m[2] * ds
      }
      dir(i / n, d)
      // transporte: tira de U a componente na direção nova e normaliza
      const dot = ux * d[0] + uy * d[1] + uz * d[2]
      ux -= dot * d[0]
      uy -= dot * d[1]
      uz -= dot * d[2]
      const l = Math.hypot(ux, uy, uz) || 1
      ux /= l
      uy /= l
      uz /= l
      pts.push(this.pos[0], this.pos[1], this.pos[2])
      tan.push(d[0], d[1], d[2])
      ups.push(ux, uy, uz)
    }
    // a torção que sobrou no fim: ângulo do U transportado até o vertical projetado
    const e = n * 3
    const [gx, gy, gz] = upOf(tan[e], tan[e + 1], tan[e + 2], 0)
    const cx = ups[e + 1] * gz - ups[e + 2] * gy
    const cy = ups[e + 2] * gx - ups[e] * gz
    const cz = ups[e] * gy - ups[e + 1] * gx
    const phi = Math.atan2(cx * tan[e] + cy * tan[e + 1] + cz * tan[e + 2], ups[e] * gx + ups[e + 1] * gy + ups[e + 2] * gz)
    for (let i = first ? 0 : 1; i <= n; i++) {
      const j = i * 3
      const a = phi * ease(i / n)
      const tx = tan[j]
      const ty = tan[j + 1]
      const tz = tan[j + 2]
      const vx = ups[j]
      const vy = ups[j + 1]
      const vz = ups[j + 2]
      // Rodrigues em volta de T (U ⟂ T): U cos a + (T × U) sen a
      const ca = Math.cos(a)
      const sa = Math.sin(a)
      const qx = vx * ca + (ty * vz - tz * vy) * sa
      const qy = vy * ca + (tz * vx - tx * vz) * sa
      const qz = vz * ca + (tx * vy - ty * vx) * sa
      this.emit(pts[j], pts[j + 1], pts[j + 2], tx, ty, tz, qx, qy, qz, 0)
    }
  }

  /** O ponto da pista na distância `s` (interpolado entre as amostras). */
  frame(s        , out            )             {
    if (s > this.extent - DS) this.ensure(s + 60)
    const f = Math.max(0, s / DS - this.base)
    let i = Math.floor(f)
    const last = this.P.length / 3 - 1
    if (i >= last) i = last - 1
    const k = Math.min(1, f - i)
    const a = i * 3
    const b = a + 3
    const P = this.P
    const T = this.T
    const U = this.U
    out.px = P[a] + (P[b] - P[a]) * k
    out.py = P[a + 1] + (P[b + 1] - P[a + 1]) * k
    out.pz = P[a + 2] + (P[b + 2] - P[a + 2]) * k
    let tx = T[a] + (T[b] - T[a]) * k
    let ty = T[a + 1] + (T[b + 1] - T[a + 1]) * k
    let tz = T[a + 2] + (T[b + 2] - T[a + 2]) * k
    const tl = Math.hypot(tx, ty, tz) || 1
    tx /= tl
    ty /= tl
    tz /= tl
    let ux = U[a] + (U[b] - U[a]) * k
    let uy = U[a + 1] + (U[b + 1] - U[a + 1]) * k
    let uz = U[a + 2] + (U[b + 2] - U[a + 2]) * k
    // re-ortogonaliza (a interpolação linear tira um pouco do ângulo reto)
    const dot = ux * tx + uy * ty + uz * tz
    ux -= dot * tx
    uy -= dot * ty
    uz -= dot * tz
    const ul = Math.hypot(ux, uy, uz) || 1
    ux /= ul
    uy /= ul
    uz /= ul
    out.tx = tx
    out.ty = ty
    out.tz = tz
    out.ux = ux
    out.uy = uy
    out.uz = uz
    // R = U × T
    out.rx = uy * tz - uz * ty
    out.ry = uz * tx - ux * tz
    out.rz = ux * ty - uy * tx
    out.bank = this.B[i] + (this.B[i + 1] - this.B[i]) * k
    return out
  }

  /** Ponto do mundo para (x, y) da seção na distância s. */
  point(x        , y        , s        , f            , out          ) {
    this.frame(s, f)
    out[0] = f.px + f.rx * x + f.ux * y
    out[1] = f.py + f.ry * x + f.uy * y
    out[2] = f.pz + f.rz * x + f.uz * y
    return out
  }
}

/** Cima fora do loop: o vertical do mundo sem a componente da direção, girado pelo banking em volta de T. */
function upOf(tx        , ty        , tz        , bank        )                           {
  let ux = -ty * tx
  let uy = 1 - ty * ty
  let uz = -ty * tz
  const l = Math.hypot(ux, uy, uz) || 1
  ux /= l
  uy /= l
  uz /= l
  if (!bank) return [ux, uy, uz]
  // direita R = U × T; banking positivo inclina o cima para a direita (curva para a direita: lado de dentro mais baixo)
  const rx = uy * tz - uz * ty
  const ry = uz * tx - ux * tz
  const rz = ux * ty - uy * tx
  const c = Math.cos(bank)
  const s = Math.sin(bank)
  return [ux * c + rx * s, uy * c + ry * s, uz * c + rz * s]
}

// ── sim/run.ts ───────────────────────────────────────────────────────────────
// features/meu-mundo/noturno/sim/run.ts — ROLÊ NOTURNO (mm3d-40): a regra.
//
// Corrida sem fim numa rua de noite, de bicicleta, skate ou patins (pedido do
// Alex: "vai coletando moedas e cada vez fica mais rápido"). Sem Babylon: roda
// no node (harness) e no jogo.
//
//  - Três faixas (x = −2,5 / 0 / +2,5). O jogador anda para +z; a velocidade
//    é função da DISTÂNCIA (v0 → vmax), então a rua é gerada sabendo a
//    velocidade com que cada trecho vai ser alcançado.
//  - Obstáculos são caixas com teto: chegar por cima (ou até `stepUp` abaixo
//    do teto) = sobe e anda em cima — carro e caminhão viram chão. Bater de
//    frente = fim. Entrar de lado = tropeço e volta para a faixa de antes;
//    dois tropeços em 5 s = fim.
//  - Rampa de skate: sobe pela superfície e, na borda, lança para cima (dá
//    para cair no teto do caminhão logo depois). No ar da rampa (mm3d-40d)
//    as setas viram manobra: lado = 360° para aquele lado, cima = mortal;
//    só conta se terminar antes de pousar (dá para emendar duas).
//  - A partir de 250 km/h (mm3d-40d) a rua aperta: trechos mais juntos, mais
//    faixas fechadas e o "zigue-zague" de veículos altos que obriga a trocar
//    de faixa — sempre com uma passagem.
//  - Carros na contramão e andando na mesma mão: começam a se mexer quando o
//    jogador chega a `act` metros; o gerador reserva a faixa pelo trecho que
//    eles percorrem, para nada atravessar nada.
//  - LOGO da Freelandoo a cada 700 m (mm3d-42), sempre numa faixa livre:
//    pegou = 5 s de poder — bater em qualquer obstáculo o EXPLODE (como no
//    jetpack) e dá um empurrão de velocidade; acabou, a velocidade volta ao
//    normal (ainda sem morrer enquanto ela desce).
//  - Multiplayer (mm3d-42): todos geram a MESMA rua pela semente da sala e
//    pela curva de velocidade do veículo mais rápido (`street`) — quem vai de
//    skate/patins só tem mais folga. A rua é igual para todos; cada aparelho
//    roda a sua corrida.
//  - FASES (Rolê Noturno 2.0): a pista ganha forma no mundo (sim/track.ts:
//    curvas, subidas, descidas e loops) sem mudar nada daqui — só o gerador
//    deixa a zona do LOOP sem obstáculo (uma fileira de moedas no lugar). A
//    fase "classica" não tem traçado: a rua reta de antes, idêntica.

const LANE = 2.5
const LANE_X = [-LANE, 0, LANE]         

/**
 * Cada veículo com o seu jeito (diferenças pequenas, para o gosto da escolha).
 * Velocidade (m/s) pela distância (pedidos do Alex, mm3d-40b/c): o skate sai
 * a 40 km/h, chega a 200 km/h aos 10 km, 350 km/h aos 20 km e 450 km/h aos
 * 30 km (o teto); bike e patins na mesma proporção (+11% e +4%). `early` =
 * o tanto que sobe logo no começo (a arrancada dos primeiros quilômetros);
 * `at` = a velocidade em cada marco de SPEED_KNOTS.
 */
const RIDES                                                                                                          = {
  bike: { v0: 12, early: 18, at: [61.73, 108.02, 138.89], jumpH: 1.45, laneTime: 0.2 },
  skate: { v0: 11, early: 16, at: [55.56, 97.22, 125], jumpH: 1.75, laneTime: 0.17 },
  skates: { v0: 11.5, early: 16.5, at: [57.61, 100.82, 129.63], jumpH: 1.55, laneTime: 0.13 },
}
/** Marcos da curva (m): até o 1º arrancada + subida reta; depois reta de marco em marco; do último em diante, o teto. */
const SPEED_KNOTS = [10000, 20000, 30000]         

const TUNING = {
  step: 1 / 120,
  gravity: 32,
  /** Puxar para baixo no ar: desce na hora. */
  dropV: -22,
  /** Velocidade vertical na borda da rampa. */
  launchV: 12.5,
  /** Chegar até isto abaixo do teto ainda sobe (sem bater). */
  stepUp: 0.55,
  half: 0.35,
  /** Distância em que carros parados no trânsito começam a andar (mínimo; cresce com a velocidade). */
  act: 110,
  /** Metros da arrancada do começo (63% dela em speedK). */
  speedK: 1500,
  /** Janela do segundo tropeço (s). */
  stumbleWindow: 5,
  /** Metros vazios no começo. */
  lead: 75,
  /** Pulo e descida guardados por este tempo antes de valer (s). */
  buffer: 0.16,
  /** Pontos por moeda. */
  coinPoints: 10,
}         

/** Logo da Freelandoo (mm3d-42): de quantos em quantos metros, quanto dura e o empurrão. */
const POWER = {
  every: 700,
  /** Segundos de poder. */
  time: 5,
  /** Velocidade × isto enquanto dura. */
  boost: 1.3,
  /** Cada obstáculo explodido soma isto (e volta devagar para `boost`). */
  kick: 0.12,
  maxBoost: 1.75,
  /** Quanto o multiplicador desce por segundo depois do fim. */
  fall: 0.55,
  /** Pontos por obstáculo explodido. */
  points: 25,
}         

                                       
/** Manobras no ar da rampa (mm3d-40d): duração (s) e pontos (o 360° vale o dobro do antigo). */
const TRICKS                                                      = {
  spin: { time: 0.4, points: 100 },
  flip: { time: 0.44, points: 150 },
}
/** Pousar com a manobra a partir daqui ainda conta. */
const TRICK_GRACE = 0.82

/** Velocidade (m/s) em que a rua começa a apertar e em que aperta de vez (250 → 450 km/h). */
const HARD_FROM = 250 / 3.6
const HARD_TO = 450 / 3.6

/** Medidas da regra (iguais aos modelos: pipeline/noturno/build_props.py e supercar/ambulância). */
const KINDS                                                                                 = {
  car: { hw: 1.07, len: 4.38, top: 1.28, solid: true },
  amb: { hw: 1.24, len: 5.7, top: 2.9, solid: true },
  truck: { hw: 1.24, len: 9.12, top: 3.0, solid: true },
  barrier: { hw: 1.08, len: 0.4, top: 1.0, solid: true },
  ramp: { hw: 1.12, len: 3.6, top: 1.1, solid: false },
}

                           
            
                    
              
           
                                  
           
                                                                        
            
                                            
           
                                                                            
             
                                            
               
                              
              
 

                       
            
           
           
                                                                    
           
                       
                
 

                           
               
                
               
               
 

                      
                               
                    
                      
                                                   
                                                      
                    
                    
                       
                                                     
                     
                        
                                                                                                                      

function speedAt(ride          , dist        ) {
  const r = RIDES[ride]
  const d = Math.max(0, dist)
  const k1 = SPEED_KNOTS[0]
  if (d <= k1) {
    const early = (x        ) => r.early * (1 - Math.exp(-x / TUNING.speedK))
    const lin = (r.at[0] - r.v0 - early(k1)) / k1
    return r.v0 + early(d) + lin * d
  }
  for (let i = 1; i < SPEED_KNOTS.length; i++) {
    const a = SPEED_KNOTS[i - 1]
    const b = SPEED_KNOTS[i]
    if (d <= b) return r.at[i - 1] + ((r.at[i] - r.at[i - 1]) * (d - a)) / (b - a)
  }
  return r.at[r.at.length - 1]
}

/** Distância (m) em que quem está parado no trânsito começa a andar: ~2,6 s antes de o jogador chegar. */
function actAt(v        ) {
  return Math.max(TUNING.act, v * 2.6)
}

/** Quantos caminhões em fila depois de uma rampa para o pouso cair em cima de um deles. */
function convoyOf(v        ) {
  return Math.max(1, Math.ceil((0.23 * v + 1) / (KINDS.truck.len + 0.5)))
}

function mulberry(seed        ) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Altura da rampa a `s` metros do começo (a mesma curva do modelo). */
function rampY(s        ) {
  const t = Math.max(0, Math.min(1, s / KINDS.ramp.len))
  return KINDS.ramp.top * Math.pow(1 - Math.cos((t * Math.PI) / 2), 0.85)
}

class Run {
           ride          
  /** Curva de velocidade com que a rua é gerada (multiplayer: a do veículo mais rápido). */
           street          
  /** Fase (Rolê Noturno 2.0) e o traçado dela (null na Clássica). */
           phase          
           track                  
                   rnd              
  obstacles             = []
  coins         = []
  /** Logos da Freelandoo (poder). */
  powers         = []
          nextPower         = POWER.every
          seq = 0
  /** Onde o próximo trecho começa. */
          nextZ         = TUNING.lead
  /** Até onde cada faixa está ocupada (reserva dos que andam incluída). */
          busy = [0, 0, 0]

  // ── o jogador ────────────────────────────────────────────────────────────
  z = 0
  x = 0
  lane = 1
          fromLane = 1
  y = 0
  vy = 0
  grounded = true
  alive = true
  time = 0
  v = 0
  coinsGot = 0
  tricks = 0
  trickPts = 0
  /** Manobra em curso (primitivos: o robô clona a corrida rasa). */
  trickKind                   = null
  /** Lado do 360° (1 = direita). */
  trickDir         = 1
  /** 0–1 da manobra em curso. */
  trickP = 0
  /** No ar vindo da rampa: as setas fazem manobra em vez de trocar de faixa. */
  trickAir = false
  /** Manobras fechadas neste ar. */
          airTricks = 0
          onRamp                  = null
          stumbleT = 0
          jumpBuf = 0
          downBuf = 0
  crashedBy                                  = null
  /** Segundos de poder que faltam. */
  powerT = 0
  /** Multiplicador da velocidade (1 = normal). */
  boost = 1
  smashed = 0
  smashPts = 0
          ticks = 0

  constructor(ride          , seed = 1, street           = ride, phase           = "classica") {
    this.ride = ride
    this.street = street
    this.phase = phase
    this.track = phase === "classica" ? null : new TrackPlan(phase, seed)
    this.rnd = mulberry(seed)
    this.v = speedAt(ride, 0)
    // começo: uma fileira de moedas no meio para chamar
    for (let i = 0; i < 8; i++) this.addCoin(LANE_X[1], 0.9, 18 + i * 3)
    this.generate(260)
  }

  get score() {
    return Math.floor(this.z) + this.coinsGot * TUNING.coinPoints + this.trickPts + this.smashPts
  }

  /** Explode o que bater: durante o poder e enquanto a velocidade ainda desce. */
  get smashing() {
    return this.powerT > 0 || this.boost > 1.04
  }

  /** Dificuldade 0–1 pela distância. */
          diff(z        ) {
    return Math.min(1, Math.max(0, (z - 150) / 2600))
  }

  /** Aperto 0–1 pela velocidade: 250 km/h → 450 km/h. */
          hard(v        ) {
    return Math.min(1, Math.max(0, (v - HARD_FROM) / (HARD_TO - HARD_FROM)))
  }

  // ═══ geração ══════════════════════════════════════════════════════════════
          add(kind              , lane        , z        , u = 0, dir         = 1)           {
    const o           = { id: ++this.seq, kind, lane, x: LANE_X[lane], z, pz: z, u, dir, actAt: z - actAt(speedAt(this.street, z)), tint: Math.floor(this.rnd() * 8) }
    this.obstacles.push(o)
    return o
  }

          addCoin(x        , y        , z        , host                  = null) {
    this.coins.push({ id: ++this.seq, x, y, z, host, taken: false })
  }

          coinLine(lane        , z0        , n        , gap = 3) {
    for (let i = 0; i < n; i++) this.addCoin(LANE_X[lane], 0.9, z0 + i * gap)
  }

  /** Arco de moedas de um pulo a partir de `z0` (altura de saída y0, vy). */
          coinArc(lane        , z0        , y0        , vy        , v        , n = 7) {
    const g = TUNING.gravity
    const tEnd = (vy + Math.sqrt(vy * vy + 2 * g * Math.max(0, y0))) / g
    for (let i = 1; i <= n; i++) {
      const t = (tEnd * i) / (n + 1)
      const y = y0 + vy * t - (g * t * t) / 2
      if (y > 0.4) this.addCoin(LANE_X[lane], y + 0.9, z0 + v * t)
    }
  }

          shuffle   (a     ) {
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rnd() * (i + 1))
      ;[a[i], a[j]] = [a[j], a[i]]
    }
    return a
  }

          pick   (a              ) {
    return a[Math.floor(this.rnd() * a.length)]
  }

  /** Gera trechos até `upTo` (z). */
  generate(upTo        ) {
    while (this.nextZ < upTo) {
      const z = this.nextZ
      const d = this.diff(z)
      const v = speedAt(this.street, z)
      const free = [0, 1, 2].filter((l) => this.busy[l] <= z - 1)
      if (z >= this.nextPower && free.length) {
        // o logo: numa faixa livre, com a rua limpa logo depois
        const l = this.pick(free)
        this.powers.push({ id: ++this.seq, x: LANE_X[l], y: 1.1, z: z + 2, host: null, taken: false })
        this.mark(l, z + 6)
        this.nextPower += POWER.every
        this.nextZ = z + 6 + v * 0.5
        continue
      }
      // loop à frente (fases 2.0): nada de obstáculo até a saída, só moedas pela pista
      const q = this.track ? this.track.quiet(z, z + 100) : null
      if (q) {
        const lane = free.includes(1) ? 1 : (free[0] ?? 1)
        for (let c = Math.max(z, q.from + 6); c < q.to - 6; c += 4) this.addCoin(LANE_X[lane], 0.9, c)
        this.mark(lane, q.to)
        this.nextZ = q.to + 4
        continue
      }
      const h = this.hard(v)
      const len = free.length ? this.pattern(z, d, v, free, h) : 6
      const gap = v * (1.5 - 0.65 * d - 0.28 * h) * (0.85 + this.rnd() * 0.3)
      this.nextZ = z + len + gap
    }
  }

          mark(lane        , until        ) {
    this.busy[lane] = Math.max(this.busy[lane], until)
  }

  /** Caminhões em fila a partir de z (o bastante para o pouso da rampa); moedas no último. Devolve o fim. */
          convoy(lane        , z        , v        ) {
    const n = convoyOf(v)
    let t                  = null
    for (let i = 0; i < n; i++) t = this.add("truck", lane, z + i * (KINDS.truck.len + 0.5))
    for (let i = 0; i < 4; i++) this.addCoin(LANE_X[lane], KINDS.truck.top + 0.9, 1.5 + i * 2.2, t)
    return z + n * (KINDS.truck.len + 0.5) - 0.5
  }

  /** Um trecho começando em z; devolve o comprimento. Sempre sobra uma faixa livre (ou passável). */
          pattern(z        , d        , v        , free          , h = 0)         {
    const lanes = this.shuffle([...free])
    const r = this.rnd()
    const g = TUNING.gravity
    const jumpV = Math.sqrt(2 * g * RIDES[this.street].jumpH)
    // pesos pelo que a dificuldade libera
    const opts                     = [
      ["barrier", 1.2],
      ["cars", 1.4],
      ["rampTruck", 1.1],
      ["ramp", 0.7],
      ["coins", 0.6 - d * 0.3],
      ["oncoming", d > 0.12 ? 0.9 : 0],
      ["mover", d > 0.08 ? 0.7 : 0],
      ["wall", d > 0.3 && free.length === 3 ? 0.8 + d + h * 0.6 : 0],
      ["amb", 0.5 + h * 0.5],
      ["slalom", h > 0 && free.length === 3 ? 0.6 + h * 1.6 : 0],
    ]
    let total = 0
    for (const [, w] of opts) total += Math.max(0, w)
    let pickW = r * total
    let kind = "coins"
    for (const [k, w] of opts) {
      pickW -= Math.max(0, w)
      if (pickW <= 0) {
        kind = k
        break
      }
    }
    const one = lanes.length === 1
    if (one && kind !== "barrier" && kind !== "ramp" && kind !== "coins") kind = this.rnd() < 0.5 ? "barrier" : "coins"

    switch (kind) {
      case "barrier": {
        const n = one ? 1 : Math.min(lanes.length, this.rnd() < 0.35 + d * 0.4 + h * 0.2 ? 2 : 1)
        const blocked = lanes.slice(0, n)
        for (const l of blocked) {
          this.add("barrier", l, z)
          this.mark(l, z + 1)
        }
        // um arco por cima de uma barreira (mostra o pulo)
        this.coinArc(blocked[0], z - (jumpV / g) * v, 0, jumpV, v, 7)
        if (lanes.length > n) this.coinLine(lanes[n], z - 6, 5)
        return 2
      }
      case "cars": {
        const n = Math.min(lanes.length - 1, this.rnd() < 0.4 + d * 0.4 + h * 0.3 ? 2 : 1)
        for (let i = 0; i < n; i++) {
          const zz = z + this.rnd() * 6
          const k = this.rnd() < 0.15 + h * 0.35 ? "amb" : "car"
          this.add(k, lanes[i], zz)
          this.mark(lanes[i], zz + KINDS[k].len + 1)
        }
        this.coinLine(lanes[n], z - 4, 6)
        return 12
      }
      case "amb": {
        const l = lanes[0]
        this.add("amb", l, z)
        this.mark(l, z + KINDS.amb.len + 1)
        // dá para subir na ambulância? não (2,9 m): passe ao lado; moedas na outra faixa
        if (lanes.length > 1) this.coinLine(lanes[1], z - 3, 5)
        return KINDS.amb.len + 2
      }
      case "ramp": {
        const l = lanes[0]
        this.add("ramp", l, z)
        const lip = z + KINDS.ramp.len
        this.coinArc(l, lip, KINDS.ramp.top, TUNING.launchV, v, 9)
        this.mark(l, lip + v * 0.9)
        return KINDS.ramp.len + v * 0.9
      }
      case "rampTruck": {
        const l = lanes[0]
        this.add("ramp", l, z)
        const lip = z + KINDS.ramp.len
        // a borda lança; o caminhão começa onde o pulo já passou do teto e a fila
        // vai até onde ele desce (rápido demais, um caminhão só ficava para trás)
        const gap = Math.max(3.5, v * 0.38)
        const end = this.convoy(l, lip + gap, v)
        this.coinArc(l, lip, KINDS.ramp.top, TUNING.launchV, v, 5)
        this.mark(l, end + 1)
        // do lado: um carro parado (mais tarde)
        if (lanes.length > 2 && d > 0.35) {
          this.add("car", lanes[1], lip + gap + 1)
          this.mark(lanes[1], lip + gap + 1 + KINDS.car.len + 1)
        }
        return end - z
      }
      case "wall": {
        // dois caminhões lado a lado; a terceira faixa tem rampa+caminhão ou barreira
        const [a, b, c] = lanes
        const tz = z + KINDS.ramp.len + Math.max(3.5, v * 0.38)
        let end = tz + KINDS.truck.len
        for (const l of [a, b]) {
          const e = this.convoy(l, tz, v)
          this.mark(l, e + 1)
          end = Math.max(end, e)
        }
        if (this.rnd() < 0.5) {
          this.add("ramp", c, z)
          const e = this.convoy(c, tz, v)
          this.mark(c, e + 1)
          end = Math.max(end, e)
        } else {
          this.add("barrier", c, tz + 2)
          this.mark(c, tz + 3)
          this.coinArc(c, tz + 2 - (jumpV / g) * v, 0, jumpV, v, 7)
        }
        return end - z
      }
      case "oncoming": {
        // carro na contramão: encontra o jogador perto de `z`; a faixa fica reservada até onde ele nasce
        const l = lanes[0]
        const u = -(7 + this.rnd() * 3 + d * 3)
        const act = actAt(v)
        const z0 = z + (-u * act) / (v - u)
        const o = this.add("car", l, z0, u, -1)
        o.actAt = z0 - act
        this.mark(l, z0 + KINDS.car.len + 4)
        if (lanes.length > 1) this.coinLine(lanes[1], z - 6, 6)
        if (lanes.length > 2 && d > 0.3) {
          this.add("barrier", lanes[2], z)
          this.mark(lanes[2], z + 1)
        }
        return 8
      }
      case "mover": {
        // carro andando na mesma mão, mais devagar: você chega nele
        const l = lanes[0]
        const u = Math.min(8, v * 0.45) * (0.6 + this.rnd() * 0.4)
        const z0 = z
        const act = actAt(v)
        const meet = z0 + (u * act) / (v - u)
        const o = this.add(this.rnd() < 0.3 ? "truck" : "car", l, z0, u, 1)
        o.actAt = z0 - act
        this.mark(l, meet + KINDS[o.kind].len + 4)
        if (lanes.length > 1) this.coinLine(lanes[1], z - 4, 5)
        return 6
      }
      case "slalom": {
        // zigue-zague: portões que fecham duas faixas com veículos parados
        // (quase todos altos, sem pulo); a passagem muda de faixa a cada um e
        // entre o fim de um e o começo do outro dá para trocar com folga.
        const gates = 3 + (this.rnd() < h ? 1 : 0)
        const t1 = 0.62 - 0.12 * h
        let open = Math.floor(this.rnd() * 3)
        let zz = z
        let end = z
        for (let i = 0; i < gates; i++) {
          for (const l of [0, 1, 2]) {
            if (l === open) continue
            const q = this.rnd()
            const k               = q < 0.45 ? "truck" : q < 0.8 ? "amb" : "car"
            this.add(k, l, zz)
            this.mark(l, zz + KINDS[k].len + 1)
            end = Math.max(end, zz + KINDS[k].len)
          }
          this.coinLine(open, zz - 3, 4)
          // a próxima passagem: ao lado (ou de ponta a ponta, mais tarde, com mais espaço)
          const next = open === 1 ? (this.rnd() < 0.5 ? 0 : 2) : this.rnd() < 0.3 * h ? 2 - open : 1
          zz += KINDS.truck.len + v * (t1 + (Math.abs(next - open) === 2 ? 0.32 : 0))
          open = next
        }
        return end - z
      }
      default: {
        // moedas em zigue-zague pelas faixas livres
        let l = lanes[0]
        for (let i = 0; i < 9; i++) {
          this.addCoin(LANE_X[l], 0.9, z + i * 3)
          if (i % 3 === 2 && lanes.length > 1) l = lanes[(lanes.indexOf(l) + 1) % lanes.length]
        }
        return 27
      }
    }
  }

  // ═══ passo ════════════════════════════════════════════════════════════════
  coinZ(c      ) {
    return c.host ? c.host.z + c.z : c.z
  }

  /** Chão sob (x, z): teto do que estiver embaixo, superfície da rampa ou a rua. */
          support(x        , z        , y        )                                       {
    let h = 0
    let ramp                  = null
    for (const o of this.obstacles) {
      const k = KINDS[o.kind]
      if (Math.abs(x - o.x) >= k.hw + TUNING.half) continue
      if (z < o.z - 0.05 || z > o.z + k.len) continue
      const top = o.kind === "ramp" ? rampY(z - o.z) : k.top
      // só conta como chão o que está abaixo dos pés (ou logo acima, degrau)
      if (top <= y + TUNING.stepUp && top > h) {
        h = top
        ramp = o.kind === "ramp" ? o : null
      }
    }
    return { h, ramp }
  }

  step(input          , out            ) {
    if (!this.alive) return
    const dt = TUNING.step
    const T = TUNING
    this.time += dt
    if (this.stumbleT > 0) this.stumbleT -= dt
    // no ar da rampa as setas viram manobra (uma por vez; dá para emendar)
    if (!this.grounded && this.trickAir && (input.jump || input.left || input.right)) {
      if (this.trickKind === null) {
        this.trickKind = input.jump ? "flip" : "spin"
        this.trickDir = input.right && !input.jump ? 1 : -1
        this.trickP = 0
      }
      input = { ...input, jump: false, left: false, right: false }
    }
    if (input.jump) this.jumpBuf = T.buffer
    if (input.down) this.downBuf = T.buffer
    if (this.jumpBuf > 0) this.jumpBuf -= dt
    if (this.downBuf > 0) this.downBuf -= dt

    // faixa
    if (input.left && this.lane > 0) {
      this.fromLane = this.lane
      this.lane--
      out.push({ type: "lane" })
    }
    if (input.right && this.lane < 2) {
      this.fromLane = this.lane
      this.lane++
      out.push({ type: "lane" })
    }
    const prevX = this.x
    const prevZ = this.z
    const rate = LANE / RIDES[this.ride].laneTime
    const dx = LANE_X[this.lane] - this.x
    this.x += Math.sign(dx) * Math.min(Math.abs(dx), rate * dt)

    // poder: o multiplicador sobe na hora, os empurrões voltam devagar e, no fim, desce até 1
    if (this.powerT > 0) {
      this.powerT -= dt
      if (this.boost < POWER.boost) this.boost = Math.min(POWER.boost, this.boost + dt * 2.5)
      else this.boost = Math.max(POWER.boost, this.boost - dt * 0.25)
      if (this.powerT <= 0) {
        this.powerT = 0
        out.push({ type: "powerEnd" })
      }
    } else if (this.boost > 1) this.boost = Math.max(1, this.boost - dt * POWER.fall)

    // frente
    this.v = speedAt(this.ride, this.z) * this.boost
    this.z += this.v * dt

    // quem anda
    for (const o of this.obstacles) {
      o.pz = o.z
      if (o.u !== 0 && this.z >= o.actAt) o.z += o.u * dt
    }

    // vertical
    const sup = this.support(this.x, this.z, this.y)
    if (this.grounded) {
      if (this.onRamp && !sup.ramp && this.z > this.onRamp.z + KINDS.ramp.len - 0.2) {
        // borda da rampa: lança (com pulo junto, mais alto); a manobra é do jogador
        this.vy = T.launchV + (this.jumpBuf > 0 ? 2.5 : 0)
        this.jumpBuf = 0
        this.grounded = false
        this.trickAir = true
        this.airTricks = 0
        out.push({ type: "launch" })
      } else if (this.jumpBuf > 0) {
        this.vy = Math.sqrt(2 * T.gravity * RIDES[this.ride].jumpH)
        this.jumpBuf = 0
        this.grounded = false
        this.trickAir = false
        out.push({ type: "jump" })
      } else if (sup.h < this.y - 0.08) {
        // acabou o teto: cai
        this.grounded = false
        this.vy = 0
        this.trickAir = false
      } else {
        if (sup.h > this.y + 0.05 && !sup.ramp) out.push({ type: "step" })
        this.y = sup.h
      }
      this.onRamp = sup.ramp
    }
    if (!this.grounded) {
      if (this.downBuf > 0) {
        // descer rápido larga a manobra
        this.vy = Math.min(this.vy, T.dropV)
        this.downBuf = 0
        this.trickKind = null
        this.trickAir = false
      }
      if (this.trickKind !== null) {
        this.trickP += dt / TRICKS[this.trickKind].time
        if (this.trickP >= 1) this.finishTrick(out)
      }
      this.vy -= T.gravity * dt
      this.y += this.vy * dt
      const s2 = this.support(this.x, this.z, this.y)
      if (this.y <= s2.h && this.vy <= 0) {
        const hard = this.vy < -14
        this.y = s2.h
        this.vy = 0
        this.onRamp = s2.ramp
        this.land(hard, out)
      }
    }

    // batidas: caixa que está à frente/ao lado mais alta que os pés
    let boom                    = null
    for (const o of this.obstacles) {
      const k = KINDS[o.kind]
      if (!k.solid) continue
      if (Math.abs(this.x - o.x) >= k.hw + T.half) continue
      // varrido: a 350 km/h o passo anda 0,8 m — o cavalete (0,4 m) não pode passar entre dois passos
      if (this.z < o.z - 0.3 || prevZ > o.pz + k.len) continue
      if (this.y >= k.top - T.stepUp) {
        if (this.y < k.top - 0.02 && this.vy <= 0 && this.z <= o.z + k.len) {
          this.y = k.top
          this.vy = 0
          if (!this.grounded) this.land(false, out)
        }
        continue
      }
      if (this.smashing) {
        // com o poder: explode (de frente ou de lado) e empurra
        ;(boom ??= []).push(o)
        continue
      }
      const wasAhead = prevZ < o.pz - 0.3 + 1e-6 || (o.dir === -1 && prevZ < o.pz)
      const wasBeside = Math.abs(prevX - o.x) >= k.hw + T.half - 1e-6
      if (wasBeside && !wasAhead) {
        // entrou de lado: volta para a faixa de antes
        this.x = prevX
        this.lane = this.fromLane
        if (this.stumbleT > 0) return this.crash("stumble", out)
        this.stumbleT = T.stumbleWindow
        out.push({ type: "stumble" })
        continue
      }
      return this.crash(o.kind, out)
    }
    if (boom) for (const o of boom) this.smash(o, out)

    // logo da Freelandoo
    for (const p of this.powers) {
      if (p.taken) continue
      if (p.z < prevZ - 1.2 || p.z > this.z + 1.2 || Math.abs(p.x - this.x) > 1.1) continue
      if (Math.abs(p.y - (this.y + 0.9)) > 1.6) continue
      p.taken = true
      this.powerT = POWER.time
      out.push({ type: "power" })
    }

    // moedas
    for (const c of this.coins) {
      if (c.taken) continue
      const cz = this.coinZ(c)
      if (cz < prevZ - 0.9 || cz > this.z + 0.9 || Math.abs(c.x - this.x) > 0.85) continue
      if (Math.abs(c.y - (this.y + 0.9)) > 1.15) continue
      c.taken = true
      this.coinsGot++
      out.push({ type: "coin", n: this.coinsGot })
    }

    // limpeza e mais rua à frente
    if (++this.ticks % 30 === 0) {
      const cut = this.z - 40
      this.obstacles = this.obstacles.filter((o) => o.z + KINDS[o.kind].len > cut || o.u < 0)
      this.obstacles = this.obstacles.filter((o) => o.z + KINDS[o.kind].len > this.z - 80)
      this.coins = this.coins.filter((c) => !c.taken && this.coinZ(c) > cut)
      this.powers = this.powers.filter((p) => !p.taken && p.z > cut)
      this.track?.forget(this.z - 400)
    }
    this.generate(this.z + Math.max(260, this.v * 4.5))
  }

  /** Obstáculo explodido: some da rua, as moedas em cima dele vêm junto, a velocidade dá um empurrão. */
          smash(o          , out            ) {
    const i = this.obstacles.indexOf(o)
    if (i < 0) return
    this.obstacles.splice(i, 1)
    let got = 0
    for (const c of this.coins) {
      if (c.host !== o || c.taken) continue
      c.taken = true
      got++
    }
    if (got) {
      this.coinsGot += got
      out.push({ type: "coin", n: this.coinsGot })
    }
    this.smashed++
    this.smashPts += POWER.points
    this.boost = Math.min(POWER.maxBoost, this.boost + POWER.kick)
    const k = KINDS[o.kind]
    out.push({ type: "smash", kind: o.kind, x: o.x, z: o.z, len: k.len, top: k.top, tint: o.tint, coins: got })
  }

          finishTrick(out            ) {
    const kind = this.trickKind
    if (kind === null) return
    const points = TRICKS[kind].points
    this.tricks++
    this.trickPts += points
    this.airTricks++
    this.trickKind = null
    this.trickP = 0
    out.push({ type: "trick", kind, points })
  }

  /** Pousou: a manobra quase no fim ainda vale; a do meio se perde. */
          land(hard         , out            ) {
    if (this.trickKind !== null && this.trickP >= TRICK_GRACE) this.finishTrick(out)
    this.trickKind = null
    this.trickP = 0
    this.grounded = true
    this.trickAir = false
    out.push({ type: "land", hard, trick: this.airTricks > 0 })
    this.airTricks = 0
  }

          crash(kind                          , out            ) {
    this.alive = false
    this.crashedBy = kind
    out.push({ type: "crash", kind })
  }
}

module.exports = { RUN_PHASES, isRunPhase, TRACK_RULES, TRACK_LEAD, QUIET_BEFORE, QUIET_AFTER, DS, ease, TrackPlan, newFrame, TrackGeom, LANE, LANE_X, RIDES, SPEED_KNOTS, TUNING, POWER, TRICKS, TRICK_GRACE, HARD_FROM, HARD_TO, KINDS, speedAt, actAt, rampY, Run };
