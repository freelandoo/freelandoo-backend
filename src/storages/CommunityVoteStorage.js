// src/storages/CommunityVoteStorage.js
// SQL da votação de liderança. "Nível do user" = subperfil de maior xp_level.

class CommunityVoteStorage {
  // Desafiante = membro (não-líder) de maior nível, desde que > nível do líder.
  // Retorna { id_user, lvl } ou null.
  static async findChallenger(conn, id_community) {
    const r = await conn.query(
      `WITH leader AS (
         SELECT m.id_user,
                (SELECT COALESCE(MAX(p.xp_level), 0) FROM public.tb_profile p
                  WHERE p.id_user = m.id_user AND p.is_clan = FALSE
                    AND p.is_community = FALSE AND p.deleted_at IS NULL) AS lvl
           FROM public.tb_community_member m
          WHERE m.id_community_profile = $1 AND m.role = 'leader'
          LIMIT 1
       ),
       members AS (
         SELECT m.id_user,
                (SELECT COALESCE(MAX(p.xp_level), 0) FROM public.tb_profile p
                  WHERE p.id_user = m.id_user AND p.is_clan = FALSE
                    AND p.is_community = FALSE AND p.deleted_at IS NULL) AS lvl
           FROM public.tb_community_member m
          WHERE m.id_community_profile = $1 AND m.role <> 'leader'
       )
       SELECT mm.id_user, mm.lvl
         FROM members mm, leader l
        WHERE mm.lvl > l.lvl
        ORDER BY mm.lvl DESC
        LIMIT 1`,
      [id_community]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getLeaderUser(conn, id_community) {
    const r = await conn.query(
      `SELECT id_user FROM public.tb_community_member
        WHERE id_community_profile = $1 AND role = 'leader' LIMIT 1`,
      [id_community]
    );
    return r.rowCount ? r.rows[0].id_user : null;
  }

  static async hasOpenVote(conn, id_community) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_community_leadership_vote
        WHERE id_community = $1 AND status = 'open' LIMIT 1`,
      [id_community]
    );
    return r.rowCount > 0;
  }

  static async createVote(conn, { id_community, id_leader_user, id_challenger_user, days = 7 }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_leadership_vote
         (id_community, id_leader_user, id_challenger_user, closes_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' days')::interval)
       ON CONFLICT DO NOTHING
       RETURNING id_vote`,
      [id_community, id_leader_user, id_challenger_user, String(days)]
    );
    return r.rowCount ? r.rows[0].id_vote : null;
  }

  // Votos abertos das comunidades em que o user é membro e AINDA não votou.
  static async listPendingForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT v.id_vote, v.id_community, v.closes_at,
              c.display_name AS community_name, c.community_theme,
              lu.nome AS leader_name, lu.username AS leader_username,
              lp.avatar_url AS leader_avatar, lp.xp_level AS leader_level,
              cu.nome AS challenger_name, cu.username AS challenger_username,
              cp.avatar_url AS challenger_avatar, cp.xp_level AS challenger_level
         FROM public.tb_community_leadership_vote v
         JOIN public.tb_community_member me
           ON me.id_community_profile = v.id_community AND me.id_user = $1
         JOIN public.tb_profile c ON c.id_profile = v.id_community
         JOIN public.tb_user lu ON lu.id_user = v.id_leader_user
         JOIN public.tb_user cu ON cu.id_user = v.id_challenger_user
         LEFT JOIN LATERAL (
           SELECT avatar_url, xp_level FROM public.tb_profile
            WHERE id_user = v.id_leader_user AND is_clan = FALSE
              AND is_community = FALSE AND deleted_at IS NULL
            ORDER BY xp_total DESC LIMIT 1
         ) lp ON TRUE
         LEFT JOIN LATERAL (
           SELECT avatar_url, xp_level FROM public.tb_profile
            WHERE id_user = v.id_challenger_user AND is_clan = FALSE
              AND is_community = FALSE AND deleted_at IS NULL
            ORDER BY xp_total DESC LIMIT 1
         ) cp ON TRUE
        WHERE v.status = 'open'
          AND NOT EXISTS (
            SELECT 1 FROM public.tb_community_vote_ballot b
             WHERE b.id_vote = v.id_vote AND b.id_user = $1
          )
        ORDER BY v.closes_at ASC`,
      [id_user]
    );
    return r.rows;
  }

  static async getOpenVoteById(conn, id_vote) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_leadership_vote
        WHERE id_vote = $1 AND status = 'open' LIMIT 1`,
      [id_vote]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async isMember(conn, id_community, id_user) {
    const r = await conn.query(
      `SELECT 1 FROM public.tb_community_member
        WHERE id_community_profile = $1 AND id_user = $2 LIMIT 1`,
      [id_community, id_user]
    );
    return r.rowCount > 0;
  }

  static async castBallot(conn, { id_vote, id_user, choice }) {
    const r = await conn.query(
      `INSERT INTO public.tb_community_vote_ballot (id_vote, id_user, choice)
         VALUES ($1, $2, $3)
       ON CONFLICT (id_vote, id_user) DO NOTHING
       RETURNING id_vote`,
      [id_vote, id_user, choice]
    );
    return r.rowCount > 0;
  }

  static async listDueVotes(conn) {
    const r = await conn.query(
      `SELECT * FROM public.tb_community_leadership_vote
        WHERE status = 'open' AND closes_at <= NOW()`
    );
    return r.rows;
  }

  static async tally(conn, id_vote) {
    const r = await conn.query(
      `SELECT choice, COUNT(*)::int AS n
         FROM public.tb_community_vote_ballot
        WHERE id_vote = $1
        GROUP BY choice`,
      [id_vote]
    );
    const out = { leader: 0, challenger: 0 };
    for (const row of r.rows) out[row.choice] = row.n;
    return out;
  }

  static async closeVote(conn, id_vote, result) {
    await conn.query(
      `UPDATE public.tb_community_leadership_vote
          SET status = 'closed', result = $2, resolved_at = NOW()
        WHERE id_vote = $1`,
      [id_vote, result]
    );
  }

  // Troca de liderança: líder atual → vice, desafiante → líder. A ordem evita
  // violar o índice de "1 líder por comunidade" (primeiro rebaixa, depois promove).
  static async applyLeadershipChange(conn, { id_community, old_leader_user, new_leader_user }) {
    await conn.query(
      `UPDATE public.tb_community_member SET role = 'vice'
        WHERE id_community_profile = $1 AND id_user = $2`,
      [id_community, old_leader_user]
    );
    await conn.query(
      `UPDATE public.tb_community_member SET role = 'leader'
        WHERE id_community_profile = $1 AND id_user = $2`,
      [id_community, new_leader_user]
    );
    await conn.query(
      `UPDATE public.tb_profile SET id_leader_user = $2, updated_at = NOW()
        WHERE id_profile = $1 AND is_community = TRUE`,
      [id_community, new_leader_user]
    );
  }
}

module.exports = CommunityVoteStorage;
