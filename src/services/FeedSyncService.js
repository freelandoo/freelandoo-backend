// Feed Interativo F6 (mig 459) — feed sincronizado: duas pessoas, o mesmo feed.
//
// Ciclo pelo REST (convidar, aceitar, recusar, encerrar, trocar o controle),
// estado pelo socket (src/realtime/feedSync.js). Régua:
//   - só entre quem já tem vínculo de lançar ATIVO em algum sentido (mig 456)
//     e sem bloqueio social; nunca com conta de menor;
//   - convite expira em 2 min; uma sessão aberta por par; 10 convites/hora;
//   - o convidado só vê, do feed do anfitrião, o que passa na régua do feed
//     global COM ELE como leitor (GET /feed-interativo/posts).

const pool = require("../databases");
const FeedInterativoStorage = require("../storages/FeedInterativoStorage");
const PortfolioFeedStorage = require("../storages/PortfolioFeedStorage");
const UserBlockStorage = require("../storages/UserBlockStorage");
const { shapeRow } = require("./portfolioFeed/PortfolioFeedService");
const { isMinorUser, assertMinorPermission } = require("../utils/supervision");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("FeedSyncService");
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const INVITE_TTL_SEC = 120;
const INVITES_PER_HOUR = 10;

function realtime() {
  return require("../realtime/socket");
}
function feedSync() {
  return require("../realtime/feedSync");
}
function notAuth() {
  return { error: "Usuário não autenticado", statusCode: 401 };
}
function card(row) {
  return row ? { id_user: row.id_user, username: row.username || null, display_name: row.display_name || null, avatar_url: row.avatar_url || null } : null;
}

async function getSession(id_session) {
  const r = await pool.query(
    `UPDATE public.tb_feed_sync_session
        SET status = 'ended', ended_at = NOW()
      WHERE id_session = $1 AND status = 'invited' AND created_at < NOW() - make_interval(secs => $2)
      RETURNING id_session`,
    [id_session, INVITE_TTL_SEC]
  );
  void r;
  const s = await pool.query(`SELECT * FROM public.tb_feed_sync_session WHERE id_session = $1`, [id_session]);
  return s.rows[0] || null;
}

function view(s, me) {
  return {
    id_session: s.id_session,
    status: s.status,
    control: s.control,
    role: s.id_host === me ? "host" : "guest",
    host: s.id_host,
    guest: s.id_guest,
    created_at: s.created_at,
    expires_at: s.status === "invited" ? new Date(new Date(s.created_at).getTime() + INVITE_TTL_SEC * 1000).toISOString() : null,
  };
}

class FeedSyncService {
  /** Os dois têm vínculo de lançar ativo em algum sentido? */
  static async linked(a, b) {
    const r = await pool.query(
      `SELECT 1 FROM public.tb_feed_throw_link
        WHERE status IN ('active', 'silenced')
          AND ((id_sender = $1 AND id_receiver = $2) OR (id_sender = $2 AND id_receiver = $1))
        LIMIT 1`,
      [a, b]
    );
    return r.rowCount > 0;
  }

  static async invite(user, body = {}) {
    return runWithLogs(log, "invite", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return notAuth();
      const guest = String(body.id_user || "");
      if (!UUID_RE.test(guest) || guest === user.id_user) return { error: "Escolha com quem sincronizar" };
      if ((await isMinorUser(user.id_user)) || (await isMinorUser(guest))) {
        return { error: "Feed sincronizado não está disponível para contas de menores", statusCode: 403 };
      }
      if ((await UserBlockStorage.eitherBlocks(pool, user.id_user, guest)) || !(await FeedSyncService.linked(user.id_user, guest))) {
        return { error: "Só dá para sincronizar com quem já troca lançamentos com você", statusCode: 403 };
      }
      const recent = await pool.query(
        `SELECT COUNT(*)::int AS n FROM public.tb_feed_sync_session WHERE id_host = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
        [user.id_user]
      );
      if (recent.rows[0].n >= INVITES_PER_HOUR) return { error: "Muitos convites seguidos. Espere um pouco.", statusCode: 429 };
      // Encerra sessão aberta antiga entre os dois (qualquer papel) antes da nova.
      await pool.query(
        `UPDATE public.tb_feed_sync_session SET status = 'ended', ended_at = NOW(), ended_by = $1
          WHERE status IN ('invited', 'active')
            AND ((id_host = $1 AND id_guest = $2) OR (id_host = $2 AND id_guest = $1))`,
        [user.id_user, guest]
      );
      const r = await pool.query(
        `INSERT INTO public.tb_feed_sync_session (id_host, id_guest) VALUES ($1, $2) RETURNING *`,
        [user.id_user, guest]
      );
      const s = r.rows[0];
      const me = await FeedInterativoStorage.userCard(pool, user.id_user);
      realtime().emitToUser(guest, "fi:sync", { type: "invite", id_session: s.id_session, from: card(me), expires_in: INVITE_TTL_SEC });
      return { session: view(s, user.id_user) };
    });
  }

  static async get(user, id_session) {
    if (!user?.id_user) return notAuth();
    if (!UUID_RE.test(String(id_session || ""))) return { error: "id_session inválido" };
    const s = await getSession(id_session);
    if (!s || (s.id_host !== user.id_user && s.id_guest !== user.id_user)) return { error: "Sessão não encontrada", statusCode: 404 };
    const other = await FeedInterativoStorage.userCard(pool, s.id_host === user.id_user ? s.id_guest : s.id_host);
    return { session: view(s, user.id_user), other: card(other) };
  }

  static async act(user, id_session, action, body = {}) {
    return runWithLogs(log, "act", () => ({ id_user: user?.id_user, id_session, action }), async () => {
      if (!user?.id_user) return notAuth();
      if (!UUID_RE.test(String(id_session || ""))) return { error: "id_session inválido" };
      const s = await getSession(id_session);
      if (!s || (s.id_host !== user.id_user && s.id_guest !== user.id_user)) return { error: "Sessão não encontrada", statusCode: 404 };
      const isHost = s.id_host === user.id_user;
      let q = null;
      if (action === "accept") {
        if (isHost) return { error: "Sem permissão", statusCode: 403 };
        if (s.status !== "invited") return { error: "Esse convite já não vale", statusCode: 409 };
        q = await pool.query(
          `UPDATE public.tb_feed_sync_session SET status = 'active', accepted_at = NOW()
            WHERE id_session = $1 AND status = 'invited' RETURNING *`,
          [id_session]
        );
      } else if (action === "decline" || action === "end") {
        if (s.status === "ended") return { session: view(s, user.id_user) };
        q = await pool.query(
          `UPDATE public.tb_feed_sync_session SET status = 'ended', ended_at = NOW(), ended_by = $2
            WHERE id_session = $1 AND status <> 'ended' RETURNING *`,
          [id_session, user.id_user]
        );
      } else if (action === "control") {
        if (!isHost) return { error: "Só quem convidou troca o controle", statusCode: 403 };
        const control = body.control === "shared" ? "shared" : "host";
        if (s.status !== "active") return { error: "A sessão não está ativa", statusCode: 409 };
        q = await pool.query(`UPDATE public.tb_feed_sync_session SET control = $2 WHERE id_session = $1 RETURNING *`, [id_session, control]);
      } else {
        return { error: "Ação inválida" };
      }
      const row = q.rows[0];
      if (!row) return { error: "A sessão mudou. Tente de novo.", statusCode: 409 };
      feedSync().sessionChanged(row);
      const type = action === "accept" ? "started" : action === "control" ? "control" : "ended";
      const payload = { type, id_session, control: row.control, by: user.id_user };
      realtime().emitToUser(row.id_host, "fi:sync", payload);
      realtime().emitToUser(row.id_guest, "fi:sync", payload);
      return { session: view(row, user.id_user) };
    });
  }

  /** Posts pelo id, no shape do card, com a régua do feed global para ESTE leitor. */
  static async posts(user, idsRaw) {
    if (!user?.id_user) return notAuth();
    const minorBlock = await assertMinorPermission(user.id_user, "can_view_feed");
    if (minorBlock) return minorBlock;
    const ids = String(idsRaw || "")
      .split(",")
      .map((x) => x.trim())
      .filter((x) => UUID_RE.test(x))
      .slice(0, 30);
    if (!ids.length) return { items: [] };
    const rows = await PortfolioFeedStorage.listEligibleByIds(pool, { ids, viewer_id_user: user.id_user });
    return { items: rows.map((r) => shapeRow(r)) };
  }

  /** Para o socket: a sessão está ativa e a pessoa é parte dela? */
  static async membership(id_session, id_user) {
    if (!UUID_RE.test(String(id_session || ""))) return null;
    const s = await getSession(id_session);
    if (!s || s.status !== "active") return null;
    if (s.id_host !== id_user && s.id_guest !== id_user) return null;
    return s;
  }
}

module.exports = FeedSyncService;
