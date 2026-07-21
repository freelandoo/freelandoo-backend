const pool = require("../databases");
const BookingStorage = require("../storages/BookingStorage");
const BookingAvailabilityStorage = require("../storages/BookingAvailabilityStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const ProfileSubscriptionStorage = require("../storages/ProfileSubscriptionStorage");
const ProfileServiceStorage = require("../storages/ProfileServiceStorage");
const ClanPayoutStorage = require("../storages/ClanPayoutStorage");
const StripeService = require("./StripeService");
const StoreGovernanceService = require("./StoreGovernanceService");
const NotificationService = require("./NotificationService");
const { createLogger } = require("../utils/logger");

const log = createLogger("BookingService");

const PLATFORM_FEE_CENTS = 1000; // R$ 10,00

class BookingService {
  /**
   * Cliente logado: cria booking + Stripe checkout session para pagamento do sinal.
   * Nome e e-mail vêm da conta autenticada; WhatsApp opcional vem do body.
   */
  static async createPublicBooking(user, id_profile, body) {
    if (!user?.id_user) return { error: "Login obrigatório para agendar" };

    const { client_whatsapp, booking_date, start_time, id_profile_service, coupon_code } = body || {};

    // Nome e email vêm sempre da conta autenticada (req.user só tem id+email no token,
    // então buscamos o nome no banco).
    const buyerRes = await pool.query(
      `SELECT nome, email FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
      [user.id_user]
    );
    const buyer = buyerRes.rows[0];
    if (!buyer) return { error: "Conta não encontrada" };
    const client_name = String(buyer.nome || "").trim();
    const client_email = String(buyer.email || user.email || "").trim();
    if (!client_name || !client_email) {
      return { error: "Conta sem nome/e-mail. Atualize seu perfil antes de agendar." };
    }
    if (!booking_date || !start_time) {
      return { error: "Campos obrigatórios: booking_date, start_time" };
    }

    // Validar perfil
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile || profile.deleted_at) return { error: "Perfil não encontrado" };
    // Perfil-conta é agendável mesmo com is_visible=FALSE (paridade user≡subperfil)
    if (!profile.is_visible && !profile.is_user_account) return { error: "Perfil indisponível" };
    if (String(profile.id_user) === String(user.id_user)) {
      return { error: "Você não pode agendar com seu próprio perfil" };
    }

    // Verificar assinatura ativa
    const sub = await ProfileSubscriptionStorage.findActiveByProfile(pool, id_profile);
    if (!sub) return { error: "Perfil não disponível para agendamento" };

    // Validar data não no passado
    const targetDate = new Date(booking_date + "T23:59:59Z");
    if (targetDate < new Date()) {
      return { error: "Não é possível agendar em data passada" };
    }

    // Resolver serviço: hoje todo booking público exige um serviço cadastrado.
    if (id_profile_service == null) {
      return { error: "Selecione um serviço para agendar" };
    }
    const service = await ProfileServiceStorage.getById(pool, Number(id_profile_service));
    if (!service || String(service.id_profile) !== String(id_profile) || !service.is_active) {
      return { error: "Serviço não encontrado ou inativo" };
    }

    // Valor base do serviço — define o que o profissional recebe (price − R$10).
    const service_price = service.price_amount;
    if (service_price < PLATFORM_FEE_CENTS) {
      return { error: "Valor do serviço inferior à taxa mínima da plataforma" };
    }
    const professional_amount = service_price - PLATFORM_FEE_CENTS;

    // Opt-in de afiliado por serviço (mig 090): comissão ADITIVA embutida no sinal,
    // base = preço cheio do serviço, sem reduzir o que o profissional recebe. Sem
    // gross-up de maquininha (booking não grossa-up). Vai pro afiliado se a venda
    // veio por ?cupom=, senão a plataforma fica.
    const affiliatesAllowed = service.affiliates_allowed === true;
    const affiliate_pct = affiliatesAllowed
      ? await StoreGovernanceService.getAffiliateCommissionPercent()
      : 0;
    const affiliate_commission_cents = affiliate_pct > 0
      ? Math.round((service_price * affiliate_pct) / 100)
      : 0;
    // Comprador paga: preço do serviço + comissão embutida.
    const charge_amount = service_price + affiliate_commission_cents;

    // Agenda da conta (mig 190): as regras moram no perfil-conta e o conflito
    // é checado contra TODOS os perfis do dono. O booking em si continua
    // guardando o id_profile de ORIGEM (é assim que a tela sabe dizer por qual
    // perfil o cliente agendou).
    const agendaScope = await BookingAvailabilityStorage.resolveAgendaScope(pool, id_profile);

    // Calcular end_time com base na duração do serviço, ou da regra semanal, ou default 60
    const [sh, sm] = start_time.split(":").map(Number);
    let duration = service?.duration_minutes;
    if (!duration) {
      const weekday = new Date(booking_date + "T12:00:00Z").getUTCDay();
      const { rows } = await pool.query(
        `SELECT slot_duration_minutes FROM public.tb_profile_availability_rules
         WHERE id_profile = $1 AND weekday = $2 LIMIT 1`,
        [agendaScope.agendaProfileId, weekday]
      );
      duration = rows[0]?.slot_duration_minutes || 60;
    }
    const endMin = sh * 60 + sm + duration;
    const end_time = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    // Lock: verificar slot livre dentro de uma transação
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const slotFree = await BookingStorage.lockAndCheckSlot(client, agendaScope.profileIds, booking_date, start_time, end_time);
      if (!slotFree) {
        await client.query("ROLLBACK");
        return { error: "Horário indisponível: a duração do serviço sobrepõe outro agendamento." };
      }

      // Criar checkout session no Stripe
      const frontendUrl = process.env.FRONTEND_URL || "https://freelandoo.com";
      const productName = service
        ? `${service.name} — ${profile.display_name}`
        : `Sinal de agendamento — ${profile.display_name}`;
      const formatBRL = (cents) => `R$ ${(cents / 100).toFixed(2).replace(".", ",")}`;
      const [yyyy, mm, dd] = booking_date.split("-");
      const dateLabel = `${dd}/${mm}/${yyyy}`;
      const description = service
        ? `Reserva: ${dateLabel} às ${start_time} (${service.duration_minutes} min). Sinal de ${formatBRL(charge_amount)} para confirmar o horário com ${profile.display_name}.`
        : `Reserva: ${dateLabel} às ${start_time}. Sinal de ${formatBRL(charge_amount)} para confirmar o horário com ${profile.display_name}.`;
      const session = await StripeService.client().checkout.sessions.create({
        mode: "payment",
        line_items: [{
          price_data: {
            currency: "brl",
            product_data: {
              name: productName,
              description,
            },
            unit_amount: charge_amount,
          },
          quantity: 1,
        }],
        customer_email: client_email,
        success_url: `${frontendUrl}/agendamento/sucesso?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${frontendUrl}/freelancer/${id_profile}?booking=canceled`,
        custom_text: {
          submit: {
            message: `Este pagamento é o sinal que confirma a sua reserva de ${dateLabel} às ${start_time}. Após a aprovação, o horário fica bloqueado pela duração do serviço. Taxa Freelandoo: ${formatBRL(PLATFORM_FEE_CENTS)}.`,
          },
        },
        metadata: {
          type: "booking_deposit",
          profile_id: id_profile,
          booking_date,
          start_time,
          client_name,
          client_email,
          user_id: String(user.id_user),
          // Comissão de afiliado SÓ quando o serviço tem opt-in (gate real).
          ...(affiliatesAllowed && coupon_code && affiliate_commission_cents > 0
            ? {
                coupon_code: String(coupon_code).trim().toUpperCase().slice(0, 40),
                affiliate_commission_cents: String(affiliate_commission_cents),
              }
            : {}),
          charge_amount: String(charge_amount),
          platform_fee: String(PLATFORM_FEE_CENTS),
          professional_amount: String(professional_amount),
          ...(service ? {
            id_profile_service: String(service.id_profile_service),
            service_name: service.name,
            service_price_amount: String(service.price_amount),
          } : {}),
        },
      });

      // Criar booking
      const booking = await BookingStorage.create(client, {
        id_profile,
        profile_owner_user_id: profile.id_user,
        id_client_user: user.id_user,
        client_name,
        client_email,
        client_whatsapp: client_whatsapp || null,
        booking_date,
        start_time,
        end_time,
        deposit_amount: charge_amount,
        platform_fee_amount: PLATFORM_FEE_CENTS,
        professional_amount,
        stripe_checkout_session_id: session.id,
        id_profile_service: service ? service.id_profile_service : null,
        service_name_snapshot: service ? service.name : null,
        service_price_amount: service ? service.price_amount : null,
      });

      await client.query("COMMIT");

      log.info("booking.created", {
        bookingId: booking.id,
        profileId: id_profile,
        date: booking_date,
        time: start_time,
        sessionId: session.id,
      });

      return {
        booking,
        checkout_url: session.url,
      };
    } catch (err) {
      await client.query("ROLLBACK");
      log.error("booking.create.fail", { error: err.message });
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Owner: listar agendamentos dos seus perfis.
   */
  static async listOwnerBookings(user) {
    const bookings = await BookingStorage.listByOwner(pool, user.id_user);
    return { bookings };
  }

  /**
   * Owner: listar agendamentos de um perfil específico.
   */
  static async listProfileBookings(user, params) {
    const { id_profile } = params;
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile) return { error: "Perfil não encontrado" };
    if (String(profile.id_user) !== String(user.id_user)) return { error: "Sem permissão" };

    const bookings = await BookingStorage.listByProfile(pool, id_profile);
    return { bookings };
  }

  /**
   * Owner: atualizar status operacional de um booking.
   */
  static async updateBookingStatus(user, params, body) {
    const { bookingId } = params;
    const { status } = body;

    const allowed = ["completed", "no_show", "canceled"];
    if (!allowed.includes(status)) {
      return { error: `Status inválido. Permitidos: ${allowed.join(", ")}` };
    }

    const booking = await BookingStorage.findById(pool, bookingId);
    if (!booking) return { error: "Agendamento não encontrado" };
    if (String(booking.profile_owner_user_id) !== String(user.id_user)) {
      return { error: "Sem permissão" };
    }

    const updated = await BookingStorage.updateStatus(pool, bookingId, status);
    return { booking: updated };
  }

  /**
   * Webhook: confirma booking após pagamento do sinal.
   */
  static async confirmBookingFromWebhook(sessionId, paymentIntentId) {
    const booking = await BookingStorage.confirmBySessionId(pool, sessionId, paymentIntentId);
    if (!booking) {
      log.warn("webhook.booking.not_found", { sessionId });
      return null;
    }
    log.info("booking.confirmed", { bookingId: booking.id, sessionId });
    // Notifica o profissional (fire-and-forget). confirmBySessionId só transita
    // bookings 'pending_payment' → na retry do webhook retorna null e não chega aqui.
    NotificationService.notifyBookingReceived({
      owner_user_id: booking.profile_owner_user_id,
      id_profile: booking.id_profile,
      id_booking: booking.id,
      client_user_id: booking.id_client_user,
      amount_cents: Number(booking.professional_amount) || null,
    }).catch(() => {});
    try {
      await BookingService.recordClanSplitForBooking(booking);
    } catch (err) {
      log.error("booking.clan_split.fail", { bookingId: booking.id, error: err.message });
    }
    try {
      const BookingPayoutService = require("./BookingPayoutService");
      await BookingPayoutService.createFromBooking(booking);
    } catch (err) {
      log.error("booking.payout_create.fail", { bookingId: booking.id, error: err.message });
    }
    return booking;
  }

  /**
   * Se o booking pertence a um perfil-clan, divide o líquido (professional_amount)
   * IGUAL entre os perfis anexados ao serviço e credita o SALDO de cada um
   * (tb_clan_payout, holdback 8 dias). A sobra dos centavos (floor) vai pro 1º.
   * Idempotente: se já houver split pra esse booking, faz no-op.
   */
  static async recordClanSplitForBooking(booking) {
    if (!booking) return null;
    const profile = await ProfileStorage.getProfileById(pool, booking.id_profile);
    if (!profile || !profile.is_clan) return null;

    if (await ClanPayoutStorage.existsForSource(pool, "clan_service", booking.id)) {
      return null;
    }

    let memberIds = [];
    if (booking.id_profile_service != null) {
      memberIds = await ProfileServiceStorage.getMemberIds(pool, booking.id_profile_service);
    }
    // Serviço de clan exige >=1 anexado na publicação; sem anexados, no-op seguro.
    if (memberIds.length === 0) return null;

    const gross = Number(booking.professional_amount) || 0;
    if (gross <= 0) return null;

    const owners = await ProfileStorage.getOwnerUserMap(pool, memberIds);
    const N = memberIds.length;
    const per = Math.floor(gross / N);
    const remainder = gross - per * N;
    const rows = memberIds
      .filter((id) => owners[id])
      .map((id_member_profile, idx) => ({
        id_member_profile,
        id_owner_user: owners[id_member_profile],
        amount_cents: per + (idx === 0 ? remainder : 0),
      }));
    if (rows.length === 0) return null;

    const created = await ClanPayoutStorage.createSplits(pool, {
      id_clan_profile: booking.id_profile,
      source_type: "clan_service",
      source_id: String(booking.id),
      gross_cents: gross,
      rows,
    });
    log.info("booking.clan_split.created", {
      bookingId: booking.id,
      members: created.length,
      per,
    });
    return created;
  }
}

module.exports = BookingService;
