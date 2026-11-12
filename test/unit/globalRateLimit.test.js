// Teto global por IP (A3): passa do limite → 429; /health e OPTIONS ficam de fora.
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");

test("limite global por IP", async () => {
  const prevEnv = process.env.NODE_ENV;
  const prevMax = process.env.RATE_LIMIT_GLOBAL_MAX;
  process.env.NODE_ENV = "production";
  process.env.RATE_LIMIT_GLOBAL_MAX = "3";
  delete require.cache[require.resolve("../../src/middlewares/rateLimit")];
  const { global } = require("../../src/middlewares/rateLimit");
  process.env.NODE_ENV = prevEnv;
  if (prevMax === undefined) delete process.env.RATE_LIMIT_GLOBAL_MAX;
  else process.env.RATE_LIMIT_GLOBAL_MAX = prevMax;
  delete require.cache[require.resolve("../../src/middlewares/rateLimit")];

  const express = require("express");
  const app = express();
  app.use(global);
  app.all("/{*any}", (_req, res) => res.json({ ok: true }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await fetch(`${base}/x`)).status);
    assert.deepStrictEqual(codes, [200, 200, 200, 429]);
    assert.strictEqual((await fetch(`${base}/health`)).status, 200);
    assert.strictEqual((await fetch(`${base}/x`, { method: "OPTIONS" })).status, 200);
  } finally {
    server.close();
  }
});
