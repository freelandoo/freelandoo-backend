// test/unit/profilePaywall.test.js
//
// O paywall de PUBLICAÇÃO: a conta publica de graça, perfil ADICIONAL só com
// assinatura ativa. É *unit* e não e2e de propósito — `assertProfileCanPublish`
// só precisa de um `conn` com `query`, e o SQL que ele monta é exercitado
// contra o Postgres de verdade pela varredura que acompanha a entrega.
//
// O que estes casos seguram é a metade que erra calada: a forma do erro (402 +
// `needs_subscription`, que é o que o composer lê para explicar em vez de só
// falhar) e a decisão de NÃO responder por perfil inexistente — ali quem tem a
// resposta certa é o guard de posse de cada porta.
const test = require("node:test");
const assert = require("node:assert");

const {
  PUBLISH_PAYWALL_ERROR,
  canPublishSql,
  assertProfileCanPublish,
} = require("../../src/utils/profilePaywall");

const PROFILE = "11111111-1111-1111-1111-111111111111";

/** Conn de mentira: devolve o veredito que o teste quer, ou nenhuma linha. */
function connWith(canPublish) {
  return {
    async query() {
      if (canPublish === null) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [{ can_publish: canPublish }] };
    },
  };
}

test("perfil que pode publicar passa sem erro", async () => {
  assert.strictEqual(await assertProfileCanPublish(connWith(true), PROFILE), null);
});

test("perfil que não pode publicar é recusado com 402 e motivo legível", async () => {
  const err = await assertProfileCanPublish(connWith(false), PROFILE);
  assert.ok(err, "deveria recusar");
  assert.strictEqual(err.statusCode, 402);
  assert.strictEqual(err.needs_subscription, true);
  assert.match(err.error, /assinatura/i);
  // A recusa precisa dizer que existe caminho grátis — senão vira parede.
  assert.match(err.error, /conta/i);
});

test("a recusa é uma CÓPIA: quem trata o erro não pode envenenar o próximo", async () => {
  const first = await assertProfileCanPublish(connWith(false), PROFILE);
  first.error = "mexido";
  const second = await assertProfileCanPublish(connWith(false), PROFILE);
  assert.notStrictEqual(second.error, "mexido");
  assert.strictEqual(PUBLISH_PAYWALL_ERROR.error.includes("mexido"), false);
});

test("perfil inexistente NÃO é recusado aqui — quem responde é o guard de posse", async () => {
  assert.strictEqual(await assertProfileCanPublish(connWith(null), PROFILE), null);
});

test("o SQL do paywall isenta conta e clan, e cobra assinatura do resto", () => {
  const sql = canPublishSql("pro");
  assert.match(sql, /pro\.is_user_account = TRUE/);
  assert.match(sql, /pro\.is_clan = TRUE/);
  assert.match(sql, /tb_profile_subscription/);
  assert.match(sql, /status = 'active'/);
  // O alias tem que atravessar: sem isso o EXISTS casaria com a tabela errada.
  assert.match(sql, /s\.id_profile = pro\.id_profile/);
});
