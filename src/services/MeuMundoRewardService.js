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

  /**
   * E12: a PRIMEIRA vitória de uma tabela que tem `first` (mig 449). Marca e devolve true uma vez
   * por conta × tabela, dentro da transação do recibo (desfeita junto se o recibo não sair).
   */
  static async claimFirst(c, idUser, table, idFight = null) {
    const t = Items.LOOT_TABLES[table];
    if (!t || !(t.first || []).length) return false;
    const r = await c.query(
      `INSERT INTO tb_mm_loot_first (id_user, loot_table, id_fight) VALUES ($1, $2, $3) ON CONFLICT (id_user, loot_table) DO NOTHING RETURNING loot_table`,
      [idUser, table, idFight],
    );
    return r.rowCount > 0;
  }

  /** E12: tabela do setor do Domínio (`domain:<id>:<setor>`) ou null. */
  static domainTableOf(domain, sector) {
    return Items.domainTableId(domain, Number(sector));
  }

  /** Tabela da atividade (Adv.ACTIVITIES): luta = `fight:<atividade>`, minijogo = `minigame:<jogo>`. */
  static tableOf(activity) {
    return Items.ACTIVITY_TABLE[activity] || null;
  }
}

module.exports = MeuMundoRewardService;
