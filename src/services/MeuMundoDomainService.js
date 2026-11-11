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

const ERRORS = {
  domain: ["Domínio desconhecido", 404],
  closed: ["Esse Domínio ainda está fechado", 403],
  sector: ["Esse setor ainda está fechado", 403],
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
    return { trainer, bypass, power: await powerOf(db, idUser), sectors: D.SECTORS, domains: D.view(trainer, best, bypass) };
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
    const domain = D.view(trainer, best, bypass).find((d) => d.id === id);
    return { trainer, bypass, power: await powerOf(db, idUser), domain };
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
    return { domain: id, sector, kind: D.kindOf(id, sector), level: D.sectorLevel(id, sector) };
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

/** Administrador passa direto (os testes desligam para ver a trava). */
MeuMundoDomainService.adminBypass = true;

module.exports = MeuMundoDomainService;
