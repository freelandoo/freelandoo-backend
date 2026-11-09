// src/services/communityInsideAccess.js
// "Este leitor pode ver o que nasceu DENTRO desta comunidade?" — a pergunta que
// o mural já faz (CommunityService.listBees / CommunitySiteService.canViewInside)
// feita para as portas que abrem UM item por id: bee (tb_story.id_community,
// mig 208) e post exclusivo (tb_profile_portfolio_item.id_exclusive_community).
//
// Segurança A1 lote 2: antes disto o bee do mural de condomínio/privada saía na
// timeline global e abria por id para qualquer um logado; comentários de post
// exclusivo eram lidos sem login. A régua de exclusividade é a da política
// (`policyFor(...).contentIsExclusive`), nunca um `privacy === 'private'` solto.
const pool = require("../databases");
const CommunityStorage = require("../storages/CommunityStorage");
const CondoStorage = require("../storages/CondoStorage");
const { policyFor } = require("../utils/communityPolicy");

async function canViewCommunityInside(id_community, id_user) {
  if (!id_community) return true;
  const community = await CommunityStorage.getById(pool, id_community);
  return canViewLoadedCommunityInside(community, id_user);
}

/**
 * A mesma pergunta para quem já carregou a comunidade (mural de bees, site).
 * `community` precisa de `id_profile`, `kind` e `privacy` (CommunityStorage.getById).
 */
async function canViewLoadedCommunityInside(community, id_user) {
  if (!community) return false;
  const id_community = community.id_profile;
  if (!policyFor(community).contentIsExclusive) return true;
  if (!id_user) return false;

  const membership = await CommunityStorage.getMembership(pool, id_community, id_user);
  const isManager = membership?.role === "leader" || membership?.role === "vice";
  if (community.kind === "condo") {
    if (isManager) return true;
    const resident = await CondoStorage.getResidentStatus(pool, id_community, id_user);
    return !!resident?.confirmed;
  }
  return !!membership;
}

/** Bee: o autor sempre vê o próprio; o resto segue a comunidade onde nasceu. */
async function canViewBee(story, id_user) {
  if (!story) return false;
  if (!story.id_community) return true;
  if (id_user && String(story.id_user) === String(id_user)) return true;
  return canViewCommunityInside(story.id_community, id_user);
}

/** Post: o dono do perfil sempre vê; exclusivo segue a comunidade. */
async function canViewPortfolioItem(item, id_user) {
  if (!item) return false;
  if (!item.id_exclusive_community) return true;
  if (id_user && String(item.owner_id_user) === String(id_user)) return true;
  return canViewCommunityInside(item.id_exclusive_community, id_user);
}

module.exports = {
  canViewCommunityInside,
  canViewLoadedCommunityInside,
  canViewBee,
  canViewPortfolioItem,
};
