// Storage da feature "Casa Views — Participantes". SQL puro (sem ORM).
// Cobre o participante e seus blocos editoriais (jornada, segredos, teorias).

const PARTICIPANT_COLS = `
  id, slug, display_name, tagline, avatar_url, cover_url, bio, quote,
  vault_amount_cents, suspicion_pct, captures_count, status, accent_color,
  external_ranking_user_id, is_active, sort_order, created_at, updated_at
`;

// ───────────────────────── Participantes ─────────────────────────

async function listParticipants(conn, { onlyActive = false } = {}) {
  const where = onlyActive ? "WHERE is_active = TRUE" : "";
  const { rows } = await conn.query(
    `SELECT ${PARTICIPANT_COLS}
       FROM public.casa_participant
       ${where}
      ORDER BY sort_order ASC, display_name ASC`
  );
  return rows;
}

async function getParticipantById(conn, id) {
  const { rows } = await conn.query(
    `SELECT ${PARTICIPANT_COLS} FROM public.casa_participant WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function getParticipantBySlug(conn, slug) {
  const { rows } = await conn.query(
    `SELECT ${PARTICIPANT_COLS} FROM public.casa_participant WHERE slug = $1 LIMIT 1`,
    [slug]
  );
  return rows[0] || null;
}

async function createParticipant(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_participant
       (slug, display_name, tagline, avatar_url, cover_url, bio, quote,
        vault_amount_cents, suspicion_pct, captures_count, status, accent_color,
        external_ranking_user_id, is_active, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING ${PARTICIPANT_COLS}`,
    [
      d.slug, d.display_name, d.tagline, d.avatar_url, d.cover_url, d.bio, d.quote,
      d.vault_amount_cents ?? 0, d.suspicion_pct ?? 0, d.captures_count ?? 0,
      d.status ?? "active", d.accent_color ?? "magenta",
      d.external_ranking_user_id, d.is_active ?? true, d.sort_order ?? 0,
    ]
  );
  return rows[0] || null;
}

const PATCHABLE = [
  "slug", "display_name", "tagline", "avatar_url", "cover_url", "bio", "quote",
  "vault_amount_cents", "suspicion_pct", "captures_count", "status", "accent_color",
  "external_ranking_user_id", "is_active", "sort_order",
];

async function updateParticipant(conn, id, patch) {
  const sets = [];
  const vals = [];
  let i = 1;
  for (const key of PATCHABLE) {
    if (patch[key] !== undefined) {
      sets.push(`${key} = $${i++}`);
      vals.push(patch[key]);
    }
  }
  if (!sets.length) return getParticipantById(conn, id);
  vals.push(id);
  const { rows } = await conn.query(
    `UPDATE public.casa_participant
        SET ${sets.join(", ")}, updated_at = NOW()
      WHERE id = $${i}
      RETURNING ${PARTICIPANT_COLS}`,
    vals
  );
  return rows[0] || null;
}

async function deleteParticipant(conn, id) {
  await conn.query(`DELETE FROM public.casa_participant WHERE id = $1`, [id]);
  return { ok: true };
}

// ───────────────────────── Blocos editoriais ─────────────────────────
// Genérico para jornada/segredo/teoria — cada um tem seu conjunto de colunas.

async function listJourney(conn, id_participant) {
  const { rows } = await conn.query(
    `SELECT id, id_participant, label, title, description, happened_on, sentiment, sort_order, created_at
       FROM public.casa_participant_journey
      WHERE id_participant = $1
      ORDER BY sort_order ASC, created_at ASC`,
    [id_participant]
  );
  return rows;
}

async function createJourney(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_participant_journey
       (id_participant, label, title, description, happened_on, sentiment, sort_order)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, id_participant, label, title, description, happened_on, sentiment, sort_order, created_at`,
    [d.id_participant, d.label, d.title, d.description, d.happened_on, d.sentiment ?? "neutral", d.sort_order ?? 0]
  );
  return rows[0] || null;
}

async function updateJourney(conn, id, p) {
  const cols = ["label", "title", "description", "happened_on", "sentiment", "sort_order"];
  const sets = []; const vals = []; let i = 1;
  for (const c of cols) if (p[c] !== undefined) { sets.push(`${c} = $${i++}`); vals.push(p[c]); }
  if (!sets.length) return null;
  vals.push(id);
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_journey SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, id_participant, label, title, description, happened_on, sentiment, sort_order, created_at`,
    vals
  );
  return rows[0] || null;
}

async function deleteJourney(conn, id) {
  await conn.query(`DELETE FROM public.casa_participant_journey WHERE id = $1`, [id]);
  return { ok: true };
}

async function listSecrets(conn, id_participant) {
  const { rows } = await conn.query(
    `SELECT id, id_participant, content, author_label, revealed, sort_order, created_at
       FROM public.casa_participant_secret
      WHERE id_participant = $1
      ORDER BY sort_order ASC, created_at ASC`,
    [id_participant]
  );
  return rows;
}

async function createSecret(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_participant_secret (id_participant, content, author_label, revealed, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, id_participant, content, author_label, revealed, sort_order, created_at`,
    [d.id_participant, d.content, d.author_label ?? "anônimo", d.revealed ?? true, d.sort_order ?? 0]
  );
  return rows[0] || null;
}

async function updateSecret(conn, id, p) {
  const cols = ["content", "author_label", "revealed", "sort_order"];
  const sets = []; const vals = []; let i = 1;
  for (const c of cols) if (p[c] !== undefined) { sets.push(`${c} = $${i++}`); vals.push(p[c]); }
  if (!sets.length) return null;
  vals.push(id);
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_secret SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, id_participant, content, author_label, revealed, sort_order, created_at`,
    vals
  );
  return rows[0] || null;
}

async function deleteSecret(conn, id) {
  await conn.query(`DELETE FROM public.casa_participant_secret WHERE id = $1`, [id]);
  return { ok: true };
}

async function listTheories(conn, id_participant) {
  const { rows } = await conn.query(
    `SELECT id, id_participant, content, author_label, votes, sort_order, created_at
       FROM public.casa_participant_theory
      WHERE id_participant = $1
      ORDER BY sort_order ASC, votes DESC, created_at ASC`,
    [id_participant]
  );
  return rows;
}

async function createTheory(conn, d) {
  const { rows } = await conn.query(
    `INSERT INTO public.casa_participant_theory (id_participant, content, author_label, votes, sort_order)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, id_participant, content, author_label, votes, sort_order, created_at`,
    [d.id_participant, d.content, d.author_label ?? "audiência", d.votes ?? 0, d.sort_order ?? 0]
  );
  return rows[0] || null;
}

async function updateTheory(conn, id, p) {
  const cols = ["content", "author_label", "votes", "sort_order"];
  const sets = []; const vals = []; let i = 1;
  for (const c of cols) if (p[c] !== undefined) { sets.push(`${c} = $${i++}`); vals.push(p[c]); }
  if (!sets.length) return null;
  vals.push(id);
  const { rows } = await conn.query(
    `UPDATE public.casa_participant_theory SET ${sets.join(", ")} WHERE id = $${i}
     RETURNING id, id_participant, content, author_label, votes, sort_order, created_at`,
    vals
  );
  return rows[0] || null;
}

async function deleteTheory(conn, id) {
  await conn.query(`DELETE FROM public.casa_participant_theory WHERE id = $1`, [id]);
  return { ok: true };
}

module.exports = {
  listParticipants,
  getParticipantById,
  getParticipantBySlug,
  createParticipant,
  updateParticipant,
  deleteParticipant,
  listJourney, createJourney, updateJourney, deleteJourney,
  listSecrets, createSecret, updateSecret, deleteSecret,
  listTheories, createTheory, updateTheory, deleteTheory,
};
