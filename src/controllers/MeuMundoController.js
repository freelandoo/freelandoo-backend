const MeuMundoService = require("../services/MeuMundoService");

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
  visits,
  candidates,
  invite,
  accept,
  decline,
  cancel,
  endVisit,
};
