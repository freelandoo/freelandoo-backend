// src/utils/companyNormalize.js
// A régua ÚNICA de normalização e de matching de empresa.
//
// ⚠️ O PROBLEMA CENTRAL DESTE SUBSISTEMA NÃO É BUSCAR, É SABER QUANDO DUAS
// COISAS SÃO A MESMA EMPRESA.
//
// A mesma academia chega três vezes e nunca igual:
//   OSM      → "Academia Corpo & Ação"        (11) 4330-1234   corpoeacao.com.br
//   Receita  → "CORPO E ACAO ACADEMIA LTDA"   1143301234       —
//   site     → "Corpo&Ação"                   +55 11 94330-1234 www.corpoeacao.com.br
//
// Sem normalização são três empresas. Com ela, são uma — e é por isso que TODA
// escrita passa por aqui antes de tocar `tb_company`. Normalizar à mão no SQL
// ou num service qualquer é como a quarta variante nasce.
//
// Módulo PURO: sem I/O, sem require de storage. É o que o torna testável sem
// Postgres (test/unit/companyNormalize.test.js).

/** Remove acento e caixa. Mesma mecânica do `slugify` da casa (utils/slug.js). */
function stripAccents(input) {
  return String(input || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Sufixos societários e ruído de razão social. Saem do nome porque são a
 * MESMA empresa com e sem eles — "Padaria Doze LTDA" e "Padaria Doze" — e
 * mantê-los faria o matching por nome falhar exatamente entre a fonte oficial
 * (que sempre os traz) e as outras duas (que nunca os trazem).
 */
const LEGAL_SUFFIXES = [
  "ltda", "me", "epp", "eireli", "sa", "s a", "s\\/a", "mei",
  "cia", "e cia", "em recuperacao judicial", "microempresa",
  "sociedade simples", "ss", "eirl",
];

const SUFFIX_RE = new RegExp(`\\s+(${LEGAL_SUFFIXES.join("|")})\\b`, "gi");

/**
 * A chave de matching por nome.
 *
 * "&" vira "e" ANTES de a pontuação cair: descartá-lo junto com o resto faria
 * "Corpo & Ação" virar "corpoacao" e "Corpo e Ação" virar "corpo e acao" —
 * duas chaves diferentes para o mesmo nome, que é o defeito que esta função
 * inteira existe para evitar.
 */
function normalizeName(raw) {
  let s = stripAccents(raw).toLowerCase();
  s = s.replace(/&/g, " e ");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = s.replace(SUFFIX_RE, "");
  return s.replace(/\s+/g, " ").trim();
}

/** Cidade normalizada — MESMA régua que `tb_region_city.municipio_norm` (mig 121). */
function normalizeCity(raw) {
  return stripAccents(raw).toLowerCase().replace(/\s+/g, " ").trim();
}

/** Só dígitos, 14 posições. Devolve `null` para qualquer outra coisa. */
function normalizeCnpj(raw) {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length === 14 ? digits : null;
}

/**
 * Dígitos verificadores do CNPJ. Offline e de graça — a mesma disciplina do
 * CPF em `utils/documents.js`.
 *
 * ⚠️ VALIDAR ANTES DE CONSULTAR não é preciosismo: CNPJ torto não existe em
 * cadastro nenhum, e perguntar por ele gasta uma chamada da API pública (que é
 * cota compartilhada) para receber 404.
 */
function isValidCnpj(raw) {
  const c = normalizeCnpj(raw);
  if (!c) return false;
  if (/^(\d)\1{13}$/.test(c)) return false;
  const calc = (len) => {
    let sum = 0;
    let pos = len - 7;
    for (let i = 0; i < len; i++) {
      sum += Number(c[i]) * pos--;
      if (pos < 2) pos = 9;
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/**
 * Telefone brasileiro em dígitos, SEM o 55.
 *
 * ⚠️ O "55" É AMBÍGUO E ENGOLI-LO CEGAMENTE QUEBRA O MATCHING. `5511943301234`
 * (13) é o país + SP + celular; mas `5534991234` (10) é o DDD 55 (Santa Maria/RS)
 * com um fixo. Por isso o corte do país só acontece nos comprimentos em que ele
 * é a única leitura possível (12 e 13 dígitos).
 */
function normalizePhone(raw) {
  let d = String(raw || "").replace(/\D/g, "");
  if (!d) return null;
  if ((d.length === 13 || d.length === 12) && d.startsWith("55")) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return null;
  return d;
}

/**
 * É celular (e portanto candidato a WhatsApp)?
 *
 * Celular brasileiro é 11 dígitos com o nono dígito entre 6 e 9. É esta conta
 * que impede a plataforma de anunciar o fixo da recepção como "WhatsApp".
 */
function isMobilePhone(raw) {
  const d = normalizePhone(raw);
  return !!d && d.length === 11 && /[6-9]/.test(d[2]);
}

/**
 * Host canônico de uma URL. É a chave de matching por domínio e a chave de
 * supressão (LGPD).
 *
 * ⚠️ `www.` CAI, o resto do subdomínio NÃO. `loja.padariadoze.com.br` pode ser
 * outro estabelecimento do mesmo grupo; `www.` nunca é.
 */
function normalizeDomain(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) s = `http://${s}`;
  let host;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  // Um host sem ponto é "localhost" ou lixo de parse — nunca um domínio real.
  if (!host.includes(".")) return null;
  return host;
}

/** URL absoluta e higienizada, ou `null`. Guarda o que vai para um `href`. */
function normalizeWebsite(raw) {
  if (!raw) return null;
  let s = String(raw).trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (!["http:", "https:"].includes(u.protocol)) return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/**
 * @handle de rede social a partir de uma URL ou de um @ solto.
 *
 * Guardamos o HANDLE e não a URL: a URL do Instagram já mudou de forma duas
 * vezes, e o handle é o que se digita para achar o perfil em qualquer uma delas.
 */
function normalizeSocialHandle(raw, network) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (s.startsWith("@")) return s.slice(1).toLowerCase() || null;
  const host = normalizeDomain(s);
  if (!host) return /^[a-z0-9._-]+$/i.test(s) ? s.toLowerCase() : null;
  // Perfil de OUTRA rede não vira handle desta — sem esta checagem, o link do
  // Facebook no rodapé viraria o "Instagram" da empresa.
  const expected = {
    instagram: "instagram.com",
    facebook: "facebook.com",
    linkedin: "linkedin.com",
    tiktok: "tiktok.com",
    youtube: "youtube.com",
  }[network];
  if (expected && !host.endsWith(expected)) return null;
  try {
    const path = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`).pathname;
    const parts = path.split("/").filter(Boolean);
    if (!parts.length) return null;
    // linkedin.com/company/<slug> e youtube.com/@<handle>
    const idx = ["company", "in", "school", "c", "channel", "user"].includes(parts[0]) ? 1 : 0;
    const handle = (parts[idx] || "").replace(/^@/, "").toLowerCase();
    return /^[a-z0-9._-]{2,60}$/.test(handle) ? handle : null;
  } catch {
    return null;
  }
}

/** E-mail em caixa baixa, ou `null`. Não valida entregabilidade — só forma. */
function normalizeEmail(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s || s.length > 160) return null;
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s) ? s : null;
}

/** CEP em 8 dígitos, ou `null`. */
function normalizeZip(raw) {
  const d = String(raw || "").replace(/\D/g, "");
  return d.length === 8 ? d : null;
}

// ─── MATCHING ────────────────────────────────────────────────────────────────

/** Similaridade de dois conjuntos de tokens (Jaccard). 0..1. */
function tokenSimilarity(a, b) {
  const A = new Set(String(a || "").split(" ").filter(Boolean));
  const B = new Set(String(b || "").split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/**
 * Distância em metros entre duas coordenadas (haversine).
 *
 * Usada no matching (mesmo endereço?) e na busca por raio. Vive aqui, e não no
 * SQL, para que as duas respondam a mesma conta — uma fórmula no banco e outra
 * no JS dariam um resultado na lista e outro no detalhe da mesma empresa.
 */
function haversineMeters(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v === null || v === undefined || Number.isNaN(Number(v)))) {
    return null;
  }
  const R = 6371000;
  const toRad = (d) => (Number(d) * Math.PI) / 180;
  const dLat = toRad(Number(lat2) - Number(lat1));
  const dLon = toRad(Number(lon2) - Number(lon1));
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * O limiar acima do qual duas empresas são FUNDIDAS sem perguntar a ninguém.
 *
 * ⚠️ ELE É ALTO DE PROPÓSITO. Fundir errado é irreversível na prática (os
 * campos se misturam e ninguém sabe mais o que veio de onde) e produz o pior
 * estrago possível aqui: o telefone de uma empresa no card de outra, que o
 * vendedor vai usar. Não fundir apenas deixa duas linhas parecidas na tela —
 * caro, mas honesto. Na dúvida, NÃO FUNDE.
 */
const MATCH_THRESHOLD = 0.82;

/**
 * Quanto estes dois candidatos parecem ser a mesma empresa. 0..1.
 *
 * A escada é a do pedido, e a ordem importa: as duas primeiras chaves são
 * IDENTIDADE (valem sozinhas), as outras são indício e precisam se somar.
 *
 *   CNPJ igual        → 1     (é a definição de "mesma empresa")
 *   domínio igual     → 0.92  (quase: matriz e filial podem dividir o site)
 *   telefone igual    → 0.80  (quase: call center compartilhado existe)
 *   nome + endereço   → soma
 *
 * ⚠️ CNPJ DIFERENTE DERRUBA TUDO PARA ZERO. Duas lojas da mesma rede na mesma
 * rua têm nome idêntico, telefone parecido e coordenadas a 40 metros — e são
 * pessoas jurídicas distintas, com donos distintos. Quando os dois lados
 * declaram CNPJ e eles não batem, não há indício que valha discussão.
 */
function matchScore(a, b) {
  const cnpjA = normalizeCnpj(a?.cnpj);
  const cnpjB = normalizeCnpj(b?.cnpj);
  if (cnpjA && cnpjB) return cnpjA === cnpjB ? 1 : 0;

  const domA = a?.domain || normalizeDomain(a?.website);
  const domB = b?.domain || normalizeDomain(b?.website);
  if (domA && domB && domA === domB) return 0.92;

  const phoneA = normalizePhone(a?.phone);
  const phoneB = normalizePhone(b?.phone);
  const samePhone = !!phoneA && phoneA === phoneB;

  const nameSim = tokenSimilarity(
    a?.name_norm || normalizeName(a?.display_name || a?.trade_name || a?.legal_name),
    b?.name_norm || normalizeName(b?.display_name || b?.trade_name || b?.legal_name)
  );

  // Nome fraco não vira empresa por acumulação de indício: "Auto Center" bate
  // com "Auto Center" em toda cidade do país.
  if (nameSim < 0.5 && !samePhone) return 0;

  let score = nameSim * 0.6;
  if (samePhone) score += 0.3;

  const zipA = normalizeZip(a?.zip_code);
  const zipB = normalizeZip(b?.zip_code);
  if (zipA && zipA === zipB) {
    score += 0.2;
    const numA = String(a?.address_number || "").replace(/\D/g, "");
    const numB = String(b?.address_number || "").replace(/\D/g, "");
    if (numA && numA === numB) score += 0.1;
  } else {
    const cityA = a?.city_norm || normalizeCity(a?.city);
    const cityB = b?.city_norm || normalizeCity(b?.city);
    const sameUf = a?.uf && b?.uf && String(a.uf).toUpperCase() === String(b.uf).toUpperCase();
    if (cityA && cityA === cityB && sameUf) score += 0.1;
    // Cidades diferentes com nomes parecidos são franquias, não a mesma loja.
    else if (cityA && cityB && cityA !== cityB) score -= 0.25;
  }

  const dist = haversineMeters(a?.latitude, a?.longitude, b?.latitude, b?.longitude);
  if (dist !== null) {
    if (dist <= 60) score += 0.15;
    else if (dist <= 250) score += 0.05;
    // Mais de 2 km é outro estabelecimento, por mais que o nome bata.
    else if (dist > 2000) score -= 0.3;
  }

  return Math.max(0, Math.min(1, score));
}

module.exports = {
  MATCH_THRESHOLD,
  stripAccents,
  normalizeName,
  normalizeCity,
  normalizeCnpj,
  isValidCnpj,
  normalizePhone,
  isMobilePhone,
  normalizeDomain,
  normalizeWebsite,
  normalizeSocialHandle,
  normalizeEmail,
  normalizeZip,
  tokenSimilarity,
  haversineMeters,
  matchScore,
};
