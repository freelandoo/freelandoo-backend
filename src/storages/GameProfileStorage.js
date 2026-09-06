// src/storages/GameProfileStorage.js
// SQL puro do perfil gamer (mig 220): a conta conectada, o catálogo de jogos e
// a estante.
//
// ─── A REGRA QUE ATRAVESSA O ARQUIVO INTEIRO ─────────────────────────────────
//
// Conta VIVA é `revoked_at IS NULL`, sempre — do mesmo jeito que morador é
// `status='recognized' AND ended_at IS NULL`. Meia condição aqui devolveria a
// biblioteca de uma conta que a pessoa já desconectou.
//
// ─── POR QUE TUDO É EM LOTE (`unnest`) ───────────────────────────────────────
//
// Uma biblioteca da Steam tem centenas de jogos. Um INSERT por jogo seriam
// centenas de idas ao banco por sincronização, e o sync roda quando a pessoa
// abre a tela — ela esperaria por isso. Com `unnest` a biblioteca inteira entra
// em três statements, independentemente do tamanho.

class GameProfileStorage {
  /* ─────────────────────────── conta conectada ──────────────────────────── */

  static async getAccount(conn, id_user, provider) {
    const r = await conn.query(
      `SELECT id_account, id_user, provider, external_id, handle, avatar_url,
              profile_url, status, visibility, sync_error, last_sync_at,
              connected_at
         FROM public.tb_user_game_account
        WHERE id_user = $1 AND provider = $2 AND revoked_at IS NULL
        LIMIT 1`,
      [id_user, provider]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listAccounts(conn, id_user) {
    const r = await conn.query(
      `SELECT id_account, provider, external_id, handle, avatar_url, profile_url,
              status, visibility, sync_error, last_sync_at, connected_at
         FROM public.tb_user_game_account
        WHERE id_user = $1 AND revoked_at IS NULL
        ORDER BY connected_at ASC`,
      [id_user]
    );
    return r.rows;
  }

  /** Quem já é dono deste SteamID aqui dentro (para recusar a segunda pessoa). */
  static async getAccountByExternal(conn, provider, external_id) {
    const r = await conn.query(
      `SELECT id_account, id_user
         FROM public.tb_user_game_account
        WHERE provider = $1 AND external_id = $2 AND revoked_at IS NULL
        LIMIT 1`,
      [provider, external_id]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Conecta (ou reconecta). Reconectar a MESMA conta não pode apagar a estante
   * nem a escolha de visibilidade — quem clica "conectar" de novo normalmente
   * está tentando destravar um sync com erro, e perder tudo seria castigo por
   * tentar. Por isso o UPDATE preserva `visibility`.
   */
  static async connectAccount(conn, { id_user, provider, external_id, handle, avatar_url, profile_url, visibility }) {
    const existing = await this.getAccount(conn, id_user, provider);
    if (existing) {
      const r = await conn.query(
        `UPDATE public.tb_user_game_account
            SET external_id = $3, handle = $4, avatar_url = $5, profile_url = $6,
                status = 'connected', sync_error = NULL
          WHERE id_user = $1 AND provider = $2 AND revoked_at IS NULL
          RETURNING id_account, id_user, provider, external_id, handle, avatar_url,
                    profile_url, status, visibility, last_sync_at, connected_at`,
        [id_user, provider, external_id, handle, avatar_url, profile_url]
      );
      return r.rows[0];
    }
    const r = await conn.query(
      `INSERT INTO public.tb_user_game_account
              (id_user, provider, external_id, handle, avatar_url, profile_url, visibility)
       VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, 'public'))
       RETURNING id_account, id_user, provider, external_id, handle, avatar_url,
                 profile_url, status, visibility, last_sync_at, connected_at`,
      [id_user, provider, external_id, handle, avatar_url, profile_url, visibility || null]
    );
    return r.rows[0];
  }

  /**
   * Desconecta. Carimba `revoked_at` (libera o par provider+external_id para o
   * dono de verdade) e APAGA a estante daquele provedor — desconectar tem que
   * levar embora o que foi trazido, senão a pessoa continuaria exposta pelo
   * dado que ela mandou parar de ler.
   */
  static async revokeAccount(conn, id_user, provider) {
    const r = await conn.query(
      `UPDATE public.tb_user_game_account
          SET revoked_at = NOW()
        WHERE id_user = $1 AND provider = $2 AND revoked_at IS NULL
        RETURNING id_account`,
      [id_user, provider]
    );
    if (!r.rowCount) return null;
    await conn.query(
      `DELETE FROM public.tb_user_game WHERE id_user = $1 AND provider = $2`,
      [id_user, provider]
    );
    return r.rows[0];
  }

  static async setSync(conn, id_account, { status, sync_error }) {
    await conn.query(
      `UPDATE public.tb_user_game_account
          SET status = $2, sync_error = $3, last_sync_at = NOW()
        WHERE id_account = $1`,
      [id_account, status, sync_error || null]
    );
  }

  static async setVisibility(conn, id_user, provider, visibility) {
    const r = await conn.query(
      `UPDATE public.tb_user_game_account
          SET visibility = $3
        WHERE id_user = $1 AND provider = $2 AND revoked_at IS NULL
        RETURNING id_account, visibility`,
      [id_user, provider, visibility]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /* ──────────────────────────── catálogo ────────────────────────────────── */

  /**
   * Garante o jogo no catálogo e a ponte provedor→jogo, e devolve o mapa
   * `external_id → id_game`.
   *
   * O `slug` é a chave de dedupe: é ele que faz "Elden Ring" da Steam e
   * "ELDEN RING" de outra plataforma caírem na MESMA linha — que é justamente o
   * que a comparação precisa. O preço conhecido: dois jogos genuinamente
   * diferentes com nome idêntico viram um só. É raro, e o remédio (id_game
   * separado, curadoria no admin) custa mais do que o problema hoje.
   */
  static async upsertGames(conn, provider, games) {
    if (!games.length) return new Map();

    const slugs = games.map((g) => g.slug);
    const names = games.map((g) => g.name);
    const covers = games.map((g) => g.cover_url || null);

    // O catálogo. `DO UPDATE` (e não `DO NOTHING`) porque só o UPDATE devolve a
    // linha que já existia — com DO NOTHING, jogo repetido sairia do RETURNING
    // e o mapa voltaria furado.
    //
    // ⚠️ O `name` NÃO é sobrescrito: o primeiro que chega fica. Duas
    // plataformas escrevem o mesmo jogo de jeitos diferentes ("ELDEN RING" e
    // "Elden Ring"), e deixar o último sync vencer faria o nome do jogo mudar
    // na tela de todo mundo conforme quem sincronizou por último — além de
    // reescrever a linha a cada sync sem necessidade. A capa, essa sim, é
    // preenchida quando falta: dado ausente vale menos que dado divergente.
    const cat = await conn.query(
      `INSERT INTO public.tb_game (slug, name, cover_url)
       SELECT s, n, c
         FROM UNNEST($1::text[], $2::text[], $3::text[]) AS t(s, n, c)
       ON CONFLICT (slug) DO UPDATE
          SET cover_url = COALESCE(public.tb_game.cover_url, EXCLUDED.cover_url)
       RETURNING id_game, slug`,
      [slugs, names, covers]
    );
    const bySlug = new Map(cat.rows.map((r) => [r.slug, r.id_game]));

    // A ponte. Idempotente: o appid já conhecido não vira linha nova.
    const externals = games.map((g) => g.external_id);
    const ids = games.map((g) => bySlug.get(g.slug));
    await conn.query(
      `INSERT INTO public.tb_game_provider_ref (provider, external_id, id_game)
       SELECT $1, e, i::uuid
         FROM UNNEST($2::text[], $3::text[]) AS t(e, i)
       ON CONFLICT (provider, external_id) DO NOTHING`,
      [provider, externals, ids]
    );

    return new Map(games.map((g) => [g.external_id, bySlug.get(g.slug)]));
  }

  /* ───────────────────────────── a estante ──────────────────────────────── */

  /**
   * Grava a biblioteca inteira daquele provedor.
   *
   * ⚠️ NÃO toca em `ach_unlocked/ach_total/ach_synced_at`: conquista é cache
   * caro (uma chamada por jogo) e o sync roda a cada 6h. Zerá-la aqui faria a
   * tela de comparação re-buscar tudo toda vez e queimar a cota diária da
   * Steam.
   */
  static async replaceShelf(conn, id_user, provider, rows) {
    if (!rows.length) {
      await conn.query(
        `DELETE FROM public.tb_user_game WHERE id_user = $1 AND provider = $2`,
        [id_user, provider]
      );
      return 0;
    }
    const ids = rows.map((r) => r.id_game);
    const minutes = rows.map((r) => r.playtime_minutes);
    const minutes2w = rows.map((r) => r.playtime_2w_minutes);
    const played = rows.map((r) => (r.last_played_at ? r.last_played_at.toISOString() : null));

    await conn.query(
      `INSERT INTO public.tb_user_game
              (id_user, id_game, provider, playtime_minutes, playtime_2w_minutes, last_played_at)
       SELECT $1, g::uuid, $2, m, m2, p::timestamptz
         FROM UNNEST($3::text[], $4::int[], $5::int[], $6::text[]) AS t(g, m, m2, p)
       ON CONFLICT (id_user, id_game, provider) DO UPDATE
          SET playtime_minutes = EXCLUDED.playtime_minutes,
              playtime_2w_minutes = EXCLUDED.playtime_2w_minutes,
              last_played_at = EXCLUDED.last_played_at,
              updated_at = NOW()`,
      [id_user, provider, ids, minutes, minutes2w, played]
    );

    // Jogo que saiu da biblioteca (reembolso, compartilhamento familiar que
    // acabou) sai da estante. Sem isto a estante só cresceria, e mostraria como
    // "possuído" o que a plataforma não confirma mais.
    const r = await conn.query(
      `DELETE FROM public.tb_user_game
        WHERE id_user = $1 AND provider = $2 AND NOT (id_game = ANY($3::uuid[]))`,
      [id_user, provider, ids]
    );
    return r.rowCount;
  }

  static async listShelf(conn, id_user, { limit = 60, offset = 0, q = null } = {}) {
    const params = [id_user];
    let filter = "";
    if (q) {
      params.push(`%${q}%`);
      filter = ` AND g.name ILIKE $${params.length}`;
    }
    params.push(limit, offset);
    const r = await conn.query(
      `SELECT g.id_game, g.slug, g.name, g.cover_url,
              ug.provider, ug.playtime_minutes, ug.playtime_2w_minutes,
              ug.last_played_at, ug.ach_unlocked, ug.ach_total
         FROM public.tb_user_game ug
         JOIN public.tb_game g ON g.id_game = ug.id_game
        WHERE ug.id_user = $1${filter}
        ORDER BY ug.playtime_minutes DESC, g.name ASC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );
    return r.rows;
  }

  static async countShelf(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(SUM(playtime_minutes), 0)::bigint AS minutes
         FROM public.tb_user_game
        WHERE id_user = $1`,
      [id_user]
    );
    return r.rows[0];
  }

  /**
   * Frente a frente: os jogos que as duas pessoas têm.
   *
   * O JOIN é por `id_game` e não por nome — é exatamente para isto que o
   * catálogo existe. `provider` sai nas duas pontas porque a tela precisa
   * dizer de ONDE veio cada número: 142h na Steam e 0h no Xbox não são
   * comparáveis, e o rótulo é o que impede a leitura errada.
   */
  static async listCommon(conn, id_user_a, id_user_b, { limit = 200 } = {}) {
    const r = await conn.query(
      `SELECT g.id_game, g.slug, g.name, g.cover_url,
              a.provider          AS a_provider,
              a.playtime_minutes  AS a_minutes,
              a.last_played_at    AS a_last_played,
              a.ach_unlocked      AS a_ach_unlocked,
              a.ach_total         AS a_ach_total,
              b.provider          AS b_provider,
              b.playtime_minutes  AS b_minutes,
              b.last_played_at    AS b_last_played,
              b.ach_unlocked      AS b_ach_unlocked,
              b.ach_total         AS b_ach_total
         FROM public.tb_user_game a
         JOIN public.tb_user_game b
           ON b.id_game = a.id_game AND b.id_user = $2
         JOIN public.tb_game g ON g.id_game = a.id_game
        WHERE a.id_user = $1
        ORDER BY GREATEST(a.playtime_minutes, b.playtime_minutes) DESC
        LIMIT $3`,
      [id_user_a, id_user_b, limit]
    );
    return r.rows;
  }

  static async getUserGame(conn, id_user, id_game, provider) {
    const r = await conn.query(
      `SELECT ug.id_user, ug.id_game, ug.provider, ug.playtime_minutes,
              ug.ach_unlocked, ug.ach_total, ug.ach_synced_at,
              g.name, g.cover_url, r.external_id
         FROM public.tb_user_game ug
         JOIN public.tb_game g ON g.id_game = ug.id_game
         LEFT JOIN public.tb_game_provider_ref r
                ON r.id_game = ug.id_game AND r.provider = ug.provider
        WHERE ug.id_user = $1 AND ug.id_game = $2 AND ug.provider = $3
        LIMIT 1`,
      [id_user, id_game, provider]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Cache das conquistas daquele jogo. `total = null` = jogo sem conquistas. */
  static async setAchievements(conn, { id_user, id_game, provider, unlocked, total }) {
    await conn.query(
      `UPDATE public.tb_user_game
          SET ach_unlocked = $4, ach_total = $5, ach_synced_at = NOW()
        WHERE id_user = $1 AND id_game = $2 AND provider = $3`,
      [id_user, id_game, provider, unlocked, total]
    );
  }

  /** Dono da estante + o cartão dele (nome/foto), para a tela de comparação. */
  static async getPublicOwner(conn, id_user) {
    const r = await conn.query(
      `SELECT u.id_user, u.username, u.nome, u.avatar
         FROM public.tb_user u
        WHERE u.id_user = $1
        LIMIT 1`,
      [id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async findUserByUsername(conn, username) {
    const r = await conn.query(
      `SELECT id_user, username, nome, avatar
         FROM public.tb_user
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1`,
      [username]
    );
    return r.rowCount ? r.rows[0] : null;
  }
}

module.exports = GameProfileStorage;
