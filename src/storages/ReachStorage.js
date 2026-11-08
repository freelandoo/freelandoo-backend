// src/storages/ReachStorage.js
// Gravação do ALCANCE do post/bee (mig 328). Toda função que muda pontos roda
// dentro da transação de quem grava o evento (recebe o `client` já em BEGIN):
// contador, pontos e promoção de degrau entram ou saem juntos — sem job.
// Pesos/curva/limiares: utils/feedReach.js.
const {
  REACH_WEIGHTS,
  UNIQUE_ACTIONS,
  SHARE_WINDOW_HOURS,
  REACH_LEVEL,
  sharePoints,
  retentionPoints,
  nextReachLevel,
} = require("../utils/feedReach");
const { momentumNowSql } = require("../utils/beeLife");

const TARGETS = Object.freeze({
  post: {
    table: "public.tb_profile_portfolio_item",
    id: "id_portfolio_item",
    dislike: "public.tb_portfolio_dislike",
  },
  bee: {
    table: "public.tb_story",
    id: "id_story",
    dislike: "public.tb_story_dislike",
  },
});

function target(kind) {
  const t = TARGETS[kind];
  if (!t) throw new Error(`alvo de alcance inválido: ${kind}`);
  return t;
}

// Pessoa para as ações únicas: logado = usuário; anônimo = sessão.
function viewerKey({ id_user, session_id } = {}) {
  if (id_user) return `u:${id_user}`;
  if (typeof session_id === "string" && session_id.trim()) return `s:${session_id.trim().slice(0, 64)}`;
  return null;
}

// Fórmula do engagement_score do post (a mesma de RankingStorage.toggleLike e
// PortfolioEventStorage) — usada quando o "não gostei" tira a curtida.
const POST_SCORE_SQL = `
    likes_count            * 1
  + shares_count           * 3
  + profile_clicks_count   * 4
  + whatsapp_clicks_count  * 6
  + social_clicks_count    * 2`;

class ReachStorage {
  /**
   * Roda `fn(client)` numa transação. Se `db` já é um client (tem release),
   * usa ele sem abrir outra — quem chamou cuida do BEGIN/COMMIT.
   */
  static async inTx(db, fn) {
    if (typeof db.release === "function") return fn(db);
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const out = await fn(client);
      await client.query("COMMIT");
      return out;
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Soma `delta` aos pontos (nunca abaixo de 0) e promove o degrau se os
   * pontos passaram o limiar do post. Só sobe. Devolve o estado novo.
   */
  static async addPoints(client, kind, id, delta, actor = null) {
    const t = target(kind);
    const d = Number(delta) || 0;
    if (!d) return null;
    // A7: pontos que OUTRA conta deu viram Esmeralda para o dono (1 a cada 10).
    if (actor && d > 0) {
      await require("../services/EngagementEmerald").owner(client, { kind, id, actor, points: d });
    }
    // Bee: o mesmo ponto alimenta o EMBALO (vida do bee, utils/beeLife.js).
    const embalo = kind === "bee"
      ? `, momentum = GREATEST(${momentumNowSql("tb_story")} + $2::numeric, 0),
             momentum_peak = GREATEST(momentum_peak, ${momentumNowSql("tb_story")} + $2::numeric),
             momentum_at = NOW()`
      : "";
    const { rows } = await client.query(
      `UPDATE ${t.table}
          SET reach_points = GREATEST(reach_points + $2::numeric, 0)${embalo}
        WHERE ${t.id} = $1
        RETURNING ${t.id} AS id, reach_points, reach_level,
                  reach_area_id, reach_region_id, reach_uf`,
      [id, d]
    );
    const row = rows[0];
    if (!row) return null;
    const points = Number(row.reach_points) || 0;
    const current = Number(row.reach_level) || 0;
    const level = nextReachLevel(current, points, row.id, {
      area_id: row.reach_area_id,
      region_id: row.reach_region_id,
      uf: row.reach_uf,
    });
    if (level > current) {
      await ReachStorage.raiseLevel(client, kind, id, level);
    }
    return { points, level, promoted: level > current };
  }

  /**
   * Força o degrau para no MÍNIMO `level` (só sobe). Porta reutilizável:
   * A2 (vitrine "dívidas" = Brasil) e A5 (alcance comprado numa região).
   */
  static async raiseLevel(client, kind, id, level) {
    const t = target(kind);
    const l = Math.min(Math.max(Math.floor(Number(level) || 0), REACH_LEVEL.CITY), REACH_LEVEL.COUNTRY);
    const { rows } = await client.query(
      `UPDATE ${t.table}
          SET reach_level = $2::smallint, reach_level_at = NOW()
        WHERE ${t.id} = $1 AND reach_level < $2::smallint
        RETURNING reach_level`,
      [id, l]
    );
    return rows.length > 0;
  }

  /**
   * Ação que vale uma vez por pessoa (view, profile_click, whatsapp_click,
   * share). Grava a marca; se é a primeira, soma os pontos (compartilhamento
   * × velocidade das últimas 6 h).
   */
  static async recordUnique(client, kind, id, viewer, action) {
    target(kind);
    if (!UNIQUE_ACTIONS.includes(action)) return { counted: false };
    const key = viewerKey(viewer);
    if (!key) return { counted: false };
    const ins = await client.query(
      `INSERT INTO public.tb_reach_action (target_kind, id_target, action, viewer_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING
       RETURNING 1`,
      [kind, id, action, key]
    );
    if (!ins.rows.length) return { counted: false };
    let pts = REACH_WEIGHTS[action];
    if (action === "share") {
      const recent = await client.query(
        `SELECT COUNT(*)::int AS n
           FROM public.tb_reach_action
          WHERE target_kind = $1 AND id_target = $2 AND action = 'share'
            AND created_at >= NOW() - make_interval(hours => $3::int)`,
        [kind, id, SHARE_WINDOW_HOURS]
      );
      pts = sharePoints(recent.rows[0]?.n || 1);
    }
    const actor = viewer?.id_user || null;
    const state = await ReachStorage.addPoints(client, kind, id, pts, actor);
    // A7: compartilhar rende Esmeralda a quem compartilhou (uma vez por post).
    if (action === "share" && actor) {
      await require("../services/EngagementEmerald").actor(client, { kind, id, actor, action: "share" });
    }
    return { counted: true, points_added: pts, ...(state || {}) };
  }

  // Retenção: +1 a cada 10 s, pela diferença do total assistido na sessão.
  static async addRetention(client, kind, id, prevSeconds, newSeconds) {
    const pts = retentionPoints(prevSeconds, newSeconds);
    if (!pts) return null;
    return ReachStorage.addPoints(client, kind, id, pts);
  }

  // Curtida/salvo/comentário: delta já com sinal (+1 = fez, −1 = desfez).
  // `who` ({ actor, ref, chars }) = quem fez (A7: Esmeralda por engajamento).
  static async addWeighted(client, kind, id, weightKey, sign = 1, who = null) {
    const w = REACH_WEIGHTS[weightKey];
    if (!w) return null;
    const s = sign < 0 ? -1 : 1;
    const actor = who?.actor || null;
    const out = await ReachStorage.addPoints(client, kind, id, w * s, actor);
    if (actor && ["like", "save", "comment"].includes(weightKey)) {
      await require("../services/EngagementEmerald").actor(client, {
        kind, id, actor, action: weightKey, sign: s, ref: who.ref || null, chars: who.chars ?? null,
      });
    }
    return out;
  }

  /**
   * Tira o "não gostei" da pessoa, se houver (curtir é exclusivo com ele).
   * Devolve true quando tirou. Os 2 pontos voltam.
   */
  static async removeDislike(client, kind, id, id_user) {
    const t = target(kind);
    const del = await client.query(
      `DELETE FROM ${t.dislike} WHERE ${t.id} = $1 AND id_user = $2 RETURNING 1`,
      [id, id_user]
    );
    if (!del.rows.length) return false;
    await client.query(
      `UPDATE ${t.table} SET dislikes_count = GREATEST(dislikes_count - 1, 0) WHERE ${t.id} = $1`,
      [id]
    );
    await ReachStorage.addPoints(client, kind, id, -REACH_WEIGHTS.dislike);
    return true;
  }

  /**
   * Liga/desliga o "não gostei" (um por pessoa). Ligar tira a curtida.
   * O contador não sai em projeção pública — só pesa no alcance.
   */
  static async toggleDislike(pool, kind, { id, id_user }) {
    const t = target(kind);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const removed = await ReachStorage.removeDislike(client, kind, id, id_user);
      if (removed) {
        await client.query("COMMIT");
        return { disliked: false, liked: false, likes_count: null };
      }
      await client.query(
        `INSERT INTO ${t.dislike} (${t.id}, id_user) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [id, id_user]
      );
      await client.query(
        `UPDATE ${t.table} SET dislikes_count = dislikes_count + 1 WHERE ${t.id} = $1`,
        [id]
      );
      await ReachStorage.addPoints(client, kind, id, REACH_WEIGHTS.dislike);

      // Exclusivo com a curtida: tira a curtida e os 5 pontos dela.
      let likes_count = null;
      if (kind === "post") {
        const unlike = await client.query(
          `DELETE FROM public.portfolio_likes WHERE id_portfolio_item = $1 AND id_user = $2 RETURNING 1`,
          [id, id_user]
        );
        if (unlike.rows.length) {
          await client.query(
            `UPDATE public.tb_profile_portfolio_item
                SET likes_count = GREATEST(likes_count - 1, 0)
              WHERE id_portfolio_item = $1`,
            [id]
          );
          const r = await client.query(
            `UPDATE public.tb_profile_portfolio_item
                SET engagement_score = ${POST_SCORE_SQL}
              WHERE id_portfolio_item = $1
              RETURNING likes_count`,
            [id]
          );
          likes_count = r.rows[0]?.likes_count ?? null;
          await ReachStorage.addPoints(client, kind, id, -REACH_WEIGHTS.like);
        }
      } else {
        const unlike = await client.query(
          `DELETE FROM public.tb_story_like WHERE id_story = $1 AND id_user = $2 RETURNING 1`,
          [id, id_user]
        );
        if (unlike.rows.length) {
          // require tardio: BeeEngagementStorage também chama esta classe.
          const BeeEngagementStorage = require("./BeeEngagementStorage");
          // _bumpCounter já tira os 5 pontos da curtida.
          const c = await BeeEngagementStorage._bumpCounter(client, id, "likes_count", -1);
          likes_count = c?.likes_count ?? null;
        }
      }
      await client.query("COMMIT");
      return { disliked: true, liked: false, likes_count };
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Lugar do leitor = o do perfil-conta (mesma régua do lugar do autor:
   * fl_reach_place). null = sem conta ou sem lugar.
   */
  static async viewerPlace(db, id_user) {
    if (!id_user) return null;
    const { rows } = await db.query(
      `SELECT pl.city_key, pl.area_id, pl.region_id, pl.uf
         FROM public.tb_profile acc
         CROSS JOIN LATERAL fl_reach_place(acc.id_profile) pl
        WHERE acc.id_user = $1 AND acc.is_user_account = TRUE AND acc.deleted_at IS NULL
        ORDER BY acc.created_at
        LIMIT 1`,
      [id_user]
    );
    const r = rows[0];
    if (!r || (!r.uf && !r.city_key)) return null;
    return {
      city_key: r.city_key || null,
      area_id: r.area_id ?? null,
      region_id: r.region_id ?? null,
      uf: r.uf || null,
    };
  }
}

module.exports = ReachStorage;
module.exports.viewerKey = viewerKey;
module.exports.TARGETS = TARGETS;
