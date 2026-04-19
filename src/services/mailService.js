const { Resend } = require("resend");
const { createLogger } = require("../utils/logger");

const log = createLogger("mailService");

const defaultFrom =
  process.env.RESEND_FROM || "Creators Views <sistema@viewsstars.com.br>";

function getResend() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    throw new Error("RESEND_API_KEY não configurada");
  }
  return new Resend(key);
}

async function sendActivationEmail({ to, name, link }) {
  log.info("sendActivationEmail.start", { to });
  try {
    const response = await getResend().emails.send({
      from: defaultFrom,
      to,
      subject: "Ative sua conta",
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
          <h2>Olá, ${name} 👋</h2>
          <p>Obrigado por se cadastrar no <strong>Creators Views</strong>.</p>

          <p>Clique no botão abaixo para ativar sua conta:</p>

          <p style="margin:24px 0">
            <a href="${link}"
               style="
                 display:inline-block;
                 padding:12px 20px;
                 background:#6c5ce7;
                 color:#ffffff;
                 border-radius:6px;
                 text-decoration:none;
                 font-weight:bold;
               ">
              Ativar conta
            </a>
          </p>

          <p style="font-size:14px;color:#555">
            Este link expira em 24 horas.
          </p>

          <hr />
          <p style="font-size:12px;color:#888">
            Se você não criou uma conta, pode ignorar este email.
          </p>
        </div>
      `,
    });

    if (response.error) {
      log.error("sendActivationEmail.resend_error", response.error);
      throw response.error;
    }

    log.info("sendActivationEmail.ok", { id: response.data?.id });
    return response.data;
  } catch (error) {
    log.error("sendActivationEmail.fail", error);
    throw error;
  }
}

async function sendPasswordResetEmail({ to, name, link }) {
  log.info("sendPasswordResetEmail.start", { to });
  try {
    const response = await getResend().emails.send({
      from: defaultFrom,
      to,
      subject: "Recuperação de senha",
      html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto">
        <h2>Olá, ${name} 👋</h2>

        <p>Recebemos uma solicitação para redefinir sua senha.</p>

        <p style="margin:24px 0">
          <a href="${link}"
             style="
               display:inline-block;
               padding:12px 20px;
               background:#e17055;
               color:#ffffff;
               border-radius:6px;
               text-decoration:none;
               font-weight:bold;
             ">
            Redefinir senha
          </a>
        </p>

        <p style="font-size:14px;color:#555">
          Este link expira em 1 hora.
        </p>

        <hr />
        <p style="font-size:12px;color:#888">
          Se você não solicitou, ignore este email.
        </p>
      </div>
    `,
    });

    if (response.error) {
      log.error("sendPasswordResetEmail.resend_error", response.error);
      throw response.error;
    }
    log.info("sendPasswordResetEmail.ok", { id: response.data?.id });
  } catch (error) {
    log.error("sendPasswordResetEmail.fail", error);
    throw error;
  }
}

module.exports = {
  sendActivationEmail,
  sendPasswordResetEmail,
};
