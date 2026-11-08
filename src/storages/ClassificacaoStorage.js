// src/storages/ClassificacaoStorage.js
//
// A6 CLASSIFICAÇÃO (migs 395/396): SQL da prova, da nota e do perfil de
// personalidade. Sem regra aqui — a regra mora em utils/classificacaoTri.js e
// utils/classificacaoRules.js; quem decide é o ClassificacaoService.

const ATTEMPT_COLS = `id_attempt, id_user, locale, status, started_at, finished_at,
  pending_item, answers, theta, se, score, areas`;

module.exports = class ClassificacaoStorage {
  // ── banco de itens ───────────────────────────────────────────────────────
  static async listActiveItems(db, locale) {
    const { rows } = await db.query(
      `SELECT id_item AS id, area, a, b
         FROM public.tb_quiz_item
        WHERE is_active AND locale = $1`,
      [locale]
    );
    return rows.map((r) => ({ id: r.id, area: r.area, a: Number(r.a), b: Number(r.b) }));
  }

  /** O item completo (com o gabarito) — só o servidor lê. */
  static async getItem(db, id_item) {
    const { rows } = await db.query(
      `SELECT id_item AS id, area, stem, options, correct, a, b, attribution
         FROM public.tb_quiz_item WHERE id_item = $1`,
      [id_item]
    );
    return rows[0] || null;
  }

  // ── provas ───────────────────────────────────────────────────────────────
  static async lockUser(db, id_user) {
    await db.query(`SELECT pg_advisory_xact_lock(hashtext('a6-quiz:' || $1::text))`, [id_user]);
  }

  static async getOpenAttempt(db, id_user, { forUpdate = false } = {}) {
    const { rows } = await db.query(
      `SELECT ${ATTEMPT_COLS} FROM public.tb_quiz_attempt
        WHERE id_user = $1 AND status = 'open'
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [id_user]
    );
    return rows[0] || null;
  }

  static async getAttempt(db, id_user, id_attempt, { forUpdate = false } = {}) {
    const { rows } = await db.query(
      `SELECT ${ATTEMPT_COLS} FROM public.tb_quiz_attempt
        WHERE id_attempt = $1 AND id_user = $2
        ${forUpdate ? "FOR UPDATE" : ""}`,
      [id_attempt, id_user]
    );
    return rows[0] || null;
  }

  /** O início da prova mais recente (qualquer estado) — conta a janela de 30 dias. */
  static async lastStartedAt(db, id_user) {
    const { rows } = await db.query(
      `SELECT max(started_at) AS at FROM public.tb_quiz_attempt WHERE id_user = $1`,
      [id_user]
    );
    return rows[0]?.at || null;
  }

  static async createAttempt(db, id_user, locale, pending_item) {
    const { rows } = await db.query(
      `INSERT INTO public.tb_quiz_attempt (id_user, locale, pending_item)
       VALUES ($1, $2, $3) RETURNING ${ATTEMPT_COLS}`,
      [id_user, locale, pending_item]
    );
    return rows[0];
  }

  static async saveProgress(db, id_attempt, answers, pending_item) {
    const { rows } = await db.query(
      `UPDATE public.tb_quiz_attempt SET answers = $2::jsonb, pending_item = $3
        WHERE id_attempt = $1 RETURNING ${ATTEMPT_COLS}`,
      [id_attempt, JSON.stringify(answers), pending_item]
    );
    return rows[0];
  }

  static async closeAttempt(db, id_attempt, { status, theta, se, score, areas }) {
    const { rows } = await db.query(
      `UPDATE public.tb_quiz_attempt
          SET status = $2, finished_at = NOW(), pending_item = NULL,
              theta = $3, se = $4, score = $5, areas = $6::jsonb
        WHERE id_attempt = $1 RETURNING ${ATTEMPT_COLS}`,
      [id_attempt, status, theta, se, score, areas == null ? null : JSON.stringify(areas)]
    );
    return rows[0];
  }

  // ── nota e visibilidade ──────────────────────────────────────────────────
  static async getResult(db, id_user) {
    const { rows } = await db.query(
      `SELECT r.id_user, r.id_attempt, r.score, r.finished_at, r.visibility, r.share_token,
              a.areas
         FROM public.tb_quiz_result r
         JOIN public.tb_quiz_attempt a ON a.id_attempt = r.id_attempt
        WHERE r.id_user = $1`,
      [id_user]
    );
    return rows[0] || null;
  }

  /** A nota nova substitui a antiga; quem vê (e o link) continuam os mesmos. */
  static async upsertResult(db, id_user, id_attempt, score, finished_at) {
    await db.query(
      `INSERT INTO public.tb_quiz_result (id_user, id_attempt, score, finished_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_user) DO UPDATE
          SET id_attempt = EXCLUDED.id_attempt, score = EXCLUDED.score,
              finished_at = EXCLUDED.finished_at, updated_at = NOW()`,
      [id_user, id_attempt, score, finished_at]
    );
  }

  static async setVisibility(db, id_user, visibility, share_token) {
    const { rows } = await db.query(
      `UPDATE public.tb_quiz_result
          SET visibility = $2, share_token = $3, updated_at = NOW()
        WHERE id_user = $1
        RETURNING visibility, share_token`,
      [id_user, visibility, share_token]
    );
    return rows[0] || null;
  }

  /** Projeção pública campo a campo (pelo link). */
  static async publicByToken(db, token) {
    const { rows } = await db.query(
      `SELECT r.score, r.finished_at, r.visibility, u.nome AS name, u.username, u.avatar
         FROM public.tb_quiz_result r
         JOIN public.tb_user u ON u.id_user = r.id_user
        WHERE r.share_token = $1`,
      [token]
    );
    return rows[0] || null;
  }

  /** Projeção pública campo a campo (no perfil, pelo @). */
  static async publicByUsername(db, username) {
    const { rows } = await db.query(
      `SELECT r.score, r.finished_at, r.visibility
         FROM public.tb_quiz_result r
         JOIN public.tb_user u ON u.id_user = r.id_user
        WHERE lower(u.username) = lower($1)`,
      [username]
    );
    return rows[0] || null;
  }

  // ── personalidade (dado sensível) ────────────────────────────────────────
  /** Os últimos eventos de consentimento, do mais antigo ao mais novo. */
  static async consentEvents(db, id_user) {
    const { rows } = await db.query(
      `SELECT action, version, at FROM (
         SELECT action, version, at, id_event FROM public.tb_personality_consent
          WHERE id_user = $1 ORDER BY at DESC, id_event DESC LIMIT 20
       ) e ORDER BY at ASC, id_event ASC`,
      [id_user]
    );
    return rows;
  }

  static async addConsentEvent(db, id_user, action, version) {
    await db.query(
      `INSERT INTO public.tb_personality_consent (id_user, action, version) VALUES ($1, $2, $3)`,
      [id_user, action, version]
    );
  }

  static async getPersonality(db, id_user) {
    const { rows } = await db.query(
      `SELECT payload_sealed, consent_version, created_at, updated_at
         FROM public.tb_personality_profile WHERE id_user = $1`,
      [id_user]
    );
    return rows[0] || null;
  }

  static async upsertPersonality(db, id_user, payload_sealed, consent_version) {
    await db.query(
      `INSERT INTO public.tb_personality_profile (id_user, payload_sealed, consent_version)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_user) DO UPDATE
          SET payload_sealed = EXCLUDED.payload_sealed,
              consent_version = EXCLUDED.consent_version, updated_at = NOW()`,
      [id_user, payload_sealed, consent_version]
    );
  }

  static async deletePersonality(db, id_user) {
    const r = await db.query(`DELETE FROM public.tb_personality_profile WHERE id_user = $1`, [id_user]);
    return r.rowCount > 0;
  }
};
