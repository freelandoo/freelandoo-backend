// src/utils/aiAccess.js
// QUEM TEM DIREITO AO ATENDENTE — a definição, num lugar só.
//
// ⚠️ DUAS PONTAS PERGUNTAM ISTO E ELAS NÃO PODEM DISCORDAR: o middleware
// (`requireAiAccess`, que guarda as rotas de configuração) e o WORKER (que
// decide se responde a um cliente). Escrito duas vezes, o dia da abertura
// deixaria uma das duas para trás — e o lado esquecido é sempre o pior dos
// dois: ou a pessoa configura e nada responde, ou responde para quem não
// contratou e a conta do LLM corre sozinha.
//
// ─── HOJE: SÓ O ADMINISTRADOR (decisão do Alex, 2026-09-17) ─────────────────
//
// A primeira rodada é fechada, para calibrar o prompt e MEDIR o custo real por
// conversa antes de a conta da Anthropic/OpenAI começar a correr por gente que
// ninguém está olhando. A chave é global e quem paga é a plataforma (mig 253).
//
// ─── A ABERTURA JÁ ESTÁ DESENHADA E É UMA LINHA ─────────────────────────────
//
// Trocar o corpo por `AtendimentoIaStorage.getLiveSubByUser(pool, id_user)` —
// a assinatura da mig 175 já carrega plano, ciclo e `token_limit_monthly`, e o
// Plano Negócio (mig 234) já a concede sem cobrança própria. Nada mais no
// subsistema precisa saber que a regra mudou.
const AuthStorage = require("../storages/AuthStorage");

/** Cache curto: o worker pergunta isto a cada mensagem que chega. */
const TTL_MS = 60_000;
const cache = new Map(); // id_user -> { at, value }

/**
 * @param {import("pg").Pool|import("pg").Client} conn
 * @param {string} id_user
 * @returns {Promise<boolean>}
 */
async function canUseAi(conn, id_user) {
  if (!id_user) return false;

  const key = String(id_user);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  // ⚠️ O papel vem do BANCO, nunca do JWT: o token vive um dia, e um acesso
  // revogado hoje continuaria valendo até amanhã se a resposta saísse do claim.
  const value = await AuthStorage.isAdmin(conn, id_user);
  cache.set(key, { at: Date.now(), value: !!value });
  return !!value;
}

/** Usado quando o acesso muda e não dá para esperar o TTL. */
function forget(id_user) {
  if (id_user) cache.delete(String(id_user));
  else cache.clear();
}

module.exports = { canUseAi, forget };
