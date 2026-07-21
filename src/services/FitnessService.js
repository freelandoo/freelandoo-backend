// src/services/FitnessService.js
// Diário fitness (fase 2): resumo do dia, contador de calorias (TACO local +
// Open Food Facts com cache em tb_food), água, medidas e metas. O painel é
// PESSOAL (qualquer user logado, flag on) — academia é opcional. Privacidade:
// cada user só mexe no próprio diário; edição do professor vira proposta
// (FitnessProposalService) que o aluno confirma.
const pool = require("../databases");
const FitnessStorage = require("../storages/FitnessStorage");
const AcademyStorage = require("../storages/AcademyStorage");
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

  // ─── Indicadores (aba do painel) ───────────────────────────────────────────
  // Agrega o que já registramos em métricas de saúde/consistência: IMC,
  // tendência de peso, médias e aderência de calorias/água, proteína por kg,
  // distribuição de macros, sequência de registro, treinos e frequência.
  static async indicators(id_user) {
    return runWithLogs(log, "indicators", () => ({ id_user }), async () => {
      const WorkoutStorage = require("../storages/WorkoutStorage");
      const todayStr = today();
      const d30 = new Date(Date.now() - 30 * 24 * 3600 * 1000);
      const from30 = d30.toISOString().slice(0, 10);
      const from7 = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
      const from14 = new Date(Date.now() - 13 * 24 * 3600 * 1000).toISOString().slice(0, 10);

      const [settings, latest, weightRows, kcalRows, waterRows, memberships] = await Promise.all([
        FitnessStorage.getSettings(pool, id_user),
        FitnessStorage.latestMeasurement(pool, id_user),
        FitnessStorage.weightSeries(pool, id_user, 40),
        FitnessStorage.kcalDailySeries(pool, id_user, from30),
        FitnessStorage.waterDailySeries(pool, id_user, from30),
        AcademyStorage.listMembershipsByUser(pool, id_user),
      ]);

      const weight = latest && latest.weight_kg ? Number(latest.weight_kg) : null;
      const height = latest && latest.height_cm ? Number(latest.height_cm) : null;

      // IMC (OMS)
      let bmi = null;
      if (weight && height) {
        const v = weight / Math.pow(height / 100, 2);
        const klass =
          v < 18.5 ? "underweight" : v < 25 ? "normal" : v < 30 ? "overweight" : v < 35 ? "obese1" : v < 40 ? "obese2" : "obese3";
        bmi = { value: Math.round(v * 10) / 10, class: klass, weight_kg: weight, height_cm: height };
      }

      // Peso: série + deltas
      const wSeries = weightRows.map((r) => ({ date: r.measured_at, weight_kg: Number(r.weight_kg) }));
      let delta30 = null;
      if (wSeries.length >= 2) {
        const base = wSeries.find((p) => new Date(p.date) >= d30) || wSeries[0];
        delta30 = Math.round((wSeries[wSeries.length - 1].weight_kg - base.weight_kg) * 10) / 10;
      }

      // Calorias: médias sobre dias REGISTRADOS + aderência (não estourou a meta)
      const goalKcal = Number(settings.daily_kcal_goal);
      const kcal7 = kcalRows.filter((r) => r.date >= from7);
      const avg = (arr, f) => (arr.length ? Math.round(arr.reduce((a, r) => a + f(r), 0) / arr.length) : null);
      const kcalOnTarget = kcalRows.filter((r) => r.kcal > 0 && r.kcal <= goalKcal).length;
      const proteinAvg30 = avg(kcalRows, (r) => r.protein_g);
      const carbsAvg30 = avg(kcalRows, (r) => r.carbs_g);
      const fatAvg30 = avg(kcalRows, (r) => r.fat_g);
      // Distribuição calórica dos macros (P/C 4 kcal/g, G 9 kcal/g)
      let macroPct = null;
      if (proteinAvg30 !== null) {
        const pK = proteinAvg30 * 4;
        const cK = (carbsAvg30 || 0) * 4;
        const fK = (fatAvg30 || 0) * 9;
        const tot = pK + cK + fK;
        if (tot > 0) {
          macroPct = {
            protein: Math.round((pK / tot) * 100),
            carbs: Math.round((cK / tot) * 100),
            fat: Math.round((fK / tot) * 100),
          };
        }
      }

      // Água
      const goalWater = Number(settings.water_goal_ml);
      const water7 = waterRows.filter((r) => r.date >= from7);
      const waterOnTarget = waterRows.filter((r) => Number(r.total_ml) >= goalWater).length;

      // Sequência de registro do diário (comida OU água), terminando hoje/ontem
      const loggedDays = new Set([...kcalRows.map((r) => r.date), ...waterRows.map((r) => r.date)]);
      let streak = 0;
      const cursor = new Date(`${todayStr}T12:00:00Z`);
      if (!loggedDays.has(todayStr)) cursor.setUTCDate(cursor.getUTCDate() - 1); // hoje ainda não registrou → conta a partir de ontem
      while (loggedDays.has(cursor.toISOString().slice(0, 10))) {
        streak += 1;
        cursor.setUTCDate(cursor.getUTCDate() - 1);
      }

      // Treinos concluídos: por USUÁRIO (mig 189 — a ficha é dele, não do
      // vínculo; somar por matrícula contaria o mesmo treino N vezes).
      const sessions7 = await WorkoutStorage.countSessionsCompleted(pool, id_user, from7);
      const sessions30 = await WorkoutStorage.countSessionsCompleted(pool, id_user, from30);

      // Frequência de catraca continua por vínculo (é evento da academia).
      let frequency30 = null;
      for (const m of memberships) {
        const days = await AcademyStorage.countDistinctDays(pool, m.id_member, d30);
        frequency30 = (frequency30 || 0) + days;
      }

      // Séries dos gráficos: últimos 14 dias preenchidos (dia sem registro = 0)
      const kcalByDate = new Map(kcalRows.map((r) => [r.date, Math.round(r.kcal)]));
      const waterByDate = new Map(waterRows.map((r) => [r.date, Number(r.total_ml)]));
      const chart14 = [];
      for (let i = 13; i >= 0; i--) {
        const d = new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10);
        chart14.push({ date: d, kcal: kcalByDate.get(d) || 0, water_ml: waterByDate.get(d) || 0 });
      }

      return {
        bmi,
        weight: { series: wSeries.slice(-20), delta_30d: delta30 },
        kcal: {
          goal: goalKcal,
          avg_7d: avg(kcal7, (r) => r.kcal),
          avg_30d: avg(kcalRows, (r) => r.kcal),
          days_logged_30d: kcalRows.length,
          days_on_target_30d: kcalOnTarget,
        },
        macros: {
          protein_avg_g: proteinAvg30,
          carbs_avg_g: carbsAvg30,
          fat_avg_g: fatAvg30,
          protein_g_per_kg: proteinAvg30 !== null && weight ? Math.round((proteinAvg30 / weight) * 100) / 100 : null,
          pct: macroPct,
        },
        water: {
          goal: goalWater,
          avg_7d: avg(water7, (r) => Number(r.total_ml)),
          avg_30d: avg(waterRows, (r) => Number(r.total_ml)),
          days_on_target_30d: waterOnTarget,
          ml_per_kg:
            waterRows.length && weight
              ? Math.round(waterRows.reduce((a, r) => a + Number(r.total_ml), 0) / waterRows.length / weight)
              : null,
        },
        streak_days: streak,
        workouts: { sessions_7d: sessions7, sessions_30d: sessions30 },
        academy: memberships.length ? { frequency_30d: frequency30 || 0 } : null,
        chart_14d: chart14,
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

  // Busca direta por código de barras (EAN/UPC) no Open Food Facts. Mais
  // confiável que a busca textual quando o produto tem o código na embalagem.
  // Devolve o mesmo formato de searchOff, então o cache + diário reaproveitam.
  static async searchOffByBarcode(code) {
    return runWithLogs(log, "off.barcode", () => ({ code }), async () => {
      const clean = String(code || "").replace(/\D/g, "");
      if (clean.length < 8 || clean.length > 14) {
        return { error: "Código de barras inválido" };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), OFF_TIMEOUT_MS);
      try {
        const url =
          `https://world.openfoodfacts.org/api/v2/product/${clean}.json` +
          "?fields=code,product_name,nutriments";
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { "User-Agent": "Freelandoo-Fitness/1.0 (contato: freelandoogroup@gmail.com)" },
        });
        if (!res.ok) return { error: "Busca de produtos indisponível no momento" };
        const data = await res.json();
        const p = data && data.product;
        if (!data || data.status !== 1 || !p) {
          return { error: "Produto não encontrado para este código" };
        }
        const n = p.nutriments || {};
        const kcal = Number(n["energy-kcal_100g"]);
        if (!p.product_name || !Number.isFinite(kcal)) {
          return { error: "Produto sem informação nutricional (kcal)" };
        }
        return {
          food: {
            external_ref: String(p.code || clean),
            nome: String(p.product_name).slice(0, 120),
            kcal_100g: Math.round(kcal * 100) / 100,
            protein_g: Math.round((Number(n.proteins_100g) || 0) * 100) / 100,
            carbs_g: Math.round((Number(n.carbohydrates_100g) || 0) * 100) / 100,
            fat_g: Math.round((Number(n.fat_100g) || 0) * 100) / 100,
          },
        };
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
