// src/storages/LiveClusterStorage.js
// Acesso a dados dos Clusters de Live (mig 185): cluster + membros + botões
// de sinal. Os SINAIS em si são efêmeros (socket.io) — nada persiste aqui.

const CLUSTER_COLUMNS = `
  c.id_live_cluster, c.name, c.status, c.started_at, c.created_by,
  c.is_active, c.created_at, c.updated_at
`;

module.exports = {
  // ── Clusters ────────────────────────────────────────────────────────────────

  async listClusters(db) {
    const { rows } = await db.query(
      `SELECT ${CLUSTER_COLUMNS},
              (SELECT COUNT(*)::int FROM public.tb_live_cluster_member m
                WHERE m.id_live_cluster = c.id_live_cluster) AS member_count
         FROM public.tb_live_cluster c
        ORDER BY c.created_at DESC`
    );
    return rows;
  },

  async getClusterById(db, id_live_cluster) {
    const { rows } = await db.query(
      `SELECT ${CLUSTER_COLUMNS}
         FROM public.tb_live_cluster c
        WHERE c.id_live_cluster = $1
        LIMIT 1`,
      [id_live_cluster]
    );
    return rows[0] || null;
  },

  async createCluster(db, { name, created_by }) {
    const { rows } = await db.query(
      `INSERT INTO public.tb_live_cluster (name, created_by)
       VALUES ($1, $2)
       RETURNING id_live_cluster, name, status, started_at, created_by,
                 is_active, created_at, updated_at`,
      [name, created_by]
    );
    return rows[0];
  },

  async updateCluster(db, id_live_cluster, { name, is_active }) {
    const { rows } = await db.query(
      `UPDATE public.tb_live_cluster
          SET name       = COALESCE($2, name),
              is_active  = COALESCE($3, is_active),
              updated_at = NOW()
        WHERE id_live_cluster = $1
        RETURNING id_live_cluster, name, status, started_at, created_by,
                  is_active, created_at, updated_at`,
      [id_live_cluster, name ?? null, is_active ?? null]
    );
    return rows[0] || null;
  },

  async deleteCluster(db, id_live_cluster) {
    const { rowCount } = await db.query(
      `DELETE FROM public.tb_live_cluster WHERE id_live_cluster = $1`,
      [id_live_cluster]
    );
    return rowCount > 0;
  },

  // Transição de status com guarda (idle→started / started→idle). Retorna a
  // linha atualizada ou null se já estava no estado alvo (evita start duplo).
  async setStatus(db, id_live_cluster, { status }) {
    const { rows } = await db.query(
      `UPDATE public.tb_live_cluster
          SET status     = $2,
              started_at = CASE WHEN $2 = 'started' THEN NOW() ELSE started_at END,
              updated_at = NOW()
        WHERE id_live_cluster = $1 AND status <> $2
        RETURNING id_live_cluster, name, status, started_at, is_active`,
      [id_live_cluster, status]
    );
    return rows[0] || null;
  },

  // ── Membros ─────────────────────────────────────────────────────────────────

  async listMembers(db, id_live_cluster) {
    const { rows } = await db.query(
      `SELECT m.id_user, m.added_at, u.username, u.nome AS name, u.avatar AS avatar_url
         FROM public.tb_live_cluster_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
        WHERE m.id_live_cluster = $1
        ORDER BY m.added_at ASC`,
      [id_live_cluster]
    );
    return rows;
  },

  async findUserByUsername(db, username) {
    const { rows } = await db.query(
      `SELECT id_user, username, nome AS name, avatar AS avatar_url
         FROM public.tb_user
        WHERE LOWER(username) = LOWER($1)
        LIMIT 1`,
      [username]
    );
    return rows[0] || null;
  },

  async addMember(db, { id_live_cluster, id_user }) {
    const { rowCount } = await db.query(
      `INSERT INTO public.tb_live_cluster_member (id_live_cluster, id_user)
       VALUES ($1, $2)
       ON CONFLICT (id_live_cluster, id_user) DO NOTHING`,
      [id_live_cluster, id_user]
    );
    return rowCount > 0;
  },

  async removeMember(db, { id_live_cluster, id_user }) {
    const { rowCount } = await db.query(
      `DELETE FROM public.tb_live_cluster_member
        WHERE id_live_cluster = $1 AND id_user = $2`,
      [id_live_cluster, id_user]
    );
    return rowCount > 0;
  },

  async isMember(db, { id_live_cluster, id_user }) {
    const { rows } = await db.query(
      `SELECT 1 FROM public.tb_live_cluster_member
        WHERE id_live_cluster = $1 AND id_user = $2
        LIMIT 1`,
      [id_live_cluster, id_user]
    );
    return rows.length > 0;
  },

  // Clusters onde o usuário é membro (superfície /cluster do membro).
  async listClustersForUser(db, id_user) {
    const { rows } = await db.query(
      `SELECT ${CLUSTER_COLUMNS},
              (SELECT COUNT(*)::int FROM public.tb_live_cluster_member m2
                WHERE m2.id_live_cluster = c.id_live_cluster) AS member_count
         FROM public.tb_live_cluster c
         JOIN public.tb_live_cluster_member m ON m.id_live_cluster = c.id_live_cluster
        WHERE m.id_user = $1 AND c.is_active = TRUE
        ORDER BY c.created_at DESC`,
      [id_user]
    );
    return rows;
  },

  // Usado pelo socket (subscribe): membro OU administrador podem ouvir a sala.
  async canAccessCluster(db, { id_live_cluster, id_user }) {
    const { rows } = await db.query(
      `SELECT 1
         FROM public.tb_live_cluster c
        WHERE c.id_live_cluster = $1
          AND (
            EXISTS (SELECT 1 FROM public.tb_live_cluster_member m
                     WHERE m.id_live_cluster = c.id_live_cluster AND m.id_user = $2)
            OR EXISTS (SELECT 1 FROM public.tb_user_role ur
                        JOIN public.tb_role r ON r.id_role = ur.id_role
                       WHERE ur.id_user = $2 AND r.desc_role = 'Administrator')
          )
        LIMIT 1`,
      [id_live_cluster, id_user]
    );
    return rows.length > 0;
  },

  // ── Botões de sinal ─────────────────────────────────────────────────────────

  async listButtons(db, id_live_cluster, { onlyActive = false } = {}) {
    const { rows } = await db.query(
      `SELECT id_button, id_live_cluster, label, color, sort_order, is_active, created_at
         FROM public.tb_live_cluster_button
        WHERE id_live_cluster = $1 ${onlyActive ? "AND is_active = TRUE" : ""}
        ORDER BY sort_order ASC, created_at ASC`,
      [id_live_cluster]
    );
    return rows;
  },

  async getButtonById(db, { id_live_cluster, id_button }) {
    const { rows } = await db.query(
      `SELECT id_button, id_live_cluster, label, color, sort_order, is_active
         FROM public.tb_live_cluster_button
        WHERE id_button = $1 AND id_live_cluster = $2
        LIMIT 1`,
      [id_button, id_live_cluster]
    );
    return rows[0] || null;
  },

  async createButton(db, { id_live_cluster, label, color, sort_order = 0 }) {
    const { rows } = await db.query(
      `INSERT INTO public.tb_live_cluster_button (id_live_cluster, label, color, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id_button, id_live_cluster, label, color, sort_order, is_active, created_at`,
      [id_live_cluster, label, color, sort_order]
    );
    return rows[0];
  },

  async updateButton(db, { id_live_cluster, id_button, label, color, sort_order, is_active }) {
    const { rows } = await db.query(
      `UPDATE public.tb_live_cluster_button
          SET label      = COALESCE($3, label),
              color      = COALESCE($4, color),
              sort_order = COALESCE($5, sort_order),
              is_active  = COALESCE($6, is_active)
        WHERE id_button = $1 AND id_live_cluster = $2
        RETURNING id_button, id_live_cluster, label, color, sort_order, is_active, created_at`,
      [id_button, id_live_cluster, label ?? null, color ?? null, sort_order ?? null, is_active ?? null]
    );
    return rows[0] || null;
  },

  async deleteButton(db, { id_live_cluster, id_button }) {
    const { rowCount } = await db.query(
      `DELETE FROM public.tb_live_cluster_button
        WHERE id_button = $1 AND id_live_cluster = $2`,
      [id_button, id_live_cluster]
    );
    return rowCount > 0;
  },
};
