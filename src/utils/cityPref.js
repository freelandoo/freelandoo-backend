/**
 * Minha cidade (mig 468) — a preferência de moradia, como regra pura.
 *
 * ⚠️ ESPELHO em `app/(header-only)/minha-cidade/_components/city-types.ts` do
 * front: valor novo entra nos dois lugares (e no CHECK da migration).
 *
 * É preferência de INTERFACE: escolher "condomínio" não dá acesso a condomínio
 * nenhum. O acesso é dos vínculos (residência, membresia) conferidos no servidor.
 */

const HOUSING_KINDS = ["house", "condo"];
const CITY_TABS = ["bairro", "condominio"];

/** A aba que cada moradia abre por padrão. */
const TAB_OF_HOUSING = { house: "bairro", condo: "condominio" };

/**
 * Valida o corpo do PUT /me/city. Parcial: campo ausente = não mexe.
 * Devolve `{ value }` com só os campos válidos que vieram, ou `{ error }`.
 */
function normalizeCityPrefInput(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Corpo inválido." };
  }
  const value = {};
  if (body.housing_kind !== undefined) {
    const v = String(body.housing_kind || "").trim();
    if (!HOUSING_KINDS.includes(v)) return { error: "Tipo de moradia inválido." };
    value.housing_kind = v;
  }
  if (body.last_tab !== undefined) {
    const v = String(body.last_tab || "").trim();
    if (!CITY_TABS.includes(v)) return { error: "Aba inválida." };
    value.last_tab = v;
  }
  if (!Object.keys(value).length) return { error: "Nada para salvar." };
  return { value };
}

/**
 * Junta os dois jeitos de "ter um bairro": a residência ativa (o território,
 * com ou sem comunidade criada) e a membresia numa comunidade de bairro (quem
 * se mudou e ainda tem pedido em aberto lá continua achando o caminho).
 * Uma linha por comunidade — ou por território, quando ainda não há comunidade.
 */
function mergeBairros(residenceRows, memberRows) {
  const out = [];
  const byProfile = new Map();
  for (const r of residenceRows || []) {
    const row = {
      id_profile: r.id_profile || null,
      display_name: r.display_name || null,
      avatar_url: r.avatar_url || null,
      id_territory: r.id_territory ?? null,
      bairro_label: r.bairro_label || null,
      municipio_label: r.municipio_label || null,
      uf: r.uf || null,
      residence_status: r.residence_status || null,
      is_member: !!r.is_member,
      role: r.role || null,
    };
    if (row.id_profile) {
      if (byProfile.has(String(row.id_profile))) continue;
      byProfile.set(String(row.id_profile), row);
    }
    out.push(row);
  }
  for (const m of memberRows || []) {
    if (!m?.id_profile || byProfile.has(String(m.id_profile))) continue;
    const row = {
      id_profile: m.id_profile,
      display_name: m.display_name || null,
      avatar_url: m.avatar_url || null,
      id_territory: null,
      bairro_label: null,
      municipio_label: null,
      uf: null,
      residence_status: null,
      is_member: true,
      role: m.role || null,
    };
    byProfile.set(String(m.id_profile), row);
    out.push(row);
  }
  return out;
}

module.exports = {
  HOUSING_KINDS,
  CITY_TABS,
  TAB_OF_HOUSING,
  normalizeCityPrefInput,
  mergeBairros,
};
