// src/services/MeuMundoEventService.js — trilha E, fatia E19: EVENTOS ligados pelo admin (mig 451).
//
// Ligado = toda atividade validada paga `ficha_evento` (MeuMundoRewardService.grant) e a loja de evento
// abre (MeuMundoGearService.exchange confere aqui). Só administrador muda (a rota é de admin).
"use strict";

const db = require("../databases");
const Events = require("../utils/mmItems/catalog/events");

const fail = (error, statusCode, code) => ({ error, statusCode, code });
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const openRow = (row, now) => !!row && row.active && (!row.ends_at || new Date(row.ends_at).getTime() > now);

class MeuMundoEventService {
  /** O evento está aberto agora? */
  static async isOpen(c, id, now = Date.now()) {
    if (!Events.EVENT_BY_ID.has(id)) return false;
    const r = await c.query(`SELECT active, ends_at FROM tb_mm_event WHERE id = $1`, [id]);
    return openRow(r.rows[0], now);
  }

  /** Ids dos eventos abertos agora. */
  static async openIds(c, now = Date.now()) {
    const r = await c.query(`SELECT id, active, ends_at FROM tb_mm_event WHERE active`);
    return r.rows.filter((x) => Events.EVENT_BY_ID.has(x.id) && openRow(x, now)).map((x) => x.id);
  }

  /** GET /evento/config — todos os eventos do catálogo, ligados ou não. */
  static async config(now = Date.now()) {
    const r = await db.query(`SELECT id, active, ends_at, updated_at FROM tb_mm_event`);
    const rows = new Map(r.rows.map((x) => [x.id, x]));
    return {
      events: Events.EVENTS.map((e) => {
        const x = rows.get(e.id);
        return { id: e.id, name: e.name, active: !!x?.active, open: openRow(x, now), endsAt: iso(x?.ends_at), updatedAt: iso(x?.updated_at) };
      }),
    };
  }

  /** POST /evento/config { event, active, hours? } — liga (por `hours` horas, ou sem fim) ou desliga. */
  static async save(idUser, body = {}, now = Date.now()) {
    const id = String(body.event || "");
    if (!Events.EVENT_BY_ID.has(id)) return fail("Evento desconhecido", 404, "event");
    if (typeof body.active !== "boolean") return fail("Informe ligar ou desligar", 400, "active");
    const hours = body.hours == null || body.hours === "" ? null : Number(body.hours);
    if (hours != null && (!Number.isFinite(hours) || hours <= 0 || hours > 24 * 60)) return fail("Duração inválida", 400, "hours");
    const endsAt = body.active && hours ? new Date(now + hours * 3600 * 1000).toISOString() : null;
    await db.query(
      `INSERT INTO tb_mm_event (id, active, ends_at, updated_by, updated_at) VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET active = EXCLUDED.active, ends_at = EXCLUDED.ends_at, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [id, body.active, endsAt, idUser]
    );
    return MeuMundoEventService.config(now);
  }
}

module.exports = MeuMundoEventService;
