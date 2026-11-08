// src/services/MeuMundoPowerService.js — MEU MUNDO 3D: o PODER do personagem (T3).
//
// A fórmula mora no front (features/meu-mundo/power/power.ts) e o back roda a
// cópia GERADA (src/utils/meuMundoPower.js). A ficha da luta entra pela cópia
// gerada da regra da luta (meuMundoFight.js): a mesma conta que o aparelho faz.
//
// Entradas: corpo vestido, nível de aventura, atributos da vida, equipamento
// equipado (mesmo que vai para a luta) e os efeitos ativos da vida (suplementos).
// Grava em tb_mm_character.power (mig 334) só quando muda.

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

class MeuMundoPowerService {
  /** Entradas do poder de quem é `idUser`, com o estado `s` da vida em `now`. */
  static async inputs(c, idUser, s, now = Date.now()) {
    const body = await MeuMundoStorage.getBody(c, idUser);
    const clan = clanOfBody(body) ?? (await MeuMundoStorage.getClan(c, idUser)).clan;
    const level = Adv.levelOf(Number((await AdvStore.getAdventure(c, idUser)).xp)).level;
    const gear = await GearService().fightGear(c, idUser, clan);
    const supplements = (s.effects || []).filter((e) => e && e.until > now).map((e) => e.id);
    return {
      body,
      level,
      stats: { strength: s.strength, speed: s.speed, intelligence: s.intelligence, dexterity: s.dexterity },
      gear,
      supplements,
    };
  }

  static async compute(c, idUser, s, now = Date.now()) {
    return Power.powerOf(FightSim, await MeuMundoPowerService.inputs(c, idUser, s, now));
  }

  /** Grava só quando muda. */
  static async store(c, idCharacter, power) {
    await c.query(`UPDATE tb_mm_character SET power = $2 WHERE id_character = $1 AND power IS DISTINCT FROM $2`, [idCharacter, power]);
  }

  /** Recalcula e grava (dentro da transação de quem chama). Devolve o poder. */
  static async refresh(c, idUser, idCharacter, s, now = Date.now()) {
    const power = await MeuMundoPowerService.compute(c, idUser, s, now);
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
   * Backfill (mig 334): toda linha com power NULL. Usa o estado gravado (não
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
          const power = await MeuMundoPowerService.compute(pool, row.id_user, s, Date.now());
          await pool.query(`UPDATE tb_mm_character SET power = $2 WHERE id_character = $1 AND power IS NULL`, [row.id_character, power]);
        } catch (err) {
          // linha que não calcula não trava as outras; grava 0 para não repetir para sempre
          log.warn("mm_power_backfill_row", { id: row.id_character, message: err.message });
          await pool.query(`UPDATE tb_mm_character SET power = 0 WHERE id_character = $1 AND power IS NULL`, [row.id_character]);
        }
        done++;
      }
    }
    return done;
  }
}

module.exports = MeuMundoPowerService;
