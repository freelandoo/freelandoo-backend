// src/services/MeuMundoPowerService.js — MEU MUNDO 3D: o PODER do personagem.
//
// Fórmula do B7 (decisão do Alex, 2026-11-08): soma simples do permanente —
//   força + velocidade + destreza + inteligência + acurácia + HP máx do nível
//   + equipamento (1% de bônus = 10 pontos). Sem suplemento nem efeito temporário.
// A regra mora no front (features/meu-mundo/power/power.ts) e o back roda a cópia
// GERADA (src/utils/meuMundoPower.js). O HP do nível vem da cópia gerada da luta
// (meuMundoFight.heroLevelScale): a mesma conta do aparelho.
//
// Grava em tb_mm_character.power (mig 334) + power_at (mig 335) só quando muda.

const pool = require("../databases");
const Power = require("../utils/meuMundoPower");
const FightSim = require("../utils/meuMundoFight");
const Adv = require("../utils/meuMundoAdventure");
const MeuMundoStorage = require("../storages/MeuMundoStorage");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const { rowToState } = require("../storages/MeuMundoLifeStorage");
const { clanOfBody } = require("../utils/meuMundoClans");
const { createLogger } = require("../utils/logger");
const log = createLogger("meuMundo.power");

/** Require tardio: o serviço de equipamento usa o withLife (ciclo). */
const GearService = () => require("./MeuMundoGearService");

const attrsOf = (s) => ({
  strength: s.strength,
  speed: s.speed,
  dexterity: s.dexterity,
  intelligence: s.intelligence,
  accuracy: s.accuracy || 0,
});

class MeuMundoPowerService {
  /** Entradas do poder de quem é `idUser`, com o estado `s` da vida. */
  static async inputs(c, idUser, s) {
    const body = await MeuMundoStorage.getBody(c, idUser);
    const clan = clanOfBody(body) ?? (await MeuMundoStorage.getClan(c, idUser)).clan;
    const level = Adv.levelOf(Number((await AdvStore.getAdventure(c, idUser)).xp) || 0).level;
    const gear = await GearService().fightGear(c, idUser, clan);
    return { attrs: attrsOf(s), level, gear };
  }

  /** Poder com as parcelas: { total, parts }. */
  static async score(c, idUser, s) {
    return Power.powerScore(FightSim, await MeuMundoPowerService.inputs(c, idUser, s));
  }

  static async compute(c, idUser, s) {
    return (await MeuMundoPowerService.score(c, idUser, s)).total;
  }

  /** Grava só quando muda (power_at marca a mudança: desempate do ranking). */
  static async store(c, idCharacter, power) {
    await c.query(
      `UPDATE tb_mm_character SET power = $2, power_at = NOW() WHERE id_character = $1 AND power IS DISTINCT FROM $2`,
      [idCharacter, power]
    );
  }

  /** Recalcula e grava (dentro da transação de quem chama). Devolve o poder. */
  static async refresh(c, idUser, idCharacter, s) {
    const power = await MeuMundoPowerService.compute(c, idUser, s);
    await MeuMundoPowerService.store(c, idCharacter, power);
    return power;
  }

  /** Poder gravado do hóspede atual (última geração) de cada conta. */
  static async ofUser(db, idUser) {
    const r = await db.query(
      `SELECT power FROM tb_mm_character WHERE id_user = $1 ORDER BY generation DESC LIMIT 1`,
      [idUser]
    );
    const v = r.rows[0]?.power;
    return v == null ? null : Number(v);
  }

  /**
   * Backfill (migs 334/335): toda linha com power NULL. Usa o estado gravado (não
   * simula a vida até agora — isso fica para o próximo withLife). Idempotente:
   * depois da primeira passada não sobra nada.
   */
  static async backfill({ batch = 200 } = {}) {
    let done = 0;
    for (;;) {
      const r = await pool.query(
        `SELECT * FROM tb_mm_character WHERE power IS NULL ORDER BY id_character LIMIT $1`,
        [batch]
      );
      if (!r.rows.length) break;
      for (const row of r.rows) {
        try {
          const s = rowToState(row);
          const power = await MeuMundoPowerService.compute(pool, row.id_user, s);
          await pool.query(
            `UPDATE tb_mm_character SET power = $2, power_at = NOW() WHERE id_character = $1 AND power IS NULL`,
            [row.id_character, power]
          );
        } catch (err) {
          // linha que não calcula não trava as outras; grava 0 para não repetir para sempre
          log.warn("mm_power_backfill_row", { id: row.id_character, message: err.message });
          await pool.query(`UPDATE tb_mm_character SET power = 0, power_at = NOW() WHERE id_character = $1 AND power IS NULL`, [row.id_character]);
        }
        done++;
      }
    }
    return done;
  }
}

module.exports = MeuMundoPowerService;
