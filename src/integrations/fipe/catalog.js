// src/integrations/fipe/catalog.js
// Catálogo de marcas e modelos de carro (tabela FIPE, API pública sem auth).
//
// Por que o catálogo passa pelo BACKEND e não é chamado direto do browser (como
// o IBGE é no cadastro de cidade):
//   1. o modelo escolhido vira o UNIQUE de "uma comunidade por carro" — quem
//      valida a existência do par (marca, modelo) tem que ser quem grava;
//   2. o CSP do front não precisa ganhar mais um host de terceiro;
//   3. a resposta é a mesma para todo mundo, então cachear aqui serve o site
//      inteiro em vez de cada aba do usuário.
//
// Degradação: FIPE fora do ar NÃO trava o cadastro (mesma regra do ViaCEP no
// cadastro de endereço). A lista volta vazia, o front oferece digitar marca e
// modelo à mão e a linha nasce com source='manual'.

const { createLogger } = require("../../utils/logger");

const log = createLogger("fipe");

const BASE = "https://parallelum.com.br/fipe/api/v1/carros";
const TIMEOUT_MS = 6000;

// Cache em memória do processo. Marcas mudam algumas vezes por ANO; modelos, por
// mês. 6h é conservador e já evita que uma tela de cadastro popular bata na FIPE
// a cada abertura. Reinício do processo limpa — e tudo bem: é cache, não verdade.
const TTL_MS = 6 * 60 * 60 * 1000;
const cache = new Map();

function fromCache(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    log.warn("fipe.http_error", { path, status: res.status });
    return null;
  }
  return res.json();
}

/** `[{ code, label }]` — vazio quando a FIPE não responde. */
async function listBrands() {
  const cached = fromCache("brands");
  if (cached) return cached;
  try {
    const json = await getJson("/marcas");
    if (!Array.isArray(json)) return [];
    const brands = json
      .map((b) => ({ code: String(b.codigo), label: String(b.nome) }))
      .filter((b) => b.code && b.label);
    cache.set("brands", { at: Date.now(), value: brands });
    return brands;
  } catch (err) {
    log.warn("fipe.brands_fail", { message: err?.message });
    return [];
  }
}

/** `[{ code, label }]` dos modelos da marca — vazio quando a FIPE não responde. */
async function listModels(brandCode) {
  const code = String(brandCode || "").trim();
  if (!code) return [];
  const key = `models:${code}`;
  const cached = fromCache(key);
  if (cached) return cached;
  try {
    const json = await getJson(`/marcas/${encodeURIComponent(code)}/modelos`);
    const raw = Array.isArray(json?.modelos) ? json.modelos : null;
    if (!raw) return [];
    const models = raw
      .map((m) => ({ code: String(m.codigo), label: String(m.nome) }))
      .filter((m) => m.code && m.label);
    cache.set(key, { at: Date.now(), value: models });
    return models;
  } catch (err) {
    log.warn("fipe.models_fail", { brandCode: code, message: err?.message });
    return [];
  }
}

/**
 * Confere se o par (marca, modelo) existe mesmo na FIPE.
 *
 * Devolve `{ verified: true, brand_label, model_label }` com os rótulos
 * OFICIAIS (os do payload são só sugestão do cliente — quem manda é o catálogo),
 * ou `{ verified: false }` quando o par não existe.
 *
 * `{ verified: null }` = não deu para saber (FIPE fora do ar). O chamador
 * decide: aqui a decisão é aceitar e marcar source='manual', porque recusar
 * deixaria o cadastro de carro refém da disponibilidade de um terceiro.
 */
async function verifyModel({ brand_code, model_code }) {
  const models = await listModels(brand_code);
  if (!models.length) return { verified: null };
  const found = models.find((m) => m.code === String(model_code));
  if (!found) return { verified: false };
  const brands = await listBrands();
  const brand = brands.find((b) => b.code === String(brand_code));
  return {
    verified: true,
    brand_label: brand ? brand.label : null,
    model_label: found.label,
  };
}

module.exports = { listBrands, listModels, verifyModel };
