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
// ⚠️ O REGISTRO DE PROVEDORES entra AQUI, no Service, e NUNCA no
// `WhatsappIngestService`. A ingestão não pode ter caminho de código até um
// envio: é isso, e não uma regra escrita, que garante que ninguém é respondido
// automaticamente pelo WhatsApp de um usuário — e é o que sustenta, perante a
// Meta, que a Freelandoo não opera ferramenta de disparo em massa (o gatilho
// declarado de ação legal dela desde 07/12/2019).
const whatsappProvider = require("../integrations/whatsappProvider");
const FeatureFlagService = require("./FeatureFlagService");
const realtime = require("../realtime/socket");
const { instanceNameFor } = require("../utils/whatsappInstance");
const { formatPhone, splitPhone } = require("../utils/whatsappJid");
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
   * A pergunta é por INSTÂNCIA, não por ambiente: quem conectou pela Evolution
   * continua na Evolution mesmo depois de a plataforma inteira passar a abrir
   * conexões novas na Cloud API. **Provedor sai da LINHA, nunca do ambiente** —
   * é a mesma lição do Asaas (mig 236), onde cobrança feita num provedor tem
   * que ser estornada nele mesmo.
   */
  static _providerFor(instance) {
    const p = whatsappProvider.forInstance(instance);
    return p && p.isAvailable() ? p : null;
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
  /**
   * COMO esta pessoa conecta: lendo um QR ou cadastrando o número.
   *
   * ⚠️ A tela não pode adivinhar isso, e adivinhar errado é caro nos dois
   * sentidos: desenhar QR para a Cloud API mostra uma caixa vazia para sempre
   * (ela não tem QR), e pedir número para a Evolution manda a pessoa digitar
   * algo que ninguém vai usar.
   *
   * A resposta é a CAPABILITY do provedor — da instância dela quando já existe
   * uma (quem conectou pela Evolution continua na Evolution), e do padrão do
   * ambiente para uma conexão nova.
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

      // Abrir a aba é usar: é isto que segura a sessão de pé (ver IDLE_DAYS).
      await WhatsappStorage.touchSeen(pool, id_user);

      const provider = this._providerFor(instance);
      let status = instance.status;
      if (provider) {
        // `null` = o provedor não respondeu; o último status conhecido vale
        // mais do que piscar "desconectado" por causa de um soluço de rede.
        const open = await provider
          .state(instance)
          .then((r) => (r && typeof r.connected === "boolean" ? r.connected : null))
          .catch(() => null);
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

      const name = instanceNameFor(id_user);

      try {
        // A instância existente manda no provedor; só uma conexão NOVA cai no
        // padrão do ambiente. É o que impede alguém que já está pareado na
        // Evolution de receber, no meio de uma renovação de QR, uma tela de
        // cadastro de número da Cloud API.
        const existing = await WhatsappStorage.getInstanceByUser(pool, id_user);
        const provider = existing
          ? this._providerFor(existing)
          : whatsappProvider.defaultProvider();
        if (!provider) return this._assertConfigured();

        // Quem não parea por QR não passa por aqui: a Cloud API cadastra o
        // número e confirma por código (W3). Dizer isso é melhor do que
        // devolver um QR vazio que a tela tentaria desenhar.
        if (!provider.capabilities.qrPairing) {
          return {
            error: "Este provedor não usa QR Code para conectar.",
            statusCode: 409,
          };
        }

        // ⚠️ O PROVEDOR VEM ANTES DO BANCO, e a ordem é a da mig 223: se a
        // criação lá falhar, não fica uma linha local apontando para uma
        // instância que não existe do outro lado. Para conexão nova o `ref` é
        // derivado do id_user — o mesmo que `ensureInstance` vai gravar.
        const ref = existing || { provider: provider.provider, evolution_instance: name };
        await provider.ensure(ref);

        const instance = existing || (await WhatsappStorage.ensureInstance(pool, id_user, name));
        const r = await provider.connect(instance);

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

  /* ─────────────── W3 — cadastro de número (Cloud API) ─────────────────── */

  /**
   * O provedor da vez para uma conexão NOVA, exigindo cadastro de número.
   *
   * A pergunta é pela CAPABILITY e não pelo nome: um provedor futuro que também
   * cadastre número entra sem tocar aqui, e a Evolution — que pareia por QR —
   * é recusada com a razão certa em vez de um erro genérico.
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
        // está migrando da Evolution. Ver o comentário no storage.
        await WhatsappStorage.upsertCloudInstance(pool, id_user, {
          ref: r.ref,
          waba_id: r.waba,
          number: parsed.full,
        });

        return { needs_code: true, method: r.method, number: parsed.full };
      } catch (e) {
        return this._evolutionError(e);
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
        return this._evolutionError(e);
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

      let waMessageId = null;
      try {
        // A conversa carrega o provedor da instância dela — responder usa o
        // MESMO transporte por onde a mensagem chegou.
        const provider = this._providerFor(conversation);
        if (!provider) return this._assertConfigured();
        waMessageId = await provider.sendText(conversation, destination, body);
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
        const provider = this._providerFor(row);
        if (!provider) return this._assertConfigured();
        const file = await provider.fetchMedia(row, row.wa_message_id);
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
    if (!whatsappProvider.isAnyAvailable()) return 0;

    try {
      const rows = await WhatsappStorage.listIdleInstances(pool, IDLE_DAYS);
      let closed = 0;
      for (const row of rows) {
        const provider = this._providerFor(row);
        // ⚠️ O SWEEPER SÓ VALE PARA QUEM TEM SESSÃO DE PÉ.
        //
        // Ele existe porque a Evolution mantém uma sessão Baileys viva por
        // número, e ela custa memória mesmo de quem conectou e sumiu. A Cloud
        // API é STATELESS: não há sessão a desligar, e derrubar um cliente
        // oficial por ociosidade arrancaria a integração dele sem motivo
        // nenhum — em silêncio, 30 dias depois de ele conectar.
        //
        // Quem declara isso é o provedor (`capabilities.idleSession`), e não um
        // `if (provider === 'evolution')` aqui: provedor novo sem sessão herda
        // a isenção sem ninguém lembrar de vir editar este laço.
        if (!provider || !provider.capabilities.idleSession) continue;

        try {
          await provider.disconnect(row);
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

  /**
   * Erro do PROVEDOR vira `{ error }` com o status que ele deu.
   *
   * Os dois adaptadores lançam erro nomeado (`EvolutionError`, `CloudApiError`)
   * justamente para que a mensagem deles chegue à tela: quando o provedor tem
   * algo a dizer — número já em uso, sessão caída, janela fechada —, é a fala
   * dele que ajuda quem está olhando. O que não é reconhecido vira uma frase
   * genérica, porque texto interno de biblioteca na tela não ajuda ninguém.
   */
  static _evolutionError(e) {
    if (e && (e.name === "EvolutionError" || e.name === "CloudApiError")) {
      return { error: e.message, statusCode: e.statusCode || 502 };
    }
    log.error("whatsapp.provider_unexpected", { message: e && e.message });
    return { error: "Falha ao falar com o WhatsApp.", statusCode: 502 };
  }
}

module.exports = WhatsappService;
