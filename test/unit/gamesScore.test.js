// test/unit/gamesScore.test.js
//
// A RÉGUA do ranking de atividade da plataforma de games (mig 226).
//
// É *unit* e não e2e de propósito: `utils/gamesScore.js` é função pura — só
// monta números e pedaços de SQL. O SQL montado é exercitado contra o Postgres
// de verdade pela varredura que acompanha a entrega.
//
// O que estes casos seguram é o que erra CALADO:
//
//  • o recorte "post de games" ser o MESMO nas três métricas (escrito três
//    vezes, a curtida contaria um post que o compartilhamento jura não existir);
//  • o escopo ser fragmento escolhido no JS e não parâmetro dentro de expressão
//    — o 42P08 que já custou três migrations neste projeto;
//  • cidade nunca ser comparada sozinha (existe Campinas em SP e no RJ);
//  • o tempo entrar por divisão INTEIRA (9 minutos valem zero, não "quase um").
const test = require("node:test");
const assert = require("node:assert");

const GamesScore = require("../../src/utils/gamesScore");

test("os pesos são os mesmos do score do bee — 1 / 2 / 3", () => {
  assert.strictEqual(GamesScore.WEIGHTS.like, 1);
  assert.strictEqual(GamesScore.WEIGHTS.comment, 2);
  assert.strictEqual(GamesScore.WEIGHTS.share, 3);
});

test("presença tem os dois tetos, e o da batida é menor que o do dia", () => {
  assert.ok(GamesScore.MAX_BEAT_SECONDS > 0);
  assert.ok(GamesScore.DAILY_CAP_SECONDS > GamesScore.MAX_BEAT_SECONDS);
  // O teto do dia não pode passar de um dia — a CHECK da mig 226 recusaria.
  assert.ok(GamesScore.DAILY_CAP_SECONDS <= 86400);
});

test("o teto da batida dá folga sobre o intervalo do cliente (120s)", () => {
  // Se o teto fosse igual ao intervalo, um `setTimeout` atrasado pelo navegador
  // perderia tempo real de presença a cada batida lenta.
  assert.ok(GamesScore.MAX_BEAT_SECONDS > 120);
});

test("gamesItemSql amarra o item ao feed de comunidade de modalidade games", () => {
  const sql = GamesScore.gamesItemSql("it");
  assert.match(sql, /tb_community_feed_item/);
  assert.match(sql, /community_kind = 'games'/);
  // Correlato com o alias que veio: sem isto o EXISTS deixaria de filtrar e
  // TODO post do site passaria a contar como post de games.
  assert.match(sql, /it\.id_portfolio_item/);
});

test("o mesmo recorte serve qualquer alias — é uma função, não um texto colado", () => {
  const a = GamesScore.gamesItemSql("it");
  const b = GamesScore.gamesItemSql("outro");
  assert.strictEqual(a.replace(/\bit\./g, "X."), b.replace(/\boutro\./g, "X."));
});

test("escopo cidade compara CIDADE E ESTADO — nunca a cidade sozinha", () => {
  const sql = GamesScore.scopeSql("city", "p");
  assert.match(sql, /p\.municipio/);
  assert.match(sql, /p\.estado/);
});

test("escopo estado NÃO filtra por cidade", () => {
  const sql = GamesScore.scopeSql("state", "p");
  assert.match(sql, /p\.estado/);
  assert.ok(!/municipio/.test(sql), "o escopo de estado não pode olhar a cidade");
});

test("o escopo é fragmento pronto — nenhum $n entra no recorte (42P08)", () => {
  for (const scope of ["city", "state"]) {
    assert.ok(
      !/\$\d/.test(GamesScore.scopeSql(scope, "p")),
      `o escopo ${scope} não pode virar parâmetro dentro de expressão`
    );
  }
});

test("escopo desconhecido cai em cidade, em vez de derrubar a tela", () => {
  assert.strictEqual(GamesScore.normalizeScope("global"), "city");
  assert.strictEqual(GamesScore.normalizeScope(undefined), "city");
  assert.strictEqual(GamesScore.normalizeScope("state"), "state");
  assert.strictEqual(GamesScore.normalizeScope("city"), "city");
});

test("a pontuação soma os quatro sinais com os pesos declarados", () => {
  const sql = GamesScore.scoreSql();
  assert.match(sql, new RegExp(`\\* ${GamesScore.WEIGHTS.like}\\b`));
  assert.match(sql, new RegExp(`\\* ${GamesScore.WEIGHTS.comment}\\b`));
  assert.match(sql, new RegExp(`\\* ${GamesScore.WEIGHTS.share}\\b`));
  assert.match(sql, new RegExp(`/ ${GamesScore.SECONDS_PER_POINT}\\b`));
});

test("ausência de sinal vale zero, não NULL — senão o score inteiro some", () => {
  // Sem COALESCE, um LEFT JOIN sem linha faria a soma virar NULL e a pessoa
  // sumir da fila mesmo tendo pontuado nas outras métricas.
  const sql = GamesScore.scoreSql();
  assert.strictEqual((sql.match(/COALESCE/g) || []).length, 4);
});

test("a divisão do tempo é inteira: minuto solto não vira ponto", () => {
  const pontos = (segundos) => Math.floor(segundos / GamesScore.SECONDS_PER_POINT);
  assert.strictEqual(pontos(GamesScore.SECONDS_PER_POINT - 1), 0);
  assert.strictEqual(pontos(GamesScore.SECONDS_PER_POINT), 1);
  assert.strictEqual(pontos(GamesScore.DAILY_CAP_SECONDS), 36);
});

test("a calibração do tempo, em uma asserção: um dia inteiro = 12 compartilhamentos", () => {
  // É este número que decide se a fila mede presença ou conteúdo. Um dia
  // inteiro no teto (6h) rende 36 pontos — o mesmo que 12 compartilhamentos ou
  // 36 curtidas. Presença conta, e não decide sozinha: quem só deixa a aba
  // aberta continua atrás de quem publica algo que os outros compartilham.
  //
  // Mexeu em SECONDS_PER_POINT ou em DAILY_CAP_SECONDS? Esta linha quebra, e é
  // para quebrar: a mudança precisa ser deliberada, não efeito colateral.
  const presencaDoDia = Math.floor(GamesScore.DAILY_CAP_SECONDS / GamesScore.SECONDS_PER_POINT);
  assert.strictEqual(presencaDoDia, 36);
  assert.strictEqual(presencaDoDia, 12 * GamesScore.WEIGHTS.share);
});
