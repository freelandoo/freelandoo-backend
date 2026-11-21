// src/services/BankConnectionService.js
//
// BANCOS CONECTADOS NA CARTEIRA (mig 462) — Open Finance pela Malvo.
// Plano: docs/PLANO_CARTEIRA_OPEN_FINANCE.md.
//
// O fluxo:
//   1. a tela pede um connectToken (aqui: confere acesso e limites);
//   2. o widget da Malvo leva a pessoa ao banco; ela autoriza LÁ (a senha
//      nunca passa por nós nem pela Malvo);
//   3. a Malvo cria o Item. Chegamos a ele por DOIS caminhos, de propósito:
//      o `onSuccess` do widget (a tela chama `registerItem`) e o webhook
//      `item/created`. O widget é best-effort (a pessoa fecha a aba) e o
//      webhook pode não estar configurado ou atrasar: com os dois, um cobre o
//      outro, e o upsert pelo id do Item faz deles a mesma operação;
//   4. a sincronização lê contas, faturas e transações e grava a Vida
//      Financeira (`source='bank'`).
//
// ⚠️ DONO DO ITEM: a Malvo devolve o `clientUserId` que mandamos no token (o
// id_user). `registerItem` só aceita um Item cujo clientUserId é o de quem
// pede — sem isso, um id de Item alheio colado na requisição puxaria o
// extrato de outra pessoa para a minha Carteira.
//
// ⚠️ O QUE CUSTA (Malvo, R$ 4): "1 nova conexão no mês ou 1 item existente
// atualizado no mês". Daí as três travas: limite de bancos vivos, limite de
// conexões NOVAS por mês (reconectar conta) e auto-sync pausado para quem
// perdeu o acesso ou não abre a Carteira há 30 dias.
const pool = require("../databases");
const MalvoClient = require("../utils/malvoClient");
const { verifyMalvoSignature } = require("../utils/malvoSignature");
const { mapBankCategory } = require("../utils/bankCategoryMap");
const { parseStatement } = require("../utils/statementParse");
const BankConnectionStorage = require("../storages/BankConnectionStorage");
const BankAccessStorage = require("../storages/BankAccessStorage");
const { bankAccessSql } = require("../storages/BankAccessStorage");
const FeatureFlagService = require("./FeatureFlagService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("BankConnectionService");

const FLAG = "bancos_conectados";
const FIRST_IMPORT_DAYS = 120;
const RESYNC_OVERLAP_DAYS = 7;
const IDLE_PAUSE_DAYS = 30;
const GRACE_DAYS = 30;
const STATEMENT_MAX_CHARS = 3 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function realtime() {
  return require("../realtime/socket");
}

function isoDay(d) {
  return new Date(d).toISOString().slice(0, 10);
}

function daysAgo(n) {
  return isoDay(Date.now() - n * 86400000);
}

function publicConnection(c, accounts) {
  return {
    id_connection: c.id_connection,
    institution_name: c.institution_name,
    institution_logo: c.institution_logo,
    primary_color: c.primary_color,
    is_sandbox: !!c.is_sandbox,
    status: c.status,
    needs_action: !!c.needs_action,
    syncing: ["CREATING", "UPDATING", "LOGIN_IN_PROGRESS"].includes(String(c.status || "")),
    last_synced_at: c.last_synced_at,
    auto_sync_paused: !!c.auto_sync_paused,
    created_at: c.created_at,
    accounts: accounts
      .filter((a) => a.id_connection === c.id_connection)
      .map((a) => ({
        id_account: a.id_account,
        type: a.type,
        subtype: a.subtype,
        name: a.name,
        number_tail: a.number_tail,
        currency: a.currency,
        balance_cents: a.balance_cents == null ? null : Number(a.balance_cents),
        credit_limit_cents: a.credit_limit_cents == null ? null : Number(a.credit_limit_cents),
        bill_amount_cents: a.bill_amount_cents == null ? null : Number(a.bill_amount_cents),
        bill_due_date: a.bill_due_date,
        balance_at: a.balance_at,
      })),
  };
}

/** A fatura que importa para a tela: a próxima a vencer; sem ela, a mais recente. */
function pickCurrentBill(bills) {
  if (!Array.isArray(bills) || !bills.length) return null;
  const today = isoDay(Date.now());
  const sorted = [...bills].filter((b) => b?.dueDate).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  return sorted.find((b) => String(b.dueDate).slice(0, 10) >= today) || sorted[sorted.length - 1] || null;
}

/** Transação da Malvo → lançamento da Vida Financeira (ou null = não entra). */
function txToEntry(tx, id_bank_account) {
  if (!tx?.id || !tx.date) return null;
  if (tx.status && String(tx.status).toUpperCase() !== "POSTED") return null;
  const amount = Number(tx.amount);
  if (!Number.isFinite(amount) || amount === 0) return null;
  const cat = mapBankCategory(tx);
  if (cat.skip) return null;
  const type = String(tx.type || "").toUpperCase();
  const direction = type === "CREDIT" ? "in" : type === "DEBIT" ? "out" : amount < 0 ? "out" : "in";
  return {
    external_id: String(tx.id),
    direction,
    title: String(tx.description || tx.descriptionRaw || "Lançamento").replace(/\s+/g, " ").trim(),
    category: cat.label,
    amount_cents: Math.round(Math.abs(amount) * 100),
    date: String(tx.date).slice(0, 10),
    id_bank_account,
  };
}

class BankConnectionService {
  /** A flag está ligada OU a pessoa é admin (o admin testa antes de abrir). */
  static async _canSell(status) {
    if (status?.is_admin) return true;
    try {
      return await FeatureFlagService.isEnabled(FLAG);
    } catch {
      return false; // fail-closed: sem a flag, não vende nem conecta
    }
  }

  // ─── tela ─────────────────────────────────────────────────────────────────
  static async getMine(user) {
    return runWithLogs(log, "getMine", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
      const [status, settings, connections, accounts] = await Promise.all([
        BankAccessStorage.getStatus(pool, user.id_user),
        BankAccessStorage.getSettings(pool),
        BankConnectionStorage.listByUser(pool, user.id_user),
        BankConnectionStorage.listAccountsByUser(pool, user.id_user),
      ]);
      if (!status) return { error: "Usuário não encontrado", statusCode: 404 };
      const available = (await this._canSell(status)) && MalvoClient.isConfigured();

      // Abriu a Carteira: marca o uso e religa o que o sweeper pausou por
      // inatividade (best-effort; a tela não espera a Malvo).
      if (connections.length) {
        BankConnectionStorage.touchViewed(pool, user.id_user).catch(() => {});
        if (status.has_access && connections.some((c) => c.auto_sync_paused)) {
          this.resumeUser(user.id_user).catch((err) => log.warn("resume.fail", { message: err.message }));
        }
      }

      const connectsUsed = await BankConnectionStorage.countConnectsThisMonth(pool, user.id_user);
      return {
        available,
        sandbox: MalvoClient.isSandbox(),
        access: {
          has_access: !!status.has_access,
          by_admin: !!status.is_admin,
          paid_until: status.paid_until || null,
          renews: !!status.subscription_ref && status.subscription_status !== "canceled",
          subscription_status: status.subscription_status || null,
        },
        price: {
          monthly_cents: settings.monthly_cents,
          for_sale: available && settings.is_active && settings.monthly_cents > 0,
        },
        limits: {
          max_banks: settings.max_banks,
          connects_per_month: settings.connects_per_month,
          connects_used: connectsUsed,
        },
        connections: connections.map((c) => publicConnection(c, accounts)),
      };
    });
  }

  /** Token de 30 min para o widget. `id_connection` = reconectar aquele banco. */
  static async createConnectToken(user, body = {}) {
    return runWithLogs(log, "createConnectToken", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
      if (!MalvoClient.isConfigured()) return { error: "Conexão bancária indisponível no momento.", statusCode: 503 };
      const status = await BankAccessStorage.getStatus(pool, user.id_user);
      if (!(await this._canSell(status))) {
        return { error: "Conexão bancária indisponível no momento.", statusCode: 403, feature_disabled: FLAG };
      }
      if (!status?.has_access) {
        return { error: "Assine os bancos conectados para conectar um banco.", statusCode: 402 };
      }

      const settings = await BankAccessStorage.getSettings(pool);
      const used = await BankConnectionStorage.countConnectsThisMonth(pool, user.id_user);
      if (used >= settings.connects_per_month) {
        return {
          error: `Você já fez ${used} conexões este mês. Novas conexões voltam no dia 1º.`,
          statusCode: 429,
        };
      }

      let itemId = null;
      if (body.id_connection) {
        if (!UUID_RE.test(String(body.id_connection))) return { error: "Conexão inválida", statusCode: 400 };
        const conn = await BankConnectionStorage.getForUser(pool, user.id_user, body.id_connection);
        if (!conn) return { error: "Conexão não encontrada", statusCode: 404 };
        itemId = conn.malvo_item_id;
      } else {
        const live = await BankConnectionStorage.countLive(pool, user.id_user);
        if (live >= settings.max_banks) {
          return {
            error: `Seu plano conecta até ${settings.max_banks} bancos. Desconecte um para trocar.`,
            statusCode: 409,
          };
        }
      }

      const token = await MalvoClient.createConnectToken({
        clientUserId: user.id_user,
        itemId,
        webhookUrl: process.env.MALVO_WEBHOOK_URL || undefined,
      });
      if (!token) return { error: "Não foi possível abrir a conexão agora.", statusCode: 502 };
      return { connect_token: token, include_sandbox: MalvoClient.isSandbox(), update_item: itemId };
    });
  }

  /**
   * A tela avisa que o widget terminou (onSuccess). Confere o dono na Malvo,
   * registra e sincroniza. Idempotente com o webhook.
   */
  static async registerItem(user, body = {}) {
    return runWithLogs(log, "registerItem", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
      const itemId = String(body.item_id || "");
      if (!UUID_RE.test(itemId)) return { error: "Item inválido", statusCode: 400 };
      let item;
      try {
        item = await MalvoClient.getItem(itemId);
      } catch (e) {
        if (e.status === 404) return { error: "Conexão não encontrada", statusCode: 404 };
        throw e;
      }
      if (String(item?.clientUserId || "") !== String(user.id_user)) {
        log.warn("register.owner_mismatch", { id_user: user.id_user });
        return { error: "Conexão não encontrada", statusCode: 404 };
      }
      const conn = await this._adoptItem(user.id_user, item, { reconnect: body.reconnect === true });
      if (!conn) return { error: "Conexão não encontrada", statusCode: 404 };
      this._syncSoon(conn.malvo_item_id);
      return { ok: true, id_connection: conn.id_connection };
    });
  }

  /**
   * Grava o Item como conexão da pessoa. Conexão NOVA (ou reconexão pedida)
   * entra no registro mensal de cobradas. Item recém-criado já com outra
   * conexão viva acima do limite é recusado e revogado (o token foi emitido
   * com vaga, mas dois widgets abertos ao mesmo tempo furariam o limite).
   */
  static async _adoptItem(id_user, item, { reconnect = false } = {}) {
    const existing = await BankConnectionStorage.getByItemId(pool, String(item.id));
    if (existing && String(existing.id_user) !== String(id_user)) return null;
    if (existing?.deleted_at) return null; // desconectado: evento atrasado não ressuscita

    if (!existing) {
      const settings = await BankAccessStorage.getSettings(pool);
      const live = await BankConnectionStorage.countLive(pool, id_user);
      if (live >= settings.max_banks) {
        log.warn("adopt.over_limit", { id_user, live });
        await MalvoClient.deleteItem(String(item.id)).catch(() => {});
        return null;
      }
    }

    const row = await BankConnectionStorage.upsertFromItem(pool, id_user, item);
    if (row?.inserted) await BankConnectionStorage.recordConnect(pool, id_user, "connect");
    else if (reconnect) await BankConnectionStorage.recordConnect(pool, id_user, "reconnect");
    return row;
  }

  /** Reconectar sem widget (consentimento derrubado): força consentimento novo. */
  static async reconnect(user, id_connection) {
    return runWithLogs(log, "reconnect", () => ({ id_user: user?.id_user }), async () => {
      const r = await this.createConnectToken(user, { id_connection });
      return r;
    });
  }

  /** Desconectar: revoga na Malvo e apaga os dados do banco aqui. Sempre disponível. */
  static async disconnect(user, id_connection) {
    return runWithLogs(log, "disconnect", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
      if (!UUID_RE.test(String(id_connection || ""))) return { error: "Conexão inválida", statusCode: 400 };
      const conn = await BankConnectionStorage.getForUser(pool, user.id_user, id_connection);
      if (!conn) return { error: "Conexão não encontrada", statusCode: 404 };
      await this._teardown(conn, "user");
      return { ok: true };
    });
  }

  static async _teardown(conn, reason) {
    try {
      await MalvoClient.deleteItem(conn.malvo_item_id);
    } catch (err) {
      // A porta de saída não depende da Malvo responder: some daqui mesmo
      // assim (o consentimento ainda pode ser revogado no app do banco).
      log.warn("teardown.remote_fail", { id_connection: conn.id_connection, message: err.message });
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const removed = await BankConnectionStorage.deleteBankEntriesOfConnection(client, conn.id_user, conn.id_connection);
      await BankConnectionStorage.softDelete(client, conn.id_connection);
      await client.query("COMMIT");
      log.info("teardown.done", { id_connection: conn.id_connection, reason, removed });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
    this._emit(conn.id_user);
  }

  // ─── sincronização ────────────────────────────────────────────────────────
  static _syncSoon(malvoItemId) {
    setImmediate(() => {
      this.syncItem(malvoItemId).catch((err) =>
        log.warn("sync.fail", { message: err.message, status: err.status || null })
      );
    });
  }

  /** Lê o Item, as contas, as faturas e as transações; grava tudo. Idempotente. */
  static async syncItem(malvoItemId) {
    const conn = await BankConnectionStorage.getByItemId(pool, malvoItemId);
    if (!conn || conn.deleted_at) return { ignored: true };

    const item = await MalvoClient.getItem(malvoItemId);
    await BankConnectionStorage.upsertFromItem(pool, conn.id_user, item);
    const status = String(item?.status || "");
    if (status !== "UPDATED" && status !== "OUTDATED") {
      this._emit(conn.id_user);
      return { ok: true, waiting: status };
    }

    const accounts = await MalvoClient.listAccounts(malvoItemId);
    const dateFrom = conn.synced_through
      ? isoDay(new Date(conn.synced_through).getTime() - RESYNC_OVERLAP_DAYS * 86400000)
      : daysAgo(FIRST_IMPORT_DAYS);

    let inserted = 0;
    let lastDay = conn.synced_through ? isoDay(conn.synced_through) : null;
    for (const account of accounts) {
      let bill = null;
      if (String(account.type).toUpperCase() === "CREDIT") {
        bill = pickCurrentBill(await MalvoClient.listBills(account.id).catch(() => []));
      }
      const acc = await BankConnectionStorage.upsertAccount(pool, {
        id_connection: conn.id_connection,
        id_user: conn.id_user,
        account,
        bill,
      });
      if (!acc) continue;
      const txs = await MalvoClient.listTransactions(account.id, { dateFrom });
      const rows = txs.map((t) => txToEntry(t, acc.id_account)).filter(Boolean);
      inserted += await BankConnectionStorage.insertEntries(pool, conn.id_user, "bank", rows);
      for (const r of rows) if (!lastDay || r.date > lastDay) lastDay = r.date;
    }
    await BankConnectionStorage.markSynced(pool, conn.id_connection, { synced_through: lastDay || isoDay(Date.now()) });
    log.info("sync.done", { id_connection: conn.id_connection, accounts: accounts.length, inserted });
    this._emit(conn.id_user);
    return { ok: true, accounts: accounts.length, inserted };
  }

  static _emit(id_user) {
    try {
      realtime().emitToUser(id_user, "wallet:bank_synced", { at: Date.now() });
    } catch {
      /* socket fora do ar: a tela relê ao abrir */
    }
  }

  /** Voltou a ter acesso (pagou) ou abriu a Carteira: religa o auto-sync pausado. */
  static async resumeUser(id_user) {
    const status = await BankAccessStorage.getStatus(pool, id_user);
    if (!status?.has_access) return { skipped: true };
    const conns = await BankConnectionStorage.listByUser(pool, id_user);
    for (const c of conns.filter((x) => x.auto_sync_paused)) {
      try {
        await MalvoClient.setAutoSync(c.malvo_item_id, true);
        await BankConnectionStorage.setAutoSyncPaused(pool, c.id_connection, false);
        this._syncSoon(c.malvo_item_id);
      } catch (err) {
        log.warn("resume.item_fail", { id_connection: c.id_connection, message: err.message });
      }
    }
    return { ok: true };
  }

  // ─── webhook ──────────────────────────────────────────────────────────────
  /**
   * @param {Buffer} rawBody corpo cru
   * @param {object} headers
   * @returns {{ status: number, body: object }}
   */
  static async handleWebhook(rawBody, headers) {
    const secrets = [process.env.MALVO_WEBHOOK_SECRET, process.env.MALVO_WEBHOOK_SECRET_PREVIOUS]
      .map((s) => String(s || "").trim())
      .filter(Boolean);
    if (!secrets.length) {
      // Sem segredo não há como saber quem mandou: recusa (a Malvo reentrega
      // por ~3 h, e a varredura cobre o que se perder).
      log.error("webhook.no_secret", {});
      return { status: 503, body: { error: "MALVO_WEBHOOK_SECRET não configurado" } };
    }
    const check = verifyMalvoSignature(rawBody, headers["malvo-signature"], secrets);
    if (!check.ok) {
      log.warn("webhook.bad_signature", { reason: check.reason });
      return { status: 401, body: { error: "assinatura inválida" } };
    }

    let body;
    try {
      body = JSON.parse(Buffer.isBuffer(rawBody) ? rawBody.toString("utf8") : String(rawBody));
    } catch {
      return { status: 200, body: { received: true, ignored: "corpo inválido" } };
    }
    const event = String(body?.event || "");
    const eventId = body?.eventId;
    const itemId = body?.itemId ? String(body.itemId) : null;
    if (!eventId || !event) return { status: 200, body: { received: true, ignored: "sem evento" } };

    const fresh = await BankConnectionStorage.claimWebhookEvent(pool, { event_id: eventId, event, item_id: itemId });
    if (!fresh) return { status: 200, body: { received: true, duplicate: true } };

    // ⚠️ Só enfileira: processar aqui seguraria a resposta enquanto a Malvo
    // espera, e um timeout dela viraria reentrega.
    setImmediate(() => {
      this._processEvent(event, itemId, body).catch((err) =>
        log.warn("webhook.process_fail", { event, message: err.message })
      );
    });
    return { status: 200, body: { received: true } };
  }

  static async _processEvent(event, itemId, body) {
    if (!itemId) return;
    const conn = await BankConnectionStorage.getByItemId(pool, itemId);

    if (event === "item/deleted") {
      if (conn && !conn.deleted_at) await this._teardown(conn, "malvo_deleted");
      return;
    }

    if (!conn) {
      // O webhook chegou antes da tela: adota pelo clientUserId que NÓS
      // mandamos no token (é um id_user).
      const owner = String(body?.clientUserId || "");
      if (!UUID_RE.test(owner)) return;
      if (event !== "item/created" && event !== "item/updated") return;
      const item = await MalvoClient.getItem(itemId);
      if (String(item?.clientUserId || "") !== owner) return;
      const adopted = await this._adoptItem(owner, item);
      if (adopted) await this.syncItem(itemId);
      return;
    }
    if (conn.deleted_at) return;

    // Erros e esperas só atualizam o estado (a tela mostra "Reconectar");
    // o resto sincroniza. Webhook é gatilho; a verdade é o GET do Item.
    await this.syncItem(itemId);
  }

  // ─── varredura (index.js, a cada 6 h) ─────────────────────────────────────
  /**
   *   • perdeu o acesso → pausa o auto-sync (item sem sync no mês não custa);
   *   • sem acesso há mais de 30 dias → desconecta e apaga;
   *   • com acesso, sem abrir a Carteira há 30 dias → pausa (volta ao abrir);
   *   • com acesso e ativo, sem sincronizar há 26 h → relê (webhook perdido).
   */
  static async sweep() {
    if (!MalvoClient.isConfigured()) return { skipped: "not_configured" };
    const rows = await BankConnectionStorage.listForSweep(pool, bankAccessSql("c.id_user"));
    const out = { paused: 0, removed: 0, resynced: 0 };
    const now = Date.now();
    for (const r of rows) {
      try {
        if (!r.has_access) {
          const anchor = r.paid_until ? new Date(r.paid_until).getTime() : new Date(r.created_at).getTime();
          if (now - anchor > GRACE_DAYS * 86400000) {
            await this._teardown(r, "grace_over");
            out.removed++;
            continue;
          }
          if (!r.auto_sync_paused) {
            await MalvoClient.setAutoSync(r.malvo_item_id, false);
            await BankConnectionStorage.setAutoSyncPaused(pool, r.id_connection, true);
            out.paused++;
          }
          continue;
        }
        if (!r.auto_sync_paused && now - new Date(r.viewed_at).getTime() > IDLE_PAUSE_DAYS * 86400000) {
          await MalvoClient.setAutoSync(r.malvo_item_id, false);
          await BankConnectionStorage.setAutoSyncPaused(pool, r.id_connection, true);
          out.paused++;
          continue;
        }
        if (!r.auto_sync_paused && (!r.last_synced_at || now - new Date(r.last_synced_at).getTime() > 26 * 3600000)) {
          await this.syncItem(r.malvo_item_id);
          out.resynced++;
        }
      } catch (err) {
        log.warn("sweep.item_fail", { id_connection: r.id_connection, message: err.message });
      }
    }
    await BankConnectionStorage.pruneWebhookEvents(pool, 30).catch(() => {});
    return out;
  }

  // ─── extrato OFX/CSV (grátis, para todo mundo) ─────────────────────────────
  static async importStatement(user, body = {}) {
    return runWithLogs(log, "importStatement", () => ({ id_user: user?.id_user }), async () => {
      if (!user?.id_user) return { error: "Não autenticado", statusCode: 401 };
      const content = typeof body.content === "string" ? body.content : "";
      if (!content.trim()) return { error: "Arquivo vazio", statusCode: 400 };
      if (content.length > STATEMENT_MAX_CHARS) return { error: "Arquivo grande demais (máx. 3 MB)", statusCode: 413 };
      const { format, rows } = parseStatement(content);
      if (!rows.length) {
        return {
          error:
            format === "ofx"
              ? "Não encontrei lançamentos neste OFX."
              : "Não reconheci este CSV. Ele precisa de colunas de data, descrição e valor.",
          statusCode: 422,
        };
      }
      const entries = rows.map((r) => ({
        external_id: r.external_id,
        direction: r.amount_cents < 0 ? "out" : "in",
        title: r.title,
        category: null,
        amount_cents: Math.abs(r.amount_cents),
        date: r.date,
      }));
      const inserted = await BankConnectionStorage.insertEntries(pool, user.id_user, "ofx", entries);
      return { ok: true, format, found: rows.length, inserted, duplicates: rows.length - inserted };
    });
  }
}

module.exports = BankConnectionService;
module.exports._internals = { txToEntry, pickCurrentBill };
