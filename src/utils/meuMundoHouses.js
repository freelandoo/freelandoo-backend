// src/utils/meuMundoHouses.js
//
// MEU MUNDO 3D — CATÁLOGO ÚNICO dos níveis de casa (01–10).
//
// Tudo que define um nível mora aqui: nome, asset de runtime (nome com hash,
// servido pelo frontend em /meu-mundo/casas/), miniatura, implantação no lote,
// dimensões, colisores, porta e pontos de interação. O payload do bairro leva
// este catálogo inteiro; o cliente NÃO guarda caminhos nem medidas próprias, e
// nunca envia uma URL de modelo — só pede um NÚMERO de nível, que o servidor
// confere aqui.
//
// Nível 01 = a casa que o jogo sempre desenhou (geometria gerada no cliente,
// medidas em HOUSE_L1). Níveis 02–09 = modelos do Tripo processados no
// Blender (MEU MUNDO 3D/pipeline/casas → build_houses.py → gltfpack →
// publish.py, que escreve meuMundoHouseCatalog.json). Nível 10: o arquivo não
// foi fornecido (a pasta MEU MUNDO 3D/casas só tem 02–09) — fica no catálogo
// como INDISPONÍVEL, e o servidor recusa escolhê-lo.
//
// Quadro local do lote: metros, origem no centro do terreno, FRENTE no -Z.

const data = require("./meuMundoHouseCatalog.json");

const MAX_LEVEL = 10;

function round(v) {
  return Math.round(v * 1000) / 1000;
}

/**
 * Monta o catálogo a partir do plano do lote. Chamado pelo meuMundoLayout
 * (que é dono do LOT_PLAN e do HOUSE_L1) para não haver segunda cópia.
 */
function buildCatalog(plan, houseL1, buildable) {
  const hf = plan.houseFront.z;
  // Degrau da casa 01 avança 0,45 m além da fachada. Os modelos novos têm a
  // ORIGEM na frente dos degraus — vão exatamente para o mesmo lugar.
  const stepFront = round(hf - (houseL1.stepDepth - 0.15));
  const levels = [];

  for (let n = 1; n <= MAX_LEVEL; n++) {
    const id = `level-${String(n).padStart(2, "0")}`;
    if (n === 1) {
      const hc = hf + houseL1.depth / 2;
      levels.push({
        level: 1,
        id,
        available: true,
        kind: "builtin",
        asset: null,
        thumb: data.levels["1"]?.thumb || null,
        size: { width: houseL1.width, depth: houseL1.depth, height: houseL1.height },
        // Ocupação no lote (para conferência): do degrau aos fundos.
        extent: { minX: -houseL1.width / 2, maxX: houseL1.width / 2, minZ: stepFront, maxZ: round(hf + houseL1.depth) },
        origin: { x: plan.houseFront.x, z: stepFront },
        door: { x: plan.houseFront.x, z: hf },
        pathEnd: { x: plan.houseFront.x, z: stepFront },
        colliders: [[plan.houseFront.x, round(hc), houseL1.width / 2, houseL1.depth / 2, houseL1.height]],
        tris: null,
        bytes: 0,
      });
      continue;
    }
    const d = data.levels[String(n)];
    if (!d || !d.asset) {
      levels.push({ level: n, id, available: false, kind: "missing", asset: null, thumb: null });
      continue;
    }
    const oz = stepFront;
    levels.push({
      level: n,
      id,
      available: true,
      kind: "glb",
      asset: d.asset,
      thumb: d.thumb,
      size: { width: d.size[0], depth: d.size[1], height: d.size[2] },
      extent: {
        minX: d.extent.minX,
        maxX: d.extent.maxX,
        minZ: oz,
        maxZ: round(oz + d.extent.depth),
      },
      origin: { x: 0, z: oz },
      door: { x: d.doorX, z: oz },
      pathEnd: { x: d.doorX, z: oz },
      colliders: d.colliders.map(([x, z, hx, hz, h]) => [round(x), round(oz + z), hx, hz, h]),
      bytes: d.bytes,
    });
  }

  // A casa nunca sai da área edificável (rua, calçada e lote vizinho ficam
  // fora dela por definição). Falha aqui = o boot recusa, não a produção.
  for (const l of levels) {
    if (!l.available) continue;
    const e = l.extent;
    const ok =
      e.minX >= buildable.minX - 1e-6 &&
      e.maxX <= buildable.maxX + 1e-6 &&
      e.maxZ <= buildable.maxZ + 1e-6 &&
      e.minZ >= buildable.minZ - 1e-6;
    if (!ok) throw new Error(`meuMundoHouses: nível ${l.level} sai da área edificável`);
  }
  return Object.freeze(levels.map((l) => Object.freeze(l)));
}

module.exports = { buildCatalog, MAX_LEVEL, ASSET_VERSION: data.assetVersion };
