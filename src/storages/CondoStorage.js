// src/storages/CondoStorage.js
// SQL puro do Condomínio (mig 196): blocos, unidades, vagas e reivindicações.
// Mesma convenção das outras storages da comunidade: métodos estáticos que
// recebem `conn` (pool ou client de transação).
//
// Regra de leitura que atravessa o arquivo: unidade/vaga são dados sensíveis.
// Nenhum método aqui decide permissão — quem decide é o CondoService —, mas os
// métodos "com titular" existem separados dos "sem titular" justamente para
// que a camada de cima consiga responder menos quando o viewer merece menos.

class CondoStorage {
  /* ------------------------------ condomínio ----------------------------- */

  // Confere que o perfil é mesmo um condomínio (evita rota de condo operar
  // sobre comunidade comum por id trocado).
  static async getCondo(conn, id_condo) {
    const r = await conn.query(
      `SELECT id_profile, display_name, id_leader_user, community_kind,
              condo_street, condo_number, condo_complement,
              condo_neighborhood, condo_cep, estado, municipio
         FROM public.tb_profile
        WHERE id_profile = $1
          AND is_community = TRUE
          AND community_kind = 'condo'
          AND deleted_at IS NULL
        LIMIT 1`,
      [id_condo]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /* -------------------------------- blocos ------------------------------- */

  static async listBlocks(conn, id_condo) {
    const r = await conn.query(
      `SELECT b.id_block, b.name, b.created_at,
              (SELECT COUNT(*)::int FROM public.tb_condo_unit u
                WHERE u.id_block = b.id_block) AS units_count
         FROM public.tb_condo_block b
        WHERE b.id_condo = $1
        ORDER BY b.name ASC`,
      [id_condo]
    );
    return r.rows;
  }

  static async createBlock(conn, id_condo, name) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_block (id_condo, name)
            VALUES ($1, $2)
       ON CONFLICT DO NOTHING
         RETURNING id_block, name, created_at`,
      [id_condo, name]
    );
    if (r.rowCount) return r.rows[0];
    // Já existia (UNIQUE por lower(name)) — devolve o existente.
    const ex = await conn.query(
      `SELECT id_block, name, created_at
         FROM public.tb_condo_block
        WHERE id_condo = $1 AND lower(name) = lower($2)
        LIMIT 1`,
      [id_condo, name]
    );
    return ex.rowCount ? ex.rows[0] : null;
  }

  static async deleteBlock(conn, id_condo, id_block) {
    const r = await conn.query(
      `DELETE FROM public.tb_condo_block
        WHERE id_condo = $1 AND id_block = $2`,
      [id_condo, id_block]
    );
    return r.rowCount > 0;
  }

  /* ------------------------------- unidades ------------------------------ */

  static async findUnit(conn, id_condo, { id_block, number }) {
    const r = await conn.query(
      `SELECT u.id_unit, u.id_block, u.number, u.id_holder_user, u.holder_since
         FROM public.tb_condo_unit u
        WHERE u.id_condo = $1
          AND COALESCE(u.id_block, 0) = COALESCE($2::bigint, 0)
          AND lower(u.number) = lower($3)
        LIMIT 1`,
      [id_condo, id_block ?? null, number]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getUnit(conn, id_condo, id_unit) {
    const r = await conn.query(
      `SELECT u.id_unit, u.id_condo, u.id_block, u.number,
              u.id_holder_user, u.holder_since,
              b.name AS block_name
         FROM public.tb_condo_unit u
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
        WHERE u.id_condo = $1 AND u.id_unit = $2
        LIMIT 1`,
      [id_condo, id_unit]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async createUnit(conn, id_condo, { id_block, number }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_unit (id_condo, id_block, number)
            VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
         RETURNING id_unit, id_block, number, id_holder_user, holder_since`,
      [id_condo, id_block ?? null, number]
    );
    if (r.rowCount) return r.rows[0];
    return this.findUnit(conn, id_condo, { id_block, number });
  }

  // with_holder = FALSE devolve a planta sem dizer quem mora onde.
  static async listUnits(conn, id_condo, { with_holder = false } = {}) {
    const holderCols = with_holder
      ? `u.id_holder_user,
         hu.username AS holder_username,
         hu.nome     AS holder_name,`
      : "";
    const holderJoin = with_holder
      ? `LEFT JOIN public.tb_user hu ON hu.id_user = u.id_holder_user`
      : "";
    const r = await conn.query(
      `SELECT u.id_unit, u.id_block, u.number, b.name AS block_name,
              ${holderCols}
              (u.id_holder_user IS NOT NULL) AS is_taken,
              (SELECT COUNT(*)::int FROM public.tb_condo_parking p
                WHERE p.id_unit = u.id_unit) AS parking_count
         FROM public.tb_condo_unit u
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
         ${holderJoin}
        WHERE u.id_condo = $1
        ORDER BY b.name NULLS FIRST, u.number ASC`,
      [id_condo]
    );
    return r.rows;
  }

  static async setUnitHolder(conn, id_unit, id_user) {
    const r = await conn.query(
      `UPDATE public.tb_condo_unit
          SET id_holder_user = $2,
              holder_since   = CASE WHEN $2::uuid IS NULL THEN NULL ELSE NOW() END,
              updated_at     = NOW()
        WHERE id_unit = $1
        RETURNING id_unit, id_condo, id_block, number, id_holder_user`,
      [id_unit, id_user ?? null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /* --------------------------------- vagas ------------------------------- */

  static async findSpot(conn, id_condo, code) {
    const r = await conn.query(
      `SELECT id_spot, id_unit, code, id_holder_user, holder_since
         FROM public.tb_condo_parking
        WHERE id_condo = $1 AND lower(code) = lower($2)
        LIMIT 1`,
      [id_condo, code]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getSpot(conn, id_condo, id_spot) {
    const r = await conn.query(
      `SELECT id_spot, id_condo, id_unit, code, id_holder_user, holder_since
         FROM public.tb_condo_parking
        WHERE id_condo = $1 AND id_spot = $2
        LIMIT 1`,
      [id_condo, id_spot]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async createSpot(conn, id_condo, { code, id_unit }) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_parking (id_condo, code, id_unit)
            VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
         RETURNING id_spot, id_unit, code, id_holder_user, holder_since`,
      [id_condo, code, id_unit ?? null]
    );
    if (r.rowCount) return r.rows[0];
    return this.findSpot(conn, id_condo, code);
  }

  static async listSpots(conn, id_condo, { with_holder = false, id_user = null } = {}) {
    const params = [id_condo];
    let filter = "";
    if (id_user) {
      params.push(id_user);
      filter = `AND p.id_holder_user = $${params.length}`;
    }
    const holderCols = with_holder
      ? `p.id_holder_user,
         hu.username AS holder_username,
         hu.nome     AS holder_name,`
      : "";
    const holderJoin = with_holder
      ? `LEFT JOIN public.tb_user hu ON hu.id_user = p.id_holder_user`
      : "";
    const r = await conn.query(
      // A vaga aponta para `tb_residence_unit` desde a mig 207 — a FK foi
      // reapontada junto com os dados. JOIN na tb_condo_unit aqui devolveria
      // o apartamento errado (os dois espaços de id se sobrepõem).
      `SELECT p.id_spot, p.code, p.id_unit,
              u.label AS unit_number, b.name AS block_name,
              ${holderCols}
              (p.id_holder_user IS NOT NULL) AS is_taken
         FROM public.tb_condo_parking p
         LEFT JOIN public.tb_residence_unit u ON u.id_unit  = p.id_unit
         LEFT JOIN public.tb_condo_block    b ON b.id_block = u.id_block
         ${holderJoin}
        WHERE p.id_condo = $1 ${filter}
        ORDER BY p.code ASC`,
      params
    );
    return r.rows;
  }

  static async setSpotHolder(conn, id_spot, id_user, id_unit) {
    const r = await conn.query(
      `UPDATE public.tb_condo_parking
          SET id_holder_user = $2,
              id_unit        = COALESCE($3::bigint, id_unit),
              holder_since   = CASE WHEN $2::uuid IS NULL THEN NULL ELSE NOW() END,
              updated_at     = NOW()
        WHERE id_spot = $1
        RETURNING id_spot, id_condo, id_unit, code, id_holder_user`,
      [id_spot, id_user ?? null, id_unit ?? null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /* ---------------------------- reivindicações --------------------------- */

  static async createClaim(conn, { id_condo, id_user, target_type, id_unit, id_spot, status, note, decided_by }) {
    const finalStatus = status || "pending";
    const decidedAt = finalStatus === "pending" ? null : new Date();
    const r = await conn.query(
      `INSERT INTO public.tb_condo_claim
         (id_condo, id_user, target_type, id_unit, id_spot, status, note,
          decided_by, decided_at)
       -- decided_at vem pronto do JS ($9): reusar $6 dentro de um CASE faz o
       -- Postgres deduzir tipos inconsistentes para o mesmo parâmetro.
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id_claim, id_condo, id_user, target_type, id_unit, id_spot,
                 status, note, created_at`,
      [
        id_condo,
        id_user,
        target_type,
        id_unit ?? null,
        id_spot ?? null,
        finalStatus,
        note ?? null,
        decided_by ?? null,
        decidedAt,
      ]
    );
    return r.rows[0];
  }

  static async getPendingClaim(conn, { id_user, id_unit, id_spot }) {
    const r = await conn.query(
      `SELECT id_claim, status
         FROM public.tb_condo_claim
        WHERE id_user = $1
          AND status = 'pending'
          AND (($2::bigint IS NOT NULL AND id_unit = $2::bigint)
            OR ($3::bigint IS NOT NULL AND id_spot = $3::bigint))
        LIMIT 1`,
      [id_user, id_unit ?? null, id_spot ?? null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getClaim(conn, id_condo, id_claim) {
    const r = await conn.query(
      `SELECT c.*, u.number AS unit_number, b.name AS block_name,
              p.code AS spot_code
         FROM public.tb_condo_claim c
         LEFT JOIN public.tb_condo_unit    u ON u.id_unit  = c.id_unit
         LEFT JOIN public.tb_condo_block   b ON b.id_block = u.id_block
         LEFT JOIN public.tb_condo_parking p ON p.id_spot  = c.id_spot
        WHERE c.id_condo = $1 AND c.id_claim = $2
        LIMIT 1`,
      [id_condo, id_claim]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listClaims(conn, id_condo, { status = "pending" } = {}) {
    const params = [id_condo];
    let filter = "";
    if (status && status !== "all") {
      params.push(status);
      filter = `AND c.status = $${params.length}`;
    }
    const r = await conn.query(
      `SELECT c.id_claim, c.id_user, c.target_type, c.id_unit, c.id_spot,
              c.status, c.note, c.created_at, c.decided_at,
              us.username AS claimant_username,
              us.nome     AS claimant_name,
              u.number    AS unit_number,
              b.name      AS block_name,
              pk.code     AS spot_code,
              hu.username AS current_holder_username,
              hu.nome     AS current_holder_name
         FROM public.tb_condo_claim c
         JOIN public.tb_user us ON us.id_user = c.id_user
         LEFT JOIN public.tb_condo_unit    u  ON u.id_unit  = c.id_unit
         LEFT JOIN public.tb_condo_block   b  ON b.id_block = u.id_block
         LEFT JOIN public.tb_condo_parking pk ON pk.id_spot = c.id_spot
         LEFT JOIN public.tb_user hu
           ON hu.id_user = COALESCE(u.id_holder_user, pk.id_holder_user)
        WHERE c.id_condo = $1 ${filter}
        ORDER BY c.created_at DESC
        LIMIT 200`,
      params
    );
    return r.rows;
  }

  static async listClaimsForUser(conn, id_condo, id_user) {
    const r = await conn.query(
      `SELECT c.id_claim, c.target_type, c.status, c.created_at, c.decided_at,
              u.number AS unit_number, b.name AS block_name, pk.code AS spot_code
         FROM public.tb_condo_claim c
         LEFT JOIN public.tb_condo_unit    u  ON u.id_unit  = c.id_unit
         LEFT JOIN public.tb_condo_block   b  ON b.id_block = u.id_block
         LEFT JOIN public.tb_condo_parking pk ON pk.id_spot = c.id_spot
        WHERE c.id_condo = $1 AND c.id_user = $2
        ORDER BY c.created_at DESC
        LIMIT 50`,
      [id_condo, id_user]
    );
    return r.rows;
  }

  // Resolve a reivindicação. `decided_by` NULL = aprovação automática (alvo
  // estava livre); com valor = decisão do administrador.
  static async resolveClaim(conn, id_claim, { status, decided_by }) {
    const r = await conn.query(
      `UPDATE public.tb_condo_claim
          SET status = $2, decided_by = $3, decided_at = NOW()
        WHERE id_claim = $1 AND status = 'pending'
        RETURNING id_claim, id_condo, id_user, target_type, id_unit, id_spot, status`,
      [id_claim, status, decided_by ?? null]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  // Ao aprovar uma reivindicação, as OUTRAS pendentes do mesmo alvo perdem o
  // sentido — arquiva em bloco para não sobrar fila fantasma.
  static async rejectOtherPendingForTarget(conn, { id_claim, id_unit, id_spot }) {
    const r = await conn.query(
      `UPDATE public.tb_condo_claim
          SET status = 'rejected', decided_at = NOW()
        WHERE status = 'pending'
          AND id_claim <> $1
          AND (($2::bigint IS NOT NULL AND id_unit = $2::bigint)
            OR ($3::bigint IS NOT NULL AND id_spot = $3::bigint))
        RETURNING id_claim, id_user`,
      [id_claim, id_unit ?? null, id_spot ?? null]
    );
    return r.rows;
  }

  /* --------------------------- situação do morador ------------------------ */

  // A pergunta central da feature: este usuário É morador confirmado?
  // É o que libera avisos, anúncios, enquetes e a lista de vizinhos.
  //
  // ⚠️ A FONTE MUDOU (mig 205). Antes: `tb_condo_unit.id_holder_user`, um
  // titular por unidade. Agora: `tb_residence_member`, N moradores por unidade,
  // alcançados pelo ENDEREÇO do condomínio (tb_address.id_condo_profile).
  //
  // Esta função continua existindo com a MESMA forma de retorno de propósito:
  // ela é chamada pelo `CommunityService` (projeção da página), pelo
  // `CondoService._context` (gate de avisos/anúncios/enquetes) e pelo claim de
  // vaga. Trocar a fonte aqui conserta os três de uma vez — deixar qualquer um
  // lendo a coluna legada faria morador NOVO não conseguir publicar, porque o
  // fluxo novo só escreve em `tb_residence_member`.
  //
  // "morador" é `status='recognized' AND ended_at IS NULL` — sempre as duas
  // metades, senão quem saiu continuaria com direito a voto.
  static async getResidentStatus(conn, id_condo, id_user) {
    if (!id_user) return { confirmed: false, pending: false, units: [], parking: [] };
    const units = await conn.query(
      `SELECT ru.id_unit, ru.label AS number, ru.floor, b.name AS block_name
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit ru ON ru.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = ru.id_address
         LEFT JOIN public.tb_condo_block b ON b.id_block = ru.id_block
        WHERE a.id_condo_profile = $1
          AND rm.id_user = $2
          AND rm.status = 'recognized'
          AND rm.ended_at IS NULL
        ORDER BY b.name NULLS FIRST, ru.floor NULLS FIRST, ru.label_norm`,
      [id_condo, id_user]
    );
    const parking = await conn.query(
      `SELECT p.id_spot, p.code, p.id_unit
         FROM public.tb_condo_parking p
        WHERE p.id_condo = $1 AND p.id_holder_user = $2
        ORDER BY p.code ASC`,
      [id_condo, id_user]
    );
    // "Pendente" também mudou de lugar: é o vínculo esperando os co-moradores
    // se pronunciarem (degrau 1), não mais uma linha em tb_condo_claim.
    // `contested` entra aqui porque, para a tela, os dois significam a mesma
    // coisa — você pediu e ainda não terminou.
    const pending = await conn.query(
      `SELECT COUNT(*)::int AS n
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit ru ON ru.id_unit = rm.id_unit
         JOIN public.tb_address a ON a.id_address = ru.id_address
        WHERE a.id_condo_profile = $1
          AND rm.id_user = $2
          AND rm.status IN ('pending', 'contested')
          AND rm.ended_at IS NULL`,
      [id_condo, id_user]
    );
    return {
      confirmed: units.rowCount > 0,
      pending: (pending.rows[0]?.n || 0) > 0,
      units: units.rows,
      parking: parking.rows,
    };
  }

  // Lista de moradores. with_units = só administrador (ver quem mora onde).
  static async listResidents(conn, id_condo, { with_units = false } = {}) {
    // Quem mora em qual apartamento sai da árvore nova (mig 205): N moradores
    // por unidade, alcançados pelo ENDEREÇO do condomínio. `with_units` segue
    // sendo só do administrador — a unidade do vizinho não é dado de vizinho.
    const unitCols = with_units
      ? `(SELECT COALESCE(
             json_agg(json_build_object('id_unit', ru.id_unit, 'number', ru.label,
                                        'floor', ru.floor, 'block_name', b.name)
                      ORDER BY ru.label_norm),
             '[]'::json)
            FROM public.tb_residence_member rm
            JOIN public.tb_residence_unit ru ON ru.id_unit = rm.id_unit
            JOIN public.tb_address a ON a.id_address = ru.id_address
            LEFT JOIN public.tb_condo_block b ON b.id_block = ru.id_block
           WHERE a.id_condo_profile = m.id_community_profile
             AND rm.id_user = m.id_user
             AND rm.status = 'recognized'
             AND rm.ended_at IS NULL) AS units,`
      : "";
    const r = await conn.query(
      `SELECT m.id_user, m.role, m.joined_at,
              us.username AS user_username,
              us.nome     AS user_name,
              ${unitCols}
              EXISTS (SELECT 1 FROM public.tb_condo_unit u2
                       WHERE u2.id_condo = m.id_community_profile
                         AND u2.id_holder_user = m.id_user) AS is_resident,
              hp.id_profile     AS top_profile_id,
              hp.display_name   AS top_profile_name,
              hp.avatar_url     AS top_profile_avatar
         FROM public.tb_community_member m
         JOIN public.tb_user us ON us.id_user = m.id_user
         LEFT JOIN LATERAL (
           SELECT id_profile, display_name, avatar_url
             FROM public.tb_profile
            WHERE id_user = m.id_user
              AND is_clan = FALSE
              AND is_community = FALSE
              AND deleted_at IS NULL
            ORDER BY xp_total DESC
            LIMIT 1
         ) hp ON TRUE
        WHERE m.id_community_profile = $1
        ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'vice' THEN 1 ELSE 2 END,
                 m.joined_at ASC`,
      [id_condo]
    );
    return r.rows;
  }

  // Titular de uma unidade/vaga — destinatário do aviso direcionado.
  static async getTargetHolder(conn, { id_unit, id_spot }) {
    if (id_unit) {
      const r = await conn.query(
        `SELECT u.id_holder_user AS id_user, u.number, b.name AS block_name
           FROM public.tb_condo_unit u
           LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
          WHERE u.id_unit = $1
          LIMIT 1`,
        [id_unit]
      );
      return r.rowCount ? r.rows[0] : null;
    }
    if (id_spot) {
      const r = await conn.query(
        `SELECT p.id_holder_user AS id_user, p.code, u.number, b.name AS block_name
           FROM public.tb_condo_parking p
           LEFT JOIN public.tb_condo_unit  u ON u.id_unit  = p.id_unit
           LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
          WHERE p.id_spot = $1
          LIMIT 1`,
        [id_spot]
      );
      return r.rowCount ? r.rows[0] : null;
    }
    return null;
  }
}

module.exports = CondoStorage;
