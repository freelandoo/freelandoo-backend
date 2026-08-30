// src/utils/condoResidentSql.js
//
// FONTE ÚNICA do predicado "morador deste condomínio" em SQL.
//
// Existe porque a mig 205 mudou de lugar a resposta para "quem mora aqui?":
//
//   antes  tb_condo_unit.id_holder_user = $user   (um titular por unidade)
//   agora  tb_residence_member, alcançado pelo ENDEREÇO do condomínio
//          (tb_address.id_condo_profile), com N moradores por unidade
//
// Esse predicado estava escrito à mão em cinco lugares — entrega de aviso
// direcionado, fila de enquete, universo de votantes, situação do morador,
// lista de vizinhos. Cada cópia é uma chance de alguém esquecer metade dele, e
// as duas metades importam:
//
//   status = 'recognized'  →  pendente e contestado NÃO votam nem publicam
//   ended_at IS NULL       →  quem saiu não é morador fantasma com voto
//
// Foi exatamente assim que os vazamentos C2/C3 do desenho territorial
// nasceram: guard replicado, uma cópia desatualizada. Aqui o predicado é um
// só; quem precisar dele importa, não reescreve.

/**
 * Existe um vínculo VIVO e RECONHECIDO deste usuário neste condomínio?
 *
 * Uso: `EXISTS (${residentExistsSql("$1", "$2")})`, onde o primeiro parâmetro é
 * o id do condomínio (uuid) e o segundo o id do usuário.
 */
function residentExistsSql(condoParam, userParam) {
  return `SELECT 1
            FROM public.tb_residence_member rm_r
            JOIN public.tb_residence_unit ru_r ON ru_r.id_unit = rm_r.id_unit
            JOIN public.tb_address a_r ON a_r.id_address = ru_r.id_address
           WHERE a_r.id_condo_profile = ${condoParam}
             AND rm_r.id_user = ${userParam}
             AND rm_r.status = 'recognized'
             AND rm_r.ended_at IS NULL`;
}

/**
 * Os ids das unidades em que este usuário mora, neste condomínio. Usado para
 * decidir se um aviso direcionado a um apartamento é para ele.
 */
function residentUnitIdsSql(condoParam, userParam) {
  return `SELECT rm_u.id_unit
            FROM public.tb_residence_member rm_u
            JOIN public.tb_residence_unit ru_u ON ru_u.id_unit = rm_u.id_unit
            JOIN public.tb_address a_u ON a_u.id_address = ru_u.id_address
           WHERE a_u.id_condo_profile = ${condoParam}
             AND rm_u.id_user = ${userParam}
             AND rm_u.status = 'recognized'
             AND rm_u.ended_at IS NULL`;
}

/**
 * Todos os moradores do condomínio (ids de usuário, sem repetir quem tem mais
 * de uma unidade). Universo elegível de enquete e destinatários de aviso geral.
 */
function residentUserIdsSql(condoParam) {
  return `SELECT DISTINCT rm_a.id_user
            FROM public.tb_residence_member rm_a
            JOIN public.tb_residence_unit ru_a ON ru_a.id_unit = rm_a.id_unit
            JOIN public.tb_address a_a ON a_a.id_address = ru_a.id_address
           WHERE a_a.id_condo_profile = ${condoParam}
             AND rm_a.status = 'recognized'
             AND rm_a.ended_at IS NULL`;
}

module.exports = {
  residentExistsSql,
  residentUnitIdsSql,
  residentUserIdsSql,
};
