// src/services/WhatsappCloudIngestService.js
// Ingestão do webhook da Meta Cloud API (mig 240): o que CHEGA.
//
// ─── O INVARIANTE DO SUBSISTEMA ────────────────────────────────────────────
//
// Este módulo NÃO importa `integrations/whatsappProvider` nem `WhatsappService`
// — os lugares que sabem ENVIAR. Não existe caminho de código daqui até um
// `sendText`, e isso continua sendo verdade depois da mig 253.
//
// ⚠️ MAS O QUE ELE GARANTE MUDOU, E ESTA PARTE PRECISA SER LIDA INTEIRA.
//
// Até a mig 253 o isolamento garantia que NINGUÉM era respondido
// automaticamente: toda saída nascia de um clique do dono. Desde ela existe o
// Atendimento com IA, e ele responde sozinho. O que o isolamento garante hoje é
// mais estreito e continua sendo o que importa:
//
//   • daqui não sai mensagem. Este módulo só ENFILEIRA (`AiJobStorage`, SQL
//     puro). Quem responde é o `AiReplyWorker`, que roda à parte;
//   • e o worker envia SEMPRE por `WhatsappService.sendText`, que confere a
//     JANELA DE 24H antes de falar com a Meta.
//
// Ou seja: a plataforma responde apenas DENTRO da janela e apenas a quem
// escreveu primeiro. Ela nunca inicia conversa e nunca usa template — que é a
// distinção entre atendimento e disparo.
//
// Isso continua pesando mais do que pesava no provedor não-oficial: o número
// está no NOSSO Business Portfolio, então um envio fora dessa regra seria,
// perante a Meta, a plataforma operando ferramenta de disparo — com o portfólio
// inteiro, e portanto o número de todos os clientes, no mesmo risco.
//
// `test/unit/whatsappIngestIsolation.test.js` lê os `require` de verdade e
// quebra se alguém acrescentar um import de passagem aqui.
// `test/unit/aiReplyIsolation.test.js` faz o mesmo do outro lado: garante que o
// worker não fale com o provider por baixo do Service, pulando a janela.
//
// ─── DE QUEM É ESTA MENSAGEM ────────────────────────────────────────────────
//
// A Meta entrega TODOS os números no mesmo endereço. A resposta legítima está
// em UM campo: `value.metadata.phone_number_id`, casado com
// `tb_whatsapp_instance` pelo par (provider='cloud', evolution_instance).
// Número desconhecido é IGNORADO — nunca atribuído a alguém.

const pool = require("../databases");
const WhatsappStorage = require("../storages/WhatsappStorage");
const realtime = require("../realtime/socket");
const { readEnvelope, readMessage, namesOf } = require("../utils/whatsappCloudPayload");
// W6. ⚠️ Nenhum dos dois alcança quem ENVIA — o parser de qualidade é função
// pura e o NotificationService fala com banco e socket, nunca com a Meta. O
// `whatsappIngestIsolation.test.js` confere isto pelo fecho transitivo dos
// `require`, e é ele que impede um import de passagem de abrir o caminho de
// "mensagem que chega" para "mensagem que sai".
const { readQualityEvent } = require("../utils/whatsappCloudQuality");
const NotificationService = require("./NotificationService");
// ⚠️ SQL PURO. Este é o ÚNICO módulo do subsistema de IA que a ingestão pode
// importar — ele não alcança nada que envie, e é isso que mantém o invariante.
const AiJobStorage = require("../storages/AiJobStorage");
const { redactPhone } = require("../utils/whatsappJid");
const { createLogger } = require("../utils/logger");

const log = createLogger("WhatsappCloudIngestService");

const PROVIDER = "cloud";

/** A janela de atendimento da Meta: 24h a contar da mensagem do cliente. */
const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

class WhatsappCloudIngestService {
  /**
   * Mensagens de um bloco já resolvido para um dono.
   *
   * ⚠️ `direction` é SEMPRE `in`. Diferente do Baileys, `messages[]` da Cloud
   * API traz só o que o CLIENTE mandou — o que o dono responde pelo celular
   * dele chega em `smb_message_echoes`, tratado no W3. Marcar qualquer coisa
   * daqui como `out` inverteria o autor da bolha na tela.
   */
  static async _handleMessages(instance, block) {
    const names = namesOf(block.contacts);
    let saved = 0;
    let duplicated = 0;

    for (const raw of block.messages) {
      const msg = readMessage(raw, names);
      if (!msg) continue;

      const conversation = await WhatsappStorage.ensureConversation(pool, {
        id_instance: instance.id_instance,
        remote_jid: msg.remoteJid,
        phone: msg.phone,
        push_name: msg.pushName,
        // Número comercial da Cloud API não participa de grupo. Não é um
        // default preguiçoso: é uma propriedade do canal.
        is_group: false,
      });

      const row = await WhatsappStorage.insertMessage(pool, {
        id_conversation: conversation.id_conversation,
        wa_message_id: msg.waMessageId,
        direction: "in",
        sender_label: null,
        body: msg.body,
        media_type: msg.mediaType,
        sent_at: msg.sentAt,
      });

      // A Meta entrega at-least-once: a repetição é esperada, e o UNIQUE de
      // `wa_message_id` é o que a torna inofensiva. Contar em vez de logar
      // mantém o sinal sem encher o log de um evento normal.
      if (!row) {
        duplicated++;
        continue;
      }
      saved++;

      // ⚠️ A JANELA DE 24H NASCE AQUI, e este é o único lugar que pode
      // abri-la: é o webhook que sabe quando o cliente falou. Calcular no
      // envio seria adivinhar, e adivinhar para o lado aberto faz a tela
      // prometer um envio que a Meta vai recusar.
      await WhatsappStorage.touchConversation(pool, conversation.id_conversation, {
        preview: msg.body,
        sent_at: msg.sentAt,
        inc_unread: true,
        service_window_expires_at: new Date(msg.sentAt.getTime() + SERVICE_WINDOW_MS),
      });

      // ⚠️ ENFILEIRA A RESPOSTA — E ENFILEIRAR NÃO É ENVIAR.
      //
      // Este é o ponto mais delicado do módulo. O invariante continua inteiro:
      // `AiJobStorage` é SQL puro e não alcança nenhum módulo de envio, então
      // daqui continua não existindo caminho de `require` até quem fala com a
      // Meta — é o que `whatsappIngestIsolation.test.js` confere, e ele segue
      // passando sem afrouxar nada. Quem responde é o `AiReplyWorker`, que roda
      // à parte e só sabe da fila.
      //
      // ⚠️ E A FILA NÃO É ENFEITE AQUI: a Meta re-entrega o que não recebe 2xx
      // em 22 segundos, e uma chamada de LLM leva segundos. Responder DENTRO do
      // webhook transformaria a lentidão do modelo em tempestade de re-entrega.
      //
      // Não decide NADA sobre responder ou não — flag, direito da conta, janela
      // e "o dono já respondeu?" são do worker. Aqui só se registra que chegou
      // mensagem. Falha ao enfileirar NÃO derruba a ingestão: a mensagem já
      // está salva e a caixa do dono é o que importa.
      AiJobStorage.enqueue(pool, {
        id_user: instance.id_user,
        channel: "whatsapp",
        ref_id: conversation.id_conversation,
        trigger_message_id: msg.waMessageId,
        trigger_text: msg.body,
      }).catch((err) => log.warn("ai.enqueue_fail", { error: err.message }));

      // O evento da caixa de entrada é UM só, e a
      // tela não deve precisar saber por qual provedor a mensagem entrou.
      realtime.emitToUser(instance.id_user, "whatsapp:message", {
        id_conversation: conversation.id_conversation,
        message: row,
        conversation: {
          id_conversation: conversation.id_conversation,
          remote_jid: conversation.remote_jid,
          phone: conversation.phone,
          push_name: conversation.push_name,
          is_group: false,
          last_message_preview: msg.body.slice(0, 300),
          last_message_at: msg.sentAt,
        },
      });
    }

    return { saved, duplicated };
  }

  /**
   * W6 — a saúde do número. Devolve um rótulo curto para o resumo do webhook,
   * ou `null` quando o bloco não é de qualidade (aí quem chama o ignora).
   *
   * ⚠️ O ROTEAMENTO AQUI É PELO NÚMERO, e essa é a diferença que quebra quem
   * copia o caminho das mensagens: `phone_number_quality_update` e
   * `account_update` NÃO trazem `value.metadata.phone_number_id`. Casar por
   * `phoneNumberId` acharia sempre vazio, todo evento cairia em "desconhecido"
   * e o painel ficaria eternamente sem dado — sem um erro sequer.
   *
   * ⚠️ Número que não é nosso é IGNORADO, como nas mensagens. Um evento de ban
   * atribuído por aproximação mandaria para uma pessoa o susto causado por
   * outra.
   */
  static async _handleQuality(block) {
    const ev = readQualityEvent(block);
    if (!ev) return null;

    if (!ev.phone) {
      log.warn("cloud.quality.no_phone", { field: ev.field, event: ev.event });
      return `${ev.field}: sem número`;
    }

    const instance = await WhatsappStorage.getInstanceByNumber(pool, PROVIDER, ev.phone);
    if (!instance) {
      // LGPD: telefone nunca inteiro no log — nem o de quem não é nosso.
      log.warn("cloud.quality.unknown_number", {
        field: ev.field,
        event: ev.event,
        phone: redactPhone(ev.phone),
      });
      return `${ev.field}: número desconhecido`;
    }

    await WhatsappStorage.setQuality(pool, instance.id_instance, {
      rating: ev.rating,
      status: ev.status,
    });

    if (ev.alert) {
      // Fire-and-forget como toda notificação: o webhook não pode falhar (e
      // provocar reentrega da Meta) porque o sino não acendeu.
      await NotificationService.notifyWhatsappQuality({
        recipient_user_id: instance.id_user,
        id_instance: instance.id_instance,
        event: ev.event,
        rating: ev.rating,
        status: ev.status,
      }).catch(() => null);

      // Quem está com a aba aberta vê na hora, sem esperar o próximo load.
      try {
        realtime.emitToUser(instance.id_user, "whatsapp:quality", {
          event: ev.event,
          rating: ev.rating,
          status: ev.status,
        });
      } catch {
        /* realtime é best-effort */
      }
    }

    log.info("cloud.quality.applied", {
      field: ev.field,
      event: ev.event,
      status: ev.status,
      alert: ev.alert,
    });
    return `${ev.field}: ${ev.event || "sem evento"}`;
  }

  /**
   * Ponto de entrada. Recebe o corpo JÁ PARSEADO — quem confere a assinatura
   * sobre os bytes crus é o controller, antes de chamar isto.
   *
   * Devolve um resumo agregado: um POST pode trazer blocos de números
   * diferentes, e o controller responde 200 uma vez só.
   */
  static async process(body) {
    const blocks = readEnvelope(body);
    if (!blocks.length) return { type: "ignored", reason: "envelope sem mudanças" };

    let saved = 0;
    let duplicated = 0;
    let statuses = 0;
    const ignored = [];
    const quality = [];

    for (const block of blocks) {
      // `field` diz o que a mudança é. Só `messages` traz conversa; a saúde do
      // número (W6) entra pelo caminho ao lado, e o resto segue ignorado.
      //
      // ⚠️ IGNORAR NÃO ERA NEUTRO: `phone_number_quality_update` e
      // `account_update` já estavam ASSINADOS no app desde o começo, então a
      // Meta vinha entregando aviso de número sinalizado e de conta restrita —
      // e nós os jogávamos fora, com 200 na resposta. O sintoma dessa perda só
      // apareceria meses depois, como "o teto de números parou de subir", sem
      // nome e sem data.
      if (block.field !== "messages") {
        const label = await this._handleQuality(block);
        if (label) quality.push(label);
        else ignored.push(block.field || "vazio");
        continue;
      }

      if (!block.phoneNumberId) {
        ignored.push("bloco sem phone_number_id");
        continue;
      }

      const instance = await WhatsappStorage.getInstanceByRef(
        pool,
        PROVIDER,
        block.phoneNumberId
      );

      // Número que não é nosso (ou que já saiu do banco). Ignorar é a única
      // resposta correta: atribuir a alguém seria entregar a conversa de um
      // desconhecido para um usuário qualquer.
      if (!instance) {
        log.warn("cloud.unknown_number", { phone_number_id: block.phoneNumberId });
        ignored.push("número desconhecido");
        continue;
      }

      const r = await this._handleMessages(instance, block);
      saved += r.saved;
      duplicated += r.duplicated;

      // `statuses[]` são recibos (enviado/entregue/lido/falhou) do que NÓS
      // mandamos. Contados e não gravados de propósito: não há coluna de
      // estado em `tb_whatsapp_message` (mig 223), e inventar uma exigiria
      // migration. Contar deixa o número visível no log quando o W4 chegar,
      // em vez de o recibo sumir sem rastro.
      statuses += block.statuses.length;
    }

    return { type: "messages", saved, duplicated, statuses, ignored, quality };
  }

  /** Log de webhook NUNCA leva telefone inteiro (LGPD) — nem o de terceiro. */
  static logSummary(body) {
    const blocks = readEnvelope(body);
    const first = blocks[0] || {};
    const msg = (first.messages || [])[0];
    return {
      blocks: blocks.length,
      field: first.field || "",
      phone_number_id: first.phoneNumberId || "",
      from: msg ? redactPhone(String(msg.from || "")) : "",
    };
  }
}

module.exports = WhatsappCloudIngestService;
