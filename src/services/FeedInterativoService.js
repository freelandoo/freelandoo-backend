// Feed Interativo (migs 456+) — regras do Throw (F2). Baú (F3) e cápsula (F4)
// entram neste mesmo service porque usam a mesma fila (tb_feed_drop) e a mesma
// permissão (tb_feed_throw_link).
//
// Régua de quem cai no feed de quem:
//   - só com convite ACEITO pelo receiver (status active/silenced);
//   - nunca entre contas com bloqueio social em qualquer sentido (mig 283);
//   - nunca com conta de menor em nenhum dos lados (adulto não empurra
//     conteúdo para o feed de criança, nem o contrário);
//   - só post que passa na régua do FEED GLOBAL (PortfolioFeedStorage
//     listEligibleByIds): exclusivo de comunidade privada, banido, de conta
//     inativa ou de perfil pago sem assinatura não é lançável. A régua roda de
//     novo na ENTREGA (inbox), com o receiver como leitor.
//   - silenciado: o envio é aceito e descartado (status 'muted'); o sender
//     não fica sabendo — é a mesma resposta de quem recebeu.

const pool = require("../databases");
const FeedInterativoStorage = require("../storages/FeedInterativoStorage");
const PortfolioFeedStorage = require("../storages/PortfolioFeedStorage");
const UserBlockStorage = require("../storages/UserBlockStorage");
const { shapeRow } = require("./portfolioFeed/PortfolioFeedService");
const { isMinorUser, assertMinorPermission } = require("../utils/supervision");
const { STICKERS, REACTIONS, CHESTS, MESSAGE_MAX } = require("../utils/feedGifts");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FeedInterativoService");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_RE = /^@?[a-z0-9_.]{2,30}$/i;

const LIMITS = {
  invitesPerDay: 30,
  reinviteDays: 7,
  throwsPerHour: 30,
  throwsPerPairPerHour: 10,
  giftsPerDay: 10,
  giftsPerPairPerDay: 2,
};

/** Texto curto, sem caractere de controle e sem pilha de linhas em branco. */
function cleanMessage(raw, max = MESSAGE_MAX) {
  if (typeof raw !== "string") return null;
  const v = raw
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return v ? v.slice(0, max) : null;
}

function realtime() {
  // require tardio: realtime/socket → services → realtime (ciclo).
  return require("../realtime/socket");
}

function publicCard(row) {
  if (!row) return null;
  return {
    id_user: row.id_user,
    username: row.username || null,
    display_name: row.display_name || row.username || null,
    avatar_url: row.avatar_url || null,
  };
}

function notAuth() {
  return { error: "Usuário não autenticado", statusCode: 401 };
}

class FeedInterativoService {
  static LIMITS = LIMITS;

  // ── vínculos ─────────────────────────────────────────────────────────────
  static async listLinks(user) {
    if (!user?.id_user) return notAuth();
    const { sending, receiving } = await FeedInterativoStorage.listLinks(pool, user.id_user);
    const prefs = await FeedInterativoStorage.getPrefs(pool, user.id_user);
    const map = (r) => ({ id_link: r.id_link, status: r.status, invited_at: r.invited_at, accepted_at: r.accepted_at, user: publicCard(r) });
    return {
      sending: sending.map(map),
      receiving: receiving.map(map),
      prefs: { invite_policy: prefs.invite_policy, accept_gifts: prefs.accept_gifts },
    };
  }

  static async invite(user, body = {}) {
    return runWithLogs(log, "invite", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return notAuth();
      let target = null;
      if (body.id_user && UUID_RE.test(String(body.id_user))) {
        target = await FeedInterativoStorage.userCard(pool, String(body.id_user));
      } else if (typeof body.username === "string" && USERNAME_RE.test(body.username.trim())) {
        target = await FeedInterativoStorage.findUserByUsername(pool, body.username.trim().replace(/^@/, ""));
      } else {
        return { error: "Informe o @ de quem você quer convidar" };
      }
      // Mesma resposta para "não existe", "bloqueado" e "conta inativa": não
      // dá para usar o convite para descobrir quem bloqueou quem.
      const GENERIC = { error: "Não foi possível convidar essa pessoa", statusCode: 404 };
      if (!target || !target.ativo || target.blocked_at) return GENERIC;
      if (target.id_user === user.id_user) return { error: "Você não pode convidar a si mesmo" };
      if (await UserBlockStorage.eitherBlocks(pool, user.id_user, target.id_user)) return GENERIC;
      if ((await isMinorUser(user.id_user)) || (await isMinorUser(target.id_user))) {
        return { error: "Lançar no feed não está disponível para contas de menores", statusCode: 403 };
      }

      const prefs = await FeedInterativoStorage.getPrefs(pool, target.id_user);
      if (prefs.invite_policy === "ninguem") {
        return { error: "Essa pessoa não está aceitando convites", statusCode: 403 };
      }
      if (prefs.invite_policy === "mutuos" && !(await FeedInterativoStorage.isMutualFollow(pool, user.id_user, target.id_user))) {
        return { error: "Essa pessoa só aceita convite de quem os dois se seguem", statusCode: 403 };
      }

      const existing = await FeedInterativoStorage.getLink(pool, user.id_user, target.id_user);
      if (existing) {
        if (existing.status === "blocked") return GENERIC;
        if (existing.status === "active" || existing.status === "silenced") {
          return { link: { id_link: existing.id_link, status: "active" }, user: publicCard(target), already: true };
        }
        if (existing.status === "pending") {
          return { link: { id_link: existing.id_link, status: "pending" }, user: publicCard(target), already: true };
        }
        const since = Date.now() - new Date(existing.updated_at).getTime();
        if (since < LIMITS.reinviteDays * 86400_000) {
          return { error: "Essa pessoa recusou há pouco. Tente de novo daqui a alguns dias.", statusCode: 429 };
        }
      }
      if ((await FeedInterativoStorage.countInvitesToday(pool, user.id_user)) >= LIMITS.invitesPerDay) {
        return { error: "Você chegou ao limite de convites de hoje", statusCode: 429 };
      }

      const link = await FeedInterativoStorage.upsertInvite(pool, user.id_user, target.id_user);
      const me = await FeedInterativoStorage.userCard(pool, user.id_user);
      realtime().emitToUser(target.id_user, "fi:links", { type: "invite", from: publicCard(me) });
      return { link: { id_link: link.id_link, status: link.status }, user: publicCard(target) };
    });
  }

  /**
   * Ações sobre um vínculo. Do RECEIVER: accept, decline, silence, unsilence,
   * revoke, block, unblock. Do SENDER: cancel (para de lançar / retira convite).
   */
  static async act(user, id_link, action) {
    return runWithLogs(log, "act", () => ({ id_user: user?.id_user, id_link, action }), async () => {
      if (!user?.id_user) return notAuth();
      if (!UUID_RE.test(String(id_link || ""))) return { error: "id_link inválido" };
      const link = await FeedInterativoStorage.getLinkById(pool, id_link);
      if (!link) return { error: "Convite não encontrado", statusCode: 404 };
      const isReceiver = link.id_receiver === user.id_user;
      const isSender = link.id_sender === user.id_user;
      if (!isReceiver && !isSender) return { error: "Convite não encontrado", statusCode: 404 };

      const RECEIVER = {
        accept: [["pending"], "active"],
        decline: [["pending"], "declined"],
        silence: [["active"], "silenced"],
        unsilence: [["silenced"], "active"],
        revoke: [["active", "silenced"], "revoked"],
        block: [["pending", "active", "silenced", "declined", "revoked"], "blocked"],
        unblock: [["blocked"], "revoked"],
      };
      let updated = null;
      if (action === "cancel") {
        if (!isSender) return { error: "Sem permissão", statusCode: 403 };
        if (!["pending", "active", "silenced"].includes(link.status)) return { error: "Nada para cancelar" };
        await FeedInterativoStorage.deleteLink(pool, id_link);
        updated = { ...link, status: "canceled" };
      } else if (RECEIVER[action]) {
        if (!isReceiver) return { error: "Sem permissão", statusCode: 403 };
        if (action === "accept") {
          if ((await isMinorUser(user.id_user)) || (await isMinorUser(link.id_sender))) {
            return { error: "Lançar no feed não está disponível para contas de menores", statusCode: 403 };
          }
          if (await UserBlockStorage.eitherBlocks(pool, link.id_sender, link.id_receiver)) {
            return { error: "Não foi possível aceitar", statusCode: 403 };
          }
        }
        const [from, to] = RECEIVER[action];
        updated = await FeedInterativoStorage.setStatus(pool, id_link, from, to);
        if (!updated) return { error: "Esse convite mudou. Atualize a lista.", statusCode: 409 };
      } else {
        return { error: "Ação inválida" };
      }
      // Os dois lados redesenham a lista. O sender só fica sabendo do que é
      // dele saber (aceite / fim); silenciar e bloquear não avisam ninguém.
      realtime().emitToUser(user.id_user, "fi:links", { type: action });
      if (action === "accept") {
        const me = await FeedInterativoStorage.userCard(pool, user.id_user);
        realtime().emitToUser(link.id_sender, "fi:links", { type: "accepted", by: publicCard(me) });
      } else if (action === "cancel") {
        realtime().emitToUser(link.id_receiver, "fi:links", { type: "canceled" });
      }
      const status = isSender && updated.status === "silenced" ? "active" : updated.status;
      return { link: { id_link: updated.id_link, status } };
    });
  }

  static async getPrefs(user) {
    if (!user?.id_user) return notAuth();
    const p = await FeedInterativoStorage.getPrefs(pool, user.id_user);
    return { invite_policy: p.invite_policy, accept_gifts: p.accept_gifts };
  }

  static async setPrefs(user, body = {}) {
    if (!user?.id_user) return notAuth();
    const invite_policy = body.invite_policy;
    if (invite_policy != null && !["todos", "mutuos", "ninguem"].includes(invite_policy)) {
      return { error: "invite_policy inválido" };
    }
    if (body.accept_gifts != null && typeof body.accept_gifts !== "boolean") {
      return { error: "accept_gifts inválido" };
    }
    const p = await FeedInterativoStorage.setPrefs(pool, user.id_user, {
      invite_policy: invite_policy ?? null,
      accept_gifts: body.accept_gifts,
    });
    return { invite_policy: p.invite_policy, accept_gifts: p.accept_gifts };
  }

  // ── lançar ───────────────────────────────────────────────────────────────
  static async targets(user) {
    if (!user?.id_user) return notAuth();
    const rows = await FeedInterativoStorage.throwTargets(pool, user.id_user);
    return { targets: rows.map(publicCard) };
  }

  /** Lança um post: `to` = 'all' ou o id_user de um alvo. Resposta não revela silêncio. */
  static async throwPost(user, body = {}) {
    return runWithLogs(log, "throwPost", () => ({ id_user: user?.id_user, post_id: body?.post_id, to: body?.to === "all" ? "all" : "one" }), async () => {
      if (!user?.id_user) return notAuth();
      const post_id = String(body.post_id || "");
      if (!UUID_RE.test(post_id)) return { error: "post_id inválido" };
      const to = body.to === "all" ? "all" : String(body.to || "");
      if (to !== "all" && !UUID_RE.test(to)) return { error: "Destino inválido" };
      if (await isMinorUser(user.id_user)) {
        return { error: "Lançar no feed não está disponível para contas de menores", statusCode: 403 };
      }

      const eligible = await PortfolioFeedStorage.listEligibleByIds(pool, { ids: [post_id] });
      if (eligible.length === 0) return { error: "Esse post não pode ser lançado", statusCode: 403 };

      let targets = await FeedInterativoStorage.throwTargets(pool, user.id_user);
      if (to !== "all") targets = targets.filter((x) => x.id_user === to);
      if (targets.length === 0) {
        return { error: to === "all" ? "Ninguém aceitou receber seus lançamentos ainda" : "Essa pessoa não está na sua lista", statusCode: 403 };
      }
      if ((await FeedInterativoStorage.countRecentDrops(pool, { id_sender: user.id_user, kind: "throw", interval: "1 hour" })) >= LIMITS.throwsPerHour) {
        return { error: "Calma! Você lançou muita coisa na última hora.", statusCode: 429 };
      }

      const already = await FeedInterativoStorage.recentPostReceivers(pool, user.id_user, post_id, targets.map((x) => x.id_user));
      const id_batch = require("node:crypto").randomUUID();
      let sent = 0;
      const deliveries = [];
      for (const tg of targets) {
        if (already.has(tg.id_user)) {
          sent++; // já está no feed da pessoa: conta como entregue
          continue;
        }
        const pair = await FeedInterativoStorage.countRecentDrops(pool, {
          id_sender: user.id_user,
          kind: "throw",
          interval: "1 hour",
          id_receiver: tg.id_user,
        });
        if (pair >= LIMITS.throwsPerPairPerHour) continue;
        const status = tg.link_status === "silenced" ? "muted" : "delivered";
        const drop = await FeedInterativoStorage.insertDrop(pool, {
          kind: "throw",
          id_sender: user.id_user,
          id_receiver: tg.id_user,
          id_portfolio_item: post_id,
          status,
          id_batch,
        });
        sent++;
        if (status === "delivered") deliveries.push({ id_receiver: tg.id_user, id_drop: drop.id_drop });
      }
      if (sent === 0) return { error: "Calma! Você já lançou muito para essa pessoa agora.", statusCode: 429 };
      for (const d of deliveries) {
        realtime().emitToUser(d.id_receiver, "fi:drop", { id_drop: d.id_drop, kind: "throw" });
      }
      return { sent };
    });
  }

  // ── receber ──────────────────────────────────────────────────────────────
  /**
   * O que ainda não entrou no meu feed, já no shape do card. Post que deixou
   * de passar na régua (ficou privado, foi banido) vira 'failed' e não volta.
   */
  static async inbox(user) {
    if (!user?.id_user) return notAuth();
    const minorBlock = await assertMinorPermission(user.id_user, "can_view_feed");
    if (minorBlock) return minorBlock;
    const rows = await FeedInterativoStorage.inbox(pool, user.id_user, 20);
    const postIds = rows.filter((r) => r.id_portfolio_item).map((r) => r.id_portfolio_item);
    const posts = postIds.length
      ? await PortfolioFeedStorage.listEligibleByIds(pool, { ids: postIds, viewer_id_user: user.id_user })
      : [];
    const byId = new Map(posts.map((p) => [p.post_id, shapeRow(p)]));
    const failed = [];
    const items = [];
    for (const r of rows) {
      let post = null;
      if (r.id_portfolio_item) {
        post = byId.get(r.id_portfolio_item) || null;
        if (!post && r.kind === "throw") {
          failed.push(r.id_drop);
          continue;
        }
      }
      items.push({
        id_drop: r.id_drop,
        kind: r.kind,
        created_at: r.delivered_at || r.created_at,
        sender: publicCard(r),
        post,
        payload: FeedInterativoService.publicPayload(r.kind, r.payload),
      });
    }
    if (failed.length) await FeedInterativoStorage.markStatus(pool, user.id_user, failed, ["delivered"], "failed");
    return { items };
  }

  /** Só o que o receiver pode ver do payload (o baú fechado não revela o prêmio). */
  static publicPayload(kind, payload) {
    const p = payload && typeof payload === "object" ? payload : {};
    if (kind === "gift") return { chest: p.chest || "madeira", opened: false };
    if (kind === "capsule") return { message: p.message || null, scheduled_for: p.scheduled_for || null, written_at: p.written_at || null };
    return {};
  }

  // ── baú (F3) ─────────────────────────────────────────────────────────────
  /**
   * Manda um baú. `to` = id_user de um alvo ou 'sorte' (sorteia entre quem
   * aceitou receber meus lançamentos E aceita presentes). O conteúdo é de
   * quem manda: { chest, sticker, reaction, message }.
   */
  static async sendGift(user, body = {}) {
    return runWithLogs(log, "sendGift", () => ({ id_user: user?.id_user, to: body?.to === "sorte" ? "sorte" : "one" }), async () => {
      if (!user?.id_user) return notAuth();
      if (await isMinorUser(user.id_user)) {
        return { error: "Lançar no feed não está disponível para contas de menores", statusCode: 403 };
      }
      const chest = CHESTS.includes(body.chest) ? body.chest : "madeira";
      const sticker = Object.prototype.hasOwnProperty.call(STICKERS, body.sticker) ? body.sticker : null;
      const reaction = REACTIONS.includes(body.reaction) ? body.reaction : null;
      const message = cleanMessage(body.message);
      if (body.sticker != null && !sticker) return { error: "Figurinha inválida" };
      if (body.reaction != null && !reaction) return { error: "Reação inválida" };
      if (!sticker && !reaction && !message) return { error: "Coloque alguma coisa dentro do baú" };

      const to = body.to === "sorte" ? "sorte" : String(body.to || "");
      if (to !== "sorte" && !UUID_RE.test(to)) return { error: "Destino inválido" };

      let targets = await FeedInterativoStorage.throwTargets(pool, user.id_user);
      const accepting = await FeedInterativoStorage.acceptsGifts(pool, targets.map((x) => x.id_user));
      if (to !== "sorte") {
        targets = targets.filter((x) => x.id_user === to);
        if (targets.length === 0) return { error: "Essa pessoa não está na sua lista", statusCode: 403 };
        if (!accepting.has(to)) return { error: "Essa pessoa não está recebendo presentes", statusCode: 403 };
      } else {
        targets = targets.filter((x) => accepting.has(x.id_user));
        if (targets.length === 0) return { error: "Ninguém da sua lista está recebendo presentes", statusCode: 403 };
      }

      if ((await FeedInterativoStorage.countRecentDrops(pool, { id_sender: user.id_user, kind: "gift", interval: "1 day" })) >= LIMITS.giftsPerDay) {
        return { error: "Você já mandou muitos baús hoje", statusCode: 429 };
      }
      // Na sorte: só entre quem ainda cabe no limite por par.
      const open = [];
      for (const tg of targets) {
        const n = await FeedInterativoStorage.countRecentDrops(pool, {
          id_sender: user.id_user,
          kind: "gift",
          interval: "1 day",
          id_receiver: tg.id_user,
        });
        if (n < LIMITS.giftsPerPairPerDay) open.push(tg);
      }
      if (open.length === 0) return { error: "Essa pessoa já recebeu baús seus hoje", statusCode: 429 };
      const pick = to === "sorte" ? open[require("node:crypto").randomInt(open.length)] : open[0];

      const status = pick.link_status === "silenced" ? "muted" : "delivered";
      const drop = await FeedInterativoStorage.insertDrop(pool, {
        kind: "gift",
        id_sender: user.id_user,
        id_receiver: pick.id_user,
        payload: { chest, sticker, reaction, message, lucky: to === "sorte" },
        status,
      });
      if (status === "delivered") realtime().emitToUser(pick.id_user, "fi:drop", { id_drop: drop.id_drop, kind: "gift" });
      // Na sorte, quem mandou fica sabendo quem a sorte escolheu.
      return { sent: 1, to: to === "sorte" ? publicCard(pick) : null };
    });
  }

  /** Abre o baú (uma vez). Devolve o conteúdo e soma a figurinha na coleção. */
  static async openGift(user, id_drop) {
    return runWithLogs(log, "openGift", () => ({ id_user: user?.id_user, id_drop }), async () => {
      if (!user?.id_user) return notAuth();
      if (!UUID_RE.test(String(id_drop || ""))) return { error: "id_drop inválido" };
      const client = await pool.connect();
      let opened;
      try {
        await client.query("BEGIN");
        opened = await FeedInterativoStorage.openGift(client, id_drop, user.id_user);
        if (!opened) {
          await client.query("ROLLBACK");
          const d = await FeedInterativoStorage.getDropForReceiver(pool, id_drop, user.id_user);
          if (!d || d.kind !== "gift") return { error: "Baú não encontrado", statusCode: 404 };
          if (d.status === "opened") return { error: "Esse baú já foi aberto", statusCode: 409 };
          return { error: "Esse baú não pode ser aberto", statusCode: 409 };
        }
        const p = opened.payload || {};
        if (p.sticker && Object.prototype.hasOwnProperty.call(STICKERS, p.sticker)) {
          await FeedInterativoStorage.addSticker(client, user.id_user, p.sticker, opened.id_sender);
        }
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const p = opened.payload || {};
      const me = await FeedInterativoStorage.userCard(pool, user.id_user);
      realtime().emitToUser(opened.id_sender, "fi:notice", { type: "gift-opened", by: publicCard(me), sticker: p.sticker || null });
      return {
        gift: {
          chest: p.chest || "madeira",
          sticker: p.sticker || null,
          rarity: p.sticker ? STICKERS[p.sticker] : null,
          reaction: p.reaction || null,
          message: p.message || null,
          lucky: !!p.lucky,
        },
      };
    });
  }

  static async stickers(user) {
    if (!user?.id_user) return notAuth();
    const rows = await FeedInterativoStorage.listStickers(pool, user.id_user);
    return { stickers: rows, catalog: STICKERS };
  }

  static async markSeen(user, body = {}) {
    if (!user?.id_user) return notAuth();
    const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).filter((x) => UUID_RE.test(x)).slice(0, 50);
    // O baú continua 'delivered' até abrir (só sai da fila ao abrir).
    const n = await FeedInterativoStorage.markStatus(pool, user.id_user, ids, ["delivered"], "seen", { exceptKind: "gift" });
    return { ok: true, updated: n };
  }
}

module.exports = FeedInterativoService;
