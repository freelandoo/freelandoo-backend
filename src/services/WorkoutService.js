// src/services/WorkoutService.js
// Treinos (fase 3): professor/dono monta fichas (biblioteca de exercícios)
// para membros da PRÓPRIA academia; o aluno vê as fichas ativas no dia e dá
// check por exercício (todos checados ⇒ sessão concluída; destick reabre).
// Privacidade: aluno só o dele; staff só membros da academia dele.
// Desde a mig 180 as MUTAÇÕES de staff (criar/editar/excluir ficha) não vivem
// mais aqui: viram proposta no FitnessProposalService, que o aluno confirma.
const pool = require("../databases");
const WorkoutStorage = require("../storages/WorkoutStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const FitnessProposalStorage = require("../storages/FitnessProposalStorage");
const AcademyService = require("./AcademyService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("workout-service");

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(from) {
  return Math.max(0, Math.floor((Date.now() - new Date(from).getTime()) / (24 * 3600 * 1000)));
}

async function hydratePlan(plan, date) {
  const exercises = await WorkoutStorage.listPlanExercises(pool, plan.id_plan);
  const session = await WorkoutStorage.getSession(pool, plan.id_plan, date);
  const checkedIds = session ? new Set(await WorkoutStorage.listChecks(pool, session.id_session)) : new Set();
  return {
    id_plan: plan.id_plan,
    nome: plan.nome,
    notes: plan.notes,
    is_active: plan.is_active,
    created_at: plan.created_at,
    days_on_plan: daysBetween(plan.created_at),
    completed_at: session ? session.completed_at : null,
    exercises: exercises.map((ex) => ({
      id_plan_exercise: ex.id_plan_exercise,
      id_exercise: ex.id_exercise,
      exercise_nome: ex.exercise_nome,
      muscle_group: ex.muscle_group,
      sets: ex.sets,
      reps: ex.reps,
      load_kg: ex.load_kg,
      rest_seconds: ex.rest_seconds,
      position: ex.position,
      checked: checkedIds.has(ex.id_plan_exercise),
    })),
  };
}

class WorkoutService {
  // ─── Aluno ─────────────────────────────────────────────────────────────────
  static async today(id_user, dateRaw) {
    return runWithLogs(log, "today", () => ({ id_user }), async () => {
      const date = isValidDate(dateRaw) ? dateRaw : today();
      const memberships = await AcademyStorage.listMembershipsByUser(pool, id_user);
      const plans = [];
      for (const m of memberships) {
        const active = await WorkoutStorage.listPlansForMember(pool, m.id_member, { onlyActive: true });
        for (const plan of active) plans.push(await hydratePlan(plan, date));
      }
      return { date, plans };
    });
  }

  static async toggleCheck(id_user, payload) {
    return runWithLogs(log, "check.toggle", () => ({ id_user }), async () => {
      const { id_plan, id_plan_exercise } = payload || {};
      const date = isValidDate(payload?.log_date) ? payload.log_date : today();
      const plan = await WorkoutStorage.getPlanById(pool, id_plan);
      if (!plan) return { error: "Ficha não encontrada" };
      const member = await AcademyStorage.getMemberById(pool, plan.id_member);
      if (!member || member.id_user !== id_user) return { error: "Sem permissão", statusCode: 403 };

      const exercises = await WorkoutStorage.listPlanExercises(pool, id_plan);
      const target = exercises.find((e) => e.id_plan_exercise === id_plan_exercise);
      if (!target) return { error: "Exercício não encontrado na ficha" };

      const session = await WorkoutStorage.getOrCreateSession(pool, id_plan, plan.id_member, date);
      const checked = new Set(await WorkoutStorage.listChecks(pool, session.id_session));
      let nowChecked;
      if (checked.has(id_plan_exercise)) {
        await WorkoutStorage.removeCheck(pool, session.id_session, id_plan_exercise);
        checked.delete(id_plan_exercise);
        nowChecked = false;
      } else {
        await WorkoutStorage.addCheck(pool, session.id_session, id_plan_exercise);
        checked.add(id_plan_exercise);
        nowChecked = true;
      }
      const allDone = exercises.every((e) => checked.has(e.id_plan_exercise));
      await WorkoutStorage.setSessionCompleted(pool, session.id_session, allDone);
      return { checked: nowChecked, completed: allDone };
    });
  }

  static async myPlans(id_user) {
    const memberships = await AcademyStorage.listMembershipsByUser(pool, id_user);
    const date = today();
    const plans = [];
    for (const m of memberships) {
      const all = await WorkoutStorage.listPlansForMember(pool, m.id_member);
      for (const plan of all) plans.push(await hydratePlan(plan, date));
    }
    return { plans };
  }

  // ─── Staff (professor/dono) ────────────────────────────────────────────────
  static async listExercises(id_user, id_academy, filters) {
    const guard = await AcademyService.assertStaff(id_academy, id_user);
    if (guard.error) return guard;
    const exercises = await WorkoutStorage.listExercises(pool, filters);
    return { exercises };
  }

  static async memberPlans(id_user, id_academy, id_member) {
    return runWithLogs(log, "member.plans", () => ({ id_academy, id_member }), async () => {
      const guard = await AcademyService.assertStaff(id_academy, id_user);
      if (guard.error) return guard;
      const member = await AcademyStorage.getMemberById(pool, id_member);
      if (!member || member.id_academy !== id_academy) return { error: "Membro não encontrado" };
      const date = today();
      const all = await WorkoutStorage.listPlansForMember(pool, member.id_member);
      const plans = [];
      for (const plan of all) plans.push(await hydratePlan(plan, date));
      const measurements = await pool.query(
        `SELECT weight_kg, height_cm, measured_at FROM public.tb_fitness_measurement
          WHERE id_user = $1 ORDER BY measured_at DESC LIMIT 10`,
        [member.id_user]
      );
      const settings = await pool.query(
        `SELECT daily_kcal_goal FROM public.tb_fitness_settings WHERE id_user = $1`,
        [member.id_user]
      );
      const proposals = await FitnessProposalStorage.listPendingForMember(pool, member.id_member);
      return {
        member: {
          id_member: member.id_member,
          member_name: member.member_name,
          membership_status: member.membership_status,
          daily_kcal_goal: settings.rows[0] ? settings.rows[0].daily_kcal_goal : null,
        },
        plans,
        measurements: measurements.rows,
        proposals,
      };
    });
  }

  static async trainingGrid(id_user, id_academy, dateRaw) {
    return runWithLogs(log, "grid", () => ({ id_academy }), async () => {
      const guard = await AcademyService.assertStaff(id_academy, id_user);
      if (guard.error) return guard;
      const date = isValidDate(dateRaw) ? dateRaw : today();
      const rows = await WorkoutStorage.trainingGrid(pool, id_academy, date);
      return {
        date,
        rows: rows.map((r) => ({
          id_member: r.id_member,
          nome: r.user_nome || r.username || r.member_name,
          membership_status: r.membership_status,
          weight_kg: r.weight_kg,
          height_cm: r.height_cm,
          measured_at: r.measured_at,
          kcal_day: Math.round(r.kcal_day),
          water_ml_day: r.water_ml_day,
          active_plan_nome: r.active_plan_nome,
          days_on_plan: r.active_plan_since ? daysBetween(r.active_plan_since) : null,
          frequency_days_30d: r.frequency_days_30d,
          sessions_done_7d: r.sessions_done_7d,
        })),
      };
    });
  }
}

module.exports = WorkoutService;
