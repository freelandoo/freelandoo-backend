// src/utils/meuMundoShop.js
//
// MEU MUNDO 3D — o VENDEDOR do centro (mm3d-37e): fica sentado na sala
// "Imóveis e Veículos" do supermercado e vende casas e cores do carro, em
// moedas do jogo (tb_mm_wallet). Pedido do Alex: comprar casas e carros
// conversando com ele; o carro é o superesportivo em cores (quem já tem fica
// com o seu, vermelho).
//
//  - Casa: o NÍVEL da casa da residência. Subir paga o preço do nível novo;
//    descer é de graça (a casa é sua, o tamanho você escolhe).
//  - Carro: cada cor se compra UMA vez e depois se troca à vontade; a cor é
//    da casa (o carro mora no lote) e todos veem na rua e no centro.
//
// O cliente pinta a lataria trocando as duas cores de vértice do modelo
// (PAINT_SOURCE ↔ engine/cars.ts) — o resto do carro (vidro, pneu, luz) fica.

const HOUSE_PRICES = Object.freeze({ 1: 0, 2: 800, 3: 1500, 4: 2500, 5: 4000, 6: 6000, 7: 9000, 8: 13000, 9: 18000 });

const DEFAULT_PAINT = "vermelho";
const PAINT_PRICE = 600;
// Cor da lataria (sRGB) de cada opção; `vermelho` é a de fábrica.
const CAR_PAINTS = Object.freeze([
  Object.freeze({ id: "vermelho", hex: "#DB1714", price: 0 }),
  Object.freeze({ id: "preto", hex: "#1C1D22", price: PAINT_PRICE }),
  Object.freeze({ id: "branco", hex: "#EEF0F2", price: PAINT_PRICE }),
  Object.freeze({ id: "prata", hex: "#A7ADB5", price: PAINT_PRICE }),
  Object.freeze({ id: "azul", hex: "#2257D6", price: PAINT_PRICE }),
  Object.freeze({ id: "amarelo", hex: "#F2C230", price: PAINT_PRICE }),
  Object.freeze({ id: "verde", hex: "#1E8A4A", price: PAINT_PRICE }),
  Object.freeze({ id: "laranja", hex: "#F07A28", price: PAINT_PRICE }),
  Object.freeze({ id: "roxo", hex: "#7B4FC0", price: PAINT_PRICE }),
  Object.freeze({ id: "rosa", hex: "#F08DB4", price: PAINT_PRICE }),
]);
const PAINT_BY_ID = new Map(CAR_PAINTS.map((p) => [p.id, p]));

/** Preço para ir do nível `from` ao `to` (descer é de graça). */
function housePrice(from, to) {
  if (!Number.isInteger(to) || HOUSE_PRICES[to] == null) return null;
  return to > from ? HOUSE_PRICES[to] : 0;
}

/** Cor válida para a rede/o banco (desconhecida → a de fábrica). */
function paintOf(id) {
  return PAINT_BY_ID.has(id) ? id : DEFAULT_PAINT;
}

module.exports = { HOUSE_PRICES, DEFAULT_PAINT, PAINT_PRICE, CAR_PAINTS, PAINT_BY_ID, housePrice, paintOf };
