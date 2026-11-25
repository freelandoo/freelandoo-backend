// GERADO por scripts/build-power-sim.js a partir de
// freelandoo frontend/.../features/meu-mundo/power/*.ts — NÃO EDITAR AQUI.
// Mudou a regra do poder no front? Rode o script e commite os dois repos juntos.
/* eslint-disable */
"use strict";

// ── power/power.ts ───────────────────────────────────────────────────────────
// ═══ PODER DO PERSONAGEM (B7, decisão do Alex em 2026-11-08) ═══
//
//   poder = força + velocidade + destreza + inteligência + acurácia
//         + HP máx do nível de aventura
//         + equipamento (trilha E4, A13: o que ele soma DE VERDADE à ficha naquele nível)
//         + status da classe das peças (2026-11-17: classPower, o que o número + % somam à ficha da luta nova)
//
// Equipamento (A13, §6.3 do plano da trilha E), sem o peso do personagem:
//   g.dmg·base(L) + g.def·base(L) + g.hp·vida(L) + g.acc·(100 + força + 3(L−1))
//   + g.spd·(100 + velocidade + 3(L−1)) + g.int·inteligência + g.dex·destreza
//   + 1.000·(g.stam + g.warn + g.power)
// com base(L) = 100 + 900(L−1)/59 e vida(L) = heroLevelScale(L).hp. Até a E3 era 10 pontos por 1%.
//
// Soma simples, SÓ do permanente: os atributos como a vida guarda (sem suplemento, fome, sono
// ou efeito temporário; sem o bônus de nível que só vale na luta), o HP máx do nível
// (heroLevelScale: 100 + 9 por nível, sem o peso do personagem) e o equipamento equipado.
// Substitui a fórmula do T3 (HP×0,5 + ataque×3 + …, suplemento multiplicando), que estava errada.
//
// FONTE ÚNICA: o back roda a cópia GERADA (freelandoo-backend/src/utils/meuMundoPower.js,
// por scripts/build-power-sim.js) e grava o número em tb_mm_character.power a cada
// mudança da vida. Mudou aqui → rodar o script e commitar os dois repos (o unit confere).
//
// Sem import: o módulo é puro. O HP do nível (heroLevelScale de laminas/sim/fight.ts) entra
// por parâmetro, assim front e back usam a MESMA regra da luta sem copiar.
//
// Nome: "power" na luta é a barra do golpe máximo (POWER do fight.ts e a chave `power` do
// equipamento). Este número é o PODER do personagem — nunca misturar.

const POWER_ATTRS = ["strength", "speed", "dexterity", "intelligence", "accuracy"]         
                                                    

/** Pontos de poder por 1% das chaves de combate sem ficha (fôlego, aviso, barra): 1.000 por 1,0. */
const GEAR_FLAT = 1000

/** Frações de bônus do equipamento já com teto (meuMundoGear.gearBonus / GearBonus da luta). */
                                                                                                                                 

/** Parcelas do poder (para a tela): os 5 atributos, o HP do nível e o equipamento. */
                                                                  

/** O que o poder precisa da regra da luta (laminas/sim/fight.ts ou a cópia gerada no back). */
                                 
                                                                  
 

                             
                                                                          
                                           
                                           
               
                         
     
                                                                                                             
                                                                                            
     
                         
 
                                                                                 
                             
                                               
                                              
 

/**
 * Pontos de Poder do status da classe = o que ele soma à ficha da luta nova (personagem de peso 100):
 *   força, defesa e vida: (base + número) × (1 + %) − base, com base = 100 + nível (a régua da luta);
 *   acerto e esquiva: o mesmo sobre (100 + atributo + nível); fôlego: o número;
 *   % de dano: a fração da força final (multiplica o dano que passa, como mais força).
 */
function classPower(cls                               , base        , accBase        , spdBase        )         {
  if (!cls) return 0
  const f = (k               ) => num(cls.flat?.[k])
  const p = (k               ) => 1 + num(cls.pct?.[k]) / 100
  const up = (b        , k               ) => (b + f(k)) * p(k) - b
  const atk = (base + f("atk")) * p("atk")
  return up(base, "atk") + up(base, "def") + up(base, "hp") + up(accBase, "acc") + up(spdBase, "spd") + f("stam") + (p("dmg") - 1) * atk
}

const num = (v         ) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Poder com as parcelas (arredondadas). */
function powerScore(rule                , input            )                                       {
  const parts = {}              
  let total = 0
  for (const k of POWER_ATTRS) {
    const v = num(input.attrs?.[k])
    parts[k] = Math.round(v)
    total += v
  }
  const level = Math.max(1, Math.round(num(input.level) || 1))
  const hp = num(rule.heroLevelScale(level).hp)
  parts.hp = Math.round(hp)
  total += hp
  const gear = input.gear || {}
  const at = (k           ) => num(input.attrs?.[k])
  const lvAttr = num(rule.heroLevelScale(level).attr ?? 3 * (level - 1))
  const base = 100 + (900 * (level - 1)) / 59
  const g =
    num(gear.dmg) * base +
    num(gear.def) * base +
    num(gear.hp) * hp +
    num(gear.acc) * (100 + at("strength") + lvAttr) +
    num(gear.spd) * (100 + at("speed") + lvAttr) +
    num(gear.int) * at("intelligence") +
    num(gear.dex) * at("dexterity") +
    GEAR_FLAT * (num(gear.stam) + num(gear.warn) + num(gear.power)) +
    classPower(input.cls, base, 100 + at("strength") + lvAttr, 100 + at("speed") + lvAttr)
  parts.gear = Math.round(g)
  total += g
  return { total: Math.round(total), parts }
}

/** Só o número: o que o servidor grava. */
function powerOf(rule                , input            )         {
  return powerScore(rule, input).total
}

// ═══ FAIXA DE PODER DO NÍVEL E O "PODER TRANSBORDANDO" (Alex, 2026-11-18) ═══
//
// Quem passa do teto da faixa do nível está forte demais para ele (mata monstro de nível acima com
// facilidade) e anda soltando faísca: vermelha no Vampiro, verde na Raposa (o desenho é do cliente; a
// decisão é do servidor).
//
// Régua do Alex (2026-11-18): a MÉDIA do nível é o Poder de um MONSTRO daquele nível — a média dos 6
// tipos da rua, pela mesma conta do "Poder recomendado" dos Domínios (meuMundoDomains.mobPower: vida +
// ataque + defesa + acuracidade + velocidade da ficha no nível; o unit confere). Teto = 1,75 × a média.
//   nível 1: 667/1.167 · 10: 1.656/2.897 · 21: 2.864/5.013 · 30: 3.853/6.743
// (A primeira versão somava o melhor de tudo ao mesmo tempo e dava 10.186 no 21: ninguém acendia.)

/** Teto sobre a média (o Poder do monstro do nível). */
const BAND_MAX = 1.75

                                 
/** O que a faixa precisa da regra da luta: régua do nível e fichas dos monstros da rua. */
                                
                                                          
                              
                                      
 

/** Poder de um monstro do tipo `kind` no nível (= meuMundoDomains.mobPower). */
function mobPowerOf(rule               , kind        , level        )         {
  const ms = rule.MOB_SHEETS[kind]
  if (!ms) return 0
  const b = rule.mobBase(level)
  return (b.hp * ms[0] + b.rate * (ms[1] + ms[2] + ms[3] + ms[4])) / 100
}

/** Faixa de Poder do nível: { avg (Poder médio de um monstro do nível), max }. */
function powerBand(rule               , level        )                               {
  const L = Math.max(1, Math.round(num(level) || 1))
  let sum = 0
  for (const k of rule.MOB_KINDS) sum += mobPowerOf(rule, k, L)
  const avg = sum / Math.max(1, rule.MOB_KINDS.length)
  return { avg: Math.round(avg), max: Math.round(avg * BAND_MAX) }
}

/** Poder transbordando: o Poder passou do teto da faixa do nível. */
function isOverpowered(rule               , power        , level        )          {
  const p = Number(power)
  return Number.isFinite(p) && p > powerBand(rule, level).max
}

module.exports = { POWER_ATTRS, GEAR_FLAT, classPower, powerScore, powerOf, BAND_MAX, mobPowerOf, powerBand, isOverpowered };
