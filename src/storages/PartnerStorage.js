// src/storages/PartnerStorage.js
// Persistência da API de parceiro de academia (mig 296): chave de parceiro,
// vínculo criado pelo software da academia, token de primeiro acesso, foto do
// cadastro na academia e o aceite dos termos da conta vinda de academia.
const { ESTADO_AGUARDANDO } = require("../utils/academyOnboarding");

// Item da listagem do parceiro. O treino é a ficha ATIVA MAIS RECENTE do aluno
// (é a que ele está seguindo agora). A foto só sai depois do aceite — antes
// dele a conta não tem foto nenhuma na plataforma (decisão Q19).
const PARTNER_MEMBER_SELECT = `
  SELECT m.id_member, m.id_user, m.cpf, m.ref_externa,
         u.academy_onboarding_state,
         CASE WHEN u.academy_onboarding_state = '${ESTADO_AGUARDANDO}' THEN NULL ELSE u.avatar END AS avatar_url,
         plan.nome AS treino_nome,
         plan.created_at AS treino_criado_em,
         plan.validade_dias AS treino_validade_dias,
         -- Ficha proposta pelo professor esperando o aluno confirmar (mig 305):
         -- o Coliseu mostra "aguardando o aluno" em vez de "sem treino/vencido".
         EXISTS (
           SELECT 1 FROM public.tb_fitness_change_proposal pr
            WHERE pr.id_member = m.id_member AND pr.status = 'pending'
              AND pr.kind IN ('plan_create', 'plan_update')
         ) AS proposta_treino_pendente
    FROM public.tb_academy_member m
    JOIN public.tb_user u ON u.id_user = m.id_user
    LEFT JOIN LATERAL (
      SELECT p.nome, p.created_at, p.validade_dias
        FROM public.tb_workout_plan p
       WHERE p.id_user = m.id_user AND p.is_active = TRUE
       ORDER BY p.created_at DESC
       LIMIT 1
    ) plan ON TRUE`;

module.exports = {
  // ─── Chave de parceiro ─────────────────────────────────────────────────────
  async getAcademyByPartnerKeyHash(db, hash) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy WHERE partner_key_hash = $1 LIMIT 1`,
      [hash]
    );
    return r.rows[0] || null;
  },

  async setPartnerKey(db, id_academy, hash) {
    const r = await db.query(
      `UPDATE public.tb_academy
          SET partner_key_hash = $2, partner_key_created_at = NOW(), updated_at = NOW()
        WHERE id_academy = $1
        RETURNING id_academy, slug, nome, partner_key_created_at`,
      [id_academy, hash]
    );
    return r.rows[0] || null;
  },

  async getPartnerKeyStatus(db, id_academy) {
    const r = await db.query(
      `SELECT (partner_key_hash IS NOT NULL) AS existe, partner_key_created_at AS criado_em
         FROM public.tb_academy WHERE id_academy = $1`,
      [id_academy]
    );
    return r.rows[0] || null;
  },

  // ─── Usuário ───────────────────────────────────────────────────────────────
  async getUserByCpf(db, cpf) {
    const r = await db.query(
      `SELECT id_user, nome, academy_onboarding_state, (senha IS NOT NULL) AS has_password
         FROM public.tb_user WHERE cpf = $1 LIMIT 1`,
      [cpf]
    );
    return r.rows[0] || null;
  },

  async getUserOnboarding(db, id_user) {
    const r = await db.query(
      `SELECT id_user, nome, email, avatar, ativo, academy_onboarding_state, academy_onboarding_id_academy,
              (senha IS NOT NULL) AS has_password
         FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
      [id_user]
    );
    return r.rows[0] || null;
  },

  async markUserAwaitingAcceptance(db, { id_user, id_academy, telefone }) {
    await db.query(
      `UPDATE public.tb_user
          SET academy_onboarding_state = '${ESTADO_AGUARDANDO}',
              academy_onboarding_id_academy = $2,
              telefone = COALESCE($3, telefone),
              updated_at = NOW()
        WHERE id_user = $1`,
      [id_user, id_academy, telefone || null]
    );
  },

  async setOnboardingState(db, id_user, state) {
    await db.query(
      `UPDATE public.tb_user SET academy_onboarding_state = $2, updated_at = NOW() WHERE id_user = $1`,
      [id_user, state]
    );
  },

  // ─── Vínculo ───────────────────────────────────────────────────────────────
  // Vínculo vindo do software da academia. Nasce 'pending' com
  // last_refreshed_at NULL: o próximo sweep do AcademySyncService consulta o
  // provider (GET member?cpf=) e grava o status real da matrícula — a API de
  // parceiro não inventa status.
  async upsertPartnerMember(db, { id_academy, id_user, cpf, member_name, ref_externa }) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_member (id_academy, id_user, cpf, member_name, ref_externa)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id_academy, id_user) DO UPDATE SET
         member_name = COALESCE(EXCLUDED.member_name, tb_academy_member.member_name),
         ref_externa = COALESCE(EXCLUDED.ref_externa, tb_academy_member.ref_externa)
       RETURNING *`,
      [id_academy, id_user, cpf, member_name || null, ref_externa || null]
    );
    return r.rows[0];
  },

  // ─── Primeiro acesso ───────────────────────────────────────────────────────
  // Link novo invalida os anteriores ainda não usados (só o último vale).
  async replaceFirstAccess(db, { id_user, id_academy, token_hash, expira_em }) {
    await db.query(
      `DELETE FROM public.tb_user_first_access WHERE id_user = $1 AND usado_em IS NULL`,
      [id_user]
    );
    const r = await db.query(
      `INSERT INTO public.tb_user_first_access (id_user, id_academy, token_hash, expira_em)
       VALUES ($1,$2,$3,$4) RETURNING id_first_access, expira_em`,
      [id_user, id_academy, token_hash, expira_em]
    );
    return r.rows[0];
  },

  async findFirstAccessByHash(db, token_hash, { forUpdate = false } = {}) {
    const r = await db.query(
      `SELECT fa.id_first_access, fa.id_user, fa.id_academy, fa.expira_em, fa.usado_em,
              (fa.usado_em IS NULL AND fa.expira_em > NOW()) AS valido
         FROM public.tb_user_first_access fa
        WHERE fa.token_hash = $1
        LIMIT 1 ${forUpdate ? "FOR UPDATE" : ""}`,
      [token_hash]
    );
    return r.rows[0] || null;
  },

  async markFirstAccessUsed(db, id_first_access) {
    await db.query(
      `UPDATE public.tb_user_first_access SET usado_em = NOW() WHERE id_first_access = $1`,
      [id_first_access]
    );
  },

  // ─── Foto do cadastro na academia ──────────────────────────────────────────
  async upsertMemberPhoto(db, { id_academy, id_user, photo_key, content_type }) {
    const prev = await db.query(
      `SELECT photo_key FROM public.tb_academy_member_photo WHERE id_academy = $1 AND id_user = $2`,
      [id_academy, id_user]
    );
    await db.query(
      `INSERT INTO public.tb_academy_member_photo (id_academy, id_user, photo_key, content_type)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_academy, id_user) DO UPDATE SET
         photo_key = EXCLUDED.photo_key,
         content_type = EXCLUDED.content_type,
         updated_at = NOW()`,
      [id_academy, id_user, photo_key, content_type]
    );
    return prev.rows[0] ? prev.rows[0].photo_key : null;
  },

  async getMemberPhoto(db, id_academy, id_user) {
    const r = await db.query(
      `SELECT photo_key, content_type, updated_at FROM public.tb_academy_member_photo
        WHERE id_academy = $1 AND id_user = $2`,
      [id_academy, id_user]
    );
    return r.rows[0] || null;
  },

  async listPhotoKeysForUser(db, id_user) {
    const r = await db.query(
      `SELECT photo_key FROM public.tb_academy_member_photo WHERE id_user = $1`,
      [id_user]
    );
    return r.rows.map((row) => row.photo_key);
  },

  // ─── Listagem do parceiro ──────────────────────────────────────────────────
  async listMembersForPartner(db, id_academy, { afterIdMember = null, limit = 200 }) {
    const r = await db.query(
      `${PARTNER_MEMBER_SELECT}
        WHERE m.id_academy = $1
          AND ($2::uuid IS NULL OR m.id_member > $2::uuid)
        ORDER BY m.id_member ASC
        LIMIT $3`,
      [id_academy, afterIdMember, limit + 1]
    );
    return r.rows;
  },

  async getMemberForPartner(db, id_academy, id_user) {
    const r = await db.query(
      `${PARTNER_MEMBER_SELECT}
        WHERE m.id_academy = $1 AND m.id_user = $2`,
      [id_academy, id_user]
    );
    return r.rows[0] || null;
  },

  // ─── Aceite ────────────────────────────────────────────────────────────────
  async insertConsent(db, { id_user, id_academy, versao_termos, foto_academia_aceita, ip, user_agent }) {
    const r = await db.query(
      `INSERT INTO public.tb_user_consent
         (id_user, id_academy, versao_termos, foto_academia_aceita, ip, user_agent)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id_consent, versao_termos, aceito_em, foto_academia_aceita`,
      [id_user, id_academy || null, versao_termos, !!foto_academia_aceita, ip || null, user_agent || null]
    );
    return r.rows[0];
  },
};
