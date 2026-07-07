// src/services/AcademySyncService.js
// Sweeper de sincronização das academias (pull, ~10min): puxa access-events e
// payments da Gym Provider API pelos cursores persistidos em tb_academy,
// associa por CPF→membro (CPF não vinculado é ignorado em silêncio) e faz
// upsert idempotente (UNIQUE id_academy+external_id). Também refresca o status
// de matrícula dos membros 1x/dia. Erro marca sync_status e NUNCA derruba o
// boot; auth 401/403 marca 'auth_error' pro dono corrigir o token.
const pool = require("../databases");
const AcademyStorage = require("../storages/AcademyStorage");
const gymProvider = require("../integrations/gymProvider");
const secretBox = require("../utils/secretBox");
const { createLogger } = require("../utils/logger");

const log = createLogger("academy-sync");
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;
const PAGE_LIMIT = 200;
const MAX_PAGES_PER_TICK = 10;

let sweeperTimer = null;

class AcademySyncService {
  static async syncAcademy(academy) {
    let token;
    try {
      token = secretBox.open(academy.api_token_enc);
    } catch (err) {
      await AcademyStorage.setSync(pool, academy.id_academy, { status: "error", error: `token ilegível: ${err.message}` });
      return;
    }

    const cpfMap = await AcademyStorage.listCpfMapForAcademy(pool, academy.id_academy);

    // ── eventos de catraca ──
    let eventsCursor = academy.events_cursor;
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const res = await gymProvider.getAccessEvents(academy.api_base_url, token, eventsCursor, PAGE_LIMIT);
      if (res.error) {
        await AcademyStorage.setSync(pool, academy.id_academy, {
          status: res.auth_error ? "auth_error" : "error",
          error: res.error,
          events_cursor: eventsCursor,
        });
        return;
      }
      const events = Array.isArray(res.data.events) ? res.data.events : [];
      const rows = [];
      for (const e of events) {
        const id_member = cpfMap[String(e.cpf || "").replace(/\D/g, "")];
        if (!id_member || !e.id || !e.at) continue;
        rows.push({ id_member, external_id: String(e.id), occurred_at: e.at });
      }
      if (rows.length) await AcademyStorage.insertAccessEvents(pool, academy.id_academy, rows);
      const next = res.data.next_cursor || null;
      const advanced = next && next !== eventsCursor;
      if (advanced) eventsCursor = next;
      if (!advanced || events.length < PAGE_LIMIT) break;
    }

    // ── pagamentos ──
    let paymentsCursor = academy.payments_cursor;
    for (let page = 0; page < MAX_PAGES_PER_TICK; page++) {
      const res = await gymProvider.getPayments(academy.api_base_url, token, paymentsCursor, PAGE_LIMIT);
      if (res.error) {
        await AcademyStorage.setSync(pool, academy.id_academy, {
          status: res.auth_error ? "auth_error" : "error",
          error: res.error,
          events_cursor: eventsCursor,
          payments_cursor: paymentsCursor,
        });
        return;
      }
      const payments = Array.isArray(res.data.payments) ? res.data.payments : [];
      const rows = [];
      for (const p of payments) {
        const id_member = cpfMap[String(p.cpf || "").replace(/\D/g, "")];
        if (!id_member || !p.id) continue;
        const status = ["pending", "paid", "overdue"].includes(p.status) ? p.status : "pending";
        rows.push({
          id_member,
          external_id: String(p.id),
          amount_cents: Math.max(0, Math.round(Number(p.amount_cents) || 0)),
          due_date: p.due_date || null,
          status,
          paid_at: p.paid_at || null,
        });
      }
      if (rows.length) await AcademyStorage.upsertPayments(pool, academy.id_academy, rows);
      const next = res.data.next_cursor || null;
      const advanced = next && next !== paymentsCursor;
      if (advanced) paymentsCursor = next;
      if (!advanced || payments.length < PAGE_LIMIT) break;
    }

    // ── refresh diário do status de matrícula ──
    const due = await AcademyStorage.listMembersDueRefresh(pool, academy.id_academy, 24, 50);
    for (const member of due) {
      const res = await gymProvider.getMember(academy.api_base_url, token, member.cpf);
      if (res.error) break; // provider caiu no meio — tenta no próximo tick
      if (!res.data.found) {
        // sumiu do cadastro da academia: marca cancelado (mantém histórico)
        await AcademyStorage.refreshMemberStatus(pool, member.id_member, {
          membership_status: "canceled",
          plan_name: member.plan_name,
          enrolled_at: member.enrolled_at,
          expires_at: member.expires_at,
        });
        continue;
      }
      const ms = res.data.membership;
      await AcademyStorage.refreshMemberStatus(pool, member.id_member, {
        member_name: res.data.name || null,
        membership_status: ms ? ms.status : "pending",
        plan_name: ms ? ms.plan_name : null,
        enrolled_at: ms ? ms.enrolled_at : null,
        expires_at: ms ? ms.expires_at : null,
      });
    }

    await AcademyStorage.setSync(pool, academy.id_academy, {
      status: "ok",
      error: null,
      events_cursor: eventsCursor,
      payments_cursor: paymentsCursor,
    });
  }

  // Sync imediato de uma academia (botão do dono / pós-vínculo).
  static async syncNow(id_academy) {
    const academy = await AcademyStorage.getById(pool, id_academy);
    if (!academy) return { error: "Academia não encontrada" };
    try {
      await this.syncAcademy(academy);
      const fresh = await AcademyStorage.getById(pool, id_academy);
      return { sync_status: fresh.sync_status, sync_error: fresh.sync_error, last_sync_at: fresh.last_sync_at };
    } catch (err) {
      log.error("syncNow.fail", { id_academy, error: err.message });
      return { error: "Falha na sincronização" };
    }
  }

  static startSweeper() {
    if (sweeperTimer) return;
    sweeperTimer = setInterval(async () => {
      try {
        const academies = await AcademyStorage.listForSync(pool, 10);
        for (const academy of academies) {
          try {
            await this.syncAcademy(academy);
          } catch (err) {
            log.error("sweep.academy.fail", { id_academy: academy.id_academy, error: err.message });
            await AcademyStorage.setSync(pool, academy.id_academy, { status: "error", error: err.message }).catch(() => {});
          }
        }
      } catch (err) {
        log.error("sweep.fail", { error: err.message });
      }
    }, SWEEP_INTERVAL_MS);
    if (sweeperTimer.unref) sweeperTimer.unref();
    log.info("sweeper.started", { interval_ms: SWEEP_INTERVAL_MS });
  }
}

module.exports = AcademySyncService;
