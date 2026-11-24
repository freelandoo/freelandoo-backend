// src/services/MeuMundoGachaService.js — CONVOCAÇÕES (gachas de fragmentos, gacha-v1, 24/11/2026).
//
// O servidor decide tudo: o cliente escolhe só o banner, 1 ou 10 giros e o alvo (quando o banner tem). O sorteio
// é `crypto.randomInt` sobre pesos inteiros (rules/gacha.js, sem viés). Débito da Faísca, fragmentos, contador de
// garantia e recibo acontecem na MESMA transação da vida (withLife → withReceipt da Forja): faltou Faísca, nada muda.
// A chave do pedido é o recibo: repetir devolve o resultado original para sempre (mesmo depois de gastar os
// fragmentos); a mesma chave com outro banner/quantidade/alvo = `key_conflict`.
// Lote de 10 = tudo ou nada (uma transação), giro a giro na ordem para a garantia.
"use strict";

const crypto = require("crypto");
const pool = require("../databases");
const Rules = require("../utils/mmItems/rules/gacha");
const Gear = require("../utils/meuMundoGear");
const GearStore = require("../storages/MeuMundoGearStorage");
const GachaStore = require("../storages/MeuMundoGachaStorage");
const MeuMundoLifeService = require("./MeuMundoLifeService");
const { createLogger } = require("../utils/logger");

const log = createLogger("meuMundo.gacha");
const GearService = () => require("./MeuMundoGearService");

const ERRORS = {
  key: ["Pedido sem chave", 400],
  key_conflict: ["Essa chave já foi usada para outra ação", 409],
  banner: ["Convocação desconhecida", 400],
  times: ["Escolha 1 ou 10 giros", 400],
  target: ["Escolha um alvo válido para essa Convocação", 400],
  spark: ["Faíscas de Éter insuficientes", 402],
  rules: ["As Convocações mudaram: atualize a página", 410],
  dead: ["Hóspede sem vida", 409],
  notFound: ["Convocação não encontrada", 404],
  cursor: ["Página inválida", 400],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code] || ["Não foi possível", 400];
  return { error, statusCode, code };
};
const KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** RNG do sorteio: inteiro sem viés em [0, n). Trocável nos testes e2e. */
const ri = (n) => MeuMundoGachaService.randomInt(n);

const stateView = (banner, st) => ({
  banner,
  sinceRare: st?.sinceRare || 0,
  sinceTop: st?.sinceTop || 0,
  guaranteed: !!st?.guaranteed,
  target: st?.target ?? null,
  pulls: st?.pulls || 0,
  // quantos giros faltam para cada garantia (o próximo que força conta como 1)
  toRare: Rules.PITY.rare - (st?.sinceRare || 0),
  toTop: Rules.PITY.top - (st?.sinceTop || 0),
});

async function sparkOf(c, idUser) {
  const r = await c.query(`SELECT qty FROM tb_mm_gear WHERE id_user = $1 AND item_id = $2`, [idUser, Rules.CURRENCY]);
  return r.rows[0] ? r.rows[0].qty : 0;
}

class MeuMundoGachaService {
  /** GET /meu-mundo/admin/gacha — regras publicadas, saldo de Faísca e os contadores da pessoa. */
  static async get(idUser) {
    return MeuMundoLifeService.withLife(idUser, async (s, ctx) => {
      const c = ctx.client;
      const states = await GachaStore.states(c, idUser);
      return {
        rules: Rules.publicRules(),
        spark: await sparkOf(c, idUser),
        states: Rules.BANNERS.map((b) => stateView(b, states[b])),
      };
    });
  }

  /**
   * POST /meu-mundo/admin/gacha/pull { banner, times: 1|10, target?, key, version? }
   * Resposta: o recibo (`receipt.result.results` = os fragmentos de cada giro, na ordem), a mochila e o contador.
   */
  static async pull(idUser, body = {}) {
    const banner = String(body.banner || "");
    if (!Rules.BANNERS.includes(banner)) return fail("banner");
    if (body.version != null && body.version !== Rules.GACHA_VERSION) return fail("rules");
    const times = body.times == null ? 1 : Number(body.times);
    if (!Rules.TIMES.includes(times)) return fail("times");
    const target = Rules.normalizeTarget(banner, body.target);
    if (target === undefined) return fail("target");
    if (!KEY.test(String(body.key || ""))) return fail("key");
    const cost = times * Rules.COST_PER_PULL;
    const match = (res) => res.banner === banner && res.times === times && (res.target ?? null) === target;

    const out = await GearService().withReceipt(idUser, "gacha_pull", body.key, async (s, ctx) => {
      const c = ctx.client;
      const st = await GachaStore.lockState(c, idUser, banner);
      const have = (await GearStore.lockItem(c, idUser, Rules.CURRENCY))?.qty || 0;
      if (have < cost) return fail("spark");
      if ((await GearStore.addStack(c, idUser, Rules.CURRENCY, -cost)) == null) return fail("spark");
      const rolled = Rules.rollMany(banner, target, st, times, ri);
      // junta as linhas iguais para a mochila; o recibo guarda giro a giro
      const sum = {};
      for (const r of rolled.results) sum[r.item] = (sum[r.item] || 0) + r.qty;
      const delivered = await GearService().deliver(c, idUser, Object.entries(sum).map(([id, qty]) => ({ id, qty })), ctx);
      const lost = delivered.filter((d) => d.qty < sum[d.id]).map((d) => ({ id: d.id, lost: sum[d.id] - d.qty }));
      await GachaStore.saveState(c, idUser, banner, rolled.state, target, times);
      ctx.what = `gacha:${banner}:${times}`;
      const after = { sinceRare: rolled.state.sinceRare, sinceTop: rolled.state.sinceTop, guaranteed: rolled.state.guaranteed, target, pulls: st.pulls + times };
      return {
        result: {
          banner, times, target, version: Rules.GACHA_VERSION, cost, currency: Rules.CURRENCY,
          results: rolled.results,
          best: rolled.results.reduce((b, r) => (Rules.TIERS.indexOf(r.tier) > Rules.TIERS.indexOf(b.tier) ? r : b), rolled.results[0]).tier,
          before: { sinceRare: st.sinceRare, sinceTop: st.sinceTop, guaranteed: st.guaranteed },
          after,
          ...(lost.length ? { capped: lost } : {}),
        },
        deltas: {},
        items: [
          { id: Rules.CURRENCY, qty: -cost, rarity: Gear.GEAR_BY_ID.get(Rules.CURRENCY)?.rarity || "epic", rank: "E" },
          ...delivered,
        ],
      };
    }, match);
    if (out && !out.error) {
      log.info("pull", { banner, times, replay: !!out.replay });
      const st = out.receipt?.result?.after;
      return { ...out, state: stateView(banner, st), spark: await MeuMundoGachaService.sparkNow(idUser) };
    }
    return out;
  }

  /** GET /meu-mundo/admin/gacha/pull/:key — recuperar um giro (recarregou/caiu a rede). Nunca sorteia. */
  static async recover(idUser, rawKey) {
    const key = String(rawKey || "");
    if (!KEY.test(key)) return fail("key");
    const rec = await GearStore.accountReceipt(pool, idUser, "gacha_pull", key);
    if (!rec) return fail("notFound");
    return { receipt: rec, replay: true };
  }

  /** GET /meu-mundo/admin/gacha/history?before=ISO&limit=20 — só os giros da própria pessoa. */
  static async history(idUser, query = {}) {
    const limit = Math.max(1, Math.min(50, Number.parseInt(query.limit, 10) || 20));
    let before = null;
    if (query.before != null && query.before !== "") {
      const d = new Date(String(query.before));
      if (Number.isNaN(d.getTime())) return fail("cursor");
      before = d.toISOString();
    }
    const list = await GachaStore.history(pool, idUser, { before, limit });
    const items = list.map((r) => ({ key: r.actionKey, at: r.at, ...r.result }));
    return { items, next: items.length === limit ? items[items.length - 1].at : null };
  }

  static async sparkNow(idUser) {
    return sparkOf(pool, idUser);
  }
}

MeuMundoGachaService.randomInt = (n) => crypto.randomInt(0, n);
MeuMundoGachaService.ERRORS = ERRORS;

module.exports = MeuMundoGachaService;
