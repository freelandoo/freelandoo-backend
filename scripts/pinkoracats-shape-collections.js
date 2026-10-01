/**
 * Troca as coleções da Loja da Pinkoracats ("New Drop", "Pink", "Dark"…) pelas
 * coleções de FORMATO de unha — Stiletto, Almond, Quadrada, Bailarina, Duck
 * nails e Garras — e põe cada produto na coleção do formato dele.
 *
 * Pedido do Alex (2026-10-01): o formato deixa de ser lido de uma linha da
 * descrição ("• Formato stiletto") e passa a ser a COLEÇÃO do produto, que a
 * Taiz escolhe num select. O tema do site reconhece a coleção de formato pelo
 * nome/endereço (`content/shapes.ts`).
 *
 * Para mover os produtos que já existem, o formato de cada um sai da linha
 * "Formato …" da descrição ATUAL (a mesma regra que o site usava). Produto sem
 * essa linha fica sem coleção — aparece no site como "Peças".
 *
 * ⚠️ PASSA PELOS SERVICES, NUNCA POR SQL CRU — mesma porta da tela da Taiz.
 * As coleções antigas são apagadas pelo soft delete do service (nenhum
 * produto é apagado). Idempotente: rodar de novo não duplica nada.
 *
 * Uso: node scripts/pinkoracats-shape-collections.js          (simulação)
 *      node scripts/pinkoracats-shape-collections.js --apply  (grava)
 */
require("dotenv").config();

const pool = require("../src/databases");
const ProductCollectionService = require("../src/services/ProductCollectionService");
const ProductCollectionStorage = require("../src/storages/ProductCollectionStorage");
const ProfileProductService = require("../src/services/ProfileProductService");
const ProfileProductStorage = require("../src/storages/ProfileProductStorage");

const ID_USER = "d85185a4-6d69-4233-a107-d20921834f59";
const ID_PROFILE = "cd3abc4f-e743-4017-b13e-7c3e53593740";
const APPLY = process.argv.includes("--apply");

/** Mesma ordem e mesmo reconhecimento de `content/shapes.ts` no tema. */
const SHAPES = [
  { slug: "stiletto", name: "Stiletto", kicker: "Formato", match: /stiletto/,
    description: "Ponta fina e alongada: o formato mais dramático da casa." },
  { slug: "almond", name: "Almond", kicker: "Formato", match: /almond|amendoad/,
    description: "Amendoado: lateral afinando até uma ponta arredondada." },
  { slug: "quadrada", name: "Quadrada", kicker: "Formato", match: /quadrad|square/,
    description: "Ponta reta e cantos marcados, do curto ao longo." },
  { slug: "bailarina", name: "Bailarina", kicker: "Formato", match: /bailarin|ballerina|coffin/,
    description: "Lateral afinando e ponta reta: a sapatilha de balé." },
  { slug: "duck", name: "Duck nails", kicker: "Formato", match: /\bduck|pato/,
    description: "A ponta abre, mais larga que a base." },
  { slug: "garras", name: "Garras", kicker: "Formato", match: /garra|claw/,
    description: "Curvatura de garra, ponta afiada." },
];
const SHAPE_SLUGS = new Set(SHAPES.map((s) => s.slug));

const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

function shapeOf(description) {
  for (const raw of String(description || "").split(/\r?\n/)) {
    const l = norm(raw.trim().replace(/^[•\-*]\s+/, ""));
    if (!l.startsWith("formato")) continue;
    const s = SHAPES.find((x) => x.match.test(l));
    if (s) return s.slug;
  }
  return null;
}

async function main() {
  const user = { id_user: ID_USER };
  const params = { id_profile: ID_PROFILE };

  const existing = await ProductCollectionStorage.listByProfile(pool, ID_PROFILE);
  const bySlug = new Map(existing.map((c) => [c.slug, c]));
  const plan = { created: [], moved: [], removed: [] };

  for (const [i, s] of SHAPES.entries()) {
    if (bySlug.has(s.slug)) continue;
    plan.created.push(s.name);
    if (!APPLY) continue;
    const r = await ProductCollectionService.create(user, params, {
      slug: s.slug, name: s.name, kicker: s.kicker, description: s.description, sort_order: i,
    });
    if (r.error) throw new Error(`coleção ${s.slug}: ${r.error}`);
    bySlug.set(s.slug, r.collection);
  }

  const products = await ProfileProductStorage.list(pool, ID_PROFILE);
  for (const p of products) {
    const shape = shapeOf(p.description);
    const target = shape ? bySlug.get(shape) : null;
    const targetId = target ? Number(target.id_collection) : null;
    if (target && (p.id_collection == null ? null : Number(p.id_collection)) === targetId) continue;
    if (!shape && p.id_collection == null) continue;
    plan.moved.push(`${p.name} → ${shape ? SHAPES.find((x) => x.slug === shape).name : "(sem coleção)"}`);
    if (!APPLY) continue;
    const r = await ProfileProductService.update(
      user,
      { id_profile: ID_PROFILE, id_profile_product: p.id_profile_product },
      { id_collection: targetId }
    );
    if (r.error) throw new Error(`produto ${p.name}: ${r.error}`);
  }

  for (const c of existing) {
    if (SHAPE_SLUGS.has(c.slug)) continue;
    plan.removed.push(c.name);
    if (!APPLY) continue;
    const r = await ProductCollectionService.remove(user, { id_profile: ID_PROFILE, id_collection: c.id_collection });
    if (r.error) throw new Error(`apagar ${c.slug}: ${r.error}`);
  }

  console.log(JSON.stringify({ apply: APPLY, ...plan }, null, 2));
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(err.message);
    await pool.end();
    process.exit(1);
  });
