// src/utils/communityDomain.js
// FONTE ÚNICA de normalização e validação de domínio próprio (mig 214).
//
// Um domínio chega aqui como texto digitado por gente. "HTTPS://Padaria.COM.BR/",
// " padaria.com.br ", "padaria.com.br:443" e "www.padaria.com.br" são coisas
// que a mesma pessoa digita querendo dizer a mesma coisa — menos a última, que
// é OUTRO domínio de verdade e precisa continuar sendo. Normalizar mal aqui
// significa duas linhas no banco para o mesmo endereço, e aí a unicidade que a
// migration promete deixa de valer.
//
// A validação também é uma fronteira de SEGURANÇA: é ela que impede alguém de
// reivindicar um domínio da própria plataforma e servir conteúdo próprio sob um
// nome em que as pessoas confiam.

const RESERVED_APEX = [
  "freelandoo.com.br",
  "freelandoo.com",
  "acasaviews.com.br",
  "vercel.app",
  "railway.app",
  "up.railway.app",
  "r2.dev",
  "cloudflarestorage.com",
];

/**
 * Texto digitado → domínio canônico. Devolve "" quando não dá para aproveitar.
 *
 * O que é removido (porque é ruído de digitação, não parte do nome):
 * protocolo, usuário/senha, porta, caminho, querystring e o ponto final do
 * FQDN absoluto. O que NÃO é removido: o "www.", que é um subdomínio legítimo
 * e distinto — quem apontou o www quis o www.
 */
function normalizeDomain(input) {
  if (!input) return "";
  let raw = String(input).trim().toLowerCase();
  if (!raw) return "";

  // Protocolo e credenciais.
  raw = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  raw = raw.replace(/^[^@/]*@/, "");
  // Caminho, query e fragmento.
  raw = raw.split("/")[0].split("?")[0].split("#")[0];
  // Porta.
  raw = raw.split(":")[0];
  // Ponto final do FQDN absoluto ("padaria.com.br." é o mesmo domínio).
  raw = raw.replace(/\.+$/, "");

  return raw;
}

/** É subdomínio (ou o próprio) de um dos domínios da plataforma? */
function isPlatformDomain(domain) {
  return RESERVED_APEX.some(
    (apex) => domain === apex || domain.endsWith(`.${apex}`)
  );
}

/**
 * Valida um domínio já normalizado.
 * `{ ok: true, domain }` ou `{ ok: false, reason }` — nunca lança: errar o
 * domínio é o caso comum aqui, e caso comum merece mensagem, não exceção.
 */
function validateDomain(input) {
  const domain = normalizeDomain(input);
  if (!domain) return { ok: false, reason: "empty" };
  if (domain.length > 253) return { ok: false, reason: "too_long" };

  // Precisa de pelo menos um ponto: "localhost" e "intranet" não são domínios
  // públicos e não têm como ser verificados nem receber certificado.
  const labels = domain.split(".");
  if (labels.length < 2) return { ok: false, reason: "not_fqdn" };

  for (const label of labels) {
    if (!label || label.length > 63) return { ok: false, reason: "label_length" };
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { ok: false, reason: "label_format" };
    }
  }

  // TLD não pode ser numérico — isso seria um IP escrito de outro jeito, e IP
  // não recebe certificado nem se verifica por TXT.
  if (/^\d+$/.test(labels[labels.length - 1])) {
    return { ok: false, reason: "ip_like" };
  }

  // A trava que importa: ninguém reivindica um domínio da plataforma. Sem isso
  // um usuário poderia pedir `admin.freelandoo.com.br` e passar a servir a
  // página dele sob um nome em que as pessoas confiam.
  if (isPlatformDomain(domain)) return { ok: false, reason: "platform" };

  return { ok: true, domain };
}

/** Onde o TXT de verificação é procurado. */
function verificationHost(domain) {
  return `_freelandoo.${domain}`;
}

/**
 * O valor esperado no TXT. Prefixado para conviver com outros TXT no mesmo
 * host — provedores de e-mail e de nuvem também escrevem ali, e procurar por
 * "o token solto" acharia lixo alheio.
 */
function verificationValue(token) {
  return `freelandoo-site-verification=${token}`;
}

module.exports = {
  RESERVED_APEX,
  normalizeDomain,
  isPlatformDomain,
  validateDomain,
  verificationHost,
  verificationValue,
};
