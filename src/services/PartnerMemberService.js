// src/services/PartnerMemberService.js
// API de parceiro de academia (/partner/v1, mig 296) — o software da academia
// (primeiro: o Coliseu) cria ou vincula a conta do aluno na Freelandoo.
//
// Regras que a API aplica sozinha (não confia no parceiro):
// - CPF com dígito verificador; idade ≥ 18 pela data de nascimento; e-mail
//   único (decisões Q2/Q5/Q17 da spec do Coliseu);
// - idempotente por CPF: CPF que já tem conta só VINCULA (nunca cria a segunda
//   conta, nunca mexe em senha). A corrida de duas chamadas com o mesmo CPF é
//   serializada por advisory lock na transação;
// - a conta nova nasce sem senha, inativa e 'aguardando_aceite' (invisível no
//   resto da plataforma até o aceite dos termos) e recebe um link de primeiro
//   acesso de 7 dias.
//
// Respostas no formato do contrato: { status, body } com `erro` de código
// estável — o parceiro decide o que mostrar por esse código.
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const PartnerStorage = require("../storages/PartnerStorage");
const academyPhoto = require("../integrations/r2/academyPhoto");
const normalizeEmail = require("../utils/normalizeEmail");
const { normalizeCPF } = require("../utils/documents");
const { validateEmailFormat, calculateAge } = require("../utils/validateSignup");
const { usernameBaseFromName, usernameCandidate } = require("../utils/academyUsername");
const { venceEm } = require("../utils/workoutValidity");
const WorkoutStorage = require("../storages/WorkoutStorage");
const { montarFila } = require("../utils/trainingQueue");
const realtime = require("../realtime/socket");
const {
  sha256Hex,
  generateFirstAccessToken,
  generatePartnerKey,
  FIRST_ACCESS_TTL_DAYS,
} = require("../utils/partnerKey");
const { ESTADO_AGUARDANDO, ESTADO_ATIVA } = require("../utils/academyOnboarding");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("partner-member-service");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const LIST_DEFAULT = 200;
const LIST_MAX = 500;

function fail(status, erro) {
  return { status, body: { erro } };
}

function estadoDe(state) {
  return state === ESTADO_AGUARDANDO ? ESTADO_AGUARDANDO : ESTADO_ATIVA;
}

function linkPrimeiroAcesso(academy, token) {
  const base = String(process.env.FRONTEND_URL || "").replace(/\/+$/, "");
  return `${base}/academia/${encodeURIComponent(academy.slug)}/primeiro-acesso?token=${token}`;
}

function isValidIsoDate(s) {
  if (!DATE_RE.test(String(s || ""))) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function toItem(row) {
  return {
    id_user: row.id_user,
    cpf: row.cpf,
    ref_externa: row.ref_externa || null,
    estado: estadoDe(row.academy_onboarding_state),
    avatar_url: row.avatar_url || null,
    treino: row.treino_criado_em
      ? {
          nome: row.treino_nome,
          criado_em: new Date(row.treino_criado_em).toISOString(),
          validade_dias: row.treino_validade_dias,
          vence_em: venceEm(row.treino_criado_em, row.treino_validade_dias).toISOString(),
        }
      : null,
    proposta_treino_pendente: row.proposta_treino_pendente === true,
  };
}

async function issueFirstAccess(db, academy, id_user) {
  const token = generateFirstAccessToken();
  const expira_em = new Date(Date.now() + FIRST_ACCESS_TTL_DAYS * 24 * 3600 * 1000);
  await PartnerStorage.replaceFirstAccess(db, {
    id_user,
    id_academy: academy.id_academy,
    token_hash: sha256Hex(token),
    expira_em,
  });
  return { link_primeiro_acesso: linkPrimeiroAcesso(academy, token), expira_em: expira_em.toISOString() };
}

async function pickUsername(db, nome) {
  const base = usernameBaseFromName(nome);
  for (let n = 0; n < 500; n++) {
    const candidate = usernameCandidate(base, n === 0 ? 0 : n + 1);
    if (!(await AuthStorage.findUserIdByUsername(db, candidate))) return candidate;
  }
  return usernameCandidate(base, Math.floor(Math.random() * 1e6));
}

/** Validação do corpo do POST /members. Devolve { data } ou { status, body }. */
function validateMemberBody(body) {
  const b = body || {};
  const cpf = normalizeCPF(b.cpf);
  if (!cpf) return fail(422, "cpf_invalido");

  const nome = typeof b.nome === "string" ? b.nome.trim().slice(0, 160) : "";
  const email = normalizeEmail(typeof b.email === "string" ? b.email : "");
  const data_nascimento = typeof b.data_nascimento === "string" ? b.data_nascimento.trim() : "";
  if (!nome || !email || !data_nascimento) return fail(422, "dados_incompletos");
  if (!validateEmailFormat(email).ok || email.length > 254) return fail(422, "dados_incompletos");
  if (!isValidIsoDate(data_nascimento)) return fail(422, "dados_incompletos");

  const age = calculateAge(data_nascimento);
  if (age == null) return fail(422, "dados_incompletos");
  if (age < 18) return fail(422, "menor_de_idade");

  const telDigits = String(b.telefone || "").replace(/\D/g, "");
  const telefone = telDigits.length >= 10 && telDigits.length <= 15 ? telDigits : null;
  const ref_externa = b.ref_externa == null ? null : String(b.ref_externa).trim().slice(0, 120) || null;

  return { data: { cpf, nome, email, data_nascimento, telefone, ref_externa } };
}

class PartnerMemberService {
  // ─── POST /partner/v1/members ──────────────────────────────────────────────
  static async upsertMember(academy, body, { _retry = 0 } = {}) {
    return runWithLogs(log, "member.upsert", () => ({ id_academy: academy.id_academy }), async () => {
      const v = validateMemberBody(body);
      if (!v.data) return v;
      const { cpf, nome, email, data_nascimento, telefone, ref_externa } = v.data;

      const client = await pool.connect();
      let retry = false;
      try {
        await client.query("BEGIN");
        // Serializa chamadas com o mesmo CPF (idempotência sob corrida).
        await client.query(`SELECT pg_advisory_xact_lock(hashtext('partner-member:' || $1))`, [cpf]);

        const existing = await PartnerStorage.getUserByCpf(client, cpf);
        const memberByCpf = await AcademyStorage.getMemberByCpf(client, academy.id_academy, cpf);

        if (existing) {
          // O CPF desta academia já aponta para OUTRA conta (vínculo antigo
          // feito com um CPF que não é o da conta): não tem como resolver
          // sozinho — a recepção precisa olhar.
          if (memberByCpf && memberByCpf.id_user !== existing.id_user) {
            await client.query("ROLLBACK");
            return fail(409, "cpf_vinculado_outra_conta");
          }
          await PartnerStorage.upsertPartnerMember(client, {
            id_academy: academy.id_academy,
            id_user: existing.id_user,
            cpf,
            member_name: nome,
            ref_externa,
          });
          await client.query("COMMIT");
          return {
            status: 200,
            body: { id_user: existing.id_user, status: "vinculado", estado: estadoDe(existing.academy_onboarding_state) },
          };
        }

        if (await AuthStorage.findUserIdByEmail(client, email)) {
          await client.query("ROLLBACK");
          return fail(409, "email_em_uso");
        }
        if (memberByCpf) {
          await client.query("ROLLBACK");
          return fail(409, "cpf_vinculado_outra_conta");
        }

        const username = await pickUsername(client, nome);
        const user = await AuthStorage.createUser(client, {
          nome,
          username,
          email,
          senhaHash: null,
          data_nascimento,
          cpf,
          sexo: null,
          estado: null,
          municipio: null,
          ativo: false,
        });
        await PartnerStorage.markUserAwaitingAcceptance(client, {
          id_user: user.id_user,
          id_academy: academy.id_academy,
          telefone,
        });
        await PartnerStorage.upsertPartnerMember(client, {
          id_academy: academy.id_academy,
          id_user: user.id_user,
          cpf,
          member_name: nome,
          ref_externa,
        });
        const access = await issueFirstAccess(client, academy, user.id_user);
        await client.query("COMMIT");

        log.info("member.created", { id_academy: academy.id_academy, id_user: user.id_user });
        return {
          status: 201,
          body: { id_user: user.id_user, status: "criado", estado: ESTADO_AGUARDANDO, ...access },
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (err?.code === "23505") {
          const where = `${err.constraint || ""} ${err.detail || ""}`;
          if (/email/i.test(where)) return fail(409, "email_em_uso");
          // CPF (outra instância criou no meio) ou username disputado: repete
          // — a segunda passada cai no "vinculado" ou num username livre.
          if (_retry < 2) retry = true;
        }
        if (!retry) throw err;
      } finally {
        client.release();
      }
      return PartnerMemberService.upsertMember(academy, body, { _retry: _retry + 1 });
    });
  }

  // ─── POST /partner/v1/members/:id_user/link ────────────────────────────────
  static async regenerateLink(academy, id_user) {
    return runWithLogs(log, "member.link", () => ({ id_academy: academy.id_academy, id_user }), async () => {
      if (!UUID_RE.test(String(id_user || ""))) return fail(404, "nao_encontrado");
      const member = await AcademyStorage.getMember(pool, academy.id_academy, id_user);
      if (!member) return fail(404, "nao_encontrado");
      const user = await PartnerStorage.getUserOnboarding(pool, id_user);
      if (!user) return fail(404, "nao_encontrado");
      // Já tem senha (fez o primeiro acesso) ou já é conta comum/aceita: link
      // novo seria um reset de senha por WhatsApp — para isso existe o
      // "esqueci a senha".
      if (user.academy_onboarding_state !== ESTADO_AGUARDANDO || user.has_password) {
        return fail(409, "ja_aceito");
      }
      const access = await issueFirstAccess(pool, academy, id_user);
      return { status: 200, body: access };
    });
  }

  // ─── PUT /partner/v1/members/:id_user/foto-academia ────────────────────────
  static async uploadPhoto(academy, id_user, file) {
    return runWithLogs(log, "member.photo", () => ({ id_academy: academy.id_academy, id_user }), async () => {
      if (!UUID_RE.test(String(id_user || ""))) return fail(404, "nao_encontrado");
      const member = await AcademyStorage.getMember(pool, academy.id_academy, id_user);
      if (!member) return fail(404, "nao_encontrado");
      if (!file || !file.buffer || !file.buffer.length) return fail(422, "foto_obrigatoria");

      const photo_key = await academyPhoto.putAcademyPhoto({
        id_academy: academy.id_academy,
        id_user,
        buffer: file.buffer,
        mimetype: file.mimetype,
      });
      const previous = await PartnerStorage.upsertMemberPhoto(pool, {
        id_academy: academy.id_academy,
        id_user,
        photo_key,
        content_type: file.mimetype,
      });
      if (previous && previous !== photo_key) academyPhoto.deleteAcademyPhoto(previous).catch(() => {});
      return { status: 200, body: { ok: true } };
    });
  }

  // ─── GET /partner/v1/members ───────────────────────────────────────────────
  static async list(academy, { cursor, limit } = {}) {
    let n = limit === undefined || limit === "" ? LIST_DEFAULT : Number(limit);
    if (!Number.isFinite(n) || n < 1) n = LIST_DEFAULT;
    n = Math.min(Math.floor(n), LIST_MAX);

    let afterIdMember = null;
    if (cursor) {
      try {
        afterIdMember = Buffer.from(String(cursor), "base64url").toString("utf8");
      } catch {
        afterIdMember = "";
      }
      if (!UUID_RE.test(afterIdMember)) return fail(400, "cursor_invalido");
    }

    const rows = await PartnerStorage.listMembersForPartner(pool, academy.id_academy, { afterIdMember, limit: n });
    const page = rows.slice(0, n);
    const proximo_cursor =
      rows.length > n ? Buffer.from(page[page.length - 1].id_member, "utf8").toString("base64url") : null;
    return { status: 200, body: { itens: page.map(toItem), proximo_cursor } };
  }

  // ─── GET /partner/v1/members/:id_user ──────────────────────────────────────
  static async get(academy, id_user) {
    if (!UUID_RE.test(String(id_user || ""))) return fail(404, "nao_encontrado");
    const row = await PartnerStorage.getMemberForPartner(pool, academy.id_academy, id_user);
    if (!row) return fail(404, "nao_encontrado");
    return { status: 200, body: toItem(row) };
  }

  // ─── POST /partner/v1/training-reminder ────────────────────────────────────
  // "Avisar professores" da aba Treinos do Coliseu (mig 305). Grava o instante
  // (o modal reabre para quem o dispensou antes dele) e, para quem está com o
  // app aberto, empurra o evento que abre o modal na hora. Sem professor
  // cadastrado não há a quem avisar — e isso é dito, não engolido.
  static async remindProfessors(academy) {
    const professores = await AcademyStorage.listProfessors(pool, academy.id_academy);
    if (professores.length === 0) return fail(409, "sem_professor");
    const pendentes = montarFila(await WorkoutStorage.trainingQueueRows(pool, academy.id_academy)).length;
    await pool.query(`UPDATE public.tb_academy SET training_reminder_at = NOW() WHERE id_academy = $1`, [
      academy.id_academy,
    ]);
    for (const p of professores) {
      realtime.emitToUser(p.id_user, "training-queue:remind", { id_academy: academy.id_academy });
    }
    log.info("training_reminder", { id_academy: academy.id_academy, professores: professores.length, pendentes });
    return { status: 200, body: { professores: professores.length, pendentes } };
  }

  // ─── Chave de parceiro (dono da academia) ──────────────────────────────────
  static async generateKey(id_user, id_academy) {
    return runWithLogs(log, "partner_key.generate", () => ({ id_user, id_academy }), async () => {
      const academy = await AcademyStorage.getById(pool, id_academy);
      if (!academy) return { error: "Academia não encontrada", statusCode: 404 };
      if (academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };
      const chave = generatePartnerKey();
      const saved = await PartnerStorage.setPartnerKey(pool, id_academy, sha256Hex(chave));
      // A chave crua sai SÓ nesta resposta — o banco guarda o hash.
      return { chave, criado_em: saved.partner_key_created_at };
    });
  }

  static async keyStatus(id_user, id_academy) {
    const academy = await AcademyStorage.getById(pool, id_academy);
    if (!academy) return { error: "Academia não encontrada", statusCode: 404 };
    if (academy.id_owner_user !== id_user) return { error: "Sem permissão", statusCode: 403 };
    const st = await PartnerStorage.getPartnerKeyStatus(pool, id_academy);
    return { existe: !!st?.existe, criado_em: st?.criado_em || null };
  }
}

module.exports = PartnerMemberService;
module.exports.validateMemberBody = validateMemberBody;
