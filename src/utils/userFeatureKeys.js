// Whitelist fechada das funções por usuário (mig 186) — fonte única, usada
// pelas rotas de preferência (userFeaturePref.routes) e pela Loja de Funções
// (FunctionStoreService). Chave fora daqui = 400. Onde a função também tem
// flag de admin, a chave é a MESMA (store, vaquinha, fitness_academias) pro
// front combinar os dois mapas sem tradução.
const USER_FEATURE_KEYS = [
  "courses",
  "store",
  "services",
  "vaquinha",
  "communities",
  "wallet",
  "fitness_academias",
  "profiles",
  "agenda",
  // "vitrine" é a única com efeito SERVER-SIDE: desligada, os perfis do user
  // somem da vitrine pública (SearchStorage) pra todo mundo — não é só UI.
  "vitrine",
];

module.exports = { USER_FEATURE_KEYS };
