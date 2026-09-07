// src/services/WhatsappService.js
// O WhatsApp de cada usuário dentro da Freelandoo (mig 223): conectar por QR,
// ler a caixa e responder.
//
// ─── AS QUATRO REGRAS QUE NÃO PODEM REGREDIR ────────────────────────────────
//
// 1. UMA INSTÂNCIA POR PESSOA, COM NOME DERIVADO DO id_user. Nunca digitado,
//    nunca herdado de ENV (`EVOLUTION_INSTANCE` do Coliseu não existe aqui).
//    É esse nome que o webhook usa para saber de quem é a mensagem.
//
// 2. TODA LEITURA PASSA PELO DONO. A caixa carrega conversa de terceiros que
//    nunca ouviram falar da Freelandoo; nenhum SELECT aceita id de conversa
//    solto (o guard está no `WhatsappStorage`, e é dele que este service depende).
//
// 3. QUEM DECIDE SE A INTEGRAÇÃO EXISTE É A ENV, NÃO A FLAG (mig 214/220).
//    Sem `EVOLUTION_URL`/`EVOLUTION_API_KEY` a resposta é "não configurado",
//    dita em voz alta — nunca um botão que só falha depois do clique.
//
// 4. ENVIAR É SEMPRE UM CLIQUE DO DONO. A ingestão não conhece este módulo, e
//    não existe caminho automático de uma mensagem que chega até uma que sai.
//
// ─── POR QUE DESCONECTAR NÃO APAGA NADA ─────────────────────────────────────
//
// `logout` derruba a sessão na Evolution e zera o status aqui, mas a instância
// e as conversas ficam. Quem troca de aparelho (ou cai) volta e encontra a
// caixa como deixou; apagar seria transformar uma queda de rede em perda de
// histórico.

const pool = require("../databases");
const WhatsappStorage = require("../storages/WhatsappStorage");
const evolution = require("../integrations/evolution");
const FeatureFlagService = require("./FeatureFlagService");
const realtime = require("../realtime/socket");
const { instanceNameFor } = require("../utils/whatsappInstance");
const { formatPhone } = require("../utils/whatsappJid");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("WhatsappService");

const FLAG = "whatsapp_atendimento";
// Teto do corpo de uma mensagem de texto do WhatsApp com folga: o que passa
// disso não é conversa, é payload.
const MAX_TEXT = 4096;
/**
 * Dias sem o DONO abrir a caixa até a sessão ser desligada.
 *
 * Existe porque uma sessão do WhatsApp custa memória enquanto está de pé, e ela
 * fica de pé sozinha: quem conecta e some custa o mesmo que quem atende todo
 * dia. Configurável por ENV para o corte ser afrouxado sem deploy — 0 desliga o
 * sweeper inteiro, que é a saída para o dia em que ele estiver atrapalhando.
 */
const IDLE_DAYS = Number(process.env.WHATSAPP_IDLE_DAYS ?? 30);

class WhatsappService {
  static async _assertEnabled() {
    const enabled = await FeatureFlagService.isEnabled(FLAG);
    if (!enabled) return { error: "Recurso indisponível no momento.", statusCode: 403 };
    return null;
  }

  /** `{ error }` quando o ambiente não tem credencial da Evolution. */
  static _assertConfigured() {
    const cfg = evolution.config();
    if (!cfg) {
      return {
        error:
          "A integração com o WhatsApp ainda não está configurada nesta instalação.",
        statusCode: 503,
      };
    }
    return null;
  }

  /* ──────────────────────────── status / conexão ───────────────────────── */

  /**
   * O que a aba WhatsApp desenha ao abrir.
   *
   * A Evolution é a fonte da verdade da SESSÃO; o banco é cache. Quando ela não
   * responde (`null`), preservamos o último status conhecido em vez de piscar
   * "desconectado" — a pessoa veria a caixa dela virar um botão de conectar por
   * causa de um soluço de rede.
   *
   * ⚠️ `connecting` é preservado de propósito: é estado de PASSAGEM (QR na tela,
   * ou reconexão em curso), e rebaixá-lo a "desconectado" apagaria o QR que a
   * pessoa está lendo neste segundo.
   */
  static async status(id_user) {
    return runWithLogs(log, "status", () => ({ id_user }), async () => {
      const cfg = evolution.config();
      const instance = await WhatsappStorage.getInstanceByUser(pool, id_user);

      if (!instance) {
        return { configured: !!cfg, exists: false, status: "disconnected", number: "" };
      }

      // Abrir a aba é usar: é isto que segura a sessão de pé (ver IDLE_DAYS).
      await WhatsappStorage.touchSeen(pool, id_user);

      let status = instance.status;
      if (cfg) {
        const open = await evolution.connectionState(cfg, instance.evolution_instance);
        if (open !== null) {
          status = open ? "connected" : instance.status === "connecting" ? "connecting" : "disconnected";
          if (status !== instance.status) {
            await WhatsappStorage.setInstanceStatus(
              pool,
              instance.evolution_instance,
              status,
              status === "connected" ? undefined : null
            );
          }
        }
      }

      return {
        configured: !!cfg,
        exists: true,
        status,
        number: formatPhone(instance.connected_number),
        // Por que caiu. Sem isto, quem volta depois de um mês encontra o botão
        // "Conectar" e conclui que o produto quebrou — desconectado silencioso
        // é indistinguível de defeito.
        disconnect_reason: status === "connected" ? null : instance.disconnect_reason || null,
        idle_days: IDLE_DAYS,
        unread: await WhatsappStorage.unreadTotal(pool, id_user),
      };
    });
  }

  /**
   * O QR para parear. Uma chamada só faz as duas coisas — garantir a instância
   * e pedir o código — porque separá-las obrigaria a tela a acertar a ordem, e
   * o primeiro clique de quem nunca conectou cairia num 409 ("instância ainda
   * não criada") que não diz nada a quem está olhando.
   *
   * O QR do WhatsApp expira em ~20s: a tela chama isto de novo a cada renovação,
   * e por isso tudo aqui é idempotente.
   */
  static async qrcode(id_user) {
    return runWithLogs(log, "qrcode", () => ({ id_user }), async () => {
      const blocked = (await this._assertEnabled()) || this._assertConfigured();
      if (blocked) return blocked;

      const cfg = evolution.config();
      const name = instanceNameFor(id_user);

      try {
        await evolution.createInstance(cfg, name);
        const instance = await WhatsappStorage.ensureInstance(pool, id_user, name);
        const r = await evolution.connect(cfg, name);

        await WhatsappStorage.setInstanceStatus(
          pool,
          instance.evolution_instance,
          r.connected ? "connected" : "connecting",
          r.connected ? undefined : null
        );

        return {
          connected: r.connected,
          qr_base64: r.qrBase64,
          pairing_code: r.pairingCode,
        };
      } catch (e) {
        return this._evolutionError(e);
      }
    });
  }

  /**
   * Desconecta o aparelho. NÃO passa pela flag, de propósito: se o Painel de
   * Controle desligar a feature, quem já conectou tem que continuar podendo
   * desligar o próprio número. Porta de saída trancada é a única que não pode
   * existir (regra da mig 220).
   */
  static async disconnect(id_user) {
    return runWithLogs(log, "disconnect", () => ({ id_user }), async () => {
      const blocked = this._assertConfigured();
      if (blocked) return blocked;

      const instance = await WhatsappStorage.getInstanceByUser(pool, id_user);
      if (!instance) return { ok: true };

      try {
        await evolution.logout(evolution.config(), instance.evolution_instance);
      } catch (e) {
        // A sessão pode já ter caído do lado de lá. O estado local vale mais do
        // que o erro: deixar "conectado" aqui mentiria para a pessoa.
        log.warn("disconnect.evolution_failed", { id_user, message: e && e.message });
      }
      await WhatsappStorage.setInstanceStatus(
        pool,
        instance.evolution_instance,
        "disconnected",
        null,
        "user"
      );
      return { ok: true };
    });
  }

  /* ─────────────────────────────── a caixa ─────────────────────────────── */

  static async listConversations(id_user, { limit, offset, search } = {}) {
    return runWithLogs(log, "listConversations", () => ({ id_user }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;

      await WhatsappStorage.touchSeen(pool, id_user);
      const rows = await WhatsappStorage.listConversations(pool, id_user, {
        limit: Math.min(Number(limit) || 40, 100),
        offset: Math.max(Number(offset) || 0, 0),
        search: String(search || "").trim().slice(0, 60),
      });
      return { conversations: rows.map((c) => this._publicConversation(c)) };
    });
  }

  static async listMessages(id_user, id_conversation, { limit, before } = {}) {
    return runWithLogs(log, "listMessages", () => ({ id_user, id_conversation }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;

      const conversation = await WhatsappStorage.getConversation(pool, id_user, id_conversation);
      if (!conversation) return { error: "Conversa não encontrada.", statusCode: 404 };

      const messages = await WhatsappStorage.listMessages(pool, id_conversation, {
        limit: Math.min(Number(limit) || 50, 100),
        before: before || null,
      });
      // Abrir é ler: zera aqui, e não numa rota separada que a tela poderia
      // esquecer de chamar.
      await WhatsappStorage.markRead(pool, id_user, id_conversation);

      return {
        conversation: this._publicConversation(conversation),
        messages,
      };
    });
  }

  /**
   * Responde a conversa. Aqui — e só aqui — a Freelandoo escreve no WhatsApp de
   * alguém, e sempre porque a pessoa clicou em enviar.
   *
   * A mensagem é gravada DEPOIS de a Evolution aceitar: gravar antes deixaria na
   * tela uma resposta que o destinatário nunca recebeu, que é a pior das duas
   * falhas possíveis (a outra — o eco do webhook chegar primeiro — o índice
   * UNIQUE do `wa_message_id` resolve sozinho).
   */
  static async sendText(id_user, id_conversation, text) {
    return runWithLogs(log, "sendText", () => ({ id_user, id_conversation }), async () => {
      const blocked = (await this._assertEnabled()) || this._assertConfigured();
      if (blocked) return blocked;

      const body = String(text || "").trim();
      if (!body) return { error: "Mensagem obrigatória.", statusCode: 400 };
      if (body.length > MAX_TEXT) return { error: "Mensagem muito longa.", statusCode: 400 };

      const conversation = await WhatsappStorage.getConversation(pool, id_user, id_conversation);
      if (!conversation) return { error: "Conversa não encontrada.", statusCode: 404 };
      if (conversation.instance_status !== "connected") {
        return { error: "Conecte o WhatsApp para responder.", statusCode: 409 };
      }

      // Grupo endereça pelo JID inteiro; pessoa, pelo telefone. Reduzir o JID de
      // um grupo a dígitos produziria um telefone inexistente.
      const destination = conversation.is_group ? conversation.remote_jid : conversation.phone;

      let waMessageId = null;
      try {
        waMessageId = await evolution.sendText(
          evolution.config(),
          conversation.evolution_instance,
          destination,
          body
        );
      } catch (e) {
        return this._evolutionError(e);
      }

      const sentAt = new Date();
      const saved = await WhatsappStorage.insertMessage(pool, {
        id_conversation,
        wa_message_id: waMessageId,
        direction: "out",
        sender_label: null,
        body,
        media_type: "text",
        sent_at: sentAt,
      });
      await WhatsappStorage.touchConversation(pool, id_conversation, {
        preview: body,
        sent_at: sentAt,
        inc_unread: false,
      });

      // `saved` é null quando o eco do webhook chegou antes da nossa gravação —
      // a mensagem existe, e devolver erro aqui faria a tela repetir o envio.
      return {
        message:
          saved || {
            id_message: null,
            wa_message_id: waMessageId,
            direction: "out",
            sender_label: null,
            body,
            media_type: "text",
            sent_at: sentAt,
          },
      };
    });
  }

  /**
   * O binário de uma mídia recebida, buscado na Evolution na hora.
   *
   * Não guardamos o arquivo: ele é de terceiro, que nunca consentiu com a
   * Freelandoo, e ficaria em repouso no nosso R2 por prazo indefinido. O
   * controller devolve os bytes direto, sem passar por armazenamento.
   */
  static async media(id_user, id_message) {
    return runWithLogs(log, "media", () => ({ id_user, id_message }), async () => {
      const blocked = (await this._assertEnabled()) || this._assertConfigured();
      if (blocked) return blocked;

      const row = await WhatsappStorage.getMessage(pool, id_user, id_message);
      if (!row) return { error: "Mensagem não encontrada.", statusCode: 404 };
      if (row.media_type === "text" || !row.wa_message_id) {
        return { error: "Esta mensagem não tem mídia.", statusCode: 400 };
      }

      try {
        const file = await evolution.fetchMedia(
          evolution.config(),
          row.evolution_instance,
          row.wa_message_id
        );
        return { file };
      } catch (e) {
        return this._evolutionError(e);
      }
    });
  }

  /* ─────────────────────────────── sweeper ─────────────────────────────── */

  /**
   * Desliga a sessão de quem não abre a caixa há `IDLE_DAYS` dias.
   *
   * ⚠️ DESLIGAR NÃO É PERDER MENSAGEM, e é isso que torna o corte aceitável: a
   * nossa sessão é um APARELHO CONECTADO do WhatsApp da pessoa, como o
   * WhatsApp Web. Derrubá-la não afeta o número — as mensagens seguem chegando
   * no celular dela — e o histórico já recebido continua aqui. O que ela perde
   * é a entrada de mensagens NOVAS nesta caixa até reconectar, e a tela diz
   * isso com todas as letras quando ela volta (`disconnect_reason = 'idle'`).
   *
   * O estado local é gravado MESMO SE a Evolution recusar o logout: se a sessão
   * já caiu do lado de lá, insistir em chamá-la a cada 6h para sempre seria uma
   * fila que nunca esvazia.
   */
  static async sweepIdleInstances() {
    if (!(IDLE_DAYS > 0)) return 0;
    const cfg = evolution.config();
    if (!cfg) return 0;

    try {
      const rows = await WhatsappStorage.listIdleInstances(pool, IDLE_DAYS);
      let closed = 0;
      for (const row of rows) {
        try {
          await evolution.logout(cfg, row.evolution_instance);
        } catch (e) {
          log.warn("sweep.logout_failed", {
            instance: row.evolution_instance,
            message: e && e.message,
          });
        }
        await WhatsappStorage.setInstanceStatus(
          pool,
          row.evolution_instance,
          "disconnected",
          null,
          "idle"
        );
        realtime.emitToUser(row.id_user, "whatsapp:status", {
          status: "disconnected",
          number: "",
          disconnect_reason: "idle",
        });
        closed++;
      }
      if (closed) log.info("whatsapp.sweep", { closed, idle_days: IDLE_DAYS });
      return closed;
    } catch (err) {
      log.error("sweepIdleInstances.fail", { error: err && err.message });
      return 0;
    }
  }

  static startSweeper() {
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    this.sweepIdleInstances().catch(() => {});
    const timer = setInterval(() => {
      this.sweepIdleInstances().catch(() => {});
    }, SIX_HOURS);
    if (typeof timer.unref === "function") timer.unref();
    return timer;
  }

  /* ──────────────────────────────── apoio ──────────────────────────────── */

  /**
   * Projeção da conversa. Enxuta campo a campo: `id_instance` e
   * `evolution_instance` NÃO saem daqui — o nome da instância é a chave de
   * roteamento do webhook, e publicá-lo daria a quem quisesse o endereço exato
   * para tentar se passar por essa caixa.
   */
  static _publicConversation(c) {
    return {
      id_conversation: c.id_conversation,
      phone: c.phone || "",
      phone_display: formatPhone(c.phone),
      // Sem nome de perfil, o telefone formatado é o melhor título. Sem os dois
      // (grupo sem assunto sincronizado), a tela decide o rótulo.
      title: c.push_name || formatPhone(c.phone) || "",
      is_group: c.is_group,
      unread_count: c.unread_count || 0,
      last_message_at: c.last_message_at,
      last_message_preview: c.last_message_preview || "",
    };
  }

  /** Erro da Evolution vira `{ error }` com o status que ela deu. */
  static _evolutionError(e) {
    if (e && e.name === "EvolutionError") {
      return { error: e.message, statusCode: e.statusCode || 502 };
    }
    log.error("evolution.unexpected", { message: e && e.message });
    return { error: "Falha ao falar com o WhatsApp.", statusCode: 502 };
  }
}

module.exports = WhatsappService;
