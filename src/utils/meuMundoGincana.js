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
  /** Esteira (Gincana 3, pedido do Alex 18/11; mais forte em 20/11): parado, ela leva você; contra ela anda a 2 m/s; pulando não escapa. */
  belt: 6.2,
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
  /** Derrubado por obstáculo: sem controle por isto (s); depois levanta (20/11: 0,9 → 1,2, o Alex achou fácil). */
  stunT: 1.2,
  /** 20/11 (o Alex achou tudo fácil): pancada empurra mais longe (× na velocidade de lado). */
  hitPush: 1.3,
  /** 20/11: nas corridas tudo que se mexe gira/vai e volta mais rápido (× na velocidade, ÷ no período). */
  tempo: 1.22,
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
                                                                                                                                                                                                                                                                                           
const GINCANA_PHASES                          = ["cidade", "floresta", "clareira", "serraria", "canion", "moinhos", "gangorras", "orbital", "helices", "forja", "altoforno", "crosta", "fabrica", "comportas", "tanque", "gelo", "portoes", "estaleiro", "aros", "relogio", "feira", "coroa"]

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
                       
            
            
            
            
 

/** Aro no ar (Descida dos Aros). */
                       
           
           
           
           
            
           
            
 

/** Centro x do aro agora (os que vão e voltam de lado). */
function hoopX(h      , t        ) {
  return h.mx > 0 ? h.x + Math.sin(h.w * t + h.ph) * h.mx : h.x
}

/** Atravessou o aro pelo meio neste passo (cruzou o plano z do aro com o meio do corpo dentro do furo)? */
function hoopPass(h      , t        , pz        , x        , y        , z        ) {
  if (!(pz < h.z && z >= h.z)) return false
  return Math.hypot(x - hoopX(h, t), y + 0.85 - h.y) < h.R - 0.45
}

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

/**
 * Serraria da Lua (20/11): TORA deitada atravessada na pista (eixo em x), girando a `w` rad/s — positivo = o
 * topo anda para −z, contra quem corre. Tem `rows` fileiras de cravos (desencontradas, um a cada `pitch` m)
 * que passam por cima e derrubam para trás. Abaixo de 60% da altura o lado é parede (sobe pulando).
 */
                      
           
           
           
           
            
           
              
               
            
 
const LOG_EDGE = 0.93
/** A ponta do cravo fica isto acima da casca; o raio do que machuca em volta dela. */
const SPIKE_OUT = 0.55
const SPIKE_R = 0.3

/** O chão da tora em (x, z): topo e o ângulo da superfície (0 = topo, + = lado +z). null = fora dela. */
function logAt(L     , x        , z        ) {
  const dz = z - L.z
  if (Math.abs(x - L.x) > L.hx || Math.abs(dz) > L.R * LOG_EDGE) return null
  return { top: L.y + Math.sqrt(L.R * L.R - dz * dz), th: Math.asin(dz / L.R) }
}

/** Ângulo da fileira k de cravos em t (0 = topo, + = lado +z). */
function logRowAngle(L     , k        , t        ) {
  return L.ph + (k * Math.PI * 2) / L.rows - L.w * t
}

/** Quantos cravos tem a fileira k e o x do j-ésimo (as ímpares ficam no meio das pares). */
function logSpikeCount(L     , k        ) {
  return Math.max(1, Math.floor((2 * L.hx) / L.pitch) - (k % 2))
}
function logSpikeX(L     , k        , j        ) {
  return L.x - L.hx + L.pitch * (j + 0.5 + (k % 2) * 0.5)
}

/**
 * Serraria da Lua: TÁBUA que balança de lado (gira em volta do eixo z, no centro). `amp` rad, `w` rad/s;
 * ângulo + = o lado +x sobe. Quem está em cima escorrega para o lado que desce.
 */
                        
           
           
            
            
           
             
           
            
 
/**
 * Estaleiro do Quebra-Gelo: HÉLICE EM PÉ que gira de frente para quem corre (em volta do eixo z). `n` pás de
 * comprimento `L` a partir do cubo (x, y, z), meia largura `hw`, meia espessura `hz` (em z); `w` rad/s
 * (+ = anti-horário visto de trás). As pás varrem o chão embaixo do cubo: passa-se pelo vão entre elas.
 */
                        
           
           
           
           
           
            
            
           
            
 
function rotorAngle(q       , k        , t        ) {
  return q.ph + (k * Math.PI * 2) / q.n + q.w * t
}
/** A pá que pega o ponto (x, y) no plano da hélice (folga `r`), ou −1. */
function rotorBladeAt(q       , x        , y        , t        , r        ) {
  const px = x - q.x
  const py = y - q.y
  for (let k = 0; k < q.n; k++) {
    const a = rotorAngle(q, k, t)
    const c = Math.cos(a)
    const s = Math.sin(a)
    const along = px * c + py * s
    if (along < 0.3 || along > q.L + r) continue
    if (Math.abs(px * s - py * c) < q.hw + r) return k
  }
  return -1
}

/**
 * Gangorras do Desfiladeiro: GANGORRA que inclina pelo PESO de quem está em cima (o estado fica no mundo,
 * `w.saw`: ângulo e giro de cada uma). `ax` 0 = a tábua comprida em z inclina para a frente/trás (o pivô
 * corre em x); 1 = inclina de lado (o pivô corre em z). Ângulo + = o lado + (z ou x) desce. Sem ninguém,
 * a mola `k` volta ao repouso `a0`; `max` é o batente. `y` = altura do eixo (o meio do tampo).
 */
                         
           
           
           
            
            
           
             
            
           
                                                                                                               
               
 
/** Ganho do peso (rad/s² por metro de braço de cada um) e amortecimento. */
const SAW = { gain: 0.6, damp: 2.2 }
/** Braço do ponto: o quanto ele está para o lado + do pivô. */
function sawArm(S        , x        , z        ) {
  return S.ax === 0 ? z - S.z : x - S.x
}
/** Tampo da gangorra no ângulo `a`, no ponto (x, z) preso dentro da tábua. */
function sawTop(S        , a        , x        , z        ) {
  const cx = Math.max(S.x - S.hx, Math.min(S.x + S.hx, x))
  const cz = Math.max(S.z - S.hz, Math.min(S.z + S.hz, z))
  return S.y - Math.tan(a) * sawArm(S, cx, cz)
}
/** Estado inicial: [ângulo, giro] por gangorra, no repouso. */
function sawRest(C                    ) {
  const s = new Float64Array(C.saws.length * 2)
  C.saws.forEach((S, i) => (s[i * 2] = S.a0))
  return s
}
/** Um passo: `arms[i]` = soma dos braços de quem está em pé na gangorra i. */
function stepSawState(C                    , s              , arms              , dt        ) {
  for (let i = 0; i < C.saws.length; i++) {
    const S = C.saws[i]
    let a = s[i * 2]
    let v = s[i * 2 + 1]
    v += (SAW.gain * arms[i] - S.k * (a - S.a0) - SAW.damp * v) * dt
    a += v * dt
    if (a > S.max) {
      a = S.max
      if (v > 0) v = 0
    } else if (a < -S.max) {
      a = -S.max
      if (v < 0) v = 0
    }
    s[i * 2] = a
    s[i * 2 + 1] = v
  }
}

function plankAngle(P       , t        ) {
  return P.amp * Math.sin(P.w * t + P.ph)
}
/** Tampo da tábua em x no tempo t. */
function plankTop(P       , x        , t        ) {
  return P.y + Math.tan(plankAngle(P, t)) * (x - P.x)
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
           hoops         = []
  ramp              = null
  balls               = null
           gems        = []
           drums         = []
           logs        = []
           planks          = []
           rotors          = []
           saws           = []
  /** Gangorra: pivô em (x, z) na altura `y`; repouso `a0` (rad), batente `max`, mola `k`. */
  saw(x        , z        , y        , hx        , hz        , ax       , max        , a0        , k        ) {
    this.saws.push({ x, z, y, hx, hz, ax, max, a0, k })
  }
  rotor(x        , z        , y        , L        , n        , hw        , hz        , w        , ph = 0) {
    this.rotors.push({ x, z, y, L, n, hw, hz, w, ph })
  }
  log(x        , z        , y        , R        , hx        , w        , rows        , pitch        , ph = 0) {
    this.logs.push({ x, z, y, R, hx, w, rows, pitch, ph })
  }
  plank(x        , z        , hx        , hz        , amp        , w        , ph        , y = DECK) {
    this.planks.push({ x, z, hx, hz, y, amp, w, ph })
  }
  drum(x        , z0        , y        , R        , rings            , f = 0.6, wall = false) {
    this.drums.push({ x, z0, y, R, f, rings, wall })
  }
  gem(x        , z        , y        , v        , t0        , back        ) {
    this.gems.push({ x, z, y, v, t0, back })
  }

  /** Caixa (tampo em `y`). Devolve o índice (para pôr esteira, gelo, movimento). */
  box(x        , z        , hx        , hz        , c        , rim        , s        , rot = 0, d = 1.4, y = DECK) {
    this.pads.push({ k: 1, x, z, r: 0, hx, hz, rot, y, y2: y, d, c, rim, s, f: 1, bx: 0, bz: 0, mx: 0, mz: 0, mw: 0, mph: 0, spin: 0, gh: 0, gp: 0, gph: 0, sl: 1 })
    return this.pads.length - 1
  }
  /** Comporta (Comportas da Usina): caixa que sobe `h` m e desce, ciclo `per` s, atraso `ph` s. */
  gate(x        , z        , hx        , hz        , h        , per        , ph        , c        , rim        , s        , y = DECK) {
    const i = this.box(x, z, hx, hz, c, rim, s, 0, h + 1.4, y)
    const p = this.pads[i]
    p.gh = h
    p.gp = per
    p.gph = ph
    return i
  }
  disc(x        , z        , r        , c        , rim        , s        , y = DECK) {
    this.pads.push({ k: 0, x, z, r, hx: r, hz: r, rot: 0, y, y2: y, d: 1.6, c, rim, s, f: 1, bx: 0, bz: 0, mx: 0, mz: 0, mw: 0, mph: 0, spin: 0, gh: 0, gp: 0, gph: 0, sl: 1 })
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
    this.pads.push({ k: 2, x, z: (z0 + z1) / 2, r: 0, hx, hz: (z1 - z0) / 2, rot: 0, y: y0, y2: y1, d: 1.4, c, rim, s, f: 1, bx: 0, bz: 0, mx: 0, mz: 0, mw: 0, mph: 0, spin: 0, gh: 0, gp: 0, gph: 0, sl: 1 })
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
    this.tiles.push({ x, z, y, h, c, k, pg: -1, pr: -1, pc: -1 })
  }
  /** Tabuleiro do caminho escondido: `cols` × `rows` ladrilhos quadrados de meia largura `h`, passo `step`, a partir de z0. */
  pathGrid(x        , z0        , cols        , rows        , h        , step        , c        ) {
    const pg = this.tiles.reduce((m, q) => Math.max(m, q.pg + 1), 0)
    for (let r = 0; r < rows; r++)
      for (let col = 0; col < cols; col++) this.tiles.push({ x: x + (col - (cols - 1) / 2) * step, z: z0 + r * step, y: DECK, h, c, k: 0, pg, pr: r, pc: col })
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
  /** Aro no ar: centro (x, y, z), raio R; se `mx` > 0, vai e volta de lado (±mx m, w rad/s, fase ph). */
  hoop(x        , z        , y        , R        , mx = 0, w = 0, ph = 0) {
    this.hoops.push({ x, z, y, R, mx, w, ph })
  }
  logo(x        , z        , y = DECK) {
    this.logos.push({ x, z, y: y + 1.1 })
  }
  /** Fecha o percurso. */
  /** Tudo que se mexe pelo relógio fica `f` vezes mais rápido (a regra é a mesma no aparelho e na sala). */
          faster(f        ) {
    for (const s of this.sweepers) {
      s.w *= f
      s.acc *= f * f
      s.wMax *= f
    }
    for (const q of this.pendulums) q.w *= f
    for (const g of this.gloves) g.period /= f
    for (const q of this.pushers) q.w *= f
    for (const q of this.rotors) q.w *= f
    for (const q of this.logs) q.w *= Math.sqrt(f) // a tora rolando contra já é o obstáculo mais duro: acelera menos
    for (const q of this.planks) q.w *= f
    for (const p of this.pads) {
      p.mw *= f
      p.spin *= f
      p.gp /= f
    }
    if (this.balls) {
      this.balls.v *= f
      this.balls.every /= f
    }
  }

  done(o   
                    
                             
                   
                   
                      
                     
                          
                                             
                      
                    
                  
               
               
                 
                   
                   
   )         {
    if ((o.mode ?? "race") === "race") this.faster(GINCANA.tempo)
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
      logs: this.logs,
      planks: this.planks,
      rotors: this.rotors,
      saws: this.saws,
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
      hoops: this.hoops,
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
/**
 * Crosta da Forja: o caminho de verdade de cada tabuleiro, pela semente. Entra na fileira r pela coluna em que
 * saiu da anterior e anda de lado até a coluna da próxima (sem diagonal): na fileira, de verdade = o trecho entre
 * as duas. 1 = de verdade.
 */
function pathReal(c        , seed        )             {
  const out = new Uint8Array(c.tiles.length)
  const grids = c.tiles.reduce((m, q) => Math.max(m, q.pg + 1), 0)
  for (let g = 0; g < grids; g++) {
    let rows = 0
    let cols = 0
    for (const q of c.tiles) if (q.pg === g) {
      rows = Math.max(rows, q.pr + 1)
      cols = Math.max(cols, q.pc + 1)
    }
    const steps = [-2, -1, -1, 0, 1, 1, 2]
    let col = courseHash(seed ^ 0x2c1b3c6d, g * 977) % cols
    for (let r = 0; r < rows; r++) {
      const next = Math.max(0, Math.min(cols - 1, col + steps[courseHash(seed ^ 0x297a2d39, g * 977 + r * 31 + 1) % steps.length]))
      const lo = Math.min(col, next)
      const hi = Math.max(col, next)
      for (let i = 0; i < c.tiles.length; i++) {
        const q = c.tiles[i]
        if (q.pg === g && q.pr === r && q.pc >= lo && q.pc <= hi) out[i] = 1
      }
      col = next
    }
  }
  return out
}

/** Pisaram o ladrilho i: comum = cai daqui a pouco; do caminho = acende (−2) ou cai (falso). */
function stepTile(c        , tiles              , real            , i        , t        ) {
  if (c.tiles[i].pg >= 0) {
    if (tiles[i] === -1) tiles[i] = real[i] ? -2 : t
    return
  }
  if (tiles[i] < 0 || t - tiles[i] >= c.tileTime.warn + c.tileTime.gone) tiles[i] = t
}

/**
 * 20/11 (pedido do Alex): em toda fileira abre UMA porta só (`doorOpen` > 1 não vale mais) e nunca na mesma
 * posição da porta aberta da fileira anterior (a de z logo antes) — quem acertou uma não acerta a próxima de graça.
 */
function doorsOpen(c        , seed        )             {
  const out = new Uint8Array(c.doors.length)
  const rowZ = (row        ) => c.doors.find((d) => d.row === row)?.z ?? 0
  const order = c.doorOpen.map((_, row) => row).sort((a, b) => rowZ(a) - rowZ(b))
  let prev = -1
  for (const row of order) {
    if (c.doorOpen[row] <= 0) continue
    const idx           = []
    for (let i = 0; i < c.doors.length; i++) if (c.doors[i].row === row) idx.push(i)
    // embaralha pela semente e abre a primeira que não fica na frente da aberta da fileira anterior
    for (let k = idx.length - 1; k > 0; k--) {
      const j = courseHash(seed ^ 0x5bd1e995, row * 31 + k) % (k + 1)
      const tmp = idx[k]
      idx[k] = idx[j]
      idx[j] = tmp
    }
    const p = prev >= 0 ? c.doors[prev] : null
    const pick = idx.find((i) => !p || Math.abs(c.doors[i].x - p.x) >= Math.min(c.doors[i].hw, p.hw)) ?? idx[0]
    if (pick === undefined) continue
    out[pick] = 1
    prev = pick
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

/**
 * Comporta: quanto está levantada (0–1) no tempo t. Ciclo: embaixo 38%, sobe 12% (suave),
 * em cima 38%, desce 12%. Tudo pelo tempo: a sala e o aparelho veem igual.
 */
function gateLift(p     , t        ) {
  if (p.gh === 0) return 0
  const u = ((((t + p.gph) / p.gp) % 1) + 1) % 1
  if (u < 0.38) return 0
  if (u < 0.5) {
    const k = (u - 0.38) / 0.12
    return k * k * (3 - 2 * k)
  }
  if (u < 0.88) return 1
  const k = (u - 0.88) / 0.12
  return 1 - k * k * (3 - 2 * k)
}

/** Tampo de uma plataforma em z no tempo t (a rampa, k = 2, sobe de y em z − hz a y2 em z + hz; a comporta sobe pelo relógio). */
function padTop(p     , z        , t = 0) {
  if (p.gh !== 0) return p.y + p.gh * gateLift(p, t)
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
    const age = t - i * B.every
    let y = z >= R.z0 ? rampTop(c, z) + B.R : R.y0 + B.R - ((R.z0 - z) / B.v) ** 2 * 12
    let x = R.x + B.lanes[lane]
    if (B.hop) {
      // quique: arco de parábola (|sen| achatado embaixo), fase própria de cada bola; o lado vai e volta
      const hopT = B.hopT ?? 0.6
      const u = ((age + (courseHash(seed, i + 7) % 100) / 100 * hopT) / hopT) % 1
      if (z >= R.z0) y += B.hop * 4 * u * (1 - u)
      x += (B.drift ?? 0) * Math.sin(age * 1.9 + i * 2.3)
    }
    out.push(x, y, z, lane, i)
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

// ═══ reprise — o percurso dobrado (20/11, pedido do Alex: "no mínimo o dobro do percurso") ═══════════════

/** Peças de chão fixo embaixo do caminho em z (o x vem da rota). */
function floorPadsAt(C        , z        ) {
  const pts = C.route(() => 0.5)
  let x = 0
  let best = Infinity
  for (const p of pts) if (Math.abs(p.z - z) < best) (best = Math.abs(p.z - z)), (x = p.x)
  return C.pads.filter((p) => {
    if (p.mw !== 0 || p.gh !== 0 || p.sl < 1) return false
    const ex = p.rot ? Math.max(p.hx, p.hz) : p.hx
    return Math.abs(z - p.z) <= p.hz + 0.01 && Math.abs(x - p.x) <= ex + 0.6
  })
}

/** Topo do chão fixo embaixo do caminho em z: para saber quanto um trecho sobe. */
function floorTopAt(C        , z        ) {
  // num vão de pulo vale o chão de logo antes
  for (let d = 0; d <= 10; d += 0.5) {
    let y = -Infinity
    for (const p of floorPadsAt(C, z - d)) y = Math.max(y, p.k === 2 ? p.y + ((z - d - (p.z - p.hz)) / (2 * p.hz)) * (p.y2 - p.y) : p.y)
    if (y > -Infinity) return y
  }
  return DECK
}

/** Corte limpo: nenhuma peça embaixo do caminho atravessa a linha z (nem a que gira ou anda). */
function cleanCut(C        , z        ) {
  const pts = C.route(() => 0.5)
  let x = 0
  let best = Infinity
  for (const p of pts) if (Math.abs(p.z - z) < best) (best = Math.abs(p.z - z)), (x = p.x)
  return !C.pads.some((p) => {
    const ex = p.rot ? Math.max(p.hx, p.hz) : p.hx
    return Math.abs(x - p.x) <= ex + 0.6 && p.z - p.hz < z - 0.05 && p.z + p.hz > z + 0.05
  })
}

/** A emenda fica no começo da peça de chão que cobre z (nunca corta uma peça no meio). */
function seamAt(C        , z        ) {
  const ps = floorPadsAt(C, z)
  return ps.length ? Math.min(...ps.map((p) => p.z - p.hz)) : z
}

/**
 * Dobra o percurso de uma corrida: o miolo [z0, z1) (do começo do trecho 1 ao começo do trecho 5, por padrão)
 * se repete logo depois, deslocado em z (e em y, se o miolo sobe), com tudo que se mexe mais rápido (`f`) e o
 * ritmo trocado (fases deslocadas) — a 2ª volta não é a 1ª decorada. Se ainda não deu `minLen` × `base`
 * (o comprimento antigo da fase), uma 3ª volta parcial (até o começo de um trecho) completa. O que vinha
 * depois de z1 (a subida e a chegada) vai para o fim. Regra pura: o aparelho e a sala calculam igual.
 */
function reprise(C        , o                                                                           = {})         {
  if (C.mode !== "race") return C
  const z0 = o.z0 ?? seamAt(C, C.sections[0] + 0.05)
  const z1 = o.z1 ?? seamAt(C, C.sections[4] + 0.05)
  const L = z1 - z0
  const target = (o.minLen ?? 2) * (o.base ?? C.finishZ)
  const dyLap = floorTopAt(C, z1 - 0.3) - floorTopAt(C, z0 + 0.3)
  const f = o.f ?? 1.12
  // voltas: [a, b) copiado com deslocamento (dz, dy), velocidade × k e fases + ph
  const laps                                                                            = [{ a: z0, b: z1, dz: L, dy: dyLap, k: f, ph: 1.7 }]
  let DZ = L
  let DY = dyLap
  if (C.finishZ + DZ < target) {
    const need = target - C.finishZ - DZ
    // cortes possíveis: começo de cada peça de chão do miolo
    const cuts = [...new Set(C.pads.filter((p) => p.z > z0 && p.z < z1 && p.mw === 0 && p.spin === 0).map((p) => p.z - p.hz).filter((s) => s > z0 + 0.5 && s <= z1 && cleanCut(C, s))), z1].sort((a, b) => a - b)
    const b = cuts.find((s) => s - z0 >= need) ?? z1
    laps.push({ a: z0, b, dz: 2 * L, dy: 2 * dyLap, k: f * f, ph: 3.1 })
    DZ += b - z0
    DY += floorTopAt(C, b - 0.3) - floorTopAt(C, z0 + 0.3)
  }
  const inLap = (z        , l                       ) => z >= l.a && z < l.b
  const after = (z        ) => z >= z1
  const out         = {
    ...C,
    pads: [],
    posts: [],
    sweepers: [],
    pendulums: [],
    gloves: [],
    tiles: [],
    doors: [],
    doorOpen: [...C.doorOpen],
    pushers: [],
    logos: [],
    hoops: [],
    gems: [],
    drums: [],
    logs: [],
    planks: [],
    rotors: [],
    saws: [],
    checkpoints: [],
  }
  // cada lista: o original (o que vem depois de z1 vai para o fim) e, para cada volta, a cópia
  function each   (src              , dst     , zOf                  , move                                     , tune                                       ) {
    src.forEach((q) => dst.push(after(zOf(q)) ? move(q, DZ, DY) : { ...q }))
    const maps                        = []
    for (const l of laps) {
      const m = new Map                ()
      src.forEach((q, i) => {
        if (!inLap(zOf(q), l)) return
        const c = move(q, l.dz, l.dy)
        tune(c, l.k, l.ph)
        m.set(i, dst.length)
        dst.push(c)
      })
      maps.push(m)
    }
    return maps
  }
  const none = () => {}
  const padMaps = each(C.pads, out.pads, (p) => p.z, (p, dz, dy) => ({ ...p, z: p.z + dz, y: p.y + dy, y2: p.y2 + dy }), (p, k, ph) => {
    p.mw *= k
    p.spin *= k
    p.mph += ph
    if (p.gp) {
      p.gp /= k
      p.gph += ph * 0.37 * p.gp
    }
  })
  each(C.posts, out.posts, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y0: q.y0 + dy, y1: q.y1 + dy }), none)
  each(C.sweepers, out.sweepers, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), (q, k, ph) => {
    q.w *= k
    q.wMax *= k
    q.acc *= k * k
    q.a0 += ph
  })
  each(C.pendulums, out.pendulums, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, py: q.py + dy }), (q, k, ph) => {
    q.w *= k
    q.ph += ph
  })
  each(C.gloves, out.gloves, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), (q, k, ph) => {
    q.period /= k
    q.ph += ph * 0.3 * q.period
  })
  each(C.pushers, out.pushers, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), (q, k, ph) => {
    q.w *= k
    q.ph += ph
  })
  each(C.logos, out.logos, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), none)
  each(C.hoops, out.hoops, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), (q, k, ph) => {
    q.w *= k
    q.ph += ph
  })
  each(C.drums, out.drums, (q) => q.z0, (q, dz, dy) => ({ ...q, z0: q.z0 + dz, y: q.y + dy }), none)
  each(C.logs, out.logs, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), (q, k, ph) => {
    q.w *= k
    q.ph += ph
  })
  each(C.planks, out.planks, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), (q, k, ph) => {
    q.w *= k
    q.ph += ph
  })
  each(C.rotors, out.rotors, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), (q, k, ph) => {
    q.w *= k
    q.ph += ph
  })
  each(C.saws, out.saws, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), none)
  each(C.checkpoints, out.checkpoints, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), none)
  out.checkpoints.sort((a, b) => a.z - b.z)
  // portas: cada volta ganha fileiras novas (sorteadas à parte)
  each(C.doors, out.doors, (q) => q.z, (q, dz) => ({ ...q, z: q.z + dz }), none)
  {
    let n = C.doors.length
    for (const l of laps) {
      const rows = new Map                ()
      for (const d of C.doors) {
        if (!inLap(d.z, l)) continue
        if (!rows.has(d.row)) {
          rows.set(d.row, out.doorOpen.length)
          out.doorOpen.push(C.doorOpen[d.row])
        }
        out.doors[n++].row = rows.get(d.row)          
      }
    }
  }
  // ladrilhos: o tabuleiro escondido copiado é outro tabuleiro (caminho sorteado à parte)
  each(C.tiles, out.tiles, (q) => q.z, (q, dz, dy) => ({ ...q, z: q.z + dz, y: q.y + dy }), none)
  {
    let n = C.tiles.length
    let pg = C.tiles.reduce((m, q) => Math.max(m, q.pg + 1), 0)
    for (const l of laps) {
      const grids = new Map                ()
      for (const t of C.tiles) {
        if (!inLap(t.z, l)) continue
        const q = out.tiles[n++]
        if (t.pg < 0) continue
        if (!grids.has(t.pg)) grids.set(t.pg, pg++)
        q.pg = grids.get(t.pg)          
      }
    }
  }
  if (C.ramp && after(C.ramp.z0)) {
    out.ramp = { ...C.ramp, z0: C.ramp.z0 + DZ, z1: C.ramp.z1 + DZ, y0: C.ramp.y0 + DY, y1: C.ramp.y1 + DY }
    if (C.balls) out.balls = { ...C.balls, zEnd: C.balls.zEnd + DZ }
  }
  const ratio = (C.finishZ + DZ) / C.finishZ
  out.finishZ = C.finishZ + DZ
  out.finishY = C.finishY + DY
  out.sections = C.sections.map((s) => (after(s) ? s + DZ : s))
  out.minFinish = Math.round(C.minFinish * ratio)
  out.limit = Math.min(300, Math.max(C.limit, Math.round(C.limit * ratio * 0.85)))
  if (C.rise) out.rise = { ...C.rise, y1: C.rise.y1 + DY, t1: C.rise.t0 + (C.rise.t1 - C.rise.t0) * ratio }
  // percurso que DESCE (Descida dos Aros): a 2ª volta afundaria no mar — levanta tudo, a chegada fica onde estava
  if (DY < 0) {
    const up = -DY
    for (const p of out.pads) (p.y += up), (p.y2 += up)
    for (const q of out.posts) (q.y0 += up), (q.y1 += up)
    for (const L of [out.sweepers, out.gloves, out.pushers, out.logos, out.hoops, out.drums, out.logs, out.planks, out.rotors, out.saws, out.checkpoints, out.tiles]                     ) for (const q of L) q.y += up
    for (const q of out.pendulums) q.py += up
    out.finishY += up
    if (out.ramp) out.ramp = { ...out.ramp, y0: out.ramp.y0 + up, y1: out.ramp.y1 + up }
  }
  const route0 = C.route
  out.route = (r) => {
    const pts = route0(r)
    const res               = []
    const fix = (p            , dz        , map                      ) => {
      const q             = { x: p.x, z: p.z + dz }
      if (p.m !== undefined) q.m = map ? (map.get(p.m) ?? p.m) : p.m
      return q
    }
    for (const p of pts) if (p.z < z1) res.push(fix(p, 0))
    laps.forEach((l, i) => {
      for (const p of pts) if (inLap(p.z, l)) res.push(fix(p, l.dz, padMaps[i]))
    })
    for (const p of pts) if (after(p.z)) res.push(fix(p, DZ))
    return res
  }
  return out
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

/**
 * Canal da Cidade — números da dificuldade (20/11, o Alex: "obstáculos mais resistentes e mais rápidos").
 * Antes: portas 3-2-2 / 2-2, carrossel de uma barra (1,05 rad/s), pêndulos R 1,1 amp 0,95 em 2 fileiras,
 * barris a cada 0,95 s a 7,5 m/s (R 1,2), ponte sem nada.
 */
const CIDADE = {
  /** 20/11: uma porta aberta por fileira, nunca na frente da aberta da anterior (doorsOpen) */
  rows1: [[26, 1], [38, 1], [50, 1]]                      ,
  open2: 1,
  /** socos da ponte: [x da base, z, fase] */
  punches: [[-5.6, 67.5, 0], [5.6, 72.5, 1.2]]                              ,
  punchReach: 6.2,
  punchPeriod: 1.9,
  sweep: { w: 1.1, acc: 0.008, wMax: 1.5, highY: 1.45, highW: 0.6 },
  pend: {
    R: 1.2,
    amp: 1.05,
    rows: [[144, [0, 2.1, 4.2]], [153, [1.1, 3.3, 0.2]]]                        ,
  },
  balls: { every: 0.75, v: 8.5, R: 1.35 },
}         

function courseCidade()         {
  // Portas da Prefeitura (Gincana 3, G3-11): a corrida de abertura do programa. Três fileiras de portas
  // (as falsas são parede; a semente sorteia quais abrem), a ponte, o carrossel de duas barras, mais
  // duas fileiras (menos portas abertas), as passarelas com pêndulos e a subida com barris.
  const k = new CourseKit()
  kitStart(k)
  // ── 1. portas ──
  k.box(0, 39.8, 8, 24.7, 6, 7, 1)
  for (const [z, open] of CIDADE.rows1) k.doorRow(0, z, 5, 3.2, 3.4, open)
  // ── 2. ponte com os socos de lado e o carrossel de duas barras ──
  k.box(0, 70, 2.4, 5.5, 6, 7, 2)
  // 20/11 (dificuldade): dois socos atravessam a ponte estreita, um de cada margem, desencontrados
  for (const [x0, z, ph] of CIDADE.punches) {
    k.post(x0, z, 0.45, -1, DECK + 1.9, 2)
    k.glove(x0, z, DECK + 1, -Math.sign(x0), CIDADE.punchReach, 1.0, CIDADE.punchPeriod, ph)
  }
  k.disc(0, 85, 9.5, 0, 1, 2)
  k.post(0, 85, 0.8, DECK, DECK + 2.4, 1)
  // 20/11: a barra baixa (pular) acelera; a alta (mergulhar, um braço só) gira ao contrário — nunca se passa as duas do mesmo jeito
  const SW = CIDADE.sweep
  k.sweep(0, 85, DECK + 0.55, 9.8, 0.32, SW.w, 0.4, true, SW.acc, SW.wMax)
  k.sweep(0, 85, DECK + SW.highY, 9.8, 0.3, -SW.highW, 0.4 + Math.PI / 2, false)
  k.box(0, 98.5, 5, 4, 6, 7, 2)
  // ── 3. mais portas (menos abertas) ──
  k.box(0, 120.5, 8, 18, 6, 7, 3)
  for (const z of [112, 126]) k.doorRow(0, z, 5, 3.2, 3.4, CIDADE.open2)
  // ── 4. passarelas com pêndulos (três fileiras) ──
  const LANES = [-5, 0, 5]
  for (const x of LANES) k.beam(x, 138.5, x, 160, 1.5, 0, 1, 4)
  const PD = CIDADE.pend
  for (const [z, phs] of PD.rows) LANES.forEach((x, i) => k.swing(x, z, DECK + 9, 7.4, PD.R, PD.amp, 2.2, phs[i]))
  k.box(0, 165, 7, 5, 6, 7, 4)
  // ── 5. subida com barris e a chegada ──
  const z0 = 170
  const finishZ = kitFinish(k, z0, CIDADE.balls.every, CIDADE.balls.v, CIDADE.balls.R)
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
/**
 * 20/11 (pedido do Alex): o chão das duas clareiras das raízes é uma esteira redonda que gira rápido CONTRA a
 * raiz. O que conta é o giro relativo (chão + raiz): a raiz tem que voltar depois dos 1,2 s de quem caiu
 * levantar, senão ela acerta de novo até jogar no pântano. Por isso a raiz ficou mais lenta. Por clareira:
 * [giro da raiz, giro do chão] (rad/s, antes do ×1,22 das corridas; na beira o chão anda ~7–8 m/s).
 */
const FLORESTA_ROOTS = [
  [0.45, 0.85],
  [-0.9, 1.0],
]         
/** Vitórias-régias que andam (antes 3). */
const FLORESTA_LILIES = 8
/** Segundos a mais para o pântano chegar ao topo (e no tempo da prova) por causa do percurso maior. */
const FLORESTA_RISE_PLUS = 25
/** Força da esteira antes das vitórias-régias (fração de GINCANA.belt, contra quem corre). */
const FLORESTA_BELT = 0.5

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
  const roots = (z        , [w, spin]                           , a0        , both         ) => {
    const d = k.disc(0, z, 6.5, 4, 1, 2, Y1)
    k.pads[d].spin = -Math.sign(w) * spin
    k.post(0, z, 0.8, Y1, Y1 + 2.4, 5)
    k.sweep(0, z, Y1 + 0.55, 6.8, 0.34, w, a0, both)
  }
  roots(70.5, FLORESTA_ROOTS[0], 0, true)
  k.box(0, 79.5, 1.8, 2.5, 4, 1, 2, 0, 1.2, Y1)
  roots(88.5, FLORESTA_ROOTS[1], 1.2, false)
  k.box(0, 99, 6, 4, 5, 1, 2, 0, 1.4, Y1)
  // ── 3. rampa curta e vitórias-régias que andam ──
  k.slope(0, 103, 121, Y1, Y2, 4, 5, 1, 3)
  // 20/11 (pedido do Alex): o patamar antes das vitórias-régias é esteira contra quem corre (pule com embalo)
  const pre = k.box(0, 123, 4, 2, 5, 1, 3, 0, 1.2, Y2)
  // (a esteira cheia deixa 2 m/s de embalo e ninguém alcança a 1ª folha: metade da força)
  k.pads[pre].bz = -GINCANA.belt * FLORESTA_BELT
  // 20/11 (pedido do Alex: "tem 3, deixe 8 no mínimo"): oito vitórias-régias; o resto da fase anda LD
  const LILY = Array.from({ length: FLORESTA_LILIES }, (_, i) => 129 + i * 5.5)
  const LD = (FLORESTA_LILIES - 3) * 5.5
  const lilies           = []
  LILY.forEach((z, i) => {
    const p = k.disc(0, z, 2.2, i % 2 ? 2 : 5, 1, 3, Y2)
    k.pads[p].mx = 4
    k.pads[p].mw = 1.1
    k.pads[p].mph = i * 1.6
    lilies.push(p)
  })
  k.box(0, 148 + LD, 6, 4, 5, 1, 3, 0, 1.4, Y2)
  // ── 4. rampa dos cocos (pêndulos) ──
  k.slope(0, 152 + LD, 176 + LD, Y2, Y3, 5, 5, 1, 4)
  let ph = 0
  for (const z of [158, 164, 170]) {
    const top = Y2 + ((z - 152) / 24) * (Y3 - Y2)
    for (const x of [-2.5, 2.5]) {
      k.swing(x, z + LD, top + 9, 7.4, 1.1, 0.95, 2.1, ph)
      ph += 1.9
    }
  }
  k.box(0, 180 + LD, 6, 4, 5, 1, 4, 0, 1.4, Y3)
  // ── 5. ponte de folhas que cai e a subida final ──
  for (let r = 0; r < 7; r++) for (let c = 0; c < 3; c++) k.tile((c - 1) * 2.9, 186.6 + LD + r * 2.9, 1.3, (r + c) % 2 ? 5 : 1, 0, Y3)
  k.box(0, 209 + LD, 6, 3.5, 5, 1, 5, 0, 1.4, Y3)
  k.slope(0, 212.5 + LD, 230.5 + LD, Y3, Y4, 5, 5, 1, 5)
  k.box(0, 238 + LD, 9, 7.5, 1, 0, 6, 0, 1.6, Y4)
  for (const [x, z, y] of [[0, 55, Y1], [0, 99, Y1], [-3, 148 + LD, Y2], [3, 148 + LD, Y2], [0, 180 + LD, Y3], [0, 209 + LD, Y3]]                              ) k.logo(x, z, y)
  const finishZ = 238 + LD
  return k.done({
    id: "floresta",
    mode: "race",
    // 20/11: +LD de percurso (8 vitórias-régias) → o pântano sobe um pouco mais devagar e o tempo cresce junto
    limit: 90 + FLORESTA_RISE_PLUS,
    // 3 s de folga; depois sobe até o topo (antes 0,34 m/s: a largada afogava aos ~12 s, o topo aos ~74 s)
    rise: { y0: 0, y1: 26, t0: 3, t1: 79.5 + FLORESTA_RISE_PLUS },
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 55, y: Y1, w: 6 },
      { x: 0, z: 99, y: Y1, w: 5 },
      { x: 0, z: 148 + LD, y: Y2, w: 5 },
      { x: 0, z: 180 + LD, y: Y3, w: 5 },
    ],
    finishZ,
    finishY: Y4,
    sections: [15, 59, 103, 152 + LD, 184 + LD],
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
        for (const z of [145, 149, 151]) add(0, z + LD)
        const L = [-1.2, 0, 1.2][Math.floor(r(2) * 3)]
        for (let z = 153; z <= 175; z += 2.5) add(L, z + LD)
        for (const z of [178, 182, 184.5]) add(0, z + LD)
        for (let i = 0; i < 7; i++) add(0, 186.6 + LD + i * 2.9)
        for (const z of [206.5, 210, 212]) add(0, z + LD)
        for (let z = 214; z <= 230; z += 2) add(0, z + LD)
        for (const z of [233 + LD, 236 + LD, finishZ + 3]) add(0, z)
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
/**
 * Pedido do Alex (19/11, 3ª rodada): tudo que gira GRANDE (perto da vitória-régia) e rápido, e o circuito
 * maior. O campo de fatias empurra o resto 33 m (CA) e a escada de tocos mais 39 m (CB = 72 no total).
 */
const CA = 33
const CB = 72
/** Fatia grande: raio, vão entre vizinhas e a distância entre centros de uma fileira e da seguinte. */
const DR = 7
const DGAP = 2.4
const DX = 2 * DR + DGAP
const DZ = Math.sqrt(DX * DX - (DX / 2) * (DX / 2))
const DZ0 = 15.1 + DGAP + DR
/** Toco grande: raio, lado da escada e o passo em z (vão 2,4 m). */
const SR = 5.5
const SX = 4.5
const SZ0 = 117 + CA + DGAP + SR
const SZ1 = Math.sqrt((2 * SR + DGAP) ** 2 - SX * SX)
const SZ = Math.sqrt((2 * SR + DGAP) ** 2 - (2 * SX) ** 2)
const CLAREIRA = {
  Y1: CY1,
  Y2: CY2,
  Y3: CY3,
  Y4: CY4,
  /**
   * Campo de discos SOBRE O PÂNTANO ("não pode ter espaço para andar sem ser pelos discos"): colmeia
   * 3-2-3-2-3 de fatias grandes, vão de 2,4 m entre vizinhas (correndo não passa: tem que pular).
   */
  discs: [0, 1, 2, 3, 4].flatMap((row) =>
    (row % 2 ? [-DX / 2, DX / 2] : [-DX, 0, DX]).map((x) => [x, DZ0 + row * DZ]         ),
  )                                          ,
  discR: DR,

  /** Giro das fatias (rad/s, alternando o lado). */

  discSpin: [2.0, 2.3, 2.15]                     ,
  /** Giro dos tocos (rad/s). */
  stumpSpin: 3.2,
  /** Giro da vitória-régia (rad/s). */
  lilySpin: 2.3,
  /** Rampa das frutas (DECK → Y1) e as faixas das frutas. */
  ramp: { z0: 65 + CA, z1: 105 + CA, hx: 8 },
  lanes: [-6, -2, 2, 6]                     ,
  /** Pedras de musgo entre as faixas: x, z (meia largura 0,75, meio comprimento 1,6, 1,5 m acima da rampa). */
  stones: [[-4, 72], [4, 72], [0, 80.5], [-4, 89], [4, 89], [0, 97.5]].map(([x, z]) => [x, z + CA]         )                                          ,
  /** Troncos ocos de onde saem as frutas (um por faixa): centro do tronco deitado. */
  cannonZ: 107.5 + CA,
  cannonR: 1.15,
  cannonLen: 4,
  /** Tocos grandes que giram, em escada: x, z, raio, quanto acima do chão Y1. */
  stumps: [0, 1, 2, 3, 4, 5, 6].map(
    (i) => [i === 0 ? 0 : i % 2 ? SX : -SX, SZ0 + (i === 0 ? 0 : SZ1 + (i - 1) * SZ), SR, 0.9 + i * 0.7]         ,
  )                                                          ,
  /** Árvores gigantes ao lado da escada de tocos. */
  trees: [1, 2, 4, 5].map((i) => [i % 2 ? -12.6 : 12.6, SZ0 + SZ1 + (i - 1) * SZ]         )                                          ,
  treeR: 1.6,
  /** A vitória-régia gigante. */
  lily: { z: 181 + CB, r: 9 },
  /** Cogumelos que lançam (x, z). */
  shrooms: [[-3, 203.1 + CB], [3, 203.1 + CB]]                                          ,
}         

function courseClareira()         {
  const K = CLAREIRA
  const k = new CourseKit()
  kitStart(k)
  // ── 1. campo de fatias de tronco que giram ──
  // sem piso: cada fatia é um tronco em pé no pântano; caiu = volta à largada
  K.discs.forEach(([x, z], i) => {
    const p = k.disc(x, z, K.discR, 1, 1, 1, DECK + 0.25)
    k.pads[p].d = DECK + 0.25
    // vizinhos giram ao contrário (quem pula de uma para a outra troca de sentido)
    k.pads[p].spin = (i % 2 ? -1 : 1) * K.discSpin[i % 3]
    // o miolo da fatia: um cogumelo que empurra
    k.post(x, z, 1.2, DECK + 0.25, DECK + 1.6, 2)
  })
  // ── 2. rampa das frutas, com pedras de musgo entre as faixas ──
  k.box(0, 61.5 + CA, 8, 3.5, 5, 1, 1)
  const R = K.ramp
  const rampY = (z        ) => DECK + ((CY1 - DECK) * (z - R.z0)) / (R.z1 - R.z0)
  k.slope(0, R.z0, R.z1, DECK, CY1, R.hx, 5, 1, 2)
  k.balls = { lanes: K.lanes, every: 0.8, v: 7, R: 1.1, zEnd: 62.5 + CA }
  for (const [x, z] of K.stones) k.box(x, z, 0.75, 1.6, 0, 1, 2, 0, 1.5 + 0.6, rampY(z) + 1.5)
  // ── 3. os troncos ocos no alto da rampa e os tocos que giram sobre o pântano ──
  k.box(0, 111 + CA, 8, 6, 5, 1, 3, 0, 1.4, CY1)
  // tronco oco deitado = parede reta (caixa de 2,3 × 4 m, alto demais para subir)
  for (const x of K.lanes) k.box(x, K.cannonZ, K.cannonR, K.cannonLen / 2, 0, 1, 3, 0, K.cannonR * 2 + 0.2, CY1 + K.cannonR * 2)
  K.stumps.forEach(([x, z, r, h], i) => {
    const p = k.disc(x, z, r, 1, 1, 3, CY1 + h)
    k.pads[p].d = CY1 + h
    k.pads[p].spin = (i % 2 ? 1 : -1) * K.stumpSpin
    // 20/11 (dificuldade): semente pendurada balançando por cima dos tocos pares (joga no pântano)
    if (i > 0 && i % 2 === 0) k.swing(x, z, CY1 + h + 9, 7.4, 1.25, 1.0, 1.9, i * 1.3)
  })
  for (const [x, z] of K.trees) k.post(x, z, K.treeR, 0, CY1 + 12, 0)
  // ── 4. o barranco, a vitória-régia gigante que gira e as sementes penduradas ──
  k.box(0, 161.5 + CB, 7, 6.5, 5, 1, 4, 0, 6, CY2)
  k.box(0, 170.5 + CB, 2, 2.2, 5, 1, 4, 0, 1.2, CY2)
  const lily = k.disc(0, K.lily.z, K.lily.r, 5, 1, 4, CY2)
  k.pads[lily].spin = K.lilySpin
  let ph = 0
  // 20/11 (dificuldade): sementes maiores e com balanço mais largo
  for (const z of [176.5, 181, 185.5]) {
    k.swing(0, z + CB, CY2 + 9, 7.4, 1.4, 1.1, 2.05, ph)
    ph += 2.3
  }
  k.box(0, 192.6 + CB, 2, 2.6, 5, 1, 4, 0, 1.2, CY2)
  // ── 5. cogumelos que lançam e a subida da chegada ──
  k.box(0, 197.6 + CB, 6, 2.4, 5, 1, 5, 0, 1.4, CY2)
  for (const [x, z] of K.shrooms) k.post(x, z, 1.15, 0, CY2 + 0.2, 2, 13.5)
  k.box(0, 210 + CB, 7, 4, 5, 1, 5, 0, 2.6, CY3)
  k.slope(0, 214 + CB, 236 + CB, CY3, CY4, 6, 5, 1, 5)
  k.swing(-2.4, 222 + CB, CY3 + 10.5, 7.6, 1.2, 0.9, 1.9, 0.6)
  k.swing(2.4, 229 + CB, CY3 + 11.5, 7.6, 1.2, 0.9, 1.9, 2.9)
  k.box(0, 243.8 + CB, 9, 7.8, 1, 0, 6, 0, 1.6, CY4)
  for (const [x, z, y] of [[0, 13.5, DECK], [0, 61.5 + CA, DECK], [-4, 113.5 + CA, CY1], [4, 113.5 + CA, CY1], [0, 163 + CB, CY2], [0, 210 + CB, CY3]]                              ) k.logo(x, z, y)
  const finishZ = 236 + CB + 8.8
  return k.done({
    id: "clareira",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 61.5 + CA, y: DECK, w: 6 },
      { x: 0, z: 113 + CA, y: CY1, w: 5 },
      { x: 0, z: 163 + CB, y: CY2, w: 5 },
      { x: 0, z: 198.2 + CB, y: CY2, w: 4 },
    ],
    finishZ,
    finishY: CY4,
    sections: [15.5, R.z0, 112 + CA, 168.5 + CB, 195 + CB],
    minFinish: 22,
    route: (r) =>
      routeOf((add) => {
        // 1. de fatia em fatia em ziguezague (a semente escolhe o lado): entra pela borda, passa ao lado do
        // cogumelo do miolo e sai pela borda voltada para a próxima
        const side = r(1) < 0.5 ? -1 : 1
        add(0, 10)
        add(0, 14.6)
        const hops                     = [0, 1, 2, 3, 4].map((row) => [row % 2 ? (side * DX) / 2 : 0, DZ0 + row * DZ])
        const out                   = [0, 59 + CA]
        let prev                   = [0, 14.6]
        hops.forEach(([x, z], i) => {
          const nx = i + 1 < hops.length ? hops[i + 1] : out
          const din = Math.hypot(x - prev[0], z - prev[1])
          const dout = Math.hypot(nx[0] - x, nx[1] - z)
          add(x - ((x - prev[0]) / din) * (DR - 1.2), z - ((z - prev[1]) / din) * (DR - 1.2))
          add(x + 2.4, z)
          add(x + ((nx[0] - x) / dout) * (DR - 0.8), z + ((nx[1] - z) / dout) * (DR - 0.8))
          prev = [x, z]
        })
        add(out[0], out[1])
        // 2. rampa: sobe pela coluna das pedras e desvia de lado quando a pedra está na frente
        const L = [-4, 0, 4][Math.floor(r(2) * 3)]
        for (let z = 64 + CA; z <= 104 + CA; z += 2) {
          const near = K.stones.some(([x, sz]) => x === L && Math.abs(z - sz) < 2.6)
          add(near ? L + (L >= 0 ? -1.3 : 1.3) * (L === 0 ? side : 1) : L, z)
        }
        // passa entre os troncos ocos pela abertura da coluna
        add(L, 103.5 + CA)
        add(L, 106 + CA)
        add(L, 109 + CA)
        add(L * 0.5, 112 + CA)
        add(0, 115.5 + CA)
        // 3. tocos, um a um: entra pela borda, passa pelo miolo e sai pela borda voltada para o próximo
        let pv                   = [0, 115.5 + CA]
        K.stumps.forEach(([x, z], i) => {
          const nx                   = i + 1 < K.stumps.length ? [K.stumps[i + 1][0], K.stumps[i + 1][1]] : [0, 156.5 + CB]
          const din = Math.hypot(x - pv[0], z - pv[1])
          const dout = Math.hypot(nx[0] - x, nx[1] - z)
          add(x - ((x - pv[0]) / din) * (SR - 1.2), z - ((z - pv[1]) / din) * (SR - 1.2))
          add(x, z)
          add(x + ((nx[0] - x) / dout) * (SR - 1), z + ((nx[1] - z) / dout) * (SR - 1))
          pv = [x, z]
        })
        add(0, 156.5 + CB)
        add(0, 163 + CB)
        add(0, 168.5 + CB)
        add(0, 172 + CB)
        // 4. atravessa a vitória-régia pelo meio
        for (let z = 174; z <= 189; z += 2.5) add(0, z + CB)
        add(0, 191 + CB)
        add(0, 194.5 + CB)
        add(0, 198.5 + CB)
        // 5. cogumelo e o barranco
        const S = K.shrooms[r(3) < 0.5 ? 0 : 1]
        add(S[0], S[1])
        add(S[0] * 0.5, 207 + CB)
        add(0, 211 + CB)
        for (let z = 214.5; z <= 235; z += 2.5) add(0, z + CB)
        add(0, finishZ - 7)
        add(0, finishZ - 2)
        add(0, finishZ + 3)
      }),
  })
}

// ═══ serraria — Serraria da Lua (3ª fase da Floresta) ════════════════════════

/**
 * 20/11 (pedido do Alex, 11º vídeo de referência: tipo de prova "pista de troncos e machados"): a serraria dos
 * lenhadores na Floresta da Lua, de noite. Toras deitadas ATRAVESSADAS na pista que rolam contra quem corre, com
 * fileiras de cravos (`Log`; duas delas deixam um desvio pelo lado), a ponte estreita dos machados de lenhador
 * (pêndulos que varrem a ponte), as tábuas que balançam de lado (`Plank`, duas filas desencontradas) e o
 * pátio das toras grandes com um machado por cima, antes da subida.
 */
const SERRARIA = {
  /** toras do pátio: [x, z, meia largura, giro rad/s, fase dos cravos] */
  logs: [
    [0, 23, 7.6, 1.25, 0],
    [-2.2, 32, 5.4, 1.5, 1.1],
    [2.2, 41, 5.4, -1.35, 2.3],
    [0, 50, 7.6, 1.6, 0.6],
  ]                                              ,
  logR: 1.15,
  /** machados da ponte: z e fase */
  axes: [
    [70, 0],
    [77.5, 1.4],
    [85, 2.7],
    [92.5, 0.8],
  ]                      ,
  axeLen: 6.2,
  /** tábuas: z dos centros (duas filas, x = ±2.6) */
  planks: [111.2, 117.2, 123.2, 129.2, 135.2],
  plankX: 2.6,
  /** pátio das toras grandes: [z, giro] */
  bigLogs: [
    [157, 1.2],
    [172, 1.4],
  ]                      ,
  bigR: 1.3,
}         

function courseSerraria()         {
  const K = SERRARIA
  const k = new CourseKit()
  kitStart(k)
  // ── 1. as toras com cravos ──
  k.box(0, 37, 8.2, 21.9, 0, 1, 1)
  for (const [x, z, hx, w, ph] of K.logs) k.log(x, z, DECK + 0.05, K.logR, hx, w, 2, 3.0, ph)
  // ── 2. a ponte dos machados ──
  k.box(0, 62.5, 3.6, 3.4, 5, 1, 2)
  k.box(0, 82, 1.7, 16.1, 0, 1, 2)
  for (const [z, ph] of K.axes) k.swing(0, z, DECK + 7.6, K.axeLen, 0.8, 1.0, 1.85, ph)
  k.box(0, 102, 3.6, 3.9, 5, 1, 3)
  // ── 3. as tábuas que balançam ──
  K.planks.forEach((z, i) => {
    k.plank(-K.plankX, z, 2.4, 2.9, 0.3, 1.35, i * 1.15)
    k.plank(K.plankX, z, 2.4, 2.9, 0.3, 1.35, i * 1.15 + Math.PI)
  })
  // ── 4. o pátio das toras grandes, com um machado no vão entre elas ──
  k.box(0, 160, 8.2, 21.9, 5, 1, 4)
  for (const [z, w] of K.bigLogs) k.log(0, z, DECK + 0.05, K.bigR, 7.8, w, 2, 2.8, z * 0.3)
  k.swing(0, (K.bigLogs[0][0] + K.bigLogs[1][0]) / 2, DECK + 7.6, K.axeLen, 0.8, 1.0, 1.6, 0.5)
  // ── 5. a subida ──
  const z0 = 182
  const finishZ = kitFinish(k, z0, 1.15, 6.5, 1.1)
  for (const [x, z] of [[0, 18], [6.6, 32], [-6.6, 41], [0, 62.5], [0, 102], [0, 144]]                      ) k.logo(x, z)
  return k.done({
    id: "serraria",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 62.5, y: DECK, w: 3 },
      { x: 0, z: 102, y: DECK, w: 3 },
      { x: 0, z: 144, y: DECK, w: 6 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [15.1, 59.1, 98.1, 138.1, z0],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        add(0, 10)
        add(0, 17)
        add(0, 21)
        add(0, 26)
        // 2ª e 3ª toras: metade desvia pelo vão do lado, metade passa por cima
        const s2 = r(1) < 0.5
        const s3 = r(2) < 0.5
        add(s2 ? 6.2 : -2.2, 29)
        add(s2 ? 6.2 : -2.2, 35)
        add(s3 ? -6.2 : 2.2, 38)
        add(s3 ? -6.2 : 2.2, 44)
        add(0, 47)
        add(0, 53)
        add(0, 57)
        for (let z = 60; z <= 104; z += 2) add(0, z)
        const c = r(3) < 0.5 ? -1 : 1
        add(c * K.plankX, 107)
        for (let z = 109; z <= 137; z += 2) add(c * K.plankX, z)
        add(0, 141)
        for (let z = 145; z <= 180; z += 2.5) add(0, z)
        routeFinish(add, z0, finishZ)
      }),
  })
}

// ═══ canion — Cânion ═════════════════════════════════════════════════════════

/**
 * Gincana 3 (2026-11-18): PEDRAS QUE CAEM — sobrevivência no Cânion. Pedra pisada treme e cai para sempre;
 * quem cai do andar de baixo está FORA. Acaba quando só sobra a vaga (metade) em pé ou em 2 min. Pular poupa
 * pedra: no ar ninguém derruba nada.
 * 20/11 (o Alex: "mais do que 4 pisos e algo legal para dificultar"): SEIS andares (23 → 3 m) e o cânion
 * DESMORONA PELA BORDA — a partir de `CANION.crumble.start` s o anel de fora de cada andar cai sozinho, um anel a
 * cada `every` s, até o miolo (os andares de baixo começam depois). A arena encolhe e quem fica na beira cai.
 */
const STONE_FLOORS = [DECK + 20, DECK + 16, DECK + 12, DECK + 8, DECK + 4, DECK]         
const STONE_R = 18
const STONE_GAP = 2.4

const CANION = {
  floors: STONE_FLOORS,
  /** desmoronamento: começa em `start` s no andar de cima; cada andar abaixo começa `floorLag` s depois; um anel (2,4 m) a cada `every` s */
  crumble: { start: 14, floorLag: 4, every: 3.5, keep: 2.6 },
  warn: 0.85,
}         

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
  const CR = CANION.crumble
  STONE_FLOORS.forEach((y, f) => {
    const rMax = STONE_R - 0.5 * f
    for (const [x, z] of stoneCells(f)) {
      // a cor do ladrilho = o andar (o desenho pinta cada andar de uma cor clara)
      k.tile(x, z, 1.27, f, 1, y)
      // o miolo (raio `keep`) nunca desmorona; o resto cai de fora para dentro
      const d = Math.hypot(x, z)
      if (d > CR.keep) k.tiles[k.tiles.length - 1].cr = CR.start + f * CR.floorLag + Math.floor((rMax - d) / STONE_GAP) * CR.every
    }
  })
  const top = STONE_FLOORS[0]
  return k.done({
    id: "canion",
    mode: "survive",
    qualify: 0.5,
    limit: 120,
    tileTime: { warn: CANION.warn, gone: 1e6 },
    checkpoints: [{ x: 0, z: 1.3, y: top, w: 6 }],
    // arena: ninguém "chega" (a linha fica fora e no alto)
    finishZ: 40,
    finishY: 90,
    sections: [],
    minFinish: 1e6,
    route: () => [{ x: 0, z: 0 }],
  })
}

// ═══ moinhos — Trilha dos Moinhos (2ª fase do Cânion) ═════════════════════════

/**
 * 20/11 (pedido do Alex, 4º vídeo de referência: tipo de prova "circuito de obstáculos misto"): no Cânion
 * Flutuante, a trilha da vila dos moinhos. Moendas de pedra deitadas que giram (o lado é parede; em cima o giro
 * joga você de lado), blocos de arenito que deslizam, pás de moinho girando rente aos discos de pedra, o campo
 * de cata-ventos (pás pequenas em grade, cada uma no seu giro) e a subida com as pedras rolando.
 */
const MOINHOS = {
  R: 1.05,
  /** [x, z0, comprimento, giro rad/s] */
  rollers: [
    [-4.4, 19, 14, 1.4],
    [0, 19, 14, -1.6],
    [4.4, 19, 14, 1.4],
    [-6.6, 37, 14, -1.5],
    [-2.2, 37, 14, 1.7],
    [2.2, 37, 14, -1.7],
    [6.6, 37, 14, 1.5],
  ]                                      ,
  /** cata-ventos: [x, z, giro] */
  vanes: [
    [-6, 130, 1.8], [-1, 130, -2.1], [4, 130, 1.9],
    [-3.5, 138, -2.0], [1.5, 138, 2.2], [6.5, 138, -1.7],
    [-6, 146, 2.1], [-1, 146, -1.9], [4, 146, 2.0],
  ]                              ,
}         

function courseMoinhos()         {
  const K = MOINHOS
  const k = new CourseKit()
  kitStart(k)
  // ── 1. as moendas ──
  k.box(0, 35, 9, 19.9, 0, 1, 1)
  for (const [x, z0, len, w] of K.rollers) k.drum(x, z0, DECK + 0.25, K.R, [{ len, w, holes: [] }], 0.8, true)
  // ── 2. os blocos de arenito ──
  k.box(0, 72, 9, 17.1, 5, 1, 2)
  // 20/11 (dificuldade): cinco blocos (antes três), mais rápidos e indo até a beira (jogam no vazio)
  k.pusher(0, 60, 1.6, 1.6, 2.2, 7.2, 0, 1.25, 0)
  k.pusher(0, 66, 1.6, 1.6, 2.2, 7.2, 0, 1.45, 1.3)
  k.pusher(0, 72, 1.6, 1.6, 2.2, 7.2, 0, 1.35, 2.6)
  k.pusher(0, 78, 1.6, 1.6, 2.2, 7.2, 0, 1.55, 3.9)
  k.pusher(0, 84, 1.6, 1.6, 2.2, 7.2, 0, 1.2, 5.0)
  // ── 3. as pás do moinho sobre dois discos de pedra ──
  k.box(0, 91, 2.2, 2.1, 0, 1, 3)
  k.disc(0, 100, 7, 2, 1, 3)
  k.sweep(0, 100, DECK + 0.55, 6.7, 0.32, 1.3, 0, true)
  k.box(0, 108.5, 2.2, 1.8, 0, 1, 3)
  k.disc(0, 117, 7, 2, 1, 3)
  k.sweep(0, 117, DECK + 0.55, 6.7, 0.32, -1.4, Math.PI / 2, true)
  // ── 4. o campo de cata-ventos ──
  k.box(0, 140, 9, 15.9, 5, 1, 4)
  for (const [x, z, w] of K.vanes) {
    k.sweep(x, z, DECK + 0.5, 2.25, 0.26, w * 1.25, x * 0.7, true)
    k.post(x, z, 0.2, DECK, DECK + 2.6, 4)
  }
  // ── 5. a subida com as pedras ──
  const z0 = 156
  const finishZ = kitFinish(k, z0, 1.1, 6.5, 1.1)
  for (const [x, z] of [[0, 16.5], [-7.4, 45], [0, 57], [0, 91.5], [0, 126]]                      ) k.logo(x, z)
  return k.done({
    id: "moinhos",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 58, y: DECK, w: 6 },
      { x: 0, z: 91.5, y: DECK, w: 2 },
      { x: 0, z: 127.5, y: DECK, w: 6 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [15.1, 54.9, 89.1, 124.1, z0],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        const a = r(1) < 0.5 ? -1 : 1
        const b = r(2) < 0.5 ? -1 : 1
        add(a * 1.2, 10)
        add(a * 2.2, 16.5)
        for (let z = 19; z <= 33; z += 2.5) add(a * 2.2, z)
        add(b * 2.2, 35)
        add(b * 4.4, 36)
        for (let z = 38; z <= 51; z += 2.5) add(b * 4.4, z)
        add(0, 54)
        for (let z = 57; z <= 88; z += 2.5) add(0, z)
        // nos discos, longe do eixo (perto dele a barra passa rápido demais para ler)
        const c = r(3) < 0.5 ? -1 : 1
        add(0, 90)
        add(0, 92.5)
        add(c * 2.6, 96)
        add(c * 3, 100)
        add(c * 2.6, 104)
        add(0, 107.5)
        add(0, 109.5)
        add(-c * 2.6, 113)
        add(-c * 3, 117)
        add(-c * 2.6, 121)
        add(0, 124)
        add(1.5, 128)
        add(1.5, 131)
        add(-1, 134.5)
        add(-1, 139)
        add(1.5, 142.5)
        add(1.5, 147)
        add(0, 152)
        routeFinish(add, z0, finishZ)
      }),
  })
}

// ═══ helices — Hélices da Orbital ════════════════════════════════════════════

/**
 * Gincana (2026-11-20, vídeo 5): CORRIDA DAS HÉLICES — a 2ª fase da Cidade
 * Orbital. Hélices deitadas no vazio: cada uma são 2 ou 3 pás retas cruzadas
 * no mesmo cubo (caixas que giram juntas) e um disco no miolo. Quem pisa é
 * levado pelo giro; entre uma hélice e a outra, o salto é de ponta a ponta.
 * Nas hélices pares, a barra do cubo varre por cima (se pula). Caiu no vazio =
 * volta ao último posto.
 */
const HELICES = {
  /** [x, z, nº de pás (2 = cruz, 3 = seis braços), meio-comprimento da pá, meia-largura, giro rad/s, barra] */
  fans: [
    [0, 30, 2, 7, 1.7, 0.5, 0],
    [0, 46, 3, 7, 1.7, -0.55, 0],
    [-2.5, 89, 3, 7.5, 1.9, 0.5, 1],
    [2, 108.8, 2, 7.5, 1.9, -0.6, 0],
    [-1.5, 128.4, 3, 7.5, 1.9, 0.62, 1],
  ]                                                              ,
  /** 20/11 (pedido do Alex): o miolo de cada hélice gira RÁPIDO ao contrário das pás (× o giro da hélice).
   *  Antes: o miolo girava junto com as pás (× 1). */
  hub: -3.2,
}         

function courseHelices()         {
  const k = new CourseKit()
  kitStart(k)
  const fan = (x        , z        , n        , L        , hw        , w        , bar        , s        ) => {
    for (let i = 0; i < n; i++) {
      const p = k.box(x, z, hw, L, 5, 1, s, (i * Math.PI) / n, 1.2)
      k.pads[p].spin = w
    }
    const c = k.disc(x, z, hw * 1.9, 6, 1, s)
    k.pads[c].spin = w * HELICES.hub
    // a barra do cubo: gira ao contrário, rente ao tampo (se pula); o cubo é um poste (ninguém fica no eixo)
    if (bar) {
      k.sweep(x, z, DECK + 0.55, L - 0.4, 0.3, -w * 1.6, 0.6, true)
      k.post(x, z, 1.1, DECK, DECK + 2.2, 4)
    }
  }
  // ── 1. as duas primeiras hélices ──
  k.box(0, 18.1, 3, 3, 0, 1, 1)
  for (const f of HELICES.fans.slice(0, 2)) fan(f[0], f[1], f[2], f[3], f[4], f[5], f[6], 1)
  // ── 2. a doca: ilha com o posto e o corredor das barras ──
  k.box(0, 58, 4, 3, 0, 1, 2)
  k.box(0, 69.5, 4.5, 8.5, 4, 1, 2)
  k.sweep(0, 64.2, DECK + 0.55, 4.5, 0.3, 1.0, 0, true)
  k.sweep(0, 74.8, DECK + 0.55, 4.5, 0.3, -1.15, 1, true)
  k.box(0, 79.7, 2.5, 1.7, 0, 1, 3)
  // ── 3. três hélices desencontradas, duas com a barra no cubo ──
  for (const f of HELICES.fans.slice(2)) fan(f[0], f[1], f[2], f[3], f[4], f[5], f[6], 3)
  // pilares parados entre uma hélice e a outra (a ponte entre os cubos)
  k.box(0, 99.2, 2, 1.8, 0, 1, 3)
  k.box(0, 118.6, 2, 1.8, 0, 1, 3)
  // ── 4. o cais e as plataformas que vão e voltam ──
  k.box(0, 138.5, 4, 2.6, 0, 1, 4)
  for (const [z, ph] of [[145.5, 0], [152.5, 2.1], [159.5, 4.2]]                      ) {
    const p = k.box(0, z, 2.6, 2.6, 4, 1, 4, 0, 1)
    Object.assign(k.pads[p], { mx: 2.4, mz: 0, mw: 1.1, mph: ph })
  }
  k.box(0, 166.2, 4, 2.8, 0, 1, 4)
  // ── 5. a subida das pedras ──
  const z0 = 169
  const finishZ = kitFinish(k, z0, 1.05, 6.8, 1.1)
  for (const [x, z] of [[0, 16.5], [0, 57], [0, 79], [0, 99.2], [0, 118.6], [0, 139]]                      ) k.logo(x, z)
  return k.done({
    id: "helices",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 58, y: DECK, w: 3 },
      { x: 0, z: 138.5, y: DECK, w: 3 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [17.4, 55, 78, 136, z0],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        add(0, 10)
        add(0, 17)
        add(0, 20.5)
        for (let z = 23; z <= 53; z += 1.5) add(0, z)
        add(0, 56)
        add(0, 59)
        add(2.4, 61.5)
        for (let z = 63; z <= 68.5; z += 1.5) add(2.4, z)
        add(-2.4, 70)
        for (let z = 71.5; z <= 78; z += 1.5) add(-2.4, z)
        add(0, 78.5)
        add(0, 81)
        // nas hélices com barra, longe do cubo (de um lado); na do meio, pelo eixo
        const sd = r(1) < 0.5 ? -1 : 1
        for (let z = 82.5; z <= 135; z += 1.5) {
          if (z > 96.5 && z < 101.5) add(0, z)
          else if (z > 116 && z < 121) add(0, z)
          else if (z < 97) add(-2.5 + sd * 2.6 * Math.max(0, 1 - Math.abs(z - 89) / 7), z)
          else if (z < 117) add(2, z)
          else add(-1.5 - sd * 2.6 * Math.max(0, 1 - Math.abs(z - 128.4) / 7), z)
        }
        add(0, 137)
        for (let z = 140; z <= 165; z += 1.5) add(0, z)
        routeFinish(add, z0, finishZ)
      }),
  })
}

// ═══ crosta — Trilha da Crosta (Forja) ═══════════════════════════════════════

/**
 * Gincana (2026-11-20, vídeo 6): TRILHA DA CROSTA — a 3ª fase da Forja. A lava
 * esfriou em placas sobre o mar de brasa e só um caminho aguenta (a semente
 * sorteia; `pathReal`). A placa firme, pisada, acende em brasa e fica acesa para
 * todos; a crosta falsa afunda na hora e vira buraco. Quatro tabuleiros: o largo
 * (7 × 8), o dos malhos (7 × 10, três malhos com cravos balançando de lado), o
 * estreito (5 × 9, dois malhos) e o da brasa (6 × 8, dois malhos). Caiu na lava =
 * volta ao último posto.
 */
const CROSTA = {
  /** passo do tabuleiro (m) e meia largura da placa */
  step: 2.4,
  h: 1.12,
  /** [x, z0, colunas, fileiras] */
  grids: [
    [0, 16, 7, 8],
    [0, 42.2, 7, 10],
    [0, 73.25, 5, 9],
    [0, 100.75, 6, 8],
  ]                                      ,
  /** malhos: [z, fase] */
  hammers: [
    [47, 0],
    [54.2, 2.1],
    [61.4, 4.2],
    [78.05, 1],
    [87.65, 3.2],
    [105.55, 0.6],
    [112.75, 3.7],
  ]                      ,
  /** 20/11 (dificuldade): malhos maiores, mais largos e mais rápidos (antes R 1,15, amp 0,72/0,9, w 1,9) */
  hamR: 1.25,
  hamAmp: [0.8, 1.0]                    ,
  hamW: 2.0,
  balls: { every: 0.85, v: 7.5, R: 1.25 },
}         

function courseCrosta()         {
  const k = new CourseKit()
  kitStart(k)
  for (const [x, z0, cols, rows] of CROSTA.grids) k.pathGrid(x, z0, cols, rows, CROSTA.h, CROSTA.step, 3)
  // patamares entre os tabuleiros (o posto)
  k.box(0, 37.5, 8.6, 3.55, 2, 1, 2)
  k.box(0, 68.6, 8.6, 3.55, 2, 1, 3)
  k.box(0, 96.6, 6, 3, 2, 1, 4)
  k.box(0, 121.7, 7.4, 3, 2, 1, 5)
  // os malhos: pêndulo pendurado no pórtico, balança de lado (cobre ±6 m)
  for (const [z, ph] of CROSTA.hammers) k.swing(0, z, DECK + 9, 7.6, CROSTA.hamR, z > 70 && z < 95 ? CROSTA.hamAmp[0] : CROSTA.hamAmp[1], CROSTA.hamW, ph)
  const z0 = 124.7
  const finishZ = kitFinish(k, z0, CROSTA.balls.every, CROSTA.balls.v, CROSTA.balls.R)
  for (const [x, z] of [[0, 37.5], [0, 68.6], [0, 96.6], [0, 121.7]]                      ) k.logo(x, z)
  return k.done({
    id: "crosta",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 37.5, y: DECK, w: 6 },
      { x: 0, z: 68.6, y: DECK, w: 6 },
      { x: 0, z: 96.6, y: DECK, w: 4 },
      { x: 0, z: 121.7, y: DECK, w: 5 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [14.9, 41, 72.1, 99.6, z0],
    minFinish: 20,
    // a falsa cai já (0,25 s) e não volta: o buraco é a pista para quem vem atrás
    tileTime: { warn: 0.25, gone: 1e6 },
    route: () =>
      routeOf((add) => {
        add(0, 10)
        for (let z = 14; z <= 122; z += 1.2) add(0, z)
        routeFinish(add, z0, finishZ)
      }),
  })
}

// ═══ gangorras — Gangorras do Desfiladeiro (3ª fase do Cânion) ════════════════

/**
 * 20/11 (pedido do Alex, 8º vídeo de referência: tipo de prova "tábuas que inclinam com o peso sobre o
 * vazio"): pontes de gangorra de madeira e corda atravessando o desfiladeiro. A gangorra inclina pelo PESO de
 * quem está em cima (estado no mundo, `w.saw`) — quem chega encontra a tábua como os da frente deixaram.
 * 1. Três pistas, duas fileiras de gangorras compridas com patamar no meio (a ponta de perto descansa no chão;
 *    passou do eixo, ela tomba para a frente; se tem gente na frente, a sua ponta está no alto: pule).
 * 2. A corrente: três gangorras emendadas em cada uma das duas pistas estreitas, sem patamar.
 * 3. Os pratos de lado: gangorras largas que tombam para o lado de quem pisa fora do meio (escorrega),
 *    com vão para pular entre elas.
 * 4. A balança grande: uma gangorra larga para todos; ela só tomba quando a turma passa do eixo.
 * Diferente da Serraria (tábuas que balançam pelo relógio): aqui quem move a tábua é o peso dos corredores.
 */
const GANGORRAS = {
  /**
   * 20/11 (pedido do Alex: "tem que ser um só bem grande em cada etapa… umas 8 etapas… ele escorrega, conforme
   * ele sobe todo mundo escorrega, é bem sensível"): no lugar das duas fileiras de três tábuas, 8 BALANÇAS largas
   * em fila, uma por etapa, que tombam de LADO pelo peso (mola fraca = sensível) e escorregam forte (`slip`).
   * Quem pisa num lado faz ela descer para esse lado: tem que correr para o outro. Patamar de descanso depois
   * da 4ª. `rest` = repouso torto, alternando o lado. Antes: rows [19.9, 35.5], lanes ±3.4 / 0, long hx 1,25.
   */
  stages: { n: 8, z0: 15.4, hx: 3.3, hz: 3.3, gap: 0.5, max: 0.34, k: 0.3, slip: 11, rest: 0.06, mid: 4, midHz: 2.6 },
  long: { hx: 1.25, hz: 4.5, max: 0.2, k: 0.9 },
  /** corrente: z do eixo de cada elo; pistas ±2.3 */
  chain: [51.1, 60.4, 69.7],
  chainX: 2.3,
  chainHx: 1.0,
  /** pratos de lado: [x, z, meia largura] */
  plates: [[-2.9, 84, 2.2], [2.9, 84, 2.2], [0, 91.4, 3.1], [-3.2, 98.8, 2.3], [3.2, 98.8, 2.3], [0, 105.2, 3.1]]                              ,
  plateHz: 2.1,
  big: { z: 123.3, hx: 5.2, hz: 6, max: 0.16, k: 0.35 },
}         

/** Gangorras: z do centro de cada balança, o patamar do meio e onde acabam (20/11). */
function gangorraStages() {
  const S = GANGORRAS.stages
  const zs           = []
  let z = S.z0
  let mid = 0
  for (let i = 0; i < S.n; i++) {
    if (i === S.mid) {
      mid = z + S.midHz
      z += 2 * S.midHz + S.gap
    }
    zs.push(z + S.hz)
    z += 2 * S.hz + S.gap
  }
  return { zs, mid, end: z - S.gap }
}
/** O resto da fase (do patamar 43,3 em diante) anda isto para a frente (as balanças são mais compridas). */
const GANG_D = gangorraStages().end + 0.2 - 40.2

function courseGangorras()         {
  const K = GANGORRAS
  const k = new CourseKit()
  kitStart(k)
  // gangorra comprida que descansa com a ponta de perto no chão (eixo acima do patamar)
  const longSaw = (x        , z        , hx        , hz        , max        , kk        ) =>
    k.saw(x, z, DECK + Math.tan(max) * hz, hx, hz, 0, max, -max, kk)
  const D = GANG_D
  const ST = K.stages
  const G = gangorraStages()
  // ── 1. as 8 balanças grandes (tombam de lado com o peso e escorregam) ──
  G.zs.forEach((z, i) => {
    k.saw(0, z, DECK, ST.hx, ST.hz, 1, ST.max, i % 2 ? ST.rest : -ST.rest, ST.k)
    k.saws[k.saws.length - 1].slip = ST.slip
  })
  k.box(0, G.mid, ST.hx, ST.midHz, 1, 1, 1)
  k.box(0, 43.3 + D, 6.2, 3.1, 1, 1, 1)
  // 20/11 (dificuldade): no patamar, a barra baixa girando (pule ou cai no vazio)
  k.sweep(0, 43.3 + D, DECK + 0.55, 5.6, 0.3, -1.2, Math.PI / 2, true)
  // ── 2. a corrente: três elos emendados em cada pista ──
  for (const x of [-K.chainX, K.chainX]) for (const z of K.chain) longSaw(x, z + D, K.chainHx, K.long.hz, K.long.max, K.long.k)
  // 20/11 (dificuldade): pêndulos atravessando as duas correntes
  k.swing(0, 55.7 + D, DECK + 8.6, 7.2, 1.05, 0.85, 1.9, 0)
  k.swing(0, 65 + D, DECK + 8.6, 7.2, 1.05, 0.85, 1.9, 2.2)
  k.box(0, 77.5 + D, 5.2, 3, 1, 1, 2)
  // ── 3. os pratos de lado ──
  // descansam tortos, cada um para um lado: quem pisa no lado baixo escorrega e tomba mais; o peso no lado alto endireita
  K.plates.forEach(([x, z, hx], i) => k.saw(x, z + D, DECK, hx, K.plateHz, 1, 0.28, i % 2 ? 0.13 : -0.13, 0.9))
  k.box(0, 113.4 + D, 6.2, 3, 1, 1, 3)
  k.sweep(0, 113.4 + D, DECK + 0.55, 5.6, 0.3, 1.25, 0.8, true)
  // ── 4. a balança grande ──
  longSaw(0, K.big.z + D, K.big.hx, K.big.hz, K.big.max, K.big.k)
  const z0 = K.big.z + D + K.big.hz + 0.3
  const finishZ = kitFinish(k, z0, 1.05, 7, 1.15)
  for (const [x, z] of [[0, G.mid], [-3, 43.3 + D], [3, 43.3 + D], [0, 77.5 + D], [0, 113.4 + D]]                      ) k.logo(x, z)
  return k.done({
    id: "gangorras",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: G.mid + 1.2, y: DECK, w: 4 },
      { x: 0, z: 43.3 + D, y: DECK, w: 5 },
      { x: 0, z: 77.5 + D, y: DECK, w: 4 },
      { x: 0, z: 113.4 + D, y: DECK, w: 5 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [15.1, 46.4 + D, 80.5 + D, 116.4 + D, z0],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        add(0, 10)
        // balanças: um pouco fora do meio (o peso de cada um conta); a regra de correr para o lado que sobe é do robô
        G.zs.forEach((z, i) => {
          const x = (r(10 + i) - 0.5) * 2
          add(x, z - ST.hz + 0.7)
          add(x, z + ST.hz - 0.7)
        })
        const l3 = r(3) < 0.5 ? -K.chainX : K.chainX
        add(l3, 46 + D)
        add(l3, 74 + D)
        // pratos: o do lado da corrente, o do meio, um dos dois de lado e o do meio
        // (no prato, um pouco fora do meio: o peso de cada um conta)
        const o = (i        ) => (r(6 + i) - 0.5) * 2.2
        add(Math.sign(l3) * 2.9 + o(0), 81 + D)
        add(Math.sign(l3) * 2.9 + o(0), 86 + D)
        add(o(1), 89.4 + D)
        add(o(1), 93.4 + D)
        const s4 = r(4) < 0.5 ? -3.2 : 3.2
        add(s4 + o(2), 96.8 + D)
        add(s4 + o(2), 100.8 + D)
        add(o(3), 104.2 + D)
        add(o(3), 108.2 + D)
        add(0, 111 + D)
        for (let z = K.big.z + D - K.big.hz + 1; z <= K.big.z + D + K.big.hz - 1; z += 2) add(r(5) < 0.5 ? -1.5 : 1.5, z)
        routeFinish(add, z0, finishZ)
      }),
  })
}

// ═══ aros — Descida dos Aros (Mar de Gelo) ════════════════════════════════════

/**
 * Gincana (2026-11-20, vídeo 7): DESCIDA DOS AROS — a 4ª fase do Mar de Gelo.
 * Larga no alto e desce duas ladeiras de gelo liso (escorrega e a ladeira
 * empurra para baixo). Aros de cristal no ar: quem PULA pelo meio ganha turbo e
 * embalo (`hoopPass`); um vai e volta de lado; um cogumelo de neve lança até o
 * aro alto. Um bloco de gelo desliza no patamar. No fim, três paredões de janelas:
 * só passa quem pula pela janela (parapeito de 1 m, verga a 3,6 m), e cada janela tem um aro.
 */
const AROS = {
  y0: DECK + 12,
  /** [x, z, altura acima do gelo, mx, w, fase] */
  hoops: [
    [-2.5, 24, 2.2, 0, 0, 0],
    [2.2, 33, 2.2, 0, 0, 0],
    [-1.2, 42, 2.2, 0, 0, 0],
    [2.6, 51, 2.2, 0, 0, 0],
    [0, 77, 2.2, 0, 0, 0],
    [-3, 91, 4.6, 0, 0, 0],
    [0, 99, 2.2, 3, 1.2, 0],
    [2.2, 107, 2.2, 0, 0, 0],
  ]                                                      ,
  /** paredões: [z, janelas (x)] — parapeito 1 m, janela de 2,4 m (20/11: 3-2-3 → 2-1-2) */
  walls: [
    [124, [-2.4, 2.4]],
    [130.5, [0]],
    [137, [-4.8, 4.8]],
  ]                        ,
  /** 20/11 (dificuldade): blocos de gelo que deslizam de lado na 1ª descida — [z, fase] */
  slides: [[31, 0], [38.5, 1.4], [55, 2.6]]                      ,
  slideAx: 4.6,
  slideW: 1.25,
  /** 20/11: estalactites em pêndulo na 2ª descida — [x, z, fase] */
  icicles: [[-2.4, 81, 0], [1.8, 94.5, 1.6], [-1.2, 103, 3.1]]                              ,
  /** 20/11: as pedras da subida (antes 1,05 s, 6,8 m/s, R 1,1) */
  balls: { every: 0.8, v: 8, R: 1.3 },
}         

function courseAros()         {
  const k = new CourseKit()
  const Y0 = AROS.y0
  const Y1 = DECK + 5
  // largada no alto
  k.box(0, 0, 10, 8, 6, 7, 0, 0, 3, Y0)
  k.box(0, 11.5, 7, 3.6, 0, 1, 0, 0, 2, Y0)
  for (const x of [-4, 0, 4]) k.logo(x, 12.5, Y0)
  // ladeira de gelo: escorrega (f) e empurra para baixo (bz)
  const ice = (z0        , z1        , y0        , y1        , s        ) => {
    const p = k.slope(0, z0, z1, y0, y1, 6.5, 3, 1, s)
    Object.assign(k.pads[p], { f: 0.55, bz: 2.2 })
  }
  const surf = (z        ) => (z < 60 ? Y0 + ((Y1 - Y0) * (z - 15.1)) / (60 - 15.1) : Y1 + ((DECK - Y1) * (z - 68)) / (112 - 68))
  // ── 1. a primeira descida, com os aros ──
  ice(15.1, 60, Y0, Y1, 1)
  for (const [x, z] of [[2.6, 28.5], [-2.8, 46.5]]                      ) k.post(x, z, 0.75, surf(z) - 0.5, surf(z) + 1.9, 3)
  // blocos de gelo que cruzam a ladeira (meio enterrados: o topo fica 1,5 m acima do gelo)
  for (const [z, ph] of AROS.slides) k.pusher(0, z, 1.2, 1.2, 2.0, AROS.slideAx, 0, AROS.slideW, ph, surf(z) - 0.5)
  // ── 2. patamar com o bloco de gelo que desliza ──
  k.box(0, 64, 7, 4, 2, 1, 2, 0, 2.2, Y1)
  k.pusher(0, 64.5, 1.4, 1.4, 2.0, 4.8, 0, 1.1, 0, Y1)
  // ── 3. a segunda descida: aro, cogumelo de neve até o aro alto, aro que vai e volta ──
  ice(68, 112, Y1, DECK, 3)
  k.post(-3, 86.5, 1.1, surf(86.5) - 0.6, surf(86.5) + 0.15, 2, 12.5)
  k.post(3.2, 83, 0.75, surf(83) - 0.5, surf(83) + 1.9, 3)
  for (const [x, z, dy, mx, w, ph] of AROS.hoops) k.hoop(x, z, surf(z) + dy, 1.45, mx, w, ph)
  for (const [x, z, ph] of AROS.icicles) k.swing(x, z, surf(z) + 8.6, 7.2, 1.1, 1.05, 2.3, ph)
  // ── 4. o paredão de janelas: parede com janelas de parapeito baixo, um aro em cada janela ──
  k.box(0, 116.5, 7.5, 4.5, 2, 1, 4, 0, 1.6)
  k.box(0, 136.5, 8, 15.5, 2, 1, 4, 0, 1.6)
  for (const [z, wins] of AROS.walls) {
    const W = 1.2
    const xs = [-8, ...wins.flatMap((x) => [x - W, x + W]), 8]
    for (let i = 0; i < xs.length; i += 2) {
      const a = xs[i]
      const b = xs[i + 1]
      if (b - a > 0.05) k.box((a + b) / 2, z, (b - a) / 2, 0.45, 5, 1, 4, 0, 4.5, DECK + 4.5)
    }
    for (const x of wins) {
      k.box(x, z, W, 0.45, 5, 1, 4, 0, 1, DECK + 1)
      // a verga: a janela é janela (de 1 a 3,6 m), não um entalhe até o topo
      k.box(x, z, W, 0.45, 5, 1, 4, 0, 0.9, DECK + 4.5)
      k.hoop(x, z, DECK + 2.25, 1.15)
    }
  }
  // a subida das pedras (a rampa das bolas é a dela, não a das descidas)
  k.ramp = null
  const z0 = 152
  const finishZ = kitFinish(k, z0, AROS.balls.every, AROS.balls.v, AROS.balls.R)
  for (const [x, z, y] of [[0, 64, Y1], [0, 116.5, DECK]]                              ) k.logo(x, z, y)
  return k.done({
    id: "aros",
    checkpoints: [
      { x: 0, z: -3.5, y: Y0, w: 7 },
      { x: 0, z: 64, y: Y1, w: 5 },
      { x: 0, z: 116.5, y: DECK, w: 5 },
      { x: 0, z: 134, y: DECK, w: 5 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [15.1, 60, 68, 121, z0],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        add(0, 10)
        add(0, 14)
        // pelos aros (a semente decide se o robô vai buscar o aro alto do cogumelo)
        const high = r(2) < 0.6
        for (const [x, z] of AROS.hoops) {
          if (z === 91 && !high) {
            add(0, 84)
            add(0, 92)
            continue
          }
          if (z === 91) add(-3, 84.5)
          add(x, z - 3.5)
          add(x, z + 1)
        }
        add(0, 114)
        // uma janela de cada paredão (pela semente)
        for (const [z, wins] of AROS.walls) {
          const x = wins[Math.floor(r(3 + z) * wins.length)]
          add(x, z - 3)
          add(x, z + 1.2)
        }
        add(0, 142)
        routeFinish(add, z0, finishZ)
      }),
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
  // 20/11 (dificuldade; o `tempo` das corridas não vale na arena): chão 0,16 → 0,22; barras aceleram mais e vão
  // mais longe (baixa 0,02/2,5 → 0,026/2,9; alta 0,014/1,7 → 0,02/2,1)
  k.pads[floor].spin = 0.22
  k.post(0, 0, 1.1, DECK, DECK + 3.2, 4)
  // barra baixa (pular): dois braços
  k.sweep(0, 0, DECK + 0.55, 11.6, 0.36, 0.85, 0, true, 0.026, 2.9)
  // barra alta (mergulhar): um braço, ao contrário, na altura do peito
  k.sweep(0, 0, DECK + 1.4, 11.6, 0.3, -0.6, Math.PI / 2, false, 0.02, 2.1)
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

// ═══ altoforno — Esteira do Alto-Forno (2ª fase da Forja) ═════════════════════

/**
 * 20/11 (pedido do Alex, 3º vídeo de referência: tipo de prova "esteira subindo contra você com o canhão no
 * alto atirando coisas que quicam"): na Forja de Kragor, a esteira de ferro sobe 80 m até a boca do
 * alto-forno e PUXA PARA TRÁS; lá de cima o canhão cospe bolas de ferro em brasa que descem QUICANDO e indo
 * de lado (no alto do quique dá para passar por baixo). Bigornas nas bordas, o patamar com a barra de fogo
 * que gira e a esteira curta até a chegada.
 */
const ALTOFORNO = {
  z0: 40,
  z1: 120,
  rise: 10,
  hx: 7,
  belt: -4.4,
  lanes: [-4.8, -2.4, 0, 2.4, 4.8],
}         

function courseAltoForno()         {
  const K = ALTOFORNO
  const k = new CourseKit()
  kitStart(k)
  // ── 1. o pátio da fundição: aquecimento com duas barras de fogo baixas ──
  k.box(0, 27.5, 8, 12.4, 6, 7, 1)
  k.sweep(0, 28, DECK + 0.5, 7, 0.35, 1.4, 0, true)
  // ── 2–3. a esteira grande (a 1ª rampa: é ela que tem as bolas) ──
  const ramp = k.slope(0, K.z0, K.z1, DECK, DECK + K.rise, K.hx, 6, 7, 2)
  k.pads[ramp].bz = K.belt
  // bigornas nas bordas (para quem foge da bola pelo canto: um tranco)
  for (let z = K.z0 + 8; z < K.z1 - 4; z += 12) {
    for (const s of [-1, 1]) {
      const zz = z + (s > 0 ? 6 : 0)
      const y = DECK + (K.rise * (zz - K.z0)) / (K.z1 - K.z0)
      k.post(s * (K.hx - 0.7), zz, 0.6, y, y + 1.3, 3)
    }
  }
  k.balls = { lanes: K.lanes, every: 0.95, v: 9, R: 1.25, zEnd: K.z0 - 2.2, hop: 1.7, hopT: 0.62, drift: 0.9 }
  // ── 4. o patamar do alto-forno: a barra de fogo que gira ──
  const top = DECK + K.rise
  k.box(0, 127.5, 8, 7.5, 6, 7, 4, 0, 1.4, top)
  k.sweep(0, 127.5, top + 0.6, 7.6, 0.4, 1.7, 0, true)
  // ── 5. esteira curta até a chegada e o patamar ──
  const z2 = 135
  const z3 = 163
  const fin = k.slope(0, z2, z3, top, top + 4, 6, 6, 7, 5)
  k.pads[fin].bz = K.belt * 0.6
  k.box(0, z3 + 7.8, 9, 7.8, 1, 0, 6, 0, 1.6, top + 4)
  for (const [x, z, y] of [[0, 20, DECK], [-4.4, 60, DECK + 2.5], [4.4, 90, DECK + 6.25], [0, 145, top + 1.4]]                              ) k.logo(x, z, y)
  const finishZ = z3 + 8.8
  return k.done({
    id: "altoforno",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 36, y: DECK, w: 6 },
      { x: 0, z: 123, y: top, w: 6 },
      { x: 0, z: 133, y: top, w: 6 },
    ],
    finishZ,
    finishY: top + 4,
    sections: [15.1, K.z0, 80, K.z1, z2],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(side * 0.6, 16)
        add(side * 4.5, 24)
        add(side * 4.5, 32)
        for (let z = K.z0 + 1; z <= K.z1; z += 2.5) add(0, z)
        add(0, 124)
        add(0, 131)
        for (let z = z2 + 1; z <= z3; z += 2.5) add(0, z)
        add(0, finishZ - 2)
        add(0, finishZ + 3)
      }),
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

// ═══ comportas — Comportas da Usina (2ª fase da Fábrica) ═════════════════════

/**
 * 20/11 (pedido do Alex: fases novas pelos vídeos de referência; tipo de prova "portões que sobem e
 * descem"): corrida na usina da Fábrica. Fileiras de COMPORTAS de aço saem do chão e voltam pelo relógio
 * (gateLift); entre elas, paredes fixas listradas. Embaixo a comporta é chão; em cima é parede de 3,5 m (e
 * quem estava no tampo sobe junto). Trechos: comportas em onda → comportas baixas (pule) e fundas →
 * funil com muretas → GRAXA (corre na metade) com comportas lentas → a fileira rápida e a subida.
 */
const COMPORTAS = {
  /** Centros das 5 comportas e das paredes entre elas (fileira larga, deck de 22 m). */
  gx: [-8.4, -4.2, 0, 4.2, 8.4],
  wall: [[-10.4, 0.6], [-6.3, 0.5], [-2.1, 0.5], [2.1, 0.5], [6.3, 0.5], [10.4, 0.6]]                      ,
  /** Fileira estreita (funil, deck de 14 m). */
  gx3: [-4.2, 0, 4.2],
  wall3: [[-6.3, 0.7], [-2.1, 0.5], [2.1, 0.5], [6.3, 0.7]]                      ,
  gateHx: 1.6,
  gateH: 3.5,
  lowH: 1.0,
  wallH: 3.2,
  /** Graxa: fração da corrida. */
  grease: 0.5,
}         

function courseComportas()         {
  const K = COMPORTAS
  const k = new CourseKit()
  kitStart(k)
  const row = (z        , hz        , xs                   , walls                             , per        , ph                       , s        , h                        = () => K.gateH) => {
    xs.forEach((x, i) => k.gate(x, z, K.gateHx, hz, h(i), per, ph(i), 6, 7, s))
    for (const [x, hx] of walls) k.box(x, z, hx, hz + 0.15, 4, 1, s, 0, K.wallH + 1.4, DECK + K.wallH)
  }
  // ── 1. comportas em onda ──
  k.box(0, 40, 11, 24.9, 3, 1, 1)
  row(26, 1.4, K.gx, K.wall, 4, (i) => i * 0.8, 1)
  row(40, 1.4, K.gx, K.wall, 4, (i) => (4 - i) * 0.8, 1)
  row(54, 1.4, K.gx, K.wall, 3.6, (i) => (i % 2) * 1.8, 1)
  for (const [x, z] of [[-9.4, 33], [9.4, 33], [-9.4, 47], [9.4, 47]]                      ) k.post(x, z, 0.8, DECK, DECK + 2.2, 2)
  // 20/11 (dificuldade): martelo no 1º vão e barra baixa girando no 2º (pule)
  k.swing(0, 33, DECK + 8, 6.6, 1.0, 1.05, 2.0, 0.3)
  k.sweep(0, 47, DECK + 0.55, 4.6, 0.32, -0.72, Math.PI / 2, true)
  // ── 2. comportas baixas (pule) e fundas ──
  k.box(0, 85, 11, 20.2, 3, 1, 2)
  row(72, 1.4, K.gx, K.wall, 3.2, (i) => i * 0.64, 2, (i) => (i % 2 ? K.lowH : K.gateH))
  row(84, 1.4, K.gx, K.wall, 3, (i) => (i % 2) * 1.5, 2)
  row(96, 2.4, K.gx, K.wall, 4.4, (i) => [0, 2.2, 1.1, 3.3, 0.5][i], 2)
  for (const [x, z] of [[-9.4, 78], [9.4, 78], [-9.4, 90], [9.4, 90]]                      ) k.post(x, z, 0.8, DECK, DECK + 2.2, 2)
  // 20/11 (dificuldade): martelos do guindaste em pêndulo entre as fileiras (jogam para a beira)
  k.swing(-3.6, 78, DECK + 8, 6.6, 1.0, 1.0, 2.0, 0)
  k.swing(3.6, 78, DECK + 8, 6.6, 1.0, 1.0, 2.0, Math.PI)
  k.swing(-2.4, 90, DECK + 8, 6.6, 1.05, 1.1, 2.1, 0.8)
  k.swing(2.4, 90, DECK + 8, 6.6, 1.05, 1.1, 2.1, 0.8 + Math.PI)

  // ── 3. funil com muretas e a fileira estreita ──
  k.box(0, 120, 7, 15.1, 3, 1, 3)
  k.box(-2.5, 112, 4.5, 0.45, 2, 1, 3, 0, 1.0 + 1.4, DECK + 1.0)
  k.box(2.5, 119, 4.5, 0.45, 2, 1, 3, 0, 1.0 + 1.4, DECK + 1.0)
  // 20/11 (dificuldade): no funil, um pistão sai da mureta e soca para fora (cai do deck)
  k.glove(-6.4, 110.6, DECK + 1, 1, 11.4, 1.1, 2.0, 0)
  k.glove(6.4, 118.2, DECK + 1, -1, 11.4, 1.1, 2.0, 1.1)
  row(128, 1.4, K.gx3, K.wall3, 2.8, (i) => i * 0.93, 3)
  // ── 4. graxa com comportas lentas ──
  const g = k.box(0, 150, 11, 15, 4, 1, 4)
  k.pads[g].sl = K.grease
  row(150, 1.4, K.gx, K.wall, 5, (i) => i, 4)
  // 20/11 (dificuldade): na graxa, martelos em pêndulo (no escorregadio é difícil fugir)
  k.swing(-3.2, 142, DECK + 8, 6.6, 1.0, 1.05, 2.0, 0)
  k.swing(3.2, 142, DECK + 8, 6.6, 1.0, 1.05, 2.0, Math.PI)

  for (const [x, z] of [[-3, 158], [3, 158]]                      ) k.post(x, z, 0.8, DECK, DECK + 2.2, 2)

  // ── 5. a fileira rápida e a subida ──
  k.box(0, 172, 11, 7, 3, 1, 5)
  row(172, 1.4, K.gx, K.wall, 2.6, (i) => i * 0.52, 5)
  // 20/11 (dificuldade): martelos antes da fileira rápida
  k.swing(-2.8, 167.4, DECK + 8, 6.6, 1.0, 1.0, 2.2, 0.4)
  k.swing(2.8, 167.4, DECK + 8, 6.6, 1.0, 1.0, 2.2, 0.4 + Math.PI)

  const z0 = 179
  k.slope(0, z0, z0 + 14, DECK, DECK + 3, 8, 0, 1, 5)
  k.box(0, z0 + 14 + 7.8, 9, 7.8, 1, 0, 6, 0, 1.6, DECK + 3)
  const finishZ = z0 + 14 + 8.8
  for (const [x, z] of [[0, 67], [-4, 107], [4, 107], [0, 166]]                      ) k.logo(x, z)
  return k.done({
    id: "comportas",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 67, y: DECK, w: 7 },
      { x: 0, z: 107.5, y: DECK, w: 6 },
      { x: 0, z: 137.5, y: DECK, w: 7 },
      { x: 0, z: 167, y: DECK, w: 7 },
    ],
    finishZ,
    finishY: DECK + 3,
    sections: [15.1, 64.9, 105.1, 135, 165],
    minFinish: 20,
    // a rota só segue o meio: a escolha da comporta é do computador (bots.ts gateAim), na hora
    route: (r) =>
      routeOf((add) => {
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(side * 0.8, 15.5)
        for (let z = 18; z <= 104; z += 2) add(0, z)
        add(4.6, 109)
        add(4.6, 113.5)
        add(0, 115.8)
        add(-4.6, 117.5)
        add(-4.6, 120.5)
        add(0, 123)
        for (let z = 125; z <= 177; z += 2) add(0, z)
        for (let z = z0 + 1; z <= z0 + 13; z += 2.5) add(0, z)
        add(0, finishZ - 7)
        add(0, finishZ - 2)
        add(0, finishZ + 3)
      }),
  })
}

// ═══ tanque — Tanque de Óleo (3ª fase da Fábrica) ═══════════════════════════

/**
 * 20/11 (pedido do Alex, 10º vídeo de referência: tipo de prova "subida em zigue-zague com o líquido subindo"):
 * dentro do tanque da Fábrica o óleo SOBE e quem ele alcança está FORA. Quatro rampas de aço que trocam de
 * lado (esquerda, direita, esquerda, meio), ligadas por patamares que se cruzam de lado a lado. Em cada trecho
 * um perigo da Fábrica: barris rolando na 1ª rampa, prensas que deslizam de lado na 2ª, os ganchos do
 * guindaste que balançam no 2º patamar, os pistões que socam da parede na 3ª rampa (jogam no óleo), as
 * prensas do 3º patamar e os ganchos da rampa do meio até a chegada no alto do tanque.
 * Diferente da Maré do Pântano: o caminho vai e volta (zigue-zague), o perigo é empurrar de lado.
 */
const TANQUE = {
  /** x das rampas (trocam de lado; a última no meio) */
  rx: [-4.2, 4.2, -4.2, 4.2, -4.2, 4.2, 0]         ,
  rhx: 3.1,
  /** z de cada rampa [início, fim] */
  rz: [
    [15, 39],
    [48, 72],
    [81, 105],
    [114, 138],
    [147, 171],
    [180, 204],
    [213, 231],
  ]                      ,
  /** altura de cada andar acima do DECK */
  dy: [0, 5, 10, 15, 20, 25, 30, 35]         ,
  /** z das prensas da 2ª e da 5ª rampa e fases */
  press2: [[54, 0], [60, 1.6], [66, 3.2]]                      ,
  press5: [[153, 0.4], [160, 2.2], [167, 1.0]]                      ,
  /** z dos pistões da 3ª, 4ª e 6ª rampa (socam da parede de fora) */
  punch3: [[87, 0], [93, 0.8], [99, 1.6]]                      ,
  punch4: [[119, 0.3], [124, 1.1], [129, 1.9], [134, 0.7]]                      ,
  punch6: [[185, 0], [189.5, 0.6], [194, 1.2], [198.5, 1.8]]                      ,
  /** Óleo derramado: a corrida fica nesta fração e o pé escorrega (atrito). */
  oilRun: 0.55,
  oilGrip: 0.3,
}         

function courseTanque()         {
  const K = TANQUE
  const k = new CourseKit()
  kitStart(k)
  const Y = K.dy.map((d) => DECK + d)
  const yAt = (i        , z        ) => Y[i] + ((z - K.rz[i][0]) / (K.rz[i][1] - K.rz[i][0])) * (Y[i + 1] - Y[i])
  const ramp = (i        , s        , hx         = K.rhx) => k.slope(K.rx[i], K.rz[i][0], K.rz[i][1], Y[i], Y[i + 1], hx, 3, 1, s)
  const land = (i        , s        ) => {
    const z0 = K.rz[i][1]
    const z1 = K.rz[i + 1][0]
    return k.box(0, (z0 + z1) / 2, 8.4, (z1 - z0) / 2, 5, 1, s, 0, 1.4, Y[i + 1])
  }
  const greasy = (p        ) => Object.assign(k.pads[p], { sl: K.oilRun, f: K.oilGrip })
  // poça de óleo na rampa i, de z0 a z1, faixa (x relativo à rampa, meia largura): uma rampa fina por cima
  const oilRamp = (i        , z0        , z1        , dx        , hx        , s        ) =>
    greasy(k.slope(K.rx[i] + dx, z0, z1, yAt(i, z0) + 0.03, yAt(i, z1) + 0.03, hx, 3, 1, s))
  // poça no patamar i (que fica depois da rampa i)
  const oilLand = (i        , x        , z        , hx        , hz        , s        ) => greasy(k.box(x, z, hx, hz, 5, 1, s, 0, 0.3, Y[i + 1] + 0.15)) // acima das barras da grade
  const pistons = (i        , list                                        , reach        , per        ) => {
    const out = K.rx[i] < 0 ? -1 : 1
    for (const [z, ph] of list) k.glove(K.rx[i] + out * (K.rhx + 1.6), z, yAt(i, z) + 1, -out, reach, 1.0, per, ph)
  }
  // ── 1. rampa dos barris (esquerda) ──
  ramp(0, 1)
  k.balls = { lanes: [-1.5, 1.5], every: 1.5, v: 6, R: 1.0, zEnd: 12 }
  land(0, 1)
  k.glove(9.4, 41.5, Y[1] + 1, -1, 7.5, 1.0, 2.6, 0)
  k.glove(9.4, 45.5, Y[1] + 1, -1, 7.5, 1.0, 2.6, 1.3)
  // ── 2. rampa das prensas (direita) ──
  ramp(1, 2)
  for (const [z, ph] of K.press2) k.pusher(K.rx[1], z, 1.1, 1.1, 1.8, 2.1, 0, 1.25, ph, yAt(1, z))
  oilRamp(1, 50, 56, -1.4, 1.5, 2)
  land(1, 2)
  k.swing(-2.5, 75, Y[2] + 8, 6.6, 0.9, 0.9, 1.9, 0)
  k.swing(2.5, 78.5, Y[2] + 8, 6.6, 0.9, 0.9, 1.9, 1.6)
  // ── 3. rampa dos pistões (esquerda) ──
  ramp(2, 3)
  pistons(2, K.punch3, 3.4, 2.2)
  oilRamp(2, 90, 100, 1.5, 1.4, 3)
  land(2, 3)
  k.pusher(-2.6, 108, 1.2, 1.2, 1.8, 3.6, 0, 1.0, 0, Y[3])
  k.pusher(2.6, 111.5, 1.2, 1.2, 1.8, 3.6, 0, 1.0, 2.2, Y[3])
  // ── 4. vazamento: daqui para cima o óleo escorre pelas rampas ──
  // 4ª rampa (direita): óleo em quase tudo + pistões da parede de fora
  ramp(3, 4)
  oilRamp(3, 115, 137, 0, K.rhx - 0.25, 4)
  pistons(3, K.punch4, 3.6, 2.0)
  land(3, 4)
  oilLand(3, -3.5, 145.6, 4, 1.3, 4)
  k.swing(-2.8, 141, Y[4] + 8, 6.6, 0.9, 0.95, 2.0, 0.5)
  k.swing(2.8, 144, Y[4] + 8, 6.6, 0.9, 0.95, 2.0, 2.1)
  // 5ª rampa (esquerda): prensas em fila + poças alternadas
  ramp(4, 4)
  for (const [z, ph] of K.press5) k.pusher(K.rx[4], z, 1.1, 1.0, 1.8, 2.1, 0, 1.15, ph, yAt(4, z))
  oilRamp(4, 155, 158, 1.3, 1.6, 4)
  oilRamp(4, 162, 165, -1.3, 1.6, 4)
  land(4, 4)
  oilLand(4, 3.8, 178.6, 4.2, 1.3, 4)
  k.pusher(-2.6, 174, 1.2, 1.2, 1.8, 3.6, 0, 1.15, 1.0, Y[5])
  k.pusher(2.6, 177.2, 1.2, 1.2, 1.8, 3.6, 0, 1.15, 3.0, Y[5])
  // 6ª rampa (direita): a mais estreita, óleo inteiro e os pistões em sequência
  ramp(5, 4, 2.7)
  oilRamp(5, 181, 203, 0, 2.45, 4)
  pistons(5, K.punch6, 3.2, 1.8)
  land(5, 4)
  k.swing(-2.5, 207, Y[6] + 8, 6.6, 0.9, 1.0, 2.1, 0)
  k.swing(2.5, 210, Y[6] + 8, 6.6, 0.9, 1.0, 2.1, 1.7)
  // ── 5. rampa do meio com os ganchos e a chegada no alto ──
  ramp(6, 5, 4.5)
  k.swing(-1.6, 217, yAt(6, 217) + 8, 6.6, 0.9, 0.9, 1.8, 0.4)
  k.swing(1.6, 222, yAt(6, 222) + 8, 6.6, 0.9, 0.9, 1.8, 2.0)
  k.swing(0, 227, yAt(6, 227) + 8, 6.6, 0.9, 0.95, 1.9, 1.1)
  k.box(0, 238.8, 9, 7.8, 1, 0, 6, 0, 1.6, Y[7])
  const finishZ = 239.8
  const L = (i        ) => (K.rz[i][1] + K.rz[i + 1][0]) / 2
  for (const i of [0, 1, 2, 3, 4]) k.logo(0, L(i), Y[i + 1])
  return k.done({
    id: "tanque",
    mode: "race",
    limit: 150,
    // 3 s de folga; o óleo afoga a largada aos ~11 s e passa do topo perto do fim
    rise: { y0: 0, y1: Y[7] + 2, t0: 3, t1: 112 },
    checkpoints: [{ x: 0, z: -3.5, y: DECK, w: 7 }, ...[0, 1, 2, 3, 4, 5].map((i) => ({ x: 0, z: L(i), y: Y[i + 1], w: 6 }))],
    finishZ,
    finishY: Y[7],
    sections: [15, 48, 81, 114, 213],
    minFinish: 34,
    route: (r) =>
      routeOf((add) => {
        const l0 = r(1) < 0.5 ? -1.4 : 1.4
        add(K.rx[0] * 0.5, 9)
        add(K.rx[0], 13.5)
        for (let z = 16; z <= 38; z += 2) add(K.rx[0] + l0, z)
        for (let i = 0; i < 6; i++) {
          const z0 = K.rz[i][1]
          const z1 = K.rz[i + 1][0]
          const nx = K.rx[i + 1]
          add(K.rx[i], z0 + 1.5)
          add(0, (z0 + z1) / 2)
          add(nx, z1 - 1.5)
          // nas rampas com pistões, por dentro (longe da parede de fora)
          const inner = i + 1 === 2 || i + 1 === 3 || i + 1 === 5 ? -Math.sign(nx) * 1.2 : 0
          for (let z = z1 + 1; z <= K.rz[i + 1][1] - 1; z += 2) add(nx + inner, z)
        }
        add(0, finishZ - 7)
        add(0, finishZ - 2)
        add(0, finishZ + 3)
      }),
  })
}

// ═══ portoes — Portões de Gelo (2ª fase do Mar de Gelo) ══════════════════════

/**
 * 20/11 (pedido do Alex, 2º vídeo de referência: tipo de prova "portas falsas que estreitam"): corrida no Mar de
 * Gelo. Nove fileiras de portas de gelo, cada vez mais estreitas e com menos portas de verdade (a falsa é parede;
 * a de verdade estilhaça quando alguém encosta), chão de GELO nos trechos 2 e 4 (escorrega: frear antes da
 * porta), blocos de gelo que deslizam de lado, estalactites que balançam e a subida com bolas de neve.
 * Diferente das Portas da Prefeitura: largura e número mudam por fileira (8 → 2), gelo e blocos.
 */
const PORTOES = {
  /** [z, portas, abertas, meia largura do deck] por fileira */
  rows: [
    [22, 8, 4, 12],
    [34, 7, 3, 12],
    [46, 6, 2, 12],
    [60, 6, 2, 9],
    [74, 5, 2, 9],
    [95, 4, 1, 6.5],
    [105, 4, 1, 6.5],
    [118, 3, 1, 5],
    [131, 2, 1, 5],
  ]                                      ,
  doorH: 3.4,
  /** 20/11 (dificuldade): mais escorregadio (antes 0,5) */
  ice: 0.4,
  /** blocos do lago: [z, giro, fase] (antes 2 blocos, 1,0 e 1,3) */
  blocks: [[66, 1.3, 0], [74.5, 1.5, 2.2], [82, 1.6, 1.6]]                              ,
  /** estalactites do corredor: [z, fase] (antes 2, R 1,1) */
  icicles: [[122.5, 0], [126.5, 2.4], [135, 1.2]]                      ,
  icicleR: 1.25,
  snow: { every: 0.8, v: 8, R: 1.3 },
}         

function coursePortoes()         {
  const K = PORTOES
  const k = new CourseKit()
  kitStart(k)
  // ── 1. o pátio largo: 3 fileiras ──
  k.box(0, 35, 12, 19.9, 6, 7, 1)
  // ── 2. o lago congelado (escorrega) com blocos de gelo que deslizam ──
  const ice2 = k.box(0, 72, 9, 17.1, 3, 7, 2)
  k.pads[ice2].f = K.ice
  for (const [z, w, ph] of K.blocks) k.pusher(0, z, 1.2, 1.2, 1.8, 6.4, 0, w, ph)
  // ── 3. a ponte de gelo: 2 fileiras de 4 ──
  k.box(0, 100, 6.5, 10.9, 6, 7, 3)
  // ── 4. o corredor (escorrega) com as estalactites ──
  const z0 = 138
  const ice4 = k.box(0, (110.9 + z0) / 2, 5, (z0 - 110.9) / 2, 3, 7, 4)
  k.pads[ice4].f = K.ice
  for (const [z, ph] of K.icicles) k.swing(0, z, DECK + 9, 7.4, K.icicleR, 0.95, 2.1, ph)
  for (const [z, n, open, hx] of K.rows) k.doorRow(0, z, n, (hx * 2) / n, K.doorH, open)
  // ── 5. subida com bolas de neve e a chegada ──
  const finishZ = kitFinish(k, z0, K.snow.every, K.snow.v, K.snow.R)
  for (const [x, z] of [[0, 16.5], [-6, 28], [6, 40], [0, 56.5], [0, 91], [0, 112.5]]                      ) k.logo(x, z)
  return k.done({
    id: "portoes",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 57, y: DECK, w: 6 },
      { x: 0, z: 91.5, y: DECK, w: 5 },
      { x: 0, z: 113, y: DECK, w: 4 },
      { x: 0, z: 136, y: DECK, w: 4 },
    ],
    finishZ,
    finishY: DECK + 6,
    sections: [15.1, 54.9, 89.1, 110.9, z0],
    minFinish: 20,
    // a rota segue o meio; a porta é escolha do computador (bots.ts pickDoor), na hora
    route: (r) =>
      routeOf((add) => {
        const side = r(1) < 0.5 ? -1 : 1
        add(side * 1.2, 10)
        add(side * 0.8, 15.5)
        for (let z = 18; z <= 135; z += 2.5) add(0, z)
        routeFinish(add, z0, finishZ)
      }),
  })
}

// ═══ estaleiro — Estaleiro do Quebra-Gelo (3ª fase do Mar de Gelo) ═══════════

/**
 * 20/11 (pedido do Alex, 9º vídeo de referência: tipo de prova "ilhas com barras que varrem + hélices gigantes
 * em pé"): no estaleiro preso no Mar de Gelo, as hélices dos quebra-gelos giram DE PÉ, de frente para quem corre
 * (as pás varrem o chão embaixo do cubo; passa-se pelo vão entre elas). Duas banquisas redondas com a barra de
 * proa que varre, o cais estreito com três hélices em fila, o pátio com duas fileiras de hélices lado a lado
 * (escolha o vão e a hora) e a subida para o dique seco com a hélice gigante atravessada.
 * Diferente das Hélices da Orbital (deitadas, você anda em cima) e dos Moinhos (pás rente aos discos): aqui a
 * pá gira num plano em pé e o vão passa pela frente de quem corre.
 */
const ESTALEIRO = {
  /** cais: z das hélices, nº de pás, giro */
  /** 20/11 (dificuldade): mais rápidas (antes 1,25/1,05/1,5; com 4 pás em todas ninguém passava — 336 pancadas) */
  pier: [[62, 3, 1.35], [70.5, 4, -1.15], [79, 3, 1.6]]                              ,
  /** pátio: [x, z, giro] — duas fileiras desencontradas (uma 3ª fileira travou a prova: testado em 20/11) */
  yard: [[-6.2, 95, 1.1], [0, 95, -1.25], [6.2, 95, 1.1], [-3.1, 104, -1.2], [3.1, 104, 1.2]]                              ,
  pierL: 4.2,
  yardL: 3.0,
  bigL: 6.2,
  /** giro da hélice gigante (antes 0,85) */
  bigW: 1.0,
  hubY: 0.35,
  /** barras das banquisas: aceleram até wMax (20/11) */
  barAcc: 0.01,
  barMax: 1.7,
}         

function courseEstaleiro()         {
  const K = ESTALEIRO
  const k = new CourseKit()
  kitStart(k)
  // hélice em pé: o cubo fica a L − folga acima do chão (a ponta raspa o piso)
  const rot = (x        , z        , floor        , L        , n        , w        , ph        ) =>
    k.rotor(x, z, floor + L - K.hubY, L, n, 0.42, 0.35, w, ph)
  // ── 1. as banquisas com a barra de proa ──
  k.box(0, 17.5, 2.2, 2.4, 5, 1, 1, 0, 1.2)
  k.disc(0, 28, 8, 5, 1, 1)
  k.post(0, 28, 0.8, DECK, DECK + 2.4, 5)
  k.sweep(0, 28, DECK + 0.55, 8.3, 0.34, 1.05, 0, true, K.barAcc, K.barMax)
  k.box(0, 38.5, 2.2, 2.6, 5, 1, 1, 0, 1.2)
  k.disc(0, 49, 8, 5, 1, 1)
  k.post(0, 49, 0.8, DECK, DECK + 2.4, 5)
  k.sweep(0, 49, DECK + 0.55, 8.3, 0.34, -1.3, 1.4, false, K.barAcc, K.barMax)
  // ── 2. o cais com três hélices em fila ──
  k.box(0, 70.5, 3.3, 13.5, 5, 1, 2)
  K.pier.forEach(([z, n, w], i) => rot(0, z, DECK, K.pierL, n, w, i * 0.7))
  // ── 3. o pátio com duas fileiras lado a lado ──
  k.box(0, 99.5, 9.6, 15.5, 5, 1, 3)
  K.yard.forEach(([x, z, w], i) => rot(x, z, DECK, K.yardL, 3, w, i * 1.1))
  // ── 4. a subida para o dique seco com a hélice gigante atravessada ──
  const z0 = 115
  const z1 = 143
  const Yt = DECK + 6
  k.slope(0, z0, z1, DECK, Yt, 6.6, 5, 1, 4)
  const zb = 131
  rot(0, zb, DECK + ((zb - z0) / (z1 - z0)) * (Yt - DECK), K.bigL, 4, K.bigW, 0.3)
  k.box(0, z1 + 7.8, 9, 7.8, 1, 0, 6, 0, 1.6, Yt)
  const finishZ = z1 + 8.8
  for (const [x, z] of [[0, 17.5], [0, 38.5], [-2, 58.5], [2, 58.5], [0, 86], [0, 111]]                      ) k.logo(x, z)
  return k.done({
    id: "estaleiro",
    checkpoints: [
      { x: 0, z: -3.5, y: DECK, w: 7 },
      { x: 0, z: 38.5, y: DECK, w: 2 },
      { x: 0, z: 59, y: DECK, w: 3 },
      { x: 0, z: 87, y: DECK, w: 6 },
      { x: 0, z: 111, y: DECK, w: 6 },
    ],
    finishZ,
    finishY: Yt,
    sections: [15.1, 57, 84, z0, z0 + 14],
    minFinish: 20,
    route: (r) =>
      routeOf((add) => {
        for (let z = 10; z <= 58; z += 2) add(0, z)
        // no cais: um pouco para um lado (o vão chega antes perto da ponta da pá)
        const s = r(1) < 0.5 ? -1.4 : 1.4
        for (let z = 60; z <= 82; z += 2) add(s, z)
        add(0, 86)
        // pátio: o vão entre as hélices da 1ª fileira (x ±3,1) e depois o da 2ª (0 ou ±6,2)
        const g1 = r(2) < 0.5 ? -3.1 : 3.1
        add(g1, 91)
        add(g1, 97)
        const g2 = r(3) < 0.4 ? 0 : g1 < 0 ? -6.2 : 6.2
        add(g2, 101)
        add(g2, 107)
        add(0, 112)
        for (let z = z0 + 1; z <= z1 - 1; z += 2.5) add(r(4) < 0.5 ? -2.5 : 2.5, z)
        add(0, finishZ - 7)
        add(0, finishZ - 2)
        add(0, finishZ + 3)
      }),
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
  // 20/11 (dificuldade): anéis 20% mais rápidos e buracos um pouco maiores (antes 0,3/−0,34/…, meia 0,17/0,2)
  const W = [0.36, -0.41, 0.46, -0.38, 0.43, -0.35]
  k.drum(
    0,
    0,
    ROLL_TOP - ROLL_R,
    ROLL_R,
    W.map((w, i) => ({
      len: 5,
      w,
      // os buracos começam embaixo (o primeiro chega ao topo depois de ~8 s); dois anéis têm 3
      holes: (i % 3 === 1 ? [0, 2.1, 4.2] : [0, 3.1]).map((o) => ({ a: Math.PI + o + i * 0.7, half: 0.19 + (i % 2) * 0.03 })),
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
/**
 * Feira do Centro — números da dificuldade (20/11, o Alex: "obstáculos mais resistentes e mais rápidos").
 * Antes: melancias a cada 1,15 s a 6,5 m/s (R 1,15), 3 prensas (1,5/1,9/1,3), martelos R 1,1 amp 0,95,
 * corredor de esteiras de lado sem nada.
 */
const FEIRA = {
  melons: { every: 0.9, v: 7.5, R: 1.3 },
  /** prensas da esteira de ida: [z, giro] */
  press: [[52, 1.8], [58.5, 2.3], [65, 1.6], [71.5, 2.1]]                      ,
  ham: { R: 1.25, amp: 1.05 },
  /** martelos do meio: [z, fase] */
  hamMid: [[99, 4.8]]                      ,
  /** socos no patamar depois do corredor de esteiras (na esteira, quem espera o soco cai): [x da base, z, fase] */
  punches: [[9.2, 145, 0], [-9.2, 148.5, 1.4]]                              ,
  punchReach: 7.4,
  punchPeriod: 2.8,
}         

function courseFeira()         {
  const k = new CourseKit()
  kitStart(k)
  const Y = DECK + 3
  // ── 1. rampa-esteira com melancias ──
  const r1 = k.slope(0, 15.1, 40, DECK, Y, 6, 0, 1, 1)
  k.pads[r1].bz = -GINCANA.belt * 0.75 // rampa + melancias + esteira: a esteira cheia trava todo mundo
  k.balls = { lanes: [-4.3, -1.45, 1.45, 4.3], every: FEIRA.melons.every, v: FEIRA.melons.v, R: FEIRA.melons.R, zEnd: 12 }
  k.box(0, 44, 7, 4, 6, 7, 1, 0, 1.4, Y)
  // ── 2. esteiras de mão dupla com prensas ──
  const fwd = k.box(-3, 63, 3, 15, 2, 0, 2, 0, 1.4, Y)
  k.pads[fwd].bz = GINCANA.belt
  const back = k.box(3, 63, 3, 15, 3, 0, 2, 0, 1.4, Y)
  k.pads[back].bz = -GINCANA.belt
  FEIRA.press.forEach(([z, w], i) => k.pusher(-3, z, 1.6, 0.9, 2.2, 3, 0, w, i * 1.3, Y))
  k.box(0, 82, 7, 4, 6, 7, 2, 0, 1.4, Y)
  // ── 3. martelos ──
  k.box(0, 99, 6, 13, 6, 7, 3, 0, 1.4, Y)
  const ham = (x        , z        , ph        ) => k.swing(x, z, Y + 9, 7.4, FEIRA.ham.R, FEIRA.ham.amp, 2.2, ph)
  ham(-3, 92, 0)
  ham(3, 92, 2.4)
  ham(-3, 99, 1.2)
  ham(3, 99, 3.6)
  ham(-3, 106, 4.4)
  ham(3, 106, 0.6)
  // 20/11: um martelo no meio da fileira do meio (em todas, ninguém passava: 129 pancadas)
  for (const [z, ph] of FEIRA.hamMid) ham(0, z, ph)
  k.box(0, 115, 7, 3, 6, 7, 3, 0, 1.4, Y)
  // ── 4. corredor de esteiras de lado ──
  for (let i = 0; i < 6; i++) {
    const p = k.box(0, 120 + i * 4, 6, 2, i % 2 ? 4 : 5, 0, 4, 0, 1.4, Y)
    k.pads[p].bx = (i % 2 ? -1 : 1) * GINCANA.belt
  }
  k.box(0, 146, 7, 4, 6, 7, 4, 0, 1.4, Y)
  // 20/11: socos de lado no patamar depois do corredor
  for (const [x0, z, ph] of FEIRA.punches) {
    k.post(x0, z, 0.45, -1, Y + 1.9, 2)
    k.glove(x0, z, Y + 1, -Math.sign(x0), FEIRA.punchReach, 1.0, FEIRA.punchPeriod, ph)
  }
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
/**
 * Torre da Coroa — números da dificuldade (20/11, o Alex: "obstáculos mais resistentes e mais rápidos").
 * Antes: martelos R 1,1 amp 0,95; portões a 1,25 e −1,45 rad/s sem aceleração; ponte estreita sem nada.
 */
const COROA = {
  ham: { R: 1.25, amp: 1.05 },
  gateAcc: 0.01,
  gateMax: 1.9,
  /** barra alta (mergulhar) no 2º portão, ao contrário, um braço */
  highY: 1.45,
  highW: 0.6,
  /** soco da ponte estreita: [x da base, z, fase] */
  punch: [5.6, 104, 0.6]                            ,
}         

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
  const ham = (x        , z        , ph        ) => k.swing(x, z, Y1 + 9, 7.4, COROA.ham.R, COROA.ham.amp, 2.2, ph)
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
    k.sweep(0, z, Y1 + 0.55, 7.3, 0.32, w, a0, true, COROA.gateAcc, COROA.gateMax)
  }
  gate(96, 1.25, 0)
  k.box(0, 104, 2.4, 1.2, 6, 7, 3, 0, 1.4, Y1)
  {
    const [x0, z, ph] = COROA.punch
    k.post(x0, z, 0.45, -1, Y1 + 1.9, 2)
    k.glove(x0, z, Y1 + 1, -Math.sign(x0), 6.2, 1.0, 2.2, ph)
  }
  gate(112, -1.45, 0.8)
  k.sweep(0, 112, Y1 + COROA.highY, 7.3, 0.3, COROA.highW, 0.8 + Math.PI / 2, false)
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

/** As fases como foram desenhadas (uma volta só): os testes de estrutura leem daqui. */
const COURSE_BASE                               = {
  cidade: courseCidade(),
  floresta: courseFloresta(),
  clareira: courseClareira(),
  serraria: courseSerraria(),
  tanque: courseTanque(),
  canion: courseCanion(),
  moinhos: courseMoinhos(),
  gangorras: courseGangorras(),
  orbital: courseOrbital(),
  helices: courseHelices(),
  forja: courseForja(),
  altoforno: courseAltoForno(),
  crosta: courseCrosta(),
  aros: courseAros(),
  fabrica: courseFabrica(),
  comportas: courseComportas(),
  gelo: courseGelo(),
  portoes: coursePortoes(),
  estaleiro: courseEstaleiro(),
  relogio: courseRelogio(),
  feira: courseFeira(),
  coroa: courseCoroa(),
}

/** Quanto media cada corrida antes de dobrar (o Tanque já tinha sido alongado à mão). */
const BASE_LEN                                        = { tanque: 140.8 }

// 20/11 (pedido do Alex): toda corrida com no mínimo o DOBRO do percurso antigo — o miolo se repete (reprise)
const COURSES                               = {
  cidade: reprise(COURSE_BASE.cidade),
  floresta: reprise(COURSE_BASE.floresta),
  clareira: reprise(COURSE_BASE.clareira),
  serraria: reprise(COURSE_BASE.serraria, { f: 1 }), // toras mais rápidas na 2ª volta prendem todo mundo
  tanque: reprise(COURSE_BASE.tanque, { z0: 114, z1: 213, base: BASE_LEN.tanque }),
  canion: reprise(COURSE_BASE.canion),
  moinhos: reprise(COURSE_BASE.moinhos),
  gangorras: reprise(COURSE_BASE.gangorras),
  orbital: reprise(COURSE_BASE.orbital),
  helices: reprise(COURSE_BASE.helices, { f: 1 }), // hélices mais rápidas na 2ª volta jogam todo mundo no vazio
  forja: reprise(COURSE_BASE.forja),
  altoforno: reprise(COURSE_BASE.altoforno),
  crosta: reprise(COURSE_BASE.crosta),
  aros: reprise(COURSE_BASE.aros),
  fabrica: reprise(COURSE_BASE.fabrica),
  comportas: reprise(COURSE_BASE.comportas),
  gelo: reprise(COURSE_BASE.gelo),
  portoes: reprise(COURSE_BASE.portoes),
  estaleiro: reprise(COURSE_BASE.estaleiro),
  relogio: reprise(COURSE_BASE.relogio),
  feira: reprise(COURSE_BASE.feira),
  coroa: reprise(COURSE_BASE.coroa),
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
  return { t, seed, course, tiles: new Float64Array(course.tiles.length).fill(-1), balls: [], open: doorsOpen(course, seed), real: pathReal(course, seed), doors: new Float64Array(course.doors.length).fill(-1), gems: new Float64Array(course.gems.length).fill(-1), saw: sawRest(course) }
}

const sawArms = new Float64Array(64)
/** Gangorras: soma o braço de quem está em pé em cada uma e anda o ângulo um passo. */
function stepSaws(w          , bodies          , live                        , dt        ) {
  const C = w.course
  if (!C.saws.length) return
  const arms = sawArms.length >= C.saws.length ? sawArms.fill(0, 0, C.saws.length) : new Float64Array(C.saws.length)
  for (let j = 0; j < bodies.length; j++) {
    const b = bodies[j]
    if (!live(j) || b.mode === MODE.WATER || b.fin >= 0) continue
    for (let i = 0; i < C.saws.length; i++) {
      const S = C.saws[i]
      if (Math.abs(b.x - S.x) > S.hx + 0.1 || Math.abs(b.z - S.z) > S.hz + 0.1) continue
      if (Math.abs(b.y - sawTop(S, w.saw[i * 2], b.x, b.z)) > 0.35) continue
      arms[i] += sawArm(S, b.x, b.z)
      break
    }
  }
  stepSawState(C, w.saw, arms, dt)
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
    roll: -1,
    fric: 1,
    bbx: 0,
    bbz: 0,
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
      top = padTop(p, z, w.t)
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
  // Serraria: toras e tábuas (também só quando são o chão mais alto)
  let roll = -1
  for (let i = 0; i < C.logs.length; i++) {
    const g = logAt(C.logs[i], x, z)
    if (g && g.top <= reach && g.top > best) {
      best = g.top
      tile = pad = drum = -1
      bounce = 0
      roll = i
    }
  }
  for (let i = 0; i < C.planks.length; i++) {
    const P = C.planks[i]
    if (Math.abs(x - P.x) > P.hx + EDGE || Math.abs(z - P.z) > P.hz + EDGE) continue
    const top = plankTop(P, Math.max(P.x - P.hx, Math.min(P.x + P.hx, x)), w.t)
    if (top <= reach && top > best) {
      best = top
      tile = pad = drum = -1
      bounce = 0
      roll = ROLL_PLANK + i
    }
  }
  for (let i = 0; i < C.saws.length; i++) {
    const S = C.saws[i]
    if (Math.abs(x - S.x) > S.hx + EDGE || Math.abs(z - S.z) > S.hz + EDGE) continue
    const top = sawTop(S, w.saw[i * 2], x, z)
    if (top <= reach && top > best) {
      best = top
      tile = pad = drum = -1
      bounce = 0
      roll = ROLL_SAW + i
    }
  }
  return { y: best, tile, pad, bounce, drum, roll }
}

/** No campo `roll`: índice da tora; a partir daqui, tábua; a partir de ROLL_SAW, gangorra. */
const ROLL_PLANK = 1000
const ROLL_SAW = 2000

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
    const top = padTop(p, b.z, w.t)
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
  // moenda (cilindro com lado): abaixo de 60% da altura é parede — empurra de lado; dá para subir pulando
  for (const d of C.drums) {
    if (!d.wall) continue
    let len = 0
    for (const r of d.rings) len += r.len
    if (b.z < d.z0 - R || b.z > d.z0 + len + R || b.y >= d.y + d.R * 0.6 || b.y + H <= d.y - d.R) continue
    const half = d.R * DRUM_EDGE + R
    const dx = b.x - d.x
    if (Math.abs(dx) >= half) continue
    // pelas pontas (entrando de frente) empurra para trás/para a frente; senão de lado
    const oz = Math.min(b.z - (d.z0 - R), d.z0 + len + R - b.z)
    const ox = half - Math.abs(dx)
    if (oz < ox) b.z = b.z - (d.z0 - R) < d.z0 + len + R - b.z ? d.z0 - R : d.z0 + len + R
    else b.x = d.x + Math.sign(dx || 1) * half
    sawLedge(d.y + d.R, Math.sign(dx || 1), 0)
  }
  // tora: a metade de baixo (60%) é parede — empurra para a frente/para trás (pelas pontas, de lado)
  for (const L of C.logs) {
    if (b.y >= L.y + L.R * 0.6 || b.y + H <= L.y - L.R) continue
    const halfZ = L.R * LOG_EDGE + R
    const dz = b.z - L.z
    const ox = L.hx + R - Math.abs(b.x - L.x)
    const oz = halfZ - Math.abs(dz)
    if (ox <= 0 || oz <= 0) continue
    if (ox < oz) b.x = L.x + Math.sign(b.x - L.x || 1) * (L.hx + R)
    else b.z = L.z + Math.sign(dz || -1) * halfZ
    sawLedge(L.y + L.R, 0, Math.sign(dz || -1))
  }
  // tábua: a beira que ficou acima do pé é parede (dá para subir na beira)
  for (const P of C.planks) {
    const top = plankTop(P, Math.max(P.x - P.hx, Math.min(P.x + P.hx, b.x)), w.t)
    if (top <= lift || top - 0.5 >= b.y + H) continue
    const lx = b.x - P.x
    const lz = b.z - P.z
    const ox = P.hx + R - Math.abs(lx)
    const oz = P.hz + R - Math.abs(lz)
    if (ox <= 0 || oz <= 0) continue
    if (ox < oz) {
      b.x = P.x + Math.sign(lx || 1) * (P.hx + R)
      sawLedge(top, Math.sign(lx || 1), 0)
    } else {
      b.z = P.z + Math.sign(lz || 1) * (P.hz + R)
      sawLedge(top, 0, Math.sign(lz || 1))
    }
  }
  // gangorra: a ponta que subiu acima do pé é parede (dá para subir na beira)
  for (let i = 0; i < C.saws.length; i++) {
    const S = C.saws[i]
    const top = sawTop(S, w.saw[i * 2], b.x, b.z)
    if (top <= lift || top - 0.5 >= b.y + H) continue
    const lx = b.x - S.x
    const lz = b.z - S.z
    const ox = S.hx + R - Math.abs(lx)
    const oz = S.hz + R - Math.abs(lz)
    if (ox <= 0 || oz <= 0) continue
    if (ox < oz) {
      b.x = S.x + Math.sign(lx || 1) * (S.hx + R)
      sawLedge(top, Math.sign(lx || 1), 0)
    } else {
      b.z = S.z + Math.sign(lz || 1) * (S.hz + R)
      sawLedge(top, 0, Math.sign(lz || 1))
    }
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
  b.vx = kx * GINCANA.hitPush + b.vx * 0.15
  b.vz = kz * GINCANA.hitPush + b.vz * 0.15
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
  // cravos das toras: a fileira que passa por cima derruba para trás (para onde o topo anda)
  for (const L of C.logs) {
    if (Math.abs(b.z - L.z) > L.R + SPIKE_OUT + 1 || Math.abs(b.x - L.x) > L.hx + 1) continue
    if (b.y > L.y + L.R + SPIKE_OUT + 0.6) continue
    const rr = L.R + SPIKE_OUT * 0.7
    for (let k = 0; k < L.rows; k++) {
      const a = logRowAngle(L, k, t)
      const cy = Math.cos(a)
      if (cy < -0.1) continue
      const sy = L.y + cy * rr
      const sz = L.z + Math.sin(a) * rr
      if (Math.abs(b.z - sz) > SPIKE_R + R + 0.1) continue
      const n = logSpikeCount(L, k)
      for (let j = 0; j < n; j++) {
        if (sphereGap(b, logSpikeX(L, k, j), sy, sz) >= SPIKE_R + R) continue
        knock(b, Math.sign(b.x - logSpikeX(L, k, j) || 1) * 1.5, 5.5, -Math.sign(L.w || 1) * 7.5, "bar", out)
        break
      }
    }
  }
  // hélice em pé: a pá que passa pelo corpo joga para o lado do giro e para trás
  for (const q of C.rotors) {
    if (Math.abs(b.z - q.z) > q.hz + R) continue
    for (const hy of [0.45, 0.9, 1.35]) {
      const y = b.y + hy
      if (rotorBladeAt(q, b.x, y, t, R) < 0) continue
      const vx = -q.w * (y - q.y)
      const vy = q.w * (b.x - q.x)
      knock(b, Math.sign(vx || 1) * Math.min(9, 4 + Math.abs(vx)), 4.5 + Math.max(0, Math.min(3, vy)), -6.5, "bar", out)
      break
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
  b.bbx = 0
  b.bbz = 0
  b.drum = -1
  b.roll = -1
  b.fric = 1
  b.grab = -1
}

/** Leva quem está em cima da plataforma que anda, do disco que gira e da esteira. */
function carry(b        , w          , dt        ) {
  if (b.ground) {
    b.bbx = 0
    b.bbz = 0
  }
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
  if (b.ground && b.roll >= ROLL_SAW) {
    // gangorra inclinada: escorrega para o lado que desce (de lado escorrega mais)
    const S = w.course.saws[b.roll - ROLL_SAW]
    if (S) {
      const s = Math.sin(w.saw[(b.roll - ROLL_SAW) * 2])
      if (S.ax === 0) b.z += s * 4 * dt
      else b.x += s * (S.slip ?? 6) * dt
    }
    return
  }
  if (b.ground && b.roll >= 0) {
    if (b.roll >= ROLL_PLANK) {
      // tábua inclinada: escorrega para o lado que desce
      const P = w.course.planks[b.roll - ROLL_PLANK]
      if (P) b.x -= Math.sin(plankAngle(P, w.t)) * 8 * dt
    } else {
      // tora: o chão anda para −z (w·altura acima do eixo) e a curva escorrega para fora
      const L = w.course.logs[b.roll]
      const g = L ? logAt(L, b.x, b.z) : null
      if (L && g) {
        b.z -= L.w * (g.top - L.y) * dt
        b.z += Math.sin(g.th) * 3.2 * dt
      }
    }
    return
  }
  if (!b.ground) {
    // no ar: o embalo da esteira de onde saiu
    b.x += b.bbx * dt
    b.z += b.bbz * dt
    return
  }
  if (b.pad < 0) return
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
    b.bbx = p.bx
    b.bbz = p.bz
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
      b.roll = g.roll
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
    // graxa (Comportas da Usina): no chão dela a corrida fica mais lenta
    if (b.ground && b.pad >= 0) run *= C.pads[b.pad].sl
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
    b.roll = g.roll
    b.fric = g.pad >= 0 ? C.pads[g.pad].f : g.drum >= 0 ? C.drums[g.drum].f : g.roll >= 0 && g.roll < ROLL_PLANK ? 0.8 : 1
    if (!b.ground) {
      b.ground = true
      // pousou: mergulho vira deslize; derrubado fica no chão o resto do tempo
      if (b.mode === MODE.DIVE) {
        b.mode = MODE.SLIDE
        b.timer = T.slideT
      } else if (b.mode === MODE.KNOCK) b.timer = Math.max(b.timer, 0.35)
    }
    b.air = 0
    if (g.tile >= 0) {
      const before = w.tiles[g.tile]
      stepTile(C, w.tiles, w.real, g.tile, w.t)
      if (w.tiles[g.tile] !== before) out?.push({ type: "tile", i: g.tile })
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
    b.roll = g.roll
  } else {
    if (b.ground) b.vy = Math.min(b.vy, 0)
    b.ground = false
    b.air += dt
    b.pad = -1
    b.drum = -1
    b.roll = -1
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
  // Descida dos Aros: passou pelo meio do aro = turbo e um empurrão para a frente
  for (let i = 0; i < C.hoops.length; i++) {
    if (!hoopPass(C.hoops[i], w.t, b.pz, b.x, b.y, b.z)) continue
    b.boost = T.boostT
    b.vz = Math.max(b.vz, T.run * 1.45)
    out?.push({ type: "hoop", slot: b.slot, i })
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
  return { route, skill, pace: 0.86 + r(7) * 0.14, seed, slot, laneX: 0, jumpCool: 0, stuck: 0, back: 0, lastZ: -99, waited: 0, fanA: 0, fanT: -1, divesFinish: r(8) < skill - 0.35, door: -1, bad: new Set(), tile: -1, path: -1 }
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
  let vx = b.vx + (it.mx * GINCANA.run - b.vx) * 0.5
  let vz = b.vz + (it.mz * GINCANA.run - b.vz) * 0.5
  // 20/11: em cima de disco que gira, o chão também leva (mesma conta de carry em body.ts)
  const own = b.pad >= 0 ? C.pads[b.pad] : null
  if (own && own.spin !== 0) {
    vx += own.spin * (b.z - own.z)
    vz -= own.spin * (b.x - own.x)
  }
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
/**
 * Hélice (Hélices da Orbital): pás retas (caixas que giram no mesmo centro) + o disco do cubo. Em cima de
 * uma pá, correr "para a frente do mundo" tira o robô da pá que gira: ele vai pelo eixo da pá — para fora se
 * ela aponta para a saída, para o cubo se não — e no cubo espera uma pá chegar na direção da saída.
 */
function fanRide(br          , b        , w          , it           ) {
  if (!b.ground || b.pad < 0) return
  const C = w.course
  const p0 = C.pads[b.pad]
  if (!isFanPad(C, p0) || p0.mw !== 0) return
  const cx = p0.x
  const cz = p0.z
  let L = 0
  const arms           = []
  let hubR = 0
  for (const p of C.pads) {
    if (p.spin === 0 || p.x !== cx || p.z !== cz) continue
    if (p.k === 1) {
      L = Math.max(L, p.hz)
      const a = padRot(p, w.t)
      arms.push(a, a + Math.PI)
    } else hubR = p.r
  }
  if (!arms.length) return
  // o alvo: o primeiro ponto da rota além da hélice
  let tx = 0
  let tz = 0
  let found = false
  for (const q of br.route) {
    if (q.z > b.z && Math.hypot(q.x - cx, q.z - cz) > L + 0.6) {
      tx = q.x
      tz = q.z
      found = true
      break
    }
  }
  if (!found) return
  const want = Math.atan2(tx - cx, tz - cz)
  const diff = (a        ) => {
    let d = (a - want) % (Math.PI * 2)
    if (d > Math.PI) d -= Math.PI * 2
    if (d < -Math.PI) d += Math.PI * 2
    return d
  }
  const spin = p0.spin
  const rb = Math.hypot(b.x - cx, b.z - cz)
  const go = Math.max(0.6, br.pace)
  // a pá que vai estar na direção da saída quando eu chegar na ponta (o giro anda enquanto eu corro)
  const lead = (L - Math.min(rb, L)) / (GINCANA.run * go)
  let best = Infinity
  let bestA = 0
  for (const a of arms) {
    const d = Math.abs(diff(a + spin * lead))
    if (d < best) {
      best = d
      bestA = a
    }
  }
  if (rb < hubR - 0.4) {
    // já escolhi a pá: sigo com ela (ela gira) até sair do cubo
    if (br.fanT >= 0 && w.t - br.fanT > 1.5) br.fanT = -1
    if (br.fanT < 0 && best < 0.16 && rb < 1.9) {
      br.fanA = bestA
      br.fanT = w.t
    }
    if (br.fanT >= 0) {
      // sai mirando um ponto SOBRE a pá (não paralelo a ela)
      const a = br.fanA + spin * (w.t - br.fanT)
      const px = cx + Math.sin(a) * L * 0.7 - b.x
      const pz = cz + Math.cos(a) * L * 0.7 - b.z
      const m = Math.hypot(px, pz) || 1
      it.mx = (px / m) * go
      it.mz = (pz / m) * go
    } else if (rb > 1.0) {
      // vai para o miolo e espera lá (longe da beira)
      it.mx = ((cx - b.x) / rb) * 0.5
      it.mz = ((cz - b.z) / rb) * 0.5
    } else {
      it.mx = 0
      it.mz = 0
    }
    return
  }
  br.fanT = -1
  // na pá: o eixo da pá onde estou (a direção do centro até mim)
  const out = Math.atan2(b.x - cx, b.z - cz)
  if (Math.abs(diff(out)) < 1.0) {
    it.mx = Math.sin(out) * go
    it.mz = Math.cos(out) * go
  } else {
    it.mx = -Math.sin(out) * go
    it.mz = -Math.cos(out) * go
  }
}

/** Pulo de/para hélice: o pouso de verdade (o pulo voa ~5 m) existe na hora em que eu chego lá? */
function fanLand(w          , b        , fx        , fz        ) {
  for (const [k, dt] of [[4.4, 0.58], [5.2, 0.7]]) {
    const g = groundUnder({ ...w, t: w.t + dt }, b.x + fx * k, b.z + fz * k, b.y + 1.2)
    if (g.y < b.y - 1.2) return false
  }
  return true
}

/** Peça de hélice: caixa que gira, ou o disco do cubo de uma (mesmo centro). Os discos da Clareira não são. */
function isFanPad(C        , p                        ) {
  if (p.spin === 0) return false
  return C.pads.some((q) => q.k === 1 && q.spin !== 0 && q.x === p.x && q.z === p.z)
}

/** Hélice (caixa que gira) por perto: o salto precisa de hora certa. */
function nearFan(C        , x        , z        ) {
  for (const p of C.pads) if (p.k === 1 && p.spin !== 0 && Math.hypot(p.x - x, p.z - z) < p.hz + 4) return true
  return false
}

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

/**
 * Crosta da Forja: no tabuleiro do caminho escondido. O computador procura o MENOR caminho até a saída do
 * tabuleiro pelo que se sabe: placa acesa custa 1, desconhecida custa mais (é chute; um pouco diferente para
 * cada um, pela semente), buraco não passa; anda só reto, de lado ou para trás (o caminho nunca faz diagonal).
 * Beco sem saída aparece sozinho. Mira a próxima placa desse caminho e se alinha na coluna antes de avançar;
 * no ar segue a placa escolhida. Devolve o alvo ou null (fora do tabuleiro).
 */
function pathAim(br          , b        , w          )                                  {
  const C = w.course
  if (!C.tiles.length || C.tiles[0].pg < 0) return null
  const state = (i        ) => (w.tiles[i] === -2 ? 2 : w.tiles[i] === -1 ? 1 : 0)
  if (!b.ground) {
    if (br.path >= 0 && state(br.path) > 0) return { x: C.tiles[br.path].x, z: C.tiles[br.path].z }
    return null
  }
  let under = -1
  for (let i = 0; i < C.tiles.length; i++) {
    const q = C.tiles[i]
    if (onTile(q, b.x, b.z, 0.02) && Math.abs(q.y - b.y) < 0.4) under = i
  }
  let g = under >= 0 ? C.tiles[under].pg : -1
  if (g < 0) {
    for (const q of C.tiles) if (q.pr === 0 && q.z - q.h - b.z > -0.2 && q.z - q.h - b.z < 4) g = q.pg
    if (g < 0) return null
  }
  // o tabuleiro g: índice por (fileira, coluna)
  const idx           = []
  let rows = 0
  let cols = 0
  for (let i = 0; i < C.tiles.length; i++) {
    const q = C.tiles[i]
    if (q.pg !== g) continue
    idx.push(i)
    rows = Math.max(rows, q.pr + 1)
    cols = Math.max(cols, q.pc + 1)
  }
  const at = (r        , c        ) => (r < 0 || r >= rows || c < 0 || c >= cols ? -1 : idx[r * cols + c])
  const enter = (i        ) => (state(i) === 2 ? 1 : 2.2 + botRand(br.seed, br.slot * 31 + i, Math.floor(w.t / 8)) * 1.6)
  // Dijkstra de trás para a frente: custo até sair do tabuleiro (da última fileira, sair custa 0)
  const n = rows * cols
  const cost = new Float64Array(n).fill(Infinity)
  const done = new Uint8Array(n)
  for (let c = 0; c < cols; c++) if (state(at(rows - 1, c)) > 0) cost[(rows - 1) * cols + c] = 0
  for (;;) {
    let k = -1
    for (let j = 0; j < n; j++) if (!done[j] && cost[j] < Infinity && (k < 0 || cost[j] < cost[k])) k = j
    if (k < 0) break
    done[k] = 1
    const r = Math.floor(k / cols)
    const c = k % cols
    // quem vem de (r2, c2) para k paga a entrada em k
    for (const [dr, dc, extra] of [[-1, 0, 0], [0, -1, 0.15], [0, 1, 0.15], [1, 0, 1]]                              ) {
      const r2 = r + dr
      const c2 = c + dc
      const j = at(r2, c2)
      if (j < 0 || state(j) === 0) continue
      const v = cost[k] + enter(idx[k]) + extra
      if (v < cost[r2 * cols + c2]) cost[r2 * cols + c2] = v
    }
  }
  let next = -1
  if (under < 0) {
    // antes do tabuleiro: a placa da 1ª fileira de menor custo (mais o caminho de lado até ela)
    let best = Infinity
    for (let c = 0; c < cols; c++) {
      const i = at(0, c)
      if (state(i) === 0) continue
      const v = cost[c] + enter(i) + Math.abs(C.tiles[i].x - b.x) * 0.12
      if (v < best) {
        best = v
        next = i
      }
    }
    br.path = next
    if (next < 0) return null
    const q = C.tiles[next]
    if (Math.abs(q.x - b.x) > 0.45) return { x: q.x, z: Math.min(b.z + 0.4, q.z - q.h - 0.9) }
    return { x: q.x, z: q.z }
  }
  const u = C.tiles[under]
  if (u.pr === rows - 1) {
    br.path = -1
    return { x: u.x, z: u.z + 4 }
  }
  let best = Infinity
  for (const [dr, dc, extra] of [[1, 0, 0], [0, -1, 0.15], [0, 1, 0.15], [-1, 0, 1]]                              ) {
    const j = at(u.pr + dr, u.pc + dc)
    if (j < 0 || state(j) === 0) continue
    const v = cost[(u.pr + dr) * cols + u.pc + dc] + enter(j) + extra
    if (v < best) {
      best = v
      next = j
    }
  }
  br.path = next
  if (next < 0) return { x: u.x, z: u.z }
  const q = C.tiles[next]
  if (q.pr === u.pr) return { x: q.x, z: u.z }
  if (q.pr < u.pr) return { x: q.x, z: q.z - 0.3 }
  return Math.abs(q.x - b.x) > 0.4 ? { x: q.x, z: b.z } : { x: q.x, z: q.z + 0.3 }
}

/**
 * Descida dos Aros: o aro (ou a janela) logo à frente e alinhado — pula para chegar ao plano dele perto do alto
 * do pulo (0,32 s depois de sair do chão). O erro de tempo vem da habilidade. Aro alto demais (o do cogumelo)
 * não se pula do chão.
 */
function hoopJump(br          , b        , w          , it           ) {
  const C = w.course
  if (!C.hoops.length || !b.ground || br.jumpCool > 0) return
  const v = Math.max(4, b.vz)
  for (let i = 0; i < C.hoops.length; i++) {
    const h = C.hoops[i]
    const dz = h.z - b.z
    if (dz <= 0 || dz > 5) continue
    if (h.y - b.y > 3.3) continue
    const tArr = dz / v
    if (Math.abs(hoopX(h, w.t + tArr) - b.x) > h.R * 0.75) continue
    const err = (botRand(br.seed, br.slot * 11 + i, Math.floor(w.t)) - 0.5) * (1 - br.skill) * 0.35
    if (tArr < 0.33 + err) {
      it.jump = true
      br.jumpCool = 0.5
      return
    }
  }
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
/** Ver o uso em botIntent: devolve true quando cuidou da intenção (andar/esperar/pular). */
function spinRide(br          , b        , w          , it           ) {
  const C = w.course
  if (!b.ground || b.pad < 0) return false
  const p = C.pads[b.pad]
  if (p.k !== 0 || p.spin === 0 || p.mw !== 0 || Math.abs(p.spin) * p.r <= 4) return false
  // o primeiro ponto da rota adiante e FORA desta peça: para onde pular
  let e = null                                    
  for (const q of br.route) {
    if (q.z > p.z && Math.hypot(q.x - p.x, q.z - p.z) > p.r + 0.3) {
      e = q
      break
    }
  }
  if (!e) return false
  const ox = b.x - p.x
  const oz = b.z - p.z
  const rho = Math.hypot(ox, oz)
  const aim = Math.atan2(e.z - p.z, e.x - p.x)
  br.stuck = 0
  br.lastZ = b.z
  if (rho < p.r - 1.4) {
    // anda para fora pela reta do centro (se está no miolo, já na direção do pulo)
    const ux = rho > 0.3 ? ox / rho : Math.cos(aim)
    const uz = rho > 0.3 ? oz / rho : Math.sin(aim)
    it.mx = ux * br.pace
    it.mz = uz * br.pace
    return true
  }
  // na beirada: espera o giro trazer para o lado da próxima peça (os menos hábeis erram a hora)
  const diff = Math.atan2(Math.sin(Math.atan2(oz, ox) - aim), Math.cos(Math.atan2(oz, ox) - aim))
  const lead = 0.1 * Math.sign(p.spin)
  const win = 0.18 + (1 - br.skill) * 0.12
  if (Math.abs(diff - lead) < win && br.jumpCool <= 0) {
    const jx = e.x - b.x
    const jz = e.z - b.z
    const jm = Math.hypot(jx, jz) || 1
    it.mx = jx / jm
    it.mz = jz / jm
    it.jump = true
    br.jumpCool = 0.6
  }
  return true
}

/**
 * Comportas (Comportas da Usina): na fileira à frente, escolhe a comporta que vai estar EMBAIXO enquanto
 * eu cruzo (prevê pelo relógio dela); nenhuma: vai para a melhor e espera na frente dela. Já dentro da
 * fileira (entre as paredes) segue a dela. Erro pela habilidade. null = nenhuma fileira perto.
 */
function gateAim(br          , b        , w          )                                                 {
  const C = w.course
  let rowZ = Infinity
  let hz = 0
  for (const p of C.pads) {
    if (p.gh <= 0 || p.z + p.hz - b.z < -0.2 || p.z - p.hz - b.z > 6.5) continue
    if (p.z < rowZ) {
      rowZ = p.z
      hz = p.hz
    }
  }
  if (rowZ === Infinity) return null
  const t = w.t
  const under = b.pad >= 0 ? C.pads[b.pad] : null
  const vRun = GINCANA.run * Math.max(0.3, br.pace) * (under ? under.sl : 1)
  const front = rowZ - hz
  let best = -1
  let bestScore = -Infinity
  for (let i = 0; i < C.pads.length; i++) {
    const p = C.pads[i]
    if (p.gh <= 0 || p.z !== rowZ) continue
    // dentro da fileira: fica na sua
    if (b.z > front - 0.15 && Math.abs(p.x - b.x) <= p.hx) return { x: p.x, z: p.z + hz + 1, wait: false }
    const lat = Math.max(0, Math.abs(p.x - b.x) - 0.3) / GINCANA.run
    const ta = Math.max(0, (front - 0.45 - b.z) / vRun, lat)
    const tl = ta + (2 * hz + 0.9) / vRun
    let free = true
    for (let k = 0; k <= 5 && free; k++) if (padTop(p, p.z, t + ta + ((tl - ta) * k) / 5) > b.y + GINCANA.stepUp - 0.08) free = false
    const score = (free ? 8 : 0) - Math.abs(p.x - b.x) * 0.45 + botRand(br.seed, br.slot * 13 + i, Math.floor((t + p.gph) / p.gp)) * (2.6 - br.skill * 2.4)
    if (score > bestScore) {
      bestScore = score
      best = i
    }
  }
  if (best < 0) return null
  const p = C.pads[best]
  const ta = Math.max(0, (front - 0.45 - b.z) / vRun)
  let open = true
  for (let k = 0; k <= 5 && open; k++) if (padTop(p, p.z, t + ta + ((2 * hz + 0.9) / vRun) * (k / 5)) > b.y + GINCANA.stepUp - 0.08) open = false
  // fechada para quando eu chegar: espera um passo antes da frente, já alinhado
  if (!open) return { x: p.x, z: front - 1.1, wait: true }
  return { x: p.x, z: p.z + hz + 1, wait: false }
}

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

  // comportas: mira a que vai estar embaixo quando eu passar (ou espera alinhado na frente)
  const ga = gateAim(br, b, w)
  if (ga) {
    tx = ga.x
    tz = ga.z
    if (ga.wait && Math.abs(b.x - ga.x) < 0.5 && b.z > ga.z - 0.6) go = 0
  }

  // Crosta: o caminho escondido
  const pa = pathAim(br, b, w)
  if (pa) {
    tx = pa.x
    tz = pa.z
  }

  // ladrilhos: escolhe o próximo em pé (e não tremendo), perto da reta
  if (pa) {
    br.tile = -1
  } else if (C.tiles.length && !b.ground && br.tile >= 0) {
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
  // Serraria: tora adiante — espera a fileira de cravos passar por baixo antes de subir (a que desce pela frente
  // derruba quem está encostado; a que vem por cima pega quem está no topo)
  for (let i = 0; i < C.logs.length; i++) {
    const L = C.logs[i]
    const ahead = L.z - L.R - b.z
    if (ahead < 0.1 || ahead > 2.6 || Math.abs(b.x - L.x) > L.hx) continue
    const arrive = ahead / vRun + 0.25
    let bad = false
    for (let k = 0; k < L.rows; k++) {
      for (const dtk of [arrive - 0.15, arrive, arrive + 0.25]) {
        let a = logRowAngle(L, k, t + dtk) % (Math.PI * 2)
        if (a > Math.PI) a -= Math.PI * 2
        if (a < -Math.PI) a += Math.PI * 2
        // de pouco atrás do topo até a frente: é por onde o corpo passa
        if (a < 0.55 && a > -1.45) bad = true
      }
    }
    if (bad && botRand(br.seed, br.slot * 53 + i, Math.floor(t * 0.7)) < br.skill + 0.15) go = 0
  }
  // Quebra-Gelo: hélice em pé adiante — só entra se nenhuma pá passar pelo corpo enquanto atravessa
  for (let i = 0; i < C.rotors.length; i++) {
    const q = C.rotors[i]
    const ahead = q.z - q.hz - b.z
    if (ahead < 0.05 || ahead > 2.4 || Math.abs(b.x - q.x) > q.L + 0.5) continue
    const arrive = ahead / vRun
    const leave = arrive + (q.hz * 2 + GINCANA.bodyR * 2 + 0.3) / vRun
    let bad = false
    for (let f = 0; f <= 1.001 && !bad; f += 0.2) {
      const tt = t + arrive - 0.1 + (leave - arrive + 0.25) * f
      for (const hy of [0.5, 1.3]) if (rotorBladeAt(q, b.x, b.y + hy, tt, GINCANA.bodyR + 0.2) >= 0) bad = true
    }
    if (bad && botRand(br.seed, br.slot * 67 + i, Math.floor(t * 0.8)) < br.skill + 0.15) go = 0
  }
  if (go === 0) br.waited += dt
  if (go === 0 && br.waited < 6 + br.skill * 4) {
    it.mx = 0
    it.mz = 0
  } else if (go > 0) br.waited = Math.max(0, br.waited - dt * 0.5)

  // disco que gira FORTE embaixo (borda > 4 m/s, a Clareira): não dá para segurar a beirada correndo.
  // Vai até perto da borda, deixa o giro levar e pula quando ele traz para o lado da próxima peça
  // (no ar o giro não carrega). Funciona em qualquer velocidade de giro.
  if (spinRide(br, b, w, it)) {
    // 20/11: a raiz/barra que gira por cima do disco (Floresta) também se pula aqui
    barJump(br, b, w, it)
    return it
  }
  // em cima de uma hélice: pá → cubo → espera uma pá apontar para a saída → corre por ela
  fanRide(br, b, w, it)
  // barra chegando: pula na hora (com o erro da habilidade)
  barJump(br, b, w, it)
  // Gangorras: a ponta da gangorra adiante subiu acima do passo — pula para subir nela
  if (b.ground && br.jumpCool <= 0) {
    for (let i = 0; i < C.saws.length; i++) {
      const S = C.saws[i]
      if (S.ax !== 0) continue
      const ahead = S.z - S.hz - b.z
      if (ahead < 0.1 || ahead > 1.3 || Math.abs(b.x - S.x) > S.hx + 0.1) continue
      if (sawTop(S, w.saw[i * 2], b.x, S.z - S.hz) < b.y + GINCANA.stepUp) continue
      it.jump = true
      br.jumpCool = 0.5
    }
  }
  // em cima da gangorra de lado inclinada: corre contra o escorregão, para o lado que sobe
  for (let i = 0; i < C.saws.length; i++) {
    const S = C.saws[i]
    if (S.ax !== 1 || !b.ground || Math.abs(b.x - S.x) > S.hx || Math.abs(b.z - S.z) > S.hz) continue
    const a = w.saw[i * 2]
    const off = b.x - S.x
    if (Math.abs(a) > 0.06 && Math.sign(off) === Math.sign(a) && Math.abs(off) > 0.5) it.mx -= Math.sign(a) * Math.min(1, br.skill + 0.3)
  }
  // aro à frente (e a janela do paredão): pula para cruzar no alto do pulo
  hoopJump(br, b, w, it)
  // Serraria: tora atravessada logo à frente — pula para subir nela (a parede de baixo não deixa passar)
  if (b.ground && br.jumpCool <= 0) {
    for (const L of C.logs) {
      const ahead = L.z - L.R - b.z
      if (ahead < 0.15 || ahead > 1.15 || Math.abs(b.x - L.x) > L.hx + 0.2 || L.y + L.R < b.y + 0.5) continue
      it.jump = true
      br.jumpCool = 0.5
    }
  }
  // ladrilho tremendo embaixo: pula para o próximo
  if (b.ground && br.jumpCool <= 0) {
    for (let i = 0; i < C.tiles.length; i++) {
      const q = C.tiles[i]
      const s = w.tiles[i]
      if (s < 0 || q.pg >= 0 || !onTile(q, b.x, b.z, 0)) continue
      if (t - s > C.tileTime.warn * 0.6 && botRand(br.seed, br.slot, i) < br.skill) {
        it.jump = true
        br.jumpCool = 0.6
      }
    }
  }
  // o chão acaba logo à frente e há chão adiante: pula o buraco
  const sp = Math.hypot(it.mx, it.mz)
  const tileNear =
    (br.tile >= 0 && Math.hypot(C.tiles[br.tile].x - b.x, C.tiles[br.tile].z - b.z) < 2.6) ||
    (br.path >= 0 && Math.hypot(C.tiles[br.path].x - b.x, C.tiles[br.path].z - b.z) < 3.4)
  if (b.ground && br.jumpCool <= 0 && sp > 0.3 && !tileNear) {
    const fx = it.mx / sp
    const fz = it.mz / sp
    const onFan = b.pad >= 0 && isFanPad(C, C.pads[b.pad])
    if (!onFan && nearFan(C, b.x, b.z)) {
      // hélice adiante, eu em chão parado: na beira, só sai com pouso garantido NO TEMPO do pouso (e longe
      // da ponta da pá); senão espera. O chão "de agora" 1 m à frente pode ser uma pá que já vai embora.
      const own = groundUnder(w, b.x + fx * 1.1, b.z + fz * 1.1, b.y + 0.5)
      if (own.pad < 0 || C.pads[own.pad].spin !== 0) {
        if (fanLand(w, b, fx, fz)) {
          it.jump = true
          br.jumpCool = 0.5
        } else {
          it.mx = 0
          it.mz = 0
        }
      }
    } else {
    const near = groundUnder(w, b.x + fx * 1.0, b.z + fz * 1.0, b.y + 0.5)
    if (near.y < b.y - 0.6 || near.y === -Infinity) {
      const fan = onFan
      let far = false
      if (fan) far = fanLand(w, b, fx, fz)
      else {
        for (const k of [2.2, 3.2, 4.2, 5.0]) {
          const g = groundUnder(w, b.x + fx * k, b.z + fz * k, b.y + 1.2)
          if (g.y > b.y - 1.2) far = true
        }
      }
      if (far) {
        it.jump = true
        br.jumpCool = 0.5
      } else if (fan) {
        it.mx = 0
        it.mz = 0
      }
    }
    }
  }
  // preso (parado sem esperar nada): pula; encostado numa fileira de portas, recua um passo (dois robôs que
  // cruzam um na frente do outro junto da parede de portas se travam de lado)
  if (br.back > 0) {
    br.back -= dt
    it.mz = -0.8
    it.mx = it.mx >= 0 ? 0.6 : -0.6
    return it
  }
  if (Math.abs(b.z - br.lastZ) > 0.6) {
    br.lastZ = b.z
    br.stuck = 0
  } else if (go > 0) {
    br.stuck += dt
    if (br.stuck > 1.4 && b.ground && br.door >= 0 && C.doors[br.door].z - b.z < 1.5) {
      br.back = 0.45 + botRand(br.seed, br.slot, Math.floor(t * 4)) * 0.3
      br.stuck = 0
    } else if (br.stuck > 2.2 && b.ground) {
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
    stepSaws(w, this.runners, (j) => !this.gone[j], dt)
    // ladrilhos que já voltaram
    for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] >= 0 && this.t - w.tiles[i] >= C.tileTime.warn + C.tileTime.gone) w.tiles[i] = -1
    // pedras que desmoronam sozinhas na hora delas (Cânion, 20/11)
    for (let i = 0; i < w.tiles.length; i++) {
      const cr = C.tiles[i].cr
      if (cr !== undefined && w.tiles[i] === -1 && this.t >= cr) w.tiles[i] = cr
    }
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
        if (Math.abs(b.y - q.y) < 0.3 && onTile(q, b.x, b.z, 0) && this.world.tiles[k] === -1) stepTile(C, this.world.tiles, this.world.real, k, this.t)
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

module.exports = { DECK, GINCANA, GINCANA_COLORS, GINCANA_PHASES, MEM_SYMBOLS, memShow, memCall, memState, memSymbols, memTarget, memTile, memIndexAt, memUp, hoopX, hoopPass, drumAngle, drumSpeed, DRUM_EDGE, drumAt, LOG_EDGE, SPIKE_OUT, SPIKE_R, logAt, logRowAngle, logSpikeCount, logSpikeX, rotorAngle, rotorBladeAt, SAW, sawArm, sawTop, sawRest, stepSawState, plankAngle, plankTop, CourseKit, sweeperAngle, sweeperW, pendulumAt, gloveAt, padShift, padRot, pusherAt, courseHash, ballLane, pathReal, stepTile, doorsOpen, wallsAt, riseAt, gateLift, padTop, rampTop, ballsAt, tileUp, onTile, sectionAt, spawnAt, reprise, CIDADE, FLORESTA_ROOTS, FLORESTA_LILIES, FLORESTA_RISE_PLUS, FLORESTA_BELT, CLAREIRA, SERRARIA, CANION, stoneCells, MOINHOS, HELICES, CROSTA, GANGORRAS, gangorraStages, AROS, ALTOFORNO, COMPORTAS, TANQUE, PORTOES, ESTALEIRO, ROLL_R, ROLL_TOP, MEM_GRID, FEIRA, COROA, COURSE_BASE, BASE_LEN, COURSES, courseOf, MODE, IDLE_INTENT, newWorld, stepSaws, newRunner, groundUnder, ROLL_PLANK, ROLL_SAW, knock, fallOut, respawn, stepRunner, separate, ANIM, runnerAnim, botRand, newBrain, botIntent, qualifyOf, GincanaRace };
