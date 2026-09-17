// src/integrations/ai/index.js
// O registry de provedores de LLM: a porta única por onde a plataforma fala com
// um modelo. Mesma disciplina do `integrations/payments` e do
// `integrations/whatsappProvider` — quem chama fala com o CONTRATO, e QUEM
// responde é uma linha de banco que o admin edita no painel.
//
// ─── POR QUE REGISTRY COM DOIS, E NÃO UM `if` ───────────────────────────────
//
// O pedido é "até duas APIs, uma da Anthropic e uma da OpenAI", e a razão de
// existirem duas não é gosto: é a RESERVA. Quando a principal devolve 429 ou
// cai, o atendente não pode emudecer na frente de um cliente — ele tenta a
// outra. Com um `if (provider === 'openai')` espalhado, a segunda tentativa
// seria escrita à mão em cada ponto de chamada, e o ponto que esquecesse
// falharia em silêncio justamente no dia de pico.
//
// ⚠️ PROVEDOR NOVO ENTRA EM TRÊS LUGARES: aqui, no CHECK
// `tb_ai_provider_key_provider_chk` (migration nova) e na lista da tela. Só no
// banco, ele é aceito e estoura na hora de responder; só aqui, ele nunca chega
// a ser gravado.
const anthropic = require("./anthropic");
const openai = require("./openai");

const PROVIDERS = {
  [anthropic.name]: anthropic,
  [openai.name]: openai,
};

/** Os nomes aceitos — o mesmo conjunto do CHECK da mig 253. */
const PROVIDER_NAMES = Object.keys(PROVIDERS);

function get(name) {
  return PROVIDERS[String(name || "").toLowerCase()] || null;
}

/** Catálogo para a tela: o que existe, o modelo padrão e as sugestões. */
function catalog() {
  return PROVIDER_NAMES.map((name) => {
    const p = PROVIDERS[name];
    return {
      name: p.name,
      label: p.label,
      default_model: p.defaultModel,
      key_placeholder: p.keyPlaceholder,
      suggested_models: p.suggestedModels,
    };
  });
}

module.exports = { get, catalog, PROVIDER_NAMES };
