// src/integrations/whatsappProvider/index.js
// Registry de provedores de WhatsApp.
//
// ─── HOJE HÁ UM SÓ: A CLOUD API OFICIAL DA META ─────────────────────────────
//
// A Evolution (Baileys) foi REMOVIDA em 2026-09-16. Ela é cliente não-oficial:
// se passa por WhatsApp Web, viola os Termos da Meta, e o número do usuário
// pode ser banido — permanentemente e sem recurso. A exposição maior nem era
// com a Meta, era com o próprio usuário (CDC art. 14, e cláusula de
// não-indenizar é nula pelo art. 51, I).
//
// Ela pôde sair inteira porque **nenhuma instância dela existia**: a única
// linha de `tb_whatsapp_instance` é `cloud`. Não houve migração de ninguém.
//
// ⚠️ O REGISTRY FICA, mesmo com um provedor só, e não é cerimônia: ele é a
// fronteira que mantém `WhatsappService` falando com um CONTRATO em vez de
// `if (provider === "cloud")` espalhado por doze lugares. Foi essa fronteira
// que permitiu trocar o provedor inteiro sem reescrever o service — e é ela
// que vai receber o provedor da fase 2 (Tech Provider).
//
// ─── O CONTRATO ─────────────────────────────────────────────────────────────
//
//   provider       identificador gravado na linha (`tb_whatsapp_instance`)
//   isAvailable()  → boolean. A ENV decide, NÃO a flag (regra da mig 214):
//                    flag ligada sem credencial produz um botão que só falha
//                    depois do clique, já fora do nosso site.
//   capabilities   o que este provedor sabe fazer. A tela OMITE o que não
//                  existe em vez de oferecer e falhar.
//   connect/state/disconnect/sendText/...
//
// ⚠️ ESTE MÓDULO É IMPORTADO PELO SERVICE, NUNCA PELA INGESTÃO. A ingestão não
// pode ter caminho de código até um envio: é isso, e não uma regra escrita, que
// garante que ninguém é respondido automaticamente pelo WhatsApp de um usuário
// — e é o que sustenta, perante a Meta, que a Freelandoo não opera ferramenta
// de disparo em massa. O `whatsappIngestIsolation.test.js` confere pelo fecho
// transitivo dos `require`.

const cloud = require("./cloud");

const PROVIDERS = Object.freeze({ cloud });

/**
 * O provedor padrão para conexões NOVAS.
 *
 * `WHATSAPP_PROVIDER` continua sendo lido: ele é o que vai escolher entre a
 * Cloud de hoje e o provedor da fase 2 sem exigir deploy de código. Valor
 * desconhecido cai no que estiver configurado, em vez de deixar todo mundo sem
 * conseguir conectar por causa de um typo numa variável de ambiente.
 */
function defaultProvider() {
  const wanted = String(process.env.WHATSAPP_PROVIDER || "").trim().toLowerCase();
  const picked = PROVIDERS[wanted];
  if (picked && picked.isAvailable()) return picked;
  if (cloud.isAvailable()) return cloud;
  return null;
}

/** Todos os provedores conhecidos, disponíveis ou não. */
function all() {
  return Object.values(PROVIDERS);
}

/** O adaptador, ou `null` — nunca lança: o valor pode vir de uma linha antiga. */
function get(provider) {
  return PROVIDERS[String(provider || "").toLowerCase()] || null;
}

/**
 * O adaptador de uma instância gravada.
 *
 * ⚠️ Linha com `provider = 'evolution'` devolve `null` — DE PROPÓSITO. O valor
 * continua aceito pelo CHECK do banco (é histórico, como o próprio nome da
 * coluna `evolution_instance`, que hoje guarda o `phone_number_id` da Cloud),
 * mas não existe mais adaptador para ele. `null` faz o service responder "o
 * WhatsApp não está configurado", que é a verdade, em vez de estourar com um
 * TypeError no meio de uma requisição.
 *
 * Em produção não existe nenhuma linha assim — a última foi conferida antes da
 * remoção.
 */
function forInstance(instance) {
  return get(instance?.provider || "cloud");
}

/** Existe ALGUM provedor configurado neste ambiente? */
function isAnyAvailable() {
  return all().some((p) => p.isAvailable());
}

module.exports = {
  PROVIDERS,
  all,
  get,
  forInstance,
  defaultProvider,
  isAnyAvailable,
};
