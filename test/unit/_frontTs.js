// test/unit/_frontTs.js — deixa o teste do back carregar a sim TS do jetpack do
// front (mm3d-21). O Node 24 já remove os tipos de .ts sozinho; aqui só
// completamos ".ts" nos imports relativos sem extensão (padrão do front).
// Front fora do lugar (CI só com o back) → frontSim() devolve null e o teste pula.
"use strict";

const path = require("path");
const fs = require("fs");
const { registerHooks } = require("module");
const { pathToFileURL } = require("url");

const JETPACK = path.resolve(__dirname, "../../../freelandoo frontend/freelandoo-website-main/features/meu-mundo/jetpack");
let hooked = false;

function hook() {
  if (hooked) return;
  hooked = true;
  registerHooks({
    resolve(spec, ctx, next) {
      if (ctx.parentURL && /\/jetpack\//.test(ctx.parentURL) && spec.startsWith(".") && !path.extname(spec)) {
        try {
          return next(spec + ".ts", ctx);
        } catch {
          /* cai na resolução normal */
        }
      }
      return next(spec, ctx);
    },
  });
}

/** Carrega um módulo da pasta do jetpack (ex.: "sim/world.ts"); null se o front não estiver ao lado. */
async function loadFront(rel) {
  if (!fs.existsSync(JETPACK)) return null;
  hook();
  return import(pathToFileURL(path.join(JETPACK, rel)).href);
}

module.exports = { loadFront, JETPACK };
