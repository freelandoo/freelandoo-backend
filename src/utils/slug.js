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

module.exports = { slugify, isValidSlug };
