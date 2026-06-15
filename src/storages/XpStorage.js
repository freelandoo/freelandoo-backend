// src/storages/XpStorage.js
const { createLogger } = require("../utils/logger");
const PolenStorage = require("./PolenStorage");

const log = createLogger("XpStorage");

// ─────────────────────────────────────────────────────────────────────────────
// XP Level math
// xpForLevel(N) = base * (mult^N - 1) / (mult - 1)  — geometric series sum
// Level 0: < base XP
// Level 1: exactly base XP
// ─────────────────────────────────────────────────────────────────────────────
function xpForLevel(level, base, mult) {
  if (level <= 0) return 0;
  if (mult <= 1) return base * level;
  return Math.round(base * (Math.pow(mult, level) - 1) / (mult - 1));
}

function levelFromXp(xpTotal, base, mult) {
  if (!base || base <= 0 || !mult || mult <= 1) return 0;
  if (xpTotal < base) return 0;
  const n = Math.log(xpTotal * (mult - 1) / base + 1) / Math.log(mult);
  return Math.floor(n);
}

const XP_EVENT_FIELD = {
  profile_activated:        "profile_activation_xp",
  affiliate_sale_confirmed: "affiliate_sale_xp",
  profile_renewed:          "renewal_xp",
  like_received:            "like_received_xp",
  share_received:           "share_received_xp",
  follow_received:          "follow_received_xp",
  whatsapp_click:           "whatsapp_click_xp",
  post_approved:            "approved_post_xp",
  online_time:              "online_minute_xp",
  profile_visit:            "profile_visit_xp",
  review_received:          "review_received_xp",
  content_retention:         "content_retention_second_xp",
};

module.exports = {
  xpForLevel,
  levelFromXp,

  // ──────────────────────────────────────────────────────────────────────────
  // SETTINGS
  // ──────────────────────────────────────────────────────────────────────────
  async getSettings(db) {
    const r = await db.query("SELECT * FROM xp_settings WHERE id = 1");
    return r.rows[0] ?? null;
  },

  async updateSettings(db, fields, admin_id) {
    const ALLOWED = Object.values(XP_EVENT_FIELD).concat([
      "is_active",
      "base_xp_level_1",
      "level_multiplier",
      "max_online_minutes",
      "polens_per_level",
    ]);

    const sets = ["updated_at = NOW()"];
    const vals = [];
    let idx = 1;

    for (const key of ALLOWED) {
      if (key in fields && fields[key] != null) {
        sets.push(`${key} = $${idx++}`);
        vals.push(fields[key]);
      }
    }
    if (admin_id) {
      sets.push(`updated_by_admin_id = $${idx++}`);
      vals.push(admin_id);
    }
    if (sets.length === 1) return this.getSettings(db);

    const r = await db.query(
      `UPDATE xp_settings SET ${sets.join(", ")} WHERE id = 1 RETURNING *`,
      vals
    );
    return r.rows[0];
  },

  // ──────────────────────────────────────────────────────────────────────────
  // EVENTS
  // ──────────────────────────────────────────────────────────────────────────

  // Insert a single XP event. Idempotent via unique index on (profile, event,
  // source_type, source_id). Returns { inserted: true/false }.
  async addEvent(db, { id_profile, event_type, source_type, source_id, xp_amount, metadata }) {
    try {
      const r = await db.query(
        `INSERT INTO subprofile_xp_events
           (id_profile, event_type, source_type, source_id, xp_amount, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id_profile, event_type, source_type, source_id)
           WHERE source_type IS NOT NULL AND source_id IS NOT NULL
           DO NOTHING
         RETURNING id`,
        [
          id_profile,
          event_type,
          source_type ?? null,
          source_id ?? null,
          xp_amount,
          metadata ? JSON.stringify(metadata) : null,
        ]
      );
      return { inserted: r.rows.length > 0 };
    } catch (err) {
      log.error("addEvent.fail", { id_profile, event_type, error: err.message });
      return { inserted: false };
    }
  },

  // Recalculate xp_total and xp_level from events + settings. Updates tb_profile.
  // Also propagates the average to the clan this profile belongs to (if any).
  async recalcProfileXp(db, id_profile) {
    const settings = await this.getSettings(db);
    if (!settings) return null;
    const base = Number(settings.base_xp_level_1);
    const mult = Number(settings.level_multiplier);

    // Edge case guard — mult must be > 1 for log formula to work
    const levelExpr = mult > 1
      ? `CASE
           WHEN total < $2 THEN 0
           ELSE FLOOR(LN(total * ($3 - 1.0) / $2 + 1.0) / LN($3))::int
         END`
      : `FLOOR(total / $2)::int`;

    const r = await db.query(
      `WITH agg AS (
         SELECT COALESCE(SUM(xp_amount), 0)::numeric AS total
           FROM subprofile_xp_events
          WHERE id_profile = $1
       ),
       prev AS (
         SELECT xp_level AS old_level, is_clan, id_user
           FROM tb_profile
          WHERE id_profile = $1
       )
       UPDATE tb_profile
          SET xp_total = agg.total,
              xp_level = (SELECT ${levelExpr} FROM agg)
         FROM agg, prev
        WHERE tb_profile.id_profile = $1
        RETURNING tb_profile.xp_total, tb_profile.xp_level,
                  prev.old_level, prev.is_clan, prev.id_user`,
      [id_profile, base, mult]
    );

    const row = r.rows[0] ?? null;

    // Crédito de Poléns por subida de nível (só subperfil não-clã, forward-only).
    // Como xp_total só cresce e o nível é monotônico, o delta > 0 ocorre uma vez
    // por nível cruzado — sem risco de crédito duplicado.
    if (row && row.is_clan === false && row.id_user) {
      const oldLevel = Number(row.old_level) || 0;
      const newLevel = Number(row.xp_level) || 0;
      const perLevel = Number(settings.polens_per_level) || 0;
      if (newLevel > oldLevel && perLevel > 0) {
        await this.creditLevelUpPolens(db, {
          user_id: row.id_user,
          id_profile,
          old_level: oldLevel,
          new_level: newLevel,
          per_level: perLevel,
        });
      }
    }

    // Propagate to the clan this profile belongs to (clan XP = AVG of members)
    await this.recalcClanXp(db, id_profile, { base, mult });

    // Propaga para as comunidades lideradas por este user (XP da comunidade =
    // espelho do XP do líder + acumulador). Require lazy: evita ciclo de import
    // (CommunityXpService → XpStorage). Fire-and-forget safe.
    if (row && row.id_user) {
      try {
        const CommunityXpService = require("../services/CommunityXpService");
        await CommunityXpService.recalcForLeaderUser(db, row.id_user);
      } catch (err) {
        log.error("recalcCommunityXp.fail", { id_profile, error: err.message });
      }
    }

    return row;
  },

  // Credita Poléns na carteira do usuário dono por cada nível cruzado.
  // Fire-and-forget safe — nunca derruba o recálculo de XP.
  async creditLevelUpPolens(db, { user_id, id_profile, old_level, new_level, per_level }) {
    try {
      const wallet = await PolenStorage.getOrCreateWallet(db, user_id);
      for (let lvl = old_level + 1; lvl <= new_level; lvl++) {
        await PolenStorage.credit(db, {
          user_id,
          wallet_id: wallet.id,
          amount: per_level,
          type: "earn_level_up",
          source: "xp_level_up",
          source_id: `${id_profile}:${lvl}`,
          metadata: { id_profile, level: lvl, per_level },
        });
      }
      log.info("creditLevelUpPolens.ok", {
        id_profile,
        user_id,
        levels: new_level - old_level,
        polens: per_level * (new_level - old_level),
      });
    } catch (err) {
      log.error("creditLevelUpPolens.fail", { id_profile, user_id, error: err.message });
    }
  },

  // Update clan xp_total = AVG(members xp_total) and recalculate xp_level.
  // id_member_profile is any member of the clan (used to look up which clan).
  async recalcClanXp(db, id_member_profile, settings_cache) {
    const memberRow = await db.query(
      `SELECT id_clan_profile FROM tb_clan_member WHERE id_member_profile = $1`,
      [id_member_profile]
    );
    if (!memberRow.rows.length) return;
    const id_clan_profile = memberRow.rows[0].id_clan_profile;

    let base, mult;
    if (settings_cache) {
      base = Number(settings_cache.base);
      mult = Number(settings_cache.mult);
    } else {
      const settings = await this.getSettings(db);
      if (!settings) return;
      base = Number(settings.base_xp_level_1);
      mult = Number(settings.level_multiplier);
    }

    const levelExpr = mult > 1
      ? `CASE
           WHEN avg_xp < $2 THEN 0
           ELSE FLOOR(LN(avg_xp * ($3 - 1.0) / $2 + 1.0) / LN($3))::int
         END`
      : `FLOOR(avg_xp / $2)::int`;

    await db.query(
      `WITH agg AS (
         SELECT COALESCE(AVG(p.xp_total), 0)::numeric AS avg_xp
           FROM tb_clan_member m
           JOIN tb_profile p ON p.id_profile = m.id_member_profile
          WHERE m.id_clan_profile = $1
            AND p.deleted_at IS NULL
       )
       UPDATE tb_profile
          SET xp_total = agg.avg_xp,
              xp_level = (SELECT ${levelExpr} FROM agg)
         FROM agg
        WHERE id_profile = $1`,
      [id_clan_profile, base, mult]
    );
  },

  // Main entry point: validate + insert event + recalculate profile XP.
  // Fire-and-forget safe — catches all errors internally.
  async award(db, { id_profile, event_type, source_type, source_id, metadata, unit_count }) {
    try {
      const settings = await this.getSettings(db);
      if (!settings || !settings.is_active) return;

      const field = XP_EVENT_FIELD[event_type];
      if (!field) return;

      const units = Math.max(1, Number(unit_count ?? 1));
      const xp_amount = Number(settings[field] ?? 0) * units;
      if (xp_amount <= 0) return;

      // Only award to non-clan active subprofiles
      const profCheck = await db.query(
        `SELECT 1
           FROM tb_profile
          WHERE id_profile = $1
            AND is_clan = FALSE
            AND deleted_at IS NULL`,
        [id_profile]
      );
      if (!profCheck.rows.length) return;

      const { inserted } = await this.addEvent(db, {
        id_profile,
        event_type,
        source_type,
        source_id,
        xp_amount,
        metadata,
      });

      if (inserted) {
        await this.recalcProfileXp(db, id_profile);
      }
    } catch (err) {
      log.error("award.fail", { id_profile, event_type, error: err.message });
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // QUERIES
  // ──────────────────────────────────────────────────────────────────────────
  async getXpSummary(db, id_profile) {
    const settings = await this.getSettings(db);
    const base = Number(settings?.base_xp_level_1 ?? 5000);
    const mult = Number(settings?.level_multiplier ?? 1.4);

    const r = await db.query(
      `SELECT xp_total, xp_level
         FROM tb_profile
        WHERE id_profile = $1 AND deleted_at IS NULL`,
      [id_profile]
    );
    const row = r.rows[0];
    if (!row) return null;

    const xp_total = Number(row.xp_total);
    const xp_level = Number(row.xp_level);
    const xp_current_level = xpForLevel(xp_level, base, mult);
    const xp_next_level = xpForLevel(xp_level + 1, base, mult);
    const range = xp_next_level - xp_current_level;
    const xp_missing = Math.max(0, xp_next_level - xp_total);
    const xp_progress_percent =
      range > 0
        ? Math.min(100, Math.round(((xp_total - xp_current_level) / range) * 100))
        : 100;

    return {
      xp_total,
      xp_level,
      level: xp_level,
      xp_current_level,
      xp_next_level,
      xp_missing,
      xp_progress_percent,
    };
  },

  async getXpSummaries(db, profileIds) {
    const ids = Array.from(new Set((profileIds || []).filter(Boolean)));
    if (!ids.length) return new Map();

    const settings = await this.getSettings(db);
    const base = Number(settings?.base_xp_level_1 ?? 5000);
    const mult = Number(settings?.level_multiplier ?? 1.4);

    const r = await db.query(
      `SELECT id_profile, COALESCE(xp_total, 0) AS xp_total, COALESCE(xp_level, 0) AS xp_level
         FROM tb_profile
        WHERE id_profile = ANY($1::uuid[])
          AND deleted_at IS NULL`,
      [ids]
    );

    const map = new Map();
    for (const row of r.rows) {
      const xp_total = Number(row.xp_total ?? 0);
      const xp_level = Number(row.xp_level ?? 0);
      const xp_current_level = xpForLevel(xp_level, base, mult);
      const xp_next_level = xpForLevel(xp_level + 1, base, mult);
      const range = xp_next_level - xp_current_level;
      const xp_missing = Math.max(0, xp_next_level - xp_total);
      const xp_progress_percent =
        range > 0
          ? Math.min(100, Math.max(0, Math.round(((xp_total - xp_current_level) / range) * 100)))
          : 100;

      map.set(String(row.id_profile), {
        xp_total,
        xp_level,
        level: xp_level,
        xp_current_level,
        xp_next_level,
        xp_missing,
        xp_progress_percent,
      });
    }

    return map;
  },

  async getXpEvents(db, id_profile, { limit = 20, offset = 0 } = {}) {
    const r = await db.query(
      `SELECT id, event_type, source_type, source_id, xp_amount, metadata, created_at
         FROM subprofile_xp_events
        WHERE id_profile = $1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [id_profile, Math.min(limit, 100), offset]
    );
    return r.rows;
  },

  // Feed amigável para a página de XP do usuário: as N coisas mais recentes
  // que deram ponto. O tempo online (gravado por minuto) é AGREGADO por hora —
  // cada bucket vira uma linha tipo "Tempo online (~1h) +15 XP". Os demais
  // eventos aparecem individualmente. `minutes` só vem para online_time.
  async getXpFeed(db, id_profile, { limit = 10 } = {}) {
    const settings = await this.getSettings(db);
    const onlinePeso = Number(settings?.online_minute_xp) || 0.25;

    const r = await db.query(
      `WITH online AS (
         SELECT 'online_time'::varchar(40) AS event_type,
                date_trunc('hour', created_at)  AS created_at,
                SUM(xp_amount)::numeric         AS xp_amount,
                COUNT(*)::int                   AS cnt
           FROM subprofile_xp_events
          WHERE id_profile = $1 AND event_type = 'online_time'
          GROUP BY date_trunc('hour', created_at)
       ),
       others AS (
         SELECT event_type, created_at, xp_amount, 1 AS cnt
           FROM subprofile_xp_events
          WHERE id_profile = $1 AND event_type <> 'online_time'
       ),
       unified AS (
         SELECT event_type, created_at, xp_amount, cnt FROM online
         UNION ALL
         SELECT event_type, created_at, xp_amount, cnt FROM others
       )
       SELECT event_type, created_at, xp_amount, cnt
         FROM unified
        ORDER BY created_at DESC
        LIMIT $2`,
      [id_profile, Math.min(limit, 50)]
    );

    return r.rows.map((row) => {
      const xp_amount = Number(row.xp_amount);
      return {
        event_type: row.event_type,
        xp_amount,
        created_at: row.created_at,
        count: Number(row.cnt),
        minutes:
          row.event_type === "online_time"
            ? Math.max(1, Math.round(xp_amount / onlinePeso))
            : null,
      };
    });
  },

  // Returns all active non-clan profile IDs for a given user
  async getUserActiveProfileIds(db, id_user) {
    const r = await db.query(
      `SELECT id_profile
         FROM tb_profile
        WHERE id_user = $1
          AND is_clan = FALSE
          AND deleted_at IS NULL
          AND is_active = TRUE`,
      [id_user]
    );
    return r.rows.map((row) => row.id_profile);
  },
};
