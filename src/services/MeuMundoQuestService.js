// src/services/MeuMundoQuestService.js — MEU MUNDO 3D mm3d-59 (slice 5): missões.
//
// O SERVIDOR confere o objetivo de cada passo (eventos da vida, recibos de
// luta, mochila) e concede a recompensa por recibo único ("<missão>:<passo>")
// dentro do withLife — reenvio, duas abas ou reconexão não concedem de novo.
// Progresso persistente e retomável (tb_mm_quest, mig 322).

const MeuMundoLifeService = require("./MeuMundoLifeService");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const GearStore = require("../storages/MeuMundoGearStorage");
const Adv = require("../utils/meuMundoAdventure");
const Gear = require("../utils/meuMundoGear");
const { QUESTS, PROLOGUE } = require("../utils/meuMundoQuests");
const { addXp } = require("./MeuMundoAdventureService");
const TrainerService = require("./MeuMundoTrainerService");
const GearService = () => require("./MeuMundoGearService");

const ACTIONS = Object.freeze(["ack", "visit_armory"]);
const ERRORS = {
  action: ["Ação inválida", 400],
  done: ["Missão concluída", 409],
  pending: ["O objetivo ainda não foi cumprido", 409],
  dead: ["Hóspede sem vida", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

async function lockQuest(c, idUser, questId) {
  await c.query(`INSERT INTO tb_mm_quest (id_user, quest_id) VALUES ($1, $2) ON CONFLICT (id_user, quest_id) DO NOTHING`, [idUser, questId]);
  return (await c.query(`SELECT * FROM tb_mm_quest WHERE id_user = $1 AND quest_id = $2 FOR UPDATE`, [idUser, questId])).rows[0];
}

/** O objetivo do passo está cumprido? (só leitura) */
async function satisfied(c, idUser, idCharacter, step, row) {
  // folga de 2 s: eventos da vida usam o relógio do Node, recibos o do banco
  // (no Windows os dois diferem em ~15 ms) — comer logo depois de abrir o passo vale.
  const since = new Date(new Date(row.step_at).getTime() - 2000);
  const q1 = async (sql, args) => (await c.query(sql, args)).rows.length > 0;
  switch (step.check) {
    case "ack":
    case "minigame":
      return true; // apresentação: a confirmação da pessoa é o objetivo
    case "ate":
      return q1(`SELECT 1 FROM tb_mm_character_event WHERE id_character = $1 AND kind = 'consume' AND at >= $2 LIMIT 1`, [idCharacter, since]);
    case "practice":
      return q1(
        `SELECT 1 FROM tb_mm_character_event WHERE id_character = $1 AND kind = 'activity' AND at >= $2
           AND data->>'kind' IN ('training', 'studying') LIMIT 1`,
        [idCharacter, since]
      );
    case "weapon": {
      const owned = await GearStore.owned(c, idUser);
      return Object.keys(owned).some((id) => Gear.GEAR_BY_ID.get(id)?.category === "weapon");
    }
    case "tutorialFight":
      return q1(`SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'fight' AND created_at >= $2 AND result->>'origin' = 'tutorial' AND NOT (result->>'abandoned')::boolean LIMIT 1`, [idUser, since]);
    case "fightWin":
      // vale a vitória desde o começo do prólogo (vencer já a luta de treino conta)
      return q1(`SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'fight' AND created_at >= $2 AND (result->>'win')::boolean LIMIT 1`, [idUser, row.started_at]);
    case "material": {
      const owned = await GearStore.owned(c, idUser);
      return Object.keys(owned).some((id) => Gear.GEAR_BY_ID.get(id)?.category === "material");
    }
    case "armory": {
      const eq = await GearStore.equipped(c, idUser);
      return !!(row.data && row.data.armory) && !!eq.weapon;
    }
    default:
      return false;
  }
}

function view(quest, row, done) {
  const i = Math.min(row.step, quest.steps.length - 1);
  return {
    id: quest.id,
    step: row.step,
    total: quest.steps.length,
    done: !!row.done_at,
    next: quest.next,
    current: row.done_at ? null : { ...quest.steps[i], index: i, ready: done },
    steps: quest.steps.map((s, k) => ({ key: s.key, where: s.where, xp: s.xp, state: k < row.step || row.done_at ? "done" : k === row.step ? "current" : "locked" })),
  };
}

class MeuMundoQuestService {
  /** GET /quest — a missão acompanhada (o prólogo, por enquanto) e se o passo atual já pode ser entregue. */
  static async get(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const row = await lockQuest(c, idUser, PROLOGUE.id);
      // passo da arma: a arma já vai para a mochila quando o passo abre
      const step = PROLOGUE.steps[row.step];
      if (!row.done_at && step && step.grant === "starter") await GearService().grantStarter(idUser, ctx);
      const ready = !row.done_at && step ? await satisfied(c, idUser, ctx.row.id_character, step, row) : false;
      return { quest: view(PROLOGUE, row, ready) };
    });
  }

  /**
   * POST /quest/advance { action } — entrega o passo atual se o objetivo foi
   * cumprido (conferido aqui). `visit_armory` só marca a visita ao Armeiro.
   */
  static async advance(idUser, body = {}) {
    const action = String(body.action || "ack");
    if (!ACTIONS.includes(action)) return fail("action");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      if (s.status !== "alive") return fail("dead");
      const c = ctx.client;
      const quest = QUESTS[PROLOGUE.id];
      const row = await lockQuest(c, idUser, quest.id);
      if (row.done_at) return fail("done");
      if (action === "visit_armory") {
        const data = { ...(row.data || {}), armory: true };
        await c.query(`UPDATE tb_mm_quest SET data = $3 WHERE id_user = $1 AND quest_id = $2`, [idUser, quest.id, JSON.stringify(data)]);
        row.data = data;
        const step0 = quest.steps[row.step];
        return { quest: view(quest, row, step0 ? await satisfied(c, idUser, ctx.row.id_character, step0, row) : false) };
      }
      const step = quest.steps[row.step];
      const key = `${quest.id}:${row.step}`;
      // a mesma entrega repetida (resposta perdida): devolve o mesmo recibo
      const same = await AdvStore.findReceipt(c, ctx.row.id_character, "quest", key);
      if (same) return { receipt: same, replay: true, quest: view(quest, row, false) };
      if (step.grant === "starter") await GearService().grantStarter(idUser, ctx);
      if (!(await satisfied(c, idUser, ctx.row.id_character, step, row))) return fail("pending");
      // recompensa: XP + itens do passo
      const adv = await AdvStore.lockAdventure(c, idUser);
      const level = addXp(adv, step.xp);
      await AdvStore.saveAdventure(c, idUser, { xp: adv.xp, level: adv.level, losses: adv.losses, lossesDay: adv.losses_day });
      // F2: o XP da missão vai INTEIRO para o treinador (a conta), sem teto
      const trainer = await TrainerService.grant(c, idUser, "quest", step.xp, ctx.now);
      const items = step.items ? await GearService().deliver(c, idUser, step.items.map(([id, qty]) => ({ id, qty, rarity: Gear.GEAR_BY_ID.get(id).rarity })), ctx) : [];
      const last = row.step + 1 >= quest.steps.length;
      await c.query(
        `UPDATE tb_mm_quest SET step = $3, step_at = $5, done_at = CASE WHEN $4 THEN $5::timestamptz ELSE NULL END,
                tracked = NOT $4 WHERE id_user = $1 AND quest_id = $2`,
        [idUser, quest.id, row.step + 1, last, new Date(ctx.now).toISOString()]
      );
      const receipt = await AdvStore.insertReceipt(c, {
        idUser,
        idCharacter: ctx.row.id_character,
        source: "quest",
        actionKey: key,
        rules: Adv.RULES_VERSION,
        result: { quest: quest.id, step: step.key, index: row.step, last },
        deltas: { xp: level, trainer },
        items,
      });
      ctx.events.push({ at: ctx.now, kind: "quest", data: { quest: quest.id, step: step.key } });
      const next = { ...row, step: row.step + 1, step_at: new Date(ctx.now), done_at: last ? new Date(ctx.now) : null };
      const nstep = quest.steps[next.step];
      if (nstep && nstep.grant === "starter") await GearService().grantStarter(idUser, ctx);
      return { receipt, replay: false, quest: view(quest, next, nstep ? await satisfied(c, idUser, ctx.row.id_character, nstep, next) : false) };
    });
  }

  /** O prólogo está no passo da luta de treino? (a luta "tutorial" só abre aí) */
  static async tutorialOpen(c, idUser) {
    const r = (await c.query(`SELECT step, done_at FROM tb_mm_quest WHERE id_user = $1 AND quest_id = $2`, [idUser, PROLOGUE.id])).rows[0];
    if (!r || r.done_at) return false;
    const key = PROLOGUE.steps[r.step]?.key;
    return key === "aprender" || key === "vitoria";
  }
}

module.exports = MeuMundoQuestService;
