// src/services/AcademyService.js
// Academia (Fitness & Academias, fase 1): cadastro self-service pelo dono com
// URL+token da Gym Provider API, busca pública, professores. Regras:
// - token cifrado com secretBox (precisa ser recuperável p/ chamadas outbound);
// - api_base_url validada anti-SSRF (reusa validateWebhookUrl);
// - professor precisa ser membro vinculado; só o dono promove/remove.
const pool = require("../databases");
const AcademyStorage = require("../storages/AcademyStorage");
const gymProvider = require("../integrations/gymProvider");
const secretBox = require("../utils/secretBox");
const { validateWebhookUrl } = require("../utils/webhookUrl");
const { slugify } = require("../utils/slug");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("academy-service");

function publicAcademy(a, extra = {}) {
  return {
    id_academy: a.id_academy,
    nome: a.nome,
    slug: a.slug,
    descricao: a.descricao,
    cidade: a.cidade,
    avatar_url: a.avatar_url,
    cover_url: a.cover_url,
    created_at: a.created_at,
    member_count: a.member_count,
    ...extra,
  };
}

function ownerAcademy(a) {
  return {
    ...publicAcademy(a),
    api_base_url: a.api_base_url,
    sync_status: a.sync_status,
    sync_error: a.sync_error,
    last_sync_at: a.last_sync_at,
    is_active: a.is_active,
  };
}

class AcademyService {
  static async create(id_user, { nome, descricao, cidade, api_base_url, api_token }) {
    return runWithLogs(log, "academy.create", () => ({ id_user }), async () => {
      if (!nome || String(nome).trim().length < 2) return { error: "Nome da academia é obrigatório" };
      if (!api_base_url || !api_token) return { error: "URL e token da API da academia são obrigatórios" };
      const urlCheck = await validateWebhookUrl(api_base_url);
      if (urlCheck.error) return { error: `URL da API inválida: ${urlCheck.error}` };

      let slug = slugify(nome);
      if (!slug) return { error: "Nome da academia inválido" };
      if (await AcademyStorage.slugExists(pool, slug)) {
        slug = `${slug}-${Math.random().toString(36).slice(2, 6)}`;
      }

      const academy = await AcademyStorage.createAcademy(pool, {
        id_owner_user: id_user,
        nome: String(nome).trim(),
        slug,
        descricao,
        cidade,
        api_base_url: String(api_base_url).replace(/\/+$/, ""),
        api_token_enc: secretBox.seal(api_token),
      });
      return { academy: ownerAcademy(academy) };
    });
  }

  static async update(id_user, id_academy, patch) {
    return runWithLogs(log, "academy.update", () => ({ id_user, id_academy }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy) return { error: "Academia não encontrada" };
      if (academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };

      const upd = {};
      if (patch.nome !== undefined) upd.nome = String(patch.nome).trim();
      if (patch.descricao !== undefined) upd.descricao = patch.descricao;
      if (patch.cidade !== undefined) upd.cidade = patch.cidade;
      if (patch.is_active !== undefined) upd.is_active = !!patch.is_active;
      if (patch.api_base_url) {
        const urlCheck = await validateWebhookUrl(patch.api_base_url);
        if (urlCheck.error) return { error: `URL da API inválida: ${urlCheck.error}` };
        upd.api_base_url = String(patch.api_base_url).replace(/\/+$/, "");
      }
      if (patch.api_token) upd.api_token_enc = secretBox.seal(patch.api_token);

      const updated = await AcademyStorage.updateAcademy(pool, id_academy, upd);
      return { academy: ownerAcademy(updated) };
    });
  }

  static async search({ q, city }) {
    const academies = await AcademyStorage.search(pool, { q, city });
    return { academies: academies.map((a) => publicAcademy(a)) };
  }

  static async getBySlug(slug, viewerId) {
    return runWithLogs(log, "academy.get", () => ({ slug }), async () => {
      const academy = await AcademyStorage.getBySlug(pool, slug);
      if (!academy || (!academy.is_active && academy.id_owner_user !== viewerId)) {
        return { error: "Academia não encontrada" };
      }
      const is_owner = viewerId ? academy.id_owner_user === viewerId : false;
      const is_professor = viewerId ? await AcademyStorage.isProfessor(pool, academy.id_academy, viewerId) : false;
      const my_membership = viewerId ? await AcademyStorage.getMember(pool, academy.id_academy, viewerId) : null;
      const professors = await AcademyStorage.listProfessors(pool, academy.id_academy);
      const base = is_owner ? ownerAcademy(academy) : publicAcademy(academy);
      const members = await AcademyStorage.listMembers(pool, academy.id_academy);
      return {
        academy: {
          ...base,
          member_count: members.length,
          is_owner,
          is_professor,
          professors: professors.map((p) => ({ id_user: p.id_user, username: p.username, nome: p.user_nome })),
          my_membership: my_membership
            ? {
                membership_status: my_membership.membership_status,
                plan_name: my_membership.plan_name,
                expires_at: my_membership.expires_at,
                linked_at: my_membership.linked_at,
              }
            : null,
        },
      };
    });
  }

  static async listMine(id_user) {
    const academies = await AcademyStorage.listByOwner(pool, id_user);
    return { academies: academies.map((a) => ownerAcademy(a)) };
  }

  static async testConnection(id_user, id_academy) {
    return runWithLogs(log, "academy.test", () => ({ id_academy }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy) return { error: "Academia não encontrada" };
      if (academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };
      const token = secretBox.open(academy.api_token_enc);
      // CPF sonda: provider deve responder 200 { found:false } — prova URL+token.
      const res = await gymProvider.getMember(academy.api_base_url, token, "00000000000");
      if (res.error) return { error: res.error };
      return { ok: true, provider_response: { found: !!res.data.found } };
    });
  }

  // ─── Professores ───────────────────────────────────────────────────────────
  static async addProfessor(id_user, id_academy, target_id_user) {
    return runWithLogs(log, "academy.professor.add", () => ({ id_academy, target_id_user }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy) return { error: "Academia não encontrada" };
      if (academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };
      const member = await AcademyStorage.getMember(pool, id_academy, target_id_user);
      if (!member) return { error: "O professor precisa estar vinculado à academia (CPF) antes de ser promovido" };
      await AcademyStorage.addProfessor(pool, id_academy, target_id_user, id_user);
      return { professors: (await AcademyStorage.listProfessors(pool, id_academy)).map((p) => ({ id_user: p.id_user, username: p.username, nome: p.user_nome })) };
    });
  }

  static async removeProfessor(id_user, id_academy, target_id_user) {
    return runWithLogs(log, "academy.professor.remove", () => ({ id_academy, target_id_user }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy) return { error: "Academia não encontrada" };
      if (academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };
      await AcademyStorage.removeProfessor(pool, id_academy, target_id_user);
      return { professors: (await AcademyStorage.listProfessors(pool, id_academy)).map((p) => ({ id_user: p.id_user, username: p.username, nome: p.user_nome })) };
    });
  }

  static async listMembers(id_user, id_academy) {
    return runWithLogs(log, "academy.members", () => ({ id_academy }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy) return { error: "Academia não encontrada" };
      const allowed = academy.id_owner_user === id_user || (await AcademyStorage.isProfessor(pool, id_academy, id_user));
      if (!allowed) return { error: "Sem permissão", statusCode: 403 };
      const members = await AcademyStorage.listMembers(pool, id_academy);
      return {
        members: members.map((m) => ({
          id_member: m.id_member,
          id_user: m.id_user,
          username: m.username,
          nome: m.user_nome,
          member_name: m.member_name,
          membership_status: m.membership_status,
          plan_name: m.plan_name,
          expires_at: m.expires_at,
          linked_at: m.linked_at,
          is_professor: m.is_professor,
        })),
      };
    });
  }

  // Guard reusável (fases 2-4): dono ou professor da academia.
  static async assertStaff(id_academy, id_user) {
    const academy = await AcademyStorage.getById(pool, id_academy);
    if (!academy) return { error: "Academia não encontrada" };
    const is_owner = academy.id_owner_user === id_user;
    const is_professor = is_owner ? false : await AcademyStorage.isProfessor(pool, id_academy, id_user);
    if (!is_owner && !is_professor) return { error: "Sem permissão", statusCode: 403 };
    return { academy, is_owner, is_professor };
  }
}

module.exports = AcademyService;
