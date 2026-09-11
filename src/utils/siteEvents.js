// src/utils/siteEvents.js
//
// O que o visitante anônimo consegue registrar no site publicado de uma
// comunidade — a lista FECHADA, num lugar só (mig 235).
//
// Esta lista é a FRONTEIRA DE CONFIANÇA da porta pública: o `kind` chega de um
// POST sem autenticação nenhuma, e é ele que vira valor de coluna com CHECK.
// Espalhar a lista pelo controller e pela storage é como uma delas passaria a
// aceitar um valor que a outra recusa — e, do lado que aceita, a linha nasceria
// numa categoria que nenhuma tela soma.
//
// ⚠️ EVENTO NOVO = uma entrada AQUI, o valor no CHECK de uma migration nova e o
// espelho em `components/site/site-analytics.tsx` no front. Faltando o CHECK, a
// gravação estoura em produção; faltando o espelho, ninguém manda o evento e o
// número nasce parado em zero — que é o pior dos dois, porque parece um dado.

/** Alguém abriu o site. Uma por sessão do navegador (o cliente deduplica). */
const VIEW = "view";
/** Alguém apertou um botão que leva à página de agendamento. */
const BOOKING_CLICK = "booking_click";
/** Alguém apertou o botão de WhatsApp do site. */
const WHATSAPP_CLICK = "whatsapp_click";

const SITE_EVENT_KINDS = Object.freeze([VIEW, BOOKING_CLICK, WHATSAPP_CLICK]);

/** `true` só para o que a tabela aceita. Não normaliza: o cliente manda certo. */
function isSiteEventKind(kind) {
  return SITE_EVENT_KINDS.includes(kind);
}

module.exports = {
  VIEW,
  BOOKING_CLICK,
  WHATSAPP_CLICK,
  SITE_EVENT_KINDS,
  isSiteEventKind,
};
