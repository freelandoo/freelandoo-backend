// src/utils/redactUrl.js
//
// Segurança A6 — URL que vai para LOG (Railway) ou para a tabela de logs do
// Painel de Arquitetura passa por aqui antes.
//
// Por quê: alguns links carregam a própria chave de acesso. O de primeiro
// acesso da academia (`/auth/primeiro-acesso/<token>`) deixa quem tem o token
// definir a senha da conta; o de ativação (`/auth/activate?token=`) ativa a
// conta; o de confirmação de horário (`/bookings/confirm/<token>`) confirma ou
// cancela o agendamento de outra pessoa; o da classificação
// (`/classificacao/link/<token>`) abre a classificação compartilhada. Quem lê
// o log (qualquer token de projeto do Railway, qualquer admin no painel) não
// deve ganhar essas chaves de brinde.
//
// Regra: o caminho mantém a forma (para o log continuar útil) e só o pedaço
// secreto vira "[oculto]"; na query, o VALOR de parâmetro com nome de segredo
// vira "[oculto]" (o nome fica).

const HIDDEN = "[oculto]";

// Segmento logo depois destes marcadores é chave de acesso.
const TOKEN_AFTER = ["primeiro-acesso", "confirm", "link", "reset-password", "activate"];
const TOKEN_AFTER_RE = new RegExp(`/(${TOKEN_AFTER.join("|")})/([^/?#]+)`, "gi");

// Segmento que é cara de token gerado por `randomBytes(32).toString("hex")`.
const HEX_TOKEN_RE = /\/[0-9a-f]{40,}(?=\/|$)/gi;

// Nome de parâmetro de query cujo valor é segredo.
const SECRET_PARAM_RE = /(token|secret|password|senha|passwd|signature|sig|key|code|otp|challenge|hash|auth)/i;

function redactPath(pathname) {
  return String(pathname || "")
    .replace(TOKEN_AFTER_RE, (_m, marker) => `/${marker}/${HIDDEN}`)
    .replace(HEX_TOKEN_RE, `/${HIDDEN}`);
}

function redactQuery(query) {
  if (!query) return "";
  return query
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      if (eq < 0) return pair;
      const name = pair.slice(0, eq);
      let decoded = name;
      try {
        decoded = decodeURIComponent(name);
      } catch {
        /* nome torto: avalia como veio */
      }
      return SECRET_PARAM_RE.test(decoded) ? `${name}=${HIDDEN}` : pair;
    })
    .join("&");
}

/** URL (caminho + query, como `req.originalUrl`) pronta para log. */
function redactUrl(url) {
  const raw = String(url || "");
  const hashAt = raw.indexOf("#");
  const noHash = hashAt >= 0 ? raw.slice(0, hashAt) : raw;
  const q = noHash.indexOf("?");
  if (q < 0) return redactPath(noHash);
  const query = redactQuery(noHash.slice(q + 1));
  return `${redactPath(noHash.slice(0, q))}${query ? `?${query}` : ""}`;
}

module.exports = { redactUrl, redactPath, HIDDEN };
