// SQL do território da Freelandoo Arena (mig 282). Tudo parametrizado.
// A janela é sempre calculada PELO RELÓGIO DO BANCO (clock_timestamp), nunca
// pelo do servidor de jogo e muito menos pelo do aparelho.

const HOUR_SQL = `date_trunc('hour', clock_timestamp() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`;

class ArenaTerritoryStorage {
  /** Agora e a janela atual, no relógio do banco. */
  static async clock(conn) {
    const r = await conn.query(`SELECT clock_timestamp() AS now, ${HOUR_SQL} AS window_start`);
    return r.rows[0];
  }

  static async getPost(conn, environment_id, post_id) {
    const r = await conn.query(
      `SELECT environment_id, post_id, map_version, generator_version,
              x::float8 AS x, y::float8 AS y, radius_m::float8 AS radius_m,
              competitive, is_active, valid_from, valid_from <= clock_timestamp() AS in_force
         FROM public.tb_arena_post
        WHERE environment_id = $1 AND post_id = $2`,
      [environment_id, post_id]
    );
    return r.rows[0] || null;
  }

  static async findByRequest(conn, id_user, request_id) {
    const r = await conn.query(
      `SELECT id_checkpoint, environment_id, post_id, category_id, team_id, window_start, request_hash
         FROM public.tb_arena_checkpoint
        WHERE id_user = $1 AND request_id = $2`,
      [id_user, request_id]
    );
    return r.rows[0] || null;
  }

  /** Garante a linha da disputa e a TRAVA. Devolve o estado travado. */
  static async lockDispute(conn, key) {
    await conn.query(
      `INSERT INTO public.tb_arena_territory_state (environment_id, post_id, category_id, window_start)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
    const r = await conn.query(
      `SELECT environment_id, post_id, category_id, window_start, status, leader_team_id, total, revision, closed_at,
              clock_timestamp() AS now
         FROM public.tb_arena_territory_state
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4
        FOR UPDATE`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
    return r.rows[0];
  }

  /**
   * Insere a participação SE a cota permitir (índice único). O instante de
   * aceitação é o do banco, depois da trava. Nenhuma linha = já participou.
   */
  static async insertCheckpoint(conn, row) {
    const r = await conn.query(
      `INSERT INTO public.tb_arena_checkpoint
         (id_user, environment_id, post_id, category_id, team_id, window_start, accepted_at, request_id, request_hash, rule_version)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp(), $7, $8, $9)
       ON CONFLICT DO NOTHING
       RETURNING id_checkpoint, accepted_at`,
      [row.id_user, row.environment_id, row.post_id, row.category_id, row.team_id, row.window_start, row.request_id, row.request_hash, row.rule_version]
    );
    return r.rows[0] || null;
  }

  static async incrementCount(conn, key, team_id) {
    await conn.query(
      `INSERT INTO public.tb_arena_territory_count (environment_id, post_id, category_id, window_start, team_id, count)
       VALUES ($1, $2, $3, $4, $5, 1)
       ON CONFLICT (environment_id, post_id, category_id, window_start, team_id)
       DO UPDATE SET count = public.tb_arena_territory_count.count + 1`,
      [key.environment_id, key.post_id, key.category_id, key.window_start, team_id]
    );
  }

  static async getCounts(conn, key) {
    const r = await conn.query(
      `SELECT team_id, count FROM public.tb_arena_territory_count
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4
        ORDER BY team_id`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
    return r.rows;
  }

  static async updateState(conn, key, { status, leader_team_id, total }) {
    const r = await conn.query(
      `UPDATE public.tb_arena_territory_state
          SET status = $5, leader_team_id = $6, total = $7,
              revision = nextval('public.seq_arena_territory_revision'), updated_at = NOW()
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4
        RETURNING environment_id, post_id, category_id, window_start, status, leader_team_id, total, revision, closed_at`,
      [key.environment_id, key.post_id, key.category_id, key.window_start, status, leader_team_id, total]
    );
    return r.rows[0];
  }

  static async isSensitive(conn, category_id) {
    const r = await conn.query(`SELECT is_sensitive FROM public.tb_arena_category WHERE category_id = $1`, [category_id]);
    return !!r.rows[0]?.is_sensitive;
  }

  /** Feed: estados da JANELA ATUAL de um ambiente com revisão > since. */
  static async feed(conn, environment_id, since, limit = 5000) {
    const r = await conn.query(
      `SELECT s.environment_id, s.post_id, s.category_id, s.window_start, s.status, s.leader_team_id, s.total,
              s.revision, c.is_sensitive,
              COALESCE((SELECT json_agg(json_build_object('teamId', k.team_id, 'count', k.count) ORDER BY k.team_id)
                          FROM public.tb_arena_territory_count k
                         WHERE k.environment_id = s.environment_id AND k.post_id = s.post_id
                           AND k.category_id = s.category_id AND k.window_start = s.window_start), '[]'::json) AS counts
         FROM public.tb_arena_territory_state s
         JOIN public.tb_arena_category c ON c.category_id = s.category_id
        WHERE s.environment_id = $1
          AND s.revision > $2
          AND s.window_start = ${HOUR_SQL}
        ORDER BY s.revision
        LIMIT $3`,
      [environment_id, since, limit]
    );
    return r.rows;
  }

  static async maxRevision(conn) {
    const r = await conn.query(`SELECT COALESCE(MAX(revision), 0)::bigint AS rev FROM public.tb_arena_territory_state`);
    return Number(r.rows[0].rev);
  }

  // ─── Apuração ─────────────────────────────────────────────────────────────

  /** Disputas de janelas JÁ ENCERRADAS e ainda não apuradas. */
  static async listEnded(conn, limit) {
    const r = await conn.query(
      `SELECT environment_id, post_id, category_id, window_start
         FROM public.tb_arena_territory_state
        WHERE closed_at IS NULL AND window_start + INTERVAL '1 hour' <= clock_timestamp()
        ORDER BY window_start
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  }

  static async insertTally(conn, key, { status, leader_team_id, total, counts, rule_version }) {
    const r = await conn.query(
      // Geometria da hora (mig 284): a posição do poste só é gravada se ela
      // já valia NO INÍCIO da janela (valid_from <= window_start). Poste que
      // mudou depois = geometria daquela hora desconhecida (NULL), nunca a
      // posição de hoje fingindo ser a de ontem.
      `INSERT INTO public.tb_arena_territory_tally
         (environment_id, post_id, category_id, window_start, status, leader_team_id, total, counts, rule_version,
          post_x, post_y, map_version)
       SELECT $1::varchar, $2::varchar, $3::varchar, $4::timestamptz, $5::varchar, $6::varchar, $7::int, $8::jsonb, $9::int, g.x, g.y, g.map_version
         FROM (SELECT 1) one
         LEFT JOIN public.tb_arena_post g
           ON g.environment_id = $1::varchar AND g.post_id = $2::varchar AND g.valid_from <= $4::timestamptz
       ON CONFLICT DO NOTHING
       RETURNING closed_at`,
      [key.environment_id, key.post_id, key.category_id, key.window_start, status, leader_team_id, total, JSON.stringify(counts), rule_version]
    );
    return r.rowCount === 1;
  }

  static async markClosed(conn, key) {
    await conn.query(
      `UPDATE public.tb_arena_territory_state
          SET closed_at = clock_timestamp(), revision = nextval('public.seq_arena_territory_revision'), updated_at = NOW()
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4 AND closed_at IS NULL`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
  }

  /** Contagem refeita dos FATOS (fonte da verdade). */
  static async countsFromFacts(conn, key) {
    const r = await conn.query(
      `SELECT team_id, COUNT(*)::int AS count FROM public.tb_arena_checkpoint
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4
        GROUP BY team_id ORDER BY team_id`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
    return r.rows;
  }

  static async replaceCounts(conn, key, counts) {
    await conn.query(
      `DELETE FROM public.tb_arena_territory_count
        WHERE environment_id = $1 AND post_id = $2 AND category_id = $3 AND window_start = $4`,
      [key.environment_id, key.post_id, key.category_id, key.window_start]
    );
    for (const c of counts) {
      await conn.query(
        `INSERT INTO public.tb_arena_territory_count (environment_id, post_id, category_id, window_start, team_id, count)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [key.environment_id, key.post_id, key.category_id, key.window_start, c.team_id, c.count]
      );
    }
  }

  // ─── Registro de postes (script) ──────────────────────────────────────────

  static async listPosts(conn, environment_id) {
    const r = await conn.query(
      `SELECT environment_id, post_id, map_version, generator_version, x::float8 AS x, y::float8 AS y,
              radius_m::float8 AS radius_m, competitive, is_active, valid_from
         FROM public.tb_arena_post WHERE ($1::text IS NULL OR environment_id = $1) ORDER BY environment_id, post_id`,
      [environment_id || null]
    );
    return r.rows;
  }
}

module.exports = ArenaTerritoryStorage;
