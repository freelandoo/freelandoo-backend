// src/services/MeuMundoQuestService.js — MEU MUNDO 3D, lore v2 F3: os 10 capítulos.
//
// O SERVIDOR confere o objetivo de cada passo (eventos da vida, recibos de luta e
// de minijogo, mochila, atributos) e concede a recompensa por recibo único
// ("<capítulo>:<passo>") dentro do withLife — reenvio, duas abas ou reconexão não
// concedem de novo. Progresso por conta em tb_mm_quest (mig 322), uma linha por
// capítulo (quest_id = "cap1" … "cap10"). Cada capítulo abre pelo nível do
// TREINADOR (F2, mig 437). O prólogo antigo ("despertar") é apagado na primeira
// leitura: todo mundo recomeça no capítulo 1 (decisão do Alex, 09/11).

const MeuMundoLifeService = require("./MeuMundoLifeService");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const GearStore = require("../storages/MeuMundoGearStorage");
const TrainerStore = require("../storages/MeuMundoTrainerStorage");
const Adv = require("../utils/meuMundoAdventure");
const Gear = require("../utils/meuMundoGear");
const Life = require("../utils/meuMundoLife");
const Trainer = require("../utils/meuMundoTrainer");
const Q = require("../utils/meuMundoQuests");
const { addXp } = require("./MeuMundoAdventureService");
const TrainerService = require("./MeuMundoTrainerService");
const GearService = () => require("./MeuMundoGearService");

const ACTIONS = Object.freeze(["ack", "visit_armory"]);
const ERRORS = {
  action: ["Ação inválida", 400],
  done: ["Missão concluída", 409],
  pending: ["O objetivo ainda não foi cumprido", 409],
  dead: ["Hóspede sem vida", 409],
  level: ["O próximo capítulo abre num nível maior do treinador", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};

const CAP_IDS = Q.CHAPTERS.map((c) => c.id);

/** Linhas dos capítulos da pessoa (quest_id → linha). */
async function chapterRows(c, idUser) {
  const r = await c.query(`SELECT * FROM tb_mm_quest WHERE id_user = $1 AND quest_id = ANY($2::text[])`, [idUser, CAP_IDS]);
  return new Map(r.rows.map((x) => [x.quest_id, x]));
}

/** O capítulo de agora: o primeiro sem `done_at` (ou o último, se tudo acabou). */
function currentChapter(rows) {
  return Q.CHAPTERS.find((ch) => !(rows.get(ch.id) && rows.get(ch.id).done_at)) || null;
}

/** Abre (ou trava) a linha do capítulo. O prólogo antigo sai na primeira vez. */
async function lockChapter(c, idUser, chapterId) {
  await c.query(`DELETE FROM tb_mm_quest WHERE id_user = $1 AND NOT (quest_id = ANY($2::text[]))`, [idUser, CAP_IDS]);
  await c.query(`INSERT INTO tb_mm_quest (id_user, quest_id) VALUES ($1, $2) ON CONFLICT (id_user, quest_id) DO NOTHING`, [idUser, chapterId]);
  return (await c.query(`SELECT * FROM tb_mm_quest WHERE id_user = $1 AND quest_id = $2 FOR UPDATE`, [idUser, chapterId])).rows[0];
}

const trainerLevel = async (c, idUser) => Trainer.trainerLevelOf(Number((await TrainerStore.get(c, idUser)).xp)).level;

/** Conta linhas (até `need`) — os checks com "× N". */
async function countOf(c, sql, args, need) {
  const r = await c.query(`SELECT COUNT(*)::int AS n FROM (${sql} LIMIT ${Math.max(1, need)}) q`, args);
  return r.rows[0].n;
}

/**
 * O objetivo do passo está cumprido? (só leitura) → { ok, have, need }.
 * `s` = estado da vida do personagem ativo (atributos).
 */
async function satisfied(c, idUser, idCharacter, s, step, row) {
  // folga de 2 s: eventos da vida usam o relógio do Node, recibos o do banco
  const since = new Date(new Date(row.step_at).getTime() - 2000);
  const need = Math.max(1, step.count || 1);
  const out = (have, n = need) => ({ ok: have >= n, have: Math.min(have, n), need: n });
  const yes = (b) => out(b ? need : 0);
  const q1 = async (sql, args) => (await c.query(sql, args)).rows.length > 0;
  const { type, arg } = Q.parseCheck(step.check);
  switch (type) {
    case "ack":
    case "minigame":
      return yes(true); // apresentação: a confirmação da pessoa é o objetivo
    case "clan":
      return yes(await q1(`SELECT 1 FROM tb_mm_clan WHERE id_user = $1 AND clan IS NOT NULL`, [idUser]));
    case "ate":
      return yes(await q1(`SELECT 1 FROM tb_mm_character_event WHERE id_character = $1 AND kind = 'consume' AND at >= $2 LIMIT 1`, [idCharacter, since]));
    case "practice": {
      const kinds = arg ? [arg] : ["training", "studying"];
      return yes(
        await q1(`SELECT 1 FROM tb_mm_character_event WHERE id_character = $1 AND kind = 'activity' AND at >= $2 AND data->>'kind' = ANY($3::text[]) LIMIT 1`, [idCharacter, since, kinds])
      );
    }
    case "sleep":
      return yes(await q1(`SELECT 1 FROM tb_mm_character_event WHERE id_character = $1 AND kind = 'activity' AND at >= $2 AND data->>'kind' = 'sleeping' LIMIT 1`, [idCharacter, since]));
    case "buy": {
      const r = await c.query(`SELECT data->>'item' AS item FROM tb_mm_character_event WHERE id_character = $1 AND kind = 'buy' AND at >= $2`, [idCharacter, since]);
      return yes(r.rows.some((x) => !arg || (Life.ITEM_BY_ID.get(x.item) || {}).kind === arg));
    }
    case "weapon": {
      const owned = await GearStore.owned(c, idUser);
      return yes(Object.keys(owned).some((id) => Gear.GEAR_BY_ID.get(id)?.category === "weapon"));
    }
    case "material": {
      const owned = await GearStore.owned(c, idUser);
      return yes(Object.keys(owned).some((id) => Gear.GEAR_BY_ID.get(id)?.category === "material"));
    }
    case "armory": {
      const eq = await GearStore.equipped(c, idUser);
      return yes(!!(row.data && row.data.armory) && !!eq.weapon);
    }
    case "tutorialFight":
      return yes(
        await q1(`SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'fight' AND created_at >= $2 AND result->>'origin' = 'tutorial' AND NOT (result->>'abandoned')::boolean LIMIT 1`, [idUser, since])
      );
    case "forge":
      return yes(await q1(`SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'forge' AND created_at >= $2 LIMIT 1`, [idUser, since]));
    case "game": {
      if (!Q.GAMES.includes(arg)) return yes(false);
      const fightGame = arg === "boxe" || arg === "laminas";
      const sql = fightGame
        ? `SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'fight' AND created_at >= $2 AND result->>'origin' = $3 AND NOT (result->>'abandoned')::boolean`
        : `SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'minigame:' || $3 AND created_at >= $2`;
      return out(await countOf(c, sql, [idUser, since, arg], need));
    }
    case "games": {
      const n = Math.max(1, Number(arg) || 1);
      // jogos DIFERENTES desde que o capítulo começou
      const r = await c.query(
        `SELECT DISTINCT CASE WHEN source = 'fight' THEN result->>'origin' ELSE substring(source FROM 10) END AS g
           FROM tb_mm_receipt
          WHERE id_user = $1 AND created_at >= $2
            AND (source LIKE 'minigame:%' OR (source = 'fight' AND result->>'origin' IN ('laminas', 'boxe') AND NOT (result->>'abandoned')::boolean))`,
        [idUser, new Date(new Date(row.started_at).getTime() - 2000)]
      );
      return out(r.rows.filter((x) => Q.GAMES.includes(x.g)).length, n);
    }
    case "fightWin":
    case "nightKill": {
      const args = [idUser, since];
      let sql = `SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'fight' AND created_at >= $2 AND (result->>'win')::boolean AND NOT (result->>'abandoned')::boolean`;
      // a rua só tem monstro de noite (18h–6h): vencer um monstro da rua é vencer de noite
      sql += type === "nightKill" ? ` AND result->>'origin' = 'mob'` : ` AND result->>'origin' <> 'tutorial'`;
      if (arg) {
        args.push(arg);
        sql += ` AND result->>'kind' = $3`;
      }
      return out(await countOf(c, sql, args, need));
    }
    case "stat": {
      const n = Math.max(1, Number(arg) || 1);
      const best = Math.max(...["strength", "speed", "intelligence", "dexterity"].map((k) => Number(s && s[k]) || 0));
      return out(Math.floor(best), n);
    }
    case "power": {
      const n = Math.max(1, Number(arg) || 1);
      const r = await c.query(`SELECT power FROM tb_mm_character WHERE id_character = $1`, [idCharacter]);
      return out(Math.floor(Number(r.rows[0] && r.rows[0].power) || 0), n);
    }
    case "hallChallenge":
      return yes(await q1(`SELECT 1 FROM tb_mm_receipt WHERE id_user = $1 AND source = 'fight' AND created_at >= $2 AND result->>'origin' = 'hall' LIMIT 1`, [idUser, since]));
    case "mix":
      return yes(
        await q1(
          `SELECT 1 FROM tb_mm_character_event e JOIN tb_mm_character ch ON ch.id_character = e.id_character
            WHERE ch.id_user = $1 AND e.kind = 'fused' AND e.at >= $2 LIMIT 1`,
          [idUser, since]
        )
      );
    case "certificate":
      return yes(
        await q1(
          `SELECT 1 FROM tb_mm_character_event e JOIN tb_mm_character ch ON ch.id_character = e.id_character
            WHERE ch.id_user = $1 AND e.kind = 'mark' AND e.data->>'mark' = 'certificate' AND e.at >= $2 LIMIT 1`,
          [idUser, since]
        )
      );
    default:
      // visit / talk / archive / nectar / paintTop: o dado chega nas próximas fatias
      return yes(false);
  }
}

/** O que a tela recebe de um capítulo. */
function view(ch, row, ready, { trainer, locked = false } = {}) {
  const r = row || { step: 0, done_at: null };
  const i = Math.min(r.step, ch.steps.length - 1);
  const cur = ch.steps[i];
  return {
    id: ch.id,
    chapter: ch.n,
    minTrainerLevel: ch.minTrainerLevel,
    step: r.step,
    total: ch.steps.length,
    done: !!r.done_at,
    next: ch.next,
    // capítulo esperando o nível do treinador
    locked: locked ? { level: ch.minTrainerLevel, trainer } : null,
    current:
      r.done_at || locked
        ? null
        : { ...cur, index: i, ready: !!(ready && ready.ok), have: ready ? ready.have : 0, need: ready ? ready.need : cur.count || 1, waiting: Q.PENDING_CHECKS.includes(Q.parseCheck(cur.check).type) },
    steps: ch.steps.map((s, k) => ({ key: s.key, where: s.where, xp: s.xp, count: s.count || 1, state: r.done_at || k < r.step ? "done" : k === r.step && !locked ? "current" : "locked" })),
  };
}

/** A lista dos capítulos (feito / agora / trancado pelo nível) para a tela. */
function chapterList(rows, cur, trainer) {
  return Q.CHAPTERS.map((ch) => ({
    id: ch.id,
    chapter: ch.n,
    minTrainerLevel: ch.minTrainerLevel,
    state: rows.get(ch.id) && rows.get(ch.id).done_at ? "done" : cur && ch.id === cur.id && trainer >= ch.minTrainerLevel ? "current" : "locked",
  }));
}

/** Monta a resposta de GET/advance: o capítulo de agora (aberto se o nível deixa). */
async function snapshot(c, idUser, idCharacter, s, ctx) {
  const rows = await chapterRows(c, idUser);
  const trainer = await trainerLevel(c, idUser);
  // a classe escolhe a variante do texto (Raposa/Vampiro) na tela
  const clan = ((await c.query(`SELECT clan FROM tb_mm_clan WHERE id_user = $1`, [idUser])).rows[0] || {}).clan || null;
  const ch = currentChapter(rows);
  if (!ch) {
    const last = Q.CHAPTERS[Q.CHAPTERS.length - 1];
    return { quest: view(last, rows.get(last.id), null, { trainer }), chapters: chapterList(rows, null, trainer), trainer, clan };
  }
  if (trainer < ch.minTrainerLevel) return { quest: view(ch, rows.get(ch.id), null, { trainer, locked: true }), chapters: chapterList(rows, ch, trainer), trainer, clan };
  const row = await lockChapter(c, idUser, ch.id);
  const step = ch.steps[row.step];
  // passo da arma: a arma já vai para a mochila quando o passo abre
  if (!row.done_at && step && step.grant === "starter") await GearService().grantStarter(idUser, ctx);
  const ready = !row.done_at && step ? await satisfied(c, idUser, idCharacter, s, step, row) : null;
  rows.set(ch.id, row);
  return { quest: view(ch, row, ready, { trainer }), chapters: chapterList(rows, ch, trainer), trainer, clan };
}

class MeuMundoQuestService {
  /** GET /quest — o capítulo de agora, se o passo atual já pode ser entregue e a lista dos capítulos. */
  static async get(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => snapshot(ctx.client, idUser, ctx.row.id_character, s, ctx));
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
      const rows = await chapterRows(c, idUser);
      const ch = currentChapter(rows);
      if (!ch) return fail("done");
      if ((await trainerLevel(c, idUser)) < ch.minTrainerLevel) return fail("level");
      const row = await lockChapter(c, idUser, ch.id);
      if (row.done_at) return fail("done");
      if (action === "visit_armory") {
        const data = { ...(row.data || {}), armory: true };
        await c.query(`UPDATE tb_mm_quest SET data = $3 WHERE id_user = $1 AND quest_id = $2`, [idUser, ch.id, JSON.stringify(data)]);
        return snapshot(c, idUser, ctx.row.id_character, s, ctx);
      }
      const step = ch.steps[row.step];
      const key = `${ch.id}:${row.step}`;
      // a mesma entrega repetida (resposta perdida): devolve o mesmo recibo
      const same = await AdvStore.findReceipt(c, ctx.row.id_character, "quest", key);
      if (same) return { receipt: same, replay: true, ...(await snapshot(c, idUser, ctx.row.id_character, s, ctx)) };
      if (step.grant === "starter") await GearService().grantStarter(idUser, ctx);
      if (!(await satisfied(c, idUser, ctx.row.id_character, s, step, row)).ok) return fail("pending");
      // recompensa: XP do personagem + o MESMO XP para o treinador (a conta) + itens do passo
      const adv = await AdvStore.lockAdventure(c, idUser);
      const level = addXp(adv, step.xp);
      await AdvStore.saveAdventure(c, idUser, { xp: adv.xp, level: adv.level, losses: adv.losses, lossesDay: adv.losses_day });
      const trainer = await TrainerService.grant(c, idUser, "quest", step.xp, ctx.now);
      const items = step.items ? await GearService().deliver(c, idUser, step.items.map(([id, qty]) => ({ id, qty, rarity: Gear.GEAR_BY_ID.get(id).rarity })), ctx) : [];
      const last = row.step + 1 >= ch.steps.length;
      await c.query(
        `UPDATE tb_mm_quest SET step = $3, step_at = $5, done_at = CASE WHEN $4 THEN $5::timestamptz ELSE NULL END,
                tracked = NOT $4 WHERE id_user = $1 AND quest_id = $2`,
        [idUser, ch.id, row.step + 1, last, new Date(ctx.now).toISOString()]
      );
      const receipt = await AdvStore.insertReceipt(c, {
        idUser,
        idCharacter: ctx.row.id_character,
        source: "quest",
        actionKey: key,
        rules: Adv.RULES_VERSION,
        result: { quest: ch.id, chapter: ch.n, step: step.key, index: row.step, last },
        deltas: { xp: level, trainer },
        items,
      });
      ctx.events.push({ at: ctx.now, kind: "quest", data: { quest: ch.id, step: step.key } });
      return { receipt, replay: false, ...(await snapshot(c, idUser, ctx.row.id_character, s, ctx)) };
    });
  }

  /**
   * POST /quest/mark { mark } — o aparelho conta que abriu uma tela que é objetivo
   * (hoje: a certidão). O servidor grava como evento da vida; o passo lê o evento.
   */
  static async mark(idUser, body = {}) {
    const mark = String(body.mark || "");
    if (!Q.MARKS.includes(mark)) return fail("action");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      ctx.events.push({ at: ctx.now, kind: "mark", data: { mark } });
      return { ok: true };
    });
  }

  /** O passo de agora é a luta de treino? (a luta "tutorial" só abre aí) */
  static async tutorialOpen(c, idUser) {
    const rows = await chapterRows(c, idUser);
    const ch = currentChapter(rows);
    if (!ch) return false;
    const r = rows.get(ch.id);
    if (!r || r.done_at) return false;
    if ((await trainerLevel(c, idUser)) < ch.minTrainerLevel) return false;
    return Q.parseCheck(ch.steps[r.step]?.check).type === "tutorialFight";
  }
}

module.exports = MeuMundoQuestService;
module.exports.satisfied = satisfied;
