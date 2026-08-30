// src/services/CondoNoticeService.js
// Avisos do condomínio (mig 197): geral (mural) ou direcionado a uma unidade
// ou vaga. O aviso direcionado NOTIFICA o responsável pelo alvo — é o
// "chegar na caixa de mensagens" pedido no escopo, feito pelo canal que já
// existe na plataforma (tb_notification + sino + push socket).

const pool = require("../databases");
const CondoService = require("./CondoService");
const CondoStorage = require("../storages/CondoStorage");
const CondoResidenceStorage = require("../storages/CondoResidenceStorage");
const CondoNoticeStorage = require("../storages/CondoNoticeStorage");
const NotificationService = require("./NotificationService");
const CondoRules = require("../utils/condoRules");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CondoNoticeService");

const MAX_BODY = 2000;
const MAX_TITLE = 120;

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

class CondoNoticeService {
  static async list(user, params, query) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo, scope: query?.scope }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const notices = await CondoNoticeStorage.list(pool, params.id_condo, {
          id_user: user.id_user,
          is_admin: ctx.isAdmin,
          scope: query?.scope || null,
          limit: query?.limit,
          offset: query?.offset,
        });
        const unread = await CondoNoticeStorage.countUnreadForUser(
          pool,
          params.id_condo,
          user.id_user
        );
        return { notices, unread_count: unread };
      }
    );
  }

  static async create(user, params, body) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo, scope: body?.scope }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const text = clean(body?.body, MAX_BODY);
        if (!text) return { error: "Escreva o aviso.", statusCode: 400 };
        const title = clean(body?.title, MAX_TITLE);

        const scope = ["general", "unit", "parking"].includes(body?.scope)
          ? body.scope
          : "general";

        let id_unit = null;
        let id_spot = null;
        let target = null;

        if (scope === "unit") {
          // A unidade vem da árvore nova (migs 205/207). E o destinatário
          // deixou de ser UM titular: o apartamento tem N moradores, e todos
          // precisam receber o aviso — avisar só o primeiro seria escolher
          // arbitrariamente quem fica sabendo que o cano estourou.
          id_unit = body?.id_unit ? Number(body.id_unit) : null;
          if (!id_unit) return { error: "Escolha o apartamento de destino.", statusCode: 400 };
          const unit = await CondoResidenceStorage.getUnitInCondo(
            pool,
            params.id_condo,
            id_unit
          );
          if (!unit) return { error: "Apartamento não encontrado", statusCode: 404 };
          const residents = await CondoResidenceStorage.listUnitResidents(pool, id_unit);
          target = {
            user_ids: residents
              .filter((r) => r.status === "recognized")
              .map((r) => r.id_user),
            label: CondoRules.unitLabel({
              block_name: unit.block_name,
              number: unit.label,
            }),
          };
        } else if (scope === "parking") {
          id_spot = body?.id_spot ? Number(body.id_spot) : null;
          if (!id_spot) return { error: "Escolha a vaga de destino.", statusCode: 400 };
          const spot = await CondoStorage.getSpot(pool, params.id_condo, id_spot);
          if (!spot) return { error: "Vaga não encontrada", statusCode: 404 };
          target = {
            user_ids: spot.id_holder_user ? [spot.id_holder_user] : [],
            label: `Vaga ${spot.code}`,
          };
        }

        const notice = await CondoNoticeStorage.create(pool, {
          id_condo: params.id_condo,
          id_author: user.id_user,
          scope,
          id_unit,
          id_spot,
          title,
          body: text,
        });

        // Direcionado: TODOS os moradores do alvo recebem. Unidade/vaga vazia
        // não notifica ninguém (o aviso fica registrado para a administração).
        for (const recipient of target?.user_ids || []) {
          NotificationService.notifyCondoNotice({
            recipient_user_id: recipient,
            author_user_id: user.id_user,
            id_condo: params.id_condo,
            id_notice: notice.id_notice,
            target_label: target.label,
            preview: title || text,
            condo_name: ctx.condo.display_name,
          }).catch(() => {});
        }

        return {
          notice,
          delivered_to_holder: (target?.user_ids || []).length > 0,
          delivered_count: (target?.user_ids || []).length,
          target_label: target?.label ?? null,
        };
      }
    );
  }

  static async markRead(user, params) {
    return runWithLogs(
      log,
      "markRead",
      () => ({ id_user: user?.id_user, id_notice: params?.id_notice }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "member",
        });
        if (ctx.error) return ctx;
        await CondoNoticeStorage.markRead(pool, params.id_notice, user.id_user);
        return { ok: true };
      }
    );
  }

  // Autor apaga o próprio aviso; administração apaga qualquer um.
  static async remove(user, params) {
    return runWithLogs(
      log,
      "remove",
      () => ({ id_user: user?.id_user, id_notice: params?.id_notice }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "member",
        });
        if (ctx.error) return ctx;

        const notice = await CondoNoticeStorage.getById(pool, params.id_condo, params.id_notice);
        if (!notice) return { error: "Aviso não encontrado", statusCode: 404 };
        if (!ctx.isAdmin && String(notice.id_author) !== String(user.id_user)) {
          return { error: "Você não pode apagar este aviso.", statusCode: 403 };
        }
        const ok = await CondoNoticeStorage.softDelete(pool, params.id_condo, params.id_notice);
        return { ok };
      }
    );
  }

  static async setPinned(user, params, body) {
    return runWithLogs(
      log,
      "setPinned",
      () => ({ id_user: user?.id_user, id_notice: params?.id_notice }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "admin",
        });
        if (ctx.error) return ctx;
        const row = await CondoNoticeStorage.setPinned(
          pool,
          params.id_condo,
          params.id_notice,
          !!body?.is_pinned
        );
        if (!row) return { error: "Aviso não encontrado", statusCode: 404 };
        return row;
      }
    );
  }
}

module.exports = CondoNoticeService;
