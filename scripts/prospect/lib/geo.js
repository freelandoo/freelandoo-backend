// scripts/prospect/lib/geo.js
// Resolve (latitude, longitude) → município, offline, com a malha do IBGE.
//
// ⚠️ ESTA PEÇA É O QUE TORNA A PARTIÇÃO POR ESTADO POSSÍVEL, e sem ela o
// modelo inteiro não fecha. A varredura ao vivo (CompanyWorker.runDiscover)
// consulta o Overpass POR CIDADE, então ela pode preencher `city` com a cidade
// do pedido — é a muleta do `UPDATE ... COALESCE(city, $2)` que está lá hoje.
// A geração em lote varre o ESTADO de uma vez e não tem essa muleta: cada
// ponto precisa saber sozinho onde está.
//
// E precisa mesmo: medido no estado de São Paulo, categoria academia, apenas
// **34% dos pontos têm `addr:city`** — mas **100% têm coordenada**. Confiar na
// tag deixaria dois terços dos leads fora de qualquer filtro por cidade, que é
// justamente o filtro que a tela usa.
//
// ⚠️ POR QUE IBGE E NÃO REVERSE GEOCODING. Perguntar o município de cada ponto
// ao Nominatim seriam milhares de chamadas a um serviço público por estado —
// exatamente o abuso que o resto do subsistema evita. A malha municipal do
// IBGE é a fonte oficial, cabe em ~1 MB por estado (qualidade intermediária) e
// responde offline, para sempre.
//
// ⚠️ SEM POSTGIS, PELO MESMO MOTIVO DE SEMPRE (mig 254). Ray casting em JS puro
// resolve: são polígonos simples e o pré-filtro por bounding box descarta a
// quase totalidade dos candidatos antes de qualquer conta cara.

const IBGE = "https://servicodados.ibge.gov.br";

/**
 * Ray casting clássico. `ring` é um anel do GeoJSON: [[lon, lat], ...].
 *
 * ⚠️ A ORDEM É [lon, lat] — GeoJSON é x,y (longitude primeiro), e o OSM
 * devolve lat/lon. Trocar os dois não dá erro nenhum: simplesmente nenhum
 * ponto casa com nenhum município, e o arquivo sai inteiro sem cidade.
 */
function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects =
      yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Um polígono do GeoJSON é uma lista de anéis: o primeiro é o contorno, os
 * demais são BURACOS (enclaves de outro município). Ignorar os buracos daria
 * o município errado para quem está dentro de um enclave.
 */
function pointInPolygon(lon, lat, rings) {
  if (!rings?.length || !pointInRing(lon, lat, rings[0])) return false;
  for (let i = 1; i < rings.length; i += 1) {
    if (pointInRing(lon, lat, rings[i])) return false;
  }
  return true;
}

function bboxOf(coords, box) {
  for (const ring of coords) {
    for (const [lon, lat] of ring) {
      if (lon < box[0]) box[0] = lon;
      if (lat < box[1]) box[1] = lat;
      if (lon > box[2]) box[2] = lon;
      if (lat > box[3]) box[3] = lat;
    }
  }
  return box;
}

async function getJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Freelandoo/1.0 (+https://www.freelandoo.com.br)" },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`IBGE ${res.status} em ${url}`);
  return res.json();
}

/**
 * Monta o resolvedor de um estado: malha + nomes, prontos para consulta.
 *
 * `qualidade=intermediaria` é escolha deliberada: a malha "maxima" é dezenas de
 * MB por estado e a precisão extra decide apenas pontos a poucos metros da
 * divisa — irrelevante para dizer em que cidade fica um comércio, e caro em
 * tempo de carga a cada execução.
 */
async function loadUf(ufCode) {
  const [mesh, cities] = await Promise.all([
    getJson(
      `${IBGE}/api/v3/malhas/estados/${ufCode}` +
        `?formato=application/vnd.geo+json&intrarregiao=municipio&qualidade=intermediaria`
    ),
    getJson(`${IBGE}/api/v1/localidades/estados/${ufCode}/municipios`),
  ]);

  const nameByCode = new Map();
  for (const c of cities) nameByCode.set(String(c.id), c.nome);

  const entries = [];
  for (const feat of mesh.features || []) {
    const code = String(feat.properties?.codarea || "");
    const name = nameByCode.get(code);
    if (!name) continue;
    const geom = feat.geometry;
    // Polygon → uma lista de anéis. MultiPolygon → várias (ilhas, exclaves).
    const polygons =
      geom?.type === "Polygon"
        ? [geom.coordinates]
        : geom?.type === "MultiPolygon"
          ? geom.coordinates
          : [];
    if (!polygons.length) continue;
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const rings of polygons) bboxOf(rings, box);
    entries.push({ code, name, polygons, box });
  }

  return {
    size: entries.length,
    /**
     * A caixa que contem o estado inteiro.
     *
     * O gerador do Overture precisa dela para recortar o parquet ANTES de ler
     * (a coluna `bbox` e o unico filtro que o formato consegue empurrar para
     * baixo). Derivada da malha em vez de digitada: uma tabela de 27 caixas a
     * mao envelheceria em silencio e o sintoma seria estado faltando pedaco.
     */
    bbox: entries.reduce(
      (acc, e) => [
        Math.min(acc[0], e.box[0]), Math.min(acc[1], e.box[1]),
        Math.max(acc[2], e.box[2]), Math.max(acc[3], e.box[3]),
      ],
      [Infinity, Infinity, -Infinity, -Infinity]
    ),
    /**
     * ⚠️ O PRÉ-FILTRO POR BOUNDING BOX É O QUE TORNA ISTO VIÁVEL. Sem ele,
     * cada ponto testaria os 645 municípios de SP contra polígonos de milhares
     * de vértices — centenas de milhões de operações por categoria. Com ele,
     * a quase totalidade é descartada por quatro comparações numéricas.
     */
    resolve(lat, lon) {
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      for (const e of entries) {
        if (lon < e.box[0] || lon > e.box[2] || lat < e.box[1] || lat > e.box[3]) continue;
        for (const rings of e.polygons) {
          if (pointInPolygon(lon, lat, rings)) return { code: e.code, name: e.name };
        }
      }
      return null;
    },
  };
}

module.exports = { loadUf, pointInPolygon, pointInRing };
