// test/unit/pdfText.test.js
//
// Exercita o extrator contra PDFs DE VERDADE, montados byte a byte aqui — não
// contra um dublê. A forma da API do `pdf-parse` mudou entre a v1 (função) e a
// v2 (classe `PDFParse`), e um dublê teria continuado dizendo "ok" com o
// extrator quebrado.
//
// O defeito que este arquivo trava é o mais caro do caminho: PDF SEM CAMADA DE
// TEXTO (folheto escaneado, foto de tabela de preços) extrai string vazia. Sem
// a recusa, a tela diria "documento adicionado", o dono acreditaria que a IA
// conhece aqueles preços, e ela responderia sem eles — sem erro em lugar nenhum.
const test = require("node:test");
const assert = require("node:assert");
const { extractPdfText, MAX_BYTES } = require("../../src/utils/pdfText");

/** Um PDF mínimo e válido com uma página e o texto pedido. */
function pdfComTexto(texto) {
  const conteudo = `BT /F1 18 Tf 72 700 Td (${texto}) Tj ET`;
  const objetos = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
    `<</Length ${conteudo.length}>>\nstream\n${conteudo}\nendstream`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
  ];

  let corpo = "%PDF-1.4\n";
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(corpo.length);
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });

  const inicioXref = corpo.length;
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) corpo += `${String(off).padStart(10, "0")} 00000 n \n`;
  corpo += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(corpo, "latin1");
}

/** Um PDF válido com uma página em branco — o caso do documento escaneado. */
function pdfSemTexto() {
  const objetos = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    "<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>",
  ];
  let corpo = "%PDF-1.4\n";
  const offsets = [];
  objetos.forEach((o, i) => {
    offsets.push(corpo.length);
    corpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const inicioXref = corpo.length;
  corpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) corpo += `${String(off).padStart(10, "0")} 00000 n \n`;
  corpo += `trailer\n<</Size ${objetos.length + 1}/Root 1 0 R>>\nstartxref\n${inicioXref}\n%%EOF\n`;
  return Buffer.from(corpo, "latin1");
}

test("extrai o texto de um PDF de verdade", async () => {
  const out = await extractPdfText(pdfComTexto("Corte R$ 40 - Barba R$ 25"));
  assert.match(out.text, /Corte R\$ 40/);
  assert.match(out.text, /Barba R\$ 25/);
  assert.equal(out.pages, 1);
  assert.equal(out.truncated, false);
  // ⚠️ O separador que o pdf-parse v2 injeta no AGREGADO não pode vazar: ele
  // viraria conteúdo enviado ao modelo em toda resposta, e é token pago para
  // dizer "-- 3 of 12 --".
  assert.doesNotMatch(out.text, /--\s*\d+\s+of\s+\d+\s*--/);
});

test("PDF sem camada de texto e RECUSADO em voz alta, nunca gravado vazio", async () => {
  await assert.rejects(
    () => extractPdfText(pdfSemTexto()),
    (err) => {
      assert.ok(err.userMessage, "a recusa tem que ser explicavel ao usuario");
      assert.match(err.userMessage, /imagem|escaneado/i);
      return true;
    }
  );
});

test("arquivo vazio e recusado", async () => {
  await assert.rejects(() => extractPdfText(Buffer.alloc(0)), (e) => !!e.userMessage);
});

test("arquivo acima do teto e recusado ANTES de ser aberto", async () => {
  const grande = Buffer.alloc(MAX_BYTES + 1);
  await assert.rejects(
    () => extractPdfText(grande),
    (err) => {
      // A recusa fala em MB, não em bytes — é o que a pessoa entende.
      assert.match(err.userMessage, /MB/);
      return true;
    }
  );
});

test("lixo que nao e PDF e recusado com frase, nao com erro cru do pdf.js", async () => {
  await assert.rejects(
    () => extractPdfText(Buffer.from("isto nao e um pdf")),
    (err) => {
      assert.ok(err.userMessage);
      assert.doesNotMatch(err.userMessage, /pdf\.js|stream|XRef/i);
      return true;
    }
  );
});

test("o texto sai normalizado (sem espaco repetido nem quebra tripla)", async () => {
  const out = await extractPdfText(pdfComTexto("Rua   das    Flores"));
  assert.doesNotMatch(out.text, / {2}/);
  assert.doesNotMatch(out.text, /\n{3}/);
});
