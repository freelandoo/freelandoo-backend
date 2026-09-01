// src/storages/CommunitySiteStorage.js
// SQL puro do site da comunidade (mig 212). Métodos estáticos recebendo `conn`,
// no estilo do CommunityStorage.
//
// Uma comunidade tem NO MÁXIMO um site (id_profile é a PK), então gravar é
// sempre um UPSERT — nunca "buscar para saber se insere ou atualiza", que abre
// janela para duas requisições do autosave criarem a mesma linha ao mesmo tempo.

class CommunitySiteStorage {
  static async getByProfile(conn, id_profile) {
    const r = await conn.query(
      `SELECT id_profile, site_name, tagline, theme, sections,
              is_published, published_at, created_at, updated_at
         FROM public.tb_community_site
        WHERE id_profile = $1
        LIMIT 1`,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Grava o site inteiro. `config` já vem NORMALIZADO pelo service — este
   * método não valida nada, só persiste.
   *
   * `is_published` fica de fora do UPSERT de propósito: salvar um rascunho não
   * pode publicar o site sozinho, e republicar não pode ser efeito colateral de
   * um autosave. Quem muda esse bit é `setPublished`.
   */
  static async upsert(conn, id_profile, config) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_site
              (id_profile, site_name, tagline, theme, sections, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, NOW())
       ON CONFLICT (id_profile) DO UPDATE
          SET site_name  = EXCLUDED.site_name,
              tagline    = EXCLUDED.tagline,
              theme      = EXCLUDED.theme,
              sections   = EXCLUDED.sections,
              updated_at = NOW()
       RETURNING id_profile, site_name, tagline, theme, sections,
                 is_published, published_at, created_at, updated_at`,
      [
        id_profile,
        config.siteName,
        config.tagline,
        JSON.stringify(config.theme),
        JSON.stringify(config.sections),
      ]
    );
    return r.rows[0];
  }

  /**
   * Publica ou despublica. `published_at` guarda a PRIMEIRA publicação e não é
   * reescrito a cada republicação — é a data de nascimento do site, não a do
   * último save (essa já é `updated_at`).
   */
  static async setPublished(conn, id_profile, isPublished) {
    const r = await conn.query(
      `UPDATE public.tb_community_site
          SET is_published = $2,
              published_at = CASE
                WHEN $2 = TRUE AND published_at IS NULL THEN NOW()
                ELSE published_at
              END,
              updated_at = NOW()
        WHERE id_profile = $1
       RETURNING id_profile, site_name, tagline, theme, sections,
                 is_published, published_at, created_at, updated_at`,
      [id_profile, isPublished]
    );
    return r.rowCount ? r.rows[0] : null;
  }
}

module.exports = CommunitySiteStorage;
