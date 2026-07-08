// src/utils/workoutSanitize.js
// Sanitização dos exercícios de uma ficha de treino. Compartilhada entre a
// criação de proposta (FitnessProposalService) e qualquer apply direto.
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

module.exports = { sanitizeExercises };
