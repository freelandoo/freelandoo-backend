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
//    Sem as credenciais da Meta (`META_APP_ID`, `META_APP_SECRET`,
//    `META_SYSTEM_USER_TOKEN`, `META_WABA_ID`) a resposta é "não configurado",
//    dita em voz alta — nunca um botão que só falha depois do clique.
//
// 4. ENVIAR É SEMPRE UM CLIQUE DO DONO. A ingestão não conhece este módulo, e
//    não existe caminho automático de uma mensagem que chega até uma que sai.
//
// ─── POR QUE DESCONECTAR NÃO APAGA NADA ─────────────────────────────────────
//
// Desconectar tira o número do nosso WABA e zera o status aqui, mas a instância
// e as conversas FICAM. Quem desliga por engano (ou é desligado pelo painel de
// admin) volta e encontra a caixa como deixou; apagar transformaria um clique
// numa perda de histórico que ninguém pediu.

const pool = require("../databases");
const WhatsappStorage = require("../storages/WhatsappStorage");
// ⚠️ O REGISTRO DE PROVEDORES entra AQUI, no Service, e NUNCA no
// `WhatsappIngestService`. A ingestão não pode ter caminho de código até um
// envio: é isso, e não uma regra escrita, que garante que ninguém é respondido
// automaticamente pelo WhatsApp de um usuário — e é o que sustenta, perante a
// Meta, que a Freelandoo não opera ferramenta de disparo em massa (o gatilho
// declarado de ação legal dela desde 07/12/2019).
const whatsappProvider = require("../integrations/whatsappProvider");
const FeatureFlagService = require("./FeatureFlagService");
const realtime = require("../realtime/socket");
const { formatPhone, splitPhone } = require("../utils/whatsappJid");
const { publicConversation } = require("../utils/whatsappConversation");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("WhatsappService");

const FLAG = "whatsapp_atendimento";
// Teto do corpo de uma mensagem de texto do WhatsApp com folga: o que passa
// disso não é conversa, é payload.
const MAX_TEXT = 4096;
class WhatsappService {
  static async _assertEnabled() {
    const enabled = await FeatureFlagService.isEnabled(FLAG);
    if (!enabled) return { error: "Recurso indisponível no momento.", statusCode: 403 };
    return null;
  }

  /** `{ error }` quando NENHUM provedor tem credencial neste ambiente. */
  static _assertConfigured() {
    if (!whatsappProvider.isAnyAvailable()) {
      return {
        error:
          "A integração com o WhatsApp ainda não está configurada nesta instalação.",
        statusCode: 503,
      };
    }
    return null;
  }

  /**
   * O adaptador de uma instância gravada — e `null` quando o provedor DELA não
   * está configurado neste ambiente.
   *
   * A pergunta é por INSTÂNCIA, não por ambiente, e isso FICA mesmo agora que
   * só existe a Cloud API: **provedor sai da LINHA, nunca do ambiente** — é a
   * mesma lição do Asaas (mig 236), onde cobrança feita num provedor tem que
   * ser estornada nele mesmo. É essa regra que vai permitir o provedor da fase
   * 2 (Tech Provider) conviver com este sem migrar ninguém à força.
   */
  static _providerFor(instance) {
    const p = whatsappProvider.forInstance(instance);
    return p && p.isAvailable() ? p : null;
  }

  /* ──────────────────────────── status / conexão ───────────────────────── */

  /**
   * O que a aba WhatsApp desenha ao abrir.
   *
   * A Meta é a fonte da verdade do NÚMERO; o banco é cache. Quando ela não
   * responde (`null`), preservamos o último status conhecido em vez de piscar
   * "desconectado" — a pessoa veria a caixa dela virar um botão de conectar por
   * causa de um soluço de rede.
   *
   * ⚠️ `connecting` é preservado de propósito: é estado de PASSAGEM (o número
   * cadastrado esperando o código do SMS), e rebaixá-lo a "desconectado" faria
   * a pessoa recomeçar o cadastro com o código já a caminho.
   */
  /**
   * COMO esta pessoa conecta. Hoje a resposta é sempre `"number"` — a Cloud API
   * cadastra o número e confirma por código; QR era da Evolution, removida em
   * 2026-09-16.
   *
   * ⚠️ O CAMPO FICA, e derivado da CAPABILITY em vez de escrito à mão: é ele
   * que o front lê para escolher o fluxo, e no dia do provedor seguinte a tela
   * passa a desenhar o caminho certo sem deploy do front. Cravar a string aqui
   * seria pedir para alguém esquecer deste lugar.
   */
  static _pairingModeFor(instance) {
    const provider = instance
      ? this._providerFor(instance)
      : whatsappProvider.defaultProvider();
    if (!provider) return null;
    return provider.capabilities.qrPairing ? "qr" : "number";
  }

  static async status(id_user) {
    return runWithLogs(log, "status", () => ({ id_user }), async () => {
      const configured = whatsappProvider.isAnyAvailable();
      const instance = await WhatsappStorage.getInstanceByUser(pool, id_user);

      if (!instance) {
        return {
          configured,
          exists: false,
          status: "disconnected",
          number: "",
          pairing: this._pairingModeFor(null),
        };
      }

      // Abrir a aba é usar. Não há mais sweeper de ociosidade (ele era da
      // Evolution, que mantinha uma sessão Baileys de pé custando memória); a
      // Cloud API é STATELESS, e desligar quem não abre a caixa arrancaria a
      // integração de alguém sem motivo nenhum. O carimbo fica porque o painel
      // de admin responde "há quanto tempo ninguém olha para este número".
      await WhatsappStorage.touchSeen(pool, id_user);

      const provider = this._providerFor(instance);
      let status = instance.status;
      let quality = { rating: instance.quality_rating, status: instance.number_status };
      if (provider) {
        // `null` = o provedor não respondeu; o último status conhecido vale
        // mais do que piscar "desconectado" por causa de um soluço de rede.
        const snapshot = await provider.state(instance).catch(() => null);
        const open = snapshot && typeof snapshot.connected === "boolean" ? snapshot.connected : null;

        // W6 — a qualidade vem DE CARONA nesta mesma chamada.
        //
        // ⚠️ O GET do número já devolvia `quality_rating` e `status` desde o W1
        // e os dois eram DESCARTADOS aqui. Aproveitá-los custa zero chamada
        // nova, e é o que preenche quem conectou antes de existir monitor: o
        // webhook só avisa quando algo MUDA, então quem está estável há meses
        // nunca receberia um evento e ficaria para sempre sem dado no painel.
        //
        // E é a única fonte que sabe o RATING: o webhook de qualidade manda
        // evento, não GREEN/YELLOW/RED (ver `utils/whatsappCloudQuality`).
        if (snapshot && (snapshot.qualityRating || snapshot.numberStatus)) {
          const saved = await WhatsappStorage.setQuality(pool, instance.id_instance, {
            rating: snapshot.qualityRating || null,
            status: snapshot.numberStatus || null,
          }).catch(() => null);
          if (saved) quality = { rating: saved.quality_rating, status: saved.number_status };
        }
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
        configured,
        exists: true,
        status,
        pairing: this._pairingModeFor(instance),
        number: formatPhone(instance.connected_number),
        // Por que caiu. Desconectado silencioso é indistinguível de defeito:
        // sem isto, quem volta encontra o botão "Conectar" e conclui que o
        // produto quebrou. Hoje só existe um motivo ('user' — alguém desligou,
        // aqui ou no painel de admin): o sweeper de ociosidade saiu junto com a
        // Evolution, porque a Cloud API não mantém sessão de pé para expirar.
        disconnect_reason: status === "connected" ? null : instance.disconnect_reason || null,
        // A saúde do número, para a tela poder avisar o dono sem esperar ele
        // abrir o sino. `null` é "ainda não sabemos", nunca "está tudo bem".
        quality_rating: quality.rating || null,
        number_status: quality.status || null,
        unread: await WhatsappStorage.unreadTotal(pool, id_user),
      };
    });
  }

  /* ─────────────── W3 — cadastro de número (Cloud API) ─────────────────── */

  /**
   * O provedor da vez para uma conexão NOVA, exigindo cadastro de número.
   *
   * A pergunta é pela CAPABILITY e não pelo nome: um provedor futuro que também
   * cadastre número entra sem tocar aqui, e um provedor que NÃO cadastre é
   * recusado com a razão certa em vez de um erro genérico.
   */
  static _numberProviderFor(existing) {
    const provider = existing
      ? this._providerFor(existing)
      : whatsappProvider.defaultProvider();
    if (!provider) return { error: this._assertConfigured().error, statusCode: 503 };
    if (!provider.capabilities.numberRegistration) {
      return {
        error: "Este provedor conecta por QR Code, não por cadastro de número.",
        statusCode: 409,
      };
    }
    return { provider };
  }

  /**
   * Passo 1 — a pessoa informa o número e a Meta manda o código.
   *
   * ⚠️ O NÚMERO É SEPARADO EM DDI + RESTO porque a Graph API exige os dois
   * campos; mandar tudo junto falha com uma mensagem que não explica nada.
   * Brasil é o padrão quando quem digita não põe o DDI — que é o caso comum de
   * alguém que escreve o próprio celular como escreve para um amigo.
   *
   * ⚠️ A ORDEM É META PRIMEIRO, BANCO DEPOIS (regra da mig 223): se o cadastro
   * lá falhar, não fica uma linha local apontando para um número que não existe
   * do outro lado.
   */
  static async cloudAddNumber(id_user, { phone, display_name, method } = {}) {
    return runWithLogs(log, "cloudAddNumber", () => ({ id_user }), async () => {
      const blocked = (await this._assertEnabled()) || this._assertConfigured();
      if (blocked) return blocked;

      // A separação DDI/resto é função PURA (`utils/whatsappJid`) para ser
      // testável: errar a inferência do DDI cadastra na Meta um número que não
      // existe, e o sintoma só aparece quando o código não chega.
      const parsed = splitPhone(phone);
      if (!parsed) {
        return { error: "Informe o número com DDD, apenas dígitos.", statusCode: 400 };
      }
      const displayName = String(display_name || "").trim();
      if (displayName.length < 3) {
        return {
          error: "Informe o nome que vai aparecer para o cliente (mínimo 3 letras).",
          statusCode: 400,
        };
      }

      const existing = await WhatsappStorage.getInstanceByUser(pool, id_user);
      const picked = this._numberProviderFor(existing);
      if (picked.error) return picked;

      try {
        const r = await picked.provider.addNumber(existing || {}, {
          cc: parsed.cc,
          number: parsed.number,
          displayName,
          method,
        });

        // ⚠️ UPDATE na linha existente — as conversas pendem de `id_instance`
        // com CASCADE, e trocar a linha apagaria a caixa de entrada de quem
        // já tem conversas gravadas. Ver o comentário no storage.
        await WhatsappStorage.upsertCloudInstance(pool, id_user, {
          ref: r.ref,
          waba_id: r.waba,
          number: parsed.full,
        });

        return { needs_code: true, method: r.method, number: parsed.full };
      } catch (e) {
        return this._providerError(e);
      }
    });
  }

  /**
   * Passo 2 — a pessoa digita o código que chegou.
   *
   * Só promove para `connected` DEPOIS que o provedor confirmou os dois passos
   * (verificar + registrar). Marcar antes deixaria a tela dizendo "conectado"
   * para um número que não envia nem recebe nada.
   */
  static async cloudVerifyCode(id_user, code) {
    return runWithLogs(log, "cloudVerifyCode", () => ({ id_user }), async () => {
      const blocked = (await this._assertEnabled()) || this._assertConfigured();
      if (blocked) return blocked;

      const digits = String(code || "").replace(/\D/g, "");
      if (!digits) return { error: "Informe o código recebido.", statusCode: 400 };

      const instance = await WhatsappStorage.getInstanceByUser(pool, id_user);
      if (!instance || !instance.evolution_instance) {
        return { error: "Informe o número antes de confirmar o código.", statusCode: 409 };
      }

      const provider = this._providerFor(instance);
      if (!provider) return this._assertConfigured();
      if (!provider.capabilities.numberRegistration) {
        return { error: "Este provedor não usa código de verificação.", statusCode: 409 };
      }

      try {
        await provider.confirmCode(instance, digits);
      } catch (e) {
        return this._providerError(e);
      }

      await WhatsappStorage.setInstanceStatus(
        pool,
        instance.evolution_instance,
        "connected",
        instance.connected_number || undefined
      );

      realtime.emitToUser(id_user, "whatsapp:status", {
        status: "connected",
        number: formatPhone(instance.connected_number),
      });

      return { connected: true, number: instance.connected_number || "" };
    });
  }

  /** Reenvia o código — o SMS se perde, e sem isto a saída é recomeçar. */
  static async cloudResendCode(id_user, method) {
    return runWithLogs(log, "cloudResendCode", () => ({ id_user }), async () => {
      const blocked = (await this._assertEnabled()) || this._assertConfigured();
      if (blocked) return blocked;

      const instance = await WhatsappStorage.getInstanceByUser(pool, id_user);
      if (!instance || !instance.evolution_instance) {
        return { error: "Informe o número primeiro.", statusCode: 409 };
      }
      const provider = this._providerFor(instance);
      if (!provider || !provider.capabilities.numberRegistration) {
        return { error: "Este provedor não usa código de verificação.", statusCode: 409 };
      }

      try {
        await provider.requestCode(instance, method);
        return { ok: true };
      } catch (e) {
        return this._providerError(e);
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
        const provider = this._providerFor(instance);
        if (provider) await provider.disconnect(instance);
      } catch (e) {
        // A sessão pode já ter caído do lado de lá. O estado local vale mais do
        // que o erro: deixar "conectado" aqui mentiria para a pessoa.
        log.warn("disconnect.provider_failed", { id_user, message: e && e.message });
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
   * AVISO DA PLATAFORMA NO WHATSAPP DO PRÓPRIO DONO (2026-09-08).
   *
   * ─── O QUE ISTO NÃO É ─────────────────────────────────────────────────────
   *
   * ⚠️ NÃO é resposta automática, e a regra 4 do topo continua inteira: a
   * ingestão (`WhatsappIngestService`) segue sem conhecer este módulo, e não
   * existe caminho de código de uma mensagem que CHEGA até uma que sai. O que
   * dispara isto é um AGENDAMENTO CONFIRMADO dentro da Freelandoo — um fato do
   * nosso lado, não uma mensagem de terceiro.
   *
   * ─── O DESTINO É SEMPRE O NÚMERO DE QUEM CONECTOU ─────────────────────────
   *
   * `dest` não existe nesta função de propósito: a única saída possível é o
   * `connected_number` da própria instância. É isso que impede o aviso de virar
   * um canal para a plataforma escrever no WhatsApp de terceiros — a pessoa
   * recebe no "recado para mim mesmo", que é onde o WhatsApp já coloca o que
   * alguém manda para o próprio número.
   *
   * ─── NÃO GRAVA A MENSAGEM ─────────────────────────────────────────────────
   *
   * `sendText` grava porque a tela do dono está aberta esperando ver a resposta
   * aparecer. Aqui não há tela: o eco do próprio envio volta pelo webhook e a
   * ingestão o registra como qualquer outra mensagem. Gravar aqui também
   * duplicaria a linha (o dedupe é por `wa_message_id`, que só o eco traz nos
   * dois lados).
   *
   * ─── SILENCIOSO POR CONSTRUÇÃO ────────────────────────────────────────────
   *
   * Devolve `{ sent: false, reason }` em vez de erro: quem chama é um aviso
   * fire-and-forget de um agendamento que JÁ está pago e confirmado. WhatsApp
   * desligado, flag fora do ar ou Evolution mal-humorada não podem virar falha
   * do agendamento — o aviso é acréscimo, nunca a entrega.
   */
  static async notifyOwner(id_user, text) {
    return runWithLogs(log, "notifyOwner", () => ({ id_user }), async () => {
      if (!id_user) return { sent: false, reason: "no_user" };

      const body = String(text || "").trim().slice(0, MAX_TEXT);
      if (!body) return { sent: false, reason: "empty" };

      // Flag primeiro: ela é o kill-switch do WhatsApp inteiro, e um aviso que
      // ignorasse o desligamento seria justamente o que o kill-switch existe
      // para impedir.
      if (!(await FeatureFlagService.isEnabled(FLAG))) {
        return { sent: false, reason: "flag_off" };
      }
      const instance = await WhatsappStorage.getInstanceByUser(pool, id_user);
      if (!instance) return { sent: false, reason: "no_instance" };

      const provider = this._providerFor(instance);
      if (!provider) return { sent: false, reason: "not_configured" };
      // Sessão caída não enfileira: a Evolution recusaria, e insistir mais tarde
      // entregaria o "novo agendamento" de ontem como se fosse de agora.
      if (instance.status !== "connected") return { sent: false, reason: "not_connected" };
      if (!instance.connected_number) return { sent: false, reason: "no_number" };

      try {
        await provider.sendText(instance, instance.connected_number, body);
        return { sent: true };
      } catch (e) {
        log.warn("notifyOwner.fail", { id_user, error: e.message });
        return { sent: false, reason: "provider_error" };
      }
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

      // A conversa carrega o provedor da instância dela — responder usa o MESMO
      // transporte por onde a mensagem chegou.
      const provider = this._providerFor(conversation);
      if (!provider) return this._assertConfigured();

      // ⚠️ A JANELA DE 24H É CONFERIDA AQUI, ANTES de falar com a Meta.
      //
      // Fora dela a Cloud API recusa texto livre — só template aprovado passa.
      // Deixar a recusa chegar como erro de API faria a pessoa escrever a
      // resposta inteira, apertar enviar, esperar a ida à Meta e só então
      // descobrir. Recusando antes, a tela desabilita o campo e explica.
      //
      // Só o cliente reabre a janela, escrevendo. Não há nada que o dono do
      // número possa fazer deste lado — e é por isso que a mensagem diz isso
      // em vez de sugerir "tente de novo".
      //
      // A Evolution não tem janela (`serviceWindow: false`) e passa direto.
      if (provider.capabilities.serviceWindow) {
        const until = conversation.service_window_expires_at
          ? new Date(conversation.service_window_expires_at)
          : null;
        if (!until || until.getTime() <= Date.now()) {
          return {
            error:
              "A janela de 24h desta conversa fechou. Só é possível responder" +
              " depois que a pessoa escrever de novo.",
            statusCode: 409,
            code: "service_window_closed",
          };
        }
      }

      let waMessageId = null;
      try {
        waMessageId = await provider.sendText(conversation, destination, body);
      } catch (e) {
        return this._providerError(e);
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
        const provider = this._providerFor(row);
        if (!provider) return this._assertConfigured();
        const file = await provider.fetchMedia(row, row.wa_message_id);
        return { file };
      } catch (e) {
        return this._providerError(e);
      }
    });
  }

  /**
   * A projeção mora em `utils/whatsappConversation` porque o PUSH do
   * `WhatsappIngestService` precisa da MESMA — e ele não pode importar este
   * service, que carrega o provedor de envio. Ver o comentário do util.
   */
  static _publicConversation(c) {
    return publicConversation(c);
  }

  /**
   * Erro do PROVEDOR vira `{ error }` com o status que ele deu.
   *
   * Os dois adaptadores lançam erro nomeado (`EvolutionError`, `CloudApiError`)
   * justamente para que a mensagem deles chegue à tela: quando o provedor tem
   * algo a dizer — número já em uso, sessão caída, janela fechada —, é a fala
   * dele que ajuda quem está olhando. O que não é reconhecido vira uma frase
   * genérica, porque texto interno de biblioteca na tela não ajuda ninguém.
   */
  static _providerError(e) {
    if (e && (e.name === "EvolutionError" || e.name === "CloudApiError")) {
      return { error: e.message, statusCode: e.statusCode || 502 };
    }
    log.error("whatsapp.provider_unexpected", { message: e && e.message });
    return { error: "Falha ao falar com o WhatsApp.", statusCode: 502 };
  }
}

module.exports = WhatsappService;
