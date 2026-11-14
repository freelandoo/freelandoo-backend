// src/services/AuthService.js
const bcrypt = require("bcrypt");
const ContentReferralService = require("./ContentReferralService");
const { signSession } = require("../utils/sessionToken");
const loginThrottle = require("../utils/loginThrottle");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const pool = require("../databases");

const AuthStorage = require("../storages/AuthStorage");
const UserStorage = require("../storages/UserStorage");
const ProfileStorage = require("../storages/ProfileStorage");
const TourSettingsStorage = require("../storages/TourSettingsStorage");
const ConsentStorage = require("../storages/ConsentStorage");
const FraudService = require("./FraudService");
const { SIGNUP_TERMS_VERSION, SIGNUP_ACTION_KEY } = require("../utils/terms");
const { sanitizeAvatarUrl } = require("../utils/avatarUrl");
const { categoryMinAgeError } = require("../utils/categoryMinAge");

// Hash fixo para a conferência "de mentira" quando o e-mail não existe: o
// login responde no mesmo tempo para conta que existe e que não existe (sem
// isto, a resposta rápida entregava quem NÃO tem conta).
let dummyHashPromise = null;
const dummyHash = () => (dummyHashPromise ||= bcrypt.hash("freelandoo-sem-conta", 10));

// Conta bloqueada no painel de fraude (mig 201) não entra. Checado no login —
// e só nele: o authMiddleware é puro JWT (zero I/O) e colocar uma consulta lá
// custaria um SELECT por request. Consequência aceita: quem já está logado
// segue até o token expirar (TTL padrão 1 dia).
const BLOCKED_MESSAGE =
  "Esta conta está bloqueada. Fale com o suporte da Freelandoo.";

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// needs_terms = o usuário ainda não aceitou a versão atual dos Termos no cadastro.
// True força a tela /aceitar-termos no frontend antes de liberar o uso.
async function computeNeedsTerms(conn, id_user) {
  const consents = await ConsentStorage.listForUser(conn, id_user);
  return (consents[SIGNUP_ACTION_KEY] || 0) < SIGNUP_TERMS_VERSION;
}
const {
  sendActivationEmail,
  sendPasswordResetEmail,
} = require("./mailService");
const normalizeEmail = require("../utils/normalizeEmail");
const { validateUsername } = require("../utils/validateUsername");
const {
  validateEmailFormat,
  validatePasswordStrength,
  calculateAge,
} = require("../utils/validateSignup");
const { normalizeCPF } = require("../utils/documents");
const SupervisionService = require("./SupervisionService");
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AuthService");

class AuthService {
  static async checkUsername(payload) {
    const v = validateUsername(payload?.username);
    if (!v.ok) {
      return { available: false, reason: v.error };
    }
    const exists = await AuthStorage.findUserIdByUsername(pool, v.username);
    return { available: !exists, username: v.username };
  }

  // Disponibilidade do CPF para o campo do cadastro. Mesma régua do signup
  // (normaliza + dígito verificador + `findUserIdByCpf`), lida ANTES de a
  // pessoa preencher o resto — antes, o "cpf_taken" só aparecia no fim, depois
  // de nome, e-mail, senha e termos. Não devolve quem é o dono: só se está
  // livre. `conn` é injetável só para o teste unitário.
  static async checkCpf(payload, conn = pool) {
    const cpf = normalizeCPF(payload?.cpf);
    if (!cpf) {
      return { available: false, reason: "cpf_invalid" };
    }
    const exists = await AuthStorage.findUserIdByCpf(conn, cpf);
    if (exists) {
      return { available: false, reason: "cpf_taken" };
    }
    return { available: true };
  }

  static async signup(payload, meta = {}) {
    const client = await pool.connect();
    return runWithLogs(
      log,
      "signup",
      () => ({ email: normalizeEmail(payload.email) || null }),
      async () => {
        try {
          const {
            nome,
            senha,
            data_nascimento,
            sexo,
            id_category,
            id_machine,
            display_name,
            bio,
            avatar_url,
            responsible_code,
          } = payload;
          // CPF (mig 188): obrigatório e único — 1 CPF = 1 conta (os perfis
          // ficam dentro dela). Fase 1 valida só o dígito verificador, offline.
          const cpf = normalizeCPF(payload.cpf);
          const email = normalizeEmail(payload.email);
          const estado = payload.estado ? String(payload.estado).trim().toUpperCase() : null;
          const municipio = payload.municipio ? String(payload.municipio).trim() : null;
          // Localização do perfil agora é por REGIÃO (cadastro envia id_region).
          // Mantemos o fallback por município (estado+municipio) pra retrocompat.
          const id_region =
            payload.id_region != null && String(payload.id_region).trim() !== ""
              ? Number(payload.id_region)
              : null;

          if (!nome || !email || !senha || !data_nascimento) {
            return {
              error: "Campos obrigatórios: nome, email, senha, data_nascimento",
            };
          }

          if (!payload.cpf) {
            return { error: "CPF é obrigatório.", reason: "cpf_required" };
          }
          if (!cpf) {
            return { error: "CPF inválido.", reason: "cpf_invalid" };
          }

          const emailCheck = validateEmailFormat(email);
          if (!emailCheck.ok) return { error: emailCheck.error };

          // Idade: se ≥18, fluxo normal. Se <18, exige responsible_code
          // (validado abaixo dentro da transação para evitar race no consumo).
          // Mesma faixa do onboarding (OnboardingService): data no futuro ou de
          // mais de 120 anos é erro de digitação, não "menor de idade" (B1-07).
          const age = calculateAge(data_nascimento);
          if (age == null || age < 0 || age > 120) {
            return { error: "Data de nascimento inválida." };
          }
          const isMinorSignup = age < 18;
          if (isMinorSignup && !responsible_code) {
            return {
              error:
                "Para criar uma conta menor de idade, informe o código do responsável.",
              reason: "responsible_code_required",
            };
          }

          const passCheck = validatePasswordStrength(senha);
          if (!passCheck.ok) return { error: passCheck.error };

          const usernameCheck = validateUsername(payload.username);
          if (!usernameCheck.ok) {
            return { error: "Nome de usuário inválido", reason: usernameCheck.error };
          }
          const username = usernameCheck.username;

          const exists = await AuthStorage.findUserIdByEmail(client, email);
          if (exists) {
            return { error: "Email já cadastrado" };
          }

          const usernameTaken = await AuthStorage.findUserIdByUsername(client, username);
          if (usernameTaken) {
            return { error: "Este nome de usuário já está em uso", reason: "username_taken" };
          }

          // 1 CPF = 1 conta. Quem quer se dividir em várias frentes usa
          // perfis dentro da mesma conta, não contas paralelas.
          const cpfTaken = await AuthStorage.findUserIdByCpf(client, cpf);
          if (cpfTaken) {
            return {
              error:
                "Este CPF já tem uma conta na Freelandoo. Use essa conta — dentro dela você pode criar quantos perfis quiser.",
              reason: "cpf_taken",
            };
          }

          if (id_category) {
            const catRow = await client.query(
              `SELECT id_machine, is_active FROM public.tb_category WHERE id_category = $1 LIMIT 1`,
              [id_category]
            );
            if (!catRow.rowCount || !catRow.rows[0].is_active) {
              return { error: "Profissão não encontrada ou inativa" };
            }
            if (id_machine && Number(catRow.rows[0].id_machine) !== Number(id_machine)) {
              return {
                error: "A profissão selecionada não pertence ao enxame escolhido",
              };
            }
            // Enxame com idade mínima (mig 338): a frase antes do trigger, que
            // sozinho virava 500 "category_min_age:18" no meio do cadastro (B1-03).
            const ageDenied = await categoryMinAgeError(client, { id_category, age });
            if (ageDenied) return ageDenied;
          }

          // Região (opcional): se informada, precisa existir e bater com o estado.
          if (id_region != null) {
            if (!Number.isInteger(id_region)) {
              return { error: "Região inválida" };
            }
            const regRow = await client.query(
              `SELECT uf FROM public.tb_region WHERE id_region = $1 AND is_active = TRUE LIMIT 1`,
              [id_region]
            );
            if (!regRow.rowCount) {
              return { error: "Região não encontrada" };
            }
            if (estado && String(regRow.rows[0].uf).toUpperCase() !== estado) {
              return { error: "A região selecionada não pertence ao estado escolhido" };
            }
          }

          const senhaHash = await bcrypt.hash(senha, 10);

          await client.query("BEGIN");

          const user = await AuthStorage.createUser(client, {
            nome,
            username,
            email,
            senhaHash,
            data_nascimento,
            cpf,
            sexo: sexo || null,
            estado,
            municipio,
            ativo: false,
          });

          // Conta supervisionada: consome código + cria vínculo + permissões
          // dentro da mesma transação. Se falhar, rollback do user também.
          if (isMinorSignup) {
            const consumed = await SupervisionService.consumeInviteForSignup(
              client,
              { code: responsible_code, minorUserId: user.id_user }
            );
            if (consumed?.error) {
              await client.query("ROLLBACK");
              return { error: consumed.error };
            }
          }

          // "Criar meu perfil" no cadastro (B1-02): a atuação escolhida vai para
          // o PERFIL-CONTA — o perfil único da pessoa, que publica de graça
          // (utils/profilePaywall) — e conta como declarada (mig 200). Antes
          // nascia um SEGUNDO perfil, que caía na regra do perfil adicional (só
          // publicava com assinatura), enquanto o onboarding ainda pedia
          // enxame/profissão/cidade de novo para o perfil-conta vazio.
          if (id_category) {
            const profileDisplayName =
              (display_name && String(display_name).trim()) || nome;

            // id_region (mig 121): usa o informado; senão resolve pela cidade.
            const upd = await client.query(
              `UPDATE public.tb_profile
                  SET id_category          = $2,
                      display_name         = $3,
                      bio                  = $4,
                      estado               = $5::text,
                      municipio            = $6::text,
                      id_region            = COALESCE($7::int,
                        (SELECT rc.id_region FROM public.tb_region_city rc
                          WHERE rc.uf = $5::text
                            AND rc.municipio_norm = fl_norm_city($6::text))),
                      taxonomy_declared_at = NOW(),
                      updated_at           = NOW()
                WHERE id_user = $1 AND is_user_account = TRUE AND deleted_at IS NULL
                RETURNING id_profile`,
              [
                user.id_user,
                id_category,
                profileDisplayName,
                (bio && String(bio).trim()) || null,
                estado,
                municipio,
                id_region,
              ]
            );
            // Foto pelo caminho único (espelha em tb_user.avatar).
            const avatar = sanitizeAvatarUrl(avatar_url);
            if (avatar && upd.rows[0]) {
              await ProfileStorage.setAvatar(client, upd.rows[0].id_profile, avatar);
            }
          }

          const token = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + 24);

          await AuthStorage.createActivationToken(client, {
            id_user: user.id_user,
            token,
            expiresAt,
          });

          // O cadastro por e-mail/senha já exige o aceite afirmativo (checkbox no
          // formulário). Grava a prova de consentimento (versão + ip + ua) na mesma
          // transação para que esse usuário não caia na tela /aceitar-termos depois.
          await ConsentStorage.upsert(client, {
            id_user: user.id_user,
            action_key: SIGNUP_ACTION_KEY,
            terms_version: SIGNUP_TERMS_VERSION,
            ip: meta.ip || null,
            user_agent: meta.user_agent || null,
          });

          // Evidência do cadastro pro painel de fraude (mig 201). Vai na MESMA
          // transação: sem o IP guardado aqui, as heurísticas de velocity
          // ("N contas do mesmo IP") nunca teriam o que agrupar depois.
          await FraudService.recordSignupContext(client, {
            id_user: user.id_user,
            signup_ip: meta.ip || null,
            user_agent: meta.user_agent || null,
            email_domain: String(email).split("@")[1] || null,
            signup_source: "email",
          });

          await client.query("COMMIT");

          // Pontuação antifraude — fire-and-forget, JAMAIS derruba o cadastro.
          // Só enfileira pra revisão humana; não bloqueia ninguém sozinho.
          FraudService.evaluateUser(user.id_user).catch(() => {});

          // Mesmo motivo do signin: as atribuições feitas deslogado (mig 194)
          // passam a ser desta conta. Aqui é só cinto e suspensório — o cadastro
          // por e-mail ainda passa pelo /login depois de ativar —, mas evita
          // depender da ordem das telas.
          if (payload?.visitor_token) {
            ContentReferralService.claimVisitorToken(user.id_user, payload.visitor_token)
              .catch(() => {});
          }

          const activationLink = `${process.env.FRONTEND_URL}/activate?token=${token}`;

          // A conta JÁ EXISTE aqui (COMMIT acima). Falha ou demora do provedor
          // de e-mail não pode virar erro de cadastro: a pessoa tentava de novo
          // e lia "Email já cadastrado" (B1-04). Sai em segundo plano; quem não
          // receber entra e usa o "reenviar" da tela de confirmação.
          sendActivationEmail({
            to: user.email,
            name: user.nome,
            link: activationLink,
          }).catch((err) =>
            log.error("signup.activation_email_fail", {
              id_user: user.id_user,
              message: err?.message,
            })
          );

          return {
            message: "Usuário cadastrado com sucesso",
            user,
          };
        } catch (err) {
          await client.query("ROLLBACK");
          // Race entre dois signups com o mesmo CPF: a checagem prévia passou
          // nos dois, o UNIQUE parcial (mig 188) barra o segundo. Sem isso o
          // usuário levaria um 500 opaco.
          if (err?.code === "23505" && String(err.constraint) === "ux_tb_user_cpf") {
            return {
              error:
                "Este CPF já tem uma conta na Freelandoo. Use essa conta — dentro dela você pode criar quantos perfis quiser.",
              reason: "cpf_taken",
            };
          }
          // Mesma corrida para e-mail e nome de usuário (B1-06): a mesma frase
          // da checagem prévia, não um 500.
          if (err?.code === "23505" && String(err.constraint) === "tb_user_email_key") {
            return { error: "Email já cadastrado" };
          }
          if (err?.code === "23505" && String(err.constraint) === "idx_tb_user_username_lower") {
            return { error: "Este nome de usuário já está em uso", reason: "username_taken" };
          }
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async signin(payload) {
    return runWithLogs(
      log,
      "signin",
      () => ({ hasEmail: !!(payload && normalizeEmail(payload.email)) }),
      async () => {
        const { senha } = payload;
        const email = normalizeEmail(payload.email);

        if (!email || !senha) {
          return { error: "Email e senha são obrigatórios" };
        }

        // Bloqueio progressivo por CONTA (A3) — antes de qualquer consulta,
        // igual para e-mail que existe e que não existe.
        const lock = loginThrottle.check(email);
        if (lock.locked) {
          log.warn("signin.account_throttled", { retryAfterSeconds: lock.retryAfterSeconds });
          return { error: loginThrottle.lockedMessage(lock.retryAfterSeconds), statusCode: 429 };
        }

        const user = await AuthStorage.findUserAuthByEmail(pool, email);

        // Conta sem senha (só Google, ou criada pela academia antes do primeiro
        // acesso, mig 296): bcrypt.compare com hash nulo lança — vira 500.
        // Sem conta ou sem senha, compara com o hash fixo: mesmo tempo de resposta.
        const senhaValida = user?.senha
          ? await bcrypt.compare(senha, user.senha)
          : (await bcrypt.compare(senha, await dummyHash()), false);
        if (!user || !senhaValida) {
          loginThrottle.fail(email);
          return { error: "Email ou senha inválidos" };
        }
        loginThrottle.clear(email);

        // Checado DEPOIS da senha de propósito: responder "bloqueada" antes de
        // validar a credencial entregaria a existência da conta a quem só está
        // testando e-mails.
        if (user.blocked_at) {
          log.warn("signin.blocked_account", { id_user: user.id_user });
          return { error: BLOCKED_MESSAGE, reason: "account_blocked", statusCode: 403 };
        }

        const token = signSession({ id_user: user.id_user, email });


        // "Esteve online agora" (mig 228). O pulso normal é o heartbeat de
        // 5 min; sem este carimbo, quem entra e fecha a aba em seguida não
        // deixaria rastro nenhum, porque a primeira batida só sai 30s depois.
        // Fire-and-forget: um UPDATE de data nunca pode derrubar um login.
        UserStorage.touchLastSeen(pool, user.id_user).catch(() => {});

        // Atribuições de conteúdo feitas deslogado (mig 194) passam a ser desta
        // conta. Sem isto, quem clica no link de alguém, cria conta e só depois
        // compra some da atribuição. Fire-and-forget: nunca derruba o login.
        if (payload?.visitor_token) {
          ContentReferralService.claimVisitorToken(user.id_user, payload.visitor_token)
            .catch(() => {});
        }

        // Conta vinda de academia aguardando aceite (mig 296): o aceite dos
        // termos é o modal da academia, e o tour espera por ele.
        const academyPending = user.academy_onboarding_state === "aguardando_aceite";
        const needs_terms = academyPending ? false : await computeNeedsTerms(pool, user.id_user);
        const isAdmin = await AuthStorage.isAdmin(pool, user.id_user);
        const tourSettings = await TourSettingsStorage.getSettings(pool);
        const show_tour = academyPending
          ? false
          : TourSettingsStorage.shouldShow(tourSettings, isAdmin, !!user.onboarding_tour_done);

        return {
          message: "Login realizado com sucesso",
          token,
          email_verified: !!user.ativo,
          needs_terms,
          terms_version: SIGNUP_TERMS_VERSION,
          show_tour,
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
    );
  }

  static async googleSignin(payload, meta = {}) {
    return runWithLogs(
      log,
      "googleSignin",
      () => ({}),
      async () => {
        const credential = payload?.credential || payload?.id_token;
        if (!credential) {
          return { error: "Credential do Google é obrigatório" };
        }
        if (!process.env.GOOGLE_CLIENT_ID) {
          return { error: "GOOGLE_CLIENT_ID não configurado no servidor", status: 500 };
        }

        let ticket;
        try {
          ticket = await googleClient.verifyIdToken({
            idToken: credential,
            audience: process.env.GOOGLE_CLIENT_ID,
          });
        } catch (err) {
          log.warn("googleSignin.invalid_token", { message: err.message });
          return { error: "Credencial inválida ou expirada" };
        }

        const gp = ticket.getPayload();
        if (!gp || !gp.sub || !gp.email) {
          return { error: "Resposta do Google incompleta" };
        }
        if (!gp.email_verified) {
          return { error: "Email do Google não está verificado" };
        }

        const email = normalizeEmail(gp.email);
        const googleSub = String(gp.sub);
        const fullName =
          (gp.name && gp.name.trim()) ||
          [gp.given_name, gp.family_name].filter(Boolean).join(" ").trim() ||
          email.split("@")[0];

        const client = await pool.connect();
        try {
          let isNew = false;
          // 1) Já existe user com esse google_sub?
          let user = await AuthStorage.findUserByGoogleSub(client, googleSub);

          // 2) Não — tenta achar por email e linkar
          if (!user) {
            user = await AuthStorage.findUserForGoogleByEmail(client, email);
            if (user) {
              // Conta NUNCA confirmada (ativo = false): quem pôs a senha nunca
              // provou ser dono do e-mail — pode ser alguém que cadastrou o
              // e-mail alheio esperando a dona chegar (pré-sequestro). O Google
              // acaba de provar a dona: a senha de antes cai. Ela cria outra
              // por "Esqueci a senha" se quiser.
              const dropPassword = !user.ativo;
              await AuthStorage.linkGoogleSub(client, user.id_user, googleSub, { dropPassword });
              if (dropPassword) log.warn("googleSignin.unverified_password_dropped", { id_user: user.id_user });
              user.google_sub = googleSub;
              user.ativo = true;
            }
          }

          // 3) Não existe — cria novo
          if (!user) {
            await client.query("BEGIN");
            try {
              const username = await AuthStorage.generateUniqueUsernameFromEmail(
                client,
                email
              );
              user = await AuthStorage.createGoogleUser(client, {
                nome: fullName,
                username,
                email,
                googleSub,
              });
              isNew = true;
              // Evidência do cadastro pro painel de fraude (mig 201) — o
              // cadastro pelo Google é justamente o mais fácil de automatizar
              // em massa, então é onde o IP mais importa.
              await FraudService.recordSignupContext(client, {
                id_user: user.id_user,
                signup_ip: meta.ip || null,
                user_agent: meta.user_agent || null,
                email_domain: String(email).split("@")[1] || null,
                signup_source: "google",
              });
              await client.query("COMMIT");
            } catch (err) {
              await client.query("ROLLBACK");
              throw err;
            }
          }

          // Mesmo gate do signin por senha (mig 201) — o Google não pode ser a
          // porta dos fundos de uma conta bloqueada.
          if (user.blocked_at) {
            log.warn("googleSignin.blocked_account", { id_user: user.id_user });
            return { error: BLOCKED_MESSAGE, reason: "account_blocked", statusCode: 403 };
          }

          const token = signSession({ id_user: user.id_user, email });

          if (isNew) {
            FraudService.evaluateUser(user.id_user).catch(() => {});
          }


          // "Esteve online agora" (mig 228). O pulso normal é o heartbeat de
          // 5 min; sem este carimbo, quem entra e fecha a aba em seguida não
          // deixaria rastro nenhum, porque a primeira batida só sai 30s depois.
          // Fire-and-forget: um UPDATE de data nunca pode derrubar um login.
          UserStorage.touchLastSeen(pool, user.id_user).catch(() => {});

          // Google é signup e login na MESMA tela: sem o claim aqui, quem chega
          // pelo link compartilhado e entra com Google nunca casa as atribuições
          // anônimas com a conta (o resolveForItem só enxerga id_user_visitor).
          if (payload?.visitor_token) {
            ContentReferralService.claimVisitorToken(user.id_user, payload.visitor_token)
              .catch(() => {});
          }

          // O login com Google NÃO grava aceite: o usuário ainda não viu os Termos
          // nesse fluxo. needs_terms vem true para conta nova (e para qualquer conta
          // sem aceite da versão atual) → frontend leva à tela /aceitar-termos.
          const academyPending = user.academy_onboarding_state === "aguardando_aceite";
          const needs_terms = academyPending ? false : await computeNeedsTerms(client, user.id_user);
          const onboarding_tour_done = isNew
            ? false
            : await AuthStorage.getOnboardingTourDone(client, user.id_user);
          const isAdmin = isNew ? false : await AuthStorage.isAdmin(client, user.id_user);
          const tourSettings = await TourSettingsStorage.getSettings(client);
          const show_tour = TourSettingsStorage.shouldShow(
            tourSettings, isAdmin, onboarding_tour_done
          );

          return {
            message: "Login com Google realizado com sucesso",
            token,
            email_verified: true,
            is_new: isNew,
            needs_terms,
            terms_version: SIGNUP_TERMS_VERSION,
            show_tour,
            user: {
              id_user: user.id_user,
              nome: user.nome,
              email,
              email_verified: true,
              is_minor: !!user.is_minor,
              responsible_user_id: user.responsible_user_id || null,
              onboarding_tour_done,
              is_admin: isAdmin,
              academy_onboarding_state: user.academy_onboarding_state || null,
            },
          };
        } finally {
          client.release();
        }
      }
    );
  }

  static async activate(query) {
    const { token } = query;
    if (!token) {
      log.warn("activate.missing_token");
      return { error: "Token não informado" };
    }

    const client = await pool.connect();

    const STATUS_EMAIL_PENDENTE = 7;
    const STATUS_EMAIL_VERIFICADO = 8;

    return runWithLogs(
      log,
      "activate",
      () => ({ hasToken: true }),
      async () => {
        try {
          await client.query("BEGIN");

          const activation = await AuthStorage.findValidActivationByToken(
            client,
            token
          );
          if (!activation) {
            await client.query("ROLLBACK");
            return { error: "Token inválido ou expirado" };
          }

          await AuthStorage.setUserActive(client, activation.id_user);
          await AuthStorage.markActivationUsed(client, activation.id_activation);

          await AuthStorage.deleteUserStatus(client, {
            id_user: activation.id_user,
            id_status: STATUS_EMAIL_PENDENTE,
          });

          await AuthStorage.insertUserStatus(client, {
            id_user: activation.id_user,
            id_status: STATUS_EMAIL_VERIFICADO,
            created_by: activation.id_user,
          });

          await client.query("COMMIT");

          return { message: "Conta ativada com sucesso" };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async resendActivation(user) {
    return runWithLogs(
      log,
      "resendActivation",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const client = await pool.connect();
        try {
          const u = await client.query(
            `SELECT id_user, nome, email, ativo FROM tb_user WHERE id_user = $1 LIMIT 1`,
            [user.id_user]
          );
          if (!u.rowCount) return { error: "Usuário não encontrado" };
          if (u.rows[0].ativo) {
            return { error: "Email já confirmado" };
          }

          // rate limit simples: bloqueia se um token foi gerado há menos de 60s
          const recent = await client.query(
            `SELECT 1 FROM tb_user_activation
              WHERE id_user = $1
                AND created_at > NOW() - INTERVAL '60 seconds'
              LIMIT 1`,
            [user.id_user]
          );
          if (recent.rowCount > 0) {
            return {
              error: "Aguarde um instante antes de solicitar outro email.",
            };
          }

          // invalida tokens anteriores
          await client.query(
            `UPDATE tb_user_activation SET used = TRUE
              WHERE id_user = $1 AND used = FALSE`,
            [user.id_user]
          );

          const token = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + 24);
          await AuthStorage.createActivationToken(client, {
            id_user: user.id_user,
            token,
            expiresAt,
          });

          const link = `${process.env.FRONTEND_URL}/activate?token=${token}`;
          await sendActivationEmail({
            to: u.rows[0].email,
            name: u.rows[0].nome,
            link,
          });

          return { message: "Email de ativação reenviado." };
        } finally {
          client.release();
        }
      }
    );
  }

  static async changeEmail(user, payload) {
    return runWithLogs(
      log,
      "changeEmail",
      () => ({ id_user: user?.id_user }),
      async () => {
        if (!user?.id_user) return { error: "Não autenticado" };
        const newEmail = normalizeEmail(payload?.new_email);
        if (!newEmail) return { error: "Email é obrigatório" };

        const { validateEmailFormat } = require("../utils/validateSignup");
        const fmt = validateEmailFormat(newEmail);
        if (!fmt.ok) return { error: fmt.error };

        const client = await pool.connect();
        try {
          await client.query("BEGIN");

          const u = await client.query(
            `SELECT id_user, nome, email, ativo FROM tb_user WHERE id_user = $1 LIMIT 1`,
            [user.id_user]
          );
          if (!u.rowCount) {
            await client.query("ROLLBACK");
            return { error: "Usuário não encontrado" };
          }
          if (u.rows[0].ativo) {
            await client.query("ROLLBACK");
            return {
              error:
                "Sua conta já está confirmada. Entre em contato com o suporte para alterar email.",
            };
          }
          if (newEmail === u.rows[0].email) {
            await client.query("ROLLBACK");
            return { error: "Este já é o email atual" };
          }

          const taken = await AuthStorage.findUserIdByEmail(client, newEmail);
          if (taken) {
            await client.query("ROLLBACK");
            return { error: "Email já cadastrado" };
          }

          await client.query(
            `UPDATE tb_user SET email = $1, ativo = FALSE WHERE id_user = $2`,
            [newEmail, user.id_user]
          );

          await client.query(
            `UPDATE tb_user_activation SET used = TRUE
              WHERE id_user = $1 AND used = FALSE`,
            [user.id_user]
          );

          const token = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + 24);
          await AuthStorage.createActivationToken(client, {
            id_user: user.id_user,
            token,
            expiresAt,
          });

          await client.query("COMMIT");

          const link = `${process.env.FRONTEND_URL}/activate?token=${token}`;
          await sendActivationEmail({
            to: newEmail,
            name: u.rows[0].nome,
            link,
          });

          return {
            message: "Email atualizado. Confirme no novo endereço.",
            email: newEmail,
          };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }

  static async forgotPassword(payload) {
    const email = normalizeEmail(payload.email);
    if (!email) return { error: "Email é obrigatório" };

    const client = await pool.connect();
    return runWithLogs(
      log,
      "forgotPassword",
      () => ({ email }),
      async () => {
        try {
          const user = await AuthStorage.findUserBasicByEmail(client, email);

          const generic = {
            message: "Se o email existir, enviaremos instruções",
          };

          if (!user) return generic;

          const token = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + 1);

          await AuthStorage.createPasswordResetToken(client, {
            id_user: user.id_user,
            token,
            expiresAt,
          });

          const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;

          await sendPasswordResetEmail({
            to: user.email,
            name: user.nome,
            link: resetLink,
          });

          return generic;
        } finally {
          client.release();
        }
      }
    );
  }

  static async resetPassword(payload) {
    const { token, novaSenha } = payload;

    if (!token || !novaSenha) {
      return { error: "Token e nova senha são obrigatórios" };
    }
    // Mesma régua do cadastro (antes, o link aceitava "1").
    const passCheck = validatePasswordStrength(novaSenha);
    if (!passCheck.ok) return { error: passCheck.error, statusCode: 400 };

    const client = await pool.connect();
    return runWithLogs(
      log,
      "resetPassword",
      () => ({ hasToken: true }),
      async () => {
        try {
          await client.query("BEGIN");

          // Consome o link numa tacada só (UPDATE … WHERE used = false): dois
          // envios ao mesmo tempo não trocam a senha duas vezes.
          const reset = await AuthStorage.consumePasswordResetToken(client, token);
          if (!reset) {
            await client.query("ROLLBACK");
            return { error: "Token inválido ou expirado" };
          }

          const senhaHash = await bcrypt.hash(novaSenha, 10);

          await AuthStorage.updateUserPassword(client, reset.id_user, senhaHash);
          // Os outros pedidos em aberto desta conta caem junto: o link velho
          // que ficou numa caixa de e-mail não troca a senha nova.
          await AuthStorage.revokeOpenPasswordResets(client, reset.id_user);

          await client.query("COMMIT");

          // Quem trocou a senha pelo e-mail sai da trava de login.
          const owner = await client.query(`SELECT email FROM tb_user WHERE id_user = $1`, [reset.id_user]);
          if (owner.rows[0]?.email) loginThrottle.clear(owner.rows[0].email);

          return { message: "Senha redefinida com sucesso" };
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        } finally {
          client.release();
        }
      }
    );
  }
}

module.exports = AuthService;
