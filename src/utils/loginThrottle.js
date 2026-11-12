// src/utils/loginThrottle.js — bloqueio progressivo de login POR CONTA (A3).
//
// O `rateLimit.auth` (5/min) conta por IP, e o login passa pelo proxy da
// Vercel (`/api/signin`): o IP que o back vê é o da Vercel, compartilhado e
// trocado a cada chamada. Quem testa senhas de UMA conta a partir de vários
// IPs não esbarrava em nada. Aqui a conta é a chave:
//   - até FREE erros dentro de WINDOW: nada muda;
//   - a partir daí, cada erro trava a conta por 1, 2, 4, 8… minutos (teto
//     MAX_LOCK). Tentativa durante a trava é recusada SEM conferir a senha e
//     sem somar (ninguém prolonga a trava de outra pessoa batendo nela);
//   - vale igual para e-mail que existe e que não existe — a resposta 429 não
//     entrega quem tem conta;
//   - acerto apaga o contador; trocar a senha pelo link também (a dona da
//     conta sai da trava pelo "esqueci a senha").
//
// Memória do processo (o back é processo único — ver realtime/meuMundo.js).
// Reiniciar o servidor zera os contadores: aceitável, o IP-limit segue de pé.
const WINDOW_MS = 15 * 60 * 1000;
const FREE = 5;
const BASE_LOCK_MS = 60 * 1000;
const MAX_LOCK_MS = 30 * 60 * 1000;
const MAX_KEYS = 50_000;

const entries = new Map(); // email → { count, last }

const keyOf = (email) => String(email || "").trim().toLowerCase();

function lockMs(count) {
  if (count < FREE) return 0;
  return Math.min(MAX_LOCK_MS, BASE_LOCK_MS * 2 ** (count - FREE));
}

function live(key, now) {
  const e = entries.get(key);
  if (!e) return null;
  if (now - e.last > Math.max(WINDOW_MS, lockMs(e.count))) {
    entries.delete(key);
    return null;
  }
  return e;
}

/** `{ locked: false }` ou `{ locked: true, retryAfterSeconds }`. */
function check(email, now = Date.now()) {
  const e = live(keyOf(email), now);
  if (!e) return { locked: false };
  const until = e.last + lockMs(e.count);
  if (now < until) return { locked: true, retryAfterSeconds: Math.ceil((until - now) / 1000) };
  return { locked: false };
}

function fail(email, now = Date.now()) {
  const key = keyOf(email);
  if (!key) return;
  const e = live(key, now);
  if (e) {
    e.count += 1;
    e.last = now;
    // reinsere no fim: a poda abaixo tira sempre o mais antigo
    entries.delete(key);
    entries.set(key, e);
  } else {
    entries.set(key, { count: 1, last: now });
  }
  while (entries.size > MAX_KEYS) entries.delete(entries.keys().next().value);
}

function clear(email) {
  entries.delete(keyOf(email));
}

function lockedMessage(retryAfterSeconds) {
  const min = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Muitas tentativas de entrar nesta conta. Tente de novo em ${min} ${
    min === 1 ? "minuto" : "minutos"
  } ou use "Esqueci a senha".`;
}

module.exports = { check, fail, clear, lockedMessage, _reset: () => entries.clear(), FREE };
