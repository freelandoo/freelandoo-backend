/**
 * socialPolicy.js — a régua ÚNICA de "esta mensagem direta pode sair?"
 * (Módulo 09 da Arena; vale para a plataforma inteira).
 *
 * Antes, cada caminho de envio checava um pedaço: o envio de TEXTO numa
 * conversa já existente não revalidava o destinatário (menor que deixou de
 * aceitar mensagens continuava recebendo), e nada olhava a sanção da conta do
 * remetente — o authMiddleware é JWT puro, então um token emitido antes do
 * bloqueio da conta seguia mandando mensagem até expirar. Aqui ficam as
 * checagens ATUAIS, chamadas por abrir conversa, enviar texto e enviar áudio:
 *
 *   1. conta do remetente ativa e sem sanção (tb_user.ativo / blocked_at);
 *   2. conta do destinatário ativa e sem sanção;
 *   3. destinatário menor aceita mensagens (can_receive_messages);
 *   4. nenhum bloqueio social entre as duas CONTAS (tb_user_block, mig 283) —
 *      trocar de perfil não contorna, porque a chave é a conta.
 *
 * Retorna null (pode) ou { error, statusCode, code } (não pode). O texto do
 * bloqueio é o MESMO nos dois sentidos de propósito: dizer "ele bloqueou
 * você" revelaria a escolha de outra pessoa.
 */

const UserBlockStorage = require("../storages/UserBlockStorage");
const { assertMinorPermission } = require("./supervision");

const deny = (code, error, statusCode = 403) => ({ error, statusCode, code });

async function assertSenderEligible(conn, senderUserId) {
  const acc = await UserBlockStorage.accountState(conn, senderUserId);
  if (!acc) return deny("account_not_found", "Conta não encontrada", 401);
  if (acc.blocked_at) return deny("account_blocked", "Conta bloqueada");
  if (!acc.ativo) return deny("account_inactive", "Conta inativa");
  return null;
}

/**
 * Pode `senderUserId` mandar mensagem direta para a entidade `targetEntityId`
 * (perfil ou clan)? Mesma conta dos dois lados (falar com o próprio clan) não
 * é bloqueável.
 */
async function assertDirectAllowed(conn, { senderUserId, targetEntityId }) {
  const sender = await assertSenderEligible(conn, senderUserId);
  if (sender) return sender;
  const targetUserId = await UserBlockStorage.ownerOfEntity(conn, targetEntityId);
  if (!targetUserId) return deny("target_unavailable", "Destinatário não está disponível para mensagens", 404);
  if (String(targetUserId) === String(senderUserId)) return null;
  const target = await UserBlockStorage.accountState(conn, targetUserId);
  if (!target || target.blocked_at || !target.ativo) {
    return deny("target_unavailable", "Destinatário não está disponível para mensagens");
  }
  const recv = await assertMinorPermission(targetUserId, "can_receive_messages", conn);
  if (recv) return deny("target_not_accepting", "Destinatário não está aceitando mensagens");
  if (await UserBlockStorage.eitherBlocks(conn, senderUserId, targetUserId)) {
    return deny("blocked", "Não é possível trocar mensagens com esta conta");
  }
  return null;
}

module.exports = { assertDirectAllowed, assertSenderEligible };
