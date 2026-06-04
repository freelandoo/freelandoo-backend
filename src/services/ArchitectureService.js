const fs = require("fs");
const path = require("path");
const pool = require("../databases");
const ArchitectureStorage = require("../storages/ArchitectureStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ArchitectureService");

function csvCell(value) {
  if (value == null) return "";
  const s = Array.isArray(value) ? value.join("; ") : String(value);
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function functionsToCsv(rows) {
  const header = [
    "area", "title", "kind", "repo", "effective_status", "git_committed",
    "git_pushed", "last_commit_sha", "last_commit_at", "file_path", "mount_path", "notes",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([
      r.area, r.title, r.kind, r.repo, r.effective_status, r.git_committed,
      r.git_pushed, r.last_commit_sha, r.last_commit_at, r.file_path, r.mount_path, r.notes,
    ].map(csvCell).join(","));
  }
  return lines.join("\r\n");
}

// Caminho do manifesto gerado pelo scan (scripts/arch-scan.js). Carimbado com
// git ANTES do deploy, porque produção não enxerga .git em runtime.
const MANIFEST_PATH = path.join(
  __dirname,
  "..",
  "databases",
  "seeds",
  "arch-manifest.json"
);

class ArchitectureService {
  // ---------- Inventário ----------

  static listFunctions(filters) {
    return runWithLogs(log, "arch.listFunctions", () => ({ filters }), async () => {
      const { rows, total, page, perPage } = await ArchitectureStorage.listFunctions(pool, filters);
      return { functions: rows, total, page, per_page: perPage };
    });
  }

  static exportFunctionsCsv(filters) {
    return runWithLogs(log, "arch.exportFunctionsCsv", () => ({ filters }), async () => {
      const { rows } = await ArchitectureStorage.listFunctions(pool, { ...filters, page: 1, perPage: 5000 });
      const date = new Date().toISOString().slice(0, 10);
      return { csv: functionsToCsv(rows), filename: `arch-functions-${date}.csv` };
    });
  }

  static getFunction(id) {
    return runWithLogs(log, "arch.getFunction", () => ({ id }), async () => {
      const fn = await ArchitectureStorage.getFunctionById(pool, id);
      if (!fn) return { error: "Função não encontrada", statusCode: 404 };
      return { function: fn };
    });
  }

  static updateCuration(id, fields, userId) {
    return runWithLogs(log, "arch.updateCuration", () => ({ id }), async () => {
      const existing = await ArchitectureStorage.getFunctionById(pool, id);
      if (!existing) return { error: "Função não encontrada", statusCode: 404 };

      const clean = {};
      if (fields.curated_status !== undefined) {
        const v = fields.curated_status;
        if (v !== null && !["live", "orphan", "wip", "deprecated"].includes(v)) {
          return { error: "Status inválido", statusCode: 400 };
        }
        clean.curated_status = v || null;
      }
      if (fields.notes !== undefined) clean.notes = fields.notes ? String(fields.notes).slice(0, 4000) : null;
      if (fields.is_archived !== undefined) clean.is_archived = !!fields.is_archived;
      if (fields.mount_path !== undefined) clean.mount_path = fields.mount_path ? String(fields.mount_path).slice(0, 500) : null;
      if (fields.description !== undefined) clean.description = fields.description ? String(fields.description).slice(0, 4000) : null;
      if (fields.area !== undefined) clean.area = fields.area ? String(fields.area).slice(0, 120) : null;
      if (fields.title !== undefined && fields.title) clean.title = String(fields.title).slice(0, 200);

      const fn = await ArchitectureStorage.updateCuration(pool, id, clean, userId);
      return { function: fn };
    });
  }

  static summary() {
    return runWithLogs(log, "arch.summary", () => ({}), async () => {
      const [summary, byArea, logs] = await Promise.all([
        ArchitectureStorage.summary(pool),
        ArchitectureStorage.byArea(pool),
        ArchitectureStorage.logsSummary(pool, { hours: 24 }),
      ]);
      return { summary, by_area: byArea, logs_24h: logs.totals, top_errors_24h: logs.topErrors };
    });
  }

  /**
   * Carrega/atualiza o inventário a partir do manifesto JSON. Idempotente.
   * Preserva curadoria do admin (ver upsertAutoFunction). Usado no boot e no
   * endpoint POST /admin/architecture/sync.
   */
  static sync() {
    return runWithLogs(log, "arch.sync", () => ({ manifest: MANIFEST_PATH }), async () => {
      let raw;
      try {
        raw = fs.readFileSync(MANIFEST_PATH, "utf8");
      } catch {
        log.warn("arch.sync.no_manifest", { path: MANIFEST_PATH });
        return { error: "Manifesto não encontrado. Rode o scan (npm run arch:scan).", statusCode: 404 };
      }

      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (err) {
        return { error: "Manifesto inválido (JSON malformado).", statusCode: 400 };
      }

      const functions = Array.isArray(parsed) ? parsed : parsed.functions;
      if (!Array.isArray(functions)) {
        return { error: "Manifesto sem array 'functions'.", statusCode: 400 };
      }

      let inserted = 0;
      let updated = 0;
      let skipped = 0;
      for (const fn of functions) {
        if (!fn || !fn.fn_key || !fn.title) { skipped++; continue; }
        try {
          const result = await ArchitectureStorage.upsertAutoFunction(pool, fn);
          if (result === "inserted") inserted++;
          else updated++;
        } catch (err) {
          skipped++;
          log.warn("arch.sync.upsert_failed", { fn_key: fn.fn_key, message: err?.message });
        }
      }

      return {
        synced: true,
        generated_at: parsed.generated_at || null,
        total: functions.length,
        inserted,
        updated,
        skipped,
      };
    });
  }

  /**
   * Boot: carrega o manifesto se existir. Nunca derruba o boot (fire-and-forget
   * com captura de erro). Chamado de index.js após o servidor subir.
   */
  static async syncOnBoot() {
    if (!fs.existsSync(MANIFEST_PATH)) {
      log.info("arch.boot.no_manifest", { path: MANIFEST_PATH });
      return;
    }
    try {
      const result = await this.sync();
      log.info("arch.boot.synced", result);
    } catch (err) {
      log.error("arch.boot.failed", { message: err?.message });
    }
  }

  // ---------- Logs ----------

  static listLogs(filters) {
    return runWithLogs(log, "arch.listLogs", () => ({ filters }), async () => {
      const { rows, total, page, perPage } = await ArchitectureStorage.listLogs(pool, filters);
      return { logs: rows, total, page, per_page: perPage };
    });
  }

  static logsSummary(hours) {
    return runWithLogs(log, "arch.logsSummary", () => ({ hours }), async () => {
      const { totals, topErrors } = await ArchitectureStorage.logsSummary(pool, { hours });
      return { totals, top_errors: topErrors };
    });
  }

  static purgeLogs(olderThanDays) {
    return runWithLogs(log, "arch.purgeLogs", () => ({ olderThanDays }), async () => {
      const days = Math.min(Math.max(Number(olderThanDays) || 30, 1), 3650);
      const deleted = await ArchitectureStorage.purgeLogs(pool, { olderThanDays: days });
      return { purged: deleted, older_than_days: days };
    });
  }
}

module.exports = ArchitectureService;
