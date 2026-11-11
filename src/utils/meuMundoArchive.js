// src/utils/meuMundoArchive.js — MEU MUNDO 3D, lore v2 F5: o ARQUIVO.
//
// Os textos que a pessoa destrava ao longo dos 10 capítulos
// (MEU MUNDO 3D/historia/v2/03-capitulos.md, linha "Arquivo:" de cada um, e as
// histórias de 02-historias.md, resumidas: 18+, contam o fato sem detalhar sangue).
// O texto mora no front (i18n, chaves `arq_<id>_title|body`); aqui ficam só os
// ids e o que destrava cada um. Quem destrava é o SERVIDOR (MeuMundoArchiveService):
//   done:<cap>          o capítulo terminou
//   step:<cap>:<passo>  o capítulo chegou naquele passo (o passo pede a leitura)
//   win:<monstro>       venceu uma luta conferida contra aquele monstro
// Basta UMA das condições. `at` (C3) = lugares onde o texto está (visit:<id>): a
// primeira leitura só vale com a última visita num deles (o livro do Ninho). `archive:<id>` (missão) = `read_at` gravado pelo servidor.
// Também aqui: os lugares de vídeo (um por capítulo, um por personagem).
"use strict";

const Q = require("./meuMundoQuests");

const entry = (id, chapter, unlock, at = null) => Object.freeze({ id, chapter, unlock: Object.freeze(unlock), at: at && Object.freeze(at) });

const ENTRIES = Object.freeze([
  entry("praca", 1, ["done:cap1"]),
  entry("tregua", 2, ["done:cap2"]),
  entry("nectar", 3, ["done:cap3"]),
  entry("soldados_pedra", 4, ["done:cap4"]),
  // o livro está na ruína do Ninho (Bairro das Matas) e, para o Vampiro, na Biblioteca do centro
  entry("registro_ninho", 5, ["step:cap5:ninho"], ["ninho", "biblioteca"]),
  entry("pequenos_ferro", 5, ["done:cap5"]),
  entry("ciborgue", 6, ["done:cap6", "win:ciborgue"]),
  entry("caderno_aeryn", 7, ["step:cap7:caderno"]),
  entry("dama_garras", 7, ["done:cap7", "win:garras"]),
  entry("pedraverde", 8, ["done:cap8", "win:stone"]),
  entry("brutamontes", 8, ["done:cap8", "win:brute"]),
  entry("ordem_sol", 9, ["done:cap9", "win:cavaleiro"]),
  entry("zephyra_almas", 10, ["step:cap10:preco"]),
  entry("maldicao_pedra", 10, ["done:cap10"]),
]);
const ENTRY_BY_ID = new Map(ENTRIES.map((e) => [e.id, e]));

/**
 * Quais entradas a pessoa já destravou (puro).
 * `chapters`: Map quest_id → { step, done } ; `wins`: Set de tipos de monstro vencidos.
 */
function unlockedIds(chapters, wins) {
  const ok = (cond) => {
    const [type, a, b] = cond.split(":");
    const row = chapters.get(a);
    if (type === "done") return !!(row && row.done);
    if (type === "win") return wins.has(a);
    if (type === "step") {
      if (!row) return false;
      if (row.done) return true;
      const ch = Q.CHAPTER_BY_ID.get(a);
      const idx = ch ? ch.steps.findIndex((s) => s.key === b) : -1;
      return idx >= 0 && row.step >= idx;
    }
    return false;
  };
  return ENTRIES.filter((e) => e.unlock.some(ok)).map((e) => e.id);
}

// ── vídeos (o Alex gera e sobe pelo admin; o jogo toca o arquivo enviado) ──
const VIDEO_KINDS = Object.freeze(["chapter", "character"]);
const VIDEO_SLOTS = Object.freeze({
  chapter: Object.freeze(Q.CHAPTERS.map((c) => c.id)),
  // os povos, os 8 deuses + Bastor e os monstros (historia/v2/02-historias.md)
  character: Object.freeze([
    "raposa",
    "vampiro",
    "aurion",
    "morkhan",
    "maru",
    "kragor",
    "iris",
    "zephyra",
    "noctis",
    "aeryn",
    "bastor",
    "ciborgue",
    "garras",
    "stone",
    "cavaleiro",
    "wolf",
    "brute",
  ]),
});
const isVideoSlot = (kind, ref) => VIDEO_KINDS.includes(kind) && VIDEO_SLOTS[kind].includes(ref);

module.exports = { ENTRIES, ENTRY_BY_ID, unlockedIds, VIDEO_KINDS, VIDEO_SLOTS, isVideoSlot };
