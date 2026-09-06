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
 * Quem tem credencial configurada AGORA. Continua sendo isto que decide se a
 * conexão pode começar — um botão que só falha depois do clique, já na tela da
 * plataforma, é pior do que não haver botão.
 *
 * ⚠️ Mas isto NÃO é mais o que a tela lista. Filtrar aqui e mandar só os
 * disponíveis deixava a aba muda quando não havia nenhum: duas caixas cinzas
 * dizendo "nada por aqui". A lista agora vai inteira, com o estado de cada uma,
 * e quem não pode conectar aparece DESLIGADA em vez de não aparecer.
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

/**
 * As plataformas que NÃO têm adaptador — e por quê.
 *
 * Elas existem aqui porque a pergunta "cadê o PlayStation?" é inevitável, e a
 * resposta é conhecida e não vai mudar por si só. Escrita na tela, ela se
 * responde sozinha para sempre; fora dela, vira uma dúvida que volta a cada
 * pessoa nova. Adaptador FALSO seria o contrário disso: prometeria um botão.
 *
 *   planned     → dá para fazer, custa dinheiro ou trabalho, ainda não fizemos
 *   unavailable → a plataforma não abre os dados; não é decisão nossa
 */
const ROADMAP = Object.freeze([
  {
    provider: "xbox",
    label: "Xbox",
    status: "planned",
    // A API oficial (XSAPI) é para desenvolvedor de JOGO, com escopo do próprio
    // título; sobra um intermediário pago. E o Xbox não expõe horas jogadas.
    reason: "xboxReason",
  },
  {
    provider: "playstation",
    label: "PlayStation",
    status: "unavailable",
    // Sony não publica API. O que existe são endpoints internos autenticados
    // pelo cookie de sessão da conta inteira — não pedimos isso a ninguém.
    reason: "playstationReason",
  },
  {
    provider: "nintendo",
    label: "Nintendo",
    status: "unavailable",
    reason: "nintendoReason",
  },
]);

/**
 * O que a API devolve para o front montar a lista. Sem segredo nenhum.
 *
 * `available` diz se a conexão pode começar; `capabilities` diz o que aquela
 * plataforma sabe responder — é ele que faz a tela não desenhar uma coluna de
 * horas para quem não tem horas.
 */
function describe(p) {
  let ok = false;
  try {
    ok = p.isAvailable();
  } catch {
    ok = false;
  }
  return {
    provider: p.provider,
    label: p.label,
    capabilities: p.capabilities,
    status: ok ? "ready" : "unconfigured",
    available: ok,
  };
}

module.exports = { PROVIDERS, ROADMAP, all, get, available, describe };
