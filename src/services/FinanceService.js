// src/services/FinanceService.js
//
// A PLATAFORMA FINANCEIRO (mig 229): quem responde "qual é o espaço financeiro
// da Freelandoo" — e só isso.
//
// ⚠️ O QUE ESTE SERVICE NÃO FAZ: feed, publicação, curtida, comentário,
// denúncia. Tudo isso é a máquina de comunidade, que já existe e já sabe fazer,
// e que passa a receber o id devolvido daqui. Reescrever qualquer uma dessas
// pontas para o Financeiro criaria a segunda máquina que a mig 229 existe para
// não criar — e a divergência apareceria no dia em que o card do feed ganhasse
// um campo e ele aparecesse numa tela e não na outra.

const pool = require("../databases");
const PlatformStorage = require("../storages/PlatformStorage");
const PlatformActivityStorage = require("../storages/PlatformActivityStorage");
const GamesScore = require("../utils/gamesScore");
const PlatformAvatarService = require("./PlatformAvatarService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FinanceService");

class FinanceService {
  /**
   * A plataforma, criando-a na primeira visita se a migration não tiver
   * semeado (banco sem admin no momento do deploy).
   *
   */
  static async getPlatform(viewer_id = null) {
    return runWithLogs(log, "getPlatform", () => ({ viewer_id }), async () => {
      const platform = await PlatformStorage.getOrCreatePlatform(pool, PlatformStorage.FINANCE_KIND);
      if (!platform) {
        // Só acontece em base sem NENHUM usuário: não há a quem pendurar a
        // linha. Recusar aqui é melhor que devolver uma plataforma inventada.
        return { error: "Plataforma financeira indisponível.", statusCode: 503 };
      }
      // A foto de quem está olhando, já resolvida (mig 233): a tela desenha o
      // headcard com ela sem pagar uma segunda ida ao servidor só por causa de
      // um campo. Sem override, é o rosto de sempre.
      const viewer_avatar = viewer_id
        ? await PlatformAvatarService.resolve(viewer_id, PlatformStorage.FINANCE_KIND, null)
        : null;
      return { platform, viewer_avatar };
    });
  }

  /**
   * O RANKING DO FINANCEIRO — por cidade e por estado, contando só o que
   * acontece dentro da plataforma.
   *
   * ⚠️ É A MESMA CONTA DO RANKING DE GAMES, e de propósito: o storage e os
   * pesos (curtida 1 · comentário 2 · compartilhamento 3) são compartilhados, e
   * o que muda é a MODALIDADE do post. A plataforma já respondeu uma vez
   * "quanto vale cada gesto" — uma segunda resposta faria a mesma curtida valer
   * coisas diferentes em duas telas.
   *
   * ⚠️ O TEMPO ONLINE ENTRA — e é o TEMPO DAQUI (mig 230). Quando esta tela
   * nasceu, a única batida de presença que existia era a do ambiente de games,
   * e somá-la aqui daria ponto de presença de games a quem nunca entrou lá:
   * o termo ficou na conta valendo zero, esperando uma fonte. A fonte chegou
   * com a mig 230, que pôs a PLATAFORMA na chave da presença — foi só ligar,
   * exatamente como este comentário previa, sem refazer a régua.
   *
   * A cidade vem PRIMEIRO e sozinha: sem ela a fila sai vazia, e "vazia" teria
   * dois significados incompatíveis — "ninguém pontuou na sua cidade" e "você
   * nunca disse qual é a sua cidade". Só o segundo tem conserto, e a tela
   * precisa poder dizer qual é o caso.
   */
  static async ranking(viewer_id, opts = {}) {
    return runWithLogs(log, "ranking", () => ({ viewer_id, scope: opts.scope }), async () => {
      if (!viewer_id) return { error: "Usuário não autenticado" };

      const scope = GamesScore.normalizeScope(opts.scope);
      const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 100);
      const weights = {
        like: GamesScore.WEIGHTS.like,
        comment: GamesScore.WEIGHTS.comment,
        share: GamesScore.WEIGHTS.share,
        // A régua do tempo vai junto para a tela poder escrever a legenda sem
        // guardar o número dela: dois lugares guardando o peso fariam a legenda
        // prometer uma conta que a fila não faz.
        minutes_per_point: GamesScore.SECONDS_PER_POINT / 60,
      };

      const place = await PlatformActivityStorage.getPlace(pool, viewer_id);
      if (!place) return { metric: "activity", scope, place: null, weights, rows: [], me: null };

      const [rows, me] = await Promise.all([
        PlatformActivityStorage.rankByActivity(pool, { id_user: viewer_id, scope, limit, kind: PlatformStorage.FINANCE_KIND }),
        PlatformActivityStorage.getActivityRank(pool, { id_user: viewer_id, scope, kind: PlatformStorage.FINANCE_KIND }),
      ]);

      const shape = (r) => ({
        id_user: r.id_user,
        username: r.username,
        name: r.nome,
        avatar_url: r.avatar,
        position: r.position,
        total: r.total,
        score: Number(r.score),
        likes: Number(r.likes),
        comments: Number(r.comments),
        shares: Number(r.shares),
        // Minutos, e não segundos: quem lê a tela conta em minutos, e mandar
        // segundos só empurraria a divisão para o front — que teria de repeti-la
        // em cada lugar que mostrasse o número.
        minutes: Math.floor(Number(r.seconds) / 60),
      });

      // A foto que vale DENTRO do Financeiro (mig 233), numa passada só para a
      // fila inteira. `me` entra na MESMA lista: fora dela, quem trocou a foto
      // se veria com o rosto antigo na própria linha e com o novo na dos outros.
      const mine = me ? shape(me) : null;
      const [withAvatar, mineWithAvatar] = await Promise.all([
        PlatformAvatarService.applyToRows(rows.map(shape), "finance"),
        mine ? PlatformAvatarService.applyToRows([mine], "finance") : Promise.resolve([null]),
      ]);

      return { metric: "activity", scope, place, weights, rows: withAvatar, me: mineWithAvatar[0] };
    });
  }

  /**
   * A BATIDA DE PRESENÇA DENTRO DO FINANCEIRO (mig 230).
   *
   * É a MESMA batida de games — mesmo storage, mesmos tetos, mesmo crédito
   * calculado pelo banco a partir de `last_beat_at`. O que muda é a plataforma
   * onde ela cai, e é isso que impede as duas de somarem no mesmo balde.
   *
   * Não recebe corpo: quem mede o tempo é o banco, a partir da batida anterior.
   * Um cliente que dissesse quanto tempo passou poderia dizer qualquer coisa.
   *
   * `resume` = "só acerte o relógio, não credite". É o que o navegador manda
   * ao voltar de uma aba escondida; vir do cliente é seguro porque a flag só
   * DIMINUI a pontuação de quem a manda.
   *
   * ⚠️ SEM FLAG, como o resto deste service: o Financeiro não tem kill-switch
   * próprio (mig 229) — ele é a Carteira de todo mundo, e não uma função
   * comprável. Inventar uma aqui criaria uma porta que nenhuma tela sabe abrir.
   */
  static async beat(id_user, opts = {}) {
    return runWithLogs(log, "beat", () => ({ id_user, resume: !!opts.resume }), async () => {
      if (!id_user) return { error: "Usuário não autenticado" };
      const row = await PlatformActivityStorage.beat(pool, id_user, {
        resume: !!opts.resume,
        kind: PlatformStorage.FINANCE_KIND,
      });
      // Resposta curta de propósito: isto é chamado a cada 2 minutos por cada
      // pessoa online. Devolver o ranking aqui multiplicaria por 30 o custo de
      // cada hora de alguém na tela.
      return { seconds_today: Number(row?.seconds || 0) };
    });
  }
}

module.exports = FinanceService;
