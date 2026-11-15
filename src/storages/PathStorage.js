// Paths (Feed Interativo F5, mig 458): histórias com caminhos. SQL parametrizado.

class PathStorage {
  static async create(db, { id_user, title }) {
    const r = await db.query(
      `INSERT INTO public.tb_path_story (id_user, title) VALUES ($1, $2) RETURNING *`,
      [id_user, title]
    );
    return r.rows[0];
  }

  static async getStory(db, id_story) {
    const r = await db.query(`SELECT * FROM public.tb_path_story WHERE id_story = $1`, [id_story]);
    return r.rows[0] || null;
  }

  static async listMine(db, id_user) {
    const r = await db.query(
      `SELECT s.id_story, s.title, s.status, s.id_portfolio_item, s.plays_count, s.updated_at,
              (SELECT COUNT(*)::int FROM public.tb_path_node n WHERE n.id_story = s.id_story) AS nodes_count
         FROM public.tb_path_story s
        WHERE s.id_user = $1
        ORDER BY s.updated_at DESC
        LIMIT 100`,
      [id_user]
    );
    return r.rows;
  }

  static async graph(db, id_story) {
    const nodes = await db.query(
      `SELECT id_node, title, body, is_ending, id_media_item, pos_x, pos_y, reach_count
         FROM public.tb_path_node WHERE id_story = $1 ORDER BY created_at, id_node`,
      [id_story]
    );
    const choices = await db.query(
      `SELECT c.id_choice, c.id_node, c.label, c.id_target_node, c.sort, c.picks_count
         FROM public.tb_path_choice c
         JOIN public.tb_path_node n ON n.id_node = c.id_node
        WHERE n.id_story = $1
        ORDER BY c.id_node, c.sort`,
      [id_story]
    );
    return { nodes: nodes.rows, choices: choices.rows };
  }

  /** Dos ids pedidos, os posts que são de algum perfil do usuário. */
  static async ownedItems(db, id_user, ids) {
    if (!ids.length) return new Set();
    const r = await db.query(
      `SELECT ppi.id_portfolio_item
         FROM public.tb_profile_portfolio_item ppi
         JOIN public.tb_profile pro ON pro.id_profile = ppi.id_profile
        WHERE pro.id_user = $1 AND ppi.id_portfolio_item = ANY($2::uuid[])`,
      [id_user, ids]
    );
    return new Set(r.rows.map((x) => x.id_portfolio_item));
  }

  static async storyByPost(db, id_portfolio_item) {
    const r = await db.query(
      `SELECT * FROM public.tb_path_story WHERE id_portfolio_item = $1 AND status = 'published' LIMIT 1`,
      [id_portfolio_item]
    );
    return r.rows[0] || null;
  }

  static async addPlay(db, id_story) {
    const r = await db.query(
      `UPDATE public.tb_path_story SET plays_count = plays_count + 1
        WHERE id_story = $1 AND status = 'published' RETURNING plays_count`,
      [id_story]
    );
    return r.rowCount > 0;
  }

  /** Conta a escolha (só de história publicada) e a chegada no nó de destino. */
  static async addPick(db, id_story, id_choice) {
    const r = await db.query(
      `UPDATE public.tb_path_choice c SET picks_count = c.picks_count + 1
         FROM public.tb_path_node n, public.tb_path_story s
        WHERE c.id_choice = $2 AND n.id_node = c.id_node AND s.id_story = n.id_story
          AND s.id_story = $1 AND s.status = 'published'
        RETURNING c.id_target_node`,
      [id_story, id_choice]
    );
    const target = r.rows[0]?.id_target_node || null;
    if (target) {
      await db.query(`UPDATE public.tb_path_node SET reach_count = reach_count + 1 WHERE id_node = $1`, [target]);
    }
    return r.rowCount > 0 ? { target } : null;
  }
}

module.exports = PathStorage;
