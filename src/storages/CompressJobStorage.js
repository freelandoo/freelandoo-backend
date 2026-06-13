// src/storages/CompressJobStorage.js
// Contagem de uso da ferramenta /comprimir (limite por hora) + checagem de
// conta paga (tem subperfil com assinatura ativa).
const pool = require("../databases");

const CompressJobStorage = {
  // Conta = paga se o usuário dono tem QUALQUER subperfil com assinatura ativa.
  async isPaidUser(id_user) {
    const r = await pool.query(
      `SELECT EXISTS (
         SELECT 1
           FROM public.tb_profile p
           JOIN public.tb_profile_subscription ps ON ps.id_profile = p.id_profile
          WHERE p.id_user = $1
            AND ps.status = 'active'
       ) AS is_paid`,
      [id_user]
    );
    return Boolean(r.rows[0]?.is_paid);
  },

  // Quantos vídeos o usuário comprimiu nos últimos `minutes` minutos.
  async countRecent(id_user, minutes = 60) {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS n
         FROM public.compress_jobs
        WHERE id_user = $1
          AND created_at > NOW() - ($2 || ' minutes')::interval`,
      [id_user, String(minutes)]
    );
    return r.rows[0]?.n || 0;
  },

  async record(id_user, sizeBytes) {
    await pool.query(
      `INSERT INTO public.compress_jobs (id_user, kind, size_bytes)
       VALUES ($1, 'video', $2)`,
      [id_user, sizeBytes ?? null]
    );
  },

  // Retenção: a janela útil é 1h; nada precisa viver mais que ~1 dia.
  async purgeOld() {
    const r = await pool.query(
      `DELETE FROM public.compress_jobs WHERE created_at < NOW() - INTERVAL '1 day'`
    );
    return { purged: r.rowCount || 0 };
  },
};

module.exports = CompressJobStorage;
