// src/services/AcademyLinkService.js
// Vínculo aluno↔academia por CPF com verificação automática na Gym Provider
// API (decisão do Alex: sem aprovação manual). 1 CPF por user por academia
// (UNIQUEs da mig 176). CPF inexistente no provider → orienta procurar a
// recepção. Desvincular remove o membro (espelhos caem por CASCADE).
const pool = require("../databases");
const AcademyStorage = require("../storages/AcademyStorage");
const gymProvider = require("../integrations/gymProvider");
const secretBox = require("../utils/secretBox");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("academy-link");

function normalizeCpf(raw) {
  return String(raw || "").replace(/\D/g, "");
}

class AcademyLinkService {
  static async link(id_user, id_academy, cpfRaw) {
    return runWithLogs(log, "link", () => ({ id_user, id_academy }), async () => {
      const cpf = normalizeCpf(cpfRaw);
      if (cpf.length !== 11) return { error: "CPF inválido" };

      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy || !academy.is_active) return { error: "Academia não encontrada" };

      const takenByOther = await AcademyStorage.getMemberByCpf(pool, id_academy, cpf);
      if (takenByOther && takenByOther.id_user !== id_user) {
        return { error: "Este CPF já está vinculado a outra conta nesta academia. Procure a recepção.", statusCode: 409 };
      }

      const token = secretBox.open(academy.api_token_enc);
      const res = await gymProvider.getMember(academy.api_base_url, token, cpf);
      if (res.error) return { error: res.error };
      if (!res.data.found) {
        return { error: "CPF não encontrado no cadastro da academia. Procure a recepção para se matricular.", statusCode: 404 };
      }

      const ms = res.data.membership || null;
      const member = await AcademyStorage.upsertMember(pool, {
        id_academy,
        id_user,
        cpf,
        member_name: res.data.name || null,
        membership_status: ms ? ms.status : "pending",
        plan_name: ms ? ms.plan_name : null,
        enrolled_at: ms ? ms.enrolled_at : null,
        expires_at: ms ? ms.expires_at : null,
      });
      return {
        membership: {
          id_member: member.id_member,
          academy_slug: academy.slug,
          membership_status: member.membership_status,
          plan_name: member.plan_name,
          expires_at: member.expires_at,
        },
      };
    });
  }

  static async unlink(id_user, id_academy) {
    return runWithLogs(log, "unlink", () => ({ id_user, id_academy }), async () => {
      const removed = await AcademyStorage.deleteMember(pool, id_academy, id_user);
      if (!removed) return { error: "Vínculo não encontrado" };
      // Professor sem vínculo não faz sentido — cai junto.
      await AcademyStorage.removeProfessor(pool, id_academy, id_user);
      return { ok: true };
    });
  }

  static async myMemberships(id_user) {
    const rows = await AcademyStorage.listMembershipsByUser(pool, id_user);
    const memberships = [];
    for (const m of rows) {
      memberships.push({
        id_member: m.id_member,
        id_academy: m.id_academy,
        academy: { nome: m.academy_nome, slug: m.academy_slug, cidade: m.academy_cidade, avatar_url: m.academy_avatar_url },
        cpf: m.cpf,
        membership_status: m.membership_status,
        plan_name: m.plan_name,
        enrolled_at: m.enrolled_at,
        expires_at: m.expires_at,
        linked_at: m.linked_at,
        payments: await AcademyStorage.listPaymentsForMember(pool, m.id_member, 12),
        frequency_days_30d: await AcademyStorage.countDistinctDays(
          pool,
          m.id_member,
          new Date(Date.now() - 30 * 24 * 3600 * 1000)
        ),
      });
    }
    return { memberships };
  }
}

module.exports = AcademyLinkService;
