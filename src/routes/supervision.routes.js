const { Router } = require("express");
const SupervisionController = require("../controllers/SupervisionController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

// Validação pública do código (sem auth — usada no signup do menor)
router.post(
  "/codes/validate",
  asyncHandler(SupervisionController.validateCode)
);

// Rotas do responsável (autenticado, maior de 18)
router.get(
  "/codes",
  authMiddleware,
  asyncHandler(SupervisionController.listInvites)
);
router.post(
  "/codes",
  authMiddleware,
  asyncHandler(SupervisionController.generateInvite)
);
router.delete(
  "/codes/:id_invite",
  authMiddleware,
  asyncHandler(SupervisionController.revokeInvite)
);

router.get(
  "/minors",
  authMiddleware,
  asyncHandler(SupervisionController.listMinors)
);
router.patch(
  "/minors/:minor_user_id/permissions",
  authMiddleware,
  asyncHandler(SupervisionController.updatePermissions)
);
router.patch(
  "/minors/:minor_user_id/status",
  authMiddleware,
  asyncHandler(SupervisionController.setStatus)
);
router.put(
  "/minors/:minor_user_id/machines/:id_machine",
  authMiddleware,
  asyncHandler(SupervisionController.setMachine)
);

module.exports = router;
