// src/services/MeuMundoDomainService.js — MEU MUNDO 3D, lore v2 D1: motor dos Domínios.
//
// A tela do portal (GET /domains) e a entrada numa cena (POST /domains/enter)
// passam por aqui; a LUTA do setor abre em MeuMundoAdventureService.fightStart
// (origem "domain"), que pergunta `fightGate` — o servidor escolhe o monstro e o
// nível pelo setor, o aparelho não manda nada disso. Vencida a luta re-simulada,
// `advance` sobe o setor na MESMA transação do recibo (tb_mm_receipt), então
// reenvio, duas abas ou derrota nunca abrem setor. Travas: nível do treinador
// (5, 9, 13, 17, 21, 25) E a travessia (setor 10 do Domínio anterior vencido);
// administrador passa direto (MM_ADMIN_LOCKS=1 desliga a passagem, para testar).
// Regra pura em utils/meuMundoDomains.js; tabela tb_mm_domain_progress (mig 444).

const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const TrainerStore = require("../storages/MeuMundoTrainerStorage");
const Trainer = require("../utils/meuMundoTrainer");
const D = require("../utils/meuMundoDomains");
const GearStore = require("../storages/MeuMundoGearStorage");
const MeuMundoPlaceService = require("./MeuMundoPlaceService");
const PactStore = require("../storages/MeuMundoPactStorage");
const Pact = require("../utils/meuMundoPact");
const Items = require("../utils/mmItems");

/** D4: namespace do advisory lock do pacto (Domínio × povo; fixo, não colide com outros). */
const PACT_LOCK_NS = 44501;
const pactKey = (domain, clan) => (D.DOMAIN_IDS.indexOf(domain) + 1) * 10 + Pact.CLANS.indexOf(clan) + 1;

const ERRORS = {
  domain: ["Domínio desconhecido", 404],
  closed: ["Esse Domínio ainda está fechado", 403],
  sector: ["Esse setor ainda está fechado", 403],
  place: ["Lugar desconhecido", 404],
  placeFar: ["Chegue à clareira primeiro", 409],
};
const fail = (code, extra = {}) => {
  const [error, statusCode] = ERRORS[code];
  return { error, statusCode, code, ...extra };
};

const levelOf = async (c, idUser) => Trainer.trainerLevelOf(Number((await TrainerStore.get(c, idUser)).xp)).level;

async function bypassOf(c, idUser) {
  if (!MeuMundoDomainService.adminBypass || process.env.MM_ADMIN_LOCKS === "1") return false;
  return AuthStorage.isAdmin(c, idUser);
}

/** { [domain]: maior setor vencido } da conta. */
async function bestOf(c, idUser) {
  const r = await c.query(`SELECT domain, best_sector FROM tb_mm_domain_progress WHERE id_user = $1`, [idUser]);
  const out = {};
  for (const row of r.rows) out[row.domain] = Number(row.best_sector) || 0;
  return out;
}

/** E12: tabelas de saque com a primeira vitória já paga (mig 449). */
async function firstsOf(c, idUser) {
  const r = await c.query(`SELECT loot_table FROM tb_mm_loot_first WHERE id_user = $1 AND loot_table LIKE 'domain:%'`, [idUser]);
  return new Set(r.rows.map((x) => x.loot_table));
}

/**
 * E12: a tabela do setor para a tela (consultável antes de lutar): garantido, chance e o bônus
 * da primeira vitória (e se já foi pago). Nome em pt de reserva; o front traduz por `gear_<id>`.
 */
function sectorLoot(domain, sector, firsts) {
  const id = Items.domainTableId(domain, sector);
  const t = id && Items.LOOT_TABLES[id];
  if (!t) return null;
  const row = (e) => {
    const g = Items.GEAR_BY_ID.get(e.id);
    return { id: e.id, name: g ? g.name : e.id, rarity: g ? g.rarity : "common", qty: Array.isArray(e.qty) ? [e.qty[0], e.qty[1]] : [1, 1], ...(e.p != null ? { p: e.p } : {}) };
  };
  return {
    table: id,
    sure: (t.sure || []).map(row),
    chance: (t.chance || []).map(row),
    first: (t.first || []).map(row),
    firstDone: firsts.has(id),
  };
}
const withLoot = (domains, firsts) => domains.map((d) => ({ ...d, sectors: d.sectors.map((s) => ({ ...s, loot: sectorLoot(d.id, s.n, firsts) })) }));

async function powerOf(c, idUser) {
  const r = await c.query(`SELECT power FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ORDER BY born_at DESC LIMIT 1`, [idUser]);
  return r.rows[0] ? Number(r.rows[0].power) || 0 : 0;
}

/** Recusa de Domínio fechado, com o que falta (o cliente desenha o cadeado com isso). */
function lockFail(lock) {
  if (lock.code === "domain") return fail("domain");
  return fail("closed", lock.code === "trainer" ? { level: lock.level, need: "trainer" } : { need: "crossing", from: lock.from });
}

class MeuMundoDomainService {
  /** GET /domains — os seis, com setores, travas, passagem e o Poder de quem joga. */
  static async state(idUser, db = pool) {
    const trainer = await levelOf(db, idUser);
    const bypass = await bypassOf(db, idUser);
    const best = await bestOf(db, idUser);
    const domains = withLoot(D.view(trainer, best, bypass), await firstsOf(db, idUser)); // E12: a tabela de cada setor
    return { trainer, bypass, power: await powerOf(db, idUser), sectors: D.SECTORS, domains, pacts: await PactStore.active(db, Date.now()) };
  }

  /** POST /domains/enter { domain } — só entra na cena de um Domínio aberto. */
  static async enter(idUser, body = {}, db = pool) {
    const id = String(body.domain || "");
    if (!D.domainOf(id)) return fail("domain");
    const trainer = await levelOf(db, idUser);
    const bypass = await bypassOf(db, idUser);
    const best = await bestOf(db, idUser);
    const lock = D.lockOf(id, trainer, best, bypass);
    if (lock) return lockFail(lock);
    const domain = withLoot(D.view(trainer, best, bypass).filter((d) => d.id === id), await firstsOf(db, idUser))[0];
    return { trainer, bypass, power: await powerOf(db, idUser), domain, pacts: (await PactStore.active(db, Date.now())).filter((p) => p.domain === id) };
  }

  /** N4: a pessoa pode estar neste Domínio agora? (o deus solto caça também lá dentro) null = pode; senão o erro. */
  static async canBeIn(idUser, domain, db = pool) {
    const id = String(domain || "");
    if (!D.domainOf(id)) return fail("domain");
    const lock = D.lockOf(id, await levelOf(db, idUser), await bestOf(db, idUser), await bypassOf(db, idUser));
    return lock ? lockFail(lock) : null;
  }

  /**
   * A luta de um setor pode abrir? Devolve o monstro e o nível que o SERVIDOR
   * escolhe pelo setor (ou o erro). Chamado pelo fightStart, fora do withLife.
   */
  static async fightGate(idUser, body = {}, db = pool) {
    const id = String(body.domain || "");
    const sector = Number(body.sector);
    if (!D.domainOf(id)) return fail("domain");
    const trainer = await levelOf(db, idUser);
    const bypass = await bypassOf(db, idUser);
    const best = await bestOf(db, idUser);
    const lock = D.lockOf(id, trainer, best, bypass);
    if (lock) return lockFail(lock);
    if (!D.sectorOpen(id, sector, trainer, best, bypass)) return fail("sector", { sector, best: best[id] || 0 });
    return { domain: id, sector, kind: D.kindOf(id, sector), level: D.sectorLevel(id, sector), boss: D.bossOf(id, sector) };
  }

  /**
   * Lore v2 C5 — POST /domains/place { domain, place, spot? }: a cena do Domínio é do
   * aparelho (não há sala), então a chegada a um lugar dela vem como pedido, e o
   * SERVIDOR confere que dá para estar lá: Domínio aberto e o setor do lugar ao alcance
   * (o anterior vencido). Grava "visit" <place> (o check `visit:pedraverde`).
   * `spot: "golem"` (a ~4 m do Golem sentado) só vale logo depois de chegar à clareira
   * (a última visita foi o lugar, há pouco) e SEM ARMA equipada: armado, não grava e
   * devolve `armed` (o Golem manda largar o ferro). Só um fato, como a visita da sala:
   * sem withLife, sem prêmio (o passo entrega pelo recibo do capítulo).
   */
  static async place(idUser, body = {}, db = pool, now = Date.now()) {
    const id = String(body.domain || "");
    if (!D.domainOf(id)) return fail("domain");
    const placeId = String(body.place || "");
    const def = D.placeOf(id, placeId);
    if (!def) return fail("place");
    const spot = body.spot == null || body.spot === "" ? null : String(body.spot);
    if (spot && !(def.spots || []).includes(spot)) return fail("place");
    const trainer = await levelOf(db, idUser);
    const bypass = await bypassOf(db, idUser);
    const best = await bestOf(db, idUser);
    const lock = D.lockOf(id, trainer, best, bypass);
    if (lock) return lockFail(lock);
    if (!D.placeOpen(id, placeId, best, bypass)) return fail("sector", { sector: def.sector, best: best[id] || 0 });
    if (!spot) {
      const recorded = await MeuMundoPlaceService.recordVisit(idUser, placeId, db);
      return { domain: id, place: placeId, spot: null, recorded, armed: false };
    }
    if (!(await MeuMundoPlaceService.isAt(db, idUser, [placeId, spot], now))) return fail("placeFar");
    const eq = await GearStore.equipped(db, idUser);
    if (eq.weapon) return { domain: id, place: placeId, spot, recorded: false, armed: true };
    const recorded = await MeuMundoPlaceService.recordVisit(idUser, spot, db);
    return { domain: id, place: placeId, spot, recorded, armed: false };
  }

  /**
   * Vitória conferida no setor (dentro do withLife, com recibo NOVO): o setor só
   * sobe; o 10 marca a travessia. Devolve o progresso do Domínio.
   */
  static async advance(c, idUser, domain, sector, now) {
    const at = new Date(now).toISOString();
    const old = (await c.query(`SELECT best_sector FROM tb_mm_domain_progress WHERE id_user = $1 AND domain = $2 FOR UPDATE`, [idUser, domain])).rows[0];
    const before = old ? Number(old.best_sector) : 0;
    const r = await c.query(
      `INSERT INTO tb_mm_domain_progress (id_user, domain, best_sector, wins, crossed_at, updated_at)
       VALUES ($1, $2, $3::smallint, 1, CASE WHEN $3::smallint >= $5::int THEN $4::timestamptz END, $4::timestamptz)
       ON CONFLICT (id_user, domain) DO UPDATE SET
         best_sector = GREATEST(tb_mm_domain_progress.best_sector, EXCLUDED.best_sector),
         wins = tb_mm_domain_progress.wins + 1,
         crossed_at = COALESCE(tb_mm_domain_progress.crossed_at, EXCLUDED.crossed_at),
         updated_at = EXCLUDED.updated_at
       RETURNING domain, best_sector, wins, crossed_at`,
      [idUser, domain, sector, at, D.SECTORS]
    );
    const row = r.rows[0];
    const best = Number(row.best_sector);
    // o que esta vitória abriu: o setor seguinte, ou a passagem (setor 10 pela 1ª vez)
    const fresh = best > before;
    return { domain: row.domain, sector, best, crossed: best >= D.SECTORS, opened: fresh && best < D.SECTORS ? best + 1 : null, crossedNow: fresh && best >= D.SECTORS };
  }
}

/**
 * D4 — vitória conferida contra o chefão do setor 10 (dentro do withLife, recibo NOVO): abre o
 * pacto de 7 dias para o povo da conta naquele Domínio. Pacto do povo ainda de pé = não estica
 * (devolve o de pé com `fresh: false`). Conta sem povo escolhido não abre. Trava por Domínio ×
 * povo (duas vitórias ao mesmo tempo não abrem dois). Devolve o pacto ou null.
 */
MeuMundoDomainService.openPact = async function openPact(c, idUser, domain, sector, idFight, now) {
  if (!D.bossOf(domain, sector)) return null;
  const d = D.domainOf(domain);
  const game = Pact.gameOfGod(d.god);
  if (!game) return null;
  const k = await c.query(`SELECT clan FROM tb_mm_clan WHERE id_user = $1`, [idUser]);
  const clan = k.rows[0] && k.rows[0].clan;
  if (!Pact.CLANS.includes(clan)) return null;
  await c.query("SELECT pg_advisory_xact_lock($1, $2)", [PACT_LOCK_NS, pactKey(domain, clan)]);
  const cur = await PactStore.current(c, domain, clan, now);
  if (cur) return { ...cur, fresh: false };
  const w = Pact.window(now);
  const made = await PactStore.insert(c, { domain, god: d.god, game, clan, idUser, idFight, startsAt: w.startsAt, endsAt: w.endsAt });
  return made ? { ...made, fresh: true } : null;
};

/** Administrador passa direto (os testes desligam para ver a trava). */
MeuMundoDomainService.adminBypass = true;

module.exports = MeuMundoDomainService;
