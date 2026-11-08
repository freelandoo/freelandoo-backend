// src/utils/categoryMinAge.js
//
// Idade mínima por ENXAME (tb_machine.min_age, mig 338). A regra de verdade é
// o trigger `trg_profile_category_min_age` no banco — vale para toda porta que
// grava profissão. Este helper só dá a RECUSA AMIGÁVEL antes do INSERT/UPDATE,
// para a pessoa ler um motivo em vez de um erro 500 do trigger.
//
// Hoje: "Trabalhos fora do comum" (A3) é só para maiores de 18.

async function categoryMinAgeError(conn, { id_category, id_user, age }) {
  if (!id_category) return null;
  const r = await conn.query(
    `SELECT m.min_age, m.name
       FROM public.tb_category c
       JOIN public.tb_machine m ON m.id_machine = c.id_machine
      WHERE c.id_category = $1`,
    [id_category]
  );
  const min = r.rows[0]?.min_age;
  if (min == null) return null;
  let years = age;
  if (years === undefined && id_user) {
    const u = await conn.query(
      `SELECT EXTRACT(YEAR FROM AGE(CURRENT_DATE, data_nascimento))::int AS age
         FROM public.tb_user WHERE id_user = $1`,
      [id_user]
    );
    years = u.rows[0]?.age;
  }
  if (years == null || Number(years) < Number(min)) {
    return {
      error: `Esta profissão é só para maiores de ${min} anos.`,
      statusCode: 403,
      reason: "category_min_age",
    };
  }
  return null;
}

module.exports = { categoryMinAgeError };
