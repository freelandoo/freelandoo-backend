// src/services/AiKnowledgeService.js
// A base de conhecimento: o que o dono escreve à mão ou manda em PDF para o
// atendente saber — condição de pagamento, política de troca, o que a tabela
// de preços não diz.
//
// ⚠️ ISTO É O QUE A PLATAFORMA NÃO SABE. Perfil, serviços, loja e site já
// entram no dossiê sozinhos (AiContextService). Este arquivo existe para o
// resto — e é por isso que o texto daqui tem PRECEDÊNCIA no prompt: se o dono
// escreveu "hoje estamos sem a máquina de cartão", isso vence o que qualquer
// outra fonte diga.
const pool = require("../databases");
const AiKnowledgeStorage = require("../storages/AiKnowledgeStorage");
const AiContextService = require("./AiContextService");
const { extractPdfText } = require("../utils/pdfText");
const { hasUpload, ensureFileBuffer } = require("../utils/mediaProcessing");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AiKnowledgeService");

const TITULO_MAX = 120;
const TEXTO_MAX = 40_000;
/** Teto de documentos por conta — freio de acúmulo, não de uso. */
const DOCS_MAX = 40;

class AiKnowledgeService {
  static async list(user) {
    return runWithLogs(log, "list", () => ({ id_user: user?.id_user }), async () => {
      const docs = await AiKnowledgeStorage.listByUser(pool, user.id_user);
      return {
        docs,
        limit: DOCS_MAX,
        // Só o que está LIGADO conta para o dossiê — a tela mostra os dois
        // números porque "tenho 12 documentos" e "a IA lê 3" são coisas
        // diferentes, e confundi-las faz o dono achar que ela sabe o que não sabe.
        active: docs.filter((d) => d.is_active).length,
      };
    });
  }

  static async createText(user, body = {}) {
    return runWithLogs(log, "createText", () => ({ id_user: user?.id_user }), async () => {
      const title = String(body.title || "").trim().slice(0, TITULO_MAX);
      const content = String(body.content || "").trim().slice(0, TEXTO_MAX);
      if (!title) return { error: "Dê um título para este documento.", statusCode: 400 };
      if (!content) return { error: "Escreva o conteúdo do documento.", statusCode: 400 };

      const cheio = await this._assertEspaco(user.id_user);
      if (cheio) return cheio;

      const doc = await AiKnowledgeStorage.create(pool, {
        id_user: user.id_user,
        source: "text",
        title,
        content,
      });
      return { ok: true, doc };
    });
  }

  /**
   * Um PDF vira TEXTO na entrada e o arquivo é descartado.
   *
   * ⚠️ A EXTRAÇÃO VEM ANTES DE QUALQUER ESCRITA. Gravar a linha primeiro e
   * extrair depois deixaria, num PDF só-imagem, um documento vazio na lista
   * dizendo ao dono que a IA aprendeu alguma coisa.
   */
  static async createFromPdf(user, file, body = {}) {
    return runWithLogs(log, "createFromPdf", () => ({ id_user: user?.id_user }), async () => {
      // ⚠️ `hasUpload`, NUNCA `file.buffer` — é a régua única de "veio arquivo?"
      // e ela aceita memória E disco. Foi um `if (!file.buffer)` que já respondeu
      // "Arquivo não enviado" com o arquivo em disco, em quatro portas.
      if (!hasUpload(file)) return { error: "Anexe o arquivo PDF.", statusCode: 400 };

      const cheio = await this._assertEspaco(user.id_user);
      if (cheio) return cheio;

      await ensureFileBuffer(file);

      let extraido;
      try {
        extraido = await extractPdfText(file.buffer);
      } catch (err) {
        // `userMessage` é a frase pensada para quem está olhando a tela; a
        // mensagem crua do pdf.js fala de XRef e stream e não ajuda ninguém.
        return { error: err.userMessage || "Não consegui ler este PDF.", statusCode: 400 };
      }

      const title =
        String(body.title || "").trim().slice(0, TITULO_MAX) ||
        String(file.originalname || "Documento").replace(/\.pdf$/i, "").slice(0, TITULO_MAX);

      const doc = await AiKnowledgeStorage.create(pool, {
        id_user: user.id_user,
        source: "pdf",
        title,
        content: extraido.text,
        file_name: file.originalname || null,
      });

      return {
        ok: true,
        doc,
        pages: extraido.pages,
        // Dito em voz alta: o dono precisa saber que o fim do manual dele ficou
        // de fora, senão ele vai achar que a IA leu tudo.
        truncated: extraido.truncated,
      };
    });
  }

  static async update(user, id_knowledge, body = {}) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user, id_knowledge }), async () => {
      const patch = {};
      if (body.title !== undefined) {
        const t = String(body.title || "").trim().slice(0, TITULO_MAX);
        if (!t) return { error: "O título não pode ficar vazio.", statusCode: 400 };
        patch.title = t;
      }
      if (body.content !== undefined) {
        const t = String(body.content || "").trim().slice(0, TEXTO_MAX);
        if (!t) return { error: "O conteúdo não pode ficar vazio.", statusCode: 400 };
        patch.content = t;
      }
      if (body.is_active !== undefined) patch.is_active = body.is_active !== false;
      if (!Object.keys(patch).length) return { error: "Nada para alterar.", statusCode: 400 };

      const doc = await AiKnowledgeStorage.update(pool, user.id_user, id_knowledge, patch);
      if (!doc) return { error: "Documento não encontrado.", statusCode: 404 };
      return { ok: true, doc };
    });
  }

  static async remove(user, id_knowledge) {
    return runWithLogs(log, "remove", () => ({ id_user: user?.id_user, id_knowledge }), async () => {
      const gone = await AiKnowledgeStorage.remove(pool, user.id_user, id_knowledge);
      if (!gone) return { error: "Documento não encontrado.", statusCode: 404 };
      return { ok: true };
    });
  }

  /**
   * O dossiê inteiro, como o modelo vai lê-lo.
   *
   * ⚠️ Esta porta é o que impede o atendente de ser uma caixa-preta. Sem ela, a
   * única forma de descobrir que a IA não conhece um preço é um cliente receber
   * a resposta errada — e aí já foi. Aqui o dono LÊ o que ela sabe, antes.
   */
  static async preview(user) {
    return runWithLogs(log, "preview", () => ({ id_user: user?.id_user }), async () => {
      const d = await AiContextService.build(user.id_user);
      return { dossie: d.text, chars: d.chars, has_knowledge: d.has_knowledge };
    });
  }

  static async _assertEspaco(id_user) {
    const docs = await AiKnowledgeStorage.listByUser(pool, id_user);
    if (docs.length >= DOCS_MAX) {
      return {
        error: `Limite de ${DOCS_MAX} documentos. Apague algum antes de acrescentar outro.`,
        statusCode: 409,
      };
    }
    return null;
  }
}

module.exports = AiKnowledgeService;
