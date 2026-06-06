# Home: textos editáveis pelo admin — Implementation Plan

> **For agentic workers:** `- [ ]` steps. Sem testes — verificação = lint + manual. Commit+push
> por slice (migration no commit do código). Frontend sem `git add -A`.

**Goal:** Textos da home do vendedor editáveis pelo admin (clica → modal textarea → salva →
persiste; público vê). `*asterisco*` vira destaque amarelo. Fallback = texto atual.

**Architecture:** Espelha o site-asset. Backend `tb_site_text` + `GET /site-texts` +
`POST /admin/site-texts/:slot`. Frontend `SiteTextsProvider` + `<EditableText>` + parser
`renderMarkedText`.

**Spec:** `docs/superpowers/specs/2026-06-06-home-editable-texts-design.md`

---

## Slice 1 — Backend (mig 131 + endpoints)

**Files (repo backend):** Create `src/databases/migrations/131_site_text.sql`,
`src/storages/SiteTextStorage.js`, `src/controllers/SiteTextController.js`,
`src/routes/siteText.routes.js`, `src/routes/siteTextAdmin.routes.js`. Modify
`src/routes/index.js`.

- [ ] **Step 1: Migration** `131_site_text.sql`:

```sql
-- Migration 131: textos editáveis das home (slot -> conteúdo). Idempotente.
CREATE TABLE IF NOT EXISTS public.tb_site_text (
  slot_key    VARCHAR(60)  PRIMARY KEY,
  content     TEXT         NOT NULL,
  updated_by  UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: Storage** `SiteTextStorage.js` (mesma forma do SiteAssetStorage):

```js
class SiteTextStorage {
  static async listAll(conn) {
    const r = await conn.query(`SELECT slot_key, content FROM public.tb_site_text`);
    const map = {};
    for (const row of r.rows) map[row.slot_key] = row.content;
    return map;
  }
  static async upsert(conn, { slot_key, content, updated_by }) {
    const r = await conn.query(
      `INSERT INTO public.tb_site_text (slot_key, content, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (slot_key) DO UPDATE
         SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING slot_key, content`,
      [slot_key, content, updated_by || null]
    );
    return r.rows[0];
  }
}
module.exports = SiteTextStorage;
```

- [ ] **Step 3: Controller** `SiteTextController.js`:

```js
const pool = require("../databases");
const SiteTextStorage = require("../storages/SiteTextStorage");

function isValidSlot(slot) {
  return /^home_(buyer|seller)_[a-z0-9_]+$/.test(slot);
}

module.exports = {
  async listPublic(req, res) {
    const texts = await SiteTextStorage.listAll(pool);
    return res.json({ texts });
  },
  async upsert(req, res) {
    const slot_key = String(req.params.slot_key || "").trim();
    if (!isValidSlot(slot_key)) return res.status(400).json({ error: "slot inválido" });
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    if (!content.trim()) return res.status(400).json({ error: "conteúdo vazio" });
    if (content.length > 2000) return res.status(400).json({ error: "conteúdo muito longo" });
    const text = await SiteTextStorage.upsert(pool, {
      slot_key,
      content,
      updated_by: req.user.id_user,
    });
    return res.status(201).json({ text });
  },
};
```

- [ ] **Step 4: Rotas** — público `siteText.routes.js` (GET `/`) e admin
  `siteTextAdmin.routes.js` (POST `/:slot_key` com `[authMiddleware, roleMiddleware("Administrator")]`).
  (Mesma forma de `siteAsset*.routes.js`, mas o POST é JSON — sem `uploadAvatar`.)

- [ ] **Step 5: Montar** em `src/routes/index.js`:

```js
const siteTextRoutes = require("./siteText.routes");
const siteTextAdminRoutes = require("./siteTextAdmin.routes");
```
```js
  app.use("/site-texts", siteTextRoutes);
  app.use("/admin/site-texts", siteTextAdminRoutes);
```

- [ ] **Step 6: Lint + commit + push** (`feat(site-texts): slice 1 — tb_site_text + endpoints`).

---

## Slice 2 — Frontend base (parser + provider + EditableText)

**Files (repo frontend):** Create `lib/marked-text.tsx`, `app/api/site-texts/route.ts`,
`app/api/admin/site-texts/[slot]/route.ts`, `components/site-texts/SiteTextsProvider.tsx`,
`components/site-texts/EditableText.tsx`. Modify `app/(landing)/layout.tsx`.

- [ ] **Step 1: Parser** `lib/marked-text.tsx`:

```tsx
import { Fragment, type ReactNode } from "react"
import { YellowHighlight } from "@/components/home/landing/primitives"

/** Converte `*trecho*` em destaque amarelo; resto vira texto normal. */
export function renderMarkedText(input: string, mark = true): ReactNode {
  const parts = input.split(/(\*[^*]+\*)/g)
  return parts.map((part, i) => {
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) {
      const inner = part.slice(1, -1)
      return (
        <YellowHighlight key={i} mark={mark}>
          {inner}
        </YellowHighlight>
      )
    }
    return <Fragment key={i}>{part}</Fragment>
  })
}
```

- [ ] **Step 2: Proxies** — `app/api/site-texts/route.ts` (GET, espelha
  `app/api/site-assets/route.ts`, retorna `{ texts: {} }` em timeout) e
  `app/api/admin/site-texts/[slot]/route.ts` (POST JSON, repassa Authorization + body pro
  `/admin/site-texts/:slot`).

POST:
```ts
import { getBackendApiUrl } from "@/lib/backend"
const BACKEND = getBackendApiUrl()
export async function POST(request: Request, ctx: { params: Promise<{ slot: string }> }) {
  const { slot } = await ctx.params
  const authHeader = request.headers.get("Authorization")
  if (!authHeader) return Response.json({ error: "Token não fornecido" }, { status: 401 })
  const body = await request.text()
  const res = await fetch(`${BACKEND}/admin/site-texts/${encodeURIComponent(slot)}`, {
    method: "POST",
    headers: { Authorization: authHeader, "Content-Type": "application/json" },
    body,
    cache: "no-store",
  })
  const text = await res.text()
  return new Response(text || "{}", { status: res.status, headers: { "Content-Type": "application/json" } })
}
```

- [ ] **Step 3: Provider** `SiteTextsProvider.tsx` — igual ao `SiteAssetsProvider`, mas
  `texts`/`setText` e busca `/api/site-texts` (`d.texts`).

- [ ] **Step 4: EditableText** `components/site-texts/EditableText.tsx`:

```tsx
"use client"

import { useEffect, useState, createElement, type ElementType } from "react"
import { Pencil } from "lucide-react"
import { renderMarkedText } from "@/lib/marked-text"
import { useSiteTexts } from "./SiteTextsProvider"
import { getStoredUser } from "@/lib/auth"
import { cn } from "@/lib/utils"

function checkAdmin(): boolean {
  const u = getStoredUser()
  return !!(u?.is_admin || u?.roles?.some((r) => r.desc_role === "Administrator"))
}

export function EditableText({
  slot,
  fallback,
  as = "span",
  className,
  mark = true,
}: {
  slot: string
  fallback: string
  as?: ElementType
  className?: string
  mark?: boolean
}) {
  const { texts, setText } = useSiteTexts()
  const [admin, setAdmin] = useState(false)
  useEffect(() => setAdmin(checkAdmin()), [])
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)

  const value = texts[slot] ?? fallback

  function openEditor() {
    setDraft(value)
    setEditing(true)
  }

  async function save() {
    setSaving(true)
    try {
      const token = localStorage.getItem("token")
      const res = await fetch(`/api/admin/site-texts/${slot}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ content: draft }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.text?.content != null) {
        setText(slot, data.text.content)
        setEditing(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const content = renderMarkedText(value, mark)

  if (!admin) {
    return createElement(as, { className }, content)
  }

  return createElement(
    as,
    { className: cn("group/edit relative", className) },
    content,
    <button
      key="edit"
      type="button"
      onClick={openEditor}
      className="absolute -right-2 -top-2 z-10 hidden rounded-full border-2 border-[#0B0B0D] bg-[#F2B705] p-1 text-[#0B0B0D] shadow-[2px_2px_0_0_#0B0B0D] group-hover/edit:inline-flex"
      aria-label="Editar texto"
    >
      <Pencil className="h-3 w-3" />
    </button>,
    editing && (
      <span
        key="modal"
        className="fixed inset-0 z-[140] flex items-center justify-center bg-black/55 p-4"
        onClick={() => setEditing(false)}
        role="presentation"
      >
        <span
          className="fl-root fl-paper-card block w-full max-w-md rounded-2xl border-2 border-[#0B0B0D] p-5 shadow-[10px_10px_0_0_#0B0B0D]"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="mb-2 block text-sm font-bold text-[#0B0B0D]">Editar texto</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={4}
            className="w-full resize-y border-2 border-[#0B0B0D] bg-white p-2 text-sm text-[#0B0B0D] outline-none"
          />
          <span className="mt-1 block text-[11px] text-[#5b554b]">
            Use *asteriscos* para destacar em amarelo.
          </span>
          <span className="mt-3 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-full border-2 border-[#0B0B0D] px-3 py-1.5 text-xs font-bold text-[#0B0B0D]"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !draft.trim()}
              className="rounded-full bg-[#F2B705] px-4 py-1.5 text-xs font-bold text-[#1A1505] disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </span>
        </span>
      </span>
    ),
  )
}
```

(Nota: o modal usa `<span>` com display block pra ser válido dentro de qualquer `as` —
inclusive `<h1>`/`<p>` — sem hidratar `<div>` dentro de parágrafo. Conferir no navegador.)

- [ ] **Step 5: Montar provider** no `app/(landing)/layout.tsx`: aninhar
  `<SiteTextsProvider>` dentro do `<SiteAssetsProvider>` (ambos cobrem as home).

- [ ] **Step 6: Lint + commit + push** (`feat(site-texts): slice 2 — provider + EditableText + parser`).

---

## Slice 3 — Wiring dos textos da home do vendedor

**Files:** `components/home/landing/HeroSection.tsx`, `MoneyPathCards.tsx`,
`FeatureCarousel.tsx`, `FeatureBento.tsx`, `FinalCTA.tsx` (e ler `tokens.ts` p/ os textos).

- [ ] **Step 1: Enumerar os textos** — abrir cada componente, listar strings visíveis e seus
  contextos (headline, subcopy, CTA, títulos, kicker/desc, labels).

- [ ] **Step 2: Converter cada texto** em `<EditableText slot="home_seller_<area>_<campo>"
  as="<tag>" className="<as classes atuais>" fallback="<texto atual, com *...* onde havia
  YellowHighlight>" />`. Para CTAs (`GoldButton`/`OutlineButton`) cujo filho é texto, envolver o
  label com EditableText `as="span"`. Headlines que usavam `<YellowHighlight mark>palavra</...>`
  viram fallback `"... *palavra* ..."`.

- [ ] **Step 3: Lint + checagem manual** — admin vê lápis ao passar o mouse; edita; *destaque*
  aparece dourado; não-admin só vê o texto.

- [ ] **Step 4: Commit + push** (`feat(site-texts): slice 3 — textos da home do vendedor editáveis`).

---

## Self-Review (cobertura do spec)

- tb_site_text + GET público + POST admin → slice 1 ✅
- Parser `*destaque*` → slice 2 (renderMarkedText) ✅
- Provider + EditableText (fallback, admin-only, modal textarea) → slice 2 ✅
- Todos os textos da home do vendedor → slice 3 ✅
- Sintaxe asterisco no fallback e no salvo → renderMarkedText sempre parseia ✅

## Pontos a confirmar na execução

- Validade de aninhar o modal dentro de `h1`/`p` (usar spans block; senão portal/condicional
  fora do elemento).
- Lista real de textos por componente (slice 3).
- `YellowHighlight` aceita `mark` (sim — primitives).
```
