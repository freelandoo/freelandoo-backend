// src/services/AcademySocialService.js
// Social da academia (fase 4): feed de posts (texto/imagem/vídeo) postados por
// membros vinculados (ou staff), metas mensais do dono e ranking de membros
// (frequência pela catraca + posts + compartilhamentos). Feed e ranking são
// públicos (a academia é vitrine); postar exige vínculo.
const pool = require("../databases");
const AcademySocialStorage = require("../storages/AcademySocialStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const AcademyService = require("./AcademyService");
const PortfolioFeedService = require("./portfolioFeed/PortfolioFeedService");
const uploadAcademyMediaToR2 = require("../integrations/r2/uploadAcademyMedia");
const { processPortfolioMedia } = require("../utils/mediaProcessing");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("academy-social");

function monthRange(monthRaw) {
  const m = /^\d{4}-\d{2}$/.test(String(monthRaw || "")) ? monthRaw : new Date().toISOString().slice(0, 7);
  const monthStart = `${m}-01`;
  const next = new Date(`${monthStart}T00:00:00Z`);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return { month: m, monthStart, nextMonth: next.toISOString().slice(0, 10) };
}

// Janela do ranking: se há temporada ativa (mig 182), usa [início, início+dias);
// senão, o mês corrente. Datas em YYYY-MM-DD (granularidade de dia).
function rankingWindow(goals, monthRaw) {
  const start = goals && goals.season_started_at ? new Date(goals.season_started_at) : null;
  if (start && !Number.isNaN(start.getTime())) {
    const days = Number(goals.season_days) || 30;
    const end = new Date(start.getTime());
    end.setUTCDate(end.getUTCDate() + days);
    const now = new Date();
    const daysLeft = Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
    return {
      windowStart: start.toISOString().slice(0, 10),
      windowEnd: end.toISOString().slice(0, 10),
      season: {
        active: now.getTime() < end.getTime(),
        started_at: start.toISOString(),
        ends_at: end.toISOString(),
        days: days,
        days_left: daysLeft,
      },
    };
  }
  const { monthStart, nextMonth } = monthRange(monthRaw);
  return { windowStart: monthStart, windowEnd: nextMonth, season: null };
}

function publicPost(p) {
  return {
    id_post: p.id_post,
    id_user: p.id_user,
    author: p.user_nome || p.username || null,
    caption: p.caption,
    media_url: p.media_url,
    thumbnail_url: p.thumbnail_url,
    media_kind: p.media_kind,
    share_count: p.share_count,
    created_at: p.created_at,
  };
}

class AcademySocialService {
  // ─── Posts ─────────────────────────────────────────────────────────────────
  static async listPosts(id_academy, { before, limit } = {}) {
    const academy = await AcademyStorage.getById(pool, id_academy);
    if (!academy || !academy.is_active) return { error: "Academia não encontrada" };
    const posts = await AcademySocialStorage.listPosts(pool, id_academy, {
      before: before || undefined,
      limit: Math.min(Number(limit) || 20, 50),
    });
    return { posts: posts.map(publicPost) };
  }

  static async createPost(user, id_academy, body, file) {
    return runWithLogs(log, "post.create", () => ({ id_academy, id_user: user.id_user }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy || !academy.is_active) return { error: "Academia não encontrada" };

      const isOwner = academy.id_owner_user === user.id_user;
      const member = await AcademyStorage.getMember(pool, id_academy, user.id_user);
      const isProfessor = await AcademyStorage.isProfessor(pool, id_academy, user.id_user);
      if (!isOwner && !member && !isProfessor) {
        return { error: "Só membros vinculados podem postar na academia", statusCode: 403 };
      }

      const caption = String(body?.caption || "").slice(0, 3000);
      if (!caption.trim() && !file?.buffer) return { error: "Escreva algo ou anexe uma mídia" };

      let media_url = null;
      let thumbnail_url = null;
      let media_kind = null;
      if (file?.buffer) {
        const mimetype = String(file.mimetype || "").toLowerCase();
        media_kind = mimetype.startsWith("image/") ? "image" : mimetype.startsWith("video/") ? "video" : null;
        if (!media_kind) return { error: "Tipo de arquivo não permitido" };
        const processed = await processPortfolioMedia(file, media_kind, { feedKind: "feed" });
        const r2 = await uploadAcademyMediaToR2({ id_academy, file: processed });
        media_url = r2.url;
        thumbnail_url = r2.thumbnail_url;
      }

      const post = await AcademySocialStorage.createPost(pool, {
        id_academy,
        id_user: user.id_user,
        caption: caption.trim() || null,
        media_url,
        thumbnail_url,
        media_kind,
      });
      return { post: publicPost({ ...post, user_nome: user.nome, username: user.username }) };
    });
  }

  static async deletePost(user, id_academy, id_post) {
    return runWithLogs(log, "post.delete", () => ({ id_post }), async () => {
      const post = await AcademySocialStorage.getPostById(pool, id_post);
      if (!post || post.id_academy !== id_academy) return { error: "Post não encontrado" };
      const academy = await AcademyStorage.getById(pool, id_academy);
      const canDelete = post.id_user === user.id_user || (academy && academy.id_owner_user === user.id_user);
      if (!canDelete) return { error: "Sem permissão", statusCode: 403 };
      await AcademySocialStorage.softDeletePost(pool, id_post);
      return { ok: true };
    });
  }

  static async sharePost(id_academy, id_post) {
    const post = await AcademySocialStorage.getPostById(pool, id_post);
    if (!post || post.id_academy !== id_academy) return { error: "Post não encontrado" };
    const share_count = await AcademySocialStorage.incrementShare(pool, id_post);
    return { share_count };
  }

  // ─── Feed no sistema de portfólio (mig 181) ─────────────────────────────────
  // Liga um post/bee (portfolio-item do autor) ao feed da academia — o post sobe
  // TAMBÉM no /feed global com a tag da academia (igual comunidade). Postar exige
  // vínculo (membro) ou staff (dono/professor).
  static async linkFeedItem(user, id_academy, body) {
    return runWithLogs(log, "feed.link", () => ({ id_academy, id_user: user?.id_user }), async () => {
      const id_user = user?.id_user;
      if (!id_user) return { error: "Usuário não autenticado" };
      const id_portfolio_item = body?.id_portfolio_item;
      if (!id_portfolio_item) return { error: "Post não informado." };

      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy || !academy.is_active) return { error: "Academia não encontrada", statusCode: 404 };

      const isOwner = academy.id_owner_user === id_user;
      const member = await AcademyStorage.getMember(pool, id_academy, id_user);
      const isProfessor = await AcademyStorage.isProfessor(pool, id_academy, id_user);
      if (!isOwner && !member && !isProfessor) {
        return { error: "Só membros vinculados podem postar na academia", statusCode: 403 };
      }

      // Anti-spoof: o post tem que ser de um perfil do próprio usuário.
      const owns = await AcademySocialStorage.itemBelongsToUser(pool, id_portfolio_item, id_user);
      if (!owns) return { error: "Este post não é seu." };

      const linked = await AcademySocialStorage.linkFeedItem(pool, id_academy, id_portfolio_item, id_user);
      return { ok: true, linked };
    });
  }

  // Feed da academia (posts do sistema de portfólio) na projeção do /feed.
  static async getFeedPosts(id_academy, query, viewer) {
    return runWithLogs(log, "feed.posts", () => ({ id_academy, cursor: query?.cursor || null }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy || !academy.is_active) return { error: "Academia não encontrada", statusCode: 404 };

      let before_ts = null;
      let before_key = null;
      if (query?.cursor) {
        try {
          const decoded = Buffer.from(String(query.cursor), "base64").toString("utf8");
          const sep = decoded.lastIndexOf("|");
          if (sep > 0) {
            before_ts = decoded.slice(0, sep);
            before_key = decoded.slice(sep + 1);
          }
        } catch {
          /* cursor inválido — começa do início */
        }
      }
      const limit = Math.min(Math.max(Number(query?.limit) || 12, 1), 24);

      const rows = await AcademySocialStorage.listAcademyFeedPosts(pool, id_academy, {
        viewer_id_user: viewer?.id_user || null,
        limit: limit + 1,
        before_ts,
        before_key,
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const items = page.map((r) => PortfolioFeedService.shapeRow(r));
      let next_cursor = null;
      if (hasMore && page.length) {
        const last = page[page.length - 1];
        const iso = last.published_at ? new Date(last.published_at).toISOString() : new Date().toISOString();
        next_cursor = Buffer.from(`${iso}|${String(last.post_id)}`, "utf8").toString("base64");
      }
      return { items, next_cursor, has_more: hasMore };
    });
  }

  // ─── Metas ─────────────────────────────────────────────────────────────────
  static async getGoals(id_academy) {
    const goals = await AcademySocialStorage.getGoals(pool, id_academy);
    const { season } = rankingWindow(goals, null);
    return {
      goals: {
        freq_target_month: goals.freq_target_month,
        posts_target_month: goals.posts_target_month,
        shares_target_month: goals.shares_target_month,
        season_days: goals.season_days || 30,
        season,
      },
    };
  }

  static async setGoals(id_user, id_academy, payload) {
    return runWithLogs(log, "goals.set", () => ({ id_academy }), async () => {
      const guard = await AcademyService.assertStaff(id_academy, id_user);
      if (guard.error) return guard;
      if (!guard.is_owner) return { error: "Sem permissão", statusCode: 403 };
      const freq = Math.round(Number(payload?.freq_target_month));
      const posts = Math.round(Number(payload?.posts_target_month));
      const shares = Math.round(Number(payload?.shares_target_month));
      if (!Number.isFinite(freq) || freq < 1 || freq > 31) return { error: "Meta de frequência inválida (1–31 dias)" };
      if (!Number.isFinite(posts) || posts < 0 || posts > 100) return { error: "Meta de posts inválida (0–100)" };
      if (!Number.isFinite(shares) || shares < 0 || shares > 100) return { error: "Meta de compartilhamentos inválida (0–100)" };
      // Temporada (mig 182): janela de 30/60/90 dias que o dono inicia/encerra.
      const patch = {
        freq_target_month: freq,
        posts_target_month: posts,
        shares_target_month: shares,
      };
      if (payload?.season_days != null) {
        const days = Math.round(Number(payload.season_days));
        if (![30, 60, 90].includes(days)) return { error: "Duração inválida (30, 60 ou 90 dias)" };
        patch.season_days = days;
      }
      if (payload?.start_season) patch.start_season = true;
      if (payload?.end_season) patch.end_season = true;
      const goals = await AcademySocialStorage.setGoals(pool, id_academy, patch);
      const { season } = rankingWindow(goals, null);
      return { goals: { ...goals, season } };
    });
  }

  // ─── Ranking ───────────────────────────────────────────────────────────────
  static async ranking(id_academy, monthRaw) {
    return runWithLogs(log, "ranking", () => ({ id_academy }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy || !academy.is_active) return { error: "Academia não encontrada" };
      const goals = await AcademySocialStorage.getGoals(pool, id_academy);
      const { windowStart, windowEnd, season } = rankingWindow(goals, monthRaw);
      const rows = await AcademySocialStorage.monthlyRanking(pool, id_academy, windowStart, windowEnd);
      return {
        month: season ? null : monthRange(monthRaw).month,
        season,
        goals: {
          freq_target_month: goals.freq_target_month,
          posts_target_month: goals.posts_target_month,
          shares_target_month: goals.shares_target_month,
          season_days: goals.season_days || 30,
        },
        members: rows.map((r) => ({
          id_member: r.id_member,
          nome: r.user_nome || r.username || r.member_name,
          username: r.username,
          avatar_url: r.avatar_url || null,
          freq_days: r.freq_days,
          posts_count: r.posts_count,
          shares_count: Number(r.shares_count),
        })),
      };
    });
  }

  // ─── Avatar/capa (dono) ────────────────────────────────────────────────────
  static async uploadMedia(id_user, id_academy, kind, file) {
    return runWithLogs(log, "media.upload", () => ({ id_academy, kind }), async () => {
      const guard = await AcademyService.assertStaff(id_academy, id_user);
      if (guard.error) return guard;
      if (!guard.is_owner) return { error: "Sem permissão", statusCode: 403 };
      if (!["avatar", "cover"].includes(kind)) return { error: "Tipo inválido (avatar|cover)" };
      if (!file?.buffer) return { error: "Arquivo obrigatório" };
      if (!String(file.mimetype || "").toLowerCase().startsWith("image/")) {
        return { error: "Envie uma imagem (JPG/PNG/WebP)" };
      }
      const { url } = await uploadAcademyMediaToR2({ id_academy, file });
      const patch = kind === "avatar" ? { avatar_url: url } : { cover_url: url };
      await AcademyStorage.updateAcademy(pool, id_academy, patch);
      return { url };
    });
  }
}

module.exports = AcademySocialService;
