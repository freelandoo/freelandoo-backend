const MeuMundoService = require("../services/MeuMundoService");
const MeuMundoLifeService = require("../services/MeuMundoLifeService");
const MeuMundoInboxService = require("../services/MeuMundoInboxService");
const { HOSPITAL_INTERIOR, bedFor } = require("../utils/meuMundoHospital");
const { CENTER_INTERIORS } = require("../utils/meuMundoCenterInteriors");
const MeuMundoShopService = require("../services/MeuMundoShopService");
const { RULES } = require("../utils/meuMundoLife");

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

// Paint (mm3d-35): lugar numa sala do centro em que a pessoa está, no modo pedido.
async function paintJoin(req, res) {
  return reply(res, await MeuMundoService.joinPaint(req.user.id_user, { mode: req.body?.mode, roomId: req.body?.roomId }));
}

// Corrida em grupo (mm3d-39b): lugar na próxima largada do centro em que a pessoa está.
async function corridaJoin(req, res) {
  return reply(res, await MeuMundoService.joinCorrida(req.user.id_user));
}

// Rolê Noturno em grupo (mm3d-42): lugar na próxima largada, com o veículo escolhido.
async function noturnoJoin(req, res) {
  return reply(res, await MeuMundoService.joinNoturno(req.user.id_user, { ride: req.body?.ride, body: req.body?.body }));
}

// Arena de Boxe (mm3d-43): a ficha (vida + adversários) e entrar numa luta.
async function boxeCard(req, res) {
  return reply(res, await MeuMundoService.boxeCard(req.user.id_user));
}

async function boxeJoin(req, res) {
  return reply(res, await MeuMundoService.joinBoxe(req.user.id_user, { mode: req.body?.mode, tier: req.body?.tier, strategy: req.body?.strategy }));
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

// Hospital do centro (mm3d-26): a planta por dentro, o leito do usuário e a
// régua da alta — em qualquer ambiente (internado abre direto no leito).
async function hospital(req, res) {
  const life = await MeuMundoLifeService.peek(req.user.id_user);
  if (life && life.error) return reply(res, life);
  return reply(res, { interior: HOSPITAL_INTERIOR, bed: bedFor(req.user.id_user), dischargeAt: RULES.DISCHARGE_AT, life });
}

// Interior de um prédio do centro (mm3d-37): a planta é a mesma para todos e
// não muda entre deploys sem mudar a versão — o navegador pode guardar.
async function centerInterior(req, res) {
  const id = String(req.params.id || "");
  const interior = Object.prototype.hasOwnProperty.call(CENTER_INTERIORS, id) ? CENTER_INTERIORS[id] : null;
  if (!interior) return reply(res, { error: "Local sem interior", statusCode: 404 });
  return reply(res, { id, interior });
}

// Vida do hóspede (mm3d-13). Deitar/dormir vão pela sala da casa (cama).
async function life(req, res) {
  return reply(res, await MeuMundoLifeService.get(req.user.id_user));
}

async function lifeActivity(req, res) {
  return reply(res, await MeuMundoLifeService.setActivity(req.user.id_user, req.body?.activity, req.body?.hours, req.body?.place));
}

async function lifeConsume(req, res) {
  return reply(res, await MeuMundoLifeService.consume(req.user.id_user, req.body?.item));
}

// Geladeira (mig 301): o Mercado compra para a geladeira; comer é na casa (sala).
// Vendedor do centro (mm3d-37e): o catálogo, a casa e a cor do carro.
async function shopCatalog(req, res) {
  return reply(res, await MeuMundoShopService.catalog(req.user.id_user));
}
async function shopHouse(req, res) {
  return reply(res, await MeuMundoShopService.buyHouse(req.user.id_user, req.body?.level));
}
async function shopPaint(req, res) {
  return reply(res, await MeuMundoShopService.paintCar(req.user.id_user, req.body?.paint));
}

// Pedido no balcão do restaurante (mm3d-37c): come na hora.
async function lifeOrder(req, res) {
  return reply(res, await MeuMundoLifeService.order(req.user.id_user, req.body?.place, req.body?.item));
}

async function lifeBuy(req, res) {
  return reply(res, await MeuMundoLifeService.buy(req.user.id_user, req.body?.item, req.body?.qty ?? 1, req.body?.key));
}

// Sino, correio, presentes, itens e saldos (mig 302, mm3d-30).
async function notices(req, res) {
  return reply(res, await MeuMundoInboxService.notices(req.user.id_user, req.query || {}));
}
async function noticesSummary(req, res) {
  return reply(res, await MeuMundoInboxService.summary(req.user.id_user));
}
async function noticesRead(req, res) {
  return reply(res, await MeuMundoInboxService.readNotices(req.user.id_user, req.body || {}));
}
async function mail(req, res) {
  return reply(res, await MeuMundoInboxService.mail(req.user.id_user, req.query || {}));
}
async function mailOpen(req, res) {
  return reply(res, await MeuMundoInboxService.openMail(req.user.id_user, req.params.id));
}
async function mailReadAll(req, res) {
  return reply(res, await MeuMundoInboxService.readAllMail(req.user.id_user));
}
async function mailClaim(req, res) {
  return reply(res, await MeuMundoLifeService.claimGift(req.user.id_user, req.params.id));
}
async function mailPrefs(req, res) {
  return reply(res, await MeuMundoInboxService.prefs(req.user.id_user));
}
async function mailPrefsSet(req, res) {
  return reply(res, await MeuMundoInboxService.setPrefs(req.user.id_user, req.body || {}));
}
async function mailSend(req, res) {
  return reply(res, await MeuMundoInboxService.send(req.user.id_user, req.body || {}));
}
async function inventory(req, res) {
  return reply(res, await MeuMundoLifeService.inventory(req.user.id_user));
}
async function wallets(req, res) {
  return reply(res, await MeuMundoLifeService.wallets(req.user.id_user));
}
// Card de perfil de outro jogador na mesma sala (mm3d-31).
async function playerProfile(req, res) {
  return reply(res, await require("../services/MeuMundoPlayerService").profile(req.user.id_user, req.params.session));
}
// Chat do jogo (mm3d-32): Global (sala meu_mundo) e abrir a conversa 1:1.
const chat = () => require("../services/MeuMundoChatService");
async function chatHistory(req, res) {
  return reply(res, await chat().history(req.user.id_user, req.query || {}));
}
async function chatSend(req, res) {
  return reply(res, await chat().send(req.user.id_user, req.body || {}));
}
async function chatReport(req, res) {
  return reply(res, await chat().report(req.user.id_user, req.params.id, req.body || {}));
}
async function chatDirect(req, res) {
  return reply(res, await chat().openDirect(req.user.id_user, req.body || {}));
}
async function polensPurchase(req, res) {
  return reply(res, await MeuMundoInboxService.polensPurchase(req.user.id_user, req.params.session));
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

// Cores do personagem (mm3d-36): { look } = 4 dígitos base36.
async function skinColors(req, res) {
  return reply(res, await MeuMundoLifeService.setSkinColors(req.user.id_user, req.params.id, req.body?.look));
}

async function adminStatus(_req, res) {
  return reply(res, await MeuMundoService.status());
}

module.exports = {
  centerInterior,
  adminNeighborhood,
  adminSession,
  adminStatus,
  adminHouseLevel,
  houseEnter,
  houseExit,
  centerEnter,
  centerLeave,
  jetpackJoin,
  paintJoin,
  corridaJoin,
  noturnoJoin,
  boxeCard,
  boxeJoin,
  visits,
  candidates,
  invite,
  accept,
  decline,
  cancel,
  endVisit,
  life,
  hospital,
  lifeActivity,
  lifeConsume,
  lifeBuy,
  lifeOrder,
  shopCatalog,
  shopHouse,
  shopPaint,
  notices,
  noticesSummary,
  noticesRead,
  mail,
  mailOpen,
  mailReadAll,
  mailClaim,
  mailPrefs,
  mailPrefsSet,
  mailSend,
  inventory,
  wallets,
  polensPurchase,
  playerProfile,
  chatHistory,
  chatSend,
  chatReport,
  chatDirect,
  lifeNewcomer,
  skins,
  skinBuy,
  skinEquip,
  skinColors,
};
