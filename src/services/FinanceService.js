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
}

module.exports = FinanceService;
