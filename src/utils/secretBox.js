// src/utils/secretBox.js
// Cifra simétrica p/ segredos que PRECISAM ser recuperáveis (ex.: token da
// Gym Provider API de cada academia, usado em chamadas outbound; e, na fase 2
// do WhatsApp, o token de cada cliente em `access_token_sealed`).
// AES-256-GCM, chave derivada por sha256. Formato: v1:<iv b64>:<tag b64>:<ct b64>
//
// ─── POR QUE ABRIR ACEITA MAIS DE UMA CHAVE ─────────────────────────────────
//
// `SECRET_BOX_KEY` é a chave PREFERIDA e `JWT_SECRET` é o fallback histórico —
// e por anos só o fallback existiu. Em produção há segredo selado com ele.
//
// ⚠️ Se `open` usasse só a chave preferida, o dia em que `SECRET_BOX_KEY` fosse
// definida TODO segredo já selado viraria lixo: o GCM não "decifra errado", ele
// falha a autenticação e estoura — e o sintoma chega longe daqui, como a
// sincronização de uma academia que parou de rodar sem ninguém mexer nela.
//
// Então: SELAR usa sempre a preferida; ABRIR tenta as candidatas na ordem. Isso
// torna definir a variável uma operação SEGURA, e o re-selar (scripts/reseal-
// secrets.js) uma arrumação que pode acontecer depois, sem janela de quebra.
//
// ⚠️ O que continua valendo: trocar as DUAS variáveis ao mesmo tempo torna o
// que está selado irrecuperável. Rotação de `JWT_SECRET` só é segura depois que
// tudo tiver sido re-selado com a `SECRET_BOX_KEY`.
const crypto = require("crypto");

/** As chaves aceitas para ABRIR, em ordem de preferência. A 1ª é a que sela. */
function candidateKeys() {
  const sources = [process.env.SECRET_BOX_KEY, process.env.JWT_SECRET]
    .map((s) => (s === undefined || s === null ? "" : String(s)))
    .filter((s) => s.length > 0);

  // Definir SECRET_BOX_KEY com o mesmo valor do JWT_SECRET não é erro, mas
  // tentar a mesma chave duas vezes só duplicaria o trabalho na falha.
  const seen = new Set();
  const keys = [];
  for (const s of sources) {
    if (seen.has(s)) continue;
    seen.add(s);
    keys.push(crypto.createHash("sha256").update(s).digest());
  }
  if (!keys.length) {
    throw new Error("SECRET_BOX_KEY/JWT_SECRET ausentes — secretBox indisponível");
  }
  return keys;
}

function seal(plain) {
  const key = candidateKeys()[0]; // sempre a preferida
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

function open(sealed) {
  const [v, ivB64, tagB64, ctB64] = String(sealed || "").split(":");
  if (v !== "v1" || !ivB64 || !tagB64 || !ctB64) throw new Error("secretBox: formato inválido");

  const iv = Buffer.from(ivB64, "base64");
  const tag = Buffer.from(tagB64, "base64");
  const ct = Buffer.from(ctB64, "base64");

  let lastErr = null;
  for (const key of candidateKeys()) {
    try {
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
    } catch (e) {
      // Chave errada falha na autenticação do GCM. Guarda e tenta a próxima —
      // o erro só sobe quando NENHUMA candidata abriu.
      lastErr = e;
    }
  }
  throw lastErr || new Error("secretBox: não foi possível abrir");
}

/** `true` quando o valor abre com a chave PREFERIDA (usado pelo re-selar). */
function isSealedWithPreferredKey(sealed) {
  try {
    const [v, ivB64, tagB64, ctB64] = String(sealed || "").split(":");
    if (v !== "v1") return false;
    const decipher = crypto.createDecipheriv("aes-256-gcm", candidateKeys()[0], Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
    return true;
  } catch {
    return false;
  }
}

module.exports = { seal, open, isSealedWithPreferredKey };
