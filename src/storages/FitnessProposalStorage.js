// src/storages/FitnessProposalStorage.js
// Propostas de alteração do professor (mig 180): staff propõe, aluno confirma
// ou recusa. SQL puro, sem regra de negócio (guards no service).
module.exports = {
  async create(db, { id_academy, id_member, id_student_user, id_professor_user, kind, payload }) {
    const r = await db.query(
      `INSERT INTO public.tb_fitness_change_proposal
         (id_academy, id_member, id_student_user, id_professor_user, kind, payload)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb)
       RETURNING *`,
      [id_academy, id_member, id_student_user, id_professor_user, kind, JSON.stringify(payload || {})]
    );
    return r.rows[0];
  },

  async getById(db, id_proposal) {
    const r = await db.query(
      `SELECT * FROM public.tb_fitness_change_proposal WHERE id_proposal = $1`,
      [id_proposal]
    );
    return r.rows[0] || null;
  },

  // Feed do aluno: pendentes com dados do professor (nome + 1 subperfil
  // visível pro botão de chat — DM é entity_type=profile) e da academia.
  async listPendingForStudent(db, id_student_user) {
    const r = await db.query(
      `SELECT pr.id_proposal, pr.id_academy, pr.id_member, pr.kind, pr.payload, pr.created_at,
              a.nome AS academy_nome, a.slug AS academy_slug,
              prof.nome AS professor_nome, prof.username AS professor_username,
              chatp.id_profile AS professor_profile_id
         FROM public.tb_fitness_change_proposal pr
         JOIN public.tb_academy a ON a.id_academy = pr.id_academy
         JOIN public.tb_user prof ON prof.id_user = pr.id_professor_user
         LEFT JOIN LATERAL (
           SELECT p.id_profile FROM public.tb_profile p
            WHERE p.id_user = pr.id_professor_user AND p.deleted_at IS NULL
            ORDER BY p.created_at ASC LIMIT 1
         ) chatp ON TRUE
        WHERE pr.id_student_user = $1 AND pr.status = 'pending'
        ORDER BY pr.created_at ASC`,
      [id_student_user]
    );
    return r.rows;
  },

  // Painel do professor: pendentes de um membro específico.
  async listPendingForMember(db, id_member) {
    const r = await db.query(
      `SELECT pr.id_proposal, pr.kind, pr.payload, pr.created_at, pr.id_professor_user,
              prof.nome AS professor_nome
         FROM public.tb_fitness_change_proposal pr
         JOIN public.tb_user prof ON prof.id_user = pr.id_professor_user
        WHERE pr.id_member = $1 AND pr.status = 'pending'
        ORDER BY pr.created_at ASC`,
      [id_member]
    );
    return r.rows;
  },

  // Supersede: nova proposta do mesmo assunto cancela a pendente anterior
  // (measurement/kcal_goal por membro; plan_update/plan_delete por id_plan).
  async cancelPendingOfKind(db, id_member, kind, id_plan = null) {
    await db.query(
      `UPDATE public.tb_fitness_change_proposal
          SET status = 'canceled', resolved_at = NOW()
        WHERE id_member = $1 AND status = 'pending' AND kind = $2
          AND ($3::text IS NULL OR payload->>'id_plan' = $3::text)`,
      [id_member, kind, id_plan]
    );
  },

  // Resolve atômico: só transiciona se ainda estiver pending (idempotência —
  // duplo clique/segunda aba não re-aplica).
  async markResolved(db, id_proposal, status) {
    const r = await db.query(
      `UPDATE public.tb_fitness_change_proposal
          SET status = $2, resolved_at = NOW()
        WHERE id_proposal = $1 AND status = 'pending'
        RETURNING *`,
      [id_proposal, status]
    );
    return r.rows[0] || null;
  },

  async cancelById(db, id_proposal) {
    const r = await db.query(
      `UPDATE public.tb_fitness_change_proposal
          SET status = 'canceled', resolved_at = NOW()
        WHERE id_proposal = $1 AND status = 'pending'
        RETURNING *`,
      [id_proposal]
    );
    return r.rows[0] || null;
  },
};
