// src/services/FeatureFlagService.js
// Cache em memória do mapa de feature flags. O middleware requireFeature() é
// chamado em toda request das rotas gated, então NÃO batemos no banco a cada
// request — cacheamos por TTL curto e invalidamos na escrita (admin toggle).
//
// Fail-open por design: se o banco falhar ou a flag não existir, tratamos como
// LIGADO. Uma flag só bloqueia quando explicitamente is_enabled = false. Assim
// um erro de infra nunca derruba uma responsabilidade inteira.
const pool = require("../databases");
const FeatureFlagStorage = require("../storages/FeatureFlagStorage");

const TTL_MS = 15000;
let cache = null;
let cacheAt = 0;

async function getMap() {
  const now = Date.now();
  if (cache && now - cacheAt < TTL_MS) return cache;
  try {
    cache = await FeatureFlagStorage.getMap(pool);
    cacheAt = now;
  } catch {
    // Mantém o cache anterior; se nunca carregou, assume vazio (tudo ligado).
    if (!cache) cache = {};
  }
  return cache;
}

function invalidate() {
  cache = null;
  cacheAt = 0;
}

// Desligado só quando explicitamente false. Desconhecido/erro = ligado.
async function isEnabled(key) {
  const map = await getMap();
  return map[key] !== false;
}

module.exports = { getMap, isEnabled, invalidate };
