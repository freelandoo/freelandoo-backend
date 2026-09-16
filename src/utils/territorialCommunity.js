// src/utils/territorialCommunity.js
//
// FONTE ÚNICA do que é uma comunidade TERRITORIAL e de quem mora nela.
//
// ─── POR QUE ESTE MÓDULO EXISTE ─────────────────────────────────────────────
//
// Condomínio (mig 196) e bairro (mig 204) são a mesma coisa vista de duas
// alturas: um lugar onde as pessoas MORAM, e onde morar — não "ter entrado" —
// é o que dá direito de escrever. As duas modalidades já dividem a política de
// privacidade (`communityPolicy.TERRITORIAL`), o feed exclusivo e a trava de
// membresia; o que faltava era dividir a RESPOSTA para "esta pessoa mora aqui?".
//
// Ela estava escrita em dois lugares com formas diferentes:
//
//   condo   → CondoStorage.getResidentStatus  (vínculo alcançado pelo ENDEREÇO
//             do condomínio: tb_address.id_condo_profile)
//   bairro  → NeighborhoodStorage.getResidentStatus (vínculo alcançado pelo
//             TERRITÓRIO: tb_address.id_territory)
//
// As duas terminam na MESMA tabela (`tb_residence_member`) e no MESMO
// predicado (`status='recognized'` E `ended_at IS NULL`) — o que muda é só por
// onde se chega nela. Sem um lugar só dizendo isso, cada feature nova precisa
// lembrar das duas formas, e a que esquecer de uma delas nasce **funcionando
// pela metade, sem erro nenhum**: a vitrine abre no condomínio e fica vazia
// para sempre no bairro, ou o contrário.
//
// É a mesma lição que `condoResidentSql.js` já pagou do lado do SQL — lá o
// predicado replicado fez avisos e enquetes continuarem perguntando à tabela
// legada, e o morador novo publicava sem receber nada.
//
// ⚠️ MODALIDADE TERRITORIAL NOVA entra em `TERRITORIAL_KINDS`, em
// `FEATURE_FLAG_BY_KIND` e no `resolveResident` — nos TRÊS. Faltando no
// primeiro, a vitrine e o delivery não a reconhecem; faltando no segundo, o
// kill-switch do Painel de Controle não a alcança; faltando no terceiro,
// ninguém nunca é morador e a tela nasce vazia.

/** As modalidades em que MORAR é o que dá direito de escrever. */
const TERRITORIAL_KINDS = Object.freeze(["condo", "neighborhood"]);

/**
 * O kill-switch de cada modalidade no Painel de Controle.
 *
 * ⚠️ Eles são SEPARADOS de propósito: desligar condomínio por causa de um
 * problema lá não pode apagar a vitrine do bairro, que é outro produto.
 */
const FEATURE_FLAG_BY_KIND = Object.freeze({
  condo: "condominio",
  neighborhood: "bairro",
});

function isTerritorialKind(kind) {
  return TERRITORIAL_KINDS.includes(kind);
}

function featureFlagFor(kind) {
  return FEATURE_FLAG_BY_KIND[kind] || null;
}

/**
 * A comunidade territorial, pelo id do perfil. `null` quando não existe ou
 * quando a modalidade não é territorial.
 *
 * Projeta o que as duas modalidades precisam: `id_territory` (o bairro alcança
 * o morador por ele); o endereço do condomínio fica com quem já o lê, porque
 * rua e número não podem sair por uma porta que não checou morador.
 */
async function getTerritorialCommunity(conn, id_profile) {
  if (!id_profile) return null;
  const r = await conn.query(
    // ⚠️ `community_privacy AS privacy`: a coluna física tem o prefixo, e o
    // resto do código lê o alias (é o que `CommunityStorage` já projeta).
    // Pedir `privacy` cru estoura com "column does not exist".
    `SELECT id_profile, display_name, id_leader_user, community_kind AS kind,
            id_territory, estado, municipio, community_privacy AS privacy
       FROM public.tb_profile
      WHERE id_profile = $1
        AND is_community = TRUE
        AND community_kind = ANY($2::text[])
        AND deleted_at IS NULL
      LIMIT 1`,
    [id_profile, TERRITORIAL_KINDS]
  );
  return r.rowCount ? r.rows[0] : null;
}

/**
 * Esta pessoa MORA aqui?
 *
 * Devolve sempre a mesma forma para as duas modalidades:
 *   { confirmed, pending, status, units, parking }
 *
 * `confirmed` é a única coisa que os guards leem — `pending` e `status`
 * existem porque a tela precisa distinguir "ainda não confirmou" de "não mora
 * aqui": as duas frases são diferentes e só uma delas tem conserto.
 *
 * ⚠️ AS DUAS METADES DO PREDICADO importam e estão dentro dos dois storages:
 * `status='recognized'` (pendente e contestado não publicam) e
 * `ended_at IS NULL` (quem saiu não é morador fantasma). Não reescrever aqui.
 */
async function resolveResident(conn, community, id_user) {
  const empty = { confirmed: false, pending: false, status: null, units: [], parking: [] };
  if (!id_user || !community) return empty;

  if (community.kind === "condo") {
    // Lazy require: o grafo de storages fecha ciclo com os services em runtime.
    // Carregar aqui dentro mantém este módulo barato para quem o importa só
    // pelas constantes.
    const CondoStorage = require("../storages/CondoStorage");
    const r = await CondoStorage.getResidentStatus(conn, community.id_profile, id_user);
    if (!r) return empty;
    return {
      confirmed: !!r.confirmed,
      pending: !!r.pending,
      status: r.confirmed ? "recognized" : r.pending ? "pending" : null,
      units: r.units || [],
      parking: r.parking || [],
    };
  }

  if (community.kind === "neighborhood") {
    // Bairro sem território é bairro quebrado (a mig 204 exige a coluna), mas
    // consultar com `null` devolveria a linha de outra pessoa qualquer.
    if (!community.id_territory) return empty;
    const NeighborhoodStorage = require("../storages/NeighborhoodStorage");
    const r = await NeighborhoodStorage.getResidentStatus(conn, {
      id_territory: community.id_territory,
      id_user,
    });
    return {
      confirmed: !!r.recognized,
      pending: !!r.linked && !r.recognized,
      status: r.status || null,
      units: [],
      parking: [],
    };
  }

  return empty;
}

/**
 * Contexto completo de uma rota territorial: a comunidade, o papel do usuário
 * e a checagem de morador — tudo de uma vez, no formato de erro que
 * `sendServiceResult` entende.
 *
 * `require`:
 *   "member"   — entrou na comunidade (ou mora nela)
 *   "resident" — MORA aqui (a administração passa junto: é ela que conserta)
 *   "admin"    — líder/vice
 *
 * ⚠️ A FLAG É CHECADA AQUI, e POR MODALIDADE. A rota genérica
 * `/communities/:id/...` serve condomínio E bairro, então um `requireFeature`
 * fixo no router mandaria o kill-switch errado: desligar `condominio` fecharia
 * a vitrine do bairro junto. Quem sabe qual flag vale é quem já descobriu a
 * modalidade — aqui.
 */
async function territorialContext(conn, id_user, id_profile, { require: level = "member" } = {}) {
  const community = await getTerritorialCommunity(conn, id_profile);
  if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };

  const flag = featureFlagFor(community.kind);
  if (flag) {
    const FeatureFlagService = require("../services/FeatureFlagService");
    let enabled = true;
    try {
      enabled = await FeatureFlagService.isEnabled(flag);
    } catch {
      // fail-open, como o `requireFeature`: erro de infra não derruba a rota.
      enabled = true;
    }
    if (!enabled) {
      return { error: "Recurso indisponível no momento.", statusCode: 403, feature_disabled: flag };
    }
  }

  const CommunityStorage = require("../storages/CommunityStorage");
  const membership = id_user
    ? await CommunityStorage.getMembership(conn, id_profile, id_user)
    : null;
  const isAdmin =
    membership?.role === "leader" ||
    membership?.role === "vice" ||
    (!!id_user && String(community.id_leader_user) === String(id_user));
  const resident = await resolveResident(conn, community, id_user);

  if (level === "admin" && !isAdmin) {
    return { error: "Somente a administração pode fazer isso.", statusCode: 403 };
  }
  if (level === "resident" && !isAdmin && !resident.confirmed) {
    return {
      error:
        community.kind === "condo"
          ? "Confirme sua unidade para participar do condomínio."
          : "Confirme seu endereço para participar do bairro.",
      statusCode: 403,
      needs_claim: true,
    };
  }
  // Morador sem linha de membresia continua sendo de dentro: no bairro é o
  // reconhecimento dos vizinhos que vale, e exigir os dois faria quem mora ali
  // bater numa porta que ele já atravessou.
  if (level === "member" && !membership && !isAdmin && !resident.confirmed) {
    return { error: "Entre na comunidade para ver esta área.", statusCode: 403 };
  }

  return { community, membership, isAdmin, resident };
}

module.exports = {
  TERRITORIAL_KINDS,
  FEATURE_FLAG_BY_KIND,
  isTerritorialKind,
  featureFlagFor,
  getTerritorialCommunity,
  resolveResident,
  territorialContext,
};
