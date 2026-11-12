// src/storages/MeuMundoGearStorage.js — MEU MUNDO 3D mm3d-59 (mig 321): posse e equipamento.
// Só SQL. Quem chama está dentro de `withLife` (advisory lock da pessoa).
//
// Trilha E, fatia E2 (mig 446): equipamento é INSTÂNCIA (tb_mm_gear_instance, cada uma com o seu
// `plus`), equipado é por PERSONAGEM (tb_mm_loadout); pilha (tb_mm_gear) só para o que empilha,
// com livro (tb_mm_item_ledger). A passagem é preguiçosa: `materialize`. `owned` e `equipped`
// continuam com a forma de antes (quem lê: missões, Domínio, mochila antiga), agora somando
// pilha + instâncias e lendo o loadout do personagem vivo.

/** Personagem vivo da pessoa (o mesmo critério do AdventureStorage). */
const LIVE = `(SELECT id_character FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ORDER BY born_at DESC LIMIT 1)`;
/** Loadouts que SEGURAM uma instância: personagem vivo ou na cápsula (morto não segura). */
const HOLDERS = `SELECT l.id_instance, l.id_character, l.slot FROM tb_mm_loadout l JOIN tb_mm_character ch ON ch.id_character = l.id_character
  WHERE ch.id_user = $1 AND ch.status IN ('alive', 'capsule')`;

const instOut = (x) => x && ({
  id: x.id_instance, item: x.item_id, plus: x.plus, grade: x.grade, ascended: x.ascended, awakened: x.awakened,
  sockets: x.sockets || [], locked: x.locked, refineFailures: x.refine_failures, version: Number(x.version),
  rules: x.rules, origin: x.origin,
  equippedBy: x.equipped_by || null, equippedSlot: x.equipped_slot || null,
});

class MeuMundoGearStorage {
  /**
   * { item_id: { qty, level, refineFailures, version, instance? } } — pilha + instâncias.
   * Equipamento: qty = nº de instâncias; level/version/refineFailures são da instância
   * REPRESENTANTE (a equipada pelo vivo; senão a de maior `plus`), a mesma que o pedido antigo
   * sem `instance` mexe. Linha antiga ainda não materializada continua valendo.
   */
  static async owned(c, idUser) {
    const r = await c.query(`SELECT item_id, qty, level, refine_failures, version FROM tb_mm_gear WHERE id_user = $1 AND qty > 0`, [idUser]);
    const out = Object.fromEntries(r.rows.map((x) => [x.item_id, { qty: x.qty, level: x.level, refineFailures: x.refine_failures, version: Number(x.version) }]));
    for (const [item, list] of Object.entries(await MeuMundoGearStorage.instancesByItem(c, idUser))) {
      const rep = list[0];
      const prev = out[item];
      out[item] = { qty: list.length + (prev ? prev.qty : 0), level: rep.plus, refineFailures: rep.refineFailures, version: rep.version, instance: rep.id };
    }
    return out;
  }

  /**
   * { slot: item_id } do personagem vivo. O que ainda não virou instância (conta antes do
   * primeiro `materialize`) segue lido do tb_mm_equip como antes; o loadout manda no slot.
   */
  static async equipped(c, idUser) {
    const r = await c.query(`SELECT slot, item_id FROM tb_mm_equip WHERE id_user = $1`, [idUser]);
    const out = Object.fromEntries(r.rows.map((x) => [x.slot, x.item_id]));
    for (const [slot, x] of Object.entries(await MeuMundoGearStorage.loadoutLive(c, idUser))) out[slot] = x.item;
    return out;
  }

  // ── E2: instâncias ─────────────────────────────────────────────────────────

  /**
   * Pilha antiga → instância (uma por unidade, `level` vira `plus`, falhas e versão vão
   * junto), zera a pilha, MOVE o tb_mm_equip das peças movidas para o loadout do vivo e
   * aponta a proposta pendente para a instância. Pilha que fica pilha ganha a linha de
   * abertura no livro. Rodar de novo não faz nada (o UPDATE só pega `qty > 0`).
   * `instanceItems` = ids que viram instância (o banco não conhece categoria).
   */
  static async materialize(c, idUser, instanceItems) {
    const moved = await c.query(
      // `old` lê a pilha ANTES (RETURNING do UPDATE daria qty = 0) e trava as linhas: uma segunda
      // chamada simultânea espera e, ao reler, já vê qty = 0 — não duplica.
      `WITH old AS (
         SELECT item_id, qty, level, refine_failures, version FROM tb_mm_gear
          WHERE id_user = $1 AND qty > 0 AND item_id = ANY($2::text[])
          FOR UPDATE
       ), moved AS (
         UPDATE tb_mm_gear g SET qty = 0, version = g.version + 1
           FROM old WHERE g.id_user = $1 AND g.item_id = old.item_id
         RETURNING g.item_id
       ), made AS (
         INSERT INTO tb_mm_gear_instance (id_user, item_id, plus, refine_failures, version, origin, rules)
         SELECT $1, m.item_id, LEAST(15, GREATEST(0, m.level)), LEAST(3, GREATEST(0, m.refine_failures)), m.version, 'materialize', 'forge-v1'
           FROM old m CROSS JOIN LATERAL generate_series(1, m.qty) AS n
         RETURNING id_instance, item_id
       )
       SELECT DISTINCT ON (item_id) item_id, id_instance FROM made ORDER BY item_id, id_instance`,
      [idUser, instanceItems]
    );
    if (moved.rows.length) {
      const items = moved.rows.map((x) => x.item_id);
      const ids = moved.rows.map((x) => x.id_instance);
      await c.query(
        `INSERT INTO tb_mm_loadout (id_character, slot, id_instance)
         SELECT ${LIVE}, e.slot, m.id_instance
           FROM tb_mm_equip e JOIN unnest($2::text[], $3::uuid[]) AS m(item_id, id_instance) ON m.item_id = e.item_id
          WHERE e.id_user = $1 AND ${LIVE} IS NOT NULL
         ON CONFLICT DO NOTHING`,
        [idUser, items, ids]
      );
      // o equipado das peças movidas agora mora no loadout
      await c.query(`DELETE FROM tb_mm_equip WHERE id_user = $1 AND item_id = ANY($2::text[])`, [idUser, items]);
      await c.query(
        `UPDATE tb_mm_refine_proposal p SET id_instance = m.id_instance
           FROM unnest($2::text[], $3::uuid[]) AS m(item_id, id_instance)
          WHERE p.id_user = $1 AND p.item_id = m.item_id AND p.status = 'pending' AND p.id_instance IS NULL`,
        [idUser, items, ids]
      );
    }
    await c.query(
      `INSERT INTO tb_mm_item_ledger (id_user, item_id, delta, balance)
       SELECT g.id_user, g.item_id, g.qty, g.qty FROM tb_mm_gear g
        WHERE g.id_user = $1 AND g.qty > 0 AND NOT (g.item_id = ANY($2::text[]))
          AND NOT EXISTS (SELECT 1 FROM tb_mm_item_ledger l WHERE l.id_user = g.id_user AND l.item_id = g.item_id)`,
      [idUser, instanceItems]
    );
    return moved.rowCount;
  }

  /** Nasce +0, grau I, na regra do aprimoramento garantido (E9). Devolve o id_instance. */
  static async createInstance(c, idUser, itemId, origin = null) {
    const r = await c.query(`INSERT INTO tb_mm_gear_instance (id_user, item_id, origin, rules) VALUES ($1, $2, $3, 'forge-v2') RETURNING id_instance`, [idUser, itemId, origin]);
    return r.rows[0].id_instance;
  }

  /**
   * E9 (A2, a mesma conta da mig 448): instância ainda em forge-v1 (pilha materializada depois do
   * deploy) passa a +round(1,5 × N); passou de +10, ascendida. Rodar de novo não faz nada.
   */
  static async convertForgeV1(c, idUser) {
    const r = await c.query(
      `UPDATE tb_mm_gear_instance SET plus = LEAST(15, ROUND(plus * 1.5)), ascended = ascended OR ROUND(plus * 1.5) > 10,
              rules = 'forge-v2', version = version + 1
        WHERE id_user = $1 AND rules = 'forge-v1'`,
      [idUser]
    );
    return r.rowCount;
  }

  /** Todas as instâncias da pessoa, com quem as segura. Ordem: equipada pelo vivo, maior plus, mais antiga. */
  static async instances(c, idUser) {
    const r = await c.query(
      `SELECT i.*, h.id_character AS equipped_by, h.slot AS equipped_slot
         FROM tb_mm_gear_instance i
         LEFT JOIN (${HOLDERS}) h ON h.id_instance = i.id_instance
        WHERE i.id_user = $1
        ORDER BY i.item_id, (h.id_character = ${LIVE}) IS TRUE DESC, i.plus DESC, i.created_at, i.id_instance`,
      [idUser]
    );
    return r.rows.map(instOut);
  }

  /** { item_id: [instância, …] } na ordem de `instances` (a primeira é a representante). */
  static async instancesByItem(c, idUser) {
    const out = {};
    for (const x of await MeuMundoGearStorage.instances(c, idUser)) (out[x.item] ||= []).push(x);
    return out;
  }

  /** FOR UPDATE; null se não é da pessoa (a outra conta recebe 404). */
  static async lockInstance(c, idUser, idInstance) {
    const r = await c.query(`SELECT * FROM tb_mm_gear_instance WHERE id_user = $1 AND id_instance = $2 FOR UPDATE`, [idUser, idInstance]);
    return instOut(r.rows[0]);
  }

  static async setPlus(c, idUser, idInstance, plus) {
    await c.query(`UPDATE tb_mm_gear_instance SET plus = $3, version = version + 1 WHERE id_user = $1 AND id_instance = $2`, [idUser, idInstance, plus]);
  }

  /** E11: trava a cópia (não desmonta, não recicla). Devolve a linha nova ou null. */
  static async setLocked(c, idUser, idInstance, locked) {
    const r = await c.query(`UPDATE tb_mm_gear_instance SET locked = $3, version = version + 1 WHERE id_user = $1 AND id_instance = $2 RETURNING id_instance`, [idUser, idInstance, locked]);
    return r.rowCount === 1;
  }

  /** E13: as runas engastadas (lista de ids, na ordem dos engastes). */
  static async setSockets(c, idUser, idInstance, sockets) {
    await c.query(`UPDATE tb_mm_gear_instance SET sockets = $3::jsonb, version = version + 1 WHERE id_user = $1 AND id_instance = $2`, [idUser, idInstance, JSON.stringify(sockets)]);
  }

  /** E14: Ascensão (libera +11…+15 e um engaste). */
  static async setAscended(c, idUser, idInstance) {
    await c.query(`UPDATE tb_mm_gear_instance SET ascended = TRUE, version = version + 1 WHERE id_user = $1 AND id_instance = $2`, [idUser, idInstance]);
  }

  /** E14: Despertar (liga a passiva). */
  static async setAwakened(c, idUser, idInstance) {
    await c.query(`UPDATE tb_mm_gear_instance SET awakened = TRUE, version = version + 1 WHERE id_user = $1 AND id_instance = $2`, [idUser, idInstance]);
  }

  /** E10: grau de refinamento (I…V; CHECK da mig 446). */
  static async setGrade(c, idUser, idInstance, grade) {
    await c.query(`UPDATE tb_mm_gear_instance SET grade = $3, version = version + 1 WHERE id_user = $1 AND id_instance = $2`, [idUser, idInstance, grade]);
  }

  static async setInstanceRefineFailures(c, idUser, idInstance, failures) {
    const r = await c.query(`UPDATE tb_mm_gear_instance SET refine_failures = $3, version = version + 1 WHERE id_user = $1 AND id_instance = $2 RETURNING version`, [idUser, idInstance, failures]);
    return r.rows[0] ? Number(r.rows[0].version) : null;
  }

  static async removeInstance(c, idUser, idInstance) {
    const r = await c.query(`DELETE FROM tb_mm_gear_instance WHERE id_user = $1 AND id_instance = $2`, [idUser, idInstance]);
    return r.rowCount === 1;
  }

  /**
   * Soma `n` (pode ser negativo) na pilha e grava o livro. Devolve a quantidade nova ou null se
   * ficaria < 0 (nada gravado). O excedente acima de `max` não entra (quem chama converte).
   */
  static async addStack(c, idUser, itemId, n, idReceipt = null, max = 9999) {
    const before = await c.query(`SELECT qty FROM tb_mm_gear WHERE id_user = $1 AND item_id = $2 FOR UPDATE`, [idUser, itemId]);
    const had = before.rows[0] ? before.rows[0].qty : 0;
    const after = await MeuMundoGearStorage.add(c, idUser, itemId, n, max);
    if (after == null) return null;
    if (after !== had) {
      await c.query(`INSERT INTO tb_mm_item_ledger (id_user, item_id, delta, balance, id_receipt) VALUES ($1, $2, $3, $4, $5)`, [idUser, itemId, after - had, after, idReceipt]);
    }
    return after;
  }

  /** Último id do livro (para ligar as linhas de uma operação ao recibo dela). */
  static async ledgerMark(c, idUser) {
    const r = await c.query(`SELECT COALESCE(MAX(id), 0) AS id FROM tb_mm_item_ledger WHERE id_user = $1`, [idUser]);
    return Number(r.rows[0].id);
  }

  static async attachLedger(c, idUser, fromId, idReceipt) {
    await c.query(`UPDATE tb_mm_item_ledger SET id_receipt = $3 WHERE id_user = $1 AND id > $2 AND id_receipt IS NULL`, [idUser, fromId, idReceipt]);
  }

  /** { slot: id_instance } de um personagem. */
  static async loadout(c, idCharacter) {
    const r = await c.query(`SELECT slot, id_instance FROM tb_mm_loadout WHERE id_character = $1`, [idCharacter]);
    return Object.fromEntries(r.rows.map((x) => [x.slot, x.id_instance]));
  }

  /** { slot: { instance, item, plus } } do personagem vivo. */
  static async loadoutLive(c, idUser) {
    const r = await c.query(
      `SELECT l.slot, i.id_instance, i.item_id, i.plus, i.grade, i.sockets, i.ascended, i.awakened, i.affixes FROM tb_mm_loadout l JOIN tb_mm_gear_instance i ON i.id_instance = l.id_instance
        WHERE l.id_character = ${LIVE} AND i.id_user = $1`,
      [idUser]
    );
    return Object.fromEntries(r.rows.map((x) => [x.slot, { instance: x.id_instance, item: x.item_id, plus: x.plus, grade: x.grade, sockets: x.sockets || [], ascended: !!x.ascended, awakened: !!x.awakened, affixes: x.affixes || {} }]));
  }

  /** Põe a instância no slot do personagem; ela sai de qualquer outro slot/personagem da pessoa. */
  static async equipInstance(c, idUser, idCharacter, slot, idInstance) {
    await c.query(
      `DELETE FROM tb_mm_loadout l USING tb_mm_character ch
        WHERE l.id_instance = $2 AND ch.id_character = l.id_character AND ch.id_user = $1`,
      [idUser, idInstance]
    );
    await c.query(
      `INSERT INTO tb_mm_loadout (id_character, slot, id_instance) VALUES ($1, $2, $3)
       ON CONFLICT (id_character, slot) DO UPDATE SET id_instance = EXCLUDED.id_instance, updated_at = NOW()`,
      [idCharacter, slot, idInstance]
    );
  }

  /** E6: linhas do loadout (vivos e cápsula) ainda nos slots de antes da E6. */
  static async legacyLoadout(c, idUser, legacySlots) {
    const r = await c.query(
      `SELECT l.id_character, l.slot, l.id_instance, i.item_id FROM tb_mm_loadout l
         JOIN tb_mm_character ch ON ch.id_character = l.id_character
         JOIN tb_mm_gear_instance i ON i.id_instance = l.id_instance
        WHERE ch.id_user = $1 AND l.slot = ANY($2::text[])
        ORDER BY l.id_character, l.slot`,
      [idUser, legacySlots]
    );
    return r.rows;
  }

  /** Muda a linha de slot; se o destino já está ocupado, a linha antiga sai (a peça volta à mochila). */
  static async moveSlot(c, idCharacter, from, to) {
    const r = await c.query(
      `UPDATE tb_mm_loadout SET slot = $3, updated_at = NOW() WHERE id_character = $1 AND slot = $2
         AND NOT EXISTS (SELECT 1 FROM tb_mm_loadout x WHERE x.id_character = $1 AND x.slot = $3)`,
      [idCharacter, from, to]
    );
    if (!r.rowCount) await c.query(`DELETE FROM tb_mm_loadout WHERE id_character = $1 AND slot = $2`, [idCharacter, from]);
    return r.rowCount === 1;
  }

  /** E6: personagens (vivos e cápsula) com arma de duas mãos E algo no offhand. */
  static async twoHandedClash(c, idUser, twoHandedItems) {
    const r = await c.query(
      `SELECT w.id_character FROM tb_mm_loadout w
         JOIN tb_mm_character ch ON ch.id_character = w.id_character
         JOIN tb_mm_gear_instance i ON i.id_instance = w.id_instance
         JOIN tb_mm_loadout o ON o.id_character = w.id_character AND o.slot = 'offhand'
        WHERE ch.id_user = $1 AND w.slot = 'weapon' AND i.item_id = ANY($2::text[])`,
      [idUser, twoHandedItems]
    );
    return r.rows.map((x) => x.id_character);
  }

  static async unequipSlot(c, idCharacter, slot) {
    await c.query(`DELETE FROM tb_mm_loadout WHERE id_character = $1 AND slot = $2`, [idCharacter, slot]);
  }

  /** Soma `n` (pode ser negativo). Devolve a quantidade nova ou null se ficaria < 0. */
  static async add(c, idUser, itemId, n, max = 9999) {
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
      (id_proposal, id_user, item_id, create_key, request_hash, rules_version, item_version, from_level, candidate_level, snapshot, created_at, expires_at, id_instance)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_timestamp($11 / 1000.0),to_timestamp($12 / 1000.0),$13) RETURNING *`,
    [p.id, p.idUser, p.item, p.key, p.requestHash, p.rules, p.version, p.fromLevel, p.candidateLevel, JSON.stringify(p.snapshot), p.now, p.expiresAt, p.instance || null]);
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
