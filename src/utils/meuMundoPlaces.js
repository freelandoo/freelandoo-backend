// src/utils/meuMundoPlaces.js — MEU MUNDO 3D, lore v2 F4: lugares e conversa.
//
// `visit:<lugar>`: a SALA (centro e bairro) confere a cada meio segundo em que
// ponto nomeado cada pessoa está e, quando ela CHEGA num ponto (ou fica nele por
// mais de VISIT_REPEAT_MS), grava um evento "visit" — fora do laço, sem esperar
// o banco. Entrar num prédio conta como visita porque a porta de cada prédio é
// um ponto (quem entra passa por ela). Os pontos moram com a planta:
// VISIT_POINTS de meuMundoCenter.js (centro) e de meuMundoLayout.js (bairro).
// "bairro" (o seu, como titular) e "casa" (a sua) são gravados pela sala na entrada.
//
// `talk:<npc>`: a conversa abre no aparelho, mas quem grava é o servidor
// (POST /quest/mark { mark: "talk", npc }), e só se a ÚLTIMA visita da pessoa foi
// a um lugar daquele NPC, há menos de TALK_TTL_MS.
"use strict";

/** De quanto em quanto tempo a sala confere os pontos (ms). */
const VISIT_EVERY_MS = 500;
/** Parado no mesmo ponto: grava de novo depois disto (o passo pode abrir com a pessoa já lá). */
const VISIT_REPEAT_MS = 60 * 1000;
/** Duas gravações da mesma pessoa nunca ficam mais perto que isto (borda de ponto). */
const VISIT_MIN_GAP_MS = 3000;
/** A conversa vale se a última visita ao lugar do NPC foi há menos que isto. */
const TALK_TTL_MS = 60 * 60 * 1000;

/**
 * NPCs que conversam. `places` = onde a pessoa precisa ter chegado por último
 * (porta do prédio ou ponto da rua). As falas moram no front (i18n).
 */
const NPCS = Object.freeze({
  // Dra. Nívea: a criogenista do Laboratório
  nivea: Object.freeze({ places: Object.freeze(["criolab"]) }),
  // o Delegado: a Trégua
  delegado: Object.freeze({ places: Object.freeze(["delegacia"]) }),
  // os dois velhos da praça, perto de Morkhan
  raposa_velha: Object.freeze({ places: Object.freeze(["praca", "estatua_morkhan"]) }),
  vampiro_velho: Object.freeze({ places: Object.freeze(["praca", "estatua_morkhan"]) }),
  // C2: o Arauto da Lua, no pedestal de Morkhan (só ambiente: nenhum passo pede talk: dele).
  // A Sacerdotisa do Sol fica no bairro (meuMundoLayout.js) e também é só ambiente.
  arauto: Object.freeze({ places: Object.freeze(["praca", "estatua_morkhan"]) }),
  // C3 (caps. 4 e 5): Forjador, Armeiro e a bibliotecária (que guarda o livro do Ninho). Só ambiente.
  forjador: Object.freeze({ places: Object.freeze(["forja"]) }),
  armeiro: Object.freeze({ places: Object.freeze(["arsenal"]) }),
  bibliotecaria: Object.freeze({ places: Object.freeze(["biblioteca"]) }),
});

/** Ponto circular (`r`) ou quadrado (`half`). */
const area = (p) => (p.r != null ? Math.PI * p.r * p.r : 4 * p.half * p.half);
const inside = (p, x, z) => (p.r != null ? Math.hypot(x - p.x, z - p.z) <= p.r : Math.abs(x - p.x) <= p.half && Math.abs(z - p.z) <= p.half);

/** O ponto mais ESPECÍFICO (menor) que contém (x, z), ou null. */
function pickVisit(points, x, z) {
  let best = null;
  for (const p of points) {
    if (!inside(p, x, z)) continue;
    if (!best || area(p) < area(best)) best = p;
  }
  return best ? best.id : null;
}

/**
 * O que a sala faz a cada conferência (puro, para o teste): `s` guarda o ponto
 * de agora e quando gravou. Devolve o lugar a gravar ou null.
 */
function visitDue(s, id, now) {
  if (!id) {
    s.visitHere = null;
    return null;
  }
  if (id === s.visitHere && now - (s.visitAt || 0) < VISIT_REPEAT_MS) return null;
  if (now - (s.visitAt || 0) < VISIT_MIN_GAP_MS) return null; // tenta de novo na próxima conferência
  s.visitHere = id;
  s.visitAt = now;
  return id;
}

/** Nome de lugar e de NPC: só minúsculas, número e _. */
const SAFE_ID = /^[a-z0-9_]{1,40}$/;

module.exports = { VISIT_EVERY_MS, VISIT_REPEAT_MS, VISIT_MIN_GAP_MS, TALK_TTL_MS, NPCS, SAFE_ID, pickVisit, visitDue };
