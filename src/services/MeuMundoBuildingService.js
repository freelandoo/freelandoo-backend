// src/services/MeuMundoBuildingService.js — MEU MUNDO 3D, lore v2 F6: prédios por nível.
//
// `gate` é chamado pelas rotas de cada prédio (interior, atividade no lugar,
// entrar nos minijogos, luta no Boxe/Arena, Hall, Forja, Laboratório completo):
// nível do treinador abaixo do da tabela (utils/meuMundoBuildings.js) = recusa
// com o nível que falta. Administrador passa direto (MM_ADMIN_LOCKS=1 desliga
// a passagem, para testar a trava com uma conta de admin).
// Missões de prédio: uma por prédio quando ele abre (pr_<id> em tb_mm_quest),
// conferidas pelo mesmo motor dos capítulos; recibo único "pr:<id>" no withLife.

const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const TrainerStore = require("../storages/MeuMundoTrainerStorage");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const Trainer = require("../utils/meuMundoTrainer");
const Adv = require("../utils/meuMundoAdventure");
const B = require("../utils/meuMundoBuildings");

const ERRORS = {
  closed: ["Esse lugar ainda está fechado para o seu nível de treinador", 403],
  mission: ["Missão de prédio desconhecida", 404],
  missionLocked: ["Essa missão abre junto com o prédio", 409],
  done: ["Missão concluída", 409],
  pending: ["O objetivo ainda não foi cumprido", 409],
  dead: ["Hóspede sem vida", 409],
};
const fail = (code, extra = {}) => {
  const [error, statusCode] = ERRORS[code];
  return { error, statusCode, code, ...extra };
};

const levelOf = async (c, idUser) => Trainer.trainerLevelOf(Number((await TrainerStore.get(c, idUser)).xp)).level;

async function bypassOf(c, idUser) {
  if (!MeuMundoBuildingService.adminBypass || process.env.MM_ADMIN_LOCKS === "1") return false;
  return AuthStorage.isAdmin(c, idUser);
}

const ALIVE_SQL = `SELECT id_character FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ORDER BY born_at DESC LIMIT 1`;

/** Abre (sem acompanhar) a linha da missão de prédio que o nível já alcançou. */
async function openMissions(c, idUser, level) {
  const ids = B.BUILDING_QUESTS.filter((q) => level >= q.minLevel).map((q) => q.id);
  if (ids.length) await c.query(`INSERT INTO tb_mm_quest (id_user, quest_id, tracked) SELECT $1, unnest($2::text[]), FALSE ON CONFLICT (id_user, quest_id) DO NOTHING`, [idUser, ids]);
  const r = await c.query(`SELECT * FROM tb_mm_quest WHERE id_user = $1 AND quest_id = ANY($2::text[])`, [idUser, B.BUILDING_QUESTS.map((q) => q.id)]);
  return new Map(r.rows.map((x) => [x.quest_id, x]));
}

async function missionsView(c, idUser, level) {
  const rows = await openMissions(c, idUser, level);
  const ch = (await c.query(ALIVE_SQL, [idUser])).rows[0];
  const Quest = require("./MeuMundoQuestService");
  const out = [];
  for (const q of B.BUILDING_QUESTS) {
    const row = rows.get(q.id);
    const state = !row ? "locked" : row.done_at ? "done" : "current";
    let ready = false;
    if (state === "current" && ch) ready = (await Quest.satisfied(c, idUser, ch.id_character, {}, { key: q.id, check: q.check, xp: q.xp }, row)).ok;
    out.push({ id: q.id, place: q.place, minLevel: q.minLevel, check: q.check, xp: q.xp, state, ready });
  }
  return out;
}

class MeuMundoBuildingService {
  /** Recusa se o prédio está fechado para a pessoa (null = pode). */
  static async gate(idUser, placeId, db = pool) {
    const need = B.minLevelOf(placeId);
    if (need <= 1) return null;
    if (await bypassOf(db, idUser)) return null;
    const level = await levelOf(db, idUser);
    return level >= need ? null : fail("closed", { place: placeId, level: need, trainer: level });
  }

  /** O mesmo para uma parte do prédio (Laboratório completo, mercado de personagens). */
  static async gateFeature(idUser, feature, db = pool) {
    const need = B.featureLevelOf(feature);
    if (need <= 1) return null;
    if (await bypassOf(db, idUser)) return null;
    const level = await levelOf(db, idUser);
    return level >= need ? null : fail("closed", { feature, level: need, trainer: level });
  }

  /** GET /buildings — o nível, se passa direto, a tabela e as missões de prédio. */
  static async state(idUser, db = pool) {
    const level = await levelOf(db, idUser);
    return {
      trainer: level,
      bypass: await bypassOf(db, idUser),
      levels: B.BUILDING_LEVELS,
      features: B.FEATURE_LEVELS,
      missions: await missionsView(db, idUser, level),
    };
  }

  /** POST /buildings/mission { id } — entrega a missão do prédio (o servidor confere). */
  static async deliver(idUser, body = {}) {
    const id = String(body.id || "");
    const q = B.BUILDING_QUEST_BY_ID.get(id);
    if (!q) return fail("mission");
    const MeuMundoLifeService = require("./MeuMundoLifeService");
    const { addXp } = require("./MeuMundoAdventureService");
    const TrainerService = require("./MeuMundoTrainerService");
    const Quest = require("./MeuMundoQuestService");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      if (s.status !== "alive") return fail("dead");
      const c = ctx.client;
      const level = await levelOf(c, idUser);
      if (level < q.minLevel) return fail("missionLocked");
      await openMissions(c, idUser, level);
      const row = (await c.query(`SELECT * FROM tb_mm_quest WHERE id_user = $1 AND quest_id = $2 FOR UPDATE`, [idUser, id])).rows[0];
      const key = `pr:${id}`;
      const same = await AdvStore.findReceipt(c, ctx.row.id_character, "quest", key);
      if (same) return { receipt: same, replay: true, ...(await MeuMundoBuildingService.state(idUser, c)) };
      if (row.done_at) return fail("done");
      if (!(await Quest.satisfied(c, idUser, ctx.row.id_character, s, { key: id, check: q.check, xp: q.xp }, row)).ok) return fail("pending");
      const adv = await AdvStore.lockAdventure(c, idUser);
      const lv = addXp(adv, q.xp);
      await AdvStore.saveAdventure(c, idUser, { xp: adv.xp, level: adv.level, losses: adv.losses, lossesDay: adv.losses_day });
      const trainer = await TrainerService.grant(c, idUser, "quest", q.xp, ctx.now);
      await c.query(`UPDATE tb_mm_quest SET step = 1, step_at = $3, done_at = $3 WHERE id_user = $1 AND quest_id = $2`, [idUser, id, new Date(ctx.now).toISOString()]);
      const receipt = await AdvStore.insertReceipt(c, {
        idUser,
        idCharacter: ctx.row.id_character,
        source: "quest",
        actionKey: key,
        rules: Adv.RULES_VERSION,
        result: { quest: id, building: q.place, last: true },
        deltas: { xp: lv, trainer },
        items: [],
      });
      ctx.events.push({ at: ctx.now, kind: "quest", data: { quest: id } });
      return { receipt, replay: false, ...(await MeuMundoBuildingService.state(idUser, c)) };
    });
  }
}

/** Administrador passa direto (os testes desligam para ver a trava). */
MeuMundoBuildingService.adminBypass = true;

module.exports = MeuMundoBuildingService;
