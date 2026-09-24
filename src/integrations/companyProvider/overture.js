// src/integrations/companyProvider/overture.js
// O Overture Maps como fonte de DESCOBERTA.
//
// ─── POR QUE ELE EXISTE ─────────────────────────────────────────────────────
//
// A descoberta nasceu no OpenStreetMap, e o OSM cobre bem o que tem fachada de
// destino e quase ignora o resto. O número que decidiu a troca foi MEDIDO, não
// estimado: **zero barbearias mapeadas em Diadema** — conferido na própria
// Overpass, e não deduzido de uma base vazia — contra **302 no Overture**. No
// estado de São Paulo são 821 contra 43.250.
//
// E não é só volume: as categorias que o OSM praticamente não tem são
// exatamente as que atendem na casa do cliente, que é boa parte do público
// desta plataforma. Eletricista 39 → 2.007. Energia solar 4 → 964. Gráfica
// 119 → 8.060. Contador 166 → 11.450.
//
// ⚠️ A LICENÇA É O QUE TORNA ISTO POSSÍVEL, e ela foi conferida NOS REGISTROS
// da própria região, não no material de divulgação: as licenças que aparecem
// são CC0-1.0, CDLA-Permissive-2.0 e Apache-2.0. Nenhuma é ODbL. Isso importa
// porque `tb_company` funde fontes CAMPO A CAMPO — misturar dado ODbL aqui
// criaria uma "Derivative Database" e a base inteira herdaria a obrigação de
// ser publicada sob ODbL. Fonte nova entra por este arquivo só depois de
// alguém ter olhado a licença dela.
//
// ⚠️ ISTO NÃO FALA COM A REDE, E É DE PROPÓSITO. O Overture é um arquivo
// estático no S3, lido OFFLINE por `scripts/prospect/build-overture.js`, que
// deixa o resultado numa partição do R2. O caminho quente continua sendo o
// `r2Partition`. É assim que o gargalo operacional some: não há mais slot da
// Overpass para esperar, 504 para tentar de novo, nem pacing de horas.
//
// Módulo PURO: recebe a linha já lida e devolve o rascunho.

const { categoryFromOvertureCategory } = require("../../utils/companyCategories");
const N = require("../../utils/companyNormalize");

/** Redes que sabemos reconhecer numa URL. Espelha o `osm.js`. */
const SOCIAL_HOSTS = [
  ["instagram", "instagram.com"],
  ["facebook", "facebook.com"],
  ["facebook", "fb.com"],
  ["linkedin", "linkedin.com"],
  ["tiktok", "tiktok.com"],
  ["youtube", "youtube.com"],
  ["youtube", "youtu.be"],
];

function socialNetworkOf(url) {
  const host = N.normalizeDomain(url);
  if (!host) return null;
  const hit = SOCIAL_HOSTS.find(([, h]) => host === h || host.endsWith("." + h));
  return hit ? hit[0] : null;
}

/** `wa.me/55…` é TELEFONE, não site. */
function whatsappFromUrl(url) {
  const host = N.normalizeDomain(url);
  if (!host) return null;
  if (!/(^|\.)(wa\.me|api\.whatsapp\.com|whatsapp\.com)$/.test(host)) return null;
  const digits = String(url).replace(/^https?:\/\//i, "").replace(/\D/g, "");
  return N.normalizePhone(digits);
}

const arr = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

/**
 * Separa o que o Overture joga junto em `websites` e `socials`.
 *
 * ⚠️ O CAMPO `websites` DO OVERTURE CARREGA REDE SOCIAL. Medido na região
 * metropolitana: 7.749 lugares têm o Instagram ali, e não em `socials` — quase
 * dez vezes mais do que no campo que existe para isso. Ler só `socials`
 * jogaria fora a maior parte do Instagram que a base tem, e o sintoma seria a
 * tela dizer "sem Instagram" para quem tem.
 */
function routeUrls(websites, socials) {
  const out = { website: null, socials: {}, whatsapp: null };
  // ⚠️ `socials` VEM ANTES DE PROPÓSITO: é o campo que existe para responder
  // esta pergunta, e o primeiro a preencher cada rede é o que vale. Em
  // `websites` a rede aparece por acidente de preenchimento.
  for (const raw of [...arr(socials), ...arr(websites)]) {
    const url = N.normalizeWebsite(raw);
    if (!url) continue;

    const zap = whatsappFromUrl(url);
    if (zap) {
      out.whatsapp = out.whatsapp || zap;
      continue;
    }
    const net = socialNetworkOf(url);
    if (net) {
      if (!out.socials[net]) {
        const handle = N.normalizeSocialHandle(url, net);
        if (handle) out.socials[net] = handle;
      }
      continue;
    }
    out.website = out.website || url;
  }
  return out;
}

/**
 * `freeform` vem como "Rua José Bonifácio, 535" — rua e número juntos.
 *
 * O `tb_company` guarda os dois separados porque a tela mostra o número ao lado
 * da rua e porque o casamento por endereço compara rua com rua. Não havendo
 * número reconhecível, a rua inteira fica no campo da rua: é melhor um endereço
 * sem número do que um número inventado a partir de outra coisa no fim da linha.
 */
function splitAddress(freeform) {
  const s = String(freeform || "").trim();
  if (!s) return { street: null, number: null };
  const m = s.match(/^(.*?),\s*(\d{1,6}[A-Za-z]?)$/);
  if (m) return { street: m[1].trim() || null, number: m[2] };
  return { street: s, number: null };
}

/**
 * Uma linha do Overture vira o rascunho neutro que o matching entende.
 *
 * ⚠️ `osm_ref` PASSA A GUARDAR UM ID DO OVERTURE, E O NOME MENTE. É reuso
 * deliberado, pela mesma disciplina de `tb_machine` (que guarda enxames) e
 * `evolution_instance` (que guarda o número da Cloud API): aquela coluna é a
 * IDENTIDADE EXTERNA do lugar, é ela que `findByOsmRef` consulta e é ela que
 * `ingestPartition` exige. Uma coluna nova custaria migration, índice e três
 * caminhos de ingestão para responder exatamente à mesma pergunta.
 *
 * ⚠️ O PREFIXO `overture/` NÃO É ENFEITE: é o que mantém as duas fontes
 * SEPARÁVEIS numa linha de SQL. Sem ele, desfazer a troca — ou só responder
 * "quais linhas vieram de onde" — viraria arqueologia.
 */
function toDraft(row) {
  const name = String(row?.name || "").trim();
  if (!name) return null;

  const id = String(row?.id || "").trim();
  if (!id) return null;

  const category_key = categoryFromOvertureCategory(row?.category);
  const routed = routeUrls(row?.websites, row?.socials);

  const phones = arr(row?.phones).map((p) => N.normalizePhone(p)).filter(Boolean);
  const phone = phones[0] || null;
  const { street, number } = splitAddress(row?.address);

  const lat = row?.lat === null || row?.lat === undefined ? null : Number(row.lat);
  const lon = row?.lon === null || row?.lon === undefined ? null : Number(row.lon);

  const fields = {
    display_name: name,
    trade_name: name,
    category_key,
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
    address: street,
    address_number: number,
    neighborhood: null,
    city: String(row?.city || "").trim() || null,
    uf: String(row?.uf || "").trim().toUpperCase().slice(0, 2) || null,
    zip_code: N.normalizeZip(row?.zip),
    website: routed.website,
    domain: N.normalizeDomain(routed.website),
    email: N.normalizeEmail(arr(row?.emails)[0]),
    phone,
    // ⚠️ MESMA REGRA DO OSM: link de wa.me vence, e sem ele um telefone que é
    // CELULAR é um WhatsApp em potencial. É essa dedução que faz o filtro "com
    // WhatsApp" achar 516 mil empresas na região metropolitana em vez de quase
    // ninguém — num país onde o comércio atende por ele.
    whatsapp: routed.whatsapp || phones.find((p) => N.isMobilePhone(p)) || null,
    instagram: routed.socials.instagram || null,
    facebook: routed.socials.facebook || null,
    linkedin: routed.socials.linkedin || null,
    tiktok: routed.socials.tiktok || null,
    youtube: routed.socials.youtube || null,
    // O Overture não carrega CNPJ. Fica NULO em vez de vazio: é "não sei", não
    // "não tem" — e é a diferença que impede a régua de confiança de tratar a
    // ausência como um valor que pode vencer o da Receita.
    cnpj: null,

    // ⚠️ O SINAL DE REDE/FRANQUIA. `brand` é o campo do Overture que diz que
    // este ponto pertence a uma marca. MEDIDO em SP: 26,2% das farmácias o têm
    // (e ele pega Drogaria São Paulo, Raia, Drogasil, Pague Menos, Farmais)
    // contra 1,2% das barbearias, que quase não têm rede — ou seja, ele não é
    // ruído: só acende onde rede existe.
    //
    // ⚠️ É MARCADO, NUNCA DESCARTADO. Quem decide se rede entra na lista é a
    // TELA, não a ingestão: franqueado às vezes compra (a unidade costuma ter
    // verba local), e apagar aqui exigiria REGERAR o lote inteiro para voltar
    // atrás.
    //
    // ⚠️⚠️ TER MARCA NÃO É SER REDE, E CONFUNDIR OS DOIS ESCONDE LEAD BOM.
    // Medido em SP (farmácia, barbearia, padaria, salão): das marcas
    // distintas, 303 têm UMA LOJA SÓ — "Barbearia HeroBoy", "Padaria
    // Delícia", "Farmácia Indiana". São independentes que preencheram o
    // campo com o próprio nome. `brand IS NOT NULL` marcaria as 303 como
    // rede e as tiraria da lista — o oposto do que a feature existe para
    // fazer. Rede de verdade são as 39 marcas com 20+ lojas, que sozinhas
    // respondem por 4.316 lugares.
    //
    // ⚠️ POR ISSO O RASCUNHO NÃO DECIDE — ele só CARREGA a marca. "É rede?"
    // depende de CONTAR as lojas daquela marca no lote, e uma linha sozinha
    // não tem como saber disso. A decisão mora onde o lote inteiro é
    // visível (geração/ingestão), nunca aqui.
    //
    // ⚠️ E `brand` É INCOMPLETO pelo outro lado: a Farmelhor aparece dos DOIS
    // (72 lojas com marca e 38 sem). Fechar essa fresta exige repetição de
    // nome CRUZADA com domínio compartilhado; repetição sozinha NÃO serve,
    // porque "Drogaria Central" ×38 são 38 independentes homônimas.
    brand_name: String(row?.brand_name || "").trim() || null,
    brand_wikidata: String(row?.brand_wikidata || "").trim() || null,

    // Diz se o lugar fechou. Medido em SP: ZERO não-abertos nestas categorias
    // hoje, então ele é inerte — existe para o dia em que a fonte preencher,
    // e é mais barato carregá-lo agora do que regerar o lote depois.
    operating_status: String(row?.operating_status || "").trim() || null,
    confidence: Number.isFinite(Number(row?.confidence)) ? Number(row.confidence) : null,
  };

  return {
    fields,
    source_url: "https://explore.overturemaps.org/#/" + id,
    osm_ref: "overture/" + id,
  };
}

module.exports = {
  source: "overture",
  label: "Overture Maps",
  // Descoberta OFFLINE: o arquivo vira partição e o caminho quente é o R2.
  capabilities: { discover: false, enrich: false },
  toDraft,
  routeUrls,
  splitAddress,
  socialNetworkOf,
};
