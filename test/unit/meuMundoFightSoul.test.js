// mm3d-72: a personalidade na luta (psicopata, covarde), o Desistir, a esquiva
// automática de verdade e os poderes dos monstros-personagem. Roda a cópia GERADA
// (src/utils/meuMundoFight.js ← laminas/sim/{fight,replay}.ts).
const test = require("node:test");
const assert = require("node:assert/strict");
const F = require("../../src/utils/meuMundoFight");

const STATS = { strength: 300, speed: 300, intelligence: 300, dexterity: 300 };
const idle = { mx: 0, mz: 0, run: false, attack: false, dodge: false };

function play(setup, steps, input = () => idle) {
  const f = new F.Fight(setup);
  const evs = [];
  for (let i = 0; i < steps && !f.over; i++) {
    f.step(input(i, f));
    evs.push(...f.events);
  }
  return { f, evs };
}

test("Desistir: a luta acaba em derrota e o servidor confere pela gravação", () => {
  const setup = { kind: "ciborgue", seed: 7, stats: STATS, tier: "arena" };
  const { f, evs } = play(setup, 600, (i) => ({ ...idle, quit: i === 120 }));
  assert.ok(f.over && !f.over.win && f.over.quit === "me");
  assert.ok(evs.some((e) => e.t === "end" && e.quit === "me"));
  const frames = [];
  for (let i = 0; i <= 120; i++) F.pushFrame(frames, { ...idle, quit: i === 120 });
  const r = F.replayFight(setup, frames);
  assert.equal(r.ok, true);
  assert.equal(r.win, false);
});

test("sem personalidade a luta é a mesma de antes (o sorteio não muda)", () => {
  const base = { kind: "wolf", seed: 99, stats: STATS, tier: "street", level: 3 };
  const a = play(base, 1800).evs.map((e) => e.t).join(",");
  const b = play({ ...base, temper: "bondoso", affection: 500 }, 1800).evs.map((e) => e.t).join(",");
  assert.equal(a, b);
});

test("psicopata contra inimigo muito mais forte: o Poder Máximo sai 3 vezes (PSICOPATA)", () => {
  let triples = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const { evs } = play({ kind: "brute", seed, stats: STATS, tier: "street", level: 40, temper: "psicopata", affection: 0 }, 260, (i, f) => {
      if (i === 60) f.me.power = F.POWER.max;
      return { ...idle, power: i === 61 };
    });
    const fires = evs.filter((e) => e.t === "powerFire").length;
    if (evs.some((e) => e.t === "psycho")) {
      triples++;
      assert.equal(fires, 3);
    } else assert.ok(fires <= 1);
  }
  assert.ok(triples >= 20, `triplos: ${triples}/40`);
});

test("psicopata contra inimigo à altura: só com afeto (sem afeto nunca)", () => {
  const roll = (affection) => {
    let n = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const { evs } = play({ kind: "cavaleiro", seed, stats: STATS, peer: 1, temper: "psicopata", affection }, 120, (i, f) => {
        if (i === 30) f.me.power = F.POWER.max;
        return { ...idle, power: i === 31 };
      });
      if (evs.some((e) => e.t === "psycho")) n++;
    }
    return n;
  };
  assert.equal(roll(0), 0);
  assert.ok(roll(400) > 0);
});

test("covarde com vida baixa: avisa e sai; quanto mais gosta do dono, menos sai", () => {
  const flee = (affection) => {
    let n = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { f, evs } = play({ kind: "ciborgue", seed, stats: STATS, tier: "arena", temper: "covarde", affection }, 60 * 40, (i, ff) => {
        if (i === 1) ff.me.hp = Math.floor(ff.me.hpMax * 0.3);
        return idle;
      });
      if (f.over && f.over.quit === "coward") {
        const w = evs.findIndex((e) => e.t === "fleeWarn");
        const end = evs.findIndex((e) => e.t === "end");
        assert.ok(w >= 0 && w < end, "avisa antes de sair");
        n++;
      }
    }
    return n;
  };
  const cold = flee(0);
  const warm = flee(2000);
  assert.ok(cold > 0, "o covarde às vezes desiste");
  assert.ok(warm < cold, `gostando muito sai menos (${warm} < ${cold})`);
});

test("esquiva automática vira esquiva de verdade (estado e evento de esquiva)", () => {
  let seen = 0;
  for (let seed = 1; seed <= 20 && !seen; seed++) {
    const f = new F.Fight({ kind: "garras", seed, stats: { ...STATS, speed: 3000 }, tier: "arena" });
    for (let i = 0; i < 60 * 30 && !f.over; i++) {
      f.step(idle);
      const auto = f.events.find((e) => e.t === "miss" && e.on === "me" && e.auto);
      if (auto && f.events.some((e) => e.t === "dodge")) {
        assert.equal(f.me.state, "dodge");
        seen++;
        break;
      }
    }
  }
  assert.ok(seen > 0);
});

test("monstros-personagem usam os poderes na Arena; o ringue e os lobos não", () => {
  const ids = (setup) => {
    const s = new Set();
    for (let seed = 1; seed <= 6; seed++) {
      const { evs } = play({ ...setup, seed }, 60 * 60, (i) => ({ ...idle, mx: Math.sin(i / 50) * 0.6, mz: Math.cos(i / 70) * 0.6, attack: i % 40 === 0 }));
      for (const e of evs) if (e.t === "warn") s.add(e.attack);
    }
    return s;
  };
  const brute = ids({ kind: "brute", stats: STATS, tier: "arena" });
  assert.ok(["skSlash", "skDash", "skUlt"].some((k) => brute.has(k)), [...brute].join(","));
  const ring = ids({ kind: "brute", stats: STATS, peer: 1 });
  assert.ok(![...ring].some((k) => k.startsWith("sk")));
  const wolf = ids({ kind: "wolf", stats: STATS, tier: "arena" });
  assert.ok(![...wolf].some((k) => k.startsWith("sk")));
});

test("escudo do monstro corta o dano por 4 s", () => {
  const f = new F.Fight({ kind: "ciborgue", seed: 3, stats: STATS, tier: "arena" });
  const m = f.mobs[0];
  m.state = "chase";
  const hit = () => {
    const hp = m.hp;
    f["damageMob"](m, 20, false, 0, 1, 3, "ult");
    return hp - m.hp;
  };
  const plain = hit();
  m.shieldUntil = f.time + 4;
  const guarded = hit();
  assert.ok(guarded < plain * 0.5, `${guarded} < ${plain}/2`);
});
