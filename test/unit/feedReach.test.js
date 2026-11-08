// Alcance regional do feed (A1, mig 328): fórmula, limiar ±15%, promoção de
// degrau, faixas do leitor e ordem das faixas no mix.
const test = require("node:test");
const assert = require("node:assert");
const R = require("../../src/utils/feedReach");
const { orderByReachBands, makeRng } = require("../../src/utils/feedMix");

const ID_LOW = "00000000-0000-4000-8000-000000000000"; // fator 0,85
const ID_HIGH = "ffffffff-0000-4000-8000-000000000000"; // fator 1,15
const SP_ABC = { area_id: 3, region_id: 70, uf: "SP" };

test("pesos aprovados", () => {
  assert.deepStrictEqual(
    { ...R.REACH_WEIGHTS },
    { view: 1, like: 5, profile_click: 4, whatsapp_click: 6, comment: 10, save: 30, share: 40, dislike: -2 }
  );
  assert.strictEqual(R.RETENTION_SECONDS_PER_POINT, 10);
  assert.deepStrictEqual([...R.REACH_THRESHOLDS], [0, 1000, 10000, 100000, 300000]);
});

test("velocidade do compartilhamento: 1,0 a 2,0 pela raiz", () => {
  assert.strictEqual(R.shareVelocity(1), 1);
  assert.strictEqual(R.shareVelocity(0), 1);
  assert.ok(Math.abs(R.shareVelocity(2) - 1.2) < 1e-9);
  assert.ok(Math.abs(R.shareVelocity(5) - 1.4) < 1e-9);
  assert.strictEqual(R.shareVelocity(26), 2);
  assert.strictEqual(R.shareVelocity(500), 2);
  for (let n = 1; n < 40; n++) assert.ok(R.shareVelocity(n + 1) >= R.shareVelocity(n));
  assert.strictEqual(R.sharePoints(1), 40);
  assert.strictEqual(R.sharePoints(26), 80);
});

test("retenção: +1 a cada 10 s pela diferença", () => {
  assert.strictEqual(R.retentionPoints(0, 9), 0);
  assert.strictEqual(R.retentionPoints(0, 10), 1);
  assert.strictEqual(R.retentionPoints(9, 21), 2);
  assert.strictEqual(R.retentionPoints(3590, 3600), 1);
  assert.strictEqual(R.retentionPoints(30, 20), 0);
});

test("fator do limiar: determinístico, em [0,85; 1,15], do id", () => {
  assert.ok(Math.abs(R.reachFactor(ID_LOW) - 0.85) < 1e-9);
  assert.ok(Math.abs(R.reachFactor(ID_HIGH) - 1.15) < 1e-9);
  const id = "8f3c2a10-1111-4222-8333-444455556666";
  assert.strictEqual(R.reachFactor(id), R.reachFactor(id));
  for (let i = 0; i < 500; i++) {
    const hex = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");
    const f = R.reachFactor(`${hex}-0000-4000-8000-000000000000`);
    assert.ok(f >= 0.85 && f <= 1.15, `fator fora: ${f}`);
  }
  // o mesmo fator vale para todos os degraus do post
  for (let l = 1; l <= 4; l++) {
    assert.ok(Math.abs(R.reachThreshold(l, ID_HIGH) / R.REACH_THRESHOLDS[l] - 1.15) < 1e-9);
  }
});

test("limiar nunca exato: 1.000 não basta para o post de fator alto", () => {
  assert.strictEqual(R.reachLevelFor(1000, ID_HIGH, SP_ABC), R.REACH_LEVEL.CITY);
  assert.strictEqual(R.reachLevelFor(1150, ID_HIGH, SP_ABC), R.REACH_LEVEL.AREA);
  assert.strictEqual(R.reachLevelFor(850, ID_LOW, SP_ABC), R.REACH_LEVEL.AREA);
  assert.strictEqual(R.reachLevelFor(849, ID_LOW, SP_ABC), R.REACH_LEVEL.CITY);
});

test("degraus por pontos", () => {
  const id = ID_LOW;
  assert.strictEqual(R.reachLevelFor(0, id, SP_ABC), 0);
  assert.strictEqual(R.reachLevelFor(8500, id, SP_ABC), 2);
  assert.strictEqual(R.reachLevelFor(85000, id, SP_ABC), 3);
  assert.strictEqual(R.reachLevelFor(255000, id, SP_ABC), 4);
  assert.strictEqual(R.reachLevelFor(254999, id, SP_ABC), 3);
});

test("cidade sem área pula direto para a região; sem região, para o estado", () => {
  const semArea = { area_id: null, region_id: 70, uf: "SP" };
  assert.strictEqual(R.reachLevelFor(900, ID_LOW, semArea), R.REACH_LEVEL.REGION);
  const semRegiao = { area_id: null, region_id: null, uf: "MG" };
  assert.strictEqual(R.reachLevelFor(900, ID_LOW, semRegiao), R.REACH_LEVEL.STATE);
});

test("post sem UF só sai do 0 na meta do Brasil", () => {
  const nada = {};
  assert.strictEqual(R.reachLevelFor(90000, ID_LOW, nada), 0);
  assert.strictEqual(R.reachLevelFor(255000, ID_LOW, nada), 4);
});

test("o alcance só sobe", () => {
  assert.strictEqual(R.nextReachLevel(3, 0, ID_LOW, SP_ABC), 3);
  assert.strictEqual(R.nextReachLevel(1, 9000, ID_LOW, SP_ABC), 2);
});

const VIEWER_ABC = { city_key: "santo andre", area_id: 3, region_id: 70, uf: "SP" };
const post = (o) => ({ reach_level: 0, reach_city_key: null, reach_area_id: null, reach_region_id: null, reach_uf: null, ...o });

test("cobertura e faixas do leitor", () => {
  const local = post({ reach_city_key: "santo andre", reach_area_id: 3, reach_region_id: 70, reach_uf: "SP" });
  assert.strictEqual(R.reachBand(local, VIEWER_ABC), 0);
  const vizinho = post({ reach_city_key: "maua", reach_area_id: 3, reach_region_id: 70, reach_uf: "SP" });
  assert.strictEqual(R.reachBand(vizinho, VIEWER_ABC), 1, "mesma área, ainda na cidade dele");
  assert.strictEqual(R.reachBand({ ...vizinho, reach_level: 1 }, VIEWER_ABC), 0, "chegou à área");
  const capital = post({ reach_city_key: "sao paulo", reach_region_id: 70, reach_uf: "SP" });
  assert.strictEqual(R.reachBand(capital, VIEWER_ABC), 2);
  assert.strictEqual(R.reachBand({ ...capital, reach_level: 2 }, VIEWER_ABC), 0);
  const campinas = post({ reach_city_key: "campinas", reach_region_id: 72, reach_uf: "SP" });
  assert.strictEqual(R.reachBand(campinas, VIEWER_ABC), 3);
  assert.strictEqual(R.reachBand({ ...campinas, reach_level: 3 }, VIEWER_ABC), 0);
  const bh = post({ reach_city_key: "belo horizonte", reach_region_id: 60, reach_uf: "MG" });
  assert.strictEqual(R.reachBand(bh, VIEWER_ABC), 4);
  assert.strictEqual(R.reachBand({ ...bh, reach_level: 4 }, VIEWER_ABC), 0);
  // cidade com o mesmo nome em outro estado não é a mesma cidade
  const outra = post({ reach_city_key: "santo andre", reach_uf: "PB" });
  assert.strictEqual(R.reachBand(outra, VIEWER_ABC), 4);
});

test("anônimo / sem cidade: alcance maior na frente", () => {
  assert.strictEqual(R.reachBand(post({ reach_level: 4 }), null), 0);
  assert.strictEqual(R.reachBand(post({ reach_level: 3, reach_uf: "SP" }), null), 1);
  assert.strictEqual(R.reachBand(post({ reach_level: 0, reach_uf: "SP" }), null), 4);
  assert.strictEqual(R.reachBand(post({ reach_level: 2 }), { city_key: null, uf: null }), 2);
});

test("parâmetros da faixa em SQL: filtro manual desliga", () => {
  assert.deepStrictEqual(R.reachBandParams(VIEWER_ABC), ["santo andre", 3, 70, "SP", "reach"]);
  assert.deepStrictEqual(R.reachBandParams(null, { off: true }), [null, null, null, null, "off"]);
  const sql = R.reachBandSql("ppi", { city: 11, area: 12, region: 13, uf: 14, mode: 15 });
  assert.match(sql, /\$15::text = 'off'/);
  assert.match(sql, /ppi\.reach_level >= 4/);
});

test("rótulo do dono", () => {
  assert.deepStrictEqual(R.reachLabel({ reach_level: 1, reach_area_name: "ABC Paulista" }), {
    level: 1, key: "area", place: "ABC Paulista",
  });
  assert.deepStrictEqual(R.reachLabel({ reach_level: 4 }), { level: 4, key: "country", place: null });
  assert.strictEqual(R.reachLabel({ reach_level: 3, reach_uf: "SP" }).place, "SP");
});

test("feedMix: faixas na ordem, mix dentro de cada uma, determinístico", () => {
  const rows = [];
  const now = Date.now();
  for (let b = 4; b >= 0; b--) {
    for (let i = 0; i < 7; i++) {
      rows.push({
        post_id: `b${b}-${i}`,
        reach_band: b,
        engagement_score: i * 3,
        impressions_count: 500,
        published_at: new Date(now - 100 * 3_600_000).toISOString(),
      });
    }
  }
  const a = orderByReachBands(rows, makeRng("seedabc1")).map((r) => r.post_id);
  const b = orderByReachBands(rows, makeRng("seedabc1")).map((r) => r.post_id);
  assert.deepStrictEqual(a, b);
  assert.strictEqual(a.length, rows.length);
  const bands = a.map((id) => Number(id[1]));
  for (let i = 1; i < bands.length; i++) assert.ok(bands[i] >= bands[i - 1], "faixa voltou");
  // dentro da faixa 0, o top do mix vem primeiro (maior score)
  assert.strictEqual(a[0], "b0-6");
  // linha sem faixa = 0
  const plain = orderByReachBands([{ post_id: "x", engagement_score: 1 }], makeRng("seedabc1"));
  assert.strictEqual(plain[0].post_id, "x");
});
