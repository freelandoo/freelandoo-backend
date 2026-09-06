// src/services/GameProfileService.js
// Regras do perfil gamer (mig 220): conectar a plataforma, trazer a biblioteca
// e comparar progresso.
//
// ─── AS QUATRO REGRAS QUE NÃO PODEM REGREDIR ─────────────────────────────────
//
// 1. SYNC É SOB DEMANDA, NÃO VARREDURA. Quem sincroniza é quem aparece: abriu a
//    estante e o último sync tem mais de 6h, enfileira. O sweeper que varre
//    todo mundo (padrão do AcademySyncService) NÃO serve aqui — a Steam limita
//    a 100.000 chamadas/dia a chave inteira, e varrer uma base grande gastaria
//    a cota com quem não entrou. Usuário inativo custa zero.
//
// 2. CONQUISTA É CACHE DE UM JOGO SÓ. `GetPlayerAchievements` é uma chamada POR
//    JOGO: buscar as de uma biblioteca de 300 jogos consumiria a cota do dia em
//    ~300 pessoas. Só quando alguém abre aquele jogo, com cache de 24h.
//
// 3. CONQUISTA NÃO É CAMPANHA. Nenhuma plataforma entrega progresso de história.
//    O que sai daqui é "34/51 conquistas", nunca "67% da campanha".
//
// 4. PRIVACIDADE TEM DOIS DONOS. A da plataforma (a pessoa fechou os detalhes
//    de jogo na Steam → `needs_permission`, que é escolha e não erro) e a nossa
//    (`visibility`, que decide quem vê a estante aqui dentro). As duas são
//    checadas, e a segunda no SERVICE — nunca só no front.

const jwt = require("jsonwebtoken");
const pool = require("../databases");
const GameProfileStorage = require("../storages/GameProfileStorage");
const FeatureFlagService = require("./FeatureFlagService");
const providers = require("../integrations/gameProvider");
const { slugify } = require("../utils/slug");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("GameProfileService");

const FLAG = "games_conexao";
// Quanto tempo a estante pode ficar velha antes de a visita disparar um sync.
const SYNC_TTL_MS = 6 * 60 * 60 * 1000;
// Piso entre dois syncs manuais: o botão "atualizar agora" não pode virar uma
// torneira aberta na cota diária da Steam.
const SYNC_FLOOR_MS = 5 * 60 * 1000;
const ACH_TTL_MS = 24 * 60 * 60 * 1000;
// O `state` do OpenID vive o tempo de uma ida e volta ao site da plataforma.
const STATE_TTL = "10m";

class GameProfileService {
  static async _assertEnabled() {
    const enabled = await FeatureFlagService.isEnabled(FLAG);
    if (!enabled) return { error: "Recurso indisponível no momento.", statusCode: 403 };
    return null;
  }

  /* ─────────────────────────── provedores ───────────────────────────────── */

  /** O que a tela pode oferecer agora (a ENV decide, não a flag). */
  static async listProviders(id_user) {
    return runWithLogs(log, "listProviders", () => ({ id_user }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;
      const accounts = await GameProfileStorage.listAccounts(pool, id_user);
      const connected = new Map(accounts.map((a) => [a.provider, a]));
      // TODAS as plataformas conhecidas, com o estado de cada uma — as que têm
      // adaptador e as que não têm. Mandar só as conectáveis deixava a aba
      // muda, e tela muda parece defeito.
      return {
        providers: providers.all().map((p) => ({
          ...providers.describe(p),
          account: connected.get(p.provider) || null,
        })),
        roadmap: providers.ROADMAP,
      };
    });
  }

  /* ──────────────────────────── conectar ────────────────────────────────── */

  /**
   * Para onde mandar a pessoa.
   *
   * ⚠️ O `state` é um JWT ASSINADO e não um id qualquer. A volta do OpenID é um
   * redirecionamento do NAVEGADOR direto para o backend: ela não carrega o
   * nosso Authorization, então sem o state a rota de callback não teria como
   * saber de quem é aquele SteamID — e aceitaria amarrar a conta Steam de
   * alguém ao usuário que o atacante escolhesse. Assinado e curto (10min), ele
   * é a única coisa que liga a volta a quem começou.
   */
  static async startConnect(id_user, provider, returnPath) {
    return runWithLogs(log, "startConnect", () => ({ id_user, provider }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;

      const adapter = providers.get(provider);
      if (!adapter) return { error: "Plataforma desconhecida.", statusCode: 404 };
      if (!adapter.isAvailable()) {
        return { error: "Esta plataforma ainda não está disponível.", statusCode: 503 };
      }

      const base = this._selfUrl();
      if (!base) {
        log.error("startConnect.no_self_url");
        return { error: "Conexão indisponível no momento.", statusCode: 503 };
      }

      const state = jwt.sign(
        { id_user, provider, purpose: "game_connect", back: this._safeReturn(returnPath) },
        process.env.JWT_SECRET,
        { expiresIn: STATE_TTL }
      );
      // ⚠️ `/gamer` e não `/games`: é onde a rota de callback está montada. O
      // erro aqui não aparece no nosso lado — ele vira um 404 DEPOIS de a
      // pessoa já ter autorizado na tela da plataforma.
      const returnTo = `${base}/gamer/${provider}/callback?state=${encodeURIComponent(state)}`;
      return { url: adapter.authUrl({ returnTo, realm: base }) };
    });
  }

  /**
   * A volta. Devolve `{ redirect }` — quem chama é uma rota de NAVEGADOR, e ela
   * responde com 302 para o site, não com JSON.
   */
  static async finishConnect(provider, query) {
    return runWithLogs(log, "finishConnect", () => ({ provider }), async () => {
      const adapter = providers.get(provider);
      if (!adapter) return { error: "Plataforma desconhecida.", statusCode: 404 };

      let claim;
      try {
        claim = jwt.verify(String(query.state || ""), process.env.JWT_SECRET);
      } catch {
        return { error: "O pedido de conexão expirou. Tente de novo.", statusCode: 400 };
      }
      if (claim.purpose !== "game_connect" || claim.provider !== provider) {
        return { error: "Pedido de conexão inválido.", statusCode: 400 };
      }

      const verified = await adapter.verifyCallback(query);
      if (verified.error) return { error: verified.error, statusCode: 400 };
      const external_id = verified.data.external_id;

      // Uma conta da plataforma pertence a UMA pessoa aqui dentro. Sem isto,
      // "conquistas verificadas" não valeria nada: duas contas Freelandoo
      // apontariam para o mesmo perfil da Steam e a comparação viraria teatro.
      const taken = await GameProfileStorage.getAccountByExternal(pool, provider, external_id);
      if (taken && String(taken.id_user) !== String(claim.id_user)) {
        return {
          error: "Esta conta da plataforma já está ligada a outro perfil da Freelandoo.",
          statusCode: 409,
        };
      }

      const profile = await adapter.fetchProfile(external_id);
      const account = await GameProfileStorage.connectAccount(pool, {
        id_user: claim.id_user,
        provider,
        external_id,
        handle: profile.data?.handle || null,
        avatar_url: profile.data?.avatar_url || null,
        profile_url: profile.data?.profile_url || null,
      });

      // Primeiro sync agora: a pessoa acabou de voltar da plataforma e a
      // estante vazia leria como "não funcionou". Falha aqui não derruba a
      // conexão — ela já está feita, e o estado conta o resto.
      await this._sync(account, adapter).catch((err) =>
        log.warn("finishConnect.sync_fail", { error: err.message })
      );

      const back = claim.back || "/account";
      const sep = back.includes("?") ? "&" : "?";
      return { redirect: this._frontUrl(`${back}${sep}games=conectado&provider=${provider}`) };
    });
  }

  static async disconnect(id_user, provider) {
    return runWithLogs(log, "disconnect", () => ({ id_user, provider }), async () => {
      const gone = await GameProfileStorage.revokeAccount(pool, id_user, provider);
      if (!gone) return { error: "Conta não conectada.", statusCode: 404 };
      return { disconnected: true };
    });
  }

  static async setVisibility(id_user, provider, visibility) {
    return runWithLogs(log, "setVisibility", () => ({ id_user, provider }), async () => {
      if (!["public", "private"].includes(String(visibility))) {
        return { error: "Visibilidade inválida.", statusCode: 400 };
      }
      const row = await GameProfileStorage.setVisibility(pool, id_user, provider, visibility);
      if (!row) return { error: "Conta não conectada.", statusCode: 404 };
      return { visibility: row.visibility };
    });
  }

  /* ──────────────────────────── sincronizar ─────────────────────────────── */

  /**
   * O sync de uma conta. Idempotente: pode rodar duas vezes seguidas sem
   * duplicar nada (o catálogo é `ON CONFLICT` e a estante é upsert).
   */
  static async _sync(account, adapter) {
    const conn = await pool.connect();
    try {
      const lib = await adapter.fetchLibrary(account.external_id);
      if (lib.error) {
        await GameProfileStorage.setSync(conn, account.id_account, {
          status: "error",
          sync_error: lib.error,
        });
        return { error: lib.error };
      }
      if (lib.data.private) {
        // Escolha do dono, não defeito: a estante fica como está e a tela
        // explica onde mudar. Marcar 'error' aqui mandaria a pessoa caçar um
        // problema que não existe.
        await GameProfileStorage.setSync(conn, account.id_account, {
          status: "needs_permission",
          sync_error: null,
        });
        return { status: "needs_permission" };
      }

      const games = lib.data.games
        .map((g) => ({ ...g, slug: slugify(g.name) }))
        // Jogo cujo nome não produz slug (só símbolos, ou nome vazio) ficaria
        // com chave em branco e colidiria com todos os outros iguais. Fora.
        .filter((g) => g.slug.length >= 2);

      await conn.query("BEGIN");
      const map = await GameProfileStorage.upsertGames(conn, account.provider, games);
      const rows = games
        .map((g) => ({
          id_game: map.get(g.external_id),
          playtime_minutes: g.playtime_minutes,
          playtime_2w_minutes: g.playtime_2w_minutes,
          last_played_at: g.last_played_at,
        }))
        .filter((r) => r.id_game);
      await GameProfileStorage.replaceShelf(conn, account.id_user, account.provider, rows);
      await GameProfileStorage.setSync(conn, account.id_account, {
        status: "connected",
        sync_error: null,
      });
      await conn.query("COMMIT");
      return { status: "connected", games: rows.length };
    } catch (err) {
      await conn.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      conn.release();
    }
  }

  /** Sync pedido pelo botão. O piso de 5 min protege a cota diária. */
  static async syncNow(id_user, provider) {
    return runWithLogs(log, "syncNow", () => ({ id_user, provider }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;
      const adapter = providers.get(provider);
      if (!adapter) return { error: "Plataforma desconhecida.", statusCode: 404 };
      const account = await GameProfileStorage.getAccount(pool, id_user, provider);
      if (!account) return { error: "Conta não conectada.", statusCode: 404 };
      if (account.last_sync_at && Date.now() - new Date(account.last_sync_at).getTime() < SYNC_FLOOR_MS) {
        return { skipped: true, last_sync_at: account.last_sync_at };
      }
      const r = await this._sync(account, adapter);
      if (r.error) return { error: r.error, statusCode: 502 };
      return r;
    });
  }

  /* ───────────────────────────── a estante ──────────────────────────────── */

  /**
   * A minha estante. É aqui que mora a regra 1: se está velha, sincroniza —
   * mas em segundo plano, devolvendo o que já existe. Esperar a Steam para
   * desenhar a tela faria a visita custar 2 segundos toda vez.
   */
  static async myShelf(id_user, opts = {}) {
    return runWithLogs(log, "myShelf", () => ({ id_user }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;

      const accounts = await GameProfileStorage.listAccounts(pool, id_user);
      for (const account of accounts) {
        const adapter = providers.get(account.provider);
        if (!adapter || !adapter.isAvailable()) continue;
        const age = account.last_sync_at ? Date.now() - new Date(account.last_sync_at).getTime() : Infinity;
        if (age > SYNC_TTL_MS) {
          this._sync(account, adapter).catch((err) =>
            log.warn("myShelf.bg_sync_fail", { provider: account.provider, error: err.message })
          );
        }
      }

      const [games, totals] = await Promise.all([
        GameProfileStorage.listShelf(pool, id_user, opts),
        GameProfileStorage.countShelf(pool, id_user),
      ]);
      return { accounts, games, total: totals.total, total_minutes: Number(totals.minutes) };
    });
  }

  /** A estante de outra pessoa. A visibilidade é checada AQUI. */
  static async userShelf(viewer_id, id_user, opts = {}) {
    return runWithLogs(log, "userShelf", () => ({ viewer_id, id_user }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;

      const owner = await GameProfileStorage.getPublicOwner(pool, id_user);
      if (!owner) return { error: "Perfil não encontrado.", statusCode: 404 };

      if (String(viewer_id) !== String(id_user)) {
        const accounts = await GameProfileStorage.listAccounts(pool, id_user);
        // Nenhuma conta pública = estante fechada. E a resposta é a MESMA de
        // "não conectou nada": dizer "esta pessoa tem uma estante privada"
        // entregaria justamente o que ela escondeu.
        if (!accounts.some((a) => a.visibility === "public")) {
          return { owner: this._card(owner), games: [], total: 0, total_minutes: 0, locked: true };
        }
      }

      const [games, totals] = await Promise.all([
        GameProfileStorage.listShelf(pool, id_user, opts),
        GameProfileStorage.countShelf(pool, id_user),
      ]);
      return {
        owner: this._card(owner),
        games,
        total: totals.total,
        total_minutes: Number(totals.minutes),
        locked: false,
      };
    });
  }

  /* ──────────────────────────── comparação ──────────────────────────────── */

  /**
   * Frente a frente. `who` é @username porque é o que a pessoa sabe digitar.
   *
   * O resumo é contado no JS e não no SQL de propósito: são poucas centenas de
   * linhas já carregadas, e a conta ("ele zerou 5 que você está jogando") vai
   * mudar de definição umas quantas vezes até assentar.
   */
  static async compare(viewer_id, username) {
    return runWithLogs(log, "compare", () => ({ viewer_id, username }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;

      const other = await GameProfileStorage.findUserByUsername(pool, String(username || "").replace(/^@/, ""));
      if (!other) return { error: "Perfil não encontrado.", statusCode: 404 };
      if (String(other.id_user) === String(viewer_id)) {
        return { error: "Escolha outra pessoa para comparar.", statusCode: 400 };
      }

      const accounts = await GameProfileStorage.listAccounts(pool, other.id_user);
      if (!accounts.some((a) => a.visibility === "public")) {
        return { other: this._card(other), locked: true, games: [] };
      }

      const games = await GameProfileStorage.listCommon(pool, viewer_id, other.id_user);
      const mine = await GameProfileStorage.countShelf(pool, viewer_id);
      const theirs = await GameProfileStorage.countShelf(pool, other.id_user);

      return {
        other: this._card(other),
        locked: false,
        games,
        summary: {
          in_common: games.length,
          my_total: mine.total,
          their_total: theirs.total,
          my_minutes: Number(mine.minutes),
          their_minutes: Number(theirs.minutes),
          // Quantos dos jogos em comum cada um jogou mais. Empate (os dois em
          // zero, o caso do jogo comprado e nunca aberto) não conta para
          // ninguém — senão a biblioteca inteira "empatada" viraria placar.
          i_played_more: games.filter((g) => g.a_minutes > g.b_minutes).length,
          they_played_more: games.filter((g) => g.b_minutes > g.a_minutes).length,
        },
      };
    });
  }

  /**
   * As conquistas de UM jogo, com cache de 24h. É o único ponto que gasta
   * chamada por jogo — e por isso é o único que precisa de TTL próprio.
   */
  static async gameAchievements(viewer_id, id_user, id_game, provider) {
    return runWithLogs(log, "gameAchievements", () => ({ id_user, id_game, provider }), async () => {
      const blocked = await this._assertEnabled();
      if (blocked) return blocked;

      if (String(viewer_id) !== String(id_user)) {
        const accounts = await GameProfileStorage.listAccounts(pool, id_user);
        if (!accounts.some((a) => a.visibility === "public")) {
          return { error: "Estante privada.", statusCode: 403 };
        }
      }

      const row = await GameProfileStorage.getUserGame(pool, id_user, id_game, provider);
      if (!row) return { error: "Jogo não encontrado nesta estante.", statusCode: 404 };

      const fresh = row.ach_synced_at && Date.now() - new Date(row.ach_synced_at).getTime() < ACH_TTL_MS;
      if (fresh) {
        return {
          cached: true,
          supported: row.ach_total !== null,
          unlocked: row.ach_unlocked,
          total: row.ach_total,
        };
      }

      const adapter = providers.get(provider);
      const account = await GameProfileStorage.getAccount(pool, id_user, provider);
      if (!adapter || !account || !row.external_id) {
        return { error: "Não deu para consultar as conquistas.", statusCode: 502 };
      }

      const r = await adapter.fetchAchievements(account.external_id, row.external_id);
      if (r.error) return { error: r.error, statusCode: 502 };
      if (!r.data.supported) {
        // Jogo sem conquistas é resposta boa: grava `total = null` para não
        // perguntar de novo a cada visita.
        await GameProfileStorage.setAchievements(pool, {
          id_user, id_game, provider, unlocked: null, total: null,
        });
        return { supported: false };
      }
      await GameProfileStorage.setAchievements(pool, {
        id_user, id_game, provider, unlocked: r.data.unlocked, total: r.data.total,
      });
      return {
        supported: true,
        unlocked: r.data.unlocked,
        total: r.data.total,
        achievements: r.data.achievements,
      };
    });
  }

  /* ───────────────────────────── auxiliares ─────────────────────────────── */

  static _card(u) {
    return { id_user: u.id_user, username: u.username, name: u.nome, avatar_url: u.avatar };
  }

  /**
   * O endereço PÚBLICO deste backend — é ele que a Steam vai chamar de volta, e
   * o que ela mostra na tela de "você está entrando em…". Sai da ENV porque o
   * host que chega no request pode ser o do proxy da Vercel, e a Steam exige
   * que `return_to` esteja dentro do `realm`.
   */
  static _selfUrl() {
    const raw = process.env.PUBLIC_BACKEND_URL || process.env.BASE_URL || "";
    return raw ? String(raw).replace(/\/+$/, "") : null;
  }

  /**
   * Para onde devolver a pessoa depois da plataforma. Ela sai do site no meio
   * do caminho, e voltar para `/account` a deixaria longe da estante que ela
   * estava abrindo.
   *
   * ⚠️ SÓ CAMINHO RELATIVO, e a checagem é dupla: tem que começar com "/" e NÃO
   * pode começar com "//" nem "/\". Sem a segunda metade, `//evil.com` passa —
   * o navegador lê isso como um host, e a nossa tela de conexão viraria um
   * trampolim para o site de outra pessoa. O caminho ainda é assinado dentro do
   * state, então nem isso o usuário consegue trocar depois.
   */
  static _safeReturn(raw) {
    const p = String(raw || "").trim();
    if (!p.startsWith("/") || p.startsWith("//") || p.startsWith("/\\")) return null;
    return p.slice(0, 300);
  }

  static _frontUrl(path) {
    const base = String(process.env.FRONTEND_URL || "https://www.freelandoo.com.br").replace(/\/+$/, "");
    return `${base}${path}`;
  }
}

module.exports = GameProfileService;
