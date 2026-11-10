// src/services/MeuMundoPlaceService.js — MEU MUNDO 3D, lore v2 F4: visitas e conversa.
//
// A sala chama `recordVisit` FORA do laço (promessa solta, erro só registrado):
// grava um evento "visit" { place } no personagem vivo da pessoa. Os checks
// `visit:<lugar>` e `talk:<npc>` (MeuMundoQuestService) leem esses eventos.
// Sem withLife: é só um fato ("chegou aqui"), não mexe na vida nem dá prêmio.

const pool = require("../databases");
const P = require("../utils/meuMundoPlaces");

/** Personagem vivo de agora (o mesmo critério do AdventureStorage). */
const ALIVE_SQL = `SELECT id_character FROM tb_mm_character WHERE id_user = $1 AND status = 'alive' ORDER BY born_at DESC LIMIT 1`;

class MeuMundoPlaceService {
  /** Grava "chegou em <place>". Devolve true se gravou. */
  static async recordVisit(idUser, place, db = pool) {
    if (!idUser || !P.SAFE_ID.test(String(place || ""))) return false;
    const r = await db.query(
      `INSERT INTO tb_mm_character_event (id_character, at, kind, data)
       SELECT id_character, NOW(), 'visit', jsonb_build_object('place', $2::text) FROM (${ALIVE_SQL}) ch`,
      [idUser, place]
    );
    return r.rowCount > 0;
  }

  /** A última visita da pessoa (qualquer personagem dela): { place, at } ou null. */
  static async lastVisit(c, idUser) {
    const r = await c.query(
      `SELECT e.data->>'place' AS place, e.at FROM tb_mm_character_event e
         JOIN tb_mm_character ch ON ch.id_character = e.id_character
        WHERE ch.id_user = $1 AND e.kind = 'visit'
        ORDER BY e.at DESC, e.id_event DESC LIMIT 1`,
      [idUser]
    );
    return r.rows[0] || null;
  }

  /** A pessoa pode conversar com o NPC agora? (a última visita foi a um lugar dele, há pouco) */
  static async canTalk(c, idUser, npc, now = Date.now()) {
    const def = P.NPCS[npc];
    if (!def) return false;
    const last = await MeuMundoPlaceService.lastVisit(c, idUser);
    if (!last || !def.places.includes(last.place)) return false;
    return now - new Date(last.at).getTime() <= P.TALK_TTL_MS;
  }
}

module.exports = MeuMundoPlaceService;
