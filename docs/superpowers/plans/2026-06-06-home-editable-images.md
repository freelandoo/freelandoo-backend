# Home: polish + imagens editáveis pelo admin — Implementation Plan

> **For agentic workers:** Steps use `- [ ]`. Sem testes automatizados — verificação =
> `npx eslint` / lint backend + checagem manual. Commit+push por slice (migration no commit do
> código). **Frontend sem `git add -A`** (WIP paralelo).

**Goal:** Banners e todos os placeholders das duas home viram `<EditableImage>` (admin clica →
crop → R2 → persiste → todos veem); + polish (sombra amarela/animação) na home do comprador.

**Architecture:** Backend `tb_site_asset` (slot→url) + `GET /site-assets` (público) +
`POST /admin/site-assets/:slot` (admin, R2). Frontend `SiteAssetsProvider` + `<EditableImage>`
reusando `MediaCropModal`. Slot vazio = placeholder dourado.

**Spec:** `docs/superpowers/specs/2026-06-06-home-editable-images-design.md`

---

## Slice 1 — Backend: tb_site_asset + endpoints + R2

**Files (repo freelandoo-backend):**
- Create: `src/databases/migrations/130_site_asset.sql`, `src/integrations/r2/uploadSiteAsset.js`,
  `src/storages/SiteAssetStorage.js`, `src/controllers/SiteAssetController.js`,
  `src/routes/siteAsset.routes.js`, `src/routes/siteAssetAdmin.routes.js`
- Modify: `src/routes/index.js`

- [ ] **Step 1: Migration** — `130_site_asset.sql`:

```sql
-- Migration 130: imagens editáveis das home (slot -> url no R2). Idempotente.
CREATE TABLE IF NOT EXISTS public.tb_site_asset (
  slot_key    VARCHAR(60)  PRIMARY KEY,
  image_url   TEXT         NOT NULL,
  updated_by  UUID         REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

- [ ] **Step 2: R2 helper** — `src/integrations/r2/uploadSiteAsset.js` (espelha uploadBlogCover):

```js
const { PutObjectCommand } = require("@aws-sdk/client-s3");
const crypto = require("crypto");
const r2 = require("../../services/r2Client");
const { createLogger } = require("../../utils/logger");

const log = createLogger("r2.uploadSiteAsset");

function getFileExt(originalname = "") {
  const parts = originalname.split(".");
  return (parts.length > 1 ? parts.pop() : "bin").toLowerCase();
}

module.exports = async function uploadSiteAssetToR2({ file, slotKey }) {
  log.info("upload.start", { slotKey, mimetype: file?.mimetype });
  const fileExt = getFileExt(file.originalname);
  const safeSlot = String(slotKey).replace(/[^a-z0-9_-]/gi, "");
  const fileName = `site-assets/${safeSlot}-${crypto.randomUUID()}.${fileExt}`;
  await r2.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: fileName,
      Body: file.buffer,
      ContentType: file.mimetype,
    })
  );
  const url = `${process.env.R2_PUBLIC_URL}/${fileName}`;
  log.info("upload.ok", { key: fileName });
  return url;
};
```

- [ ] **Step 3: Storage** — `src/storages/SiteAssetStorage.js`:

```js
class SiteAssetStorage {
  static async listAll(conn) {
    const r = await conn.query(`SELECT slot_key, image_url FROM public.tb_site_asset`);
    const map = {};
    for (const row of r.rows) map[row.slot_key] = row.image_url;
    return map;
  }

  static async upsert(conn, { slot_key, image_url, updated_by }) {
    const r = await conn.query(
      `INSERT INTO public.tb_site_asset (slot_key, image_url, updated_by, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (slot_key) DO UPDATE
         SET image_url = EXCLUDED.image_url, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING slot_key, image_url`,
      [slot_key, image_url, updated_by || null]
    );
    return r.rows[0];
  }
}
module.exports = SiteAssetStorage;
```

- [ ] **Step 4: Controller** — `src/controllers/SiteAssetController.js`:

```js
const pool = require("../databases");
const SiteAssetStorage = require("../storages/SiteAssetStorage");
const uploadSiteAssetToR2 = require("../integrations/r2/uploadSiteAsset");

// slots válidos — espelha lib/site-asset-slots.ts do front. Mantém em sincronia.
const VALID_SLOTS = new Set([
  "home_buyer_hero",
  "home_seller_hero",
]);

module.exports = {
  // Permite registrar slots adicionais sem editar o controller a cada wiring novo:
  // aceita qualquer slot com prefixo home_ (buyer/seller) além do set acima.
  isValidSlot(slot) {
    return VALID_SLOTS.has(slot) || /^home_(buyer|seller)_[a-z0-9_]+$/.test(slot);
  },

  async listPublic(req, res) {
    const assets = await SiteAssetStorage.listAll(pool);
    return res.json({ assets });
  },

  async upload(req, res) {
    const slot_key = String(req.params.slot_key || "").trim();
    if (!module.exports.isValidSlot(slot_key)) {
      return res.status(400).json({ error: "slot inválido" });
    }
    if (!req.file) return res.status(400).json({ error: "imagem não enviada" });
    const image_url = await uploadSiteAssetToR2({ file: req.file, slotKey: slot_key });
    const asset = await SiteAssetStorage.upsert(pool, {
      slot_key,
      image_url,
      updated_by: req.user.id_user,
    });
    return res.status(201).json({ asset });
  },
};
```

- [ ] **Step 5: Rotas** — público `src/routes/siteAsset.routes.js`:

```js
const { Router } = require("express");
const SiteAssetController = require("../controllers/SiteAssetController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
router.get("/", asyncHandler(SiteAssetController.listPublic));
module.exports = router;
```

admin `src/routes/siteAssetAdmin.routes.js`:

```js
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const roleMiddleware = require("../middlewares/roleMiddleware");
const uploadAvatar = require("../middlewares/uploadAvatar");
const SiteAssetController = require("../controllers/SiteAssetController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();
const admin = [authMiddleware, roleMiddleware("Administrator")];
router.post("/:slot_key", ...admin, uploadAvatar.single("image"), asyncHandler(SiteAssetController.upload));
module.exports = router;
```

- [ ] **Step 6: Montar no index** — `src/routes/index.js`: require + mount:

```js
const siteAssetRoutes = require("./siteAsset.routes");
const siteAssetAdminRoutes = require("./siteAssetAdmin.routes");
```
```js
  app.use("/site-assets", siteAssetRoutes);
  app.use("/admin/site-assets", siteAssetAdminRoutes);
```

- [ ] **Step 7: Lint + commit + push**

Run: `npx eslint src/integrations/r2/uploadSiteAsset.js src/storages/SiteAssetStorage.js src/controllers/SiteAssetController.js src/routes/siteAsset.routes.js src/routes/siteAssetAdmin.routes.js src/routes/index.js`
```bash
git add src/databases/migrations/130_site_asset.sql src/integrations/r2/uploadSiteAsset.js src/storages/SiteAssetStorage.js src/controllers/SiteAssetController.js src/routes/siteAsset.routes.js src/routes/siteAssetAdmin.routes.js src/routes/index.js
git commit -m "feat(site-assets): slice 1 — tb_site_asset + GET /site-assets + POST /admin/site-assets/:slot (R2)"
git push origin main
```

---

## Slice 2 — Frontend base: catálogo + provider + EditableImage

**Files (repo frontend):**
- Create: `lib/site-asset-slots.ts`, `app/api/site-assets/route.ts`,
  `app/api/admin/site-assets/[slot]/route.ts`, `components/site-assets/SiteAssetsProvider.tsx`,
  `components/site-assets/EditableImage.tsx`
- Modify: `app/(landing)/layout.tsx` (montar provider)

- [ ] **Step 1: Catálogo** — `lib/site-asset-slots.ts`:

```ts
export interface SiteAssetSlot {
  key: string
  aspectRatio: number
  outputWidth: number
  outputHeight: number
  label: string
}

export const SITE_ASSET_SLOTS: Record<string, SiteAssetSlot> = {
  home_buyer_hero: { key: "home_buyer_hero", aspectRatio: 16 / 5, outputWidth: 1600, outputHeight: 500, label: "Banner — home do comprador" },
  home_seller_hero: { key: "home_seller_hero", aspectRatio: 16 / 5, outputWidth: 1600, outputHeight: 500, label: "Banner — home do vendedor" },
}

/** Registra um slot em runtime (pra placeholders convertidos no slice 4). */
export function slotDef(key: string, fallback?: Partial<SiteAssetSlot>): SiteAssetSlot {
  return (
    SITE_ASSET_SLOTS[key] || {
      key,
      aspectRatio: fallback?.aspectRatio ?? 1,
      outputWidth: fallback?.outputWidth ?? 1000,
      outputHeight: fallback?.outputHeight ?? 1000,
      label: fallback?.label ?? "Imagem",
    }
  )
}
```

- [ ] **Step 2: Proxies** — `app/api/site-assets/route.ts` (GET) e
  `app/api/admin/site-assets/[slot]/route.ts` (POST multipart). GET espelha o padrão de
  `app/api/me/consents/route.ts` (sem auth, retorna `{assets:{}}` em timeout). POST encaminha
  `Authorization` + repassa o `FormData` (body como stream / `await request.formData()` e
  re-montar) pro backend `/admin/site-assets/:slot`. (Conferir helper de proxy multipart
  existente — ex.: rotas de upload de avatar/portfolio em `app/api/**` que repassam FormData.)

GET:
```ts
import { getBackendApiUrl } from "@/lib/backend"
import { fetchWithTimeout, readBodyWithTimeout, isFetchTimeout } from "@/lib/server-fetch"

const BACKEND = getBackendApiUrl()

export async function GET() {
  try {
    const res = await fetchWithTimeout(`${BACKEND}/site-assets`, { method: "GET", cache: "no-store" }, 2500)
    const text = await readBodyWithTimeout(res, 1500)
    return Response.json(text ? JSON.parse(text) : { assets: {} }, { status: res.status })
  } catch (e) {
    if (isFetchTimeout(e)) return Response.json({ assets: {}, timeout: true }, { status: 200 })
    return Response.json({ assets: {} }, { status: 200 })
  }
}
```

POST (`[slot]/route.ts`) — repassa multipart:
```ts
import { getBackendApiUrl } from "@/lib/backend"

const BACKEND = getBackendApiUrl()

export async function POST(request: Request, ctx: { params: Promise<{ slot: string }> }) {
  const { slot } = await ctx.params
  const authHeader = request.headers.get("Authorization")
  if (!authHeader) return Response.json({ error: "Token não fornecido" }, { status: 401 })
  const form = await request.formData()
  const res = await fetch(`${BACKEND}/admin/site-assets/${encodeURIComponent(slot)}`, {
    method: "POST",
    headers: { Authorization: authHeader },
    body: form,
    cache: "no-store",
  })
  const text = await res.text()
  return new Response(text || "{}", {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  })
}
```

- [ ] **Step 3: Provider** — `components/site-assets/SiteAssetsProvider.tsx`:

```tsx
"use client"

import { createContext, useContext, useEffect, useState, useCallback } from "react"

interface SiteAssetsValue {
  assets: Record<string, string>
  setAsset: (slot: string, url: string) => void
}

const Ctx = createContext<SiteAssetsValue | null>(null)

export function useSiteAssets() {
  const v = useContext(Ctx)
  if (!v) throw new Error("useSiteAssets fora do SiteAssetsProvider")
  return v
}

export function SiteAssetsProvider({ children }: { children: React.ReactNode }) {
  const [assets, setAssets] = useState<Record<string, string>>({})

  useEffect(() => {
    fetch("/api/site-assets", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.assets) setAssets(d.assets)
      })
      .catch(() => {})
  }, [])

  const setAsset = useCallback((slot: string, url: string) => {
    setAssets((prev) => ({ ...prev, [slot]: url }))
  }, [])

  return <Ctx.Provider value={{ assets, setAsset }}>{children}</Ctx.Provider>
}
```

- [ ] **Step 4: EditableImage** — `components/site-assets/EditableImage.tsx`:

```tsx
"use client"

import { useState } from "react"
import { ImagePlus } from "lucide-react"
import { MediaCropModal } from "@/components/media/media-crop-modal"
import { type ProcessedImage } from "@/lib/media/image-processing"
import { slotDef, type SiteAssetSlot } from "@/lib/site-asset-slots"
import { useSiteAssets } from "./SiteAssetsProvider"
import { getStoredUser } from "@/lib/auth"
import { cn } from "@/lib/utils"

function isAdmin(): boolean {
  const u = getStoredUser()
  return !!(u?.is_admin || u?.roles?.some((r) => r.desc_role === "Administrator"))
}

export function EditableImage({
  slot,
  className,
  slotConfig,
  fallback,
}: {
  slot: string
  className?: string
  slotConfig?: Partial<SiteAssetSlot>
  fallback?: React.ReactNode
}) {
  const { assets, setAsset } = useSiteAssets()
  const def = slotDef(slot, slotConfig)
  const [admin] = useState(isAdmin)
  const [cropFile, setCropFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const url = assets[slot]

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (f) setCropFile(f)
  }

  async function onCropConfirm(image: ProcessedImage) {
    setCropFile(null)
    setUploading(true)
    try {
      const token = localStorage.getItem("token")
      const fd = new FormData()
      fd.append("image", image.file, "asset.webp")
      const res = await fetch(`/api/admin/site-assets/${slot}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      })
      const data = await res.json()
      if (res.ok && data?.asset?.image_url) setAsset(slot, data.asset.image_url)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" />
      ) : (
        fallback ?? (
          <div className="flex h-full w-full items-center justify-center bg-[#1D1810]">
            <ImagePlus className="h-8 w-8 text-[#F2B705]/40" />
          </div>
        )
      )}

      {admin && (
        <>
          <label className="absolute inset-0 z-10 flex cursor-pointer items-center justify-center gap-2 bg-black/0 text-sm font-bold text-transparent transition hover:bg-black/45 hover:text-white">
            <ImagePlus className="h-5 w-5" />
            {uploading ? "Enviando…" : "Trocar imagem"}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPick} disabled={uploading} />
          </label>
          {cropFile && (
            <MediaCropModal
              file={cropFile}
              aspectRatio={def.aspectRatio}
              outputWidth={def.outputWidth}
              outputHeight={def.outputHeight}
              maxSizeMB={3}
              mediaType="post_image"
              title={`Cortar: ${def.label}`}
              description="Ajuste o enquadramento da imagem."
              onCancel={() => setCropFile(null)}
              onConfirm={onCropConfirm}
            />
          )}
        </>
      )}
    </div>
  )
}
```

(Conferir a assinatura real de `MediaCropModal` — props usadas na página de clan: `file`,
`aspectRatio`, `outputWidth`, `outputHeight`, `maxSizeMB`, `mediaType`, `title`, `description`,
`onCancel`, `onConfirm(ProcessedImage)`.)

- [ ] **Step 5: Montar provider** — em `app/(landing)/layout.tsx`, envolver `{children}` com
  `<SiteAssetsProvider>` (junto do AudienceChooserModal):

```tsx
import { SiteAssetsProvider } from "@/components/site-assets/SiteAssetsProvider"
// ...
    <div className="fl-root fl-paper-texture flex min-h-[100dvh] flex-col font-sans antialiased">
      <SiteAssetsProvider>
        {children}
        <AudienceChooserModal />
      </SiteAssetsProvider>
    </div>
```

- [ ] **Step 6: Lint + commit + push**

```bash
git add "lib/site-asset-slots.ts" "app/api/site-assets/route.ts" "app/api/admin/site-assets/" "components/site-assets/" "app/(landing)/layout.tsx"
git commit -m "feat(site-assets): slice 2 — provider + EditableImage + catálogo + proxies"
git push origin main
```

---

## Slice 3 — Polish da home do comprador + banners editáveis nas 2 home

**Files:** `components/home/landing/buyer/BuyerHero.tsx`, `BuyerFinalCTA.tsx` (e/ou um
`BuyerBanner.tsx` novo), `app/(landing)/ganhar/page.tsx`, `app/(landing)/page.tsx`.

- [ ] **Step 1: Sombra amarela + animação nos CTAs/cards do comprador**

Aplicar nos botões/cards da buyer home a sombra sólida amarela e hover translate. Ex.: nos
cards de `BuyerHowItWorks`/`BuyerTrust` já há `shadow-[6px_6px_0_0_#F2B705]` no hover —
garantir consistência; nos CTAs (`GoldButton`) envolver com classe
`shadow-[5px_5px_0_0_#F2B705] hover:shadow-[7px_7px_0_0_#F2B705] hover:-translate-y-0.5 transition`
ou criar wrapper. Conferir no navegador.

- [ ] **Step 2: Banner editável na home do comprador**

Em `BuyerHero` (ou novo `BuyerBanner`), adicionar `<EditableImage slot="home_buyer_hero"
className="aspect-[16/5] w-full rounded-xl border-2 border-[#0B0B0D] shadow-[6px_6px_0_0_#F2B705]" />`
abaixo do hero/busca.

- [ ] **Step 3: Banner editável na home do vendedor**

Em `app/(landing)/ganhar/page.tsx`, inserir `<EditableImage slot="home_seller_hero" .../>` em
posição equivalente (topo do main, abaixo do header).

- [ ] **Step 4: Lint + checagem manual + commit + push**

Logar como admin → banner mostra "Trocar imagem" → crop → aparece. Não-admin vê imagem ou
placeholder dourado. Botões com sombra amarela + animação.

```bash
git add "components/home/landing/buyer/" "app/(landing)/ganhar/page.tsx" "app/(landing)/page.tsx"
git commit -m "feat(site-assets): slice 3 — polish (sombra amarela/animação) + banners editáveis nas 2 home"
git push origin main
```

---

## Slice 4 — Converter os placeholders restantes em EditableImage

**Files:** componentes da seller com `PhotoFrame` (`components/home/landing/HeroSection.tsx`,
`FeatureBento.tsx`, `FeatureCarousel.tsx`, `MoneyPathCards.tsx` — os que tiverem) + imagens da
buyer.

- [ ] **Step 1: Enumerar os PhotoFrame/placeholders**

`grep -rn "PhotoFrame" components/home/landing` e listar cada ocorrência com seu aspect.

- [ ] **Step 2: Converter cada um em `<EditableImage slot="home_seller_photo_N" slotConfig={{aspectRatio: ...}} />`**

Substituir `PhotoFrame` por `EditableImage` mantendo o `className`/aspect. Dar slots únicos e
descritivos (`home_seller_hero_main`, `home_seller_bento_1`, etc.). Idem pra imagens novas da
buyer, se houver além do banner.

- [ ] **Step 3: Lint + checagem manual + commit + push**

```bash
git add "components/home/landing/"
git commit -m "feat(site-assets): slice 4 — placeholders das home viram EditableImage (admin troca)"
git push origin main
```

---

## Self-Review (cobertura do spec)

- tb_site_asset + GET público + POST admin R2 → slice 1 ✅
- Catálogo + provider + EditableImage (crop reusado, admin-only, placeholder dourado) → slice 2 ✅
- Polish sombra amarela/animação → slice 3 ✅
- Banners editáveis nas 2 home → slice 3 ✅
- Todos os placeholders editáveis → slice 4 ✅
- Slot vazio = placeholder dourado p/ qualquer um → EditableImage fallback ✅
- Admin = is_admin || roles Administrator → EditableImage ✅

## Pontos a confirmar na execução

- Padrão de proxy multipart no Next (repassar FormData) — usar `request.formData()` + reenviar.
- Assinatura exata de `MediaCropModal` e `ProcessedImage`.
- Lista real de `PhotoFrame` na seller (slice 4).
- `roleMiddleware` aceita `"Administrator"` (confirmado em manifestationAdmin.routes.js).
```
