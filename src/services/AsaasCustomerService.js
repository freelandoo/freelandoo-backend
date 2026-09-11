// src/services/AsaasCustomerService.js
// Get-or-create do cliente no Asaas (mig 236).
//
// ─── POR QUE ISTO NÃO EXISTE NO STRIPE ──────────────────────────────────────
//
// No Stripe dá para cobrar um desconhecido: `customer_email` na Checkout
// Session basta. O Asaas exige um `customer` que já exista lá dentro, e criá-lo
// exige `name` + `cpfCnpj`.
//
// Essa é a dependência que a mig 188 (CPF obrigatório por conta) já tinha
// resolvido sem saber: todo usuário da plataforma tem CPF válido, então todo
// usuário pode virar cliente do Asaas sem pedir nada de novo a ele.

const pool = require("../databases");
const AsaasCustomerStorage = require("../storages/AsaasCustomerStorage");
const asaas = require("../integrations/payments/asaasClient");
const { onlyDigits, isValidCPF } = require("../utils/documents");
const { createLogger } = require("../utils/logger");

const log = createLogger("AsaasCustomerService");

class AsaasCustomerError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "AsaasCustomerError";
    this.statusCode = statusCode;
  }
}

/**
 * Devolve o id do cliente no Asaas, criando-o na primeira vez.
 *
 * ⚠️ A ORDEM É: banco → Asaas por externalReference → criar. O passo do meio
 * parece redundante e não é: se a criação anterior gravou no Asaas e falhou ao
 * gravar aqui, criar de novo esbarraria no CPF já cadastrado e a conta ficaria
 * permanentemente impedida de pagar. Procurar antes recupera o vínculo perdido.
 */
async function ensureCustomer(id_user, { conn = pool } = {}) {
  if (!id_user) throw new AsaasCustomerError("Não autenticado", 401);

  const user = await AsaasCustomerStorage.getPayerIdentity(conn, id_user);
  if (!user) throw new AsaasCustomerError("Usuário não encontrado", 404);
  if (user.asaas_customer_id) return user.asaas_customer_id;

  const cpf = onlyDigits(user.cpf);
  // ⚠️ A recusa é explícita e ANTES da ida ao gateway. Mandar CPF vazio faria o
  // Asaas responder um erro de validação cru, que chegaria ao comprador como
  // "falha no pagamento" — escondendo que o que falta é o cadastro dele.
  if (!isValidCPF(cpf)) {
    throw new AsaasCustomerError(
      "Cadastre seu CPF antes de pagar — ele é exigido pelo provedor de pagamento.",
      422
    );
  }

  const name = String(user.nome || "").trim().slice(0, 100);
  if (!name) throw new AsaasCustomerError("Complete seu nome antes de pagar.", 422);

  let customer = await asaas.findCustomerByExternalReference(id_user);
  if (!customer) {
    customer = await asaas.createCustomer({
      name,
      cpfCnpj: cpf,
      email: user.email || undefined,
      externalReference: id_user,
    });
  }

  const customerId = customer?.id;
  if (!customerId) throw new AsaasCustomerError("Asaas não devolveu o cliente", 502);

  const claimed = await AsaasCustomerStorage.attachCustomerId(conn, id_user, customerId);
  if (claimed) {
    log.info("customer.created", { id_user, env: asaas.environment() });
    return customerId;
  }

  // Perdeu a corrida: outro checkout carimbou primeiro. O id do vencedor é o
  // que vale — usar o nosso deixaria duas cobranças da mesma pessoa em clientes
  // diferentes.
  const fresh = await AsaasCustomerStorage.getPayerIdentity(conn, id_user);
  return fresh?.asaas_customer_id || customerId;
}

module.exports = { ensureCustomer, AsaasCustomerError };
