# Termos de Etapa (Consent Gates) — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax. Sem suíte de testes
> automatizados — verificação por slice: (1) `npx eslint <arquivos>` / lint backend sem erro,
> (2) migration idempotente aplica no boot, (3) checagem manual de endpoint/UI. Commit + push
> por slice (migration no mesmo commit do código). **Frontend sem `git add -A`** (WIP paralelo).

**Goal:** Gate de consentimento versionado em ações críticas (publicar, vender, comprar,
afiliar) — aparece 1x, aceite grava server-side com data/IP/UA, recusa bloqueia.

**Architecture:** Backend = tabela `tb_user_action_consent` + `GET/POST /me/consents`
(controller→storage, SQL puro). Frontend = `ConsentProvider` (carrega aceites 1x) + hook
`useActionConsent().ensureConsent(key)` chamado no início de cada handler + `<ActionConsentModal/>`
único. Catálogo de textos/versões em `lib/action-consents.ts`.

**Tech Stack:** Express 5 + pg (backend), Next.js 16 App Router + framer-motion (frontend).

**Spec:** `docs/superpowers/specs/2026-06-06-action-consent-gates-design.md`

---

## File Structure

**Backend (repo `freelandoo-backend`):**
- Create: `src/databases/migrations/129_user_action_consent.sql`
- Create: `src/storages/ConsentStorage.js`
- Create: `src/controllers/ConsentController.js`
- Create: `src/routes/consent.routes.js`
- Modify: `src/routes/index.js` (mount `/me/consents`)

**Frontend (repo `freelandoo frontend/freelandoo-website-main`):**
- Create: `app/api/me/consents/route.ts` (proxy GET+POST)
- Create: `lib/action-consents.ts` (catálogo + versões + textos)
- Create: `components/consent/ConsentProvider.tsx`
- Create: `hooks/use-action-consent.ts`
- Create: `components/consent/ActionConsentModal.tsx`
- Modify: providers de topo (montar `ConsentProvider`)
- Modify (slices 3–4): handlers dos gatilhos.

---

## Slice 1 — Backend: tabela + endpoints `/me/consents`

**Files:**
- Create: `src/databases/migrations/129_user_action_consent.sql`, `src/storages/ConsentStorage.js`,
  `src/controllers/ConsentController.js`, `src/routes/consent.routes.js`
- Modify: `src/routes/index.js`

- [ ] **Step 1: Migration**

Create `src/databases/migrations/129_user_action_consent.sql`:

```sql
-- =============================================================================
-- Migration 129: Aceite de termos por ação crítica (consent gates)
-- =============================================================================
-- Guarda o aceite mais recente por (usuário, ação), com versão e prova (ip/ua).
-- PK composta = upsert atualiza versão/data. Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_user_action_consent (
  id_user        UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  action_key     VARCHAR(40)  NOT NULL,
  terms_version  INT          NOT NULL,
  accepted_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  ip             VARCHAR(64),
  user_agent     TEXT,
  PRIMARY KEY (id_user, action_key)
);
```

- [ ] **Step 2: Storage**

Create `src/storages/ConsentStorage.js`:

```js
class ConsentStorage {
  static async listForUser(conn, id_user) {
    const r = await conn.query(
      `SELECT action_key, terms_version FROM public.tb_user_action_consent WHERE id_user = $1`,
      [id_user]
    );
    const map = {};
    for (const row of r.rows) map[row.action_key] = row.terms_version;
    return map;
  }

  static async upsert(conn, { id_user, action_key, terms_version, ip, user_agent }) {
    const r = await conn.query(
      `INSERT INTO public.tb_user_action_consent
         (id_user, action_key, terms_version, accepted_at, ip, user_agent)
       VALUES ($1, $2, $3, NOW(), $4, $5)
       ON CONFLICT (id_user, action_key) DO UPDATE
         SET terms_version = EXCLUDED.terms_version,
             accepted_at   = NOW(),
             ip            = EXCLUDED.ip,
             user_agent    = EXCLUDED.user_agent
       RETURNING action_key, terms_version, accepted_at`,
      [id_user, action_key, terms_version, ip || null, user_agent || null]
    );
    return r.rows[0];
  }
}

module.exports = ConsentStorage;
```

- [ ] **Step 3: Controller**

Create `src/controllers/ConsentController.js`:

```js
const pool = require("../databases");
const ConsentStorage = require("../storages/ConsentStorage");

// Ações conhecidas — recusa qualquer chave fora desta lista.
const VALID_ACTIONS = new Set(["publish_content", "publish_offer", "purchase", "affiliate"]);

module.exports = {
  async listMine(req, res) {
    const consents = await ConsentStorage.listForUser(pool, req.user.id_user);
    return res.json({ consents });
  },

  async accept(req, res) {
    const action_key = String(req.body?.action_key || "").trim();
    const terms_version = Number(req.body?.terms_version);
    if (!VALID_ACTIONS.has(action_key)) {
      return res.status(400).json({ error: "action_key inválido" });
    }
    if (!Number.isInteger(terms_version) || terms_version < 1) {
      return res.status(400).json({ error: "terms_version inválido" });
    }
    const ip =
      (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
      req.ip ||
      null;
    const user_agent = (req.headers["user-agent"] || "").toString().slice(0, 1000) || null;
    const consent = await ConsentStorage.upsert(pool, {
      id_user: req.user.id_user,
      action_key,
      terms_version,
      ip,
      user_agent,
    });
    return res.status(201).json({ consent });
  },
};
```

- [ ] **Step 4: Rotas**

Create `src/routes/consent.routes.js`:

```js
const { Router } = require("express");
const authMiddleware = require("../middlewares/authMiddleware");
const ConsentController = require("../controllers/ConsentController");
const asyncHandler = require("../utils/asyncHandler");

const router = Router();

router.use(authMiddleware);
router.get("/", asyncHandler(ConsentController.listMine));
router.post("/", asyncHandler(ConsentController.accept));

module.exports = router;
```

- [ ] **Step 5: Montar no index de rotas**

Em `src/routes/index.js`: adicionar o require junto aos outros (perto de `bookmarkRoutes`)
e o mount junto aos `app.use("/me/...")`:

```js
const consentRoutes = require("./consent.routes");
```
```js
  app.use("/me/consents", consentRoutes);
```

- [ ] **Step 6: Lint**

Run: `npx eslint src/storages/ConsentStorage.js src/controllers/ConsentController.js src/routes/consent.routes.js src/routes/index.js`
Expected: sem erros.

- [ ] **Step 7: Commit + push**

```bash
git add src/databases/migrations/129_user_action_consent.sql src/storages/ConsentStorage.js src/controllers/ConsentController.js src/routes/consent.routes.js src/routes/index.js
git commit -m "feat(consent): slice 1 — tabela tb_user_action_consent + GET/POST /me/consents"
git push origin main
```

- [ ] **Step 8: Verificar pós-deploy (read-only)**

```bash
node -e "require('dotenv').config();process.env.NODE_TLS_REJECT_UNAUTHORIZED='0';const{Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});p.query(\"SELECT to_regclass('public.tb_user_action_consent') AS t\").then(r=>{console.log(r.rows[0]);return p.end()})"
```
Expected: `{ t: 'tb_user_action_consent' }`.

---

## Slice 2 — Frontend base: provider + hook + modal + catálogo

**Files:**
- Create: `app/api/me/consents/route.ts`, `lib/action-consents.ts`,
  `components/consent/ConsentProvider.tsx`, `hooks/use-action-consent.ts`,
  `components/consent/ActionConsentModal.tsx`
- Modify: providers de topo

- [ ] **Step 1: Proxy API**

Create `app/api/me/consents/route.ts`:

```ts
import { getBackendApiUrl } from "@/lib/backend"
import { fetchWithTimeout, readBodyWithTimeout, isFetchTimeout } from "@/lib/server-fetch"

const BACKEND = getBackendApiUrl()

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader) return Response.json({ error: "Token não fornecido" }, { status: 401 })
  try {
    const res = await fetchWithTimeout(
      `${BACKEND}/me/consents`,
      { method: "GET", headers: { Authorization: authHeader }, cache: "no-store" },
      2500,
    )
    const text = await readBodyWithTimeout(res, 1500)
    return Response.json(text ? JSON.parse(text) : { consents: {} }, { status: res.status })
  } catch (e) {
    if (isFetchTimeout(e)) return Response.json({ consents: {}, timeout: true }, { status: 200 })
    return Response.json({ consents: {} }, { status: 200 })
  }
}

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization")
  if (!authHeader) return Response.json({ error: "Token não fornecido" }, { status: 401 })
  const body = await request.text()
  try {
    const res = await fetchWithTimeout(
      `${BACKEND}/me/consents`,
      {
        method: "POST",
        headers: { Authorization: authHeader, "Content-Type": "application/json" },
        body,
        cache: "no-store",
      },
      4000,
    )
    const text = await readBodyWithTimeout(res, 2000)
    return Response.json(text ? JSON.parse(text) : {}, { status: res.status })
  } catch (e) {
    if (isFetchTimeout(e)) return Response.json({ error: "timeout" }, { status: 504 })
    return Response.json({ error: "Erro de conexão" }, { status: 500 })
  }
}
```

(Conferir os nomes exportados reais de `@/lib/server-fetch` — `fetchWithTimeout`,
`readBodyWithTimeout`, `isFetchTimeout` são usados em `app/api/me/notifications/.../route.ts`.)

- [ ] **Step 2: Catálogo de termos**

Create `lib/action-consents.ts`:

```ts
export type ConsentActionKey = "publish_content" | "publish_offer" | "purchase" | "affiliate"

export interface ConsentActionDef {
  key: ConsentActionKey
  version: number
  title: string
  summary: string
  bullets: string[]
  links: { label: string; href: string }[]
}

/**
 * Minuta de boas práticas (CDC/LGPD/autoral/Marco Civil) — texto final pendente de revisão
 * jurídica. Subir `version` re-dispara o aceite para todos os usuários.
 */
export const CONSENT_ACTIONS: Record<ConsentActionKey, ConsentActionDef> = {
  publish_content: {
    key: "publish_content",
    version: 1,
    title: "Antes de publicar",
    summary:
      "Você é responsável pelo conteúdo que publica. Ao continuar, declara que tem os direitos necessários e que o conteúdo respeita as regras da plataforma.",
    bullets: [
      "O conteúdo é seu ou você tem autorização para publicá-lo.",
      "Não viola direitos de terceiros (autorais, imagem, marca).",
      "Não é ilegal, ofensivo ou enganoso.",
    ],
    links: [
      { label: "Direitos Autorais", href: "/copyright-policy" },
      { label: "Diretrizes da Comunidade", href: "/community-guidelines" },
      { label: "Política de Moderação", href: "/moderation-policy" },
    ],
  },
  publish_offer: {
    key: "publish_offer",
    version: 1,
    title: "Antes de publicar sua oferta",
    summary:
      "Ao publicar um curso, serviço ou produto pago, você assume a responsabilidade de fornecedor pela oferta e pela entrega.",
    bullets: [
      "As informações da oferta são verdadeiras e você pode cumpri-la.",
      "Você é responsável pela entrega, pela qualidade e pelos impostos/nota fiscal.",
      "Concorda com as regras de comissão e repasse do marketplace.",
    ],
    links: [
      { label: "Termos do Marketplace", href: "/marketplace-terms" },
      { label: "Direitos Autorais", href: "/copyright-policy" },
    ],
  },
  purchase: {
    key: "purchase",
    version: 1,
    title: "Antes de concluir a compra",
    summary:
      "A contratação é entre você e o vendedor; a Freelandoo intermedia o pagamento com proteção. Confira seus direitos antes de continuar.",
    bullets: [
      "Direito de arrependimento em até 7 dias em compras online (CDC, art. 49).",
      "O pagamento fica protegido até a confirmação da entrega.",
      "Você leu a Política de Devolução e as regras da compra.",
    ],
    links: [
      { label: "Política de Devolução", href: "/return-policy" },
      { label: "Termos do Marketplace", href: "/marketplace-terms" },
    ],
  },
  affiliate: {
    key: "affiliate",
    version: 1,
    title: "Antes de virar afiliado",
    summary:
      "Como afiliado, você divulga ofertas de terceiros e recebe comissão pelas vendas atribuídas a você, conforme os termos.",
    bullets: [
      "A comissão segue as regras e os prazos de liberação (holdback) do programa.",
      "Divulgação honesta — sem spam, fraude ou promessas enganosas.",
      "A Freelandoo pode reverter comissões de vendas canceladas ou fraudulentas.",
    ],
    links: [{ label: "Termos de Afiliados", href: "/affiliate-terms" }],
  },
}
```

- [ ] **Step 3: ConsentProvider**

Create `components/consent/ConsentProvider.tsx`:

```tsx
"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { CONSENT_ACTIONS, type ConsentActionKey } from "@/lib/action-consents"
import { ActionConsentModal } from "./ActionConsentModal"

const CACHE_KEY = "fl_consents"

type ConsentMap = Partial<Record<ConsentActionKey, number>>

interface ConsentContextValue {
  ensureConsent: (key: ConsentActionKey) => Promise<boolean>
}

const ConsentContext = createContext<ConsentContextValue | null>(null)

export function useConsentContext() {
  const ctx = useContext(ConsentContext)
  if (!ctx) throw new Error("useConsentContext fora do ConsentProvider")
  return ctx
}

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [consents, setConsents] = useState<ConsentMap>({})
  const [pending, setPending] = useState<ConsentActionKey | null>(null)
  const resolverRef = useRef<((ok: boolean) => void) | null>(null)

  // Carrega aceites 1x (cache local só pra não piscar).
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached) setConsents(JSON.parse(cached))
    } catch {
      /* ignore */
    }
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    if (!token) return
    fetch("/api/me/consents", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.consents) {
          setConsents(d.consents)
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(d.consents))
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})
  }, [])

  const ensureConsent = useCallback(
    (key: ConsentActionKey) =>
      new Promise<boolean>((resolve) => {
        const required = CONSENT_ACTIONS[key].version
        if ((consents[key] ?? 0) >= required) {
          resolve(true)
          return
        }
        resolverRef.current = resolve
        setPending(key)
      }),
    [consents],
  )

  function finish(ok: boolean) {
    const r = resolverRef.current
    resolverRef.current = null
    setPending(null)
    if (r) r(ok)
  }

  async function handleAccept(key: ConsentActionKey) {
    const version = CONSENT_ACTIONS[key].version
    const token = localStorage.getItem("token")
    try {
      await fetch("/api/me/consents", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action_key: key, terms_version: version }),
      })
    } catch {
      /* mesmo se falhar a gravação, libera a ação nesta sessão */
    }
    setConsents((prev) => {
      const next = { ...prev, [key]: version }
      try {
        localStorage.setItem(CACHE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
    finish(true)
  }

  return (
    <ConsentContext.Provider value={{ ensureConsent }}>
      {children}
      <ActionConsentModal
        actionKey={pending}
        onAccept={handleAccept}
        onDecline={() => finish(false)}
      />
    </ConsentContext.Provider>
  )
}
```

- [ ] **Step 4: Hook**

Create `hooks/use-action-consent.ts`:

```ts
"use client"

import { useConsentContext } from "@/components/consent/ConsentProvider"

/** Atalho: `const { ensureConsent } = useActionConsent()`. */
export function useActionConsent() {
  return useConsentContext()
}
```

- [ ] **Step 5: Modal**

Create `components/consent/ActionConsentModal.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import Link from "next/link"
import { Check, X } from "lucide-react"
import { CONSENT_ACTIONS, type ConsentActionKey } from "@/lib/action-consents"

export function ActionConsentModal({
  actionKey,
  onAccept,
  onDecline,
}: {
  actionKey: ConsentActionKey | null
  onAccept: (key: ConsentActionKey) => void
  onDecline: () => void
}) {
  const reduceMotion = useReducedMotion()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    setChecked(false)
  }, [actionKey])

  const def = actionKey ? CONSENT_ACTIONS[actionKey] : null

  return (
    <AnimatePresence>
      {def && (
        <motion.div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onDecline}
          role="presentation"
        >
          <motion.div
            className="fl-root fl-paper-card relative w-full max-w-lg rounded-2xl border-2 border-[#0B0B0D] p-6 shadow-[10px_10px_0_0_#0B0B0D] sm:p-8"
            initial={reduceMotion ? { opacity: 0 } : { scale: 0.94, y: 16, opacity: 0 }}
            animate={reduceMotion ? { opacity: 1 } : { scale: 1, y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { scale: 0.96, opacity: 0 }}
            transition={reduceMotion ? { duration: 0.15 } : { type: "spring", stiffness: 100, damping: 20 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="consent-modal-title"
          >
            <button
              type="button"
              onClick={onDecline}
              className="absolute right-4 top-4 rounded-full p-1.5 text-[#0B0B0D]/50 transition hover:bg-[#0B0B0D]/10 hover:text-[#0B0B0D] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0B0B0D]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>

            <h2 id="consent-modal-title" className="fl-display text-2xl text-[#0B0B0D] sm:text-3xl">
              {def.title}
            </h2>
            <p className="mt-2 text-sm text-[#3a352c]">{def.summary}</p>

            <ul className="mt-4 space-y-2">
              {def.bullets.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-[#0B0B0D]">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-[#0B0B0D]" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>

            <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {def.links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  target="_blank"
                  className="font-bold text-[#0B0B0D] underline underline-offset-2"
                >
                  {l.label}
                </Link>
              ))}
            </div>

            <label className="mt-5 flex cursor-pointer items-start gap-2 text-sm text-[#0B0B0D]">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => setChecked(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-[#F2B705]"
              />
              <span>Li e concordo com os termos acima.</span>
            </label>

            <div className="mt-6 flex justify-end gap-2">
              <button
                type="button"
                onClick={onDecline}
                className="rounded-full border-2 border-[#0B0B0D] px-4 py-2 text-sm font-bold text-[#0B0B0D] transition hover:bg-[#0B0B0D]/5 active:scale-[0.98]"
              >
                Recusar
              </button>
              <button
                type="button"
                disabled={!checked}
                onClick={() => def && onAccept(def.key)}
                className="rounded-full bg-[#F2B705] px-5 py-2 text-sm font-bold text-[#1A1505] transition hover:brightness-105 active:scale-[0.98] disabled:opacity-50"
              >
                Aceitar e continuar
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

- [ ] **Step 6: Montar o ConsentProvider nos providers de topo**

Localizar o wrapper de providers client de mais alto nível (ex.: `app/providers.tsx` ou o
componente client que envolve `children` no `app/layout.tsx`). Envolver `children` com
`<ConsentProvider>...</ConsentProvider>`. Se não houver um arquivo de providers client,
montar diretamente no `app/layout.tsx` dentro do `<body>` (ConsentProvider é client e tolera
SSR — só ativa com token).

- [ ] **Step 7: Lint**

Run: `npx eslint "app/api/me/consents/route.ts" "lib/action-consents.ts" "components/consent/" "hooks/use-action-consent.ts"`
Expected: sem erros.

- [ ] **Step 8: Commit + push**

```bash
git add "app/api/me/consents/route.ts" "lib/action-consents.ts" "components/consent/" "hooks/use-action-consent.ts" <arquivo-de-providers>
git commit -m "feat(consent): slice 2 — provider + hook + modal + catálogo de termos por ação"
git push origin main
```

---

## Slice 3 — Wiring: publicar conteúdo + publicar oferta

> **Padrão de integração** (aplicar em cada handler de gatilho): tornar o handler async e,
> na primeira linha, chamar o gate. Se recusar, aborta.
>
> ```ts
> const { ensureConsent } = useActionConsent()
> async function handleCriar() {
>   if (!(await ensureConsent("publish_offer"))) return
>   // ...fluxo original
> }
> ```
>
> Quando o gatilho for um `<Link>`/navegação direta, trocar por `<button onClick>` que faz o
> gate e então navega (`router.push`).

**Files (gatilhos a localizar e embrulhar — confirmar caminho exato ao executar):**

- [ ] **Step 1: `publish_offer` — Novo curso**

Em `app/(header-only)/account/_components/courses-section.tsx` (`createAndGo`) e em
`app/(header-only)/account/clans/[id_profile]/page.tsx` (`handleCreateCourse`): no início,
`if (!(await ensureConsent("publish_offer"))) return`.

- [ ] **Step 2: `publish_offer` — Novo serviço**

Em `components/profile/profile-public-services-section.tsx` (`openCreateService`): gate antes
de abrir o modal.

- [ ] **Step 3: `publish_offer` — Novo produto**

Localizar a seção de produtos do dono (`components/profile/*products*` — `ProfileOwnerProductsSection`
e seu botão "novo produto") e aplicar o gate no handler de criar produto.

- [ ] **Step 4: `publish_content` — Novo post/bee/story**

Localizar a abertura do composer (eventos `freelandoo:create`/`freelandoo:create-subprofile`
em `freelancer-profile-view.tsx` e o composer de stories). Aplicar `ensureConsent("publish_content")`
antes de abrir o composer/upload.

- [ ] **Step 5: Lint dos arquivos tocados**

Run: `npx eslint <arquivos modificados>`
Expected: sem erros.

- [ ] **Step 6: Checagem manual**

Logar com usuário sem aceite, clicar "Novo curso"/"Novo serviço"/criar post → modal aparece;
Recusar → não abre; Aceitar → abre e não pede de novo nas próximas vezes.

- [ ] **Step 7: Commit + push**

```bash
git add <arquivos modificados>
git commit -m "feat(consent): slice 3 — gate de publish_content e publish_offer nos gatilhos de criar"
git push origin main
```

---

## Slice 4 — Wiring: comprar + afiliado

**Files (confirmar ao executar):**

- [ ] **Step 1: `purchase` — Agendamento de serviço**

Em `components/profile/profile-public-services-section.tsx` (`openSchedule`/início do fluxo de
agendar) e/ou no `ScheduleBookingModal`: gate `ensureConsent("purchase")` antes de abrir o
fluxo de agendamento.

- [ ] **Step 2: `purchase` — Compra de produto (checkout)**

Localizar o botão de checkout do carrinho/loja (`app/checkout/*` ou o handler "finalizar
compra") e aplicar o gate antes de iniciar o checkout Stripe.

- [ ] **Step 3: `purchase` — Compra de curso**

Localizar o botão de comprar curso (página pública do curso `/cursos/[slug]` ou
`course-landing`/watch) e aplicar o gate antes de iniciar o checkout.

- [ ] **Step 4: `affiliate` — Ativar afiliação**

Localizar o fluxo de virar afiliado (`/me/affiliate` no front — página/botão de ativação) e
aplicar `ensureConsent("affiliate")` antes de ativar.

- [ ] **Step 5: Lint dos arquivos tocados**

Run: `npx eslint <arquivos modificados>`
Expected: sem erros.

- [ ] **Step 6: Checagem manual**

Fluxos de comprar/agendar/curso e virar afiliado pedem o aceite 1x; recusar bloqueia; aceitar
segue.

- [ ] **Step 7: Commit + push**

```bash
git add <arquivos modificados>
git commit -m "feat(consent): slice 4 — gate de purchase e affiliate nos gatilhos de comprar/afiliar"
git push origin main
```

---

## Self-Review (cobertura do spec)

- Tabela versionada com prova (ip/ua) → slice 1 ✅
- `GET/POST /me/consents` com validação de action_key/version → slice 1 ✅
- Catálogo de 4 gates com textos/links/versão → slice 2 ✅
- Provider carrega 1x + hook `ensureConsent` + modal aceitar/recusar → slice 2 ✅
- Aparece 1x; re-pergunta só por versão → slice 2 (compara `consents[key] >= version`) ✅
- `publish_content` + `publish_offer` nos gatilhos de criar → slice 3 ✅
- `purchase` + `affiliate` nos gatilhos de comprar/afiliar → slice 4 ✅
- Busca sem gate (não há task de busca) → respeitado ✅
- Recusar bloqueia (handler aborta) → slices 3–4 ✅

## Pontos a confirmar na execução (não bloqueiam)

- Exports reais de `@/lib/server-fetch` (slice 2 step 1).
- Arquivo de providers client de topo p/ montar `ConsentProvider` (slice 2 step 6).
- Caminhos exatos dos gatilhos de produto, composer de post/bee/story, checkout de produto/
  curso e ativação de afiliado (slices 3–4) — pinar ao abrir cada arquivo.
```
