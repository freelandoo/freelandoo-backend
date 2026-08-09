// src/storages/ResidenceStorage.js
// SQL puro do vínculo morador↔unidade (mig 203).
//
// Convenção do projeto: métodos estáticos que recebem `conn` (pool ou client de
// transação). Nenhum método aqui decide permissão — quem decide é o service.
//
// Duas regras atravessam o arquivo:
//   * "morador" é sempre `status='recognized' AND ended_at IS NULL`. A constante
//     LIVE existe para que nenhuma query esqueça metade do predicado — vínculo
//     encerrado que continuasse contando seria morador fantasma com direito a
//     voto;
//   * o histórico NUNCA é apagado (o `leave` da comunidade faz DELETE e por isso
//     não há onde apoiar carência — conflito C7 do desenho). Sair é gravar
//     `ended_at` + motivo.

const LIVE = "ended_at IS NULL";

class ResidenceStorage {
  /* -------------------------------- leitura ------------------------------ */

  static async getById(conn, id_residence) {
    const r = await conn.query(
      `SELECT rm.*, u.id_address, u.label AS unit_label, u.id_block,
              a.id_territory, a.cep, a.numero
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = u.id_address
        WHERE rm.id_residence = $1
        LIMIT 1`,
      [id_residence]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getActiveForUserInUnit(conn, { id_unit, id_user }) {
    const r = await conn.query(
      `SELECT * FROM public.tb_residence_member
        WHERE id_unit = $1 AND id_user = $2 AND ${LIVE}
        LIMIT 1`,
      [id_unit, id_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Vínculos vivos do usuário, com o endereço resolvido para exibição. */
  static async listForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT rm.id_residence, rm.status, rm.claimed_at, rm.recognized_at,
              rm.pending_until, rm.derived_from,
              u.id_unit, u.label AS unit_label,
              a.id_address, a.cep, a.numero,
              t.id_territory, t.uf, t.municipio_label, t.bairro_label,
              t.is_city_wide
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = u.id_address
         JOIN public.tb_territory t ON t.id_territory = a.id_territory
        WHERE rm.id_user = $1 AND rm.${LIVE}
        ORDER BY rm.claimed_at DESC`,
      [id_user]
    );
    return r.rows;
  }

  /**
   * Co-moradores RECONHECIDOS de uma unidade. São eles que reconhecem e
   * contestam (§7) e são eles que a notificação acorda.
   *
   * `exclude_user` tira o próprio requerente da lista — ninguém se reconhece.
   */
  static async listRecognizedInUnit(conn, id_unit, { exclude_user = null } = {}) {
    const params = [id_unit];
    let filter = "";
    if (exclude_user) {
      params.push(exclude_user);
      filter = ` AND rm.id_user <> $${params.length}`;
    }
    const r = await conn.query(
      `SELECT rm.id_residence, rm.id_user, rm.recognized_at, rm.derived_from,
              us.username, us.nome
         FROM public.tb_residence_member rm
         JOIN public.tb_user us ON us.id_user = rm.id_user
        WHERE rm.id_unit = $1
          AND rm.status = 'recognized'
          AND rm.${LIVE}${filter}
        ORDER BY rm.recognized_at`,
      params
    );
    return r.rows;
  }

  /** Todos os vínculos vivos da unidade, em qualquer estado. */
  static async listInUnit(conn, id_unit) {
    const r = await conn.query(
      // `is_minor` vem da flag denormalizada em tb_user — a MESMA fonte que
      // utils/supervision usa. Derivar minoridade do vínculo aqui criaria uma
      // segunda verdade, e é a que estaria errada quando o vínculo é revogado.
      `SELECT rm.id_residence, rm.id_user, rm.status, rm.claimed_at,
              rm.recognized_at, rm.derived_from,
              us.username, us.nome, us.avatar,
              COALESCE(us.is_minor, FALSE) AS is_minor
         FROM public.tb_residence_member rm
         JOIN public.tb_user us ON us.id_user = rm.id_user
        WHERE rm.id_unit = $1 AND rm.${LIVE}
        ORDER BY rm.status, rm.claimed_at`,
      [id_unit]
    );
    return r.rows;
  }

  /** Pendências que ESTE usuário pode julgar: unidades onde ele é morador. */
  static async listPendingForJudge(conn, id_user) {
    const r = await conn.query(
      `SELECT rm.id_residence, rm.id_unit, rm.claimed_at, rm.pending_until,
              rm.status,
              us.username, us.nome, us.avatar,
              u.label AS unit_label, a.numero,
              t.bairro_label, t.municipio_label, t.uf,
              (SELECT rv.action FROM public.tb_residence_review rv
                WHERE rv.id_residence = rm.id_residence AND rv.id_user = $1
                LIMIT 1) AS my_vote
         FROM public.tb_residence_member rm
         JOIN public.tb_user us ON us.id_user = rm.id_user
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = u.id_address
         JOIN public.tb_territory t ON t.id_territory = a.id_territory
        WHERE rm.status IN ('pending', 'unrecognized')
          AND rm.${LIVE}
          AND rm.id_user <> $1
          AND EXISTS (
            SELECT 1 FROM public.tb_residence_member me
             WHERE me.id_unit = rm.id_unit
               AND me.id_user = $1
               AND me.status = 'recognized'
               AND me.ended_at IS NULL
          )
        ORDER BY rm.claimed_at`,
      [id_user]
    );
    return r.rows;
  }

  /* -------------------------------- escrita ------------------------------ */

  /**
   * Cria o vínculo. `status` vem decidido pelo service (degrau 0 × degrau 1),
   * porque a decisão depende de contar co-moradores — e essa contagem tem que
   * acontecer com a unidade TRAVADA, senão duas reivindicações simultâneas numa
   * unidade vazia viram duas "primeiras".
   */
  static async createLink(
    conn,
    { id_unit, id_user, status, pending_until = null, derived_from = null, recognized_by = null }
  ) {
    // `recognized_at` sai do JS, e não de um CASE sobre $3: o mesmo parâmetro
    // numa coluna e dentro de um CASE faz o Postgres deduzir tipos
    // inconsistentes (armadilha que o condomínio pagou 3× na mig 196).
    const recognizedAt = status === "recognized" ? new Date() : null;
    const r = await conn.query(
      `INSERT INTO public.tb_residence_member
         (id_unit, id_user, status, pending_until, derived_from,
          recognized_at, recognized_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id_unit, id_user) WHERE ended_at IS NULL DO NOTHING
       RETURNING *`,
      [id_unit, id_user, status, pending_until, derived_from, recognizedAt, recognized_by]
    );
    if (r.rowCount) return r.rows[0];
    // Corrida perdida: o vínculo já existe. Devolver o que está lá é mais útil
    // (e mais honesto) do que estourar violação de unicidade na cara do usuário.
    return this.getActiveForUserInUnit(conn, { id_unit, id_user });
  }

  /**
   * Trava a unidade para decidir o degrau. `pg_advisory_xact_lock` em vez de
   * SELECT FOR UPDATE porque não existe uma linha única para travar: a decisão
   * depende da AUSÊNCIA de linhas, e ausência não se tranca com row lock.
   */
  static async lockUnit(conn, id_unit) {
    await conn.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
      0x7265_7369, // "resi"
      Number(id_unit) % 2147483647,
    ]);
  }

  static async setStatus(conn, id_residence, status, { recognized_by = null } = {}) {
    // Mesma razão do createLink: nada de CASE sobre o parâmetro que também é
    // coluna. Os dois derivados do status são resolvidos aqui.
    const recognizedAt = status === "recognized" ? new Date() : null;
    const keepPending = status === "pending";
    const r = await conn.query(
      `UPDATE public.tb_residence_member
          SET status = $2,
              recognized_at = COALESCE(recognized_at, $3::timestamptz),
              recognized_by = COALESCE($4, recognized_by),
              pending_until = CASE WHEN $5 THEN pending_until ELSE NULL END,
              updated_at = NOW()
        WHERE id_residence = $1 AND ended_at IS NULL
        RETURNING *`,
      [id_residence, status, recognizedAt, recognized_by, keepPending]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Encerra o vínculo. O motivo é obrigatório (CHECK da mig 203) porque é ele
   * que a carência do subsistema 6 vai ler — "saiu" e "foi expulso" não podem
   * receber o mesmo tratamento.
   */
  static async endLink(conn, id_residence, { reason, by_user = null }) {
    const r = await conn.query(
      `UPDATE public.tb_residence_member
          SET status = 'ended', ended_at = NOW(), end_reason = $2,
              ended_by = $3, updated_at = NOW()
        WHERE id_residence = $1 AND ended_at IS NULL
        RETURNING *`,
      [id_residence, reason, by_user]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Cascata do D15: os vínculos dos menores que derivam deste usuário nesta
   * unidade. O menor não escolheu nada, então ele não fica para trás nem
   * responde por si — ele acompanha.
   */
  static async endDerivedLinks(conn, { id_unit, responsible, reason = "responsible_left" }) {
    const r = await conn.query(
      `UPDATE public.tb_residence_member
          SET status = 'ended', ended_at = NOW(), end_reason = $3,
              ended_by = $2, updated_at = NOW()
        WHERE id_unit = $1 AND derived_from = $2 AND ended_at IS NULL
        RETURNING id_residence, id_user`,
      [id_unit, responsible, reason]
    );
    return r.rows;
  }

  /* ---------------------- reconhecimento e contestação -------------------- */

  static async upsertVote(conn, { id_residence, id_user, action, reason = null }) {
    const r = await conn.query(
      `INSERT INTO public.tb_residence_review (id_residence, id_user, action, reason)
            VALUES ($1, $2, $3, $4)
       ON CONFLICT (id_residence, id_user) DO UPDATE
         SET action = EXCLUDED.action,
             reason = EXCLUDED.reason,
             updated_at = NOW()
       RETURNING *`,
      [id_residence, id_user, action, reason]
    );
    return r.rows[0];
  }

  static async listVotes(conn, id_residence) {
    const r = await conn.query(
      `SELECT rv.*, us.username, us.nome
         FROM public.tb_residence_review rv
         JOIN public.tb_user us ON us.id_user = rv.id_user
        WHERE rv.id_residence = $1
        ORDER BY rv.created_at`,
      [id_residence]
    );
    return r.rows;
  }

  /* ------------------------------ comprovante ----------------------------- */

  static async createProof(conn, { id_residence, storage_key, requested_by = null }) {
    // Reenviar substitui o que estava em análise em vez de empilhar (o índice
    // parcial ux_residence_proof_pending garante um só pendente por vínculo).
    await conn.query(
      `UPDATE public.tb_residence_proof
          SET status = 'rejected', verdict_note = 'substituído por novo envio',
              reviewed_at = NOW(), purge_after = NOW() + INTERVAL '30 days'
        WHERE id_residence = $1 AND status = 'pending'`,
      [id_residence]
    );
    const r = await conn.query(
      `INSERT INTO public.tb_residence_proof (id_residence, storage_key, requested_by)
            VALUES ($1, $2, $3)
       RETURNING *`,
      [id_residence, storage_key, requested_by]
    );
    return r.rows[0];
  }

  static async listProofQueue(conn, { status = "pending", limit = 50, offset = 0 }) {
    const r = await conn.query(
      `SELECT p.*, rm.id_user, rm.status AS residence_status, rm.id_unit,
              us.username, us.nome,
              u.label AS unit_label, a.numero,
              t.bairro_label, t.municipio_label, t.uf
         FROM public.tb_residence_proof p
         JOIN public.tb_residence_member rm ON rm.id_residence = p.id_residence
         JOIN public.tb_user us ON us.id_user = rm.id_user
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = u.id_address
         JOIN public.tb_territory t ON t.id_territory = a.id_territory
        WHERE p.status = $1
        ORDER BY p.created_at
        LIMIT $2 OFFSET $3`,
      [status, Math.min(Number(limit) || 50, 200), Number(offset) || 0]
    );
    return r.rows;
  }

  static async decideProof(conn, { id_proof, status, note, reviewed_by }) {
    const r = await conn.query(
      `UPDATE public.tb_residence_proof
          SET status = $2, verdict_note = $3, reviewed_by = $4,
              reviewed_at = NOW(),
              -- O arquivo é lixo tóxico depois do veredito: some do R2 em 30
              -- dias (§7.2) e só a decisão persiste.
              purge_after = NOW() + INTERVAL '30 days'
        WHERE id_proof = $1 AND status = 'pending'
        RETURNING *`,
      [id_proof, status, note || null, reviewed_by]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listProofsToPurge(conn, { limit = 100 } = {}) {
    const r = await conn.query(
      `SELECT id_proof, storage_key FROM public.tb_residence_proof
        WHERE purged_at IS NULL AND purge_after IS NOT NULL AND purge_after <= NOW()
        ORDER BY purge_after
        LIMIT $1`,
      [Math.min(Number(limit) || 100, 500)]
    );
    return r.rows;
  }

  static async markProofPurged(conn, id_proof) {
    await conn.query(
      `UPDATE public.tb_residence_proof
          SET purged_at = NOW(), storage_key = ''
        WHERE id_proof = $1`,
      [id_proof]
    );
  }

  /* -------------------------------- sweeper ------------------------------- */

  /**
   * Degrau 2: pendente que estourou o prazo vira NÃO RECONHECIDO — não é
   * recusa. A pessoa passa a ler o feed e continua sem publicar, votar ou ver
   * vizinhos, e qualquer co-morador ainda pode reconhecê-la depois.
   */
  static async sweepExpiredPending(conn, { limit = 200 } = {}) {
    const r = await conn.query(
      `UPDATE public.tb_residence_member
          SET status = 'unrecognized', pending_until = NULL, updated_at = NOW()
        WHERE id_residence IN (
          SELECT id_residence FROM public.tb_residence_member
           WHERE status = 'pending' AND ended_at IS NULL
             AND pending_until IS NOT NULL AND pending_until <= NOW()
           ORDER BY pending_until
           LIMIT $1
        )
        RETURNING id_residence, id_user, id_unit`,
      [Math.min(Number(limit) || 200, 1000)]
    );
    return r.rows;
  }

  /* ------------------------- fatos para o antifraude ---------------------- */

  /**
   * Os cinco sinais territoriais do §10, numa passada só. Devolve CONTAGENS —
   * a decisão de pontuar é do fraudScore, que é puro. Aqui não se decide nada.
   */
  static async getFraudFacts(conn, id_user, { windowDays = 90 } = {}) {
    const r = await conn.query(
      `WITH janela AS (SELECT NOW() - ($2 || ' days')::interval AS inicio)
       SELECT
         -- endereços DISTINTOS declarados na janela (mudar de casa é normal;
         -- mudar três vezes em 90 dias é o que chama atenção)
         (SELECT COUNT(DISTINCT u.id_address)
            FROM public.tb_residence_member rm
            JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
           WHERE rm.id_user = $1 AND rm.claimed_at >= (SELECT inicio FROM janela)
         )::int AS residence_changes,

         (SELECT COUNT(*)
            FROM public.tb_residence_member rm
            JOIN public.tb_residence_review rv ON rv.id_residence = rm.id_residence
           WHERE rm.id_user = $1 AND rv.action = 'contest'
             AND rv.created_at >= (SELECT inicio FROM janela)
         )::int AS contested_claims,

         (SELECT COUNT(DISTINCT rm.id_user)
            FROM public.tb_residence_review rv
            JOIN public.tb_residence_member rm ON rm.id_residence = rv.id_residence
           WHERE rv.id_user = $1 AND rv.action = 'contest'
             AND rv.created_at >= (SELECT inicio FROM janela)
         )::int AS contests_made,

         (SELECT COUNT(DISTINCT a.id_territory)
            FROM public.tb_residence_member rm
            JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
            JOIN public.tb_address a ON a.id_address = u.id_address
           WHERE rm.id_user = $1 AND rm.claimed_at >= (SELECT inicio FROM janela)
         )::int AS territorial_joins,

         -- Maior lotação entre as unidades vivas do usuário. Conta de MENOR não
         -- entra (§7.4): família grande não pode disparar overcrowded_unit.
         COALESCE((
           SELECT MAX(cnt) FROM (
             SELECT COUNT(*) AS cnt
               FROM public.tb_residence_member peer
               JOIN public.tb_user pu ON pu.id_user = peer.id_user
              WHERE peer.ended_at IS NULL
                AND COALESCE(pu.is_minor, FALSE) = FALSE
                AND peer.id_unit IN (
                  SELECT mine.id_unit FROM public.tb_residence_member mine
                   WHERE mine.id_user = $1 AND mine.ended_at IS NULL
                )
              GROUP BY peer.id_unit
           ) x
         ), 0)::int AS max_unit_occupants`,
      [id_user, String(windowDays)]
    );
    return r.rows[0];
  }

  /**
   * Quantos moradores VIVOS existem nas unidades de um bloco.
   *
   * Existe para uma coisa só: impedir que apagar uma torre apague gente. A FK
   * é CASCADE em cadeia (bloco → unidade → vínculo), então o banco removeria os
   * vínculos em silêncio — sem `ended_at`, sem motivo, sem notificação. Apagar
   * é diferente de encerrar: o histórico é a única prova do que aconteceu, e é
   * justamente o que o `leave` da comunidade destrói hoje (conflito C7).
   *
   * Conta só o vínculo vivo: linha já encerrada é história, e história não
   * pode travar o síndico para sempre.
   */
  static async countLiveInBlock(conn, id_block) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
        WHERE u.id_block = $1 AND rm.${LIVE}`,
      [id_block]
    );
    return r.rows[0].n;
  }

  /** Teto anti-oráculo (§11): quantas reivindicações o usuário fez hoje. */
  static async countClaimsToday(conn, id_user) {
    const r = await conn.query(
      `SELECT COUNT(*)::int AS n FROM public.tb_residence_member
        WHERE id_user = $1 AND claimed_at >= NOW() - INTERVAL '24 hours'`,
      [id_user]
    );
    return r.rows[0].n;
  }
}

module.exports = ResidenceStorage;
