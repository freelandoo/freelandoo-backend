// Sincroniza o catálogo da Arena (categorias e equipes) a partir de um JSON
// versionado (src/databases/seeds/arena-catalog.json). É o mecanismo de
// configuração do catálogo até o painel administrativo (Módulo 16).
//
// Regras:
//   - valida TUDO antes de gravar: um erro no arquivo não grava nada;
//   - upsert por id estável; categoria/equipe que saiu do arquivo NÃO é
//     apagada (apagar levaria junto as escolhas das pessoas): é DESATIVADA;
//   - nunca toca em equipes `is_synthetic` (fixtures de teste);
//   - tudo numa transação.

const rules = require("../utils/arenaRules");

function validateCatalog(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.categories)) return ["catálogo sem `categories`"];
  const catIds = new Set();
  for (const c of doc.categories) {
    const where = `categoria ${c?.categoryId ?? "?"}`;
    if (!rules.isCategoryId(c?.categoryId)) errors.push(`${where}: categoryId inválido`);
    if (catIds.has(c?.categoryId)) errors.push(`${where}: repetida`);
    catIds.add(c?.categoryId);
    if (typeof c?.sensitive !== "boolean") errors.push(`${where}: sensitive deve ser booleano`);
    if (!rules.validLabels(c?.labels)) errors.push(`${where}: labels inválidos (pt-BR obrigatório; só pt-BR/en/es)`);
    if (!rules.isColor(c?.color)) errors.push(`${where}: cor inválida`);
    const v = c?.consentPolicyVersion;
    if (v !== undefined && v !== null && !(Number.isInteger(v) && v > 0)) errors.push(`${where}: consentPolicyVersion inválida`);
    if (v && !c.sensitive) errors.push(`${where}: só categoria sensível tem política de consentimento`);
    if (!Array.isArray(c?.teams)) {
      errors.push(`${where}: teams deve ser lista`);
      continue;
    }
    const teamIds = new Set();
    for (const t of c.teams) {
      const tw = `${where} / equipe ${t?.teamId ?? "?"}`;
      if (!rules.isTeamId(t?.teamId)) errors.push(`${tw}: teamId inválido`);
      if (teamIds.has(t?.teamId)) errors.push(`${tw}: repetida`);
      teamIds.add(t?.teamId);
      if (!rules.validLabels(t?.labels)) errors.push(`${tw}: labels inválidos`);
      if (!rules.isColor(t?.color)) errors.push(`${tw}: cor inválida`);
    }
  }
  return errors;
}

async function syncCatalog(client, doc, { apply = false } = {}) {
  const errors = validateCatalog(doc);
  if (errors.length) return { ok: false, errors };
  const summary = { categories: 0, teams: 0, deactivatedCategories: 0, deactivatedTeams: 0 };
  await client.query("BEGIN");
  try {
    const catIds = doc.categories.map((c) => c.categoryId);
    for (const c of doc.categories) {
      await client.query(
        `INSERT INTO public.tb_arena_category
           (category_id, is_sensitive, is_active, sort_order, labels, color, consent_policy_version)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         ON CONFLICT (category_id) DO UPDATE SET
           is_sensitive = EXCLUDED.is_sensitive, is_active = EXCLUDED.is_active,
           sort_order = EXCLUDED.sort_order, labels = EXCLUDED.labels, color = EXCLUDED.color,
           consent_policy_version = EXCLUDED.consent_policy_version, updated_at = NOW()`,
        [c.categoryId, c.sensitive, c.active !== false, c.order ?? 0, JSON.stringify(c.labels), c.color ?? null, c.consentPolicyVersion ?? null]
      );
      summary.categories++;
      const teamIds = c.teams.map((t) => t.teamId);
      for (const t of c.teams) {
        await client.query(
          `INSERT INTO public.tb_arena_team (category_id, team_id, labels, color, is_active, sort_order, is_synthetic)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, FALSE)
           ON CONFLICT (category_id, team_id) DO UPDATE SET
             labels = EXCLUDED.labels, color = EXCLUDED.color, is_active = EXCLUDED.is_active,
             sort_order = EXCLUDED.sort_order, updated_at = NOW()
           WHERE public.tb_arena_team.is_synthetic = FALSE`,
          [c.categoryId, t.teamId, JSON.stringify(t.labels), t.color ?? null, t.active !== false, t.order ?? 0]
        );
        summary.teams++;
      }
      const off = await client.query(
        `UPDATE public.tb_arena_team SET is_active = FALSE, updated_at = NOW()
          WHERE category_id = $1 AND is_synthetic = FALSE AND is_active = TRUE
            AND NOT (team_id = ANY($2::text[]))`,
        [c.categoryId, teamIds]
      );
      summary.deactivatedTeams += off.rowCount;
    }
    const offCats = await client.query(
      `UPDATE public.tb_arena_category SET is_active = FALSE, updated_at = NOW()
        WHERE is_active = TRUE AND NOT (category_id = ANY($1::text[]))`,
      [catIds]
    );
    summary.deactivatedCategories = offCats.rowCount;
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { ok: true, applied: apply, summary };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

module.exports = { validateCatalog, syncCatalog };
