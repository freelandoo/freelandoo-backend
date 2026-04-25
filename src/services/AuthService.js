// src/services/AuthService.js
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const pool = require("../databases");

const AuthStorage = require("../storages/AuthStorage");
const {
  sendActivationEmail,
  sendPasswordResetEmail,
} = require("./mailService");
const normalizeEmail = require("../utils/normalizeEmail");
const { validateUsername, normalizeUsername } = require("../utils/validateUsername");
const {
  validateEmailFormat,
  validateAge18,
  validatePasswordStrength,
} = require("../utils/validateSignup");
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

  static async signup(payload) {
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
          } = payload;
          const email = normalizeEmail(payload.email);
          const estado = payload.estado ? String(payload.estado).trim().toUpperCase() : null;
          const municipio = payload.municipio ? String(payload.municipio).trim() : null;

          if (!nome || !email || !senha || !data_nascimento) {
            return {
              error: "Campos obrigatórios: nome, email, senha, data_nascimento",
            };
          }

          const emailCheck = validateEmailFormat(email);
          if (!emailCheck.ok) return { error: emailCheck.error };

          const ageCheck = validateAge18(data_nascimento);
          if (!ageCheck.ok) return { error: ageCheck.error };

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
                error: "A profissão selecionada não pertence à máquina escolhida",
              };
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
            sexo: sexo || null,
            estado,
            municipio,
            ativo: false,
          });

          if (id_category) {
            await client.query(
              `INSERT INTO tb_profile (id_user, id_category, display_name, bio, avatar_url, estado, municipio, is_active)
               VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
              [
                user.id_user,
                id_category,
                (display_name && String(display_name).trim()) || nome,
                (bio && String(bio).trim()) || null,
                (avatar_url && String(avatar_url).trim()) || null,
                estado,
                municipio,
              ]
            );
          }

          const token = crypto.randomBytes(32).toString("hex");
          const expiresAt = new Date();
          expiresAt.setHours(expiresAt.getHours() + 24);

          await AuthStorage.createActivationToken(client, {
            id_user: user.id_user,
            token,
            expiresAt,
          });

          await client.query("COMMIT");

          const activationLink = `${process.env.FRONTEND_URL}/activate?token=${token}`;

          await sendActivationEmail({
            to: user.email,
            name: user.nome,
            link: activationLink,
          });

          return {
            message: "Usuário cadastrado com sucesso",
            user,
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

        const user = await AuthStorage.findUserAuthByEmail(pool, email);

        if (!user) {
          return { error: "Email ou senha inválidos" };
        }

        const senhaValida = await bcrypt.compare(senha, user.senha);
        if (!senhaValida) {
          return { error: "Email ou senha inválidos" };
        }

        const token = jwt.sign(
          { id_user: user.id_user, email },
          process.env.JWT_SECRET,
          { expiresIn: process.env.JWT_EXPIRES_IN || "1d" }
        );

        return {
          message: "Login realizado com sucesso",
          token,
          email_verified: !!user.ativo,
          user: {
            id_user: user.id_user,
            nome: user.nome,
            email,
            email_verified: !!user.ativo,
          },
        };
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

    const client = await pool.connect();
    return runWithLogs(
      log,
      "resetPassword",
      () => ({ hasToken: true }),
      async () => {
        try {
          await client.query("BEGIN");

          const reset = await AuthStorage.findValidPasswordResetByToken(
            client,
            token
          );
          if (!reset) {
            await client.query("ROLLBACK");
            return { error: "Token inválido ou expirado" };
          }

          const senhaHash = await bcrypt.hash(novaSenha, 10);

          await AuthStorage.updateUserPassword(client, reset.id_user, senhaHash);
          await AuthStorage.markPasswordResetUsed(client, reset.id_reset);

          await client.query("COMMIT");

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
