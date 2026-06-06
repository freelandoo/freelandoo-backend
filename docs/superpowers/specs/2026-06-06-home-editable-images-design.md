# Home: polish + imagens editáveis pelo admin — Design

> **Status:** aprovado em brainstorming com Alex (2026-06-06). Backend (mig + endpoints + R2)
> + frontend (componente EditableImage + provider + wiring + polish). Itera a home do
> comprador ([[project_freelandoo_buyer_seller_wedge]]).

## Problema

A home do comprador (entregue no wedge) ficou "pobre" perto da do vendedor: botões sem
dropshadow amarelo sólido nem animação, e **sem nenhum banner/imagem**. Além disso, o Alex
quer poder **trocar qualquer imagem das duas home** (banners e placeholders) clicando nelas,
com o mesmo fluxo de crop da foto de perfil — mas só quando for admin, e a escolha persiste e
aparece pra todos.

## Objetivo

1. **Polish**: botões e cards da home do comprador com dropshadow sólido amarelo
   (`6px 6px 0 #F2B705`) + animação no hover/active, batendo com a identidade da seller.
2. **Banners**: cada home ganha região(ões) de banner.
3. **Imagens editáveis (admin)**: banners e **todos os placeholders de imagem das duas home**
   viram clicáveis pra admin → abre modal de crop (reusa `MediaCropModal`) → troca a imagem →
   upload pro R2 → persiste no banco → aparece pra todo mundo. Slot vazio mostra placeholder
   dourado (pra qualquer visitante).

## Como o fluxo existente funciona (reuso)

- **Crop**: `MediaCropModal` (client) recebe `file`, `aspectRatio`, `outputWidth/Height`,
  `maxSizeMB`, `mediaType`, e devolve um `ProcessedImage` ({file, previewUrl}) já cortado.
- **R2**: helpers dedicados em `src/integrations/r2/*` (ex.: `uploadBlogCover.js`,
  `uploadAvatar.js`). Upload multipart via middleware `uploadAvatar.single("...")`.
- **Admin route**: padrão `[authMiddleware, roleMiddleware("Administrator")]`.
- **Admin no front**: `is_admin || roles?.some(r => r.desc_role === "Administrator")` lido de
  `getStoredUser()` (`lib/auth.ts`).
- **Placeholder dourado**: já existe `PhotoFrame` (primitives) com fallback dourado quando não
  há imagem — a base visual do EditableImage.

## Arquitetura — Backend (migration 130)

```sql
CREATE TABLE IF NOT EXISTS public.tb_site_asset (
  slot_key    VARCHAR(60)  PRIMARY KEY,
  image_url   TEXT         NOT NULL,
  updated_by  UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**Endpoints:**
- `GET /site-assets` (público, sem auth) → `{ assets: { slot_key: image_url } }`. Cacheável
  (revalidate curto). Usado pelas home pra render server-side.
- `POST /admin/site-assets/:slot_key` (`authMiddleware` + `roleMiddleware("Administrator")` +
  `uploadAvatar.single("image")`) → valida `slot_key` contra lista conhecida, sobe o arquivo
  pro R2 prefixo `site-assets/<slot_key>-<ts>.<ext>`, faz upsert em `tb_site_asset`, retorna
  `{ asset: { slot_key, image_url } }`.

Camadas: `SiteAssetStorage` (listAll, upsert), `SiteAssetController`, `siteAsset.routes.js`
(público) + montagem admin. Helper R2 `uploadSiteAsset.js` espelhando `uploadBlogCover.js`.
A lista de `slot_key` válidos vive no controller (set) e espelha o catálogo do front.

## Arquitetura — Frontend

- `lib/site-asset-slots.ts` — catálogo: cada slot `{ key, aspectRatio, outputWidth,
  outputHeight, label, fallbackIcon }`. Fonte única dos slots (back valida contra os mesmos
  keys).
- `app/api/site-assets/route.ts` (GET proxy) e `app/api/admin/site-assets/[slot]/route.ts`
  (POST multipart proxy).
- `components/site-assets/SiteAssetsProvider.tsx` — busca `GET /api/site-assets` 1x, provê o
  map `{ slot: url }` e um `setAsset(slot, url)` pra atualizar após upload do admin.
- `components/site-assets/EditableImage.tsx` (client) — props `slot` (+ `className`). Lê o
  url do provider; renderiza imagem ou placeholder dourado (estilo PhotoFrame). Se admin:
  overlay com botão "Trocar imagem" → seleciona arquivo → `MediaCropModal` (aspect do slot)
  → `compressImageToMaxSize` → `POST /api/admin/site-assets/<slot>` → `setAsset`.
- **Wiring**: banners novos + todos os placeholders de imagem das duas home (`PhotoFrame` da
  seller + imagens novas da buyer) passam a usar `<EditableImage slot=...>`. Os `slot_key`
  exatos são enumerados ao ler os componentes na implementação (ex.: `home_buyer_hero`,
  `home_buyer_*`, `home_seller_hero`, `home_seller_photo_1..N`).

## Polish (parte 1)

- CTAs/cards da home do comprador: aplicar sombra sólida amarela + hover translate. Onde o
  `GoldButton` (sombra preta) não basta, envolver com classe utilitária de sombra amarela ou
  variante. Manter `prefers-reduced-motion` (já tratado no globals).

## Data flow

1. Home renderiza (server ou client) lendo `GET /api/site-assets`.
2. `<EditableImage slot>` mostra `assets[slot]` ou placeholder dourado.
3. Admin clica "Trocar" → crop → upload → `POST /admin/site-assets/:slot` → upsert + R2.
4. Provider atualiza o map → imagem nova aparece na hora; demais visitantes veem no próximo
   load (público, cache curto).

## Não-objetivos (YAGNI)

- Sem biblioteca de mídia/galeria — 1 imagem por slot (substitui a anterior).
- Sem versionamento/histórico de imagens.
- Sem editar imagens fora das duas home nesta entrega (o mecanismo é genérico e reusável
  depois).
- Sem deletar slot (trocar substitui; placeholder dourado cobre o vazio).

## Fatiamento

1. **Slice 1** — Backend: mig 130 + `uploadSiteAsset.js` + Storage/Controller/rotas
   (`GET /site-assets`, `POST /admin/site-assets/:slot`).
2. **Slice 2** — Frontend base: catálogo `lib/site-asset-slots.ts`, proxies, `SiteAssetsProvider`,
   `<EditableImage>`. Montar provider no layout das home.
3. **Slice 3** — Polish da home do comprador (sombra amarela + animação) + banner(s)
   editável(is) nas duas home via `<EditableImage>`.
4. **Slice 4** — Converter os placeholders de imagem restantes (PhotoFrames da seller +
   imagens da buyer) em `<EditableImage>` com seus slots.

Cada slice: lint + checagem manual; commit+push por área (back no repo back; front sem
`git add -A`).
