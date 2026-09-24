#!/usr/bin/env node
"use strict";

/**
 * Gera `scripts/prospect/lib/cities.js` — as cidades que a base de leads nasce
 * pronta para atender.
 *
 * Uso: node scripts/prospect/build-cities.js
 *
 * ⚠️ ESTE SCRIPT RODA À MÃO, e o resultado é COMMITADO. A lista é congelada de
 * propósito: população muda uma vez por censo, e uma consulta viva ao IBGE no
 * caminho da geração seria um modo de falha novo (o lote pararia junto com a
 * API deles) para responder uma pergunta cuja resposta quase nunca muda.
 *
 * ⚠️ O NOME DO MUNICÍPIO SAI DA MESMA FONTE QUE `lib/geo.js` USA
 * (/localidades/estados/{uf}/municipios → `nome`), e é isso que faz a lista
 * casar com o que fica gravado em `tb_company.city`. Outra fonte, por mais
 * completa que fosse, reabriria a divergência de grafia que o seletor de cidade
 * existe para fechar — e o sintoma seria busca vazia numa cidade cheia.
 *
 * A população vem do Censo 2022 (agregado 4709, variável 93), casada por código
 * IBGE de 7 dígitos — nunca por nome, que se repete entre estados.
 */

const fs = require("fs");
const path = require("path");

const IBGE = "https://servicodados.ibge.gov.br";

// A régua. Mexer aqui e rodar de novo é tudo o que é preciso para reabrir ou
// apertar o escopo.
const TOP_N = 15;
const POP_FLOOR = 50000;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} em ${url}`);
  return res.json();
}

function ufOf(m) {
  return (
    m?.microrregiao?.mesorregiao?.UF?.sigla ||
    m?.["regiao-imediata"]?.["regiao-intermediaria"]?.UF?.sigla ||
    null
  );
}

async function main() {
  const [municipios, censo] = await Promise.all([
    getJson(`${IBGE}/api/v1/localidades/municipios`),
    getJson(`${IBGE}/api/v3/agregados/4709/periodos/2022/variaveis/93?localidades=N6[all]`),
  ]);

  const popByCode = new Map();
  for (const s of censo[0].resultados[0].series) {
    const v = s.serie["2022"];
    if (v != null && v !== "-") popByCode.set(String(s.localidade.id), Number(v));
  }

  const byUf = new Map();
  for (const m of municipios) {
    const uf = ufOf(m);
    const pop = popByCode.get(String(m.id));
    if (!uf || pop == null) continue;
    if (!byUf.has(uf)) byUf.set(uf, []);
    byUf.get(uf).push({ nome: m.nome, pop });
  }

  const selecionadas = {};
  let total = 0;
  for (const uf of [...byUf.keys()].sort()) {
    const lista = byUf
      .get(uf)
      .sort((a, b) => b.pop - a.pop)
      .filter((c) => c.pop >= POP_FLOOR)
      .slice(0, TOP_N);
    selecionadas[uf] = lista.map((c) => c.nome);
    total += lista.length;
    const menor = lista.length ? lista[lista.length - 1].pop.toLocaleString("pt-BR") : "-";
    console.log(`${uf}  ${String(lista.length).padStart(2)} de ${String(byUf.get(uf).length).padStart(3)}  (menor: ${menor})`);
  }
  console.log(`\nTOTAL: ${total} cidades de ${municipios.length} municípios`);

  const corpo = Object.keys(selecionadas)
    .sort()
    .map((uf) => `  ${uf}: [${selecionadas[uf].map((n) => JSON.stringify(n)).join(", ")}],`)
    .join("\n");

  const arquivo = [
    '"use strict";',
    "",
    "/**",
    " * As cidades que a base de leads NASCE PRONTA para atender.",
    " *",
    " * ⚠️ GERADO por `scripts/prospect/build-cities.js` — não editar à mão.",
    " *",
    " * ⚠️ ESTA LISTA NÃO É A FRONTEIRA DO PRODUTO, É O PRÉ-AQUECIMENTO. Cidade fora",
    " * dela continua sendo atendida: o município já está resolvido linha a linha no",
    " * arquivo do estado no R2 (o point-in-polygon roda na geração), então ela entra",
    " * SOB DEMANDA na primeira busca, pelo mesmo reabastecimento que já existe.",
    " * Cortar aqui não tira cobertura — tira só o disco gasto por antecipação com",
    " * cidade que ninguém pediu.",
    " *",
    " * ⚠️ OS NOMES VÊM DA MESMA FONTE QUE `lib/geo.js` USA para nomear o município",
    " * (/localidades/estados/{uf}/municipios), e é isso que faz a lista casar com o",
    " * que fica gravado em `tb_company.city`.",
    " *",
    ` * A régua: as ${TOP_N} mais populosas de cada UF, com PISO de ${POP_FLOOR.toLocaleString("pt-BR")}`,
    " * habitantes (Censo 2022).",
    " *",
    " * ⚠️ O PISO NÃO É ENFEITE — sem ele a regra quebra nas pontas. Roraima tem 15",
    " * municípios no TOTAL: \"as 15 maiores\" pegaria o estado inteiro, incluindo",
    " * cidade de 8 mil habitantes onde o Overture tem uma dúzia de pontos. Com o",
    " * piso, RR fica com 1 (Boa Vista), AC e AP com 2 — que é o honesto.",
    " *",
    ` * Hoje: ${total} cidades de ${municipios.length} municípios.`,
    " */",
    "",
    `const TOP_N = ${TOP_N};`,
    `const POP_FLOOR = ${POP_FLOOR};`,
    "",
    "const CITIES = Object.freeze({",
    corpo,
    "});",
    "",
    "/** As cidades pré-aquecidas de uma UF (vazio quando a UF não é conhecida). */",
    "function citiesFor(uf) {",
    '  return CITIES[String(uf || "").toUpperCase()] || [];',
    "}",
    "",
    "/**",
    " * Esta cidade está no pré-aquecimento?",
    " *",
    " * ⚠️ Compara NORMALIZADO, nunca o texto cru — a mesma régua do `filterCity` do",
    ' * r2Partition. Comparando cru, "Sao Paulo" sem acento não casaria com',
    ' * "São Paulo" e a cidade mais populosa do país ficaria de fora, sem erro',
    " * nenhum aparecer.",
    " */",
    "function isPrewarmCity(uf, city) {",
    '  const { normalizeCity } = require("../../../src/utils/companyNormalize");',
    '  const want = normalizeCity(String(city || ""));',
    "  if (!want) return false;",
    "  return citiesFor(uf).some((n) => normalizeCity(n) === want);",
    "}",
    "",
    "module.exports = { CITIES, citiesFor, isPrewarmCity, TOP_N, POP_FLOOR };",
    "",
  ].join("\n");

  const destino = path.join(__dirname, "lib", "cities.js");
  fs.writeFileSync(destino, arquivo);
  console.log(`escrito: ${destino}`);
}

main().catch((e) => {
  console.error("falhou:", e.message);
  process.exit(1);
});
