// src/storages/LeadListStorage.js
// SQL puro das listas de prospecção (mig 254).
//
// ⚠️ TODA LEITURA E TODA ESCRITA SOBEM ATÉ O NEGÓCIO (`id_profile`).
//
// A lista guarda quem a barbearia pretende abordar — é estratégia comercial. Um
// `SELECT` por `id_list` solto seria a carteira de prospecção de um concorrente
// servida a quem adivinhasse um UUID. Mesma disciplina da base de conhecimento
// do atendente (mig 253) e da caixa de WhatsApp (mig 223): o dono entra no
// WHERE, não num `if` do service.

const { COMPANY_COLUMNS } = require("./CompanyStorage");

class LeadListStorage {
  static async listByProfile(conn, id_profile) {
    const { rows } = await conn.query(
      `SELECT l.id_list, l.name, l.note, l.created_at, l.updated_at,
              COUNT(i.id_company)::int AS total
         FROM public.tb_lead_list l
         LEFT JOIN public.tb_lead_list_item i ON i.id_list = l.id_list
        WHERE l.id_profile = $1
        GROUP BY l.id_list
        ORDER BY l.created_at DESC`,
      [id_profile]
    );
    return rows;
  }

  /** A lista, SE ela for daquele negócio. `null` também quando não é. */
  static async getOwned(conn, id_list, id_profile) {
    const { rows } = await conn.query(
      `SELECT id_list, id_profile, id_user, name, note, created_at, updated_at
         FROM public.tb_lead_list
        WHERE id_list = $1 AND id_profile = $2
        LIMIT 1`,
      [id_list, id_profile]
    );
    return rows[0] || null;
  }

  static async create(conn, { id_profile, id_user, name, note }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_lead_list (id_profile, id_user, name, note)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (id_profile, lower(name)) DO NOTHING
       RETURNING id_list, name, note, created_at, updated_at`,
      [id_profile, id_user || null, String(name).trim().slice(0, 120), note || null]
    );
    return rows[0] || null;
  }

  static async rename(conn, id_list, id_profile, { name, note }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_lead_list
          SET name = COALESCE($3, name), note = $4, updated_at = NOW()
        WHERE id_list = $1 AND id_profile = $2
        RETURNING id_list, name, note, updated_at`,
      [id_list, id_profile, name ? String(name).trim().slice(0, 120) : null, note ?? null]
    );
    return rows[0] || null;
  }

  static async remove(conn, id_list, id_profile) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_lead_list WHERE id_list = $1 AND id_profile = $2`,
      [id_list, id_profile]
    );
    return rowCount > 0;
  }

  /**
   * Põe a empresa na lista.
   *
   * ⚠️ O `id_profile` ENTRA NO `SELECT` DE ORIGEM, e não num guard antes: é o
   * que torna impossível gravar numa lista alheia mesmo que o service esqueça
   * de checar. Lista que não é do negócio simplesmente não produz linha.
   *
   * `ON CONFLICT DO NOTHING` porque adicionar duas vezes é o clique duplo de
   * sempre, e não um erro a mostrar na cara de quem acabou de salvar um lead.
   */
  static async addCompany(conn, { id_list, id_profile, id_company, added_by, note }) {
    const { rows } = await conn.query(
      `INSERT INTO public.tb_lead_list_item (id_list, id_company, added_by, note)
       SELECT l.id_list, $3, $4, $5
         FROM public.tb_lead_list l
        WHERE l.id_list = $1 AND l.id_profile = $2
       ON CONFLICT (id_list, id_company) DO NOTHING
       RETURNING id_list, id_company, stage, added_at`,
      [id_list, id_profile, id_company, added_by || null, note || null]
    );
    return rows[0] || null;
  }

  static async removeCompany(conn, { id_list, id_profile, id_company }) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_lead_list_item i
        USING public.tb_lead_list l
        WHERE i.id_list = l.id_list
          AND i.id_list = $1 AND l.id_profile = $2 AND i.id_company = $3`,
      [id_list, id_profile, id_company]
    );
    return rowCount > 0;
  }

  /**
   * O estágio do lead — o degrau que já deixa o CRM entrar sem migration.
   *
   * ⚠️ O VALOR NÃO É VALIDADO AQUI: quem o valida é o CHECK
   * `chk_lead_item_stage` da mig 254, e é ele que tem que ser a verdade. Uma
   * segunda lista de estágios no JS divergiria do banco na primeira adição, e o
   * INSERT passaria a estourar num caminho que "parecia validado".
   */
  static async setStage(conn, { id_list, id_profile, id_company, stage, owner_user, note }) {
    const { rows } = await conn.query(
      `UPDATE public.tb_lead_list_item i
          SET stage      = COALESCE($4, i.stage),
              owner_user = COALESCE($5, i.owner_user),
              note       = COALESCE($6, i.note),
              updated_at = NOW()
         FROM public.tb_lead_list l
        WHERE i.id_list = l.id_list
          AND i.id_list = $1 AND l.id_profile = $2 AND i.id_company = $3
        RETURNING i.id_company, i.stage, i.owner_user, i.note, i.updated_at`,
      [id_list, id_profile, id_company, stage || null, owner_user || null, note ?? null]
    );
    return rows[0] || null;
  }

  /**
   * As empresas da lista, com os dados delas.
   *
   * Serve a tela E a exportação — uma segunda consulta para o CSV é como ele
   * passaria a exportar um conjunto diferente do que está na tela.
   */
  static async listCompanies(conn, { id_list, id_profile, limit = 500, offset = 0 }) {
    const { rows } = await conn.query(
      `SELECT ${COMPANY_COLUMNS},
              i.stage, i.note AS lead_note, i.owner_user, i.added_at
         FROM public.tb_lead_list_item i
         JOIN public.tb_lead_list l ON l.id_list = i.id_list
         JOIN public.tb_company   c ON c.id_company = i.id_company
        WHERE i.id_list = $1 AND l.id_profile = $2
          AND c.suppressed_at IS NULL
        ORDER BY i.added_at DESC
        LIMIT $3 OFFSET $4`,
      [id_list, id_profile, Math.max(1, Math.min(2000, Number(limit) || 500)), Number(offset) || 0]
    );
    return rows;
  }

  /**
   * Em quais listas DESTE negócio a empresa já está.
   *
   * É o que deixa a tela marcar o card como "já salvo" em vez de oferecer
   * adicionar de novo — a informação que faz a pessoa confiar na lista.
   */
  static async listIdsForCompanies(conn, { id_profile, companyIds }) {
    if (!companyIds?.length) return {};
    const { rows } = await conn.query(
      `SELECT i.id_company, i.id_list
         FROM public.tb_lead_list_item i
         JOIN public.tb_lead_list l ON l.id_list = i.id_list
        WHERE l.id_profile = $1 AND i.id_company = ANY($2::uuid[])`,
      [id_profile, companyIds]
    );
    const out = {};
    for (const r of rows) {
      (out[r.id_company] = out[r.id_company] || []).push(r.id_list);
    }
    return out;
  }

  /** Quantos leads em cada estágio — o começo do funil, sem tabela nova. */
  static async stageSummary(conn, id_profile) {
    const { rows } = await conn.query(
      `SELECT i.stage, COUNT(*)::int AS total
         FROM public.tb_lead_list_item i
         JOIN public.tb_lead_list l ON l.id_list = i.id_list
        WHERE l.id_profile = $1
        GROUP BY i.stage`,
      [id_profile]
    );
    return Object.fromEntries(rows.map((r) => [r.stage, r.total]));
  }
}

module.exports = LeadListStorage;
