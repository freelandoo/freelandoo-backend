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
    GEAR_FLAT * (num(gear.stam) + num(gear.warn) + num(gear.power))
  parts.gear = Math.round(g)
  total += g
  return { total: Math.round(total), parts }
}

/** Só o número: o que o servidor grava. */
function powerOf(rule                , input            )         {
  return powerScore(rule, input).total
}

module.exports = { POWER_ATTRS, GEAR_FLAT, powerScore, powerOf };
