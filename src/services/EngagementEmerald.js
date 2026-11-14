// A7 — Verde Esmeralda por ENGAJAMENTO (mig 333). Roda DENTRO da transação do
// evento (a mesma do alcance do A1, ReachStorage): curtiu e ganhou, ou nada.
//
// Quem engaja (actor), por ação, uma vez (dedupe por source/source_id):
//   curtir 1 · salvar 2 · comentar 3 (≥ 10 caracteres) · compartilhar 5
//   desfazer (descurtir, tirar dos salvos, apagar o comentário) estorna.
//   Refazer depois de desfazer NÃO paga de novo (a chave da ação já foi usada).
// Dono do post: 1 Esmeralda a cada 10 pontos de alcance que OUTRA conta
//   logada deu (reach_emerald_acc/paid no post; desfazer não devolve e refazer
//   não paga de novo).
// Só conta interação entre contas distintas e ativas: nada para o próprio
// post, nada de anônimo. Teto diário SOMADO (ator + dono) em
// emerald_settings.engagement_daily_cap (500, dia de Brasília).
const EmeraldStorage = require("../storages/EmeraldStorage");

const ACTION_POINTS = Object.freeze({ like: "points_like", save: "points_save", comment: "points_comment", share: "points_share" });
const TYPES = ["earn_engagement", "earn_reach"];
const TABLES = Object.freeze({
  post: {
    table: "public.tb_profile_portfolio_item",
    id: "id_portfolio_item",
    owner: `(SELECT p.id_user FROM public.tb_profile p WHERE p.id_profile = x.id_profile)`,
  },
  bee: { table: "public.tb_story", id: "id_story", owner: `x.id_user` },
});

async function context(client, kind, id, actor) {
  const t = TABLES[kind];
  if (!t || !actor) return null;
  const { rows } = await client.query(
    `SELECT ${t.owner} AS owner,
            (SELECT COALESCE(u.ativo, FALSE) FROM public.tb_user u WHERE u.id_user = $2) AS actor_ok
       FROM ${t.table} x WHERE x.${t.id} = $1`,
    [id, actor]
  );
  const r = rows[0];
  if (!r || !r.owner || !r.actor_ok) return null;
  if (String(r.owner) === String(actor)) return null; // o próprio post não rende
  const settings = await EmeraldStorage.getSettings(client);
  if (!settings || settings.is_active === false || settings.engagement_enabled === false) return null;
  return { owner: r.owner, settings };
}

/**
 * A2-07: trava o PAR (ator e dono) até o fim da transação, em ordem FIXA, antes de ler o teto.
 * Sem ela, duas ações em paralelo liam o mesmo "quanto já ganhou hoje" e as duas pagavam (teto
 * furado). Ordem fixa porque a mesma transação credita o ator e o dono: A engajando em B enquanto
 * B engaja em A travaria em ordens trocadas (deadlock). Reentrante na mesma transação.
 */
async function lockPair(client, a, b) {
  const ids = [...new Set([a, b].filter(Boolean).map(String))].sort();
  for (const id of ids) await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`emerald:engajamento:${id}`]);
}

/** Quanto ainda cabe hoje para esta pessoa (ator ou dono). */
async function room(client, user_id, settings) {
  const cap = Math.max(0, Number(settings.engagement_daily_cap) || 0);
  if (!cap) return 0;
  const today = await EmeraldStorage.sumToday(client, user_id, TYPES);
  return Math.max(0, cap - today);
}

class EngagementEmerald {
  /**
   * Ação de quem engaja. sign +1 = fez, −1 = desfez. `ref` distingue ações
   * repetíveis (o id do comentário); `chars` = tamanho do comentário.
   */
  static async actor(client, { kind, id, actor, action, sign = 1, ref = null, chars = null }) {
    const key = ACTION_POINTS[action];
    if (!key || !actor || !id) return null;
    const sourceId = `${action}:${kind}:${id}:${actor}${ref ? `:${ref}` : ""}`;
    if (sign < 0) {
      const done = await EmeraldStorage.findPosted(client, "engagement", sourceId);
      if (!done) return null;
      const wallet = await EmeraldStorage.getOrCreateWallet(client, actor);
      return EmeraldStorage.reverseCredit(client, {
        user_id: actor, wallet_id: wallet.id, amount: done.amount,
        source: "engagement_reversal", source_id: sourceId,
        metadata: { reverses: "earn_engagement", action, kind, id },
      });
    }
    const ctx = await context(client, kind, id, actor);
    if (!ctx) return null;
    if (action === "comment" && (Number(chars) || 0) < (Number(ctx.settings.comment_min_chars) || 0)) return null;
    const points = Math.max(0, Number(ctx.settings[key]) || 0);
    await lockPair(client, actor, ctx.owner);
    const amount = Math.min(points, await room(client, actor, ctx.settings));
    if (amount <= 0) return null;
    const wallet = await EmeraldStorage.getOrCreateWallet(client, actor);
    return EmeraldStorage.credit(client, {
      user_id: actor, wallet_id: wallet.id, amount,
      type: "earn_engagement", source: "engagement", source_id: sourceId,
      metadata: { action, kind, id, owner: ctx.owner },
    });
  }

  /** Pontos de alcance que `actor` deu ao post: o dono acumula e recebe 1/10. */
  static async owner(client, { kind, id, actor, points }) {
    const p = Number(points) || 0;
    if (p <= 0) return null;
    const ctx = await context(client, kind, id, actor);
    if (!ctx) return null;
    await lockPair(client, actor, ctx.owner);
    const t = TABLES[kind];
    const per = Math.max(1, Number(ctx.settings.reach_points_per_emerald) || 10);
    const { rows } = await client.query(
      `UPDATE ${t.table}
          SET reach_emerald_acc = reach_emerald_acc + $2::numeric
        WHERE ${t.id} = $1
        RETURNING reach_emerald_acc, reach_emerald_paid`,
      [id, p]
    );
    const row = rows[0];
    if (!row) return null;
    const owed = Math.floor(Number(row.reach_emerald_acc) / per) - Number(row.reach_emerald_paid);
    if (owed <= 0) return null;
    const amount = Math.min(owed, await room(client, ctx.owner, ctx.settings));
    if (amount <= 0) return null;
    const paidAfter = Number(row.reach_emerald_paid) + amount;
    const wallet = await EmeraldStorage.getOrCreateWallet(client, ctx.owner);
    const res = await EmeraldStorage.credit(client, {
      user_id: ctx.owner, wallet_id: wallet.id, amount,
      type: "earn_reach", source: "reach", source_id: `${kind}:${id}:${paidAfter}`,
      metadata: { kind, id, per },
    });
    if (res) {
      await client.query(`UPDATE ${t.table} SET reach_emerald_paid = $2 WHERE ${t.id} = $1`, [id, paidAfter]);
    }
    return res;
  }
}

module.exports = EngagementEmerald;
