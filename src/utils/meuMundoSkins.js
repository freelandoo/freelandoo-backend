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

// Os Sete e Morkhan (espelho de features/meu-mundo/gods.ts no cliente).
const GODS = Object.freeze([
  ["aurion", "Aurion"],
  ["morkhan", "Morkhan"],
  ["kragor", "Kragor"],
  ["zephyra", "Zéphyra"],
  ["maru", "Marú"],
  ["iris", "Íris"],
  ["noctis", "Noctis"],
  ["aeryn", "Aeryn"],
  // Outras skins de 2 m com a mesma receita (mig 314); Golem, Ciborgue e Dama
  // também são monstros da Arena das Lâminas.
  ["ciborgue", "Ciborgue"],
  ["cavaleiro", "Cavaleiro Dourado"],
  ["golem", "Golem de Pedra"],
  ["garras", "Dama das Garras"],
]);

const CATALOG = Object.freeze([
  // O personagem padrão: de todos, de graça, corpo = condição física.
  Object.freeze({ id: STANDARD, kind: "standard", name: "Padrão", price: 0, currency: "coins", body: null }),
  // O lutador da RA da Casa Views (mm3d-10).
  Object.freeze({ id: "sergio", kind: "skin", name: "Sergio", price: 1000, currency: "coins", body: "sergio" }),
  // A versão feminina da personagem padrão (mm3d-30): mesmo esqueleto e mesmas
  // animações do padrão, de graça — escolher a personagem não é produto.
  Object.freeze({ id: "feminina", kind: "skin", name: "Feminina", price: 0, currency: "coins", body: "female" }),
  // Ekaterina (mm3d-30): personagem própria, como o Sergio — mesmo preço dele.
  Object.freeze({ id: "ekaterina", kind: "skin", name: "Ekaterina", price: 1000, currency: "coins", body: "ekaterina" }),
  // Os deuses de Lúmen (mm3d-50, mig 313): skins de 2 m com as animações do
  // Sergio. Preço PROVISÓRIO em moedas (hoje só admin joga, e admin adquire de
  // graça); a regra da lore (3 meses em 1º ou compra) entra com o ranking.
  ...GODS.map(([id, name]) => Object.freeze({ id, kind: "skin", name, price: 5000, currency: "coins", body: id })),
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

module.exports = { STANDARD, GODS, CATALOG, skinById, avatarBody, costFor, publicCatalog };
