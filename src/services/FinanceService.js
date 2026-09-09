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
const FinanceStorage = require("../storages/FinanceStorage");
const PlatformActivityStorage = require("../storages/PlatformActivityStorage");
const GamesScore = require("../utils/gamesScore");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FinanceService");

class FinanceService {
  /**
   * A plataforma, criando-a na primeira visita se a migration não tiver
   * semeado (banco sem admin no momento do deploy).
   *
   */
  static async getPlatform() {
    return runWithLogs(log, "getPlatform", () => ({}), async () => {
      const platform = await FinanceStorage.getOrCreatePlatform(pool);
      if (!platform) {
        // Só acontece em base sem NENHUM usuário: não há a quem pendurar a
        // linha. Recusar aqui é melhor que devolver uma plataforma inventada.
        return { error: "Plataforma financeira indisponível.", statusCode: 503 };
      }
      return { platform };
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
   * ⚠️ AQUI NÃO ENTRA TEMPO ONLINE. A batida de presença mede quem está no
   * ambiente de GAMES; contá-la aqui daria ponto de presença de games a quem
   * nunca entrou lá. O termo existe na conta e vale zero — o dia em que o
   * Financeiro tiver a batida dele, é ligar a fonte, não refazer a régua.
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
      };

      const place = await PlatformActivityStorage.getPlace(pool, viewer_id);
      if (!place) return { metric: "activity", scope, place: null, weights, rows: [], me: null };

      const [rows, me] = await Promise.all([
        PlatformActivityStorage.rankByActivity(pool, { id_user: viewer_id, scope, limit, kind: FinanceStorage.FINANCE_KIND }),
        PlatformActivityStorage.getActivityRank(pool, { id_user: viewer_id, scope, kind: FinanceStorage.FINANCE_KIND }),
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
      });

      return { metric: "activity", scope, place, weights, rows: rows.map(shape), me: me ? shape(me) : null };
    });
  }
}

module.exports = FinanceService;
