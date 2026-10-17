const test = require("node:test");
const assert = require("node:assert/strict");
const { decide, stateDto } = require("../../src/services/ArenaTerritoryService");
const { sign, canonical, readSecret } = require("../../src/middlewares/arenaServiceAuth");

test("zero participações = neutro, sem líder", () => {
  assert.deepEqual(decide([]), { status: "neutral", leader_team_id: null, tied: [], total: 0 });
});

test("maior contagem lidera", () => {
  const d = decide([{ team_id: "a", count: 2 }, { team_id: "b", count: 1 }]);
  assert.equal(d.status, "leader");
  assert.equal(d.leader_team_id, "a");
  assert.equal(d.total, 3);
});

test("empate no topo = tie, ordem determinística dos empatados", () => {
  const d = decide([{ team_id: "z", count: 2 }, { team_id: "b", count: 2 }, { team_id: "c", count: 1 }]);
  assert.equal(d.status, "tie");
  assert.equal(d.leader_team_id, null);
  assert.deepEqual(d.tied, ["b", "z"]);
});

test("DTO de categoria sensível omite contagens", () => {
  const row = { environment_id: "br-sp", post_id: "q0-p0-post", category_id: "politica", window_start: "2026-10-17T15:00:00.000Z", status: "leader", leader_team_id: "a", total: 3, revision: 9 };
  const dto = stateDto(row, [{ team_id: "a", count: 3 }], true);
  assert.equal(dto.counts, null);
  assert.equal(dto.total, null);
  assert.equal(dto.window.endsAt, "2026-10-17T16:00:00.000Z");
});

test("assinatura muda com qualquer parte do canônico", () => {
  const base = { method: "POST", url: "/arena/internal/checkpoints", ts: "1760000000000", nonce: "abcdefghijklmnop", bodyHash: "0".repeat(64) };
  const s = sign("k".repeat(40), base);
  for (const k of Object.keys(base)) assert.notEqual(sign("k".repeat(40), { ...base, [k]: base[k] + "x" }), s, k);
  assert.match(canonical(base), /^POST\n/);
});

test("segredo do serviço: curto ou igual ao JWT_SECRET = canal fechado", () => {
  assert.equal(readSecret({ ARENA_SERVICE_SECRET: "curto" }), null);
  assert.equal(readSecret({ ARENA_SERVICE_SECRET: "x".repeat(40), JWT_SECRET: "x".repeat(40) }), null);
  assert.equal(readSecret({ ARENA_SERVICE_SECRET: "x".repeat(40), JWT_SECRET: "y" }), "x".repeat(40));
});
