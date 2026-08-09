// src/utils/communityPolicy.js
// Fonte ÚNICA da política de exposição das comunidades.
//
// Antes deste módulo a regra de privacidade era o literal
// `privacy === 'private' || kind === 'condo'` repetido em vários guards — e foi
// exatamente assim que os vazamentos C2 e C3 nasceram: alguém escreveu um guard
// novo e esqueceu do OR. Aqui a modalidade declara o que expõe, e a projeção
// nega por padrão: campo não liberado para o tier NÃO EXISTE na saída.
//
// Módulo puro: sem I/O, sem require de storage. É o que o torna testável e o que
// permite reusá-lo em qualquer camada.
//
// Spec: docs/superpowers/specs/2026-08-09-comunidades-territoriais-design.md §5

// Escada de tiers. Comparação é numérica: tier >= mínimo exigido.
const TIER = Object.freeze({
  anonymous: 0,
  outsider: 1, // logado, sem vínculo com esta comunidade
  member: 2, // entrou na comunidade
  resident: 3, // titular de unidade confirmada (condomínio)
  manager: 4, // leader | vice
  platform_admin: 5,
});

// Campos de contagem/atividade. São os que denunciam o tamanho e o movimento
// interno da comunidade — o que a visão proíbe expor em modalidade territorial.
const COUNTER_FIELDS = Object.freeze(["member_count", "xp_total", "xp_level"]);

const THEMATIC_PUBLIC = Object.freeze({
  id: "thematic_public",
  searchableByAddress: false,
  // Post ligado ao feed daqui continua público (aparece no /feed, nos bees e
  // no perfil do autor).
  contentIsExclusive: false,
  // Feed e mural abertos a qualquer visitante.
  feedRequiresMembership: false,
  minTier: Object.freeze({
    counters: TIER.anonymous,
    memberList: TIER.anonymous,
    goal: TIER.anonymous,
    benchmark: TIER.anonymous,
  }),
});

const THEMATIC_PRIVATE = Object.freeze({
  id: "thematic_private",
  searchableByAddress: false,
  contentIsExclusive: true,
  feedRequiresMembership: true,
  minTier: Object.freeze({
    counters: TIER.member,
    memberList: TIER.member,
    goal: TIER.member,
    benchmark: TIER.member,
  }),
});

// Bairro entrará aqui junto do condomínio quando o Subsistema 4 chegar — e é
// por isso que exclusividade e gate de feed são DECLARADOS e não escritos à mão
// nos services: bairro herda os dois de graça, em vez de alguém ter que lembrar
// de acrescentar mais um `|| kind === 'neighborhood'` em cada ponto.
const TERRITORIAL = Object.freeze({
  id: "territorial",
  searchableByAddress: false,
  contentIsExclusive: true,
  feedRequiresMembership: true,
  minTier: Object.freeze({
    counters: TIER.member,
    memberList: TIER.resident,
    goal: TIER.resident,
    benchmark: TIER.resident,
  }),
});

const TERRITORIAL_KINDS = new Set(["condo"]);

/**
 * Política da comunidade. Modalidade desconhecida cai na MAIS RESTRITIVA de
 * propósito: se alguém adicionar um kind novo e esquecer de mapeá-lo aqui, o
 * efeito é esconder demais — nunca vazar.
 */
function policyFor(community) {
  const kind = community?.kind ?? null;
  const privacy = community?.privacy ?? null;
  if (kind === "common") {
    return privacy === "private" ? THEMATIC_PRIVATE : THEMATIC_PUBLIC;
  }
  if (TERRITORIAL_KINDS.has(kind)) return TERRITORIAL;
  return TERRITORIAL;
}

/**
 * Resolve o tier do viewer uma vez, a partir de fatos já carregados.
 * Gestor vence morador (quem lidera enxerga tudo que o morador enxerga).
 */
function resolveTier({ viewer, membership, isResident, isPlatformAdmin } = {}) {
  if (isPlatformAdmin) return TIER.platform_admin;
  const role = membership?.role ?? null;
  if (role === "leader" || role === "vice") return TIER.manager;
  if (isResident) return TIER.resident;
  if (membership) return TIER.member;
  if (viewer?.id_user) return TIER.outsider;
  return TIER.anonymous;
}

/** Negação por padrão: recurso não declarado na política é sempre negado. */
function can(policy, resource, tier) {
  const min = policy?.minTier?.[resource];
  if (typeof min !== "number") return false;
  return Number(tier) >= min;
}

/** Cópia sem os campos de contagem. Nunca muta a linha original. */
function stripCounters(row) {
  const out = { ...row };
  for (const field of COUNTER_FIELDS) delete out[field];
  return out;
}

/**
 * Recorta a comunidade para o tier do viewer. Toda leitura pública passa por
 * aqui — é a rede de segurança que torna o vazamento impossível por omissão.
 */
function projectCommunity(row, tier) {
  if (!row) return row;
  const policy = policyFor(row);
  if (can(policy, "counters", tier)) return { ...row };
  return stripCounters(row);
}

module.exports = {
  TIER,
  COUNTER_FIELDS,
  policyFor,
  resolveTier,
  can,
  stripCounters,
  projectCommunity,
};
