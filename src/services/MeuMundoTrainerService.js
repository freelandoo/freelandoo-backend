// src/services/MeuMundoTrainerService.js — MEU MUNDO 3D, lore v2 F2: nível do TREINADOR.
//
// O treinador é a conta (tb_mm_trainer, mig 437). Ganha o XP inteiro das missões e uma
// fração do resto (minijogo, luta, Domínio, cuidar, treinar) com teto por dia de
// Brasília (utils/meuMundoTrainer.js). Tudo aqui roda DENTRO do withLife de quem
// chama (mesma transação e advisory lock): o XP do treinador vai no MESMO recibo da
// atividade (`deltas.trainer`); cuidar/treinar ganham recibo próprio (source "trainer").

const Store = require("../storages/MeuMundoTrainerStorage");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const Trainer = require("../utils/meuMundoTrainer");
const Life = require("../utils/meuMundoLife");
const Adv = require("../utils/meuMundoAdventure");

/** Soma `xp` no treinador travado (`row`), respeitando o teto do dia quando `capped`. Devolve o delta ou null. */
function addTo(row, xp, { capped, now }) {
  let gain = Math.max(0, Math.round(Number(xp) || 0));
  if (capped) {
    const day = Life.localParts(now).day;
    if (row.gain_day !== day) {
      row.gain_day = day;
      row.gain_today = 0;
    }
    gain = Math.min(gain, Trainer.capRoom(row.gain_today));
    row.gain_today = Number(row.gain_today) + gain;
  }
  if (gain <= 0) return null;
  const before = Trainer.trainerLevelOf(Number(row.xp));
  row.xp = Number(row.xp) + gain;
  const after = Trainer.trainerLevelOf(row.xp);
  row.level = after.level;
  return { xp: gain, total: after.total, from: before.level, to: after.level, into: after.into, need: after.need };
}

class MeuMundoTrainerService {
  /**
   * XP do treinador por uma atividade, dentro do withLife. `source` = "quest" (XP do
   * passo inteiro, sem teto) ou "minigame" | "fight" | "domain" (fração do XP de
   * aventura `charXp`, com teto do dia). Devolve o delta para o recibo, ou undefined.
   */
  static async grant(c, idUser, source, charXp, now) {
    const quest = source === "quest";
    const xp = quest ? Math.round(Trainer.GAIN.quest * Math.max(0, Number(charXp) || 0)) : Trainer.shareOf(source, charXp);
    if (xp <= 0) return undefined;
    const row = await Store.lock(c, idUser);
    const delta = addTo(row, xp, { capped: !quest, now });
    if (!delta) return undefined;
    await Store.save(c, row);
    return delta;
  }

  /**
   * Cuidar e treinar: refeições feitas e horas ÚTEIS de treino/estudo do diário da vida
   * (o servidor é quem mede o tempo). `days` = dias fechados pela simulação + o de hoje,
   * em ordem. Cada unidade nova vira XP (com teto do dia) e um recibo "trainer".
   */
  static async fromLife(c, idUser, idCharacter, days, now) {
    const list = (days || []).filter((d) => d && d.day);
    if (!list.some((d) => {
      const u = Trainer.dayUnits(d);
      return u.meals > 0 || u.hours > 0;
    })) return null;
    const row = await Store.lock(c, idUser);
    let total = 0;
    let delta = null;
    const credited = [];
    for (const d of list) {
      if (row.care_day && d.day < row.care_day) continue; // dia já fechado antes
      if (row.care_day !== d.day) {
        row.care_day = d.day;
        row.care_meals = 0;
        row.train_hours = 0;
      }
      const u = Trainer.dayUnits(d);
      const meals = Math.max(0, u.meals - row.care_meals);
      const hours = Math.max(0, u.hours - row.train_hours);
      if (!meals && !hours) continue;
      row.care_meals += meals;
      row.train_hours += hours;
      const xp = meals * Trainer.GAIN.carePerMeal + hours * Trainer.GAIN.trainPerHour;
      // o teto é do dia de HOJE (um dia que passou sem a pessoa entrar não abre teto novo)
      const got = addTo(row, xp, { capped: true, now });
      credited.push({ day: d.day, meals: row.care_meals, hours: row.train_hours });
      if (got) {
        total += got.xp;
        delta = delta ? { ...got, xp: total, from: delta.from } : got;
      }
    }
    if (!credited.length) return null;
    await Store.save(c, row);
    if (!delta) return null;
    const last = credited[credited.length - 1];
    // a chave carrega os contadores: o mesmo estado nunca grava dois recibos
    return AdvStore.insertReceipt(c, {
      idUser,
      idCharacter,
      source: "trainer",
      actionKey: `life:${last.day}:m${last.meals}:h${last.hours}`,
      rules: Adv.RULES_VERSION,
      result: { kind: "care_train", days: credited },
      deltas: { trainer: delta },
    });
  }

  /** O nível do treinador para as telas: { level, into, need, total }. */
  static async view(c, idUser) {
    return Trainer.trainerLevelOf(Number((await Store.get(c, idUser)).xp));
  }
}

module.exports = MeuMundoTrainerService;
module.exports.addTo = addTo;
