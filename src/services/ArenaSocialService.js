// Freelandoo Arena — integração social (Módulo 09). NÃO é um segundo chat:
// cada operação chama o MESMO serviço da plataforma (ConversationService,
// EntityFollowService, SocialSafetyService) e só ADAPTA a resposta por
// allowlist para a Arena:
//
//   • nada de id_user em lugar nenhum (nem sender_user_id da mensagem — a
//     Arena recebe `mine: true/false`);
//   • o ator ("Enviar como") é sempre conferido no servidor contra a posse
//     da conta (resolveActor do ConversationService);
//   • o alvo de um personagem é resolvido AQUI: playerId público → perfil-conta
//     do dono. O mapeamento playerId → id_user nunca sai do backend.
//
// O guard arenaAuth (conta ativa, sem sanção, supervisão em dia) roda antes
// de toda operação — o mesmo da Arena inteira.

const pool = require("../databases");
const ConversationService = require("./ConversationService");
const EntityFollowService = require("./EntityFollowService");
const SocialSafetyService = require("./SocialSafetyService");
const EntityFollowStorage = require("../storages/EntityFollowStorage");
const UserFollowStorage = require("../storages/UserFollowStorage");
const UserBlockStorage = require("../storages/UserBlockStorage");
const { assertDirectAllowed } = require("../utils/socialPolicy");
const { hasMinorPermission, isMinorUser } = require("../utils/supervision");
const rules = require("../utils/arenaRules");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PLAYER_ID = /^pl_[A-Za-z0-9]{10,32}$/;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;
const MAX_BODY = 4000;

const fail = (status, code, error, extra = {}) => ({ status, body: { error, code, ...extra } });
const ok = (body, status = 200) => ({ status, body });

/** Traduz o `{ error }` dos serviços da plataforma em código estável. */
function fromPlatform(result) {
  const err = String(result?.error || "");
  if (result?.code) {
    const status = result.statusCode || 403;
    return fail(status, result.code, err);
  }
  if (/sem permissão para (esta conversa|enviar como)/i.test(err)) return fail(403, "forbidden", err);
  if (/não encontrad/i.test(err)) return fail(404, "not_found", err);
  if (/limite de envio|aguarde/i.test(err)) return fail(429, "rate_limited", err);
  if (/bloqueada pelo responsável|supervisionada|revogado/i.test(err)) return fail(403, "minor_restricted", err);
  if (/indisponível|não está disponível|não está aceitando/i.test(err)) return fail(403, "target_unavailable", err);
  return fail(result?.statusCode && result.statusCode < 500 ? result.statusCode : 400, "invalid_input", err || "Pedido inválido");
}

const userOf = (ctx) => ({ id_user: ctx.id_user });

async function actorTypeOf(conn, ctx, actorId) {
  if (!UUID_RE.test(String(actorId || ""))) return null;
  const r = await conn.query(`SELECT is_clan FROM public.tb_profile WHERE id_profile = $1`, [actorId]);
  if (!r.rows[0]) return null;
  return r.rows[0].is_clan ? "clan" : "profile";
}

function entityDto(e) {
  if (!e) return null;
  return {
    profileId: e.id,
    type: e.type === "clan" ? "clan" : "profile",
    displayName: e.display_name || null,
    username: e.username || null,
    avatarUrl: e.avatar_url || null,
  };
}

function messageDto(m, me) {
  const mine = String(m.sender_user_id) === String(me);
  return {
    messageId: m.id_message,
    clientMessageId: mine && m.client_message_id ? m.client_message_id : null,
    mine,
    senderProfileId: m.sender_entity_id,
    kind: m.kind === "audio" ? "audio" : "text",
    body: m.kind === "audio" ? null : m.body,
    audioUrl: m.kind === "audio" ? m.audio_url || null : null,
    audioSeconds: m.kind === "audio" ? m.audio_duration_seconds || null : null,
    createdAt: new Date(m.created_at).toISOString(),
  };
}

/** Perfil-conta (o que representa a PESSOA) do dono de um playerId. */
async function resolvePlayer(conn, playerId) {
  const r = await conn.query(
    `SELECT ap.id_user, u.ativo, u.blocked_at, u.username,
            p.id_profile, p.display_name, p.avatar_url
       FROM public.tb_arena_player ap
       JOIN public.tb_user u ON u.id_user = ap.id_user
       LEFT JOIN LATERAL (
         SELECT id_profile, display_name, avatar_url FROM public.tb_profile
          WHERE id_user = ap.id_user AND is_user_account = TRUE AND deleted_at IS NULL AND is_active = TRUE
          LIMIT 1
       ) p ON TRUE
      WHERE ap.player_id = $1`,
    [playerId]
  );
  return r.rows[0] || null;
}

class ArenaSocialService {
  static async actors(ctx) {
    const rows = await EntityFollowStorage.listMessageableActorOptions(pool, ctx.id_user);
    // Perfil-conta primeiro: é o padrão de "Enviar como".
    const list = rows
      .map((r) => ({ ...entityDto(r), isAccount: !!r.is_user_account }))
      .sort((a, b) => Number(b.isAccount) - Number(a.isAccount));
    return ok({ actors: list });
  }

  static async conversations(ctx, query) {
    const actorId = query?.actorId;
    const actorType = await actorTypeOf(pool, ctx, actorId);
    if (!actorType) return fail(400, "invalid_input", "actorId");
    if (query?.cursor != null && !CURSOR.test(String(query.cursor))) return fail(400, "invalid_input", "cursor");
    const r = await ConversationService.listMine(userOf(ctx), { actor_id: actorId, actor_type: actorType, cursor: query?.cursor, limit: 30 });
    if (r?.error) return fromPlatform(r);
    return ok({
      items: r.items.map((c) => ({
        conversationId: c.id_conversation,
        kind: c.kind === "group" ? "group" : "direct",
        title: c.kind === "group" ? c.name || null : c.other_entity?.display_name || c.other_entity?.username || null,
        other: c.kind === "group" ? null : entityDto(c.other_entity),
        memberCount: c.kind === "group" ? c.member_count ?? null : null,
        lastMessageAt: c.last_message_at ? new Date(c.last_message_at).toISOString() : null,
        lastMessagePreview: c.last_message_preview || null,
        lastFromMe: c.is_last_message_from_me === true,
        unread: Number(c.unread_count || 0),
      })),
      nextCursor: r.next_cursor || null,
    });
  }

  static async messages(ctx, conversationId, query) {
    if (!UUID_RE.test(String(conversationId || ""))) return fail(400, "invalid_input", "conversationId");
    const actorType = await actorTypeOf(pool, ctx, query?.actorId);
    if (!actorType) return fail(400, "invalid_input", "actorId");
    if (query?.cursor != null && !CURSOR.test(String(query.cursor))) return fail(400, "invalid_input", "cursor");
    const r = await ConversationService.listMessages(userOf(ctx), {
      id_conversation: conversationId,
      actor_id: query.actorId,
      actor_type: actorType,
      cursor: query?.cursor,
      limit: 30,
    });
    if (r?.error) return fromPlatform(r);
    // listMessages devolve DESC; sender_user_id não sai (só `mine`).
    const raw = await pool.query(
      `SELECT id_message, client_message_id FROM public.tb_message WHERE id_message = ANY($1::uuid[])`,
      [r.items.map((m) => m.id_message)]
    );
    const cids = new Map(raw.rows.map((x) => [x.id_message, x.client_message_id]));
    return ok({
      items: r.items.map((m) => messageDto({ ...m, client_message_id: cids.get(m.id_message) }, ctx.id_user)),
      nextCursor: r.next_cursor || null,
    });
  }

  static async send(ctx, conversationId, body) {
    const picked = rules.pickBody(body, ["actorId", "body", "clientMessageId"]);
    if (!picked.ok) return fail(400, "invalid_input", `campo não aceito: ${picked.field}`);
    const b = picked.value;
    if (!UUID_RE.test(String(conversationId || ""))) return fail(400, "invalid_input", "conversationId");
    if (!UUID_RE.test(String(b.clientMessageId || ""))) return fail(400, "invalid_input", "clientMessageId");
    if (typeof b.body !== "string" || !b.body.trim() || b.body.length > MAX_BODY) return fail(400, "invalid_input", "body");
    const actorType = await actorTypeOf(pool, ctx, b.actorId);
    if (!actorType) return fail(400, "invalid_input", "actorId");
    const r = await ConversationService.sendMessage(userOf(ctx), {
      id_conversation: conversationId,
      actor_id: b.actorId,
      actor_type: actorType,
      body: b.body,
      client_message_id: b.clientMessageId,
    });
    if (r?.error) return fromPlatform(r);
    const m = { ...r.message, client_message_id: b.clientMessageId };
    return ok({ message: messageDto(m, ctx.id_user), duplicate: !!r.duplicate }, r.duplicate ? 200 : 201);
  }

  static async read(ctx, conversationId, body) {
    const picked = rules.pickBody(body, ["actorId", "upToMessageId"]);
    if (!picked.ok) return fail(400, "invalid_input", `campo não aceito: ${picked.field}`);
    const b = picked.value;
    if (!UUID_RE.test(String(conversationId || ""))) return fail(400, "invalid_input", "conversationId");
    if (!UUID_RE.test(String(b.upToMessageId || ""))) return fail(400, "invalid_input", "upToMessageId");
    const actorType = await actorTypeOf(pool, ctx, b.actorId);
    if (!actorType) return fail(400, "invalid_input", "actorId");
    const r = await ConversationService.markRead(userOf(ctx), {
      id_conversation: conversationId,
      actor_id: b.actorId,
      actor_type: actorType,
      up_to_message_id: b.upToMessageId,
    });
    if (r?.error) return fromPlatform(r);
    return ok({ unread: Number(r.unread_count || 0) });
  }

  // ─── Personagem → alvo social ─────────────────────────────────────────────

  static async player(ctx, playerId) {
    if (!PLAYER_ID.test(String(playerId || ""))) return fail(400, "invalid_input", "playerId");
    const p = await resolvePlayer(pool, playerId);
    // Mesmo "não encontrado" para inexistente e para conta indisponível:
    // não confirma que um playerId pertence a uma conta sancionada.
    if (!p || !p.ativo || p.blocked_at || !p.id_profile) return fail(404, "not_found", "Jogador indisponível");
    const self = String(p.id_user) === String(ctx.id_user);
    let canMessage = false;
    let blockedByMe = false;
    let following = false;
    if (!self) {
      blockedByMe = await UserBlockStorage.iBlocked(pool, ctx.id_user, p.id_user);
      const denied = await assertDirectAllowed(pool, { senderUserId: ctx.id_user, targetEntityId: p.id_profile });
      const minorSend = (await isMinorUser(ctx.id_user)) && !(await hasMinorPermission(ctx.id_user, "can_message"));
      canMessage = !denied && !minorSend;
      following = !!(await UserFollowStorage.findActive(pool, { follower_user_id: ctx.id_user, target_profile_id: p.id_profile }));
    }
    return ok({
      playerId,
      self,
      profile: {
        profileId: p.id_profile,
        displayName: p.display_name || p.username || null,
        username: p.username || null,
        avatarUrl: p.avatar_url || null,
      },
      relation: { canMessage, blockedByMe, following, canFollow: !self, canBlock: !self },
    });
  }

  static async openWithPlayer(ctx, playerId, body) {
    const picked = rules.pickBody(body, ["actorId"]);
    if (!picked.ok) return fail(400, "invalid_input", `campo não aceito: ${picked.field}`);
    if (!PLAYER_ID.test(String(playerId || ""))) return fail(400, "invalid_input", "playerId");
    const actorType = await actorTypeOf(pool, ctx, picked.value.actorId);
    if (!actorType) return fail(400, "invalid_input", "actorId");
    const p = await resolvePlayer(pool, playerId);
    if (!p || !p.ativo || p.blocked_at || !p.id_profile) return fail(404, "not_found", "Jogador indisponível");
    if (String(p.id_user) === String(ctx.id_user)) return fail(422, "self", "Não é possível conversar consigo mesmo");
    const r = await ConversationService.openOrCreate(userOf(ctx), {
      actor_id: picked.value.actorId,
      actor_type: actorType,
      target_id: p.id_profile,
    });
    if (r?.error) return fromPlatform(r);
    return ok({ conversationId: r.conversation.id_conversation, created: !!r.created });
  }

  static async block(ctx, playerId, on) {
    if (!PLAYER_ID.test(String(playerId || ""))) return fail(400, "invalid_input", "playerId");
    const p = await resolvePlayer(pool, playerId);
    if (!p || !p.id_profile) return fail(404, "not_found", "Jogador indisponível");
    const r = on
      ? await SocialSafetyService.block(userOf(ctx), { target_profile_id: p.id_profile })
      : await SocialSafetyService.unblock(userOf(ctx), { target_profile_id: p.id_profile });
    if (r?.error) return fromPlatform(r);
    return ok({ blockedByMe: r.blocked });
  }

  static async follow(ctx, playerId, on) {
    if (!PLAYER_ID.test(String(playerId || ""))) return fail(400, "invalid_input", "playerId");
    const p = await resolvePlayer(pool, playerId);
    if (!p || !p.ativo || p.blocked_at || !p.id_profile) return fail(404, "not_found", "Jogador indisponível");
    if (String(p.id_user) === String(ctx.id_user)) return fail(422, "self", "Não é possível seguir a si mesmo");
    // Seguir é do USUÁRIO (mig 056): o ator é o perfil-conta de quem segue.
    const mine = await pool.query(
      `SELECT id_profile FROM public.tb_profile WHERE id_user = $1 AND is_user_account = TRUE AND deleted_at IS NULL LIMIT 1`,
      [ctx.id_user]
    );
    const actorId = mine.rows[0]?.id_profile;
    if (!actorId) return fail(422, "no_account_profile", "Sua conta ainda não tem perfil");
    const payload = { actor_type: "profile", actor_id: actorId, target_type: "profile", target_id: p.id_profile };
    const r = on ? await EntityFollowService.follow(userOf(ctx), payload) : await EntityFollowService.unfollow(userOf(ctx), payload);
    if (r?.error) return fromPlatform(r);
    return ok({ following: on });
  }

  static async report(ctx, messageId, body) {
    const picked = rules.pickBody(body, ["reasonCategory", "reason"]);
    if (!picked.ok) return fail(400, "invalid_input", `campo não aceito: ${picked.field}`);
    const r = await SocialSafetyService.reportMessage(userOf(ctx), {
      id_message: messageId,
      reason_category: picked.value.reasonCategory,
      reason: picked.value.reason ?? null,
    });
    if (r?.error) return fromPlatform(r);
    return ok({ reported: true }, 201);
  }
}

module.exports = ArenaSocialService;
