// src/storages/CourseLessonQuestionsStorage.js
// SQL puro para public.course_lesson_questions e
// public.course_lesson_question_options (migration 046).

class CourseLessonQuestionsStorage {
  // ---------------- Perguntas ----------------

  static async listByLesson(conn, lessonId) {
    const { rows: questions } = await conn.query(
      `SELECT id, lesson_id, prompt, position, created_at, updated_at
         FROM public.course_lesson_questions
        WHERE lesson_id = $1
        ORDER BY position ASC, created_at ASC`,
      [lessonId],
    );
    if (!questions.length) return [];
    const ids = questions.map((q) => q.id);
    const { rows: options } = await conn.query(
      `SELECT id, question_id, label, is_correct, position, created_at, updated_at
         FROM public.course_lesson_question_options
        WHERE question_id = ANY($1::uuid[])
        ORDER BY position ASC, created_at ASC`,
      [ids],
    );
    const byQ = new Map(questions.map((q) => [q.id, { ...q, options: [] }]));
    for (const o of options) {
      const q = byQ.get(o.question_id);
      if (q) q.options.push(o);
    }
    return Array.from(byQ.values());
  }

  static async getQuestionById(conn, id) {
    const { rows } = await conn.query(
      `SELECT id, lesson_id, prompt, position, created_at, updated_at
         FROM public.course_lesson_questions
        WHERE id = $1
        LIMIT 1`,
      [id],
    );
    return rows[0] || null;
  }

  static async listOptionsByQuestion(conn, questionId) {
    const { rows } = await conn.query(
      `SELECT id, question_id, label, is_correct, position, created_at, updated_at
         FROM public.course_lesson_question_options
        WHERE question_id = $1
        ORDER BY position ASC, created_at ASC`,
      [questionId],
    );
    return rows;
  }

  static async getNextQuestionPosition(conn, lessonId) {
    const { rows } = await conn.query(
      `SELECT COALESCE(MAX(position), -1) + 1 AS next
         FROM public.course_lesson_questions
        WHERE lesson_id = $1`,
      [lessonId],
    );
    return rows[0]?.next || 0;
  }

  /**
   * Cria a pergunta + opções dentro de uma transação. Garante que
   * exatamente uma opção fica como correta (validação no service).
   */
  static async createWithOptions(conn, { lessonId, prompt, position, options }) {
    await conn.query("BEGIN");
    try {
      const { rows: qRows } = await conn.query(
        `INSERT INTO public.course_lesson_questions (lesson_id, prompt, position)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [lessonId, prompt, position],
      );
      const question = qRows[0];
      const insertedOptions = [];
      for (let i = 0; i < options.length; i += 1) {
        const o = options[i];
        const { rows: oRows } = await conn.query(
          `INSERT INTO public.course_lesson_question_options
             (question_id, label, is_correct, position)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [question.id, o.label, !!o.is_correct, i],
        );
        insertedOptions.push(oRows[0]);
      }
      await conn.query("COMMIT");
      return { ...question, options: insertedOptions };
    } catch (err) {
      await conn.query("ROLLBACK");
      throw err;
    }
  }

  static async updatePrompt(conn, id, prompt) {
    const { rows } = await conn.query(
      `UPDATE public.course_lesson_questions
          SET prompt = $1
        WHERE id = $2
        RETURNING *`,
      [prompt, id],
    );
    return rows[0] || null;
  }

  /**
   * Substitui o conjunto inteiro de opções da pergunta. Mantém integridade
   * via DELETE + INSERT dentro da mesma transação. Idempotente o suficiente
   * para o caso de uso (admin reedita a lista).
   */
  static async replaceOptions(conn, questionId, options) {
    await conn.query("BEGIN");
    try {
      await conn.query(
        `DELETE FROM public.course_lesson_question_options WHERE question_id = $1`,
        [questionId],
      );
      const inserted = [];
      for (let i = 0; i < options.length; i += 1) {
        const o = options[i];
        const { rows } = await conn.query(
          `INSERT INTO public.course_lesson_question_options
             (question_id, label, is_correct, position)
           VALUES ($1, $2, $3, $4)
           RETURNING *`,
          [questionId, o.label, !!o.is_correct, i],
        );
        inserted.push(rows[0]);
      }
      await conn.query("COMMIT");
      return inserted;
    } catch (err) {
      await conn.query("ROLLBACK");
      throw err;
    }
  }

  static async deleteQuestion(conn, id) {
    const { rowCount } = await conn.query(
      `DELETE FROM public.course_lesson_questions WHERE id = $1`,
      [id],
    );
    return rowCount > 0;
  }

  /**
   * Reordenação atômica das perguntas. Mesmo shift +1000000 dos materiais.
   */
  static async setQuestionsOrder(conn, lessonId, orderedIds) {
    await conn.query("BEGIN");
    try {
      await conn.query(
        `UPDATE public.course_lesson_questions
            SET position = position + 1000000
          WHERE lesson_id = $1`,
        [lessonId],
      );
      for (let i = 0; i < orderedIds.length; i += 1) {
        await conn.query(
          `UPDATE public.course_lesson_questions
              SET position = $1
            WHERE id = $2 AND lesson_id = $3`,
          [i, orderedIds[i], lessonId],
        );
      }
      const { rows: leftovers } = await conn.query(
        `SELECT id FROM public.course_lesson_questions
          WHERE lesson_id = $1 AND position >= 1000000
          ORDER BY position ASC`,
        [lessonId],
      );
      let nextPos = orderedIds.length;
      for (const row of leftovers) {
        await conn.query(
          `UPDATE public.course_lesson_questions SET position = $1 WHERE id = $2`,
          [nextPos, row.id],
        );
        nextPos += 1;
      }
      await conn.query("COMMIT");
    } catch (err) {
      await conn.query("ROLLBACK");
      throw err;
    }
  }
}

module.exports = CourseLessonQuestionsStorage;
