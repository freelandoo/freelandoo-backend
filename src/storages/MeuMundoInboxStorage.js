// src/storages/MeuMundoInboxStorage.js — MEU MUNDO 3D: sino e correio interno (mig 302).
//
// Só SQL. Quem decide o que vira notificação, quem recebe e como um presente
// é entregue é o MeuMundoInboxService; aqui só se lê e grava.

const NOTICE_COLS = `n.id, n.kind, n.code, n.priority, n.data, n.id_mail, n.created_at, n.read_at`;
const MAIL_COLS = `m.id, m.kind, m.title, m.body, m.data, m.gift, m.claimed_at, m.claim_result, m.created_at, m.read_at`;

// Filtros do histórico do sino: "character" = necessidades e vida do hóspede.
const NOTICE_FILTERS = Object.freeze({
  all: null,
  unread: `n.read_at IS NULL`,
  character: `n.kind IN ('need', 'life')`,
  rewards: `n.kind IN ('gift', 'purchase')`,
  official: `n.kind IN ('official', 'promo')`,
});
const MAIL_TABS = Object.freeze({
  all: null,
  gift: `m.kind = 'gift'`,
  official: `m.kind = 'official'`,
  promo: `m.kind = 'promo'`,
  receipt: `m.kind = 'receipt'`,
});

function noticeRow(r) {
  return {
    id: String(r.id),
    kind: r.kind,
    code: r.code,
    priority: Number(r.priority),
    data: r.data || {},
    mailId: r.id_mail ? String(r.id_mail) : null,
    createdAt: new Date(r.created_at).toISOString(),
    read: !!r.read_at,
  };
}

function mailRow(r) {
  return {
    id: String(r.id),
    kind: r.kind,
    title: r.title,
    body: r.body,
    data: r.data || {},
    gift: r.gift || null,
    claimedAt: r.claimed_at ? new Date(r.claimed_at).toISOString() : null,
    claimResult: r.claim_result || null,
    createdAt: new Date(r.created_at).toISOString(),
    read: !!r.read_at,
  };
}

class MeuMundoInboxStorage {
  /** Grava uma notificação; com `dedupeKey` repetida não grava (devolve null). */
  static async insertNotice(db, idUser, { kind, code, priority = 3, data = {}, mailId = null, dedupeKey = null }) {
    const r = await db.query(
      `INSERT INTO tb_mm_notice (id_user, kind, code, priority, data, id_mail, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id_user, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id, kind, code, priority, data, id_mail, created_at, read_at`,
      [idUser, kind, code, priority, data, mailId, dedupeKey]
    );
    return r.rows[0] ? noticeRow(r.rows[0]) : null;
  }

  /**
   * Aviso de necessidade: grava só se a mesma necessidade não foi registrada
   * nas últimas `quietH` horas (o histórico não vira uma fila de "fome" a
   * cada minuto). Quem chama já segura o lock da pessoa (withLife).
   */
  static async insertNeed(db, idUser, { code, priority, data, quietH }) {
    const r = await db.query(
      `INSERT INTO tb_mm_notice (id_user, kind, code, priority, data)
       SELECT $1, 'need', $2, $3, $4
        WHERE NOT EXISTS (
          SELECT 1 FROM tb_mm_notice
           WHERE id_user = $1 AND kind = 'need' AND code = $2
             AND created_at > NOW() - make_interval(hours => $5)
        )
       RETURNING id, kind, code, priority, data, id_mail, created_at, read_at`,
      [idUser, code, priority, data, quietH]
    );
    return r.rows[0] ? noticeRow(r.rows[0]) : null;
  }

  static async listNotices(db, idUser, { filter = "all", before = null, limit = 30 } = {}) {
    const where = [`n.id_user = $1`];
    const args = [idUser];
    if (NOTICE_FILTERS[filter]) where.push(NOTICE_FILTERS[filter]);
    if (before) {
      args.push(before);
      where.push(`n.id < $${args.length}`);
    }
    args.push(limit + 1);
    const r = await db.query(
      `SELECT ${NOTICE_COLS} FROM tb_mm_notice n WHERE ${where.join(" AND ")} ORDER BY n.id DESC LIMIT $${args.length}`,
      args
    );
    const rows = r.rows.slice(0, limit).map(noticeRow);
    return { items: rows, more: r.rows.length > limit };
  }

  /** Notificações recentes ainda não lidas (para o "ao entrar": só as frescas). */
  static async recentUnread(db, idUser, sinceMs, limit = 3) {
    const r = await db.query(
      `SELECT ${NOTICE_COLS} FROM tb_mm_notice n
        WHERE n.id_user = $1 AND n.read_at IS NULL AND n.kind <> 'need' AND n.created_at > to_timestamp($2 / 1000.0)
        ORDER BY n.priority ASC, n.id DESC LIMIT $3`,
      [idUser, sinceMs, limit]
    );
    return r.rows.map(noticeRow);
  }

  static async counts(db, idUser) {
    const r = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM tb_mm_notice WHERE id_user = $1 AND read_at IS NULL) AS notices,
         (SELECT COUNT(*)::int FROM tb_mm_mail WHERE id_user = $1 AND read_at IS NULL) AS mail,
         (SELECT COUNT(*)::int FROM tb_mm_mail WHERE id_user = $1 AND kind = 'gift' AND claimed_at IS NULL) AS gifts`,
      [idUser]
    );
    return r.rows[0];
  }

  /** Marca como lidas: ids da pessoa (os de outra pessoa são ignorados pelo WHERE) ou todas. */
  static async readNotices(db, idUser, ids) {
    if (ids === "all") {
      const r = await db.query(`UPDATE tb_mm_notice SET read_at = NOW() WHERE id_user = $1 AND read_at IS NULL`, [idUser]);
      return r.rowCount;
    }
    const r = await db.query(
      `UPDATE tb_mm_notice SET read_at = NOW() WHERE id_user = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL`,
      [idUser, ids]
    );
    return r.rowCount;
  }

  /** Abrir uma carta marca ela e as notificações que apontam para ela. */
  static async readMail(db, idUser, idMail) {
    await db.query(`UPDATE tb_mm_mail SET read_at = NOW() WHERE id_user = $1 AND id = $2 AND read_at IS NULL`, [idUser, idMail]);
    await db.query(`UPDATE tb_mm_notice SET read_at = NOW() WHERE id_user = $1 AND id_mail = $2 AND read_at IS NULL`, [idUser, idMail]);
  }

  static async readAllMail(db, idUser) {
    await db.query(`UPDATE tb_mm_mail SET read_at = NOW() WHERE id_user = $1 AND read_at IS NULL`, [idUser]);
    await db.query(`UPDATE tb_mm_notice SET read_at = NOW() WHERE id_user = $1 AND id_mail IS NOT NULL AND read_at IS NULL`, [idUser]);
  }

  static async insertMail(db, idUser, { kind, title, body = "", data = {}, gift = null, dedupeKey = null, createdBy = null }) {
    const r = await db.query(
      `INSERT INTO tb_mm_mail (id_user, kind, title, body, data, gift, dedupe_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id_user, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
       RETURNING id, kind, title, body, data, gift, claimed_at, claim_result, created_at, read_at`,
      [idUser, kind, title, body, data, gift, dedupeKey, createdBy]
    );
    return r.rows[0] ? mailRow(r.rows[0]) : null;
  }

  static async listMail(db, idUser, { tab = "all", before = null, limit = 30 } = {}) {
    const where = [`m.id_user = $1`];
    const args = [idUser];
    if (MAIL_TABS[tab]) where.push(MAIL_TABS[tab]);
    if (before) {
      args.push(before);
      where.push(`m.id < $${args.length}`);
    }
    args.push(limit + 1);
    const r = await db.query(
      `SELECT ${MAIL_COLS} FROM tb_mm_mail m WHERE ${where.join(" AND ")} ORDER BY m.id DESC LIMIT $${args.length}`,
      args
    );
    return { items: r.rows.slice(0, limit).map(mailRow), more: r.rows.length > limit };
  }

  static async getMail(db, idUser, idMail) {
    const r = await db.query(`SELECT ${MAIL_COLS} FROM tb_mm_mail m WHERE m.id_user = $1 AND m.id = $2`, [idUser, idMail]);
    return r.rows[0] ? mailRow(r.rows[0]) : null;
  }

  /** Trava a carta para o resgate (dentro da transação da vida). */
  static async lockMail(c, idUser, idMail) {
    const r = await c.query(`SELECT ${MAIL_COLS} FROM tb_mm_mail m WHERE m.id_user = $1 AND m.id = $2 FOR UPDATE`, [idUser, idMail]);
    return r.rows[0] ? mailRow(r.rows[0]) : null;
  }

  /** Resgata uma vez: só grava se ainda não foi resgatado. */
  static async markClaimed(c, idUser, idMail, result) {
    const r = await c.query(
      `UPDATE tb_mm_mail SET claimed_at = NOW(), claim_result = $3, read_at = COALESCE(read_at, NOW())
        WHERE id_user = $1 AND id = $2 AND claimed_at IS NULL
        RETURNING id`,
      [idUser, idMail, result]
    );
    return r.rowCount > 0;
  }

  /** Presentes resgatados há pouco (o selo "Novo" na aba Itens). */
  static async recentClaims(db, idUser, hours = 48) {
    const r = await db.query(
      `SELECT gift, claimed_at FROM tb_mm_mail
        WHERE id_user = $1 AND kind = 'gift' AND claimed_at > NOW() - make_interval(hours => $2)
        ORDER BY claimed_at DESC LIMIT 50`,
      [idUser, hours]
    );
    return r.rows.map((x) => ({ gift: x.gift, claimedAt: new Date(x.claimed_at).toISOString() }));
  }

  static async getPrefs(db, idUser) {
    const r = await db.query(`SELECT promos FROM tb_mm_inbox_pref WHERE id_user = $1`, [idUser]);
    return { promos: r.rows[0] ? !!r.rows[0].promos : true };
  }

  static async setPrefs(db, idUser, { promos }) {
    await db.query(
      `INSERT INTO tb_mm_inbox_pref (id_user, promos) VALUES ($1, $2)
       ON CONFLICT (id_user) DO UPDATE SET promos = EXCLUDED.promos, updated_at = NOW()`,
      [idUser, !!promos]
    );
  }

  /**
   * Destinatários de um comunicado para todos: quem já joga (tem carteira do
   * jogo). Promoção pula quem desligou promoções.
   */
  static async players(db, { promo = false } = {}) {
    const r = await db.query(
      `SELECT w.id_user FROM tb_mm_wallet w
        ${promo ? `LEFT JOIN tb_mm_inbox_pref p ON p.id_user = w.id_user WHERE COALESCE(p.promos, TRUE)` : ``}`
    );
    return r.rows.map((x) => x.id_user);
  }
}

MeuMundoInboxStorage.NOTICE_FILTERS = Object.keys(NOTICE_FILTERS);
MeuMundoInboxStorage.MAIL_TABS = Object.keys(MAIL_TABS);

module.exports = MeuMundoInboxStorage;
