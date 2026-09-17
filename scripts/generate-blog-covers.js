#!/usr/bin/env node
/**
 * Capas automáticas dos posts do blog.
 *
 * ─── POR QUE ESTE SCRIPT EXISTE ─────────────────────────────────────────────
 *
 * `blog_posts.cover_url` alimenta TRÊS coisas ao mesmo tempo: o card do índice
 * (/blog), a `og:image` do compartilhamento e o campo `image` do JSON-LD de
 * Article. Com a coluna vazia, o índice cai num bloco de cor com o nome da
 * categoria — o que faz os 9 posts de "Casa Views" ficarem idênticos entre si —
 * e as outras duas superfícies simplesmente não existem: o Twitter card degrada
 * de `summary_large_image` para `summary` e o Article vai ao Google sem imagem.
 *
 * A capa é montada com o que o PRÓPRIO post diz: o título e os subtítulos `##`
 * do corpo. Não é arte genérica por categoria — duas capas da mesma categoria
 * saem diferentes porque os tópicos são diferentes.
 *
 * ─── POR QUE PNG NO R2, E NÃO GERAÇÃO SOB DEMANDA ───────────────────────────
 *
 * `ImageResponse` (next/og) geraria a imagem na hora, mas cada card do índice
 * viraria uma invocação de função na Vercel — 30 por visita ao /blog, que é a
 * superfície de aquisição. O arquivo pronto no R2 custa zero em runtime e é
 * servido pelo CDN, a mesma regra que já vale para o resto da mídia.
 *
 * ─── O QUE ELE NUNCA SOBRESCREVE ────────────────────────────────────────────
 *
 * Só regera a capa que ELE mesmo criou — a chave mora em `blog-covers/auto/`.
 * Capa subida à mão pelo admin fica intocada, senão o script apagaria em
 * silêncio o trabalho de quem escolheu uma imagem de verdade. `--force`
 * atropela isso de propósito, e só quando alguém digita.
 *
 * Uso:
 *   node scripts/generate-blog-covers.js                  # simula, não grava
 *   node scripts/generate-blog-covers.js --apply          # sobe ao R2 e grava
 *   node scripts/generate-blog-covers.js --apply --force
 *   node scripts/generate-blog-covers.js --only slug-a,slug-b
 *   node scripts/generate-blog-covers.js --out ./tmp      # PNG local, para ver
 */
require("dotenv").config();

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const r2 = require("../src/services/r2Client");
const db = require("../src/databases");

// ⚠️ Bump ao mudar o DESENHO: a versão entra na chave, então a capa nova nasce
// num endereço novo e o CDN não continua servindo a antiga em cache.
const DESIGN_VERSION = "v1";
const AUTO_PREFIX = "blog-covers/auto/";

const W = 1200, H = 630;                  // proporção de og:image (1.91:1)
const PAPER = "#F1EDE2", INK = "#0B0B0D";
const CX = 38, CY = 32, CW = W - 92, CH = H - 116, CB = CY + CH;
const PAD = 54;
const TEXT_X = CX + PAD;
const TEXT_W = CW - PAD * 2;
const RULE_Y = CB - 78;                   // a linha do rodapé fica DENTRO do card
const FOOT_Y = CB - 30;

// Uma cor por categoria: é o que separa as sete famílias de relance na grade.
const CAT_COLOR = {
  "Vender serviços": "#F2B705",
  "Vender produtos": "#6D28D9",
  "Monetização": "#15803D",
  "Primeiros passos": "#1D4ED8",
  "Comunidade": "#C2410C",
  "Casa Views": "#DB2777",
  "Conteúdo e audiência": "#0D9488",
};
const FALLBACK_COLOR = "#F2B705";

const esc = (s) => String(s)
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&apos;");

/** "A parte referente ao tópico": os `## subtítulos` do próprio post. */
const topicsOf = (md) =>
  (md || "")
    .split("\n")
    .filter((l) => l.startsWith("## "))
    .map((l) => l.slice(3).trim())
    .filter(Boolean);

function wrap(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = "";
  for (const w of words) {
    if (!cur) { cur = w; continue; }
    if ((cur + " " + w).length <= maxChars) cur += " " + w;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const clip = (s, n) =>
  String(s).length <= n ? String(s) : String(s).slice(0, n - 1).trimEnd() + "…";

function buildSvg(post) {
  const color = CAT_COLOR[post.category] || FALLBACK_COLOR;
  const cat = String(post.category || "Freelandoo").toUpperCase();
  // Largura da tarja ESTIMADA pela métrica da fonte — curta demais corta a
  // última letra, e isso só aparece olhando a imagem.
  const catW = Math.round(cat.length * (23 * 0.68 + 2)) + 58;

  const len = post.title.length;
  const tSize = len > 52 ? 70 : len > 34 ? 82 : 94;
  const tLead = Math.round(tSize * 0.86);
  const tLines = wrap(post.title.toUpperCase(), Math.floor(TEXT_W / (tSize * 0.40))).slice(0, 3);
  const tTop = 208;
  const titleBlock = tLines
    .map((l, i) => `<text x="${TEXT_X}" y="${tTop + i * tLead}" font-family="Bebas Neue" font-size="${tSize}" fill="${INK}">${esc(l)}</text>`)
    .join("");

  // Só entram os tópicos que CABEM entre o fim do título e a linha do rodapé —
  // título de três linhas simplesmente sai com menos tópicos, em vez de vazar.
  const tEnd = tTop + (tLines.length - 1) * tLead;
  const room = RULE_Y - 26 - (tEnd + 40);
  const maxTopics = Math.max(0, Math.min(3, Math.floor(room / 44)));
  const topicBlock = topicsOf(post.body_md)
    .slice(0, maxTopics)
    .map((t, i) => {
      const y = tEnd + 62 + i * 44;
      return `<rect x="${TEXT_X}" y="${y - 15}" width="13" height="13" fill="${color}" stroke="${INK}" stroke-width="2"/>`
        + `<text x="${TEXT_X + 30}" y="${y - 3}" font-family="Arial" font-size="26" font-weight="600" fill="${INK}" opacity="0.82">${esc(clip(t, 60))}</text>`;
    })
    .join("");

  const dots = Array.from({ length: 40 }, (_, i) =>
    `<circle cx="${(i * 67) % W}" cy="${(i * 113) % H}" r="3" fill="${INK}" opacity="0.13"/>`).join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="${color}"/>
  ${dots}
  <rect x="${CX + 8}" y="${CY + 8}" width="${CW}" height="${CH}" fill="${INK}"/>
  <rect x="${CX}" y="${CY}" width="${CW}" height="${CH}" fill="${PAPER}" stroke="${INK}" stroke-width="5"/>
  <g transform="rotate(-2 ${TEXT_X} 92)">
    <rect x="${TEXT_X - 12}" y="66" width="${catW}" height="46" fill="${color}" stroke="${INK}" stroke-width="4"/>
    <text x="${TEXT_X + 14}" y="98" font-family="Arial" font-size="23" font-weight="900" fill="${INK}" letter-spacing="2">${esc(cat)}</text>
  </g>
  ${titleBlock}
  ${topicBlock}
  <rect x="${TEXT_X}" y="${RULE_Y}" width="${TEXT_W}" height="4" fill="${INK}"/>
  <text x="${TEXT_X}" y="${FOOT_Y}" font-family="Bebas Neue" font-size="34" fill="${INK}" letter-spacing="3">FREELANDOO</text>
  <text x="${TEXT_X + TEXT_W}" y="${FOOT_Y - 2}" text-anchor="end" font-family="Arial" font-size="21" font-weight="700" fill="${INK}" opacity="0.5">freelandoo.com.br/blog</text>
</svg>`;
}

const isAuto = (url) => typeof url === "string" && url.includes(AUTO_PREFIX);

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--apply");
  const force = argv.includes("--force");
  const outIdx = argv.indexOf("--out");
  const outDir = outIdx >= 0 ? argv[outIdx + 1] : null;
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || "").split(",").filter(Boolean) : null;

  if (outDir) fs.mkdirSync(outDir, { recursive: true });

  const { rows } = await db.query(
    "SELECT id, slug, title, category, body_md, cover_url FROM public.blog_posts ORDER BY published_at DESC NULLS LAST"
  );
  const posts = only ? rows.filter((p) => only.includes(p.slug)) : rows;

  let made = 0;
  let skipped = 0;

  for (const post of posts) {
    if (post.cover_url && !isAuto(post.cover_url) && !force) {
      console.log(`  pulado (capa própria)  ${post.slug}`);
      skipped++;
      continue;
    }

    const png = await sharp(Buffer.from(buildSvg(post))).png().toBuffer();
    if (outDir) fs.writeFileSync(path.join(outDir, `${post.slug}.png`), png);

    const key = `${AUTO_PREFIX}${post.slug}-${DESIGN_VERSION}.png`;
    const url = `${process.env.R2_PUBLIC_URL}/${key}`;
    const alt = `${post.title} — ${post.category || "Freelandoo"}`;

    if (apply) {
      await r2.send(new PutObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: key,
        Body: png,
        ContentType: "image/png",
        CacheControl: "public, max-age=31536000, immutable",
      }));
      await db.query(
        "UPDATE public.blog_posts SET cover_url = $1, cover_alt = $2, updated_at = NOW() WHERE id = $3",
        [url, alt, post.id]
      );
    }

    console.log(`  ${apply ? "OK  " : "sim "} ${String(Math.round(png.length / 1024)).padStart(3)}KB  ${post.slug}`);
    made++;
  }

  console.log(`\n${apply ? "GRAVADO" : "SIMULAÇÃO (use --apply)"} — ${made} capa(s), ${skipped} pulada(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("FALHOU:", err.message);
  process.exit(1);
});
