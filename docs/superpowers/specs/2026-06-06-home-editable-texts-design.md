# Home: textos editáveis pelo admin — Design

> **Status:** aprovado em brainstorming com Alex (2026-06-06). Espelha o subsistema de imagens
> editáveis ([[project_freelandoo_home_editable_images]]). Aplica-se à home do vendedor (`/`).

## Problema / Objetivo

O admin já troca as imagens das home (`EditableImage`/`tb_site_asset`). Agora quer **editar os
textos** da home do vendedor (`/`) do mesmo jeito: clicar → editar → salvar → persiste e
aparece pra todos. Texto não definido pelo admin mostra o **texto atual (hardcoded) como
fallback**.

## Decisões (cravadas)

- **Escopo:** todos os textos visíveis da home do vendedor (headline, subtítulo, CTAs, títulos
  de seção, kicker/descrição dos cards, rótulos).
- **Destaque amarelo:** sintaxe `*asterisco*` — trechos entre `*...*` viram `YellowHighlight`
  (dourado). Ex.: `"Ganhe com seu *talento*"`. Funciona tanto no fallback quanto no texto que o
  admin salva.
- **UX:** modal com `textarea` (texto puro). Sem `contentEditable` inline.

## Arquitetura — Backend (migration 131)

Espelha `tb_site_asset`:

```sql
CREATE TABLE IF NOT EXISTS public.tb_site_text (
  slot_key    VARCHAR(60)  PRIMARY KEY,
  content     TEXT         NOT NULL,
  updated_by  UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- `GET /site-texts` (público) → `{ texts: { slot_key: content } }`.
- `POST /admin/site-texts/:slot_key` (`authMiddleware` + `roleMiddleware("Administrator")`,
  JSON `{ content }`) → valida slot `home_(buyer|seller)_[a-z0-9_]+` e `content` (string, limite
  ~2000 chars) → upsert → `{ text }`.

Camadas `SiteTextStorage` (listAll, upsert), `SiteTextController`, `siteText.routes.js` +
`siteTextAdmin.routes.js`, montados em `routes/index.js`.

## Arquitetura — Frontend

- `lib/marked-text.tsx` — `renderMarkedText(str, markClassName?)`: divide a string em `*...*` e
  envolve os trechos em `YellowHighlight`/`MarkerText`; o resto vira texto normal. Usado pelo
  `EditableText` (e reaproveitável).
- `components/site-texts/SiteTextsProvider.tsx` — busca `GET /api/site-texts` 1x, provê o map
  `{ slot: content }` + `setText(slot, content)`. Montado no `(landing)/layout.tsx` junto do
  `SiteAssetsProvider`.
- `components/site-texts/EditableText.tsx` (client) — props `slot`, `fallback` (string, pode ter
  `*marcadores*`), `as` (tag, default `span`), `className`, `markClassName?`. Renderiza
  `renderMarkedText(stored ?? fallback)`. Se admin (via `getStoredUser`, detectado em
  `useEffect`): botão de lápis (canto) que abre modal com `textarea` (prefill = stored ??
  fallback) → salvar faz `POST /api/admin/site-texts/:slot` → `setText`.
- `app/api/site-texts/route.ts` (GET) + `app/api/admin/site-texts/[slot]/route.ts` (POST JSON).

## Wiring

Converter os textos da home do vendedor (componentes em `components/home/landing/*` +
`tokens.ts`) para `<EditableText slot fallback>`:
- `HeroSection`: headline, subcopy, labels dos CTAs, rótulos das stats.
- `MoneyPathCards`: título da seção + `kicker`/`desc` de cada caminho (slot por id:
  `home_seller_path_<id>_kicker`/`_desc`).
- `FeatureCarousel` / `FeatureBento`: títulos/descrições visíveis.
- `FinalCTA`: headline + label do botão.

Os fallbacks reusam o texto atual (com `*...*` onde hoje há `YellowHighlight`). Slots seguem
`home_seller_*` (mesmo prefixo aceito no back).

## Data flow

1. Home renderiza; `SiteTextsProvider` busca os textos.
2. `<EditableText>` mostra `texts[slot]` parseado, ou o fallback parseado.
3. Admin clica no lápis → modal textarea → salvar → `POST` → `setText` → atualiza na hora;
   demais visitantes veem no próximo load (público, cache curto).

## Não-objetivos (YAGNI)

- Sem rich text além do `*destaque*` (negrito/itálico/links não).
- Sem i18n por slot (a home é pt-BR).
- Sem histórico/versionamento (só o conteúdo atual por slot).
- Sem editar textos fora da home do vendedor nesta entrega (mecanismo reusável depois).

## Fatiamento

1. **Slice 1** — Backend: mig 131 + Storage/Controller/rotas (`GET /site-texts`,
   `POST /admin/site-texts/:slot`).
2. **Slice 2** — Frontend base: `lib/marked-text.tsx`, proxies, `SiteTextsProvider`,
   `EditableText` (com modal). Montar provider no layout.
3. **Slice 3** — Wiring de todos os textos da home do vendedor.

Cada slice: lint + checagem manual; commit+push por área (back no repo back; front sem
`git add -A`).
