// src/integrations/whatsappProvider/index.js
// Registro dos provedores de WhatsApp. É a ÚNICA lista de transportes do
// backend: quem quiser saber quais existem pergunta aqui, e quem quiser
// adicionar um escreve o adaptador dele e acrescenta UMA linha em `PROVIDERS`.
//
// ─── POR QUE UM REGISTRO, E NÃO UM `if (provider === "cloud")` ──────────────
//
// Porque o `if` se multiplica: um no service, um no controller, um no sweeper,
// um no front. Foi assim que o `kind === 'condo'` espalhado virou os
// vazamentos C2/C3 do condomínio, e é a mesma lição que o `gameProvider` e o
// `PaymentGateway` já aplicam. Aqui o provedor DECLARA o que sabe fazer e o
// resto pergunta.
//
// ─── O CONTRATO ─────────────────────────────────────────────────────────────
//
//   provider              string curto, é o valor gravado no banco
//   label                 nome de exibição
//   capabilities          { qrPairing, numberRegistration, serviceWindow,
//                           qualityRating, idleSession }
//   isAvailable()         → boolean. A ENV decide, não a flag (regra da mig 214)
//   ensure(instance)      → prepara o lado do provedor (idempotente)
//   connect(instance)     → { connected, qrBase64?, pairingCode?, needsCode? }
//   state(instance)       → { connected, number? }
//                           ⚠️ `connected` pode ser `null` = NÃO SEI (provedor
//                           mudo). Quem chama tem que distinguir isso de
//                           `false`: tratar os dois igual faz a caixa de quem
//                           está conversando virar um botão de conectar por
//                           causa de um soluço de rede.
//   disconnect(instance)
//   sendText(instance, dest, text)  → waMessageId | null
//   fetchMedia(instance, ref)       → { bytes, mimetype, fileName }
//
// `instance` é a LINHA de `tb_whatsapp_instance` — o adaptador lê dela o que
// precisa (`evolution_instance` é o `provider_ref` genérico). Nenhum chamador
// passa credencial: ela é do ambiente e nunca sai daqui.
//
// ─── CAPABILITIES NÃO É ENFEITE ─────────────────────────────────────────────
//
// A Cloud API **não tem QR** (o número é cadastrado e confirmado por SMS) e a
// Evolution **não tem janela de 24h nem quality rating**. A tela precisa
// OMITIR o que não existe, em vez de desenhar um botão que só falha depois do
// clique — mesma razão pela qual o `gameProvider` declara `playtime`.
//
// ⚠️ `idleSession` é o que governa o sweeper da mig 224: a Evolution mantém uma
// sessão Baileys de pé, que custa memória e por isso é desligada depois de
// WHATSAPP_IDLE_DAYS. A Cloud API é STATELESS — desligar um cliente ocioso lá
// arrancaria a integração dele sem motivo nenhum.
//
// ⚠️ ESTE MÓDULO É IMPORTADO PELO SERVICE, NUNCA PELO `WhatsappIngestService`.
// A ingestão não pode ter caminho de código até um envio: é isso, e não uma
// regra escrita, que garante que ninguém é respondido automaticamente pelo
// WhatsApp de um usuário — e é o que sustenta, perante a Meta, que a
// Freelandoo não opera ferramenta de disparo em massa.

const evolution = require("./evolution");
const cloud = require("./cloud");

const PROVIDERS = Object.freeze({ evolution, cloud });

/** O provedor padrão para conexões NOVAS. Conexões existentes seguem o que
 *  está gravado na linha — provedor sai da LINHA, nunca do ambiente (mesma
 *  lição do Asaas na mig 236: cobrança feita num provedor é estornada nele
 *  mesmo depois da plataforma inteira migrar). */
function defaultProvider() {
  const wanted = String(process.env.WHATSAPP_PROVIDER || "").trim().toLowerCase();
  const picked = PROVIDERS[wanted];
  // Pedido sem credencial cai no que estiver configurado — a alternativa seria
  // deixar todo mundo sem conseguir conectar, e o sintoma só apareceria no
  // primeiro clique, em produção.
  if (picked && picked.isAvailable()) return picked;
  if (cloud.isAvailable()) return cloud;
  if (evolution.isAvailable()) return evolution;
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
 * Linha sem `provider` (anterior à mig 240) é da Evolution: o DEFAULT da
 * coluna diz isso, e este fallback cobre o caso de uma projeção que não trouxe
 * a coluna.
 */
function forInstance(instance) {
  return get(instance?.provider || "evolution");
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
