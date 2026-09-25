// Foto de perfil é IMAGEM, nunca um link qualquer.
//
// O cadastro e a edição de perfil aceitavam `avatar_url` como texto livre, e a
// pessoa colava ali o link do Instagram dela. O banco gravava, o card mandava o
// navegador carregar uma página HTML como foto, e o perfil aparecia com a foto
// quebrada — sem erro nenhum em lugar nenhum.
//
// Regra: vale a URL do nosso R2 (é para lá que todo upload vai) ou uma URL
// https que termine em extensão de imagem. O resto vira "sem foto".
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

function r2Prefix() {
  const base = String(process.env.R2_PUBLIC_URL || "").trim().replace(/\/+$/, "");
  return base ? `${base}/` : null;
}

/** Devolve a URL se ela for uma imagem aceitável; senão `null`. */
function sanitizeAvatarUrl(value) {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const r2 = r2Prefix();
  if (r2 && raw.startsWith(r2)) return raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  return IMAGE_EXT.test(url.pathname) ? raw : null;
}

module.exports = { sanitizeAvatarUrl };
