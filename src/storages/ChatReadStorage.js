// src/storages/ChatReadStorage.js
// Estado de "não-lido" do chat ao vivo (Global + Enxames), por usuário e escopo.
// scope = 'global' | 'machine:<id_machine>'.
const ACTIVITY_WINDOW = "1 day"; // chat é efêmero (reset diário) — não olha além disso

const ChatReadStorage = {
  // Marca um escopo como lido agora (upsert).
  async markRead(db, { id_user, scope }) {
    await db.query(
      `INSERT INTO public.tb_chat_read (id_user, scope, last_read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (id_user, scope)
       DO UPDATE SET last_read_at = NOW()`,
      [id_user, scope]
    );
  },

  // Última atividade (mensagem de OUTRA pessoa) por escopo nas salas ativas,
  // dentro da janela efêmera. Retorna [{ scope, last_msg_at }].
  async activityByScope(db, id_user) {
    const r = await db.query(
      `SELECT
         CASE WHEN r.type = 'global'
              THEN 'global'
              ELSE 'machine:' || r.id_machine
         END AS scope,
         MAX(m.created_at) AS last_msg_at
       FROM public.tb_chat_message m
       JOIN public.tb_chat_room r ON r.id_chat_room = m.id_chat_room
      WHERE m.deleted_at IS NULL
        AND r.status = 'active'
        AND m.id_user <> $1
        AND m.created_at > NOW() - INTERVAL '${ACTIVITY_WINDOW}'
      GROUP BY scope`,
      [id_user]
    );
    return r.rows;
  },

  // last_read_at por escopo para o usuário. Retorna Map<scope, Date>.
  async readByScope(db, id_user) {
    const r = await db.query(
      `SELECT scope, last_read_at FROM public.tb_chat_read WHERE id_user = $1`,
      [id_user]
    );
    const map = new Map();
    for (const row of r.rows) map.set(row.scope, row.last_read_at);
    return map;
  },
};

module.exports = ChatReadStorage;
