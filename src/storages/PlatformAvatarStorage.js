// src/storages/PlatformAvatarStorage.js
//
// A FOTO DE ALGUÉM DENTRO DE UMA PLATAFORMA (mig 233).
//
// Pedido do Alex (2026-09-09): "a foto de perfil você vai puxar do perfil
// principal, sempre. Mas, se a pessoa quiser alterar, ela altera e só altera o
// games. Assim também precisa ser no financeiro."
//
// ⚠️ AUSÊNCIA DE LINHA NÃO É "SEM FOTO": é "usa o rosto de sempre". Toda
// leitura daqui é um COALESCE com `tb_user.avatar` — e é isso que faz a
// herança continuar valendo depois, quando a pessoa troca a foto principal sem
// nunca ter mexido na da plataforma.
//
// ⚠️ E POR ISSO "VOLTAR A USAR A MINHA FOTO" É `remove`, e não gravar vazio.
// Um NULL guardado seria um segundo jeito de dizer a mesma coisa, e a leitura
// teria de conhecer os dois.

const { assertPlatformKind } = require("../utils/gamesScore");

/**
 * A URL do override, ou null. `kind` passa pela lista fechada de
 * `utils/gamesScore` — a MESMA do CHECK da tabela.
 */
async function get(conn, id_user, kind) {
  assertPlatformKind(kind, "PlatformAvatarStorage.get");
  const { rows } = await conn.query(
    `SELECT avatar_url
       FROM public.tb_user_platform_avatar
      WHERE id_user = $1 AND kind = $2`,
    [id_user, kind]
  );
  return rows[0]?.avatar_url || null;
}

/**
 * A foto de VÁRIAS pessoas de uma vez, para uma plataforma.
 *
 * Existe por causa das filas: o ranking devolve dezenas de linhas, e perguntar
 * a foto de cada uma seria uma consulta por pessoa. Devolve um Map — quem não
 * está nele nunca trocou nada e fica com o rosto de sempre.
 */
async function mapFor(conn, ids, kind) {
  assertPlatformKind(kind, "PlatformAvatarStorage.mapFor");
  const list = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!list.length) return new Map();
  const { rows } = await conn.query(
    `SELECT id_user, avatar_url
       FROM public.tb_user_platform_avatar
      WHERE kind = $1 AND id_user = ANY($2::uuid[])`,
    [kind, list]
  );
  return new Map(rows.map((r) => [String(r.id_user), r.avatar_url]));
}

/** Grava (ou troca) a foto da pessoa naquela plataforma. */
async function set(conn, id_user, kind, avatar_url) {
  assertPlatformKind(kind, "PlatformAvatarStorage.set");
  const { rows } = await conn.query(
    `INSERT INTO public.tb_user_platform_avatar (id_user, kind, avatar_url)
          VALUES ($1, $2, $3)
     ON CONFLICT (id_user, kind)
     DO UPDATE SET avatar_url = EXCLUDED.avatar_url, updated_at = NOW()
       RETURNING avatar_url`,
    [id_user, kind, avatar_url]
  );
  return rows[0]?.avatar_url || null;
}

/** Volta a herdar o rosto da pessoa. Devolve se havia o que apagar. */
async function remove(conn, id_user, kind) {
  assertPlatformKind(kind, "PlatformAvatarStorage.remove");
  const { rowCount } = await conn.query(
    `DELETE FROM public.tb_user_platform_avatar
      WHERE id_user = $1 AND kind = $2`,
    [id_user, kind]
  );
  return rowCount > 0;
}

module.exports = { get, mapFor, set, remove };
