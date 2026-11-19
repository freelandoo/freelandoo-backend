// GERADO por scripts/build-gincana-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/gincana/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── sim/course.ts ────────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/course.ts — GINCANA (mm3d-47): o que um percurso É.
//
// Corrida de obstáculos do gênero dos "party games" de feijão (o vídeo do
// Alex), com percursos próprios. Tudo aqui é FUNÇÃO DO TEMPO DA PROVA (`t`,
// s depois do "vai"): barras que giram, pêndulos, luvas, bolas que rolam,
// plataformas que andam, discos que giram e blocos que empurram ficam no mesmo
// lugar em todos os aparelhos e na sala — ninguém precisa mandar onde estão.
//
// 2026-11-16 (Gincana 2.0, pedido do Alex): o percurso deixou de ser fixo no
// código e virou DADO (`Course`), montado em courses.ts — a fase de sempre
// ("cidade", com os mesmos números) e uma fase por Domínio. Peças novas:
// cogumelo que lança (Post.b), porta falsa (Door), plataforma que anda e disco
// que gira (Pad.mx/mz/spin), esteira (Pad.bx/bz), gelo (Pad.f), bloco que
// empurra (Pusher) e hexágono (Tile.k = 1).
//
// Regra única: o navegador e a sala (src/utils/meuMundoGincana.js, GERADO
// deste diretório por scripts/build-gincana-sim.js no back) usam os mesmos
// números. Metros, segundos; y para cima; a prova corre para +z.

/** Altura do tampo das plataformas; a água (ou lava, ou o vazio) fica em y = 0. */
const DECK = 3

const GINCANA = {
  step: 1 / 60,
  // mm3d-47b: mais rápido e mais seco (o Alex achou lento e o pulo mole)
  gravity: 30,
  run: 8.2,
  /** Esteira (Gincana 3, pedido do Alex 18/11): forte — parado, ela leva você; contra ela anda a 2,7 m/s. */
  belt: 5.5,
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
  /** Gincana 3: altura do corpo mergulhando/deslizando (passa por baixo da barra alta). */
  lowH: 0.7,
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
  // ── Gincana 2.0 (2026-11-16) ──
  /** Agarrar: alcance (m, de centro a centro, na frente), quanto tempo segura, a velocidade de quem é segurado e de quem segura. */
  grabR: 1.3,
  grabMax: 2.6,
  grabCool: 0.8,
  heldRun: 0.42,
  grabRun: 0.32,
  /** Beira: bateu de lado numa plataforma com o tampo até isto acima do pé = sobe (segurando AGARRAR, mais alto). */
  ledge: 1.05,
  ledgeGrab: 1.6,
  climbT: 0.3,
  /** Mergulho que acerta alguém: empurrão (m/s). */
  tackle: 6.5,
  /** Classificam (fração das vagas); a prova fecha quando esse tanto chega. */
  qualify: 0.75,
}         

/** Paleta (índice = cor do tampo; as bordas usam a cor do par). Turquesa (3) é a cor do mar: nunca no tampo. */
const GINCANA_COLORS = ["#FF6A13", "#FFD21F", "#FF5FA8", "#19C6D1", "#8A4DFF", "#63E05A", "#2F7BFF", "#FFFFFF"]         

/**
 * Gincana 3 (2026-11-18): cada fase é um TIPO de prova (pedido do Alex: "as fases
 * estão bem iguais"). race = corrida até a chegada; survive = último em pé (quem
 * cai está fora); collect = quem pega mais engrenagens; zone = quem fica mais tempo
 * na zona. Tudo sai da pose e do tempo: a sala conta igual ao aparelho.
 */
                                                                 

/** As fases: a de sempre e uma por Domínio. */
                                                                                                                                                   
const GINCANA_PHASES                          = ["cidade", "floresta", "clareira", "canion", "orbital", "forja", "fabrica", "gelo", "relogio", "feira", "coroa"]

/**
 * Plataforma: 0 = disco (r), 1 = caixa girada (hx, hz, rot), 2 = rampa
 * (caixa sem giro; o tampo sobe de `y` em z−hz até `y2` em z+hz).
 * `d` = espessura (abaixo do tampo é parede: empurra de lado).
 */
                      
              
           
           
           
            
            
             
           
            
           
                                                             
           
             
                                                
           
                                                            
           
                                                  
            
            
                                                               
            
            
            
             
                                                               
              
 

/** Coluna (pilar, frade, poste da luva, cogumelo): empurra de lado e dá para subir; `b` > 0 = lança para cima (m/s) quem pousa. */
                       
           
           
           
            
            
           
           
 

/** Barra girando em volta de (x, z); `both` = atravessa o disco inteiro. */
                          
           
           
           
             
           
           
            
               
                                                                                               
             
              
 

/** Bola de pêndulo que balança no eixo x, pendurada em (x, py, z). */
                           
           
           
            
             
           
             
           
            
 

/** Luva de boxe (ou pistão) que soca para dentro do campo a partir de x0 (dir = ±1). */
                        
            
           
           
             
               
           
                
            
 

/**
 * Gincana 3 (Relógio da Praça): grade n×n de ladrilhos com símbolos. Cada rodada: os símbolos
 * aparecem (show), somem (hide), o relógio chama um (call) e os ladrilhos dos OUTROS caem (drop),
 * voltando no fim (back). Tudo pela semente e pelo tempo: nada guardado, a sala conta igual.
 */
                         
           
           
           
           
                                            
              
             
                                        
            
 
const MEM_SYMBOLS = 6
const MEM_HIDE = 1.2
const MEM_DROP = 3
const MEM_BACK = 0.8
/** As rodadas encurtam: menos tempo para decorar e para correr. */
function memShow(r        ) {
  return Math.max(2.4, 5 - 0.4 * r)
}
function memCall(r        ) {
  return Math.max(1.5, 3.2 - 0.3 * r)
}
/** Fase da rodada em t: 0 espera, 1 mostra, 2 esconde, 3 chama, 4 cai, 5 volta; `left` = quanto falta dela. */
function memState(m        , t        )                                          {
  if (t < m.t0) return { r: 0, ph: 0, left: m.t0 - t }
  let s = t - m.t0
  for (let r = 0; r < 500; r++) {
    const parts = [memShow(r), MEM_HIDE, memCall(r), MEM_DROP, MEM_BACK]
    for (let k = 0; k < parts.length; k++) {
      if (s < parts[k]) return { r, ph: k + 1, left: parts[k] - s }
      s -= parts[k]
    }
  }
  return { r: 499, ph: 5, left: 0 }
}
/** Símbolo de cada ladrilho na rodada: embaralhado pela semente, todos os símbolos com 4–5 ladrilhos. */
function memSymbols(m        , seed        , r        )             {
  const N = m.n * m.n
  const idx           = []
  for (let i = 0; i < N; i++) idx.push(i)
  for (let k = N - 1; k > 0; k--) {
    const j = courseHash(seed ^ 0x2c1b3c6d, r * 977 + k) % (k + 1)
    const tmp = idx[k]
    idx[k] = idx[j]
    idx[j] = tmp
  }
  const out = new Uint8Array(N)
  for (let k = 0; k < N; k++) out[idx[k]] = k % MEM_SYMBOLS
  return out
}
/** O símbolo que o relógio chama na rodada. */
function memTarget(seed        , r        ) {
  return courseHash(seed ^ 0x7f4a7c15, r * 131 + 7) % MEM_SYMBOLS
}
/** Centro do ladrilho i. */
function memTile(m        , i        ) {
  const pitch = m.size + m.gap
  const c = (m.n - 1) / 2
  return { x: m.x + ((i % m.n) - c) * pitch, z: m.z + (Math.floor(i / m.n) - c) * pitch }
}
/** Ladrilho sob (x, z) (−1 = vão ou fora), com folga `e`. */
function memIndexAt(m        , x        , z        , e        ) {
  const pitch = m.size + m.gap
  const c = (m.n - 1) / 2
  const ix = Math.round((x - m.x) / pitch + c)
  const iz = Math.round((z - m.z) / pitch + c)
  if (ix < 0 || iz < 0 || ix >= m.n || iz >= m.n) return -1
  const i = iz * m.n + ix
  const q = memTile(m, i)
  return Math.abs(x - q.x) <= m.size / 2 + e && Math.abs(z - q.z) <= m.size / 2 + e ? i : -1
}
/** O ladrilho i está de pé em t? Só cai na fase 4, e só os que não têm o símbolo chamado. */
function memUp(m        , seed        , i        , t        ) {
  const st = memState(m, t)
  if (st.ph !== 4) return true
  return memSymbols(m, seed, st.r)[i] === memTarget(seed, st.r)
}

/** Ladrilho que cai `warn` s depois de pisado e volta depois de `gone`; k 0 = quadrado (meia largura h), 1 = hexágono (raio h). */
                       
           
           
           
           
           
          
 

/** Porta numa fileira: as falsas são parede; as de verdade abrem quando alguém encosta (a semente sorteia quais). */
                       
           
           
            
           
             
 

/** Bloco que anda de um lado para o outro e empurra: centro (x, z) + (ax, az)·sen(w·t + ph). */
                         
           
           
            
            
           
           
            
            
           
            
 

/** Posto de volta (quem cai volta aqui). */
                             
           
           
           
                                               
           
 

                       
           
            
            
            
            
            
 

/** Bolas que descem a rampa: faixas (x), intervalo (s), velocidade, raio e onde somem. */
                        
                          
               
           
           
              
 

/** Ponto da rota dos computadores; `m` = índice da plataforma que anda (mira nela onde estiver). */
                             
           
           
            
 

/** Perigo que sobe (pântano, lava): nível y de y0 (em t0) a y1 (em t1); quem fica abaixo está fora. */
                       
            
            
            
            
 

/** Ponto onde aparece uma engrenagem (coleta): some quando alguém pega e volta depois de `back` s. */
                      
           
           
           
                                        
           
                                                   
            
              
 

/**
 * Gincana 3: ondas de PAREDE que atravessam a arena de z0 para z1 (Paredes de
 * Brasa). Uma onda sai a cada `every` s (a partir de t0) e anda mais rápido
 * com o tempo (v0 → v1 em `ramp` s). A semente decide cada onda: parede alta
 * com um vão, com dois vãos, ou mureta baixa (pula). Pedaços de `seg` m.
 */
                        
            
            
            
           
               
            
            
            
              
             
              
             
 

/** Uma onda de parede agora: onde está (z), a velocidade, o tipo (0 = um vão, 1 = mureta, 2 = dois vãos) e os pedaços abertos. */
                           
           
           
           
                 
                
 

/**
 * Gincana 3 (Rolo de Gelo): anel de um cilindro deitado (eixo em z). Gira em volta do eixo a `w` rad/s
 * (positivo = o topo anda para +x), acelerando devagar; `holes` = buracos (ângulo do material e meia
 * largura, em rad). Ângulo 0 do material = topo no tempo 0.
 */
                           
             
           
                                      
 

/** Cilindro deitado feito de anéis em fila (de z0 para +z). Eixo na altura y, raio R. */
                       
           
            
           
           
           
                   
 

/** Quanto o anel girou até t (acelera: o dobro da velocidade aos 80 s). */
function drumAngle(r          , t        ) {
  return r.w * (t + (t * t) / 160)
}

/** Velocidade do giro do anel em t (rad/s). */
function drumSpeed(r          , t        ) {
  return r.w * (1 + t / 80)
}

const DRUM_EDGE = 0.93

/**
 * O chão do cilindro em (x, z) no tempo t: topo, anel e o ângulo da superfície (0 = topo, + = lado +x).
 * null = fora dele ou em cima de um buraco.
 */
function drumAt(d      , x        , z        , t        ) {
  const dx = x - d.x
  if (Math.abs(dx) > d.R * DRUM_EDGE || z < d.z0) return null
  let zz = d.z0
  for (let k = 0; k < d.rings.length; k++) {
    const r = d.rings[k]
    if (z <= zz + r.len) {
      const th = Math.asin(dx / d.R)
      const mat = th - drumAngle(r, t)
      for (const h of r.holes) {
        let da = (mat - h.a) % (Math.PI * 2)
        if (da > Math.PI) da -= Math.PI * 2
        if (da < -Math.PI) da += Math.PI * 2
        if (Math.abs(da) < h.half) return null
      }
      return { top: d.y + Math.sqrt(d.R * d.R - dx * dx), ring: k, th }
    }
    zz += r.len
  }
  return null
}

/** Zona do rei do pedaço: círculo (x, z, r) com o chão em y. */
                       
           
           
           
           
 

                         
                  
                                   
                   
                                         
                 
                                                     
               
                   
             
                   
                     
                                                       
               
                                                
                       
                                                                                                     
                
             
               
                     
                       
                 
               
                                          
               
                                              
                    
                   
                   
                     
                           
                                              
                 
                 
                                                                                                 
                    
                                                       
                   
                                                                            
                                                      
 

// ── montar um percurso ───────────────────────────────────────────────────────

/** Ajudante de montagem (courses.ts): cada fase chama estes métodos em ordem e termina em `done`. */
class CourseKit {
           pads        = []
           posts         = []
           sweepers            = []
           pendulums             = []
           gloves          = []
           tiles         = []
           doors         = []
           doorOpen           = []
           pushers           = []
           logos                                        = []
  ramp              = null
  balls               = null
           gems        = []
           drums         = []
  drum(x        , z0        , y        , R        , rings            , f = 0.6) {
    this.drums.push({ x, z0, y, R, f, rings })
  }
  gem(x        , z        , y        , v        , t0        , back        ) {
    this.gems.push({ x, z, y, v, t0, back })
  }

  /** Caixa (tampo em `y`). Devolve o índice (para pôr esteira, gelo, movimento). */
  box(x        , z        , hx        , hz        , c        , rim        , s        , rot = 0, d = 1.4, y = DECK) {
    this.pads.push({ k: 1, x, z, r: 0, hx, hz, rot, y, y2: y, d, c, rim, s, f: 1, bx: 0, bz: 0, mx: 0, mz: 0, mw: 0, mph: 0, spin: 0 })
    return this.pads.length - 1
  }
  disc(x        , z        , r        , c        , rim        , s        , y = DECK) {
    this.pads.push({ k: 0, x, z, r, hx: r, hz: r, rot: 0, y, y2: y, d: 1.6, c, rim, s, f: 1, bx: 0, bz: 0, mx: 0, mz: 0, mw: 0, mph: 0, spin: 0 })
    return this.pads.length - 1
  }
  /** Viga de (x0, z0) a (x1, z1), largura `w`. */
  beam(x0        , z0        , x1        , z1        , w        , c        , rim        , s        ) {
    const L = Math.hypot(x1 - x0, z1 - z0)
    return this.box((x0 + x1) / 2, (z0 + z1) / 2, w / 2, L / 2, c, rim, s, Math.atan2(x1 - x0, z1 - z0), 0.7)
  }
  /** Rampa de z0 (y0) a z1 (y1), meia largura hx; com bolas opcionais. */
  slope(x        , z0        , z1        , y0        , y1        , hx        , c        , rim        , s        ) {
    // várias rampas (Gincana 3): só a primeira tem as bolas
    if (!this.ramp) this.ramp = { x, z0, z1, y0, y1, hx }
    this.pads.push({ k: 2, x, z: (z0 + z1) / 2, r: 0, hx, hz: (z1 - z0) / 2, rot: 0, y: y0, y2: y1, d: 1.4, c, rim, s, f: 1, bx: 0, bz: 0, mx: 0, mz: 0, mw: 0, mph: 0, spin: 0 })
    return this.pads.length - 1
  }
  post(x        , z        , r        , y0        , y1        , c        , b = 0) {
    this.posts.push({ x, z, r, y0, y1, c, b })
  }
  sweep(x        , z        , y        , len        , r        , w        , a0        , both         , acc = 0, wMax = 0) {
    this.sweepers.push({ x, z, y, len, r, w, a0, both, acc, wMax })
    return this.sweepers.length - 1
  }
  swing(x        , z        , py        , len        , R        , amp        , w        , ph        ) {
    this.pendulums.push({ x, z, py, len, R, amp, w, ph })
  }
  glove(x0        , z        , y        , dir        , reach        , R        , period        , ph        ) {
    this.gloves.push({ x0, z, y, dir, reach, R, period, ph })
  }
  tile(x        , z        , h        , c        , k        = 0, y = DECK) {
    this.tiles.push({ x, z, y, h, c, k })
  }
  /** Fileira de `n` portas de largura `w` centrada em x, em z; `open` abrem. */
  doorRow(x        , z        , n        , w        , h        , open        ) {
    const row = this.doorOpen.length
    this.doorOpen.push(open)
    for (let i = 0; i < n; i++) this.doors.push({ x: x + (i - (n - 1) / 2) * w, z, hw: w / 2, h, row })
  }
  pusher(x        , z        , hx        , hz        , h        , ax        , az        , w        , ph        , y = DECK) {
    this.pushers.push({ x, z, hx, hz, y, h, ax, az, w, ph })
  }
  logo(x        , z        , y = DECK) {
    this.logos.push({ x, z, y: y + 1.1 })
  }
  /** Fecha o percurso. */
  done(o   
                    
                             
                   
                   
                      
                     
                          
                                             
                      
                    
                  
               
               
                 
                   
                   
   )         {
    return {
      id: o.id,
      mode: o.mode ?? "race",
      qualify: o.qualify ?? GINCANA.qualify,
      limit: o.limit ?? GINCANA.timeLimit,
      rise: o.rise ?? null,
      gems: this.gems,
      zone: o.zone ?? null,
      walls: o.walls ?? null,
      drums: this.drums,
      memory: o.memory ?? null,
      crown: o.crown ?? false,
      pads: this.pads,
      posts: this.posts,
      sweepers: this.sweepers,
      pendulums: this.pendulums,
      gloves: this.gloves,
      tiles: this.tiles,
      tileTime: o.tileTime ?? { warn: 0.7, gone: 4 },
      doors: this.doors,
      doorOpen: this.doorOpen,
      pushers: this.pushers,
      ramp: this.ramp,
      balls: this.balls,
      checkpoints: o.checkpoints,
      logos: this.logos,
      finishZ: o.finishZ,
      finishY: o.finishY,
      sections: o.sections,
      minFinish: o.minFinish,
      route: o.route,
    }
  }
}

// ── o que se mexe ────────────────────────────────────────────────────────────

function sweeperAngle(s         , t        ) {
  if (!s.acc) return s.a0 + s.w * t
  // acelera até wMax e segue nela
  const sg = Math.sign(s.w || 1)
  const w0 = Math.abs(s.w)
  const tc = Math.max(0, Math.min(t, (s.wMax - w0) / s.acc))
  return s.a0 + sg * (w0 * t + 0.5 * s.acc * tc * tc + s.acc * tc * (t - tc))
}

/** Velocidade do giro da barra no tempo t (rad/s, com sinal). */
function sweeperW(s         , t        ) {
  if (!s.acc) return s.w
  return Math.sign(s.w || 1) * Math.min(s.wMax, Math.abs(s.w) + s.acc * Math.max(0, t))
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

/** Deslocamento da plataforma que anda no tempo t (0,0 se parada). */
function padShift(p     , t        ) {
  if (p.mw === 0) return { dx: 0, dz: 0 }
  const s = Math.sin(p.mw * t + p.mph)
  return { dx: p.mx * s, dz: p.mz * s }
}

/** Giro da plataforma (caixa) no tempo t. */
function padRot(p     , t        ) {
  return p.rot + p.spin * t
}

/** Centro do bloco que empurra e a velocidade dele. */
function pusherAt(q        , t        ) {
  const s = Math.sin(q.w * t + q.ph)
  const c = Math.cos(q.w * t + q.ph) * q.w
  return { x: q.x + q.ax * s, z: q.z + q.az * s, vx: q.ax * c, vz: q.az * c }
}

/** Mistura de inteiros (semente das bolas e das portas). */
function courseHash(seed        , i        ) {
  let h = (Math.imul(i + 1, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca77)) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0
  return (h ^ (h >>> 13)) >>> 0
}

/** Faixa do número sorteado (0–3) ou -1 = sem bola nesta vez. */
function ballLane(c        , seed        , i        ) {
  const h = courseHash(seed, i)
  if (h % 5 === 0 || !c.balls) return -1
  return (h >>> 3) % c.balls.lanes.length
}

/** Quais portas abrem (1) nesta semente: em cada fileira, `doorOpen[row]` sorteadas. */
function doorsOpen(c        , seed        )             {
  const out = new Uint8Array(c.doors.length)
  for (let row = 0; row < c.doorOpen.length; row++) {
    const idx           = []
    for (let i = 0; i < c.doors.length; i++) if (c.doors[i].row === row) idx.push(i)
    // embaralha pela semente e abre as primeiras
    for (let k = idx.length - 1; k > 0; k--) {
      const j = courseHash(seed ^ 0x5bd1e995, row * 31 + k) % (k + 1)
      const tmp = idx[k]
      idx[k] = idx[j]
      idx[j] = tmp
    }
    for (let k = 0; k < Math.min(c.doorOpen[row], idx.length); k++) out[idx[k]] = 1
  }
  return out
}

/** Ondas de parede na arena no tempo t (Paredes de Brasa); `out` é reaproveitado. */
function wallsAt(c        , seed        , t        , out            ) {
  out.length = 0
  const W = c.walls
  if (!W || t < W.t0) return out
  const span = (W.z0 - W.z1) / W.v0
  const i1 = Math.floor((t - W.t0) / W.every)
  const i0 = Math.max(0, Math.floor((t - W.t0 - span) / W.every))
  const n = Math.round((2 * W.hw) / W.seg)
  for (let i = i0; i <= i1; i++) {
    // depois de 40 s as ímpares chegam logo atrás da anterior (pares de paredes)
    const T = W.t0 + i * W.every - (i % 2 && W.t0 + i * W.every > 40 ? W.every * 0.45 : 0)
    const v = W.v0 + (W.v1 - W.v0) * Math.min(1, T / W.ramp)
    const z = W.z0 - v * (t - T)
    if (z < W.z1 || z > W.z0) continue
    const h = courseHash(seed ^ 0x3c6ef372, i)
    // as duas primeiras são de aquecimento (um vão); depois a semente escolhe
    const roll = i < 2 ? 0 : h % 6
    const kind            = roll === 5 ? 1 : roll >= 3 ? 2 : 0
    const g1 = (h >>> 3) % n
    const gaps = kind === 1 ? [] : kind === 2 ? [g1, (g1 + 3 + ((h >>> 9) % (n - 5))) % n] : [g1]
    out.push({ i, z, v, kind, gaps })
  }
  return out
}

/** Nível do perigo que sobe no tempo t (−∞ sem perigo). */
function riseAt(c        , t        ) {
  const R = c.rise
  if (!R) return -Infinity
  const u = Math.max(0, Math.min(1, (t - R.t0) / (R.t1 - R.t0)))
  return R.y0 + (R.y1 - R.y0) * u
}

/** Tampo de uma plataforma em z (a rampa, k = 2, sobe de y em z − hz a y2 em z + hz). */
function padTop(p     , z        ) {
  if (p.k !== 2) return p.y
  const u = Math.max(0, Math.min(1, (z - (p.z - p.hz)) / (2 * p.hz)))
  return p.y + (p.y2 - p.y) * u
}

/** Altura do tampo da rampa em z. */
function rampTop(c        , z        ) {
  const R = c.ramp
  if (!R) return DECK
  const u = Math.max(0, Math.min(1, (z - R.z0) / (R.z1 - R.z0)))
  return R.y0 + (R.y1 - R.y0) * u
}

/** Bolas rolando agora: [x, y, z, faixa, índice] por bola. */
function ballsAt(c        , seed        , t        , out          ) {
  out.length = 0
  const B = c.balls
  const R = c.ramp
  if (t < 0 || !B || !R) return out
  const span = (R.z1 - B.zEnd) / B.v
  const i1 = Math.floor(t / B.every)
  const i0 = Math.max(0, Math.floor((t - span) / B.every))
  for (let i = i0; i <= i1; i++) {
    const lane = ballLane(c, seed, i)
    if (lane < 0) continue
    const z = R.z1 - B.v * (t - i * B.every)
    if (z < B.zEnd || z > R.z1) continue
    // depois do pé da rampa a bola cai na água
    const y = z >= R.z0 ? rampTop(c, z) + B.R : R.y0 + B.R - ((R.z0 - z) / B.v) ** 2 * 12
    out.push(R.x + B.lanes[lane], y, z, lane, i)
  }
  return out
}

/** Ladrilho em pé (pode pisar) no tempo t, sabendo quando foi pisado (−1 = nunca). */
function tileUp(c        , stepped        , t        ) {
  return stepped < 0 || t - stepped < c.tileTime.warn || t - stepped >= c.tileTime.warn + c.tileTime.gone
}

/** O ponto (x, z) está em cima do ladrilho (com folga `e`)? */
function onTile(q      , x        , z        , e        ) {
  if (q.k === 1) return Math.hypot(x - q.x, z - q.z) <= q.h + e
  return Math.abs(x - q.x) <= q.h + e && Math.abs(z - q.z) <= q.h + e
}

/** Trecho da prova em que z está (0 largada, 1…n, n + 1 chegada) — para a interface. */
function sectionAt(c        , z        ) {
  if (z >= c.finishZ) return c.sections.length + 1
  let s = 0
  while (s < c.sections.length && z >= c.sections[s]) s++
  return s
}

/** Lugar de largada da vaga (2 filas de 4) e de volta a um posto. */
function spawnAt(c        , cp        , slot        ) {
  const p = c.checkpoints[Math.max(0, Math.min(c.checkpoints.length - 1, cp))]
  const col = slot % 4
  const row = Math.floor(slot / 4) % 2
  return { x: p.x + (col - 1.5) * Math.min(3.4, (p.w * 2) / 4), z: p.z - row * 2.6, y: p.y }
}

// ── sim/courses.ts ───────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/courses.ts — GINCANA 2.0 (2026-11-16): as FASES.
//
// "cidade" é o percurso de sempre (mm3d-47), com os MESMOS números. As outras
// seis são uma por Domínio (pedido do Alex: "6 fases como cada Domínio, com o
// tema de cada um", inspiradas nas provas de corrida dos party games de
// feijão — portas falsas, plataformas que andam, piso que cai, esteiras):
//
//  floresta — Floresta da Lua: cogumelos que lançam, raízes que giram, portas
//             de cipó, ponte de folhas que cai, troncos rolando.
//  canion   — Cânion: pedras flutuantes que andam, pêndulos de pedra, portões
//             que empurram, desfiladeiro com pistões de rocha, avalanche.
//  orbital  — Cidade Orbital: esteiras para trás, anéis que giram, hexágonos
//             que somem, barreiras de energia, esferas rolando.
//  forja    — Forja: martelos, pistões dos dois lados, esteiras de lado sobre
//             a lava, grade que cai, rochas derretidas.
//  fabrica  — Fábrica: esteira das prensas, engrenagens que giram, portas de
//             aço, prensas deslizantes, barris.
//  gelo     — Mar de Gelo: lago que escorrega, estalactites, placas de gelo
//             que andam, gelo fino, bolas de neve.
//
// O desenho de cada fase (cores, cenário, nomes) fica no front
// (engine/course-view.ts + engine/phase-themes.ts); aqui só a regra. Fase nova
// = uma função aqui + a entrada em COURSES + o tema + GINCANA_PHASES.

/** Largada (2 filas de 4) e a ponte larga: igual em todas as fases. */
function kitStart(k           ) {
  k.box(0, 0, 10, 8, 6, 7, 0)
  // ponte larga: quem larga na ponta e corre reto não cai na água
  k.box(0, 11.5, 7, 3.6, 0, 1, 0)
  for (const x of [-4, 0, 4]) k.logo(x, 12.5)
}

/** Subida de 36 m com bolas e o patamar da chegada; devolve o z da linha. */
function kitFinish(k           , z0        , every        , v        , R        ) {
  const z1 = z0 + 36
  k.slope(0, z0, z1, DECK, DECK + 6, 6, 0, 1, 5)
  k.balls = { lanes: [-4.3, -1.45, 1.45, 4.3], every, v, R, zEnd: z0 - 3 }
  k.box(0, z1 + 7.8, 9, 7.8, 1, 0, 6, 0, 1.6, DECK + 6)
  for (const [x, dz] of [[-4.3, 12], [0, 20], [4.3, 28]]                      ) k.logo(x, z0 + dz, DECK + (6 * dz) / 36)
  return z1 + 8.8
}

/** Rota pela subida até a linha. */
function routeFinish(add                                , z0        , finishZ        ) {
  for (let z = z0 + 1; z <= z0 + 35; z += 2.5) add(0, z)
  add(0, finishZ - 7)
  add(0, finishZ - 2)
  add(0, finishZ + 3)
}

/** Rota que só anda para +z (o computador mira o primeiro ponto adiante). */
function routeOf(fill                                                           ) {
  const out               = []
  fill((x, z, m) => out.push(m === undefined ? { x, z } : { x, z, m }))
  return out
}

// ═══ cidade — o percurso de sempre (mm3d-47) ═════════════════════════════════

function courseCidade()         {
  // Portas da Prefeitura (Gincana 3, G3-11): a corrida de abertura do programa. Três fileiras de portas
  // (as falsas são parede; a semente sorteia quais abrem), a ponte, o carrossel de duas barras, mais
  // duas fileiras (menos portas abertas), as passarelas com pêndulos e a subida com barris.
  const k = new CourseKit()
  kitStart(k)
  // ── 1. portas ──
  k.box(0, 39.8, 8, 24.7, 6, 7, 1)
  const ROWS1                     = [[26, 3], [38, 2], [50, 2]]
  for (const [z, open] of ROWS1) k.doorRow(0, z, 5, 3.2, 3.4, open)
  // ── 2. ponte e carrossel de duas barras ──
  k.box(0, 70, 2.4, 5.5, 6, 7, 2)
  k.disc(0, 85, 9.5, 0, 1, 2)
  k.post(0, 85, 0.8, DECK, DECK + 2.4, 1)
  k.sweep(0, 85, DECK + 0.55, 9.8, 0.32, 1.05, 0.4, true)
  k.box(0, 98.5, 5, 4, 6, 7, 2)
  // ── 3. mais portas (menos abertas) ──
  k.box(0, 120.5, 8, 18, 6, 7, 3)
  for (const z of [112, 126]) k.doorRow(0, z, 5, 3.2, 3.4, 2)
  // ── 4. passarelas com pêndulos ──
  const LANES = [-5, 0, 5]
  for (const x of LANES) k.beam(x, 138.5, x, 160, 1.5, 0, 1, 4)
  const swing = (x        , z        , ph        ) => k.swing(x, z, DECK + 9, 7.4, 1.1, 0.95, 2.2, ph)
  swing(-5, 144, 0)
  swing(0, 144, 2.1)
  swing(5, 144, 4.2)
  swing(-5, 153, 1.1)
  swing(0, 153, 3.3)
  swing(5, 153, 0.2)
  k.box(0, 165, 7, 5, 6, 7, 4)
  // ── 5. subida com barris e a chegada ──
  const z0 = 170
  const finishZ = kitFinish(k, z0, 0.95, 7.5, 1.2)
  for (const [x, z] of [[0, 18], [-4.8, 32], [4.8, 44], [0, 58], [0, 98.5], [-4.8, 118], [4.8, 132], [0, 165]]                      ) k.logo(x, z)
  return k.done({
    id: "cidade",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 61, y: DECK, w: 6 },
      { x: 0, z: 100, y: DECK, w: 5 },
      { x: 0, z: 136, y: DECK, w: 6 },
      { x: 0, z: 167, y: DECK, w: 5.5 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [15.1, 64.5, 102.5, 138.5, z0],
    minFinish: 22,
    route: (r) =>
      routeOf((add) => {
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(side * 0.8, 15.5)
        for (const z of [19, 22.5, 26.6, 30, 34, 38.6, 42, 46, 50.6, 54, 58, 62]) add(0, z)
        add(0, 66)
        add(0, 70)
        add(0, 74.5)
        add(side * 1.5, 77)
        add(side * 3.2, 81)
        add(side * 3.2, 86)
        add(side * 2, 90.5)
        add(0, 94.8)
        add(0, 98.5)
        for (const z of [103, 106, 108.5, 112.6, 116, 120, 122.5, 126.6, 130, 134]) add(0, z)
        const L = [-5, 0, 5][Math.floor(r(2) * 3)]
        add(L * 0.6, 136.5)
        add(L, 139)
        for (const z of [142, 146, 149, 152, 156, 159]) add(L, z)
        add(L, 160.8)
        add(L * 0.4, 163)
        add(0, 167)
        routeFinish(add, z0, finishZ)
      }),
  })
}

// ═══ floresta — Floresta da Lua ══════════════════════════════════════════════

/**
 * Gincana 3 (2026-11-18): MARÉ DO PÂNTANO — subida pela Floresta da Lua com o
 * pântano subindo atrás (0,3 m/s desde o "vai"). Quem o pântano alcança, ou cai
 * quando o posto de volta já está embaixo dele, está FORA. Cinco andares:
 * rampa dos troncos (3→9 m) · raízes que giram (9) · rampa curta e
 * vitórias-régias que andam (9→14) · rampa dos cocos-pêndulo (14→20) · ponte de
 * folhas que cai e a subida final (20→24).
 */
function courseFloresta()         {
  const k = new CourseKit()
  kitStart(k)
  const Y1 = DECK + 6
  const Y2 = Y1 + 5
  const Y3 = Y2 + 6
  const Y4 = Y3 + 4
  // ── 1. rampa dos troncos rolando ──
  k.slope(0, 15, 51, DECK, Y1, 6, 5, 1, 1)
  k.balls = { lanes: [-4.3, -1.45, 1.45, 4.3], every: 1.15, v: 6.5, R: 1.1, zEnd: 12 }
  k.box(0, 55, 7, 4, 5, 1, 1, 0, 1.4, Y1)
  // ── 2. raízes que giram (duas clareiras ligadas por pontes) ──
  k.box(0, 61.5, 1.8, 2.5, 4, 1, 2, 0, 1.2, Y1)
  const roots = (z        , w        , a0        , both         ) => {
    k.disc(0, z, 6.5, 4, 1, 2, Y1)
    k.post(0, z, 0.8, Y1, Y1 + 2.4, 5)
    k.sweep(0, z, Y1 + 0.55, 6.8, 0.34, w, a0, both)
  }
  roots(70.5, 1.1, 0, true)
  k.box(0, 79.5, 1.8, 2.5, 4, 1, 2, 0, 1.2, Y1)
  roots(88.5, -1.6, 1.2, false)
  k.box(0, 99, 6, 4, 5, 1, 2, 0, 1.4, Y1)
  // ── 3. rampa curta e vitórias-régias que andam ──
  k.slope(0, 103, 121, Y1, Y2, 4, 5, 1, 3)
  k.box(0, 123, 4, 2, 5, 1, 3, 0, 1.2, Y2)
  const LILY = [129, 134.5, 140]
  const lilies           = []
  LILY.forEach((z, i) => {
    const p = k.disc(0, z, 2.2, i % 2 ? 2 : 5, 1, 3, Y2)
    k.pads[p].mx = 4
    k.pads[p].mw = 1.1
    k.pads[p].mph = i * 1.6
    lilies.push(p)
  })
  k.box(0, 148, 6, 4, 5, 1, 3, 0, 1.4, Y2)
  // ── 4. rampa dos cocos (pêndulos) ──
  k.slope(0, 152, 176, Y2, Y3, 5, 5, 1, 4)
  let ph = 0
  for (const z of [158, 164, 170]) {
    const top = Y2 + ((z - 152) / 24) * (Y3 - Y2)
    for (const x of [-2.5, 2.5]) {
      k.swing(x, z, top + 9, 7.4, 1.1, 0.95, 2.1, ph)
      ph += 1.9
    }
  }
  k.box(0, 180, 6, 4, 5, 1, 4, 0, 1.4, Y3)
  // ── 5. ponte de folhas que cai e a subida final ──
  for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) k.tile((c - 1) * 2.9, 186.6 + r * 2.9, 1.3, (r + c) % 2 ? 5 : 1, 0, Y3)
  k.box(0, 209, 6, 3.5, 5, 1, 5, 0, 1.4, Y3)
  k.slope(0, 212.5, 230.5, Y3, Y4, 5, 5, 1, 5)
  k.box(0, 238, 9, 7.5, 1, 0, 6, 0, 1.6, Y4)
  for (const [x, z, y] of [[0, 55, Y1], [0, 99, Y1], [-3, 148, Y2], [3, 148, Y2], [0, 180, Y3], [0, 209, Y3]]                              ) k.logo(x, z, y)
  const finishZ = 238
  return k.done({
    id: "floresta",
    mode: "race",
    limit: 90,
    // 3 s de folga; depois 0,34 m/s (a largada afoga aos ~12 s, o topo aos ~74 s)
    rise: { y0: 0, y1: 26, t0: 3, t1: 79.5 },
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 55, y: Y1, w: 6 },
      { x: 0, z: 99, y: Y1, w: 5 },
      { x: 0, z: 148, y: Y2, w: 5 },
      { x: 0, z: 180, y: Y3, w: 5 },
    ],
    finishZ,
    finishY: Y4,
    sections: [15, 59, 103, 152, 184],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(0, 15.5)
        for (let z = 18; z <= 50; z += 2.5) add(0, z)
        for (const z of [53, 57, 60, 62.5]) add(0, z)
        for (let z = 65; z <= 76; z += 2) add(0, z)
        for (const z of [78, 80.5]) add(0, z)
        for (let z = 83; z <= 94; z += 2) add(0, z)
        for (const z of [97, 101]) add(0, z)
        for (let z = 104; z <= 120; z += 2.5) add(0, z)
        add(0, 122)
        add(0, 124.5)
        LILY.forEach((z, i) => add(0, z, lilies[i]))
        for (const z of [145, 149, 151]) add(0, z)
        const L = [-1.2, 0, 1.2][Math.floor(r(2) * 3)]
        for (let z = 153; z <= 175; z += 2.5) add(L, z)
        for (const z of [178, 182, 184.5]) add(0, z)
        for (let i = 0; i < 7; i++) add(0, 186.6 + i * 2.9)
        for (const z of [206.5, 210, 212]) add(0, z)
        for (let z = 214; z <= 230; z += 2) add(0, z)
        for (const z of [233, 236, finishZ + 3]) add(0, z)
      }),
  })
}

// ═══ clareira — Clareira da Lua (2ª fase da Floresta) ════════════════════════

/**
 * 2026-11-19 (pedido do Alex: a corrida dos discos do vídeo, com a cara da
 * Floresta). TOCOS QUE GIRAM — corrida em cinco trechos, copiando o TIPO de
 * prova (nada do traçado nem da arte do jogo do vídeo):
 *  1. campo de fatias de tronco que giram (cada uma para um lado), com troncos
 *     caídos entre elas para pular ou contornar;
 *  2. rampa das frutas: frutas gigantes descem por quatro faixas, pedras de
 *     musgo entre as faixas dão abrigo; no alto, as frutas saem de troncos ocos;
 *  3. tocos em escada que giram sobre o pântano, entre árvores gigantes;
 *  4. a vitória-régia gigante que gira, com sementes penduradas balançando;
 *  5. cogumelos que lançam para o alto do barranco e a subida da chegada.
 * As medidas que o desenho usa (troncos ocos, árvores, tocos) ficam em CLAREIRA.
 */
const CY1 = DECK + 5
const CY2 = CY1 + 5.6
const CY3 = CY2 + 2.2
const CY4 = CY3 + 2.5
const CLAREIRA = {
  Y1: CY1,
  Y2: CY2,
  Y3: CY3,
  Y4: CY4,
  /** Campo de discos: (x, z) de cada fatia de tronco (raio DISC_R). */
  discs: [
    [-8, 24], [0, 24], [8, 24],
    [-4, 33], [4, 33],
    [-8, 42], [0, 42], [8, 42],
    [-4, 51], [4, 51],
  ]                                          ,
  discR: 3.4,
  /** Troncos caídos: x, z, giro (meia largura 0,5, meio comprimento 1,6, topo 0,95 acima do chão). */
  logs: [
    [-8, 18.4, Math.PI / 2], [8, 18.4, Math.PI / 2],
    [-4, 28.5, Math.PI / 2], [4, 28.5, Math.PI / 2],
    [-10.2, 33, 0], [10.2, 33, 0], [0, 37.6, Math.PI / 2],
    [-4, 46.5, Math.PI / 2], [4, 46.5, Math.PI / 2],
    [-10.2, 51, 0], [10.2, 51, 0], [0, 55.6, Math.PI / 2],
  ]                                                  ,
  /** Rampa das frutas (DECK → Y1) e as faixas das frutas. */
  ramp: { z0: 65, z1: 105, hx: 8 },
  lanes: [-6, -2, 2, 6]                     ,
  /** Pedras de musgo entre as faixas: x, z (meia largura 0,75, meio comprimento 1,6, 1,5 m acima da rampa). */
  stones: [[-4, 72], [4, 72], [0, 80.5], [-4, 89], [4, 89], [0, 97.5]]                                          ,
  /** Troncos ocos de onde saem as frutas (um por faixa): centro do tronco deitado. */
  cannonZ: 107.5,
  cannonR: 1.15,
  cannonLen: 4,
  /** Tocos que giram: x, z, raio, quanto acima do chão Y1. */
  stumps: [
    [0, 120, 2.4, 0.9], [-2.2, 125.2, 2.4, 1.6], [2.2, 130.4, 2.4, 2.3], [-2.2, 135.6, 2.4, 3.0],
    [2.2, 140.8, 2.4, 3.7], [-1.8, 146, 2.4, 4.4], [1.4, 151.2, 2.6, 5.1],
  ]                                                          ,
  /** Árvores gigantes da escada de tocos (coluna que bloqueia). */
  trees: [[-6.8, 127.8], [6.8, 133], [-6.8, 143.4], [6.8, 148.6]]                                          ,
  treeR: 1.6,
  /** A vitória-régia gigante. */
  lily: { z: 181, r: 9 },
  /** Cogumelos que lançam (x, z). */
  shrooms: [[-3, 203.1], [3, 203.1]]                                          ,
}         

function courseClareira()         {
  const K = CLAREIRA
  const k = new CourseKit()
  kitStart(k)
  // ── 1. campo de fatias de tronco que giram ──
  k.box(0, 36.75, 12, 21.25, 5, 1, 1)
  const discs           = []
  K.discs.forEach(([x, z], i) => {
    const p = k.disc(x, z, K.discR, 1, 1, 1, DECK + 0.25)
    k.pads[p].d = 1.2
    // vizinhos giram ao contrário (o chão "torce" entre eles)
    k.pads[p].spin = (i % 2 ? -1 : 1) * (0.5 + (i % 3) * 0.08)
    discs.push(p)
    // o miolo da fatia: um toquinho que empurra
    k.post(x, z, 0.75, DECK + 0.25, DECK + 1.3, 2)
  })
  for (const [x, z, rot] of K.logs) k.box(x, z, 0.5, 1.6, 0, 1, 1, rot, 1.4, DECK + 0.95)
  // ── 2. rampa das frutas, com pedras de musgo entre as faixas ──
  k.box(0, 61.5, 8, 3.5, 5, 1, 1)
  const R = K.ramp
  const rampY = (z        ) => DECK + ((CY1 - DECK) * (z - R.z0)) / (R.z1 - R.z0)
  k.slope(0, R.z0, R.z1, DECK, CY1, R.hx, 5, 1, 2)
  k.balls = { lanes: K.lanes, every: 0.8, v: 7, R: 1.1, zEnd: 62.5 }
  for (const [x, z] of K.stones) k.box(x, z, 0.75, 1.6, 0, 1, 2, 0, 1.5 + 0.6, rampY(z) + 1.5)
  // ── 3. os troncos ocos no alto da rampa e os tocos que giram sobre o pântano ──
  k.box(0, 111, 8, 6, 5, 1, 3, 0, 1.4, CY1)
  // tronco oco deitado = parede reta (caixa de 2,3 × 4 m, alto demais para subir)
  for (const x of K.lanes) k.box(x, K.cannonZ, K.cannonR, K.cannonLen / 2, 0, 1, 3, 0, K.cannonR * 2 + 0.2, CY1 + K.cannonR * 2)
  K.stumps.forEach(([x, z, r, h], i) => {
    const p = k.disc(x, z, r, 1, 1, 3, CY1 + h)
    k.pads[p].d = CY1 + h
    k.pads[p].spin = (i % 2 ? 1 : -1) * 0.65
  })
  for (const [x, z] of K.trees) k.post(x, z, K.treeR, 0, CY1 + 12, 0)
  // ── 4. o barranco, a vitória-régia gigante que gira e as sementes penduradas ──
  k.box(0, 161.5, 7, 6.5, 5, 1, 4, 0, 6, CY2)
  k.box(0, 170.5, 2, 2.2, 5, 1, 4, 0, 1.2, CY2)
  const lily = k.disc(0, K.lily.z, K.lily.r, 5, 1, 4, CY2)
  k.pads[lily].spin = 0.32
  let ph = 0
  for (const z of [176.5, 181, 185.5]) {
    k.swing(0, z, CY2 + 9, 7.4, 1.25, 0.95, 2.05, ph)
    ph += 2.3
  }
  k.box(0, 192.6, 2, 2.6, 5, 1, 4, 0, 1.2, CY2)
  // ── 5. cogumelos que lançam e a subida da chegada ──
  k.box(0, 197.6, 6, 2.4, 5, 1, 5, 0, 1.4, CY2)
  for (const [x, z] of K.shrooms) k.post(x, z, 1.15, 0, CY2 + 0.2, 2, 13.5)
  k.box(0, 210, 7, 4, 5, 1, 5, 0, 2.6, CY3)
  k.slope(0, 214, 236, CY3, CY4, 6, 5, 1, 5)
  k.swing(-2.4, 222, CY3 + 10.5, 7.6, 1.2, 0.9, 1.9, 0.6)
  k.swing(2.4, 229, CY3 + 11.5, 7.6, 1.2, 0.9, 1.9, 2.9)
  k.box(0, 243.8, 9, 7.8, 1, 0, 6, 0, 1.6, CY4)
  for (const [x, z, y] of [[0, 13.5, DECK], [0, 61.5, DECK], [-4, 113.5, CY1], [4, 113.5, CY1], [0, 163, CY2], [0, 210, CY3]]                              ) k.logo(x, z, y)
  const finishZ = 236 + 8.8
  return k.done({
    id: "clareira",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 61.5, y: DECK, w: 6 },
      { x: 0, z: 113, y: CY1, w: 5 },
      { x: 0, z: 163, y: CY2, w: 5 },
      { x: 0, z: 198.2, y: CY2, w: 4 },
    ],
    finishZ,
    finishY: CY4,
    sections: [15.5, R.z0, 112, 168.5, 195],
    minFinish: 22,
    route: (r) =>
      routeOf((add) => {
        // 1. corta o campo pelos vãos entre as fatias (a semente escolhe o lado)
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(side * 1.2, 15.5)
        for (const [x, z] of [[side * 4, 19.5], [side * 4, 24], [side * 1.6, 28.5], [0, 33], [side * 1.6, 37.6], [side * 4, 42], [side * 4, 46.5], [side * 1.6, 51], [0, 55.6], [0, 59]]                      ) add(x, z)
        // 2. rampa: sobe pela coluna das pedras e desvia de lado quando a pedra está na frente
        const L = [-4, 0, 4][Math.floor(r(2) * 3)]
        for (let z = 64; z <= 104; z += 2) {
          const near = K.stones.some(([x, sz]) => x === L && Math.abs(z - sz) < 2.6)
          add(near ? L + (L >= 0 ? -1.3 : 1.3) * (L === 0 ? side : 1) : L, z)
        }
        // passa entre os troncos ocos pela abertura da coluna
        add(L, 103.5)
        add(L, 106)
        add(L, 109)
        add(L * 0.5, 112)
        add(0, 115.5)
        // 3. tocos, um a um
        for (const [x, z] of K.stumps) add(x, z)
        add(0, 156.5)
        add(0, 163)
        add(0, 168.5)
        add(0, 172)
        // 4. atravessa a vitória-régia pelo meio
        for (let z = 174; z <= 189; z += 2.5) add(0, z)
        add(0, 191)
        add(0, 194.5)
        add(0, 198.5)
        // 5. cogumelo e o barranco
        const S = K.shrooms[r(3) < 0.5 ? 0 : 1]
        add(S[0], S[1])
        add(S[0] * 0.5, 207)
        add(0, 211)
        for (let z = 214.5; z <= 235; z += 2.5) add(0, z)
        add(0, finishZ - 7)
        add(0, finishZ - 2)
        add(0, finishZ + 3)
      }),
  })
}

// ═══ canion — Cânion ═════════════════════════════════════════════════════════

/**
 * Gincana 3 (2026-11-18): PEDRAS QUE CAEM — sobrevivência no Cânion. Quatro
 * andares de pedras hexagonais flutuando sobre o abismo (15, 11, 7 e 3 m). Pedra
 * pisada treme 1 s e cai para sempre; quem cai do andar de baixo está FORA.
 * Acaba quando só sobra a vaga (metade) em pé ou em 2 min. Pular poupa pedra:
 * no ar ninguém derruba nada.
 */
const STONE_FLOORS = [DECK + 12, DECK + 8, DECK + 4, DECK]         
const STONE_R = 18
const STONE_GAP = 2.4

/** Centros da colmeia de um andar (a de baixo deslocada meia pedra, para quem cai de um buraco achar chão). */
function stoneCells(floor        ) {
  const out                     = []
  const dz = (STONE_GAP * Math.sqrt(3)) / 2
  const shift = floor % 2 ? STONE_GAP / 2 : 0
  for (let r = -10; r <= 10; r++) {
    for (let c = -9; c <= 9; c++) {
      const x = c * STONE_GAP + (r % 2 ? STONE_GAP / 2 : 0) + shift
      const z = r * dz
      if (Math.hypot(x, z) <= STONE_R - 0.5 * floor) out.push([x, z])
    }
  }
  return out
}

function courseCanion()         {
  const k = new CourseKit()
  STONE_FLOORS.forEach((y, f) => {
    for (const [x, z] of stoneCells(f)) {
      const ring = Math.floor(Math.hypot(x, z) / 4.6)
      const pair = [[2, 1], [0, 1], [5, 2], [6, 2]][f]
      k.tile(x, z, 1.27, pair[ring % 2], 1, y)
    }
  })
  const top = STONE_FLOORS[0]
  return k.done({
    id: "canion",
    mode: "survive",
    qualify: 0.5,
    limit: 120,
    tileTime: { warn: 1.0, gone: 1e6 },
    checkpoints: [{ x: 0, z: 1.3, y: top, w: 6 }],
    // arena: ninguém "chega" (a linha fica fora e no alto)
    finishZ: 40,
    finishY: 90,
    sections: [],
    minFinish: 1e6,
    route: () => [{ x: 0, z: 0 }],
  })
}

// ═══ orbital — Cidade Orbital ════════════════════════════════════════════════

/**
 * Gincana 3 (2026-11-18): VARREDURA — sobrevivência na Cidade Orbital. Um disco
 * no vazio que gira devagar e duas barras: a BAIXA (rente ao chão) se pula; a
 * ALTA (na altura do peito, girando para o outro lado) só passa quem MERGULHA
 * por baixo. As duas aceleram até o fim. Quem cai do disco está fora. Acaba
 * quando sobra a vaga (metade) ou em 100 s.
 */
function courseOrbital()         {
  const k = new CourseKit()
  const floor = k.disc(0, 0, 11, 6, 7, 1)
  k.pads[floor].spin = 0.16
  k.post(0, 0, 1.1, DECK, DECK + 3.2, 4)
  // barra baixa (pular): dois braços
  k.sweep(0, 0, DECK + 0.55, 11.6, 0.36, 0.85, 0, true, 0.02, 2.5)
  // barra alta (mergulhar): um braço, ao contrário, na altura do peito
  k.sweep(0, 0, DECK + 1.4, 11.6, 0.3, -0.6, Math.PI / 2, false, 0.014, 1.7)
  return k.done({
    id: "orbital",
    mode: "survive",
    qualify: 0.5,
    limit: 100,
    checkpoints: [{ x: 0, z: -6.5, y: DECK, w: 6 }],
    finishZ: 40,
    finishY: 90,
    sections: [],
    minFinish: 1e6,
    route: () => [{ x: 0, z: 0 }],
  })
}

// ═══ forja — Forja ═══════════════════════════════════════════════════════════

/**
 * Gincana 3 (2026-11-18): PAREDES DE BRASA — sobrevivência na Forja. Uma
 * arena quadrada de 22 m sobre a lava; ondas de parede de brasa vêm da frente
 * e atravessam tudo: parede alta com um ou dois vãos (ache o buraco) ou
 * mureta baixa (pule). Quem a parede empurra para fora cai na lava e está
 * FORA. As ondas ficam mais rápidas; acaba quando sobra a vaga ou em 100 s.
 */
function courseForja()         {
  const k = new CourseKit()
  k.box(0, 0, 11, 11, 0, 1, 1, 0, 1.6)
  return k.done({
    id: "forja",
    mode: "survive",
    qualify: 0.5,
    limit: 100,
    walls: { hw: 11, z0: 13, z1: -14, y: DECK, every: 3.2, t0: 2, v0: 3.4, v1: 11, ramp: 60, seg: 2.2, tall: 3.2, low: 0.9 },
    checkpoints: [{ x: 0, z: -2, y: DECK, w: 6 }],
    finishZ: 40,
    finishY: 90,
    sections: [],
    minFinish: 1e6,
    route: () => [{ x: 0, z: 0 }],
  })
}

// ═══ fabrica — Fábrica ═══════════════════════════════════════════════════════

/**
 * Gincana 3 (2026-11-18): CAÇA ÀS ENGRENAGENS — coleta na Fábrica. Chão de
 * 24 m sobre o óleo com duas esteiras (em sentidos contrários), duas prensas
 * que deslizam de lado e a plataforma do meio (1 m acima: pule ou suba na
 * beira). Engrenagens aparecem espalhadas e voltam 7 s depois de pegas; a
 * DOURADA (no alto do meio) vale 3. Quem cai no óleo volta ao meio (só perde
 * tempo). Em 75 s, classificam os que pegaram mais (metade).
 */
function courseFabrica()         {
  const k = new CourseKit()
  k.box(0, 0, 12, 12, 2, 1, 1, 0, 1.6)
  // esteiras (um tico acima do chão para valerem): a da esquerda leva para a frente, a da direita para trás
  const beltL = k.box(-8, 0, 1.6, 12, 0, 1, 1, 0, 1.6, DECK + 0.05)
  k.pads[beltL].bz = GINCANA.belt
  const beltR = k.box(8, 0, 1.6, 12, 0, 1, 1, 0, 1.6, DECK + 0.05)
  k.pads[beltR].bz = -GINCANA.belt
  // plataforma do meio (a dourada fica nela)
  k.disc(0, 0, 2.6, 4, 1, 1, DECK + 1)
  // prensas que deslizam de lado
  k.pusher(0, 7, 1.3, 1.3, 1.8, 8.5, 0, 0.85, 0)
  k.pusher(0, -7, 1.3, 1.3, 1.8, 8.5, 0, 0.85, Math.PI)
  // engrenagens: anel no chão, as das esteiras e a dourada
  let n = 0
  const add = (x        , z        , y        , v        , back        ) => k.gem(x, z, y + 0.9, v, 1 + (n++ % 6) * 0.6, back)
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8
    add(Math.sin(a) * 5, Math.cos(a) * 5, DECK, 1, 7)
  }
  for (const [x, z] of [[-4, 9.5], [4, -9.5], [-4, -9.5], [4, 9.5]]                      ) add(x, z, DECK, 1, 7)
  for (const z of [-8, 0, 8]) {
    add(-8, z, DECK + 0.05, 1, 7)
    add(8, z, DECK + 0.05, 1, 7)
  }
  add(0, 0, DECK + 1, 3, 12)
  return k.done({
    id: "fabrica",
    mode: "collect",
    qualify: 0.5,
    limit: 75,
    checkpoints: [{ x: 0, z: -3.6, y: DECK, w: 5 }],
    finishZ: 40,
    finishY: 90,
    sections: [],
    minFinish: 1e6,
    route: () => [{ x: 0, z: 0 }],
  })
}

// ═══ gelo — Mar de Gelo ══════════════════════════════════════════════════════

/**
 * Gincana 3 (2026-11-18, plano das 10 fases): ROLO DE GELO — sobrevivência no Mar de Gelo. Um cilindro de
 * gelo deitado (raio 7 m, 30 m de comprido) feito de 5 anéis; cada anel gira no seu sentido (e cada vez mais
 * rápido) e tem buracos que passam por baixo de quem está em cima. O chão anda de lado e escorrega para fora
 * na curva: corra contra o giro e troque de anel quando um buraco vier. Caiu no mar = FORA. Acaba quando
 * sobra a vaga (metade) ou em 100 s.
 */
const ROLL_R = 7
const ROLL_TOP = DECK + 4
function courseGelo()         {
  const k = new CourseKit()
  const W = [0.3, -0.34, 0.38, -0.32, 0.36, -0.29]
  k.drum(
    0,
    0,
    ROLL_TOP - ROLL_R,
    ROLL_R,
    W.map((w, i) => ({
      len: 5,
      w,
      // os buracos começam embaixo (o primeiro chega ao topo depois de ~8 s); dois anéis têm 3
      holes: (i % 3 === 1 ? [0, 2.1, 4.2] : [0, 3.1]).map((o) => ({ a: Math.PI + o + i * 0.7, half: 0.17 + (i % 2) * 0.03 })),
    })),
    0.6,
  )
  return k.done({
    id: "gelo",
    mode: "survive",
    qualify: 0.5,
    limit: 100,
    checkpoints: [{ x: 0, z: 16.3, y: ROLL_TOP, w: 3.4 }],
    finishZ: 40,
    finishY: 90,
    sections: [],
    minFinish: 1e6,
    route: () => [{ x: 0, z: 15 }],
  })
}

/** Todas as fases (montadas uma vez). */
/**
 * Relógio da Praça (Gincana 3, memória): grade 5×5 na praça do Centro. Os ladrilhos mostram
 * símbolos, apagam, o relógio da torre chama um e os ladrilhos dos outros caem por 3 s.
 * As rodadas encurtam; quem cai está fora.
 */
const MEM_GRID = { x: 0, z: 0, y: DECK, n: 5, size: 3.3, gap: 0.22, t0: 1.5 }
function courseRelogio()         {
  const k = new CourseKit()
  return k.done({
    id: "relogio",
    mode: "survive",
    qualify: 0.5,
    limit: 100,
    memory: MEM_GRID,
    checkpoints: [{ x: 0, z: 1.3, y: DECK, w: 6 }],
    finishZ: 40,
    finishY: 90,
    sections: [],
    minFinish: 1e6,
    route: () => [{ x: 0, z: 0 }],
  })
}

/**
 * Feira Rolante (Gincana 3, G3-12): corrida na feira do Centro. A rampa de entrada é uma ESTEIRA
 * FORTE que desce (5,5 m/s: parado, ela leva você de volta) e as barracas soltam melancias que
 * rolam rampa abaixo; depois, duas esteiras lado a lado em sentidos opostos com prensas que
 * empurram de lado, os martelos (pêndulos), o corredor de esteiras de lado e a subida.
 */
function courseFeira()         {
  const k = new CourseKit()
  kitStart(k)
  const Y = DECK + 3
  // ── 1. rampa-esteira com melancias ──
  const r1 = k.slope(0, 15.1, 40, DECK, Y, 6, 0, 1, 1)
  k.pads[r1].bz = -GINCANA.belt
  k.balls = { lanes: [-4.3, -1.45, 1.45, 4.3], every: 1.15, v: 6.5, R: 1.15, zEnd: 12 }
  k.box(0, 44, 7, 4, 6, 7, 1, 0, 1.4, Y)
  // ── 2. esteiras de mão dupla com prensas ──
  const fwd = k.box(-3, 63, 3, 15, 2, 0, 2, 0, 1.4, Y)
  k.pads[fwd].bz = GINCANA.belt
  const back = k.box(3, 63, 3, 15, 3, 0, 2, 0, 1.4, Y)
  k.pads[back].bz = -GINCANA.belt
  const PW = [1.5, 1.9, 1.3]
  ;[54, 63, 72].forEach((z, i) => k.pusher(-3, z, 1.6, 0.9, 2.2, 3, 0, PW[i], i * 1.3, Y))
  k.box(0, 82, 7, 4, 6, 7, 2, 0, 1.4, Y)
  // ── 3. martelos ──
  k.box(0, 99, 6, 13, 6, 7, 3, 0, 1.4, Y)
  const ham = (x        , z        , ph        ) => k.swing(x, z, Y + 9, 7.4, 1.1, 0.95, 2.2, ph)
  ham(-3, 92, 0)
  ham(3, 92, 2.4)
  ham(-3, 99, 1.2)
  ham(3, 99, 3.6)
  ham(-3, 106, 4.4)
  ham(3, 106, 0.6)
  k.box(0, 115, 7, 3, 6, 7, 3, 0, 1.4, Y)
  // ── 4. corredor de esteiras de lado ──
  for (let i = 0; i < 6; i++) {
    const p = k.box(0, 120 + i * 4, 6, 2, i % 2 ? 4 : 5, 0, 4, 0, 1.4, Y)
    k.pads[p].bx = (i % 2 ? -1 : 1) * GINCANA.belt
  }
  k.box(0, 146, 7, 4, 6, 7, 4, 0, 1.4, Y)
  // ── 5. subida e chegada ──
  const z0 = 150
  k.slope(0, z0, z0 + 24, Y, DECK + 6, 6, 0, 1, 5)
  k.box(0, z0 + 24 + 7.8, 9, 7.8, 1, 0, 6, 0, 1.6, DECK + 6)
  const finishZ = z0 + 24 + 8.8
  for (const [x, z] of [[0, 44], [0, 82], [-3, 115], [3, 115], [0, 146]]                      ) k.logo(x, z, Y)
  return k.done({
    id: "feira",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 45.5, y: Y, w: 6 },
      { x: 0, z: 83.5, y: Y, w: 6 },
      { x: 0, z: 116.5, y: Y, w: 6 },
      { x: 0, z: 147.5, y: Y, w: 6 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [15.1, 48, 86, 118, z0],
    minFinish: 22,
    route: (r) =>
      routeOf((add) => {
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(side * 0.8, 15.5)
        const F = [-1.45, 1.45, -3, 3][Math.floor(r(2) * 4)]
        for (let z = 18; z <= 39; z += 3) add(F, z)
        add(F * 0.5, 42)
        add(-3, 46)
        for (let z = 50; z <= 76; z += 2) add(-3, z)
        add(-1.5, 79)
        add(0, 83)
        const H = r(3) < 0.5 ? -3 : 3
        for (const z of [87, 90, 94, 97, 101, 104, 108, 111]) add(H, z)
        add(0, 115)
        for (let z = 118.5; z <= 142; z += 1.5) add(0, z)
        add(0, 146)
        for (let z = z0 + 1; z <= z0 + 23; z += 2.5) add(0, z)
        add(0, finishZ - 7)
        add(0, finishZ - 2)
        add(0, finishZ + 3)
      }),
  })
}

/**
 * Coroa da Torre (Gincana 3, G3-13): a FINAL do programa (vaga = 1). Rampa larga com bolas em cinco
 * faixas, martelos, dois portões giratórios (carrosséis de duas barras), a rampa final e a coroa
 * no alto do estrado da torre: só ganha quem PULA e pega a coroa (a linha fica 1,1 m acima do chão).
 */
function courseCoroa()         {
  const k = new CourseKit()
  kitStart(k)
  const Y1 = DECK + 5
  const Y2 = DECK + 8
  // ── 1. rampa larga com bolas ──
  k.slope(0, 15.1, 51, DECK, Y1, 8, 0, 1, 1)
  k.balls = { lanes: [-6, -3, 0, 3, 6], every: 0.8, v: 7, R: 1.3, zEnd: 12 }
  k.box(0, 55, 8, 4, 6, 7, 1, 0, 1.4, Y1)
  // ── 2. martelos ──
  k.box(0, 74, 6, 15, 6, 7, 2, 0, 1.4, Y1)
  const ham = (x        , z        , ph        ) => k.swing(x, z, Y1 + 9, 7.4, 1.1, 0.95, 2.2, ph)
  ham(-3, 66, 0)
  ham(3, 66, 2.4)
  ham(-3, 74, 1.2)
  ham(3, 74, 3.6)
  ham(-3, 82, 4.4)
  ham(3, 82, 0.6)
  // ── 3. portões giratórios ──
  const gate = (z        , w        , a0        ) => {
    k.disc(0, z, 7, 4, 1, 3, Y1)
    k.post(0, z, 0.8, Y1, Y1 + 2.4, 1)
    k.sweep(0, z, Y1 + 0.55, 7.3, 0.32, w, a0, true)
  }
  gate(96, 1.25, 0)
  k.box(0, 104, 2.4, 1.2, 6, 7, 3, 0, 1.4, Y1)
  gate(112, -1.45, 0.8)
  k.box(0, 122, 7, 3, 6, 7, 3, 0, 1.4, Y1)
  // ── 4. ladrilhos que caem (6 × 6) ──
  for (let r = 0; r < 6; r++) for (let c = 0; c < 6; c++) k.tile((c - 2.5) * 2.9, 127.6 + r * 2.9, 1.3, (r + c) % 2 === 0 ? 2 : 5, 0, Y1)
  k.box(0, 147.5, 7, 2.5, 6, 7, 4, 0, 1.4, Y1)
  // ── 5. rampa final e o estrado da coroa ──
  const z0 = 150
  k.slope(0, z0, z0 + 24, Y1, Y2, 6, 0, 1, 5)
  k.box(0, 176, 7, 2, 6, 7, 5, 0, 1.4, Y2)
  k.box(0, 183, 2.6, 5, 1, 0, 5, 0, 1.6, Y2)
  const finishZ = 182.5
  for (const [x, z] of [[0, 55], [-3, 70], [3, 78], [0, 122]]                      ) k.logo(x, z, Y1)
  return k.done({
    id: "coroa",
    qualify: 0.01,
    crown: true,
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 56.5, y: Y1, w: 7 },
      { x: 0, z: 88, y: Y1, w: 5 },
      { x: 0, z: 123, y: Y1, w: 6 },
      { x: 0, z: 148.5, y: Y1, w: 6 },
    ],
    finishZ,
    finishY: Y2 + 1.1,
    sections: [15.1, 59, 89, 125, z0],
    minFinish: 18,
    route: (r) =>
      routeOf((add) => {
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(side * 0.8, 15.5)
        const F = [-4.5, -1.5, 1.5, 4.5][Math.floor(r(2) * 4)]
        for (let z = 18; z <= 50; z += 3) add(F, z)
        add(F * 0.4, 54)
        const H = r(3) < 0.5 ? -3 : 3
        for (const z of [60, 63, 69, 71, 77, 79, 85, 88]) add(H, z)
        add(0, 89.5)
        add(side * 3, 93)
        add(side * 3, 99)
        add(0, 102.5)
        add(0, 105.5)
        add(-side * 3, 109)
        add(-side * 3, 115)
        add(0, 119.5)
        add(0, 123)
        const T = [-1.45, 1.45][Math.floor(r(4) * 2)]
        for (let i = 0; i < 6; i++) add(T, 127.6 + i * 2.9)
        add(0, 146)
        add(0, 148.5)
        for (let z = z0 + 1; z <= z0 + 23; z += 2.5) add(0, z)
        add(0, 176)
        add(0, 180)
        add(0, 185)
      }),
  })
}

const COURSES                               = {
  cidade: courseCidade(),
  floresta: courseFloresta(),
  clareira: courseClareira(),
  canion: courseCanion(),
  orbital: courseOrbital(),
  forja: courseForja(),
  fabrica: courseFabrica(),
  gelo: courseGelo(),
  relogio: courseRelogio(),
  feira: courseFeira(),
  coroa: courseCoroa(),
}

/** O percurso da fase (desconhecida = a de sempre). */
function courseOf(id                           )         {
  return (id && (COURSES                          )[id]) || COURSES.cidade
}

// ── sim/body.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/body.ts — GINCANA (mm3d-47): o corpo de quem corre.
//
// Passo fixo (GINCANA.step). Anda pela intenção (direção no mundo, 0–1),
// pula, MERGULHA (para a frente; desliza de barriga e levanta), é derrubado
// pelo que se mexe (barra, pêndulo, luva, bola, bloco: voa, cai, levanta), cai
// na água (volta ao último posto) e chega. Mesmo código no aparelho (o meu
// corpo e os computadores do treino) e na sala (os computadores da partida).
//
// Gincana 2.0 (2026-11-16, "como o Fall Guys"): SOBE NA BEIRA quando bate de
// lado numa plataforma pulando (segurando AGARRAR alcança mais alto), é levado
// pela plataforma que anda, pelo disco que gira e pela esteira, escorrega no
// gelo, é lançado pelo cogumelo, passa pela porta de verdade e bate na falsa,
// e é empurrado pelos blocos. Quem é AGARRADO (race.ts decide) anda devagar.

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
  /** Subindo na beira de uma plataforma. */
  CLIMB: 7,
}         

                         
              
           
           
           
            
            
            
                
                 
                                  
             
              
                                                                                      
               
                                                      
                
                                                
                 
                                                        
            
                                                
             
                                                                                            
             
                                                              
             
                                                                          
                
                                                                                     
                 
                                                     
               
                                                   
                
                                                                      
            
            
            
                                                                                                   
             
                                                                           
              
                                           
              
                                                                                          
              
               
                  
                                                                   
              
                                                   
             
             
             
             
             
             
 

                            
                                    
            
            
                                                       
               
               
                           
                
 

/** O mundo num instante: tempo da prova, semente, o percurso, os ladrilhos e as portas. */
                           
           
              
                
                                                                    
                     
                                                                 
                 
                                                          
                  
                                                                
                     
                                                                 
                    
 

/** Acontecimentos de um passo (para som, aviso e animação). */
                      
                                  
                                  
                                                                                             
                                                          
                                  
                                            
                                               
                               
                                             
                                    
                                   
                                                            
                                                 
                                 
                                                       

const IDLE_INTENT            = { mx: 0, mz: 0, jump: false, dive: false, grab: false }

function newWorld(course        , seed        , t        )           {
  return { t, seed, course, tiles: new Float64Array(course.tiles.length).fill(-1), balls: [], open: doorsOpen(course, seed), doors: new Float64Array(course.doors.length).fill(-1), gems: new Float64Array(course.gems.length).fill(-1) }
}

function newRunner(course        , slot        )         {
  const p = spawnAt(course, 0, slot)
  return {
    slot,
    x: p.x,
    y: p.y,
    z: p.z,
    vx: 0,
    vy: 0,
    vz: 0,
    facing: 0,
    ground: true,
    air: 0,
    mode: MODE.RUN,
    timer: 0,
    shield: 0,
    hitCool: 0,
    cp: 0,
    fin: -1,
    out: -1,
    pts: 0,
    launch: GINCANA.jumpV,
    jumpBuf: 0,
    boost: 0,
    took: course.logos.map(() => -99),
    px: p.x,
    py: p.y,
    pz: p.z,
    pad: -1,
    drum: -1,
    fric: 1,
    grab: -1,
    grabT: 0,
    grabCool: 0,
    held: 0,
    cx0: 0,
    cy0: 0,
    cz0: 0,
    cx1: 0,
    cy1: 0,
    cz1: 0,
  }
}

const EDGE = 0.12

/** (x, z) no referencial da caixa `p` no tempo t (centro e giro de agora). */
function padLocal(p     , t        , x        , z        ) {
  const sh = padShift(p, t)
  const dx = x - (p.x + sh.dx)
  const dz = z - (p.z + sh.dz)
  const a = padRot(p, t)
  const c = Math.cos(a)
  const s = Math.sin(a)
  return { lx: dx * c - dz * s, lz: dx * s + dz * c, cx: p.x + sh.dx, cz: p.z + sh.dz, c, s }
}

/**
 * Chão mais alto até `reach` sob (x, z): altura, ladrilho (−1), plataforma
 * (−1 = coluna/ladrilho) e o lançamento do cogumelo (0 = nenhum); y = −∞ sem chão.
 */
function groundUnder(w          , x        , z        , reach        ) {
  const C = w.course
  let best = -Infinity
  let tile = -1
  let pad = -1
  let bounce = 0
  for (let i = 0; i < C.pads.length; i++) {
    const p = C.pads[i]
    let top        
    if (p.k === 0) {
      const sh = padShift(p, w.t)
      if (Math.hypot(x - p.x - sh.dx, z - p.z - sh.dz) > p.r + EDGE) continue
      top = p.y
    } else {
      const L = padLocal(p, w.t, x, z)
      if (Math.abs(L.lx) > p.hx + EDGE || Math.abs(L.lz) > p.hz + EDGE) continue
      top = padTop(p, z)
    }
    if (top <= reach && top > best) {
      best = top
      tile = -1
      pad = i
      bounce = 0
    }
  }
  for (const q of C.posts) {
    if (q.y1 <= reach && q.y1 > best && Math.hypot(x - q.x, z - q.z) <= q.r + (q.b > 0 ? EDGE : 0)) {
      best = q.y1
      tile = -1
      pad = -1
      bounce = q.b
    }
  }
  for (let i = 0; i < C.tiles.length; i++) {
    const q = C.tiles[i]
    if (Math.abs(z - q.z) > q.h + 1 || !onTile(q, x, z, EDGE)) continue
    if (!tileUp(C, w.tiles[i], w.t)) continue
    if (q.y <= reach && q.y > best) {
      best = q.y
      tile = i
      pad = -1
      bounce = 0
    }
  }
  // Relógio da Praça: o ladrilho sob o pé, se estiver de pé agora
  const M = C.memory
  if (M && M.y <= reach && M.y > best) {
    const i = memIndexAt(M, x, z, EDGE)
    if (i >= 0 && memUp(M, w.seed, i, w.t)) {
      best = M.y
      tile = -1
      pad = -1
      bounce = 0
    }
  }
  // cilindros por último: só ganham se forem o chão mais alto
  let drum = -1
  for (let i = 0; i < C.drums.length; i++) {
    const g = drumAt(C.drums[i], x, z, w.t)
    if (g && g.top <= reach && g.top > best) {
      best = g.top
      tile = -1
      pad = -1
      bounce = 0
      drum = i
    }
  }
  return { y: best, tile, pad, bounce, drum }
}

/** Ondas de parede do passo (reaproveitado: nada de lixo a 60 Hz). */
const WALL_TMP             = []

/** Beira encontrada ao bater de lado: tampo e normal para fora. */
                 
             
            
            
 

/**
 * Empurra para fora das paredes (lado das plataformas acima do pé), das
 * colunas, das portas falsas e dos blocos. Devolve a beira mais baixa em que
 * bateu (para subir) e se um bloco empurrou forte.
 */
function pushWalls(b        , w          , out                   )               {
  const C = w.course
  const R = GINCANA.bodyR
  const H = GINCANA.bodyH
  const lift = b.y + GINCANA.stepUp
  let ledge               = null
  const sawLedge = (top        , nx        , nz        ) => {
    if (!ledge || top < ledge.top) ledge = { top, nx, nz }
  }
  for (const p of C.pads) {
    const top = padTop(p, b.z)
    if (top <= lift || top - p.d >= b.y + H) continue
    if (p.k === 0) {
      const sh = padShift(p, w.t)
      const cx = p.x + sh.dx
      const cz = p.z + sh.dz
      const dx = b.x - cx
      const dz = b.z - cz
      const d = Math.hypot(dx, dz)
      if (d >= p.r + R || d < 1e-6) continue
      b.x = cx + (dx / d) * (p.r + R)
      b.z = cz + (dz / d) * (p.r + R)
      sawLedge(top, dx / d, dz / d)
      continue
    }
    const L = padLocal(p, w.t, b.x, b.z)
    const ox = p.hx + R - Math.abs(L.lx)
    const oz = p.hz + R - Math.abs(L.lz)
    if (ox <= 0 || oz <= 0) continue
    let nx = L.lx
    let nz = L.lz
    let ux = 0
    let uz = 0
    if (ox < oz) {
      nx = Math.sign(L.lx || 1) * (p.hx + R)
      ux = Math.sign(L.lx || 1)
    } else {
      nz = Math.sign(L.lz || 1) * (p.hz + R)
      uz = Math.sign(L.lz || 1)
    }
    b.x = L.cx + nx * L.c + nz * L.s
    b.z = L.cz - nx * L.s + nz * L.c
    sawLedge(top, ux * L.c + uz * L.s, -ux * L.s + uz * L.c)
  }
  for (const q of C.posts) {
    if (q.y1 <= lift || q.y0 >= b.y + H) continue
    const dx = b.x - q.x
    const dz = b.z - q.z
    const d = Math.hypot(dx, dz)
    if (d >= q.r + R || d < 1e-6) continue
    b.x = q.x + (dx / d) * (q.r + R)
    b.z = q.z + (dz / d) * (q.r + R)
  }
  // ladrilhos caídos não seguram, e os de pé têm lado
  for (let i = 0; i < C.tiles.length; i++) {
    const q = C.tiles[i]
    if (q.y <= lift || Math.abs(b.z - q.z) > q.h + R + 0.2 || !tileUp(C, w.tiles[i], w.t) || q.y - 0.6 >= b.y + H) continue
    const lx = b.x - q.x
    const lz = b.z - q.z
    if (q.k === 1) {
      const d = Math.hypot(lx, lz)
      if (d >= q.h + R || d < 1e-6) continue
      b.x = q.x + (lx / d) * (q.h + R)
      b.z = q.z + (lz / d) * (q.h + R)
      continue
    }
    const ox = q.h + R - Math.abs(lx)
    const oz = q.h + R - Math.abs(lz)
    if (ox <= 0 || oz <= 0) continue
    if (ox < oz) b.x = q.x + Math.sign(lx || 1) * (q.h + R)
    else b.z = q.z + Math.sign(lz || 1) * (q.h + R)
  }
  // portas: a falsa é parede; a de verdade abre quando alguém encosta
  for (let i = 0; i < C.doors.length; i++) {
    const d = C.doors[i]
    const T = 0.3
    if (Math.abs(b.z - d.z) >= T + R || Math.abs(b.x - d.x) >= d.hw + R * 0.2 || b.y >= DECK + d.h || b.y + H <= DECK) continue
    if (w.open[i]) {
      if (w.doors[i] < 0) {
        w.doors[i] = w.t
        out?.push({ type: "door", i, open: true, slot: b.slot })
      }
      continue
    }
    if (w.doors[i] === -1) {
      // bateu numa falsa: marca (a interface mostra o "tum") só uma vez por porta
      w.doors[i] = -2
      out?.push({ type: "door", i, open: false, slot: b.slot })
    }
    // empurra para trás (de onde veio) — as portas da mesma fileira se encostam: nunca de lado
    b.z = d.z + Math.sign(b.z - d.z || -1) * (T + R)
    b.vz = 0
  }
  // Gincana 3: paredes de brasa — o pedaço sólido empurra para o lado de onde a pessoa está (o vão deixa passar)
  if (C.walls) {
    const Wl = C.walls
    const TH = 0.35
    for (const v of wallsAt(C, w.seed, w.t, WALL_TMP)) {
      if (Math.abs(b.z - v.z) >= TH + R || Math.abs(b.x) > Wl.hw + R) continue
      if (b.y >= Wl.y + (v.kind === 1 ? Wl.low : Wl.tall) || b.y + H <= Wl.y) continue
      let hit = v.kind === 1
      if (!hit) {
        const n = Math.round((2 * Wl.hw) / Wl.seg)
        for (let j = 0; j < n && !hit; j++) {
          if (v.gaps.includes(j)) continue
          const L = -Wl.hw + j * Wl.seg
          if (b.x + R * 0.8 > L && b.x - R * 0.8 < L + Wl.seg) hit = true
        }
      }
      if (!hit) continue
      const side = Math.sign(b.z - v.z) || -1
      b.z = v.z + side * (TH + R)
      if (side < 0 && b.vz > -v.v) b.vz = -v.v
    }
  }
  // blocos que andam e empurram
  for (const q of C.pushers) {
    if (b.y >= q.y + q.h || b.y + H <= q.y) continue
    const P = pusherAt(q, w.t)
    const lx = b.x - P.x
    const lz = b.z - P.z
    const ox = q.hx + R - Math.abs(lx)
    const oz = q.hz + R - Math.abs(lz)
    if (ox <= 0 || oz <= 0) continue
    let nx = 0
    let nz = 0
    if (ox < oz) {
      nx = Math.sign(lx || 1)
      b.x = P.x + nx * (q.hx + R)
    } else {
      nz = Math.sign(lz || 1)
      b.z = P.z + nz * (q.hz + R)
    }
    const vn = P.vx * nx + P.vz * nz
    if (vn > 1.5) {
      const mag = Math.max(5.5, vn * 1.35)
      knock(b, nx * mag, 3.5, nz * mag, "push", out)
    }
  }
  return ledge
}

/** Distância do ponto ao segmento vertical do corpo (x, z, de y+R a y+H−R). */
function sphereGap(b        , x        , y        , z        ) {
  const R = GINCANA.bodyR
  const cy = Math.max(b.y + R, Math.min(b.y + GINCANA.bodyH - R, y))
  return Math.hypot(b.x - x, b.z - z, cy - y)
}

function knock(b        , kx        , ky        , kz        , by                                                        , out                   ) {
  if (b.shield > 0 || b.hitCool > 0 || b.mode === MODE.WATER || b.mode === MODE.DONE) return
  b.vx = kx + b.vx * 0.15
  b.vz = kz + b.vz * 0.15
  b.vy = Math.max(b.vy, ky)
  b.ground = false
  b.air = GINCANA.coyote
  b.mode = MODE.KNOCK
  b.timer = GINCANA.stunT
  b.hitCool = 1.4
  b.grab = -1
  out?.push({ type: "hit", slot: b.slot, by })
}

/** O que se mexe: barras, pêndulos, luvas e bolas. */
function hazards(b        , w          , out                   ) {
  const C = w.course
  const R = GINCANA.bodyR
  // Gincana 3: mergulhando/deslizando o corpo fica baixo (0,7 m) e passa por baixo da barra alta
  const H = b.mode === MODE.DIVE || b.mode === MODE.SLIDE ? GINCANA.lowH : GINCANA.bodyH
  const t = w.t
  for (const s of C.sweepers) {
    const cx = b.x - s.x
    const cz = b.z - s.z
    if (Math.abs(cz) > s.len + 1 || Math.hypot(cx, cz) > s.len + R + s.r) continue
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
    const sp = sweeperW(s, t) * along
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
  for (const p of C.pendulums) {
    if (Math.abs(b.z - p.z) > p.R + R + 0.2) continue
    const q = pendulumAt(p, t)
    if (sphereGap(b, q.x, q.y, q.z) >= p.R + R) continue
    const dir = Math.abs(q.vx) > 1 ? Math.sign(q.vx) : Math.sign(b.x - q.x || 1)
    knock(b, dir * 9, 4.5, Math.sign(b.z - q.z || 1) * 1.5, "swing", out)
  }
  for (const g of C.gloves) {
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
  if (C.balls && w.balls.length && C.ramp && b.z > C.ramp.z0 - 5) {
    const bl = w.balls
    const BR = C.balls.R
    for (let k = 0; k < bl.length; k += 5) {
      if (sphereGap(b, bl[k], bl[k + 1], bl[k + 2]) >= BR + R) continue
      knock(b, Math.sign(b.x - bl[k] || 1) * 3, 5, -9, "ball", out)
    }
  }
}

/**
 * Caiu agora: fica FORA? Na sobrevivência sempre; com perigo que sobe, quando o
 * posto de volta já estará embaixo dele quando voltar.
 */
function fallOut(b        , C        , t        ) {
  if (C.mode === "survive") return true
  if (!C.rise) return false
  const p = C.checkpoints[Math.max(0, Math.min(C.checkpoints.length - 1, b.cp))]
  return p.y < riseAt(C, t + GINCANA.respawnT) + 0.3
}

/** Volta ao último posto (caiu na água ou ficou preso). */
function respawn(b        , course        ) {
  const p = spawnAt(course, b.cp, b.slot)
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
  b.pad = -1
  b.drum = -1
  b.fric = 1
  b.grab = -1
}

/** Leva quem está em cima da plataforma que anda, do disco que gira e da esteira. */
function carry(b        , w          , dt        ) {
  if (b.ground && b.drum >= 0) {
    // cilindro: o chão anda de lado (w·R·cos θ) e a curva escorrega para fora
    const d = w.course.drums[b.drum]
    const g = d ? drumAt(d, b.x, b.z, w.t) : null
    if (d && g) {
      b.x += drumSpeed(d.rings[g.ring], w.t) * (g.top - d.y) * dt
      b.x += Math.sin(g.th) * 3.2 * dt
    }
    return
  }
  if (!b.ground || b.pad < 0) return
  const p = w.course.pads[b.pad]
  if (!p) return
  if (p.mw !== 0) {
    const a = padShift(p, w.t - dt)
    const c = padShift(p, w.t)
    b.x += c.dx - a.dx
    b.z += c.dz - a.dz
  }
  if (p.spin !== 0) {
    const sh = padShift(p, w.t)
    const cx = p.x + sh.dx
    const cz = p.z + sh.dz
    const da = p.spin * dt
    // giro para o mesmo lado da caixa (padLocal usa a mesma convenção)
    const c = Math.cos(da)
    const s = Math.sin(da)
    const dx = b.x - cx
    const dz = b.z - cz
    b.x = cx + dx * c + dz * s
    b.z = cz - dx * s + dz * c
    b.facing += da
  }
  if (p.bx !== 0 || p.bz !== 0) {
    b.x += p.bx * dt
    b.z += p.bz * dt
  }
}

function stepRunner(b        , it           , w          , out                   , dt = GINCANA.step) {
  const T = GINCANA
  const C = w.course
  b.shield = Math.max(0, b.shield - dt)
  b.boost = Math.max(0, b.boost - dt)
  b.jumpBuf = it.jump ? T.jumpBuffer : Math.max(0, b.jumpBuf - dt)
  b.hitCool = Math.max(0, b.hitCool - dt)
  b.held = Math.max(0, b.held - dt)
  b.grabCool = Math.max(0, b.grabCool - dt)
  if (b.mode === MODE.WATER) {
    b.timer -= dt
    b.vy = Math.max(-3, b.vy - T.gravity * dt)
    b.y = Math.max(-6, b.y + b.vy * dt)
    b.vx *= 0.9
    b.vz *= 0.9
    // fora da prova: fica no fundo
    if (b.out >= 0) return
    if (b.timer <= 0) {
      respawn(b, C)
      out?.push({ type: "back", slot: b.slot })
    }
    return
  }
  if (b.mode === MODE.CLIMB) {
    // sobe na beira: primeiro para cima, depois para dentro
    b.timer -= dt
    const k = Math.max(0, Math.min(1, 1 - b.timer / T.climbT))
    const up = Math.min(1, k / 0.6)
    const inn = Math.max(0, (k - 0.45) / 0.55)
    b.x = b.cx0 + (b.cx1 - b.cx0) * inn
    b.z = b.cz0 + (b.cz1 - b.cz0) * inn
    b.y = b.cy0 + (b.cy1 - b.cy0) * (1 - (1 - up) * (1 - up))
    b.vx = b.vy = b.vz = 0
    if (b.timer <= 0) {
      b.mode = MODE.RUN
      b.ground = true
      b.air = 0
      b.y = b.cy1
      const g = groundUnder(w, b.x, b.z, b.y + 0.1)
      b.pad = g.pad
      b.drum = g.drum
    }
    return
  }
  carry(b, w, dt)
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
    let run = T.run * (b.boost > 0 ? T.boost : 1)
    if (b.held > 0) run *= T.heldRun
    if (b.grab >= 0) run *= T.grabRun
    const tx = mx * run
    const tz = mz * run
    const a = T.accel * (b.boost > 0 ? 1.3 : 1) * (b.ground ? b.fric : T.airControl) * dt
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
      b.grab = -1
      out?.push({ type: "dive", slot: b.slot })
    }
  } else if (b.ground) {
    // de barriga, levantando ou derrubado no chão: escorrega até parar (no gelo, bem mais)
    const k = Math.max(0, 1 - (b.mode === MODE.SLIDE ? 5 : 9) * Math.max(0.15, b.fric) * dt)
    b.vx *= k
    b.vz *= k
  }

  b.x += b.vx * dt
  b.z += b.vz * dt
  const wasAirY = b.y
  const ledge = pushWalls(b, w, out)
  hazards(b, w, out)

  // bateu de lado numa plataforma no ar, com o tampo ao alcance: sobe na beira
  if (ledge && !b.ground && (b.mode === MODE.RUN || b.mode === MODE.DIVE) && b.vy < 7) {
    const L = ledge         
    const high = L.top - wasAirY
    if (high > 0 && high <= (it.grab ? T.ledgeGrab : T.ledge)) {
      b.mode = MODE.CLIMB
      b.timer = T.climbT
      b.cx0 = b.x
      b.cz0 = b.z
      b.cy0 = b.y
      b.cx1 = b.x - L.nx * (GINCANA.bodyR + 0.25)
      b.cz1 = b.z - L.nz * (GINCANA.bodyR + 0.25)
      b.cy1 = L.top
      b.grab = -1
      out?.push({ type: "climb", slot: b.slot })
      return
    }
  }

  const wasGround = b.ground
  if (!b.ground) b.vy -= T.gravity * dt
  const prevY = b.y
  b.y += b.vy * dt
  // no chão sobe degrau; caindo, pega uma beirinha (borda que ficou um pouco acima do pé)
  // caindo rápido (andar de baixo, 6 m) o passo anda ~0,3 m: o chão cruzado neste passo também pega (Gincana 3)
  const reach = wasGround ? Math.max(prevY, b.y) + T.stepUp : b.vy <= 0 ? Math.max(b.y + 0.25, prevY) : Math.max(prevY, b.y) + 0.02
  const g = groundUnder(w, b.x, b.z, reach)
  if (b.vy <= 0 && g.y > -Infinity && b.y <= g.y + (wasGround ? 0.06 : 0)) {
    b.y = g.y
    b.vy = 0
    b.pad = g.pad
    b.drum = g.drum
    b.fric = g.pad >= 0 ? C.pads[g.pad].f : g.drum >= 0 ? C.drums[g.drum].f : 1
    if (!b.ground) {
      b.ground = true
      // pousou: mergulho vira deslize; derrubado fica no chão o resto do tempo
      if (b.mode === MODE.DIVE) {
        b.mode = MODE.SLIDE
        b.timer = T.slideT
      } else if (b.mode === MODE.KNOCK) b.timer = Math.max(b.timer, 0.35)
    }
    b.air = 0
    if (g.tile >= 0 && (w.tiles[g.tile] < 0 || w.t - w.tiles[g.tile] >= C.tileTime.warn + C.tileTime.gone)) {
      w.tiles[g.tile] = w.t
      out?.push({ type: "tile", i: g.tile })
    }
    if (g.bounce > 0) {
      // cogumelo: lança para cima (o embalo de lado fica)
      b.vy = g.bounce
      b.launch = g.bounce
      b.ground = false
      b.air = T.coyote
      b.pad = -1
      if (b.mode === MODE.SLIDE) b.mode = MODE.RUN
      out?.push({ type: "bounce", slot: b.slot })
    }
  } else if (wasGround && b.vy <= 0 && g.y > -Infinity && b.y - g.y <= 0.3) {
    // descendo a rampa: gruda
    b.y = g.y
    b.vy = 0
    b.pad = g.pad
    b.drum = g.drum
  } else {
    if (b.ground) b.vy = Math.min(b.vy, 0)
    b.ground = false
    b.air += dt
    b.pad = -1
    b.drum = -1
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

  // a água (ou o perigo que sobe: o pântano pega quem ficou com o pé embaixo)
  if ((b.y < T.waterY || b.y < riseAt(C, w.t) - 0.15) && b.mode !== MODE.DONE) {
    b.mode = MODE.WATER
    b.timer = T.respawnT
    b.vy = Math.min(b.vy, -2)
    b.grab = -1
    out?.push({ type: "splash", slot: b.slot, x: b.x, z: b.z })
    if (fallOut(b, C, w.t)) {
      b.out = w.t
      out?.push({ type: "out", slot: b.slot })
    }
    return
  }
  if (b.mode === MODE.DONE) return
  // logo da Freelandoo: turbo com brilho (cada corredor tem os seus)
  for (let i = 0; i < C.logos.length; i++) {
    const L = C.logos[i]
    if (Math.abs(b.z - L.z) > T.logoR + 0.5 || w.t - b.took[i] < T.logoBack) continue
    if (Math.hypot(b.x - L.x, b.z - L.z) > T.logoR || b.y > L.y + 0.6 || b.y + T.bodyH < L.y - 0.6) continue
    b.took[i] = w.t
    b.boost = T.boostT
    out?.push({ type: "logo", slot: b.slot, i })
  }
  const next = C.checkpoints[b.cp + 1]
  if (next && b.ground && b.z >= next.z - 1.5) {
    b.cp++
    out?.push({ type: "cp", slot: b.slot, cp: b.cp })
  }
  if (b.z >= C.finishZ && b.y >= C.finishY - 0.5) {
    b.fin = w.t
    b.mode = MODE.DONE
    b.timer = 0
    b.grab = -1
    out?.push({ type: "finish", slot: b.slot, t: w.t })
  }
}

/** Dois corpos não ocupam o mesmo lugar: cada um sai metade (o que só aparece sai tudo). */
function separate(a        , b        , moveB         ) {
  if (a.mode === MODE.WATER || b.mode === MODE.WATER) return false
  if (Math.abs(a.y - b.y) > GINCANA.bodyH * 0.8) return false
  const dx = a.x - b.x
  const dz = a.z - b.z
  const d = Math.hypot(dx, dz)
  const min = GINCANA.bodyR * 1.8
  if (d >= min) return false
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
  return true
}

/** Código de animação que viaja na rede (CLIMB usa o de levantar). */
const ANIM = { IDLE: 0, RUN: 1, AIR: 2, DIVE: 3, SLIDE: 4, KNOCK: 5, RISE: 6, WATER: 7, WIN: 8 }         

function runnerAnim(b        ) {
  switch (b.mode) {
    case MODE.DIVE:
      return ANIM.DIVE
    case MODE.SLIDE:
      return ANIM.SLIDE
    case MODE.RISE:
    case MODE.CLIMB:
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
// Cada computador segue a ROTA da fase (courses.ts; a semente escolhe o lado,
// a viga, a faixa), com um passo e uma HABILIDADE (0,55–0,95) que decide quanto
// ele erra: pula a barra cedo ou tarde, às vezes não espera o pêndulo, a luva
// ou o bloco. Gincana 2.0: o comportamento é genérico (vale em qualquer fase):
// pula buraco quando o chão acaba e há chão adiante, espera a plataforma que
// anda chegar, escolhe porta (as que já abriram primeiro; bateu numa falsa,
// tenta a vizinha), troca de ladrilho quando o da frente treme, escolhe a
// faixa sem bola na subida. Tudo determinístico pela semente e pelo tempo — a
// sala e o treino no aparelho decidem igual.

/** 0–1 determinístico. */
function botRand(seed        , a        , b = 0) {
  let h = (Math.imul(a + 0x632be5ab, 0x9e3779b1) ^ Math.imul(b + 0x1b873593, 0x85ebca77) ^ Math.imul(seed | 0, 0xc2b2ae35)) >>> 0
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

function newBrain(w          , seed        , slot        )           {
  const r = (k        ) => botRand(seed, slot, k)
  const route = w.course.route(r)
  const skill = 0.55 + r(6) * 0.4
  return { route, skill, pace: 0.86 + r(7) * 0.14, seed, slot, laneX: 0, jumpCool: 0, stuck: 0, lastZ: -99, waited: 0, divesFinish: r(8) < skill - 0.35, door: -1, bad: new Set(), tile: -1 }
}

/**
 * Gincana 3: o computador numa ARENA. Pedras que caem: vai para uma pedra firme
 * do mesmo andar, perto e com muitas vizinhas firmes (lugar para continuar), e
 * os mais hábeis pulam o tempo todo (no ar não derruba pedra). Tudo pela
 * semente e pelo tempo, igual na sala e no aparelho.
 */
/**
 * Barra chegando: prevê onde estarei (velocidade de agora) e onde a barra
 * estará; pula ~0,15 s antes do contato — ou, se a barra é ALTA (na altura do
 * peito, Gincana 3), mergulha por baixo, de frente para o eixo. Erro pela habilidade.
 */
function barJump(br          , b        , w          , it           ) {
  const C = w.course
  const t = w.t
  if (!b.ground || br.jumpCool > 0) return
  const vx = b.vx + (it.mx * GINCANA.run - b.vx) * 0.5
  const vz = b.vz + (it.mz * GINCANA.run - b.vz) * 0.5
  for (let i = 0; i < C.sweepers.length; i++) {
    const s = C.sweepers[i]
    if (Math.hypot(b.x - s.x, b.z - s.z) > s.len + 5) continue
    const high = s.y - s.r - b.y > 0.9
    let tc = -1
    for (let k = 1; k <= 30 && tc < 0; k++) {
      const h = k * 0.02
      const px = b.x + vx * h - s.x
      const pz = b.z + vz * h - s.z
      const a = sweeperAngle(s, t + h)
      const dx = Math.sin(a)
      const dz = Math.cos(a)
      const along = Math.max(s.both ? -s.len : 0, Math.min(s.len, px * dx + pz * dz))
      if (Math.abs(along) < 0.9) continue
      if (Math.hypot(px - dx * along, pz - dz * along) < s.r + GINCANA.bodyR + 0.08) tc = h
    }
    if (tc < 0) continue
    const span = s.both ? Math.PI : Math.PI * 2
    const pass = Math.floor(sweeperAngle(s, t) / span)
    const err = (botRand(br.seed, br.slot * 31 + i, pass) - 0.5) * (1 - br.skill) * 0.3
    if (high) {
      // mergulha um pouco antes (o mergulho leva ~0,1 s para baixar), de frente para o eixo
      if (tc < 0.3 + err && tc > 0.06) {
        const ex = s.x - b.x
        const ez = s.z - b.z
        const d = Math.hypot(ex, ez) || 1
        it.mx = ex / d
        it.mz = ez / d
        it.dive = true
        br.jumpCool = 0.9
      }
    } else if (tc < 0.2 + err && tc > 0.04) {
      it.jump = true
      br.jumpCool = 0.7
    }
  }
}

/** Ondas de parede vistas pelo computador (reaproveitado). */
const BOT_WALLS             = []

/** Vizinhas de cada pedra (mesmo andar, até 2,6 m), calculadas uma vez por percurso. */
const TILE_NB = new WeakMap                    ()
function tileNeighbors(C        ) {
  let nb = TILE_NB.get(C)
  if (nb) return nb
  nb = C.tiles.map((q, i) => {
    const out           = []
    for (let j = 0; j < C.tiles.length; j++) {
      const p = C.tiles[j]
      if (j !== i && Math.abs(p.y - q.y) < 0.1 && Math.hypot(p.x - q.x, p.z - q.z) < 2.6) out.push(j)
    }
    return out
  })
  TILE_NB.set(C, nb)
  return nb
}

function arenaIntent(br          , b        , w          , it           )            {
  const C = w.course
  const t = w.t
  let tx = b.x
  let tz = b.z
  if (C.tiles.length) {
    const firm = (i        ) => w.tiles[i] < 0 && Math.abs(C.tiles[i].y - b.y) < 0.5
    const cur = br.tile
    const reached = cur >= 0 && Math.hypot(C.tiles[cur].x - b.x, C.tiles[cur].z - b.z) < 0.8
    if (b.ground && (cur < 0 || reached || !firm(cur))) {
      let best = -1
      let bestScore = -Infinity
      const noise = 0.4 + (1 - br.skill) * 2.5
      for (let i = 0; i < C.tiles.length; i++) {
        if (!firm(i)) continue
        const q = C.tiles[i]
        const d = Math.hypot(q.x - b.x, q.z - b.z)
        if (d < 1.8 || d > 7.5) continue
        let n = 0
        for (const j of tileNeighbors(C)[i]) if (firm(j)) n++
        const score = n - d * 0.25 - Math.hypot(q.x, q.z) * 0.06 + botRand(br.seed, br.slot * 13 + i, Math.floor(t)) * noise
        if (score > bestScore) {
          bestScore = score
          best = i
        }
      }
      // nada perto: a pedra firme mais perto do andar, longe que seja
      if (best < 0) {
        let bd = Infinity
        for (let i = 0; i < C.tiles.length; i++) {
          if (!firm(i)) continue
          const d = Math.hypot(C.tiles[i].x - b.x, C.tiles[i].z - b.z)
          if (d < bd) {
            bd = d
            best = i
          }
        }
      }
      br.tile = best
    }
    if (br.tile >= 0) {
      tx = C.tiles[br.tile].x
      tz = C.tiles[br.tile].z
    }
    // pula para poupar pedra (os mais hábeis quase sempre)
    if (b.ground && br.jumpCool <= 0 && botRand(br.seed, br.slot, Math.floor(t * 4)) < br.skill * 1.2 - 0.25) {
      it.jump = true
      br.jumpCool = 0.2
    }
  }
  // Paredes de Brasa: fica na frente da arena; a próxima onda chegando, vai para o vão (ou pula a mureta)
  if (C.walls) {
    const Wl = C.walls
    const list = wallsAt(C, w.seed, t, BOT_WALLS)
    let next                  = null
    for (const v of list) if (v.z > b.z - 0.1 && (!next || v.z < next.z)) next = v
    tx = Math.max(-Wl.hw + 2, Math.min(Wl.hw - 2, b.x))
    tz = 2.5
    if (next) {
      const eta = (next.z - b.z) / next.v
      // os menos hábeis percebem tarde e às vezes escolhem o vão errado
      const notice = 2.6 - (1 - br.skill) * 1.6
      if (next.kind === 1) {
        const err = (botRand(br.seed, br.slot * 17, next.i) - 0.5) * (1 - br.skill) * 0.35
        if (b.ground && br.jumpCool <= 0 && eta < 0.22 + err && eta > 0.02) {
          it.jump = true
          br.jumpCool = 0.5
        }
      } else if (eta < notice) {
        const n = Math.round((2 * Wl.hw) / Wl.seg)
        let g = next.gaps[0]
        for (const q of next.gaps) if (Math.abs(-Wl.hw + (q + 0.5) * Wl.seg - b.x) < Math.abs(-Wl.hw + (g + 0.5) * Wl.seg - b.x)) g = q
        if (next.i >= 3 && botRand(br.seed, br.slot * 19, next.i) < (1 - br.skill) * 0.35) g = g > 0 && (g === n - 1 || botRand(br.seed, br.slot * 23, next.i) < 0.5) ? g - 1 : g + 1
        tx = -Wl.hw + (g + 0.5) * Wl.seg
        // parado no vão esperando a parede passar
        tz = b.z
      }
    }
  }
  // Caça às Engrenagens: a engrenagem que vale mais pela distância (a dourada atrai); sobe na plataforma pulando
  if (C.gems.length) {
    let best = -1
    let bestScore = -Infinity
    for (let k = 0; k < C.gems.length; k++) {
      const g = C.gems[k]
      // a que vai voltar logo também serve (chega quando ela aparece)
      const back = w.gems[k] < 0 ? g.t0 - t : w.gems[k] + g.back - t
      const d = Math.hypot(g.x - b.x, g.z - b.z)
      const wait = Math.max(0, back - d / GINCANA.run)
      if (wait > 1.5) continue
      const score = g.v / (d + 3 + wait * 6) + botRand(br.seed, br.slot * 7 + k, Math.floor(t / 2)) * 0.12 * (1.4 - br.skill)
      if (score > bestScore) {
        bestScore = score
        best = k
      }
    }
    if (best >= 0) {
      const g = C.gems[best]
      tx = g.x
      tz = g.z
      // está no alto (plataforma do meio): pula perto da beira
      const d = Math.hypot(g.x - b.x, g.z - b.z)
      if (g.y - 0.9 > b.y + 0.5 && d < 3.6 && b.ground && br.jumpCool <= 0) {
        it.jump = true
        br.jumpCool = 0.6
      }
    } else {
      tx = 0
      tz = 0
    }
  }
  // Rei do Iceberg: vai para o topo (um lugar dentro dele que muda de tempo em tempo); pula na beira
  if (C.zone) {
    const Z = C.zone
    const a = botRand(br.seed, br.slot, 700 + Math.floor(t / 4)) * Math.PI * 2
    const rr = botRand(br.seed, br.slot, 800 + Math.floor(t / 4)) * (Z.r - 1.2)
    tx = Z.x + Math.sin(a) * rr
    tz = Z.z + Math.cos(a) * rr
    const d = Math.hypot(Z.x - b.x, Z.z - b.z)
    // ainda embaixo: pula perto da beira (o mais fraco erra a hora às vezes)
    if (b.y < Z.y - 0.4 && d < Z.r + 1.4 + br.skill * 0.6 && b.ground && br.jumpCool <= 0) {
      it.jump = true
      br.jumpCool = 0.5 + (1 - br.skill) * 0.6
    }
  }
  // Rolo de Gelo: procura o ponto (5 de lado × o anel e os vizinhos) que fica livre por mais tempo,
  // descontado o tempo para chegar lá (quem é bom enxerga mais longe); pula o buraco que chega no pé
  if (C.drums.length) {
    const d = C.drums[0]
    const sight = 1.6 + br.skill * 2.4
    const zOf           = []
    let z0 = d.z0
    let here = 0
    for (let q = 0; q < d.rings.length; q++) {
      zOf.push(z0 + d.rings[q].len / 2)
      if (b.z >= z0 && b.z <= z0 + d.rings[q].len) here = q
      z0 += d.rings[q].len
    }
    let bestScore = -Infinity
    for (let q = Math.max(0, here - 1); q <= Math.min(d.rings.length - 1, here + 1); q++) {
      for (let px = -3; px <= 3; px += 1.5) {
        const x = d.x + px
        const z = zOf[q] + ((br.slot % 4) - 1.5) * 0.6
        const travel = Math.hypot(x - b.x, z - b.z) / GINCANA.run
        // o caminho até lá (o meio) também precisa estar de pé agora
        if (!drumAt(d, (x + b.x) / 2, (z + b.z) / 2, t + travel / 2)) continue
        let sf = sight + 0.5
        for (let s = travel; s <= sight; s += 0.15) {
          if (!drumAt(d, x, z, t + s)) {
            sf = s
            break
          }
        }
        const sc = sf - travel - Math.abs(px) * 0.08 + (q === here ? 0.3 : 0) + botRand(br.seed, br.slot * 9 + q * 5 + px, Math.floor(t / 2)) * 0.4 * (1.4 - br.skill)
        if (sc > bestScore) {
          bestScore = sc
          tx = x
          tz = z
        }
      }
    }
    if (bestScore === -Infinity) {
      tx = d.x
      tz = zOf[here]
    }
    // buraco já debaixo do pé: pula
    if (b.ground && br.jumpCool <= 0 && !drumAt(d, b.x, b.z, t + 0.12)) {
      it.jump = true
      br.jumpCool = 0.6
    }
  }
  // Relógio da Praça: decorando, passeia por um ladrilho sorteado da rodada; o relógio chamou, corre
  // para o ladrilho mais perto do símbolo (depois de reagir). Às vezes "esquece" e vai para um errado:
  // mais nas rodadas do fim e nos menos hábeis.
  if (C.memory) {
    const M = C.memory
    const st = memState(M, t)
    const N = M.n * M.n
    const roam = memTile(M, Math.floor(botRand(br.seed, br.slot * 7, 900 + st.r * 3 + (st.ph >= 3 ? 1 : 0)) * N) % N)
    tx = roam.x
    tz = roam.z
    const react = 0.25 + (1 - br.skill) * 0.9
    const since = st.ph === 3 ? memCall(st.r) - st.left : st.ph === 4 ? 99 : -1
    if (since >= react) {
      const sym = memSymbols(M, w.seed, st.r)
      const forget = 0.015 + st.r * 0.03 + (1 - br.skill) * 0.1
      const target = botRand(br.seed, br.slot * 31, 950 + st.r) < forget ? (memTarget(w.seed, st.r) + 1 + Math.floor(botRand(br.seed, br.slot, 970 + st.r) * 5)) % 6 : memTarget(w.seed, st.r)
      let bd = Infinity
      for (let i = 0; i < N; i++) {
        if (sym[i] !== target) continue
        const q = memTile(M, i)
        const dd = Math.hypot(q.x - b.x, q.z - b.z)
        if (dd < bd) {
          bd = dd
          tx = q.x
          tz = q.z
        }
      }
    }
  }
  // arena sem pedras (Varredura): um lugar a ~5 m do eixo, que muda de tempo em tempo
  if (!C.tiles.length && !C.gems.length && !C.zone && !C.drums.length && !C.memory && C.sweepers.length) {
    const a = botRand(br.seed, br.slot, 500 + Math.floor(t / 6)) * Math.PI * 2
    const rr = 3.5 + botRand(br.seed, br.slot, 600 + Math.floor(t / 6)) * 3.5
    tx = C.sweepers[0].x + Math.sin(a) * rr
    tz = C.sweepers[0].z + Math.cos(a) * rr
  }
  const dx = tx - b.x
  const dz = tz - b.z
  const d = Math.hypot(dx, dz)
  const go = br.pace * Math.min(1, d / 0.8)
  if (d > 1e-3) {
    it.mx = (dx / d) * go
    it.mz = (dz / d) * go
  }
  barJump(br, b, w, it)
  return it
}

/** Escolhe a porta da fileira à frente: aberta (alguém passou) > desconhecida mais perto > a sorteada. */
function pickDoor(br          , b        , w          , row        ) {
  const C = w.course
  let best = -1
  let bestScore = -Infinity
  for (let i = 0; i < C.doors.length; i++) {
    const d = C.doors[i]
    if (d.row !== row || br.bad.has(i)) continue
    let score = -Math.abs(d.x - b.x) * 0.25 + botRand(br.seed, br.slot * 13 + i, row) * 1.5
    if (w.doors[i] >= 0) score += 6 * br.skill + 1
    if (w.doors[i] === -2) score -= 20
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  return best
}

/** Intenção do computador neste passo. */
function botIntent(br          , b        , w          , dt = GINCANA.step)            {
  const C = w.course
  const it            = { mx: 0, mz: 0, jump: false, dive: false, grab: false }
  br.jumpCool = Math.max(0, br.jumpCool - dt)
  if (b.mode !== MODE.RUN || w.t < 0) return it
  // Gincana 3: arena (sobrevivência, coleta, zona) — sem rota
  if (C.mode !== "race") return arenaIntent(br, b, w, it)
  const t = w.t
  // próximo ponto: o primeiro adiante (as rotas só andam para +z)
  let wi = 0
  while (wi < br.route.length - 1 && br.route[wi].z < b.z + 0.6) wi++
  const wp = br.route[wi]
  let tx = wp.x
  let tz = wp.z
  let go = br.pace

  // plataforma que anda: mira onde ela está; espera ela chegar antes de passar
  if (wp.m !== undefined) {
    const p = C.pads[wp.m]
    const sh = padShift(p, t)
    tx = p.x + sh.dx
    const edge = p.z + sh.dz - p.hz
    const lead = (botRand(br.seed, br.slot * 7 + wp.m, Math.floor(t / 3)) - 0.5) * (1 - br.skill) * 2.5
    if (b.z < edge && edge - b.z < 2.2 && Math.abs(tx + lead - b.x) > 1.4) go = 0
    // em cima de uma que anda: acompanha a de baixo até alinhar
    if (go === 0 && b.pad >= 0 && C.pads[b.pad].mw !== 0) {
      const q = C.pads[b.pad]
      tx = q.x + padShift(q, t).dx
    }
  }

  // portas: na fileira à frente, mira a escolhida; bateu numa falsa, troca
  if (C.doors.length) {
    for (let row = 0; row < C.doorOpen.length; row++) {
      let dz = Infinity
      for (const d of C.doors) if (d.row === row) dz = d.z
      if (b.z > dz + 0.5 || dz - b.z > 7) continue
      if (br.door < 0 || C.doors[br.door].row !== row || br.bad.has(br.door)) br.door = pickDoor(br, b, w, row)
      // a escolhida se revelou falsa (alguém bateu) ou eu estou parado na frente dela
      if (br.door >= 0 && w.doors[br.door] === -2 && !w.open[br.door] && botRand(br.seed, br.slot, row * 5 + br.door) < br.skill + 0.2) {
        br.bad.add(br.door)
        br.door = pickDoor(br, b, w, row)
      }
      if (br.door >= 0) {
        const d = C.doors[br.door]
        tx = d.x
        tz = Math.max(tz, d.z + 1.2)
        if (dz - b.z < 0.9 && Math.abs(b.x - d.x) < d.hw && !w.open[br.door]) {
          br.bad.add(br.door)
          br.door = pickDoor(br, b, w, row)
        }
      }
      break
    }
  }

  // ladrilhos: escolhe o próximo em pé (e não tremendo), perto da reta
  if (C.tiles.length && !b.ground && br.tile >= 0) {
    // no ar: segue mirando o ladrilho escolhido (freia no ar se for passar)
    tx = C.tiles[br.tile].x
    tz = C.tiles[br.tile].z
  } else if (C.tiles.length && b.ground) {
    let near = false
    for (const q of C.tiles) if (Math.abs(q.z - b.z) < 3.2 && Math.abs(q.x - b.x) < 9) near = true
    if (near) {
      const ok = (i        ) => {
        const s = w.tiles[i]
        return tileUp(C, s, t + 0.35) && !(s >= 0 && t - s < 0.8)
      }
      let under = -1
      for (let i = 0; i < C.tiles.length; i++) if (onTile(C.tiles[i], b.x, b.z, 0) && Math.abs(C.tiles[i].y - b.y) < 0.3) under = i
      const cur = br.tile
      const curQ = cur >= 0 ? C.tiles[cur] : null
      if (!curQ || curQ.z < b.z + 0.8 || !ok(cur)) {
        let best = -1
        let bestScore = -Infinity
        for (let i = 0; i < C.tiles.length; i++) {
          const q = C.tiles[i]
          const ahead = q.z - b.z
          if (ahead < 1.2 || ahead > 3.6 || Math.abs(q.x - b.x) > 4.5 || !ok(i)) continue
          const score = -Math.abs(q.x - b.x) - Math.abs(q.x) * 0.15 + botRand(br.seed, br.slot, i) * 0.8
          if (score > bestScore) {
            bestScore = score
            best = i
          }
        }
        // nada firme adiante e estou num ladrilho (que já treme): o firme mais perto, para qualquer lado
        // chão firme (plataforma) logo à frente: segue a rota
        const solid = groundUnder(w, b.x, b.z + 2.4, b.y + 0.5)
        if (best < 0 && solid.pad >= 0 && solid.y > b.y - 0.5) under = -2
        if (best < 0 && under >= 0) {
          let bd = Infinity
          for (let i = 0; i < C.tiles.length; i++) {
            if (i === under || !ok(i)) continue
            const dd = Math.hypot(C.tiles[i].x - b.x, C.tiles[i].z - b.z)
            if (dd < 3.8 && dd < bd) {
              bd = dd
              best = i
            }
          }
        }
        br.tile = best
      }
      if (br.tile >= 0) {
        tx = C.tiles[br.tile].x
        tz = C.tiles[br.tile].z
      } else if (under === -1) {
        // na beira, sem ladrilho firme à frente: espera voltarem
        let ahead = false
        for (const q of C.tiles) if (q.z - b.z > 0.5 && q.z - b.z < 3.2) ahead = true
        if (ahead && botRand(br.seed, br.slot, 900 + Math.floor(t)) < br.skill + 0.25) go = 0
      }
    } else br.tile = -1
  }

  // subida: a faixa mais livre das bolas que vêm
  if (C.ramp && C.balls && b.z > C.ramp.z0 - 2 && b.z < C.ramp.z1 + 0.5) {
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
        if (dx < C.balls.R + 1) score -= (10 - ahead) * (C.balls.R + 1 - dx)
      }
      if (score > bestScore) {
        bestScore = score
        best = gx
      }
    }
    // os menos hábeis demoram a perceber
    if (botRand(br.seed, br.slot, Math.floor(t * 4)) < br.skill) br.laneX = best
    tx = C.ramp.x + br.laneX
  }

  // esteira: corre contra ela (mira um pouco além)
  if (b.pad >= 0) {
    const p = C.pads[b.pad]
    if (p.bx !== 0) tx -= p.bx * 0.35
  }

  let dx = tx - b.x
  let dz = tz - b.z
  const d = Math.hypot(dx, dz) || 1
  dx /= d
  dz /= d
  // desvia das colunas (pilar, frade, caixa) — o cogumelo é chão
  for (const q of C.posts) {
    if (q.b > 0 || q.y1 <= b.y + GINCANA.stepUp || q.y0 > b.y + 1) continue
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
  it.mx = (dx / m) * go
  it.mz = (dz / m) * go
  const vRun = GINCANA.run * Math.max(0.3, br.pace)

  // pêndulo adiante na mesma linha: espera passar (os menos hábeis às vezes vão)
  for (let i = 0; i < C.pendulums.length; i++) {
    const p = C.pendulums[i]
    const ahead = p.z - b.z
    // decide entre 4,6 e 2,4 m (freia em ~0,6 m e fica fora do alcance); mais perto, vai
    if (ahead < 2.4 || ahead > 4.6 || Math.abs(p.x - b.x) > p.len * Math.sin(p.amp) + 2) continue
    const reach = p.R + GINCANA.bodyR + 0.3
    const slope = it.mx / Math.max(0.2, it.mz)
    let near = false
    for (let k = 0; k <= 4; k++) {
      const dz2 = ahead - reach + (2 * reach * k) / 4
      const q = pendulumAt(p, t + dz2 / vRun)
      if (Math.abs(q.x - (b.x + slope * dz2)) < reach) near = true
    }
    if (near && botRand(br.seed, br.slot * 97 + i, Math.floor(t / 2.86)) < br.skill + 0.05) go = 0
  }
  // luva prestes a socar na faixa por onde vai passar: espera
  for (let i = 0; i < C.gloves.length; i++) {
    const g = C.gloves[i]
    const ahead = g.z - b.z
    if (ahead < 1.3 || ahead > 3.4) continue
    // a luva alcança o meu x?
    const tipMax = g.x0 + g.dir * (g.reach + g.R)
    if ((g.dir > 0 && b.x > tipMax + 0.6) || (g.dir < 0 && b.x < tipMax - 0.6)) continue
    const enter = (ahead - 1.6) / vRun
    const leave = (ahead + 1.6) / vRun
    let hot = false
    for (const f of [0, 0.5, 1]) {
      const q = gloveAt(g, t + Math.max(0, enter + (leave - enter) * f))
      if (q.hot || q.u > 0.5) hot = true
    }
    if (hot && botRand(br.seed, br.slot * 89 + i, Math.floor(t / g.period)) < br.skill + 0.1) go = 0
  }
  // bloco que anda cruzando a minha linha logo à frente: espera
  for (let i = 0; i < C.pushers.length; i++) {
    const q = C.pushers[i]
    const ahead = q.z - b.z
    if (ahead < q.hz + 0.5 || ahead > q.hz + 3) continue
    const enter = (ahead - q.hz - 0.6) / vRun
    const leave = (ahead + q.hz + 0.6) / vRun
    let block = false
    for (const f of [0, 0.33, 0.66, 1]) {
      const P = pusherAt(q, t + Math.max(0, enter + (leave - enter) * f))
      if (Math.abs(P.x - b.x) < q.hx + GINCANA.bodyR + 0.5) block = true
    }
    if (block && botRand(br.seed, br.slot * 71 + i, Math.floor((t * q.w) / 3.14)) < br.skill + 0.1) go = 0
  }
  if (go === 0) br.waited += dt
  if (go === 0 && br.waited < 6 + br.skill * 4) {
    it.mx = 0
    it.mz = 0
  } else if (go > 0) br.waited = Math.max(0, br.waited - dt * 0.5)

  // barra chegando: pula na hora (com o erro da habilidade)
  barJump(br, b, w, it)
  // ladrilho tremendo embaixo: pula para o próximo
  if (b.ground && br.jumpCool <= 0) {
    for (let i = 0; i < C.tiles.length; i++) {
      const q = C.tiles[i]
      const s = w.tiles[i]
      if (s < 0 || !onTile(q, b.x, b.z, 0)) continue
      if (t - s > C.tileTime.warn * 0.6 && botRand(br.seed, br.slot, i) < br.skill) {
        it.jump = true
        br.jumpCool = 0.6
      }
    }
  }
  // o chão acaba logo à frente e há chão adiante: pula o buraco
  const sp = Math.hypot(it.mx, it.mz)
  const tileNear = br.tile >= 0 && Math.hypot(C.tiles[br.tile].x - b.x, C.tiles[br.tile].z - b.z) < 2.6
  if (b.ground && br.jumpCool <= 0 && sp > 0.3 && !tileNear) {
    const fx = it.mx / sp
    const fz = it.mz / sp
    const near = groundUnder(w, b.x + fx * 1.0, b.z + fz * 1.0, b.y + 0.5)
    if (near.y < b.y - 0.6 || near.y === -Infinity) {
      let far = false
      for (const k of [2.2, 3.2, 4.2, 5.0]) {
        const g = groundUnder(w, b.x + fx * k, b.z + fz * k, b.y + 1.2)
        if (g.y > b.y - 1.2) far = true
      }
      if (far) {
        it.jump = true
        br.jumpCool = 0.5
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
  // Coroa da Torre: pula na hora de pegar a coroa (a linha fica no alto); nada de mergulho
  if (C.crown) {
    if (b.ground && b.z > C.finishZ - 1.7 && b.z < C.finishZ - 0.3 && br.jumpCool <= 0) {
      it.jump = true
      br.jumpCool = 0.5
    }
    return it
  }
  // reta final: os melhores mergulham para a linha
  if (br.divesFinish && b.ground && b.z > C.finishZ - 7 && b.z < C.finishZ - 4 && Math.abs(b.facing) < 0.3) it.dive = true
  return it
}

// ── sim/race.ts ──────────────────────────────────────────────────────────────
// features/meu-mundo/gincana/sim/race.ts — GINCANA (mm3d-47): a prova.
//
// Quem corre e como cada um é movido:
//  - "local": o corpo deste aparelho (intenção do controle);
//  - "bot": computador (bots.ts), rodado aqui;
//  - "remote": alguém de fora (a pose chega pela rede; aqui só pisa nos
//    ladrilhos, abre portas e empurra os outros).
// No treino o aparelho tem o "local" e os computadores; na sala, os
// jogadores são "remote" e os computadores "bot"; no multiplayer, o aparelho
// tem o "local" e todo o resto é "remote" (os computadores vêm da sala).
//
// Gincana 2.0 (2026-11-16): a prova é de uma FASE (courses.ts). CLASSIFICAÇÃO
// como nas provas de corrida dos party games: só os primeiros `quota`
// (GINCANA.qualify das vagas) passam — quando esse tanto chega, a prova fecha
// e o resto está eliminado. AGARRAR: quem segura a vaga de alguém na frente
// (pose `g`) deixa os dois devagar; o efeito em quem é segurado é aplicado por
// quem move aquele corpo (o aparelho dele ou a sala, para os computadores) —
// por isso o `g` viaja na pose e nada mais precisa de mensagem nova.
//
// A ordem de chegada é de quem cruza primeiro; quem não chegou fica pela
// distância. A prova acaba quando a vaga dos classificados enche, quando todos
// que contam (os de fora e o local; computador não segura a prova) chegaram ou
// saíram, ou o tempo acabou.

/** Pose que viaja na rede (e que o "remote" recebe). */
                             
           
           
           
           
           
                         
            
                                          
             
                                                
            
 

                              
              
                                            
             
                                                       
              
                                                                            
            
                                                                               
             
             
 

/** Quantos classificam numa prova de `n` vagas (fração da fase). */
function qualifyOf(n        , frac         = GINCANA.qualify) {
  return Math.max(1, Math.ceil(n * frac))
}

class GincanaRace {
           seed        
           course        
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
  /** Classificam os primeiros `quota`. */
           quota        
                   bySlot = new Map                ()

  constructor(seed        , seats               , countdown         = GINCANA.countdown, phase         = "cidade") {
    this.seed = seed >>> 0
    this.course = courseOf(phase)
    this.t = -countdown
    this.world = newWorld(this.course, this.seed, this.t)
    for (const s of seats) {
      this.bySlot.set(s.slot, this.runners.length)
      this.runners.push(newRunner(this.course, s.slot))
      this.ctl.push(s.ctl)
      this.brains.push(s.ctl === "bot" ? newBrain(this.world, this.seed, s.slot) : null)
      this.gone.push(false)
    }
    this.quota = qualifyOf(seats.length, this.course.qualify)
  }

  /** Quantos ainda estão na prova (não saíram nem ficaram fora). */
  alive() {
    let n = 0
    for (let i = 0; i < this.runners.length; i++) if (!this.gone[i] && this.runners[i].out < 0) n++
    return n
  }

  /** Duração máxima desta prova (s). */
  limit() {
    return this.course.limit
  }

  runner(slot        )                {
    const i = this.bySlot.get(slot)
    return i === undefined ? null : this.runners[i]
  }

  /** A vaga dos classificados encheu (só na corrida). */
  closed() {
    return this.course.mode === "race" && this.order.length >= this.quota
  }

  /** Um passo fixo; `local` = intenção do corpo deste aparelho. */
  step(local            = IDLE_INTENT, out                    = null, dt         = GINCANA.step) {
    this.t += dt
    const w = this.world
    const C = this.course
    w.t = this.t
    ballsAt(C, this.seed, this.t, w.balls)
    // ladrilhos que já voltaram
    for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] >= 0 && this.t - w.tiles[i] >= C.tileTime.warn + C.tileTime.gone) w.tiles[i] = -1
    for (const b of this.runners) {
      b.px = b.x
      b.py = b.y
      b.pz = b.z
    }
    if (this.t < 0) return
    // quem está sendo segurado (por qualquer um, de fora também) anda devagar
    for (let j = 0; j < this.runners.length; j++) {
      const a = this.runners[j]
      if (a.grab < 0 || this.gone[j]) continue
      const v = this.runner(a.grab)
      if (!v || this.ctl[this.bySlot.get(a.grab) ] === "remote") continue
      if (Math.hypot(v.x - a.x, v.z - a.z) < GINCANA.grabR + 0.7 && Math.abs(v.y - a.y) < 1.2) v.held = 0.15
    }
    const closed = this.closed()
    for (let i = 0; i < this.runners.length; i++) {
      const b = this.runners[i]
      const c = this.ctl[i]
      if (this.gone[i]) continue
      if (c === "remote") continue
      const it = c === "local" ? local : botIntent(this.brains[i] , b, w, dt)
      const wasFin = b.fin >= 0
      stepRunner(b, it, w, out, dt)
      if (!wasFin && b.fin >= 0) {
        // chegou depois de a vaga encher: não conta (a prova já fechou)
        if (closed) b.fin = -1
        else this.order.push(b.slot)
      }
      this.grab(i, !!it.grab, out, dt)
    }
    // ninguém atravessa ninguém (quem é movido aqui sai; o de fora não); mergulho em cima empurra
    for (let i = 0; i < this.runners.length; i++) {
      if (this.ctl[i] === "remote" || this.gone[i]) continue
      for (let j = 0; j < this.runners.length; j++) {
        if (i === j || this.gone[j]) continue
        if (j < i && this.ctl[j] !== "remote") continue
        const a = this.runners[i]
        const b = this.runners[j]
        if (!separate(a, b, this.ctl[j] !== "remote")) continue
        // mergulho que acerta alguém (movido aqui): empurrão
        for (const [p, q, k] of [[a, b, j], [b, a, i]]                              ) {
          if (p.mode !== MODE.DIVE || this.ctl[k] === "remote" || q.mode === MODE.DONE) continue
          const sp = Math.hypot(p.vx, p.vz) || 1
          knock(q, (p.vx / sp) * GINCANA.tackle, 3, (p.vz / sp) * GINCANA.tackle, "tackle", out)
        }
      }
    }
    this.score(out, dt)
  }

  /**
   * Gincana 3: engrenagens (coleta) e segundos na zona (rei do pedaço), de TODOS
   * (os de fora também, pela pose): a sala conta igual ao aparelho.
   */
          score(out                   , dt        ) {
    const C = this.course
    const w = this.world
    if (C.mode === "zone" && C.zone) {
      const Z = C.zone
      for (let i = 0; i < this.runners.length; i++) {
        const b = this.runners[i]
        if (this.gone[i] || b.out >= 0 || b.mode === MODE.WATER || b.mode === MODE.KNOCK) continue
        if (Math.abs(b.y - Z.y) < 0.7 && Math.hypot(b.x - Z.x, b.z - Z.z) <= Z.r) b.pts += dt
      }
    }
    for (let k = 0; k < C.gems.length; k++) {
      const g = C.gems[k]
      if (this.t < g.t0 || (w.gems[k] >= 0 && this.t - w.gems[k] < g.back)) continue
      // quem chega junto: a ordem roda a cada passo (ninguém leva sempre o empate)
      const n = this.runners.length
      const off = Math.floor(this.t * 60) % n
      for (let q = 0; q < n; q++) {
        const i = (q + off) % n
        const b = this.runners[i]
        if (this.gone[i] || b.out >= 0 || b.mode === MODE.WATER) continue
        if (Math.hypot(b.x - g.x, b.z - g.z) > 1.1 || b.y > g.y + 0.8 || b.y + GINCANA.bodyH < g.y - 0.4) continue
        w.gems[k] = this.t
        b.pts += g.v
        out?.push({ type: "gem", slot: b.slot, i: k, v: g.v })
        break
      }
    }
  }

  /** Segurar AGARRAR: pega a vaga da frente ao alcance; solta ao soltar, longe ou no tempo. */
          grab(i        , held         , out                   , dt        ) {
    const a = this.runners[i]
    if (a.grab >= 0) {
      const v = this.runner(a.grab)
      a.grabT += dt
      const far = !v || Math.hypot(v.x - a.x, v.z - a.z) > GINCANA.grabR + 0.9 || v.mode === MODE.WATER || v.mode === MODE.DONE || a.out >= 0
      if (!held || far || a.grabT > GINCANA.grabMax || a.mode !== MODE.RUN) {
        a.grab = -1
        a.grabCool = GINCANA.grabCool
      }
      return
    }
    if (!held || a.grabCool > 0 || a.mode !== MODE.RUN) return
    const fx = Math.sin(a.facing)
    const fz = Math.cos(a.facing)
    let best = -1
    let bestD = Infinity
    for (let j = 0; j < this.runners.length; j++) {
      if (j === i || this.gone[j]) continue
      const v = this.runners[j]
      if (v.mode === MODE.WATER || v.mode === MODE.DONE || Math.abs(v.y - a.y) > 1.2) continue
      const dx = v.x - a.x
      const dz = v.z - a.z
      const d = Math.hypot(dx, dz)
      if (d > GINCANA.grabR || (dx * fx + dz * fz) / (d || 1) < 0.2) continue
      if (d < bestD) {
        bestD = d
        best = v.slot
      }
    }
    if (best >= 0) {
      a.grab = best
      a.grabT = 0
      out?.push({ type: "grab", slot: a.slot, other: best })
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

  /** Pose de alguém de fora (rede). Pisa nos ladrilhos e abre portas como os outros. */
  setRemote(slot        , p            ) {
    const i = this.bySlot.get(slot)
    if (i === undefined) return
    const b = this.runners[i]
    const C = this.course
    b.x = p.x
    b.y = p.y
    b.z = p.z
    b.facing = p.f
    b.cp = p.cp
    b.grab = p.g === undefined || !Number.isFinite(p.g) ? -1 : p.g
    // caiu agora: fica fora pela regra da fase (sobrevivência, perigo que sobe)
    if (p.a === ANIM.WATER && b.mode !== MODE.WATER && b.out < 0 && fallOut(b, C, this.t)) b.out = this.t
    b.mode = p.a === ANIM.WATER ? MODE.WATER : p.a === ANIM.WIN ? MODE.DONE : p.a === ANIM.KNOCK ? MODE.KNOCK : p.a === ANIM.DIVE ? MODE.DIVE : MODE.RUN
    b.ground = p.a === ANIM.IDLE || p.a === ANIM.RUN || p.a === ANIM.WIN || p.a === ANIM.SLIDE || p.a === ANIM.RISE
    if (p.fin >= 0 && b.fin < 0 && !this.closed()) {
      b.fin = p.fin
      this.order.push(slot)
    }
    if (b.ground) {
      for (let k = 0; k < C.tiles.length; k++) {
        const q = C.tiles[k]
        if (Math.abs(b.y - q.y) < 0.3 && onTile(q, b.x, b.z, 0) && this.world.tiles[k] < 0) this.world.tiles[k] = this.t
      }
    }
    for (let k = 0; k < C.doors.length; k++) {
      const d = C.doors[k]
      if (this.world.open[k] && this.world.doors[k] < 0 && Math.abs(b.z - d.z) < 0.8 && Math.abs(b.x - d.x) < d.hw) this.world.doors[k] = this.t
    }
  }

  setGone(slot        ) {
    const i = this.bySlot.get(slot)
    if (i !== undefined) this.gone[i] = true
  }

  pose(slot        )                    {
    const b = this.runner(slot)
    if (!b) return null
    return { x: b.x, y: b.y, z: b.z, f: b.facing, a: b.out >= 0 ? ANIM.WATER : runnerAnim(b), cp: b.cp, fin: b.fin, g: b.grab }
  }

  /** Progresso de quem não chegou (posto e z). */
  distOf(b        ) {
    const C = this.course
    return Math.max(C.checkpoints[b.cp].z, Math.min(C.finishZ, b.z))
  }

  /**
   * Classificação pelo tipo da prova. Corrida: quem chegou pela ordem; o resto
   * pela distância; quem ficou fora no fim (o último a sair na frente).
   * Sobrevivência: quem está em pé (todos classificam); depois quem ficou fora,
   * do último ao primeiro. Coleta e zona: pelos pontos (classifica a vaga, com ponto).
   */
  standings()                {
    const C = this.course
    const row = (b        , q         )              => ({ slot: b.slot, fin: b.fin, dist: b.fin >= 0 ? C.finishZ : this.distOf(b), q, pts: Math.round(b.pts * 10) / 10, out: b.out })
    const byOut = (a        , b        ) => b.out - a.out || a.slot - b.slot
    if (C.mode === "collect" || C.mode === "zone") {
      return [...this.runners].sort((a, b) => b.pts - a.pts || a.slot - b.slot).map((b, k) => row(b, k < this.quota && b.pts > 0))
    }
    if (C.mode === "survive") {
      const up = this.runners.filter((b, i) => b.out < 0 && !this.gone[i])
      const down = this.runners.filter((b, i) => b.out >= 0 || this.gone[i]).sort(byOut)
      return up.map((b) => row(b, true)).concat(down.map((b) => row(b, false)))
    }
    const rows                = this.order.map((slot, k) => row(this.runner(slot) , k < this.quota))
    const rest = this.runners.filter((b) => b.fin < 0 || !this.order.includes(b.slot))
    const inRace = rest.filter((b) => b.out < 0).sort((a, b) => this.distOf(b) - this.distOf(a) || a.slot - b.slot)
    const outRows = rest.filter((b) => b.out >= 0).sort(byOut)
    return rows.concat(inRace.map((b) => row(b, false)), outRows.map((b) => row(b, false)))
  }

  /**
   * Acabou: o tempo da fase acabou; na corrida, a vaga encheu ou todos os que
   * contam chegaram/ficaram fora/saíram; na sobrevivência, sobrou só a vaga ou
   * todas as pessoas ficaram fora.
   */
  over()          {
    const C = this.course
    if (this.t >= C.limit || this.closed()) return true
    if (C.mode === "collect" || C.mode === "zone") return false
    if (C.mode === "survive" && this.alive() <= this.quota) return true
    let any = false
    for (let i = 0; i < this.runners.length; i++) {
      if (this.ctl[i] === "bot" || this.gone[i]) continue
      any = true
      const b = this.runners[i]
      if (C.mode === "race" ? b.fin < 0 && b.out < 0 : b.out < 0) return false
    }
    return any
  }
}

module.exports = { DECK, GINCANA, GINCANA_COLORS, GINCANA_PHASES, MEM_SYMBOLS, memShow, memCall, memState, memSymbols, memTarget, memTile, memIndexAt, memUp, drumAngle, drumSpeed, drumAt, CourseKit, sweeperAngle, sweeperW, pendulumAt, gloveAt, padShift, padRot, pusherAt, courseHash, ballLane, doorsOpen, wallsAt, riseAt, padTop, rampTop, ballsAt, tileUp, onTile, sectionAt, spawnAt, CLAREIRA, stoneCells, ROLL_R, ROLL_TOP, MEM_GRID, COURSES, courseOf, MODE, IDLE_INTENT, newWorld, newRunner, groundUnder, knock, fallOut, respawn, stepRunner, separate, ANIM, runnerAnim, botRand, newBrain, botIntent, qualifyOf, GincanaRace };
