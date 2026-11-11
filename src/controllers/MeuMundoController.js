const MeuMundoService = require("../services/MeuMundoService");
const MeuMundoLifeService = require("../services/MeuMundoLifeService");
const MeuMundoInboxService = require("../services/MeuMundoInboxService");
const MeuMundoCharacterService = require("../services/MeuMundoCharacterService");
const { HOSPITAL_INTERIOR, bedFor } = require("../utils/meuMundoHospital");
const { CENTER_INTERIORS } = require("../utils/meuMundoCenterInteriors");
const MeuMundoShopService = require("../services/MeuMundoShopService");
const { RULES } = require("../utils/meuMundoLife");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reply(res, out) {
  res.set("Cache-Control", "no-store");
  // F6: prédio fechado manda o nível que abre (o cliente desenha o cadeado com ele)
  if (out && out.error) return res.status(out.statusCode || 400).json({ error: out.error, code: out.code, ...(out.level ? { level: out.level } : {}) });
  return res.json(out);
}

// Lore v2 F6: prédio fechado pelo nível do treinador — o SERVIDOR recusa a rota.
const building = () => require("../services/MeuMundoBuildingService");
async function gated(req, res, place, run) {
  const no = place ? await building().gate(req.user.id_user, place) : null;
  return no ? reply(res, no) : run();
}
async function gatedFeature(req, res, feature, run) {
  const no = await building().gateFeature(req.user.id_user, feature);
  return no ? reply(res, no) : run();
}

const withVisit = (fn) => async (req, res) => {
  if (!UUID.test(String(req.params.id || ""))) return reply(res, { error: "Convite não encontrado", statusCode: 404 });
  return reply(res, await fn(req.user.id_user, req.params.id));
};

// Ambiente atual do usuário (rua do bairro ou interior de uma casa) + reserva.
async function adminNeighborhood(req, res) {
  return reply(res, await MeuMundoService.enter(req.user.id_user));
}

// Classes (mm3d-58): estado, escolha (uma vez), troca pelo artefato e um
// artefato de teste (o jogo hoje é só de administradores).
async function clanGet(req, res) {
  return reply(res, await MeuMundoService.clanState(req.user.id_user));
}
async function clanChoose(req, res) {
  return reply(res, await MeuMundoService.chooseClan(req.user.id_user, req.body));
}
async function clanChange(req, res) {
  return reply(res, await MeuMundoService.changeClan(req.user.id_user, req.body));
}
async function clanTestArtifact(req, res) {
  return reply(res, await MeuMundoService.grantTestArtifact(req.user.id_user));
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

// Jetpack no túnel (mm3d-63): sala do centro em que a pessoa está (sozinho ou em grupo), da fase escolhida (mm3d-75).
async function jetpackJoin(req, res) {
  const closed = await building().gate(req.user.id_user, "jetpack");
  if (closed) return reply(res, closed);
  return reply(res, await MeuMundoService.joinJetpack(req.user.id_user, { solo: req.body?.solo === true, phase: req.body?.phase }));
}

// Paint (mm3d-35): lugar numa sala do centro em que a pessoa está, no modo pedido.
async function paintJoin(req, res) {
  const closed = await building().gate(req.user.id_user, "paint");
  if (closed) return reply(res, closed);
  return reply(res, await MeuMundoService.joinPaint(req.user.id_user, { mode: req.body?.mode, roomId: req.body?.roomId, map: req.body?.map }));
}

// Corrida em grupo (mm3d-39b): lugar na próxima largada do centro em que a pessoa está (com a nave da garagem, mm3d-49).
async function corridaJoin(req, res) {
  const closed = await building().gate(req.user.id_user, "corrida");
  if (closed) return reply(res, closed);
  return reply(res, await MeuMundoService.joinCorrida(req.user.id_user, { ship: req.body?.ship, track: req.body?.track }));
}

// Rolê Noturno em grupo (mm3d-42): lugar na próxima largada, com o veículo escolhido.
async function noturnoJoin(req, res) {
  const closed = await building().gate(req.user.id_user, "noturno");
  if (closed) return reply(res, closed);
  return reply(res, await MeuMundoService.joinNoturno(req.user.id_user, { ride: req.body?.ride, body: req.body?.body, phase: req.body?.phase }));
}

// Gincana em grupo (mm3d-47): lugar na próxima largada (o computador completa as 8 vagas).
async function gincanaJoin(req, res) {
  const closed = await building().gate(req.user.id_user, "gincana");
  if (closed) return reply(res, closed);
  return reply(res, await MeuMundoService.joinGincana(req.user.id_user, { body: req.body?.body }));
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
  return gated(req, res, id, () => reply(res, { id, interior }));
}

// Vida do hóspede (mm3d-13). Deitar/dormir vão pela sala da casa (cama).
async function life(req, res) {
  return reply(res, await MeuMundoLifeService.get(req.user.id_user));
}

async function lifeActivity(req, res) {
  const place = typeof req.body?.place === "string" ? req.body.place : null;
  return gated(req, res, place, async () => reply(res, await MeuMundoLifeService.setActivity(req.user.id_user, req.body?.activity, req.body?.hours, req.body?.place, req.body?.station)));
}

// mm3d-59: aventura (XP, recibos) e luta conferida pelo servidor.
const adventure = () => require("../services/MeuMundoAdventureService");
async function adventureGet(req, res) {
  return reply(res, await adventure().get(req.user.id_user));
}

/** B5: inventário de monstros (Arena e rua). */
async function monstersGet(req, res) {
  return reply(res, await adventure().monsters(req.user.id_user));
}
// B8: Lâminas = Hall (cadeiras e desafios pela vaga)
const hall = () => require("../services/MeuMundoHallService");
// o Hall da Fama é a Arena das Lâminas (abre no nível dela)
async function hallBoard(req, res) {
  return gated(req, res, "laminas", async () => reply(res, await hall().board(req.user.id_user)));
}
async function hallChallenge(req, res) {
  return gated(req, res, "laminas", async () => reply(res, await hall().challenge(req.user.id_user, req.body || {})));
}

async function fightStart(req, res) {
  // luta no ringue do Boxe e na Arena das Lâminas: o prédio precisa estar aberto
  const origin = String(req.body?.origin || "");
  const place = origin === "boxe" || origin === "laminas" ? origin : null;
  return gated(req, res, place, async () => reply(res, await adventure().fightStart(req.user.id_user, req.body || {})));
}
async function fightFinish(req, res) {
  return reply(res, await adventure().fightFinish(req.user.id_user, req.body || {}));
}
// Sonda de queda (2026-11-07): a luta que não fechou no aparelho vai para o log, campo a campo.
const clientLog = require("../utils/logger").createLogger("meuMundo.client");
async function clientReport(req, res) {
  const b = req.body || {};
  const text = (v, n) => String(v ?? "").slice(0, n);
  clientLog.warn("fight_lost", {
    id_user: req.user.id_user,
    what: text(b.what, 40),
    step: text(b.step, 20),
    left: !!b.left,
    notes: (Array.isArray(b.notes) ? b.notes : []).slice(0, 4).map((n) => text(n, 140)),
    ageMs: Number(b.ageMs) || 0,
    memory: Number(b.memory) || null,
    heapMB: Number(b.heapMB) || null,
    limitMB: Number(b.limitMB) || null,
    screen: text(b.screen, 30),
    ua: text(b.ua, 200),
  });
  return reply(res, { ok: true });
}
// mm3d-59 slice 3: equipamento (Armeiro, mochila, forja)
// B7: aba Ranking (Poder, Nível, Freelandoo)
// N1: o placar da semana de um jogável (?week=AAAA-MM-DD, um domingo; sem = a semana de agora)
async function weeklyRanking(req, res) {
  return reply(res, await require("../services/MeuMundoPoderService").weekly(req.user.id_user, String(req.params.game || ""), req.query.week ? String(req.query.week) : null));
}

async function nectarWallet(req, res) {
  return reply(res, await require("../services/MeuMundoNectarService").wallet(req.user.id_user));
}

async function ranking(req, res) {
  return reply(res, await require("../services/MeuMundoPoderService").ranking(req.user.id_user, String(req.params.tab || "")));
}

// A8: botão Compartilhar — código de afiliado + % do Meu Mundo
async function shareLink(req, res) {
  return reply(res, await require("../services/MeuMundoShareService").link(req.user.id_user));
}

const gear = () => require("../services/MeuMundoGearService");
async function gearGet(req, res) {
  return reply(res, await gear().get(req.user.id_user));
}
async function gearBuy(req, res) {
  return reply(res, await gear().buy(req.user.id_user, req.body || {}));
}
async function gearEquip(req, res) {
  return reply(res, await gear().equip(req.user.id_user, req.body || {}));
}
async function gearForge(req, res) {
  return gated(req, res, "forja", async () => reply(res, await gear().forge(req.user.id_user, req.body || {})));
}
async function gearUpgrade(req, res) {
  return reply(res, await gear().upgrade(req.user.id_user, req.body || {}));
}
async function gearRefine(req, res) {
  return reply(res, await gear().refine(req.user.id_user, req.body || {}));
}
async function gearRefineResolve(req, res) {
  return reply(res, await gear().resolveRefine(req.user.id_user, req.body || {}));
}
async function gearUse(req, res) {
  return reply(res, await gear().use(req.user.id_user, req.body || {}));
}
// lore v2 F3: missões (os 10 capítulos)
const quest = () => require("../services/MeuMundoQuestService");
async function questGet(req, res) {
  return reply(res, await quest().get(req.user.id_user));
}
async function questAdvance(req, res) {
  return reply(res, await quest().advance(req.user.id_user, req.body || {}));
}
async function questMark(req, res) {
  return reply(res, await quest().mark(req.user.id_user, req.body || {}));
}

// Lore v2 F5: o Arquivo (textos destravados) e os vídeos de capítulo/personagem
const archive = () => require("../services/MeuMundoArchiveService");
async function archiveGet(req, res) {
  return reply(res, await archive().get(req.user.id_user));
}
async function archiveRead(req, res) {
  return reply(res, await archive().read(req.user.id_user, req.body || {}));
}
async function videosList(req, res) {
  return reply(res, await archive().listVideos());
}
async function videosUpload(req, res) {
  return reply(res, await archive().upload(req.user.id_user, String(req.params.kind || ""), String(req.params.ref || ""), req.files || {}));
}
async function videosClear(req, res) {
  return reply(res, await archive().clear(String(req.params.kind || ""), String(req.params.ref || ""), req.body || {}));
}
async function gearRecycle(req, res) {
  return reply(res, await gear().recycle(req.user.id_user, req.body || {}));
}

// mm3d-72: o apelido da pessoa e o do hóspede
async function lifeNickname(req, res) {
  return reply(res, await MeuMundoLifeService.setNickname(req.user.id_user, req.body?.nickname));
}
async function lifePetName(req, res) {
  return reply(res, await MeuMundoLifeService.setPetName(req.user.id_user, req.body?.name));
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
// Hall da Fama (2026-11-08): o card de perfil de quem está no top 10 da Arena.
async function hallPlayerProfile(req, res) {
  return reply(res, await require("../services/MeuMundoPlayerService").hallProfile(req.user.id_user, req.params.id));
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

// B3 (mig 340): personagens — o ativo e a cápsula, trocar, fundir, certificado.
async function characters(req, res) {
  return reply(res, await MeuMundoCharacterService.list(req.user.id_user));
}

async function characterUse(req, res) {
  return reply(res, await MeuMundoCharacterService.use(req.user.id_user, req.params.id));
}

async function characterFuse(req, res) {
  return reply(res, await MeuMundoCharacterService.fuse(req.user.id_user, req.body || {}));
}

// B12: Laboratório de Criogenia — comprar embrião e usar o acelerador.
// Laboratório completo (embrião, genética, acelerador): nível 10 do treinador
async function characterEmbryo(req, res) {
  return gatedFeature(req, res, "lab_full", async () => reply(res, await MeuMundoCharacterService.buyEmbryo(req.user.id_user, req.body || {})));
}

// 09/11: a genética do laboratório (para a mistura).
async function characterGenetics(req, res) {
  return gatedFeature(req, res, "lab_full", async () => reply(res, await MeuMundoCharacterService.buyGenetics(req.user.id_user, req.body || {})));
}

async function characterAccelerate(req, res) {
  return gatedFeature(req, res, "lab_full", async () => reply(res, await MeuMundoCharacterService.accelerate(req.user.id_user, req.params.id)));
}

// Lore v2 F6: o nível, a tabela dos prédios e as missões de prédio
async function buildingsGet(req, res) {
  return reply(res, await building().state(req.user.id_user));
}
async function buildingsMission(req, res) {
  return reply(res, await building().deliver(req.user.id_user, req.body || {}));
}

// TESTE (hoje só admin joga): ganha um personagem da espécie na cápsula.
async function characterTestGrant(req, res) {
  return reply(res, await MeuMundoCharacterService.testGrant(req.user.id_user, req.body || {}));
}

// Público (sem login): certificado do personagem pelo código da página.
async function certificate(req, res) {
  const out = await MeuMundoCharacterService.certificate(req.params.code);
  if (out && out.error) return reply(res, out);
  res.set("Cache-Control", "public, max-age=60");
  return res.json(out);
}

async function adminStatus(_req, res) {
  return reply(res, await MeuMundoService.status());
}

module.exports = {
  clanGet,
  clanChoose,
  clanChange,
  clanTestArtifact,
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
  gincanaJoin,
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
  lifeNickname,
  lifePetName,
  adventureGet,
  monstersGet,
  fightStart,
  hallBoard,
  hallChallenge,
  fightFinish,
  clientReport,
  gearGet,
  ranking,
  weeklyRanking,
  nectarWallet,
  shareLink,
  gearBuy,
  gearEquip,
  gearForge,
  gearUpgrade,
  gearRefine,
  gearRefineResolve,
  gearUse,
  gearRecycle,
  questGet,
  questAdvance,
  questMark,
  archiveGet,
  buildingsGet,
  buildingsMission,
  archiveRead,
  videosList,
  videosUpload,
  videosClear,
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
  hallPlayerProfile,
  chatHistory,
  chatSend,
  chatReport,
  chatDirect,
  lifeNewcomer,
  characters,
  characterUse,
  characterFuse,
  characterTestGrant,
  characterEmbryo,
  characterGenetics,
  characterAccelerate,
  certificate,
};
