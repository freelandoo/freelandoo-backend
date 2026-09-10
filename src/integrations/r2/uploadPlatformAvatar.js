const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadPlatformAvatar");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

/**
 * A foto de alguém DENTRO de uma plataforma (mig 233).
 *
 * ⚠️ PREFIXO PRÓPRIO (`platform-avatars/`), e não `profile-avatars/`: aquele
 * guarda o rosto de um PERFIL, e a limpeza que um dia varrer objetos órfãos por
 * lá vai procurar por linhas de `tb_profile`. Uma foto de plataforma
 * escondida no mesmo prefixo não teria perfil correspondente e seria apagada
 * como lixo.
 *
 * O nome carrega a plataforma além do usuário: sem ela, a foto de games e a do
 * Financeiro da mesma pessoa seriam indistinguíveis num `ls` do bucket.
 */
module.exports = async function uploadPlatformAvatarToR2({ id_user, kind, file }) {
  log.info("upload.start", { id_user, kind, mimetype: file?.mimetype });
  const fileExt = getFileExt(file.originalname);
  const fileName = `platform-avatars/${kind}/${id_user}-${crypto.randomUUID()}.${fileExt}`;

  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );

  const url = `${process.env.R2_PUBLIC_URL}/${fileName}`;
  log.info("upload.ok", { key: fileName });
  return url;
};
