// src/utils/meuMundoStatues.js — MEU MUNDO 3D: as estátuas dos deuses (mm3d-50).
//
// Os Sete e Morkhan em pedra cinza (MEU MUNDO 3D/pipeline/build_estatuas.py):
// Aurion com 10 m no meio de cada bairro (onde se nasce), os outros seis em
// púlpitos em volta dele, e Morkhan com 10 m no meio da praça do centro, com a
// fera aos pés. QUEM fica ONDE é da planta de cada lugar (meuMundoLayout.js e
// meuMundoCenter.js); aqui mora só o catálogo dos modelos publicados e a forma
// de cada entrada:
//   { id, x, z, rot, height, base: { kind: "pedestal" | "pulpit" | "none", r, h } }
// "none" = em cima da base de outra estátua (a fera no pedestal do Morkhan):
// sem desenho nem colisão próprios, só a altura `h` de onde ela fica.
// `rot` = rotação em Y com a FRENTE no −Z local (a mesma conta dos lotes);
// `height` = altura da estátua em metros (o modelo tem 1 m); a estátua fica
// em cima da base (`base.h`). O cliente desenha a base e baixa o modelo.

const fs = require("fs");
const path = require("path");

const round = (v) => Math.round(v * 1000) / 1000;

// Gerado por MEU MUNDO 3D/pipeline/publish_estatuas.py (hash no nome). Sem o
// arquivo, o cliente desenha só as bases (a colisão continua).
const ASSETS_FILE = path.join(__dirname, "meuMundoStatueAssets.json");
function loadAssets() {
  try {
    const a = JSON.parse(fs.readFileSync(ASSETS_FILE, "utf8"));
    if (!a || typeof a.basePath !== "string" || !a.models) return null;
    const models = {};
    for (const [id, f] of Object.entries(a.models)) if (/^[a-z0-9-]+$/.test(id) && /^[a-z0-9._-]+\.glb$/i.test(f)) models[id] = f;
    return Object.freeze({ version: String(a.version || ""), basePath: a.basePath, models: Object.freeze(models) });
  } catch {
    return null;
  }
}
const STATUE_ASSETS = loadAssets();

const statue = (id, x, z, rot, height, base) =>
  Object.freeze({ id, x: round(x), z: round(z), rot: round(rot), height, base: Object.freeze(base) });

/** Caixas de colisão da base (a estátua fica em cima; ninguém sobe). */
function statueBoxes(list) {
  const out = [];
  for (const s of list) {
    if (s.base.kind === "none") continue;
    if (s.base.kind === "pedestal") {
      // Octógono: duas caixas, uma girada 45°.
      const hx = round(s.base.r * 0.93);
      out.push({ x: s.x, z: s.z, hx, hz: hx, rot: 0, h: s.base.h });
      out.push({ x: s.x, z: s.z, hx, hz: hx, rot: round(Math.PI / 4), h: s.base.h });
    } else {
      out.push({ x: s.x, z: s.z, hx: s.base.r, hz: s.base.r, rot: s.rot, h: round(s.base.h + s.height) });
    }
  }
  return out;
}

module.exports = { STATUE_ASSETS, statue, statueBoxes };
