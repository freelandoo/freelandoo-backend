// Catálogo de missões da Arena (mig 287) a partir de seeds/arena-missions.json.
//
// Versão publicada é IMUTÁVEL no que define a regra (fato, objetivo, meta,
// ciclo, recompensa, x2, requisito): mudar = nova versão. A versão anterior
// vira 'retired' e continua existindo — o progresso já fixado nela termina
// com a regra em que começou, e a concessão do ciclo não é reaberta (a chave
// do prêmio não inclui a versão). Ligar/desligar (status) não é nova versão.

const rules = require("../utils/arenaMissions");

const RULE_FIELDS = [
  ["fact_type", "factType"],
  ["objective", "objective"],
  ["target", "target"],
  ["cycle", "cycle"],
  ["reward_xp", "rewardXp"],
  ["x2_eligible", "x2Eligible"],
  ["requirement", "requirement"],
  ["voluntary", "voluntary"],
];

async function syncMissions(client, doc, { apply = false } = {}) {
  const v = rules.validateMissionsDoc(doc);
  if (v.errors) return { ok: false, errors: v.errors };
  const summary = { insert: 0, statusChanged: 0, retired: 0, unchanged: 0 };
  const errors = [];
  await client.query("BEGIN");
  try {
    for (const m of doc.missions) {
      const rows = (await client.query(`SELECT * FROM public.tb_arena_mission_def WHERE mission_key = $1 ORDER BY version FOR UPDATE`, [m.missionKey])).rows;
      const same = rows.find((r) => r.version === m.version);
      if (same) {
        const changed = RULE_FIELDS.filter(([col, key]) => same[col] !== m[key]).map(([, key]) => key);
        if (changed.length) {
          errors.push(`${m.missionKey}@v${m.version}: versão publicada é imutável (${changed.join(", ")}). Use a versão ${Math.max(...rows.map((r) => r.version)) + 1}.`);
          continue;
        }
        if (same.status === "retired") {
          errors.push(`${m.missionKey}@v${m.version}: versão aposentada não volta; use uma versão nova`);
          continue;
        }
        if (same.status !== m.status || same.sort_order !== m.order) {
          summary.statusChanged++;
          await client.query(`UPDATE public.tb_arena_mission_def SET status = $3, sort_order = $4, updated_at = NOW() WHERE mission_key = $1 AND version = $2`, [m.missionKey, m.version, m.status, m.order]);
        } else summary.unchanged++;
        continue;
      }
      const maxV = rows.length ? Math.max(...rows.map((r) => r.version)) : 0;
      if (m.version <= maxV) {
        errors.push(`${m.missionKey}@v${m.version}: versão menor que a já publicada (v${maxV})`);
        continue;
      }
      const retired = await client.query(`UPDATE public.tb_arena_mission_def SET status = 'retired', updated_at = NOW() WHERE mission_key = $1 AND status IN ('active', 'disabled')`, [m.missionKey]);
      summary.retired += retired.rowCount;
      summary.insert++;
      await client.query(
        `INSERT INTO public.tb_arena_mission_def
           (mission_key, version, status, fact_type, objective, target, cycle, reward_xp, x2_eligible, requirement, voluntary, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [m.missionKey, m.version, m.status, m.factType, m.objective, m.target, m.cycle, m.rewardXp, m.x2Eligible, m.requirement, m.voluntary, m.order]
      );
    }
    if (errors.length) {
      await client.query("ROLLBACK");
      return { ok: false, errors };
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { ok: true, summary };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

module.exports = { syncMissions };
