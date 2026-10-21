// src/storages/MeuMundoVehicleStorage.js — MEU MUNDO 3D: onde ficam os veículos (mig 299).
//
// Só SQL. Quem decide onde um veículo pode ficar é a sala (src/realtime/
// meuMundo.js) e o MeuMundoService; aqui só se lê e grava a última posição.
// Sem linha = na vaga da casa (meuMundoCars.spotFor).

const COLS = `vehicle_id, x, z, facing, id_house, floor, layout`;

function toRow(r) {
  return {
    id: Number(r.vehicle_id),
    x: Number(r.x),
    z: Number(r.z),
    facing: Number(r.facing),
    houseId: r.id_house || null,
    floor: Number(r.floor) || 0,
    layout: Number(r.layout),
  };
}

class MeuMundoVehicleStorage {
  /** Todos os veículos do bairro que já saíram da vaga (rua ou dentro de casa). */
  static async listByNeighborhood(db, idNeighborhood) {
    const r = await db.query(`SELECT ${COLS} FROM tb_mm_vehicle WHERE id_neighborhood = $1`, [idNeighborhood]);
    return r.rows.map(toRow);
  }

  /** Os guardados dentro de uma casa. */
  static async listInHouse(db, idHouse) {
    const r = await db.query(`SELECT ${COLS} FROM tb_mm_vehicle WHERE id_house = $1`, [idHouse]);
    return r.rows.map(toRow);
  }

  static async get(db, idNeighborhood, vehicleId) {
    const r = await db.query(`SELECT ${COLS} FROM tb_mm_vehicle WHERE id_neighborhood = $1 AND vehicle_id = $2`, [
      idNeighborhood,
      vehicleId,
    ]);
    return r.rows[0] ? toRow(r.rows[0]) : null;
  }

  /** Grava a posição (`houseId` null = na rua). */
  static async save(db, idNeighborhood, vehicleId, { x, z, facing, houseId = null, floor = 0, layout }) {
    await db.query(
      `INSERT INTO tb_mm_vehicle (id_neighborhood, vehicle_id, x, z, facing, id_house, floor, layout)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id_neighborhood, vehicle_id) DO UPDATE
         SET x = EXCLUDED.x, z = EXCLUDED.z, facing = EXCLUDED.facing, id_house = EXCLUDED.id_house,
             floor = EXCLUDED.floor, layout = EXCLUDED.layout, updated_at = NOW()`,
      [idNeighborhood, vehicleId, x, z, facing, houseId, floor, layout]
    );
  }
}

module.exports = MeuMundoVehicleStorage;
