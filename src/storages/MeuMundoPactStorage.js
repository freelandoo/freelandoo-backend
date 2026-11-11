/**
 * MEU MUNDO 3D, lore v2 D4: o pacto do deus vencido (mig 445, tb_mm_domain_pact).
 * Regra pura em utils/meuMundoPact.js; quem abre é MeuMundoDomainService.openPact
 * (na transação do recibo da vitória) e quem paga é MeuMundoNectarService.closeWeek.
 */
const iso = (d) => new Date(d).toISOString();
const row = (x) => ({
  domain: x.domain,
  god: x.god,
  game: x.game,
  clan: x.clan,
  startsAt: iso(x.starts_at),
  endsAt: iso(x.ends_at),
});

class MeuMundoPactStorage {
  /** O pacto de pé do povo naquele Domínio em `now` (ou null). */
  static async current(c, domain, clan, now) {
    const r = await c.query(
      `SELECT domain, god, game, clan, starts_at, ends_at FROM tb_mm_domain_pact
        WHERE domain = $1 AND clan = $2 AND ends_at > $3::timestamptz
        ORDER BY ends_at DESC LIMIT 1`,
      [domain, clan, iso(now)]
    );
    return r.rows[0] ? row(r.rows[0]) : null;
  }

  /** Grava o pacto. Devolve o pacto, ou null se esta luta já tinha aberto um. */
  static async insert(c, { domain, god, game, clan, idUser, idFight, startsAt, endsAt }) {
    const r = await c.query(
      `INSERT INTO tb_mm_domain_pact (domain, god, game, clan, id_user, id_fight, starts_at, ends_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8::timestamptz)
       ON CONFLICT (id_fight) DO NOTHING
       RETURNING domain, god, game, clan, starts_at, ends_at`,
      [domain, god, game, clan, idUser, idFight, iso(startsAt), iso(endsAt)]
    );
    return r.rows[0] ? row(r.rows[0]) : null;
  }

  /** Todos os pactos de pé em `now` (a tela: aba Semana, estátua, portal). */
  static async active(db, now) {
    const r = await db.query(
      `SELECT domain, god, game, clan, starts_at, ends_at FROM tb_mm_domain_pact
        WHERE ends_at > $1::timestamptz AND starts_at <= $1::timestamptz
        ORDER BY ends_at`,
      [iso(now)]
    );
    return r.rows.map(row);
  }

  /** Pactos que cruzam o intervalo [start, end) (ms): o fechamento da semana. */
  static async overlapping(c, start, end) {
    const r = await c.query(
      `SELECT domain, god, game, clan, starts_at, ends_at FROM tb_mm_domain_pact
        WHERE starts_at < $2::timestamptz AND ends_at > $1::timestamptz`,
      [iso(start), iso(end)]
    );
    return r.rows.map((x) => ({ ...row(x), start: new Date(x.starts_at).getTime(), end: new Date(x.ends_at).getTime() }));
  }

  /** Povo de cada conta (Map id_user → clan; quem não escolheu fica de fora). */
  static async clansOf(c, ids) {
    if (!ids.length) return new Map();
    const r = await c.query(`SELECT id_user, clan FROM tb_mm_clan WHERE id_user = ANY($1::uuid[]) AND clan IS NOT NULL`, [ids]);
    return new Map(r.rows.map((x) => [x.id_user, x.clan]));
  }
}

module.exports = MeuMundoPactStorage;
