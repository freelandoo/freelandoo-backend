const pool = require("../databases");
const CourseRequestStorage = require("../storages/CourseRequestStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const {
  assertNotMinorForServiceRequest,
  assertNotMinorForMural,
} = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CourseRequestService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

async function loadOwnedProfile(conn, id_profile, id_user) {
  if (!isUuid(id_profile)) return { error: "id_profile inválido" };
  const profile = await ProfileStorage.getProfileById(conn, id_profile);
  if (!profile) return { error: "Perfil não encontrado" };
  if (String(profile.id_user) !== String(id_user)) return { error: "Sem permissão para este perfil" };
  if (profile.deleted_at) return { error: "Perfil não encontrado" };
  return { profile };
}

class CourseRequestService {
  // ---------- USER ----------
  static async createRequest(user, body) {
    return runWithLogs(log, "createRequest", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const minorBlock = await assertNotMinorForServiceRequest(user.id_user);
      if (minorBlock) return minorBlock;
      const id_machine = Number(body?.id_machine);
      const id_category = Number(body?.id_category);
      if (!Number.isInteger(id_machine) || id_machine <= 0) return { error: "id_machine inválido" };
      if (!Number.isInteger(id_category) || id_category <= 0) return { error: "id_category inválido" };
      const description = typeof body?.description === "string" ? body.description.trim() : "";
      if (description.length < 5) return { error: "Descrição obrigatória (mín. 5 caracteres)" };
      const created = await CourseRequestStorage.createRequest(pool, {
        id_user: user.id_user,
        id_machine,
        id_category,
        description: description.slice(0, 4000),
      });
      return { request: created };
    });
  }

  static async listMyRequests(user) {
    return runWithLogs(log, "listMyRequests", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const requests = await CourseRequestStorage.listRequestsByUser(pool, user.id_user);
      const out = [];
      for (const r of requests) {
        const responses = await CourseRequestStorage.listResponsesByRequest(pool, r.id_course_request);
        out.push({ ...r, responses });
      }
      return { requests: out };
    });
  }

  static async listMyChats(user) {
    return runWithLogs(log, "listMyChats", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const rows = await CourseRequestStorage.listChatsForUser(pool, user.id_user);
      const chats = rows.map((r) => ({
        id_response: r.id_response,
        response_status: r.response_status,
        response_created_at: r.response_created_at,
        last_message: r.last_message,
        last_message_at: r.last_message_at,
        unread_count: r.unread_count,
        request: {
          id_request: r.id_request,
          status: r.request_status,
          description: r.request_description,
          id_machine: r.id_machine,
          id_category: r.id_category,
          machine_name: r.machine_name,
          category_name: r.category_name,
          id_response_chosen: r.id_response_chosen,
        },
        profile: {
          id_profile: r.id_profile,
          display_name: r.display_name,
          avatar_url: r.avatar_url,
          sub_profile_slug: r.sub_profile_slug,
          username: r.username,
          is_clan: r.is_clan,
        },
        course: r.id_course ? { id_course: r.id_course } : null,
      }));
      return { chats };
    });
  }

  static async cancelRequest(user, id_request) {
    return runWithLogs(log, "cancelRequest", () => ({ id_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_request)) return { error: "id_request inválido" };
      const req = await CourseRequestStorage.getRequestById(pool, id_request);
      if (!req) return { error: "Pedido não encontrado" };
      if (String(req.id_buyer_user) !== String(user.id_user)) return { error: "Sem permissão" };
      if (req.status !== "OPEN") return { error: "Pedido não está aberto" };
      const updated = await CourseRequestStorage.cancelRequest(pool, id_request);
      return { request: updated };
    });
  }

  // ---------- PRO (subperfil) ----------
  static async listMural(user, id_profile) {
    return runWithLogs(log, "listMural", () => ({ id_user: user?.id_user, id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const minorBlock = await assertNotMinorForMural(user.id_user);
      if (minorBlock) return minorBlock;
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      const p = own.profile;
      if (p.is_clan) return { items: [] };
      const items = await CourseRequestStorage.listMuralForProfile(pool, {
        id_profile: p.id_profile,
        id_machine: p.id_machine,
        id_category: p.id_category,
      });
      return { items };
    });
  }

  static async respond(user, id_request, body) {
    return runWithLogs(log, "respond", () => ({ id_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_request)) return { error: "id_request inválido" };
      const id_profile = body?.id_profile;
      const action = body?.action;
      const id_course = body?.id_course; // opcional
      if (!isUuid(id_profile)) return { error: "id_profile inválido" };
      if (!["accept", "reject"].includes(action)) return { error: "action inválido" };
      if (id_course && !isUuid(id_course)) return { error: "id_course inválido" };
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      const p = own.profile;
      const req = await CourseRequestStorage.getRequestById(pool, id_request);
      if (!req) return { error: "Pedido não encontrado" };
      if (req.status !== "OPEN") {
        const err = { error: "Pedido não está aberto" };
        err.status = 409;
        return err;
      }
      if (!p.is_clan) {
        if (Number(p.id_machine) !== Number(req.id_machine) || Number(p.id_category) !== Number(req.id_category)) {
          return { error: "Perfil não corresponde ao Enxame/Profissão do pedido" };
        }
      }
      let resp;
      if (action === "accept") {
        resp = await CourseRequestStorage.upsertResponseAccept(pool, { id_request, id_profile, id_course });
      } else {
        resp = await CourseRequestStorage.upsertResponseReject(pool, { id_request, id_profile });
      }
      return { response: resp };
    });
  }

  // ---------- Mensagens ----------
  static async sendMessage(user, id_response, body) {
    return runWithLogs(log, "sendMessage", () => ({ id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_response)) return { error: "id_response inválido" };
      const content = typeof body?.content === "string" ? body.content.trim() : "";
      if (content.length < 1) return { error: "Mensagem vazia" };
      const resp = await CourseRequestStorage.getResponseById(pool, id_response);
      if (!resp) return { error: "Resposta não encontrada" };
      const req = await CourseRequestStorage.getRequestById(pool, resp.id_course_request);
      if (!req) return { error: "Pedido não encontrado" };
      let sender;
      if (String(req.id_buyer_user) === String(user.id_user)) sender = "USER";
      else {
        // verifica se perfil pertence ao user
        const profile = await ProfileStorage.getProfileById(pool, resp.id_profile);
        if (!profile || String(profile.id_user) !== String(user.id_user)) {
          return { error: "Sem permissão" };
        }
        sender = "PRO";
      }
      const msg = await CourseRequestStorage.insertMessage(pool, {
        id_response,
        sender,
        content: content.slice(0, 4000),
      });
      return { message: msg };
    });
  }

  static async listMessages(user, id_response) {
    return runWithLogs(log, "listMessages", () => ({ id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_response)) return { error: "id_response inválido" };
      const resp = await CourseRequestStorage.getResponseById(pool, id_response);
      if (!resp) return { error: "Resposta não encontrada" };
      const req = await CourseRequestStorage.getRequestById(pool, resp.id_course_request);
      if (!req) return { error: "Pedido não encontrado" };
      const isUser = String(req.id_buyer_user) === String(user.id_user);
      let isPro = false;
      if (!isUser) {
        const profile = await ProfileStorage.getProfileById(pool, resp.id_profile);
        isPro = profile && String(profile.id_user) === String(user.id_user);
      }
      if (!isUser && !isPro) return { error: "Sem permissão" };
      const messages = await CourseRequestStorage.listMessages(pool, id_response);
      // marca como lido pelo lado certo
      if (isUser) await CourseRequestStorage.markReadByUser(pool, id_response);
      else if (isPro) await CourseRequestStorage.markReadByPro(pool, id_response);
      return {
        messages,
        side: isUser ? "USER" : "PRO",
        response: { id_response: resp.id_response, status: resp.status },
      };
    });
  }

  // ---------- Badges ----------
  static async badgeForProfile(user, id_profile) {
    return runWithLogs(log, "badgeForProfile", () => ({ id_user: user?.id_user, id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      const p = own.profile;
      let mural_count = 0;
      if (!p.is_clan) {
        const since = await CourseRequestStorage.getMuralLastSeen(pool, id_profile);
        mural_count = await CourseRequestStorage.countMuralNew(
          pool,
          { id_profile: p.id_profile, id_machine: p.id_machine, id_category: p.id_category },
          since,
        );
      }
      const chat_unread = await CourseRequestStorage.countProUnreadChats(pool, id_profile);
      return { has_new: mural_count > 0 || chat_unread > 0, mural_count, chat_unread };
    });
  }

  static async badgeForUser(user) {
    return runWithLogs(log, "badgeForUser", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const unread_chats = await CourseRequestStorage.countUserUnreadChats(pool, user.id_user);
      return { has_new: unread_chats > 0, unread_chats };
    });
  }

  static async markMuralSeen(user, id_profile) {
    return runWithLogs(log, "markMuralSeen", () => ({ id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      await CourseRequestStorage.setMuralSeen(pool, id_profile);
      return { ok: true };
    });
  }

  static async markRead(user, id_response) {
    return runWithLogs(log, "markRead", () => ({ id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_response)) return { error: "id_response inválido" };
      const resp = await CourseRequestStorage.getResponseById(pool, id_response);
      if (!resp) return { error: "Resposta não encontrada" };
      const req = await CourseRequestStorage.getRequestById(pool, resp.id_course_request);
      if (!req) return { error: "Pedido não encontrado" };
      if (String(req.id_buyer_user) === String(user.id_user)) {
        await CourseRequestStorage.markReadByUser(pool, id_response);
      } else {
        const profile = await ProfileStorage.getProfileById(pool, resp.id_profile);
        if (profile && String(profile.id_user) === String(user.id_user)) {
          await CourseRequestStorage.markReadByPro(pool, id_response);
        } else return { error: "Sem permissão" };
      }
      return { ok: true };
    });
  }
}

module.exports = CourseRequestService;
