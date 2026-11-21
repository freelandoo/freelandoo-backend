// src/storages/MeuMundoLastPlaceStorage.js — MEU MUNDO 3D: o último lugar de cada pessoa (mig 463).
//
// Só SQL. Quem decide quando gravar e o que vale na volta é realtime/meuMundoLastPlace.js (fila) e as salas.

const NUM = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function rowToPlace(r) {
  if (!r) return null;
  return {
    scene: r.scene,
    nbId: r.id_neighborhood || null,
    houseId: r.id_house || null,
    x: NUM(r.x),
    z: NUM(r.z),
    facing: NUM(r.facing),
    floor: NUM(r.floor),
    layout: NUM(r.layout),
    at: r.updated_at ? new Date(r.updated_at).getTime() : 0,
  };
}

async function get(db, idUser) {
  const { rows } = await db.query(
    `SELECT scene, id_neighborhood, id_house, x, z, facing, floor, layout, updated_at FROM tb_mm_last_place WHERE id_user = $1`,
    [idUser]
  );
  return rowToPlace(rows[0]);
}

/** Grava várias de uma vez (a última de cada pessoa). Conta que não existe é ignorada. */
async function saveMany(db, list) {
  if (!list.length) return 0;
  const cols = { u: [], s: [], n: [], h: [], x: [], z: [], f: [], fl: [], l: [] };
  for (const [idUser, p] of list) {
    cols.u.push(idUser);
    cols.s.push(p.scene);
    cols.n.push(p.nbId || null);
    cols.h.push(p.houseId || null);
    cols.x.push(NUM(p.x));
    cols.z.push(NUM(p.z));
    cols.f.push(NUM(p.facing));
    cols.fl.push(Math.trunc(NUM(p.floor)));
    cols.l.push(Math.trunc(NUM(p.layout)));
  }
  const { rowCount } = await db.query(
    `INSERT INTO tb_mm_last_place (id_user, scene, id_neighborhood, id_house, x, z, facing, floor, layout, updated_at)
     SELECT v.u, v.s, v.n, v.h, v.x, v.z, v.f, v.fl, v.l, NOW()
       FROM unnest($1::uuid[], $2::text[], $3::uuid[], $4::uuid[], $5::real[], $6::real[], $7::real[], $8::smallint[], $9::int[])
            AS v(u, s, n, h, x, z, f, fl, l)
       JOIN tb_user tu ON tu.id_user = v.u
     ON CONFLICT (id_user) DO UPDATE SET
       scene = EXCLUDED.scene, id_neighborhood = EXCLUDED.id_neighborhood, id_house = EXCLUDED.id_house,
       x = EXCLUDED.x, z = EXCLUDED.z, facing = EXCLUDED.facing, floor = EXCLUDED.floor, layout = EXCLUDED.layout,
       updated_at = NOW()`,
    [cols.u, cols.s, cols.n, cols.h, cols.x, cols.z, cols.f, cols.fl, cols.l]
  );
  return rowCount;
}

module.exports = { get, saveMany };
