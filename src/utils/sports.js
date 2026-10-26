// src/utils/sports.js
// A lista de esportes da plataforma Esportes (mig 306 — a antiga plataforma
// Fitness; o `community_kind` continua 'fitness' por dentro). FONTE ÚNICA: o
// front recebe a lista pronta do GET /fitness/sport em vez de manter a sua, e
// é aqui que um esporte novo entra (chave estável, ASCII; o rótulo pode mudar).
//
// Pedido do Alex (2026-10-26): "academia, futebol, basket, puxa os principais e
// beach tênis também". Cada pessoa escolhe UM (o "Meu esporte") e cada post
// publicado na plataforma leva o seu.

const SPORTS = Object.freeze([
  { key: "academia", label: "Academia" },
  { key: "futebol", label: "Futebol" },
  { key: "futsal", label: "Futsal" },
  { key: "volei", label: "Vôlei" },
  { key: "basquete", label: "Basquete" },
  { key: "corrida", label: "Corrida" },
  { key: "ciclismo", label: "Ciclismo" },
  { key: "natacao", label: "Natação" },
  { key: "lutas", label: "Lutas" },
  { key: "tenis", label: "Tênis" },
  { key: "beach_tenis", label: "Beach Tennis" },
  { key: "padel", label: "Padel" },
  { key: "crossfit", label: "Crossfit / Funcional" },
  { key: "yoga_pilates", label: "Yoga / Pilates" },
  { key: "skate", label: "Skate" },
  { key: "surf", label: "Surf" },
  { key: "outro", label: "Outro esporte" },
]);

const KEYS = new Set(SPORTS.map((s) => s.key));

/** Chave válida ou null — nunca lança (o post sem esporte continua publicando). */
function parseSport(raw) {
  const k = String(raw || "").trim().toLowerCase();
  return KEYS.has(k) ? k : null;
}

module.exports = { SPORTS, parseSport };
