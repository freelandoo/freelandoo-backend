// A cifra dos segredos recuperáveis (token da Gym Provider API das academias e,
// na fase 2, o token de WhatsApp de cada cliente).
//
// Unit e não e2e de propósito: `seal`/`open` são puras sobre variáveis de
// ambiente e não tocam banco. O que estes casos travam é o DEFEITO QUE NÃO DÁ
// ERRO NA HORA: definir `SECRET_BOX_KEY` num ambiente que já tem segredo selado
// com o `JWT_SECRET`. Sem o fallback na abertura, aquele segredo vira lixo — e
// o sintoma chega dias depois, como uma academia que parou de sincronizar.

const test = require("node:test");
const assert = require("node:assert");

const MOD = require.resolve("../../src/utils/secretBox");

/** Recarrega o módulo com o ambiente pedido — a chave é lida a cada chamada. */
function withEnv({ boxKey, jwt }, fn) {
  const before = { box: process.env.SECRET_BOX_KEY, jwt: process.env.JWT_SECRET };
  if (boxKey === undefined) delete process.env.SECRET_BOX_KEY;
  else process.env.SECRET_BOX_KEY = boxKey;
  if (jwt === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = jwt;
  delete require.cache[MOD];
  try {
    return fn(require(MOD));
  } finally {
    if (before.box === undefined) delete process.env.SECRET_BOX_KEY;
    else process.env.SECRET_BOX_KEY = before.box;
    if (before.jwt === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = before.jwt;
    delete require.cache[MOD];
  }
}

const SEGREDO = "gym_token_abc123çãé";

test("ida e volta com só o JWT_SECRET (o mundo de hoje)", () => {
  withEnv({ jwt: "jwt-antigo" }, (sb) => {
    assert.strictEqual(sb.open(sb.seal(SEGREDO)), SEGREDO);
  });
});

test("⚠️ o caso que motiva tudo: selado com JWT_SECRET continua abrindo DEPOIS de a SECRET_BOX_KEY existir", () => {
  const selado = withEnv({ jwt: "jwt-antigo" }, (sb) => sb.seal(SEGREDO));
  withEnv({ boxKey: "chave-nova-dedicada", jwt: "jwt-antigo" }, (sb) => {
    assert.strictEqual(sb.open(selado), SEGREDO, "o token da academia tem que sobreviver");
  });
});

test("com as duas presentes, quem SELA é a preferida — não o fallback", () => {
  const selado = withEnv({ boxKey: "chave-nova-dedicada", jwt: "jwt-antigo" }, (sb) => sb.seal(SEGREDO));
  // Some o fallback: ainda abre, porque foi selado com a preferida.
  withEnv({ boxKey: "chave-nova-dedicada" }, (sb) => {
    assert.strictEqual(sb.open(selado), SEGREDO);
  });
  // Some a preferida e sobra só o fallback antigo: NÃO abre.
  withEnv({ jwt: "jwt-antigo" }, (sb) => {
    assert.throws(() => sb.open(selado), /.*/);
  });
});

test("perder as duas chaves é irrecuperável — e falha em voz alta", () => {
  const selado = withEnv({ jwt: "jwt-antigo" }, (sb) => sb.seal(SEGREDO));
  withEnv({ boxKey: "outra", jwt: "outra-ainda" }, (sb) => {
    assert.throws(() => sb.open(selado), /.*/);
  });
});

test("formato inválido é recusado antes de qualquer tentativa de chave", () => {
  withEnv({ jwt: "jwt-antigo" }, (sb) => {
    for (const ruim of ["", null, undefined, "texto-puro", "v2:a:b:c", "v1:só-uma-parte"]) {
      assert.throws(() => sb.open(ruim), /formato inválido/, String(ruim));
    }
  });
});

test("isSealedWithPreferredKey distingue o que já foi re-selado do que falta", () => {
  const velho = withEnv({ jwt: "jwt-antigo" }, (sb) => sb.seal(SEGREDO));
  withEnv({ boxKey: "chave-nova-dedicada", jwt: "jwt-antigo" }, (sb) => {
    assert.strictEqual(sb.isSealedWithPreferredKey(velho), false, "selado com o fallback");
    assert.strictEqual(sb.isSealedWithPreferredKey(sb.seal(SEGREDO)), true, "selado com a preferida");
    assert.strictEqual(sb.isSealedWithPreferredKey("lixo"), false);
  });
});

test("sem chave nenhuma o módulo diz o que falta, em vez de cifrar com vazio", () => {
  withEnv({}, (sb) => {
    assert.throws(() => sb.seal("x"), /SECRET_BOX_KEY\/JWT_SECRET ausentes/);
  });
});
