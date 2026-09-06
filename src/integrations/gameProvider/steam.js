// src/integrations/gameProvider/steam.js
// Adaptador da Steam. É o ÚNICO arquivo do backend que sabe o que é um appid,
// o que é OpenID e onde mora a `api.steampowered.com` — o resto do sistema
// conversa pelo contrato de `gameProvider/index.js`.
//
// ─── LOGIN: É OPENID 2.0, NÃO OAUTH ──────────────────────────────────────────
//
// A Steam não devolve token, não tem escopo e não tem refresh. O fluxo dela só
// PROVA que aquele SteamID pertence a quem clicou: manda a pessoa para a Steam,
// a Steam devolve um punhado de parâmetros `openid.*`, e a gente pergunta de
// volta à própria Steam se aquela assertiva é verdadeira. Quem lê a biblioteca
// depois é a nossa chave global.
//
// ⚠️ A verificação (`check_authentication`) NÃO É OPCIONAL. Os parâmetros
// chegam pela URL do navegador, onde qualquer um os escreve à mão: sem o
// segundo passo, `?openid.claimed_id=.../id/76561198000000000` seria bastante
// para reivindicar a conta Steam de outra pessoa. E ela precisa reenviar TODOS
// os campos que vieram, sem escolher nenhum — a assinatura cobre a lista que a
// própria resposta declara em `openid.signed`.
//
// ─── LEITURA: DOIS TETOS QUE DECIDEM O DESENHO ───────────────────────────────
//
// 1. O ToS da Steam limita a 100.000 chamadas/dia a chave INTEIRA (a nossa, não
//    a do usuário). Por isso o sync são DUAS chamadas — resumo + biblioteca — e
//    conquista é buscada só quando alguém abre aquele jogo.
// 2. `GetOwnedGames` obedece à privacidade do dono. Perfil com "Detalhes do
//    jogo" em Privado/Somente amigos responde **200 com corpo vazio**, sem erro
//    nenhum. Tratar isso como falha mandaria a pessoa caçar um defeito que não
//    existe; por isso `needs_permission` é um estado de produto, com texto
//    próprio na tela, e não um `sync_error`.
const { createLogger } = require("../../utils/logger");

const log = createLogger("game-provider:steam");

const TIMEOUT_MS = 10_000;
const OPENID_ENDPOINT = "https://steamcommunity.com/openid/login";
const API = "https://api.steampowered.com";

// SteamID64 é sempre numérico de 17 dígitos. Validar aqui evita que um
// `claimed_id` torto vire chave de banco.
const STEAM_ID_RE = /^\d{17}$/;

function apiKey() {
  return String(process.env.STEAM_WEB_API_KEY || "").trim();
}

/**
 * A Steam existe para esta instalação? A resposta é a ENV, nunca uma flag —
 * regra da mig 214. Sem chave, a plataforma some da lista de provedores em vez
 * de virar um botão que falha depois do clique, já fora do nosso site.
 */
function isAvailable() {
  return apiKey().length > 0;
}

async function call(path, params) {
  const url = new URL(`${API}${path}`);
  url.searchParams.set("key", apiKey());
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      // A chave é NOSSA: 403 aqui é problema de operação (chave revogada ou
      // cota estourada), não permissão do usuário. Nunca vira needs_permission.
      log.error("key_rejected", { path, status: res.status });
      return { error: "Steam recusou a chave da plataforma", status: res.status };
    }
    if (res.status === 429) return { error: "Steam pediu para esperar", status: 429, retry: true };
    if (!res.ok) return { error: `Steam respondeu ${res.status}`, status: res.status };
    return { data: await res.json() };
  } catch (err) {
    const timedOut = err && err.name === "AbortError";
    log.warn("call.fail", { path, timedOut, error: err.message });
    return { error: timedOut ? "Steam demorou demais" : "Steam inacessível", retry: true };
  } finally {
    clearTimeout(timer);
  }
}

/* ───────────────────────────── login (OpenID 2.0) ───────────────────────── */

/**
 * Para onde mandar a pessoa. `realm` é o que a Steam mostra na tela dela
 * ("você está entrando em …"), e a Steam EXIGE que `return_to` esteja dentro do
 * realm — divergir os dois é o erro que faz a Steam recusar sem explicar.
 */
function authUrl({ returnTo, realm }) {
  const url = new URL(OPENID_ENDPOINT);
  url.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  url.searchParams.set("openid.mode", "checkid_setup");
  url.searchParams.set("openid.return_to", returnTo);
  url.searchParams.set("openid.realm", realm);
  // `identifier_select`: não sabemos QUEM é antes de ela escolher — é a Steam
  // que devolve o SteamID de quem entrou.
  url.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  url.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return url.toString();
}

/**
 * Confere a volta com a própria Steam e devolve o SteamID.
 *
 * Reenvia os parâmetros que chegaram trocando só o `mode`. A resposta é
 * key-value em texto puro (não JSON — é o protocolo), e o que importa é a
 * linha `is_valid:true`.
 */
async function verifyCallback(query) {
  const claimed = String(query["openid.claimed_id"] || "");
  const match = claimed.match(/\/openid\/id\/(\d{17})\/?$/);
  if (!match) return { error: "Resposta da Steam sem identificador válido" };

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (k.startsWith("openid.")) body.set(k, String(v));
  }
  body.set("openid.mode", "check_authentication");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(OPENID_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    // Comparação por LINHA e não `includes("is_valid:true")`: a resposta também
    // pode conter `invalidate_handle`, e um includes solto casaria com
    // "is_valid:true" dentro de outro campo.
    const valid = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .includes("is_valid:true");
    if (!valid) {
      log.warn("openid.invalid", { claimed });
      return { error: "A Steam não confirmou este login" };
    }
    return { data: { external_id: match[1] } };
  } catch (err) {
    log.warn("openid.verify_fail", { error: err.message });
    return { error: "Não deu para confirmar o login com a Steam" };
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────────── leitura ────────────────────────────────── */

/** Quem é a pessoa + o perfil dela é público. Uma chamada. */
async function fetchProfile(steamId) {
  if (!STEAM_ID_RE.test(String(steamId))) return { error: "SteamID inválido" };
  const r = await call("/ISteamUser/GetPlayerSummaries/v2/", { steamids: steamId });
  if (r.error) return r;
  const player = r.data?.response?.players?.[0];
  if (!player) return { error: "Perfil não encontrado na Steam" };
  return {
    data: {
      external_id: String(player.steamid),
      handle: player.personaname || null,
      avatar_url: player.avatarfull || null,
      profile_url: player.profileurl || null,
      // 3 = público. Qualquer outro valor é perfil fechado, e aí nem a
      // biblioteca nem as conquistas vão vir.
      is_public: Number(player.communityvisibilitystate) === 3,
      playing_now: player.gameextrainfo || null,
    },
  };
}

/**
 * A biblioteca. Uma chamada, e ela já traz nome, horas e última sessão — é o
 * que permite montar a estante inteira sem uma chamada por jogo.
 *
 * `private: true` é resposta LEGÍTIMA, não erro: significa que o dono fechou os
 * detalhes de jogo. Quem chama decide o que dizer na tela.
 */
async function fetchLibrary(steamId) {
  if (!STEAM_ID_RE.test(String(steamId))) return { error: "SteamID inválido" };
  const r = await call("/IPlayerService/GetOwnedGames/v1/", {
    steamid: steamId,
    include_appinfo: 1,
    include_played_free_games: 1,
  });
  if (r.error) return r;
  const response = r.data?.response;
  // Sem a chave `games` = privado. `game_count: 0` com `games` ausente é o
  // mesmo caso; conta pública e realmente vazia devolve `games: []`.
  if (!response || !Array.isArray(response.games)) return { data: { private: true, games: [] } };
  const games = response.games.map((g) => ({
    external_id: String(g.appid),
    name: String(g.name || `App ${g.appid}`).slice(0, 200),
    // A Steam já entrega minutos — a coluna é minutos justamente para não
    // haver conversão no meio do caminho.
    playtime_minutes: Number(g.playtime_forever) || 0,
    playtime_2w_minutes: Number(g.playtime_2weeks) || 0,
    last_played_at: g.rtime_last_played ? new Date(Number(g.rtime_last_played) * 1000) : null,
    // Arte pelo appid, servida pelo CDN: não custa chamada de API e não conta
    // no teto diário.
    cover_url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${g.appid}/header.jpg`,
  }));
  return { data: { private: false, games } };
}

/**
 * Conquistas de UM jogo. Uma chamada por jogo — por isso isto NUNCA roda em
 * lote no sync (ver o cabeçalho e a mig 220).
 *
 * `supported: false` cobre o caso comum e chato: jogo sem conquistas nenhuma
 * responde `success: false` com a mesma cara de erro. Não é falha, e a tela
 * precisa saber a diferença para não acusar problema onde não há.
 */
async function fetchAchievements(steamId, externalId) {
  if (!STEAM_ID_RE.test(String(steamId))) return { error: "SteamID inválido" };
  const r = await call("/ISteamUserStats/GetPlayerAchievements/v1/", {
    steamid: steamId,
    appid: externalId,
    l: "portuguese",
  });
  // 400/403 aqui quer dizer "esse jogo não tem estatística" ou "perfil
  // fechado" — a Steam usa o mesmo código para os dois e nenhum é erro nosso.
  if (r.error && (r.status === 400 || r.status === 403)) return { data: { supported: false } };
  if (r.error) return r;
  const stats = r.data?.playerstats;
  if (!stats || stats.success === false || !Array.isArray(stats.achievements)) {
    return { data: { supported: false } };
  }
  const list = stats.achievements.map((a) => ({
    key: String(a.apiname || ""),
    name: a.name || a.apiname || "",
    description: a.description || "",
    unlocked: Number(a.achieved) === 1,
    unlocked_at: a.unlocktime ? new Date(Number(a.unlocktime) * 1000) : null,
  }));
  return {
    data: {
      supported: true,
      total: list.length,
      unlocked: list.filter((a) => a.unlocked).length,
      achievements: list,
    },
  };
}

module.exports = {
  provider: "steam",
  label: "Steam",
  // O que ESTA plataforma sabe responder. A tela pergunta em vez de lembrar:
  // com `playtime: false` (o caso do Xbox, quando ele entrar) a coluna de horas
  // não é desenhada — em vez de mostrar "0h", que seria mentira.
  //
  // `campaign: false` em todas, sempre: progresso de campanha não existe em
  // plataforma nenhuma. A linha está aqui para que a próxima pessoa que
  // procurar por ela encontre a resposta em vez de tentar inventá-la.
  capabilities: {
    library: true,
    playtime: true,
    achievements: true,
    presence: true,
    campaign: false,
  },
  isAvailable,
  authUrl,
  verifyCallback,
  fetchProfile,
  fetchLibrary,
  fetchAchievements,
};
