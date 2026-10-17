// SQL das estatísticas da Arena (Módulo 08). Só LEITURA de fontes canônicas
// (fatos, apuração, estado atual, presença). Tudo parametrizado; o bucket e o
// fuso são SEMPRE UTC (a interface converte para exibir).

const BUCKET = {
  hour: (col) => `date_trunc('hour', ${col} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
  day: (col) => `date_trunc('day', ${col} AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`,
};

class ArenaStatsStorage {
  static async clock(conn) {
    const r = await conn.query(
      `SELECT clock_timestamp() AS now,
              date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS hour_start`
    );
    return r.rows[0];
  }

  static async coverageStarts(conn) {
    const r = await conn.query(
      `SELECT (SELECT MIN(minute_at) FROM public.tb_arena_presence_beat) AS presence_since,
              (SELECT MIN(valid_from) FROM public.tb_arena_post) AS posts_since,
              (SELECT MIN(window_start) FROM public.tb_arena_checkpoint) AS first_checkpoint`
    );
    return r.rows[0];
  }

  static async category(conn, category_id) {
    const r = await conn.query(`SELECT category_id, is_sensitive, is_active FROM public.tb_arena_category WHERE category_id = $1`, [category_id]);
    return r.rows[0] || null;
  }

  /** Checkpoints por bucket × ambiente (sem categoria sensível). */
  static async checkpointCounts(conn, { gran, from, to, env, category }) {
    const r = await conn.query(
      `SELECT ${BUCKET[gran]("c.window_start")} AS bucket, c.environment_id AS env, COUNT(*)::int AS n
         FROM public.tb_arena_checkpoint c
         JOIN public.tb_arena_category cat ON cat.category_id = c.category_id AND cat.is_sensitive = FALSE
        WHERE c.window_start >= $1 AND c.window_start < $2
          AND ($3::varchar IS NULL OR c.environment_id = $3)
          AND ($4::varchar IS NULL OR c.category_id = $4)
        GROUP BY 1, 2`,
      [from, to, env, category]
    );
    return r.rows;
  }

  /**
   * Participantes únicos por bucket: por ambiente E nacional (o nacional NÃO é
   * a soma dos ambientes). `anon` = fatos anonimizados (conta excluída), que
   * não entram no distinto.
   */
  static async participants(conn, { gran, from, to, category }) {
    const r = await conn.query(
      // GROUPING SETS pela EXPRESSÃO (num subselect): dentro de GROUPING SETS
      // um número é constante, não posição de coluna.
      `SELECT x.bucket, COALESCE(x.environment_id, '*') AS env,
              COUNT(DISTINCT x.id_user)::int AS n,
              COUNT(*) FILTER (WHERE x.id_user IS NULL)::int AS anon
         FROM (SELECT ${BUCKET[gran]("c.window_start")} AS bucket, c.environment_id, c.id_user
                 FROM public.tb_arena_checkpoint c
                 JOIN public.tb_arena_category cat ON cat.category_id = c.category_id AND cat.is_sensitive = FALSE
                WHERE c.window_start >= $1 AND c.window_start < $2
                  AND ($3::varchar IS NULL OR c.category_id = $3)) x
        GROUP BY GROUPING SETS ((x.bucket, x.environment_id), (x.bucket))`,
      [from, to, category]
    );
    return r.rows;
  }

  /** Participantes únicos no PERÍODO inteiro (não soma de buckets). */
  static async participantsOverRange(conn, { from, to, category }) {
    const r = await conn.query(
      `SELECT COALESCE(c.environment_id, '*') AS env, COUNT(DISTINCT c.id_user)::int AS n,
              COUNT(*) FILTER (WHERE c.id_user IS NULL)::int AS anon
         FROM public.tb_arena_checkpoint c
         JOIN public.tb_arena_category cat ON cat.category_id = c.category_id AND cat.is_sensitive = FALSE
        WHERE c.window_start >= $1 AND c.window_start < $2
          AND ($3::varchar IS NULL OR c.category_id = $3)
        GROUP BY GROUPING SETS ((c.environment_id), ())`,
      [from, to, category]
    );
    return r.rows;
  }

  /** Minutos cobertos (houve batida de alguma instância) por bucket. */
  static async coveredMinutes(conn, { gran, from, to }) {
    const r = await conn.query(
      `SELECT ${BUCKET[gran]("minute_at")} AS bucket, COUNT(DISTINCT minute_at)::int AS minutes
         FROM public.tb_arena_presence_beat
        WHERE minute_at >= $1 AND minute_at < $2
        GROUP BY 1`,
      [from, to]
    );
    return r.rows;
  }

  /**
   * Presença por minuto × ambiente (soma das instâncias e trechos) agregada
   * por bucket: soma de controladores, pico por minuto e soma de residentes.
   */
  static async presenceByBucket(conn, { gran, from, to }) {
    const r = await conn.query(
      `WITH per_minute AS (
         SELECT minute_at, environment_id, SUM(controlling)::int AS ctl, SUM(controlling + away)::int AS res
           FROM public.tb_arena_presence_sample
          WHERE minute_at >= $1 AND minute_at < $2
          GROUP BY minute_at, environment_id
       ),
       national AS (
         SELECT minute_at, SUM(ctl)::int AS ctl, SUM(res)::int AS res FROM per_minute GROUP BY minute_at
       )
       SELECT ${BUCKET[gran]("minute_at")} AS bucket, environment_id AS env,
              SUM(ctl)::bigint AS ctl_sum, MAX(ctl)::int AS ctl_peak, SUM(res)::bigint AS res_sum
         FROM per_minute GROUP BY 1, 2
       UNION ALL
       SELECT ${BUCKET[gran]("minute_at")}, '*', SUM(ctl)::bigint, MAX(ctl)::int, SUM(res)::bigint
         FROM national GROUP BY 1`,
      [from, to]
    );
    return r.rows;
  }

  static async uniques(conn, { gran, from, to }) {
    const r = await conn.query(
      `SELECT bucket_start AS bucket, environment_id AS env, unique_players AS n
         FROM public.tb_arena_presence_unique
        WHERE granularity = $1 AND bucket_start >= $2 AND bucket_start < $3`,
      [gran, from, to]
    );
    return r.rows;
  }

  /** Únicos ainda não consolidados, direto dos membros transitórios. */
  static async liveUniques(conn, { gran, from, to }) {
    const r = await conn.query(
      `SELECT x.bucket, COALESCE(x.environment_id, '*') AS env, COUNT(DISTINCT x.id_user)::int AS n
         FROM (SELECT ${BUCKET[gran]("hour_start")} AS bucket, environment_id, id_user
                 FROM public.tb_arena_presence_member
                WHERE hour_start >= $1 AND hour_start < $2) x
        GROUP BY GROUPING SETS ((x.bucket, x.environment_id), (x.bucket))`,
      [from, to]
    );
    return r.rows;
  }

  // ─── Rankings ────────────────────────────────────────────────────────────

  static async checkpointsByTeam(conn, { from, to, env, category }) {
    const r = await conn.query(
      `SELECT team_id, COUNT(*)::int AS n FROM public.tb_arena_checkpoint
        WHERE window_start >= $1 AND window_start < $2 AND category_id = $4
          AND ($3::varchar IS NULL OR environment_id = $3)
        GROUP BY team_id`,
      [from, to, env, category]
    );
    return r.rows;
  }

  static async winsByTeam(conn, { from, to, env, category }) {
    const r = await conn.query(
      `SELECT status, leader_team_id AS team_id, COUNT(*)::int AS n FROM public.tb_arena_territory_tally
        WHERE window_start >= $1 AND window_start < $2 AND category_id = $4
          AND ($3::varchar IS NULL OR environment_id = $3)
        GROUP BY status, leader_team_id`,
      [from, to, env, category]
    );
    return r.rows;
  }

  /** Disputas de horas ENCERRADAS ainda não apuradas (atrasadas). */
  static async lateWindows(conn, { from, to, env, category }) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_arena_territory_state
        WHERE closed_at IS NULL AND window_start + INTERVAL '1 hour' <= clock_timestamp()
          AND window_start >= $1 AND window_start < $2 AND category_id = $4
          AND ($3::varchar IS NULL OR environment_id = $3)`,
      [from, to, env, category]
    );
    return r.rows[0]?.n || 0;
  }

  static async leadingNow(conn, { env, category }) {
    const r = await conn.query(
      `SELECT status, leader_team_id AS team_id, COUNT(*)::int AS n FROM public.tb_arena_territory_state
        WHERE window_start = date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
          AND category_id = $2 AND ($1::varchar IS NULL OR environment_id = $1)
        GROUP BY status, leader_team_id`,
      [env, category]
    );
    return r.rows;
  }

  // ─── Mapa de calor ───────────────────────────────────────────────────────

  /**
   * Checkpoints por poste com a geometria DA HORA: apuração fechada usa a
   * posição gravada nela; hora ainda aberta usa a posição atual se ela já
   * valia no começo da janela; o resto fica sem posição ("unplaced").
   */
  static async checkpointHeat(conn, { from, to, env, category }) {
    const r = await conn.query(
      `WITH facts AS (
         SELECT c.post_id, c.category_id, c.window_start, COUNT(*)::int AS n
           FROM public.tb_arena_checkpoint c
           JOIN public.tb_arena_category cat ON cat.category_id = c.category_id AND cat.is_sensitive = FALSE
          WHERE c.environment_id = $3 AND c.window_start >= $1 AND c.window_start < $2
            AND ($4::varchar IS NULL OR c.category_id = $4)
          GROUP BY c.post_id, c.category_id, c.window_start
       )
       SELECT f.post_id,
              COALESCE(t.post_x, CASE WHEN p.valid_from <= f.window_start AND t.environment_id IS NULL THEN p.x END)::float8 AS x,
              COALESCE(t.post_y, CASE WHEN p.valid_from <= f.window_start AND t.environment_id IS NULL THEN p.y END)::float8 AS y,
              COALESCE(t.map_version, CASE WHEN p.valid_from <= f.window_start AND t.environment_id IS NULL THEN p.map_version END) AS map_version,
              SUM(f.n)::int AS n
         FROM facts f
         LEFT JOIN public.tb_arena_territory_tally t
           ON t.environment_id = $3 AND t.post_id = f.post_id AND t.category_id = f.category_id AND t.window_start = f.window_start
         LEFT JOIN public.tb_arena_post p ON p.environment_id = $3 AND p.post_id = f.post_id
        GROUP BY 1, 2, 3, 4`,
      [from, to, env, category]
    );
    return r.rows;
  }

  /** Disputa por poste (apurações fechadas): contestadas (2+ equipes), empates, decididas. */
  static async disputeHeat(conn, { from, to, env, category }) {
    const r = await conn.query(
      `SELECT t.post_id, t.post_x::float8 AS x, t.post_y::float8 AS y, t.map_version,
              COUNT(*) FILTER (WHERE (SELECT COUNT(*) FROM jsonb_object_keys(t.counts)) >= 2)::int AS contested,
              COUNT(*) FILTER (WHERE t.status = 'tie')::int AS ties,
              COUNT(*) FILTER (WHERE t.status = 'leader')::int AS decided
         FROM public.tb_arena_territory_tally t
         JOIN public.tb_arena_category cat ON cat.category_id = t.category_id AND cat.is_sensitive = FALSE
        WHERE t.environment_id = $3 AND t.window_start >= $1 AND t.window_start < $2
          AND ($4::varchar IS NULL OR t.category_id = $4)
        GROUP BY 1, 2, 3, 4`,
      [from, to, env, category]
    );
    return r.rows;
  }

  static async presenceHeat(conn, { from, to, env }) {
    const r = await conn.query(
      `SELECT chunk_index, SUM(controlling)::bigint AS player_minutes
         FROM public.tb_arena_presence_sample
        WHERE environment_id = $3 AND minute_at >= $1 AND minute_at < $2
        GROUP BY chunk_index`,
      [from, to, env]
    );
    return r.rows;
  }

  static async preferenceCounts(conn, { category, includeSynthetic }) {
    const r = await conn.query(
      `SELECT pr.team_id, COUNT(*)::int AS n
         FROM public.tb_arena_preference pr
         JOIN public.tb_arena_category c ON c.category_id = pr.category_id AND c.is_active AND c.is_sensitive = FALSE
         JOIN public.tb_arena_team t ON t.category_id = pr.category_id AND t.team_id = pr.team_id AND t.is_active
          AND ($2::boolean OR t.is_synthetic = FALSE)
        WHERE pr.category_id = $1
        GROUP BY pr.team_id`,
      [category, includeSynthetic]
    );
    return r.rows;
  }
}

module.exports = ArenaStatsStorage;
