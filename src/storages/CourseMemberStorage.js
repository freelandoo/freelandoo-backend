// Perfis anexados a um curso de clan (mig 127). Co-autores que dividem a venda.
class CourseMemberStorage {
  static async setMembers(conn, course_id, memberIds) {
    await conn.query(
      `DELETE FROM public.tb_course_member WHERE course_id = $1`,
      [course_id]
    );
    if (!memberIds || memberIds.length === 0) return [];
    const values = memberIds.map((_, i) => `($1, $${i + 2})`).join(", ");
    const r = await conn.query(
      `INSERT INTO public.tb_course_member (course_id, id_member_profile)
       VALUES ${values}
       ON CONFLICT DO NOTHING
       RETURNING id_member_profile`,
      [course_id, ...memberIds]
    );
    return r.rows;
  }

  static async getMemberIds(conn, course_id) {
    const r = await conn.query(
      `SELECT id_member_profile FROM public.tb_course_member
        WHERE course_id = $1 ORDER BY created_at ASC`,
      [course_id]
    );
    return r.rows.map((x) => x.id_member_profile);
  }

  static async getMemberIdsByCourses(conn, courseIds) {
    if (!courseIds || courseIds.length === 0) return new Map();
    const r = await conn.query(
      `SELECT course_id, id_member_profile FROM public.tb_course_member
        WHERE course_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
      [courseIds]
    );
    const map = new Map();
    for (const row of r.rows) {
      const key = String(row.course_id);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(row.id_member_profile);
    }
    return map;
  }
}

module.exports = CourseMemberStorage;
