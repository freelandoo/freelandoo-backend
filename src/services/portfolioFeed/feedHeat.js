// Cache em processo dos posts "em alta" do dia (post_id → 'leader' | 'rising').
//
// O feed é caminho quente e o calor não precisa ser ao vivo, mas precisa ser
// RÁPIDO o suficiente pra que interagir com um post e recarregar o feed já
// mostre o anel aceso. Daí o par:
//   - TTL curto (1 min) pro refresh normal;
//   - `markHeatStale()` em like/comentário/salvar, que derruba o cache na hora
//     — respeitando um piso de 10s pra que um pico não vire uma agregação por
//     request.
//
// NÃO é polling: nada roda no relógio. A agregação só acontece quando chega
// uma requisição de feed e o cache está vencido. Sem tráfego, zero consulta.
//
// Falha nunca derruba o feed: se a agregação der erro, devolve o último
// conjunto conhecido (ou vazio) e o feed carrega sem o brilho.

const FeedHeatStorage = require("../../storages/FeedHeatStorage");

const TTL_MS = 60 * 1000;
const MIN_REFRESH_MS = 10 * 1000;

let cache = { at: 0, tiers: new Map() };
let stale = false;
let inFlight = null;

/** Map `post_id` → 'leader' | 'rising' dos posts em alta hoje. */
async function getHotPostTiers(db) {
  const age = Date.now() - cache.at;
  const expired = stale ? age >= MIN_REFRESH_MS : age >= TTL_MS;
  if (!expired) return cache.tiers;
  if (inFlight) return inFlight;

  inFlight = FeedHeatStorage.listHotPosts(db)
    .then((rows) => {
      const tiers = new Map(rows.map((r) => [r.post_id, r.tier]));
      cache = { at: Date.now(), tiers };
      stale = false;
      return tiers;
    })
    .catch(() => cache.tiers)
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

/**
 * Chegou (ou saiu) um like/comentário/salvamento: o ranking do dia pode ter
 * mudado, então a próxima carga do feed recalcula. Nunca lança.
 */
function markHeatStale() {
  stale = true;
}

/** Só para teste — zera o cache entre cenários. */
function resetHeatCache() {
  cache = { at: 0, tiers: new Map() };
  stale = false;
  inFlight = null;
}

module.exports = {
  getHotPostTiers,
  markHeatStale,
  resetHeatCache,
  TTL_MS,
  MIN_REFRESH_MS,
};
