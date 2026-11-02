// src/storages/MeuMundoGearStorage.js — MEU MUNDO 3D mm3d-59 (mig 321): posse e equipamento.
// Só SQL. Quem chama está dentro de `withLife` (advisory lock da pessoa).

class MeuMundoGearStorage {
  /** { item_id: { qty, level } } */
  static async owned(c, idUser) {
    const r = await c.query(`SELECT item_id, qty, level FROM tb_mm_gear WHERE id_user = $1 AND qty > 0`, [idUser]);
    return Object.fromEntries(r.rows.map((x) => [x.item_id, { qty: x.qty, level: x.level }]));
  }

  /** { slot: item_id } */
  static async equipped(c, idUser) {
    const r = await c.query(`SELECT slot, item_id FROM tb_mm_equip WHERE id_user = $1`, [idUser]);
    return Object.fromEntries(r.rows.map((x) => [x.slot, x.item_id]));
  }

  /** Soma `n` (pode ser negativo). Devolve a quantidade nova ou null se ficaria < 0. */
  static async add(c, idUser, itemId, n, max = 999) {
    const r = await c.query(
      `INSERT INTO tb_mm_gear (id_user, item_id, qty) VALUES ($1, $2, LEAST($4, GREATEST(0, $3)))
       ON CONFLICT (id_user, item_id) DO UPDATE SET qty = LEAST($4, tb_mm_gear.qty + $3)
       WHERE tb_mm_gear.qty + $3 >= 0
       RETURNING qty`,
      [idUser, itemId, n, max]
    );
    return r.rows[0] ? r.rows[0].qty : null;
  }

  static async setLevel(c, idUser, itemId, level) {
    await c.query(`UPDATE tb_mm_gear SET level = $3 WHERE id_user = $1 AND item_id = $2`, [idUser, itemId, level]);
  }

  static async equip(c, idUser, slot, itemId) {
    await c.query(
      `INSERT INTO tb_mm_equip (id_user, slot, item_id) VALUES ($1, $2, $3)
       ON CONFLICT (id_user, slot) DO UPDATE SET item_id = $3, updated_at = NOW()`,
      [idUser, slot, itemId]
    );
  }

  static async unequip(c, idUser, slot) {
    await c.query(`DELETE FROM tb_mm_equip WHERE id_user = $1 AND slot = $2`, [idUser, slot]);
  }
}

module.exports = MeuMundoGearStorage;
