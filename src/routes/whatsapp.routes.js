const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const requireFeature = require("../middlewares/requireFeature");
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
  asyncHandler(WhatsappController.qrcode)
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
