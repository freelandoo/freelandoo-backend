// src/integrations/gameProvider/index.js
// Registro dos provedores de games. É a ÚNICA lista de plataformas do backend:
// quem quiser saber quais existem pergunta aqui, e quem quiser adicionar uma
// escreve o adaptador dela e acrescenta UMA linha em `PROVIDERS`.
//
// ─── O CONTRATO ──────────────────────────────────────────────────────────────
//
//   provider        string curto, é o valor gravado no banco ('steam')
//   label           nome de exibição
//   capabilities    { library, playtime, achievements, presence, campaign }
//   isAvailable()   → boolean. A ENV decide, não a flag (regra da mig 214)
//   authUrl({returnTo, realm})       → string
//   verifyCallback(query)            → { data:{external_id} } | { error }
//   fetchProfile(externalId)         → { data:{handle, avatar_url, is_public…} }
//   fetchLibrary(externalId)         → { data:{ private, games[] } }
//   fetchAchievements(externalId, gameExternalId)
//                                    → { data:{ supported, total, unlocked… } }
//
// Nem todo provedor responde tudo, e é por isso que `capabilities` existe: o
// Xbox (via OpenXBL, quando entrar) NÃO tem horas jogadas, e a tela precisa
// omitir a coluna em vez de escrever "0h". `campaign` é `false` em todos,
// sempre — nenhuma plataforma entrega progresso de campanha.
//
// ─── POR QUE UM REGISTRO E NÃO UM `if (provider === 'steam')` ───────────────
//
// Porque o `if` se multiplica: um no service, um no controller, um no front. Foi
// assim que o `kind === 'condo'` espalhado virou os vazamentos C2/C3 do
// condomínio. Aqui a modalidade nova declara o que é e o resto pergunta.
const steam = require("./steam");

const PROVIDERS = Object.freeze({ steam });

/** Todos os provedores conhecidos, disponíveis ou não. */
function all() {
  return Object.values(PROVIDERS);
}

/** O adaptador, ou `null` — nunca lança: `provider` chega da URL. */
function get(provider) {
  return PROVIDERS[String(provider || "").toLowerCase()] || null;
}

/**
 * O que a tela pode oferecer AGORA. Provedor sem credencial configurada não
 * entra na lista: um botão "Conectar" que só falha depois do clique — já fora
 * do nosso site, na tela da plataforma — é pior do que a plataforma não
 * aparecer.
 */
function available() {
  return all().filter((p) => {
    try {
      return p.isAvailable();
    } catch {
      return false;
    }
  });
}

/** O que a API devolve para o front montar a lista. Sem segredo nenhum. */
function describe(p) {
  return { provider: p.provider, label: p.label, capabilities: p.capabilities };
}

module.exports = { PROVIDERS, all, get, available, describe };
