// src/storages/NeedsStorage.js
// As chaves "Preciso de emprego" / "Preciso pagar dívidas" (A2, mig 338) e a
// aba Empregos das comunidades (A4).
//
// ⚠️ O ALCANCE SÓ ORDENA, NUNCA ESCONDE (regra do A1): todo mundo com a chave
// ligada aparece; `geo_tiers` (mig 336) só decide a ordem — mesma cidade,
// área, região, estado, Brasil. Espelho JS em utils/vitrine.js (proximityRank).

const { proximitySql } = require("../utils/vitrine");

class NeedsStorage {
  static async get(conn, id_user) {
    const r = await conn.query(
      `SELECT u.needs_job, u.needs_job_at, u.job_pitch, u.needs_debt_help, u.needs_debt_help_at,
              (u.cpf IS NOT NULL) AS has_cpf,
              EXTRACT(YEAR FROM AGE(CURRENT_DATE, u.data_nascimento))::int AS age
         FROM public.tb_user u
        WHERE u.id_user = $1`,
      [id_user]
    );
    return r.rows[0] || null;
  }

  static async update(conn, id_user, { needs_job, job_pitch, needs_debt_help }) {
    const r = await conn.query(
      `UPDATE public.tb_user
          SET needs_job = COALESCE($2, needs_job),
              needs_job_at = CASE
                WHEN $2 IS TRUE AND needs_job = FALSE THEN NOW()
                WHEN $2 IS FALSE THEN NULL
                ELSE needs_job_at END,
              job_pitch = CASE WHEN $3::boolean THEN $4 ELSE job_pitch END,
              needs_debt_help = COALESCE($5, needs_debt_help),
              needs_debt_help_at = CASE
                WHEN $5 IS TRUE AND needs_debt_help = FALSE THEN NOW()
                WHEN $5 IS FALSE THEN NULL
                ELSE needs_debt_help_at END,
              updated_at = NOW()
        WHERE id_user = $1
        RETURNING needs_job, needs_job_at, job_pitch, needs_debt_help, needs_debt_help_at`,
      [
        id_user,
        typeof needs_job === "boolean" ? needs_job : null,
        job_pitch !== undefined,
        job_pitch ?? null,
        typeof needs_debt_help === "boolean" ? needs_debt_help : null,
      ]
    );
    return r.rows[0] || null;
  }

  /**
   * A aba Empregos. `id_community` + `participantsOnly` recorta pelos
   * participantes (membro ou líder); sem isso, Brasil todo.
   * Projeção pública campo a campo: perfil-conta, nome, foto, profissão,
   * cidade/UF e o texto que a pessoa escreveu. Nada de CPF, e-mail, telefone.
   */
  static async listJobSeekers(conn, { viewer, id_community = null, participantsOnly = false, limit = 30, offset = 0 }) {
    const vals = [viewer || null, Math.min(60, Math.max(1, Number(limit) || 30)), Math.max(0, Number(offset) || 0)];
    let scope = "";
    if (id_community && participantsOnly) {
      vals.push(id_community);
      scope = `AND (
        EXISTS (SELECT 1 FROM public.tb_community_member m
                 WHERE m.id_community_profile = $${vals.length} AND m.id_user = u.id_user)
        OR EXISTS (SELECT 1 FROM public.tb_profile cp
                    WHERE cp.id_profile = $${vals.length} AND cp.id_leader_user = u.id_user)
      )`;
    }
    const r = await conn.query(
      `WITH vp AS (
         SELECT id_profile FROM public.tb_profile
          WHERE id_user = $1 AND is_user_account = TRUE AND deleted_at IS NULL
          LIMIT 1
       ),
       v AS (
         SELECT g.* FROM vp CROSS JOIN LATERAL geo_tiers(vp.id_profile) g
       )
       SELECT acc.id_profile, acc.display_name, acc.avatar_url, u.username,
              u.job_pitch, u.needs_job_at,
              cat.desc_category AS profession,
              c.city_name, c.uf,
              (u.id_user = $1) AS mine,
              ${proximitySql("vv", "c")} AS proximity
         FROM public.tb_user u
         JOIN public.tb_profile acc
           ON acc.id_user = u.id_user AND acc.is_user_account = TRUE AND acc.deleted_at IS NULL
         LEFT JOIN public.tb_category cat ON cat.id_category = acc.id_category
         CROSS JOIN LATERAL geo_tiers(acc.id_profile) c
         LEFT JOIN v vv ON TRUE
        WHERE u.needs_job = TRUE
          ${scope}
        ORDER BY proximity DESC, u.needs_job_at DESC NULLS LAST, acc.id_profile
        LIMIT $2 OFFSET $3`,
      vals
    );
    return r.rows;
  }
}

module.exports = NeedsStorage;
