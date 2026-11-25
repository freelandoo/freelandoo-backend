// 25/11/2026 (Alex: "se tá batendo 13, o S tem que ser no máximo 50"): o peso do golpe multiplica o dano já
// passado pela defesa — o Poder/habilidade nunca explode quando o golpe normal está no piso.
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../src/utils/meuMundoFight");

test("golpe forte = peso × golpe normal (ataque perto da defesa)", () => {
  const comboMean = (14 + 16 + 26) / 3;
  const power = F.POWER.bladeDmg / comboMean; // ~2,25
  for (const [atk, def] of [[260, 255], [260, 200], [260, 400], [1000, 50]]) {
    const normal = F.strikeWeighted(atk, def, 1);
    const s = F.strikeWeighted(atk, def, power);
    assert.ok(Math.abs(s / normal - power) < 1e-9, `${atk}/${def}`);
    assert.ok(s <= normal * 4, `${atk}/${def}: ${s} > 4× ${normal}`);
  }
  // o caso do print: 13 no golpe normal → o Poder fica perto de 29, nunca 393
  assert.equal(Math.round(F.strikeWeighted(260, 300, 1)), 13);
  assert.ok(Math.round(F.strikeWeighted(260, 300, power)) <= 50);
  // a média do combo acima da defesa não muda (a soma dos pesos do combo é 3)
  const old = [14, 16, 26].reduce((a, d) => a + F.strike((1000 * d) / comboMean, 50), 0);
  const now = [14, 16, 26].reduce((a, d) => a + F.strikeWeighted(1000, 50, d / comboMean), 0);
  assert.ok(Math.abs(old - now) < 1e-6);
});
