# Termos de Etapa — Consent Gates em Ações Críticas — Design

> **Status:** aprovado em brainstorming com Alex (2026-06-06). Backend (migration + endpoints)
> + frontend (provider/hook/modal + wiring). Sem reembolso/afiliado novo — só consentimento.

## Problema

Ações críticas (publicar conteúdo, vender, comprar, virar afiliado) têm implicações legais
(CDC, LGPD, direitos autorais, Marco Civil). Hoje não há registro de que o usuário foi
informado e concordou com as regras de cada etapa. Falta uma prova de aceite, versionada, que
reduza disputa e ajude na conformidade.

## Objetivo

Um **gate de consentimento por ação**: na 1ª vez que o usuário aciona uma ação crítica, mostra
um termo específico daquela etapa; **aceitar** libera e registra (server-side, com data/IP/UA,
versionado); **recusar** bloqueia o recurso. Aparece uma vez por ação (re-pergunta só se a
versão do termo mudar). **A busca não tem gate** (decisão do Alex — evita atrito; é navegação).

> **Disclaimer:** este design entrega o MECANISMO + uma MINUTA dos textos seguindo boas
> práticas (CDC/LGPD/autoral/Marco Civil) e referenciando os documentos legais já existentes.
> O texto final exige revisão de advogado — pendência do Alex (igual à "revisão jurídica" já
> registrada). Não se afirma conformidade jurídica.

## Catálogo de gates (4 chaves)

Curso/serviço/produto são "publicar" + "vender" ao mesmo tempo → um gate só (`publish_offer`)
pra não empilhar modal.

| `action_key` | Dispara em | Termos referenciados |
|--------------|------------|----------------------|
| `publish_content` | novo post, bee, story (conteúdo grátis) | Direitos Autorais, Diretrizes da Comunidade, Moderação |
| `publish_offer` | novo curso, serviço, produto (oferta paga) | Autoral + Marketplace (veracidade, entrega, impostos/nota, repasse) |
| `purchase` | checkout de produto, agendamento de serviço, compra de curso | Devolução, arrependimento 7 dias (CDC art. 49), contrato comprador↔vendedor, pagamento protegido |
| `affiliate` | ativar afiliação | Termos de Afiliados (comissão, holdback, antifraude) |

Cada gate referencia os documentos legais já existentes em `app/(with-footer)/*`
(`copyright-policy`, `community-guidelines`, `moderation-policy`, `marketplace-terms`,
`return-policy`, `affiliate-terms`).

## Arquitetura — Backend

**Migration 129** (`129_user_action_consent.sql`, idempotente):

```sql
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

(PK em `(id_user, action_key)` = guarda o aceite mais recente; `UPSERT` atualiza versão/data.)

**Endpoints (auth, sem prefixo `/api` no backend):**
- `GET /me/consents` → `{ consents: { "publish_offer": 1, "purchase": 1, ... } }` (map action→version aceita).
- `POST /me/consents` body `{ action_key, terms_version }` → UPSERT, grava `ip` (de `req.ip`/
  `x-forwarded-for`) e `user_agent` (header). Valida `action_key` contra lista conhecida e
  `terms_version` inteiro ≥ 1. Resposta `{ consent }`.

Camadas: `routes/` → `ConsentController` → `ConsentService` (runWithLogs) → `ConsentStorage`
(SQL puro). `action_key` válido conferido contra um set no service.

## Arquitetura — Frontend

- `lib/action-consents.ts` — catálogo client: para cada `key`, um objeto
  `{ key, version, title, summary, bullets[], links: {label, href}[] }`. A **versão** vive
  aqui; subir o número re-dispara o gate.
- `components/consent/ConsentProvider.tsx` — context client montado no layout autenticado.
  Carrega `GET /me/consents` uma vez (cache em `localStorage` `fl_consents` só pra não piscar),
  expõe `ensureConsent(actionKey): Promise<boolean>` e controla o modal.
- `hooks/use-action-consent.ts` — hook fino que lê o context: `const { ensureConsent } =
  useActionConsent()`.
- `components/consent/ActionConsentModal.tsx` — modal único (tablóide, segue taste skill:
  spring 100/20, prefers-reduced-motion, focus-visible). Mostra título + resumo + bullets +
  links "ler na íntegra" + checkbox "Li e aceito" + botões **Aceitar** (habilita só com
  checkbox) / **Recusar**. Aceitar → `POST /me/consents` + resolve `true`. Recusar/fechar →
  resolve `false`.

**Padrão de integração nos gatilhos:** no início de cada handler de ação crítica:

```ts
const { ensureConsent } = useActionConsent()
async function handleNovoCurso() {
  if (!(await ensureConsent("publish_offer"))) return // recusou → não prossegue
  // ...fluxo normal
}
```

## Data flow

1. Login → `ConsentProvider` busca `GET /me/consents`, guarda em memória + cache.
2. Usuário clica gatilho → handler chama `ensureConsent(key)`.
3. Se `consents[key] >= catálogo[key].version` → resolve `true` na hora (sem modal).
4. Senão → abre modal; Aceitar faz `POST` (atualiza estado/cache) e resolve `true`; Recusar
   resolve `false` e o handler aborta.

## Pontos de gatilho (inventário; arquivos exatos no plano)

- **publish_content:** abertura do composer de post/bee/story.
- **publish_offer:** "Novo curso" (`courses-section`, página de clan), "Novo serviço"
  (`profile-public-services-section`), "Novo produto" (UI de produtos do perfil).
- **purchase:** checkout de produto (carrinho/loja), agendamento (`schedule-booking`/
  `ServiceSelectionModal`), compra de curso.
- **affiliate:** ativação de afiliação (tela/fluxo de virar afiliado).

## Não-objetivos (YAGNI)

- **Sem gate na busca** (decisão do Alex).
- Sem histórico de versões aceitas (guarda só o aceite atual por ação; PK substitui).
- Sem painel admin de consentimentos nesta entrega (dá pra ler direto no banco).
- Não reescreve os documentos legais existentes — só referencia.

## Fatiamento

1. **Slice 1** — Backend: migration 129 + `ConsentStorage/Service/Controller` + rotas
   `GET/POST /me/consents`. Lint + verificação no banco pós-deploy.
2. **Slice 2** — Frontend base: `lib/action-consents.ts` (catálogo + minuta dos textos),
   `ConsentProvider`, `use-action-consent`, `ActionConsentModal`; montar provider no layout
   autenticado. Lint.
3. **Slice 3** — Wiring: `publish_content` (post/bee/story) + `publish_offer` (curso/serviço/
   produto, incl. clan). Lint + checagem manual.
4. **Slice 4** — Wiring: `purchase` (checkout/agendamento/curso) + `affiliate`. Lint + manual.

Cada slice: commit+push por área (backend no repo backend; front sem `git add -A`).
