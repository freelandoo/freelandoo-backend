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
      `SELECT id_profile, site_name, tagline, theme, sections, text_styles, pages,
              template, template_data, managed_by_platform, grace_until,
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
   *
   * ⚠️ AS QUATRO COLUNAS DA MIG 241 (`template`, `template_data`,
   * `managed_by_platform`, `grace_until`) FICAM DE FORA PELO MESMO MOTIVO, e
   * este é o ponto mais sensível do arquivo: esta é a porta de escrita do
   * LÍDER — é ela que o autosave chama a cada pausa. Mencionar `template` aqui
   * faria qualquer líder poder apontar o próprio site para um tema nosso, ou
   * apagar o tema de um site gerenciado gravando seções por cima, sem uma
   * linha de código nova em lugar nenhum. Quem mexe nelas é `setManaged`,
   * atrás de `roleMiddleware("Administrator")`.
   */
  static async upsert(conn, id_profile, config) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_site
              (id_profile, site_name, tagline, theme, sections, text_styles, pages, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, NOW())
       ON CONFLICT (id_profile) DO UPDATE
          SET site_name   = EXCLUDED.site_name,
              tagline     = EXCLUDED.tagline,
              theme       = EXCLUDED.theme,
              sections    = EXCLUDED.sections,
              text_styles = EXCLUDED.text_styles,
              pages       = EXCLUDED.pages,
              updated_at  = NOW()
       RETURNING id_profile, site_name, tagline, theme, sections, text_styles, pages,
                 is_published, published_at, created_at, updated_at`,
      [
        id_profile,
        config.siteName,
        config.tagline,
        JSON.stringify(config.theme),
        JSON.stringify(config.sections),
        // ⚠️ Estes dois vêm do normalizador e SEMPRE existem. Guardar `config.x
        // || {}` aqui esconderia um normalizador quebrado: a coluna nasceria
        // vazia e o sintoma seria o tamanho do texto sumindo de novo.
        JSON.stringify(config.textStyles),
        JSON.stringify(config.pages),
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
              p.id_leader_user,
              p.community_site_slug AS slug,
              p.community_privacy   AS privacy,
              p.community_kind      AS kind,
              cs.site_name, cs.tagline, cs.theme, cs.sections, cs.text_styles, cs.pages,
              -- ATENCAO: sem a coluna template aqui, o site publicado sairia
              -- desenhado pelo canvas de secoes mesmo tendo um tema gravado --
              -- e as secoes de um site gerenciado estao vazias, entao a pagina
              -- abriria EM BRANCO sem um unico erro. Projecao campo a campo
              -- cobra isso (mig 238). (Sem crase e sem cifrao neste comentario:
              -- ele vive dentro de um template literal de JS.)
              cs.template, cs.template_data, cs.managed_by_platform,
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
       RETURNING id_profile, site_name, tagline, theme, sections, text_styles, pages,
                 template, template_data, managed_by_platform, grace_until,
                 is_published, published_at, created_at, updated_at`,
      [id_profile, isPublished]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * A PORTA DA PLATAFORMA (mig 241) — grava o tema, os dados dele e o bit de
   * travamento. É o único caminho de escrita dessas colunas, e vive atrás de
   * `roleMiddleware("Administrator")`.
   *
   * INSERT ... ON CONFLICT e não UPDATE: o site gerenciado é montado por nós
   * do zero, e na primeira vez a linha não existe. Um UPDATE puro não
   * gravaria nada e devolveria `null` — "não encontrado" para um site que
   * estamos criando agora.
   *
   * As colunas do DOCUMENTO ficam de fora: um site de tema não usa seções, e
   * mencioná-las aqui apagaria o rascunho de quem estava no construtor antes
   * de contratar o site pronto. Se um dia ele voltar ao construtor, o que ele
   * tinha continua lá.
   */
  static async setManaged(conn, id_profile, { template, templateData, managed }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_site
              (id_profile, template, template_data, managed_by_platform, updated_at)
       VALUES ($1, $2, $3::jsonb, $4, NOW())
       ON CONFLICT (id_profile) DO UPDATE
          SET template            = EXCLUDED.template,
              template_data       = EXCLUDED.template_data,
              managed_by_platform = EXCLUDED.managed_by_platform,
              updated_at          = NOW()
       RETURNING id_profile, site_name, tagline, theme, sections, text_styles, pages,
                 template, template_data, managed_by_platform, grace_until,
                 is_published, published_at, created_at, updated_at`,
      [id_profile, template, JSON.stringify(templateData || {}), !!managed]
    );
    return r.rows[0];
  }

  /**
   * Liga e desliga o relógio da carência (mig 241).
   *
   * `until` NULL PARA o relógio — é o que acontece quando a assinatura volta.
   * Só toca site gerenciado: o site do construtor continua no ar quando o
   * plano acaba, que é a regra do PlanService ("perde a porta, não o que já é
   * seu"), e aqui um WHERE a menos derrubaria o site de quem montou o próprio.
   */
  static async setGrace(conn, id_profile, until) {
    const r = await conn.query(
      `UPDATE public.tb_community_site
          SET grace_until = $2, updated_at = NOW()
        WHERE id_profile = $1
          AND managed_by_platform = TRUE
       RETURNING id_profile, grace_until`,
      [id_profile, until]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * A carteira de sites feitos por nós (mig 241) — o que o painel de admin
   * lista. Traz o dono e o endereço junto: sem eles, a tela pediria uma
   * consulta por linha só para escrever o nome do cliente.
   */
  static async listManaged(conn) {
    const r = await conn.query(
      `SELECT cs.id_profile, cs.template, cs.is_published, cs.published_at,
              cs.grace_until, cs.updated_at,
              p.display_name, p.community_site_slug AS slug, p.id_leader_user,
              u.username AS leader_username
         FROM public.tb_community_site cs
         JOIN public.tb_profile p ON p.id_profile = cs.id_profile
         LEFT JOIN public.tb_user u ON u.id_user = p.id_leader_user
        WHERE cs.managed_by_platform = TRUE
          AND p.deleted_at IS NULL
        ORDER BY cs.updated_at DESC`
    );
    return r.rows;
  }

  /**
   * Os sites gerenciados cujo prazo venceu — o que o sweeper despublica.
   *
   * Devolve o dono junto porque quem despublica precisa avisar alguém, e uma
   * segunda consulta por linha transformaria a varredura em N+1.
   */
  static async listGraceExpired(conn, limit = 100) {
    const r = await conn.query(
      `SELECT cs.id_profile, p.id_leader_user, p.display_name
         FROM public.tb_community_site cs
         JOIN public.tb_profile p ON p.id_profile = cs.id_profile
        WHERE cs.managed_by_platform = TRUE
          AND cs.is_published = TRUE
          AND cs.grace_until IS NOT NULL
          AND cs.grace_until <= NOW()
        LIMIT $1`,
      [limit]
    );
    return r.rows;
  }
}

module.exports = CommunitySiteStorage;
