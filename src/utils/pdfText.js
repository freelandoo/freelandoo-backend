// src/utils/pdfText.js
// Extrai o TEXTO de um PDF. É a única porta de PDF do backend.
//
// ⚠️ O PDF NÃO FICA GUARDADO. O que vai para `tb_ai_knowledge.content` é o
// texto extraído aqui, uma vez, no upload. Guardar o binário obrigaria a
// re-extrair a cada resposta — trabalho repetido no caminho mais quente — e
// deixaria em repouso um arquivo que, depois de extraído, não serve a mais nada.
//
// ⚠️ PDF SEM CAMADA DE TEXTO É RECUSADO EM VOZ ALTA. Um PDF que é só imagem
// (foto de tabela de preços, folheto escaneado) extrai string vazia. Gravar
// vazio seria o pior resultado possível: a tela diria "documento adicionado",
// o admin acreditaria que a IA sabe daqueles preços, e ela responderia sem
// eles — sem erro nenhum em lugar nenhum.
const { PDFParse } = require("pdf-parse");

/** Acima disto o arquivo é recusado antes de ser aberto. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Teto do texto extraído.
 *
 * Um manual de 400 páginas cabe no banco e NÃO cabe na janela do modelo — e o
 * excesso não é inofensivo: ele empurra para fora do contexto justamente o que
 * o cliente perguntou. Cortar aqui, com aviso, é melhor do que cortar em
 * silêncio na hora de montar o dossiê.
 */
const MAX_CHARS = 120_000;

/** Espaço repetido e quebra tripla viram ruído caro: cada um é token pago. */
function tidy(raw) {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[ \t]+| [ \t]+$/gm, "")
    .trim();
}

/**
 * @param {Buffer} buffer
 * @returns {Promise<{ text: string, pages: number, truncated: boolean }>}
 * @throws {Error} com `userMessage` quando a recusa é explicável ao usuário.
 */
async function extractPdfText(buffer) {
  if (!buffer || !buffer.length) {
    const e = new Error("Arquivo vazio.");
    e.userMessage = "O arquivo chegou vazio.";
    throw e;
  }
  if (buffer.length > MAX_BYTES) {
    const e = new Error("PDF acima do limite.");
    e.userMessage = `O PDF tem ${(buffer.length / 1048576).toFixed(1)} MB e o limite é 10 MB.`;
    throw e;
  }

  let parser = null;
  try {
    parser = new PDFParse({ data: buffer });
    const out = await parser.getText();

    // ⚠️ O TEXTO VEM DE `pages[].text`, NUNCA DO AGREGADO `out.text`.
    //
    // O `pdf-parse` v2 injeta um separador no agregado — um PDF de uma página
    // volta `"...\n\n-- 1 of 1 --\n\n"`. Isso estraga as duas coisas que mais
    // importam aqui:
    //
    //   • uma página EM BRANCO (o folheto escaneado) volta NÃO-VAZIA, então a
    //     recusa logo abaixo nunca dispararia e o documento entraria mudo;
    //   • e o marcador viraria conteúdo enviado ao modelo, em toda resposta,
    //     custando token para dizer "-- 3 of 12 --".
    //
    // O separador é do agregado; `pages[].text` já vem limpo.
    const paginas = Array.isArray(out?.pages) ? out.pages : [];
    const bruto = paginas.length
      ? paginas.map((p) => String(p?.text || "")).join("\n\n")
      : String(out?.text || "").replace(/^\s*--\s*\d+\s+of\s+\d+\s*--\s*$/gm, "");
    const text = tidy(bruto);
    const pages = Number(out?.total || paginas.length || 0);

    if (!text) {
      const e = new Error("PDF sem camada de texto.");
      e.userMessage =
        "Este PDF não tem texto — ele parece ser só imagem (documento escaneado ou foto). " +
        "Copie o conteúdo e cole como texto, ou gere o PDF a partir do documento original.";
      throw e;
    }

    return {
      text: text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) : text,
      pages,
      truncated: text.length > MAX_CHARS,
    };
  } catch (err) {
    if (err.userMessage) throw err;
    // Senha e arquivo corrompido chegam como exceções do pdf.js; a mensagem
    // crua dele não ajuda quem está olhando a tela.
    const name = String(err?.name || "");
    const e = new Error(`Falha ao ler o PDF: ${err.message}`);
    e.userMessage = name.includes("Password")
      ? "Este PDF está protegido por senha. Remova a senha e envie de novo."
      : "Não consegui ler este PDF. Confira se o arquivo não está corrompido.";
    throw e;
  } finally {
    // ⚠️ Sem o destroy, cada upload deixa o documento e os workers do pdf.js
    // vivos — o vazamento só aparece como memória subindo devagar no container.
    if (parser) await parser.destroy().catch(() => {});
  }
}

module.exports = { extractPdfText, MAX_BYTES, MAX_CHARS };
