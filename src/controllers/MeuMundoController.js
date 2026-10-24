const MeuMundoService = require("../services/MeuMundoService");
const MeuMundoLifeService = require("../services/MeuMundoLifeService");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(res, out) {
  res.set("Cache-Control", "no-store");
  if (out && out.error) return res.status(out.statusCode || 400).json({ error: out.error, code: out.code });
  return res.json(out);
}

const withVisit = (fn) => async (req, res) => {
  if (!UUID.test(String(req.params.id || ""))) return reply(res, { error: "Convite não encontrado", statusCode: 404 });
  return reply(res, await fn(req.user.id_user, req.params.id));
};

// Ambiente atual do usuário (rua do bairro ou interior de uma casa) + reserva.
async function adminNeighborhood(req, res) {
  return reply(res, await MeuMundoService.enter(req.user.id_user));
}

// Reconexão: revalida acesso e devolve uma reserva nova (com o ambiente).
async function adminSession(req, res) {
  return reply(res, await MeuMundoService.reconnect(req.user.id_user));
}

// Seletor de teste do nível da própria casa (01–10).
async function adminHouseLevel(req, res) {
  return reply(res, await MeuMundoService.setHouseLevel(req.user.id_user, req.body?.level));
}

async function houseEnter(req, res) {
  return reply(res, await MeuMundoService.enterHouse(req.user.id_user, req.body?.lot));
}

async function houseExit(req, res) {
  return reply(res, await MeuMundoService.exitHouse(req.user.id_user));
}

// Centro da cidade (mm3d-17): ir (da rua do bairro) e voltar para casa. O
// destino é decidido no servidor — nada do corpo da requisição é usado.
async function centerEnter(req, res) {
  return reply(res, await MeuMundoService.travelToCenter(req.user.id_user));
}

async function centerLeave(req, res) {
  return reply(res, await MeuMundoService.returnHome(req.user.id_user));
}

// Jetpack em grupo (mm3d-21): lugar na sala do centro em que a pessoa está.
async function jetpackJoin(req, res) {
  return reply(res, await MeuMundoService.joinJetpack(req.user.id_user, { roomId: req.body?.roomId }));
}

async function visits(req, res) {
  return reply(res, await MeuMundoService.visitState(req.user.id_user));
}

async function candidates(req, res) {
  return reply(res, await MeuMundoService.inviteCandidates(req.user.id_user));
}

async function invite(req, res) {
  return reply(res, await MeuMundoService.invite(req.user.id_user, req.body?.name));
}

const accept = withVisit((u, id) => MeuMundoService.accept(u, id));
const decline = withVisit((u, id) => MeuMundoService.decline(u, id));
const cancel = withVisit((u, id) => MeuMundoService.cancel(u, id));
const endVisit = withVisit((u, id) => MeuMundoService.endVisit(u, id));

// Vida do hóspede (mm3d-13). Deitar/dormir vão pela sala da casa (cama).
async function life(req, res) {
  return reply(res, await MeuMundoLifeService.get(req.user.id_user));
}

async function lifeActivity(req, res) {
  return reply(res, await MeuMundoLifeService.setActivity(req.user.id_user, req.body?.activity, req.body?.hours));
}

async function lifeConsume(req, res) {
  return reply(res, await MeuMundoLifeService.consume(req.user.id_user, req.body?.item));
}

async function lifeNewcomer(req, res) {
  return reply(res, await MeuMundoLifeService.newcomer(req.user.id_user));
}

// Vestuário (mig 300): skins compradas com as moedas do jogo.
async function skins(req, res) {
  return reply(res, await MeuMundoLifeService.skins(req.user.id_user));
}

async function skinBuy(req, res) {
  return reply(res, await MeuMundoLifeService.buySkin(req.user.id_user, req.params.id));
}

async function skinEquip(req, res) {
  return reply(res, await MeuMundoLifeService.equipSkin(req.user.id_user, req.params.id));
}

async function adminStatus(_req, res) {
  return reply(res, await MeuMundoService.status());
}

module.exports = {
  adminNeighborhood,
  adminSession,
  adminStatus,
  adminHouseLevel,
  houseEnter,
  houseExit,
  centerEnter,
  centerLeave,
  jetpackJoin,
  visits,
  candidates,
  invite,
  accept,
  decline,
  cancel,
  endVisit,
  life,
  lifeActivity,
  lifeConsume,
  lifeNewcomer,
  skins,
  skinBuy,
  skinEquip,
};
