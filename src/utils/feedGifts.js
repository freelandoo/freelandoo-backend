// Catálogo do Baú (Feed Interativo F3, mig 457). FONTE da validação no back;
// o front tem o visual de cada id em lib/feed-fx/gifts.ts (mesmos ids).
// Figurinha nova = id novo aqui E lá. Nunca reaproveitar id (a coleção guarda).

const STICKERS = {
  coroa: "raro",
  raio: "comum",
  chama: "comum",
  estrela: "comum",
  coracao: "comum",
  foguete: "raro",
  gema: "lendario",
  sol: "comum",
  lua: "raro",
  nota: "comum",
  trofeu: "lendario",
  faisca: "comum",
};

const REACTIONS = ["confete", "fogos", "chuva-de-mel", "coracoes"];
const CHESTS = ["madeira", "ferro", "ouro"];
const MESSAGE_MAX = 140;

module.exports = { STICKERS, REACTIONS, CHESTS, MESSAGE_MAX };
