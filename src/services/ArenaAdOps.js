// Operação mínima das campanhas da Arena (Módulo 11) — usada pela CLI
// scripts/arena-ads-ops.js (simula por padrão; --apply grava). NÃO é o painel
// do M16: é o suficiente para configurar, agendar, pausar e encerrar.
//
// Toda operação: campanha travada (FOR UPDATE), relógio do banco, revisão +1,
// transação única. Aprovação de CONTEÚDO e ativação são passos SEPARADOS.

const Ads = require("../storages/ArenaAdStorage");
const rules = require("../utils/arenaAds");

const err = (code, message) => Object.assign(new Error(message), { code, op: true });

/**
 * A arte é esticada para o quadrilátero do slot: proporção muito diferente
 * deforma o criativo. Tolerância de 35% (log), tanto ao reservar quanto ao
 * trocar a versão.
 */
const ASPECT_TOLERANCE = Math.log(1.35);
function creativeAspect(cr) {
  const a = cr?.assets?.[cr.far_ref];
  return a && a.width > 0 && a.height > 0 ? a.width / a.height : null;
}
const aspectFits = (placementAspect, ca) => ca === null || Math.abs(Math.log(Number(placementAspect) / ca)) <= ASPECT_TOLERANCE;

async function tx(client, apply, fn) {
  await client.query("BEGIN");
  try {
    const out = await fn();
    await client.query(apply ? "COMMIT" : "ROLLBACK");
    return { ok: true, applied: apply, ...out };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    if (e.op) return { ok: false, code: e.code, error: e.message };
    throw e;
  }
}

async function campaignOrFail(client, code) {
  if (!rules.isCampaignCode(code)) throw err("invalid_input", "código de campanha inválido");
  const c = await Ads.getCampaignByCode(client, code, { forUpdate: true });
  if (!c) throw err("unknown_campaign", `campanha ${code} não existe (importe com scripts/arena-ads.js)`);
  return c;
}

async function bump(client, id, set, params = []) {
  const r = await client.query(
    `UPDATE public.tb_arena_ad_campaign SET ${set}, revision = revision + 1, updated_at = NOW() WHERE id_campaign = $1 RETURNING *`,
    [id, ...params]
  );
  return r.rows[0];
}

const view = (c) => ({
  code: c.code,
  approval: c.approval_status,
  op: c.op_status,
  startsAt: new Date(c.starts_at).toISOString(),
  endsAt: new Date(c.ends_at).toISOString(),
  creativeVersion: c.current_creative_version,
  revision: c.revision,
});

const ops = {
  /** Aprova o CONTEÚDO (não ativa). */
  approve: (client, { code, by }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      if (rules.cleanText(by, 120, { required: true }).error) throw err("invalid_input", "--by obrigatório (quem aprovou)");
      if (c.approval_status === "approved") return { campaign: view(c), noop: true };
      return { campaign: view(await bump(client, c.id_campaign, `approval_status = 'approved', approved_by_label = $2, approved_at = NOW()`, [by.trim()])) };
    }),

  /** Retira por segurança: sai do ar na hora e não volta sem nova aprovação. */
  withdraw: (client, { code }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      return { campaign: view(await bump(client, c.id_campaign, `approval_status = 'withdrawn', op_status = CASE WHEN op_status = 'active' THEN 'paused' ELSE op_status END`)) };
    }),

  /** Janela [início, fim) da campanha. */
  schedule: (client, { code, startsAt, endsAt }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      if (c.op_status === "ended") throw err("ended", "campanha encerrada não é reagendada");
      const s = Date.parse(startsAt);
      const e = Date.parse(endsAt);
      if (Number.isNaN(s) || Number.isNaN(e) || e <= s) throw err("invalid_window", "janela inválida (fim exclusivo > início, ISO 8601 UTC)");
      return { campaign: view(await bump(client, c.id_campaign, `starts_at = $2, ends_at = $3`, [new Date(s), new Date(e)])) };
    }),

  /** Ativa (ou agenda, se o início ainda não chegou). Exige aprovação e criativo corrente. */
  activate: (client, { code }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      if (c.approval_status !== "approved") throw err("not_approved", "aprove o conteúdo antes de ativar");
      if (c.op_status === "ended") throw err("ended", "campanha encerrada não é reativada");
      if (!c.current_creative_version) throw err("no_creative", "escolha o criativo (set-creative) antes de ativar");
      const cr = (await client.query(`SELECT approval_status FROM public.tb_arena_ad_creative WHERE id_campaign = $1 AND version = $2`, [c.id_campaign, c.current_creative_version])).rows[0];
      if (!cr || cr.approval_status !== "approved") throw err("creative_not_approved", "o criativo corrente não está aprovado");
      if (c.op_status === "active") return { campaign: view(c), noop: true };
      return { campaign: view(await bump(client, c.id_campaign, `op_status = 'active'`)) };
    }),

  pause: (client, { code }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      if (c.op_status !== "active") throw err("not_active", "só campanha ativa é pausada");
      return { campaign: view(await bump(client, c.id_campaign, `op_status = 'paused'`)) };
    }),

  end: (client, { code }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      if (c.op_status === "ended") return { campaign: view(c), noop: true };
      return { campaign: view(await bump(client, c.id_campaign, `op_status = 'ended'`)) };
    }),

  /** Substitui o criativo: aponta para OUTRA versão (imutável) já importada. */
  setCreative: (client, { code, version }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      const v = Number(version);
      if (!Number.isInteger(v) || v < 1) throw err("invalid_input", "--version");
      const cr = (await client.query(`SELECT approval_status, far_ref, assets FROM public.tb_arena_ad_creative WHERE id_campaign = $1 AND version = $2`, [c.id_campaign, v])).rows[0];
      if (!cr) throw err("unknown_creative", `versão ${v} não importada`);
      // A versão nova tem que caber em TODOS os espaços já reservados.
      const booked = (
        await client.query(
          `SELECT p.placement_id, p.aspect FROM public.tb_arena_ad_booking b JOIN public.tb_arena_ad_placement p ON p.placement_id = b.placement_id
            WHERE b.id_campaign = $1 AND b.status = 'active' AND b.ends_at > NOW()`,
          [c.id_campaign]
        )
      ).rows;
      const bad = booked.find((b) => !aspectFits(b.aspect, creativeAspect(cr)));
      if (bad) throw err("aspect_mismatch", `a proporção da versão ${v} não serve no espaço reservado ${bad.placement_id}`);
      if (cr.approval_status !== "approved") throw err("creative_not_approved", `versão ${v} não está aprovada`);
      if (c.current_creative_version === v) return { campaign: view(c), noop: true };
      return { campaign: view(await bump(client, c.id_campaign, `current_creative_version = $2`, [v])) };
    }),

  /** Retira UMA versão de criativo por segurança. */
  withdrawCreative: (client, { code, version }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      const r = await client.query(`UPDATE public.tb_arena_ad_creative SET approval_status = 'withdrawn' WHERE id_campaign = $1 AND version = $2 RETURNING version`, [c.id_campaign, Number(version)]);
      if (!r.rowCount) throw err("unknown_creative", "versão não importada");
      return { campaign: view(await bump(client, c.id_campaign, `notes = notes`)), withdrawnVersion: Number(version) };
    }),

  /**
   * Reserva o espaço para a campanha em [início, fim) (padrão: a janela da
   * campanha). Conflito com reserva ativa de campanha não encerrada → RECUSA.
   */
  book: (client, { code, placementId, startsAt, endsAt }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      if (c.op_status === "ended") throw err("ended", "campanha encerrada");
      if (!rules.isPlacementId(placementId)) throw err("invalid_input", "placementId");
      // O espaço travado serializa duas reservas concorrentes para o mesmo lugar.
      const p = await Ads.getPlacement(client, placementId, { forUpdate: true });
      if (!p || !p.is_active) throw err("unknown_placement", "espaço inexistente ou desativado");
      if (p.slot_class !== "commercial") throw err("not_commercial", "espaço não comercializável");
      const s = startsAt ? new Date(startsAt) : new Date(c.starts_at);
      const e = endsAt ? new Date(endsAt) : new Date(c.ends_at);
      if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || e <= s) throw err("invalid_window", "janela inválida");
      if (c.current_creative_version) {
        const cr = (await client.query(`SELECT far_ref, assets FROM public.tb_arena_ad_creative WHERE id_campaign = $1 AND version = $2`, [c.id_campaign, c.current_creative_version])).rows[0];
        if (!aspectFits(p.aspect, creativeAspect(cr))) throw err("aspect_mismatch", `a proporção do criativo não serve neste espaço (${Number(p.aspect).toFixed(2)})`);
      }
      const clash = await Ads.overlappingBookings(client, placementId, s, e);
      if (clash.length) throw err("booking_conflict", `conflito com a reserva ${clash[0].id_booking} (${clash[0].code})`);
      const r = await client.query(
        `INSERT INTO public.tb_arena_ad_booking (id_campaign, placement_id, starts_at, ends_at) VALUES ($1, $2, $3, $4) RETURNING id_booking`,
        [c.id_campaign, placementId, s, e]
      );
      await bump(client, c.id_campaign, `notes = notes`);
      return { booking: { id: r.rows[0].id_booking, placementId, startsAt: s.toISOString(), endsAt: e.toISOString() } };
    }),

  cancelBooking: (client, { code, bookingId }, apply) =>
    tx(client, apply, async () => {
      const c = await campaignOrFail(client, code);
      const r = await client.query(
        `UPDATE public.tb_arena_ad_booking SET status = 'cancelled', cancelled_at = NOW() WHERE id_booking = $1 AND id_campaign = $2 AND status = 'active' RETURNING id_booking`,
        [bookingId, c.id_campaign]
      );
      if (!r.rowCount) throw err("unknown_booking", "reserva ativa não encontrada nesta campanha");
      await bump(client, c.id_campaign, `notes = notes`);
      return { cancelled: bookingId };
    }),

  /** Estado completo (leitura). */
  status: async (client, { code }) => {
    const c = await Ads.getCampaignByCode(client, code);
    if (!c) return { ok: false, code: "unknown_campaign", error: "campanha não existe" };
    const now = await Ads.now(client);
    const creatives = await Ads.listCreatives(client, c.id_campaign);
    const bookings = await Ads.listBookings(client, c.id_campaign);
    const current = creatives.find((x) => x.version === c.current_creative_version) || null;
    return {
      ok: true,
      serverTime: new Date(now).toISOString(),
      campaign: { ...view(c), sponsor: c.sponsor_label, demo: c.is_demo, responsible: c.responsible_label },
      derived: c.op_status === "active" && new Date(now) < new Date(c.starts_at) ? "scheduled" : c.op_status,
      creatives: creatives.map((x) => ({ version: x.version, kind: x.kind, approval: x.approval_status, headline: x.headline })),
      bookings: bookings.map((b) => ({
        id: b.id_booking,
        placementId: b.placement_id,
        status: b.status,
        startsAt: new Date(b.starts_at).toISOString(),
        endsAt: new Date(b.ends_at).toISOString(),
        delivery: rules.deliverability({ campaign: c, creative: current, booking: b, placement: { is_active: true, slot_class: "commercial" } }, new Date(now).getTime()),
      })),
    };
  },
};

module.exports = ops;
