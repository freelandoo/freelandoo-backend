/**
 * ArchitectureStorage — SQL puro do Painel de Arquitetura.
 * Duas áreas: inventário de funções (arch_functions) e log de rotas (arch_route_logs).
 */
class ArchitectureStorage {
  // ===========================================================================
  // Inventário de funções
  // ===========================================================================

  /**
   * Lista funções com filtros + paginação. Retorna { rows, total }.
   * `effectiveStatus` = COALESCE(curated_status, status).
   */
  static async listFunctions(conn, {
    status,        // filtra pelo status efetivo
    kind,
    repo,
    area,
    committed,     // boolean: git_committed
    pushed,        // boolean: git_pushed
    archived,      // boolean: is_archived (default: exclui arquivados)
    q,
    sort = "area",
    order = "asc",
    page = 1,
    perPage = 50,
  } = {}) {
    const where = [];
    const params = [];
    let i = 1;

    if (status) {
      where.push(`COALESCE(curated_status, status) = $${i++}`);
      params.push(status);
    }
    if (kind) { where.push(`kind = $${i++}`); params.push(kind); }
    if (repo) { where.push(`repo = $${i++}`); params.push(repo); }
    if (area) { where.push(`area = $${i++}`); params.push(area); }
    if (typeof committed === "boolean") { where.push(`git_committed = $${i++}`); params.push(committed); }
    if (typeof pushed === "boolean") { where.push(`git_pushed = $${i++}`); params.push(pushed); }
    if (typeof archived === "boolean") {
      where.push(`is_archived = $${i++}`);
      params.push(archived);
    } else {
      where.push(`is_archived = FALSE`);
    }
    if (q) {
      where.push(`(title ILIKE $${i} OR description ILIKE $${i} OR description_curated ILIKE $${i} OR fn_key ILIKE $${i} OR file_path ILIKE $${i} OR area ILIKE $${i})`);
      params.push(`%${q}%`);
      i++;
    }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

    const sortable = {
      area: "area",
      title: "title",
      status: "COALESCE(curated_status, status)",
      kind: "kind",
      repo: "repo",
      updated_at: "updated_at",
      last_commit_at: "last_commit_at",
    };
    const sortCol = sortable[sort] || "area";
    const sortDir = String(order).toLowerCase() === "desc" ? "DESC" : "ASC";

    const limit = Math.min(Math.max(Number(perPage) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const { rows: countRows } = await conn.query(
      `SELECT COUNT(*)::int AS total FROM public.arch_functions ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const { rows } = await conn.query(
      `SELECT *,
              COALESCE(curated_status, status) AS effective_status,
              COALESCE(description_curated, description) AS description_effective
       FROM public.arch_functions
       ${whereSql}
       ORDER BY ${sortCol} ${sortDir} NULLS LAST, title ASC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );

    return { rows, total, page: Math.max(Number(page) || 1, 1), perPage: limit };
  }

  static async getFunctionById(conn, id) {
    const { rows } = await conn.query(
      `SELECT *,
              COALESCE(curated_status, status) AS effective_status,
              COALESCE(description_curated, description) AS description_effective
       FROM public.arch_functions WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * Atualiza campos de curadoria (não toca nos campos do scan automático).
   * Marca source='curated' quando há override de status.
   */
  static async updateCuration(conn, id, fields, userId) {
    const sets = [];
    const params = [];
    let i = 1;

    const allowed = ["curated_status", "notes", "is_archived", "mount_path", "description_curated", "area", "title"];
    for (const key of allowed) {
      if (key in fields && fields[key] !== undefined) {
        sets.push(`${key} = $${i++}`);
        params.push(fields[key]);
      }
    }
    if (!sets.length) return this.getFunctionById(conn, id);

    if ("curated_status" in fields) {
      sets.push(`source = 'curated'`);
    }
    sets.push(`curated_by = $${i++}`);
    params.push(userId || null);
    sets.push(`updated_at = NOW()`);

    params.push(id);
    const { rows } = await conn.query(
      `UPDATE public.arch_functions
       SET ${sets.join(", ")}
       WHERE id = $${i}
       RETURNING *,
                 COALESCE(curated_status, status) AS effective_status,
                 COALESCE(description_curated, description) AS description_effective`,
      params
    );
    return rows[0] || null;
  }

  /**
   * Upsert de uma linha vinda do scan automático. Preserva curadoria do admin:
   * NÃO sobrescreve curated_status, notes, is_archived nem source.
   */
  static async upsertAutoFunction(conn, fn) {
    const { rows } = await conn.query(
      `INSERT INTO public.arch_functions
         (fn_key, title, description, area, kind, repo, file_path, mount_path,
          status, git_committed, git_pushed, last_commit_sha, last_commit_msg,
          last_commit_at, source, tags, last_synced_at, updated_at)
       VALUES
         ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'auto',$15,NOW(),NOW())
       ON CONFLICT (fn_key) DO UPDATE SET
         title           = EXCLUDED.title,
         -- narração automática sempre atualiza; o override do admin vive em
         -- description_curated (preservado, não tocado aqui).
         description      = EXCLUDED.description,
         area            = EXCLUDED.area,
         kind            = EXCLUDED.kind,
         repo            = EXCLUDED.repo,
         file_path       = EXCLUDED.file_path,
         mount_path      = EXCLUDED.mount_path,
         status          = EXCLUDED.status,
         git_committed   = EXCLUDED.git_committed,
         git_pushed      = EXCLUDED.git_pushed,
         last_commit_sha = EXCLUDED.last_commit_sha,
         last_commit_msg = EXCLUDED.last_commit_msg,
         last_commit_at  = EXCLUDED.last_commit_at,
         tags            = EXCLUDED.tags,
         last_synced_at  = NOW(),
         updated_at      = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [
        fn.fn_key, fn.title, fn.description || null, fn.area || null,
        fn.kind || "component", fn.repo || "frontend", fn.file_path || null,
        fn.mount_path || null, fn.status || "live",
        !!fn.git_committed, !!fn.git_pushed,
        fn.last_commit_sha || null, fn.last_commit_msg || null,
        fn.last_commit_at || null, Array.isArray(fn.tags) ? fn.tags : [],
      ]
    );
    return rows[0]?.inserted ? "inserted" : "updated";
  }

  /** KPIs do resumo. */
  static async summary(conn) {
    const { rows } = await conn.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(curated_status, status) = 'live' AND NOT is_archived)::int AS live,
         COUNT(*) FILTER (WHERE COALESCE(curated_status, status) = 'orphan' AND NOT is_archived)::int AS orphan,
         COUNT(*) FILTER (WHERE COALESCE(curated_status, status) = 'wip' AND NOT is_archived)::int AS wip,
         COUNT(*) FILTER (WHERE COALESCE(curated_status, status) = 'deprecated' OR is_archived)::int AS deprecated,
         COUNT(*) FILTER (WHERE git_committed)::int AS committed,
         COUNT(*) FILTER (WHERE git_pushed)::int AS pushed,
         COUNT(*) FILTER (WHERE NOT git_committed)::int AS uncommitted,
         MAX(last_synced_at) AS last_synced_at
       FROM public.arch_functions`
    );
    return rows[0];
  }

  /** Distribuição por área (para o resumo). */
  static async byArea(conn) {
    const { rows } = await conn.query(
      `SELECT
         COALESCE(area, 'Sem área') AS area,
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE COALESCE(curated_status, status) = 'orphan')::int AS orphan,
         COUNT(*) FILTER (WHERE NOT git_committed)::int AS uncommitted
       FROM public.arch_functions
       WHERE NOT is_archived
       GROUP BY COALESCE(area, 'Sem área')
       ORDER BY total DESC`
    );
    return rows;
  }

  // ===========================================================================
  // Log de rotas
  // ===========================================================================

  static async insertRouteLog(conn, entry) {
    await conn.query(
      `INSERT INTO public.arch_route_logs
         (request_id, method, path, route_pattern, status_code, duration_ms,
          user_id, ip, error_message, error_stack, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        entry.request_id || null, entry.method, entry.path,
        entry.route_pattern || null, entry.status_code, entry.duration_ms ?? null,
        entry.user_id || null, entry.ip || null,
        entry.error_message || null, entry.error_stack || null,
        entry.meta ? JSON.stringify(entry.meta) : "{}",
      ]
    );
  }

  static async listLogs(conn, {
    path,
    status,        // status_code exato
    minStatus,     // >= (ex: 400 para "só erros")
    errorsOnly,
    method,
    since,         // ISO date
    page = 1,
    perPage = 50,
  } = {}) {
    const where = [];
    const params = [];
    let i = 1;

    if (path) { where.push(`path ILIKE $${i++}`); params.push(`%${path}%`); }
    if (method) { where.push(`method = $${i++}`); params.push(String(method).toUpperCase()); }
    if (status) { where.push(`status_code = $${i++}`); params.push(Number(status)); }
    if (errorsOnly) { where.push(`status_code >= 400`); }
    else if (minStatus) { where.push(`status_code >= $${i++}`); params.push(Number(minStatus)); }
    if (since) { where.push(`created_at >= $${i++}`); params.push(since); }

    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const limit = Math.min(Math.max(Number(perPage) || 50, 1), 200);
    const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

    const { rows: countRows } = await conn.query(
      `SELECT COUNT(*)::int AS total FROM public.arch_route_logs ${whereSql}`,
      params
    );
    const total = countRows[0]?.total || 0;

    const { rows } = await conn.query(
      `SELECT * FROM public.arch_route_logs
       ${whereSql}
       ORDER BY created_at DESC
       LIMIT $${i++} OFFSET $${i++}`,
      [...params, limit, offset]
    );
    return { rows, total, page: Math.max(Number(page) || 1, 1), perPage: limit };
  }

  /** Top rotas com erro nas últimas N horas. */
  static async logsSummary(conn, { hours = 24 } = {}) {
    const { rows: totals } = await conn.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE status_code >= 500)::int AS server_errors,
         COUNT(*) FILTER (WHERE status_code >= 400 AND status_code < 500)::int AS client_errors,
         COALESCE(AVG(duration_ms), 0)::int AS avg_ms
       FROM public.arch_route_logs
       WHERE created_at >= NOW() - ($1 || ' hours')::interval`,
      [String(hours)]
    );
    const { rows: top } = await conn.query(
      `SELECT
         COALESCE(route_pattern, path) AS route,
         method,
         COUNT(*)::int AS hits,
         COUNT(*) FILTER (WHERE status_code >= 400)::int AS errors,
         MAX(status_code) AS worst_status,
         MAX(created_at) AS last_seen
       FROM public.arch_route_logs
       WHERE created_at >= NOW() - ($1 || ' hours')::interval
         AND status_code >= 400
       GROUP BY COALESCE(route_pattern, path), method
       ORDER BY errors DESC, last_seen DESC
       LIMIT 20`,
      [String(hours)]
    );
    return { totals: totals[0], topErrors: top };
  }

  /** Apaga logs mais antigos que N dias. Retorna nº de linhas. */
  static async purgeLogs(conn, { olderThanDays = 30 } = {}) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.arch_route_logs
       WHERE created_at < NOW() - ($1 || ' days')::interval`,
      [String(olderThanDays)]
    );
    return rowCount;
  }
}

module.exports = ArchitectureStorage;
