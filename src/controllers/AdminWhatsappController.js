// src/controllers/AdminWhatsappController.js
// W6 — o painel de qualidade dos números do portfólio.
//
// ─── POR QUE ESTE PAINEL EXISTE ─────────────────────────────────────────────
//
// Na fase 1 (mig 240) os números dos clientes moram no WABA da Freelandoo, e a
// escala automática do teto — 2 no começo, até 20 — depende da qualidade
// AGREGADA de todos eles. Um número ruim trava o aumento para todo mundo.
//
// A punição direta é do dono; o crescimento travado é nosso. Sem uma lista que
// diga QUAL número está degradando e DE QUEM ele é, o sintoma chega meses
// depois como "o limite parou de subir", sem nome e sem data — e aí não há
// mais como saber quem causou.
//
// ─── O DESCONECTAR DAQUI É DIFERENTE DO DESCONECTAR DO DONO ─────────────────
//
// O dono desliga o próprio número pela aba dele. Este botão desliga o número de
// OUTRA pessoa, e existe para um caso só: tirar do portfólio quem está
// degradando antes que ele trave o teto de todos. Por isso ele reusa o MESMO
// caminho (`WhatsappService.disconnect`) em vez de apagar a linha na mão — o
// número precisa sair do WABA da Meta também, senão ele continua contando
// contra o limite enquanto some da nossa tela.

const pool = require("../databases");
const WhatsappStorage = require("../storages/WhatsappStorage");
const WhatsappService = require("../services/WhatsappService");
// ⚠️ DESTRUCTURING: o módulo exporta { sendServiceResult, statusFromServiceError }.
// Importar o objeto inteiro já derrubou cinco controllers de uma vez (500 em
// toda resposta) e o erro só aparece em runtime.
const { sendServiceResult } = require("../utils/sendServiceResult");
const { createLogger } = require("../utils/logger");

const log = createLogger("AdminWhatsappController");

class AdminWhatsappController {
  /**
   * A lista, ordenada por gravidade (vermelho primeiro).
   *
   * ⚠️ O telefone sai INTEIRO aqui, e é deliberado: quem abre esta tela é
   * administrador, e a ação que ela existe para disparar é falar com o dono
   * sobre um número específico. Mascarar tornaria a lista inútil justamente
   * para o seu único uso. Não vale para log — lá o telefone continua reduzido.
   */
  static async listNumbers(req, res) {
    const rows = await WhatsappStorage.listForAdmin(pool, { limit: 200 });

    // Contagem por rating para o cabeçalho do painel: é ela que responde "o
    // portfólio está saudável?" sem obrigar a ler linha por linha.
    const tally = { GREEN: 0, YELLOW: 0, RED: 0, UNKNOWN: 0 };
    for (const r of rows) {
      const key = String(r.quality_rating || "").toUpperCase();
      if (key in tally) tally[key] += 1;
      else tally.UNKNOWN += 1;
    }

    return res.json({
      numbers: rows,
      tally,
      total: rows.length,
      // O teto da fase 1. Vem daqui e não do front para que a régua seja uma
      // só: o painel diz "8 de 20" sem guardar o 20 do lado de lá.
      phone_number_limit: Number(process.env.META_PHONE_NUMBER_LIMIT || 20),
    });
  }

  /**
   * Desliga o número de alguém (caso de degradação).
   *
   * Recebe o `id_instance` e resolve o dono aqui: aceitar `id_user` direto
   * faria a tela precisar conhecer uma segunda chave para a mesma linha.
   */
  static async disconnectNumber(req, res) {
    const rows = await WhatsappStorage.listForAdmin(pool, { limit: 500 });
    const target = rows.find((r) => String(r.id_instance) === String(req.params.id_instance));
    if (!target) return res.status(404).json({ error: "Número não encontrado." });

    log.warn("admin.whatsapp.disconnect", {
      id_instance: target.id_instance,
      username: target.username,
      quality: target.quality_rating,
      by: req.user && req.user.id_user,
    });

    const result = await WhatsappService.disconnect(target.id_user);
    return sendServiceResult(res, result);
  }
}

module.exports = AdminWhatsappController;
