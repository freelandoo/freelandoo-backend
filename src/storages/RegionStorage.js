// src/storages/RegionStorage.js
// Regiões agregadas (Estado → Região → Cidade). A vitrine filtra por região.
module.exports = {
  // Regiões ativas de um estado, na ordem de exibição.
  async listByUf(db, uf) {
    const { rows } = await db.query(
      `SELECT id_region, uf, name, sort_order
         FROM public.tb_region
        WHERE uf = $1 AND is_active = TRUE
        ORDER BY sort_order, name`,
      [uf]
    );
    return rows;
  },
};
