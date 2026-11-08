// src/utils/vitrineCommunity.js
//
// Contexto das VITRINES em QUALQUER comunidade (A4, mig 338).
//
// A vitrine de Produtos/Serviços nasceu territorial (mig 198) e o seu guard é
// `territorialContext`. O A4 dá as quatro abas a toda modalidade, então o
// guard precisa responder "esta pessoa está dentro?" para todas elas — sem
// reescrever a resposta territorial, que continua sendo a de lá (morador).
//
// Mesma assinatura e mesma forma de retorno de `territorialContext`
// ({ community, membership, isAdmin, resident }) para os services trocarem um
// pelo outro sem mudar mais nada:
//
//   territorial → delega a territorialContext (morador, flag por modalidade)
//   open        → pet, carro e plataformas: toda conta logada está dentro
//   member      → negócio/academia: membro ou líder
//
// ⚠️ `resident.confirmed` aqui quer dizer "está dentro" para as não
// territoriais — é o campo que os guards leem com `require: "resident"`.

const { territorialContext, isTerritorialKind } = require("./territorialCommunity");
const { VITRINE_KINDS, accessModeFor } = require("./vitrine");

async function getVitrineCommunity(conn, id_profile) {
  if (!id_profile) return null;
  const r = await conn.query(
    `SELECT id_profile, display_name, id_leader_user, community_kind AS kind,
            id_territory, estado, municipio, community_privacy AS privacy
       FROM public.tb_profile
      WHERE id_profile = $1
        AND is_community = TRUE
        AND community_kind = ANY($2::text[])
        AND deleted_at IS NULL
      LIMIT 1`,
    [id_profile, VITRINE_KINDS]
  );
  return r.rowCount ? r.rows[0] : null;
}

async function isPlatformAdmin(conn, id_user) {
  if (!id_user) return false;
  const r = await conn.query(
    `SELECT 1
       FROM public.tb_user_role ur
       JOIN public.tb_role r ON r.id_role = ur.id_role
      WHERE ur.id_user = $1 AND ur.is_active = TRUE AND r.is_active = TRUE
        AND r.desc_role = 'Administrator'
      LIMIT 1`,
    [id_user]
  );
  return r.rowCount > 0;
}

async function vitrineContext(conn, id_user, id_profile, { require: level = "member" } = {}) {
  const community = await getVitrineCommunity(conn, id_profile);
  if (!community) return { error: "Comunidade não encontrada", statusCode: 404 };
  if (isTerritorialKind(community.kind)) {
    return territorialContext(conn, id_user, id_profile, { require: level });
  }
  if (!id_user) return { error: "Entre na sua conta.", statusCode: 401 };

  const CommunityStorage = require("../storages/CommunityStorage");
  const membership = await CommunityStorage.getMembership(conn, id_profile, id_user);
  const leader =
    membership?.role === "leader" ||
    membership?.role === "vice" ||
    String(community.id_leader_user || "") === String(id_user);
  // Plataforma não tem líder (id_leader_user NULL): quem cuida é o admin.
  const isAdmin = leader || (!community.id_leader_user && (await isPlatformAdmin(conn, id_user)));

  const mode = accessModeFor(community.kind);
  const inside = mode === "open" || !!membership || isAdmin;

  if (level === "admin" && !isAdmin) {
    return { error: "Somente a administração pode fazer isso.", statusCode: 403 };
  }
  if ((level === "resident" || level === "member") && !inside) {
    return { error: "Entre na comunidade para usar a vitrine.", statusCode: 403, needs_join: true };
  }

  return {
    community,
    membership,
    isAdmin,
    resident: { confirmed: inside, pending: false, status: inside ? "member" : null, units: [], parking: [] },
  };
}

module.exports = { getVitrineCommunity, vitrineContext };
