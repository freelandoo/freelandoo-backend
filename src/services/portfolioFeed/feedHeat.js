// Cache em processo do conjunto de posts "em alta".
//
// O feed é caminho quente e o calor não precisa ser ao vivo — um post que
// esquentou há 3 minutos pode acender no próximo carregamento. Uma agregação a
// cada TTL serve todas as requisições do processo, então o custo por request é
// zero.
//
// Falha nunca derruba o feed: se a agregação der erro, devolve o último
// conjunto conhecido (ou vazio) e o feed carrega sem o brilho.

const FeedHeatStorage = require("../../storages/FeedHeatStorage");

const TTL_MS = 5 * 60 * 1000;

let cache = { at: 0, ids: new Set() };
let inFlight = null;

/** Set com os `post_id` acima da média do dia. */
async function getHotPostIds(db) {
  if (Date.now() - cache.at < TTL_MS) return cache.ids;
  if (inFlight) return inFlight;

  inFlight = FeedHeatStorage.listHotPosts(db)
    .then((rows) => {
      cache = { at: Date.now(), ids: new Set(rows.map((r) => r.post_id)) };
      return cache.ids;
    })
    .catch(() => cache.ids)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/** Só para teste — zera o cache entre cenários. */
function resetHeatCache() {
  cache = { at: 0, ids: new Set() };
  inFlight = null;
}

module.exports = { getHotPostIds, resetHeatCache, TTL_MS };
