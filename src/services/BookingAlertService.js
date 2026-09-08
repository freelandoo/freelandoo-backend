// src/services/BookingAlertService.js
// QUEM PRECISA SABER QUE UM HORÁRIO FOI MARCADO PELO SITE DA COMUNIDADE.
//
// Pedido do Alex (2026-09-08), olhando o construtor do site: "quando agendar
// ali, vá uma mensagem pra caixa de mensagens do perfil líder da comunidade, e
// também, se tiver conectado o Evolution, com o número de WhatsApp cadastrado.
// As notificações dos agendamentos precisam ir pra lá."
//
// ═══ POR QUE O SINO NÃO BASTAVA ═════════════════════════════════════════════
//
// O agendamento confirmado já acendia uma notificação (`booking_received`) para
// o PROFISSIONAL. Duas coisas faltavam:
//
//   1. O LÍDER não recebia nada. O site é o negócio dele; numa barbearia com
//      três barbeiros, a reserva cai na agenda de um deles e o dono da casa não
//      ficava sabendo — nem no sino, nem em lugar nenhum.
//   2. O SINO NÃO ALCANÇA QUEM NÃO ESTÁ NO SITE. Uma reserva marcada às 23h só
//      seria vista na próxima visita à Freelandoo. É por isso que o aviso agora
//      tem dois canais de naturezas diferentes: a caixa de mensagens (fica lá,
//      e permite RESPONDER o cliente) e o WhatsApp (chega).
//
// ═══ QUEM RECEBE ════════════════════════════════════════════════════════════
//
// O LÍDER da comunidade de onde o agendamento veio, sempre — e o PROFISSIONAL
// agendado, quando for outra pessoa. Não é ampliação de escopo: é quem tem que
// aparecer na hora marcada. Avisar só o dono da casa deixaria quem vai atender
// sabendo do compromisso apenas pelo sino.
//
// Quando líder e profissional são a MESMA pessoa (o caso comum, o prestador
// sozinho), é UM aviso só — a lista é deduplicada por id_user, senão o solo
// receberia duas mensagens idênticas de cada reserva.
//
// ═══ O QUE DISPARA, E O QUE NÃO ═════════════════════════════════════════════
//
// Só agendamento CONFIRMADO (sinal pago), e só quando ele carrega
// `id_origin_community` (mig 227) — ou seja, veio pelo site. Agendamento feito
// pelo modal do perfil não tem comunidade por trás, e avisar um líder sobre ele
// seria contar ao dono do site uma reserva que não passou pelo negócio dele.
//
// ⚠️ TUDO AQUI É FIRE-AND-FORGET. O agendamento já está pago e confirmado
// quando esta função roda: nada do que acontece aqui pode desfazê-lo nem
// devolver erro para o webhook do Stripe (que reentregaria o evento). Cada
// canal falha sozinho e em silêncio — no log, nunca na cara do cliente.

const pool = require("../databases");
const ProfileStorage = require("../storages/ProfileStorage");
const CommunityStorage = require("../storages/CommunityStorage");
const CommunityProfessionalStorage = require("../storages/CommunityProfessionalStorage");
const ConversationStorage = require("../storages/ConversationStorage");
const MessageStorage = require("../storages/MessageStorage");
const NotificationService = require("./NotificationService");
const ConversationService = require("./ConversationService");
const WhatsappService = require("./WhatsappService");
const realtime = require("../realtime/socket");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BookingAlertService");

const WEB_URL =
  process.env.FRONTEND_URL || process.env.PUBLIC_WEB_URL || "https://www.freelandoo.com.br";

/** `date` do Postgres chega como Date; o corpo do POST, como string. */
function ymd(d) {
  if (!d) return "";
  if (typeof d === "string") return d.slice(0, 10);
  try {
    return new Date(d).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function dateLabel(d) {
  const s = ymd(d);
  if (!s) return "";
  const [y, m, day] = s.split("-");
  return `${day}/${m}/${y}`;
}

/** `14:00:00` -> `14:00`. O segundo nunca disse nada a ninguém. */
function timeLabel(t) {
  return String(t || "").slice(0, 5);
}

function brl(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return null;
  return `R$ ${(n / 100).toFixed(2).replace(".", ",")}`;
}

class BookingAlertService {
  /**
   * A origem é VERDADEIRA? Chamada na CRIAÇÃO do agendamento.
   *
   * ⚠️ `id_community` vem do corpo do POST, ou seja, de quem está agendando.
   * Sem esta checagem qualquer pessoa logada carimbaria a comunidade de um
   * desconhecido e faria chegar mensagem na caixa (e no WhatsApp) do líder
   * dela — um canal de spam com o nome da plataforma em cima.
   *
   * A régua é a MESMA da página de agendamento do site: quem atende ali é o
   * líder mais a equipe promovida (mig 221). Se o perfil agendado não é nenhum
   * dos dois, a origem não existe.
   *
   * Devolve `null` quando não bate — e quem chama trata isso como "sem origem",
   * nunca como recusa: o horário marcado é verdadeiro de qualquer forma, e
   * derrubar o agendamento por causa do carimbo puniria o cliente.
   */
  static async resolveOrigin(conn, id_community, professional_user_id) {
    if (!id_community || !professional_user_id) return null;
    try {
      const community = await CommunityStorage.getById(conn, id_community);
      if (!community) return null;

      const isLeader = String(community.id_leader_user) === String(professional_user_id);
      const isTeam =
        isLeader ||
        (await CommunityProfessionalStorage.exists(conn, id_community, professional_user_id));
      if (!isTeam) return null;

      return {
        id_community: community.id_profile,
        leader_user_id: community.id_leader_user,
        display_name: community.display_name,
      };
    } catch (err) {
      log.warn("resolveOrigin.fail", { id_community, error: err.message });
      return null;
    }
  }

  /**
   * O agendamento foi pago e confirmado: avisa quem precisa saber.
   *
   * Nunca lança — o chamador é o webhook do Stripe.
   */
  static async notifyBookingConfirmed(booking) {
    if (!booking?.id_origin_community) return null;

    try {
      return await runWithLogs(
        log,
        "notifyBookingConfirmed",
        () => ({ id_booking: booking.id, id_community: booking.id_origin_community }),
        async () => {
          const community = await CommunityStorage.getById(pool, booking.id_origin_community);
          // Comunidade apagada depois da reserva: o agendamento continua de pé
          // (a FK é SET NULL, o compromisso não some junto com o anúncio), mas
          // não há mais dono de site a avisar.
          if (!community) return null;

          const leaderUserId = community.id_leader_user;
          const proUserId = booking.profile_owner_user_id;

          // Dedupe por pessoa: solo (líder == profissional) recebe UM aviso.
          const recipients = [];
          for (const id_user of [leaderUserId, proUserId]) {
            if (!id_user) continue;
            if (recipients.some((r) => String(r) === String(id_user))) continue;
            recipients.push(id_user);
          }
          if (recipients.length === 0) return null;

          const text = BookingAlertService._buildText(booking, community);

          for (const id_user of recipients) {
            // O sino do PROFISSIONAL já foi aceso pelo fluxo do agendamento
            // (`notifyBookingReceived`, no BookingService). Repetir aqui daria
            // duas linhas idênticas na lista de notificações dele.
            if (String(id_user) !== String(proUserId)) {
              NotificationService.notifyBookingReceived({
                owner_user_id: id_user,
                id_profile: booking.id_profile,
                id_booking: booking.id,
                client_user_id: booking.id_client_user,
                amount_cents: Number(booking.professional_amount) || null,
                preview: text,
              }).catch(() => {});
            }

            await BookingAlertService._sendInbox(id_user, booking, text).catch((err) =>
              log.warn("inbox.fail", { id_booking: booking.id, id_user, error: err.message })
            );

            // O WhatsApp NÃO é esperado: a caixa de mensagens é a entrega que
            // fica, e uma Evolution lenta não pode segurar o webhook do Stripe.
            // O retorno é informativo — ele devolve `{ sent:false, reason }` em
            // vez de erro quando o número não está conectado.
            WhatsappService.notifyOwner(id_user, text)
              .then((r) => {
                if (r && r.sent === false) {
                  log.info("whatsapp.skipped", {
                    id_booking: booking.id,
                    id_user,
                    reason: r.reason,
                  });
                }
              })
              .catch(() => {});
          }

          return { recipients: recipients.length };
        }
      );
    } catch (err) {
      // runWithLogs relança; aqui a falha morre para valer — o webhook não pode
      // devolver erro por causa de um aviso.
      log.error("notifyBookingConfirmed.fail", { id_booking: booking?.id, error: err.message });
      return null;
    }
  }

  /**
   * O texto do aviso — UM só para os dois canais.
   *
   * Escrever dois (um "curto para o WhatsApp", outro "completo para a caixa")
   * seria a segunda verdade de sempre: alguém acrescenta o serviço num e
   * esquece do outro, e o líder passa a ver reservas diferentes em cada lugar.
   *
   * ⚠️ NÃO leva e-mail nem telefone do cliente. O destino no WhatsApp é o
   * "recado para mim mesmo" do dono, que mora no aparelho dele e com backup em
   * nuvem de terceiro — dado de contato de quem agendou não precisa passear por
   * lá. Quem quiser falar com o cliente responde a mensagem na Freelandoo, que
   * é justamente o que o outro canal deste aviso abre.
   */
  static _buildText(booking, community) {
    const when = `${dateLabel(booking.booking_date)} às ${timeLabel(booking.start_time)}`;
    const service = booking.service_name_snapshot || "Agendamento";
    const value = brl(booking.professional_amount);

    const lines = [
      `📅 Novo agendamento pelo site de ${community.display_name}`,
      "",
      `Serviço: ${service}`,
      `Quando: ${when}`,
      `Cliente: ${booking.client_name || "—"}`,
    ];
    if (value) lines.push(`Você recebe: ${value}`);
    lines.push("", `Ver na agenda: ${WEB_URL}/account/profile/${booking.id_profile}/agenda`);
    return lines.join("\n");
  }

  /**
   * A mensagem na caixa da Freelandoo.
   *
   * ⚠️ QUEM ASSINA É O CLIENTE, e é uma escolha: assim a conversa abre no lugar
   * onde o líder pode RESPONDER quem agendou ("pode chegar 10 min antes?").
   * Um remetente-sistema produziria uma linha na caixa que ninguém consegue
   * responder — aviso, e não conversa; e para aviso já existe o sino.
   *
   * Vai pelo storage, e não pelo `ConversationService.sendMessage`: aquele
   * caminho exige um usuário AUTENTICADO na requisição, aplica limite de envio
   * e checa supervisão do remetente — regras de alguém digitando. Aqui quem
   * escreve é o sistema, num momento em que ninguém está na tela (o webhook do
   * Stripe). É a mesma decisão da conversa automática da disputa de condomínio.
   */
  static async _sendInbox(recipient_user_id, booking, text) {
    if (!booking.id_client_user) return null;

    const senderProfile = await ProfileStorage.getUserAccountProfileId(
      pool,
      booking.id_client_user
    );
    const recipientProfile = await ProfileStorage.getUserAccountProfileId(pool, recipient_user_id);
    if (!senderProfile || !recipientProfile) return null;
    // O líder agendando com um profissional da própria equipe: não existe
    // conversa de alguém consigo mesmo, e o sino dele já acendeu.
    if (String(senderProfile) === String(recipientProfile)) return null;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const { conversation } = await ConversationStorage.getOrCreate(
        client,
        senderProfile,
        recipientProfile
      );
      const message = await MessageStorage.create(client, {
        id_conversation: conversation.id_conversation,
        sender_entity_id: senderProfile,
        sender_user_id: booking.id_client_user,
        body: text,
      });
      await ConversationStorage.updateLastMessage(client, {
        id_conversation: conversation.id_conversation,
        sender_entity_id: senderProfile,
        body: text,
        at: message.created_at,
      });
      // O destinatário ganha o não-lido; o remetente (o cliente) não deve ver
      // badge de uma mensagem que ele não escreveu.
      await ConversationStorage.incrementUnreadForOther(client, {
        id_conversation: conversation.id_conversation,
        sender_entity_id: senderProfile,
      });
      await ConversationStorage.markRead(client, {
        id_conversation: conversation.id_conversation,
        entity_id: senderProfile,
      });
      await client.query("COMMIT");

      // Push, como qualquer mensagem: sem isto a caixa só mostraria a reserva na
      // próxima vez que a pessoa recarregasse a página.
      try {
        realtime.emitToConversation(conversation.id_conversation, "conversation:message", {
          id_conversation: conversation.id_conversation,
          // A MESMA projeção do envio normal (`ConversationService.mapMessage`).
          // Montar o objeto à mão aqui faria o card da conversa receber uma
          // mensagem sem algum campo no dia em que a projeção ganhasse um.
          message: ConversationService.mapMessage(message),
        });
        realtime.emitToUser(recipient_user_id, "nav-counts:changed", {
          reason: "message_received",
          id_conversation: conversation.id_conversation,
        });
      } catch {
        /* realtime é best-effort */
      }

      return conversation.id_conversation;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}

module.exports = BookingAlertService;
