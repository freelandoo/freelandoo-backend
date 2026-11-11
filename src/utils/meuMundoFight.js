// GERADO por scripts/build-fight-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/laminas/sim/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do jogo no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── sim/fight.ts ─────────────────────────────────────────────────────────────
// features/meu-mundo/laminas/sim/fight.ts — ARENA DAS LÂMINAS (mm3d-48a): a regra da luta.
//
// Luta de espada contra a máquina (pedido do Alex, 29/10): o jogador anda,
// ataca em combo de 3 golpes e esquiva; cada inimigo é uma máquina de
// estados com AVISO antes de cada golpe (o anel vermelho no chão) e brecha
// depois dele. Tudo em passo fixo de 1/60 s e sorteio com semente, para a
// mesma regra poder rodar na sala depois (como a Gincana e o Paint).
//
// Atributos da vida (0–1000) pesam com teto: força = dano (0,85×–1,35×),
// velocidade = ritmo de ataque e passada, inteligência = aviso mais longo
// (até +35%). Sem atributos, todos valem 300.
// mm3d-59: DESTREZA = economia de fôlego (até 15% no ataque e na esquiva),
// recuperação depois do golpe até 10% menor e 30% do peso no ranque do golpe
// (a regra ÚNICA de golpe superior: inteligência 70% + destreza 30%).
//
// Coordenadas: x/z no chão, centro da arena na origem; rumo 0 = +z.

const DT = 1 / 60
/** Raio do chão de luta (m). */
const ARENA_R = 11
const PLAYER_R = 0.45

// Lore v2 (F1, 2026-11-10): ids renomeados — `cavaleiro` (o Soldado de Pedra/Cavaleiro Dourado, ex-"soldier"),
// `ciborgue` (ex-"golem"), `garras` (ex-"harpy") e o novo `stone` (o Golem de Pedra, que antes
// dividia o id com o Soldado). O servidor ainda aceita os ids antigos (LEGACY_MOB_KIND).
                                                                                      
const MOB_KINDS            = ["cavaleiro", "wolf", "ciborgue", "garras", "brute", "stone"]
/** Ids de antes da F1 → os de agora (aparelho com página antiga, recibos e troféus gravados). */
const LEGACY_MOB_KIND                          = { soldier: "cavaleiro", golem: "ciborgue", harpy: "garras" }
const mobKindOf = (k         )                 => {
  const id = typeof k === "string" ? (LEGACY_MOB_KIND[k] ?? k) : ""
  return (MOB_KINDS            ).includes(id) ? (id           ) : null
}

                        
                  
               
                      
                   
 
const BASE_STATS        = { strength: 300, speed: 300, intelligence: 300, dexterity: 300 }

// ── o jogador ──────────────────────────────────────────────────────────────
/** Golpe do combo: duração, instante do corte, alcance, abertura (rad), dano, avanço (m/s até o corte). */
                        
             
               
               
             
             
               
 
/** Três golpes (gancho = corte, direto = corte de volta, o terceiro é o forte). Tempos no ritmo 1. */
const COMBO          = [
  { dur: 0.62, hitAt: 0.29, range: 2.1, arc: 1.9, dmg: 14, lunge: 2.2 },
  { dur: 0.66, hitAt: 0.31, range: 2.1, arc: 1.9, dmg: 16, lunge: 2.2 },
  { dur: 0.86, hitAt: 0.42, range: 2.4, arc: 2.4, dmg: 26, lunge: 3.2 },
]
/**
 * MAGA (raposa, pedido do Alex em 2026-11-01: "os magos soltam bolas de
 * fogo"): o golpe não corta — no instante do disparo sai uma BOLA DE FOGO
 * que voa até o inimigo (mira automática dentro de `arc`) e explode ao tocar;
 * a terceira é a grande, que explode em área. Mesmos tempos do combo.
 */
const MAGE_COMBO          = [
  { dur: 0.62, hitAt: 0.29, range: 10, arc: 1.2, dmg: 12, lunge: 0 },
  { dur: 0.66, hitAt: 0.31, range: 10, arc: 1.2, dmg: 14, lunge: 0 },
  { dur: 0.86, hitAt: 0.42, range: 11, arc: 1.4, dmg: 24, lunge: 0 },
]
const SHOT = { speed: 15, radius: 0.45, blast: 2.0, y: 1.25 }
                       
            
           
           
           
            
            
              
             
                
            
 

/**
 * RANQUES (pedido do Alex em 2026-11-01): cada ATACAR sorteia um golpe C, B, A
 * ou S. O normal (C) é o mais comum; o S é raro, dá muito mais dano e é o mais
 * brilhante. Treinar INTELIGÊNCIA (0–1000) puxa a sorte para os fortes.
 * `slot` = qual dos 3 tempos/alcances do combo o golpe usa.
 */
const RANKS = ["C", "B", "A", "S"]         
                                
const RANK = {
  /** Peso no sorteio com inteligência 0 e com 1000 (interpolado). */
  weight0: [64, 24, 9, 3],
  weight1: [34, 30, 22, 14],
  dmg: [1, 1.3, 1.7, 2.6],
  slot: [0, 1, 2, 2],
  /** Mais devagar no S (a preparação do golpe especial). */
  durK: [1, 1, 1, 1.15],
}
/** Chance de cada ranque: inteligência (70%) e destreza (30%), 0–1000. Sem destreza = só a inteligência. */
function rankOdds(intelligence        , dexterity         = intelligence)           {
  const k = 0.7 * clamp(intelligence / 1000, 0, 1) + 0.3 * clamp(dexterity / 1000, 0, 1)
  const w = RANK.weight0.map((a, i) => a + (RANK.weight1[i] - a) * k)
  const sum = w.reduce((a, b) => a + b, 0)
  return w.map((x) => x / sum)
}
/** Golpes seguidos antes de voltar à guarda. */
const MAX_CHAIN = 3

/** Apertou de novo até isto depois do corte: o próximo golpe do combo encadeia. */
const CHAIN_AFTER = 0.05
const DODGE = { dur: 0.46, iframeFrom: 0.04, iframeTo: 0.36, speed: 8.2, stam: 24 }
const PLAYER = { hp: 100, walk: 3.4, run: 5.6, stam: 100, stamRegen: 30, attackStam: 9, hurt: 0.32, heavyHurt: 0.7 }

                                                                                                   

/**
 * PODER (pedido do Alex em 2026-11-01: "poderes que brilham desde o chão"):
 * a barra enche com os acertos; cheia, o poder da classe. Durante ele quem
 * joga não leva dano. Maga = explosão de fogo em volta (área); lâmina =
 * golpe de sangue à frente que devolve vida.
 * 2026-11-03 (combate premium): carga mais longa (1,6 s, dispara em 0,85 s)
 * e recarga de SKILLS.ult.cd depois de usar.
 */
const POWER = { max: 100, perHit: 14, perHeavy: 22, dur: 1.6, fireAt: 0.85, mageR: 4.6, mageDmg: 46, bladeRange: 4.8, bladeArc: 2.0, bladeDmg: 42, heal: 22 }

/**
 * HABILIDADES (pedido do Alex, 2026-11-03 — "combate mobile RPG premium"):
 * números num lugar só. Todas contam no servidor (a gravação re-simula).
 *  - slash  CORTE MÁGICO: lâmina de luz curva que sai à frente, atravessa e
 *           acerta cada inimigo uma vez no caminho;
 *  - dash   INVESTIDA RELÂMPAGO: avanço rápido na direção do joystick (sem
 *           direção = para o alvo), sem levar golpe, acerta quem encostar;
 *  - shield ESCUDO DE LUZ: cúpula por `dur` s que corta `cut` do dano e
 *           impede a queda (não trava o movimento);
 *  - ult    recarga do PODER depois de usar (a barra continua enchendo).
 */
const SKILLS = {
  slash: { cd: 8, dur: 0.55, fireAt: 0.22, speed: 17, range: 7.5, width: 1.7, dmg: 30 },
  dash: { cd: 6, dur: 0.3, dist: 5.4, width: 0.9, dmg: 14 },
  shield: { cd: 18, dur: 4, cut: 0.7 },
  ult: { cd: 12 },
}
                                                 
/** Recarga restante de cada habilidade (s). */
                            
               
              
                
             
 
/** Lâmina do Corte Mágico no ar. */
                       
            
           
           
            
            
              
             
                                              
               
 
                             
           
           
            
            
                
            
              
                    
                                   
           
                                       
               
                               
                 
                                            
                 
                
                
                                              
              
                                      
               
                                                                       
               
                                                                    
            
               
                                              
                       
               
                                                    
                     
                                  
                   
 

// ── os inimigos ────────────────────────────────────────────────────────────
/**
 * Golpe de inimigo: aviso (windup), ativo, recuperação; alcance e abertura
 * (cone à frente) ou ÁREA (círculo de raio `area` a `reach` m à frente);
 * avanço durante o ativo (m/s); peso no sorteio; mínimo e máximo de
 * distância para escolher este golpe.
 */
                            
            
                
                
                 
               
             
               
                
             
               
                
              
              
                 
                                                                                            
                
                                                                        
               
                                                                                        
               
                                                             
               
                                                                
              
                                                                                                       
                                             
             
 
                         
            
                
               
                                                     
                
                                                                        
               
                      
                                
                        
                                     
                 
                                                                                                               
                                                  
 

/**
 * mm3d-72 (Alex, 2026-11-07: "os monstros que são personagens ganham os poderes"): o Golem de
 * Pedra, o Ciborgue, a Dama e o Brutamontes, na Arena e na rua, usam os mesmos 4 poderes de
 * quem joga — Corte (raio reto), Investida (avanço que arrasta), Escudo (−70% por 4 s, só
 * machucado) e Poder Máximo (área em volta) —, cada um com a sua recarga.
 */
const MOB_SKILL_KINDS                     = ["cavaleiro", "ciborgue", "garras", "brute", "stone"]
const MOB_SKILLS                       = [
  { id: "skSlash", windup: 0.6, active: 0.14, recover: 0.7, range: 7.5, arc: 0, line: 0.85, dmg: 16, lunge: 0, weight: 2, minD: 2.5, maxD: 7.5, heavy: true, skill: "slash", cd: 8 },
  { id: "skDash", windup: 0.45, active: 0.35, recover: 0.8, range: 1.8, arc: 1.8, dmg: 12, lunge: 15, ram: true, weight: 2, minD: 3, maxD: 8, skill: "dash", cd: 6 },
  { id: "skShield", windup: 0.3, active: 0.1, recover: 0.3, range: 0, arc: 0, dmg: 0, lunge: 0, weight: 3, minD: 0, maxD: 99, skill: "shield", cd: 18 },
  { id: "skUlt", windup: 1.2, active: 0.2, recover: 1.2, range: 0, arc: 0, area: 4.2, reach: 0, dmg: 34, lunge: 0, weight: 4, minD: 0, maxD: 3.6, heavy: true, skill: "ult", cd: 16 },
]
/** Escudo do monstro: quanto corta, quanto dura e abaixo de que vida ele usa. */
const MOB_SHIELD = { cut: 0.7, dur: 4, below: 0.6 }

/**
 * mm3d-72 (regras do Alex, 2026-11-08): a PERSONALIDADE mexe na luta por probabilidade, e o
 * afeto pelo dono muda a chance.
 *  - Psicopata: o Poder Máximo pode sair 3 vezes seguidas ("PSICOPATA" na tela). Contra
 *    inimigo com mais de 1,5× a minha força (ataque) ou defesa a chance é alta; fora disso
 *    ela existe e cresce com o afeto.
 *  - Covarde: com a vida baixa, às vezes desiste — avisa ("tô com medo dessa luta, vou
 *    sair") e sai `cowardWarn` s depois. Quanto mais gosta do dono, menor a chance.
 * Os sorteios só acontecem para quem tem a personalidade: a luta dos outros não muda.
 */
const SOUL_FIGHT = {
  psychoRatio: 1.5,
  psychoStrong: 0.75,
  psychoPerAff: 0.0015,
  psychoAffMax: 0.35,
  /** Disparos extras do Poder Máximo depois do primeiro (s). */
  psychoExtra: [0.45, 0.9],
  cowardHp: 0.5,
  cowardPerS: 0.06,
  cowardAffHalf: 150,
  cowardWarn: 2,
}
                                                                                         

const MOBS                          = {
  // o Cavaleiro Dourado / Soldado de Pedra: espada (corte e estocada), na Arena, no treino e no ringue
  cavaleiro: {
    hp: 60,
    radius: 0.5,
    speed: 2.3,
    engage: 1.7,
    poise: 0,
    rest: [0.9, 1.6],
    attacks: [
      { id: "cut", windup: 0.7, active: 0.2, recover: 0.7, range: 2.0, arc: 1.4, dmg: 10, lunge: 1.5, weight: 3, minD: 0, maxD: 2.4 },
      { id: "thrust", windup: 0.85, active: 0.25, recover: 0.9, range: 2.6, arc: 0.7, dmg: 14, lunge: 4, weight: 1, minD: 1.4, maxD: 3.2 },
    ],
  },
  wolf: {
    hp: 34,
    radius: 0.9, // lobo grande (29/10): 4 m de comprimento
    speed: 5.2,
    engage: 3.4,
    poise: 0,
    rest: [1.6, 3.0],
    attacks: [
      { id: "bite", windup: 0.5, active: 0.18, recover: 0.6, range: 1.5, arc: 1.2, dmg: 7, lunge: 2, weight: 2, minD: 0, maxD: 1.9 },
      { id: "pounce", windup: 0.6, active: 0.35, recover: 0.9, range: 1.4, arc: 1.4, dmg: 10, lunge: 9, weight: 3, minD: 2.2, maxD: 4.6 },
    ],
    // pedido do Alex (2026-11-06): raio roxo pela boca; o golpe máximo é a investida brilhando,
    // que leva quem joga no peito
    arena: {
      engage: 4,
      attacks: [
        { id: "bite", windup: 0.5, active: 0.18, recover: 0.6, range: 1.5, arc: 1.2, dmg: 7, lunge: 2, weight: 2, minD: 0, maxD: 1.9 },
        { id: "pounce", windup: 0.6, active: 0.35, recover: 0.9, range: 1.4, arc: 1.4, dmg: 10, lunge: 9, weight: 3, minD: 2.2, maxD: 4.6 },
        { id: "breath", windup: 0.7, active: 0.16, recover: 0.6, range: 9, arc: 0, line: 0.35, dmg: 8, lunge: 0, weight: 3, minD: 3, maxD: 9.5 },
        { id: "rush", windup: 0.8, active: 0.7, recover: 0.9, range: 1.7, arc: 1.8, dmg: 12, lunge: 15, ram: true, weight: 12, minD: 2.5, maxD: 12, heavy: true, max: 10 },
      ],
    },
  },
  ciborgue: {
    hp: 220,
    radius: 1.0,
    speed: 1.5,
    engage: 2.4,
    poise: 4,
    rest: [1.0, 1.8],
    attacks: [
      { id: "swipe", windup: 0.95, active: 0.3, recover: 1.0, range: 3.0, arc: 2.2, dmg: 18, lunge: 0.8, weight: 2, minD: 0, maxD: 3.3, heavy: true },
      { id: "slam", windup: 1.3, active: 0.2, recover: 1.5, range: 0, arc: 0, area: 2.6, reach: 2.2, dmg: 28, lunge: 0, weight: 2, minD: 0, maxD: 4.4, heavy: true },
    ],
    // regra do Alex (2026-11-06): o Ciborgue encontrado é o da skin: atira, reto, de longe
    arena: {
      engage: 6,
      attacks: [
        { id: "shot", windup: 0.75, active: 0.12, recover: 0.7, range: 9.5, arc: 0.35, dmg: 16, lunge: 0, weight: 3, minD: 0, maxD: 10 },
        { id: "blast", windup: 1.15, active: 0.14, recover: 1.1, range: 10.5, arc: 0.6, dmg: 26, lunge: 0, weight: 2, minD: 2.5, maxD: 11, heavy: true },
      ],
    },
  },
  garras: {
    hp: 80,
    radius: 0.55,
    speed: 3.2,
    engage: 2.6,
    poise: 2,
    rest: [0.9, 1.7],
    // 2026-11-03 (Alex: "deixa a dama sem ficar voando"): luta NO CHÃO, sempre pode levar golpe.
    // 2026-11-06 (Alex): garras abertas, salta para perto como o Brutamontes.
    attacks: [
      { id: "claw", windup: 0.45, active: 0.2, recover: 0.5, range: 2.0, arc: 1.7, dmg: 9, lunge: 2, weight: 3, minD: 0, maxD: 2.6 },
      { id: "rake", windup: 0.6, active: 0.3, recover: 0.6, range: 2.2, arc: 2.2, dmg: 13, lunge: 3, weight: 2, minD: 0, maxD: 3 },
      { id: "leap", windup: 0.75, active: 0.5, recover: 0.7, range: 2, arc: 2.2, dmg: 16, lunge: 11, leap: true, weight: 4, minD: 3, maxD: 22, heavy: true },
    ],
  },
  brute: {
    hp: 320,
    radius: 0.85,
    speed: 2.1,
    engage: 2.3,
    poise: 5,
    rest: [0.8, 1.4],
    attacks: [
      { id: "sweep", windup: 0.9, active: 0.3, recover: 0.9, range: 2.8, arc: 2.6, dmg: 20, lunge: 1, weight: 3, minD: 0, maxD: 3.1, heavy: true },
      { id: "charge", windup: 1.0, active: 0.6, recover: 1.3, range: 1.8, arc: 1.4, dmg: 26, lunge: 9, weight: 2, minD: 3.2, maxD: 9, heavy: true },
      { id: "smash", windup: 1.25, active: 0.2, recover: 1.4, range: 0, arc: 0, area: 2.2, reach: 1.8, dmg: 30, lunge: 0, weight: 1, minD: 0, maxD: 3.5, heavy: true },
    ],
  },
  // o Golem de Pedra (F1): na Arena e na rua, com os golpes que eram do "soldier" nesses lugares
  stone: {
    hp: 60,
    radius: 0.5,
    speed: 2.3,
    engage: 2.2,
    poise: 0,
    rest: [0.9, 1.6],
    attacks: [
      { id: "jab", windup: 0.5, active: 0.16, recover: 0.45, range: 2.4, arc: 1.6, dmg: 9, lunge: 1.2, weight: 3, minD: 0, maxD: 3.0 },
      { id: "hook", windup: 0.75, active: 0.2, recover: 0.7, range: 2.7, arc: 1.9, dmg: 14, lunge: 1.5, weight: 2, minD: 0, maxD: 3.2 },
    ],
    // regra do Alex (2026-11-06): o Golem salta para perto e dá socos de boxe; as duas pedras atrás
    // dos ombros soltam raio verde, e o golpe máximo é o raio das duas juntas, em fluxo contínuo
    arena: {
      engage: 2.2,
      attacks: [
        { id: "jab", windup: 0.5, active: 0.16, recover: 0.45, range: 2.4, arc: 1.6, dmg: 9, lunge: 1.2, weight: 3, minD: 0, maxD: 3.0 },
        { id: "hook", windup: 0.75, active: 0.2, recover: 0.7, range: 2.7, arc: 1.9, dmg: 14, lunge: 1.5, weight: 2, minD: 0, maxD: 3.2 },
        { id: "leap", windup: 0.9, active: 0.6, recover: 0.8, range: 2.2, arc: 2.2, dmg: 18, lunge: 9, leap: true, weight: 3, minD: 3.4, maxD: 22, heavy: true },
        { id: "zap", windup: 0.7, active: 0.14, recover: 0.6, range: 10, arc: 0, line: 0.35, dmg: 9, lunge: 0, weight: 2, minD: 3.4, maxD: 10 },
        { id: "max", windup: 1.3, active: 2.4, recover: 1.0, range: 14, arc: 0, line: 0.75, flow: 0.3, dmg: 5, lunge: 0, weight: 12, minD: 0, maxD: 22, max: 11 },
      ],
    },
  },
}

                                                                                                               
                      
            
               
           
           
                               
           
                
            
               
                 
           
                                                                                              
                      
                
                                               
             
                                                                           
                
                                                                
              
              
                 
              
                  
                                           
              
                
                                                                                  
                    
                                            
               
                                                                     
                 
                                                                                                       
                 
                                     
                 
                                                                   
               
                                              
                  
                                                
                  
                                                                                  
                                 
                     
 

                        
                                             
                                                                                                                                                       
                                                                                                              
                              
                                             
                                               
                  
                                                                                 
                                                                                   
                              
                                
                                                                                         
                                                      
                                                                                                            
                   
                     
                                                 
                                  
                                                         
                                                  
                                                                                          
                                                                             
                                                        
                                                                                      
                                            
                                                                     
                                               
                             
                                                      
                         
                      
                                                  
                                        

                        
                                             
            
            
              
                 
                
                                      
                 
                                                       
                 
                
                  
                                                     
                
 

/** Uma luta: quem entra e com que força. `level` (1–60; o Soldado só 1–2) multiplica vida, dano e firmeza. */
                             
               
                
               
                        
                                                                  
                
     
                                                                               
                                                                            
                                                 
     
                           
     
                                                                            
                                                                                    
     
               
     
                                                                                 
                                          
     
               
     
                                                                                             
                                                                                       
                                                                           
     
                                      
                                                                         
               
                                                                                                   
                      
                    
 

                            
             
             
              
              
               
 
const NO_GEAR            = { dmg: 0, def: 0, stam: 0, warn: 0, power: 0 }
/** Teto de segurança do lado da regra (o servidor já corta antes). */
const GEAR_MAX            = { dmg: 0.35, def: 0.25, stam: 0.12, warn: 0.12, power: 0.18 }
function clampGear(g                     )            {
  const out = { ...NO_GEAR }
  if (!g) return out
  for (const k of Object.keys(NO_GEAR)                       ) out[k] = clamp(Number(g[k]) || 0, 0, GEAR_MAX[k])
  return out
}

const clamp = (v        , a        , b        ) => (v < a ? a : v > b ? b : v)

// ═══ NÍVEL DO MONSTRO (mm3d-60m, regra do Alex) ═══ — o monstro da rua tem
// nível sorteado (pode vir bem acima ou abaixo do seu) e os status crescem
// com ele. Base = o nível 1 de hoje; 1–3 ficam EXATAMENTE como antes (a Arena
// usa); do 3 em diante cada nível soma +0,25× vida, +0,08× dano, +0,25 firmeza.
function mobLevelScale(level        )                                             {
  const l = Math.max(1, Math.round(level))
  const low = Math.min(l, 3) - 1
  const over = Math.max(0, l - 3)
  return { hp: 1 + 0.45 * low + 0.25 * over, dmg: 1 + 0.3 * low + 0.08 * over, poise: 2 * low + 0.25 * over }
}
// ═══ NÍVEL DE QUEM JOGA (pedido do Alex, 2026-11-03) ═══ — "todo level up tem
// um aumento de status geral". Nível 1 = como sempre foi (100 de vida, sem
// defesa). Cada nível: +9 de vida, +0,5% de defesa (teto 30%), +22% de ataque
// e +3 pontos em força/velocidade/inteligência/destreza (só na luta; a vida
// guarda os atributos sem o bônus). Desenhado contra mobLevelScale: lutar com
// um monstro do MESMO nível dá quase o mesmo número de golpes que no nível 1.
// Espelho para a tela: meuMundoAdventure.js heroLevelScale (o unit confere).
const HERO_LEVEL = { hp: 9, def: 0.005, defMax: 0.3, dmg: 0.22, attr: 3 }
/** Defesa total (nível + equipamento) nunca passa disto. */
const DEF_MAX = 0.6
function heroLevelScale(level        )                                                         {
  const n = Math.max(1, Math.round(Number(level) || 1)) - 1
  return {
    hp: PLAYER.hp + HERO_LEVEL.hp * n,
    def: Math.min(HERO_LEVEL.defMax, Math.round(HERO_LEVEL.def * n * 1000) / 1000),
    dmg: Math.round((1 + HERO_LEVEL.dmg * n) * 100) / 100,
    attr: HERO_LEVEL.attr * n,
  }
}
/** Atributos de luta = os da vida + o bônus do nível (sem teto). */
function heroStats(stats       , level        )        {
  const a = heroLevelScale(level).attr
  const up = (v        ) => Math.max(0, v + a)
  return { strength: up(stats.strength), speed: up(stats.speed), intelligence: up(stats.intelligence), dexterity: up(stats.dexterity ?? 300) }
}

// ═══ ADVERSÁRIO À ALTURA (regra do Alex, 2026-11-05) ═══ — no ringue do Boxe o
// adversário copia os status de quem joga; o Campeão tem 20% a mais.
const PEER_ELITE = 1.2
function peerOf(kind         )         {
  return kind === "brute" ? PEER_ELITE : 1
}

// ═══ FICHAS (regra do Alex, 2026-11-06) ═══ — os pesos de cada personagem: vida,
// ataque, defesa, acuracidade, velocidade, em %. Multiplicam os status de quem veste:
// com tudo em 200, o Aurion fica com 320 de vida. O personagem padrão (normal, magro,
// gordo, forte) não está aqui: pesa 100 em tudo.
                                                                     
const BASE_SHEET        = [100, 100, 100, 100, 100]
const BODY_SHEETS                        = {
  aurion: [160, 140, 150, 140, 120],
  morkhan: [130, 180, 90, 150, 130],
  kragor: [220, 150, 160, 100, 70],
  zephyra: [100, 120, 80, 120, 200],
  maru: [180, 100, 100, 90, 120],
  iris: [90, 120, 80, 200, 110],
  noctis: [100, 130, 90, 150, 170],
  aeryn: [90, 110, 90, 180, 150],
  cavaleiro: [140, 110, 180, 110, 80],
  golem: [160, 110, 150, 80, 50],
  ciborgue: [130, 130, 130, 150, 70],
  garras: [90, 120, 80, 160, 140],
  brutamontes: [200, 160, 140, 120, 90],
  sergio: [110, 130, 100, 100, 110],
  ekaterina: [100, 110, 90, 130, 120],
  female: [90, 100, 90, 110, 110],
  raposa: [90, 110, 90, 130, 110],
  raposa_f: [90, 105, 90, 135, 115],
  raposa_adulto: [110, 130, 100, 150, 120],
  raposa_adulta: [105, 125, 100, 155, 125],
  vampiro: [100, 120, 90, 100, 130],
  vampira: [95, 115, 90, 105, 135],
  vampiro_adulto: [130, 150, 110, 110, 140],
  vampira_adulta: [120, 145, 105, 115, 150],
}
/**
 * Monstros: ficha sobre os status do nível (mobBase). `stone` = o Golem de Pedra; o
 * bando divide a vida. Regra do Alex (2026-11-06): todas as raças na dificuldade do Brutamontes,
 * cada uma com o seu jeito. Números medidos com robô lutando (vitórias próximas às do Brutamontes
 * com os mesmos heróis). Esta ficha é da LUTA; a de quem veste a skin é BODY_SHEETS.
 */
const MOB_SHEETS                         = {
  cavaleiro: [170, 130, 170, 90, 70],
  stone: [175, 120, 165, 95, 60],
  wolf: [225, 125, 125, 75, 100],
  ciborgue: [180, 170, 150, 180, 80],
  garras: [125, 150, 110, 120, 130],
  brute: [200, 160, 140, 120, 90],
}
/**
 * Status normais de um monstro do nível (regra do Alex, 2026-11-06): o nível 15 vale o que o 18
 * valia (Brutamontes do 15 = 506/575/503/431/323). Valer o 27 ficou impossível de ganhar. O nível
 * 1 não muda; segue nesse passo, sem teto.
 */
function mobBase(level        )                               {
  const n = ((Math.max(1, Math.round(Number(level) || 1)) - 1) * 17) / 14
  return { hp: PLAYER.hp + HERO_LEVEL.hp * n, rate: 100 + (900 * n) / 59 }
}
/** O que o nível soma em ataque, defesa e, nos monstros, acuracidade e velocidade (0 no 1, 900 no 60, e segue). */
const levelRate = (level        ) => (900 * (Math.max(1, Math.round(Number(level) || 1)) - 1)) / 59
/** Equipamento no teto soma isto em ataque e em defesa. */
const GEAR_RATE = 150
/** Status de luta de quem joga: (100 + nível + treino + equipamento) × peso do personagem. */
function heroSheet(body                           , level        , stats                                                   , gear                     ) {
  const [hp, atk, def, acc, spd] = BODY_SHEETS[body ?? ""] ?? BASE_SHEET
  const h = heroLevelScale(level)
  const f = heroStats({ ...stats, dexterity: stats.dexterity ?? 0 }, level)
  const g = clampGear(gear)
  return {
    hp: Math.round((h.hp * hp) / 100),
    atk: ((100 + levelRate(level) + (g.dmg / GEAR_MAX.dmg) * GEAR_RATE) * atk) / 100,
    def: ((100 + levelRate(level) + (g.def / GEAR_MAX.def) * GEAR_RATE) * def) / 100,
    acc: ((100 + f.strength) * acc) / 100,
    spd: ((100 + f.speed) * spd) / 100,
  }
}

// ═══ ACERTO, ESQUIVA E DANO (regra do Alex, 2026-11-06) ═══ — vale para os dois
// lados. A acuracidade (o antigo atributo força)
// disputa com a velocidade: 100 contra 1000 acerta 10%, 1000 contra 100 sempre acerta.
// Quem não aperta esquivar escapa sozinho do que sobra (90% no exemplo). Apertar
// esquivar escapa na razão inversa, até 90%: no empate funciona e, contra 1000 de
// acuracidade com 100 de velocidade, quase nunca. Quem tem menos de 50% não acerta 2
// seguidos. O dano segue a mesma conta, em porcentagem pura: um golpe de 200 com
// ataque 50 tira 100 em defesa 100 e 10 em defesa 1000; ataque 100 contra defesa 50
// tira 400. Em luta igual o golpe médio tira a mesma fatia da vida em todo nível.
                            
             
             
             
             
 
const DODGE_MAX = 0.9
function hitChance(acc        , spd        ) {
  return clamp(acc / Math.max(1, spd), 0, 1)
}
function dodgeChance(acc        , spd        ) {
  return Math.max(1 - hitChance(acc, spd), Math.min(DODGE_MAX, spd / Math.max(1, acc)))
}
function damageRatio(atk        , def        ) {
  return Math.max(0, atk) / Math.max(1, def)
}

const angDiff = (a        , b        ) => {
  let d = a - b
  while (d > Math.PI) d -= 2 * Math.PI
  while (d < -Math.PI) d += 2 * Math.PI
  return d
}
const turnTo = (cur        , to        , max        ) => cur + clamp(angDiff(to, cur), -max, max)

/** Sorteio com semente (mulberry32). */
function rng(seed        ) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** O que os atributos valem na luta (com teto de vantagem). */
function statEffects(s       ) {
  const k = (v        ) => Math.max(0, v / 1000)
  return {
    dmg: 0.85 + 0.5 * k(s.strength),
    rate: 0.92 + 0.3 * k(s.speed),
    move: 0.95 + 0.2 * k(s.speed),
    warn: 1 + 0.35 * k(s.intelligence),
    intelligence: Math.max(0, s.intelligence),
    dexterity: Math.max(0, s.dexterity ?? 300),
    /** Fôlego gasto (ataque e esquiva): até −15%. */
    stamK: Math.max(0.1, 1 - 0.15 * k(s.dexterity ?? 300)),
    /** Recuperação depois do corte: até −10%. */
    recoverK: Math.max(0.2, 1 - 0.1 * k(s.dexterity ?? 300)),
  }
}

/** Quantos e onde nascem: lobos em bando de 3, o resto sozinho. */
function spawnList(kind         )                             {
  if (kind === "wolf") return [{ x: -3.6, z: 5.5 }, { x: 0, z: 7 }, { x: 3.6, z: 5.5 }]
  return [{ x: 0, z: 5.5 }]
}

class Fight {
           R              
           me            
           mobs        = []
  fx                                
           level        
           kind         
  time = 0
  over                                                              = null
  /** mm3d-72: personalidade e afeto (probabilidades da luta). */
           temper                    
           affection        
  /** Este Poder Máximo sai 3 vezes (psicopata). */
          psychoTriple = false
  /** Covarde: sai quando o relógio passar disto (0 = não vai sair). */
          fleeAt = 0
          lastSecond = 0
  /** Eventos do último passo (quem desenha consome). */
  events               = []
  /** Lobo que tem a vez de atacar (os outros circulam). */
          token = -1
  /** Bolas de fogo no ar (maga). */
           shots         = []
          shotSeq = 0
  /** Monstros em que meu último golpe pegou. */
                   meLanded = new Set        ()
           combo         
          prevAttack = false
          prevDodge = false
          prevPower = false
          prevSkill = { slash: false, dash: false, shield: false }
  /** Lâminas do Corte Mágico no ar. */
           waves         = []
          waveSeq = 0
  /** Só conferência (harness): força o ranque dos próximos golpes. */
  forceRank              = null
  /** mm3d-59: bônus do equipamento (com teto). */
           gear           
  /** Nível de aventura de quem joga e o que ele dá. */
           heroLevel        
           hero                                   
  /** Luta com acerto e esquiva por status (adversário à altura). */
           rated         
           rate           
  /** Defesa total (nível + equipamento, com teto). */
           def        

  constructor(setup            ) {
    // luta aberta antes da F1 (ou aparelho com a página antiga): o id antigo vira o de agora;
    // o "soldier" da Arena e da rua era o Golem de Pedra
    const legacy = (setup.kind          ) === "soldier" && setup.tier ? "stone" : mobKindOf(setup.kind)
    if (legacy && legacy !== setup.kind) setup = { ...setup, kind: legacy }
    this.R = rng(setup.seed ?? (Date.now() & 0x7fffffff))
    this.temper = setup.temper ?? null
    this.affection = Math.max(0, Number(setup.affection) || 0)
    this.kind = setup.kind
    this.combo = setup.style === "mage" ? MAGE_COMBO : COMBO
    // O Golem de Pedra do menu tem só os níveis 1 e 2 (Alex, 29/10) — quem corta é o
    // servidor (e o menu); na rua (2026-11-03) ele vem com o nível sorteado, até 60.
    this.level = Math.max(1, Math.round(setup.level ?? 1))
    const stats = { ...BASE_STATS, ...(setup.stats ?? {}) }
    this.gear = clampGear(setup.gear)
    this.heroLevel = Math.max(1, Math.round(Number(setup.hero) || 1))
    this.hero = heroLevelScale(this.heroLevel)
    this.def = clamp(this.gear.def + this.hero.def, 0, DEF_MAX)
    const peer = clamp(Number(setup.peer) || 0, 0, 2)
    this.rated = peer > 0 || !!setup.tier
    this.fx = this.withGear(statEffects(heroStats(stats, this.heroLevel)))
    const sheet = heroSheet(setup.body, this.heroLevel, stats, this.gear)
    this.rate = { acc: Math.max(1, sheet.acc), spd: Math.max(1, sheet.spd), atk: sheet.atk, def: sheet.def }
    const hpMax = this.rated ? sheet.hp : this.hero.hp
    this.me = {
      x: 0,
      z: -5,
      vx: 0,
      vz: 0,
      facing: 0,
      hp: hpMax,
      hpMax,
      stam: PLAYER.stam,
      state: "idle",
      t: 0,
      combo: 0,
      struck: false,
      queued: false,
      dodgeX: 0,
      dodgeZ: 1,
      rate: this.fx.rate,
      power: 0,
      rank: 0,
      chain: 0,
      skill: null,
      cd: { slash: 0, dash: 0, shield: 0, ult: 0 },
      shieldUntil: 0,
      dashHit: [],
    }
    const def = MOBS[setup.kind]
    const lv = mobLevelScale(this.level)
    const spots = spawnList(setup.kind)
    const mean = (list          ) => list.reduce((a, b) => a + b, 0) / list.length
    const foeLevel = setup.tier === "street" || setup.tier === "domain" ? this.level : this.heroLevel
    const base = setup.tier ? mobBase(foeLevel) : { hp: heroLevelScale(foeLevel).hp, rate: 100 + levelRate(foeLevel) }
    const normal = base.hp
    const rated = base.rate
    const ms = MOB_SHEETS[setup.kind]
    const foe            = peer
      ? { acc: this.rate.acc * peer, spd: this.rate.spd * peer, atk: this.rate.atk * peer, def: this.rate.def * peer }
      : { acc: (rated * ms[3]) / 100, spd: (rated * ms[4]) / 100, atk: (rated * ms[1]) / 100, def: (rated * ms[2]) / 100 }
    const hp = Math.round(peer ? (this.me.hpMax * peer) / spots.length : setup.tier ? (normal * ms[0]) / 100 / spots.length : def.hp * lv.hp)
    const moves = setup.tier && def.arena ? def.arena : def
    const dmgMul = this.rated ? (mean(this.combo.map((c) => c.dmg)) * (normal / PLAYER.hp)) / mean(moves.attacks.map((a) => a.dmg)) : lv.dmg
    // os poderes entram DEPOIS da conta do dano (não mudam a força dos golpes de sempre)
    const attacks = setup.tier && MOB_SKILL_KINDS.includes(setup.kind) ? [...moves.attacks, ...MOB_SKILLS] : moves.attacks
    spots.forEach((p, i) =>
      this.mobs.push({
        id: i + 1,
        kind: setup.kind,
        x: p.x,
        z: p.z,
        y: 0,
        facing: Math.PI,
        hp,
        hpMax: hp,
        state: "spawn",
        t: -0.35 * i,
        attacks,
        engage: moves.engage,
        atk: 0,
        windup: 0,
        aimX: 0,
        aimZ: 0,
        struck: false,
        hits: 0,
        restLeft: 0.6 + 0.5 * i,
        side: i % 2 ? 1 : -1,
        dmgMul,
        armorUntil: 0,
        poise: this.rated ? def.poise : def.poise + lv.poise,
        rate: { ...foe },
        landed: false,
        maxLeft: 6 + 3 * i,
        leapV: 0,
        flowLeft: 0,
        ramming: false,
        skillCd: {},
        shieldUntil: 0,
      }),
    )
  }

  /** Inimigo vivo mais perto (alvo da câmera e do golpe). */
  target()             {
    let best             = null
    let bd = Infinity
    for (const m of this.mobs) {
      if (m.state === "dead") continue
      const d = Math.hypot(m.x - this.me.x, m.z - this.me.z)
      if (d < bd) {
        bd = d
        best = m
      }
    }
    return best
  }

  step(inp       ) {
    this.events = []
    this.time += DT
    const attackPressed = inp.attack && !this.prevAttack
    const dodgePressed = inp.dodge && !this.prevDodge
    this.prevAttack = inp.attack
    this.prevDodge = inp.dodge
    const powerPressed = !!inp.power && !this.prevPower
    this.prevPower = !!inp.power
    const skillPressed                 =
      inp.slash && !this.prevSkill.slash ? "slash" : inp.dash && !this.prevSkill.dash ? "dash" : inp.shield && !this.prevSkill.shield ? "shield" : null
    this.prevSkill = { slash: !!inp.slash, dash: !!inp.dash, shield: !!inp.shield }
    if (this.over) {
      this.stepPlayerIdle()
      return
    }
    const cd = this.me.cd
    cd.slash = Math.max(0, cd.slash - DT)
    cd.dash = Math.max(0, cd.dash - DT)
    cd.shield = Math.max(0, cd.shield - DT)
    cd.ult = Math.max(0, cd.ult - DT)
    if (this.me.shieldUntil > 0 && this.time >= this.me.shieldUntil) {
      this.me.shieldUntil = 0
      this.events.push({ t: "shieldEnd" })
    }
    if (inp.quit) return this.quit("me")
    this.stepCoward()
    if (this.over) return
    this.stepPower(powerPressed)
    if (skillPressed) this.startSkill(skillPressed, inp)
    this.stepPlayer(inp, attackPressed, dodgePressed)
    this.stepShots()
    this.stepWaves()
    this.pickToken()
    for (const m of this.mobs) this.stepMob(m)
    this.separate()
    if (this.me.hp <= 0 && !this.over) {
      this.over = { win: false, at: this.time }
      this.events.push({ t: "end", win: false })
    } else if (this.mobs.every((m) => m.state === "dead") && !this.over) {
      this.over = { win: true, at: this.time }
      this.me.state = "win"
      this.me.t = 0
      this.events.push({ t: "end", win: true })
    }
  }

  /** Atributos da vida que chegam depois de a luta abrir (o pedido ao servidor é em paralelo). */
  /** Os bônus do equipamento por cima do que os atributos dão. */
          withGear(fx                                ) {
    const g = this.gear
    // nas lutas por status o golpe acompanha a vida do nível; quem pesa é ataque contra defesa
    return { ...fx, dmg: this.rated ? this.hero.hp / PLAYER.hp : fx.dmg * (1 + g.dmg) * this.hero.dmg, warn: fx.warn * (1 + g.warn), stamK: fx.stamK * (1 - g.stam) }
  }

  setStats(stats                ) {
    this.fx = this.withGear(statEffects(heroStats({ ...BASE_STATS, ...stats }, this.heroLevel)))
    this.me.rate = this.fx.rate
  }

  /** mm3d-72: desistir (botão, ou o covarde sozinho) = derrota. */
          quit(who                 ) {
    if (this.over) return
    this.over = { win: false, at: this.time, quit: who }
    this.events.push({ t: "end", win: false, quit: who })
  }

  /** Covarde: uma vez por segundo, com a vida baixa, sorteia se desiste (avisa antes). */
          stepCoward() {
    if (this.temper !== "covarde") return
    if (this.fleeAt) {
      if (this.time >= this.fleeAt) this.quit("coward")
      return
    }
    const sec = Math.floor(this.time)
    if (sec === this.lastSecond) return
    this.lastSecond = sec
    if (this.me.hp >= SOUL_FIGHT.cowardHp * this.me.hpMax || this.me.state === "down") return
    const chance = SOUL_FIGHT.cowardPerS / (1 + this.affection / SOUL_FIGHT.cowardAffHalf)
    if (this.R() >= chance) return
    this.fleeAt = this.time + SOUL_FIGHT.cowardWarn
    this.events.push({ t: "fleeWarn" })
  }

  /** Psicopata: este Poder Máximo sai 3 vezes? */
          psychoRoll() {
    if (this.temper !== "psicopata") return false
    const k = SOUL_FIGHT.psychoRatio
    const strong = this.mobs.some((m) => m.state !== "dead" && (m.rate.atk >= k * this.rate.atk || m.rate.def >= k * this.rate.def))
    const chance = strong ? SOUL_FIGHT.psychoStrong : Math.min(SOUL_FIGHT.psychoAffMax, this.affection * SOUL_FIGHT.psychoPerAff)
    return chance > 0 && this.R() < chance
  }

  /** Duração do Poder Máximo (o triplo do psicopata dura mais). */
  powerDur() {
    return POWER.dur + (this.psychoTriple ? SOUL_FIGHT.psychoExtra[SOUL_FIGHT.psychoExtra.length - 1] : 0)
  }

  /** Poder: começa com a barra cheia (parado ou golpeando); dispara em fireAt. */
          stepPower(pressed         ) {
    const p = this.me
    if (pressed && (p.power < POWER.max || p.cd.ult > 0)) this.events.push({ t: "denied", id: "ult" })
    else if (pressed && (p.state === "idle" || p.state === "attack")) {
      p.power = 0
      this.psychoTriple = this.psychoRoll()
      // a recarga começa quando o poder termina
      p.cd.ult = SKILLS.ult.cd + this.powerDur()
      p.vx = 0
      p.vz = 0
      this.faceNearest()
      this.setPlayer("power")
      this.events.push({ t: "power", x: p.x, z: p.z, facing: p.facing })
      if (this.psychoTriple) this.events.push({ t: "psycho" })
      return
    }
    if (p.state !== "power") return
    // stepPlayer avança o relógio; aqui só o disparo (uma vez, no quadro que cruza cada instante)
    const t = p.t + DT
    if (p.t < POWER.fireAt && t >= POWER.fireAt) this.firePower(1)
    if (this.psychoTriple)
      SOUL_FIGHT.psychoExtra.forEach((d, i) => {
        const at = POWER.fireAt + d
        if (p.t < at && t >= at) this.firePower(i + 2)
      })
  }

          faceNearest() {
    const p = this.me
    let best = Infinity
    for (const m of this.mobs) {
      if (m.state === "dead" || m.state === "spawn") continue
      const d = Math.hypot(m.x - p.x, m.z - p.z)
      if (d < best) {
        best = d
        p.facing = Math.atan2(m.x - p.x, m.z - p.z)
      }
    }
  }

  /** Toque numa habilidade: recarga, estado permitido e o começo de cada uma. */
          startSkill(id         , inp       ) {
    const p = this.me
    if (p.cd[id] > 0) {
      this.events.push({ t: "denied", id })
      return
    }
    // escudo: a qualquer hora em pé (também levando pancada); as outras: parado ou na volta do golpe
    const free = p.state === "idle" || (p.state === "attack" && p.struck)
    if (id === "shield" ? p.state === "down" || p.state === "win" || p.state === "power" : !free) return
    p.cd[id] = SKILLS[id].cd
    if (id === "shield") {
      p.shieldUntil = this.time + SKILLS.shield.dur
      this.events.push({ t: "skill", id, x: p.x, z: p.z, facing: p.facing })
      return
    }
    if (id === "dash") {
      let dx = inp.mx
      let dz = inp.mz
      if (Math.hypot(dx, dz) < 0.2) {
        this.faceNearest()
        dx = Math.sin(p.facing)
        dz = Math.cos(p.facing)
      }
      const l = Math.hypot(dx, dz) || 1
      p.dodgeX = dx / l
      p.dodgeZ = dz / l
      p.facing = Math.atan2(p.dodgeX, p.dodgeZ)
      p.dashHit = []
    } else this.faceNearest()
    p.vx = 0
    p.vz = 0
    p.struck = false
    p.queued = false
    this.setPlayer("skill")
    p.skill = id
    this.events.push({ t: "skill", id, x: p.x, z: p.z, facing: p.facing })
  }

          stepWaves() {
    const S = SKILLS.slash
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i]
      const step = S.speed * DT
      w.x += w.dx * step
      w.z += w.dz * step
      w.left -= step
      for (const m of this.mobs) {
        if (m.state === "dead" || m.state === "spawn" || m.y > 1.6 || w.hit.includes(m.id)) continue
        if (Math.hypot(m.x - w.x, m.z - w.z) > S.width / 2 + MOBS[m.kind].radius) continue
        w.hit.push(m.id)
        this.damageMob(m, w.dmg, true, w.dx, w.dz, 3, "skill")
      }
      if (w.left > 0 && Math.hypot(w.x, w.z) <= ARENA_R + 0.5) continue
      this.waves.splice(i, 1)
      this.events.push({ t: "waveEnd", id: w.id, x: w.x, z: w.z })
    }
  }

          firePower(n = 1) {
    const p = this.me
    const mage = this.combo === MAGE_COMBO
    let healed = 0
    for (const m of this.mobs) {
      if (m.state === "dead" || m.state === "spawn") continue
      const dx = m.x - p.x
      const dz = m.z - p.z
      const d = Math.hypot(dx, dz) - MOBS[m.kind].radius
      if (mage) {
        if (d > POWER.mageR) continue
        this.damageMob(m, Math.round(POWER.mageDmg * this.fx.dmg), true, dx, dz, 3, "ult")
      } else {
        if (d > POWER.bladeRange || Math.abs(angDiff(Math.atan2(dx, dz), p.facing)) > POWER.bladeArc / 2) continue
        this.damageMob(m, Math.round(POWER.bladeDmg * this.fx.dmg), true, dx, dz, 3, "ult")
        healed = POWER.heal
      }
    }
    // a cura do poder cresce junto com a vida máxima
    if (healed) p.hp = Math.min(p.hpMax, p.hp + Math.round((healed * p.hpMax) / PLAYER.hp))
    this.events.push({ t: "powerFire", x: p.x, z: p.z, facing: p.facing, heal: healed, n })
  }

          stepPlayerIdle() {
    const p = this.me
    p.t += DT
    p.vx *= 0.8
    p.vz *= 0.8
  }

          setPlayer(s             ) {
    this.me.state = s
    this.me.t = 0
  }

          stepPlayer(inp       , attackPressed         , dodgePressed         ) {
    const p = this.me
    p.t += DT
    const mag = Math.min(1, Math.hypot(inp.mx, inp.mz))
    const tgt = this.target()
    const faceTarget = () => {
      if (tgt) p.facing = Math.atan2(tgt.x - p.x, tgt.z - p.z)
      else if (mag > 0.1) p.facing = Math.atan2(inp.mx, inp.mz)
    }
    if (p.state !== "dodge" && p.state !== "hurt" && p.state !== "down") p.stam = Math.min(PLAYER.stam, p.stam + PLAYER.stamRegen * DT * (p.state === "attack" ? 0.3 : 1))

    // Esquiva: corta o golpe (antes do corte) e a recuperação de qualquer golpe.
    const dodgeStam = DODGE.stam * this.fx.stamK
    const atkStam = PLAYER.attackStam * this.fx.stamK
    if (dodgePressed && p.stam >= dodgeStam && (p.state === "idle" || (p.state === "attack" && (!p.struck || p.t > this.combo[p.combo].hitAt / p.rate + 0.08)))) {
      p.stam -= dodgeStam
      let dx = inp.mx
      let dz = inp.mz
      if (mag < 0.2) {
        // Sem direção: para trás, longe do alvo.
        dx = -Math.sin(p.facing)
        dz = -Math.cos(p.facing)
      }
      const l = Math.hypot(dx, dz) || 1
      p.dodgeX = dx / l
      p.dodgeZ = dz / l
      this.setPlayer("dodge")
      this.events.push({ t: "dodge" })
    }

    switch (p.state) {
      case "idle": {
        if (attackPressed && p.stam >= atkStam) {
          this.startSwing(0)
          faceTarget()
          break
        }
        const sp = (inp.run ? PLAYER.run : PLAYER.walk) * this.fx.move
        p.vx = inp.mx * sp
        p.vz = inp.mz * sp
        if (tgt && Math.hypot(tgt.x - p.x, tgt.z - p.z) < 9) faceTargetSmooth(p, tgt)
        else if (mag > 0.1) p.facing = turnTo(p.facing, Math.atan2(inp.mx, inp.mz), 12 * DT)
        break
      }
      case "attack": {
        const sw = this.combo[p.combo]
        const hitAt = (sw.hitAt * RANK.durK[p.rank]) / p.rate
        // Destreza encurta só a volta da arma (depois do corte), nunca o golpe.
        const dur = hitAt + ((sw.dur * RANK.durK[p.rank]) / p.rate - hitAt) * this.fx.recoverK
        if (attackPressed && p.chain < MAX_CHAIN - 1) p.queued = true
        // Avança até o corte, depois para.
        const lunge = p.t < hitAt ? sw.lunge : 0
        p.vx = Math.sin(p.facing) * lunge
        p.vz = Math.cos(p.facing) * lunge
        if (!p.struck && p.t >= hitAt) {
          p.struck = true
          this.playerStrike(sw)
        }
        if (p.struck && p.queued && p.t >= hitAt + CHAIN_AFTER && p.stam >= atkStam) {
          this.startSwing(p.chain + 1)
          faceTarget()
        } else if (p.t >= dur) this.setPlayer("idle")
        break
      }
      case "dodge": {
        const k = 1 - Math.max(0, p.t - DODGE.dur * 0.6) / (DODGE.dur * 0.4)
        p.vx = p.dodgeX * DODGE.speed * k
        p.vz = p.dodgeZ * DODGE.speed * k
        if (p.t >= DODGE.dur) this.setPlayer("idle")
        break
      }
      case "hurt":
      case "down": {
        p.vx *= 0.85
        p.vz *= 0.85
        const limit = p.state === "down" ? PLAYER.heavyHurt : PLAYER.hurt
        if (p.t >= limit) this.setPlayer("idle")
        break
      }
      case "win":
        p.vx = 0
        p.vz = 0
        break
      case "power":
        p.vx = 0
        p.vz = 0
        if (p.t >= this.powerDur()) {
          this.psychoTriple = false
          this.setPlayer("idle")
        }
        break
      case "skill":
        if (p.skill === "slash") {
          p.vx = 0
          p.vz = 0
          if (!p.struck && p.t >= SKILLS.slash.fireAt) {
            p.struck = true
            this.castWave()
          }
          if (p.t >= SKILLS.slash.dur) this.endSkill()
        } else {
          const D = SKILLS.dash
          const sp = D.dist / D.dur
          p.vx = p.dodgeX * sp
          p.vz = p.dodgeZ * sp
          for (const m of this.mobs) {
            if (m.state === "dead" || m.state === "spawn" || m.y > 1.6 || p.dashHit.includes(m.id)) continue
            const dx = m.x - p.x
            const dz = m.z - p.z
            if (Math.hypot(dx, dz) > MOBS[m.kind].radius + PLAYER_R + D.width) continue
            p.dashHit.push(m.id)
            this.damageMob(m, Math.round(D.dmg * this.fx.dmg), false, dx, dz, 3, "skill")
          }
          if (p.t >= D.dur) {
            p.vx *= 0.25
            p.vz *= 0.25
            this.endSkill()
          }
        }
        break
    }
    p.x += p.vx * DT
    p.z += p.vz * DT
    const r = Math.hypot(p.x, p.z)
    const max = ARENA_R - PLAYER_R
    if (r > max) {
      p.x *= max / r
      p.z *= max / r
    }
  }

          endSkill() {
    this.me.skill = null
    this.setPlayer("idle")
  }

  /** Corte Mágico: a lâmina de luz sai à frente de quem joga. */
          castWave() {
    const p = this.me
    const S = SKILLS.slash
    const w       = { id: ++this.waveSeq, x: p.x + Math.sin(p.facing) * 0.8, z: p.z + Math.cos(p.facing) * 0.8, dx: Math.sin(p.facing), dz: Math.cos(p.facing), left: S.range, dmg: Math.round(S.dmg * this.fx.dmg), hit: [] }
    this.waves.push(w)
    this.events.push({ t: "wave", id: w.id })
  }

  /** Golpe novo: o ranque é sorteado (inteligência puxa para os fortes). `chain` = quantos já seguidos. */
          startSwing(chain        ) {
    const p = this.me
    p.stam -= PLAYER.attackStam * this.fx.stamK
    const odds = rankOdds(this.fx.intelligence, this.fx.dexterity)
    let roll = this.R()
    let rank = 0        
    for (let i = 0; i < odds.length; i++) {
      roll -= odds[i]
      if (roll <= 0) {
        rank = i        
        break
      }
    }
    if (this.forceRank !== null) rank = this.forceRank
    p.rank = rank
    p.chain = chain
    p.combo = RANK.slot[rank]
    p.struck = false
    p.queued = false
    this.setPlayer("attack")
    this.events.push({ t: "swing", combo: p.combo, rank })
  }

  /** Maga: a bola de fogo sai do cajado, mirando o inimigo mais perto dentro do cone. */
          castShot(sw       ) {
    const p = this.me
    let dir = p.facing
    let best = Infinity
    for (const m of this.mobs) {
      if (m.state === "dead" || m.state === "spawn") continue
      const a = Math.atan2(m.x - p.x, m.z - p.z)
      const d = Math.hypot(m.x - p.x, m.z - p.z)
      if (d <= sw.range && Math.abs(angDiff(a, p.facing)) <= sw.arc / 2 + 0.2 && d < best) {
        best = d
        dir = a
      }
    }
    const heavy = p.rank >= 2
    const shot       = { id: ++this.shotSeq, x: p.x + Math.sin(dir) * 0.6, y: SHOT.y, z: p.z + Math.cos(dir) * 0.6, dx: Math.sin(dir), dz: Math.cos(dir), left: sw.range, dmg: Math.round(sw.dmg * this.fx.dmg * RANK.dmg[p.rank]), heavy, rank: p.rank }
    this.shots.push(shot)
    this.events.push({ t: "cast", id: shot.id, heavy, rank: p.rank })
  }

          stepShots() {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]
      const step = SHOT.speed * DT
      s.x += s.dx * step
      s.z += s.dz * step
      s.left -= step
      let hit             = null
      for (const m of this.mobs) {
        if (m.state === "dead" || m.state === "spawn" || m.y > 1.6) continue
        if (Math.hypot(m.x - s.x, m.z - s.z) <= MOBS[m.kind].radius + SHOT.radius) {
          hit = m
          break
        }
      }
      const wall = Math.hypot(s.x, s.z) > ARENA_R + 1
      if (!hit && s.left > 0 && !wall) continue
      this.shots.splice(i, 1)
      this.events.push({ t: "boom", id: s.id, x: s.x, y: s.y, z: s.z, heavy: s.heavy, rank: s.rank })
      if (!hit) continue
      // a grande explode em área; a pequena só no alvo
      for (const m of this.mobs) {
        if (m.state === "dead" || m.state === "spawn" || m.y > 1.6) continue
        const d = Math.hypot(m.x - s.x, m.z - s.z)
        const blast = s.rank === 3 ? SHOT.blast * 1.6 : SHOT.blast
        if (m === hit || (s.heavy && d <= blast + MOBS[m.kind].radius)) this.damageMob(m, s.dmg, s.heavy, m.x - s.x + s.dx * 0.3, m.z - s.z + s.dz * 0.3, s.rank)
      }
    }
  }

  /** O corte do jogador: todo inimigo vivo no cone à frente. */
          playerStrike(sw       ) {
    if (this.combo === MAGE_COMBO) return this.castShot(sw)
    const p = this.me
    let any = false
    for (const m of this.mobs) {
      if (m.state === "dead" || m.state === "spawn") continue
      // Harpia alta só leva quando desce.
      if (m.y > 1.6) continue
      const dx = m.x - p.x
      const dz = m.z - p.z
      const d = Math.hypot(dx, dz) - MOBS[m.kind].radius
      if (d > sw.range) continue
      if (Math.abs(angDiff(Math.atan2(dx, dz), p.facing)) > sw.arc / 2 + 0.25) continue
      any = true
      const heavy = p.rank >= 2
      this.damageMob(m, Math.round(sw.dmg * this.fx.dmg * RANK.dmg[p.rank]), heavy, dx, dz, p.rank)
    }
    if (!any) this.events.push({ t: "whiff", id: 0 })
  }

  /** Dano num inimigo (corte ou bola de fogo); (dx, dz) = de onde veio, para o empurrão. */
          damageMob(m     , base        , heavy         , dx        , dz        , rank       = 3, src                  ) {
    if (this.rated && src !== "ult") {
      const chance = hitChance(this.rate.acc, m.rate.spd)
      const miss = (chance < 0.5 && this.meLanded.has(m.id)) || this.R() >= chance
      if (miss) {
        this.meLanded.delete(m.id)
        this.events.push({ t: "miss", on: "mob", x: m.x, y: m.y, z: m.z, auto: true })
        return
      }
      this.meLanded.add(m.id)
    }
    // Pancada na brecha (logo depois do golpe dele) dói mais.
    const opening = m.state === "recover" ? 1.25 : 1
    // mm3d-72: escudo do monstro corta o dano
    const guard = m.shieldUntil > this.time ? 1 - MOB_SHIELD.cut : 1
    const dmg = Math.max(1, Math.round(base * opening * guard * (this.rated ? damageRatio(this.rate.atk, m.rate.def) : 1)))
    m.hp = Math.max(0, m.hp - dmg)
    const dead = m.hp <= 0
    this.events.push({ t: "hit", on: "mob", id: m.id, dmg, x: m.x, y: m.y, z: m.z, heavy, dead, rank, src })
    if (this.me.state !== "power") this.me.power = Math.min(POWER.max, this.me.power + (heavy ? POWER.perHeavy : POWER.perHit) * (1 + this.gear.power))
    if (dead) {
      m.state = "dead"
      m.t = 0
      return
    }
    m.hits++
    const def = MOBS[m.kind]
    // Cambaleia: sem postura, ou quando a postura quebra, ou no golpe forte — mas nunca no meio do golpe dele (só pancada).
    if (m.state !== "strike" && this.time >= m.armorUntil && (m.poise === 0 || m.hits >= m.poise || (heavy && m.poise <= 2))) {
      m.hits = 0
      m.armorUntil = this.time + 1.8
      m.state = "hurt"
      m.t = 0
      m.y = 0
      this.events.push({ t: "stagger", id: m.id })
    }
    // Empurrão.
    const l = Math.hypot(dx, dz) || 1
    const push = heavy ? 0.9 : 0.35
    m.x += (dx / l) * push * (m.poise ? 0.5 : 1)
    m.z += (dz / l) * push * (m.poise ? 0.5 : 1)
  }

  /** Bando: só um lobo ataca por vez; os outros rodeiam. */
          pickToken() {
    if (this.kind !== "wolf") return
    const cur = this.mobs.find((m) => m.id === this.token)
    if (cur && cur.state !== "dead" && cur.state !== "circle" && cur.state !== "chase") return
    if (cur && (cur.state === "chase" || cur.state === "circle") && cur.restLeft > 0) return
    const alive = this.mobs.filter((m) => m.state !== "dead" && m.state !== "spawn")
    if (!alive.length) return
    alive.sort((a, b) => Math.hypot(a.x - this.me.x, a.z - this.me.z) - Math.hypot(b.x - this.me.x, b.z - this.me.z))
    this.token = alive[0].id
  }

          setMob(m     , s          ) {
    m.state = s
    m.t = 0
  }

          stepMob(m     ) {
    const def = MOBS[m.kind]
    const p = this.me
    m.t += DT
    const dx = p.x - m.x
    const dz = p.z - m.z
    const dist = Math.hypot(dx, dz)
    const toMe = Math.atan2(dx, dz)
    const speed = def.speed
    m.maxLeft -= DT
    for (const k in m.skillCd) m.skillCd[k] -= DT
    switch (m.state) {
      case "spawn":
        if (m.t >= 0.9) this.setMob(m, def.flies ? "fly" : "chase")
        return
      case "dead":
        m.y = Math.max(0, m.y - 6 * DT)
        return
      case "hurt":
        if (m.t >= 0.5) this.setMob(m, def.flies ? "fly" : "chase")
        return
      case "fly":
      case "chase":
      case "circle": {
        m.restLeft -= DT
        if (def.flies) m.y += (2.6 - m.y) * Math.min(1, 3 * DT)
        const myTurn = this.kind !== "wolf" || this.token === m.id
        // Escolhe golpe quando descansou e está no alcance de algum.
        if (myTurn && m.restLeft <= 0 && p.state !== "down") {
          const opts = m.attacks
            .map((a, i) => ({ a, i }))
            .filter(
              ({ a }) =>
                dist >= a.minD &&
                dist <= a.maxD &&
                (!a.max || m.maxLeft <= 0) &&
                (!a.cd || (m.skillCd[a.id] ?? 0) <= 0) &&
                (a.skill !== "shield" || (m.hp < MOB_SHIELD.below * m.hpMax && m.shieldUntil <= this.time)),
            )
          if (opts.length) {
            let sum = opts.reduce((s, o) => s + o.a.weight, 0) * this.R()
            let pick = opts[0]
            for (const o of opts) {
              sum -= o.a.weight
              if (sum <= 0) {
                pick = o
                break
              }
            }
            m.atk = pick.i
            if (pick.a.max) m.maxLeft = pick.a.max
            if (pick.a.cd) m.skillCd[pick.a.id] = pick.a.cd
            m.windup = pick.a.windup * this.fx.warn
            m.struck = false
            m.facing = toMe
            this.setMob(m, "windup")
            this.events.push({ t: "warn", id: m.id, attack: pick.a.id })
            return
          }
        }
        // Anda: chega na distância de luta; quem não tem a vez rodeia.
        let vx = 0
        let vz = 0
        const want = myTurn ? m.engage : m.engage + 1.6
        if (dist > want + 0.3) {
          vx = (dx / dist) * speed
          vz = (dz / dist) * speed
        } else if (dist < want - 0.6) {
          vx = (-dx / dist) * speed * 0.6
          vz = (-dz / dist) * speed * 0.6
        }
        if (!myTurn || dist <= want + 0.3) {
          // De lado, em volta do jogador.
          vx += (dz / Math.max(dist, 0.1)) * m.side * speed * 0.45
          vz += (-dx / Math.max(dist, 0.1)) * m.side * speed * 0.45
        }
        m.x += vx * DT
        m.z += vz * DT
        m.facing = turnTo(m.facing, toMe, 6 * DT)
        if (this.R() < 0.004) m.side = -m.side
        return
      }
      case "windup": {
        const a = m.attacks[m.atk]
        // Durante o aviso acompanha o jogador devagar (o golpe de área marca o ponto no fim).
        m.facing = turnTo(m.facing, toMe, (a.area ? 2.5 : 1.6) * DT)
        if (a.id === "dive" && def.flies) m.y += (3.4 - m.y) * Math.min(1, 4 * DT)
        if (m.t >= m.windup) {
          const reach = a.reach ?? 0
          m.aimX = m.x + Math.sin(m.facing) * reach
          m.aimZ = m.z + Math.cos(m.facing) * reach
          if (a.leap) {
            // o salto vai até a distância de luta, em linha com a mira do fim do aviso
            m.leapV = Math.max(0, dist - def.radius - PLAYER_R - 0.5) / a.active
          }
          m.flowLeft = 0
          m.ramming = false
          this.setMob(m, "strike")
          this.events.push({ t: "strike", id: m.id, attack: a.id })
          if (a.skill === "shield") {
            // o escudo não bate: liga e pronto
            m.struck = true
            m.shieldUntil = this.time + MOB_SHIELD.dur
            this.events.push({ t: "mobShield", id: m.id, until: m.shieldUntil })
          }
        }
        return
      }
      case "strike": {
        const a = m.attacks[m.atk]
        const v = a.leap ? m.leapV : a.lunge
        // o raio contínuo segue quem joga devagar: dá para sair da linha andando
        if (a.flow) m.facing = turnTo(m.facing, toMe, 0.8 * DT)
        m.x += Math.sin(m.facing) * v * DT
        m.z += Math.cos(m.facing) * v * DT
        if (m.ramming) {
          p.x += Math.sin(m.facing) * v * DT
          p.z += Math.cos(m.facing) * v * DT
          const r = Math.hypot(p.x, p.z)
          const edge = ARENA_R - PLAYER_R
          if (r > edge) {
            p.x *= edge / r
            p.z *= edge / r
          }
        }
        if (a.flow) {
          m.flowLeft -= DT
          if (m.flowLeft <= 0) {
            m.flowLeft = a.flow
            m.struck = false
            this.mobHit(m, a)
          }
        } else if (!m.struck && (!a.leap || m.t >= a.active * 0.75)) this.mobHit(m, a)
        if (m.t >= a.active) {
          this.setMob(m, "recover")
          if (!m.struck) this.events.push({ t: "evade", id: m.id })
        }
        return
      }
      case "recover": {
        const a = m.attacks[m.atk]
        if (def.flies) m.y = Math.max(0, m.y - 4 * DT)
        if (m.t >= a.recover) {
          m.restLeft = def.rest[0] + (def.rest[1] - def.rest[0]) * this.R()
          this.setMob(m, def.flies ? "fly" : "chase")
          if (this.kind === "wolf") this.token = -1
        }
        return
      }
    }
  }

  /**
   * mm3d-72 (Alex: "se ele tem muito speed, quando esquivar sozinho, fazer ele realmente esquivar
   * como se tivesse apertado"): a esquiva pela velocidade vira a esquiva do botão — de lado, para
   * longe do golpe —, sem gastar fôlego e sem sorteio (o lado sai da posição).
   */
          autoDodge(m     ) {
    const p = this.me
    const free = p.state === "idle" || (p.state === "attack" && (!p.struck || p.t > this.combo[p.combo].hitAt / p.rate + 0.08))
    if (!free) return
    const dx = p.x - m.x
    const dz = p.z - m.z
    const l = Math.hypot(dx, dz) || 1
    // perpendicular ao golpe, do lado em que já estou em relação à frente dele
    const side = Math.sin(m.facing) * dz - Math.cos(m.facing) * dx >= 0 ? 1 : -1
    let ex = (-dz / l) * side + (dx / l) * 0.35
    let ez = (dx / l) * side + (dz / l) * 0.35
    const el = Math.hypot(ex, ez) || 1
    ex /= el
    ez /= el
    p.dodgeX = ex
    p.dodgeZ = ez
    p.queued = false
    this.setPlayer("dodge")
    this.events.push({ t: "dodge" })
  }

  /** O golpe do inimigo acerta? (cone à frente ou área marcada; esquiva na hora certa passa). */
          mobHit(m     , a           ) {
    const p = this.me
    const dodging = p.state === "dodge" && p.t >= DODGE.iframeFrom && p.t <= DODGE.iframeTo
    if (dodging && !this.rated) return
    if (p.state === "down" || p.state === "power" || (p.state === "skill" && p.skill === "dash")) return
    let hit = false
    if (a.area) {
      // Área: só no primeiro quadro do ativo.
      if (m.t > DT * 1.5) return
      hit = Math.hypot(p.x - m.aimX, p.z - m.aimZ) <= a.area + PLAYER_R
      m.struck = true
    } else {
      const dx = p.x - m.x
      const dz = p.z - m.z
      const d = Math.hypot(dx, dz) - PLAYER_R
      if (a.line) {
        const along = dx * Math.sin(m.facing) + dz * Math.cos(m.facing)
        const off = Math.abs(dx * Math.cos(m.facing) - dz * Math.sin(m.facing))
        hit = along > 0 && d <= a.range && off <= a.line + PLAYER_R
      } else hit = d <= a.range && Math.abs(angDiff(Math.atan2(dx, dz), m.facing)) <= a.arc / 2 + 0.2
    }
    if (!hit) return
    m.struck = true
    if (this.rated) {
      const chance = hitChance(m.rate.acc, this.rate.spd)
      const evaded = (chance < 0.5 && m.landed) || this.R() < (dodging ? dodgeChance(m.rate.acc, this.rate.spd) : 1 - chance)
      m.landed = !evaded
      if (evaded) {
        this.events.push({ t: "miss", on: "me", x: p.x, y: 0, z: p.z, auto: !dodging })
        if (!dodging) this.autoDodge(m)
        return
      }
    }
    // Escudo de luz: corta o dano e segura de pé (sem queda nem pancada)
    const shield = p.shieldUntil > this.time
    const cut = this.rated ? damageRatio(m.rate.atk, this.rate.def) : 1 - this.def
    const dmg = Math.max(1, Math.round(a.dmg * m.dmgMul * cut * (shield ? 1 - SKILLS.shield.cut : 1)))
    p.hp = Math.max(0, p.hp - dmg)
    const heavy = !!a.heavy
    this.events.push({ t: "hit", on: "me", dmg, x: p.x, z: p.z, heavy, dead: p.hp <= 0, shield })
    // O raio contínuo queima sem derrubar: cada pancada só empurra um pouco.
    const l = Math.hypot(p.x - m.x, p.z - m.z) || 1
    if (a.flow && p.hp > 0) {
      p.x += ((p.x - m.x) / l) * 0.12
      p.z += ((p.z - m.z) / l) * 0.12
      return
    }
    if (a.ram && !shield) m.ramming = true
    // Empurrão para longe de quem bateu.
    if (shield && p.hp > 0) {
      p.x += ((p.x - m.x) / l) * 0.3
      p.z += ((p.z - m.z) / l) * 0.3
      return
    }
    const push = heavy ? 1.4 : 0.6
    p.x += ((p.x - m.x) / l) * push
    p.z += ((p.z - m.z) / l) * push
    p.queued = false
    this.setPlayer(p.hp <= 0 ? "down" : heavy ? "down" : "hurt")
  }

  /** Ninguém atravessa ninguém nem sai da arena. */
          separate() {
    const p = this.me
    for (const m of this.mobs) {
      if (m.state === "dead" || m.y > 1.2) continue
      const r = MOBS[m.kind].radius
      const dx = m.x - p.x
      const dz = m.z - p.z
      const d = Math.hypot(dx, dz)
      const min = r + PLAYER_R
      if (d < min && d > 1e-4) {
        const push = (min - d) / 2
        m.x += (dx / d) * push
        m.z += (dz / d) * push
        p.x -= (dx / d) * push
        p.z -= (dz / d) * push
      }
    }
    for (let i = 0; i < this.mobs.length; i++) {
      for (let j = i + 1; j < this.mobs.length; j++) {
        const a = this.mobs[i]
        const b = this.mobs[j]
        if (a.state === "dead" || b.state === "dead") continue
        const dx = b.x - a.x
        const dz = b.z - a.z
        const d = Math.hypot(dx, dz)
        const min = MOBS[a.kind].radius + MOBS[b.kind].radius
        if (d < min && d > 1e-4) {
          const push = (min - d) / 2
          a.x -= (dx / d) * push
          a.z -= (dz / d) * push
          b.x += (dx / d) * push
          b.z += (dz / d) * push
        }
      }
    }
    for (const m of this.mobs) {
      const r = Math.hypot(m.x, m.z)
      const max = ARENA_R - MOBS[m.kind].radius
      if (r > max) {
        m.x *= max / r
        m.z *= max / r
      }
    }
  }
}

function faceTargetSmooth(p            , m     ) {
  p.facing = turnTo(p.facing, Math.atan2(m.x - p.x, m.z - p.z), 10 * DT)
}

/** Golpe atual do inimigo (para desenhar o aviso). */
function mobAttack(m     )                   {
  if (m.state !== "windup" && m.state !== "strike") return null
  return m.attacks[m.atk] ?? null
}

// ── sim/replay.ts ────────────────────────────────────────────────────────────
// features/meu-mundo/laminas/sim/replay.ts — mm3d-59: a luta que o SERVIDOR confere.
//
// O aparelho joga com a semente do ticket e grava a entrada de cada passo
// (1/60 s) já QUANTIZADA — a luta do aparelho também passa pela quantização,
// então o servidor, re-simulando a mesma lista, chega ao mesmo resultado.
// Gravação em blocos [repetições, mx, mz, botões]; os botões são bits.
//
// O back roda este arquivo GERADO junto com fight.ts (scripts/build-fight-sim.js).

/** Bits dos botões. */
const BTN_RUN = 1
const BTN_ATTACK = 2
const BTN_DODGE = 4
const BTN_POWER = 8
/** 2026-11-03: as habilidades (Corte Mágico, Investida, Escudo). */
const BTN_SLASH = 16
const BTN_DASH = 32
const BTN_SHIELD = 64
/** mm3d-72: Desistir. */
const BTN_QUIT = 128
const BTN_ALL = 255

/** Um bloco: [quantos passos, mx (−127…127), mz (−127…127), botões]. */
                                                            

/** Passos no máximo numa luta conferida (6 min). */
const REPLAY_MAX_STEPS = 6 * 60 * 60
/** Sem nenhum toque por mais que isto, o tempo não conta como ativo (s). */
const REPLAY_IDLE_S = 3

const q127 = (v        ) => Math.max(-127, Math.min(127, Math.round((Number(v) || 0) * 127)))

/** A entrada como o servidor vai ver: direção em 1/127 e botões. */
function quantizeInput(inp       )        {
  const mx = q127(inp.mx) / 127
  const mz = q127(inp.mz) / 127
  return { mx, mz, run: !!inp.run, attack: !!inp.attack, dodge: !!inp.dodge, power: !!inp.power, slash: !!inp.slash, dash: !!inp.dash, shield: !!inp.shield, quit: !!inp.quit }
}

/** Grava um passo (já quantizado) no fim da lista. */
function pushFrame(frames             , inp       ) {
  const mx = q127(inp.mx)
  const mz = q127(inp.mz)
  const b =
    (inp.run ? BTN_RUN : 0) |
    (inp.attack ? BTN_ATTACK : 0) |
    (inp.dodge ? BTN_DODGE : 0) |
    (inp.power ? BTN_POWER : 0) |
    (inp.slash ? BTN_SLASH : 0) |
    (inp.dash ? BTN_DASH : 0) |
    (inp.shield ? BTN_SHIELD : 0) |
    (inp.quit ? BTN_QUIT : 0)
  const last = frames[frames.length - 1]
  if (last && last[1] === mx && last[2] === mz && last[3] === b && last[0] < 65535) last[0]++
  else frames.push([1, mx, mz, b])
}

                               
             
                                       
                                     
              
               
                                                                                       
                     
              
                   
                                                      
                   
 

/** Re-simula uma luta inteira. A luta tem que TERMINAR dentro da gravação. */
function replayFight(setup            , frames         )               {
  const fail = (reason                        )               => ({ ok: false, reason, win: false, steps: 0, activeSteps: 0, hits: 0, hitsTaken: 0, mobHpLeft: 1 })
  if (!Array.isArray(frames) || frames.length > 40000) return fail("frames")
  let total = 0
  for (const f of frames) {
    if (!Array.isArray(f) || f.length !== 4) return fail("frames")
    const [n, mx, mz, b] = f            
    if (!Number.isInteger(n) || n < 1 || n > 65535 || !Number.isInteger(mx) || !Number.isInteger(mz) || !Number.isInteger(b)) return fail("frames")
    if (Math.abs(mx) > 127 || Math.abs(mz) > 127 || b < 0 || b > BTN_ALL) return fail("frames")
    total += n
  }
  if (total > REPLAY_MAX_STEPS) return fail("long")
  const fight = new Fight(setup)
  const idleSteps = Math.round(REPLAY_IDLE_S / DT)
  let lastTouch = -Infinity
  let prev = -1
  let steps = 0
  let activeSteps = 0
  let hits = 0
  let hitsTaken = 0
  for (const [n, mx, mz, b] of frames              ) {
    const inp        = { mx: mx / 127, mz: mz / 127, run: !!(b & BTN_RUN), attack: !!(b & BTN_ATTACK), dodge: !!(b & BTN_DODGE), power: !!(b & BTN_POWER), slash: !!(b & BTN_SLASH), dash: !!(b & BTN_DASH), shield: !!(b & BTN_SHIELD), quit: !!(b & BTN_QUIT) }
    const sig = (mx & 0xff) | ((mz & 0xff) << 8) | (b << 16)
    for (let i = 0; i < n; i++) {
      if (fight.over) break
      // toque = mudou a entrada ou está segurando direção/botão
      if (sig !== prev || mx !== 0 || mz !== 0 || b !== 0) lastTouch = steps
      prev = sig
      fight.step(inp)
      for (const e of fight.events) {
        if (e.t === "hit" && e.on === "mob") hits++
        if (e.t === "hit" && e.on === "me") hitsTaken++
      }
      if (steps - lastTouch <= idleSteps) activeSteps++
      steps++
    }
    if (fight.over) break
  }
  if (!fight.over) return { ...fail("open"), steps, activeSteps }
  const hpMax = fight.mobs.reduce((a, m) => a + m.hpMax, 0) || 1
  const left = fight.mobs.reduce((a, m) => a + Math.max(0, m.hp), 0)
  return { ok: true, win: fight.over.win, steps, activeSteps, hits, hitsTaken, mobHpLeft: left / hpMax }
}

module.exports = { DT, ARENA_R, PLAYER_R, MOB_KINDS, LEGACY_MOB_KIND, mobKindOf, COMBO, MAGE_COMBO, SHOT, RANKS, RANK, rankOdds, POWER, SKILLS, MOB_SKILL_KINDS, MOB_SKILLS, MOB_SHIELD, SOUL_FIGHT, MOBS, mobLevelScale, HERO_LEVEL, DEF_MAX, heroLevelScale, heroStats, PEER_ELITE, peerOf, BASE_SHEET, BODY_SHEETS, MOB_SHEETS, mobBase, heroSheet, DODGE_MAX, hitChance, dodgeChance, damageRatio, rng, statEffects, Fight, mobAttack, REPLAY_MAX_STEPS, REPLAY_IDLE_S, quantizeInput, pushFrame, replayFight };
