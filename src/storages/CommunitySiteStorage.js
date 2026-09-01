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
   * Reserva o endereço próprio (`community_site_slug`, mig 213).
   *
   * A unicidade é do BANCO (índice parcial), não de um SELECT antes do UPDATE:
   * duas comunidades publicando ao mesmo tempo com o mesmo nome passariam as
   * duas por um "já existe?" e colidiriam no INSERT. Aqui a corrida é resolvida
   * pelo índice e traduzida em `{ taken: true }` — que para quem chamou é uma
   * resposta, não um erro.
   */
  static async claimSlug(conn, id_profile, slug) {
    try {
      const r = await conn.query(
        `UPDATE public.tb_profile
            SET community_site_slug = $2, updated_at = NOW()
          WHERE id_profile = $1
            AND is_community = TRUE
            AND deleted_at IS NULL
        RETURNING id_profile, community_site_slug`,
        [id_profile, slug]
      );
      return r.rowCount ? { slug: r.rows[0].community_site_slug } : null;
    } catch (err) {
      // 23505 = unique_violation: o endereço é de outra comunidade.
      if (err && err.code === "23505") return { taken: true };
      throw err;
    }
  }

  static async getSlug(conn, id_profile) {
    const r = await conn.query(
      `SELECT community_site_slug FROM public.tb_profile WHERE id_profile = $1`,
      [id_profile]
    );
    return r.rowCount ? r.rows[0].community_site_slug : null;
  }

  /**
   * Resolve o endereço público → comunidade + site, numa consulta só.
   *
   * Devolve a linha mesmo com o site despublicado: quem decide o que fazer com
   * isso é o service (para o visitante é 404; o líder ainda vê o rascunho).
   * Uma consulta que já filtrasse por `is_published` obrigaria uma segunda
   * viagem só para distinguir "não existe" de "existe e está oculto".
   */
  static async getPublicBySlug(conn, slug) {
    const r = await conn.query(
      `SELECT p.id_profile, p.display_name, p.avatar_url, p.bio,
              p.community_site_slug AS slug,
              p.community_privacy   AS privacy,
              p.community_kind      AS kind,
              cs.site_name, cs.tagline, cs.theme, cs.sections,
              cs.is_published, cs.published_at, cs.updated_at
         FROM public.tb_profile p
         JOIN public.tb_community_site cs ON cs.id_profile = p.id_profile
        WHERE p.community_site_slug = $1
          AND p.is_community = TRUE
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [slug]
    );
    return r.rowCount ? r.rows[0] : null;
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
