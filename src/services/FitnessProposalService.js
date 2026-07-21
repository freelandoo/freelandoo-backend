// src/services/FitnessProposalService.js
// Propostas de alteração do professor (mig 180). Fluxo: staff da academia
// edita peso/altura, limite de calorias ou fichas de treino do aluno → vira
// proposta 'pending'; o aluno vê um modal no /fitness e confirma (aplica) ou
// recusa. Nova proposta do mesmo assunto substitui a pendente anterior.
// Push: evento socket 'fitness:proposal' pro aluno (poll só como fallback).
const pool = require("../databases");
const FitnessProposalStorage = require("../storages/FitnessProposalStorage");
const WorkoutStorage = require("../storages/WorkoutStorage");
const FitnessStorage = require("../storages/FitnessStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const AcademyService = require("./AcademyService");
const FitnessService = require("./FitnessService");
const realtime = require("../realtime/socket");
const { sanitizeExercises } = require("../utils/workoutSanitize");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("fitness-proposal-service");

const KINDS = ["measurement", "kcal_goal", "plan_create", "plan_update", "plan_delete"];

// Junta o nome do exercício no payload pra o modal do aluno exibir a ficha
// sem precisar de outra chamada.
async function hydrateExerciseNames(exercises) {
  const ids = exercises.map((e) => e.id_exercise);
  const r = await pool.query(
    `SELECT id_exercise, nome, muscle_group FROM public.tb_exercise WHERE id_exercise = ANY($1::uuid[])`,
    [ids]
  );
  const byId = new Map(r.rows.map((row) => [row.id_exercise, row]));
  for (const ex of exercises) {
    const found = byId.get(ex.id_exercise);
    if (!found) return { error: "Exercício não encontrado" };
    ex.exercise_nome = found.nome;
    ex.muscle_group = found.muscle_group;
  }
  return { exercises };
}

async function buildPayload(kind, raw, member) {
  if (kind === "measurement") {
    const weight = raw?.weight_kg === undefined || raw.weight_kg === null || raw.weight_kg === "" ? null : Number(raw.weight_kg);
    const height = raw?.height_cm === undefined || raw.height_cm === null || raw.height_cm === "" ? null : Number(raw.height_cm);
    if (weight === null && height === null) return { error: "Informe peso e/ou altura" };
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight >= 500)) return { error: "Peso inválido" };
    if (height !== null && (!Number.isFinite(height) || height <= 0 || height >= 300)) return { error: "Altura inválida" };
    return { payload: { weight_kg: weight, height_cm: height } };
  }

  if (kind === "kcal_goal") {
    const kcal = Math.round(Number(raw?.daily_kcal_goal));
    if (!Number.isFinite(kcal) || kcal < 500 || kcal > 10000) return { error: "Meta de calorias inválida (500–10000)" };
    return { payload: { daily_kcal_goal: kcal } };
  }

  if (kind === "plan_create" || kind === "plan_update") {
    let id_plan = null;
    let currentName = null;
    if (kind === "plan_update") {
      // Casa pelo DONO (mig 189): a ficha pode ter sido criada pelo próprio
      // aluno, e aí não tem id_member nenhum.
      const plan = await WorkoutStorage.getPlanById(pool, raw?.id_plan);
      if (!plan || plan.id_user !== member.id_user) return { error: "Ficha não encontrada" };
      id_plan = plan.id_plan;
      currentName = plan.nome;
    }
    const nome = raw?.nome === undefined ? undefined : String(raw.nome || "").trim().slice(0, 60);
    if (kind === "plan_create" && !nome) return { error: "Nome da ficha é obrigatório (ex.: Treino A)" };
    if (kind === "plan_update" && nome === "") return { error: "Nome da ficha é obrigatório (ex.: Treino A)" };
    const payload = {
      nome: nome === undefined ? undefined : nome,
      notes: raw?.notes === undefined ? undefined : raw.notes ? String(raw.notes).slice(0, 2000) : null,
    };
    if (kind === "plan_update") {
      payload.id_plan = id_plan;
      payload.plan_nome = currentName;
      if (raw?.is_active !== undefined) payload.is_active = Boolean(raw.is_active);
    }
    if (kind === "plan_create" || Array.isArray(raw?.exercises)) {
      const check = sanitizeExercises(raw?.exercises);
      if (check.error) return check;
      const hydrated = await hydrateExerciseNames(check.exercises);
      if (hydrated.error) return hydrated;
      payload.exercises = hydrated.exercises;
    }
    return { payload };
  }

  if (kind === "plan_delete") {
    const plan = await WorkoutStorage.getPlanById(pool, raw?.id_plan);
    if (!plan || plan.id_user !== member.id_user) return { error: "Ficha não encontrada" };
    return { payload: { id_plan: plan.id_plan, plan_nome: plan.nome } };
  }

  return { error: "Tipo de proposta inválido" };
}

async function applyProposal(proposal) {
  const payload = proposal.payload || {};

  if (proposal.kind === "measurement") {
    return FitnessService.addMeasurement(proposal.id_student_user, payload, proposal.id_professor_user);
  }

  if (proposal.kind === "kcal_goal") {
    await FitnessStorage.setKcalGoal(pool, proposal.id_student_user, payload.daily_kcal_goal);
    return { ok: true };
  }

  if (proposal.kind === "plan_create") {
    const plan = await WorkoutStorage.createPlan(pool, {
      id_user: proposal.id_student_user,
      id_academy: proposal.id_academy,
      id_member: proposal.id_member,
      created_by: proposal.id_professor_user,
      nome: payload.nome,
      notes: payload.notes || null,
    });
    await WorkoutStorage.replacePlanExercises(pool, plan.id_plan, payload.exercises || []);
    return { ok: true };
  }

  if (proposal.kind === "plan_update") {
    const plan = await WorkoutStorage.getPlanById(pool, payload.id_plan);
    // Ficha sumiu entre a proposta e o aceite: no-op (nada a aplicar).
    if (!plan || plan.id_user !== proposal.id_student_user) return { ok: true };
    await WorkoutStorage.updatePlan(pool, plan.id_plan, {
      nome: payload.nome,
      notes: payload.notes,
      is_active: payload.is_active,
    });
    if (Array.isArray(payload.exercises)) {
      await WorkoutStorage.replacePlanExercises(pool, plan.id_plan, payload.exercises);
    }
    return { ok: true };
  }

  if (proposal.kind === "plan_delete") {
    const plan = await WorkoutStorage.getPlanById(pool, payload.id_plan);
    if (!plan || plan.id_user !== proposal.id_student_user) return { ok: true };
    await WorkoutStorage.deletePlan(pool, plan.id_plan);
    return { ok: true };
  }

  return { error: "Tipo de proposta inválido" };
}

class FitnessProposalService {
  // ─── Staff propõe ──────────────────────────────────────────────────────────
  static async propose(actor_id_user, id_academy, id_member, body) {
    return runWithLogs(log, "propose", () => ({ id_academy, id_member, kind: body?.kind }), async () => {
      const guard = await AcademyService.assertStaff(id_academy, actor_id_user);
      if (guard.error) return guard;
      const member = await AcademyStorage.getMemberById(pool, id_member);
      if (!member || member.id_academy !== id_academy) return { error: "Membro não encontrado" };
      const kind = String(body?.kind || "");
      if (!KINDS.includes(kind)) return { error: "Tipo de proposta inválido" };

      const built = await buildPayload(kind, body, member);
      if (built.error) return built;

      // Substitui a pendente anterior do mesmo assunto (última edição vence).
      if (kind === "measurement" || kind === "kcal_goal") {
        await FitnessProposalStorage.cancelPendingOfKind(pool, id_member, kind);
      } else if (kind === "plan_update" || kind === "plan_delete") {
        await FitnessProposalStorage.cancelPendingOfKind(pool, id_member, "plan_update", built.payload.id_plan);
        await FitnessProposalStorage.cancelPendingOfKind(pool, id_member, "plan_delete", built.payload.id_plan);
      }

      const proposal = await FitnessProposalStorage.create(pool, {
        id_academy,
        id_member,
        id_student_user: member.id_user,
        id_professor_user: actor_id_user,
        kind,
        payload: built.payload,
      });

      // Push pro aluno (fire-and-forget) — o /fitness aberto reage na hora.
      try {
        realtime.emitToUser(member.id_user, "fitness:proposal", {
          id_proposal: proposal.id_proposal,
          kind,
        });
      } catch (err) {
        log.warn("emit.fail", { error: err.message });
      }

      return { proposal };
    });
  }

  // PATCH/DELETE /academies/:id/plans/:planId — o membro vem da própria ficha.
  static async proposeForPlan(actor_id_user, id_academy, id_plan, kind, body) {
    const plan = await WorkoutStorage.getPlanById(pool, id_plan);
    if (!plan) return { error: "Ficha não encontrada" };
    // A ficha pode ser pessoal (criada pelo aluno, sem id_academy/id_member):
    // o vínculo vem do DONO dentro da academia de quem está propondo. Se o dono
    // não é membro dela, o professor não tem nada com essa ficha.
    const member = await AcademyStorage.getMember(pool, id_academy, plan.id_user);
    if (!member) return { error: "Ficha não encontrada" };
    return this.propose(actor_id_user, id_academy, member.id_member, { ...body, kind, id_plan });
  }

  static async listForMember(actor_id_user, id_academy, id_member) {
    const guard = await AcademyService.assertStaff(id_academy, actor_id_user);
    if (guard.error) return guard;
    const member = await AcademyStorage.getMemberById(pool, id_member);
    if (!member || member.id_academy !== id_academy) return { error: "Membro não encontrado" };
    const proposals = await FitnessProposalStorage.listPendingForMember(pool, id_member);
    return { proposals };
  }

  static async cancel(actor_id_user, id_academy, id_proposal) {
    const guard = await AcademyService.assertStaff(id_academy, actor_id_user);
    if (guard.error) return guard;
    const proposal = await FitnessProposalStorage.getById(pool, id_proposal);
    if (!proposal || proposal.id_academy !== id_academy) return { error: "Proposta não encontrada" };
    const canceled = await FitnessProposalStorage.cancelById(pool, id_proposal);
    if (!canceled) return { error: "Proposta já resolvida" };
    return { ok: true };
  }

  // ─── Aluno responde ────────────────────────────────────────────────────────
  static async listForStudent(id_user) {
    const proposals = await FitnessProposalStorage.listPendingForStudent(pool, id_user);
    return { proposals };
  }

  static async resolve(id_user, body) {
    return runWithLogs(log, "resolve", () => ({ id_user, action: body?.action }), async () => {
      const action = body?.action;
      if (action !== "accept" && action !== "decline") return { error: "Ação inválida" };
      const ids = Array.isArray(body?.ids) ? body.ids.slice(0, 50) : [];
      if (ids.length === 0) return { error: "Nenhuma proposta informada" };

      const results = [];
      for (const id of ids) {
        const proposal = await FitnessProposalStorage.getById(pool, id);
        if (!proposal || proposal.id_student_user !== id_user) {
          return { error: "Proposta não encontrada", statusCode: 404 };
        }
        // markResolved só transiciona pending → evita duplo apply.
        const resolved = await FitnessProposalStorage.markResolved(
          pool,
          id,
          action === "accept" ? "accepted" : "declined"
        );
        if (!resolved) continue; // já resolvida em outra aba
        if (action === "accept") {
          const applied = await applyProposal(resolved);
          if (applied.error) {
            log.warn("apply.fail", { id_proposal: id, error: applied.error });
            results.push({ id_proposal: id, ok: false, error: applied.error });
            continue;
          }
        }
        results.push({ id_proposal: id, ok: true });
      }
      return { action, results };
    });
  }
}

module.exports = FitnessProposalService;
