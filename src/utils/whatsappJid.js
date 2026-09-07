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

module.exports = {
  onlyDigits,
  isGroupJid,
  isPersonJid,
  isConversationJid,
  phoneFromJid,
  formatPhone,
  redactPhone,
};
