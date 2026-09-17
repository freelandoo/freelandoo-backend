// src/services/AiContextService.js
// O DOSSIÊ: tudo que a plataforma já sabe sobre um vendedor, virado texto para
// o modelo ler.
//
// ─── ⚠️ ISTO NÃO INVENTA NADA, E É O PONTO INTEIRO ──────────────────────────
//
// O atendente responde preço, endereço e horário. Um número inventado aqui não
// é um erro de software: é uma promessa comercial que alguém vai ter que honrar
// na frente de um cliente. Por isso o dossiê só carrega FATO GRAVADO, e o que
// não está gravado não aparece — em vez de aparecer como zero, vazio ou palpite.
//
// As três armadilhas de preço que este arquivo fecha, todas silenciosas:
//
//   1. SERVIÇO SOB ORÇAMENTO (mig 239) tem `price_amount = 0`. Formatado como
//      moeda vira "R$ 0,00" e o atendente anuncia DE GRAÇA o que ia ser orçado.
//   2. ITEM DESATIVADO continua no banco. Oferecê-lo é vender o que não existe.
//   3. CENTAVOS: a plataforma conta em centavos inteiros. Um `price_amount`
//      solto no texto vira "4000 reais" para um corte de R$ 40.
//
// ─── DE ONDE SAI ────────────────────────────────────────────────────────────
//
// Do que JÁ EXISTE. A API de Dados (mig 172) responde "o que esta conta tem"
// desde 2026-07-02 e nunca foi lida por ninguém dentro da plataforma: perfis,
// serviços, produtos, redes e cursos. Construir uma segunda varredura seria a
// segunda verdade de sempre — no dia em que discordassem, o atendente falaria
// de um serviço que a vitrine jura não existir.
const pool = require("../databases");
const DataExportService = require("./DataExportService");
const CommunitySiteStorage = require("../storages/CommunitySiteStorage");
const DataExportStorage = require("../storages/DataExportStorage");
const AiKnowledgeStorage = require("../storages/AiKnowledgeStorage");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AiContextService");

/**
 * Teto do dossiê inteiro, em caracteres (~6 mil tokens).
 *
 * ⚠️ O teto não é economia, é QUALIDADE: o que passa dele empurra para fora da
 * janela justamente o trecho que responderia a pergunta. Quando aperta, o corte
 * é por PRIORIDADE declarada abaixo — nunca pelo fim do texto.
 */
const MAX_DOSSIE = 24_000;

/** Quanto cada bloco pode ocupar, na ordem em que sobrevivem ao aperto. */
const ORCAMENTO = {
  // O que o dono escreveu à mão é o de maior sinal: ele escreveu justamente o
  // que a plataforma não sabia.
  conhecimento: 10_000,
  servicos: 5_000,
  produtos: 4_000,
  site: 4_000,
  identidade: 1_000,
  cursos: 1_500,
  contato: 800,
};

const brl = (cents) =>
  (Number(cents || 0) / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function corta(texto, teto) {
  const s = String(texto || "").trim();
  if (s.length <= teto) return s;
  return s.slice(0, teto) + "\n[...] (trecho cortado por tamanho)";
}

/** Uma linha só, sem quebra — cada item do dossiê tem que caber numa linha. */
const linha = (s) => String(s || "").replace(/\s+/g, " ").trim();

/**
 * Achata o documento do site (JSONB) em texto.
 *
 * ⚠️ Anda pela árvore em vez de conhecer os kinds um a um, e isso é decisão:
 * seção nova do construtor (mig 212/238 já trocaram a forma duas vezes) passa
 * a ser lida sozinha. Conhecer os kinds faria o atendente ficar cego para a
 * seção nova sem que nada quebrasse.
 *
 * As chaves de APARÊNCIA e de ENDEREÇO DE ARQUIVO são puladas: "#F2B705" e
 * "https://.../foto.webp" não respondem pergunta de cliente e custam token.
 */
const CHAVES_MUDAS = new Set([
  "id", "kind", "url", "href", "src", "image", "imageUrl", "photo", "heroPhoto",
  "color", "accent", "background", "icon", "theme", "slug", "styleKey",
  "objectPosition", "layout", "textStyles", "enabled", "visible", "order",
]);

function achataSite(no, saida = [], profundidade = 0) {
  if (profundidade > 8 || saida.length > 400) return saida;
  if (typeof no === "string") {
    const t = linha(no);
    // Endereço de arquivo e cor entram como string em campo de nome inocente.
    if (t && t.length > 1 && !/^https?:\/\//i.test(t) && !/^#[0-9a-f]{3,8}$/i.test(t)) saida.push(t);
    return saida;
  }
  if (Array.isArray(no)) {
    for (const item of no) achataSite(item, saida, profundidade + 1);
    return saida;
  }
  if (no && typeof no === "object") {
    for (const [k, v] of Object.entries(no)) {
      if (CHAVES_MUDAS.has(k)) continue;
      achataSite(v, saida, profundidade + 1);
    }
  }
  return saida;
}

class AiContextService {
  /**
   * Monta o dossiê de um usuário.
   *
   * @returns {Promise<{ text: string, parts: object, chars: number }>}
   */
  static async build(id_user) {
    return runWithLogs(log, "build", () => ({ id_user }), async () => {
      const user = { id_user };
      const blocos = [];
      const parts = {};

      // ─── identidade ───────────────────────────────────────────────────────
      const perfis = await DataExportService.profiles(user);
      const lista = perfis?.profiles || [];
      const conta = lista.find((p) => p.is_user_account) || lista[0] || null;

      if (conta) {
        const id = [
          `Nome: ${conta.display_name || conta.username || "(não informado)"}`,
          conta.username ? `Usuário: @${conta.username}` : null,
          conta.profession ? `Profissão: ${conta.profession}` : null,
          [conta.municipio, conta.estado].filter(Boolean).join(" / ") || null,
          conta.bio ? `Sobre: ${linha(conta.bio)}` : null,
        ]
          .filter(Boolean)
          .join("\n");
        parts.identidade = corta(id, ORCAMENTO.identidade);
        blocos.push(`## QUEM ATENDE\n${parts.identidade}`);
      }

      // Os outros perfis do dono também vendem — o cliente não sabe que são
      // linhas diferentes no banco, e para ele é tudo "o mesmo negócio".
      const outros = lista.filter((p) => p !== conta && !p.is_community && (p.bio || p.profession));
      if (outros.length) {
        const txt = outros
          .slice(0, 6)
          .map((p) => `- ${p.display_name || p.username}${p.profession ? ` (${p.profession})` : ""}${p.bio ? `: ${linha(p.bio)}` : ""}`)
          .join("\n");
        blocos.push(`## OUTROS PERFIS DESTA CONTA\n${corta(txt, ORCAMENTO.identidade)}`);
      }

      // ─── serviços ─────────────────────────────────────────────────────────
      const svc = await DataExportService.services(user);
      const ativos = (svc?.services || []).filter((s) => s.is_active);
      if (ativos.length) {
        const txt = ativos
          .map((s) => {
            // ⚠️ AQUI MORA A ARMADILHA Nº 1. `price_on_request` (mig 239) tem
            // `price_amount = 0`; sem este ramo o atendente anuncia de graça.
            const preco = s.price_on_request ? "sob orçamento" : brl(s.price_amount);
            const dur = s.duration_minutes ? `, ${s.duration_minutes} min` : "";
            const desc = s.description ? ` — ${linha(s.description)}` : "";
            return `- ${linha(s.name)}: ${preco}${dur}${desc}`;
          })
          .join("\n");
        parts.servicos = corta(txt, ORCAMENTO.servicos);
        blocos.push(`## SERVIÇOS (preço e duração)\n${parts.servicos}`);
      }

      // ─── produtos ─────────────────────────────────────────────────────────
      const prod = await DataExportService.products(user);
      const emVenda = (prod?.products || []).filter(
        (p) => p.is_active && p.moderation_status !== "rejected"
      );
      if (emVenda.length) {
        const txt = emVenda
          .slice(0, 80)
          .map((p) => {
            const estoque =
              p.stock_quantity === null || p.stock_quantity === undefined
                ? ""
                : p.stock_quantity > 0
                  ? `, ${p.stock_quantity} em estoque`
                  : ", SEM ESTOQUE no momento";
            const desc = p.description ? ` — ${linha(p.description)}` : "";
            return `- ${linha(p.name)}: ${brl(p.price_amount)}${estoque}${desc}`;
          })
          .join("\n");
        parts.produtos = corta(txt, ORCAMENTO.produtos);
        blocos.push(`## PRODUTOS DA LOJA\n${parts.produtos}`);
      }

      // ─── cursos ───────────────────────────────────────────────────────────
      const cur = await DataExportService.courses(user);
      const publicados = (cur?.courses || []).filter((c) => c.status === "published");
      if (publicados.length) {
        const txt = publicados
          .map((c) => `- ${linha(c.title)}: ${brl(c.price_cents)}${c.short_description ? ` — ${linha(c.short_description)}` : ""}`)
          .join("\n");
        blocos.push(`## CURSOS\n${corta(txt, ORCAMENTO.cursos)}`);
      }

      // ─── o site publicado (descrição, endereço, horário, perguntas) ───────
      const comunidades = lista.filter((p) => p.is_community);
      const siteTxt = [];
      for (const com of comunidades.slice(0, 4)) {
        const site = await CommunitySiteStorage.getByProfile(pool, com.id_profile).catch(() => null);
        // ⚠️ SÓ SITE PUBLICADO. Rascunho é texto que o dono ainda está
        // escrevendo — o atendente citaria preço de uma página que ninguém viu.
        if (!site || !site.is_published) continue;
        const frases = achataSite({ sections: site.sections, pages: site.pages });
        const unicas = [...new Set(frases)].filter((f) => f.length > 2);
        siteTxt.push(
          `### ${site.site_name || com.display_name || "Site"}${site.tagline ? ` — ${linha(site.tagline)}` : ""}\n${unicas.join("\n")}`
        );
      }
      if (siteTxt.length) {
        parts.site = corta(siteTxt.join("\n\n"), ORCAMENTO.site);
        blocos.push(`## O QUE O SITE PUBLICADO DIZ\n${parts.site}`);
      }

      // ─── contato ──────────────────────────────────────────────────────────
      const soc = await DataExportStorage.listSocial(pool, lista.map((p) => p.id_profile)).catch(() => []);
      if (soc.length) {
        const txt = [...new Set(soc.map((s) => `- ${s.network}: ${s.url || s.phone_number_normalized || ""}`.trim()))].join("\n");
        blocos.push(`## REDES E CONTATO\n${corta(txt, ORCAMENTO.contato)}`);
      }

      // ─── o que o dono escreveu (texto e PDF) ──────────────────────────────
      const docs = await AiKnowledgeStorage.listActiveContent(pool, id_user);
      if (docs.length) {
        const txt = docs.map((d) => `### ${linha(d.title)}\n${d.content}`).join("\n\n");
        parts.conhecimento = corta(txt, ORCAMENTO.conhecimento);
        // Vem POR ÚLTIMO de propósito: é o mais específico e, em janela de
        // contexto, o que está mais perto da pergunta pesa mais.
        blocos.push(`## INFORMAÇÕES QUE O DONO ESCREVEU (têm precedência)\n${parts.conhecimento}`);
      }

      const text = corta(blocos.join("\n\n"), MAX_DOSSIE);
      return { text, parts, chars: text.length, has_knowledge: docs.length > 0 };
    });
  }
}

module.exports = AiContextService;
