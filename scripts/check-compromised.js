#!/usr/bin/env node
/**
 * Confere se algum pacote infectado (vermes de npm) entrou nos projetos.
 *
 * Uso:
 *   node scripts/check-compromised.js <pasta|package-lock.json> [...] [--list arquivo.txt] [--offline]
 *
 * O que faz:
 *  1. Acha todo package-lock.json (e o node_modules/.package-lock.json, que é o
 *     que está INSTALADO de fato) dentro das pastas dadas, sem entrar em node_modules.
 *  2. Cruza cada nome@versão com o banco OSV (api.osv.dev), que inclui os avisos
 *     MAL-* de pacote malicioso (ChainDrop, Mini Shai-Hulud, IronWorm e os próximos).
 *  3. Cruza também com uma lista local opcional (--list), uma linha "nome@versão"
 *     ou "nome@*" por linha (# comenta) — para IOC que ainda não entrou no OSV.
 *  4. Lista pacotes instalados que rodam script na instalação e não estão na
 *     lista liberada, e arquivos conhecidos de carga dos vermes no node_modules.
 *
 * Só envia nome e versão de pacote público ao OSV. Sai com código 1 se achar algo.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".vercel", "dist", "build", ".turbo", ".cache"]);
// Pacotes com script de instalação que conhecemos e liberamos (plano 0.4).
const ALLOWED_INSTALL_SCRIPTS = new Set([
  "bcrypt", "sharp", "ffmpeg-static", "msgpackr-extract", "unrs-resolver",
  "esbuild", "@parcel/watcher", "core-js", "protobufjs", "@prisma/engines", "prisma",
  "@prisma/client", "fsevents", "@swc/core", "lightningcss", "@tailwindcss/oxide",
]);
// Nomes de arquivo de carga observados nas ondas de 2025–2026.
const IOC_FILES = new Set(["setup_bun.js", "bun_environment.js", "setup.mjs", "math_init.js", "Math_Symbol.js"]);

function parseArgs(argv) {
  const out = { roots: [], list: null, offline: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--list") out.list = argv[++i];
    else if (a === "--offline") out.offline = true;
    else out.roots.push(a);
  }
  if (!out.roots.length) out.roots.push(process.cwd());
  return out;
}

function findLockfiles(root, acc) {
  let st;
  try { st = fs.statSync(root); } catch { return acc; }
  if (st.isFile()) { acc.push(root); return acc; }
  if (path.basename(root) === "node_modules") { pushNodeModules(root, acc); return acc; }
  let entries;
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(root, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules") {
        pushNodeModules(p, acc);
        continue;
      }
      if (SKIP_DIRS.has(e.name)) continue;
      findLockfiles(p, acc);
    } else if (e.name === "package-lock.json") {
      acc.push(p);
    }
  }
  return acc;
}

// node_modules com lockfile oculto: lê ele; sem (pacotes globais): percorre os package.json.
function pushNodeModules(nm, acc) {
  const hidden = path.join(nm, ".package-lock.json");
  acc.push(fs.existsSync(hidden) ? hidden : "dir:" + nm);
}

function walkInstalled(nm, prefix, pkgs) {
  let entries;
  try { entries = fs.readdirSync(nm, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    let dirs = [e.name];
    if (e.name.startsWith("@")) {
      try {
        dirs = fs.readdirSync(path.join(nm, e.name), { withFileTypes: true })
          .filter((x) => x.isDirectory()).map((x) => e.name + "/" + x.name);
      } catch { dirs = []; }
    }
    for (const d of dirs) {
      const dir = path.join(nm, d);
      let pj;
      try { pj = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8")); } catch { continue; }
      const sc = pj.scripts || {};
      const key = prefix + d;
      if (pj.name && pj.version) {
        pkgs.push({ name: pj.name, version: pj.version, key,
          hasInstallScript: !!(sc.preinstall || sc.install || sc.postinstall) });
      }
      walkInstalled(path.join(dir, "node_modules"), key + "/node_modules/", pkgs);
    }
  }
}

function nameFromPath(key) {
  const i = key.lastIndexOf("node_modules/");
  return i === -1 ? null : key.slice(i + "node_modules/".length);
}

function readLock(file) {
  const pkgs = [];
  if (file.startsWith("dir:")) {
    walkInstalled(file.slice(4), "node_modules/", pkgs);
    return { pkgs };
  }
  let json;
  try { json = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {
    return { pkgs, error: e.message };
  }
  if (json.packages) {
    for (const [key, meta] of Object.entries(json.packages)) {
      if (!key || meta.link) continue;
      const name = meta.name || nameFromPath(key);
      if (!name || !meta.version) continue;
      pkgs.push({ name, version: meta.version, key, hasInstallScript: !!meta.hasInstallScript });
    }
  } else if (json.dependencies) {
    const walk = (deps, prefix) => {
      for (const [name, meta] of Object.entries(deps)) {
        if (meta.version && !String(meta.version).startsWith("file:")) {
          pkgs.push({ name, version: meta.version, key: prefix + name, hasInstallScript: false });
        }
        if (meta.dependencies) walk(meta.dependencies, prefix + name + "/node_modules/");
      }
    };
    walk(json.dependencies, "node_modules/");
  }
  return { pkgs };
}

function loadList(file) {
  const exact = new Set();
  const anyVersion = new Set();
  if (!file) return { exact, anyVersion };
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const at = line.lastIndexOf("@");
    if (at <= 0) { anyVersion.add(line); continue; }
    const name = line.slice(0, at);
    const ver = line.slice(at + 1);
    if (ver === "*" || ver === "") anyVersion.add(name);
    else exact.add(`${name}@${ver}`);
  }
  return { exact, anyVersion };
}

async function queryOsv(items) {
  const hits = new Map(); // "name@ver" -> [ids]
  const BATCH = 1000;
  for (let i = 0; i < items.length; i += BATCH) {
    const chunk = items.slice(i, i + BATCH);
    const body = {
      queries: chunk.map((s) => {
        const at = s.lastIndexOf("@");
        return { package: { name: s.slice(0, at), ecosystem: "npm" }, version: s.slice(at + 1) };
      }),
    };
    let res;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch("https://api.osv.dev/v1/querybatch", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok) break;
      } catch (e) { res = { ok: false, status: e.message }; }
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
    if (!res || !res.ok) throw new Error(`OSV respondeu ${res && res.status}`);
    const data = await res.json();
    data.results.forEach((r, idx) => {
      const ids = (r.vulns || []).map((v) => v.id);
      if (ids.length) hits.set(chunk[idx], ids);
    });
  }
  return hits;
}

// O OSV às vezes não propaga a retirada de um aviso do GitHub (ex.: true@0.0.4,
// GHSA-f59f-vj5q-c725, retirado em 2026-08-05). Só conta como retirado se TODOS
// os avisos GHSA de origem estiverem retirados.
async function isWithdrawn(malId) {
  try {
    const v = await (await fetch(`https://api.osv.dev/v1/vulns/${malId}`)).json();
    if (v.withdrawn) return true;
    const origins = (v.database_specific && v.database_specific["malicious-packages-origins"]) || [];
    const ghsas = [...new Set([...(v.aliases || []), ...origins.map((o) => o.id)])]
      .filter((x) => x && x.startsWith("GHSA-"));
    if (!ghsas.length) return false;
    for (const g of ghsas) {
      const gr = await fetch(`https://api.github.com/advisories/${g}`, { headers: { accept: "application/vnd.github+json" } });
      if (!gr.ok) return false;
      if (!(await gr.json()).withdrawn_at) return false;
    }
    return true;
  } catch { return false; }
}

function scanIocFiles(lockfile) {
  // Só para o lockfile oculto: olha a raiz de cada pacote instalado.
  if (!lockfile.endsWith(path.join("node_modules", ".package-lock.json"))) return [];
  const projectRoot = path.dirname(path.dirname(lockfile));
  const { pkgs } = readLock(lockfile);
  const found = [];
  for (const p of pkgs) {
    const dir = path.join(projectRoot, p.key);
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (IOC_FILES.has(n)) found.push(path.join(dir, n));
  }
  return found;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const list = loadList(args.list);
  const lockfiles = [];
  for (const r of args.roots) findLockfiles(path.resolve(r), lockfiles);

  const where = new Map(); // "name@ver" -> Set(lockfile)
  const scripts = new Map(); // name -> Set(lockfile)
  const errors = [];
  for (const lf of lockfiles) {
    const { pkgs, error } = readLock(lf);
    if (error) { errors.push(`${lf}: ${error}`); continue; }
    for (const p of pkgs) {
      const k = `${p.name}@${p.version}`;
      if (!where.has(k)) where.set(k, new Set());
      where.get(k).add(lf);
      if (p.hasInstallScript && !ALLOWED_INSTALL_SCRIPTS.has(p.name)) {
        if (!scripts.has(k)) scripts.set(k, new Set());
        scripts.get(k).add(lf);
      }
    }
  }

  const all = [...where.keys()];
  console.log(`lockfiles: ${lockfiles.length} · pacote@versão distintos: ${all.length}`);
  errors.forEach((e) => console.log(`  ! não li ${e}`));

  let bad = 0;

  // Lista local
  for (const k of all) {
    const name = k.slice(0, k.lastIndexOf("@"));
    if (list.exact.has(k) || list.anyVersion.has(name)) {
      bad++;
      console.log(`LISTA  ${k}  em ${[...where.get(k)].join(" | ")}`);
    }
  }

  // OSV
  if (!args.offline) {
    const hits = await queryOsv(all);
    let vulnCount = 0;
    for (const [k, ids] of hits) {
      const mal = [];
      for (const id of ids.filter((x) => x.startsWith("MAL-"))) {
        if (await isWithdrawn(id)) console.log(`retirado ${k}  ${id} (aviso retirado pelo GitHub: falso positivo)`);
        else mal.push(id);
      }
      if (mal.length) {
        bad++;
        console.log(`MALWARE ${k}  ${mal.join(",")}  em ${[...where.get(k)].join(" | ")}`);
      } else {
        vulnCount++;
      }
    }
    console.log(`OSV: ${hits.size} com aviso, dos quais ${vulnCount} são falha comum (não malware; ver npm audit)`);
  }

  // Script de instalação fora da lista liberada
  if (scripts.size) {
    console.log(`\nscript de instalação fora da lista liberada (${scripts.size}):`);
    for (const [k, s] of scripts) console.log(`  ${k}  (${s.size} projeto(s))`);
  }

  // Arquivos de carga conhecidos
  const iocs = lockfiles.flatMap(scanIocFiles);
  for (const f of iocs) { bad++; console.log(`ARQUIVO-IOC ${f}`); }

  console.log(bad ? `\n${bad} sinal(is) encontrado(s).` : "\nNenhum pacote malicioso conhecido.");
  process.exit(bad ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
