const { Router } = require("express");
const AuthController = require("../controllers/AuthController");
const authMiddleware = require("../middlewares/authMiddleware");
const asyncHandler = require("../utils/asyncHandler");
const rateLimit = require("../middlewares/rateLimit");
const validate = require("../middlewares/validate");
const authSchemas = require("../schemas/authSchemas");

const router = Router();

router.post(
  "/signup",
  rateLimit.auth,
  validate({ body: authSchemas.signupBody }),
  asyncHandler(AuthController.signup)
);
router.get(
  "/check-username",
  validate({ query: authSchemas.checkUsernameQuery }),
  asyncHandler(AuthController.checkUsername)
);
// Disponibilidade do CPF enquanto a pessoa digita (mig 188: 1 CPF = 1 conta).
// O signup já dizia "cpf_taken" no fim — isto só ANTECIPA a mesma resposta
// para o campo, antes de a pessoa preencher o resto. Com rate limit próprio
// porque a porta é anônima e responde sobre um documento: o `auth` (5/min)
// derrubaria quem corrige um dígito duas vezes, e sem limite nenhum viraria
// varredura de CPF.
router.get(
  "/check-cpf",
  rateLimit.lookup,
  validate({ query: authSchemas.checkCpfQuery }),
  asyncHandler(AuthController.checkCpf)
);
router.post(
  "/signin",
  rateLimit.auth,
  validate({ body: authSchemas.signinBody }),
  asyncHandler(AuthController.signin)
);
router.post(
  "/google-signin",
  rateLimit.auth,
  validate({ body: authSchemas.googleSigninBody }),
  asyncHandler(AuthController.googleSignin)
);
router.get(
  "/activate",
  validate({ query: authSchemas.activateQuery }),
  asyncHandler(AuthController.activate)
);
router.post(
  "/resend-activation",
  authMiddleware,
  rateLimit.auth,
  asyncHandler(AuthController.resendActivation)
);
router.post(
  "/change-email",
  authMiddleware,
  rateLimit.auth,
  asyncHandler(AuthController.changeEmail)
);
router.post(
  "/forgot-password",
  rateLimit.auth,
  validate({ body: authSchemas.forgotPasswordBody }),
  asyncHandler(AuthController.forgotPassword)
);
router.post(
  "/reset-password",
  rateLimit.auth,
  validate({ body: authSchemas.resetPasswordBody }),
  asyncHandler(AuthController.resetPassword)
);

module.exports = router;
