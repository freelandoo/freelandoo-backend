// src/storages/NeighborhoodStorage.js
// SQL puro do bairro como comunidade (mig 204).
//
// O predicado de morador (§4.2) mora AQUI, escrito uma vez, e é o que o resto
// do sistema consulta:
//
//   morador do bairro = vínculo RECONHECIDO e VIVO numa unidade cujo endereço
//                       pertence ao território do bairro
//
// Escrito como EXISTS sobre a árvore da mig 202 (território → endereço →
// unidade), o que faz a mudança de escopo do condomínio (subsistema 5) ser
// trocar um JOIN, não reescrever a regra.

const ProfileStorage = require("./ProfileStorage");

// Repetido nas queries porque é a definição, não um detalhe: vínculo encerrado
// que continuasse contando seria morador fantasma com direito a voto.
const RECOGNIZED = `rm.status = 'recognized' AND rm.ended_at IS NULL`;

class NeighborhoodStorage {
  static async getById(conn, id_profile) {
    const r = await conn.query(
      `SELECT p.id_profile, p.display_name, p.bio, p.avatar_url, p.id_leader_user,
              p.community_kind, p.id_territory, p.estado, p.municipio,
              t.uf, t.municipio_label, t.bairro_label, t.is_city_wide
         FROM public.tb_profile p
         LEFT JOIN public.tb_territory t ON t.id_territory = p.id_territory
        WHERE p.id_profile = $1
          AND p.community_kind = 'neighborhood'
          AND p.deleted_at IS NULL
        LIMIT 1`,
      [id_profile]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getByTerritory(conn, id_territory) {
    const r = await conn.query(
      `SELECT id_profile, display_name FROM public.tb_profile
        WHERE id_territory = $1
          AND community_kind = 'neighborhood'
          AND deleted_at IS NULL
        LIMIT 1`,
      [id_territory]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Territórios onde o usuário é morador RECONHECIDO. */
  static async listTerritoriesForResident(conn, id_user) {
    const r = await conn.query(
      `SELECT DISTINCT t.id_territory, t.uf, t.municipio_label, t.bairro_label,
              t.is_city_wide, t.id_region
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = u.id_address
         JOIN public.tb_territory t ON t.id_territory = a.id_territory
        WHERE rm.id_user = $1 AND ${RECOGNIZED}
        ORDER BY t.bairro_label`,
      [id_user]
    );
    return r.rows;
  }

  /**
   * Situação do usuário no território. Devolve os dois níveis do D6 separados:
   * `linked` (declarou residência, seja lá em que estado) e `recognized` (os
   * vizinhos confirmaram) — porque a mensagem para quem está esperando
   * reconhecimento não pode ser a mesma de quem não mora ali.
   */
  static async getResidentStatus(conn, { id_territory, id_user }) {
    const r = await conn.query(
      `SELECT rm.status
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = u.id_address
        WHERE rm.id_user = $2
          AND a.id_territory = $1
          AND rm.ended_at IS NULL
        ORDER BY CASE rm.status WHEN 'recognized' THEN 0 ELSE 1 END
        LIMIT 1`,
      [id_territory, id_user]
    );
    if (!r.rowCount) return { linked: false, recognized: false, status: null };
    const status = r.rows[0].status;
    return { linked: true, recognized: status === "recognized", status };
  }

  static async createNeighborhood(
    conn,
    { id_user, id_territory, display_name, bio, avatar_url }
  ) {
    const sub_profile_slug = await ProfileStorage.resolveUniqueSubProfileSlug(conn, {
      id_user,
      display_name,
    });

    // id_machine e id_category ficam NULL: bairro não tem enxame (o CHECK da
    // mig 204 abriu essa porta justamente para não gravar taxonomia falsa).
    // Cidade, UF e região saem do TERRITÓRIO, não do perfil do fundador — o
    // bairro tem lugar próprio, que não é o lugar de quem o criou.
    const r = await conn.query(
      `INSERT INTO public.tb_profile
         (id_user, id_category, id_machine, is_community, id_leader_user,
          display_name, bio, avatar_url, sub_profile_slug,
          community_kind, id_territory, estado, municipio, id_region)
       SELECT $1, NULL, NULL, TRUE, $1,
              $2, $3, $4, $5,
              'neighborhood', t.id_territory, t.uf, t.municipio_label, t.id_region
         FROM public.tb_territory t
        WHERE t.id_territory = $6
       RETURNING id_profile, display_name, community_kind, id_territory,
                 estado, municipio, id_region`,
      [id_user, display_name, bio, avatar_url, sub_profile_slug, id_territory]
    );
    return r.rows[0];
  }

  /**
   * Descoberta por (cidade, bairro). NUNCA por rua (D5): é a busca por
   * logradouro que transformava o condomínio num diretório de endereços (C4).
   *
   * A projeção é deliberadamente magra — nome, bairro, cidade, UF. Contagem de
   * membros e atividade NÃO saem daqui: numa comunidade territorial elas dizem
   * quanta gente mora e quão movimentado é o lugar.
   */
  static async discover(conn, { uf, municipio, q = null, limit = 50 }) {
    const params = [String(uf).toUpperCase().slice(0, 2), String(municipio)];
    let filter = "";
    if (q) {
      params.push(`%${String(q).trim()}%`);
      filter = ` AND t.bairro_label ILIKE $${params.length}`;
    }
    params.push(Math.min(Number(limit) || 50, 200));
    const r = await conn.query(
      `SELECT t.id_territory, t.uf, t.municipio_label, t.bairro_label,
              t.is_city_wide,
              p.id_profile, p.display_name, p.avatar_url
         FROM public.tb_territory t
         LEFT JOIN public.tb_profile p
                ON p.id_territory = t.id_territory
               AND p.community_kind = 'neighborhood'
               AND p.deleted_at IS NULL
        WHERE t.uf = $1
          AND t.municipio_norm = fl_norm_city($2)
          AND t.status = 'active'${filter}
        ORDER BY t.bairro_label
        LIMIT $${params.length}`,
      params
    );
    return r.rows;
  }

  /** Onde EU moro + a comunidade do lugar, se já existir. */
  static async listMine(conn, id_user) {
    const r = await conn.query(
      `SELECT DISTINCT ON (t.id_territory)
              t.id_territory, t.uf, t.municipio_label, t.bairro_label,
              rm.status AS residence_status,
              p.id_profile, p.display_name, p.avatar_url,
              (cm.id_user IS NOT NULL) AS is_member,
              cm.role
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = u.id_address
         JOIN public.tb_territory t ON t.id_territory = a.id_territory
         LEFT JOIN public.tb_profile p
                ON p.id_territory = t.id_territory
               AND p.community_kind = 'neighborhood'
               AND p.deleted_at IS NULL
         LEFT JOIN public.tb_community_member cm
                ON cm.id_community_profile = p.id_profile AND cm.id_user = $1
        WHERE rm.id_user = $1 AND rm.ended_at IS NULL
        ORDER BY t.id_territory,
                 CASE rm.status WHEN 'recognized' THEN 0 ELSE 1 END`,
      [id_user]
    );
    return r.rows;
  }
}

module.exports = NeighborhoodStorage;
