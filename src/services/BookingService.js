const pool = require("../databases");
const BookingStorage = require("../storages/BookingStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const ProfileSubscriptionStorage = require("../storages/ProfileSubscriptionStorage");
const ProfileServiceStorage = require("../storages/ProfileServiceStorage");
const ClanStorage = require("../storages/ClanStorage");
const ClanEarningSplitStorage = require("../storages/ClanEarningSplitStorage");
const StripeService = require("./StripeService");
const { createLogger } = require("../utils/logger");

const log = createLogger("BookingService");

const PLATFORM_FEE_CENTS = 1000; // R$ 10,00

class BookingService {
  /**
   * Público: cria booking + Stripe checkout session para pagamento do sinal.
   */
  static async createPublicBooking(id_profile, body) {
    const { client_name, client_email, client_whatsapp, booking_date, start_time, id_profile_service } = body;

    if (!client_name || !client_email || !booking_date || !start_time) {
      return { error: "Campos obrigatórios: client_name, client_email, booking_date, start_time" };
    }

    // Validar perfil
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile || profile.deleted_at) return { error: "Perfil não encontrado" };
    if (!profile.is_visible) return { error: "Perfil indisponível" };

    // Verificar assinatura ativa
    const sub = await ProfileSubscriptionStorage.findActiveByProfile(pool, id_profile);
    if (!sub) return { error: "Perfil não disponível para agendamento" };

    // Validar data não no passado
    const targetDate = new Date(booking_date + "T23:59:59Z");
    if (targetDate < new Date()) {
      return { error: "Não é possível agendar em data passada" };
    }

    // Resolver serviço (se enviado): usa price_amount + duration_minutes do serviço
    let service = null;
    if (id_profile_service != null) {
      service = await ProfileServiceStorage.getById(pool, Number(id_profile_service));
      if (!service || String(service.id_profile) !== String(id_profile) || !service.is_active) {
        return { error: "Serviço não encontrado ou inativo" };
      }
    }

    // Valor cobrado: prioriza preço do serviço; fallback ao deposit_amount legacy
    const charge_amount = service ? service.price_amount : settings.deposit_amount;
    if (charge_amount < PLATFORM_FEE_CENTS) {
      return { error: "Valor do serviço inferior à taxa mínima da plataforma" };
    }
    const professional_amount = charge_amount - PLATFORM_FEE_CENTS;

    // Calcular end_time com base na duração do serviço, ou da regra semanal, ou default 60
    const [sh, sm] = start_time.split(":").map(Number);
    let duration = service?.duration_minutes;
    if (!duration) {
      const weekday = new Date(booking_date + "T12:00:00Z").getUTCDay();
      const { rows } = await pool.query(
        `SELECT slot_duration_minutes FROM public.tb_profile_availability_rules
         WHERE id_profile = $1 AND weekday = $2 LIMIT 1`,
        [id_profile, weekday]
      );
      duration = rows[0]?.slot_duration_minutes || 60;
    }
    const endMin = sh * 60 + sm + duration;
    const end_time = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;

    // Lock: verificar slot livre dentro de uma transação
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const slotFree = await BookingStorage.lockAndCheckSlot(client, id_profile, booking_date, start_time, end_time);
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
    try {
      await BookingService.recordClanSplitForBooking(booking);
    } catch (err) {
      log.error("booking.clan_split.fail", { bookingId: booking.id, error: err.message });
    }
    return booking;
  }

  /**
   * Se o booking pertence a um perfil-clan, registra splits em
   * tb_clan_earning_split (1 row por membro participante).
   * Idempotente: se já houver split pra esse booking, faz no-op.
   */
  static async recordClanSplitForBooking(booking) {
    if (!booking) return null;
    const profile = await ProfileStorage.getProfileById(pool, booking.id_profile);
    if (!profile || !profile.is_clan) return null;

    const already = await ClanEarningSplitStorage.existsForBooking(pool, booking.id);
    if (already) return null;

    let memberIds = [];
    if (booking.id_profile_service != null) {
      memberIds = await ProfileServiceStorage.getMemberIds(pool, booking.id_profile_service);
    }
    if (memberIds.length === 0) {
      const all = await ClanStorage.listMembers(pool, booking.id_profile);
      memberIds = all.map((m) => m.id_member_profile);
    }
    if (memberIds.length === 0) return null;

    const gross = Number(booking.professional_amount) || 0;
    if (gross <= 0) return null;

    const N = memberIds.length;
    const per = Math.floor(gross / N);
    const remainder = gross - per * N;
    const member_amounts = memberIds.map((id_member_profile, idx) => ({
      id_member_profile,
      amount_cents: per + (idx === 0 ? remainder : 0),
    }));

    const rows = await ClanEarningSplitStorage.createBookingSplits(pool, {
      id_clan_profile: booking.id_profile,
      source_id: String(booking.id),
      gross_amount_cents: gross,
      member_amounts,
    });
    log.info("booking.clan_split.created", {
      bookingId: booking.id,
      members: rows.length,
      per,
    });
    return rows;
  }
}

module.exports = BookingService;
