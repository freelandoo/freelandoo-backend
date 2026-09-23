// src/utils/companyConfidence.js
// A régua ÚNICA de confiança por fonte e a resolução de conflito entre elas.
//
// ⚠️ O DEFEITO QUE ESTE ARQUIVO EXISTE PARA IMPEDIR É SILENCIOSO E CARO.
//
// Sem ele, `tb_company` é uma pilha de "último a escrever ganha": o crawler
// acha um `contato@wixsite.com` no rodapé do template e sobrescreve o e-mail
// que veio da Receita Federal. O campo continua preenchido, com cara de certo,
// e o vendedor manda a proposta para o vazio. Ninguém descobre nunca — porque
// não há erro, há um dado pior no lugar de um melhor.
//
// A regra é uma linha: **fonte fraca NÃO sobrescreve fonte forte.** Empate é
// resolvido pela mais RECENTE (a empresa trocou de telefone), e só aí.
//
// Módulo PURO: sem I/O. Testável sem Postgres.

/**
 * A escada, e o porquê de cada degrau:
 *
 *   cnpj (95)      A Receita Federal. É o cadastro que a própria empresa é
 *                  obrigada a manter. Nada aqui vence isto — exceto o humano.
 *   manual (100)   Um admin corrigiu à mão. Vence tudo, inclusive a Receita:
 *                  é o único degrau em que alguém OLHOU.
 *   website (80)   O site oficial da empresa. Ela escreveu ali de propósito e
 *                  para o público — mas o rodapé também carrega o e-mail da
 *                  agência que fez o site.
 *   osm (65)       Mapeado por colaborador. Ótimo para existência, nome e
 *                  coordenada; envelhece mal em telefone e site.
 *   social (55)    Perfil de rede. O que se acha ali é o que a empresa divulga,
 *                  mas a origem do link já é de segunda mão.
 *   directory (45) Diretório de terceiro. Entra como último recurso.
 *
 * ⚠️ ESTE MAPA É A LISTA FECHADA e ele ESPELHA o CHECK
 * `chk_company_source_kind` da mig 254. Fonte nova entra nos DOIS — declarada
 * só aqui, o INSERT é recusado pelo banco; só no banco, ela grava com confiança
 * 0 e nunca vence ninguém.
 */
const SOURCE_CONFIDENCE = Object.freeze({
  manual: 100,
  cnpj: 95,
  website: 80,
  // ⚠️ ACIMA DO OSM E ABAIXO DO SITE, e os dois lados têm motivo. Acima do
  // OSM porque não é mapeamento voluntário: vem de operação comercial
  // (Meta, Microsoft, PinMeTo, Foursquare), e onde o OSM tem 821 barbearias
  // em SP ela tem 43.250, com telefone em 93% contra uma minoria. Abaixo do
  // site porque continua sendo um terceiro falando sobre a empresa — quando
  // a própria empresa escreve o contato no rodapé dela, é ela que manda.
  overture: 70,
  osm: 65,
  social: 55,
  directory: 45,
});

/** Confiança de uma fonte. Desconhecida vale 0 — nunca vence nada. */
function confidenceOf(source) {
  return SOURCE_CONFIDENCE[String(source || "").toLowerCase()] || 0;
}

/**
 * Alguns campos valem mais de UMA fonte que de outra, independente da escada.
 *
 * ⚠️ É A EXCEÇÃO QUE TORNA A ESCADA HONESTA. A Receita é a melhor fonte do
 * mundo para razão social e CNAE — e é péssima para COORDENADA (ela não tem) e
 * para SITE (o campo quase nunca é preenchido, e quando é, está velho). O OSM é
 * o contrário. Sem este ajuste, a coordenada do OSM seria descartada por um
 * `NULL` de alta confiança vindo da Receita.
 */
/*
 * ⚠️ O BOOST DE 35 DO OSM NÃO É "UM POUCO MAIS": ele é calibrado para PASSAR
 * a Receita (65 + 35 = 100 contra 95), e foi um teste que pegou isso — com o
 * valor anterior (25) a intenção escrita aqui não valia no código, e a Receita
 * vencia coordenada e categoria com um campo que ela nem tem.
 *
 * Empata com `manual` (100), e o empate vai para o valor NOVO — o que é o certo
 * aqui, porque a correção humana sempre chega depois.
 */
const FIELD_BOOST = Object.freeze({
  latitude: { osm: 35, overture: 30 },
  longitude: { osm: 35, overture: 30 },
  // ⚠️ A CATEGORIA TEM COMPETIÇÃO DE VERDADE, e o OSM ganha de propósito. A
  // Receita declara a ATIVIDADE FISCAL ("comércio varejista de suplementos");
  // o OSM declara o que está na PLACA ("academia"). Quem procurou "academias"
  // quer a academia — deixar o CNAE vencer tiraria da busca exatamente as
  // empresas que ela existe para achar.
  category_key: { osm: 35, overture: 30 },
  // O site e as redes são do site, não do cadastro fiscal.
  website: { website: 20, osm: 10, overture: 10 },
  instagram: { website: 20, social: 25 },
  facebook: { website: 20, social: 25 },
  linkedin: { website: 20, social: 25 },
  tiktok: { website: 20, social: 25 },
  youtube: { website: 20, social: 25 },
  whatsapp: { website: 15 },
  // Razão social, CNAE e capital são fatos de registro — só a Receita os tem.
  legal_name: { cnpj: 5 },
  main_cnae: { cnpj: 5 },
  share_capital_cents: { cnpj: 5 },
  opened_at: { cnpj: 5 },
  reg_status: { cnpj: 5 },
});

/** Confiança efetiva daquela fonte PARA AQUELE CAMPO. Teto em 100. */
function fieldConfidence(field, source) {
  const base = confidenceOf(source);
  const boost = FIELD_BOOST[field]?.[String(source || "").toLowerCase()] || 0;
  return Math.min(100, base + boost);
}

/**
 * O valor novo deve substituir o que está gravado?
 *
 * ⚠️ VALOR VAZIO NUNCA VENCE. Uma fonte forte que não conhece o campo não pode
 * APAGAR o que uma fonte fraca sabia — é a diferença entre "não sei" e "é
 * vazio", e confundi-las faz o enriquecimento pela Receita zerar o Instagram
 * que o crawler tinha achado.
 *
 * ⚠️ EMPATE VAI PARA O NOVO, e é de propósito: mesma fonte relendo o mesmo
 * campo é a empresa tendo TROCADO de telefone. Preferir o antigo congelaria o
 * cadastro no dia da primeira leitura.
 */
function shouldReplace({ field, currentValue, currentSource, nextValue, nextSource }) {
  const isEmpty = (v) => v === null || v === undefined || String(v).trim() === "";
  if (isEmpty(nextValue)) return false;
  if (isEmpty(currentValue)) return true;
  if (String(currentValue) === String(nextValue)) return false;
  return fieldConfidence(field, nextSource) >= fieldConfidence(field, currentSource);
}

/**
 * A nota 0..100 da LINHA — quanto se sabe sobre esta empresa.
 *
 * ⚠️ ELA NÃO É "QUALIDADE DO LEAD" e a tela precisa dizer isso: uma empresa
 * pequena e ótima pode ter nota baixa só porque ninguém mapeou o site dela.
 * O que ela mede é COMPLETUDE PONDERADA PELA FONTE — e é isso que responde
 * "posso confiar neste telefone?".
 *
 * Os pesos dizem o que serve para PROSPECTAR: um canal de contato vale mais
 * que o capital social, porque sem canal não há abordagem.
 */
const FIELD_WEIGHT = Object.freeze({
  display_name: 10,
  phone: 16,
  whatsapp: 14,
  email: 14,
  website: 12,
  instagram: 8,
  cnpj: 10,
  address: 6,
  city: 4,
  latitude: 3,
  main_cnae: 3,
});

function scoreCompany(company, sourcesByField = {}) {
  let got = 0;
  let total = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHT)) {
    total += weight;
    const value = company?.[field];
    if (value === null || value === undefined || String(value).trim() === "") continue;
    const source = sourcesByField[field] || "osm";
    // O campo entra proporcional à confiança da fonte que o preencheu: um
    // telefone da Receita vale mais que o mesmo telefone achado num rodapé.
    got += weight * (fieldConfidence(field, source) / 100);
  }
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((got / total) * 100)));
}

module.exports = {
  SOURCE_CONFIDENCE,
  FIELD_WEIGHT,
  confidenceOf,
  fieldConfidence,
  shouldReplace,
  scoreCompany,
};
