// src/services/AiReplyWorker.js
// AS MÃOS: tira trabalho da fila, pergunta ao cérebro e ENVIA a resposta.
//
// ═══ ⚠️ ESTE É O ÚNICO ARQUIVO DO SUBSISTEMA DE IA QUE PODE ENVIAR ══════════
//
// A ingestão de WhatsApp (`WhatsappCloudIngestService`) NÃO alcança nenhum
// módulo de envio — ela só escreve uma linha na fila, e
// `test/unit/whatsappIngestIsolation.test.js` prova isso pelo fecho transitivo
// dos `require`. A fila no meio é o que permite responder sem reabrir aquele
// caminho, e não é cerimônia: ela também é o que impede a latência do modelo de
// estourar os 22 segundos do webhook da Meta e disparar re-entrega em cascata.
//
// ─── ⚠️ O ENVIO DE WHATSAPP PASSA POR `WhatsappService.sendText`, SEMPRE ────
//
// NUNCA chamar `integrations/whatsappProvider` direto daqui. A checagem da
// JANELA DE 24H mora no Service, não no provider — o próprio provider diz isso
// no comentário dele. Chamando o provider direto, a janela deixaria de ser
// conferida e a plataforma passaria a tentar mensagem fora dela: é exatamente o
// comportamento que a Meta lê como envio não solicitado, num número que na fase
// 1 é do Business Portfolio da Freelandoo — ou seja, com o número de todos os
// clientes no mesmo risco.
//
// `test/unit/aiReplyIsolation.test.js` trava isso.
//
// ─── O QUE ESTE ATENDENTE NUNCA FAZ ─────────────────────────────────────────
//
//   • não INICIA conversa: todo trabalho nasce de uma mensagem que CHEGOU;
//   • não usa template: só texto livre, e só dentro da janela;
//   • não responde a si mesmo (mensagem `out` não enfileira);
//   • e não responde duas vezes à mesma mensagem (dedupe da mig 253).
const pool = require("../databases");
const AiJobStorage = require("../storages/AiJobStorage");
const AtendimentoAiService = require("./AtendimentoAiService");
const FeatureFlagService = require("./FeatureFlagService");
const WhatsappStorage = require("../storages/WhatsappStorage");
const WhatsappService = require("./WhatsappService");
const ConversationService = require("./ConversationService");
const MessageStorage = require("../storages/MessageStorage");
const ServiceRequestService = require("./ServiceRequestService");
const ServiceRequestStorage = require("../storages/ServiceRequestStorage");
const ExtMessagingStorage = require("../storages/ExtMessagingStorage");
const DataExportStorage = require("../storages/DataExportStorage");
const { canUseAi } = require("../utils/aiAccess");
const { createLogger } = require("../utils/logger");

const log = createLogger("AiReplyWorker");

const TICK_MS = 5_000;
const LOTE = 3;
/** Depois disto o trabalho desiste — insistir só queima token. */
const MAX_TENTATIVAS = 4;
/** Espera entre tentativas, em segundos. */
const BACKOFF_S = [30, 120, 600];
const HISTORICO = 12;
/** Varredura de presos e poda da fila, de hora em hora. */
const MANUTENCAO_MS = 60 * 60 * 1000;

let tickTimer = null;
let manutencaoTimer = null;
let rodando = false;

/** A flag do canal. Canal novo entra aqui E ganha a flag na migration. */
const FLAG_DO_CANAL = {
  whatsapp: "atendimento_ai_whatsapp",
  dm: "atendimento_ai_freelandoo",
  os: "atendimento_ai_freelandoo",
};

/**
 * ⚠️ FAIL-CLOSED, ao contrário do `requireFeature` das rotas.
 *
 * Lá o fail-open é certo: um erro de infra não pode derrubar uma tela. Aqui a
 * consequência de errar é MANDAR MENSAGEM para o cliente de alguém com o
 * interruptor possivelmente desligado — o lado seguro do erro é o silêncio.
 */
async function canalLigado(canal) {
  try {
    const geral = await FeatureFlagService.isEnabled("atendimento_ai");
    if (!geral) return false;
    const chave = FLAG_DO_CANAL[canal];
    if (!chave) return false;
    return await FeatureFlagService.isEnabled(chave);
  } catch (err) {
    log.warn("flag.indisponivel", { canal, error: err.message });
    return false;
  }
}

class AiReplyWorker {
  static start() {
    if (tickTimer) return;
    tickTimer = setInterval(() => {
      this.tick().catch((err) => log.error("tick.fail", { error: err.message }));
    }, TICK_MS);
    if (tickTimer.unref) tickTimer.unref();

    manutencaoTimer = setInterval(() => {
      this.manutencao().catch((err) => log.error("manutencao.fail", { error: err.message }));
    }, MANUTENCAO_MS);
    if (manutencaoTimer.unref) manutencaoTimer.unref();

    // Uma passada no boot: solta o que ficou preso na queda anterior.
    this.manutencao().catch(() => {});
    log.info("worker.started", { tick_ms: TICK_MS });
  }

  static async manutencao() {
    const soltos = await AiJobStorage.releaseStuck(pool, 10);
    const podados = await AiJobStorage.purgeOld(pool, 30);
    if (soltos || podados) log.info("manutencao", { soltos, podados });
  }

  static async tick() {
    // Um tick por vez: dois em paralelo no mesmo processo dobrariam a chamada
    // de LLM sem dobrar a vazão útil.
    if (rodando) return;
    rodando = true;
    try {
      const lote = await AiJobStorage.claimDue(pool, LOTE);
      for (const job of lote) {
        await this.process(job).catch(async (err) => {
          log.error("process.fail", { id_job: job.id_job, error: err.message });
          await this._falhar(job, err.message, true).catch(() => {});
        });
      }
    } finally {
      rodando = false;
    }
  }

  /** Um trabalho: decide, pergunta e envia. */
  static async process(job) {
    const canal = job.channel;

    if (!(await canalLigado(canal))) {
      return AiJobStorage.finish(pool, job.id_job, {
        status: "skipped",
        skip_reason: "canal desligado no Painel de Controle",
      });
    }

    if (!(await canUseAi(pool, job.id_user))) {
      return AiJobStorage.finish(pool, job.id_job, {
        status: "skipped",
        skip_reason: "conta sem acesso ao Atendimento com IA",
      });
    }

    const ctx = await this._contexto(job);
    if (ctx.skip) {
      return AiJobStorage.finish(pool, job.id_job, { status: "skipped", skip_reason: ctx.skip });
    }

    // ⚠️ SE O DONO JÁ RESPONDEU, A IA CALA. Entre a mensagem chegar e o worker
    // pegar o trabalho passam segundos — tempo de sobra para a pessoa responder
    // pelo celular. Responder por cima seria o atendente falando em cima do
    // dono, com o cliente vendo as duas.
    if (ctx.donoJaRespondeu) {
      return AiJobStorage.finish(pool, job.id_job, {
        status: "skipped",
        skip_reason: "o dono já respondeu esta conversa",
      });
    }

    const out = await AtendimentoAiService.answer({
      id_user: job.id_user,
      canal,
      historico: ctx.historico,
      nomeNegocio: ctx.nomeNegocio,
      id_job: job.id_job,
    });

    if (out.error) return this._falhar(job, out.error, out.retryable !== false);

    const enviado = await this._enviar(job, ctx, out.text);
    if (enviado.error) {
      // Recusa de REGRA (janela fechada, conversa sumiu) não é falha de infra:
      // tentar de novo daqui a pouco daria o mesmo resultado e queimaria outra
      // chamada de LLM — a resposta já foi gerada e paga.
      if (enviado.definitivo) {
        return AiJobStorage.finish(pool, job.id_job, {
          status: "skipped",
          answer: out.text,
          skip_reason: enviado.error,
        });
      }
      return this._falhar(job, enviado.error, true, out.text);
    }

    log.info("respondeu", {
      id_job: job.id_job,
      canal,
      provider: out.provider,
      tokens: out.input_tokens + out.output_tokens,
    });
    return AiJobStorage.finish(pool, job.id_job, { status: "done", answer: out.text });
  }

  static async _falhar(job, mensagem, retentavel, answer) {
    const tentativas = Number(job.attempts || 1);
    if (!retentavel || tentativas >= MAX_TENTATIVAS) {
      return AiJobStorage.finish(pool, job.id_job, {
        status: "failed",
        answer: answer || null,
        last_error: mensagem,
      });
    }
    const espera = BACKOFF_S[Math.min(tentativas - 1, BACKOFF_S.length - 1)];
    return AiJobStorage.retryLater(pool, job.id_job, { seconds: espera, last_error: mensagem });
  }

  /** Histórico, nome do negócio e o que mais o canal precisa para responder. */
  static async _contexto(job) {
    const nomeNegocio = await this._nomeNegocio(job.id_user);

    if (job.channel === "whatsapp") {
      const conversa = await WhatsappStorage.getConversation(pool, job.id_user, job.ref_id);
      if (!conversa) return { skip: "conversa de WhatsApp não encontrada" };
      if (conversa.is_group) return { skip: "conversa de grupo — o atendente não responde em grupo" };

      const msgs = await WhatsappStorage.listMessages(pool, job.ref_id, { limit: HISTORICO });
      const ordenadas = [...msgs].sort((a, b) => new Date(a.sent_at) - new Date(b.sent_at));
      // Quem responde depois da mensagem que disparou já é o dono, pelo celular.
      const disparo = ordenadas.findIndex((m) => m.wa_message_id === job.trigger_message_id);
      const donoJaRespondeu =
        disparo >= 0 && ordenadas.slice(disparo + 1).some((m) => m.direction === "out");

      return {
        conversa,
        nomeNegocio,
        donoJaRespondeu,
        historico: ordenadas.map((m) => ({
          role: m.direction === "out" ? "assistant" : "user",
          content: m.body,
        })),
      };
    }

    if (job.channel === "dm") {
      const escopo = await ExtMessagingStorage.getDmInScope(pool, {
        id_conversation: job.ref_id,
        id_user: job.id_user,
        scope_personal: true,
        connected_at: null,
      });
      if (!escopo) return { skip: "conversa não encontrada ou não é desta conta" };

      const msgs = await MessageStorage.listByConversation(pool, {
        id_conversation: job.ref_id,
        limit: HISTORICO,
      });
      const ordenadas = [...(msgs || [])].sort(
        (a, b) => new Date(a.created_at) - new Date(b.created_at)
      );
      const meu = String(escopo.my_profile_id);
      const disparo = ordenadas.findIndex((m) => String(m.id_message) === String(job.trigger_message_id));
      const donoJaRespondeu =
        disparo >= 0 &&
        ordenadas.slice(disparo + 1).some((m) => String(m.sender_entity_id) === meu);

      return {
        my_profile_id: escopo.my_profile_id,
        nomeNegocio,
        donoJaRespondeu,
        historico: ordenadas.map((m) => ({
          role: String(m.sender_entity_id) === meu ? "assistant" : "user",
          content: m.body,
        })),
      };
    }

    // O.S.
    const escopo = await ExtMessagingStorage.getOsInScope(pool, {
      id_response: job.ref_id,
      id_user: job.id_user,
    });
    if (!escopo) return { skip: "O.S. não encontrada ou não é desta conta" };

    const msgs = await ServiceRequestStorage.listMessages(pool, job.ref_id);
    const ordenadas = [...(msgs || [])].sort(
      (a, b) => new Date(a.created_at) - new Date(b.created_at)
    );
    const disparo = ordenadas.findIndex((m) => String(m.id_message) === String(job.trigger_message_id));
    const donoJaRespondeu =
      disparo >= 0 && ordenadas.slice(disparo + 1).some((m) => m.sender === "PRO");

    return {
      nomeNegocio,
      donoJaRespondeu,
      historico: ordenadas.map((m) => ({
        role: m.sender === "PRO" ? "assistant" : "user",
        content: m.content,
      })),
    };
  }

  /**
   * Envia pelo canal certo.
   *
   * `definitivo: true` quer dizer "não adianta tentar de novo" — recusa de
   * regra, não de infra.
   */
  static async _enviar(job, ctx, texto) {
    if (job.channel === "whatsapp") {
      // ⚠️ PELO SERVICE, NUNCA PELO PROVIDER: é o Service que confere a janela
      // de 24h ANTES de falar com a Meta. Ver o cabeçalho deste arquivo.
      const r = await WhatsappService.sendText(job.id_user, job.ref_id, texto);
      if (r?.error) {
        // Janela fechada é o caso comum e é DEFINITIVO: só o cliente reabre,
        // escrevendo de novo — e aí nasce outro trabalho.
        return { error: r.error, definitivo: r.code === "service_window_closed" || r.statusCode === 404 };
      }
      return { ok: true };
    }

    if (job.channel === "dm") {
      const r = await ConversationService.sendMessage(
        { id_user: job.id_user },
        {
          id_conversation: job.ref_id,
          actor_id: ctx.my_profile_id,
          actor_type: "profile",
          body: texto,
        },
        // O selo que separa, na tela do dono, o que ele escreveu do que o
        // atendente escreveu por ele.
        { sent_via: "ai" }
      );
      if (r?.error) return { error: r.error, definitivo: r.status === 403 };
      return { ok: true };
    }

    const r = await ServiceRequestService.sendMessage(
      { id_user: job.id_user },
      job.ref_id,
      { content: texto },
      { sent_via: "ai" }
    );
    if (r?.error) return { error: r.error, definitivo: r.statusCode === 403 };
    return { ok: true };
  }

  /** O nome que o atendente usa para se apresentar. */
  static async _nomeNegocio(id_user) {
    try {
      const perfis = await DataExportStorage.listProfiles(pool, id_user);
      const conta = perfis.find((p) => p.is_user_account) || perfis[0];
      return conta?.display_name || conta?.username || "este negócio";
    } catch {
      return "este negócio";
    }
  }
}

module.exports = AiReplyWorker;
