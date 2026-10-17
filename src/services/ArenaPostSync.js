// Registro canônico dos postes de conquista da Arena (mig 282).
//
// O documento vem do GERADOR do mundo (repositório freelandoo-arena,
// `npm run world:posts`): os mesmos ids e coordenadas que o servidor de jogo
// usa para validar a distância. Nada aqui inventa poste.
//
// Regras:
//   - poste novo nasce com `competitive = FALSE` (só pontua com --competitive,
//     decisão do proprietário) e `valid_from` = PRÓXIMA hora cheia — mudar o
//     mapa nunca cria um poste novo no meio de uma janela já em andamento;
//   - poste que mudou de lugar/versão é atualizado, mantendo o id (a cota da
//     janela é pelo id: não nasce direito novo);
//   - poste que sumiu do documento é DESATIVADO, nunca apagado (há fatos
//     aceitos apontando para ele);
//   - só ambientes br-<uf>; laboratório nunca entra.

const ENV_ID = /^br-[a-z]{2}$/;
const POST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function validate(doc) {
  const errors = [];
  if (!doc || typeof doc !== "object" || !Array.isArray(doc.posts)) return ["documento sem `posts`"];
  if (doc.posts.length > 20_000) errors.push("posts demais");
  const seen = new Set();
  for (const [i, p] of doc.posts.entries()) {
    const at = `posts[${i}]`;
    if (!ENV_ID.test(p?.environmentId || "")) errors.push(`${at}.environmentId`);
    if (!POST_ID.test(p?.postId || "") || p.postId.length > 64) errors.push(`${at}.postId`);
    for (const k of ["x", "y"]) if (!Number.isFinite(p?.[k]) || Math.abs(p[k]) > 20_000) errors.push(`${at}.${k}`);
    if (!Number.isFinite(p?.radiusM) || p.radiusM <= 0 || p.radiusM > 50) errors.push(`${at}.radiusM`);
    for (const k of ["mapVersion", "generatorVersion"]) if (!Number.isInteger(p?.[k]) || p[k] < 0) errors.push(`${at}.${k}`);
    const key = `${p?.environmentId}/${p?.postId}`;
    if (seen.has(key)) errors.push(`${at}: repetido ${key}`);
    seen.add(key);
  }
  return errors;
}

/**
 * Sincroniza. `environments`: limita a esses ambientes (os outros ficam
 * intocados). `competitive`: liga a pontuação dos postes tocados.
 * `validFromNow`: SÓ teste — vale a partir da hora ATUAL.
 */
async function syncPosts(client, doc, { apply = false, environments = null, competitive = false, validFromNow = false } = {}) {
  const errors = validate(doc);
  if (errors.length) return { ok: false, errors };
  const posts = doc.posts.filter((p) => !environments || environments.includes(p.environmentId));
  const envs = [...new Set(posts.map((p) => p.environmentId))];
  const summary = { insert: 0, update: 0, unchanged: 0, deactivate: 0, environments: envs.length, competitive };
  await client.query("BEGIN");
  try {
    const validFrom = validFromNow
      ? `date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`
      : `(date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') + INTERVAL '1 hour') AT TIME ZONE 'UTC'`;
    for (const env of envs) {
      const current = new Map(
        (
          await client.query(
            `SELECT post_id, map_version, generator_version, x::float8 AS x, y::float8 AS y, radius_m::float8 AS radius_m, competitive, is_active
               FROM public.tb_arena_post WHERE environment_id = $1 FOR UPDATE`,
            [env]
          )
        ).rows.map((r) => [r.post_id, r])
      );
      const wanted = posts.filter((p) => p.environmentId === env);
      const keep = new Set();
      for (const p of wanted) {
        keep.add(p.postId);
        const cur = current.get(p.postId);
        const same =
          cur &&
          cur.is_active &&
          cur.map_version === p.mapVersion &&
          cur.generator_version === p.generatorVersion &&
          Math.abs(cur.x - p.x) < 1e-3 &&
          Math.abs(cur.y - p.y) < 1e-3 &&
          Math.abs(cur.radius_m - p.radiusM) < 1e-3 &&
          cur.competitive === competitive;
        if (same) {
          summary.unchanged++;
          continue;
        }
        if (cur) summary.update++;
        else summary.insert++;
        if (!apply) continue;
        await client.query(
          `INSERT INTO public.tb_arena_post
             (environment_id, post_id, map_version, generator_version, x, y, radius_m, competitive, is_active, valid_from)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, ${validFrom})
           ON CONFLICT (environment_id, post_id) DO UPDATE SET
             map_version = EXCLUDED.map_version, generator_version = EXCLUDED.generator_version,
             x = EXCLUDED.x, y = EXCLUDED.y, radius_m = EXCLUDED.radius_m,
             competitive = EXCLUDED.competitive, is_active = TRUE,
             -- Reativado ou movido: só vale a partir da próxima hora.
             valid_from = CASE WHEN public.tb_arena_post.is_active = FALSE
                                 OR public.tb_arena_post.x <> EXCLUDED.x OR public.tb_arena_post.y <> EXCLUDED.y
                               THEN EXCLUDED.valid_from ELSE public.tb_arena_post.valid_from END,
             updated_at = NOW()`,
          [env, p.postId, p.mapVersion, p.generatorVersion, p.x, p.y, p.radiusM, competitive]
        );
      }
      for (const [id, cur] of current) {
        if (keep.has(id) || !cur.is_active) continue;
        summary.deactivate++;
        if (apply) {
          await client.query(`UPDATE public.tb_arena_post SET is_active = FALSE, updated_at = NOW() WHERE environment_id = $1 AND post_id = $2`, [env, id]);
        }
      }
    }
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { ok: true, summary };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  }
}

module.exports = { syncPosts, validate };
