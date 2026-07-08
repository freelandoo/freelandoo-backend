// src/storages/AcademyStorage.js
// Persistência de Fitness & Academias — fase 1 (mig 176): academia, vínculo
// por CPF, professores e espelhos de catraca/pagamentos (idempotentes).
module.exports = {
  // ─── Academia ──────────────────────────────────────────────────────────────
  async createAcademy(db, a) {
    const r = await db.query(
      `INSERT INTO public.tb_academy
         (id_owner_user, nome, slug, descricao, cidade, api_base_url, api_token_enc)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING *`,
      [a.id_owner_user, a.nome, a.slug, a.descricao || null, a.cidade || null, a.api_base_url, a.api_token_enc]
    );
    return r.rows[0];
  },

  async updateAcademy(db, id_academy, patch) {
    const allowed = ["nome", "descricao", "cidade", "api_base_url", "api_token_enc", "avatar_url", "cover_url", "is_active"];
    const sets = [];
    const vals = [id_academy];
    for (const key of allowed) {
      if (patch[key] !== undefined) {
        vals.push(patch[key]);
        sets.push(`${key} = $${vals.length}`);
      }
    }
    if (!sets.length) return this.getById(db, id_academy);
    const r = await db.query(
      `UPDATE public.tb_academy SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id_academy = $1 RETURNING *`,
      vals
    );
    return r.rows[0] || null;
  },

  async getById(db, id_academy) {
    const r = await db.query(`SELECT * FROM public.tb_academy WHERE id_academy = $1`, [id_academy]);
    return r.rows[0] || null;
  },

  async getBySlug(db, slug) {
    const r = await db.query(`SELECT * FROM public.tb_academy WHERE slug = $1`, [slug]);
    return r.rows[0] || null;
  },

  // Subperfil (oldest, não-deletado) de um usuário para receber DM — a academia
  // "recebe mensagens como um subperfil" abrindo conversa com o dono. DM é
  // entity_type=profile, então precisamos de um id_profile alvo.
  async getChatProfileForUser(db, id_user) {
    const r = await db.query(
      `SELECT id_profile FROM public.tb_profile
        WHERE id_user = $1 AND deleted_at IS NULL
        ORDER BY created_at ASC LIMIT 1`,
      [id_user]
    );
    return r.rows[0] ? r.rows[0].id_profile : null;
  },

  async slugExists(db, slug) {
    const r = await db.query(`SELECT 1 FROM public.tb_academy WHERE slug = $1`, [slug]);
    return r.rowCount > 0;
  },

  async search(db, { q, city, limit = 30 }) {
    const vals = [];
    const where = ["is_active = TRUE"];
    if (q) {
      vals.push(`%${q}%`);
      where.push(`nome ILIKE $${vals.length}`);
    }
    if (city) {
      vals.push(`%${city}%`);
      where.push(`cidade ILIKE $${vals.length}`);
    }
    vals.push(limit);
    const r = await db.query(
      `SELECT a.id_academy, a.nome, a.slug, a.descricao, a.cidade, a.avatar_url, a.cover_url, a.created_at,
              (SELECT COUNT(*)::int FROM public.tb_academy_member m WHERE m.id_academy = a.id_academy) AS member_count
         FROM public.tb_academy a
        WHERE ${where.join(" AND ")}
        ORDER BY a.created_at DESC
        LIMIT $${vals.length}`,
      vals
    );
    return r.rows;
  },

  async listByOwner(db, id_owner_user) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy WHERE id_owner_user = $1 ORDER BY created_at DESC`,
      [id_owner_user]
    );
    return r.rows;
  },

  async setSync(db, id_academy, { status, error, events_cursor, payments_cursor }) {
    await db.query(
      `UPDATE public.tb_academy
          SET sync_status = COALESCE($2, sync_status),
              sync_error = $3,
              events_cursor = COALESCE($4, events_cursor),
              payments_cursor = COALESCE($5, payments_cursor),
              last_sync_at = NOW(),
              updated_at = NOW()
        WHERE id_academy = $1`,
      [id_academy, status || null, error || null, events_cursor || null, payments_cursor || null]
    );
  },

  async listForSync(db, limit = 10) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy
        WHERE is_active = TRUE
        ORDER BY last_sync_at ASC NULLS FIRST
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  },

  // ─── Membros (vínculo CPF) ─────────────────────────────────────────────────
  async upsertMember(db, m) {
    const r = await db.query(
      `INSERT INTO public.tb_academy_member
         (id_academy, id_user, cpf, member_name, membership_status, plan_name, enrolled_at, expires_at, last_refreshed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (id_academy, id_user) DO UPDATE SET
         cpf = EXCLUDED.cpf,
         member_name = EXCLUDED.member_name,
         membership_status = EXCLUDED.membership_status,
         plan_name = EXCLUDED.plan_name,
         enrolled_at = EXCLUDED.enrolled_at,
         expires_at = EXCLUDED.expires_at,
         last_refreshed_at = NOW()
       RETURNING *`,
      [m.id_academy, m.id_user, m.cpf, m.member_name || null, m.membership_status, m.plan_name || null, m.enrolled_at || null, m.expires_at || null]
    );
    return r.rows[0];
  },

  async getMember(db, id_academy, id_user) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_member WHERE id_academy = $1 AND id_user = $2`,
      [id_academy, id_user]
    );
    return r.rows[0] || null;
  },

  async getMemberById(db, id_member) {
    const r = await db.query(`SELECT * FROM public.tb_academy_member WHERE id_member = $1`, [id_member]);
    return r.rows[0] || null;
  },

  async getMemberByCpf(db, id_academy, cpf) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_member WHERE id_academy = $1 AND cpf = $2`,
      [id_academy, cpf]
    );
    return r.rows[0] || null;
  },

  async deleteMember(db, id_academy, id_user) {
    const r = await db.query(
      `DELETE FROM public.tb_academy_member WHERE id_academy = $1 AND id_user = $2`,
      [id_academy, id_user]
    );
    return r.rowCount > 0;
  },

  async listMembers(db, id_academy) {
    const r = await db.query(
      `SELECT m.*, u.username, u.nome AS user_nome,
              (p.id_user IS NOT NULL) AS is_professor
         FROM public.tb_academy_member m
         JOIN public.tb_user u ON u.id_user = m.id_user
         LEFT JOIN public.tb_academy_professor p
           ON p.id_academy = m.id_academy AND p.id_user = m.id_user
        WHERE m.id_academy = $1
        ORDER BY m.linked_at DESC`,
      [id_academy]
    );
    return r.rows;
  },

  async listMembershipsByUser(db, id_user) {
    const r = await db.query(
      `SELECT m.*, a.nome AS academy_nome, a.slug AS academy_slug, a.cidade AS academy_cidade,
              a.avatar_url AS academy_avatar_url
         FROM public.tb_academy_member m
         JOIN public.tb_academy a ON a.id_academy = m.id_academy
        WHERE m.id_user = $1
        ORDER BY m.linked_at DESC`,
      [id_user]
    );
    return r.rows;
  },

  async listCpfMapForAcademy(db, id_academy) {
    const r = await db.query(
      `SELECT id_member, cpf FROM public.tb_academy_member WHERE id_academy = $1`,
      [id_academy]
    );
    const map = {};
    for (const row of r.rows) map[row.cpf] = row.id_member;
    return map;
  },

  async listMembersDueRefresh(db, id_academy, hours = 24, limit = 50) {
    const r = await db.query(
      `SELECT * FROM public.tb_academy_member
        WHERE id_academy = $1
          AND (last_refreshed_at IS NULL OR last_refreshed_at < NOW() - ($2 || ' hours')::interval)
        ORDER BY last_refreshed_at ASC NULLS FIRST
        LIMIT $3`,
      [id_academy, hours, limit]
    );
    return r.rows;
  },

  async refreshMemberStatus(db, id_member, { member_name, membership_status, plan_name, enrolled_at, expires_at }) {
    await db.query(
      `UPDATE public.tb_academy_member
          SET member_name = COALESCE($2, member_name),
              membership_status = $3,
              plan_name = $4,
              enrolled_at = $5,
              expires_at = $6,
              last_refreshed_at = NOW()
        WHERE id_member = $1`,
      [id_member, member_name || null, membership_status, plan_name || null, enrolled_at || null, expires_at || null]
    );
  },

  async userHasActiveMembership(db, id_user) {
    const r = await db.query(
      `SELECT 1 FROM public.tb_academy_member
        WHERE id_user = $1 AND membership_status = 'active' LIMIT 1`,
      [id_user]
    );
    return r.rowCount > 0;
  },

  // ─── Professores ───────────────────────────────────────────────────────────
  async addProfessor(db, id_academy, id_user, granted_by) {
    await db.query(
      `INSERT INTO public.tb_academy_professor (id_academy, id_user, granted_by)
       VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
      [id_academy, id_user, granted_by]
    );
  },

  async removeProfessor(db, id_academy, id_user) {
    const r = await db.query(
      `DELETE FROM public.tb_academy_professor WHERE id_academy = $1 AND id_user = $2`,
      [id_academy, id_user]
    );
    return r.rowCount > 0;
  },

  async isProfessor(db, id_academy, id_user) {
    const r = await db.query(
      `SELECT 1 FROM public.tb_academy_professor WHERE id_academy = $1 AND id_user = $2`,
      [id_academy, id_user]
    );
    return r.rowCount > 0;
  },

  async listProfessors(db, id_academy) {
    const r = await db.query(
      `SELECT p.id_user, p.created_at, u.username, u.nome AS user_nome
         FROM public.tb_academy_professor p
         JOIN public.tb_user u ON u.id_user = p.id_user
        WHERE p.id_academy = $1
        ORDER BY p.created_at ASC`,
      [id_academy]
    );
    return r.rows;
  },

  async listProfessorAcademies(db, id_user) {
    const r = await db.query(
      `SELECT id_academy FROM public.tb_academy_professor WHERE id_user = $1`,
      [id_user]
    );
    return r.rows.map((row) => row.id_academy);
  },

  // ─── Espelho: eventos de catraca ───────────────────────────────────────────
  async insertAccessEvents(db, id_academy, events) {
    let inserted = 0;
    for (const e of events) {
      const r = await db.query(
        `INSERT INTO public.tb_academy_access_event (id_academy, id_member, external_id, occurred_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id_academy, external_id) DO NOTHING`,
        [id_academy, e.id_member, e.external_id, e.occurred_at]
      );
      inserted += r.rowCount;
    }
    return inserted;
  },

  async countDistinctDays(db, id_member, sinceDate) {
    const r = await db.query(
      `SELECT COUNT(DISTINCT occurred_at::date)::int AS days
         FROM public.tb_academy_access_event
        WHERE id_member = $1 AND occurred_at >= $2`,
      [id_member, sinceDate]
    );
    return r.rows[0].days;
  },

  async listEventDays(db, id_member, fromDate, toDate) {
    const r = await db.query(
      `SELECT DISTINCT occurred_at::date AS day
         FROM public.tb_academy_access_event
        WHERE id_member = $1 AND occurred_at >= $2 AND occurred_at < $3
        ORDER BY day ASC`,
      [id_member, fromDate, toDate]
    );
    return r.rows.map((row) => row.day);
  },

  // ─── Espelho: pagamentos ───────────────────────────────────────────────────
  async upsertPayments(db, id_academy, payments) {
    let upserted = 0;
    for (const p of payments) {
      const r = await db.query(
        `INSERT INTO public.tb_academy_payment
           (id_academy, id_member, external_id, amount_cents, due_date, status, paid_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id_academy, external_id) DO UPDATE SET
           amount_cents = EXCLUDED.amount_cents,
           due_date = EXCLUDED.due_date,
           status = EXCLUDED.status,
           paid_at = EXCLUDED.paid_at,
           updated_at = NOW()`,
        [id_academy, p.id_member, p.external_id, p.amount_cents, p.due_date || null, p.status, p.paid_at || null]
      );
      upserted += r.rowCount;
    }
    return upserted;
  },

  async listPaymentsForMember(db, id_member, limit = 12) {
    const r = await db.query(
      `SELECT external_id, amount_cents, due_date, status, paid_at
         FROM public.tb_academy_payment
        WHERE id_member = $1
        ORDER BY due_date DESC NULLS LAST
        LIMIT $2`,
      [id_member, limit]
    );
    return r.rows;
  },
};
