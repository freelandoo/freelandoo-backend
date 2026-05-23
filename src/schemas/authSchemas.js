// Schemas Zod das rotas de autenticação.
// Mantém limites compatíveis com o que AuthService já assume (e com o
// schema do banco — username max 30, etc.). Não loosens nem tightens
// regras de negócio; apenas rejeita lixo no boundary.

const { z } = require("zod");

const emailSchema = z
  .string({ message: "Email é obrigatório." })
  .trim()
  .toLowerCase()
  .min(5, "Email muito curto.")
  .max(254, "Email muito longo.")
  .email("Email inválido.");

const passwordSchema = z
  .string({ message: "Senha é obrigatória." })
  .min(6, "Senha deve ter ao menos 6 caracteres.")
  .max(200, "Senha muito longa.");

const usernameSchema = z
  .string({ message: "Username é obrigatório." })
  .trim()
  .min(3, "Username muito curto.")
  .max(30, "Username muito longo.")
  .regex(
    /^[a-zA-Z0-9._-]+$/,
    "Username pode conter apenas letras, números, ponto, underline e hífen."
  );

const signupBody = z
  .object({
    name: z.string().trim().min(1, "Nome obrigatório.").max(120),
    email: emailSchema,
    password: passwordSchema,
    username: usernameSchema.optional(),
    affiliateCode: z.string().trim().max(60).optional(),
  })
  .passthrough(); // mantém outros campos opcionais que o service usa

const signinBody = z
  .object({
    email: emailSchema,
    password: passwordSchema,
  })
  .passthrough();

const googleSigninBody = z
  .object({
    id_token: z.string().min(20, "id_token ausente."),
  })
  .passthrough();

const forgotPasswordBody = z
  .object({
    email: emailSchema,
  })
  .passthrough();

const resetPasswordBody = z
  .object({
    token: z.string().min(10, "Token ausente.").max(500),
    password: passwordSchema,
  })
  .passthrough();

const checkUsernameQuery = z
  .object({
    username: usernameSchema,
  })
  .passthrough();

const activateQuery = z
  .object({
    token: z.string().min(10).max(500),
  })
  .passthrough();

module.exports = {
  signupBody,
  signinBody,
  googleSigninBody,
  forgotPasswordBody,
  resetPasswordBody,
  checkUsernameQuery,
  activateQuery,
};
