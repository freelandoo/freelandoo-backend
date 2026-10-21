// Schemas Zod do primeiro acesso e do aceite da conta vinda de academia (mig 296).
// Validação mínima no boundary; força de senha e estado da conta ficam no service.
const { z } = require("zod");

const firstAccessBody = z.object({
  token: z.string({ message: "Token é obrigatório." }).trim().min(1, "Token é obrigatório.").max(200),
  senha: z.string({ message: "Senha é obrigatória." }).min(1, "Senha é obrigatória.").max(200),
});

const firstAccessParams = z.object({
  token: z.string().trim().min(1).max(200),
});

const acceptBody = z
  .object({
    foto: z.boolean().optional().default(false),
  })
  .passthrough();

module.exports = { firstAccessBody, firstAccessParams, acceptBody };
