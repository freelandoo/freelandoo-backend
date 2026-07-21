// Schemas Zod das rotas de autenticação.
//
// Filosofia: validação MÍNIMA no boundary — só rejeita request claramente
// malformado (body vazio, tipos errados, email com formato inválido).
// Validação de regra de negócio (força de senha, idade, username em uso,
// etc.) continua no AuthService — não duplicar.
//
// Campos do backend são em português (nome, senha, novaSenha) por
// histórico do projeto. NÃO mudar.

const { z } = require("zod");

const emailSchema = z
  .string({ message: "Email é obrigatório." })
  .trim()
  .toLowerCase()
  .min(5, "Email muito curto.")
  .max(254, "Email muito longo.")
  .email("Email inválido.");

const senhaSchema = z
  .string({ message: "Senha é obrigatória." })
  .min(1, "Senha é obrigatória.")
  .max(200, "Senha muito longa.");

// passthrough em todos pra não bloquear campos opcionais que o service
// usa (display_name, bio, avatar_url, responsible_code, estado, etc).

const signupBody = z
  .object({
    nome: z.string().trim().min(1, "Nome obrigatório.").max(120),
    email: emailSchema,
    senha: senhaSchema,
    data_nascimento: z.string().trim().min(4, "Data de nascimento obrigatória."),
    // Aceita com ou sem máscara; o dígito verificador é conferido no
    // AuthService (normalizeCPF), junto com a duplicidade.
    cpf: z.string().trim().min(11, "CPF obrigatório.").max(14),
  })
  .passthrough();

const signinBody = z
  .object({
    email: emailSchema,
    senha: senhaSchema,
  })
  .passthrough();

// Frontend (Google Identity Services) manda `credential`; clientes
// legados podem mandar `id_token`. AuthService aceita os dois.
const googleSigninBody = z
  .object({
    credential: z.string().min(20).optional(),
    id_token: z.string().min(20).optional(),
  })
  .passthrough()
  .refine((data) => Boolean(data.credential || data.id_token), {
    message: "credential ou id_token é obrigatório.",
    path: ["credential"],
  });

const forgotPasswordBody = z
  .object({
    email: emailSchema,
  })
  .passthrough();

const resetPasswordBody = z
  .object({
    token: z.string().min(10, "Token ausente.").max(500),
    novaSenha: senhaSchema,
  })
  .passthrough();

// AuthController aceita ?u= ou ?username=
const checkUsernameQuery = z
  .object({
    u: z.string().trim().min(1).max(60).optional(),
    username: z.string().trim().min(1).max(60).optional(),
  })
  .passthrough()
  .refine((data) => Boolean(data.u || data.username), {
    message: "Parâmetro u (ou username) é obrigatório.",
    path: ["u"],
  });

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
