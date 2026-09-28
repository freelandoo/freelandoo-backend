// src/utils/aiAccess.js
// QUEM TEM DIREITO AO ATENDENTE — a definição, num lugar só.
//
// ⚠️ DUAS PONTAS PERGUNTAM ISTO E ELAS NÃO PODEM DISCORDAR: o middleware
// (`requireAiAccess`, que guarda as rotas de configuração) e o WORKER (que
// decide se responde a um cliente). Escrito duas vezes, a mudança de regra
// deixaria uma das duas para trás.
//
// ─── TODO MUNDO (mig 263, decisão do Alex de 2026-09-27) ────────────────────
//
// O atendente é aberto: qualquer conta conecta de graça. O que limita é a
// COTA (`utils/aiQuota.js`) — duas pessoas por dia na camada grátis, e a cota
// de respostas do plano para quem assina. Direito e cota são perguntas
// separadas de propósito: "posso configurar?" é sempre sim para quem tem
// conta; "posso responder ESTA conversa agora?" é a cota.
//
// A fase fechada (só o administrador, 2026-09-17) terminou. A leitura do papel
// no banco saiu junto — sem papel a conferir, ela seria custo à toa na porta
// mais chamada do subsistema.

/**
 * @param {import("pg").Pool|import("pg").Client} _conn
 * @param {string} id_user
 * @returns {Promise<boolean>}
 */
async function canUseAi(_conn, id_user) {
  return !!id_user;
}

/** Mantido para os chamadores antigos: não há mais cache a derrubar. */
function forget() {}

module.exports = { canUseAi, forget };
