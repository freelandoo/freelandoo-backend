// Cache em processo do conjunto de posts "em alta".
//
// O feed é caminho quente e o calor não precisa ser ao vivo, mas precisa ser
// RÁPIDO o suficiente pra que curtir um post e recarregar o feed já mostre o
// anel aceso. Daí o par:
//   - TTL curto (1 min) pro refresh normal;
//   - `markHeatStale()` no like, que derruba o cache na hora — respeitando um
//     piso de 10s pra que um pico de likes não vire uma agregação por request.
//
// Falha nunca derruba o feed: se a agregação der erro, devolve o último
// conjunto conhecido (ou vazio) e o feed carrega sem o brilho.

const FeedHeatStorage = require("../../storages/FeedHeatStorage");

const TTL_MS = 60 * 1000;
const MIN_REFRESH_MS = 10 * 1000;

let cache = { at: 0, ids: new Set() };
let stale = false;
let inFlight = null;

/** Set com os `post_id` em alta hoje. */
async function getHotPostIds(db) {
  const age = Date.now() - cache.at;
  const expired = stale ? age >= MIN_REFRESH_MS : age >= TTL_MS;
  if (!expired) return cache.ids;
  if (inFlight) return inFlight;

  inFlight = FeedHeatStorage.listHotPosts(db)
    .then((rows) => {
      cache = { at: Date.now(), ids: new Set(rows.map((r) => r.post_id)) };
      stale = false;
      return cache.ids;
    })
    .catch(() => cache.ids)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Um like acabou de entrar (ou sair): o ranking do dia pode ter mudado, então
 * a próxima carga do feed recalcula. Fire-and-forget — nunca lança.
 */
function markHeatStale() {
  stale = true;
}

/** Só para teste — zera o cache entre cenários. */
function resetHeatCache() {
  cache = { at: 0, ids: new Set() };
  stale = false;
  inFlight = null;
}

module.exports = {
  getHotPostIds,
  markHeatStale,
  resetHeatCache,
  TTL_MS,
  MIN_REFRESH_MS,
};
