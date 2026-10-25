// src/utils/meuMundoSkins.js — MEU MUNDO 3D: vestuário (mm3d-16, mig 300).
//
// Duas coisas diferentes que NÃO se misturam:
//   CONDIÇÃO  magro, normal, gordo, forte — o corpo do personagem PADRÃO,
//             que sai da vida (meuMundoLife.js, bodyHint). Não se compra nem
//             se escolhe.
//   SKIN      outro visual inteiro (ex.: o Sergio), comprado com as moedas do
//             jogo — ou, se `currency: "polens"`, EXCLUSIVA de Poléns (mm3d-30:
//             a carteira de Poléns da Freelandoo; nunca se paga com moedas).
//             Vestida, o avatar é o dela, em qualquer condição.
//
// O cliente espelha os ids em features/meu-mundo/skins.ts (arte, fundo e
// nome visível); quem vale aqui é o PREÇO e o corpo de cada skin. Skin nova =
// uma linha em cada lado, com a mesma chave, e o corpo dela em BODIES
// (MeuMundoStorage) + CHECK chk_mm_avatar_body.

const STANDARD = "standard";

const CATALOG = Object.freeze([
  // O personagem padrão: de todos, de graça, corpo = condição física.
  Object.freeze({ id: STANDARD, kind: "standard", name: "Padrão", price: 0, currency: "coins", body: null }),
  // O lutador da RA da Casa Views (mm3d-10).
  Object.freeze({ id: "sergio", kind: "skin", name: "Sergio", price: 1000, currency: "coins", body: "sergio" }),
]);

const BY_ID = new Map(CATALOG.map((s) => [s.id, s]));

const skinById = (id) => BY_ID.get(String(id || "")) || null;

/** Corpo que a sala desenha: o da skin vestida ou, no padrão, a condição. */
function avatarBody(condition, skin) {
  const s = skinById(skin);
  return (s && s.body) || condition || "normal";
}

/**
 * Quanto a pessoa paga: administrador adquire de graça o que é em moedas do
 * jogo. Poléns são dinheiro de verdade — exclusiva de Poléns cobra de todos.
 */
const costFor = (skin, admin) => (admin && skin.currency !== "polens" ? 0 : skin.price);

/** Catálogo para a rede, com o que a pessoa tem, o que está vestido e quanto custa para ela. */
function publicCatalog(owned, equipped, admin = false) {
  const mine = new Set(owned);
  return CATALOG.map((s) => ({
    id: s.id,
    kind: s.kind,
    name: s.name,
    price: s.price,
    currency: s.currency,
    cost: costFor(s, admin),
    owned: s.kind === "standard" || mine.has(s.id),
    equipped: s.id === (skinById(equipped) ? equipped : STANDARD),
  }));
}

module.exports = { STANDARD, CATALOG, skinById, avatarBody, costFor, publicCatalog };
