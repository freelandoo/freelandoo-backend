// src/services/MeuMundoInviteService.js — CONVITES do Meu Mundo com o cupom da conta (gacha-v1, mig 470).
//
// Decisões do Alex (24/11/2026): novo membro = conta que entra no Meu Mundo pela 1ª vez com o cupom de alguém;
// quando ATIVA (15 min ativos em recibos do jogo em até 14 dias), quem convidou ESCOLHE 10 fragmentos de um
// personagem jogável; não repete na rodada (o escolhido some da lista); depois dos 12, a lista recomeça.
// Suposições minhas (plano): 24 h depois do 1º personagem ainda vale o vínculo; teto de 30 ativações premiadas
// a cada 30 dias (as de cima ficam registradas sem prêmio).
//
// Separado das comissões: NÃO chama ReferralService.bind nem toca no vínculo financeiro de afiliado.
// Nada de duas vidas travadas: o vínculo grava só a linha do convite (sem lock de vida); a ativação e a
// entrega rodam no withLife de QUEM CONVIDOU, lendo os recibos do convidado sem travar a vida dele.
// Um crédito por convidado: a linha do convite é a chave (PK id_invitee) e o prêmio sai só de status 'pending'
// travado com FOR UPDATE; o recibo (source 'invite_reward') registra a entrega.
"use strict";

const pool = require("../databases");
const Rules = require("../utils/mmItems/rules/gacha");
const CouponStorage = require("../storages/CouponStorage");
const AffiliateStorage = require("../storages/AffiliateStorage");
const GearStore = require("../storages/MeuMundoGearStorage");
const AdvStore = require("../storages/MeuMundoAdventureStorage");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.invite");
const GearService = () => require("./MeuMundoGearService");

const RULES = Object.freeze({
  /** Minutos ativos (em recibos do jogo) que o convidado precisa somar. */
  activationMs: 15 * 60 * 1000,
  /** Prazo para ativar, contado do vínculo. */
  activationDays: 14,
  /** Até quantas horas depois do 1º personagem a conta ainda é "nova" no jogo. */
  firstEntryHours: 24,
  /** Teto de ativações premiadas por convidador numa janela de 30 dias. */
  cap: 30,
  capDays: 30,
  /** Fragmentos de personagem por convidado ativado. */
  qty: 10,
});
const DAY = 24 * 60 * 60 * 1000;

const ERRORS = {
  code: ["Convite inválido", 400],
  self: ["Você não pode usar o seu próprio convite", 409],
  notNew: ["O convite vale para quem está entrando no Meu Mundo pela primeira vez", 409],
  character: ["Escolha um personagem da lista", 400],
  repeated: ["Esse personagem já foi escolhido nesta rodada", 409],
  none: ["Nenhum prêmio de convite esperando", 409],
  dead: ["Hóspede sem vida", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};
const CODE_RE = /^[A-Z0-9_-]{2,40}$/;

/** Os escolhidos da rodada atual (as entregas em ordem; rodada = blocos de 12). */
async function roundOf(c, idInviter) {
  const r = await c.query(
    `SELECT reward->>'character' AS ch FROM tb_mm_invite WHERE id_inviter = $1 AND status = 'delivered' ORDER BY delivered_at, id_invitee`,
    [idInviter]
  );
  const all = r.rows.map((x) => x.ch);
  const size = Rules.CHARACTERS.length;
  const chosen = all.slice(Math.floor(all.length / size) * size);
  return { delivered: all.length, round: Math.floor(all.length / size) + 1, chosen, available: Rules.CHARACTERS.map((x) => x.id).filter((id) => !chosen.includes(id)) };
}

/**
 * Ativa quem já somou os minutos e vence quem passou do prazo. Roda no withLife de quem convidou (lê os
 * recibos do convidado sem travar a vida dele). `now` em ms.
 */
async function refresh(c, idInviter, now) {
  const waiting = await c.query(`SELECT id_invitee, claimed_at FROM tb_mm_invite WHERE id_inviter = $1 AND status = 'waiting' FOR UPDATE`, [idInviter]);
  for (const w of waiting.rows) {
    const from = new Date(w.claimed_at).getTime();
    const until = from + RULES.activationDays * DAY;
    const sum = await c.query(
      `SELECT COALESCE(SUM(active_ms), 0)::bigint AS ms FROM tb_mm_receipt WHERE id_user = $1 AND created_at >= $2 AND created_at <= $3`,
      [w.id_invitee, new Date(from), new Date(until)]
    );
    if (Number(sum.rows[0].ms) >= RULES.activationMs) {
      const recent = await c.query(
        `SELECT COUNT(*)::int AS n FROM tb_mm_invite WHERE id_inviter = $1 AND status IN ('pending', 'delivered') AND activated_at > $2`,
        [idInviter, new Date(now - RULES.capDays * DAY)]
      );
      const status = recent.rows[0].n >= RULES.cap ? "capped" : "pending";
      await c.query(`UPDATE tb_mm_invite SET status = $2, activated_at = $3 WHERE id_invitee = $1 AND status = 'waiting'`, [w.id_invitee, status, new Date(Math.min(now, until))]);
    } else if (now > until) {
      await c.query(`UPDATE tb_mm_invite SET status = 'expired' WHERE id_invitee = $1 AND status = 'waiting'`, [w.id_invitee]);
    }
  }
}

async function counts(c, idInviter) {
  const r = await c.query(`SELECT status, COUNT(*)::int AS n FROM tb_mm_invite WHERE id_inviter = $1 GROUP BY status`, [idInviter]);
  const out = { waiting: 0, pending: 0, delivered: 0, capped: 0, expired: 0 };
  for (const x of r.rows) out[x.status] = x.n;
  return out;
}

class MeuMundoInviteService {
  /**
   * POST /meu-mundo/admin/invite/claim { code } — o CONVIDADO autenticado, na 1ª entrada no jogo, registra o
   * convite que trouxe no aparelho. Só cria a linha (o primeiro vínculo vale para sempre); nunca premia aqui.
   * Código inválido, suspenso, vencido ou do próprio usuário: recusa sem dizer de quem é o cupom.
   */
  static async claim(idUser, body = {}, now = Date.now()) {
    const code = String(body.code || "").trim().toUpperCase();
    if (!CODE_RE.test(code)) return fail("code");
    const existing = await pool.query(`SELECT status FROM tb_mm_invite WHERE id_invitee = $1`, [idUser]);
    if (existing.rows[0]) return { linked: true, already: true };
    const coupon = await CouponStorage.findByCode(pool, code);
    if (!coupon || coupon.is_active === false || !coupon.owner_user_id || (coupon.expires_at && new Date(coupon.expires_at).getTime() < now)) return fail("code");
    if (coupon.owner_user_id === idUser) return fail("self");
    const aff = await AffiliateStorage.getAffiliateByUserId(pool, coupon.owner_user_id);
    if (!aff || aff.status !== "ACTIVE" || aff.is_active === false) return fail("code");
    const first = await pool.query(`SELECT MIN(created_at) AS at FROM tb_mm_character WHERE id_user = $1`, [idUser]);
    const at = first.rows[0]?.at ? new Date(first.rows[0].at).getTime() : null;
    if (at != null && now - at > RULES.firstEntryHours * 60 * 60 * 1000) return fail("notNew");
    const ins = await pool.query(
      `INSERT INTO tb_mm_invite (id_invitee, id_inviter, code, claimed_at) VALUES ($1, $2, $3, $4) ON CONFLICT (id_invitee) DO NOTHING RETURNING status`,
      [idUser, coupon.owner_user_id, code, new Date(now)]
    );
    log.info("claim", { linked: !!ins.rows[0] });
    return { linked: true, already: !ins.rows[0] };
  }

  /** GET /meu-mundo/admin/invite — o painel de quem convida: regra, totais e a lista de personagens da rodada. */
  static async get(idUser) {
    const out = await MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      await refresh(c, idUser, ctx.now);
      return { counts: await counts(c, idUser), round: await roundOf(c, idUser) };
    });
    if (out && out.error) return out;
    return {
      rules: { ...RULES, characters: Rules.CHARACTERS.map((x) => ({ id: x.id, kind: x.kind, frag: x.frag })) },
      counts: out.counts,
      round: out.round,
    };
  }

  /**
   * POST /meu-mundo/admin/invite/reward { character } — quem convidou escolhe os 10 fragmentos do prêmio
   * mais antigo esperando. Não repete na rodada. Um crédito por convidado (linha travada + status).
   */
  static async reward(idUser, body = {}) {
    const ch = Rules.CHARACTER_BY_ID.get(String(body.character || ""));
    if (!ch) return fail("character");
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      if (s.status !== "alive") return fail("dead");
      await refresh(c, idUser, ctx.now);
      const row = (await c.query(
        `SELECT id_invitee FROM tb_mm_invite WHERE id_inviter = $1 AND status = 'pending' ORDER BY activated_at, id_invitee LIMIT 1 FOR UPDATE`,
        [idUser]
      )).rows[0];
      if (!row) return fail("none");
      const round = await roundOf(c, idUser);
      if (!round.available.includes(ch.id)) return fail("repeated");
      await GearService().prepare(c, idUser);
      const mark = await GearStore.ledgerMark(c, idUser);
      const delivered = await GearService().deliver(c, idUser, [{ id: ch.frag, qty: RULES.qty }], ctx);
      const reward = { character: ch.id, item: ch.frag, qty: RULES.qty };
      const upd = await c.query(
        `UPDATE tb_mm_invite SET status = 'delivered', delivered_at = to_timestamp($2 / 1000.0), reward = $3 WHERE id_invitee = $1 AND status = 'pending'`,
        [row.id_invitee, ctx.now, JSON.stringify(reward)]
      );
      if (upd.rowCount !== 1) return fail("none");
      const rec = await AdvStore.insertReceipt(c, {
        idUser, idCharacter: ctx.row.id_character, source: "invite_reward", actionKey: row.id_invitee, rules: Rules.GACHA_VERSION,
        result: { reward, round: round.round }, deltas: {}, items: delivered,
      });
      if (rec) await GearStore.attachLedger(c, idUser, mark, rec.eventId);
      ctx.what = `invite:${ch.id}`;
      return { reward, items: delivered, counts: await counts(c, idUser), round: await roundOf(c, idUser) };
    });
  }
}

MeuMundoInviteService.RULES = RULES;
MeuMundoInviteService.ERRORS = ERRORS;
MeuMundoInviteService.refresh = refresh;

module.exports = MeuMundoInviteService;
