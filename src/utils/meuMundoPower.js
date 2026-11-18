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
// Equipamento (A13, §6.3 do plano da trilha E), sem o peso da skin:
//   g.dmg·base(L) + g.def·base(L) + g.hp·vida(L) + g.acc·(100 + força + 3(L−1))
//   + g.spd·(100 + velocidade + 3(L−1)) + g.int·inteligência + g.dex·destreza
//   + 1.000·(g.stam + g.warn + g.power)
// com base(L) = 100 + 900(L−1)/59 e vida(L) = heroLevelScale(L).hp. Até a E3 era 10 pontos por 1%.
//
// Soma simples, SÓ do permanente: os atributos como a vida guarda (sem suplemento, fome, sono
// ou efeito temporário; sem o bônus de nível que só vale na luta), o HP máx do nível
// (heroLevelScale: 100 + 9 por nível, sem o peso da skin) e o equipamento equipado.
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
// Cada nível tem uma faixa de Poder: o que um personagem daquele nível consegue ter com os atributos
// que a régua deixa subir e com as peças da classe que ele consegue COMPRAR até ali. Quem passa do teto
// está forte demais para o nível (mata monstro de nível acima com facilidade) e anda soltando faísca:
// vermelha no Vampiro, verde na Raposa (o desenho é do cliente; a decisão é do servidor).
//
//   piso  = atributos em 1× a régua do nível (mobBase(L).rate) + HP do nível, sem equipamento
//   média = piso + o kit de 8 peças da classe que dá para comprar no nível (valor médio da classe)
//   teto  = atributos em 2,3× a régua (o fim do freio do drop, A14/I5) + equipamento antigo no teto
//           (GEAR_MAX) + o kit de 8 peças da classe comprável com a variação máxima (+10%)
//
// Classe comprável (SHOP_RANK_LEVEL): o primeiro nível em que as moedas juntadas só vencendo luta na rua
// (monstro no fator mais alto da régua, 1,6×; 20 moedas por nível do monstro; sem chefão) pagam UMA peça
// daquela classe (preço da loja em mmItems/rules/classStats.js). O unit do back refaz a conta com a
// economia real e falha se a tabela envelhecer. Kit (KIT_SPLIT/KIT_NUMBER/KIT_PERCENT) = espelho de
// classStats.js (o unit confere).

/** Primeiro nível de aventura em que cada classe cabe no bolso (E desde o começo: é o kit da loja). */
const SHOP_RANK_LEVEL = [
  ["E", 1], ["D", 6], ["C", 8], ["B", 11], ["A", 17], ["S", 30], ["SS", 55], ["SSR", 101], ["legendary", 187], ["divine", 346],
]         
                                                          

const KIT_NUMBER                           = { E: 5, D: 10, C: 20, B: 40, A: 80, S: 240, SS: 720, SSR: 2160, legendary: 6480, divine: 19440 }
const KIT_PERCENT                           = { E: 20, D: 25, C: 30, B: 35, A: 40, S: 45, SS: 50, SSR: 55, legendary: 60, divine: 110 }
/** As 8 peças do kit (arma de espada, escudo e as 6 de proteção/acessório): divisão do número (n) e da % (p). */
const KIT_SPLIT                                                                                                           = {
  sword: { n: { acc: 0.4, atk: 0.4, spd: 0.2 }, p: { dmg: 0.5, atk: 0.5 } },
  shield: { n: { hp: 0.4, def: 0.4, stam: 0.2 }, p: { def: 0.5, hp: 0.5 } },
  chest: { n: { hp: 0.5, def: 0.4, stam: 0.1 }, p: { hp: 0.5, def: 0.5 } },
  helm: { n: { acc: 0.4, hp: 0.3, def: 0.3 }, p: { acc: 0.5, hp: 0.5 } },
  gloves: { n: { acc: 0.4, atk: 0.4, spd: 0.2 }, p: { acc: 0.5, atk: 0.5 } },
  boots: { n: { spd: 0.5, stam: 0.3, hp: 0.2 }, p: { spd: 0.5, stam: 0.5 } },
  amulet: { n: { hp: 0.4, atk: 0.3, acc: 0.3 }, p: { hp: 0.5, dmg: 0.5 } },
  relic: { n: { hp: 0.4, def: 0.3, spd: 0.3 }, p: { dmg: 0.5, hp: 0.5 } },
}
/** Atributo no fim do freio do drop (o atributo vive entre 1× e ~2,3× a régua do nível). */
const ATTR_CEIL = 2.3
/** Variação máxima de uma peça sobre a média da classe (classStats.spreadOf: 0,9 a 1,1). */
const KIT_SPREAD_MAX = 1.1

/** O que a faixa precisa da regra da luta, além do HP do nível. */
                                                       
                                              
                     
 

/** Classe mais alta que dá para comprar no nível. */
function shopRankAt(level        )           {
  const L = Math.max(1, Math.round(num(level) || 1))
  let r           = "E"
  for (const [rank, at] of SHOP_RANK_LEVEL) if (L >= at) r = rank
  return r
}

/** Status da classe de um kit de 8 peças da classe `rank` (k = variação: 1 média, 1,1 o máximo). */
function kitOf(rank          , k = 1)             {
  const flat                                         = {}
  const pct                                         = {}
  const n = KIT_NUMBER[rank] * k
  const p = KIT_PERCENT[rank] * (1 + (k - 1) * 0.2)
  for (const piece of Object.values(KIT_SPLIT)) {
    for (const [s, w] of Object.entries(piece.n)                             ) flat[s] = (flat[s] || 0) + n * w
    for (const [s, w] of Object.entries(piece.p)                             ) pct[s] = (pct[s] || 0) + p * w
  }
  return { flat, pct }
}

/** Faixa de Poder do nível: { rank, min, avg, max }. */
function powerBand(rule               , level        )                                                            {
  const L = Math.max(1, Math.round(num(level) || 1))
  const r = num(rule.mobBase(L).rate)
  const attrs = (m        ) => Object.fromEntries(POWER_ATTRS.map((k) => [k, r * m]))                             
  const rank = shopRankAt(L)
  return {
    rank,
    min: powerOf(rule, { attrs: attrs(1), level: L }),
    avg: powerOf(rule, { attrs: attrs(1), level: L, cls: kitOf(rank) }),
    max: powerOf(rule, { attrs: attrs(ATTR_CEIL), level: L, gear: rule.GEAR_MAX, cls: kitOf(rank, KIT_SPREAD_MAX) }),
  }
}

/** Poder transbordando: o Poder passou do teto da faixa do nível. */
function isOverpowered(rule               , power        , level        )          {
  const p = Number(power)
  return Number.isFinite(p) && p > powerBand(rule, level).max
}

module.exports = { POWER_ATTRS, GEAR_FLAT, classPower, powerScore, powerOf, SHOP_RANK_LEVEL, KIT_NUMBER, KIT_PERCENT, KIT_SPLIT, ATTR_CEIL, KIT_SPREAD_MAX, shopRankAt, kitOf, powerBand, isOverpowered };
