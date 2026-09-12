// src/utils/whatsappJid.js
// Endereço do WhatsApp (JID) e telefone. Módulo PURO — não toca banco nem rede.
//
// Copiado do Coliseu (`src/lib/whatsapp/telefone.ts`), menos a parte de casar
// com cadastro: lá o telefone vira lead no CRM; aqui a conversa é da pessoa que
// conectou o número, e não existe cadastro para casar.
//
// O WhatsApp entrega o endereço em quatro formas, e confundi-las cria dado
// falso: telefone (`5511900000000@s.whatsapp.net`), grupo (`120363...@g.us`),
// `@lid` (identificador opaco de quem NÃO expõe o número) e transmissão/status.

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

/** Grupo: `120363...@g.us`. Conversa coletiva. */
function isGroupJid(jid) {
  return /@g\.us$/i.test(String(jid ?? "").trim());
}

/** Conversa de duas pessoas — nem grupo, nem transmissão, nem status. */
function isPersonJid(jid) {
  const v = String(jid ?? "").trim();
  if (!v) return false;
  if (isGroupJid(v)) return false;
  if (/@broadcast$/i.test(v)) return false;
  if (/^status@/i.test(v)) return false;
  return true;
}

/**
 * O que vira conversa na caixa: pessoa OU grupo. Transmissão e status ficam de
 * fora — não são conversa, são publicação de mão única, e apareceriam na lista
 * como alguém esperando resposta.
 */
function isConversationJid(jid) {
  return isGroupJid(jid) || isPersonJid(jid);
}

/**
 * Telefone de um JID. `@lid` e grupo devolvem vazio de propósito: o `120363…`
 * de um grupo tem cara de telefone, e tratá-lo como número escreveria na caixa
 * um contato que não existe.
 */
function phoneFromJid(jid) {
  const v = String(jid ?? "").trim();
  if (!v || /@lid$/i.test(v) || isGroupJid(v)) return "";
  const [head] = v.split("@");
  const d = onlyDigits(head);
  return d.length >= 10 ? d : "";
}

/** Exibição: (11) 90000-0000, tolerando DDI e números fora do padrão BR. */
function formatPhone(value) {
  const d = onlyDigits(value);
  const national = d.startsWith("55") && d.length > 11 ? d.slice(2) : d;
  if (national.length === 11) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  }
  if (national.length === 10) {
    return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  }
  return national || "";
}

/** Telefone em log NUNCA aparece inteiro (LGPD) — nem o de terceiro. */
function redactPhone(value) {
  const d = onlyDigits(value);
  return d.length <= 4 ? "****" : `****${d.slice(-4)}`;
}

/**
 * Separa DDI do resto — a Cloud API exige os dois campos (`cc` e
 * `phone_number`) e RECUSA o número inteiro num só, com uma mensagem que não
 * explica o motivo.
 *
 * ⚠️ O DDI É INFERIDO, e a régua é o COMPRIMENTO. No Brasil o número completo
 * tem 10 dígitos (fixo com DDD) ou 11 (celular com DDD); com o 55 na frente,
 * 12 ou 13. Quem digita o próprio celular escreve "11988887777", sem DDI —
 * é assim que se escreve para um amigo, e é o caso comum.
 *
 * O erro que isto evita é silencioso nos dois sentidos: sem inferir, o número
 * vira DDI "11" + resto e a Meta cadastra um número que não existe; inferindo
 * sem olhar o tamanho, "5511988887777" viraria "55" + "5511988887777".
 *
 * @returns {{cc: string, number: string, full: string} | null} `null` quando
 *   não dá para afirmar nada — e aí é melhor recusar do que adivinhar um
 *   número de telefone.
 */
function splitPhone(value, defaultCc = "55") {
  const digits = onlyDigits(value);
  // 10 = fixo brasileiro com DDD. Menos que isso não é número completo em
  // lugar nenhum; mais que 15 é o teto do E.164.
  if (digits.length < 10 || digits.length > 15) return null;

  const full = digits.length <= 11 ? `${defaultCc}${digits}` : digits;
  return { cc: full.slice(0, defaultCc.length), number: full.slice(defaultCc.length), full };
}

module.exports = {
  onlyDigits,
  isGroupJid,
  isPersonJid,
  isConversationJid,
  phoneFromJid,
  formatPhone,
  redactPhone,
  splitPhone,
};
