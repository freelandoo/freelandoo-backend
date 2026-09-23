// src/storages/CompanyStorage.js
// SQL puro da base de empresas (mig 254).
//
// ⚠️ DUAS REGRAS QUE VALEM PARA TODO MÉTODO NOVO AQUI:
//
// 1. SUPRIMIDA NÃO APARECE. Toda leitura de LISTA filtra `suppressed_at IS NULL`
//    — é o que faz o opt-out da LGPD valer de fato. Um método novo que esqueça
//    o filtro devolve para a tela exatamente a empresa que pediu para sair, e
//    o defeito é invisível até alguém reclamar pela segunda vez.
//
// 2. NENHUM PARÂMETRO É REUSADO ENTRE UMA COLUNA E UMA EXPRESSÃO. É o 42P08
//    ("could not determine data type") que já custou quatro migrations neste
//    projeto: o Postgres deduz o tipo do placeholder pelo primeiro uso, e o
//    segundo uso, dentro de um CASE ou de uma função, deduz outro. Cada valor
//    entra uma vez, com o `::tipo` explícito quando houver a menor dúvida.

const N = require("../utils/companyNormalize");

/**
 * As colunas que a tela e a exportação leem. Projeção EXPLÍCITA, nunca `*`.
 *
 * ⚠️ `name_norm` E `suppressed_at` ESTÃO AQUI POR NECESSIDADE, não por simetria
 * — e os dois entraram porque a suíte pegou o que a ausência deles causava:
 *
 *   · sem `name_norm`, o motor de matching recebia candidatos sem a chave que
 *     `tb_company` guarda justamente para ele, e caía no fallback que recalcula
 *     o nome a cada comparação. Funcionava, e tornava a coluna decorativa.
 *
 *   · sem `suppressed_at`, `company.suppressed_at` era `undefined` em TODA
 *     leitura — e os dois guards que dependem dele (a ficha da empresa e o
 *     worker de enriquecimento) passavam batido. O pior dos dois é o worker:
 *     a plataforma continuaria CRAWLEANDO o site de quem exerceu o opt-out.
 */
const COMPANY_COLUMNS = `
  c.id_company, c.cnpj, c.legal_name, c.trade_name, c.display_name, c.name_norm,
  c.description, c.suppressed_at,
  c.category_key, c.main_cnae, c.cnae_list, c.company_size, c.legal_nature,
  c.share_capital_cents, c.opened_at, c.reg_status, c.is_headquarters,
  c.website, c.domain, c.email, c.phone, c.whatsapp,
  c.instagram, c.facebook, c.linkedin, c.tiktok, c.youtube,
  c.address, c.address_number, c.complement, c.neighborhood,
  c.city, c.city_norm, c.uf, c.zip_code, c.country, c.id_region,
  c.latitude, c.longitude, c.osm_ref, c.confidence, c.enrichment_status,
  c.enriched_at, c.website_checked_at, c.cnpj_checked_at, c.osm_checked_at,
  c.created_at, c.updated_at
`;

/** Campos que uma fonte pode escrever. Lista FECHADA: é a fronteira de confiança. */
const WRITABLE = Object.freeze([
  "cnpj", "legal_name", "trade_name", "display_name", "description",
  "category_key", "main_cnae", "cnae_list", "company_size", "legal_nature",
  "share_capital_cents", "opened_at", "reg_status", "is_headquarters",
  "website", "domain", "email", "phone", "whatsapp",
  "instagram", "facebook", "linkedin", "tiktok", "youtube",
  "address", "address_number", "complement", "neighborhood",
  "city", "uf", "zip_code", "latitude", "longitude", "osm_ref",
]);

class CompanyStorage {
  // ─── LEITURA PONTUAL ───────────────────────────────────────────────────────

  static async getById(conn, id_company) {
    const { rows } = await conn.query(
      `SELECT ${COMPANY_COLUMNS} FROM public.tb_company c WHERE c.id_company = $1 LIMIT 1`,
      [id_company]
    );
    return rows[0] || null;
  }

  static async findByCnpj(conn, cnpj) {
    const c = N.normalizeCnpj(cnpj);
    if (!c) return null;
    const { rows } = await conn.query(
      `SELECT ${COMPANY_COLUMNS} FROM public.tb_company c WHERE c.cnpj = $1 LIMIT 1`,
      [c]
    );
    return rows[0] || null;
  }

  static async findByOsmRef(conn, osm_ref) {
    if (!osm_ref) return null;
    const { rows } = await conn.query(
      `SELECT ${COMPANY_COLUMNS} FROM public.tb_company c WHERE c.osm_ref = $1 LIMIT 1`,
      [String(osm_ref)]
    );
    return rows[0] || null;
  }

  /**
   * Os candidatos plausíveis para o motor de matching pontuar.
   *
   * ⚠️ ELE NÃO DECIDE NADA — quem decide é `matchScore` em
   * `utils/companyNormalize.js`. O papel desta consulta é só REDUZIR o universo
   * de "todas as empresas do banco" para "as que vale a pena comparar", e por
   * isso ela é generosa: domínio igual, telefone igual, ou mesma cidade com
   * nome parecido. Estreitar aqui faria o matching nunca ver o par certo;
   * alargar faria ele pontuar o banco inteiro a cada descoberta.
   */
  static async findCandidates(conn, draft, limit = 25) {
    const domain = draft.domain || N.normalizeDomain(draft.website);
    const phone = N.normalizePhone(draft.phone);
    const nameNorm = draft.name_norm || N.normalizeName(draft.display_name);
    const cityNorm = draft.city_norm || N.normalizeCity(draft.city);
    const uf = draft.uf ? String(draft.uf).toUpperCase() : null;
    // Primeiro token do nome: é o prefixo que o índice `ix_company_name_norm`
    // consegue usar. "academia corpo e acao" → "academia%".
    const prefix = nameNorm ? `${nameNorm.split(" ")[0]}%` : null;

    const { rows } = await conn.query(
      `SELECT ${COMPANY_COLUMNS}
         FROM public.tb_company c
        WHERE c.suppressed_at IS NULL
          AND (
                ($1::text IS NOT NULL AND c.domain = $1::text)
             OR ($2::text IS NOT NULL AND c.phone  = $2::text)
             OR ($3::text IS NOT NULL AND c.name_norm LIKE $3::text
                   AND ($4::text IS NULL OR c.city_norm = $4::text)
                   AND ($5::text IS NULL OR c.uf = $5::text))
              )
        LIMIT $6`,
      [domain, phone, prefix, cityNorm, uf, limit]
    );
    return rows;
  }

  // ─── ESCRITA ───────────────────────────────────────────────────────────────

  /**
   * Cria a empresa. `fields` já vem normalizado pelo provider.
   *
   * `display_name` e `name_norm` são derivados AQUI e não pelo chamador: as
   * duas colunas são NOT NULL e `name_norm` é a chave de matching — deixá-las
   * para quem chama é como uma linha nasceria com a normalização de outro
   * autor e nunca mais casaria com nada.
   */
  static async insert(conn, fields = {}) {
    const display = String(
      fields.display_name || fields.trade_name || fields.legal_name || ""
    ).trim().slice(0, 300);
    if (!display) return null;
    const nameNorm = N.normalizeName(display);
    const cityNorm = N.normalizeCity(fields.city);

    const { rows } = await conn.query(
      `INSERT INTO public.tb_company
         (cnpj, legal_name, trade_name, display_name, name_norm, description,
          category_key, main_cnae, cnae_list, company_size, legal_nature,
          share_capital_cents, opened_at, reg_status, is_headquarters,
          website, domain, email, phone, whatsapp,
          instagram, facebook, linkedin, tiktok, youtube,
          address, address_number, complement, neighborhood,
          city, city_norm, uf, zip_code, id_region, latitude, longitude, osm_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::date,$14,$15,
               $16,$17,$18,$19,$20,$21,$22,$23,$24,$25,
               $26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37)
       ON CONFLICT DO NOTHING
       RETURNING ${COMPANY_COLUMNS.replace(/c\./g, "")}`,
      [
        N.normalizeCnpj(fields.cnpj),
        fields.legal_name || null,
        fields.trade_name || null,
        display,
        nameNorm,
        fields.description || null,
        fields.category_key || null,
        fields.main_cnae || null,
        JSON.stringify(Array.isArray(fields.cnae_list) ? fields.cnae_list : []),
        fields.company_size || null,
        fields.legal_nature || null,
        fields.share_capital_cents ?? null,
        fields.opened_at || null,
        fields.reg_status || null,
        fields.is_headquarters ?? null,
        fields.website || null,
        fields.domain || null,
        fields.email || null,
        fields.phone || null,
        fields.whatsapp || null,
        fields.instagram || null,
        fields.facebook || null,
        fields.linkedin || null,
        fields.tiktok || null,
        fields.youtube || null,
        fields.address || null,
        fields.address_number || null,
        fields.complement || null,
        fields.neighborhood || null,
        fields.city || null,
        cityNorm || null,
        fields.uf ? String(fields.uf).toUpperCase().slice(0, 2) : null,
        N.normalizeZip(fields.zip_code),
        fields.id_region ?? null,
        fields.latitude ?? null,
        fields.longitude ?? null,
        fields.osm_ref || null,
      ]
    );
    return rows[0] || null;
  }

  /**
   * Aplica um patch de campos já DECIDIDO pela resolução de conflito.
   *
   * ⚠️ ESTE MÉTODO NÃO DECIDE NADA — quem decide se a fonte nova vence é
   * `companyConfidence.shouldReplace`, no service. Se ele passasse a decidir,
   * existiriam duas réguas de precedência e a que ficasse para trás deixaria
   * uma fonte fraca apagar uma forte em silêncio.
   *
   * ⚠️ CAMPO FORA DA LISTA `WRITABLE` É IGNORADO. É a fronteira que impede um
   * provider (cujo payload vem da internet) de escrever em `confidence`,
   * `suppressed_at` ou `id_company`.
   */
  static async updateFields(conn, id_company, patch = {}) {
    const sets = [];
    const values = [id_company];
    let i = 2;

    for (const [key, value] of Object.entries(patch)) {
      if (!WRITABLE.includes(key)) continue;
      if (key === "cnae_list") {
        sets.push(`cnae_list = $${i}::jsonb`);
        values.push(JSON.stringify(Array.isArray(value) ? value : []));
      } else if (key === "opened_at") {
        sets.push(`opened_at = $${i}::date`);
        values.push(value || null);
      } else {
        sets.push(`${key} = $${i}`);
        values.push(value ?? null);
      }
      i++;
      // O nome de tela e a chave de matching andam juntos: mexer num sem o
      // outro faria a empresa deixar de casar consigo mesma na próxima leitura.
      if (key === "display_name") {
        sets.push(`name_norm = $${i}`);
        values.push(N.normalizeName(value));
        i++;
      }
      if (key === "city") {
        sets.push(`city_norm = $${i}`);
        values.push(N.normalizeCity(value));
        i++;
      }
    }

    if (!sets.length) return this.getById(conn, id_company);

    const { rows } = await conn.query(
      `UPDATE public.tb_company
          SET ${sets.join(", ")}, updated_at = NOW()
        WHERE id_company = $1
        RETURNING ${COMPANY_COLUMNS.replace(/c\./g, "")}`,
      values
    );
    return rows[0] || null;
  }

  /** Carimba a nota e o estado do enriquecimento. */
  static async setEnrichment(conn, id_company, { confidence, status, touched = [] }) {
    const stamps = [];
    if (touched.includes("website")) stamps.push("website_checked_at = NOW()");
    if (touched.includes("cnpj")) stamps.push("cnpj_checked_at = NOW()");
    if (touched.includes("osm")) stamps.push("osm_checked_at = NOW()");
    const { rows } = await conn.query(
      `UPDATE public.tb_company
          SET confidence        = COALESCE($2, confidence),
              enrichment_status = COALESCE($3, enrichment_status),
              enriched_at       = NOW(),
              updated_at        = NOW()
              ${stamps.length ? `, ${stamps.join(", ")}` : ""}
        WHERE id_company = $1
        RETURNING id_company, confidence, enrichment_status, enriched_at`,
      [id_company, confidence ?? null, status || null]
    );
    return rows[0] || null;
  }

  /** Resolve a região pela MESMA régua do resto da plataforma (mig 121). */
  static async resolveRegion(conn, uf, city) {
    const cityNorm = N.normalizeCity(city);
    if (!uf || !cityNorm) return null;
    const { rows } = await conn.query(
      `SELECT id_region FROM public.tb_region_city
        WHERE uf = $1 AND municipio_norm = $2 LIMIT 1`,
      [String(uf).toUpperCase().slice(0, 2), cityNorm]
    );
    return rows[0]?.id_region ?? null;
  }

  // ─── PROVENIÊNCIA ──────────────────────────────────────────────────────────

  /**
   * Registra (ou atualiza) a opinião de uma fonte sobre um campo.
   *
   * `ON CONFLICT ... DO UPDATE` em vez de INSERT novo: uma fonte tem UMA
   * opinião por campo. Empilhar histórico de crawl transformaria esta tabela na
   * maior do banco em semanas, para responder uma pergunta que ninguém faz.
   */
  static async recordSource(conn, { id_company, field, value, source, source_url, confidence }) {
    await conn.query(
      `INSERT INTO public.tb_company_source
         (id_company, field, value, source, source_url, confidence)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (id_company, field, source) DO UPDATE
         SET value        = EXCLUDED.value,
             source_url   = EXCLUDED.source_url,
             confidence   = EXCLUDED.confidence,
             last_seen_at = NOW()`,
      [
        id_company,
        String(field).slice(0, 32),
        value === null || value === undefined ? null : String(value).slice(0, 2000),
        source,
        source_url ? String(source_url).slice(0, 500) : null,
        Number(confidence) || 0,
      ]
    );
  }

  /** Toda a proveniência da empresa — é o que a ficha mostra em "Fontes". */
  static async listSources(conn, id_company) {
    const { rows } = await conn.query(
      `SELECT field, value, source, source_url, confidence, first_seen_at, last_seen_at
         FROM public.tb_company_source
        WHERE id_company = $1
        ORDER BY field ASC, confidence DESC`,
      [id_company]
    );
    return rows;
  }

  /** `{ campo: fonte_vencedora }` — alimenta o cálculo da nota da linha. */
  static async winningSources(conn, id_company) {
    const { rows } = await conn.query(
      `SELECT DISTINCT ON (field) field, source
         FROM public.tb_company_source
        WHERE id_company = $1
        ORDER BY field ASC, confidence DESC, last_seen_at DESC`,
      [id_company]
    );
    return Object.fromEntries(rows.map((r) => [r.field, r.source]));
  }

  // ─── SUPRESSÃO (LGPD) ──────────────────────────────────────────────────────

  /**
   * Esta empresa pediu para sair?
   *
   * ⚠️ CONSULTADA ANTES DE CRIAR, e não só antes de mostrar. É o que impede a
   * descoberta de amanhã de recriar a linha que alguém pediu para remover —
   * sem isso, o opt-out duraria até a próxima varredura da cidade.
   */
  static async isSuppressed(conn, { cnpj, domain, email }) {
    const values = [
      N.normalizeCnpj(cnpj),
      domain || null,
      N.normalizeEmail(email),
    ];
    if (values.every((v) => !v)) return false;
    const { rows } = await conn.query(
      `SELECT 1 FROM public.tb_company_suppression
        WHERE (kind = 'cnpj'   AND value = $1::text)
           OR (kind = 'domain' AND value = $2::text)
           OR (kind = 'email'  AND value = $3::text)
        LIMIT 1`,
      values
    );
    return rows.length > 0;
  }

  static async suppress(conn, { kind, value, reason, created_by }) {
    await conn.query(
      `INSERT INTO public.tb_company_suppression (kind, value, reason, created_by)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (kind, value) DO UPDATE SET reason = EXCLUDED.reason`,
      [kind, String(value).toLowerCase().slice(0, 300), reason || null, created_by || null]
    );
    // Marca as linhas que já existem. As que ainda não existem são barradas na
    // criação pelo `isSuppressed` — as duas metades do mesmo pedido.
    const { rowCount } = await conn.query(
      `UPDATE public.tb_company
          SET suppressed_at = NOW(), suppressed_reason = $3, updated_at = NOW()
        WHERE suppressed_at IS NULL
          AND (
               ($1 = 'cnpj'   AND cnpj   = $2::text)
            OR ($1 = 'domain' AND domain = $2::text)
            OR ($1 = 'email'  AND email  = $2::text)
          )`,
      [kind, String(value).toLowerCase().slice(0, 300), reason || null]
    );
    return { suppressed: rowCount };
  }

  // ─── BUSCA ─────────────────────────────────────────────────────────────────

  /**
   * A consulta da tela.
   *
   * ⚠️ O RECORTE GEOGRÁFICO VEM PRIMEIRO NO ÍNDICE, e é o que torna isto
   * barato: `ix_company_place (uf, city_norm, category_key)`. A pergunta é
   * sempre "categoria X em Y", e (uf, cidade) é o que mais reduz.
   *
   * ⚠️ O RAIO É BOUNDING BOX + HAVERSINE, nesta ordem. A bbox é o que o índice
   * `ix_company_geo` consegue usar; o haversine é exato mas não é indexável, e
   * rodá-lo sobre a tabela inteira seria um seq scan por busca. A bbox recorta,
   * o haversine confere. Sem a bbox, isto degrada silenciosamente conforme a
   * base cresce — que é o pior modo de falhar.
   *
   * ⚠️ A DELTA DE LONGITUDE É CORRIGIDA PELA LATITUDE (`cos(lat)`). Sem isso a
   * caixa fica larga demais no Sul e no Norte do país: em Porto Alegre, 1 grau
   * de longitude são ~80 km, não 111. O haversine corrigiria o resultado, mas
   * a caixa teria varrido 40% a mais de linhas à toa.
   */
  static async search(conn, f = {}) {
    const where = ["c.is_active = TRUE", "c.suppressed_at IS NULL"];
    const v = [];
    const p = (value) => {
      v.push(value);
      return `$${v.length}`;
    };

    if (f.category_key) where.push(`c.category_key = ${p(f.category_key)}`);
    if (f.uf) where.push(`c.uf = ${p(String(f.uf).toUpperCase().slice(0, 2))}`);
    if (f.city) where.push(`c.city_norm = ${p(N.normalizeCity(f.city))}`);
    if (f.neighborhood) {
      where.push(`lower(c.neighborhood) = ${p(String(f.neighborhood).toLowerCase().trim())}`);
    }
    if (f.cnae) {
      // Prefixo: "8630" acha 8630-5/01 e 8630-5/02, que são a mesma atividade.
      where.push(`c.main_cnae LIKE ${p(`${String(f.cnae).replace(/\D/g, "")}%`)}`);
    }
    if (f.q) {
      // A busca textual roda sobre um conjunto JÁ RECORTADO por cidade e
      // categoria — é o que permite um LIKE aqui sem trigram nem tsvector, e o
      // que dispensou ligar extensão nova no Postgres de produção.
      where.push(`c.name_norm LIKE ${p(`%${N.normalizeName(f.q)}%`)}`);
    }
    if (f.only_active_status) where.push(`c.reg_status = 'ativa'`);
    if (f.headquarters_only) where.push(`c.is_headquarters IS TRUE`);
    if (f.company_size) where.push(`c.company_size = ${p(f.company_size)}`);
    if (f.min_capital_cents) {
      where.push(`c.share_capital_cents >= ${p(Number(f.min_capital_cents))}`);
    }
    if (f.opened_before) where.push(`c.opened_at <= ${p(f.opened_before)}::date`);
    if (f.min_confidence) where.push(`c.confidence >= ${p(Number(f.min_confidence))}`);

    // Os filtros de CANAL — são eles que separam "cadastro" de "lead abordável".
    if (f.has_phone) where.push("c.phone IS NOT NULL");
    if (f.has_whatsapp) where.push("c.whatsapp IS NOT NULL");
    if (f.has_email) where.push("c.email IS NOT NULL");
    if (f.has_website) where.push("c.website IS NOT NULL");
    if (f.has_instagram) where.push("c.instagram IS NOT NULL");
    if (f.has_social) {
      where.push(
        "(c.instagram IS NOT NULL OR c.facebook IS NOT NULL OR c.linkedin IS NOT NULL OR c.tiktok IS NOT NULL OR c.youtube IS NOT NULL)"
      );
    }
    if (f.has_cnpj) where.push("c.cnpj IS NOT NULL");

    // Raio.
    let distanceSelect = "NULL::float8 AS distance_m";
    let orderBy = "c.confidence DESC, c.display_name ASC";
    const lat = Number(f.lat);
    const lon = Number(f.lon);
    const radiusM = Number(f.radius_m);
    if (Number.isFinite(lat) && Number.isFinite(lon) && radiusM > 0) {
      const dLat = radiusM / 111_320;
      const cosLat = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
      const dLon = radiusM / (111_320 * cosLat);
      where.push(`c.latitude BETWEEN ${p(lat - dLat)} AND ${p(lat + dLat)}`);
      where.push(`c.longitude BETWEEN ${p(lon - dLon)} AND ${p(lon + dLon)}`);
      // ⚠️ O centro entra UMA vez por eixo e é reusado por NOME (`dist`), não
      // por placeholder repetido — repetir `$n` dentro de `radians()` e numa
      // comparação numérica é exatamente a forma do 42P08.
      const pLat = p(lat);
      const pLon = p(lon);
      distanceSelect = `
        6371000 * 2 * asin(sqrt(
          power(sin(radians(c.latitude - ${pLat}::float8) / 2), 2)
          + cos(radians(${pLat}::float8)) * cos(radians(c.latitude))
          * power(sin(radians(c.longitude - ${pLon}::float8) / 2), 2)
        )) AS distance_m`;
      where.push(`
        6371000 * 2 * asin(sqrt(
          power(sin(radians(c.latitude - ${pLat}::float8) / 2), 2)
          + cos(radians(${pLat}::float8)) * cos(radians(c.latitude))
          * power(sin(radians(c.longitude - ${pLon}::float8) / 2), 2)
        )) <= ${p(radiusM)}`);
      orderBy = "distance_m ASC NULLS LAST, c.confidence DESC";
    }

    const perPage = Math.max(1, Math.min(100, Number(f.per_page) || 24));
    const page = Math.max(1, Number(f.page) || 1);
    const offset = (page - 1) * perPage;

    const whereSql = where.join("\n      AND ");

    const { rows } = await conn.query(
      `SELECT ${COMPANY_COLUMNS}, ${distanceSelect}
         FROM public.tb_company c
        WHERE ${whereSql}
        ORDER BY ${orderBy}
        LIMIT ${p(perPage)} OFFSET ${p(offset)}`,
      v
    );

    // A contagem reusa exatamente o mesmo WHERE (e só os parâmetros dele): uma
    // segunda lista de filtros aqui divergiria da primeira na próxima mudança,
    // e a tela diria "1.284 empresas" mostrando outra coisa.
    const countValues = v.slice(0, v.length - 2);
    const { rows: countRows } = await conn.query(
      `SELECT COUNT(*)::int AS total FROM public.tb_company c WHERE ${whereSql}`,
      countValues
    );

    return { rows, total: countRows[0]?.total || 0, page, per_page: perPage };
  }

  /**
   * Quantas empresas a base tem para (categoria, uf, cidade) — IGNORANDO os
   * filtros de refino.
   *
   * ⚠️ ELA EXISTE PARA SEPARAR DUAS COISAS QUE A TELA CONFUNDIA, e a confusão
   * mandava a pessoa fazer exatamente a coisa errada. Com `total = 0` a tela
   * dizia "nada por aqui ainda, aperte Procurar mais" — mas esse total é o
   * FILTRADO. Numa cidade já varrida, um filtro impossível (por exemplo "com
   * WhatsApp" **e** "com Instagram" ao mesmo tempo, que na base fresca do OSM
   * é interseção vazia) zerava o resultado e a tela mandava varrer de novo:
   * gasta uma varredura do Overpass à toa, não muda nada, e esconde a causa
   * real — que é o filtro, não a falta de dado.
   *
   * O recorte aqui é só o que a DESCOBERTA sabe responder (categoria + cidade),
   * porque é exatamente essa a pergunta: "esta cidade já foi varrida para esta
   * categoria?". Canal, CNPJ, capital e data de abertura são refino sobre o que
   * já foi varrido, e por isso ficam de fora.
   */
  static async countPlace(conn, { category_key, uf, city }) {
    const { rows } = await conn.query(
      `SELECT COUNT(*)::int AS total
         FROM public.tb_company c
        WHERE c.is_active = TRUE AND c.suppressed_at IS NULL
          AND ($1::text IS NULL OR c.category_key = $1::text)
          AND ($2::text IS NULL OR c.uf = $2::text)
          AND ($3::text IS NULL OR c.city_norm = $3::text)`,
      [
        category_key || null,
        uf ? String(uf).toUpperCase().slice(0, 2) : null,
        city ? N.normalizeCity(city) : null,
      ]
    );
    return rows[0]?.total || 0;
  }

  /**
   * As cidades que a base já conhece para uma categoria — alimenta o seletor
   * da tela em vez de deixar a pessoa digitar uma cidade onde não há nada.
   */
  static async facetCities(conn, { category_key, uf }) {
    const { rows } = await conn.query(
      `SELECT c.uf, c.city, c.city_norm, COUNT(*)::int AS total
         FROM public.tb_company c
        WHERE c.is_active = TRUE AND c.suppressed_at IS NULL
          AND c.city IS NOT NULL
          AND ($1::text IS NULL OR c.category_key = $1::text)
          AND ($2::text IS NULL OR c.uf = $2::text)
        GROUP BY c.uf, c.city, c.city_norm
        ORDER BY total DESC
        LIMIT 60`,
      [category_key || null, uf ? String(uf).toUpperCase().slice(0, 2) : null]
    );
    return rows;
  }

  // ─── CACHE DE ÁREA DO OSM ──────────────────────────────────────────────────

  static async getAreaCache(conn, uf, city) {
    const { rows } = await conn.query(
      `SELECT uf, city_norm, osm_area_id, display_name, checked_at
         FROM public.tb_osm_area_cache
        WHERE uf = $1 AND city_norm = $2 LIMIT 1`,
      [String(uf).toUpperCase().slice(0, 2), N.normalizeCity(city)]
    );
    return rows[0] || null;
  }

  static async setAreaCache(conn, { uf, city, osm_area_id, display_name }) {
    await conn.query(
      `INSERT INTO public.tb_osm_area_cache (uf, city_norm, osm_area_id, display_name)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (uf, city_norm) DO UPDATE
         SET osm_area_id  = EXCLUDED.osm_area_id,
             display_name = EXCLUDED.display_name,
             checked_at   = NOW()`,
      [
        String(uf).toUpperCase().slice(0, 2),
        N.normalizeCity(city),
        osm_area_id ?? null,
        display_name || null,
      ]
    );
  }

  // ─── SETTINGS ──────────────────────────────────────────────────────────────

  static async getSettings(conn) {
    const { rows } = await conn.query(
      `SELECT * FROM public.prospeccao_settings WHERE id = 1 LIMIT 1`
    );
    return rows[0] || null;
  }
}

module.exports = CompanyStorage;
module.exports.COMPANY_COLUMNS = COMPANY_COLUMNS;
module.exports.WRITABLE = WRITABLE;
