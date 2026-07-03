// src/services/DataExportService.js
// Regras da API de Dados (/ext/v1/data). Somente-leitura, escopo = DONO do token.
// Reusa storages existentes; nunca toca em saldo/ganhos/repasses.
const pool = require("../databases");
const DataExportStorage = require("../storages/DataExportStorage");
const CoursesStorage = require("../storages/CoursesStorage");
const XpStorage = require("../storages/XpStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("DataExportService");

// Curso sem receita (revenue_cents é financeiro → não expor).
function publicCourse(c) {
  return {
    id: c.id,
    profile_id: c.profile_id,
    title: c.title,
    slug: c.slug,
    short_description: c.short_description,
    cover_url: c.cover_url,
    price_cents: c.price_cents,
    status: c.status,
    affiliates_allowed: c.affiliates_allowed,
    modules_count: c.modules_count,
    lessons_count: c.lessons_count,
    students_count: c.students_count,
    published_at: c.published_at,
    created_at: c.created_at,
  };
}

// Carrega perfis + índices auxiliares uma vez por request.
async function loadBase(id_user) {
  const profiles = await DataExportStorage.listProfiles(pool, id_user);
  const profileIds = profiles.map((p) => p.id_profile);
  return { profiles, profileIds };
}

class DataExportService {
  static async me(user) {
    return runWithLogs(log, "me", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { profiles, profileIds } = await loadBase(user.id_user);
      const account = profiles.find((p) => p.is_user_account) || profiles[0] || null;
      const xpMap = await XpStorage.getXpSummaries(pool, profileIds);
      const courses = await CoursesStorage.listByOwner(pool, user.id_user);

      const subprofiles = profiles.filter(
        (p) => !p.is_user_account && !p.is_clan && !p.is_community
      ).length;
      const communities = profiles.filter((p) => p.is_community).length;
      const clans = profiles.filter((p) => p.is_clan && !p.is_community).length;
      const services = await DataExportStorage.listServices(pool, profileIds);
      const products = await DataExportStorage.listProducts(pool, profileIds);

      const accXp = account ? xpMap.get(String(account.id_profile)) : null;
      return {
        id_user: user.id_user,
        username: account?.username || null,
        account_profile_id: account?.id_profile || null,
        level: accXp?.xp_level ?? 0,
        xp_total: accXp?.xp_total ?? 0,
        counts: {
          profiles_total: profiles.length,
          subprofiles,
          communities,
          clans,
          services: services.length,
          products: products.length,
          courses: courses.length,
        },
      };
    });
  }

  static async profiles(user) {
    return runWithLogs(log, "profiles", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { profiles, profileIds } = await loadBase(user.id_user);
      const xpMap = await XpStorage.getXpSummaries(pool, profileIds);
      const followers = await DataExportStorage.followerCounts(pool, profileIds);
      const enriched = profiles.map((p) => {
        const xp = xpMap.get(String(p.id_profile));
        return {
          ...p,
          followers: followers.get(String(p.id_profile)) || 0,
          level: xp?.xp_level ?? 0,
          xp_total: xp?.xp_total ?? 0,
        };
      });
      return { profiles: enriched };
    });
  }

  static async services(user) {
    return runWithLogs(log, "services", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { profileIds } = await loadBase(user.id_user);
      const services = await DataExportStorage.listServices(pool, profileIds);
      return { services };
    });
  }

  static async products(user) {
    return runWithLogs(log, "products", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { profileIds } = await loadBase(user.id_user);
      const products = await DataExportStorage.listProducts(pool, profileIds);
      return { products };
    });
  }

  static async social(user) {
    return runWithLogs(log, "social", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { profileIds } = await loadBase(user.id_user);
      const social = await DataExportStorage.listSocial(pool, profileIds);
      return { social };
    });
  }

  static async courses(user) {
    return runWithLogs(log, "courses", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const rows = await CoursesStorage.listByOwner(pool, user.id_user);
      return { courses: rows.map(publicCourse) };
    });
  }

  static async metrics(user) {
    return runWithLogs(log, "metrics", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const { profiles, profileIds } = await loadBase(user.id_user);
      const xpMap = await XpStorage.getXpSummaries(pool, profileIds);
      const followers = await DataExportStorage.followerCounts(pool, profileIds);
      const per_profile = profiles.map((p) => {
        const xp = xpMap.get(String(p.id_profile));
        return {
          id_profile: p.id_profile,
          display_name: p.display_name,
          is_community: p.is_community,
          is_clan: p.is_clan,
          followers: followers.get(String(p.id_profile)) || 0,
          level: xp?.xp_level ?? 0,
          xp_total: xp?.xp_total ?? 0,
          xp_next_level: xp?.xp_next_level ?? 0,
          xp_progress_percent: xp?.xp_progress_percent ?? 0,
        };
      });
      const totals = {
        followers: per_profile.reduce((s, p) => s + p.followers, 0),
        xp_total: per_profile.reduce((s, p) => s + p.xp_total, 0),
      };
      return { totals, per_profile };
    });
  }
}

module.exports = DataExportService;
