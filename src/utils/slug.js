// src/utils/slug.js
// Slugify alinhado com lib/slug.ts do frontend e migrations 011/020.

function slugify(input) {
  if (!input) return "";
  return String(input)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function isValidSlug(s) {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s) && s.length >= 2 && s.length <= 80;
}

function withHandlePrefix(handle) {
  if (!handle) return "";
  return String(handle).startsWith("@") ? String(handle) : `@${handle}`;
}

// Espelha lib/slug.ts:buildProfileUrl do frontend.
function buildProfileUrl({ profession_slug, municipio, handle, sub_profile_slug }) {
  if (!profession_slug || !handle) return null;
  const city = slugify(municipio) || "brasil";
  const h = withHandlePrefix(handle);
  const sub = sub_profile_slug ? String(sub_profile_slug).trim() : "";
  if (sub) return `/${profession_slug}/${city}/${h}/${sub}`;
  return `/${profession_slug}/${city}/${h}`;
}

module.exports = { slugify, isValidSlug, withHandlePrefix, buildProfileUrl };
