// GERADO por scripts/build-noturno-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/noturno/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

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

  constructor(ride          , seed = 1, street           = ride) {
    this.ride = ride
    this.street = street
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

module.exports = { LANE, LANE_X, RIDES, SPEED_KNOTS, TUNING, POWER, TRICKS, TRICK_GRACE, HARD_FROM, HARD_TO, KINDS, speedAt, actAt, rampY, Run };
