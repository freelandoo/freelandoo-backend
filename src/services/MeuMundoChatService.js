// src/services/MeuMundoChatService.js — MEU MUNDO 3D mm3d-32: chat do jogo.
//
// Global: uma sala do chat ao vivo (tipo meu_mundo, mig 303) — gravar,
// moderar e denunciar são do ChatService; aqui só se decide QUEM recebe
// (online no jogo, menos bloqueio em qualquer sentido) e o balão na sala.
// A entrega é pela sala do Meu Mundo; o socket recusa essa sala (D3).
//
// 1:1: a conversa da Freelandoo entre os PERFIS-CONTA (aparece em /mensagens).
// O jogo só abre/acha a conversa; enviar, ler e tempo real são o /conversations
// e o socket que o site já usa.

const pool = require("../databases");
const ChatService = require("./ChatService");
const ConversationService = require("./ConversationService");
const MeuMundoChatStorage = require("../storages/MeuMundoChatStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const presence = require("../realtime/meuMundoPresence");
const { toLine, authorOf, recipients, bubbleText } = require("../utils/meuMundoChat");

const fail = (error, code, statusCode) => ({ error, code, statusCode });
const SID = /^[A-Za-z0-9_-]{4,64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function blockedWith(pairs, userId) {
  const out = new Set();
  for (const p of pairs) {
    if (String(p.blocker_user_id) === String(userId)) out.add(String(p.blocked_user_id));
    if (String(p.blocked_user_id) === String(userId)) out.add(String(p.blocker_user_id));
  }
  return out;
}

class MeuMundoChatService {
  static async history(userId, query = {}) {
    const room = await MeuMundoChatStorage.ensureRoom(pool);
    if (!room) return fail("Chat indisponível", "unavailable", 503);
    // Cursor inválido vira erro do Postgres (500) lá dentro: recusa aqui.
    const before = query.before != null && query.before !== "" ? String(query.before) : null;
    if (before && Number.isNaN(Date.parse(before))) return fail("Cursor inválido", "cursor", 400);
    // game: true — a sala meu_mundo só abre por aqui (rotas públicas do /chat devolvem 404).
    const r = await ChatService.listMessages(
      { id_user: userId },
      { id_chat_room: room.id_chat_room },
      { before, limit: query.limit || 50 },
      { game: true }
    );
    if (r.error) return r;
    const cut = blockedWith(await MeuMundoChatStorage.blockPairs(pool, userId), userId);
    const mm = require("../realtime/meuMundo");
    const items = (r.items || [])
      .filter((m) => !cut.has(String(authorOf(m))))
      .map((m) => toLine(m, { viewerId: userId, sessionOf: (u) => mm.sessionOf(userId, u) }))
      .filter(Boolean);
    return { items, next_before: r.next_before || null, has_more: !!r.has_more };
  }

  static async send(userId, body = {}) {
    const room = await MeuMundoChatStorage.ensureRoom(pool);
    if (!room) return fail("Chat indisponível", "unavailable", 503);
    const id_profile = await ProfileStorage.getUserAccountProfileId(pool, userId);
    const r = await ChatService.sendMessage(
      { id_user: userId },
      { id_chat_room: room.id_chat_room },
      { content: body.text },
      { id_profile, silent: true, game: true }
    );
    // Moderação recusou: `code` = a ação (block / mute_temp / review) — o painel
    // do jogo diferencia "bloqueada", "silenciado" e "em análise" por ele.
    if (r.error) return r.moderation_action ? { ...r, code: r.moderation_action } : r;
    if (!r.message) return fail("Mensagem não enviada", "failed", 500);

    const pairs = await MeuMundoChatStorage.blockPairs(pool, userId);
    const cut = blockedWith(pairs, userId);
    const mm = require("../realtime/meuMundo");
    for (const u of recipients(presence.onlineUsers(), userId, pairs)) {
      const line = toLine(r.message, { viewerId: u, sessionOf: (a) => mm.sessionOf(u, a) });
      if (line) mm.pushChat(u, line);
    }
    mm.sayInRoom(userId, bubbleText(r.message.content), (u) => !cut.has(String(u)));
    return { line: toLine(r.message, { viewerId: userId }) };
  }

  static async report(userId, messageId, body = {}) {
    if (!UUID.test(String(messageId || ""))) return fail("Mensagem não encontrada", "gone", 404);
    const room = await MeuMundoChatStorage.ensureRoom(pool);
    if (!room) return fail("Chat indisponível", "unavailable", 503);
    // Pelo jogo só se denuncia mensagem do Global do jogo.
    if (!(await MeuMundoChatStorage.messageInRoom(pool, messageId, room.id_chat_room))) {
      return fail("Mensagem não encontrada", "gone", 404);
    }
    const r = await ChatService.reportMessage({ id_user: userId }, { id_chat_message: messageId }, body);
    if (r && r.error && !r.statusCode && /não encontrada/i.test(r.error)) return { ...r, code: "gone", statusCode: 404 };
    return r;
  }

  /**
   * mm3d-33: a mensagem 1:1 entre perfis-conta acabou de ser gravada (o
   * /conversations já conferiu bloqueio). Se o destinatário está no jogo, só
   * ele recebe o balão sobre quem falou + o aviso. Quem não joga não custa banco.
   */
  static async relayDirect({ fromUserId, actorId, to, conversationId, body }) {
    if (!to || !to.is_user_account || !to.id_user || String(to.id_user) === String(fromUserId)) return false;
    if (!presence.get(to.id_user)) return false;
    const text = bubbleText(body);
    if (!text) return false;
    const actor = await ProfileStorage.getProfileById(pool, actorId);
    if (!actor || !actor.is_user_account || String(actor.id_user) !== String(fromUserId)) return false;
    return require("../realtime/meuMundo").directInGame(to.id_user, fromUserId, {
      conversationId,
      name: actor.display_name || actor.username || "",
      text,
    });
  }

  /** Acha/cria a conversa 1:1 com o jogador (sessão na minha sala OU perfil-conta da linha). */
  static async openDirect(userId, body = {}) {
    let targetUserId = null;
    let targetProfileId = null;
    if (body.session) {
      const sid = String(body.session);
      if (!SID.test(sid)) return fail("Jogador não encontrado", "gone", 404);
      const found = require("../realtime/meuMundo").playerInMyRoom(userId, sid);
      if (!found) return fail("Esse jogador não está mais aqui", "gone", 404);
      targetUserId = found.userId;
    } else if (body.profileId) {
      // id_profile é UUID: texto qualquer viraria erro do Postgres (500).
      const pid = String(body.profileId);
      if (!UUID.test(pid)) return fail("Jogador não encontrado", "gone", 404);
      const acc = await MeuMundoChatStorage.accountProfileById(pool, pid);
      if (!acc) return fail("Jogador não encontrado", "gone", 404);
      targetUserId = acc.id_user;
      targetProfileId = acc.id_profile;
    } else {
      return fail("Jogador não encontrado", "gone", 404);
    }
    if (String(targetUserId) === String(userId)) return fail("Esse é você", "self", 404);
    const actor = await ProfileStorage.getUserAccountProfileId(pool, userId);
    const target = targetProfileId || (await ProfileStorage.getUserAccountProfileId(pool, targetUserId));
    // Bloqueio, conta inativa e menor: a régua é a do /conversations (assertDirectAllowed).
    return ConversationService.openOrCreate(
      { id_user: userId },
      { actor_id: actor, actor_type: "profile", target_id: target, target_type: "profile" }
    );
  }
}

module.exports = MeuMundoChatService;
