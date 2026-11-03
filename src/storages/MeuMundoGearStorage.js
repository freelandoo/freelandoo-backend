// src/storages/MeuMundoGearStorage.js — MEU MUNDO 3D mm3d-59 (mig 321): posse e equipamento.
// Só SQL. Quem chama está dentro de `withLife` (advisory lock da pessoa).

class MeuMundoGearStorage {
  /** { item_id: { qty, level } } */
  static async owned(c, idUser) {
    const r = await c.query(`SELECT item_id, qty, level, refine_failures, version FROM tb_mm_gear WHERE id_user = $1 AND qty > 0`, [idUser]);
    return Object.fromEntries(r.rows.map((x) => [x.item_id, { qty: x.qty, level: x.level, refineFailures: x.refine_failures, version: Number(x.version) }]));
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
       ON CONFLICT (id_user, item_id) DO UPDATE SET qty = LEAST($4, tb_mm_gear.qty + $3), version = tb_mm_gear.version + 1
       WHERE tb_mm_gear.qty + $3 >= 0
       RETURNING qty`,
      [idUser, itemId, n, max]
    );
    return r.rows[0] ? r.rows[0].qty : null;
  }

  static async setLevel(c, idUser, itemId, level) {
    await c.query(`UPDATE tb_mm_gear SET level = $3, version = version + 1 WHERE id_user = $1 AND item_id = $2`, [idUser, itemId, level]);
  }

  static async setRefineFailures(c, idUser, itemId, failures) {
    const r = await c.query(`UPDATE tb_mm_gear SET refine_failures = $3, version = version + 1 WHERE id_user = $1 AND item_id = $2 AND qty > 0 RETURNING version`, [idUser, itemId, failures]);
    return r.rows[0] ? Number(r.rows[0].version) : null;
  }

  static async lockItem(c, idUser, itemId) {
    const r = await c.query(`SELECT qty, level, refine_failures, version FROM tb_mm_gear WHERE id_user = $1 AND item_id = $2 FOR UPDATE`, [idUser, itemId]);
    const x = r.rows[0];
    return x ? { qty: x.qty, level: x.level, refineFailures: x.refine_failures, version: Number(x.version) } : null;
  }

  static async expireProposals(c, idUser, now) {
    await c.query(`UPDATE tb_mm_refine_proposal SET status = 'expired', resolved_at = to_timestamp($2 / 1000.0) WHERE id_user = $1 AND status = 'pending' AND expires_at <= to_timestamp($2 / 1000.0)`, [idUser, now]);
  }

  static async pendingProposals(c, idUser, now) {
    const r = await c.query(`SELECT * FROM tb_mm_refine_proposal WHERE id_user = $1 AND status = 'pending' AND expires_at > to_timestamp($2 / 1000.0) ORDER BY created_at`, [idUser, now]);
    return r.rows;
  }

  static async findProposalByKey(c, idUser, key) {
    const r = await c.query(`SELECT * FROM tb_mm_refine_proposal WHERE id_user = $1 AND create_key = $2 FOR UPDATE`, [idUser, key]);
    return r.rows[0] || null;
  }

  static async findResolutionByKey(c, idUser, key) {
    const r = await c.query(`SELECT * FROM tb_mm_refine_proposal WHERE id_user = $1 AND resolve_key = $2 FOR UPDATE`, [idUser, key]);
    return r.rows[0] || null;
  }

  static async lockProposal(c, idUser, id) {
    const r = await c.query(`SELECT * FROM tb_mm_refine_proposal WHERE id_user = $1 AND id_proposal = $2 FOR UPDATE`, [idUser, id]);
    return r.rows[0] || null;
  }

  static async insertProposal(c, p) {
    const r = await c.query(`INSERT INTO tb_mm_refine_proposal
      (id_proposal, id_user, item_id, create_key, request_hash, rules_version, item_version, from_level, candidate_level, snapshot, created_at, expires_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11 / 1000.0),to_timestamp($12 / 1000.0)) RETURNING *`,
    [p.id, p.idUser, p.item, p.key, p.requestHash, p.rules, p.version, p.fromLevel, p.candidateLevel, JSON.stringify(p.snapshot), p.now, p.expiresAt]);
    return r.rows[0];
  }

  static async attachProposalReceipt(c, idUser, id, receipt) {
    await c.query(`UPDATE tb_mm_refine_proposal SET create_receipt = $3 WHERE id_user = $1 AND id_proposal = $2`, [idUser, id, receipt]);
  }

  static async resolveProposal(c, idUser, id, status, key, receipt, now) {
    const r = await c.query(`UPDATE tb_mm_refine_proposal SET status = $3, resolve_key = $4, resolve_receipt = $5, resolved_at = to_timestamp($6 / 1000.0)
      WHERE id_user = $1 AND id_proposal = $2 AND status = 'pending' RETURNING *`, [idUser, id, status, key, receipt, now]);
    return r.rows[0] || null;
  }

  static async receipt(c, idUser, id) {
    if (!id) return null;
    const r = await c.query(`SELECT * FROM tb_mm_receipt WHERE id_user = $1 AND id_receipt = $2`, [idUser, id]);
    return require('./MeuMundoAdventureStorage').receiptOut(r.rows[0]);
  }

  static async accountReceipt(c, idUser, source, key) {
    const r = await c.query(`SELECT * FROM tb_mm_receipt WHERE id_user = $1 AND source = $2 AND action_key = $3 ORDER BY created_at LIMIT 1`, [idUser, source, key]);
    return require('./MeuMundoAdventureStorage').receiptOut(r.rows[0]);
  }

  static async unlocks(c, idUser) {
    const r = await c.query(`SELECT item_id, kind, active FROM tb_mm_gear_unlock WHERE id_user = $1 ORDER BY item_id`, [idUser]);
    return r.rows;
  }

  static async unlock(c, idUser, itemId, kind, active = false) {
    if (kind === 'cosmetic' && active) await c.query(`UPDATE tb_mm_gear_unlock SET active = FALSE WHERE id_user = $1 AND kind = 'cosmetic' AND active`, [idUser]);
    await c.query(`INSERT INTO tb_mm_gear_unlock (id_user, item_id, kind, active) VALUES ($1,$2,$3,$4)
      ON CONFLICT (id_user, item_id) DO UPDATE SET active = EXCLUDED.active`, [idUser, itemId, kind, active]);
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
