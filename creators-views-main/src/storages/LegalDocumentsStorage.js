const pool = require("../databases");

class LegalDocumentsStorage {
  static async list({ document_type = null, active = "true" } = {}) {
    const params = [];
    let where = "WHERE 1=1";
    let i = 1;

    if (document_type) {
      where += ` AND document_type = $${i++}`;
      params.push(document_type);
    }

    const a = String(active).toLowerCase();
    if (a === "true") where += " AND is_active = TRUE";
    else if (a === "false") where += " AND is_active = FALSE";
    // "all" -> sem filtro

    const { rows } = await pool.query(
      `
      SELECT id_legal_document, version, document_type, title, content, document_hash,
             published_at, published_by, is_active, created_at, updated_at
      FROM tb_legal_document
      ${where}
      ORDER BY document_type ASC, created_at DESC
      `,
      params
    );

    return rows;
  }

  static async getById(id_legal_document) {
    const { rows } = await pool.query(
      `
      SELECT id_legal_document, version, document_type, title, content, document_hash,
             published_at, published_by, is_active, created_at, updated_at
      FROM tb_legal_document
      WHERE id_legal_document = $1
      LIMIT 1
      `,
      [id_legal_document]
    );
    return rows[0] || null;
  }

  static async getByHash(document_hash) {
    const { rows } = await pool.query(
      `
      SELECT id_legal_document, document_hash
      FROM tb_legal_document
      WHERE document_hash = $1
      LIMIT 1
      `,
      [document_hash]
    );
    return rows[0] || null;
  }

  static async getByTypeAndVersion(document_type, version) {
    const { rows } = await pool.query(
      `
      SELECT id_legal_document, document_type, version
      FROM tb_legal_document
      WHERE document_type = $1 AND version = $2
      LIMIT 1
      `,
      [document_type, version]
    );
    return rows[0] || null;
  }

  static async getActiveByType(document_type) {
    const { rows } = await pool.query(
      `
      SELECT id_legal_document, version, document_type, title, content, document_hash,
             published_at, published_by, is_active, created_at, updated_at
      FROM tb_legal_document
      WHERE document_type = $1
        AND is_active = TRUE
      ORDER BY published_at DESC NULLS LAST, created_at DESC
      LIMIT 1
      `,
      [document_type]
    );
    return rows[0] || null;
  }

  static async create({
    version,
    document_type,
    title,
    content,
    document_hash,
    created_by: _created_by,
  }) {
    const { rows } = await pool.query(
      `
      INSERT INTO tb_legal_document (
        id_legal_document, version, document_type, title, content, document_hash,
        published_at, published_by, is_active, created_at, updated_at
      )
      VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5,
        NULL, NULL, FALSE, NOW(), NOW()
      )
      RETURNING id_legal_document, version, document_type, title, content, document_hash,
                published_at, published_by, is_active, created_at, updated_at
      `,
      [version, document_type, title, content, document_hash]
    );

    // OBS: seu schema não tem created_by; se tiver, me avisa que eu incluo.
    return rows[0];
  }

  static async update({
    id_legal_document,
    version,
    document_type,
    title,
    content,
    document_hash,
    updated_by: _updated_by,
  }) {
    const sets = [];
    const params = [];
    let i = 1;

    if (version !== undefined) {
      sets.push(`version = $${i++}`);
      params.push(version);
    }
    if (document_type !== undefined) {
      sets.push(`document_type = $${i++}`);
      params.push(document_type);
    }
    if (title !== undefined) {
      sets.push(`title = $${i++}`);
      params.push(title);
    }
    if (content !== undefined) {
      sets.push(`content = $${i++}`);
      params.push(content);
    }
    if (document_hash !== undefined) {
      sets.push(`document_hash = $${i++}`);
      params.push(document_hash);
    }

    // seu schema não tem updated_by, apenas updated_at.
    // se você adicionar updated_by, eu coloco aqui também.
    sets.push(`updated_at = NOW()`);

    params.push(id_legal_document);

    const { rows } = await pool.query(
      `
      UPDATE tb_legal_document
      SET ${sets.join(", ")}
      WHERE id_legal_document = $${i}
      RETURNING id_legal_document, version, document_type, title, content, document_hash,
                published_at, published_by, is_active, created_at, updated_at
      `,
      params
    );

    return rows[0] || null;
  }

  // Ativa 1 documento e desativa os outros do mesmo type (transação)
  static async activate({ id_legal_document, document_type, published_by }) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // desativa outras versões
      await client.query(
        `
        UPDATE tb_legal_document
        SET is_active = FALSE,
            updated_at = NOW()
        WHERE document_type = $1
          AND id_legal_document <> $2
          AND is_active = TRUE
        `,
        [document_type, id_legal_document]
      );

      // ativa essa versão e registra published_at/by
      const { rows } = await client.query(
        `
        UPDATE tb_legal_document
        SET is_active = TRUE,
            published_at = COALESCE(published_at, NOW()),
            published_by = COALESCE(published_by, $1),
            updated_at = NOW()
        WHERE id_legal_document = $2
        RETURNING id_legal_document, version, document_type, title, content, document_hash,
                  published_at, published_by, is_active, created_at, updated_at
        `,
        [published_by, id_legal_document]
      );

      await client.query("COMMIT");
      return rows[0] || null;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  static async deactivate({ id_legal_document, updated_by: _updated_by }) {
    const { rows } = await pool.query(
      `
      UPDATE tb_legal_document
      SET is_active = FALSE,
          updated_at = NOW()
      WHERE id_legal_document = $1
      RETURNING id_legal_document, version, document_type, title, content, document_hash,
                published_at, published_by, is_active, created_at, updated_at
      `,
      [id_legal_document]
    );
    return rows[0] || null;
  }
}

module.exports = LegalDocumentsStorage;
