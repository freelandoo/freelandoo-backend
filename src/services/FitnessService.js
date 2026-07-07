// src/services/FitnessService.js
// Diário fitness (fase 2): resumo do dia, contador de calorias (TACO local +
// Open Food Facts com cache em tb_food), água, medidas e metas. Acesso já
// passou pelo requireFitnessAccess; privacidade: cada user só mexe no próprio
// diário (professor registra medição via rota da academia, com guard próprio).
const pool = require("../databases");
const FitnessStorage = require("../storages/FitnessStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const AcademyService = require("./AcademyService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("fitness-service");

const OFF_TIMEOUT_MS = 5_000;
const MEALS = ["cafe", "almoco", "jantar", "lanche"];

function isValidDate(s) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

class FitnessService {
  // ─── Resumo do dia ─────────────────────────────────────────────────────────
  static async summary(id_user, dateRaw) {
    return runWithLogs(log, "summary", () => ({ id_user }), async () => {
      const date = isValidDate(dateRaw) ? dateRaw : today();
      const [settings, totals, logs, water, latest, memberships] = await Promise.all([
        FitnessStorage.getSettings(pool, id_user),
        FitnessStorage.dayTotals(pool, id_user, date),
        FitnessStorage.listFoodLogs(pool, id_user, date),
        FitnessStorage.getWater(pool, id_user, date),
        FitnessStorage.latestMeasurement(pool, id_user),
        AcademyStorage.listMembershipsByUser(pool, id_user),
      ]);

      // Frequência do mês corrente por vínculo (dias distintos + dias do mês).
      const monthStart = `${date.slice(0, 7)}-01`;
      const nextMonth = new Date(`${monthStart}T00:00:00Z`);
      nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
      const academies = [];
      for (const m of memberships) {
        academies.push({
          id_member: m.id_member,
          academy: { nome: m.academy_nome, slug: m.academy_slug, avatar_url: m.academy_avatar_url },
          membership_status: m.membership_status,
          plan_name: m.plan_name,
          expires_at: m.expires_at,
          month_days: await AcademyStorage.listEventDays(
            pool,
            m.id_member,
            monthStart,
            nextMonth.toISOString().slice(0, 10)
          ),
          frequency_days_30d: await AcademyStorage.countDistinctDays(
            pool,
            m.id_member,
            new Date(Date.now() - 30 * 24 * 3600 * 1000)
          ),
          payments: await AcademyStorage.listPaymentsForMember(pool, m.id_member, 6),
        });
      }

      return {
        date,
        goals: { daily_kcal_goal: settings.daily_kcal_goal, water_goal_ml: settings.water_goal_ml },
        totals,
        water_ml: water,
        logs: logs.map((l) => ({
          id_log: l.id_log,
          meal: l.meal,
          food_nome: l.food_nome,
          quantity_g: Number(l.quantity_g),
          kcal: Number(l.kcal),
          protein_g: Number(l.protein_g),
          carbs_g: Number(l.carbs_g),
          fat_g: Number(l.fat_g),
        })),
        latest_measurement: latest
          ? { weight_kg: latest.weight_kg, height_cm: latest.height_cm, measured_at: latest.measured_at }
          : null,
        academies,
      };
    });
  }

  // ─── Alimentos ─────────────────────────────────────────────────────────────
  static async searchFoods(q) {
    const query = String(q || "").trim();
    if (query.length < 2) return { foods: [] };
    const foods = await FitnessStorage.searchFoods(pool, query, 20);
    return { foods };
  }

  // Busca no Open Food Facts (industrializados). Proxy server-side com timeout
  // curto; item escolhido é cacheado via cacheOffFood.
  static async searchOff(q) {
    return runWithLogs(log, "off.search", () => ({ q }), async () => {
      const query = String(q || "").trim();
      if (query.length < 2) return { foods: [] };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
      try {
        const url =
          "https://world.openfoodfacts.org/cgi/search.pl?search_simple=1&action=process&json=1&page_size=15" +
          `&fields=code,product_name,nutriments&search_terms=${encodeURIComponent(query)}`;
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Freelandoo-Fitness/1.0 (contato: freelandoogroup@gmail.com)" },
        });
        if (!res.ok) return { error: "Busca de produtos indisponível no momento" };
        const data = await res.json();
        const foods = [];
        for (const p of data.products || []) {
          const n = p.nutriments || {};
          const kcal = Number(n["energy-kcal_100g"]);
          if (!p.code || !p.product_name || !Number.isFinite(kcal)) continue;
          foods.push({
            external_ref: String(p.code),
            nome: String(p.product_name).slice(0, 120),
            kcal_100g: Math.round(kcal * 100) / 100,
            protein_g: Math.round((Number(n.proteins_100g) || 0) * 100) / 100,
            carbs_g: Math.round((Number(n.carbohydrates_100g) || 0) * 100) / 100,
            fat_g: Math.round((Number(n.fat_100g) || 0) * 100) / 100,
          });
        }
        return { foods };
      } catch (err) {
        const timedOut = err && err.name === "AbortError";
        return { error: timedOut ? "Busca de produtos demorou demais" : "Busca de produtos indisponível no momento" };
      } finally {
        clearTimeout(timer);
      }
    });
  }

  static async cacheOffFood(payload) {
    const { external_ref, nome, kcal_100g } = payload || {};
    if (!external_ref || !nome || !Number.isFinite(Number(kcal_100g))) {
      return { error: "Produto inválido" };
    }
    const food = await FitnessStorage.upsertOffFood(pool, {
      external_ref: String(external_ref),
      nome: String(nome).slice(0, 120),
      kcal_100g: Number(kcal_100g),
      protein_g: Number(payload.protein_g) || 0,
      carbs_g: Number(payload.carbs_g) || 0,
      fat_g: Number(payload.fat_g) || 0,
    });
    return { food };
  }

  static async createCustomFood(id_user, payload) {
    const { nome, kcal_100g } = payload || {};
    if (!nome || String(nome).trim().length < 2) return { error: "Nome do alimento é obrigatório" };
    const kcal = Number(kcal_100g);
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > 900) return { error: "Calorias por 100g inválidas" };
    const food = await FitnessStorage.createCustomFood(pool, id_user, {
      nome: String(nome).trim().slice(0, 120),
      kcal_100g: kcal,
      protein_g: Number(payload.protein_g) || 0,
      carbs_g: Number(payload.carbs_g) || 0,
      fat_g: Number(payload.fat_g) || 0,
    });
    return { food };
  }

  // ─── Diário ────────────────────────────────────────────────────────────────
  static async addFoodLog(id_user, payload) {
    return runWithLogs(log, "log.add", () => ({ id_user }), async () => {
      const { id_food, meal } = payload || {};
      const date = isValidDate(payload?.log_date) ? payload.log_date : today();
      const qty = Number(payload?.quantity_g);
      if (!MEALS.includes(meal)) return { error: "Refeição inválida" };
      if (!Number.isFinite(qty) || qty <= 0 || qty > 5000) return { error: "Quantidade inválida" };
      const food = await FitnessStorage.getFoodById(pool, id_food);
      if (!food) return { error: "Alimento não encontrado" };
      const factor = qty / 100;
      const entry = await FitnessStorage.addFoodLog(pool, {
        id_user,
        log_date: date,
        meal,
        id_food,
        quantity_g: qty,
        kcal: Math.round(Number(food.kcal_100g) * factor * 100) / 100,
        protein_g: Math.round(Number(food.protein_g) * factor * 100) / 100,
        carbs_g: Math.round(Number(food.carbs_g) * factor * 100) / 100,
        fat_g: Math.round(Number(food.fat_g) * factor * 100) / 100,
      });
      return { log: entry };
    });
  }

  static async deleteFoodLog(id_user, id_log) {
    const removed = await FitnessStorage.deleteFoodLog(pool, id_user, id_log);
    if (!removed) return { error: "Registro não encontrado" };
    return { ok: true };
  }

  // ─── Água ──────────────────────────────────────────────────────────────────
  static async setWater(id_user, payload) {
    const date = isValidDate(payload?.log_date) ? payload.log_date : today();
    const ml = Number(payload?.total_ml);
    if (!Number.isFinite(ml) || ml < 0 || ml > 20000) return { error: "Quantidade de água inválida" };
    const total_ml = await FitnessStorage.setWater(pool, id_user, date, Math.round(ml));
    return { log_date: date, total_ml };
  }

  // ─── Medidas ───────────────────────────────────────────────────────────────
  static async addMeasurement(id_user, payload, recorded_by) {
    const weight = payload?.weight_kg === undefined || payload.weight_kg === null ? null : Number(payload.weight_kg);
    const height = payload?.height_cm === undefined || payload.height_cm === null ? null : Number(payload.height_cm);
    if (weight === null && height === null) return { error: "Informe peso e/ou altura" };
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0 || weight >= 500)) return { error: "Peso inválido" };
    if (height !== null && (!Number.isFinite(height) || height <= 0 || height >= 300)) return { error: "Altura inválida" };
    const measurement = await FitnessStorage.addMeasurement(pool, {
      id_user,
      weight_kg: weight,
      height_cm: height,
      recorded_by: recorded_by || id_user,
    });
    return { measurement };
  }

  static async listMeasurements(id_user) {
    const measurements = await FitnessStorage.listMeasurements(pool, id_user, 30);
    return { measurements };
  }

  // Professor/dono registra medição de um membro da academia dele (avaliação
  // física). Guard: staff da MESMA academia do membro.
  static async addMemberMeasurement(actor_id_user, id_academy, id_member, payload) {
    return runWithLogs(log, "member.measure", () => ({ id_academy, id_member }), async () => {
      const guard = await AcademyService.assertStaff(id_academy, actor_id_user);
      if (guard.error) return guard;
      const member = await AcademyStorage.getMemberById(pool, id_member);
      if (!member || member.id_academy !== id_academy) return { error: "Membro não encontrado" };
      return this.addMeasurement(member.id_user, payload, actor_id_user);
    });
  }

  // ─── Metas ─────────────────────────────────────────────────────────────────
  static async setSettings(id_user, payload) {
    const kcal = Math.round(Number(payload?.daily_kcal_goal));
    const water = Math.round(Number(payload?.water_goal_ml));
    if (!Number.isFinite(kcal) || kcal < 500 || kcal > 10000) return { error: "Meta de calorias inválida (500–10000)" };
    if (!Number.isFinite(water) || water < 250 || water > 10000) return { error: "Meta de água inválida (250–10000)" };
    const settings = await FitnessStorage.setSettings(pool, id_user, {
      daily_kcal_goal: kcal,
      water_goal_ml: water,
    });
    return { settings };
  }
}

module.exports = FitnessService;
