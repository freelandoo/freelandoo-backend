#!/usr/bin/env node
/**
 * arch-scan — varre os dois repos (backend + frontend) e gera o manifesto do
 * Painel de Arquitetura (src/databases/seeds/arch-manifest.json).
 *
 * Roda LOCALMENTE / no deploy, onde o .git existe (produção não enxerga git
 * em runtime). O backend carrega o manifesto no boot (ArchitectureService.sync).
 *
 * O que detecta:
 *   - Backend: rotas montadas (kind=route), services (kind=service). Órfão =
 *     arquivo de rota não montado no index.js, ou service que ninguém requer.
 *   - Frontend: páginas (kind=page), proxies api (kind=proxy), componentes
 *     (kind=component/button). Órfão = componente NÃO alcançável a partir das
 *     páginas/layouts (BFS sobre o grafo de imports) — pega o caso clássico do
 *     botão construído mas nunca montado (ex: PolensCard).
 *   - Git por arquivo: committed (sem alteração pendente), pushed (commit é
 *     ancestral de origin/main), sha/msg/data do último commit.
 *
 * Uso:
 *   node scripts/arch-scan.js
 *   ARCH_FRONTEND_ROOT="/caminho/front" node scripts/arch-scan.js
 *
 * Não tem dependências externas (fs/path/child_process apenas).
 */
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const BACKEND_ROOT = path.resolve(__dirname, "..");
const FRONTEND_ROOT =
  process.env.ARCH_FRONTEND_ROOT ||
  path.resolve(BACKEND_ROOT, "..", "freelandoo frontend", "freelandoo-website-main");
const OUT = path.join(BACKEND_ROOT, "src", "databases", "seeds", "arch-manifest.json");

const SRC_EXTS = [".tsx", ".ts", ".jsx", ".js"];

// ---------------------------------------------------------------------------
// utils de fs
// ---------------------------------------------------------------------------
function walk(dir, { ignore = [] } = {}) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (["node_modules", "dist", "build", ".next", "storage", "coverage"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (ignore.some((ig) => full.includes(ig))) continue;
    if (entry.isDirectory()) out.push(...walk(full, { ignore }));
    else out.push(full);
  }
  return out;
}

function readSafe(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return ""; }
}

function rel(root, file) {
  return path.relative(root, file).replace(/\\/g, "/");
}

// ---------------------------------------------------------------------------
// git
// ---------------------------------------------------------------------------
function gitContext(repoRoot) {
  const dirty = new Set();
  let hasOrigin = false;
  try {
    const out = execSync("git status --porcelain", { cwd: repoRoot, encoding: "utf8" });
    for (const line of out.split("\n")) {
      const body = line.slice(3).trim();
      if (!body) continue;
      const file = body.includes(" -> ") ? body.split(" -> ")[1] : body;
      dirty.add(file.replace(/^"|"$/g, ""));
    }
  } catch {}
  for (const ref of ["origin/main", "origin/master"]) {
    try {
      execSync(`git rev-parse --verify ${ref}`, { cwd: repoRoot, stdio: "ignore" });
      hasOrigin = ref;
      break;
    } catch {}
  }
  return { dirty, hasOrigin };
}

function gitStamp(repoRoot, ctx, relPath) {
  const blank = {
    git_committed: false, git_pushed: false,
    last_commit_sha: null, last_commit_msg: null, last_commit_at: null,
  };
  try {
    const out = execSync(
      `git log -1 --format=%H%x09%ct%x09%s -- "${relPath}"`,
      { cwd: repoRoot, encoding: "utf8" }
    ).trim();
    if (!out) return blank; // nunca commitado
    const [sha, ts, ...rest] = out.split("\t");
    const committed = !ctx.dirty.has(relPath);
    let pushed = false;
    if (ctx.hasOrigin) {
      try {
        execSync(`git merge-base --is-ancestor ${sha} ${ctx.hasOrigin}`, { cwd: repoRoot, stdio: "ignore" });
        pushed = committed; // só "pushado" se também não há mudança local pendente
      } catch { pushed = false; }
    }
    return {
      git_committed: committed,
      git_pushed: pushed,
      last_commit_sha: sha.slice(0, 12),
      last_commit_msg: rest.join("\t").slice(0, 200),
      last_commit_at: new Date(Number(ts) * 1000).toISOString(),
    };
  } catch {
    return blank;
  }
}

// ---------------------------------------------------------------------------
// imports / reachability (frontend e backend)
// ---------------------------------------------------------------------------
const IMPORT_RE =
  /(?:import\s+[^'"]*?from\s*|import\s*|export\s+[^'"]*?from\s*|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

function extractImports(src) {
  const specs = [];
  let m;
  IMPORT_RE.lastIndex = 0;
  while ((m = IMPORT_RE.exec(src))) specs.push(m[1]);
  return specs;
}

function resolveImport(root, fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(fromFile), spec);
  else return null; // pacote npm
  const candidates = [
    base,
    ...SRC_EXTS.map((e) => base + e),
    ...SRC_EXTS.map((e) => path.join(base, "index" + e)),
  ];
  for (const c of candidates) {
    try { if (fs.statSync(c).isFile()) return path.normalize(c); } catch {}
  }
  return null;
}

/** Conjunto de arquivos alcançáveis (BFS) a partir das entradas. */
function reachableSet(root, files, entryFiles) {
  const adj = new Map();
  for (const f of files) {
    const src = readSafe(f);
    const targets = [];
    for (const spec of extractImports(src)) {
      const resolved = resolveImport(root, f, spec);
      if (resolved) targets.push(path.normalize(resolved));
    }
    adj.set(path.normalize(f), targets);
  }
  const seen = new Set();
  const queue = entryFiles.map((f) => path.normalize(f));
  for (const e of queue) seen.add(e);
  while (queue.length) {
    const cur = queue.shift();
    for (const next of adj.get(cur) || []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return seen;
}

// ---------------------------------------------------------------------------
// derivação de área e nome
// ---------------------------------------------------------------------------
const AREA_RULES = [
  [/acasaviews|casa-views|\/casa/i, "Casa Views"],
  [/manifest/i, "Manifestação"],
  [/\bpolen/i, "Poléns"],
  [/premium/i, "Premium"],
  [/stories|story/i, "Stories"],
  [/\bbees?\b/i, "Bees"],
  [/course|curso|aula|lesson|module/i, "Cursos"],
  [/chat/i, "Chat ao vivo"],
  [/mensagens|conversation|message/i, "Mensagens"],
  [/ranking/i, "Ranking"],
  [/enxame|machine/i, "Enxame"],
  [/affiliate|afiliad|cupom|coupon/i, "Afiliados"],
  [/booking|agenda/i, "Agendamentos"],
  [/portfolio/i, "Portfólio"],
  [/loja|store|product|order|checkout|cart/i, "Loja"],
  [/supervis/i, "Supervisão"],
  [/notific/i, "Notificações"],
  [/blog/i, "Blog"],
  [/legal|termos|polit/i, "Legal"],
  [/auth|login|cadastro|signin|signup/i, "Auth"],
  [/admin|administ/i, "Admin"],
  [/home|landing/i, "Home"],
  [/account|perfil|profile/i, "Perfil"],
  [/header|footer|layout|nav|dropside/i, "Layout"],
];

function deriveArea(p) {
  for (const [re, name] of AREA_RULES) if (re.test(p)) return name;
  return "Geral";
}

function componentName(src, file) {
  const patterns = [
    /export\s+default\s+function\s+([A-Z]\w+)/,
    /export\s+function\s+([A-Z]\w+)/,
    /export\s+default\s+([A-Z]\w+)/,
    /export\s+const\s+([A-Z]\w+)\s*[:=]/,
  ];
  for (const re of patterns) {
    const m = src.match(re);
    if (m) return m[1];
  }
  return path.basename(file).replace(/\.(tsx|ts|jsx|js)$/, "");
}

function isButtonLike(name, file) {
  return /button|btn|card|toggle|cta|fab|menu|modal|dialog|sheet/i.test(name + " " + file);
}

// ---------------------------------------------------------------------------
// scan backend
// ---------------------------------------------------------------------------
function scanBackend(fns) {
  const ctx = gitContext(BACKEND_ROOT);
  const routesDir = path.join(BACKEND_ROOT, "src", "routes");
  const servicesDir = path.join(BACKEND_ROOT, "src", "services");

  // Mapa de rotas montadas: lê routes/index.js E app.js (alguns mounts, como
  // /webhooks, são feitos direto no app.js) -> { arquivoRota: mountPath }
  const indexSrc = readSafe(path.join(routesDir, "index.js"));
  const appSrc = readSafe(path.join(BACKEND_ROOT, "src", "app.js"));
  const combined = indexSrc + "\n" + appSrc;
  const requireMap = {}; // varName -> routeFileName
  for (const m of combined.matchAll(/const\s+(\w+)\s*=\s*require\(["']\.(?:\/routes)?\/([\w.]+)["']\)/g)) {
    requireMap[m[1]] = m[2];
  }
  const mounted = {}; // routeFile -> mountPath
  for (const m of combined.matchAll(/app\.use\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g)) {
    const [, mountPath, varName] = m;
    const file = requireMap[varName];
    if (file) mounted[file] = mountPath;
  }

  // Grafo de require do backend para detectar service órfão.
  const backendFiles = walk(path.join(BACKEND_ROOT, "src")).filter((f) => f.endsWith(".js"));
  const requiredSet = new Set();
  for (const f of backendFiles) {
    const src = readSafe(f);
    for (const spec of extractImports(src)) {
      const resolved = resolveImport(BACKEND_ROOT, f, spec);
      if (resolved) requiredSet.add(path.normalize(resolved));
    }
  }

  // Rotas
  for (const f of walk(routesDir).filter((x) => x.endsWith(".routes.js") || x.endsWith("Routes.js"))) {
    const relPath = rel(BACKEND_ROOT, f);
    const base = path.basename(f);
    const key = base.replace(/\.js$/, "");
    const mountPath = mounted[key] || null;
    const src = readSafe(f);
    const endpoints = [...src.matchAll(/router\.(get|post|put|delete|patch)\(/g)].length;
    fns.push({
      fn_key: `backend:route:${key}`,
      title: base,
      description: `Arquivo de rotas (${endpoints} endpoint${endpoints === 1 ? "" : "s"}).`,
      area: deriveArea(relPath),
      kind: "route",
      repo: "backend",
      file_path: relPath,
      mount_path: mountPath,
      status: mountPath ? "live" : "orphan",
      tags: mountPath ? [] : ["nao-montado"],
      ...gitStamp(BACKEND_ROOT, ctx, relPath),
    });
  }

  // Services
  for (const f of walk(servicesDir).filter((x) => x.endsWith(".js"))) {
    const relPath = rel(BACKEND_ROOT, f);
    const base = path.basename(f);
    const required = requiredSet.has(path.normalize(f));
    fns.push({
      fn_key: `backend:service:${base.replace(/\.js$/, "")}`,
      title: base,
      description: "Service (camada de negócio).",
      area: deriveArea(relPath),
      kind: "service",
      repo: "backend",
      file_path: relPath,
      mount_path: required ? "requerido" : null,
      status: required ? "live" : "orphan",
      tags: required ? [] : ["nao-requerido"],
      ...gitStamp(BACKEND_ROOT, ctx, relPath),
    });
  }
}

// ---------------------------------------------------------------------------
// scan frontend
// ---------------------------------------------------------------------------
const ENTRY_RE =
  /(?:^|\/)(page|layout|template|loading|error|global-error|not-found|route|default|sitemap|robots|opengraph-image|icon|apple-icon|manifest)\.(tsx|ts|jsx|js)$/;

function urlFromAppFile(relPath) {
  // app/(group)/foo/[id]/page.tsx -> /foo/[id]
  let p = relPath.replace(/^app\//, "").replace(/\/(page|route|layout)\.(tsx|ts|jsx|js)$/, "");
  p = p
    .split("/")
    .filter((seg) => !(seg.startsWith("(") && seg.endsWith(")"))) // route groups
    .join("/");
  return "/" + p;
}

function scanFrontend(fns) {
  if (!fs.existsSync(FRONTEND_ROOT)) {
    console.warn(`[arch-scan] frontend não encontrado em: ${FRONTEND_ROOT} — pulando.`);
    return;
  }
  const ctx = gitContext(FRONTEND_ROOT);

  const scanDirs = ["app", "components", "features", "lib", "hooks", "context", "providers", "contexts"]
    .map((d) => path.join(FRONTEND_ROOT, d))
    .filter(fs.existsSync);
  const allFiles = scanDirs
    .flatMap((d) => walk(d))
    .filter((f) => SRC_EXTS.some((e) => f.endsWith(e)) && !f.endsWith(".d.ts"));

  // Entradas = arquivos especiais do app/ + middleware/instrumentation
  const entryFiles = allFiles.filter((f) => {
    const r = rel(FRONTEND_ROOT, f);
    return ENTRY_RE.test(r) || /^(middleware|instrumentation)\.(tsx|ts|js)$/.test(path.basename(f));
  });

  const reachable = reachableSet(FRONTEND_ROOT, allFiles, entryFiles);

  for (const f of allFiles) {
    const relPath = rel(FRONTEND_ROOT, f);
    const isApp = relPath.startsWith("app/");
    const base = path.basename(f);
    const src = readSafe(f);
    const stamp = gitStamp(FRONTEND_ROOT, ctx, relPath);

    // Páginas
    if (isApp && /\/page\.(tsx|ts|jsx|js)$/.test(relPath)) {
      const url = urlFromAppFile(relPath);
      fns.push({
        fn_key: `frontend:page:${url}`,
        title: url,
        description: "Página (rota Next.js App Router).",
        area: deriveArea(relPath),
        kind: "page",
        repo: "frontend",
        file_path: relPath,
        mount_path: url,
        status: "live",
        tags: [],
        ...stamp,
      });
      continue;
    }

    // Proxies de API
    if (isApp && /\/route\.(ts|js)$/.test(relPath)) {
      const url = urlFromAppFile(relPath);
      fns.push({
        fn_key: `frontend:proxy:${url}`,
        title: url,
        description: "Proxy / route handler (app/api).",
        area: deriveArea(relPath),
        kind: "proxy",
        repo: "frontend",
        file_path: relPath,
        mount_path: url,
        status: "live",
        tags: [],
        ...stamp,
      });
      continue;
    }

    // Outros arquivos do app/ (layout, loading, etc) — não inventariar como função.
    if (isApp && (ENTRY_RE.test(relPath) || base.startsWith("_"))) continue;
    if (isApp) continue; // helpers locais dentro de app/ — ignora para reduzir ruído

    // Componentes / features / hooks / lib
    const onlyDir = relPath.split("/")[0]; // components | features | lib | hooks ...
    const exportsSomething = /export\s+(default|function|const|class)/.test(src);
    if (!exportsSomething) continue;

    const isComponentDir = ["components", "features"].includes(onlyDir);
    const name = componentName(src, f);
    const isReachable = reachable.has(path.normalize(f));

    // lib/hooks só inventaria se for órfão (ruído baixo); componentes sempre.
    if (!isComponentDir && isReachable) continue;

    const kind = isComponentDir ? (isButtonLike(name, relPath) ? "button" : "component") : "hook";
    fns.push({
      fn_key: `frontend:${kind}:${relPath}`,
      title: name,
      description: isComponentDir
        ? `${kind === "button" ? "Botão/controle" : "Componente"} de UI.`
        : "Helper / hook.",
      area: deriveArea(relPath),
      kind,
      repo: "frontend",
      file_path: relPath,
      mount_path: isReachable ? "alcançável" : null,
      status: isReachable ? "live" : "orphan",
      tags: isReachable ? [] : ["nao-montado"],
      ...stamp,
    });
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const t0 = Date.now();
  const fns = [];
  console.log("[arch-scan] backend:", BACKEND_ROOT);
  scanBackend(fns);
  console.log("[arch-scan] frontend:", FRONTEND_ROOT);
  scanFrontend(fns);

  const orphan = fns.filter((f) => f.status === "orphan").length;
  const uncommitted = fns.filter((f) => !f.git_committed).length;

  const manifest = {
    generated_at: new Date().toISOString(),
    generator: "arch-scan",
    counts: { total: fns.length, orphan, uncommitted },
    functions: fns.sort((a, b) => (a.area || "").localeCompare(b.area || "") || a.title.localeCompare(b.title)),
  };

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2), "utf8");

  console.log(
    `[arch-scan] OK — ${fns.length} funções (${orphan} órfãs, ${uncommitted} não-commitadas) em ${Date.now() - t0}ms`
  );
  console.log(`[arch-scan] manifesto: ${OUT}`);
}

main();
