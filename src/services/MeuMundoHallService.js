// src/services/MeuMundoHallService.js — B8 (2026-11-08): LÂMINAS = HALL.
//
// As 10 cadeiras do Hall das Lâminas e o desafio pela vaga (regra pura em
// utils/meuMundoHallLadder.js, tabelas na mig 375). O desafio abre uma luta comum
// (MeuMundoAdventureService.fightStart, origem interna "hall") com a ficha congelada do
// defensor como `peer`; o fechamento (settleFight) chama `settle` na MESMA transação do
// recibo, então resultado, cadeiras e o aviso do defensor entram juntos ou nada entra.

const pool = require("../databases");
const Ladder = require("../utils/meuMundoHallLadder");
const Inbox = require("../storages/MeuMundoInboxStorage");
const PoderStore = require("../storages/MeuMundoPoderStorage");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ERRORS = {
  defender: ["Escolha alguém do Hall ou do top do Poder", 400],
  self: ["Você não pode desafiar a si mesmo", 400],
  eligible: ["Só dá para desafiar quem está no Hall ou no top 100 do Poder", 409],
  daily: ["Você já fez os 3 desafios de hoje", 429],
  again: ["Você já desafiou essa pessoa nas últimas 24 horas", 429],
  power: ["Seu personagem ainda não tem Poder", 409],
};
const fail = (code) => {
  const [error, statusCode] = ERRORS[code];
  return { error, statusCode, code };
};

// O dia de Brasília (o mesmo dos orçamentos da vida).
const TODAY_BR = `(NOW() AT TIME ZONE 'America/Sao_Paulo')::date`;

async function bestPower(db, idUser) {
  const r = await db.query(
    `SELECT COALESCE(MAX(power), 0)::int AS p FROM tb_mm_character WHERE id_user = $1 AND status = 'alive'`,
    [idUser]
  );
  return r.rows[0] ? Number(r.rows[0].p) : 0;
}

async function seatsMap(db, lock = false) {
  const r = await db.query(`SELECT seat, id_user FROM tb_mm_hall_seat ORDER BY seat${lock ? " FOR UPDATE" : ""}`);
  return new Map(r.rows.map((x) => [Number(x.seat), x.id_user]));
}

async function limitsOf(db, idUser) {
  const r = await db.query(
    `SELECT
       (SELECT COUNT(*)::int FROM tb_mm_hall_challenge
         WHERE challenger = $1 AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = ${TODAY_BR}) AS today,
       COALESCE((SELECT array_agg(DISTINCT defender) FROM tb_mm_hall_challenge
         WHERE challenger = $1 AND created_at > NOW() - make_interval(hours => $2)), '{}') AS recent`,
    [idUser, Ladder.LIMITS.SAME_DEFENDER_H]
  );
  const x = r.rows[0];
  return { today: Number(x.today), left: Math.max(0, Ladder.LIMITS.PER_DAY - Number(x.today)), recent: x.recent || [] };
}

/** Está no top 100 do Poder (melhor personagem vivo por pessoa, sem menor de idade, como o B7)? */
async function inTopPower(db, idUser) {
  const r = await db.query(
    `WITH best AS (
       SELECT c.id_user, MAX(c.power) AS p
         FROM tb_mm_character c JOIN tb_user u ON u.id_user = c.id_user
        WHERE c.status = 'alive' AND c.power IS NOT NULL AND u.is_minor = FALSE
        GROUP BY c.id_user)
     SELECT 1 + (SELECT COUNT(*) FROM best b2 WHERE b2.p > b.p)::int AS pos FROM best b WHERE b.id_user = $1`,
    [idUser]
  );
  return !!r.rows[0] && Number(r.rows[0].pos) <= Ladder.LIMITS.TOP_POWER;
}

/** O top 10 da Arena (cadeiras + vagas preenchidas pelo Poder), com o ranking do Poder lido. */
async function ladderOf(db) {
  const seats = await seatsMap(db);
  const top = await PoderStore.topPower(db, Ladder.SEATS * 3);
  return { seats, top, ten: Ladder.topTen(seats, top.map((x) => x.idUser)) };
}

/** Foto do perfil-conta (a da Freelandoo) de cada um; conta bloqueada = sem foto. */
async function photosOf(db, ids) {
  const UserPublicSummaryStorage = require("../storages/UserPublicSummaryStorage");
  const UserBlockStorage = require("../storages/UserBlockStorage");
  const out = new Map();
  await Promise.all(
    ids.map(async (u) => {
      const [state, acc] = await Promise.all([UserBlockStorage.accountState(db, u).catch(() => null), UserPublicSummaryStorage.getAccountProfile(db, u).catch(() => null)]);
      if (state && !state.blocked_at && acc && acc.avatar_url) out.set(u, acc.avatar_url);
    })
  );
  return out;
}

class MeuMundoHallService {
  /** Os ids do top 10 agora (o card de perfil do Hall só abre para eles). */
  static async topTenUsers() {
    const { ten } = await ladderOf(pool);
    return ten.map((e) => e.user).filter(Boolean);
  }

  /** GET /hall/board — as cadeiras, quem dá para desafiar, os meus limites e o histórico. */
  static async board(idUser) {
    const seats = await pool.query(
      `SELECT s.seat, s.id_user, s.since, s.defenses, u.username
         FROM tb_mm_hall_seat s JOIN tb_user u ON u.id_user = s.id_user
        ORDER BY s.seat`
    );
    // Poder e corpo de quem está sentado: a mesma leitura do ranking (B7), no máximo 10
    const info = new Map();
    for (const x of seats.rows) info.set(x.id_user, await PoderStore.myPower(pool, x.id_user));
    const lim = await limitsOf(pool, idUser);
    const seated = new Set(seats.rows.map((x) => x.id_user));
    const { top, ten } = await ladderOf(pool);
    const row = (x) => ({ id: x.id_user, name: x.username || "—", isMe: x.id_user === idUser, cooldown: lim.recent.includes(x.id_user) });
    const history = await pool.query(
      `SELECT h.id_challenge, h.challenger, h.defender, h.status, h.seat_won, h.defender_seat, h.created_at,
              uc.username AS challenger_name, ud.username AS defender_name
         FROM tb_mm_hall_challenge h
         JOIN tb_user uc ON uc.id_user = h.challenger
         JOIN tb_user ud ON ud.id_user = h.defender
        WHERE h.challenger = $1 OR h.defender = $1
        ORDER BY h.created_at DESC LIMIT 20`,
      [idUser]
    );
    const seatRow = new Map(seats.rows.map((x) => [x.id_user, x]));
    const photos = await photosOf(pool, ten.map((e) => e.user).filter(Boolean));
    const powerRow = new Map(top.map((x) => [x.idUser, x]));
    return {
      seats: Ladder.SEATS,
      // a Arena: do 1º ao 10º (pódio 1–3, lista 4–10); vaga sem ninguém = person null
      top: ten.map((e) => {
        if (!e.user) return { pos: e.pos, seated: false, person: null };
        const sr = seatRow.get(e.user);
        const pr = powerRow.get(e.user);
        const inf = info.get(e.user);
        return {
          pos: e.pos,
          seated: e.seated,
          person: {
            id: e.user,
            name: (sr && sr.username) || (pr && (pr.username || pr.name)) || "—",
            isMe: e.user === idUser,
            cooldown: lim.recent.includes(e.user),
            power: Number((inf && inf.value) ?? (pr && pr.value) ?? 0),
            body: (inf && inf.body) || (pr && pr.body) || null,
            defenses: sr ? Number(sr.defenses) : 0,
            // a foto do perfil da Freelandoo (toque abre o card do perfil)
            photo: photos.get(e.user) || null,
          },
        };
      }),
      hall: seats.rows.map((x) => ({ seat: Number(x.seat), ...row(x), power: Number(info.get(x.id_user)?.value || 0), body: info.get(x.id_user)?.body || null, since: new Date(x.since).toISOString(), defenses: Number(x.defenses) })),
      // top do Poder que ainda não está no Hall (o B7 já filtra menor de idade)
      contenders: top
        .filter((x) => !seated.has(x.idUser))
        .map((x) => ({ id: x.idUser, name: x.username || x.name || "—", isMe: x.idUser === idUser, power: Number(x.value), position: x.position, body: x.body || null, cooldown: lim.recent.includes(x.idUser) })),
      me: { seat: [...seats.rows].find((x) => x.id_user === idUser)?.seat ?? null, power: await bestPower(pool, idUser), left: lim.left, perDay: Ladder.LIMITS.PER_DAY },
      history: history.rows.map((h) => ({
        id: h.id_challenge,
        role: h.challenger === idUser ? "challenger" : "defender",
        other: h.challenger === idUser ? h.defender_name || "—" : h.challenger_name || "—",
        status: h.status,
        seatWon: h.seat_won,
        defenderSeat: h.defender_seat,
        at: new Date(h.created_at).toISOString(),
      })),
    };
  }

  /** POST /hall/challenge { defender } — abre a luta contra a ficha congelada do defensor. */
  static async challenge(idUser, body = {}) {
    const defender = String(body.defender || "");
    if (!UUID.test(defender)) return fail("defender");
    if (defender === idUser) return fail("self");
    const { seats, ten } = await ladderOf(pool);
    // defensor de fora mostrado numa vaga do top 10: vencer dá aquela cadeira
    const shown = ten.find((e) => e.user === defender && !e.seated);
    const target = shown ? shown.pos : null;
    const defSeat = [...seats].find(([, u]) => u === defender)?.[0] ?? null;
    if (defSeat == null && !(await inTopPower(pool, defender))) return fail("eligible");
    const myPower = await bestPower(pool, idUser);
    const defPower = await bestPower(pool, defender);
    if (!(myPower > 0)) return fail("power");
    if (!(defPower > 0)) return fail("eligible");
    const peer = Ladder.peerOf(myPower, defPower);
    const mySeat = [...seats].find(([, u]) => u === idUser)?.[0] ?? null;
    const Adventure = require("./MeuMundoAdventureService");
    const out = await Adventure.fightStart(idUser, { origin: "hall" }, {
      hall: {
        peer,
        // dentro da transação da luta (a pessoa travada pelo withLife): limites conferidos
        // de novo e o desafio gravado junto do ticket — erro aqui desfaz o ticket.
        onOpen: async (c, idFight) => {
          const lim = await limitsOf(c, idUser);
          if (lim.left <= 0) return fail("daily");
          if (lim.recent.includes(defender)) return fail("again");
          await c.query(
            `INSERT INTO tb_mm_hall_challenge (id_fight, challenger, defender, challenger_seat, defender_seat, challenger_power, defender_power, peer, target_seat)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [idFight, idUser, defender, mySeat, defSeat, myPower, defPower, peer, target]
          );
          return null;
        },
      },
    });
    if (out.error) return out;
    return { ...out, challenge: { defender, defenderSeat: defSeat, targetSeat: target, peer, myPower, defenderPower: defPower } };
  }

  /**
   * Fecha o desafio da luta `idFight` (chamado pelo settleFight, na transação do recibo).
   * Vitória: troca de cadeira (ou senta na primeira vaga); derrota/abandono: defesa conta.
   */
  static async settle(c, idFight, win) {
    const r = await c.query(`SELECT * FROM tb_mm_hall_challenge WHERE id_fight = $1 AND status = 'open' FOR UPDATE`, [idFight]);
    const h = r.rows[0];
    if (!h) return null;
    const names = await c.query(`SELECT id_user, username FROM tb_user WHERE id_user = ANY($1::uuid[])`, [[h.challenger, h.defender]]);
    const nameOf = (u) => names.rows.find((x) => x.id_user === u)?.username || "—";
    let seatWon = null;
    if (win) {
      const before = await seatsMap(c, true);
      const after = Ladder.afterWin(before, h.challenger, h.defender, h.target_seat == null ? null : Number(h.target_seat));
      seatWon = after.seatWon;
      if (seatWon != null) {
        // regrava só as cadeiras que mudaram (DELETE + INSERT: id_user é único)
        const changed = [...after.seats].filter(([k, u]) => before.get(k) !== u).map(([k]) => k);
        await c.query(`DELETE FROM tb_mm_hall_seat WHERE seat = ANY($1::int[])`, [changed]);
        for (const k of changed) await c.query(`INSERT INTO tb_mm_hall_seat (seat, id_user, since, defenses) VALUES ($1, $2, NOW(), 0)`, [k, after.seats.get(k)]);
      }
    } else {
      await c.query(`UPDATE tb_mm_hall_seat SET defenses = defenses + 1 WHERE id_user = $1`, [h.defender]);
    }
    await c.query(`UPDATE tb_mm_hall_challenge SET status = $2, seat_won = $3, finished_at = NOW() WHERE id_challenge = $1`, [h.id_challenge, win ? "won" : "lost", seatWon]);
    // aviso no sino do defensor (ele não precisava estar online)
    await Inbox.insertNotice(c, h.defender, {
      kind: "life",
      code: win ? (seatWon != null && h.defender_seat != null ? "hall_lost" : "hall_beaten") : "hall_defended",
      priority: 2,
      data: { name: nameOf(h.challenger), seat: h.defender_seat, seatWon },
      dedupeKey: `hall:${h.id_challenge}`,
    });
    return { status: win ? "won" : "lost", seatWon };
  }
}

module.exports = MeuMundoHallService;
