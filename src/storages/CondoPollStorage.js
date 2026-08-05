// src/storages/CondoPollStorage.js
// SQL das enquetes do condomínio (mig 199).
//
// "Aberta" é derivado, não guardado: status='open' E (closes_at NULL OU no
// futuro). Assim uma enquete com prazo fecha sozinha, sem job/sweeper — mesma
// escolha feita na vida do bee (BEE_ALIVE_SQL).

const OPEN_SQL = `p.status = 'open' AND (p.closes_at IS NULL OR p.closes_at > NOW())`;

class CondoPollStorage {
  static get OPEN_SQL() {
    return OPEN_SQL;
  }

  static async create(conn, { id_condo, id_author, question, description, closes_at }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_poll (id_condo, id_author, question, description, closes_at)
            VALUES ($1, $2, $3, $4, $5)
         RETURNING id_poll, id_condo, id_author, question, description, status,
                   closes_at, created_at`,
      [id_condo, id_author, question, description ?? null, closes_at ?? null]
    );
    return r.rows[0];
  }

  static async addOptions(conn, id_poll, labels) {
    const rows = [];
    for (let i = 0; i < labels.length; i += 1) {
      const r = await conn.query(
        `INSERT INTO public.tb_condo_poll_option (id_poll, label, position)
              VALUES ($1, $2, $3)
           RETURNING id_option, label, position`,
        [id_poll, labels[i], i]
      );
      rows.push(r.rows[0]);
    }
    return rows;
  }

  static async getById(conn, id_condo, id_poll) {
    const r = await conn.query(
      `SELECT p.id_poll, p.id_condo, p.id_author, p.question, p.description,
              p.status, p.closes_at, p.created_at, p.closed_at,
              (${OPEN_SQL}) AS is_open
         FROM public.tb_condo_poll p
        WHERE p.id_condo = $1 AND p.id_poll = $2
        LIMIT 1`,
      [id_condo, id_poll]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Resultado agregado + o voto do viewer (para a tela não deixar votar 2×).
  static async listForCondo(conn, id_condo, id_user, { status = "all" } = {}) {
    const params = [id_condo, id_user ?? null];
    let filter = "";
    if (status === "open") filter = `AND ${OPEN_SQL}`;
    if (status === "closed") filter = `AND NOT (${OPEN_SQL})`;

    const r = await conn.query(
      `SELECT p.id_poll, p.question, p.description, p.status, p.closes_at,
              p.created_at, p.id_author,
              (${OPEN_SQL}) AS is_open,
              au.username AS author_username,
              (SELECT COUNT(*)::int FROM public.tb_condo_poll_vote v
                WHERE v.id_poll = p.id_poll) AS votes_total,
              (SELECT v.id_option FROM public.tb_condo_poll_vote v
                WHERE v.id_poll = p.id_poll AND v.id_user = $2) AS my_option,
              COALESCE((
                SELECT json_agg(json_build_object(
                         'id_option', o.id_option,
                         'label',     o.label,
                         'votes',     (SELECT COUNT(*)::int
                                         FROM public.tb_condo_poll_vote v
                                        WHERE v.id_option = o.id_option))
                       ORDER BY o.position)
                  FROM public.tb_condo_poll_option o
                 WHERE o.id_poll = p.id_poll
              ), '[]'::json) AS options
         FROM public.tb_condo_poll p
         JOIN public.tb_user au ON au.id_user = p.id_author
        WHERE p.id_condo = $1 ${filter}
        ORDER BY p.created_at DESC
        LIMIT 100`,
      params
    );
    return r.rows;
  }

  // Enquetes abertas, de qualquer condomínio em que o usuário seja MORADOR
  // CONFIRMADO (titular de unidade), que ele ainda não respondeu. É a consulta
  // que alimenta o modal de acesso à plataforma.
  static async listPendingForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT p.id_poll, p.id_condo, p.question, p.description, p.closes_at,
              c.display_name AS condo_name,
              COALESCE((
                SELECT json_agg(json_build_object('id_option', o.id_option, 'label', o.label)
                       ORDER BY o.position)
                  FROM public.tb_condo_poll_option o
                 WHERE o.id_poll = p.id_poll
              ), '[]'::json) AS options
         FROM public.tb_condo_poll p
         JOIN public.tb_profile c ON c.id_profile = p.id_condo
        WHERE ${OPEN_SQL}
          AND c.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM public.tb_condo_unit u
                       WHERE u.id_condo = p.id_condo
                         AND u.id_holder_user = $1)
          AND NOT EXISTS (SELECT 1 FROM public.tb_condo_poll_vote v
                           WHERE v.id_poll = p.id_poll AND v.id_user = $1)
        ORDER BY p.created_at ASC
        LIMIT 10`,
      [id_user]
    );
    return r.rows;
  }

  static async getOption(conn, id_poll, id_option) {
    const r = await conn.query(
      `SELECT id_option, id_poll, label
         FROM public.tb_condo_poll_option
        WHERE id_poll = $1 AND id_option = $2
        LIMIT 1`,
      [id_poll, id_option]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // ON CONFLICT DO NOTHING: o segundo voto do mesmo morador não troca o
  // primeiro nem estoura erro — simplesmente não conta.
  static async vote(conn, { id_poll, id_user, id_option }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_poll_vote (id_poll, id_user, id_option)
            VALUES ($1, $2, $3)
       ON CONFLICT (id_poll, id_user) DO NOTHING
         RETURNING id_poll, id_option, voted_at`,
      [id_poll, id_user, id_option]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async close(conn, id_condo, id_poll) {
    const r = await conn.query(
      `UPDATE public.tb_condo_poll
          SET status = 'closed', closed_at = NOW()
        WHERE id_condo = $1 AND id_poll = $2 AND status = 'open'
        RETURNING id_poll, status, closed_at`,
      [id_condo, id_poll]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Moradores confirmados — universo elegível da enquete (e destinatários da
  // notificação de abertura).
  static async listResidentUserIds(conn, id_condo) {
    const r = await conn.query(
      `SELECT DISTINCT id_holder_user AS id_user
         FROM public.tb_condo_unit
        WHERE id_condo = $1 AND id_holder_user IS NOT NULL`,
      [id_condo]
    );
    return r.rows.map((row) => row.id_user);
  }
}

module.exports = CondoPollStorage;
