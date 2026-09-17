// src/storages/AiKnowledgeStorage.js
// SQL puro da base de conhecimento do atendente (mig 253): o que o dono escreve
// à mão ou manda em PDF, já convertido em texto.
//
// ⚠️ TODA LEITURA SOBE ATÉ O DONO (`id_user` no WHERE). Esta tabela carrega
// tabela de preço, endereço e condição comercial de gente diferente: um SELECT
// por id solto seria o dossiê de um vendedor servido a quem adivinhasse um
// número.

/** A lista da tela NÃO traz `content` — são documentos inteiros. */
const LIST_COLS = `
  id_knowledge, source, title, file_name, char_count, is_active,
  created_at, updated_at
`;

class AiKnowledgeStorage {
  static async listByUser(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT ${LIST_COLS}
         FROM public.tb_ai_knowledge
        WHERE id_user = $1
        ORDER BY is_active DESC, created_at DESC`,
      [id_user]
    );
    return rows;
  }

  /** O texto de verdade, só do que está ligado — é isto que vai no dossiê. */
  static async listActiveContent(conn, id_user) {
    const { rows } = await conn.query(
      `SELECT id_knowledge, source, title, content, char_count
         FROM public.tb_ai_knowledge
        WHERE id_user = $1 AND is_active = TRUE
        ORDER BY created_at ASC`,
      [id_user]
    );
    return rows;
  }

  static async get(conn, id_user, id_knowledge) {
    const { rows } = await conn.query(
      `SELECT id_knowledge, id_user, source, title, content, file_name,
              char_count, is_active, created_at, updated_at
         FROM public.tb_ai_knowledge
        WHERE id_user = $1 AND id_knowledge = $2 LIMIT 1`,
      [id_user, id_knowledge]
    );
    return rows[0] || null;
  }

  static async create(conn, { id_user, source, title, content, file_name }) {
    const text = String(content || "");
    const { rows } = await conn.query(
      `INSERT INTO public.tb_ai_knowledge
         (id_user, source, title, content, file_name, char_count)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING ${LIST_COLS}`,
      [id_user, source, title, text, file_name || null, text.length]
    );
    return rows[0];
  }

  static async update(conn, id_user, id_knowledge, { title, content, is_active }) {
    const sets = ["updated_at = NOW()"];
    const vals = [];
    let i = 1;
    if (title !== undefined) {
      sets.push(`title = $${i++}`);
      vals.push(title);
    }
    if (content !== undefined) {
      const text = String(content || "");
      sets.push(`content = $${i++}`);
      vals.push(text);
      // char_count é DERIVADO do texto, sempre na mesma instrução. Deixá-lo
      // para um UPDATE à parte abriria a janela em que a tela mostra um número
      // que não corresponde ao documento.
      sets.push(`char_count = $${i++}`);
      vals.push(text.length);
    }
    if (is_active !== undefined) {
      sets.push(`is_active = $${i++}`);
      vals.push(!!is_active);
    }
    vals.push(id_user, id_knowledge);
    const { rows } = await conn.query(
      `UPDATE public.tb_ai_knowledge SET ${sets.join(", ")}
        WHERE id_user = $${i++} AND id_knowledge = $${i}
        RETURNING ${LIST_COLS}`,
      vals
    );
    return rows[0] || null;
  }

  static async remove(conn, id_user, id_knowledge) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.tb_ai_knowledge WHERE id_user = $1 AND id_knowledge = $2`,
      [id_user, id_knowledge]
    );
    return rowCount > 0;
  }
}

module.exports = AiKnowledgeStorage;
