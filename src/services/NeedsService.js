// src/services/NeedsService.js
//
// A2 (mig 338): as chaves da pessoa e a aba Empregos.
//
//   "Preciso de emprego"     → o perfil-conta aparece SOZINHO na aba Empregos
//                              das comunidades de que a pessoa participa (e nas
//                              sem membresia, que mostram o Brasil todo). Quem
//                              quer contratar chama pelo chat. Não existe vaga
//                              publicada (decisão do Alex).
//   "Preciso pagar dívidas"  → libera postar boletos (DebtService).
//
// Liga e desliga a qualquer momento. Desligar tira a pessoa da aba na hora, e
// os boletos dela somem do feed (o feed lê a chave no SELECT).

const pool = require("../databases");
const NeedsStorage = require("../storages/NeedsStorage");
const DebtStorage = require("../storages/DebtStorage");
const { vitrineContext } = require("../utils/vitrineCommunity");
const { participantScopeFor } = require("../utils/vitrine");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("NeedsService");

/** Idade mínima para "Preciso de emprego" (CLT: 16; aprendiz fica de fora). */
const JOB_MIN_AGE = 16;
const MAX_PITCH = 280;

function shape(row, helped) {
  if (!row) return null;
  return {
    needs_job: !!row.needs_job,
    needs_job_at: row.needs_job_at || null,
    job_pitch: row.job_pitch || "",
    needs_debt_help: !!row.needs_debt_help,
    has_cpf: !!row.has_cpf,
    adult: row.age != null && Number(row.age) >= 18,
    job_allowed: row.age != null && Number(row.age) >= JOB_MIN_AGE,
    helped: helped ?? 0,
  };
}

class NeedsService {
  static async mine(user) {
    const [row, helped] = await Promise.all([
      NeedsStorage.get(pool, user.id_user),
      DebtStorage.helpedCount(pool, user.id_user),
    ]);
    if (!row) return { error: "Conta não encontrada.", statusCode: 404 };
    return { needs: shape(row, helped) };
  }

  static async update(user, body) {
    return runWithLogs(log, "update", () => ({ id_user: user?.id_user }), async () => {
      const current = await NeedsStorage.get(pool, user.id_user);
      if (!current) return { error: "Conta não encontrada.", statusCode: 404 };

      const patch = {};
      if (typeof body?.needs_job === "boolean") {
        if (body.needs_job && !(current.age != null && Number(current.age) >= JOB_MIN_AGE)) {
          return {
            error: `"Preciso de emprego" é para quem tem ${JOB_MIN_AGE} anos ou mais. Confira sua data de nascimento.`,
            statusCode: 403,
            reason: "job_min_age",
          };
        }
        patch.needs_job = body.needs_job;
      }
      if (body?.job_pitch !== undefined) {
        const s = String(body.job_pitch ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_PITCH);
        patch.job_pitch = s || null;
      }
      if (typeof body?.needs_debt_help === "boolean") patch.needs_debt_help = body.needs_debt_help;

      await NeedsStorage.update(pool, user.id_user, patch);
      return NeedsService.mine(user);
    });
  }

  /** A aba Empregos de uma comunidade. */
  static async communityJobs(user, params, query) {
    return runWithLogs(log, "communityJobs", () => ({ id_user: user?.id_user }), async () => {
      const ctx = await vitrineContext(pool, user?.id_user, params.id_profile, { require: "member" });
      if (ctx.error) return ctx;
      const scope = participantScopeFor(ctx.community.kind);
      const people = await NeedsStorage.listJobSeekers(pool, {
        viewer: user.id_user,
        id_community: ctx.community.id_profile,
        participantsOnly: scope === "participants",
        limit: query?.limit,
        offset: query?.offset,
      });
      return { people, scope };
    });
  }
}

NeedsService.JOB_MIN_AGE = JOB_MIN_AGE;
module.exports = NeedsService;
