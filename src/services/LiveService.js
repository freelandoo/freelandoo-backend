// src/services/LiveService.js
// Sessões de live (WebRTC via LiveKit). Lives efêmeras, sem gravação.
// Gate de transmissão: perfil próprio e PAGO (assinatura ativa). 1 live ativa
// por perfil (índice parcial único em tb_live). Token + ws_url voltam juntos.
const crypto = require("crypto");
const pool = require("../databases");
const LiveStorage = require("../storages/LiveStorage");
const PolenStorage = require("../storages/PolenStorage");
const NotificationService = require("./NotificationService");
const livekit = require("../utils/livekit");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("LiveService");

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Fração dos Poléns do presente repassada ao criador da live (1 = 100%).
// Ajuste aqui se a plataforma passar a reter uma comissão.
const LIVE_GIFT_CREATOR_SHARE = 1;

function normalizeTitle(value) {
  if (typeof value !== "string") return null;
  const t = value.trim();
  if (!t) return null;
  return t.slice(0, 120);
}

function mapLive(row, { self_user_id } = {}) {
  if (!row) return null;
  return {
    id_live: row.id_live,
    id_profile: row.id_profile,
    id_user: row.id_user,
    room_name: row.room_name,
    title: row.title,
    status: row.status,
    peak_viewers: row.peak_viewers,
    started_at: row.started_at,
    ended_at: row.ended_at,
    is_owner: self_user_id ? row.id_user === self_user_id : undefined,
    profile: {
      id_profile: row.id_profile,
      display_name: row.profile_display_name,
      avatar_url: row.profile_avatar_url,
      is_clan: row.profile_is_clan,
      username: row.owner_username,
    },
    machine: row.machine_slug
      ? {
          name: row.machine_name,
          slug: row.machine_slug,
          color_from: row.machine_color_from,
          color_to: row.machine_color_to,
          color_ring: row.machine_color_ring,
          color_accent: row.machine_color_accent,
        }
      : null,
  };
}

class LiveService {
  // Abre (ou reaproveita) a live ativa de um perfil. Retorna token de transmissor.
  static async startLive(user, body = {}) {
    return runWithLogs(
      log,
      "startLive",
      () => ({ id_user: user?.id_user, id_profile: body?.id_profile }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_profile = body?.id_profile;
        if (!id_profile || !UUID_RE.test(id_profile)) {
          return { error: "id_profile inválido" };
        }

        const profile = await LiveStorage.getOwnedProfileForLive(pool, {
          id_profile,
          id_user: user.id_user,
        });
        if (!profile) return { error: "Sem permissão para transmitir por este perfil" };
        if (!profile.is_active) return { error: "Perfil inativo não pode transmitir" };
        if (!profile.is_paid) {
          return { error: "Só perfis com assinatura ativa podem transmitir ao vivo" };
        }

        const title = normalizeTitle(body?.title);

        // 1 live ativa por perfil: se já existe, reaproveita (reemite token).
        let live = await LiveStorage.getActiveByProfile(pool, id_profile);
        if (!live) {
          const room_name = `live_${id_profile}_${crypto.randomBytes(4).toString("hex")}`;
          try {
            live = await LiveStorage.createLive(pool, {
              id_profile,
              id_user: user.id_user,
              room_name,
              title,
            });
          } catch (err) {
            // Corrida com o índice único parcial → recupera a live existente.
            if (err?.code === "23505") {
              live = await LiveStorage.getActiveByProfile(pool, id_profile);
            } else {
              throw err;
            }
          }
        }
        if (!live) return { error: "Não foi possível abrir a live" };

        const token = await livekit.broadcasterToken(
          live.room_name,
          `u_${user.id_user}`,
          profile.display_name || "Transmissor"
        );

        return {
          live: mapLive(live, { self_user_id: user.id_user }),
          token,
          ws_url: livekit.getWsUrl(),
        };
      }
    );
  }

  static async endLive(user, params = {}) {
    return runWithLogs(
      log,
      "endLive",
      () => ({ id_user: user?.id_user, id_live: params?.id_live }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_live = params?.id_live;
        if (!id_live || !UUID_RE.test(id_live)) {
          return { error: "id_live inválido" };
        }

        const existing = await LiveStorage.getById(pool, id_live);
        if (!existing) return { error: "Live não encontrada" };
        if (existing.id_user !== user.id_user) {
          return { error: "Sem permissão para encerrar esta live" };
        }

        const ended = await LiveStorage.endLive(pool, {
          id_live,
          id_user: user.id_user,
        });
        // Derruba a sala no LiveKit (best-effort).
        if (existing.room_name) await livekit.deleteRoom(existing.room_name);

        return { ended: ended || existing.status === "ended", id_live };
      }
    );
  }

  static async listActive(user) {
    return runWithLogs(
      log,
      "listActive",
      () => ({ id_user: user?.id_user }),
      async () => {
        const rows = await LiveStorage.listActive(pool);
        return {
          items: rows.map((r) => mapLive(r, { self_user_id: user?.id_user })),
        };
      }
    );
  }

  // Catálogo de presentes ativos (loja do admin, mig 132).
  static async listGifts() {
    return runWithLogs(log, "listGifts", () => ({}), async () => {
      const gifts = await LiveStorage.listGifts(pool, { onlyActive: true });
      return { gifts };
    });
  }

  // Envia um presente: cobra Poléns do remetente e registra o evento. O cliente
  // anima na tela de todos via data channel do LiveKit (não passa pelo backend).
  static async sendGift(user, params = {}, body = {}) {
    return runWithLogs(
      log,
      "sendGift",
      () => ({ id_user: user?.id_user, id_live: params?.id_live, id_live_gift: body?.id_live_gift }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_live = params?.id_live;
        const id_live_gift = body?.id_live_gift;
        if (!id_live || !UUID_RE.test(id_live)) return { error: "id_live inválido" };
        if (!id_live_gift || !UUID_RE.test(id_live_gift)) return { error: "id_live_gift inválido" };

        const live = await LiveStorage.getById(pool, id_live);
        if (!live) return { error: "Live não encontrada" };
        if (live.status !== "live") return { error: "Esta live já encerrou" };

        const gift = await LiveStorage.getGiftById(pool, id_live_gift);
        if (!gift || gift.is_active === false) return { error: "Presente indisponível" };

        const message = typeof body?.message === "string" ? body.message.trim().slice(0, 120) : null;
        const amount = Number(gift.price_polens) || 0;

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const settings = await PolenStorage.getSettings(client);
          if (!settings?.is_active) {
            await client.query("ROLLBACK");
            return { error: "Sistema de Poléns inativo" };
          }
          const wallet = await PolenStorage.getOrCreateWallet(client, user.id_user);
          let debit = { wallet };
          const txId = crypto.randomUUID();
          if (amount > 0) {
            const result = await PolenStorage.debit(client, {
              user_id: user.id_user,
              wallet_id: wallet.id,
              amount,
              type: "spend_live_gift",
              source: "live_gift",
              source_id: txId,
              metadata: { id_live, id_live_gift, gift_name: gift.name },
            });
            if (!result) {
              await client.query("ROLLBACK");
              return { error: "Saldo de Poléns insuficiente" };
            }
            debit = result;
          }

          // Repasse ao criador: credita o dono da live com os Poléns do presente.
          // (Se o próprio dono enviar, debita e credita a mesma carteira = neutro.)
          const creatorShare = Math.round(amount * LIVE_GIFT_CREATOR_SHARE);
          if (creatorShare > 0) {
            const creatorWallet = await PolenStorage.getOrCreateWallet(client, live.id_user);
            await PolenStorage.credit(client, {
              user_id: live.id_user,
              wallet_id: creatorWallet.id,
              amount: creatorShare,
              type: "earn_live_gift",
              source: "live_gift_payout",
              source_id: `${txId}:payout`,
              metadata: { id_live, id_live_gift, gift_name: gift.name, from_user: user.id_user },
            });
          }

          const event = await LiveStorage.insertGiftEvent(client, {
            id_live,
            id_live_gift,
            id_sender_user: user.id_user,
            polens_spent: amount,
            message,
          });
          await client.query("COMMIT");

          // Notifica o dono da live que recebeu um presente (fire-and-forget, WS).
          // safeNotify pula se o próprio dono enviar (sender == host).
          NotificationService.notifyLiveGift({
            host_user_id: live.id_user,
            sender_user_id: user.id_user,
            id_live,
            gift_name: gift.name,
            polens: amount,
          }).catch(() => {});

          return {
            event: { id: event.id, created_at: event.created_at },
            polens_spent: amount,
            creator_credited: creatorShare,
            wallet: debit.wallet,
            gift: {
              id_live_gift: gift.id_live_gift,
              name: gift.name,
              emoji: gift.emoji,
              color: gift.color,
              animation: gift.animation,
            },
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  // O transmissor reporta a contagem atual de espectadores → atualiza o pico.
  static async reportViewers(user, params = {}, body = {}) {
    return runWithLogs(
      log,
      "reportViewers",
      () => ({ id_user: user?.id_user, id_live: params?.id_live }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_live = params?.id_live;
        if (!id_live || !UUID_RE.test(id_live)) return { error: "id_live inválido" };
        const count = Math.max(0, Math.min(Number(body?.count) || 0, 1_000_000));

        const live = await LiveStorage.getById(pool, id_live);
        if (!live) return { error: "Live não encontrada" };
        if (live.id_user !== user.id_user) {
          return { error: "Sem permissão para atualizar esta live" };
        }
        const peak = await LiveStorage.bumpPeakViewers(pool, { id_live, count });
        return { peak_viewers: peak ?? live.peak_viewers, count };
      }
    );
  }

  // Entrar como espectador: live precisa estar ativa. Retorna token de viewer.
  static async joinLive(user, params = {}) {
    return runWithLogs(
      log,
      "joinLive",
      () => ({ id_user: user?.id_user, id_live: params?.id_live }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const id_live = params?.id_live;
        if (!id_live || !UUID_RE.test(id_live)) {
          return { error: "id_live inválido" };
        }

        const live = await LiveStorage.getById(pool, id_live);
        if (!live) return { error: "Live não encontrada" };
        if (live.status !== "live") return { error: "Esta live já encerrou" };

        // O próprio dono pode entrar como transmissor (reabrir a tela de live).
        const isOwner = live.id_user === user.id_user;
        const token = isOwner
          ? await livekit.broadcasterToken(live.room_name, `u_${user.id_user}`, "Transmissor")
          : await livekit.viewerToken(live.room_name, `u_${user.id_user}`, "Espectador");

        return {
          live: mapLive(live, { self_user_id: user.id_user }),
          token,
          ws_url: livekit.getWsUrl(),
          role: isOwner ? "broadcaster" : "viewer",
        };
      }
    );
  }
}

module.exports = LiveService;
