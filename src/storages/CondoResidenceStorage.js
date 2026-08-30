// src/storages/CondoResidenceStorage.js
// SQL puro do condomínio depois da absorção pelo núcleo territorial
// (migs 205/206): planta (torre × andar × apartamento), morador e disputa.
//
// Convenção do projeto: métodos estáticos que recebem `conn` (pool ou client de
// transação). Nenhum método aqui decide permissão — quem decide é o service.
//
// Três regras atravessam o arquivo:
//
//   * "morador do condomínio" é `status='recognized' AND ended_at IS NULL` numa
//     unidade do ENDEREÇO do condomínio. As duas metades sempre juntas (é a
//     mesma constante LIVE do ResidenceStorage, pela mesma razão): vínculo
//     encerrado que continuasse contando seria morador fantasma com voto.
//
//   * QUEM mora em QUAL unidade só sai por método próprio (`listUnitResidents`,
//     `listPlantWithResidents`). A planta que o morador comum enxerga devolve
//     CONTAGEM, nunca nome — saber que o 302 tem dois moradores é o necessário
//     para escolher um apartamento; saber quem são não é.
//
//   * `tb_condo_unit` é legado (mig 205). Nada aqui lê `id_holder_user`: a
//     titularidade única morreu com o conflito E1. Quem quiser o histórico usa
//     o ponteiro `id_residence_unit`.

const LIVE = "ended_at IS NULL";

class CondoResidenceStorage {
  /* --------------------------------- planta ------------------------------- */

  /**
   * A planta como o MORADOR a vê: torre, andar, apartamento e quantos moram
   * em cada um. Sem nomes — ver `listPlantWithResidents` para a visão do
   * síndico.
   *
   * Ordena por andar e depois pelo rótulo, para a grade sair na ordem em que
   * um prédio é lido. `label_norm` no fim do ORDER BY dá desempate estável
   * quando dois apartamentos têm o mesmo rótulo em torres diferentes.
   */
  static async listPlant(conn, id_address) {
    const r = await conn.query(
      `SELECT u.id_unit, u.id_block, u.label, u.floor, u.source,
              b.name AS block_name,
              b.floors, b.units_per_floor, b.first_floor,
              (SELECT COUNT(*)::int
                 FROM public.tb_residence_member rm
                WHERE rm.id_unit = u.id_unit
                  AND rm.status = 'recognized'
                  AND rm.${LIVE}) AS residents_count,
              (SELECT COUNT(*)::int
                 FROM public.tb_residence_member rm
                WHERE rm.id_unit = u.id_unit
                  AND rm.status = 'pending'
                  AND rm.${LIVE}) AS pending_count
         FROM public.tb_residence_unit u
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
        WHERE u.id_address = $1
        ORDER BY b.name NULLS FIRST, u.floor NULLS FIRST, u.label_norm`,
      [id_address]
    );
    return r.rows;
  }

  /** Visão do síndico: a planta com QUEM mora onde. Só a administração chama. */
  static async listPlantWithResidents(conn, id_address) {
    const r = await conn.query(
      `SELECT u.id_unit, u.id_block, u.label, u.floor,
              b.name AS block_name,
              rm.id_residence, rm.id_user, rm.status, rm.claimed_at,
              rm.recognized_at, rm.derived_from,
              us.username, us.nome, us.avatar
         FROM public.tb_residence_unit u
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
         LEFT JOIN public.tb_residence_member rm
                ON rm.id_unit = u.id_unit AND rm.${LIVE}
         LEFT JOIN public.tb_user us ON us.id_user = rm.id_user
        WHERE u.id_address = $1
        ORDER BY b.name NULLS FIRST, u.floor NULLS FIRST, u.label_norm,
                 rm.status, rm.claimed_at`,
      [id_address]
    );
    return r.rows;
  }

  /**
   * Uma unidade, confirmando que ela é DESTE condomínio. O `id_condo` não é
   * decoração: sem ele, um id de unidade de outro endereço passaria por
   * qualquer rota que aceite unidade (aviso direcionado, exclusão, vaga).
   */
  static async getUnitInCondo(conn, id_condo, id_unit) {
    const r = await conn.query(
      `SELECT u.id_unit, u.id_block, u.label, u.floor, u.source,
              b.name AS block_name
         FROM public.tb_residence_unit u
         JOIN public.tb_address a ON a.id_address = u.id_address
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
        WHERE u.id_unit = $1 AND a.id_condo_profile = $2
        LIMIT 1`,
      [id_unit, id_condo]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async listBlocks(conn, id_condo) {
    const r = await conn.query(
      `SELECT b.id_block, b.name, b.floors, b.units_per_floor, b.first_floor,
              b.generated_at, b.created_at,
              (SELECT COUNT(*)::int FROM public.tb_residence_unit u
                WHERE u.id_block = b.id_block) AS units_count
         FROM public.tb_condo_block b
        WHERE b.id_condo = $1
        ORDER BY b.name`,
      [id_condo]
    );
    return r.rows;
  }

  static async getBlock(conn, id_condo, id_block) {
    const r = await conn.query(
      `SELECT * FROM public.tb_condo_block
        WHERE id_block = $1 AND id_condo = $2
        LIMIT 1`,
      [id_block, id_condo]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /**
   * Grava a grade DECLARADA da torre. Não gera nada — gerar é
   * `TerritoryStorage.bulkCreateUnits`, chamado pelo service, porque a geração
   * precisa das duas escritas na mesma transação.
   */
  static async setBlockGrid(conn, { id_block, floors, units_per_floor, first_floor }) {
    const r = await conn.query(
      `UPDATE public.tb_condo_block
          SET floors          = $2,
              units_per_floor = $3,
              first_floor     = $4,
              generated_at    = NOW()
        WHERE id_block = $1
        RETURNING *`,
      [id_block, floors, units_per_floor, first_floor]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Carimba o andar nas unidades geradas (o bulk insert não o conhece). */
  static async setUnitFloor(conn, id_unit, floor) {
    await conn.query(
      `UPDATE public.tb_residence_unit
          SET floor = $2, updated_at = NOW()
        WHERE id_unit = $1`,
      [id_unit, floor]
    );
  }

  /**
   * Aplica o andar a uma leva inteira de rótulos de uma torre de uma vez. Usar
   * o rótulo NORMALIZADO (e não o cru) porque é ele que a unicidade usa: casar
   * pelo cru deixaria "101 " de fora e o andar sairia NULL sem erro nenhum.
   */
  static async setFloorForLabels(conn, { id_block, floor, labels }) {
    if (!Array.isArray(labels) || labels.length === 0) return 0;
    const r = await conn.query(
      `UPDATE public.tb_residence_unit u
          SET floor = $2, updated_at = NOW()
        WHERE u.id_block = $1
          AND u.label_norm = ANY (
                SELECT fl_norm_token(x) FROM unnest($3::text[]) AS x
              )`,
      [id_block, floor, labels]
    );
    return r.rowCount;
  }

  static async deleteUnit(conn, { id_address, id_unit }) {
    const r = await conn.query(
      `DELETE FROM public.tb_residence_unit
        WHERE id_unit = $1 AND id_address = $2
        RETURNING id_unit`,
      [id_unit, id_address]
    );
    return r.rowCount > 0;
  }

  /* -------------------------------- morador ------------------------------- */

  /**
   * O papel do usuário DENTRO deste condomínio, numa consulta só.
   *
   * `recognized` é o que abre publicar, votar e ver vizinhos. `pending` é quem
   * está esperando um co-morador se pronunciar. `unrecognized` é quem esperou
   * sete dias e ninguém falou nada: lê, não escreve — e continua podendo ser
   * reconhecido depois, porque o degrau 3 não é recusa (§7).
   */
  static async getResidentContext(conn, { id_address, id_user }) {
    if (!id_address || !id_user) {
      return { recognized: false, pending: false, unrecognized: false, units: [] };
    }
    const r = await conn.query(
      `SELECT rm.id_residence, rm.id_unit, rm.status, rm.claimed_at,
              rm.pending_until, rm.derived_from,
              u.label, u.floor, u.id_block,
              b.name AS block_name
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
        WHERE u.id_address = $1
          AND rm.id_user = $2
          AND rm.${LIVE}
        ORDER BY rm.claimed_at`,
      [id_address, id_user]
    );
    const units = r.rows;
    return {
      recognized: units.some((u) => u.status === "recognized"),
      pending: units.some((u) => u.status === "pending"),
      unrecognized: units.some((u) => u.status === "unrecognized"),
      contested: units.some((u) => u.status === "contested"),
      units,
    };
  }

  /** Moradores vivos de uma unidade, em qualquer estado. Visão da administração. */
  static async listUnitResidents(conn, id_unit) {
    const r = await conn.query(
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

  /**
   * Vizinhos do condomínio para a lista de membros. `is_minor` sai de fora
   * (D15: o menor herda a residência do responsável, não aparece na lista) e
   * a UNIDADE de cada um só é anexada quando `with_unit` — isto é, só para a
   * administração.
   */
  static async listCondoResidents(conn, { id_address, with_unit = false }) {
    const unitCols = with_unit
      ? `, u.label AS unit_label, u.floor, b.name AS block_name`
      : ``;
    const r = await conn.query(
      `SELECT DISTINCT ON (rm.id_user)
              rm.id_user, rm.recognized_at,
              us.username, us.nome, us.avatar${unitCols}
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
         JOIN public.tb_user us ON us.id_user = rm.id_user
        WHERE u.id_address = $1
          AND rm.status = 'recognized'
          AND rm.${LIVE}
          AND COALESCE(us.is_minor, FALSE) = FALSE
        ORDER BY rm.id_user, rm.recognized_at`,
      [id_address]
    );
    return r.rows;
  }

  static async countCondoResidents(conn, id_address) {
    const r = await conn.query(
      `SELECT COUNT(DISTINCT rm.id_user)::int AS n
         FROM public.tb_residence_member rm
         JOIN public.tb_residence_unit u ON u.id_unit = rm.id_unit
        WHERE u.id_address = $1
          AND rm.status = 'recognized'
          AND rm.${LIVE}`,
      [id_address]
    );
    return r.rows[0]?.n ?? 0;
  }

  /* -------------------------------- disputa ------------------------------- */

  static async createDispute(
    conn,
    { id_condo, id_unit, id_residence, id_claimant, id_contester, reason = null }
  ) {
    const r = await conn.query(
      `INSERT INTO public.tb_condo_dispute
         (id_condo, id_unit, id_residence, id_claimant, id_contester, reason)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id_residence) WHERE status = 'open' DO NOTHING
       RETURNING *`,
      [id_condo, id_unit, id_residence, id_claimant, id_contester, reason]
    );
    if (r.rowCount) return r.rows[0];
    // Já havia disputa aberta: devolve a existente em vez de estourar. Contestar
    // de novo continua a MESMA disputa (e a mesma conversa dos três).
    return this.getOpenDispute(conn, id_residence);
  }

  static async getOpenDispute(conn, id_residence) {
    const r = await conn.query(
      `SELECT * FROM public.tb_condo_dispute
        WHERE id_residence = $1 AND status = 'open'
        LIMIT 1`,
      [id_residence]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async getDisputeById(conn, id_dispute) {
    const r = await conn.query(
      `SELECT d.*, u.label AS unit_label, u.floor, b.name AS block_name,
              cl.username AS claimant_username, cl.nome AS claimant_name,
              ct.username AS contester_username, ct.nome AS contester_name
         FROM public.tb_condo_dispute d
         JOIN public.tb_residence_unit u ON u.id_unit = d.id_unit
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
         JOIN public.tb_user cl ON cl.id_user = d.id_claimant
         JOIN public.tb_user ct ON ct.id_user = d.id_contester
        WHERE d.id_dispute = $1
        LIMIT 1`,
      [id_dispute]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  static async setDisputeConversation(conn, id_dispute, id_conversation) {
    await conn.query(
      `UPDATE public.tb_condo_dispute
          SET id_conversation = $2, updated_at = NOW()
        WHERE id_dispute = $1`,
      [id_dispute, id_conversation]
    );
  }

  /**
   * Lista as disputas do condomínio. O comprovante mais recente vem junto —
   * é o que o síndico precisa ver para decidir, e sem ele o painel obrigaria
   * uma segunda consulta por linha.
   */
  static async listDisputes(conn, { id_condo, status = "open", limit = 50 }) {
    const r = await conn.query(
      `SELECT d.*, u.label AS unit_label, u.floor, b.name AS block_name,
              cl.username AS claimant_username, cl.nome AS claimant_name,
              cl.avatar AS claimant_avatar,
              ct.username AS contester_username, ct.nome AS contester_name,
              p.id_proof, p.storage_key AS proof_key, p.status AS proof_status,
              p.media_kind AS proof_media_kind, p.created_at AS proof_at
         FROM public.tb_condo_dispute d
         JOIN public.tb_residence_unit u ON u.id_unit = d.id_unit
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
         JOIN public.tb_user cl ON cl.id_user = d.id_claimant
         JOIN public.tb_user ct ON ct.id_user = d.id_contester
         LEFT JOIN LATERAL (
              SELECT pr.id_proof, pr.storage_key, pr.status, pr.media_kind,
                     pr.created_at
                FROM public.tb_residence_proof pr
               WHERE pr.id_residence = d.id_residence
                 AND pr.purged_at IS NULL
               ORDER BY pr.created_at DESC
               LIMIT 1
         ) p ON TRUE
        WHERE d.id_condo = $1
          AND ($2::text = 'all' OR d.status = $2::text)
        ORDER BY d.created_at DESC
        LIMIT $3`,
      [id_condo, status, Math.min(Number(limit) || 50, 200)]
    );
    return r.rows;
  }

  /**
   * Fecha a disputa. `decided_by` é obrigatório para approved/rejected — o
   * CHECK da mig 206 recusa veredito sem autor, que é como se garante que
   * ninguém perde a casa por causa de um job.
   */
  static async decideDispute(conn, { id_dispute, status, decided_by, note = null }) {
    const r = await conn.query(
      `UPDATE public.tb_condo_dispute
          SET status = $2, decided_by = $3, decided_at = NOW(),
              verdict_note = $4, updated_at = NOW()
        WHERE id_dispute = $1 AND status = 'open'
        RETURNING *`,
      [id_dispute, status, decided_by, note]
    );
    return r.rowCount ? r.rows[0] : null;
  }

  /** Disputas em que o usuário é parte — usado para liberar leitura/envio. */
  static async listDisputesForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT d.*, u.label AS unit_label, b.name AS block_name,
              pf.display_name AS condo_name
         FROM public.tb_condo_dispute d
         JOIN public.tb_residence_unit u ON u.id_unit = d.id_unit
         LEFT JOIN public.tb_condo_block b ON b.id_block = u.id_block
         JOIN public.tb_profile pf ON pf.id_profile = d.id_condo
        WHERE (d.id_claimant = $1 OR d.id_contester = $1)
          AND d.status = 'open'
        ORDER BY d.created_at DESC`,
      [id_user]
    );
    return r.rows;
  }
}

module.exports = CondoResidenceStorage;
