// Paths (Feed Interativo F5, mig 458) — histórias com caminhos alternativos.
//
// O autor monta um grafo (nós + botões) e prende a história a UM post seu:
// no feed, esse post ganha o botão "Começar". Cada nó pode emprestar a mídia
// de outro post do PRÓPRIO autor. Quem assiste só vê história publicada cujo
// post (e cujas mídias) passam na régua do feed global — o mesmo
// listEligibleByIds do lançar: post de comunidade privada não vira história
// pública, nem empresta mídia para uma.

const crypto = require("node:crypto");
const pool = require("../databases");
const PathStorage = require("../storages/PathStorage");
const PortfolioFeedStorage = require("../storages/PortfolioFeedStorage");
const { shapeRow } = require("./portfolioFeed/PortfolioFeedService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("PathService");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIMITS = { nodes: 40, choices: 4, title: 80, body: 600, label: 40, stories: 50 };

function clean(raw, max) {
  if (typeof raw !== "string") return "";
  return raw
    // eslint-disable-next-line no-control-regex -- tirar caractere de controle é o objetivo
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function notAuth() {
  return { error: "Usuário não autenticado", statusCode: 401 };
}

function mapGraph(story, { nodes, choices }, { withStats }) {
  const byNode = new Map();
  for (const c of choices) {
    if (!byNode.has(c.id_node)) byNode.set(c.id_node, []);
    byNode.get(c.id_node).push({
      id: c.id_choice,
      label: c.label,
      target: c.id_target_node,
      ...(withStats ? { picks: c.picks_count } : {}),
    });
  }
  return {
    id_story: story.id_story,
    title: story.title,
    status: story.status,
    root: story.id_root_node,
    post_id: story.id_portfolio_item,
    ...(withStats ? { plays: story.plays_count } : {}),
    nodes: nodes.map((n) => ({
      id: n.id_node,
      title: n.title,
      body: n.body,
      is_ending: n.is_ending,
      media_post_id: n.id_media_item,
      x: n.pos_x,
      y: n.pos_y,
      ...(withStats ? { reach: n.reach_count } : {}),
      choices: n.is_ending ? [] : byNode.get(n.id_node) || [],
    })),
  };
}

/** Grafo publicável: raiz existe, todo nó que não é final tem botão, todo botão tem destino. */
function completeness(g) {
  const ids = new Set(g.nodes.map((n) => n.id));
  if (!g.root || !ids.has(g.root)) return "Escolha o começo da história";
  if (!g.nodes.some((n) => n.is_ending)) return "A história precisa de pelo menos um final";
  for (const n of g.nodes) {
    if (n.is_ending) continue;
    if (!n.choices.length) return `"${n.title || "Sem título"}" precisa de um botão ou virar final`;
    for (const c of n.choices) if (!c.target || !ids.has(c.target)) return `O botão "${c.label}" não leva a lugar nenhum`;
  }
  return null;
}

class PathService {
  static LIMITS = LIMITS;

  static async listMine(user) {
    if (!user?.id_user) return notAuth();
    return { stories: await PathStorage.listMine(pool, user.id_user) };
  }

  static async create(user, body = {}) {
    if (!user?.id_user) return notAuth();
    const mine = await PathStorage.listMine(pool, user.id_user);
    if (mine.length >= LIMITS.stories) return { error: "Você chegou ao limite de histórias", statusCode: 429 };
    const title = clean(body.title, LIMITS.title) || "Nova história";
    const story = await PathStorage.create(pool, { id_user: user.id_user, title });
    // Já nasce com o começo, para o editor não abrir vazio.
    const saved = await PathService.save(user, story.id_story, {
      title,
      root: "n:inicio",
      nodes: [{ id: "n:inicio", title: "Começo", body: "", is_ending: false, x: 0, y: 0, choices: [] }],
    });
    return saved.error ? saved : { story: saved.story };
  }

  static async getForEdit(user, id_story) {
    if (!user?.id_user) return notAuth();
    if (!UUID_RE.test(String(id_story || ""))) return { error: "id_story inválido" };
    const story = await PathStorage.getStory(pool, id_story);
    if (!story || story.id_user !== user.id_user) return { error: "História não encontrada", statusCode: 404 };
    return { story: mapGraph(story, await PathStorage.graph(pool, id_story), { withStats: true }) };
  }

  /**
   * Salva o grafo inteiro de uma vez (o editor manda tudo). Id que já é deste
   * grafo é mantido (os contadores ficam); id novo do editor ("n:…", "c:…")
   * vira uuid. Some do banco o que não veio.
   */
  static async save(user, id_story, body = {}) {
    return runWithLogs(log, "save", () => ({ id_user: user?.id_user, id_story }), async () => {
      if (!user?.id_user) return notAuth();
      if (!UUID_RE.test(String(id_story || ""))) return { error: "id_story inválido" };
      const story = await PathStorage.getStory(pool, id_story);
      if (!story || story.id_user !== user.id_user) return { error: "História não encontrada", statusCode: 404 };
      const nodesIn = Array.isArray(body.nodes) ? body.nodes : [];
      if (nodesIn.length < 1) return { error: "A história precisa de pelo menos um passo" };
      if (nodesIn.length > LIMITS.nodes) return { error: `No máximo ${LIMITS.nodes} passos por história` };

      const current = await PathStorage.graph(pool, id_story);
      const curNodes = new Set(current.nodes.map((n) => n.id_node));
      const curChoices = new Set(current.choices.map((c) => c.id_choice));
      const idMap = new Map();
      for (const n of nodesIn) {
        const raw = String(n?.id || "");
        if (idMap.has(raw)) return { error: "Passo repetido no envio" };
        idMap.set(raw, UUID_RE.test(raw) && curNodes.has(raw) ? raw : crypto.randomUUID());
      }
      const mediaIds = [...new Set(nodesIn.map((n) => n?.media_post_id).filter((x) => typeof x === "string" && UUID_RE.test(x)))];
      const owned = await PathStorage.ownedItems(pool, user.id_user, mediaIds);

      const nodes = [];
      for (const n of nodesIn) {
        const id = idMap.get(String(n.id || ""));
        const is_ending = !!n.is_ending;
        const choicesIn = is_ending ? [] : Array.isArray(n.choices) ? n.choices : [];
        if (choicesIn.length > LIMITS.choices) return { error: `No máximo ${LIMITS.choices} botões por passo` };
        const choices = [];
        for (const [i, c] of choicesIn.entries()) {
          const label = clean(c?.label, LIMITS.label);
          if (!label) return { error: "Todo botão precisa de um texto" };
          const rawC = String(c?.id || "");
          const target = idMap.get(String(c?.target || "")) || null;
          choices.push({ id: UUID_RE.test(rawC) && curChoices.has(rawC) ? rawC : crypto.randomUUID(), label, target, sort: i });
        }
        const media = typeof n.media_post_id === "string" && owned.has(n.media_post_id) ? n.media_post_id : null;
        nodes.push({
          id,
          title: clean(n.title, LIMITS.title),
          body: clean(n.body, LIMITS.body),
          is_ending,
          media,
          x: Math.max(-5000, Math.min(5000, Math.round(Number(n.x) || 0))),
          y: Math.max(-5000, Math.min(5000, Math.round(Number(n.y) || 0))),
          choices,
        });
      }
      const root = idMap.get(String(body.root || "")) || nodes[0].id;
      const title = clean(body.title, LIMITS.title) || story.title || "Nova história";
      const graph = { root, nodes: nodes.map((n) => ({ ...n, choices: n.choices })) };
      if (story.status === "published") {
        const problem = completeness(graph);
        if (problem) return { error: `Publicada precisa estar completa: ${problem}` };
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const keepNodes = nodes.map((n) => n.id);
        await client.query(
          `DELETE FROM public.tb_path_node WHERE id_story = $1 AND NOT (id_node = ANY($2::uuid[]))`,
          [id_story, keepNodes]
        );
        for (const n of nodes) {
          await client.query(
            `INSERT INTO public.tb_path_node (id_node, id_story, title, body, is_ending, id_media_item, pos_x, pos_y)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (id_node) DO UPDATE
                SET title = EXCLUDED.title, body = EXCLUDED.body, is_ending = EXCLUDED.is_ending,
                    id_media_item = EXCLUDED.id_media_item, pos_x = EXCLUDED.pos_x, pos_y = EXCLUDED.pos_y
              WHERE public.tb_path_node.id_story = EXCLUDED.id_story`,
            [n.id, id_story, n.title, n.body, n.is_ending, n.media, n.x, n.y]
          );
        }
        const keepChoices = nodes.flatMap((n) => n.choices.map((c) => c.id));
        await client.query(
          `DELETE FROM public.tb_path_choice c USING public.tb_path_node n
            WHERE c.id_node = n.id_node AND n.id_story = $1 AND NOT (c.id_choice = ANY($2::uuid[]))`,
          [id_story, keepChoices]
        );
        for (const n of nodes) {
          for (const c of n.choices) {
            await client.query(
              `INSERT INTO public.tb_path_choice (id_choice, id_node, label, id_target_node, sort)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (id_choice) DO UPDATE
                  SET id_node = EXCLUDED.id_node, label = EXCLUDED.label,
                      id_target_node = EXCLUDED.id_target_node, sort = EXCLUDED.sort`,
              [c.id, n.id, c.label, c.target, c.sort]
            );
          }
        }
        await client.query(
          `UPDATE public.tb_path_story SET title = $2, id_root_node = $3, updated_at = NOW() WHERE id_story = $1`,
          [id_story, title, root]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
      const fresh = await PathStorage.getStory(pool, id_story);
      return { story: mapGraph(fresh, await PathStorage.graph(pool, id_story), { withStats: true }) };
    });
  }

  /** Publica: prende a um post do autor que passa na régua do feed global. */
  static async publish(user, id_story, body = {}) {
    return runWithLogs(log, "publish", () => ({ id_user: user?.id_user, id_story }), async () => {
      if (!user?.id_user) return notAuth();
      const edit = await PathService.getForEdit(user, id_story);
      if (edit.error) return edit;
      const problem = completeness(edit.story);
      if (problem) return { error: problem };
      const post_id = String(body.post_id || "");
      if (!UUID_RE.test(post_id)) return { error: "Escolha o post que vai carregar a história" };
      const owned = await PathStorage.ownedItems(pool, user.id_user, [post_id]);
      if (!owned.has(post_id)) return { error: "Esse post não é seu", statusCode: 403 };
      const ok = await PortfolioFeedStorage.listEligibleByIds(pool, { ids: [post_id] });
      if (ok.length === 0) return { error: "Esse post não aparece no feed público", statusCode: 403 };
      const other = await PathStorage.storyByPost(pool, post_id);
      if (other && other.id_story !== id_story) return { error: "Esse post já carrega outra história", statusCode: 409 };
      await pool.query(
        `UPDATE public.tb_path_story
            SET status = 'published', id_portfolio_item = $2, published_at = COALESCE(published_at, NOW()), updated_at = NOW()
          WHERE id_story = $1`,
        [id_story, post_id]
      );
      return PathService.getForEdit(user, id_story);
    });
  }

  static async unpublish(user, id_story) {
    if (!user?.id_user) return notAuth();
    const edit = await PathService.getForEdit(user, id_story);
    if (edit.error) return edit;
    await pool.query(`UPDATE public.tb_path_story SET status = 'draft', updated_at = NOW() WHERE id_story = $1`, [id_story]);
    return PathService.getForEdit(user, id_story);
  }

  static async remove(user, id_story) {
    if (!user?.id_user) return notAuth();
    const edit = await PathService.getForEdit(user, id_story);
    if (edit.error) return edit;
    await pool.query(`DELETE FROM public.tb_path_story WHERE id_story = $1`, [id_story]);
    return { ok: true };
  }

  /**
   * A história para quem ASSISTE (pelo post do feed). Só publicada, só se o
   * post passa na régua, e a mídia de cada nó também (senão o nó fica sem mídia).
   */
  static async forPlayer(viewer, post_id) {
    if (!UUID_RE.test(String(post_id || ""))) return { error: "post_id inválido" };
    const story = await PathStorage.storyByPost(pool, post_id);
    if (!story) return { error: "História não encontrada", statusCode: 404 };
    const root = await PortfolioFeedStorage.listEligibleByIds(pool, { ids: [post_id], viewer_id_user: viewer?.id_user || null });
    if (root.length === 0) return { error: "História não encontrada", statusCode: 404 };
    const g = mapGraph(story, await PathStorage.graph(pool, story.id_story), { withStats: false });
    const mediaIds = [...new Set(g.nodes.map((n) => n.media_post_id).filter(Boolean))];
    const rows = mediaIds.length ? await PortfolioFeedStorage.listEligibleByIds(pool, { ids: mediaIds }) : [];
    const media = new Map(rows.map((r) => [r.post_id, shapeRow(r).media?.[0] || null]));
    return {
      story: {
        id_story: g.id_story,
        title: g.title,
        root: g.root,
        nodes: g.nodes.map((n) => {
          const { media_post_id, x, y, ...rest } = n;
          void x;
          void y;
          return { ...rest, media: media_post_id ? media.get(media_post_id) || null : null };
        }),
      },
    };
  }

  static async play(id_story) {
    if (!UUID_RE.test(String(id_story || ""))) return { error: "id_story inválido" };
    const ok = await PathStorage.addPlay(pool, id_story);
    return ok ? { ok: true } : { error: "História não encontrada", statusCode: 404 };
  }

  static async pick(id_story, body = {}) {
    if (!UUID_RE.test(String(id_story || "")) || !UUID_RE.test(String(body.id_choice || ""))) return { error: "Escolha inválida" };
    const r = await PathStorage.addPick(pool, id_story, String(body.id_choice));
    return r ? { ok: true, target: r.target } : { error: "Escolha não encontrada", statusCode: 404 };
  }
}

module.exports = PathService;
