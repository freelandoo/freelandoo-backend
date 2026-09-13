const pool = require("../databases");
const BookingStorage = require("../storages/BookingStorage");
const BookingAvailabilityStorage = require("../storages/BookingAvailabilityStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const ProfileSubscriptionStorage = require("../storages/ProfileSubscriptionStorage");
const ProfileServiceStorage = require("../storages/ProfileServiceStorage");
const ClanPayoutStorage = require("../storages/ClanPayoutStorage");
const PaymentGateway = require("../integrations/payments");
const StoreGovernanceService = require("./StoreGovernanceService");
const NotificationService = require("./NotificationService");
const BookingAlertService = require("./BookingAlertService");
const { createLogger } = require("../utils/logger");
const {
  resolvePlatformFee,
  estimateProcessorFee,
  professionalNet,
} = require("../utils/bookingFee");

const log = createLogger("BookingService");

/**
 * ⚠️ A TAXA DA PLATAFORMA NÃO MORA MAIS AQUI (mig 244).
 *
 * Era `const PLATFORM_FEE_CENTS = 1000`, uma constante — enquanto a tela de
 * admin da mig 018 escrevia em `tb_booking_fee_settings` e NINGUÉM lia. Em
 * produção a tabela estava com 5% + R$ 2,50 configurados e sem efeito nenhum:
 * o painel mostrava ao dono uma taxa que não era a cobrada.
 *
 * Agora quem responde é `resolvePlatformFee`, que lê aquela linha. Não
 * recriar constante de taxa neste arquivo.
 */

/** Régua do e-mail do cliente sem conta. Mesma de `utils/validateSignup`. */
const GUEST_EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class BookingService {
  /**
   * Cria o agendamento — com ou sem conta na Freelandoo.
   *
   * ⚠️ LOGIN DEIXOU DE SER OBRIGATÓRIO (decisão do Alex, 2026-09-13), e a
   * tabela já aguentava: `tb_profile_bookings.id_client_user` sempre foi
   * NULL-able e `client_name`/`client_email`/`client_whatsapp` já existiam.
   * O que travava era só o `authMiddleware` na rota. Num site de barbearia
   * exigir cadastro para marcar um corte é pedágio: a pessoa veio de uma busca,
   * quer um horário, e criar conta numa plataforma que ela não conhece é a
   * parte do fluxo onde ela desiste.
   *
   * Logada, nome e e-mail saem da CONTA (não do corpo) — é o que impede alguém
   * de marcar em nome de outra pessoa usando a própria sessão. Sem conta, eles
   * vêm do corpo e o agendamento nasce com `id_client_user = NULL`.
   *
   * @param {{id_user?: string, email?: string}|null} user sessão, ou null
   */
  static async createPublicBooking(user, id_profile, body) {
    const {
      client_whatsapp,
      booking_date,
      start_time,
      id_profile_service,
      coupon_code,
      // De onde a pessoa chegou (mig 227). Só a página de agendamento do SITE
      // da comunidade manda isto; o modal do perfil não tem comunidade por trás
      // e continua mandando nada. É este campo que decide se o líder do site
      // recebe o aviso da reserva.
      id_community,
      // "now" (padrão) abre o checkout; "on_site" marca o horário e o dinheiro
      // é combinado no balcão. Ausente = "now", então cliente antigo que não
      // conhece o campo continua entrando pelo caminho de sempre.
      payment_mode,
    } = body || {};

    const onSite = String(payment_mode || "now") === "on_site";

    let client_name;
    let client_email;
    if (user?.id_user) {
      // req.user só tem id+email no token, então o nome vem do banco.
      const buyerRes = await pool.query(
        `SELECT nome, email FROM public.tb_user WHERE id_user = $1 LIMIT 1`,
        [user.id_user]
      );
      const buyer = buyerRes.rows[0];
      if (!buyer) return { error: "Conta não encontrada" };
      client_name = String(buyer.nome || "").trim();
      client_email = String(buyer.email || user.email || "").trim();
      if (!client_name || !client_email) {
        return { error: "Conta sem nome/e-mail. Atualize seu perfil antes de agendar." };
      }
    } else {
      client_name = String(body?.client_name || "").trim();
      client_email = String(body?.client_email || "").trim().toLowerCase();
      if (client_name.length < 2) {
        return { error: "Informe o seu nome para agendar" };
      }
      if (!GUEST_EMAIL_RE.test(client_email)) {
        return { error: "Informe um e-mail válido para receber a confirmação" };
      }
      // As colunas são VARCHAR e o valor vem da internet: cortar aqui evita que
      // um corpo gigante estoure no INSERT com erro de banco na cara de quem
      // só queria marcar um horário.
      client_name = client_name.slice(0, 120);
      client_email = client_email.slice(0, 160);
    }
    if (!booking_date || !start_time) {
      return { error: "Campos obrigatórios: booking_date, start_time" };
    }

    // Validar perfil
    const profile = await ProfileStorage.getProfileById(pool, id_profile);
    if (!profile || profile.deleted_at) return { error: "Perfil não encontrado" };
    // Perfil-conta é agendável mesmo com is_visible=FALSE (paridade user≡perfil)
    if (!profile.is_visible && !profile.is_user_account) return { error: "Perfil indisponível" };
    // Só faz sentido com sessão: sem conta não há "próprio perfil" para barrar.
    if (user?.id_user && String(profile.id_user) === String(user.id_user)) {
      return { error: "Você não pode agendar com seu próprio perfil" };
    }

    // ⚠️ O PERFIL-CONTA NÃO PRECISA DE ASSINATURA, e esta linha estava faltando.
    // A paridade user≡perfil (S2, 2026-07-20) tirou o gate de pagamento da
    // vitrine, da loja e dos cursos para o perfil-conta, mas o do agendamento
    // ficou para trás — então o perfil-conta de qualquer pessoa respondia
    // "Perfil não disponível para agendamento", que é o oposto do que a regra
    // diz. Foi exatamente o que barrou a barbearia do Enzo: perfil-conta, sem
    // assinatura, agendamento recusado mesmo com serviço cadastrado.
    // Subperfil comprado segue exigindo assinatura ativa, como sempre.
    if (!profile.is_user_account) {
      const sub = await ProfileSubscriptionStorage.findActiveByProfile(pool, id_profile);
      if (!sub) return { error: "Perfil não disponível para agendamento" };
    }

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

    // ⚠️ Serviço SOB ORÇAMENTO não é reservável (mig 239): não existe valor a
    // cobrar antes da visita, e sinal é pagamento. O card público já manda essa
    // pessoa para o WhatsApp — este guard é o que impede a porta de trás, e
    // precisa vir ANTES da conta do preço: sem ele a recusa sairia como "valor
    // inferior à taxa mínima", que não explica nada a quem só queria um orçamento.
    if (service.price_on_request === true) {
      return { error: "Este serviço é sob orçamento — fale com o profissional antes de agendar" };
    }

    // O preço publicado é o que o cliente paga. Dele saem a taxa da plataforma
    // e a tarifa do gateway; o resto é do profissional (ver `utils/bookingFee`).
    const service_price = service.price_amount;

    // Taxa da plataforma: sai de `tb_booking_fee_settings`, a MESMA linha da
    // tela de admin (mig 244). No modo balcão ela é ZERO — a plataforma não
    // pode cobrar comissão de um dinheiro que não passou por ela.
    const platform_fee_cents = onSite ? 0 : await resolvePlatformFee(pool, service_price);

    if (!onSite && service_price <= platform_fee_cents) {
      return { error: "Valor do serviço inferior à taxa mínima da plataforma" };
    }

    // Opt-in de afiliado por serviço (mig 090): comissão ADITIVA embutida no sinal,
    // base = preço cheio do serviço, sem reduzir o que o profissional recebe. Sem
    // gross-up de maquininha (booking não grossa-up). Vai pro afiliado se a venda
    // veio por ?cupom=, senão a plataforma fica.
    const affiliatesAllowed = service.affiliates_allowed === true;
    // % definida pelo DONO do serviço (mig 192); NULL cai no default global.
    const affiliate_pct = await StoreGovernanceService.resolveAffiliatePercent({
      affiliatesAllowed,
      affiliatePercent: service.affiliate_percent,
    });
    const affiliate_commission_cents = affiliate_pct > 0
      ? Math.round((service_price * affiliate_pct) / 100)
      : 0;
    // Comprador paga: preço do serviço + comissão embutida.
    // No modo balcão nada é cobrado agora — o dinheiro é combinado na cadeira.
    const charge_amount = onSite ? 0 : service_price + affiliate_commission_cents;

    // ⚠️ A TARIFA DO GATEWAY É DESCONTADA DO PROFISSIONAL (mig 244), e não da
    // plataforma como antes. Com a taxa da plataforma em R$ 1,00, absorvê-la
    // aqui dentro daria PREJUÍZO em quase toda a tabela: o Asaas cobra R$ 1,99
    // no Pix e 2,99% + R$ 0,49 no cartão — mais que a taxa inteira.
    //
    // Este número é ESTIMATIVA e quase nunca vira dinheiro: a confirmação o
    // substitui pelo valor apurado no gateway antes de qualquer repasse. Ele
    // existe para a linha não mentir na janela entre criar e confirmar.
    const governance = onSite ? null : await StoreGovernanceService.getSettings();
    const processorEstimate = onSite
      ? { cents: 0, source: "none" }
      : estimateProcessorFee(charge_amount, governance);

    const professional_amount = onSite
      ? 0 // ninguém repassa dinheiro que não recebeu
      : professionalNet({
          chargeAmountCents: charge_amount,
          platformFeeCents: platform_fee_cents,
          processorFeeCents: processorEstimate.cents,
          // ⚠️ A comissão do afiliado está DENTRO de `charge_amount` e é dele,
          // não do profissional. Sem descontá-la aqui ela seria paga duas
          // vezes: uma no repasse e outra pelo webhook do afiliado.
          affiliateCommissionCents: affiliate_commission_cents,
        });

    // ─── DE ONDE VEIO ────────────────────────────────────────────────────────
    // O carimbo é do CLIENTE, então ele é conferido: só vale quando o perfil
    // agendado realmente atende naquela comunidade (líder ou equipe da mig 221).
    // Não batendo, `origin` é null e o agendamento segue igual — origem
    // duvidosa vira silêncio, nunca recusa de um horário que é verdadeiro.
    const origin = id_community
      ? await BookingAlertService.resolveOrigin(pool, id_community, profile.id_user)
      : null;

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

      // ⚠️ NO MODO BALCÃO NÃO EXISTE COBRANÇA, e por isso não existe checkout.
      // Abrir um de R$ 0,00 "só para manter o caminho único" criaria uma
      // cobrança no gateway que nunca seria paga e que o sweeper de pendentes
      // acabaria expirando — cancelando sozinho um horário que está valendo.
      //
      // ⚠️ ANTES ISTO CHAMAVA `StripeService.client()` DIRETO, furando a costura
      // do gateway — era um dos dois pontos que o commit A0 apontou como
      // impedimento para o fluxo migrar. O que prendia era `custom_text`, que só
      // o Stripe tem; agora ele desce como parâmetro opcional e o Asaas aproveita
      // o mesmo texto como `description` da cobrança, em vez de perdê-lo.
      const session = onSite ? null : await PaymentGateway.createCheckout({
        amount_cents: charge_amount,
        currency: "BRL",
        productName,
        description,
        customerEmail: client_email,
        successUrl: `${frontendUrl}/agendamento/sucesso?session_id={CHECKOUT_SESSION_ID}`,
        cancelUrl: `${frontendUrl}/freelancer/${id_profile}?booking=canceled`,
        customText: {
          submit: {
            // ⚠️ A TAXA DA PLATAFORMA SAIU DESTE TEXTO, e não foi só porque a
            // constante morreu: ela é combinada com o PROFISSIONAL e sai do
            // que ELE recebe (mig 244). Anunciá-la a quem está pagando sugere
            // um acréscimo que não existe — o cliente paga o preço publicado,
            // e essa é a promessa que o site dele faz.
            message: `Este pagamento é o sinal que confirma a sua reserva de ${dateLabel} às ${start_time}. Após a aprovação, o horário fica bloqueado pela duração do serviço.`,
          },
        },
        metadata: {
          type: "booking_deposit",
          profile_id: id_profile,
          booking_date,
          start_time,
          client_name,
          client_email,
          // Cliente sem conta não tem id — o campo some do metadata em vez de
          // ir como "undefined", que o gateway guardaria como string literal.
          ...(user?.id_user ? { user_id: String(user.id_user) } : {}),
          // Comissão de afiliado SÓ quando o serviço tem opt-in (gate real).
          ...(affiliatesAllowed && coupon_code && affiliate_commission_cents > 0
            ? {
                coupon_code: String(coupon_code).trim().toUpperCase().slice(0, 40),
                affiliate_commission_cents: String(affiliate_commission_cents),
              }
            : {}),
          charge_amount: String(charge_amount),
          platform_fee: String(platform_fee_cents),
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
        // NULL quando agendou sem conta — a coluna sempre foi NULL-able.
        id_client_user: user?.id_user || null,
        client_name,
        client_email,
        client_whatsapp: client_whatsapp || null,
        booking_date,
        start_time,
        end_time,
        deposit_amount: charge_amount,
        platform_fee_amount: platform_fee_cents,
        professional_amount,
        stripe_checkout_session_id: session ? session.id : null,
        // ⚠️ No balcão a reserva nasce VALENDO. Ela não espera pagamento
        // nenhum, então não pode nascer `pending_payment`/`pending`: o sweeper
        // de pendentes expiraria o horário de quem escolheu pagar na cadeira.
        status: onSite ? "confirmed" : "pending_payment",
        payment_status: onSite ? "on_site" : "pending",
        processor_fee_cents: processorEstimate.cents,
        processor_fee_source: processorEstimate.source,
        id_profile_service: service ? service.id_profile_service : null,
        service_name_snapshot: service ? service.name : null,
        // O preço FICA registrado mesmo no balcão: é quanto o cliente vai
        // pagar lá, e é o que a agenda do Enzo precisa mostrar.
        service_price_amount: service ? service.price_amount : null,
        id_origin_community: origin ? origin.id_community : null,
      });

      await client.query("COMMIT");

      log.info("booking.created", {
        bookingId: booking.id,
        profileId: id_profile,
        date: booking_date,
        time: start_time,
        sessionId: session ? session.id : null,
        paymentMode: onSite ? "on_site" : "now",
        guest: !user?.id_user,
      });

      // ⚠️ NO BALCÃO O AVISO SAI AQUI, e não pode sair de outro lugar: quem
      // avisa o profissional é a confirmação do pagamento (`confirmBySessionId`
      // → `notifyBookingConfirmed`), e aqui não existe pagamento para confirmar.
      // Sem isto, o Enzo teria na agenda um horário que ninguém lhe contou.
      //
      // Fire-and-forget e DEPOIS do COMMIT: a reserva já está gravada, e falha
      // de aviso não pode desfazer um horário que é verdadeiro.
      if (onSite) {
        BookingAlertService.notifyBookingConfirmed(booking).catch((err) =>
          log.warn("booking.onsite.alert.fail", { bookingId: booking.id, message: err?.message })
        );
      }

      return {
        booking,
        checkout_url: session ? session.url : null,
        payment_mode: onSite ? "on_site" : "now",
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

    // Agenda da conta: a lista é a mesma vista de qualquer perfil (mig 190).
    const { profileIds } = await BookingAvailabilityStorage.resolveAgendaScope(pool, id_profile);
    const bookings = await BookingStorage.listByProfile(pool, profileIds);
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

    // ─── A TARIFA REAL SUBSTITUI A ESTIMATIVA ────────────────────────────────
    // Na criação `processor_fee_cents` recebeu um palpite (a régua da Loja,
    // calibrada para o Stripe). Aqui existe a cobrança de verdade, e com ela o
    // número apurado: `fee` no Stripe, `value − netValue` no Asaas.
    //
    // ⚠️ ISTO VEM ANTES DO REPASSE, e a ordem é a feature inteira: o
    // `BookingPayoutService` copia `professional_amount` para a linha do
    // payout, e a partir dali o dinheiro é o que está lá. Rodando depois, a
    // booking ficaria certa e o repasse errado — que é o único dos dois que
    // vira saque.
    //
    // ⚠️ NÃO APURAR NÃO É TARIFA ZERO. `getChargeFee` devolve `fee_cents:
    // null` quando não consegue ler, e assumir zero aqui pagaria ao
    // profissional dinheiro que o gateway já reteve. Sem número, a estimativa
    // fica — e `processor_fee_source` segue dizendo `fallback`, que é como se
    // descobre depois quais repasses saíram no palpite.
    let confirmed = booking;
    try {
      const fee = await PaymentGateway.getChargeFee(paymentIntentId);
      const cents = Number(fee?.fee_cents);
      if (Number.isFinite(cents)) {
        const updated = await BookingStorage.applyProcessorFee(
          pool,
          booking.id,
          Math.max(0, Math.round(cents))
        );
        if (updated) {
          confirmed = updated;
          log.info("booking.processor_fee.applied", {
            bookingId: booking.id,
            estimated_cents: Number(booking.processor_fee_cents) || 0,
            real_cents: Math.max(0, Math.round(cents)),
            professional_cents: Number(updated.professional_amount) || 0,
          });
        }
      } else {
        log.warn("booking.processor_fee.unavailable", {
          bookingId: booking.id,
          paymentIntentId,
        });
      }
    } catch (err) {
      // Falha de apuração não pode derrubar a confirmação de um pagamento que
      // já aconteceu — a reserva vale, e o repasse sai na estimativa.
      log.warn("booking.processor_fee.fail", {
        bookingId: booking.id,
        message: err?.message,
      });
    }

    // Notifica o profissional (fire-and-forget). confirmBySessionId só transita
    // bookings 'pending_payment' → na retry do webhook retorna null e não chega aqui.
    NotificationService.notifyBookingReceived({
      owner_user_id: confirmed.profile_owner_user_id,
      id_profile: confirmed.id_profile,
      id_booking: confirmed.id,
      client_user_id: confirmed.id_client_user,
      amount_cents: Number(confirmed.professional_amount) || null,
    }).catch(() => {});
    // Veio pelo site de uma comunidade? O dono do site (e quem vai atender, se
    // for outra pessoa) recebe o recado na caixa de mensagens e no WhatsApp —
    // o sino sozinho não alcança quem não está com a Freelandoo aberta.
    // Fire-and-forget pela mesma razão da linha acima: este é o webhook do
    // Stripe, e uma falha de aviso não pode fazer o pagamento ser reentregue.
    BookingAlertService.notifyBookingConfirmed(confirmed).catch(() => {});
    // ⚠️ DAQUI PARA BAIXO É SEMPRE `confirmed`, nunca `booking`: as duas
    // linhas são a mesma reserva, mas `booking` carrega o líquido calculado
    // com a tarifa ESTIMADA. É este valor que vira split de clan e payout —
    // usar a linha velha aqui seria apurar a tarifa real e repassar mesmo
    // assim o número do palpite.
    try {
      await BookingService.recordClanSplitForBooking(confirmed);
    } catch (err) {
      log.error("booking.clan_split.fail", { bookingId: confirmed.id, error: err.message });
    }
    try {
      const BookingPayoutService = require("./BookingPayoutService");
      await BookingPayoutService.createFromBooking(confirmed);
    } catch (err) {
      log.error("booking.payout_create.fail", { bookingId: confirmed.id, error: err.message });
    }
    return confirmed;
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
