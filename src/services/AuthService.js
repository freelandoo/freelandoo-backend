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
const { createLogger, runWithLogs } = require("../utils/logger");

const log = createLogger("AuthService");

class AuthService {
  static async signup(payload) {
    const client = await pool.connect();
    return runWithLogs(
      log,
      "signup",
      () => ({ email: normalizeEmail(payload.email) || null }),
      async () => {
        try {
          const { nome, senha, data_nascimento, sexo, id_category } = payload;
          const email = normalizeEmail(payload.email);

          if (!nome || !email || !senha || !data_nascimento) {
            return {
              error: "Campos obrigatórios: nome, email, senha, data_nascimento",
            };
          }

          const exists = await AuthStorage.findUserIdByEmail(client, email);
          if (exists) {
            return { error: "Email já cadastrado" };
          }

          const senhaHash = await bcrypt.hash(senha, 10);

          await client.query("BEGIN");

          const user = await AuthStorage.createUser(client, {
            nome,
            email,
            senhaHash,
            data_nascimento,
            sexo: sexo || null,
            ativo: false,
          });

          if (id_category) {
            await client.query(
              `INSERT INTO tb_profile (id_user, id_category, display_name, is_active)
               VALUES ($1, $2, $3, false)`,
              [user.id_user, id_category, nome]
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

        if (!user.ativo) {
          return { error: "Conta não ativada. Verifique seu email." };
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
          user: {
            id_user: user.id_user,
            nome: user.nome,
            email,
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
