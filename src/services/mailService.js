const { Resend } = require("resend");
const { createLogger } = require("../utils/logger");

const log = createLogger("mailService");

const defaultFrom =
  process.env.RESEND_FROM || "Freelandoo <sistema@freelandoo.com.br>";

// Banner do email de ativação (hospedado no R2). Env sobrescreve o fallback.
const activationBannerUrl =
  process.env.ACTIVATION_EMAIL_BANNER_URL ||
  "https://pub-3b9774a0af714847979058ea5677a840.r2.dev/email-assets/welcome-activation.png";

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
      subject: "Ative sua conta na Freelandoo",
      html: `
        <div style="margin:0;padding:0;background:#0B0B0D">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0B0B0D">
            <tr>
              <td align="center" style="padding:0">
                <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;font-family:Arial,Helvetica,sans-serif">
                  <!-- Banner clicável -->
                  <tr>
                    <td style="padding:0;line-height:0">
                      <a href="${link}" target="_blank" style="display:block;text-decoration:none">
                        <img src="${activationBannerUrl}"
                             alt="Bem-vindo à Freelandoo — Ative seu email para liberar seu acesso"
                             width="600"
                             style="display:block;width:100%;max-width:600px;height:auto;border:0" />
                      </a>
                    </td>
                  </tr>
                  <!-- Botão real (fallback caso imagens estejam bloqueadas / reforço da ação) -->
                  <tr>
                    <td align="center" style="background:#0B0B0D;padding:28px 24px 12px 24px">
                      <table role="presentation" cellpadding="0" cellspacing="0">
                        <tr>
                          <td align="center" bgcolor="#F5C518" style="background:#F5C518">
                            <a href="${link}" target="_blank"
                               style="display:inline-block;padding:16px 44px;font-size:18px;font-weight:bold;
                                      color:#0B0B0D;text-decoration:none;font-family:Arial,Helvetica,sans-serif;
                                      letter-spacing:0.5px">
                              ATIVAR EMAIL
                            </a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <!-- Texto de apoio -->
                  <tr>
                    <td align="center" style="background:#0B0B0D;padding:8px 24px 28px 24px">
                      <p style="margin:0 0 6px 0;font-size:14px;color:#9A9AA0;font-family:Arial,Helvetica,sans-serif">
                        Se o botão não funcionar, copie e cole este link no navegador:
                      </p>
                      <p style="margin:0 0 18px 0;font-size:13px;word-break:break-all">
                        <a href="${link}" target="_blank" style="color:#F5C518;text-decoration:underline">${link}</a>
                      </p>
                      <p style="margin:0;font-size:13px;color:#6B6B70;font-family:Arial,Helvetica,sans-serif">
                        Este link expira em 24 horas. Se você não criou uma conta na Freelandoo, pode ignorar este email.
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
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

async function sendBookingReminderEmail({ to, clientName, proName, dateLabel, timeLabel, confirmUrl }) {
  log.info("sendBookingReminderEmail.start", { to });
  try {
    const response = await getResend().emails.send({
      from: defaultFrom,
      to,
      subject: `Lembrete: seu horário com ${proName} em ${dateLabel}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#0B0B0D">
          <h2>Olá, ${clientName} 👋</h2>
          <p>Passando para lembrar do seu horário com <strong>${proName}</strong>:</p>
          <p style="font-size:18px;margin:16px 0">
            📅 <strong>${dateLabel}</strong> &nbsp;·&nbsp; ⏰ <strong>${timeLabel}</strong>
          </p>
          <p>Você consegue comparecer? Toque para confirmar:</p>
          <p style="margin:24px 0">
            <a href="${confirmUrl}"
               style="display:inline-block;padding:12px 22px;background:#16B79A;color:#06251F;
                      border-radius:6px;text-decoration:none;font-weight:bold">
              Confirmar presença
            </a>
          </p>
          <p style="font-size:13px;color:#555">
            Se precisar remarcar, é só responder por lá ou avisar com antecedência.
          </p>
          <hr />
          <p style="font-size:12px;color:#888">Lembrete automático enviado pela Freelandoo.</p>
        </div>
      `,
    });
    if (response.error) {
      log.error("sendBookingReminderEmail.resend_error", response.error);
      throw response.error;
    }
    log.info("sendBookingReminderEmail.ok", { id: response.data?.id });
    return response.data;
  } catch (error) {
    log.error("sendBookingReminderEmail.fail", error);
    throw error;
  }
}

module.exports = {
  sendActivationEmail,
  sendPasswordResetEmail,
  sendBookingReminderEmail,
};
