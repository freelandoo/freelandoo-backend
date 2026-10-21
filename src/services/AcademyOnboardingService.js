// src/services/AcademyOnboardingService.js
// Conta criada pela academia (API de parceiro, mig 296): primeiro acesso e
// consentimento (decisões Q3/Q19 da spec do Coliseu).
//
// 1. O aluno toca no link de primeiro acesso (7 dias) e cria a senha — a
//    academia já conferiu a identidade, então o e-mail conta como verificado
//    (ativo = TRUE) e ele sai logado, com a mesma sessão do signin.
// 2. No primeiro carregamento logado aparece o modal de termos. Aceitar grava
//    tb_user_consent (versão + data + foto), passa a conta para 'ativa' e, se
//    ele quis, copia a foto do cadastro da academia para o avatar. Recusar
//    APAGA a conta e o vínculo.
// Até aceitar, a conta fica invisível no resto da plataforma
// (utils/academyOnboarding.notPendingAcademyUserSql).
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../databases");
const AuthStorage = require("../storages/AuthStorage");
const AcademyStorage = require("../storages/AcademyStorage");
const PartnerStorage = require("../storages/PartnerStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const ConsentStorage = require("../storages/ConsentStorage");
const TourSettingsStorage = require("../storages/TourSettingsStorage");
const academyPhoto = require("../integrations/r2/academyPhoto");
const { validatePasswordStrength } = require("../utils/validateSignup");
const { sha256Hex } = require("../utils/partnerKey");
const { SIGNUP_TERMS_VERSION, SIGNUP_ACTION_KEY } = require("../utils/terms");
const { ESTADO_AGUARDANDO, ESTADO_ATIVA, VERSAO_TERMOS_ACADEMIA } = require("../utils/academyOnboarding");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("academy-onboarding");

const STATUS_EMAIL_PENDENTE = 7;
const STATUS_EMAIL_VERIFICADO = 8;
const INVALID_LINK = "Link de primeiro acesso inválido ou expirado. Peça um novo na recepção da academia.";

function academiaPublica(a) {
  return a ? { nome: a.nome, slug: a.slug, logo: a.avatar_url || null } : null;
}

class AcademyOnboardingService {
  // ─── GET /auth/primeiro-acesso/:token ──────────────────────────────────────
  static async firstAccessInfo(rawToken) {
    const token = String(rawToken || "");
    if (!/^[0-9a-f]{64}$/i.test(token)) return { valido: false };
    const fa = await PartnerStorage.findFirstAccessByHash(pool, sha256Hex(token));
    if (!fa || !fa.valido) return { valido: false };
    const user = await PartnerStorage.getUserOnboarding(pool, fa.id_user);
    if (!user) return { valido: false };
    const academy = fa.id_academy ? await AcademyStorage.getById(pool, fa.id_academy) : null;
    // Só o primeiro nome: a porta é anônima (quem tem o link).
    return {
      valido: true,
      nome: String(user.nome || "").trim().split(/\s+/)[0] || null,
      academia: academiaPublica(academy),
    };
  }

  // ─── POST /auth/primeiro-acesso ────────────────────────────────────────────
  static async completeFirstAccess(payload) {
    return runWithLogs(log, "first_access.complete", () => ({}), async () => {
      const token = String(payload?.token || "");
      const senha = payload?.senha;
      if (!/^[0-9a-f]{64}$/i.test(token)) return { error: INVALID_LINK, reason: "token_invalido", statusCode: 400 };
      const pass = validatePasswordStrength(senha);
      if (!pass.ok) return { error: pass.error, reason: "senha_fraca", statusCode: 400 };

      const client = await pool.connect();
      let id_user;
      try {
        await client.query("BEGIN");
        const fa = await PartnerStorage.findFirstAccessByHash(client, sha256Hex(token), { forUpdate: true });
        if (!fa || !fa.valido) {
          await client.query("ROLLBACK");
          return { error: INVALID_LINK, reason: fa && fa.usado_em ? "token_usado" : "token_invalido", statusCode: 400 };
        }
        id_user = fa.id_user;
        const senhaHash = await bcrypt.hash(senha, 10);
        // A academia conferiu a identidade: e-mail conta como verificado.
        await client.query(
          `UPDATE public.tb_user SET senha = $2, ativo = TRUE, updated_at = NOW() WHERE id_user = $1`,
          [id_user, senhaHash]
        );
        await PartnerStorage.markFirstAccessUsed(client, fa.id_first_access);
        await AuthStorage.deleteUserStatus(client, { id_user, id_status: STATUS_EMAIL_PENDENTE });
        // Mesmo selo do /activate — condicional ao status existir no catálogo
        // (tb_status é seed de produção; um banco novo pode não ter a linha).
        await client.query(
          `INSERT INTO public.tb_user_status (id_user, id_status, created_by)
           SELECT $1, $2, $1 WHERE EXISTS (SELECT 1 FROM public.tb_status WHERE id_status = $2)
           ON CONFLICT (id_user, id_status) DO NOTHING`,
          [id_user, STATUS_EMAIL_VERIFICADO]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }

      return AcademyOnboardingService.sessionFor(id_user);
    });
  }

  /** Mesma resposta do POST /auth/signin — o front reaproveita extractAuthSession. */
  static async sessionFor(id_user) {
    const r = await pool.query(
      `SELECT id_user, nome, email, ativo, is_minor, responsible_user_id, onboarding_tour_done,
              blocked_at, academy_onboarding_state
         FROM public.tb_user WHERE id_user = $1`,
      [id_user]
    );
    const user = r.rows[0];
    if (!user) return { error: "Usuário não encontrado", statusCode: 404 };
    if (user.blocked_at) {
      return { error: "Esta conta está bloqueada. Fale com o suporte da Freelandoo.", reason: "account_blocked", statusCode: 403 };
    }
    const email = String(user.email || "").trim().toLowerCase();
    const token = jwt.sign({ id_user: user.id_user, email }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    });
    const isAdmin = await AuthStorage.isAdmin(pool, user.id_user);
    const tourSettings = await TourSettingsStorage.getSettings(pool);
    const pending = user.academy_onboarding_state === ESTADO_AGUARDANDO;
    return {
      message: "Login realizado com sucesso",
      token,
      email_verified: !!user.ativo,
      // Conta de academia aguardando aceite: o aceite dos termos é o MODAL da
      // academia (que também grava o aceite do cadastro), não /aceitar-termos.
      needs_terms: pending
        ? false
        : ((await ConsentStorage.listForUser(pool, user.id_user))[SIGNUP_ACTION_KEY] || 0) < SIGNUP_TERMS_VERSION,
      terms_version: SIGNUP_TERMS_VERSION,
      // O tour de boas-vindas espera o aceite.
      show_tour: pending ? false : TourSettingsStorage.shouldShow(tourSettings, isAdmin, !!user.onboarding_tour_done),
      user: {
        id_user: user.id_user,
        nome: user.nome,
        email,
        email_verified: !!user.ativo,
        is_minor: !!user.is_minor,
        responsible_user_id: user.responsible_user_id || null,
        onboarding_tour_done: !!user.onboarding_tour_done,
        is_admin: isAdmin,
        academy_onboarding_state: user.academy_onboarding_state || null,
      },
    };
  }

  // ─── GET /academy-onboarding ───────────────────────────────────────────────
  static async state(id_user) {
    const user = await PartnerStorage.getUserOnboarding(pool, id_user);
    if (!user) return { error: "Usuário não encontrado", statusCode: 404 };
    const academy = user.academy_onboarding_id_academy
      ? await AcademyStorage.getById(pool, user.academy_onboarding_id_academy)
      : null;
    const photo = academy ? await PartnerStorage.getMemberPhoto(pool, academy.id_academy, id_user) : null;
    return {
      estado: user.academy_onboarding_state || null,
      academia: academiaPublica(academy),
      tem_foto: !!photo,
      versao_termos: VERSAO_TERMOS_ACADEMIA,
    };
  }

  /** Foto do cadastro na academia, para o próprio aluno ver no modal. */
  static async photo(id_user) {
    const user = await PartnerStorage.getUserOnboarding(pool, id_user);
    if (!user || !user.academy_onboarding_id_academy) return { error: "Foto não encontrada", statusCode: 404 };
    const photo = await PartnerStorage.getMemberPhoto(pool, user.academy_onboarding_id_academy, id_user);
    if (!photo) return { error: "Foto não encontrada", statusCode: 404 };
    const obj = await academyPhoto.getAcademyPhoto(photo.photo_key);
    return { stream: obj.body, contentType: photo.content_type || obj.contentType };
  }

  // ─── POST /academy-onboarding/aceite ───────────────────────────────────────
  static async accept(id_user, { foto }, meta = {}) {
    return runWithLogs(log, "accept", () => ({ id_user, foto: !!foto }), async () => {
      const user = await PartnerStorage.getUserOnboarding(pool, id_user);
      if (!user) return { error: "Usuário não encontrado", statusCode: 404 };
      if (user.academy_onboarding_state !== ESTADO_AGUARDANDO) {
        return { error: "Não há aceite pendente nesta conta.", reason: "nada_pendente", statusCode: 409 };
      }
      const id_academy = user.academy_onboarding_id_academy;

      // Cópia no R2 ANTES da transação (rede); se falhar, o aceite segue sem
      // a foto — melhor do que travar a pessoa no modal.
      let avatarUrl = null;
      let fotoAceita = false;
      if (foto && id_academy) {
        const photo = await PartnerStorage.getMemberPhoto(pool, id_academy, id_user);
        if (photo) {
          try {
            avatarUrl = await academyPhoto.copyAcademyPhotoToAvatar({
              key: photo.photo_key,
              id_user,
              mimetype: photo.content_type,
            });
            fotoAceita = true;
          } catch (err) {
            log.warn("accept.photo_copy_failed", { id_user, message: err?.message });
          }
        }
      }

      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const consent = await PartnerStorage.insertConsent(client, {
          id_user,
          id_academy,
          versao_termos: VERSAO_TERMOS_ACADEMIA,
          foto_academia_aceita: fotoAceita,
          ip: meta.ip,
          user_agent: meta.user_agent,
        });
        // O modal inclui os Termos de Uso e a Política de Privacidade: vale
        // como o aceite do cadastro (senão /aceitar-termos pediria de novo).
        await ConsentStorage.upsert(client, {
          id_user,
          action_key: SIGNUP_ACTION_KEY,
          terms_version: SIGNUP_TERMS_VERSION,
          ip: meta.ip,
          user_agent: meta.user_agent,
        });
        await PartnerStorage.setOnboardingState(client, id_user, ESTADO_ATIVA);
        if (avatarUrl) {
          const id_profile = await ProfileStorage.getUserAccountProfileId(client, id_user);
          await ProfileStorage.setAvatar(client, id_profile, avatarUrl);
        }
        await client.query("COMMIT");
        return {
          ok: true,
          estado: ESTADO_ATIVA,
          avatar_url: avatarUrl,
          aceite: { versao_termos: consent.versao_termos, aceito_em: consent.aceito_em },
        };
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      } finally {
        client.release();
      }
    });
  }

  // ─── POST /academy-onboarding/recusa ───────────────────────────────────────
  // Apaga a conta (e, por CASCADE, o vínculo, o token e a foto). Só vale para
  // conta AINDA aguardando aceite — nunca apaga conta comum por esta porta.
  static async refuse(id_user) {
    return runWithLogs(log, "refuse", () => ({ id_user }), async () => {
      const user = await PartnerStorage.getUserOnboarding(pool, id_user);
      if (!user) return { error: "Usuário não encontrado", statusCode: 404 };
      if (user.academy_onboarding_state !== ESTADO_AGUARDANDO) {
        return { error: "Esta conta não está aguardando aceite.", reason: "nada_pendente", statusCode: 409 };
      }
      const photoKeys = await PartnerStorage.listPhotoKeysForUser(pool, id_user);

      const client = await pool.connect();
      let apagada = true;
      try {
        await client.query("BEGIN");
        await client.query(
          `DELETE FROM public.tb_user WHERE id_user = $1 AND academy_onboarding_state = $2`,
          [id_user, ESTADO_AGUARDANDO]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        if (err?.code !== "23503") throw err;
        // Algum registro sem CASCADE aponta para a conta: desliga e desfaz o
        // vínculo em vez de deixar a pessoa presa no modal. Segue invisível
        // ('aguardando_aceite') e sem senha.
        apagada = false;
        log.warn("refuse.hard_delete_blocked", { id_user, constraint: err?.constraint });
        await client.query("BEGIN");
        await client.query(`DELETE FROM public.tb_academy_member WHERE id_user = $1`, [id_user]);
        await client.query(`DELETE FROM public.tb_user_first_access WHERE id_user = $1`, [id_user]);
        await client.query(`DELETE FROM public.tb_academy_member_photo WHERE id_user = $1`, [id_user]);
        await client.query(
          `UPDATE public.tb_user SET ativo = FALSE, senha = NULL, updated_at = NOW() WHERE id_user = $1`,
          [id_user]
        );
        await client.query("COMMIT");
      } finally {
        client.release();
      }
      for (const key of photoKeys) academyPhoto.deleteAcademyPhoto(key).catch(() => {});
      return { ok: true, apagada };
    });
  }
}

module.exports = AcademyOnboardingService;
