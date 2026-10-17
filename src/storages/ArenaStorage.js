// SQL da Freelandoo Arena (mig 281). Tudo parametrizado; toda leitura pessoal
// recebe o id_user do CONTEXTO AUTENTICADO, nunca do corpo da requisição.

class ArenaStorage {
  // ─── Conta (lida da plataforma, nunca copiada) ────────────────────────────

  /** Estado canônico ATUAL da conta: existe, bloqueio, ativo, supervisão. */
  static async getAccountState(conn, id_user) {
    const r = await conn.query(
      `SELECT u.id_user, u.username, u.ativo, u.blocked_at, u.is_minor,
              CASE WHEN EXISTS (
                     SELECT 1 FROM public.supervised_accounts s
                      WHERE s.minor_user_id = u.id_user AND s.status = 'active'
                   ) THEN 'active' ELSE NULL END AS link_status
         FROM public.tb_user u
        WHERE u.id_user = $1
        LIMIT 1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  // ─── Jogador ──────────────────────────────────────────────────────────────

  /**
   * Cria o jogador se não existir. `ON CONFLICT (id_user) DO NOTHING` torna
   * duas inicializações simultâneas inofensivas: a segunda não faz nada e as
   * duas leem a MESMA linha depois. Colisão de player_id (improvável) vira
   * 23505 em ux_arena_player_player_id e o service tenta de novo.
   */
  static async ensurePlayer(conn, id_user, player_id) {
    await conn.query(
      `INSERT INTO public.tb_arena_player (id_user, player_id)
       VALUES ($1, $2)
       ON CONFLICT (id_user) DO NOTHING`,
      [id_user, player_id]
    );
  }

  static async getPlayer(conn, id_user, { forUpdate = false } = {}) {
    const r = await conn.query(
      `SELECT id_user, player_id, active_category_id, revision
         FROM public.tb_arena_player
        WHERE id_user = $1
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async bumpRevision(conn, id_user, { activeCategoryId }) {
    const r = await conn.query(
      `UPDATE public.tb_arena_player
          SET active_category_id = $2,
              revision = revision + 1,
              updated_at = NOW()
        WHERE id_user = $1
        RETURNING revision`,
      [id_user, activeCategoryId]
    );
    return r.rows[0].revision;
  }

  static async deletePlayer(conn, id_user) {
    const r = await conn.query(`DELETE FROM public.tb_arena_player WHERE id_user = $1`, [id_user]);
    return r.rowCount;
  }

  // ─── Catálogo ─────────────────────────────────────────────────────────────

  /**
   * Catálogo como a tela vê: categorias ATIVAS e suas equipes ATIVAS.
   * `includeSynthetic` só é verdadeiro fora de produção (fixture de teste).
   */
  static async getCatalog(conn, { includeSynthetic }) {
    const cats = await conn.query(
      `SELECT category_id, is_sensitive, is_active, sort_order, labels, color,
              consent_policy_version, updated_at
         FROM public.tb_arena_category
        WHERE is_active = TRUE
        ORDER BY sort_order, category_id`
    );
    const teams = await conn.query(
      `SELECT t.category_id, t.team_id, t.labels, t.color, t.sort_order, t.updated_at
         FROM public.tb_arena_team t
         JOIN public.tb_arena_category c ON c.category_id = t.category_id AND c.is_active = TRUE
        WHERE t.is_active = TRUE
          AND (t.is_synthetic = FALSE OR $1::boolean)
        ORDER BY t.category_id, t.sort_order, t.team_id`,
      [!!includeSynthetic]
    );
    return { categories: cats.rows, teams: teams.rows };
  }

  /** A equipe como o servidor a entende — nunca o que o cliente mandou. */
  static async getTeamForChoice(conn, category_id, team_id, { includeSynthetic }) {
    const r = await conn.query(
      `SELECT c.category_id, c.is_sensitive, c.is_active AS category_active,
              c.consent_policy_version,
              t.team_id, t.is_active AS team_active, t.is_synthetic,
              (SELECT COUNT(*)::int FROM public.tb_arena_team t2
                WHERE t2.category_id = c.category_id AND t2.is_active = TRUE
                  AND (t2.is_synthetic = FALSE OR $3::boolean)) AS active_team_count
         FROM public.tb_arena_category c
         LEFT JOIN public.tb_arena_team t ON t.category_id = c.category_id AND t.team_id = $2
        WHERE c.category_id = $1`,
      [category_id, team_id, !!includeSynthetic]
    );
    return r.rows[0] || null;
  }

  static async getCategory(conn, category_id) {
    const r = await conn.query(
      `SELECT category_id, is_sensitive, is_active, consent_policy_version
         FROM public.tb_arena_category WHERE category_id = $1`,
      [category_id]
    );
    return r.rows[0] || null;
  }

  // ─── Preferências ─────────────────────────────────────────────────────────

  /**
   * Preferências do titular com a validade ATUAL de cada uma: uma escolha
   * cuja equipe/categoria foi desligada no catálogo continua guardada (o
   * titular pode consultar e remover), mas sai como `valid = false`.
   */
  static async listPreferences(conn, id_user, { includeSynthetic }) {
    const r = await conn.query(
      `SELECT p.category_id, p.team_id, p.updated_at,
              (c.is_active AND t.is_active AND (t.is_synthetic = FALSE OR $2::boolean)
                 AND (c.is_sensitive = FALSE OR (
                       c.consent_policy_version IS NOT NULL AND EXISTS (
                         SELECT 1 FROM public.tb_arena_sensitive_consent sc
                          WHERE sc.id_user = p.id_user AND sc.category_id = p.category_id
                            AND sc.revoked_at IS NULL
                            AND sc.policy_version = c.consent_policy_version)))) AS valid
         FROM public.tb_arena_preference p
         JOIN public.tb_arena_category c ON c.category_id = p.category_id
         JOIN public.tb_arena_team t ON t.category_id = p.category_id AND t.team_id = p.team_id
        WHERE p.id_user = $1
        ORDER BY c.sort_order, p.category_id`,
      [id_user, !!includeSynthetic]
    );
    return r.rows;
  }

  static async getPreference(conn, id_user, category_id) {
    const r = await conn.query(
      `SELECT category_id, team_id FROM public.tb_arena_preference
        WHERE id_user = $1 AND category_id = $2`,
      [id_user, category_id]
    );
    return r.rows[0] || null;
  }

  static async upsertPreference(conn, id_user, category_id, team_id) {
    await conn.query(
      `INSERT INTO public.tb_arena_preference (id_user, category_id, team_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user, category_id) DO UPDATE
         SET team_id = EXCLUDED.team_id, updated_at = NOW()`,
      [id_user, category_id, team_id]
    );
  }

  static async deletePreference(conn, id_user, category_id) {
    const r = await conn.query(
      `DELETE FROM public.tb_arena_preference WHERE id_user = $1 AND category_id = $2`,
      [id_user, category_id]
    );
    return r.rowCount;
  }

  // ─── Consentimento específico (categoria sensível) ────────────────────────

  static async listConsents(conn, id_user) {
    const r = await conn.query(
      `SELECT category_id, policy_version, granted_at, revoked_at
         FROM public.tb_arena_sensitive_consent
        WHERE id_user = $1`,
      [id_user]
    );
    return r.rows;
  }

  static async getConsent(conn, id_user, category_id) {
    const r = await conn.query(
      `SELECT policy_version, revoked_at FROM public.tb_arena_sensitive_consent
        WHERE id_user = $1 AND category_id = $2`,
      [id_user, category_id]
    );
    return r.rows[0] || null;
  }

  static async grantConsent(conn, id_user, category_id, policy_version) {
    await conn.query(
      `INSERT INTO public.tb_arena_sensitive_consent (id_user, category_id, policy_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user, category_id) DO UPDATE
         SET policy_version = EXCLUDED.policy_version, granted_at = NOW(), revoked_at = NULL`,
      [id_user, category_id, policy_version]
    );
  }

  /** Revogar guarda SÓ a prova mínima (versão + datas); a escolha é apagada pelo service. */
  static async revokeConsent(conn, id_user, category_id) {
    const r = await conn.query(
      `UPDATE public.tb_arena_sensitive_consent
          SET revoked_at = NOW()
        WHERE id_user = $1 AND category_id = $2 AND revoked_at IS NULL`,
      [id_user, category_id]
    );
    return r.rowCount;
  }

  // ─── Exportação (LGPD) ────────────────────────────────────────────────────

  static async exportForUser(conn, id_user) {
    const player = await conn.query(
      `SELECT player_id, active_category_id, created_at FROM public.tb_arena_player WHERE id_user = $1`,
      [id_user]
    );
    if (!player.rows[0]) return null;
    const prefs = await conn.query(
      `SELECT category_id, team_id, created_at, updated_at FROM public.tb_arena_preference
        WHERE id_user = $1 ORDER BY category_id`,
      [id_user]
    );
    const consents = await this.listConsents(conn, id_user);
    // Participações em postes (mig 282): o titular vê as próprias.
    const checkpoints = await conn.query(
      `SELECT environment_id, post_id, category_id, team_id, window_start, accepted_at
         FROM public.tb_arena_checkpoint WHERE id_user = $1 ORDER BY accepted_at`,
      [id_user]
    );
    return { player: player.rows[0], preferences: prefs.rows, sensitive_consents: consents, checkpoints: checkpoints.rows };
  }

  /** Exclusão da conta: o fato aceito fica, sem o vínculo com a pessoa. */
  static async anonymizeCheckpoints(conn, id_user) {
    const r = await conn.query(`UPDATE public.tb_arena_checkpoint SET id_user = NULL WHERE id_user = $1`, [id_user]);
    return r.rowCount;
  }
}

module.exports = ArenaStorage;
