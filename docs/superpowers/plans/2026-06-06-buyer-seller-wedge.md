# Wedge Comprador × Vendedor — Implementation Plan

> **For agentic workers:** Steps use checkbox (`- [ ]`) syntax for tracking. Este projeto
> **não tem suíte de testes automatizados** (`npm test` é no-op). Verificação por slice:
> (1) `npx eslint <arquivos>` sem erros, (2) checagem manual da rota no navegador quando
> aplicável. Commit + push por slice. **Sem `git add -A`** (há WIP paralelo no front —
> commitar só os caminhos da feature). Repo: `freelandoo frontend/freelandoo-website-main`.

**Goal:** Separar comprador e vendedor na entrada — comprador na raiz `/` (copy anti-risco/
prova social), vendedor migra pra `/ganhar`, com um modal chooser suave de boas-vindas.

**Architecture:** Fork raso dentro do route group `(landing)`. Reusa `primitives.tsx`/
`tokens.ts`/`LandingHeader`/`LandingFooter` (mesma identidade visual). Modal client montado
no layout do grupo, não-bloqueante (monta pós-hidratação). Sem mudança de backend/schema.

**Tech Stack:** Next.js 16 App Router, Tailwind 4, framer-motion (já no projeto), lucide.
Skills no momento da execução: `growth-engine` (copy/CTA de comprador, slice 2) e a **taste
skill** (modal, slice 3) — puxar via WebFetch o SKILL.md antes de desenhar.

**Spec:** `docs/superpowers/specs/2026-06-06-buyer-seller-wedge-design.md`

---

## File Structure

**Criar:**
- `app/(landing)/ganhar/page.tsx` — home do vendedor (conteúdo atual de `/`).
- `components/home/landing/AudienceCrossLink.tsx` — link discreto "cruza" entre os lados.
- `components/home/landing/buyer/BuyerHero.tsx` — hero + busca.
- `components/home/landing/buyer/BuyerSocialProof.tsx` — números.
- `components/home/landing/buyer/BuyerHowItWorks.tsx` — 3 passos.
- `components/home/landing/buyer/BuyerCategories.tsx` — atalho de categorias/enxames.
- `components/home/landing/buyer/BuyerTrust.tsx` — segurança/confiança.
- `components/home/landing/buyer/BuyerFinalCTA.tsx` — CTA final + cross-link.
- `components/home/landing/buyer/index.ts` — barrel dos blocos de comprador.
- `components/home/landing/AudienceChooserModal.tsx` — modal client.

**Modificar:**
- `app/(landing)/page.tsx` — passa a compor a home do comprador.
- `app/(landing)/layout.tsx` — monta o `AudienceChooserModal`.
- `app/sitemap.ts` — adiciona `/ganhar`.

---

## Slice 1 — Mover vendedor para `/ganhar` + cross-links + sitemap

**Files:**
- Create: `app/(landing)/ganhar/page.tsx`, `components/home/landing/AudienceCrossLink.tsx`
- Modify: `app/sitemap.ts`

- [ ] **Step 1: Criar o cross-link reutilizável**

Create `components/home/landing/AudienceCrossLink.tsx`:

```tsx
import Link from "next/link"
import { ArrowUpRight } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Link discreto que cruza entre as duas home (comprador `/` ↔ vendedor `/ganhar`).
 * Visual leve em tema light (fl-root), pensado pra rodapé de hero ou CTA final.
 */
export function AudienceCrossLink({
  href,
  children,
  className,
}: {
  href: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <Link
      href={href}
      className={cn(
        "inline-flex items-center gap-1 text-sm font-bold text-[#0B0B0D]/70 underline-offset-4 transition hover:text-[#0B0B0D] hover:underline",
        className,
      )}
    >
      {children}
      <ArrowUpRight className="h-4 w-4" />
    </Link>
  )
}
```

- [ ] **Step 2: Criar `/ganhar` com o conteúdo atual do vendedor**

Create `app/(landing)/ganhar/page.tsx` copiando a composição atual de
`app/(landing)/page.tsx` (Hero/MoneyPath/Carousel/Bento/FinalCTA + JSON-LD), com metadata
própria e o cross-link pro comprador. Conteúdo:

```tsx
import type { Metadata } from "next"
import {
  LandingHeader,
  LandingFooter,
  HeroSection,
  MoneyPathCards,
  FeatureCarousel,
  FeatureBento,
  FinalCTA,
} from "@/components/home/landing"
import { AudienceCrossLink } from "@/components/home/landing/AudienceCrossLink"
import { RevealMount } from "@/components/home/landing/RevealMount"

const TITLE = "Freelandoo — Venda serviços, cursos e produtos, e ganhe como afiliado"
const DESCRIPTION =
  "Transforme seu talento ou sua audiência em renda. Ofereça serviços, crie cursos de graça, venda produtos, abra sua lojinha e ganhe indicando. Comece de graça."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://www.freelandoo.com.br/ganhar" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.freelandoo.com.br/ganhar",
    siteName: "Freelandoo",
    type: "website",
    locale: "pt_BR",
    images: [{ url: "/og-image.png", width: 1024, height: 1024, alt: "Freelandoo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
}

export default function SellerHomePage() {
  return (
    <>
      <LandingHeader />
      <main className="flex-1 overflow-x-clip">
        <HeroSection />
        <MoneyPathCards />
        <FeatureCarousel />
        <FeatureBento />
        <div className="flex justify-center px-5 pb-2">
          <AudienceCrossLink href="/">Quer contratar ou comprar?</AudienceCrossLink>
        </div>
        <FinalCTA />
      </main>
      <LandingFooter />
      <RevealMount />
    </>
  )
}
```

(Nota: o JSON-LD de Organization/WebSite fica só na `/` — não duplicar em `/ganhar`.)

- [ ] **Step 3: Adicionar `/ganhar` ao sitemap**

Em `app/sitemap.ts`, dentro de `STATIC_ROUTES`, logo após a linha de `BASE_URL` raiz,
adicionar:

```ts
  { url: `${BASE_URL}/ganhar`, changeFrequency: "daily", priority: 0.9 },
```

- [ ] **Step 4: Lint**

Run: `npx eslint "app/(landing)/ganhar/page.tsx" "components/home/landing/AudienceCrossLink.tsx" "app/sitemap.ts"`
Expected: sem erros.

- [ ] **Step 5: Commit + push**

```bash
git add "app/(landing)/ganhar/page.tsx" "components/home/landing/AudienceCrossLink.tsx" "app/sitemap.ts"
git commit -m "feat(wedge): slice 1 — home de vendedor migra para /ganhar + cross-link + sitemap"
git push origin main
```

---

## Slice 2 — Home do comprador em `/`

**Files:**
- Create: `components/home/landing/buyer/*` (6 blocos + index)
- Modify: `app/(landing)/page.tsx`

> **Antes de escrever a copy:** puxar a `growth-engine` skill (marketing/neuromarketing) e
> usar os ângulos do spec (redução de risco, prova social, baixo esforço) pra refinar as
> frases/CTAs abaixo. As copies nos code blocks são um ponto de partida válido; refine o
> wording, não a estrutura. Seguir a paleta dos `primitives` (tema light papel/preto/dourado).

- [ ] **Step 1: BuyerHero (hero + busca)**

Create `components/home/landing/buyer/BuyerHero.tsx`. Client (tem form de busca que navega):

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Search, ShieldCheck, Star } from "lucide-react"
import { Section, YellowHighlight, GoldButton, AvatarStack } from "@/components/home/landing"

export function BuyerHero() {
  const router = useRouter()
  const [q, setQ] = useState("")

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const term = q.trim()
    router.push(term ? `/search?q=${encodeURIComponent(term)}` : "/search")
  }

  return (
    <Section className="pt-10 sm:pt-14">
      <div className="mx-auto max-w-[820px] text-center">
        <h1 className="fl-display text-5xl leading-[0.95] text-[#0B0B0D] sm:text-6xl md:text-7xl">
          Encontre <YellowHighlight mark>profissionais</YellowHighlight> e{" "}
          <YellowHighlight mark>influenciadores</YellowHighlight>
        </h1>
        <p className="mx-auto mt-5 max-w-[560px] text-base text-[#3a352c] sm:text-lg">
          Contrate serviços, compre de criadores e feche com influenciadores — com
          pagamento protegido e avaliações reais, num lugar só.
        </p>

        <form onSubmit={submit} className="mx-auto mt-8 flex max-w-[560px] items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-full border-2 border-[#0B0B0D] bg-white px-4 py-3 shadow-[4px_4px_0_0_#0B0B0D]">
            <Search className="h-5 w-5 shrink-0 text-[#0B0B0D]/60" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="O que você precisa? (ex: fotógrafo, edição de vídeo…)"
              className="w-full bg-transparent text-sm text-[#0B0B0D] outline-none placeholder:text-[#0B0B0D]/40"
              aria-label="Buscar profissionais, influenciadores ou produtos"
            />
          </div>
          <GoldButton type="submit" className="shrink-0">
            Encontrar
          </GoldButton>
        </form>

        <div className="mt-6 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs font-semibold text-[#3a352c]">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-4 w-4 text-[#0B0B0D]" /> Pagamento protegido
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Star className="h-4 w-4 text-[#0B0B0D]" /> Avaliações reais
          </span>
          <span className="inline-flex items-center gap-1.5">
            <AvatarStack count={4} /> Profissionais perto de você
          </span>
        </div>
      </div>
    </Section>
  )
}
```

- [ ] **Step 2: BuyerSocialProof (números)**

Create `components/home/landing/buyer/BuyerSocialProof.tsx`. Server component; números via
contagem leve do `/search` é exagero — usar valores estáticos editoriais por enquanto
(refináveis depois com dado real):

```tsx
import { Section } from "@/components/home/landing"

const STATS = [
  { value: "Profissionais", label: "de todo o Brasil" },
  { value: "15 enxames", label: "de áreas e profissões" },
  { value: "Pagamento", label: "protegido em toda compra" },
]

export function BuyerSocialProof() {
  return (
    <Section className="py-8 sm:py-10">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {STATS.map((s) => (
          <div
            key={s.value}
            className="rounded-xl border-2 border-[#0B0B0D] bg-white px-5 py-4 text-center shadow-[4px_4px_0_0_#0B0B0D]"
          >
            <div className="fl-display text-2xl text-[#0B0B0D]">{s.value}</div>
            <div className="text-xs font-semibold text-[#3a352c]">{s.label}</div>
          </div>
        ))}
      </div>
    </Section>
  )
}
```

- [ ] **Step 3: BuyerHowItWorks (3 passos)**

Create `components/home/landing/buyer/BuyerHowItWorks.tsx`:

```tsx
import { Search, ShieldCheck, MessagesSquare } from "lucide-react"
import { Section, SectionHeading, BigNumber } from "@/components/home/landing"

const STEPS = [
  { icon: Search, title: "Busque", desc: "Procure por profissão, influenciador ou produto — perto de você." },
  { icon: ShieldCheck, title: "Contrate com segurança", desc: "O pagamento fica protegido até você confirmar que deu tudo certo." },
  { icon: MessagesSquare, title: "Acompanhe num lugar", desc: "Converse, contrate e acompanhe tudo dentro da plataforma." },
]

export function BuyerHowItWorks() {
  return (
    <Section>
      <SectionHeading className="!text-[#0B0B0D] [&_h2]:!text-[#0B0B0D]" align="center">
        Como funciona
      </SectionHeading>
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {STEPS.map((s, i) => (
          <div
            key={s.title}
            className="relative rounded-2xl border-2 border-[#0B0B0D] bg-white p-6 shadow-[6px_6px_0_0_#0B0B0D]"
          >
            <BigNumber n={i + 1} className="text-3xl" />
            <s.icon className="mt-3 h-7 w-7 text-[#0B0B0D]" />
            <h3 className="mt-3 text-lg font-bold text-[#0B0B0D]">{s.title}</h3>
            <p className="mt-1 text-sm text-[#3a352c]">{s.desc}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}
```

(`SectionHeading` usa texto claro por padrão — passar override pra preto no tema light.
Se o override por className não pegar, criar `<h2 className="fl-display text-4xl text-[#0B0B0D] ...">` direto. Conferir no navegador.)

- [ ] **Step 4: BuyerCategories (atalho de enxames)**

Create `components/home/landing/buyer/BuyerCategories.tsx`. Server component que busca os
enxames do backend (mesmo endpoint do sitemap) e linka pra `/enxame/<slug>`:

```tsx
import Link from "next/link"
import { getBackendApiUrl } from "@/lib/backend"
import { Section, SectionHeading } from "@/components/home/landing"

type Enxame = { id_machine?: number; slug: string; name?: string; desc_machine?: string }

async function fetchEnxames(): Promise<Enxame[]> {
  try {
    const res = await fetch(`${getBackendApiUrl()}/enxames`, { next: { revalidate: 3600 } })
    if (!res.ok) return []
    const body = await res.json()
    const list = Array.isArray(body) ? body : Array.isArray(body?.enxames) ? body.enxames : []
    return list.filter((m: Enxame) => m && typeof m.slug === "string")
  } catch {
    return []
  }
}

export async function BuyerCategories() {
  const enxames = (await fetchEnxames()).slice(0, 15)
  if (enxames.length === 0) return null
  return (
    <Section>
      <SectionHeading align="center">Explore por área</SectionHeading>
      <div className="mt-8 flex flex-wrap justify-center gap-2.5">
        {enxames.map((e) => (
          <Link
            key={e.slug}
            href={`/enxame/${e.slug}`}
            className="rounded-full border-2 border-[#0B0B0D] bg-white px-4 py-2 text-sm font-bold text-[#0B0B0D] transition hover:bg-[#F2B705] hover:shadow-[3px_3px_0_0_#0B0B0D]"
          >
            {e.name || e.slug}
          </Link>
        ))}
      </div>
    </Section>
  )
}
```

(Conferir o shape real de `/enxames` — o sitemap usa `slug`; o nome pode vir como `name` ou
`desc_machine`. Ajustar o label conforme a resposta real ao executar.)

- [ ] **Step 5: BuyerTrust (segurança)**

Create `components/home/landing/buyer/BuyerTrust.tsx`:

```tsx
import { ShieldCheck, Star, Headset } from "lucide-react"
import { Section, SectionHeading } from "@/components/home/landing"

const ITEMS = [
  { icon: ShieldCheck, title: "Pagamento protegido", desc: "Seu dinheiro fica retido com segurança até a entrega ser confirmada." },
  { icon: Star, title: "Avaliações reais", desc: "Veja a reputação de quem você vai contratar antes de fechar." },
  { icon: Headset, title: "Suporte de verdade", desc: "Time pronto pra ajudar se algo sair do combinado." },
]

export function BuyerTrust() {
  return (
    <Section>
      <SectionHeading align="center">Compre sem medo</SectionHeading>
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-3">
        {ITEMS.map((it) => (
          <div key={it.title} className="rounded-2xl border-2 border-[#0B0B0D] bg-[#F2B705]/15 p-6">
            <it.icon className="h-7 w-7 text-[#0B0B0D]" />
            <h3 className="mt-3 text-lg font-bold text-[#0B0B0D]">{it.title}</h3>
            <p className="mt-1 text-sm text-[#3a352c]">{it.desc}</p>
          </div>
        ))}
      </div>
    </Section>
  )
}
```

- [ ] **Step 6: BuyerFinalCTA (CTA + cross-link)**

Create `components/home/landing/buyer/BuyerFinalCTA.tsx`:

```tsx
import { Section, GoldButton } from "@/components/home/landing"
import { AudienceCrossLink } from "@/components/home/landing/AudienceCrossLink"

export function BuyerFinalCTA() {
  return (
    <Section className="text-center">
      <h2 className="fl-display text-4xl text-[#0B0B0D] sm:text-5xl">
        Encontre quem você precisa hoje
      </h2>
      <div className="mt-7 flex flex-col items-center gap-3">
        <GoldButton href="/search">Encontrar agora</GoldButton>
        <AudienceCrossLink href="/ganhar">
          É profissional ou influenciador? Ganhe dinheiro
        </AudienceCrossLink>
      </div>
    </Section>
  )
}
```

- [ ] **Step 7: Barrel dos blocos de comprador**

Create `components/home/landing/buyer/index.ts`:

```ts
export { BuyerHero } from "./BuyerHero"
export { BuyerSocialProof } from "./BuyerSocialProof"
export { BuyerHowItWorks } from "./BuyerHowItWorks"
export { BuyerCategories } from "./BuyerCategories"
export { BuyerTrust } from "./BuyerTrust"
export { BuyerFinalCTA } from "./BuyerFinalCTA"
```

- [ ] **Step 8: Reescrever `app/(landing)/page.tsx` para o comprador**

Substituir o conteúdo de `app/(landing)/page.tsx` por:

```tsx
import type { Metadata } from "next"
import { LandingHeader, LandingFooter } from "@/components/home/landing"
import {
  BuyerHero,
  BuyerSocialProof,
  BuyerHowItWorks,
  BuyerCategories,
  BuyerTrust,
  BuyerFinalCTA,
} from "@/components/home/landing/buyer"
import { RevealMount } from "@/components/home/landing/RevealMount"

const TITLE = "Freelandoo — Encontre profissionais, influenciadores e produtos"
const DESCRIPTION =
  "Contrate profissionais, compre de criadores e feche com influenciadores com pagamento protegido e avaliações reais. Encontre perto de você, num lugar só."

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: "https://www.freelandoo.com.br" },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: "https://www.freelandoo.com.br",
    siteName: "Freelandoo",
    type: "website",
    locale: "pt_BR",
    images: [{ url: "/og-image.png", width: 1024, height: 1024, alt: "Freelandoo" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
}

export default function BuyerHomePage() {
  const jsonLdOrg = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Freelandoo",
    url: "https://www.freelandoo.com.br",
    description: DESCRIPTION,
  }
  const jsonLdSite = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Freelandoo",
    url: "https://www.freelandoo.com.br",
    inLanguage: "pt-BR",
    potentialAction: {
      "@type": "SearchAction",
      target: "https://www.freelandoo.com.br/search?q={search_term_string}",
      "query-input": "required name=search_term_string",
    },
  }
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdOrg) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSite) }} />
      <LandingHeader />
      <main className="flex-1 overflow-x-clip">
        <BuyerHero />
        <BuyerSocialProof />
        <BuyerHowItWorks />
        <BuyerCategories />
        <BuyerTrust />
        <BuyerFinalCTA />
      </main>
      <LandingFooter />
      <RevealMount />
    </>
  )
}
```

- [ ] **Step 9: Lint**

Run: `npx eslint "app/(landing)/page.tsx" "components/home/landing/buyer/"`
Expected: sem erros.

- [ ] **Step 10: Checagem manual**

`npm run dev` e abrir `http://localhost:3000/` — hero "Encontre profissionais e
influenciadores", busca navega pra `/search?q=`, seções renderizam no tema light, cross-link
vai pra `/ganhar`. Conferir contraste dos headings (override de cor pegou).

- [ ] **Step 11: Commit + push**

```bash
git add "app/(landing)/page.tsx" "components/home/landing/buyer/"
git commit -m "feat(wedge): slice 2 — home do comprador na raiz / (hero+busca, prova social, passos, segurança)"
git push origin main
```

---

## Slice 3 — Modal chooser de boas-vindas

**Files:**
- Create: `components/home/landing/AudienceChooserModal.tsx`
- Modify: `app/(landing)/layout.tsx`

> **Antes de desenhar:** puxar a **taste skill** (WebFetch do SKILL.md em
> `https://raw.githubusercontent.com/leonxlnx/taste-skill/main/skills/taste-skill/SKILL.md`)
> e aplicar: spring `stiffness:100 damping:20`, sem pure black, estados desenhados. O modal
> usa o container de papel (`fl-root fl-paper-card`) como nos modais light do projeto
> (ver memória `fl-paper-card`).

- [ ] **Step 1: Criar o modal**

Create `components/home/landing/AudienceChooserModal.tsx`:

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "framer-motion"
import Image from "next/image"
import { Search, Sparkles, X } from "lucide-react"

const STORAGE_KEY = "fl_audience"
const DISMISS_KEY = "fl_audience_dismissed"

export function AudienceChooserModal() {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    // Não mostra pra logado, pra quem já escolheu, ou já dispensou nesta sessão.
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    if (token) return
    if (localStorage.getItem(STORAGE_KEY)) return
    if (sessionStorage.getItem(DISMISS_KEY)) return
    setOpen(true)
  }, [])

  function chooseBuyer() {
    localStorage.setItem(STORAGE_KEY, "buyer")
    setOpen(false)
  }
  function chooseSeller() {
    localStorage.setItem(STORAGE_KEY, "seller")
    setOpen(false)
    router.push("/ganhar")
  }
  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1")
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={dismiss}
          role="presentation"
        >
          <motion.div
            className="fl-root fl-paper-card relative w-full max-w-2xl rounded-2xl border-2 border-[#0B0B0D] p-6 shadow-[10px_10px_0_0_#0B0B0D] sm:p-8"
            initial={{ scale: 0.92, y: 20, opacity: 0 }}
            animate={{ scale: 1, y: 0, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", stiffness: 100, damping: 20 }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="audience-modal-title"
          >
            <button
              type="button"
              onClick={dismiss}
              className="absolute right-4 top-4 rounded-full p-1.5 text-[#0B0B0D]/50 transition hover:bg-[#0B0B0D]/10 hover:text-[#0B0B0D]"
              aria-label="Fechar"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex flex-col items-center text-center">
              <Image src="/logo.svg" alt="Freelandoo" width={180} height={48} className="h-12 w-auto" priority />
              <h2 id="audience-modal-title" className="fl-display mt-5 text-3xl text-[#0B0B0D] sm:text-4xl">
                Bem-vindo à Freelandoo
              </h2>
              <p className="mt-2 text-sm text-[#3a352c]">O que você quer fazer agora?</p>
            </div>

            <div className="mt-7 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <button
                type="button"
                onClick={chooseBuyer}
                className="group flex flex-col items-start gap-3 rounded-xl border-2 border-[#0B0B0D] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#F2B705]"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#0B0B0D] bg-[#F2B705]">
                  <Search className="h-5 w-5 text-[#0B0B0D]" />
                </span>
                <span className="text-lg font-bold text-[#0B0B0D]">
                  Quero encontrar um profissional, influenciador ou produto
                </span>
                <span className="text-sm text-[#3a352c]">Contrate e compre com segurança.</span>
              </button>

              <button
                type="button"
                onClick={chooseSeller}
                className="group flex flex-col items-start gap-3 rounded-xl border-2 border-[#0B0B0D] bg-white p-5 text-left transition hover:-translate-y-0.5 hover:shadow-[6px_6px_0_0_#F2B705]"
              >
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#0B0B0D] bg-[#0B0B0D]">
                  <Sparkles className="h-5 w-5 text-[#F2B705]" />
                </span>
                <span className="text-lg font-bold text-[#0B0B0D]">
                  Sou profissional ou influenciador e quero ganhar dinheiro
                </span>
                <span className="text-sm text-[#3a352c]">Comece de graça e venda seu talento.</span>
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
```

(Conferir o caminho real do logo em `/public` — pode ser `/logo.svg`, `/logo.png` ou
`/og-image.png`. Ajustar `src`/dimensões ao executar.)

- [ ] **Step 2: Montar no layout do grupo**

Em `app/(landing)/layout.tsx`, importar e renderizar o modal dentro do wrapper:

```tsx
import type { ReactNode } from "react"
import { AudienceChooserModal } from "@/components/home/landing/AudienceChooserModal"

export default function LandingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="fl-root fl-paper-texture flex min-h-[100dvh] flex-col font-sans antialiased">
      {children}
      <AudienceChooserModal />
    </div>
  )
}
```

- [ ] **Step 3: Lint**

Run: `npx eslint "components/home/landing/AudienceChooserModal.tsx" "app/(landing)/layout.tsx"`
Expected: sem erros.

- [ ] **Step 4: Checagem manual**

Em aba anônima abrir `/`: modal aparece. Clicar comprador → fecha, fica em `/`. Recarregar →
não reaparece (localStorage). Limpar storage, recarregar, clicar vendedor → vai pra
`/ganhar`. Logar e abrir `/` → modal não aparece.

- [ ] **Step 5: Commit + push**

```bash
git add "components/home/landing/AudienceChooserModal.tsx" "app/(landing)/layout.tsx"
git commit -m "feat(wedge): slice 3 — modal chooser de boas-vindas (comprador/vendedor) não-bloqueante"
git push origin main
```

---

## Slice 4 — Polish: medição do split

**Files:**
- Modify: `components/home/landing/AudienceChooserModal.tsx`

- [ ] **Step 1: Disparar evento no clique do modal**

Em `AudienceChooserModal.tsx`, adicionar um helper que empurra pro `dataLayer` (a infra de
Consent Mode v2/GTM já existe no projeto; é no-op seguro se ausente) e chamar nas duas
escolhas:

```tsx
function track(choice: "buyer" | "seller") {
  try {
    const w = window as unknown as { dataLayer?: Record<string, unknown>[] }
    w.dataLayer = w.dataLayer || []
    w.dataLayer.push({ event: "audience_choice", audience: choice })
  } catch {
    /* no-op */
  }
}
```

Chamar `track("buyer")` em `chooseBuyer` e `track("seller")` em `chooseSeller` (antes do
`router.push`).

- [ ] **Step 2: Lint**

Run: `npx eslint "components/home/landing/AudienceChooserModal.tsx"`
Expected: sem erros.

- [ ] **Step 3: Commit + push**

```bash
git add "components/home/landing/AudienceChooserModal.tsx"
git commit -m "feat(wedge): slice 4 — evento de medição do split comprador/vendedor (dataLayer)"
git push origin main
```

---

## Self-Review (cobertura do spec)

- Comprador vira `/` (decisão cravada) → slice 2 ✅
- Seller migra pra `/ganhar` reusando blocos atuais → slice 1 ✅
- Mesma identidade visual (reuso primitives/tokens) → slices 1–3 ✅
- Modal chooser suave, não-bloqueante, 1ª visita / não-logado → slice 3 ✅
- Logo grande + dois botões com os textos do spec → slice 3 ✅
- Hero "Encontre profissionais e influenciadores" + busca → slice 2 ✅
- Seções anti-risco / prova social / baixo esforço → slice 2 ✅
- Cross-links nos dois lados → slices 1 e 2 ✅
- sitemap/metadata/canonical → slices 1 e 2 ✅
- Medição leve do split → slice 4 ✅
- Sem backend/schema; fork raso → respeitado ✅

## Pontos a confirmar na execução (não bloqueiam)

- Caminho real do logo em `/public` (slice 3 step 1).
- Shape real de `/enxames` (campo de nome) — slice 2 step 4.
- Override de cor do `SectionHeading` no tema light — se não pegar via className, usar `<h2>`
  direto (slice 2 step 3).
- `growth-engine` refina copy/CTA do comprador no slice 2; **taste** desenha o modal no
  slice 3.
