const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../../src/utils/meuMundoCenter");
const { MOTION, resolveCircle } = require("../../src/utils/meuMundoMotion");
const { VEHICLE } = require("../../src/utils/meuMundoVehicle");
const { carFits } = require("../../src/utils/meuMundoCars");

// Busca em grade (0,5 m) de quem cabe onde: um círculo do raio dado está
// livre num ponto se a colisão não o empurra. É a MESMA conta da sala.
const CELL = 0.5;
function reach(start, radius, limit = C.DIMS.bound) {
  const n = Math.ceil((2 * limit) / CELL);
  const idx = (x, z) => Math.round((x + limit) / CELL) * (n + 1) + Math.round((z + limit) / CELL);
  const free = new Map();
  const isFree = (i, x, z) => {
    if (!free.has(i)) free.set(i, C.isSafeSpot(x, z, resolveCircle, radius));
    return free.get(i);
  };
  const seen = new Set();
  const sx = Math.round(start.x / CELL) * CELL;
  const sz = Math.round(start.z / CELL) * CELL;
  const q = [[sx, sz]];
  seen.add(idx(sx, sz));
  while (q.length) {
    const [x, z] = q.pop();
    for (const [dx, dz] of [[CELL, 0], [-CELL, 0], [0, CELL], [0, -CELL]]) {
      const nx = x + dx;
      const nz = z + dz;
      if (Math.abs(nx) > limit || Math.abs(nz) > limit) continue;
      const i = idx(nx, nz);
      if (seen.has(i) || !isFree(i, nx, nz)) continue;
      seen.add(i);
      q.push([nx, nz]);
    }
  }
  return (x, z) => seen.has(idx(Math.round(x / CELL) * CELL, Math.round(z / CELL) * CELL));
}

const walker = reach(C.ARRIVAL, MOTION.RADIUS);
// O carro: o círculo do meio do corpo (os da frente e de trás passam onde ele passa nas retas).
const car = reach(C.ARRIVAL_SPOTS[0], VEHICLE.COL_RADIUS);

test("centro: os 11 estabelecimentos + a praça, ids estáveis e únicos", () => {
  const ids = C.PLACES.map((p) => p.id);
  assert.deepEqual(ids.sort(), ["academia", "biblioteca", "delegacia", "escola", "hamburgueria", "hospital", "igreja", "jetpack", "pizzaria", "supermercado", "universidade"]);
  assert.equal(new Set(ids).size, 11);
  assert.equal(C.PLAZA_PLACE.id, "praca");
});

test("registro de destinos: cada local tem entrada, interação, retorno, destino e está indisponível", () => {
  for (const p of C.PLACES) {
    assert.ok(p.nameKey.startsWith("centerPlace_"), p.id);
    for (const k of ["entry", "interact", "return"]) assert.ok(Number.isFinite(p[k].x) && Number.isFinite(p[k].z), `${p.id}.${k}`);
    assert.ok(p.interact.radius >= 2.5);
    if (p.id === "jetpack") {
      assert.equal(p.destination, "game:jetpack");
      assert.equal(p.available, true, "o jetpack abre o minijogo (mm3d-20)");
      assert.equal(p.party, 4, "até 4 na mesma partida (mm3d-21)");
    } else {
      assert.equal(p.destination, `interior:${p.id}`);
      assert.equal(p.available, false, "nenhum interior existe ainda");
    }
  }
});

test("pegadas dos prédios não se sobrepõem e ficam dentro da cerca", () => {
  for (const a of C.PLACES) {
    const r = a.rect;
    assert.ok(Math.abs(r.x0) < C.DIMS.bound && Math.abs(r.x1) < C.DIMS.bound && Math.abs(r.z0) < C.DIMS.bound && Math.abs(r.z1) < C.DIMS.bound, a.id);
    for (const b of C.PLACES) {
      if (a === b) continue;
      const o = b.rect;
      const overlap = r.x0 < o.x1 && o.x0 < r.x1 && r.z0 < o.z1 && o.z0 < r.z1;
      assert.ok(!overlap, `${a.id} × ${b.id}`);
    }
  }
});

test("a pé: da chegada se alcança a porta, o retorno e a interação de TODOS os locais", () => {
  for (const p of C.PLACES) {
    assert.ok(walker(p.return.x, p.return.z), `retorno de ${p.id}`);
    assert.ok(walker(p.interact.x, p.interact.z), `interação de ${p.id}`);
    assert.ok(C.isSafeSpot(p.return.x, p.return.z, resolveCircle, MOTION.RADIUS), `retorno livre de ${p.id}`);
  }
  assert.ok(walker(C.PORTAL.x + 2, C.PORTAL.z), "portal");
  assert.ok(walker(0, 6), "praça");
});

test("nenhuma porta bloqueada: a faixa de 1,5 m na frente de cada porta é livre", () => {
  for (const p of C.PLACES) {
    // Para fora da fachada = para onde o retorno olha (vale também para o prédio girado).
    const out = [Math.sin(p.return.facing), Math.cos(p.return.facing)];
    const side = [out[1], -out[0]];
    for (const d of [0.9, 1.5, 2.2]) {
      for (const t of [-0.5, 0, 0.5]) {
        const x = p.door.x + out[0] * d + side[0] * t * p.door.width;
        const z = p.door.z + out[1] * d + side[1] * t * p.door.width;
        assert.ok(C.isSafeSpot(x, z, resolveCircle, MOTION.RADIUS), `${p.id} em (${x}, ${z})`);
      }
    }
  }
});

test("praça: miolo livre para encontro (só o monumento no meio) e acessível a pé pelas 4 travessias", () => {
  for (let x = -11; x <= 11; x += 0.5) {
    for (let z = -11; z <= 11; z += 0.5) {
      // o monumento é um octógono (duas caixas de 0,88 r): a quina vai a 0,88·r·√2 do centro
      if (Math.hypot(x, z) <= C.MONUMENT.radius * 0.88 * Math.SQRT2 + MOTION.RADIUS + 0.05) continue;
      assert.ok(C.isSafeSpot(x, z, resolveCircle, MOTION.RADIUS), `(${x}, ${z})`);
    }
  }
  for (const [x, z] of [[0, 18.5], [0, -18.5], [18.5, 0], [-18.5, 0]]) assert.ok(walker(x, z), `travessia (${x}, ${z})`);
});

test("carro: não entra na praça, mas dá a volta inteira no anel e chega aos dois estacionamentos", () => {
  for (let x = -15; x <= 15; x += 1) for (let z = -15; z <= 15; z += 1) assert.ok(!car(x, z), `carro na praça (${x}, ${z})`);
  // Eixo do anel, de 5 em 5 graus (retas e curvas).
  const k = C.DIMS.ring - C.DIMS.cornerR;
  for (let a = 0; a < 360; a += 5) {
    const t = (a * Math.PI) / 180;
    const dx = Math.cos(t);
    const dz = Math.sin(t);
    // ponto do quadrado arredondado na direção (dx, dz)
    const s = C.DIMS.ring / Math.max(Math.abs(dx), Math.abs(dz));
    let x = dx * s;
    let z = dz * s;
    if (Math.abs(x) > k && Math.abs(z) > k) {
      const cx = Math.sign(x) * k;
      const cz = Math.sign(z) * k;
      const ang = Math.atan2(z - cz, x - cx);
      x = cx + Math.cos(ang) * C.DIMS.cornerR;
      z = cz + Math.sin(ang) * C.DIMS.cornerR;
    }
    assert.ok(C.onRoad(x, z), `eixo fora da pista em ${a}°`);
    assert.ok(car(x, z), `carro não chega ao anel em ${a}°`);
  }
  for (const lot of C.PARKING) for (const s of lot.slots) assert.ok(car(s.x, s.z), `${lot.id} (${s.x}, ${s.z})`);
});

test("curvas do anel compatíveis com a dirigibilidade (raio ≥ 10 m no eixo)", () => {
  assert.ok(C.DIMS.cornerR >= 10);
  assert.ok(C.DIMS.roadHalf * 2 >= 6);
});

test("vagas de chegada: 32 lugares livres para um veículo, distintos, sem encostar uns nos outros", () => {
  assert.ok(C.ARRIVAL_SPOTS.length >= C.CENTER_CAPACITY);
  for (const s of C.ARRIVAL_SPOTS) assert.ok(carFits(s.x, s.z, s.facing, C.OBSTACLES, "car"), `(${s.x}, ${s.z})`);
  for (let i = 0; i < C.ARRIVAL_SPOTS.length; i++) {
    for (let j = i + 1; j < C.ARRIVAL_SPOTS.length; j++) {
      const a = C.ARRIVAL_SPOTS[i];
      const b = C.ARRIVAL_SPOTS[j];
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) >= 2.5, `vagas ${i} e ${j} grudadas`);
    }
  }
});

test("chegada a pé e portal em lugar livre; payload sem nada de usuário", () => {
  assert.ok(C.isSafeSpot(C.ARRIVAL.x, C.ARRIVAL.z, resolveCircle, MOTION.RADIUS));
  const p = C.buildCenterPayload();
  assert.equal(p.capacity, 20);
  assert.equal(p.places.length, 11);
  assert.equal(p.obstacles.length, C.OBSTACLES.length);
  assert.ok(JSON.stringify(p).length < 30000, "payload pequeno");
  assert.ok(!/user|email|token/i.test(JSON.stringify(p)));
});

// ═══ Hospital (mm3d-26) ═══
const H = C.PLACES.find((p) => p.id === "hospital");
const hAt = (X, D) => {
  const r = H.rotationY;
  const f = r - Math.PI;
  return { x: H.origin.x + Math.cos(r) * X + Math.sin(f) * D, z: H.origin.z - Math.sin(r) * X + Math.cos(f) * D };
};

test("hospital: no canto sudoeste, entre a delegacia e a academia, de frente para a praça", () => {
  assert.equal(H.front, "rot");
  assert.ok(H.center.x < -30 && H.center.z < -30, "canto sudoeste");
  // A fachada olha para o nordeste (a praça).
  assert.ok(Math.abs(H.return.facing - Math.PI / 4) < 1e-3);
  assert.equal(H.destination, "interior:hospital");
  // A pegada girada não encosta na delegacia nem na academia (folga ≥ 1 m nas quinas).
  const box = C.OBSTACLES.find((b) => b.place === "hospital");
  assert.ok(Math.abs(box.rot - H.rotationY) < 1e-3);
  for (const id of ["delegacia", "academia"]) {
    const o = C.PLACES.find((p) => p.id === id).rect;
    for (const X of [-10, 10]) {
      for (const D of [0, -14]) {
        const q = hAt(X, D);
        const dx = Math.max(o.x0 - q.x, 0, q.x - o.x1);
        const dz = Math.max(o.z0 - q.z, 0, q.z - o.z1);
        assert.ok(Math.hypot(dx, dz) >= 1, `quina do hospital em ${id}`);
      }
    }
  }
});

test("hospital: a calçada leva a pé da curva do anel até a porta, sem nada no caminho", () => {
  for (let D = 1; D <= 18; D += 0.5) {
    const q = hAt(D < 6.5 ? 0 : 1.75, D);
    assert.ok(C.isSafeSpot(q.x, q.z, resolveCircle, MOTION.RADIUS), `calçada bloqueada em D=${D}`);
    assert.ok(walker(q.x, q.z), `calçada fora de alcance em D=${D}`);
  }
});

test("hospital: um carro chega pela pista até o pátio; a ambulância fica parada na baia, fora da calçada", () => {
  for (let D = 8; D <= 20; D += 1) {
    const q = hAt(-1.35, D);
    assert.ok(car(q.x, q.z), `pista em D=${D}`);
  }
  const amb = C.PROPS.find((o) => o.id === "ambulancia");
  assert.ok(amb && C.OBSTACLES.some((b) => b.x === amb.x && b.z === amb.z), "ambulância colide");
  assert.ok(Math.abs(amb.facing - Math.PI / 4) < 1e-3, "bico para a praça");
  // O eixo da porta (entre os pilares da marquise) passa longe dela.
  for (let D = 0.5; D <= 7; D += 0.5) {
    const q = hAt(0, D);
    assert.ok(C.isSafeSpot(q.x, q.z, resolveCircle, MOTION.RADIUS), `ambulância na calçada em D=${D}`);
  }
  for (const g of C.GROUNDS) assert.ok(["pave", "asphalt", "walk", "mark"].includes(g.kind));
});
