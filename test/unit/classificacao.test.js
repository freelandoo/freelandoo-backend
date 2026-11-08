// A6 Classificação (migs 395/396): TRI 2PL (estimativa e escala 0–100), prova
// adaptativa, janela de 30 dias, consentimento da personalidade e visibilidade.
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const Tri = require("../../src/utils/classificacaoTri");
const R = require("../../src/utils/classificacaoRules");
const { placeOptions, decodeHtml } = require("../../scripts/classificacao-itens");

function seeded(seed) {
  let a = seed;
  return () => {
    a = (a * 1664525 + 1013904223) % 4294967296;
    return a / 4294967296;
  };
}

const BANK = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../scripts/data/classificacao-itens.json"), "utf8")
).items.map((it, i) => ({ id: i + 1, area: it.area, a: it.a, b: it.b }));

test("2PL: P = 0,5 em θ = b e cresce com θ", () => {
  assert.strictEqual(Tri.p2pl(0.7, 1.3, 0.7), 0.5);
  assert.ok(Tri.p2pl(1, 1.3, 0) > Tri.p2pl(0, 1.3, 0));
  // informação máxima em θ = b, igual a a²/4
  assert.ok(Math.abs(Tri.itemInfo(0.4, 2, 0.4) - 1) < 1e-12);
  assert.ok(Tri.itemInfo(0.4, 2, 0.4) > Tri.itemInfo(1.4, 2, 0.4));
});

test("Φ bate com a tabela da normal", () => {
  assert.ok(Math.abs(Tri.normalCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(Tri.normalCdf(1) - 0.841345) < 1e-5);
  assert.ok(Math.abs(Tri.normalCdf(-1.96) - 0.024998) < 1e-5);
});

test("escala 0–100: 50 na média, monotônica, limitada", () => {
  assert.strictEqual(Tri.scoreFromTheta(0), 50);
  assert.strictEqual(Tri.scoreFromTheta(1), 84);
  assert.strictEqual(Tri.scoreFromTheta(-1), 16);
  assert.strictEqual(Tri.scoreFromTheta(10), 100);
  assert.strictEqual(Tri.scoreFromTheta(-10), 0);
  assert.strictEqual(Tri.scoreFromTheta(NaN), 0);
  let prev = -1;
  for (let t = -4; t <= 4; t += 0.25) {
    const s = Tri.scoreFromTheta(t);
    assert.ok(s >= prev && s >= 0 && s <= 100);
    prev = s;
  }
});

test("EAP: sem respostas = prior; acertar sobe, errar desce; tudo certo fica finito", () => {
  const prior = Tri.estimateTheta([]);
  assert.ok(Math.abs(prior.theta) < 1e-9 && Math.abs(prior.se - 1) < 0.01);
  const it = { a: 1.2, b: 0 };
  const up = Tri.estimateTheta([{ ...it, correct: true }]);
  const down = Tri.estimateTheta([{ ...it, correct: false }]);
  assert.ok(up.theta > 0 && down.theta < 0);
  assert.ok(Math.abs(up.theta + down.theta) < 1e-9, "simétrico");
  const all = BANK.slice(0, 20).map((x) => ({ ...x, correct: true }));
  const e = Tri.estimateTheta(all);
  assert.ok(Number.isFinite(e.theta) && e.theta > 1.5 && e.theta < 4);
  assert.ok(e.se < 1, "mais itens = menos erro");
});

test("EAP recupera a habilidade de quem responde pelo modelo", () => {
  const rng = seeded(42);
  for (const truth of [-1.5, 0, 1.5]) {
    let err = 0;
    const N = 60;
    for (let k = 0; k < N; k += 1) {
      const answered = [];
      for (let i = 0; i < Tri.TEST_LENGTH; i += 1) {
        const it = Tri.pickNextItem(BANK, answered, { rng });
        answered.push({ ...it, correct: rng() < Tri.p2pl(truth, it.a, it.b) });
      }
      err += Tri.estimateTheta(answered).theta - truth;
    }
    assert.ok(Math.abs(err / N) < 0.45, `viés em θ=${truth}: ${err / N}`);
  }
});

test("blueprint: 20 itens, economia + finanças pesam mais", () => {
  const bp = Tri.blueprint(20);
  assert.deepStrictEqual(bp, { economia: 6, financas: 5, historia: 3, geografia: 3, gerais: 3 });
  const total = Object.values(Tri.AREA_WEIGHTS).reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(total - 1) < 1e-12);
  assert.strictEqual(Object.values(Tri.blueprint(7)).reduce((s, x) => s + x, 0), 7);
});

test("prova adaptativa: cumpre o blueprint, não repete item, para em 20", () => {
  const rng = seeded(7);
  const answered = [];
  for (;;) {
    const it = Tri.pickNextItem(BANK, answered, { rng });
    if (!it) break;
    answered.push({ ...it, correct: rng() < 0.6 });
  }
  assert.strictEqual(answered.length, Tri.TEST_LENGTH);
  assert.strictEqual(new Set(answered.map((x) => x.id)).size, Tri.TEST_LENGTH);
  const count = {};
  answered.forEach((x) => (count[x.area] = (count[x.area] || 0) + 1));
  assert.deepStrictEqual(count, Tri.blueprint());
  const sum = Tri.areaSummary(answered);
  assert.strictEqual(sum.economia.n, 6);
});

test("prova adaptativa: quem acerta recebe itens mais difíceis", () => {
  const rng = seeded(3);
  const run = (ok) => {
    const ans = [];
    for (let i = 0; i < Tri.TEST_LENGTH; i += 1) {
      const it = Tri.pickNextItem(BANK, ans, { rng });
      ans.push({ ...it, correct: ok });
    }
    return ans.slice(10).reduce((s, x) => s + x.b, 0) / 10;
  };
  assert.ok(run(true) > run(false) + 0.8);
});

test("banco: ao menos 60 itens, todas as áreas, parâmetros válidos, códigos únicos", () => {
  assert.ok(BANK.length >= 60);
  const bp = Tri.blueprint();
  for (const k of Tri.AREAS) {
    assert.ok(BANK.filter((x) => x.area === k).length >= bp[k] * 2, `área ${k} com folga`);
  }
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../../scripts/data/classificacao-itens.json"), "utf8"));
  assert.strictEqual(new Set(raw.items.map((x) => x.code)).size, raw.items.length);
  for (const it of raw.items) {
    assert.ok(it.a > 0 && it.a <= 4 && Math.abs(it.b) <= 4, it.code);
    assert.strictEqual(new Set(it.options).size, it.options.length, `opções repetidas em ${it.code}`);
  }
});

test("gerador: embaralha estável e o gabarito segue a opção certa", () => {
  const it = { code: "x-1", options: ["certa", "b", "c", "d"] };
  const p1 = placeOptions(it);
  const p2 = placeOptions(it);
  assert.deepStrictEqual(p1, p2);
  assert.strictEqual(p1.options[p1.correct], "certa");
  assert.deepStrictEqual(placeOptions({ code: "e", options: ["a", "b"], correct: 1 }), { options: ["a", "b"], correct: 1 });
  assert.strictEqual(decodeHtml("Who&#039;s &quot;x&quot; &amp; y"), `Who's "x" & y`);
  // a migration gerada (396) está em dia com o .json
  const sql = fs.readFileSync(path.join(__dirname, "../../src/databases/migrations/396_classificacao_itens.sql"), "utf8");
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "../../scripts/data/classificacao-itens.json"), "utf8"));
  for (const x of raw.items) assert.ok(sql.includes(`('${x.code}'`), x.code);
});

test("refazer: 1 vez a cada 30 dias, contando do início", () => {
  const now = new Date("2026-11-08T12:00:00Z");
  assert.strictEqual(R.nextAttemptAt(null, now), null);
  const d = R.nextAttemptAt("2026-11-01T12:00:00Z", now);
  assert.strictEqual(d.toISOString(), "2026-12-01T12:00:00.000Z");
  assert.strictEqual(R.nextAttemptAt("2026-10-09T11:59:00Z", now), null);
  assert.strictEqual(R.attemptExpired("2026-11-08T11:30:00Z", now), false);
  assert.strictEqual(R.attemptExpired("2026-11-08T10:59:00Z", now), true);
});

test("visibilidade: ninguém, link ou perfil", () => {
  assert.deepStrictEqual(R.VISIBILITIES, ["private", "link", "profile"]);
  assert.strictEqual(R.normalizeVisibility("public"), null);
  assert.strictEqual(R.normalizeVisibility("link"), "link");
  const table = {
    private: { owner: true, link: false, profile: false },
    link: { owner: true, link: true, profile: false },
    profile: { owner: true, link: true, profile: true },
  };
  for (const [v, ways] of Object.entries(table)) {
    for (const [via, ok] of Object.entries(ways)) assert.strictEqual(R.canShowScore(v, via), ok, `${v}/${via}`);
  }
  assert.strictEqual(R.canShowScore("profile", "anything"), false);
});

test("consentimento: vale o último evento, só na versão atual", () => {
  const V = R.PERSONALITY_CONSENT_VERSION;
  assert.strictEqual(R.consentActive([]), false);
  assert.strictEqual(R.consentActive([{ action: "grant", version: V, at: "2026-11-08T10:00:00Z" }]), true);
  assert.strictEqual(R.consentActive([{ action: "grant", version: "2020-01-01", at: "2026-11-08T10:00:00Z" }]), false);
  assert.strictEqual(
    R.consentActive([
      { action: "revoke", version: V, at: "2026-11-08T11:00:00Z" },
      { action: "grant", version: V, at: "2026-11-08T10:00:00Z" },
    ]),
    false,
    "revogou depois"
  );
  assert.strictEqual(
    R.consentActive([
      { action: "grant", version: V, at: "2026-11-08T10:00:00Z" },
      { action: "revoke", version: V, at: "2026-11-08T11:00:00Z" },
      { action: "grant", version: V, at: "2026-11-08T12:00:00Z" },
    ]),
    true,
    "deu de novo"
  );
});

test("IPIP-50: chave de correção e traços 0–100", () => {
  assert.strictEqual(R.IPIP50_KEYS.length, 50);
  // 10 itens por traço
  const per = {};
  for (let n = 1; n <= 50; n += 1) per[R.traitOfItem(n)] = (per[R.traitOfItem(n)] || 0) + 1;
  for (const k of R.TRAITS) assert.strictEqual(per[k], 10);
  assert.strictEqual(R.traitOfItem(1), "extraversion");
  assert.strictEqual(R.traitOfItem(4), "stability");
  // concordar com tudo: os traços com itens só diretos ou mistos dão valores previsíveis
  const allFive = R.scorePersonality(Array(50).fill(5)).traits;
  const allOne = R.scorePersonality(Array(50).fill(1)).traits;
  const neutral = R.scorePersonality(Array(50).fill(3)).traits;
  for (const k of R.TRAITS) {
    assert.strictEqual(neutral[k], 50);
    assert.strictEqual(allFive[k] + allOne[k], 100);
  }
  // resposta "ideal" pela chave dá 100 em tudo
  const ideal = R.IPIP50_KEYS.map((k) => (k > 0 ? 5 : 1));
  for (const k of R.TRAITS) assert.strictEqual(R.scorePersonality(ideal).traits[k], 100);
  assert.ok(R.scorePersonality(Array(49).fill(3)).error);
  assert.ok(R.scorePersonality([...Array(49).fill(3), 6]).error);
  assert.ok(R.scorePersonality([...Array(49).fill(3), "x"]).error);
});
