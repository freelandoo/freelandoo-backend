// src/services/CondoPollService.js
// Enquetes do condomínio (mig 199).
//
// NÃO confundir com a votação de liderança da comunidade (CommunityLeadership
// Service, mig 156): aquela troca o líder e é aberta pelo sistema quando a
// comunidade estagna. Esta é consulta entre moradores, aberta por eles, e não
// muda papel nenhum. As duas convivem: um condomínio não entra na votação de
// liderança porque nem participa do ranking (mig 196).

const pool = require("../databases");
const CondoService = require("./CondoService");
const CondoPollStorage = require("../storages/CondoPollStorage");
const NotificationService = require("./NotificationService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("CondoPollService");

const MAX_QUESTION = 280;
const MAX_DESCRIPTION = 1000;
const MAX_OPTION = 120;
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 10;

function clean(value, max) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (!s) return null;
  return s.slice(0, max);
}

class CondoPollService {
  static async list(user, params, query) {
    return runWithLogs(
      log,
      "list",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const polls = await CondoPollStorage.listForCondo(
          pool,
          params.id_condo,
          user.id_user,
          { status: query?.status || "all" }
        );
        return { polls, can_create: ctx.isAdmin || ctx.resident.confirmed };
      }
    );
  }

  static async create(user, params, body) {
    return runWithLogs(
      log,
      "create",
      () => ({ id_user: user?.id_user, id_condo: params?.id_condo }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "resident",
        });
        if (ctx.error) return ctx;

        const question = clean(body?.question, MAX_QUESTION);
        if (!question) return { error: "Escreva a pergunta da enquete.", statusCode: 400 };

        const options = Array.isArray(body?.options)
          ? body.options.map((o) => clean(o, MAX_OPTION)).filter(Boolean).slice(0, MAX_OPTIONS)
          : [];
        if (options.length < MIN_OPTIONS) {
          return { error: "Dê pelo menos duas opções de resposta.", statusCode: 400 };
        }

        let closes_at = null;
        if (body?.closes_at) {
          const d = new Date(body.closes_at);
          if (Number.isNaN(d.getTime())) {
            return { error: "Prazo inválido.", statusCode: 400 };
          }
          if (d.getTime() <= Date.now()) {
            return { error: "O prazo precisa ser no futuro.", statusCode: 400 };
          }
          closes_at = d.toISOString();
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          const poll = await CondoPollStorage.create(client, {
            id_condo: params.id_condo,
            id_author: user.id_user,
            question,
            description: clean(body?.description, MAX_DESCRIPTION),
            closes_at,
          });
          const created = await CondoPollStorage.addOptions(client, poll.id_poll, options);
          await client.query("COMMIT");

          // O modal já aparece no próximo acesso; a notificação é o rastro no
          // sino para quem não abrir o condomínio tão cedo.
          const residents = await CondoPollStorage.listResidentUserIds(pool, params.id_condo);
          for (const resident of residents) {
            NotificationService.notifyCondoPollOpened({
              recipient_user_id: resident,
              author_user_id: user.id_user,
              id_condo: params.id_condo,
              id_poll: poll.id_poll,
              question,
              condo_name: ctx.condo.display_name,
            }).catch(() => {});
          }

          return { poll: { ...poll, options: created } };
        } catch (err) {
          try {
            await client.query("ROLLBACK");
          } catch {
            /* noop */
          }
          log.error("create.fail", { id_user: user?.id_user, error: err.message });
          return { error: "Não foi possível criar a enquete." };
        } finally {
          client.release();
        }
      }
    );
  }

  // Só morador confirmado vota, e só uma vez (PK da tb_condo_poll_vote).
  static async vote(user, params, body) {
    return runWithLogs(
      log,
      "vote",
      () => ({ id_user: user?.id_user, id_poll: params?.id_poll }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "resident",
        });
        if (ctx.error) return ctx;

        // Administração que não mora não vota: o voto é do morador.
        if (!ctx.resident.confirmed) {
          return {
            error: "Só moradores confirmados podem votar.",
            statusCode: 403,
            needs_claim: true,
          };
        }

        const poll = await CondoPollStorage.getById(pool, params.id_condo, params.id_poll);
        if (!poll) return { error: "Enquete não encontrada", statusCode: 404 };
        if (!poll.is_open) return { error: "Esta enquete já foi encerrada.", statusCode: 409 };

        const id_option = body?.id_option ? Number(body.id_option) : null;
        if (!id_option) return { error: "Escolha uma opção.", statusCode: 400 };
        const option = await CondoPollStorage.getOption(pool, params.id_poll, id_option);
        if (!option) return { error: "Opção inválida.", statusCode: 400 };

        const vote = await CondoPollStorage.vote(pool, {
          id_poll: params.id_poll,
          id_user: user.id_user,
          id_option,
        });
        if (!vote) return { ok: true, already_voted: true };
        return { ok: true, vote };
      }
    );
  }

  static async close(user, params) {
    return runWithLogs(
      log,
      "close",
      () => ({ id_user: user?.id_user, id_poll: params?.id_poll }),
      async () => {
        const ctx = await CondoService._context(pool, user?.id_user, params?.id_condo, {
          require: "member",
        });
        if (ctx.error) return ctx;

        const poll = await CondoPollStorage.getById(pool, params.id_condo, params.id_poll);
        if (!poll) return { error: "Enquete não encontrada", statusCode: 404 };
        if (!ctx.isAdmin && String(poll.id_author) !== String(user.id_user)) {
          return { error: "Você não pode encerrar esta enquete.", statusCode: 403 };
        }
        const row = await CondoPollStorage.close(pool, params.id_condo, params.id_poll);
        return row || { ok: true, already_closed: true };
      }
    );
  }

  // Fila do modal global: enquetes abertas e não respondidas, de todos os
  // condomínios do morador. Sem paginação — no máximo 10 por chamada.
  static async listPending(user) {
    return runWithLogs(
      log,
      "listPending",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Usuário não autenticado" };
        const polls = await CondoPollStorage.listPendingForUser(pool, user.id_user);
        return { polls };
      }
    );
  }
}

module.exports = CondoPollService;
