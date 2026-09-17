// src/integrations/ai/anthropic.js
// Adaptador da Messages API da Anthropic.
//
// ⚠️ O `model` NÃO é lista fechada aqui, e isso é decisão. Catálogo de modelo
// muda de nome e de geração várias vezes por ano; uma lista no código viraria
// a razão de o atendente parar de funcionar num dia em que ninguém mexeu nele.
// O que este arquivo garante é o TRANSPORTE; qual modelo é escolha do admin,
// gravada em `tb_ai_provider_key.model`. A tela oferece sugestões, não trava.
const { createLogger } = require("../../utils/logger");

const log = createLogger("ai/anthropic");

const URL = "https://api.anthropic.com/v1/messages";
// A Anthropic versiona a API por cabeçalho, não por caminho. Fixar aqui é o
// que impede uma mudança de contrato do lado deles de chegar sem aviso.
const API_VERSION = "2023-06-01";
const TIMEOUT_MS = 60_000;

const SUGGESTED_MODELS = [
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 (recomendado)" },
  { value: "claude-opus-5", label: "Claude Opus 5 (mais capaz)" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (mais barato)" },
];

/**
 * Uma resposta do modelo.
 *
 * @returns {{ text: string, input_tokens: number, output_tokens: number, model: string }}
 */
async function complete({ apiKey, model, system, messages, maxTokens, temperature }) {
  let res;
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        // O dossiê inteiro vai no `system`, separado da conversa. Misturá-lo na
        // primeira mensagem do usuário faria o modelo tratar as instruções da
        // casa como fala do cliente — e cliente pode pedir para ignorá-las.
        system,
        messages,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    // Timeout e queda de rede chegam aqui. `retryable` é o que diz ao worker
    // se vale tentar de novo ou se insistir só queima token.
    const err = new Error(`Anthropic indisponível: ${e.message}`);
    err.retryable = true;
    throw err;
  }

  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!res.ok) {
    const msg = data?.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Anthropic: ${msg}`);
    err.statusCode = res.status;
    // 429 e 5xx passam; 401/400 não — chave errada não melhora com espera.
    err.retryable = res.status === 429 || res.status >= 500;
    log.warn("complete.fail", { status: res.status, model });
    throw err;
  }

  // `content` é uma LISTA de blocos. Pegar só o primeiro perderia texto quando
  // o modelo devolve mais de um bloco — o sintoma seria resposta cortada no
  // meio, sem erro nenhum.
  const out = Array.isArray(data?.content)
    ? data.content
        .filter((b) => b?.type === "text")
        .map((b) => b.text)
        .join("")
    : "";

  return {
    text: String(out || "").trim(),
    input_tokens: Number(data?.usage?.input_tokens || 0),
    output_tokens: Number(data?.usage?.output_tokens || 0),
    model: data?.model || model,
  };
}

module.exports = {
  name: "anthropic",
  label: "Anthropic Claude",
  defaultModel: "claude-sonnet-5",
  keyPlaceholder: "sk-ant-...",
  suggestedModels: SUGGESTED_MODELS,
  complete,
};
