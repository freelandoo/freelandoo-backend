// src/services/OnboardingService.js
// Fluxo pós-login para usuários que ainda não preencheram data de nascimento
// (caso típico: signup pelo Google, que não captura idade). Se a data
// indica menor de 18, exige código do responsável para vincular como
// conta supervisionada — tudo na mesma transação.

const pool = require("../databases");
const SupervisionService = require("./SupervisionService");
const SupervisionStorage = require("../storages/SupervisionStorage");
const { calculateAge } = require("../utils/validateSignup");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("OnboardingService");

class OnboardingService {
  /**
   * Submete os dados de onboarding (data de nascimento + opcional código
   * parental). Só funciona se o user ainda não tem data_nascimento setada
   * — chamada subsequente retorna erro.
   */
  static async submitBirthdate(user, body) {
    return runWithLogs(
      log,
      "submitBirthdate",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };

        const dataNascimento =
          typeof body?.data_nascimento === "string" &&
          body.data_nascimento.trim()
            ? body.data_nascimento.trim()
            : null;
        const responsibleCode =
          typeof body?.responsible_code === "string" &&
          body.responsible_code.trim()
            ? body.responsible_code.trim().toUpperCase()
            : null;

        if (!dataNascimento) {
          return { error: "Data de nascimento é obrigatória" };
        }
        const age = calculateAge(dataNascimento);
        if (age == null || age < 0 || age > 120) {
          return { error: "Data de nascimento inválida" };
        }

        const flags = await SupervisionStorage.getUserMinorFlags(
          pool,
          user.id_user,
        );
        if (flags?.data_nascimento) {
          return { error: "Onboarding já foi concluído" };
        }

        const isMinor = age < 18;
        if (isMinor && !responsibleCode) {
          return {
            error:
              "Conta menor de 18 anos exige código do responsável.",
            reason: "responsible_code_required",
          };
        }

        const client = await pool.connect();
        try {
          await client.query("BEGIN");
          await client.query(
            `UPDATE tb_user SET data_nascimento = $1, updated_at = NOW()
              WHERE id_user = $2`,
            [dataNascimento, user.id_user],
          );

          if (isMinor) {
            const consumed = await SupervisionService.consumeInviteForSignup(
              client,
              { code: responsibleCode, minorUserId: user.id_user },
            );
            if (consumed?.error) {
              await client.query("ROLLBACK");
              return { error: consumed.error };
            }
          }

          await client.query("COMMIT");
          return {
            ok: true,
            is_minor: isMinor,
            data_nascimento: dataNascimento,
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      },
    );
  }
}

module.exports = OnboardingService;
