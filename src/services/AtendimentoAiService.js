// src/services/AtendimentoAiService.js
// O CÉREBRO: recebe uma pergunta e o histórico, lê o dossiê e devolve a
// resposta. Não envia nada — quem envia é o worker (A4).
//
// ─── ⚠️ A REGRA QUE SUSTENTA O PRODUTO INTEIRO: NÃO INVENTAR ────────────────
//
// Este atendente responde PREÇO, ENDEREÇO e HORÁRIO em nome de um negócio de
// verdade, por escrito, para um cliente de verdade. Um número inventado não é
// um bug de tela: é uma promessa comercial que alguém vai ter que honrar no
// balcão — ou desmentir na frente do cliente, que é pior.
//
// Por isso a instrução mais forte do prompt não é "seja útil", é "o que não
// está no dossiê você NÃO sabe". E o desenho todo empurra para isso:
//
//   • o dossiê carrega só fato gravado (AiContextService);
//   • `temperature` baixa, porque aqui criatividade é risco;
//   • e a saída de emergência é explícita — "vou confirmar com o responsável"
//     é uma resposta ACEITÁVEL, e o prompt diz isso em voz alta. Sem uma saída
//     honesta declarada, o modelo preenche o vazio, que é exatamente o que não
//     pode acontecer.
//
// ─── POR QUE DOIS PROVEDORES ────────────────────────────────────────────────
//
// Não é gosto: é a reserva. Quando a principal devolve 429 ou cai, o atendente
// não pode emudecer na frente de um cliente que está esperando. Ele tenta a
// segunda. Erro que NÃO é de disponibilidade (401, 400) não cai para a reserva
// — chave errada não melhora trocando de provedor, e insistir só queima token.
const pool = require("../databases");
const AiProviderStorage = require("../storages/AiProviderStorage");
const AiJobStorage = require("../storages/AiJobStorage");
const AiContextService = require("./AiContextService");
const AiSettingsService = require("./AiSettingsService");
const AiRegistry = require("../integrations/ai");
const { open } = require("../utils/secretBox");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AtendimentoAiService");

/** Resposta curta é requisito, não economia — ver a regra 4 do prompt. */
const MAX_TOKENS = 500;
/** Perto de zero: aqui o que se quer é fidelidade ao dossiê, não invenção. */
const TEMPERATURA = 0.2;
/** Quantas mensagens anteriores entram. Conversa de atendimento é curta. */
const HISTORICO_MAX = 12;

/**
 * As regras de comportamento.
 *
 * ⚠️ MUDANÇA AQUI MUDA O QUE O CLIENTE LÊ. Não é configuração: é o produto.
 */
function montarSystem({ dossie, nomeNegocio, canal, primeiraResposta }) {
  return `Você é o atendente virtual de "${nomeNegocio}". Você responde clientes ${
    canal === "whatsapp" ? "no WhatsApp" : "nas mensagens da Freelandoo"
  }, em português do Brasil.

REGRA MAIS IMPORTANTE — NÃO INVENTE NADA.
Tudo que você afirmar sobre preço, endereço, horário, prazo, forma de pagamento,
disponibilidade ou condição comercial TEM que estar escrito no DOSSIÊ abaixo.
Se a informação não estiver lá, você NÃO SABE. Nunca estime, nunca arredonde,
nunca deduza "deve ser mais ou menos". É melhor dizer que vai confirmar do que
dar um número errado — o cliente vai cobrar esse número depois.
Quando não souber, responda assim: diga com naturalidade que vai confirmar com
o responsável e retornar, e aproveite para adiantar o que você SABE sobre o resto
da pergunta.

O QUE FAZER
1. Entenda o que a pessoa quer. Se o pedido estiver vago, responda o que já der
   para responder e faça UMA pergunta objetiva para fechar o resto.
2. Entregue o máximo de informação ÚTIL sobre o que ela perguntou. Se ela
   perguntou o preço de um serviço, diga o preço e também a duração e como
   marcar — poupe a próxima pergunta dela.
3. Seja curto e direto: no máximo 4 frases curtas. Isto é uma conversa, não um
   e-mail. Sem saudação longa, sem "espero ter ajudado", sem repetir a pergunta.
4. Escreva como uma pessoa do balcão escreveria: simples, cordial, sem formalidade
   exagerada e sem emoji em excesso (no máximo um, e só se couber).
5. Valores sempre como estão no dossiê, em reais. "Sob orçamento" quer dizer que
   o preço depende do caso — diga isso, e ofereça levantar o orçamento.

O QUE NÃO FAZER
- Não prometa em nome do negócio o que não está no dossiê (desconto, prazo de
  entrega, frete grátis, exceção, horário especial).
- Não diga que já agendou, reservou, separou ou registrou nada. Você não executa
  ações — você informa e encaminha.
- Não fale de assunto que não seja este negócio.
- Não invente avaliação, nota ou depoimento de cliente.
- Não peça dados sensíveis (cartão, senha, documento).
${
  primeiraResposta
    ? `
NESTA PRIMEIRA RESPOSTA
Diga em poucas palavras que você é o atendimento de "${nomeNegocio}" antes de
responder. Se perguntarem se você é um robô ou uma pessoa, responda a verdade:
você é um atendente automático e pode chamar o responsável quando for preciso.`
    : `
Se perguntarem se você é um robô ou uma pessoa, responda a verdade: você é um
atendente automático e pode chamar o responsável quando for preciso.`
}

===== DOSSIÊ (a única fonte de fatos) =====
${dossie}
===== FIM DO DOSSIÊ =====`;
}

class AtendimentoAiService {
  /**
   * Gera uma resposta.
   *
   * @param {object} p
   * @param {string} p.id_user        dono do atendimento (de quem é o dossiê)
   * @param {string} p.canal          'whatsapp' | 'dm' | 'os'
   * @param {Array}  p.historico      [{ role:'user'|'assistant', content }]
   * @param {string} p.nomeNegocio
   * @param {number} [p.id_job]       para amarrar o consumo ao trabalho
   * @returns {Promise<{ text, provider, model, input_tokens, output_tokens, cost_usd } | { error, retryable }>}
   */
  static async answer({ id_user, canal, historico, nomeNegocio, id_job }) {
    return runWithLogs(log, "answer", () => ({ id_user, canal, id_job }), async () => {
      const chaves = await AiProviderStorage.listUsable(pool);
      if (!chaves.length) {
        // Estado normal antes da primeira configuração: nada acontece, e o
        // motivo é dito em vez de virar silêncio.
        return { error: "Nenhum provedor de IA configurado no painel.", retryable: false };
      }

      const mensagens = (historico || [])
        .filter((m) => m && m.content && String(m.content).trim())
        .slice(-HISTORICO_MAX)
        .map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content).slice(0, 4000),
        }));

      if (!mensagens.length) return { error: "Nada para responder.", retryable: false };

      // ⚠️ A ÚLTIMA MENSAGEM TEM QUE SER DO CLIENTE. Os dois provedores recusam
      // um turno terminado em `assistant`, e a recusa chega como 400 — que não
      // é retentável, então a conversa morreria em silêncio.
      while (mensagens.length && mensagens[mensagens.length - 1].role === "assistant") {
        mensagens.pop();
      }
      if (!mensagens.length) return { error: "Nada para responder.", retryable: false };

      const dossieOut = await AiContextService.build(id_user);
      const system = montarSystem({
        dossie: dossieOut.text,
        nomeNegocio: nomeNegocio || "este negócio",
        canal,
        // Primeira resposta = ainda não falamos nada nesta conversa.
        primeiraResposta: !mensagens.some((m) => m.role === "assistant"),
      });

      let ultimoErro = null;
      for (const chave of chaves) {
        const adapter = AiRegistry.get(chave.provider);
        if (!adapter) {
          // Linha no banco para um provedor que o registry não conhece: aceita
          // pelo CHECK, sem adaptador aqui. Pula em vez de estourar.
          log.warn("provider.sem_adaptador", { provider: chave.provider });
          continue;
        }

        let apiKey;
        try {
          apiKey = open(chave.api_key_sealed);
        } catch {
          // Chave selada com uma cifra que não existe mais no ambiente.
          await AiProviderStorage.markResult(pool, chave.provider, {
            ok: false,
            error: "A chave não abre com a cifra atual — recadastre no painel.",
          });
          ultimoErro = { message: `${chave.provider}: chave ilegível`, retryable: false };
          continue;
        }

        try {
          const out = await adapter.complete({
            apiKey,
            model: chave.model,
            system,
            messages: mensagens,
            maxTokens: MAX_TOKENS,
            temperature: TEMPERATURA,
          });

          const cost_usd = AiSettingsService.costOf(chave, out.input_tokens, out.output_tokens);

          // ⚠️ O CONSUMO É GRAVADO MESMO QUANDO A RESPOSTA SAI VAZIA. O provedor
          // cobra pelo que processou, não pelo que serviu — não registrar aqui
          // faria a soma do painel ficar abaixo da fatura, justamente nos casos
          // que mais interessa investigar.
          await AiJobStorage.recordUsage(pool, {
            id_user,
            id_job: id_job || null,
            provider: chave.provider,
            model: out.model,
            channel: canal,
            input_tokens: out.input_tokens,
            output_tokens: out.output_tokens,
            cost_usd,
          }).catch((e) => log.warn("usage.fail", { error: e.message }));

          await AiProviderStorage.markResult(pool, chave.provider, { ok: true }).catch(() => {});

          const texto = String(out.text || "").trim();
          if (!texto) {
            ultimoErro = { message: `${chave.provider}: resposta vazia`, retryable: true };
            continue;
          }

          return {
            text: texto,
            provider: chave.provider,
            model: out.model,
            input_tokens: out.input_tokens,
            output_tokens: out.output_tokens,
            cost_usd,
            dossie_chars: dossieOut.chars,
          };
        } catch (err) {
          await AiProviderStorage.markResult(pool, chave.provider, {
            ok: false,
            error: err.message,
          }).catch(() => {});
          ultimoErro = { message: err.message, retryable: err.retryable !== false };
          // ⚠️ SÓ CAI PARA A RESERVA quando o erro é de DISPONIBILIDADE. 401 e
          // 400 não melhoram trocando de provedor — e, pior, gastariam a cota
          // da reserva repetindo um pedido que já se sabe malformado.
          if (err.retryable === false) break;
          log.warn("provider.fallback", { de: chave.provider, motivo: err.message });
        }
      }

      return {
        error: ultimoErro?.message || "Nenhum provedor respondeu.",
        retryable: ultimoErro?.retryable !== false,
      };
    });
  }
}

module.exports = AtendimentoAiService;
