const pool = require("../databases");
const ServiceRequestStorage = require("../storages/ServiceRequestStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("ServiceRequestService");

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

class ServiceRequestService {
  // ---------- USER ----------
  static async createRequest(user, body) {
    return runWithLogs(log, "createRequest", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const id_machine = Number(body?.id_machine);
      const id_category = Number(body?.id_category);
      if (!Number.isInteger(id_machine) || id_machine <= 0) return { error: "id_machine inválido" };
      if (!Number.isInteger(id_category) || id_category <= 0) return { error: "id_category inválido" };
      const description = typeof body?.description === "string" ? body.description.trim() : "";
      if (description.length < 5) return { error: "Descrição obrigatório (mín. 5 caracteres)" };
      const estado = body?.estado ? String(body.estado).trim().slice(0, 2).toUpperCase() : null;
      const municipio = body?.municipio ? String(body.municipio).trim().slice(0, 120) : null;
      if (estado && estado.length !== 2) return { error: "estado inválido" };
      const created = await ServiceRequestStorage.createRequest(pool, {
        id_user: user.id_user,
        id_machine,
        id_category,
        estado,
        municipio,
        description: description.slice(0, 4000),
      });
      return { request: created };
    });
  }

  static async listMyRequests(user) {
    return runWithLogs(log, "listMyRequests", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const requests = await ServiceRequestStorage.listRequestsByUser(pool, user.id_user);
      const out = [];
      for (const r of requests) {
        const responses = await ServiceRequestStorage.listResponsesByRequest(pool, r.id_request);
        out.push({ ...r, responses });
      }
      return { requests: out };
    });
  }

  static async listMyChats(user) {
    return runWithLogs(log, "listMyChats", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const rows = await ServiceRequestStorage.listChatsForUser(pool, user.id_user);
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
          estado: r.request_estado,
          municipio: r.request_municipio,
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
      }));
      return { chats };
    });
  }

  static async cancelRequest(user, id_request) {
    return runWithLogs(log, "cancelRequest", () => ({ id_user: user?.id_user, id_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_request)) return { error: "id_request inválido" };
      const req = await ServiceRequestStorage.getRequestById(pool, id_request);
      if (!req) return { error: "Solicitação não encontrada" };
      if (String(req.id_user) !== String(user.id_user)) return { error: "Sem permissão" };
      if (req.status !== "OPEN") return { error: "Solicitação não está aberta" };
      const updated = await ServiceRequestStorage.cancelRequest(pool, id_request);
      return { request: updated };
    });
  }

  static async finalizeResponse(user, id_request, id_response) {
    return runWithLogs(log, "finalizeResponse", () => ({ id_user: user?.id_user, id_request, id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_request) || !isUuid(id_response)) return { error: "id inválido" };
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const req = await ServiceRequestStorage.getRequestById(client, id_request);
        if (!req) { await client.query("ROLLBACK"); return { error: "Solicitação não encontrada" }; }
        if (String(req.id_user) !== String(user.id_user)) { await client.query("ROLLBACK"); return { error: "Sem permissão" }; }
        if (req.status !== "OPEN") { await client.query("ROLLBACK"); return { error: "Solicitação não está aberta" }; }
        const resp = await ServiceRequestStorage.getResponseById(client, id_response);
        if (!resp || String(resp.id_request) !== String(id_request)) {
          await client.query("ROLLBACK");
          return { error: "Resposta não encontrada" };
        }
        if (!["PENDING", "PRO_ACCEPTED"].includes(resp.status)) {
          await client.query("ROLLBACK");
          return { error: "Resposta não está disponível para finalização" };
        }
        const finalized = await ServiceRequestStorage.finalizeResponse(client, id_response);
        await ServiceRequestStorage.closeOtherResponses(client, id_request, id_response);
        const updatedReq = await ServiceRequestStorage.fulfillRequest(client, id_request, id_response);
        await client.query("COMMIT");
        return { request: updatedReq, response: finalized };
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    });
  }

  static async userRejectResponse(user, id_request, id_response) {
    return runWithLogs(log, "userRejectResponse", () => ({ id_user: user?.id_user, id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_request) || !isUuid(id_response)) return { error: "id inválido" };
      const req = await ServiceRequestStorage.getRequestById(pool, id_request);
      if (!req) return { error: "Solicitação não encontrada" };
      if (String(req.id_user) !== String(user.id_user)) return { error: "Sem permissão" };
      const resp = await ServiceRequestStorage.getResponseById(pool, id_response);
      if (!resp || String(resp.id_request) !== String(id_request)) return { error: "Resposta não encontrada" };
      if (!["PENDING", "PRO_ACCEPTED"].includes(resp.status)) return { error: "Resposta não pode ser rejeitada" };
      const updated = await ServiceRequestStorage.userRejectResponse(pool, id_response);
      return { response: updated };
    });
  }

  // ---------- PRO (subperfil) ----------
  static async listMural(user, id_profile) {
    return runWithLogs(log, "listMural", () => ({ id_user: user?.id_user, id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      const p = own.profile;
      if (p.is_clan) return { error: "Mural de clan será disponibilizado na próxima slice" };
      if (!p.is_paid || !p.is_visible) return { error: "Perfil precisa estar ativo e visível" };
      // Expira PENDING > 6h antes de listar — abre a O.S. de novo pra todos
      await ServiceRequestStorage.expireOldPending(pool);
      const [items, conversations] = await Promise.all([
        ServiceRequestStorage.listMuralForProfile(pool, p),
        ServiceRequestStorage.listConversationsForProfile(pool, id_profile),
      ]);
      return { requests: items, items, conversations };
    });
  }

  static async respond(user, id_request, body) {
    return runWithLogs(log, "respond", () => ({ id_user: user?.id_user, id_request }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_request)) return { error: "id_request inválido" };
      const id_profile = body?.id_profile;
      const action = body?.action;
      if (!isUuid(id_profile)) return { error: "id_profile inválido" };
      if (!["open", "accept", "reject"].includes(action)) return { error: "action inválido" };
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      const p = own.profile;
      // Expira PENDING > 6h antes de checar request — pode liberar a vaga
      await ServiceRequestStorage.expireOldPending(pool);
      const req = await ServiceRequestStorage.getRequestById(pool, id_request);
      if (!req) return { error: "Solicitação não encontrada" };
      if (req.status !== "OPEN") {
        const err = { error: "Solicitação não está aberta" };
        err.status = 409;
        return err;
      }
      // valida match (defensivo)
      if (!p.is_clan) {
        if (Number(p.id_machine) !== Number(req.id_machine) || Number(p.id_category) !== Number(req.id_category)) {
          return { error: "Perfil não corresponde à solicitação" };
        }
        if (req.municipio && p.municipio && req.municipio !== p.municipio) {
          return { error: "Município não corresponde" };
        }
      }
      const existing = await ServiceRequestStorage.getResponseByPair(pool, id_request, id_profile);
      if (existing && ["USER_REJECTED", "FINALIZED", "CLOSED_OTHER_WON"].includes(existing.status)) {
        return { error: "Resposta já encerrada" };
      }
      // Lock por O.S. removido: multiplos sub-perfis podem responder em paralelo.
      // O usuario ve a concorrencia pelo responses_count no mural.
      let resp;
      if (action === "open") {
        resp = await ServiceRequestStorage.upsertResponsePending(pool, { id_request, id_profile });
      } else if (action === "accept") {
        resp = await ServiceRequestStorage.upsertResponseAccept(pool, { id_request, id_profile });
      } else {
        resp = await ServiceRequestStorage.upsertResponseReject(pool, { id_request, id_profile });
      }
      return { response: resp };
    });
  }

  static async markMuralSeen(user, body) {
    return runWithLogs(log, "markMuralSeen", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const id_profile = body?.id_profile;
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      await ServiceRequestStorage.setMuralSeen(pool, id_profile);
      return { ok: true };
    });
  }

  // ---------- Messages ----------
  static async listMessages(user, id_response) {
    return runWithLogs(log, "listMessages", () => ({ id_user: user?.id_user, id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_response)) return { error: "id_response inválido" };
      const ctx = await this._loadResponseContext(id_response, user.id_user);
      if (ctx.error) return ctx;
      const messages = await ServiceRequestStorage.listMessages(pool, id_response);
      await ServiceRequestStorage.markRead(pool, id_response, ctx.side);
      return { messages, side: ctx.side, response: ctx.response };
    });
  }

  static async sendMessage(user, id_response, body) {
    return runWithLogs(log, "sendMessage", () => ({ id_user: user?.id_user, id_response }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      if (!isUuid(id_response)) return { error: "id_response inválido" };
      const content = typeof body?.content === "string" ? body.content.trim() : "";
      if (!content) return { error: "Mensagem obrigatório" };
      if (content.length > 4000) return { error: "Mensagem excede 4000 caracteres" };
      const ctx = await this._loadResponseContext(id_response, user.id_user);
      if (ctx.error) return ctx;
      const terminal = ["USER_REJECTED", "PRO_REJECTED", "CLOSED_OTHER_WON", "FINALIZED"];
      if (terminal.includes(ctx.response.status)) {
        return { error: "Conversa encerrada" };
      }
      const msg = await ServiceRequestStorage.createMessage(pool, {
        id_response,
        sender: ctx.side,
        content,
      });
      await ServiceRequestStorage.markRead(pool, id_response, ctx.side);
      return { message: msg };
    });
  }

  static async _loadResponseContext(id_response, id_user) {
    const resp = await ServiceRequestStorage.getResponseById(pool, id_response);
    if (!resp) return { error: "Resposta não encontrada" };
    const req = await ServiceRequestStorage.getRequestById(pool, resp.id_request);
    if (!req) return { error: "Solicitação não encontrada" };
    if (String(req.id_user) === String(id_user)) {
      return { side: "USER", response: resp, request: req };
    }
    const profile = await ProfileStorage.getProfileById(pool, resp.id_profile);
    if (profile && String(profile.id_user) === String(id_user)) {
      return { side: "PRO", response: resp, request: req };
    }
    return { error: "Sem permissão" };
  }

  // ---------- Badges ----------
  static async badgeForProfile(user, id_profile) {
    return runWithLogs(log, "badgeForProfile", () => ({ id_user: user?.id_user, id_profile }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const own = await loadOwnedProfile(pool, id_profile, user.id_user);
      if (own.error) return { error: own.error };
      const p = own.profile;
      let mural_count = 0;
      if (!p.is_clan && p.is_paid && p.is_visible) {
        const since = await ServiceRequestStorage.getMuralLastSeen(pool, id_profile);
        mural_count = await ServiceRequestStorage.countMuralNew(pool, p, since);
      }
      const chat_unread = await ServiceRequestStorage.countProUnreadChats(pool, id_profile);
      return { has_new: mural_count > 0 || chat_unread > 0, mural_count, chat_unread };
    });
  }

  static async badgeForUser(user) {
    return runWithLogs(log, "badgeForUser", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado" };
      const unread_chats = await ServiceRequestStorage.countUserUnreadChats(pool, user.id_user);
      return { has_new: unread_chats > 0, unread_chats };
    });
  }
}

module.exports = ServiceRequestService;
