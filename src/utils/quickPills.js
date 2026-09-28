/**
 * O acesso rápido do perfil (mig 260) — as chaves que podem virar pill atrás
 * da foto, e quantos cabem.
 *
 * ⚠️ ESPELHO em `components/profile/quick-access.ts` do front: chave nova entra
 * NOS DOIS lugares. Chave fora desta lista é descartada ao gravar.
 *
 * O teto é GEOMETRIA, não gosto: 4 pills de 36px + 3 gaps de 6px = 162px, e a
 * foto do headcard tem 192px. Um quinto escaparia por cima e por baixo.
 */
const QUICK_PILL_KEYS = [
  "business",
  "wallet",
  "fitness",
  "games",
  "pet",
  "car",
  "condo",
  "neighborhood",
  "children",
];

const QUICK_PILL_MAX = 4;

/** Filtra, tira repetidos e corta no teto — preservando a ordem escolhida. */
function normalizeQuickPills(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const raw of input) {
    const key = String(raw || "").trim();
    if (!QUICK_PILL_KEYS.includes(key) || out.includes(key)) continue;
    out.push(key);
    if (out.length >= QUICK_PILL_MAX) break;
  }
  return out;
}

/**
 * O OLHO (mig 270): quais pills o VISITANTE vê. Só as modalidades que têm uma
 * página para abrir do lado de quem visita — carteira, condomínio, bairro e
 * filhos são da própria pessoa e nunca aparecem para o público.
 */
const PUBLIC_PILL_KEYS = ["business", "games", "pet", "car", "fitness"];

/** Quem nunca mexeu no olho: só o negócio é público. */
const DEFAULT_PUBLIC_PILLS = ["business"];

/** Filtra e tira repetidos. `null` = entrada inválida (não é lista). */
function normalizePublicPills(input) {
  if (!Array.isArray(input)) return null;
  const out = [];
  for (const raw of input) {
    const key = String(raw || "").trim();
    if (PUBLIC_PILL_KEYS.includes(key) && !out.includes(key)) out.push(key);
  }
  return out;
}

/** O que vale de fato: a escolha gravada, ou o padrão se nunca escolheu. */
function resolvePublicPills(stored) {
  return Array.isArray(stored) ? normalizePublicPills(stored) : [...DEFAULT_PUBLIC_PILLS];
}

module.exports = {
  QUICK_PILL_KEYS,
  QUICK_PILL_MAX,
  normalizeQuickPills,
  PUBLIC_PILL_KEYS,
  DEFAULT_PUBLIC_PILLS,
  normalizePublicPills,
  resolvePublicPills,
};
