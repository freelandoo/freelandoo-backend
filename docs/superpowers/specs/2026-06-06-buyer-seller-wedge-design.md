# Wedge Comprador × Vendedor — Design

> **Status:** aprovado em brainstorming com Alex (2026-06-06). Frontend-only (Next.js,
> repo `freelandoo frontend/freelandoo-website-main`). Nenhuma mudança de backend/schema.

## Problema

A Freelandoo fala uma língua só — "ganhe dinheiro" — então atrai **vendedores/influenciadores**
(earners) e quase não atrai **compradores** (spenders). Marketplace precisa dos dois lados.
Risco já mapeado no GTM: *"o funil atrai earner, não spender"*.

Causa raiz: os dois públicos têm motivações opostas.
- **Comprador**: medo de ser enganado, quer resolver com segurança e rápido. Alavancas =
  **redução de risco, prova social, baixo esforço**.
- **Vendedor**: quer renda, fácil, sem custo. Alavancas = **potencial de ganho, custo zero,
  autonomia**.

Uma home única nunca converte bem os dois. Solução: **wedge** — separar os dois públicos
logo na entrada e falar a língua certa de cada um.

## Decisão estratégica (cravada)

**O comprador vira a home raiz `/`** (é dele que falta, e é por buscas de comprador que
queremos ranquear). A home de vendedor atual migra para `/ganhar`. Ganha-se duas landing
pages indexáveis, cada uma mirando um universo de palavra-chave.

## Arquitetura — Roteamento

| URL | Conteúdo | Origem |
|-----|----------|--------|
| `/` | **Home do comprador** (nova) | reescreve `app/(landing)/page.tsx` |
| `/ganhar` | **Home do vendedor** (a atual, sem mudança de composição) | move conteúdo atual de `app/(landing)/page.tsx` para `app/(landing)/ganhar/page.tsx` |

- Os blocos de vendedor já existentes (`HeroSection`, `MoneyPathCards`, `FeatureCarousel`,
  `FeatureBento`, `FinalCTA`, `LandingHeader`, `LandingFooter`) continuam servindo o
  `/ganhar` sem alteração.
- **Mesma identidade visual nos dois lados**: a home do comprador reusa `primitives.tsx` e
  `tokens.ts` (tema light editorial papel/preto/dourado, `fl-root`). Não é um visual novo —
  é a mesma linguagem da seller, com conteúdo diferente.
- `sitemap.ts` passa a listar `/` e `/ganhar`.
- `metadata`/`canonical` de cada página apontando pro próprio endereço; JSON-LD de
  Organization/WebSite permanece em `/`.
- **Cross-link discreto** nos dois lados, pra quem caiu no lado errado:
  - Buyer (`/`): "É profissional ou influenciador? **Ganhe dinheiro →**" → `/ganhar`
  - Seller (`/ganhar`): "Quer **contratar ou comprar**? →" → `/`

## Arquitetura — Modal de entrada (chooser suave)

Componente client `AudienceChooserModal`, montado em `app/(landing)/layout.tsx` (cobre `/`
e `/ganhar`).

**Comportamento:**
- Aparece **só na 1ª visita** e **só se não estiver logado** (sem token).
- Lê `localStorage.fl_audience`; se já existe valor (`'buyer'`/`'seller'`), não mostra.
- **Não bloqueia SEO**: a home do comprador é renderizada no servidor; o modal é um overlay
  que monta **após a hidratação** (sem penalidade de "intrusive interstitial", sem custo de
  LCP — o conteúdo real está atrás).
- Fechar no X = dispensa leve via `sessionStorage` (não grava escolha definitiva, não força
  um lado errado; pode reaparecer em outra visita).

**Visual (tablóide):** `fl-root fl-paper-card`, **logo grande**, dois cards de escolha lado
a lado (empilham no mobile), spring physics (`stiffness:100 damping:20`). Construção segue a
**taste skill** (puxar SKILL.md antes de desenhar).

**As duas escolhas:**
- 🔎 *"Quero encontrar um profissional, influenciador ou produto"* → grava
  `fl_audience='buyer'`, fecha (já está em `/`).
- 💸 *"Sou profissional ou influenciador e quero ganhar dinheiro"* → grava
  `fl_audience='seller'`, navega pra `/ganhar`.

## Home do comprador — seções

Hero com a mensagem central **"Encontre profissionais e influenciadores"** (e produtos).
Cada seção fala com o **medo / baixo esforço / confiança** do comprador — não com ambição.
A copy/CTAs finais são escritas na implementação puxando a **`growth-engine` skill**
(marketing/neuromarketing); aqui ficam registrados os *ângulos*, não as frases finais.

1. **Hero** — promessa única ("Encontre profissionais e influenciadores") + **busca em
   destaque** (encontre perto de você). CTA primário "Encontrar agora". Linha de confiança
   embaixo (pagamento protegido · avaliações). Ângulo: clareza + baixo esforço.
2. **Prova social** — números reais (X profissionais · Y regiões · Z categorias). Ângulo:
   "tem gente de verdade aqui".
3. **Como funciona em 3 passos** — buscar → contratar com segurança → acompanhar tudo num
   lugar. Ângulo: reduz esforço e incerteza.
4. **Categorias / enxames visuais** — atalho pra busca, reusando os cards de categoria já
   existentes. Ângulo: "acho rápido o que preciso".
5. **Confiança / segurança** — pagamento protegido (holdback), avaliações, suporte. Ângulo:
   redução de risco (a alavanca #1 do comprador).
6. **Destaques** — profissionais/produtos/cursos em evidência (definição final do conteúdo
   no início da implementação; default: profissionais + produtos).
7. **CTA final** — "Encontrar agora" + cross-link discreto pro `/ganhar`.

## Home do vendedor (`/ganhar`)

Igual à `/` de hoje, apenas movida de endereço. Ajustes mínimos: `metadata`/`canonical` para
`/ganhar`, e o cross-link "Quer contratar ou comprar? →" pro `/`.

## Medição (leve)

Disparar um evento simples no clique do modal (`buyer` vs `seller`) pra medir o split e a
conversão downstream. Sem infra nova — reusa mecanismo de evento existente ou um log leve.

## Não-objetivos (YAGNI)

- **Não** duplicar o site. Fork raso: 1 modal + 2 landings reusando primitives/tokens.
- **Não** mexer em header/login/busca (compartilhados).
- **Não** criar visual novo — reusar a linguagem da seller.
- **Não** redirecionar à força usuário recorrente (lembrar a escolha só suprime o modal).
- **Nenhuma** mudança de backend/schema.

## Componentes (fronteiras)

- `AudienceChooserModal` — overlay client; entrada: nada; efeito: grava `fl_audience`,
  navega. Depende de `localStorage`/`sessionStorage`, `next/navigation`, logo, taste.
- `app/(landing)/page.tsx` (buyer) — server component; compõe seções de comprador a partir
  de blocos novos + primitives reusados.
- `app/(landing)/ganhar/page.tsx` (seller) — server component; conteúdo atual movido.
- `app/(landing)/layout.tsx` — passa a montar o `AudienceChooserModal`.

## Fatiamento (vira o plano)

1. **Slice 1** — Mover seller para `/ganhar` (criar rota, mover conteúdo), cross-links,
   `sitemap.ts`, metadata/canonical. `/` temporariamente ainda seller até o slice 2. Lint.
2. **Slice 2** — Home do comprador em `/` (seções 1–7), reusando primitives/tokens; copy via
   growth-engine + taste; estados (empty/loading onde houver dados). Lint.
3. **Slice 3** — `AudienceChooserModal` + persistência (`fl_audience`) + regra logado/
   recorrente + dismiss leve. Lint.
4. **Slice 4** — Polish: evento de medição do split, responsivo, microcopy final. Lint.

Cada slice: `npm run lint` antes do commit; commit+push só dos caminhos da feature (há WIP
paralelo no front — sem `git add -A`).
