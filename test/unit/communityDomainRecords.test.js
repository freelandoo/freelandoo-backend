// Os registros de DNS que o painel manda a pessoa criar (migs 213/214).
//
// Unit e não e2e de propósito: `buildRecords` é pura e é onde esta feature
// falha CALADA. Nome relativo errado ("_freelandoo.exemplo.com.br" num painel
// que espera o relativo) cria um registro de verdade, sem erro nenhum — só que
// em "_freelandoo.exemplo.com.br.exemplo.com.br", que ninguém vai procurar.
// E valor de rota escrito à mão manda o domínio do cliente para o servidor de
// outra pessoa.

const test = require("node:test");
const assert = require("node:assert");

const { buildRecords } = require("../../src/services/CommunityDomainService");

const TOKEN = "1c0659dbfe8dad5f1641be52926e48bb";
const DNS = {
  a: ["216.150.1.1", "216.150.16.1"],
  cname: "0bf7c32d38c049ba.vercel-dns-017.com",
};

const row = (domain) => ({ domain, verification_token: TOKEN });

test("o TXT de posse sai com o nome RELATIVO à zona, e o completo junto", () => {
  const [txt] = buildRecords(row("ricardofogoes.com.br"), null);
  assert.strictEqual(txt.type, "TXT");
  assert.strictEqual(txt.name, "_freelandoo");
  assert.strictEqual(txt.host, "_freelandoo.ricardofogoes.com.br");
  assert.strictEqual(txt.value, `freelandoo-site-verification=${TOKEN}`);
});

test("sem provedor automatizado, sai SÓ o TXT — nenhum valor de rota é inventado", () => {
  const recs = buildRecords(row("ricardofogoes.com.br"), null);
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs.every((r) => r.type === "TXT"), true);
});

test("domínio raiz recebe A (nunca CNAME) com TODOS os IPs do provedor", () => {
  const recs = buildRecords(row("ricardofogoes.com.br"), DNS);
  const rota = recs.filter((r) => r.purpose === "route");
  assert.deepStrictEqual(rota.map((r) => r.type), ["A", "A"]);
  assert.deepStrictEqual(rota.map((r) => r.value), DNS.a);
  assert.strictEqual(rota.every((r) => r.name === "@"), true);
  // CNAME no ápice conflita com o SOA/NS da zona — não pode aparecer como rota.
  assert.strictEqual(rota.some((r) => r.type === "CNAME"), false);
});

test("a raiz ganha o www como OPCIONAL — é o que a pessoa digita por reflexo", () => {
  const recs = buildRecords(row("ricardofogoes.com.br"), DNS);
  const www = recs.find((r) => r.purpose === "optional");
  assert.strictEqual(www.type, "CNAME");
  assert.strictEqual(www.name, "www");
  assert.strictEqual(www.host, "www.ricardofogoes.com.br");
  assert.strictEqual(www.value, DNS.cname);
});

test("subdomínio recebe CNAME com o nome relativo à zona, não ao próprio domínio", () => {
  const recs = buildRecords(row("loja.exemplo.com.br"), DNS);
  const rota = recs.filter((r) => r.purpose === "route");
  assert.strictEqual(rota.length, 1);
  assert.strictEqual(rota[0].type, "CNAME");
  assert.strictEqual(rota[0].name, "loja");
  assert.strictEqual(rota[0].value, DNS.cname);
  // O TXT também é relativo à zona, não ao subdomínio.
  assert.strictEqual(recs[0].name, "_freelandoo.loja");
  assert.strictEqual(recs[0].host, "_freelandoo.loja.exemplo.com.br");
});

test("subdomínio NÃO ganha a linha do www — ali ela não quer dizer nada", () => {
  const recs = buildRecords(row("loja.exemplo.com.br"), DNS);
  assert.strictEqual(recs.some((r) => r.purpose === "optional"), false);
});

test("provedor sem CNAME não produz linha de CNAME vazia", () => {
  const recs = buildRecords(row("exemplo.com"), { a: ["1.2.3.4"], cname: null });
  assert.strictEqual(recs.some((r) => r.type === "CNAME"), false);
  assert.strictEqual(recs.filter((r) => r.type === "A").length, 1);
});

test("o valor de rota é SEMPRE o que o provedor devolveu, nunca um literal", () => {
  const outro = { a: ["9.9.9.9"], cname: "outra-conta.vercel-dns-999.com" };
  const recs = buildRecords(row("exemplo.com"), outro);
  assert.strictEqual(recs.find((r) => r.type === "A").value, "9.9.9.9");
  assert.strictEqual(recs.find((r) => r.type === "CNAME").value, outro.cname);
});
