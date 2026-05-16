/**
 * SupervisionStorage — SQL puro para Conta Supervisionada.
 *
 * Tabelas: parental_invites, supervised_accounts, minor_permissions,
 * minor_machine_access (mig 061). tb_user.is_minor / responsible_user_id
 * são desnormalizações para guards rápidos.
 */

const DEFAULT_PERMISSIONS = {
  can_view_feed: true,
  can_post_feed: true,
  can_use_bees: true,
  can_watch_courses: true,
  can_sell_courses: false,
  can_message: true,
  can_receive_messages: true,
  can_use_global_chat: false,
  can_use_machine_chat: false,
  can_request_service: false,
  can_show_in_showcase: false,
  can_show_in_ranking: false,
  can_have_mural: false,
};

const PERMISSION_KEYS = Object.keys(DEFAULT_PERMISSIONS);

// ---------------------------------------------------------------------------
// parental_invites
// ---------------------------------------------------------------------------

async function createInvite(conn, { responsibleUserId, code, expiresAt }) {
  const r = await conn.query(
    `INSERT INTO public.parental_invites
       (responsible_user_id, code, status, expires_at)
     VALUES ($1, $2, 'active', $3)
     RETURNING *`,
    [responsibleUserId, code, expiresAt]
  );
  return r.rows[0];
}

async function listInvitesByResponsible(conn, responsibleUserId) {
  const r = await conn.query(
    `SELECT * FROM public.parental_invites
      WHERE responsible_user_id = $1
      ORDER BY created_at DESC`,
    [responsibleUserId]
  );
  return r.rows;
}

async function getActiveInviteByCode(conn, code) {
  const r = await conn.query(
    `SELECT * FROM public.parental_invites
      WHERE code = $1
        AND status = 'active'
        AND expires_at > NOW()
      LIMIT 1`,
    [code]
  );
  return r.rows[0] || null;
}

async function revokeInvite(conn, { id_invite, responsibleUserId }) {
  const r = await conn.query(
    `UPDATE public.parental_invites
        SET status = 'revoked',
            revoked_at = NOW(),
            updated_at = NOW()
      WHERE id_invite = $1
        AND responsible_user_id = $2
        AND status = 'active'
      RETURNING *`,
    [id_invite, responsibleUserId]
  );
  return r.rows[0] || null;
}

async function markInviteUsed(conn, { id_invite, usedByUserId }) {
  const r = await conn.query(
    `UPDATE public.parental_invites
        SET status = 'used',
            used_at = NOW(),
            used_by_user_id = $2,
            updated_at = NOW()
      WHERE id_invite = $1
        AND status = 'active'
      RETURNING *`,
    [id_invite, usedByUserId]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// supervised_accounts
// ---------------------------------------------------------------------------

async function createSupervisedAccount(
  conn,
  { minorUserId, responsibleUserId, inviteId, relationship }
) {
  const r = await conn.query(
    `INSERT INTO public.supervised_accounts
       (minor_user_id, responsible_user_id, invite_id, relationship, status)
     VALUES ($1, $2, $3, $4, 'active')
     RETURNING *`,
    [minorUserId, responsibleUserId, inviteId || null, relationship || null]
  );
  return r.rows[0];
}

async function listMinorsByResponsible(conn, responsibleUserId) {
  const r = await conn.query(
    `SELECT sa.*,
            u.id_user      AS minor_id,
            u.username     AS minor_username,
            u.nome         AS minor_nome,
            u.email        AS minor_email,
            u.avatar       AS minor_avatar,
            u.data_nascimento AS minor_birthdate
       FROM public.supervised_accounts sa
       JOIN public.tb_user u ON u.id_user = sa.minor_user_id
      WHERE sa.responsible_user_id = $1
      ORDER BY sa.created_at DESC`,
    [responsibleUserId]
  );
  return r.rows;
}

async function getSupervisedByMinor(conn, minorUserId) {
  const r = await conn.query(
    `SELECT * FROM public.supervised_accounts
      WHERE minor_user_id = $1 AND status = 'active'
      LIMIT 1`,
    [minorUserId]
  );
  return r.rows[0] || null;
}

async function setSupervisedStatusByMinor(
  conn,
  { minorUserId, responsibleUserId, status }
) {
  const r = await conn.query(
    `UPDATE public.supervised_accounts
        SET status = $3, updated_at = NOW()
      WHERE minor_user_id = $1
        AND responsible_user_id = $2
      RETURNING *`,
    [minorUserId, responsibleUserId, status]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// minor_permissions
// ---------------------------------------------------------------------------

async function createDefaultPermissions(conn, minorUserId, overrides = {}) {
  const merged = { ...DEFAULT_PERMISSIONS, ...overrides };
  const cols = PERMISSION_KEYS.map((k, i) => `$${i + 2}`).join(", ");
  const colNames = PERMISSION_KEYS.join(", ");
  const values = PERMISSION_KEYS.map((k) => merged[k]);
  const r = await conn.query(
    `INSERT INTO public.minor_permissions
       (minor_user_id, ${colNames})
     VALUES ($1, ${cols})
     ON CONFLICT (minor_user_id) DO NOTHING
     RETURNING *`,
    [minorUserId, ...values]
  );
  return r.rows[0] || (await getPermissions(conn, minorUserId));
}

async function getPermissions(conn, minorUserId) {
  const r = await conn.query(
    `SELECT * FROM public.minor_permissions WHERE minor_user_id = $1 LIMIT 1`,
    [minorUserId]
  );
  return r.rows[0] || null;
}

async function updatePermissions(conn, minorUserId, patch) {
  const allowed = PERMISSION_KEYS.filter((k) =>
    Object.prototype.hasOwnProperty.call(patch, k)
  );
  if (allowed.length === 0) return getPermissions(conn, minorUserId);

  const sets = allowed.map((k, i) => `${k} = $${i + 2}`).join(", ");
  const values = allowed.map((k) => Boolean(patch[k]));
  const r = await conn.query(
    `UPDATE public.minor_permissions
        SET ${sets}, updated_at = NOW()
      WHERE minor_user_id = $1
      RETURNING *`,
    [minorUserId, ...values]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// minor_machine_access
// ---------------------------------------------------------------------------

async function listMinorMachineAccess(conn, minorUserId) {
  const r = await conn.query(
    `SELECT mma.*, m.slug AS machine_slug, m.name AS machine_name
       FROM public.minor_machine_access mma
       JOIN public.tb_machine m ON m.id_machine = mma.id_machine
      WHERE mma.minor_user_id = $1
      ORDER BY m.display_order ASC, m.name ASC`,
    [minorUserId]
  );
  return r.rows;
}

async function setMinorMachineAccess(
  conn,
  { minorUserId, idMachine, allowed }
) {
  const r = await conn.query(
    `INSERT INTO public.minor_machine_access
       (minor_user_id, id_machine, allowed)
     VALUES ($1, $2, $3)
     ON CONFLICT (minor_user_id, id_machine)
       DO UPDATE SET allowed = EXCLUDED.allowed, updated_at = NOW()
     RETURNING *`,
    [minorUserId, idMachine, Boolean(allowed)]
  );
  return r.rows[0];
}

async function isMachineAllowedForMinor(conn, minorUserId, idMachine) {
  const r = await conn.query(
    `SELECT allowed FROM public.minor_machine_access
      WHERE minor_user_id = $1 AND id_machine = $2
      LIMIT 1`,
    [minorUserId, idMachine]
  );
  return r.rows[0]?.allowed === true;
}

// ---------------------------------------------------------------------------
// User flags (denormalização)
// ---------------------------------------------------------------------------

async function markUserAsMinor(conn, { userId, responsibleUserId }) {
  await conn.query(
    `UPDATE public.tb_user
        SET is_minor = TRUE,
            responsible_user_id = $2,
            updated_at = NOW()
      WHERE id_user = $1`,
    [userId, responsibleUserId]
  );
}

async function getUserMinorFlags(conn, userId) {
  const r = await conn.query(
    `SELECT id_user, is_minor, responsible_user_id, data_nascimento
       FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

// ---------------------------------------------------------------------------
// Mensagens supervisionadas — visão read-only do responsável
// ---------------------------------------------------------------------------

/**
 * Lista todas as conversas envolvendo qualquer profile do menor.
 * Retorna uma linha por conversa, com o profile (entity) do menor e o other.
 */
async function listMinorConversations(conn, minorUserId) {
  const r = await conn.query(
    `
    WITH minor_profiles AS (
      SELECT id_profile FROM public.tb_profile
       WHERE id_user = $1 AND deleted_at IS NULL
    )
    SELECT
      c.id_conversation,
      c.last_message_at,
      c.last_message_preview,
      c.last_message_sender_entity_id,
      CASE
        WHEN c.entity_a_id IN (SELECT id_profile FROM minor_profiles)
          THEN c.entity_a_id
        ELSE c.entity_b_id
      END AS minor_entity_id,
      CASE
        WHEN c.entity_a_id IN (SELECT id_profile FROM minor_profiles)
          THEN c.entity_b_id
        ELSE c.entity_a_id
      END AS other_entity_id,
      mp.display_name AS minor_display_name,
      mp.avatar_url   AS minor_avatar_url,
      op.display_name AS other_display_name,
      op.avatar_url   AS other_avatar_url,
      ou.username     AS other_username
    FROM public.tb_conversation c
    LEFT JOIN public.tb_profile mp
      ON mp.id_profile = CASE
        WHEN c.entity_a_id IN (SELECT id_profile FROM minor_profiles)
          THEN c.entity_a_id
        ELSE c.entity_b_id
      END
    LEFT JOIN public.tb_profile op
      ON op.id_profile = CASE
        WHEN c.entity_a_id IN (SELECT id_profile FROM minor_profiles)
          THEN c.entity_b_id
        ELSE c.entity_a_id
      END
    LEFT JOIN public.tb_user ou ON ou.id_user = op.id_user
    WHERE c.deleted_at IS NULL
      AND (
        c.entity_a_id IN (SELECT id_profile FROM minor_profiles)
        OR c.entity_b_id IN (SELECT id_profile FROM minor_profiles)
      )
    ORDER BY c.last_message_at DESC NULLS LAST
    LIMIT 100
    `,
    [minorUserId]
  );
  return r.rows;
}

/**
 * Lista mensagens de uma conversa específica (read-only). Garante que pelo
 * menos um dos participantes pertença ao menor.
 */
async function listMinorConversationMessages(
  conn,
  { minorUserId, idConversation, limit = 100 }
) {
  const own = await conn.query(
    `
    SELECT 1
      FROM public.tb_conversation c
      JOIN public.tb_profile p
        ON p.id_profile IN (c.entity_a_id, c.entity_b_id)
     WHERE c.id_conversation = $1
       AND p.id_user = $2
       AND c.deleted_at IS NULL
     LIMIT 1
    `,
    [idConversation, minorUserId]
  );
  if (own.rowCount === 0) return null;

  const r = await conn.query(
    `
    SELECT m.id_message,
           m.id_conversation,
           m.sender_entity_id,
           m.sender_user_id,
           m.body,
           m.created_at,
           sp.display_name AS sender_display_name,
           sp.avatar_url   AS sender_avatar_url
      FROM public.tb_message m
      LEFT JOIN public.tb_profile sp ON sp.id_profile = m.sender_entity_id
     WHERE m.id_conversation = $1
       AND m.deleted_at IS NULL
     ORDER BY m.created_at ASC
     LIMIT $2
    `,
    [idConversation, limit]
  );
  return r.rows;
}

module.exports = {
  DEFAULT_PERMISSIONS,
  PERMISSION_KEYS,

  // invites
  createInvite,
  listInvitesByResponsible,
  getActiveInviteByCode,
  revokeInvite,
  markInviteUsed,

  // supervised
  createSupervisedAccount,
  listMinorsByResponsible,
  getSupervisedByMinor,
  setSupervisedStatusByMinor,

  // permissions
  createDefaultPermissions,
  getPermissions,
  updatePermissions,

  // machines
  listMinorMachineAccess,
  setMinorMachineAccess,
  isMachineAllowedForMinor,

  // user flags
  markUserAsMinor,
  getUserMinorFlags,

  // mensagens supervisionadas
  listMinorConversations,
  listMinorConversationMessages,
};
