/**
 * QUEM TEM O SELO VERIFICADO (mig 268) — fonte única.
 *
 * Verificado = pagou e ainda está no período (`paid_until > NOW()`) OU é
 * administrador da plataforma (decisão do Alex: "já coloque o selo nos
 * admins"). Lido no SELECT, sem job: quando o período vence, o selo some na
 * leitura seguinte.
 *
 * ⚠️ TODA PROJEÇÃO QUE MOSTRA O SELO PASSA POR AQUI. Escrito à mão em cada
 * storage, o lugar que esquecesse do ramo do admin mostraria o admin sem selo
 * numa tela e com selo na outra.
 *
 * @param {string} userIdExpr expressão SQL do id do usuário (ex.: "p.id_user").
 *   É interpolada — só passe expressão de coluna escrita no código, nunca
 *   valor vindo de requisição.
 */
function verifiedUserSql(userIdExpr) {
  if (!/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/i.test(String(userIdExpr))) {
    throw new Error(`verifiedUserSql: expressão de coluna inválida: ${userIdExpr}`);
  }
  return `(
    EXISTS (
      SELECT 1 FROM public.tb_user_verification uv_
       WHERE uv_.id_user = ${userIdExpr} AND uv_.paid_until > NOW()
    )
    OR EXISTS (
      SELECT 1 FROM public.tb_user_role ur_
        JOIN public.tb_role r_ ON r_.id_role = ur_.id_role
       WHERE ur_.id_user = ${userIdExpr}
         AND ur_.is_active = TRUE AND r_.is_active = TRUE
         AND r_.desc_role = 'Administrator'
    )
  )`;
}

module.exports = { verifiedUserSql };
