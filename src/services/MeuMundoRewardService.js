// src/services/MeuMundoRewardService.js — trilha E, fatia E3: PORTA ÚNICA do saque.
//
// Todo item que cai de uma atividade (luta, minijogo; depois monstro, Domínio, missão, baú) sai
// daqui: sorteia a TABELA nomeada (`Items.rollTable`, regra pura em mmItems/rules/loot.js) e
// entrega pela mochila (`MeuMundoGearService.deliver`: pilha com livro, equipamento como
// instância, excedente da pilha vira moedas). Quem chama já está dentro do `withLife` e grava o
// recibo com as linhas devolvidas — sem recibo, não entrega (regra do jogo).
"use strict";

const Items = require("../utils/mmItems");

const GearService = () => require("./MeuMundoGearService");

class MeuMundoRewardService {
  /**
   * Sorteia e entrega. `ctx` é o contexto do withLife (moedas do excedente); `roll` =
   * { win, activeMs, level, first }; `R` = sorteio do servidor (o teste injeta).
   * Devolve as linhas do recibo: [{ id, qty, rarity, overflowCoins }].
   */
  static async grant(c, idUser, { table, ctx, R, roll = {} }) {
    if (!Items.LOOT_TABLES[table]) throw new Error(`Tabela de saque desconhecida: ${table}`);
    const drops = Items.rollTable(table, roll, R || GearService().R);
    return drops.length ? GearService().deliver(c, idUser, drops, ctx) : [];
  }

  /** Tabela da atividade (Adv.ACTIVITIES): luta = `fight:<atividade>`, minijogo = `minigame:<jogo>`. */
  static tableOf(activity) {
    return Items.ACTIVITY_TABLE[activity] || null;
  }
}

module.exports = MeuMundoRewardService;
