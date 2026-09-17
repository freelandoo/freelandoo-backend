// src/integrations/ai/openai.js
// Adaptador da Chat Completions da OpenAI.
//
// Mesma disciplina do irmão Anthropic: o `model` é escolha do admin, gravada em
// `tb_ai_provider_key.model`, e este arquivo garante só o transporte.
const { createLogger } = require("../../utils/logger");

const log = createLogger("ai/openai");

const URL = "https://api.openai.com/v1/chat/completions";
const TIMEOUT_MS = 60_000;

const SUGGESTED_MODELS = [
  { value: "gpt-4o-mini", label: "GPT-4o mini (mais barato)" },
  { value: "gpt-4o", label: "GPT-4o" },
];

/**
 * @returns {{ text: string, input_tokens: number, output_tokens: number, model: string }}
 */
async function complete({ apiKey, model, system, messages, maxTokens, temperature }) {
  let res;
  try {
    res = await fetch(URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature,
        // ⚠️ Aqui o dossiê entra como PRIMEIRA MENSAGEM de papel `system`, e não
        // num campo à parte como na Anthropic. É a única diferença de forma
        // entre os dois provedores, e é ela que o contrato existe para esconder
        // — sem isso, quem chama teria que saber de qual provedor está falando.
        messages: [{ role: "system", content: system }, ...messages],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    const err = new Error(`OpenAI indisponível: ${e.message}`);
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
    const err = new Error(`OpenAI: ${msg}`);
    err.statusCode = res.status;
    err.retryable = res.status === 429 || res.status >= 500;
    log.warn("complete.fail", { status: res.status, model });
    throw err;
  }

  return {
    text: String(data?.choices?.[0]?.message?.content || "").trim(),
    input_tokens: Number(data?.usage?.prompt_tokens || 0),
    output_tokens: Number(data?.usage?.completion_tokens || 0),
    model: data?.model || model,
  };
}

module.exports = {
  name: "openai",
  label: "OpenAI GPT",
  defaultModel: "gpt-4o-mini",
  keyPlaceholder: "sk-...",
  suggestedModels: SUGGESTED_MODELS,
  complete,
};
