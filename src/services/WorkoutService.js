// src/services/WorkoutService.js
// Treinos (fase 3): professor/dono monta fichas (biblioteca de exercícios)
// para membros da PRÓPRIA academia; o aluno vê as fichas ativas no dia e dá
// check por exercício (todos checados ⇒ sessão concluída; destick reabre).
// Privacidade: aluno só o dele; staff só membros da academia dele.
const pool = require("../databases");
const WorkoutStorage = require("../storages/WorkoutStorage");
const AcademyStorage = require("../storages/AcademyStorage");
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

function sanitizeExercises(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return { error: "A ficha precisa de pelo menos 1 exercício" };
  if (raw.length > 30) return { error: "Máximo de 30 exercícios por ficha" };
  const exercises = [];
  for (const ex of raw) {
    if (!ex || !ex.id_exercise) return { error: "Exercício inválido" };
    const sets = Math.round(Number(ex.sets));
    if (!Number.isFinite(sets) || sets < 1 || sets > 20) return { error: "Séries inválidas (1–20)" };
    const reps = String(ex.reps || "10").slice(0, 20);
    const load = ex.load_kg === null || ex.load_kg === undefined || ex.load_kg === "" ? null : Number(ex.load_kg);
    if (load !== null && (!Number.isFinite(load) || load < 0 || load > 1000)) return { error: "Carga inválida" };
    const rest = ex.rest_seconds === null || ex.rest_seconds === undefined || ex.rest_seconds === "" ? null : Math.round(Number(ex.rest_seconds));
    if (rest !== null && (!Number.isFinite(rest) || rest < 0 || rest > 900)) return { error: "Descanso inválido (0–900s)" };
    exercises.push({ id_exercise: ex.id_exercise, sets, reps, load_kg: load, rest_seconds: rest });
  }
  return { exercises };
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
      return {
        member: {
          id_member: member.id_member,
          member_name: member.member_name,
          membership_status: member.membership_status,
        },
        plans,
        measurements: measurements.rows,
      };
    });
  }

  static async createPlan(id_user, id_academy, id_member, payload) {
    return runWithLogs(log, "plan.create", () => ({ id_academy, id_member }), async () => {
      const guard = await AcademyService.assertStaff(id_academy, id_user);
      if (guard.error) return guard;
      const member = await AcademyStorage.getMemberById(pool, id_member);
      if (!member || member.id_academy !== id_academy) return { error: "Membro não encontrado" };
      const nome = String(payload?.nome || "").trim();
      if (!nome) return { error: "Nome da ficha é obrigatório (ex.: Treino A)" };
      const check = sanitizeExercises(payload?.exercises);
      if (check.error) return check;
      const plan = await WorkoutStorage.createPlan(pool, {
        id_academy,
        id_member,
        created_by: id_user,
        nome: nome.slice(0, 60),
        notes: payload?.notes ? String(payload.notes).slice(0, 2000) : null,
      });
      await WorkoutStorage.replacePlanExercises(pool, plan.id_plan, check.exercises);
      return { plan: await hydratePlan(plan, today()) };
    });
  }

  static async updatePlan(id_user, id_plan, payload) {
    return runWithLogs(log, "plan.update", () => ({ id_plan }), async () => {
      const plan = await WorkoutStorage.getPlanById(pool, id_plan);
      if (!plan) return { error: "Ficha não encontrada" };
      const guard = await AcademyService.assertStaff(plan.id_academy, id_user);
      if (guard.error) return guard;
      const updated = await WorkoutStorage.updatePlan(pool, id_plan, {
        nome: payload?.nome ? String(payload.nome).trim().slice(0, 60) : undefined,
        notes: payload?.notes === undefined ? undefined : payload.notes ? String(payload.notes).slice(0, 2000) : null,
        is_active: payload?.is_active,
      });
      if (Array.isArray(payload?.exercises)) {
        const check = sanitizeExercises(payload.exercises);
        if (check.error) return check;
        await WorkoutStorage.replacePlanExercises(pool, id_plan, check.exercises);
      }
      return { plan: await hydratePlan(updated, today()) };
    });
  }

  static async deletePlan(id_user, id_plan) {
    const plan = await WorkoutStorage.getPlanById(pool, id_plan);
    if (!plan) return { error: "Ficha não encontrada" };
    const guard = await AcademyService.assertStaff(plan.id_academy, id_user);
    if (guard.error) return guard;
    await WorkoutStorage.deletePlan(pool, id_plan);
    return { ok: true };
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
