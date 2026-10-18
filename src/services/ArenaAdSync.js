// Registro de espaços e importação de campanhas/criativos da Arena (mig 286).
//
// Espaços: documento gerado pelo MESMO gerador do mundo (repositório
// freelandoo-arena, `npm run ads:placements`). Só classe comercial entra.
// Espaço que sumiu do documento é DESATIVADO, nunca apagado (há reservas e
// sinais apontando para ele).
//
// Campanhas/criativos: documento gerado pela ingestão da Arena
// (`npm run ads:ingest`), que só aceita criativo aprovado por operador e mediu
// cada arquivo. Campanha nova nasce em RASCUNHO e com aprovação PENDENTE —
// aprovar e ativar é operação explícita (scripts/arena-ads-ops.js). Versão de
// criativo é imutável: mesma versão com outro conteúdo é recusada.

const rules = require("../utils/arenaAds");

function validatePlacements(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.placements)) return ["documento sem `placements`"];
  if (doc.placements.length > 50_000) errors.push("espaços demais");
  const ids = new Set();
  const keys = new Set();
  for (const [i, p] of doc.placements.entries()) {
    const at = `placements[${i}]`;
    if (!rules.isEnvironmentId(p?.environmentId)) errors.push(`${at}.environmentId`);
    for (const k of ["mapVersion", "generatorVersion"]) if (!Number.isInteger(p?.[k]) || p[k] < 0) errors.push(`${at}.${k}`);
    if (!rules.isSlug(p?.instanceId)) errors.push(`${at}.instanceId`);
    if (!rules.isSlot(p?.slot)) errors.push(`${at}.slot`);
    if (!rules.isSlug(p?.assetId)) errors.push(`${at}.assetId`);
    if (!rules.SLOT_CLASSES.includes(p?.slotClass)) errors.push(`${at}.slotClass`);
    for (const k of ["x", "y"]) if (!Number.isFinite(p?.[k]) || Math.abs(p[k]) > 20_000) errors.push(`${at}.${k}`);
    if (!Number.isFinite(p?.aspect) || p.aspect <= 0 || p.aspect >= 100) errors.push(`${at}.aspect`);
    // O id tem que ser o DERIVADO da chave natural (ninguém escolhe id à mão).
    if (p && rules.isPlacementId(p.placementId)) {
      if (p.placementId !== rules.placementIdFor(p)) errors.push(`${at}: id não corresponde à chave natural`);
    } else errors.push(`${at}.placementId`);
    if (ids.has(p?.placementId)) errors.push(`${at}: colisão de id ${p?.placementId}`);
    const nk = p ? rules.naturalKey(p) : "";
    if (keys.has(nk)) errors.push(`${at}: repetido ${nk}`);
    ids.add(p?.placementId);
    keys.add(nk);
  }
  return errors;
}

async function syncPlacements(client, doc, { apply = false, environments = null } = {}) {
  const errors = validatePlacements(doc);
  if (errors.length) return { ok: false, errors };
  const wanted = doc.placements.filter((p) => p.slotClass === "commercial" && (!environments || environments.includes(p.environmentId)));
  const envs = [...new Set(wanted.map((p) => p.environmentId))];
  const summary = { insert: 0, update: 0, unchanged: 0, deactivate: 0, environments: envs.length, ignoredNonCommercial: doc.placements.length - doc.placements.filter((p) => p.slotClass === "commercial").length };
  await client.query("BEGIN");
  try {
    for (const env of envs) {
      const current = new Map(
        (await client.query(`SELECT placement_id, is_active, x::float8 AS x, y::float8 AS y, aspect::float8 AS aspect FROM public.tb_arena_ad_placement WHERE environment_id = $1 FOR UPDATE`, [env])).rows.map((r) => [r.placement_id, r])
      );
      const keep = new Set();
      for (const p of wanted.filter((x) => x.environmentId === env)) {
        keep.add(p.placementId);
        const cur = current.get(p.placementId);
        if (cur && cur.is_active && Math.abs(cur.x - p.x) < 1e-3 && Math.abs(cur.y - p.y) < 1e-3 && Math.abs(cur.aspect - p.aspect) < 1e-3) {
          summary.unchanged++;
          continue;
        }
        if (cur) summary.update++;
        else summary.insert++;
        if (!apply) continue;
        await client.query(
          `INSERT INTO public.tb_arena_ad_placement
             (placement_id, natural_key, environment_id, map_version, generator_version, instance_id, slot, asset_id, slot_class, x, y, aspect)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'commercial', $9, $10, $11)
           ON CONFLICT (placement_id) DO UPDATE SET
             x = EXCLUDED.x, y = EXCLUDED.y, aspect = EXCLUDED.aspect, is_active = TRUE,
             registry_revision = public.tb_arena_ad_placement.registry_revision + 1, updated_at = NOW()`,
          [p.placementId, rules.naturalKey(p), env, p.mapVersion, p.generatorVersion, p.instanceId, p.slot, p.assetId, p.x, p.y, Math.round(p.aspect * 10000) / 10000]
        );
      }
      for (const [id, cur] of current) {
        if (keep.has(id) || !cur.is_active) continue;
        summary.deactivate++;
        if (apply) await client.query(`UPDATE public.tb_arena_ad_placement SET is_active = FALSE, updated_at = NOW() WHERE placement_id = $1`, [id]);
      }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { ok: true, summary };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

function validateCampaign(c) {
  const errors = [];
  if (!rules.isCampaignCode(c?.code)) errors.push(`campanha ${c?.code}: code`);
  for (const [k, max] of [["sponsorLabel", 80], ["responsible", 120]]) if (rules.cleanText(c?.[k], max, { required: true }).error) errors.push(`campanha ${c?.code}: ${k}`);
  if (typeof c?.isDemo !== "boolean") errors.push(`campanha ${c?.code}: isDemo`);
  if (Number.isNaN(Date.parse(c?.startsAt)) || Number.isNaN(Date.parse(c?.endsAt)) || Date.parse(c.endsAt) <= Date.parse(c.startsAt)) errors.push(`campanha ${c?.code}: janela (fim exclusivo > início)`);
  if (rules.cleanText(c?.notes, 500).error) errors.push(`campanha ${c?.code}: notes`);
  return errors;
}

async function syncAds(client, doc, { apply = false } = {}) {
  const errors = [];
  if (!doc || !Array.isArray(doc.campaigns) || !Array.isArray(doc.creatives)) return { ok: false, errors: ["documento sem campaigns/creatives"] };
  for (const c of doc.campaigns) errors.push(...validateCampaign(c));
  const creatives = [];
  for (const c of doc.creatives) {
    const v = rules.validateCreativeDoc(c);
    if (v.errors) errors.push(...v.errors);
    else creatives.push(v.value);
  }
  const codes = new Set(doc.campaigns.map((c) => c.code));
  for (const c of creatives) if (!codes.has(c.campaignCode)) errors.push(`criativo de campanha ausente: ${c.campaignCode}`);
  if (errors.length) return { ok: false, errors };
  const summary = { campaignsCreated: 0, campaignsUpdated: 0, creativesCreated: 0, creativesUnchanged: 0 };
  await client.query("BEGIN");
  try {
    for (const c of doc.campaigns) {
      const cur = (await client.query(`SELECT * FROM public.tb_arena_ad_campaign WHERE code = $1 FOR UPDATE`, [c.code])).rows[0];
      if (!cur) {
        summary.campaignsCreated++;
        await client.query(
          `INSERT INTO public.tb_arena_ad_campaign (code, sponsor_label, responsible_label, is_demo, starts_at, ends_at, notes)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [c.code, c.sponsorLabel.trim(), c.responsible.trim(), c.isDemo, c.startsAt, c.endsAt, c.notes ?? null]
        );
      } else if (cur.sponsor_label !== c.sponsorLabel.trim() || cur.responsible_label !== c.responsible.trim() || cur.is_demo !== c.isDemo) {
        // Janela e estado NÃO são tocados pela importação: são operação.
        summary.campaignsUpdated++;
        await client.query(
          `UPDATE public.tb_arena_ad_campaign SET sponsor_label = $2, responsible_label = $3, is_demo = $4, revision = revision + 1, updated_at = NOW() WHERE code = $1`,
          [c.code, c.sponsorLabel.trim(), c.responsible.trim(), c.isDemo]
        );
      }
    }
    for (const v of creatives) {
      const camp = (await client.query(`SELECT id_campaign FROM public.tb_arena_ad_campaign WHERE code = $1`, [v.campaignCode])).rows[0];
      const cur = (await client.query(`SELECT content_hash FROM public.tb_arena_ad_creative WHERE id_campaign = $1 AND version = $2`, [camp.id_campaign, v.version])).rows[0];
      if (cur) {
        if (cur.content_hash !== v.contentHash) throw Object.assign(new Error(`${v.campaignCode}@v${v.version}: versão publicada é imutável (conteúdo diferente). Crie a versão ${v.version + 1}.`), { code: "ARENA_CREATIVE_IMMUTABLE" });
        summary.creativesUnchanged++;
        continue;
      }
      summary.creativesCreated++;
      await client.query(
        `INSERT INTO public.tb_arena_ad_creative
           (id_campaign, version, kind, far_ref, near_ref, poster_ref, video_ref, video_duration_ms, video_mime, assets, content_hash,
            alt_text, headline, body, cta_label, cta_url, approval_status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, 'approved')`,
        [camp.id_campaign, v.version, v.kind, v.farRef, v.nearRef, v.posterRef, v.videoRef, v.videoDurationMs, v.videoMime, JSON.stringify(v.assets), v.contentHash, v.alt, v.headline, v.body, v.ctaLabel, v.ctaUrl]
      );
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { ok: true, summary };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    if (err.code === "ARENA_CREATIVE_IMMUTABLE") return { ok: false, errors: [err.message] };
    throw err;
  }
}

module.exports = { syncPlacements, validatePlacements, syncAds };
