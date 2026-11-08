// src/services/ClassificacaoService.js
//
// A6 CLASSIFICAÇÃO (migs 395/396): a prova adaptativa com nota 0–100, quem vê a
// nota e o perfil de personalidade (Big Five/IPIP-50).
//
// ⚠️ O GABARITO NUNCA SAI DAQUI. O cliente recebe um item por vez (enunciado e
// opções), responde, e só então recebe o próximo — escolhido pela TRI no servidor.
// A nota é calculada aqui; o aparelho não tem como dizer "tirei 100".
//
// ⚠️ PERSONALIDADE É PERFIL, NÃO DIAGNÓSTICO, e é dado sensível (LGPD art. 11):
// grava só com consentimento da versão atual, respostas seladas (secretBox), nunca
// aparece para outra pessoa, e apagar revoga o consentimento.

const crypto = require("crypto");
const pool = require("../databases/index");
const S = require("../storages/ClassificacaoStorage");
const Tri = require("../utils/classificacaoTri");
const Rules = require("../utils/classificacaoRules");
const { seal, open } = require("../utils/secretBox");
const { createLogger } = require("../utils/logger");

const log = createLogger("ClassificacaoService");

const LOCALES = ["pt-BR", "en", "es"];
const BANK_TTL_MS = 5 * 60 * 1000;
const bankCache = new Map(); // locale → { at, items }

function normLocale(l) {
  const s = String(l || "");
  if (LOCALES.includes(s)) return s;
  if (/^en/i.test(s)) return "en";
  if (/^es/i.test(s)) return "es";
  return "pt-BR";
}

/**
 * O banco do idioma. Idioma sem itens suficientes para uma prova inteira (com
 * folga para a escolha adaptativa) cai no português, que é o banco completo.
 */
async function bankFor(db, locale) {
  const hit = bankCache.get(locale);
  if (hit && Date.now() - hit.at < BANK_TTL_MS) return hit;
  let items = await S.listActiveItems(db, locale);
  let used = locale;
  if (items.length < Tri.TEST_LENGTH * 2 && locale !== "pt-BR") {
    items = await S.listActiveItems(db, "pt-BR");
    used = "pt-BR";
  }
  const entry = { at: Date.now(), items, locale: used };
  bankCache.set(locale, entry);
  return entry;
}

function rng() {
  return crypto.randomInt(0, 1 << 30) / (1 << 30);
}

/** O que o cliente vê de um item: sem gabarito e sem parâmetros. */
function itemView(it) {
  if (!it) return null;
  return {
    id: it.id,
    area: it.area,
    stem: it.stem,
    options: it.options,
    attribution: it.attribution || null,
  };
}

async function attemptView(db, at) {
  if (!at) return null;
  const item = at.status === "open" && at.pending_item ? await S.getItem(db, at.pending_item) : null;
  return {
    id_attempt: Number(at.id_attempt),
    status: at.status,
    started_at: at.started_at,
    expires_at: new Date(new Date(at.started_at).getTime() + Rules.ATTEMPT_MINUTES * 60000),
    answered: (at.answers || []).length,
    total: Tri.TEST_LENGTH,
    item: itemView(item),
    score: at.score == null ? null : Number(at.score),
    areas: at.areas || null,
  };
}

/** Fecha a prova: nota pela TRI e, se houve resposta, vira a nota que vale. */
async function finalize(db, at, status) {
  const answers = at.answers || [];
  if (!answers.length) {
    return S.closeAttempt(db, at.id_attempt, { status: "expired", theta: null, se: null, score: null, areas: null });
  }
  const { theta, se } = Tri.estimateTheta(answers);
  const score = Tri.scoreFromTheta(theta);
  const areas = Tri.areaSummary(answers);
  const closed = await S.closeAttempt(db, at.id_attempt, { status, theta, se, score, areas });
  await S.upsertResult(db, at.id_user, at.id_attempt, score, closed.finished_at);
  return closed;
}

/** Prova aberta que passou do tempo fecha com o que foi respondido (sem job). */
async function closeIfExpired(db, at) {
  if (at && at.status === "open" && Rules.attemptExpired(at.started_at)) {
    return finalize(db, at, "expired");
  }
  return at;
}

async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const out = await fn(c);
    await c.query("COMMIT");
    return out;
  } catch (err) {
    await c.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    c.release();
  }
}

function resultView(r) {
  if (!r) return null;
  return {
    score: Number(r.score),
    finished_at: r.finished_at,
    visibility: r.visibility,
    share_token: r.visibility === "private" ? null : r.share_token,
    areas: r.areas || null,
  };
}

function readPersonality(row) {
  if (!row) return null;
  try {
    const p = JSON.parse(open(row.payload_sealed));
    return { traits: p.traits, updated_at: row.updated_at };
  } catch (err) {
    log.warn("personality.unseal_failed", { message: err?.message });
    return null;
  }
}

module.exports = class ClassificacaoService {
  /** O estado da pessoa: nota, prova aberta, quando pode refazer, consentimento. */
  static async me(id_user) {
    return tx(async (c) => {
      await S.lockUser(c, id_user);
      const open = await closeIfExpired(c, await S.getOpenAttempt(c, id_user, { forUpdate: true }));
      const last = await S.lastStartedAt(c, id_user);
      const result = await S.getResult(c, id_user);
      const events = await S.consentEvents(c, id_user);
      const profile = await S.getPersonality(c, id_user);
      return {
        result: resultView(result),
        open: open && open.status === "open" ? await attemptView(c, open) : null,
        next_at: Rules.nextAttemptAt(last),
        retake_days: Rules.RETAKE_DAYS,
        test_length: Tri.TEST_LENGTH,
        minutes: Rules.ATTEMPT_MINUTES,
        personality: {
          consent: Rules.consentActive(events),
          consent_version: Rules.PERSONALITY_CONSENT_VERSION,
          has_profile: Boolean(profile),
        },
      };
    });
  }

  /** Começa (ou retoma) a prova. Uma a cada 30 dias, contando do início. */
  static async start(id_user, locale) {
    const loc = normLocale(locale);
    return tx(async (c) => {
      await S.lockUser(c, id_user);
      const open = await closeIfExpired(c, await S.getOpenAttempt(c, id_user, { forUpdate: true }));
      if (open && open.status === "open") return { attempt: await attemptView(c, open) };

      const next = Rules.nextAttemptAt(await S.lastStartedAt(c, id_user));
      if (next) {
        return { error: "Você já fez a prova. Ela pode ser refeita a cada 30 dias.", statusCode: 409 };
      }
      const bank = await bankFor(c, loc);
      const first = Tri.pickNextItem(bank.items, [], { rng });
      if (!first) return { error: "A prova não está disponível agora.", statusCode: 503 };
      const at = await S.createAttempt(c, id_user, bank.locale, first.id);
      log.info("attempt.start", { id_attempt: at.id_attempt, locale: bank.locale });
      return { attempt: await attemptView(c, at) };
    });
  }

  /** Responde o item da vez e recebe o próximo (ou a nota). */
  static async answer(id_user, id_attempt, body) {
    const itemId = Number(body?.item_id);
    const choice = Number(body?.choice);
    if (!Number.isInteger(itemId) || !Number.isInteger(choice)) {
      return { error: "Resposta inválida." };
    }
    return tx(async (c) => {
      await S.lockUser(c, id_user);
      let at = await S.getAttempt(c, id_user, id_attempt, { forUpdate: true });
      if (!at) return { error: "Prova não encontrada." };
      at = await closeIfExpired(c, at);
      if (at.status !== "open") {
        // repetir a última resposta depois de fechar devolve o resultado, sem erro
        return { attempt: await attemptView(c, at) };
      }
      const answers = at.answers || [];
      if (answers.some((r) => r.id === itemId)) return { attempt: await attemptView(c, at) };
      if (Number(at.pending_item) !== itemId) {
        return { error: "Essa não é a pergunta da vez.", statusCode: 409 };
      }
      const item = await S.getItem(c, itemId);
      if (!item || choice < 0 || choice >= item.options.length) return { error: "Resposta inválida." };

      answers.push({
        id: item.id,
        area: item.area,
        a: Number(item.a),
        b: Number(item.b),
        choice,
        correct: choice === Number(item.correct),
      });

      const bank = await bankFor(c, at.locale);
      const next = answers.length >= Tri.TEST_LENGTH ? null : Tri.pickNextItem(bank.items, answers, { rng });
      if (!next) {
        at = await S.saveProgress(c, at.id_attempt, answers, null);
        at = await finalize(c, at, "done");
        log.info("attempt.done", { id_attempt: at.id_attempt, score: at.score });
      } else {
        at = await S.saveProgress(c, at.id_attempt, answers, next.id);
      }
      return { attempt: await attemptView(c, at) };
    });
  }

  /** Quem vê a nota: private | link | profile. */
  static async setVisibility(id_user, visibility) {
    const v = Rules.normalizeVisibility(visibility);
    if (!v) return { error: "Opção inválida." };
    const r = await S.getResult(pool, id_user);
    if (!r) return { error: "Você ainda não tem nota.", statusCode: 404 };
    // Fechar (private) invalida o link; abrir de novo gera um link novo.
    const token = v === "private" ? null : r.share_token || crypto.randomBytes(12).toString("base64url");
    await S.setVisibility(pool, id_user, v, token);
    return { result: resultView(await S.getResult(pool, id_user)) };
  }

  /** Pelo link (visibilidade link ou profile). 404 igual para "não existe" e "fechada". */
  static async publicByToken(token) {
    const t = String(token || "");
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(t)) return { error: "Nota não encontrada." };
    const r = await S.publicByToken(pool, t);
    if (!r || !Rules.canShowScore(r.visibility, "link")) return { error: "Nota não encontrada." };
    return {
      score: Number(r.score),
      finished_at: r.finished_at,
      name: r.name,
      username: r.username || null,
      avatar: r.avatar || null,
    };
  }

  /** No perfil (só com visibility = profile). */
  static async publicByUsername(username) {
    const u = String(username || "").replace(/^@/, "").trim();
    if (!u) return { error: "Nota não encontrada." };
    const r = await S.publicByUsername(pool, u);
    if (!r || !Rules.canShowScore(r.visibility, "profile")) return { error: "Nota não encontrada." };
    return { score: Number(r.score), finished_at: r.finished_at };
  }

  // ── personalidade ────────────────────────────────────────────────────────
  static async personality(id_user) {
    const events = await S.consentEvents(pool, id_user);
    const row = await S.getPersonality(pool, id_user);
    return {
      consent: Rules.consentActive(events),
      consent_version: Rules.PERSONALITY_CONSENT_VERSION,
      profile: readPersonality(row),
    };
  }

  static async grantConsent(id_user, version) {
    if (version !== Rules.PERSONALITY_CONSENT_VERSION) {
      return { error: "O texto do consentimento mudou. Leia de novo.", statusCode: 409 };
    }
    const events = await S.consentEvents(pool, id_user);
    if (!Rules.consentActive(events)) {
      await S.addConsentEvent(pool, id_user, "grant", version);
    }
    return { consent: true, consent_version: version };
  }

  static async savePersonality(id_user, answers) {
    return tx(async (c) => {
      await S.lockUser(c, id_user);
      const events = await S.consentEvents(c, id_user);
      if (!Rules.consentActive(events)) {
        return { error: "É preciso dar o consentimento antes.", statusCode: 403 };
      }
      const scored = Rules.scorePersonality(answers);
      if (scored.error) return scored;
      const payload = seal(JSON.stringify({ answers, traits: scored.traits, at: new Date().toISOString() }));
      await S.upsertPersonality(c, id_user, payload, Rules.PERSONALITY_CONSENT_VERSION);
      return { profile: { traits: scored.traits, updated_at: new Date() } };
    });
  }

  /** Apaga o perfil e revoga o consentimento. Sem flag nenhuma: porta de saída nunca tranca. */
  static async deletePersonality(id_user) {
    return tx(async (c) => {
      await S.lockUser(c, id_user);
      const deleted = await S.deletePersonality(c, id_user);
      const events = await S.consentEvents(c, id_user);
      const last = events[events.length - 1];
      if (last && last.action === "grant") {
        await S.addConsentEvent(c, id_user, "revoke", last.version);
      }
      return { deleted, consent: false };
    });
  }
};

module.exports._test = { normLocale, itemView };
