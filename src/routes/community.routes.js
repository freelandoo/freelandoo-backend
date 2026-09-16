const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const requireFeature = require("../middlewares/requireFeature");
const CommunityController = require("../controllers/CommunityController");
const CommunitySiteController = require("../controllers/CommunitySiteController");
const CommunityDomainController = require("../controllers/CommunityDomainController");
const BusinessIndicatorsController = require("../controllers/BusinessIndicatorsController");
const CommunityListingController = require("../controllers/CommunityListingController");
const CommunityDeliveryController = require("../controllers/CommunityDeliveryController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.get(
  "/eligibility",
  authMiddleware,
  asyncHandler(CommunityController.getCreationEligibility)
);

router.get("/me", authMiddleware, asyncHandler(CommunityController.listMine));

// Bundle R$100 (+1 criar / +1 entrar). Antes das rotas /:id_profile.
router.post(
  "/slots/checkout",
  authMiddleware,
  asyncHandler(CommunityController.createSlotCheckout)
);

// Votação de liderança. Antes das rotas /:id_profile.
router.get(
  "/votes/pending",
  authMiddleware,
  asyncHandler(CommunityController.listPendingVotes)
);

router.post(
  "/votes/:id_vote/ballot",
  authMiddleware,
  asyncHandler(CommunityController.castBallot)
);

router.post("/", authMiddleware, asyncHandler(CommunityController.create));

router.patch(
  "/:id_profile/theme",
  authMiddleware,
  asyncHandler(CommunityController.updateTheme)
);

// Privacidade (público/privado + mensalidade) — só líder; flag no Painel.
router.patch(
  "/:id_profile/privacy",
  authMiddleware,
  requireFeature("comunidade_privada"),
  asyncHandler(CommunityController.updatePrivacy)
);

// Entrada paga em comunidade privada (assinatura mensal Stripe).
router.post(
  "/:id_profile/membership/checkout",
  authMiddleware,
  requireFeature("comunidade_privada"),
  asyncHandler(CommunityController.createMembershipCheckout)
);

// Resumo das mensalidades (só líder).
router.get(
  "/:id_profile/membership/summary",
  authMiddleware,
  asyncHandler(CommunityController.getMembershipSummary)
);

// INDICADORES DO NEGÓCIO (mig 235) — leads, site, agendamentos e faturamento.
// Só o LÍDER, e só na modalidade `common`: o guard mora no service, como o do
// site. Sem `requireFeature` de propósito — não há superfície nova a segurar
// aqui, só a leitura do que as outras features já gravaram.
router.get(
  "/:id_profile/indicators",
  authMiddleware,
  asyncHandler(BusinessIndicatorsController.get)
);

// Edição de perfil da comunidade (só líder; guard no service).
router.patch(
  "/:id_profile/profile",
  authMiddleware,
  asyncHandler(CommunityController.updateProfile)
);

router.post(
  "/:id_profile/banner",
  authMiddleware,
  uploadAvatar.single("banner"),
  asyncHandler(CommunityController.uploadBanner)
);

router.post(
  "/:id_profile/avatar",
  authMiddleware,
  uploadAvatar.single("avatar"),
  asyncHandler(CommunityController.uploadAvatar)
);

// Metas coletivas (só líder).
router.put(
  "/:id_profile/goal",
  authMiddleware,
  asyncHandler(CommunityController.setGoal)
);
router.delete(
  "/:id_profile/goal",
  authMiddleware,
  asyncHandler(CommunityController.clearGoal)
);

// Mural do líder (só líder).
router.post(
  "/:id_profile/announcements",
  authMiddleware,
  asyncHandler(CommunityController.createAnnouncement)
);
router.delete(
  "/:id_profile/announcements/:id_announcement",
  authMiddleware,
  asyncHandler(CommunityController.deleteAnnouncement)
);

// Faixa de bees da comunidade (mig 208): os bees publicados no mural daqui,
// vivos pela MESMA regra do resto do site (24h + 1h por ponto, teto 7 dias).
router.get(
  "/:id_profile/bees",
  authMiddleware,
  asyncHandler(CommunityController.listBees)
);

// Feed estilo grupo: liga (membro) / desliga (autor ou líder) um post.
router.post(
  "/:id_profile/feed",
  authMiddleware,
  asyncHandler(CommunityController.linkFeedItem)
);
router.delete(
  "/:id_profile/feed/:id_portfolio_item",
  authMiddleware,
  asyncHandler(CommunityController.unlinkFeedItem)
);

// Recado: nota só-texto no feed da comunidade (membro publica; autor/líder apaga).
router.post(
  "/:id_profile/recado",
  authMiddleware,
  asyncHandler(CommunityController.createRecado)
);
router.delete(
  "/:id_profile/recado/:id_feed_item",
  authMiddleware,
  asyncHandler(CommunityController.deleteRecado)
);

// ─── "Meu Site" da comunidade (mig 212) ──────────────────────────────────────
// Escrita do construtor visual. Só o líder (guard no service) e só com a flag
// `comunidade_site` ligada — a flag barra EDITAR e PUBLICAR; a leitura do site
// já publicado fica fora dela (em communityPublic.routes), pela mesma razão que
// GET /me/spaces não tem requireFeature: desligar o kill-switch segura o que
// ainda não nasceu, não derruba o que já está no ar.
router.put(
  "/:id_profile/site",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunitySiteController.save)
);

// Endereço próprio (mig 213). Trocar o slug quebra os links antigos de
// propósito — não guardamos redirecionamento; o painel avisa antes.
router.patch(
  "/:id_profile/site/slug",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunitySiteController.renameSlug)
);

router.post(
  "/:id_profile/site/publish",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunitySiteController.setPublished)
);

// ─── Site pronto: a oferta (mig 242) ────────────────────────────────────────
// O lado do CLIENTE. Ele lê o que está reservado para ele, aceita a troca e
// pode devolver o site ao construtor.
//
// ⚠️ SEM `requireFeature("comunidade_site")`, nas três — e é a mesma decisão
// das rotas de `/admin/managed-sites`. Aquela flag é o kill-switch do
// CONSTRUTOR; desligá-la um dia para segurar um problema lá não pode impedir a
// entrega (nem a devolução) de um site que foi vendido.
//
// ⚠️ `release` CONTINUA MONTADA MAS RECUSA (410, 2026-09-12): o aceite do
// cliente virou definitivo. Quem devolve agora é só o admin, pela porta de
// `/admin/managed-sites` — ver a justificativa inteira no service. A rota
// fica de pé porque front antigo em cache ainda a chama, e uma recusa que
// se explica vale mais que um 404 que manda procurar defeito.
// PEDIR O SITE (mig 243). Fora do `requireFeature("comunidade_site")` como as
// irmãs, e sem gate de plano: pedir orçamento é o começo da venda, e cobrar
// assinatura para poder PEDIR é cobrar antes de mostrar o produto.
router.post(
  "/:id_profile/site/request",
  authMiddleware,
  asyncHandler(CommunitySiteController.requestSite)
);
router.get(
  "/:id_profile/site/offer",
  authMiddleware,
  asyncHandler(CommunitySiteController.getOffer)
);
router.post(
  "/:id_profile/site/offer/accept",
  authMiddleware,
  asyncHandler(CommunitySiteController.acceptOffer)
);
router.post(
  "/:id_profile/site/release",
  authMiddleware,
  asyncHandler(CommunitySiteController.releaseManaged)
);

// ─── Domínio próprio (mig 214) ──────────────────────────────────────────────
// Só o líder (guard no service). `verify` confere o TXT no DNS e pede o
// certificado; `refresh` só reconsulta o provedor — são botões diferentes
// porque falham por motivos diferentes e o dono precisa saber qual é qual.
router.get(
  "/:id_profile/site/domains",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunityDomainController.list)
);
router.post(
  "/:id_profile/site/domains",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunityDomainController.create)
);
router.post(
  "/:id_profile/site/domains/:id_domain/verify",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunityDomainController.verify)
);
router.post(
  "/:id_profile/site/domains/:id_domain/refresh",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunityDomainController.refresh)
);
router.delete(
  "/:id_profile/site/domains/:id_domain",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunityDomainController.remove)
);

// ─── Equipe do site (mig 221) ───────────────────────────────────────────────
// Quem atende pelo site. Só o líder (guard no service), como todo o resto do
// construtor. Promover NÃO dá papel na comunidade: é só publicar a pessoa no
// site como quem atende.
router.get(
  "/:id_profile/site/professionals",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunitySiteController.listProfessionals)
);
router.post(
  "/:id_profile/site/professionals",
  authMiddleware,
  requireFeature("comunidade_site"),
  asyncHandler(CommunitySiteController.addProfessional)
);
// ⚠️ SEM requireFeature de propósito: o site já publicado continua no ar com a
// flag desligada, e tirar alguém da equipe é a porta de SAÍDA. Trancá-la
// deixaria o líder sem como remover do site público uma pessoa que saiu — e
// porta de saída trancada é a única que não pode existir.
router.delete(
  "/:id_profile/site/professionals/:id_user",
  authMiddleware,
  asyncHandler(CommunitySiteController.removeProfessional)
);

// Imagem do construtor (banner de hero, foto de serviço, galeria). Mesmo
// middleware de imagem do avatar/banner: 12 MB, JPG/PNG/WebP.
router.post(
  "/:id_profile/site/media",
  authMiddleware,
  requireFeature("comunidade_site"),
  uploadAvatar.single("file"),
  asyncHandler(CommunitySiteController.uploadMedia)
);

/* ------------------- vitrines territoriais (condo + bairro) ---------------- */
// As duas vitrines da mig 198 promovidas a ABA e estendidas ao bairro. A rota
// antiga (`/condos/:id_condo/listings*`) continua montada, apontando para o
// MESMO service, porque front em cache ainda a chama.
//
// ⚠️ SEM `requireFeature` AQUI, de propósito: a porta serve condomínio E
// bairro, e cada um tem o seu kill-switch. Um gate fixo mandaria o errado —
// desligar `condominio` fecharia a vitrine do bairro. Quem escolhe a flag é
// `territorialContext`, depois de descobrir a modalidade.
//
// ⚠️ `/listings/quota` ANTES de `/listings/:id_listing` — rota estática vence a
// param, senão "quota" é lido como o id de um anúncio.
router.get(
  "/:id_profile/listings/quota",
  authMiddleware,
  asyncHandler(CommunityListingController.quota)
);
router.get(
  "/:id_profile/listings",
  authMiddleware,
  asyncHandler(CommunityListingController.list)
);
router.post(
  "/:id_profile/listings",
  authMiddleware,
  asyncHandler(CommunityListingController.create)
);
router.patch(
  "/:id_profile/listings/:id_listing",
  authMiddleware,
  asyncHandler(CommunityListingController.update)
);
router.patch(
  "/:id_profile/listings/:id_listing/status",
  authMiddleware,
  asyncHandler(CommunityListingController.setStatus)
);
router.post(
  "/:id_profile/listing-slots/checkout",
  authMiddleware,
  asyncHandler(CommunityListingController.slotCheckout)
);
router.post(
  "/:id_profile/listing-slots/polens",
  authMiddleware,
  asyncHandler(CommunityListingController.slotPolens)
);

/* ------------------ delivery entre vizinhos (condo + bairro) --------------- */
// Mig 248. Qualquer MORADOR abre um chamado pago; qualquer MORADOR aceita e
// recebe. Não existe papel promovido de entregador (decisão do Alex).
//
// ⚠️ SEM `requireFeature` AQUI, pelos DOIS motivos: (a) a porta serve as duas
// modalidades territoriais, cada uma com o seu kill-switch, e (b) o gate da
// própria feature (`delivery_vizinho`) é checado NO SERVICE, que sabe distinguir
// "abrir chamado novo" de "concluir uma corrida que já está em pé" — desligar o
// interruptor não pode prender o dinheiro de quem já carregou o sofá.
//
// ⚠️ A CARTEIRA do entregador NÃO mora aqui: ela é `/me/delivery-payouts`,
// porque o saldo é da PESSOA e não de uma comunidade (ver bookingPayout.routes).
router.get(
  "/:id_profile/deliveries",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.board)
);
router.post(
  "/:id_profile/deliveries",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.open)
);
router.post(
  "/:id_profile/deliveries/availability",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.setAvailability)
);
router.post(
  "/:id_profile/deliveries/:id_delivery/accept",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.accept)
);
router.post(
  "/:id_profile/deliveries/:id_delivery/delivered",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.markDelivered)
);
router.post(
  "/:id_profile/deliveries/:id_delivery/confirm",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.confirm)
);
router.post(
  "/:id_profile/deliveries/:id_delivery/release",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.release)
);
router.post(
  "/:id_profile/deliveries/:id_delivery/cancel",
  authMiddleware,
  asyncHandler(CommunityDeliveryController.cancel)
);

router.post(
  "/:id_profile/join",
  authMiddleware,
  asyncHandler(CommunityController.join)
);

router.post(
  "/:id_profile/leave",
  authMiddleware,
  asyncHandler(CommunityController.leave)
);

module.exports = router;
