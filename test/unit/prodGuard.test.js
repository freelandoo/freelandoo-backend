// Segurança 0B: trava que impede script local de conectar em banco remoto sem --prod.
const test = require("node:test");
const assert = require("node:assert");
const { assertDbAllowed } = require("../../src/databases/prodGuard");

const REMOTE = "postgresql://postgres:x@monorail.proxy.rlwy.net:55621/railway";
const LOCAL = "postgres://postgres:x@127.0.0.1:55432/freelandoo";
const dev = { NODE_ENV: "development" };

test("máquina local + banco remoto sem --prod: recusa", () => {
  assert.throws(() => assertDbAllowed(REMOTE, { argv: ["node", "x.js"], env: dev }), { code: "FL_PROD_GUARD" });
});

test("máquina local + banco remoto com --prod ou FL_ALLOW_PROD=1: passa", () => {
  assertDbAllowed(REMOTE, { argv: ["node", "x.js", "--prod"], env: dev });
  assertDbAllowed(REMOTE, { argv: ["node", "x.js"], env: { ...dev, FL_ALLOW_PROD: "1" } });
});

test("banco local passa sempre", () => {
  assertDbAllowed(LOCAL, { argv: ["node"], env: dev });
  assertDbAllowed("postgres://u:p@localhost/db", { argv: ["node"], env: {} });
});

test("servidor (Railway ou NODE_ENV=production) nunca é travado", () => {
  const internal = "postgresql://postgres:x@postgres.railway.internal:5432/railway";
  assertDbAllowed(internal, { argv: ["node"], env: { NODE_ENV: "production" } });
  assertDbAllowed(internal, { argv: ["node"], env: { RAILWAY_PROJECT_ID: "p" } });
  assertDbAllowed(REMOTE, { argv: ["node"], env: { RAILWAY_ENVIRONMENT_NAME: "production" } });
});

test("sem URL não é problema da trava", () => {
  assertDbAllowed(undefined, { argv: ["node"], env: dev });
});
