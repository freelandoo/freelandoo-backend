// 25/11/2026 (Alex: "ué, mas ele está com espada nas lutas"): a loja chama de guerreiro quem LUTA de espada.
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../../src/services/MeuMundoGearService");

test("guerreiro da loja = quem luta de espada (skin sem classe usa a classe da conta)", () => {
  assert.equal(G.swordUser("vampiro", "vampiro"), true);
  assert.equal(G.swordUser("aurion", "raposa"), true); // skin de espada
  assert.equal(G.swordUser("raposa", "vampiro"), false); // a skin de raposa manda: maga
  assert.equal(G.swordUser("sergio", "vampiro"), true); // skin sem classe + conta vampiro = espada na luta
  assert.equal(G.swordUser("sergio", "raposa"), false); // skin sem classe + conta raposa = maga
  assert.equal(G.swordUser("sergio", null), true); // sem classe nenhuma a luta é de espada
  assert.equal(G.swordUser("kragor", "vampiro"), false); // martelo
  assert.equal(G.swordUser("iris", "vampiro"), false); // arco
  assert.equal(G.swordUser("noctis", "vampiro"), false); // arma de fogo
});
