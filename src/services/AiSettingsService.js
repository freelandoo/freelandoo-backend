// src/services/AiSettingsService.js
// O painel do admin: as duas chaves de LLM, o teste de conexão e o medidor.
//
// ─── ⚠️ A CHAVE ENTRA E NUNCA MAIS SAI ──────────────────────────────────────
//
// Ela é gravada SELADA (utils/secretBox) e nenhuma resposta desta classe a
// devolve — nem mascarada por engano num `SELECT *`. O que a tela mostra é o
// `key_hint`, os 4 últimos caracteres, que servem para o admin reconhecer qual
// chave está lá sem que a plataforma precise reexibir o segredo.
//
// Reexibir seria transformar o painel de administração num ponto de vazamento:
// basta uma sessão de admin comprometida para a chave de faturamento da conta
// da Anthropic/OpenAI ir junto.
const pool = require("../databases");
const AiProviderStorage = require("../storages/AiProviderStorage");
const AiJobStorage = require("../storages/AiJobStorage");
const AiRegistry = require("../integrations/ai");
const { seal, open } = require("../utils/secretBox");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AiSettingsService");

const MODEL_MAX = 120;
const LABEL_MAX = 80;

function hintOf(key) {
  const s = String(key || "");
  return s.length <= 4 ? s : s.slice(-4);
}

/** Preço em USD por milhão de tokens → aceita vírgula, recusa negativo. */
function parsePrice(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

class AiSettingsService {
  /** O que a tela precisa para desenhar: catálogo + o que está cadastrado. */
  static async getSettings() {
    return runWithLogs(log, "getSettings", () => ({}), async () => {
      const keys = await AiProviderStorage.list(pool);
      return {
        catalog: AiRegistry.catalog(),
        keys,
        // Sem nenhuma chave o subsistema é inerte — a tela diz isso em vez de
        // parecer ligada e não responder ninguém.
        ready: keys.some((k) => k.is_enabled),
      };
    });
  }

  static async saveKey(user, provider, body = {}) {
    return runWithLogs(log, "saveKey", () => ({ provider, by: user?.id_user }), async () => {
      const adapter = AiRegistry.get(provider);
      if (!adapter) return { error: "Provedor desconhecido.", statusCode: 404 };

      const existing = await AiProviderStorage.get(pool, adapter.name);

      // Chave só é tocada quando vem chave nova. Editar o modelo não pode
      // apagar o segredo — é por isso que os dois campos viajam juntos e em
      // COALESCE no upsert.
      const raw = String(body.api_key || "").trim();
      let sealed = null;
      let hint = null;
      if (raw) {
        sealed = seal(raw);
        hint = hintOf(raw);
      } else if (!existing) {
        return { error: "Cole a chave da API para cadastrar este provedor.", statusCode: 400 };
      }

      const model = String(body.model || existing?.model || adapter.defaultModel).trim().slice(0, MODEL_MAX);
      if (!model) return { error: "Informe o modelo.", statusCode: 400 };

      const priority = Number(body.priority);
      const row = await AiProviderStorage.upsert(pool, {
        provider: adapter.name,
        label: body.label === undefined ? null : String(body.label || "").slice(0, LABEL_MAX),
        api_key_sealed: sealed,
        key_hint: hint,
        model,
        is_enabled: body.is_enabled === undefined ? null : body.is_enabled !== false,
        priority: priority === 1 || priority === 2 ? priority : null,
        // Campo AUSENTE do corpo mantém o que já estava; campo presente e vazio
        // LIMPA de propósito (é assim que se volta para "preço não informado").
        price_in_mtok: body.price_in_mtok === undefined ? (existing?.price_in_mtok ?? null) : parsePrice(body.price_in_mtok),
        price_out_mtok: body.price_out_mtok === undefined ? (existing?.price_out_mtok ?? null) : parsePrice(body.price_out_mtok),
        updated_by: user?.id_user || null,
      });

      return { ok: true, key: row };
    });
  }

  static async removeKey(provider) {
    return runWithLogs(log, "removeKey", () => ({ provider }), async () => {
      const adapter = AiRegistry.get(provider);
      if (!adapter) return { error: "Provedor desconhecido.", statusCode: 404 };
      const gone = await AiProviderStorage.remove(pool, adapter.name);
      if (!gone) return { error: "Este provedor não estava cadastrado.", statusCode: 404 };
      return { ok: true };
    });
  }

  /**
   * Teste de conexão: uma chamada minúscula de verdade.
   *
   * ⚠️ É de verdade DE PROPÓSITO. Conferir só o formato da chave (`sk-ant-...`)
   * diria "tudo certo" para uma chave revogada, sem saldo ou com o modelo
   * errado digitado — e o erro apareceria na frente de um cliente, dias depois.
   * O custo de descobrir agora é de alguns tokens.
   */
  static async testKey(provider) {
    return runWithLogs(log, "testKey", () => ({ provider }), async () => {
      const adapter = AiRegistry.get(provider);
      if (!adapter) return { error: "Provedor desconhecido.", statusCode: 404 };

      const row = await AiProviderStorage.getSealedFor(pool, adapter.name);
      if (!row) return { error: "Cadastre a chave antes de testar.", statusCode: 404 };

      let apiKey;
      try {
        apiKey = open(row.api_key_sealed);
      } catch {
        // Acontece quando o JWT_SECRET/SECRET_BOX_KEY girou sem re-selar.
        await AiProviderStorage.markResult(pool, adapter.name, {
          ok: false,
          error: "A chave gravada não abre com a chave de cifra atual — recadastre-a.",
        });
        return {
          error: "A chave gravada não pôde ser aberta (a chave de cifra do ambiente mudou). Cole a chave da API de novo.",
          statusCode: 409,
        };
      }

      try {
        const out = await adapter.complete({
          apiKey,
          model: row.model,
          system: "Você é um teste de conexão. Responda exatamente: ok",
          messages: [{ role: "user", content: "ok?" }],
          maxTokens: 16,
          temperature: 0,
        });
        await AiProviderStorage.markResult(pool, adapter.name, { ok: true });
        // O teste também é uso: ele consome token e entra no medidor, senão a
        // conta do mês nunca fecharia com a fatura do provedor.
        await AiJobStorage.recordUsage(pool, {
          id_user: null,
          id_job: null,
          provider: adapter.name,
          model: out.model,
          channel: null,
          input_tokens: out.input_tokens,
          output_tokens: out.output_tokens,
          cost_usd: this.costOf(row, out.input_tokens, out.output_tokens),
        }).catch(() => {});
        return { ok: true, model: out.model, reply: out.text.slice(0, 200) };
      } catch (e) {
        await AiProviderStorage.markResult(pool, adapter.name, { ok: false, error: e.message });
        return { error: e.message, statusCode: e.statusCode === 401 ? 401 : 502 };
      }
    });
  }

  /**
   * Custo em USD, ou `null` quando o admin não informou o preço.
   *
   * ⚠️ `null` e `0` são coisas diferentes e a tela mostra as duas diferentes:
   * zero é "não gastou", null é "não sei quanto gastou".
   */
  static costOf(row, inputTokens, outputTokens) {
    const pin = row?.price_in_mtok;
    const pout = row?.price_out_mtok;
    if (pin === null || pin === undefined || pout === null || pout === undefined) return null;
    const cost = (Number(inputTokens || 0) * Number(pin) + Number(outputTokens || 0) * Number(pout)) / 1e6;
    return Number(cost.toFixed(6));
  }

  static async usage(query = {}) {
    return runWithLogs(log, "usage", () => ({}), async () => {
      const days = Math.min(Math.max(Number(query.days) || 30, 1), 365);
      const rows = await AiJobStorage.usageSummary(pool, { days });
      return {
        days,
        rows: rows.map((r) => ({
          provider: r.provider,
          model: r.model,
          calls: Number(r.calls),
          input_tokens: Number(r.input_tokens),
          output_tokens: Number(r.output_tokens),
          // Sem preço informado em NENHUMA chamada o SUM vem null — e ele
          // continua null aqui, para a tela dizer "não apurado".
          cost_usd: r.cost_usd === null ? null : Number(r.cost_usd),
          calls_without_price: Number(r.calls_without_price),
        })),
      };
    });
  }

  static async jobs(query = {}) {
    return runWithLogs(log, "jobs", () => ({}), async () => {
      const rows = await AiJobStorage.listRecent(pool, {
        limit: Number(query.limit) || 50,
        status: query.status || null,
      });
      return { jobs: rows };
    });
  }
}

module.exports = AiSettingsService;
