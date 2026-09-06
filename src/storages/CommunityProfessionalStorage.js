// src/storages/CommunityProfessionalStorage.js
// A equipe que atende pelo site da comunidade (mig 221).
//
// A linha guarda só o par (comunidade, usuário). Tudo que a tela mostra — nome,
// foto, profissão — é lido do PERFIL-CONTA da pessoa na hora, e não copiado
// para cá: nome e foto mudam, e uma cópia deixaria o site anunciando o rosto
// antigo de quem já trocou a foto.
//
// O perfil-conta é também o alvo do agendamento: a agenda é da CONTA (mig 190)
// e a aba "Serviços" do /account grava nele. É por isso que a projeção sempre
// devolve `id_profile` — sem ele o site não tem para onde mandar o cliente.

const PROFESSIONAL_SELECT = `
  SELECT p.id_profile,
         u.id_user,
         u.username,
         u.nome                AS user_name,
         p.display_name        AS profile_name,
         p.avatar_url,
         c.desc_category       AS profession,
         p.taxonomy_declared_at
    FROM public.tb_user u
    JOIN public.tb_profile p
      ON p.id_user = u.id_user
     AND p.is_user_account = TRUE
     AND p.deleted_at IS NULL
    LEFT JOIN public.tb_category c ON c.id_category = p.id_category
`;

class CommunityProfessionalStorage {
  /**
   * A equipe promovida, na ordem em que entrou.
   *
   * NÃO inclui o líder: ele é profissional por construção, e quem monta a lista
   * final (service) o coloca em primeiro. Uma linha para o líder aqui seria uma
   * segunda verdade sobre um fato que `tb_profile.id_leader_user` já guarda.
   */
  static async list(conn, id_community) {
    const r = await conn.query(
      `${PROFESSIONAL_SELECT}
        JOIN public.tb_community_professional cp ON cp.id_user = u.id_user
       WHERE cp.id_profile = $1
       ORDER BY cp.created_at ASC`,
      [id_community]
    );
    return r.rows;
  }

  /** Os mesmos campos, para UM usuário — usado ao montar o líder da lista. */
  static async getPersonByUser(conn, id_user) {
    const r = await conn.query(`${PROFESSIONAL_SELECT} WHERE u.id_user = $1 LIMIT 1`, [id_user]);
    return r.rows[0] || null;
  }

  static async exists(conn, id_community, id_user) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_community_professional
        WHERE id_profile = $1 AND id_user = $2 LIMIT 1`,
      [id_community, id_user]
    );
    return r.rowCount > 0;
  }

  /**
   * Promove. Idempotente de propósito: dois cliques no mesmo @username são a
   * mesma intenção, não um erro a mostrar para o líder.
   */
  static async add(conn, id_community, id_user, granted_by) {
    await conn.query(
      `INSERT INTO public.tb_community_professional (id_profile, id_user, granted_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (id_profile, id_user) DO NOTHING`,
      [id_community, id_user, granted_by || null]
    );
  }

  static async remove(conn, id_community, id_user) {
    await conn.query(
      `DELETE FROM public.tb_community_professional
        WHERE id_profile = $1 AND id_user = $2`,
      [id_community, id_user]
    );
  }

  /** Busca por @username, para o campo de promover. */
  static async findUserByUsername(conn, username) {
    const r = await conn.query(
      `SELECT id_user, username, nome FROM public.tb_user
        WHERE LOWER(username) = LOWER($1) LIMIT 1`,
      [String(username || "").trim().replace(/^@/, "")]
    );
    return r.rows[0] || null;
  }
}

module.exports = CommunityProfessionalStorage;
