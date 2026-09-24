"use strict";

/**
 * As cidades que a base de leads NASCE PRONTA para atender.
 *
 * ⚠️ GERADO por `scripts/prospect/build-cities.js` — não editar à mão.
 *
 * ⚠️ ESTA LISTA NÃO É A FRONTEIRA DO PRODUTO, É O PRÉ-AQUECIMENTO. Cidade fora
 * dela continua sendo atendida: o município já está resolvido linha a linha no
 * arquivo do estado no R2 (o point-in-polygon roda na geração), então ela entra
 * SOB DEMANDA na primeira busca, pelo mesmo reabastecimento que já existe.
 * Cortar aqui não tira cobertura — tira só o disco gasto por antecipação com
 * cidade que ninguém pediu.
 *
 * ⚠️ OS NOMES VÊM DA MESMA FONTE QUE `lib/geo.js` USA para nomear o município
 * (/localidades/estados/{uf}/municipios), e é isso que faz a lista casar com o
 * que fica gravado em `tb_company.city`.
 *
 * A régua: as 15 mais populosas de cada UF, com PISO de 50.000
 * habitantes (Censo 2022).
 *
 * ⚠️ O PISO NÃO É ENFEITE — sem ele a regra quebra nas pontas. Roraima tem 15
 * municípios no TOTAL: "as 15 maiores" pegaria o estado inteiro, incluindo
 * cidade de 8 mil habitantes onde o Overture tem uma dúzia de pontos. Com o
 * piso, RR fica com 1 (Boa Vista), AC e AP com 2 — que é o honesto.
 *
 * Hoje: 281 cidades de 5571 municípios.
 */

const TOP_N = 15;
const POP_FLOOR = 50000;

const CITIES = Object.freeze({
  AC: ["Rio Branco", "Cruzeiro do Sul"],
  AL: ["Maceió", "Arapiraca", "Rio Largo", "Palmeira dos Índios", "Marechal Deodoro", "União dos Palmares", "Penedo", "São Miguel dos Campos", "Delmiro Gouveia", "Coruripe"],
  AM: ["Manaus", "Itacoatiara", "Manacapuru", "Parintins", "Tefé", "Coari", "Tabatinga", "Maués", "Iranduba", "Humaitá", "Manicoré", "São Gabriel da Cachoeira"],
  AP: ["Macapá", "Santana"],
  BA: ["Salvador", "Feira de Santana", "Vitória da Conquista", "Camaçari", "Juazeiro", "Lauro de Freitas", "Itabuna", "Ilhéus", "Porto Seguro", "Barreiras", "Jequié", "Alagoinhas", "Teixeira de Freitas", "Simões Filho", "Eunápolis"],
  CE: ["Fortaleza", "Caucaia", "Juazeiro do Norte", "Maracanaú", "Sobral", "Itapipoca", "Crato", "Maranguape", "Iguatu", "Quixadá", "Quixeramobim", "Pacatuba", "Tianguá", "Aquiraz", "Crateús"],
  DF: ["Brasília"],
  ES: ["Serra", "Vila Velha", "Cariacica", "Vitória", "Cachoeiro de Itapemirim", "Linhares", "Guarapari", "São Mateus", "Colatina", "Aracruz", "Viana"],
  GO: ["Goiânia", "Aparecida de Goiânia", "Anápolis", "Rio Verde", "Águas Lindas de Goiás", "Luziânia", "Valparaíso de Goiás", "Senador Canedo", "Trindade", "Formosa", "Catalão", "Itumbiara", "Jataí", "Planaltina", "Novo Gama"],
  MA: ["São Luís", "Imperatriz", "São José de Ribamar", "Timon", "Caxias", "Paço do Lumiar", "Codó", "Açailândia", "Bacabal", "Balsas", "Santa Inês", "Pinheiro", "Barra do Corda", "Chapadinha", "Grajaú"],
  MG: ["Belo Horizonte", "Uberlândia", "Contagem", "Juiz de Fora", "Montes Claros", "Betim", "Uberaba", "Ribeirão das Neves", "Governador Valadares", "Divinópolis", "Ipatinga", "Sete Lagoas", "Santa Luzia", "Ibirité", "Poços de Caldas"],
  MS: ["Campo Grande", "Dourados", "Três Lagoas", "Corumbá", "Ponta Porã", "Naviraí"],
  MT: ["Cuiabá", "Várzea Grande", "Rondonópolis", "Sinop", "Sorriso", "Tangará da Serra", "Cáceres", "Primavera do Leste", "Lucas do Rio Verde", "Barra do Garças", "Alta Floresta", "Nova Mutum", "Pontes e Lacerda"],
  PA: ["Belém", "Ananindeua", "Santarém", "Parauapebas", "Marabá", "Castanhal", "Abaetetuba", "Cametá", "Barcarena", "Altamira", "Itaituba", "Bragança", "Marituba", "Breves", "Paragominas"],
  PB: ["João Pessoa", "Campina Grande", "Santa Rita", "Patos", "Bayeux", "Sousa", "Cabedelo", "Cajazeiras", "Guarabira", "Sapé"],
  PE: ["Recife", "Jaboatão dos Guararapes", "Petrolina", "Caruaru", "Olinda", "Paulista", "Cabo de Santo Agostinho", "Camaragibe", "Garanhuns", "Vitória de Santo Antão", "Igarassu", "São Lourenço da Mata", "Ipojuca", "Abreu e Lima", "Santa Cruz do Capibaribe"],
  PI: ["Teresina", "Parnaíba", "Picos", "Piripiri", "Floriano"],
  PR: ["Curitiba", "Londrina", "Maringá", "Ponta Grossa", "Cascavel", "São José dos Pinhais", "Foz do Iguaçu", "Colombo", "Guarapuava", "Araucária", "Toledo", "Fazenda Rio Grande", "Paranaguá", "Campo Largo", "Apucarana"],
  RJ: ["Rio de Janeiro", "São Gonçalo", "Duque de Caxias", "Nova Iguaçu", "Campos dos Goytacazes", "Belford Roxo", "Niterói", "São João de Meriti", "Petrópolis", "Volta Redonda", "Macaé", "Magé", "Itaboraí", "Cabo Frio", "Maricá"],
  RN: ["Natal", "Mossoró", "Parnamirim", "São Gonçalo do Amarante", "Macaíba", "Ceará-Mirim", "Extremoz", "Caicó", "Assú"],
  RO: ["Porto Velho", "Ji-Paraná", "Ariquemes", "Vilhena", "Cacoal", "Rolim de Moura", "Jaru"],
  RR: ["Boa Vista"],
  RS: ["Porto Alegre", "Caxias do Sul", "Canoas", "Pelotas", "Santa Maria", "Gravataí", "Novo Hamburgo", "Viamão", "São Leopoldo", "Passo Fundo", "Rio Grande", "Alvorada", "Cachoeirinha", "Santa Cruz do Sul", "Sapucaia do Sul"],
  SC: ["Joinville", "Florianópolis", "Blumenau", "São José", "Itajaí", "Chapecó", "Palhoça", "Criciúma", "Jaraguá do Sul", "Lages", "Brusque", "Balneário Camboriú", "Tubarão", "Camboriú", "Navegantes"],
  SE: ["Aracaju", "Nossa Senhora do Socorro", "Itabaiana", "Lagarto", "São Cristóvão", "Estância", "Tobias Barreto"],
  SP: ["São Paulo", "Guarulhos", "Campinas", "São Bernardo do Campo", "Santo André", "Osasco", "Sorocaba", "Ribeirão Preto", "São José dos Campos", "São José do Rio Preto", "Mogi das Cruzes", "Jundiaí", "Piracicaba", "Santos", "Mauá"],
  TO: ["Palmas", "Araguaína", "Gurupi", "Porto Nacional", "Paraíso do Tocantins"],
});

/** As cidades pré-aquecidas de uma UF (vazio quando a UF não é conhecida). */
function citiesFor(uf) {
  return CITIES[String(uf || "").toUpperCase()] || [];
}

/**
 * Esta cidade está no pré-aquecimento?
 *
 * ⚠️ Compara NORMALIZADO, nunca o texto cru — a mesma régua do `filterCity` do
 * r2Partition. Comparando cru, "Sao Paulo" sem acento não casaria com
 * "São Paulo" e a cidade mais populosa do país ficaria de fora, sem erro
 * nenhum aparecer.
 */
function isPrewarmCity(uf, city) {
  const { normalizeCity } = require("../../../src/utils/companyNormalize");
  const want = normalizeCity(String(city || ""));
  if (!want) return false;
  return citiesFor(uf).some((n) => normalizeCity(n) === want);
}

module.exports = { CITIES, citiesFor, isPrewarmCity, TOP_N, POP_FLOOR };
