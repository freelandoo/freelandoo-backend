// src/routes/meuMundoAdmin.routes.js
//
// MEU MUNDO 3D — área administrativa (em desenvolvimento).
//
// Só Administrator. O cliente do jogo só é carregado DEPOIS que esta rota
// responde, então quem não é admin não recebe nem o bairro nem o motor 3D,
// mesmo entrando pela URL. Sem requireFeature: não há flag do Meu Mundo
// (a antiga saiu com o jogo anterior), e o acesso público segue fechado.
//
// mm3d-02: o bairro é PERSISTENTE (mig 291) e a resposta traz a reserva da
// sala multiplayer. mm3d-09: o ambiente pode ser a RUA ou o INTERIOR de uma
// casa; entrar, sair e visitar passam por aqui (o servidor confere posição,
// propriedade e convite — o navegador nunca escolhe a sala).

const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const rateLimit = require("../middlewares/rateLimit");
const MeuMundoController = require("../controllers/MeuMundoController");
const uploadMeuMundoVideo = require("../middlewares/uploadMeuMundoVideo");

// Lore v2 F5: erro do multer (formato, tamanho) vira 400 com o texto, não 500.
const videoUpload = (req, res, next) =>
  uploadMeuMundoVideo(req, res, (err) => {
    if (!err) return next();
    const error = err.code === "LIMIT_FILE_SIZE" ? "Arquivo grande demais (máximo 100 MB)" : err.message || "Envio recusado";
    return res.status(400).json({ error });
  });

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];

router.get("/neighborhood", ...admin, asyncHandler(MeuMundoController.adminNeighborhood));
router.post("/session", ...admin, asyncHandler(MeuMundoController.adminSession));
// Classes (mm3d-58): sem classe o GET /neighborhood responde 409 needs_clan.
router.get("/clan", ...admin, asyncHandler(MeuMundoController.clanGet));
router.post("/clan", ...admin, asyncHandler(MeuMundoController.clanChoose));
router.post("/clan/change", ...admin, asyncHandler(MeuMundoController.clanChange));
router.post("/clan/artifact", ...admin, asyncHandler(MeuMundoController.clanTestArtifact));
// Troca o nível da PRÓPRIA casa (teste). Dono = residência ativa do token.
router.post("/house/level", ...admin, asyncHandler(MeuMundoController.adminHouseLevel));
// Entrar (lote no bairro em que você está) e sair pela porta.
router.post("/house/enter", ...admin, asyncHandler(MeuMundoController.houseEnter));
router.post("/house/exit", ...admin, asyncHandler(MeuMundoController.houseExit));
// Centro da cidade (mm3d-17): ir e voltar para casa (o bairro de casa é o da residência do token).
router.post("/center/enter", ...admin, asyncHandler(MeuMundoController.centerEnter));
router.post("/center/leave", ...admin, asyncHandler(MeuMundoController.centerLeave));
// Jetpack no túnel (mm3d-63): sala do centro em que você está, perto da porta (sozinho ou grupo).
router.post("/center/jetpack", ...admin, asyncHandler(MeuMundoController.jetpackJoin));
// Paint (mm3d-35): treino, 1×1, 2×2 ou 3×3, perto da porta.
router.post("/center/paint", ...admin, asyncHandler(MeuMundoController.paintJoin));
// Corrida em grupo (mm3d-39b): espera até 1 minuto e completa 6 naves com o computador.
router.post("/center/corrida", ...admin, asyncHandler(MeuMundoController.corridaJoin));
// Rolê Noturno em grupo (mm3d-42): espera até 1 minuto, todos na mesma rua.
router.post("/center/noturno", ...admin, asyncHandler(MeuMundoController.noturnoJoin));
// Gincana em grupo (mm3d-47): espera até 1 minuto; o computador completa as 8 vagas.
router.post("/center/gincana", ...admin, asyncHandler(MeuMundoController.gincanaJoin));
// Interior de um prédio do centro (mm3d-37): a planta, buscada ao entrar.
router.get("/center/interiors/:id", ...admin, asyncHandler(MeuMundoController.centerInterior));
// Convites e visitas (mig 293).
router.get("/visits", ...admin, asyncHandler(MeuMundoController.visits));
router.get("/visits/candidates", ...admin, asyncHandler(MeuMundoController.candidates));
router.post("/visits", ...admin, asyncHandler(MeuMundoController.invite));
router.post("/visits/:id/accept", ...admin, asyncHandler(MeuMundoController.accept));
router.post("/visits/:id/decline", ...admin, asyncHandler(MeuMundoController.decline));
router.post("/visits/:id/cancel", ...admin, asyncHandler(MeuMundoController.cancel));
router.post("/visits/:id/end", ...admin, asyncHandler(MeuMundoController.endVisit));
// Vida do hóspede (mig 295): estado, atividade com horas, comer/tomar, novo hóspede.
router.get("/life", ...admin, asyncHandler(MeuMundoController.life));
// Hospital do centro (mm3d-26): planta por dentro + leito + régua da alta.
router.get("/hospital", ...admin, asyncHandler(MeuMundoController.hospital));
router.post("/life/activity", ...admin, asyncHandler(MeuMundoController.lifeActivity));
router.post("/life/consume", ...admin, asyncHandler(MeuMundoController.lifeConsume));
// mm3d-72: apelidos (o da pessoa e o do hóspede)
router.post("/life/nickname", ...admin, asyncHandler(MeuMundoController.lifeNickname));
router.post("/life/pet-name", ...admin, asyncHandler(MeuMundoController.lifePetName));
// mm3d-59: aventura e luta conferida (o servidor sorteia a semente e re-simula a gravação).
router.get("/adventure", ...admin, asyncHandler(MeuMundoController.adventureGet));
router.get("/monsters", ...admin, asyncHandler(MeuMundoController.monstersGet));
router.get("/hall/board", ...admin, asyncHandler(MeuMundoController.hallBoard));
router.post("/hall/challenge", ...admin, asyncHandler(MeuMundoController.hallChallenge));
router.post("/fight/start", ...admin, asyncHandler(MeuMundoController.fightStart));
router.post("/fight/finish", ...admin, asyncHandler(MeuMundoController.fightFinish));
router.post("/client-report", ...admin, asyncHandler(MeuMundoController.clientReport));
// mm3d-59: equipamento — compras/forja com chave do pedido (recibo idempotente).
router.get("/gear", ...admin, asyncHandler(MeuMundoController.gearGet));
// B7: ranking do jogo (poder | nivel | freelandoo) — top 100 do Brasil + a minha posição
// N1: placar semanal por jogável (antes da rota de abas)
router.get("/ranking/semana/:game", ...admin, asyncHandler(MeuMundoController.weeklyRanking));
// N2: carteira de néctar (para entregar) + quanto vale cada posição
router.get("/nectar", ...admin, asyncHandler(MeuMundoController.nectarWallet));
// N3: domingo na estátua — corrida Raposas × Vampiros, entrega (recibo pela chave) e a meta no admin
router.get("/estatua", ...admin, asyncHandler(MeuMundoController.statueRace));
router.post("/estatua/entregar", ...admin, asyncHandler(MeuMundoController.statueDeliver));
router.get("/estatua/config", ...admin, asyncHandler(MeuMundoController.statueConfigGet));
router.post("/estatua/config", ...admin, asyncHandler(MeuMundoController.statueConfigSave));
// N4: o deus solto — quem está solto, os próximos e as quedas; o admin solta para conferir
router.get("/deus", ...admin, asyncHandler(MeuMundoController.godState));
router.post("/deus/soltar", ...admin, asyncHandler(MeuMundoController.godRelease));
router.get("/ranking/:tab", ...admin, asyncHandler(MeuMundoController.ranking));
// A8: link de afiliado do Meu Mundo (10% do que o convidado gastar em dinheiro)
router.get("/share", ...admin, asyncHandler(MeuMundoController.shareLink));
router.post("/gear/buy", ...admin, asyncHandler(MeuMundoController.gearBuy));
router.post("/gear/equip", ...admin, asyncHandler(MeuMundoController.gearEquip));
router.post("/gear/forge", ...admin, asyncHandler(MeuMundoController.gearForge));
router.post("/gear/upgrade", ...admin, asyncHandler(MeuMundoController.gearUpgrade));
router.post("/gear/refine", ...admin, rateLimit.checkout, asyncHandler(MeuMundoController.gearRefine));
router.post("/gear/refine/resolve", ...admin, rateLimit.checkout, asyncHandler(MeuMundoController.gearRefineResolve));
router.post("/gear/use", ...admin, asyncHandler(MeuMundoController.gearUse));
router.post("/gear/recycle", ...admin, asyncHandler(MeuMundoController.gearRecycle));
router.post("/gear/fragment/convert", ...admin, asyncHandler(MeuMundoController.gearFragmentConvert));
// mm3d-59: missões — o servidor confere cada objetivo; recompensa por recibo único.
router.get("/quest", ...admin, asyncHandler(MeuMundoController.questGet));
router.post("/quest/advance", ...admin, asyncHandler(MeuMundoController.questAdvance));
router.post("/quest/mark", ...admin, asyncHandler(MeuMundoController.questMark));
// Lore v2 F5: Arquivo e vídeos. O ENVIO de vídeo é só de Administrator mesmo
// quando o jogo abrir ao público (hoje todo o jogo já é só de admin).
router.get("/archive", ...admin, asyncHandler(MeuMundoController.archiveGet));
// Lore v2 F6: prédios por nível do treinador (a trava em si mora em cada rota de prédio)
router.get("/buildings", ...admin, asyncHandler(MeuMundoController.buildingsGet));
router.post("/buildings/mission", ...admin, asyncHandler(MeuMundoController.buildingsMission));
// Lore v2 D1: Domínios — a tela do portal e a entrada na cena (travas: treinador + travessia)
router.get("/domains", ...admin, asyncHandler(MeuMundoController.domainsGet));
router.post("/domains/enter", ...admin, asyncHandler(MeuMundoController.domainsEnter));
router.post("/domains/place", ...admin, asyncHandler(MeuMundoController.domainsPlace));
router.post("/archive/read", ...admin, asyncHandler(MeuMundoController.archiveRead));
const videoAdmin = [authMiddleware, roleMiddleware("Administrator")];
router.get("/videos", ...videoAdmin, asyncHandler(MeuMundoController.videosList));
router.post("/videos/:kind/:ref", ...videoAdmin, videoUpload, asyncHandler(MeuMundoController.videosUpload));
router.post("/videos/:kind/:ref/clear", ...videoAdmin, asyncHandler(MeuMundoController.videosClear));
// Mercado → geladeira (mig 301). Comer da geladeira é pela sala da casa (mensagem "fridge").
router.post("/life/buy", ...admin, asyncHandler(MeuMundoController.lifeBuy));
// Pedido no balcão da pizzaria/hamburgueria (mm3d-37c): come na hora, lá dentro.
router.post("/life/order", ...admin, asyncHandler(MeuMundoController.lifeOrder));
// Vendedor do centro (mm3d-37e): casas e cores do carro, com a pessoa na sala dele.
router.get("/shop", ...admin, asyncHandler(MeuMundoController.shopCatalog));
router.post("/shop/house", ...admin, asyncHandler(MeuMundoController.shopHouse));
router.post("/shop/paint", ...admin, asyncHandler(MeuMundoController.shopPaint));
router.post("/life/newcomer", ...admin, asyncHandler(MeuMundoController.lifeNewcomer));
// B3 (mig 340): personagens no lugar das skins — o ativo + a cápsula, trocar e fundir.
router.get("/characters", ...admin, asyncHandler(MeuMundoController.characters));
router.post("/characters/fuse", ...admin, asyncHandler(MeuMundoController.characterFuse));
router.post("/characters/test-grant", ...admin, asyncHandler(MeuMundoController.characterTestGrant));
router.post("/characters/:id/use", ...admin, asyncHandler(MeuMundoController.characterUse));
// B12 (mig 410): Laboratório de Criogenia — embrião na cápsula e acelerador (15 anos).
router.post("/characters/embryo", ...admin, asyncHandler(MeuMundoController.characterEmbryo));
router.post("/characters/genetics", ...admin, asyncHandler(MeuMundoController.characterGenetics));
router.post("/characters/:id/accelerate", ...admin, asyncHandler(MeuMundoController.characterAccelerate));
// Sino e correio interno (mig 302, mm3d-30): histórico, leitura, presentes.
router.get("/notices", ...admin, asyncHandler(MeuMundoController.notices));
router.get("/notices/summary", ...admin, asyncHandler(MeuMundoController.noticesSummary));
router.post("/notices/read", ...admin, asyncHandler(MeuMundoController.noticesRead));
router.get("/mail", ...admin, asyncHandler(MeuMundoController.mail));
router.post("/mail/read-all", ...admin, asyncHandler(MeuMundoController.mailReadAll));
router.get("/mail/prefs", ...admin, asyncHandler(MeuMundoController.mailPrefs));
router.post("/mail/prefs", ...admin, asyncHandler(MeuMundoController.mailPrefsSet));
// Comunicado / promoção / presente da plataforma. Fica no Administrator mesmo
// quando o jogo abrir ao público (esta é a única rota do correio que envia).
router.post("/mail/send", ...admin, asyncHandler(MeuMundoController.mailSend));
router.get("/mail/:id", ...admin, asyncHandler(MeuMundoController.mailOpen));
router.post("/mail/:id/claim", ...admin, asyncHandler(MeuMundoController.mailClaim));
// Aba Itens (inventário real) e os dois saldos (moedas do jogo + Poléns da Freelandoo).
router.get("/inventory", ...admin, asyncHandler(MeuMundoController.inventory));
router.get("/wallets", ...admin, asyncHandler(MeuMundoController.wallets));
// Situação de uma compra de Poléns iniciada no jogo (o crédito é do webhook).
router.get("/polens/purchase/:session", ...admin, asyncHandler(MeuMundoController.polensPurchase));
// Card de perfil (mm3d-31): o jogador tocado, só se estiver na sua sala agora.
router.get("/players/:session", ...admin, asyncHandler(MeuMundoController.playerProfile));
router.get("/hall/player/:id", ...admin, asyncHandler(MeuMundoController.hallPlayerProfile));
// Chat (mm3d-32): Global do jogo e abrir a conversa 1:1 (histórico na Freelandoo).
router.get("/chat/global", ...admin, asyncHandler(MeuMundoController.chatHistory));
router.post("/chat/global", ...admin, rateLimit.chat, asyncHandler(MeuMundoController.chatSend));
router.post("/chat/global/:id/report", ...admin, rateLimit.chat, asyncHandler(MeuMundoController.chatReport));
router.post("/chat/direct", ...admin, asyncHandler(MeuMundoController.chatDirect));
router.get("/status", ...admin, asyncHandler(MeuMundoController.adminStatus));

module.exports = router;
