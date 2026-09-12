const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
const requirePlanFeature = require("../middlewares/requirePlanFeature");
const WhatsappController = require("../controllers/WhatsappController");
const asyncHandler = require("../utils/asyncHandler");

// WhatsApp do usuário (mig 223), base `/whatsapp`.
//
// ─── ORDEM: LITERAL ANTES DE PARÂMETRO ──────────────────────────────────────
//
// `instance`, `conversations` e `messages` vêm ANTES de qualquer `:id`. Mesma
// disciplina que `/bees/timeline` e `/gamer/providers` exigiram — declarada
// depois, a rota com parâmetro engole a literal e o erro aparece como "rota
// inexistente", que manda procurar no lugar errado.
const router = Router();

// ─── Conexão ────────────────────────────────────────────────────────────────

/**
 * Status. FORA da flag de propósito: com a feature desligada a aba ainda
 * precisa saber dizer o que houve, e um 403 aqui deixaria a tela sem nenhuma
 * resposta para desenhar. Quem realmente bloqueia é o QR e o envio.
 */
router.get("/instance", authMiddleware, asyncHandler(WhatsappController.status));

/** O QR do pareamento. Idempotente: a tela chama a cada renovação (~20s). */
router.get(
  "/instance/qrcode",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  // A posse entra AQUI, e não no status: é este clique que levanta a sessão na
  // Evolution, e é a sessão que custa memória enquanto estiver de pé (mig 224).
  // O status fica aberto para a aba conseguir escrever o motivo em vez de
  // mostrar um botão que só falha depois do clique.
  requirePlanFeature("whatsapp"),
  asyncHandler(WhatsappController.qrcode)
);

/**
 * Cadastro de número — o caminho da Cloud API, que NÃO tem QR (W3).
 *
 * Mesmos dois guards do QR, e pela mesma razão: é este clique que cria o
 * número dentro do NOSSO WABA, e o teto da fase 1 é o número de números (2 no
 * começo, até 20). Deixar sem `requirePlanFeature` faria qualquer conta gastar
 * uma das vagas do portfólio.
 *
 * São duas rotas porque são dois passos separados por um SMS: entre informar o
 * número e digitar o código passa o tempo da operadora, e uma chamada só teria
 * que segurar a requisição aberta esperando a pessoa ler o celular.
 */
router.post(
  "/instance/number",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  requirePlanFeature("whatsapp"),
  asyncHandler(WhatsappController.cloudAddNumber)
);

router.post(
  "/instance/number/verify",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  requirePlanFeature("whatsapp"),
  asyncHandler(WhatsappController.cloudVerifyCode)
);

/** Reenviar o código: o SMS se perde, e sem isto a saída seria recomeçar. */
router.post(
  "/instance/number/resend",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  requirePlanFeature("whatsapp"),
  asyncHandler(WhatsappController.cloudResendCode)
);

/**
 * Desconectar NÃO passa pela flag: desligada a feature, quem já conectou tem
 * que continuar podendo desligar o próprio número. Porta de saída trancada é a
 * única que não pode existir (regra da mig 220).
 */
router.delete("/instance", authMiddleware, asyncHandler(WhatsappController.disconnect));

// ─── A caixa ────────────────────────────────────────────────────────────────

router.get(
  "/conversations",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  asyncHandler(WhatsappController.listConversations)
);

router.get(
  "/conversations/:id_conversation/messages",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  asyncHandler(WhatsappController.listMessages)
);

router.post(
  "/conversations/:id_conversation/messages",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  asyncHandler(WhatsappController.sendText)
);

/** Bytes da mídia recebida, buscados na Evolution na hora (nada em repouso). */
router.get(
  "/messages/:id_message/media",
  authMiddleware,
  requireFeature("whatsapp_atendimento"),
  asyncHandler(WhatsappController.media)
);

module.exports = router;
