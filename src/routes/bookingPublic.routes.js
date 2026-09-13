const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const optionalAuthMiddleware = require("../middlewares/optionalAuthMiddleware");
const rateLimit = require("../middlewares/rateLimit");
const BookingController = require("../controllers/BookingController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// ─── Público: slots disponíveis ────────────────────────────────────
router.get(
  "/:id_profile/available-slots",
  asyncHandler(BookingController.getAvailableSlots)
);

// ─── Público: dados completos da semana ─────────────────────────────
router.get(
  "/:id_profile/calendar/week",
  asyncHandler(BookingController.getWeekData)
);

// ─── Criar booking: COM OU SEM CONTA ───────────────────────────────
//
// ⚠️ ERA `authMiddleware` (bloqueante) e virou OPCIONAL (mig 244). Num site de
// barbearia exigir cadastro para marcar um corte é pedágio: a pessoa veio de
// uma busca, quer um horário, e criar conta numa plataforma que ela não
// conhece é a parte do fluxo onde ela desiste. O service continua tirando nome
// e e-mail da CONTA quando há sessão — é o que impede alguém de marcar em nome
// de outra pessoa usando o próprio token; sem sessão eles vêm do corpo e o
// agendamento nasce com `id_client_user` NULL (a coluna sempre foi NULL-able).
//
// ⚠️ E POR ISSO ENTRA RATE LIMIT: era o login que segurava a enxurrada. Sem
// conta, cada requisição aceita marca um horário na agenda de alguém — e no
// modo balcão ela nasce CONFIRMADA, sem cobrança nenhuma para o sweeper
// expirar. O limite é por IP e não substitui o dono cancelar o que for falso;
// ele impede o roteiro que preenche a agenda inteira em segundos.
router.post(
  "/:id_profile/bookings",
  rateLimit.checkout,
  optionalAuthMiddleware,
  asyncHandler(BookingController.createPublicBooking)
);

// ─── Owner: todos os agendamentos do usuário ───────────────────────
router.get(
  "/my-bookings",
  authMiddleware,
  asyncHandler(BookingController.listOwnerBookings)
);

// ─── Owner: atualizar status ───────────────────────────────────────
router.patch(
  "/bookings/:bookingId/status",
  authMiddleware,
  asyncHandler(BookingController.updateBookingStatus)
);

module.exports = router;
