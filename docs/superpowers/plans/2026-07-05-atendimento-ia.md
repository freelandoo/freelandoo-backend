# Atendimento IA — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (execução inline nesta sessão). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vender o bot de atendimento como assinatura mensal por planos (preço + limite de tokens LLM), com provisionamento automático Freelandoo → bot pjcodeworks, página do vendedor com controles/medidor e painel admin de planos.

**Architecture:** Freelandoo cunha tokens gerenciados (`managed_by='atendimento_ia'`) e faz push idempotente para `POST {BOT_URL}/freelandoo/provision` com retry/backoff (re-cunha tokens a cada tentativa). O webhook Stripe segue o padrão de roteamento por tabela (membership → sponsorship → **atendimento_ia** → profile). O bot faz upsert de instância, conta tokens por ciclo e para ao bater o limite; `invoice.paid` re-push com `cycle_start` novo zera o contador.

**Tech Stack:** Express+pg (2 backends), Stripe subscriptions (price_data mensal), Next.js 16 (front), i18n 3 idiomas.

**Spec:** `docs/superpowers/specs/2026-07-05-atendimento-ia-design.md`

---

### Task F1.1 — Mig 175 (planos, subs, managed_by, flag OFF)

**Files:** Create `freelandoo-backend/src/databases/migrations/175_atendimento_ia.sql`

- [ ] `tb_atendimento_ia_plan` (id_plan BIGSERIAL, name, description, monthly_cents INT>0, token_limit_monthly BIGINT>0, sort_order, is_active, timestamps) + seed 3 planos: Básico 2990/300000, Profissional 5990/1000000, Turbo 9990/2500000 (`ON CONFLICT DO NOTHING` via UNIQUE em name? — usar `WHERE NOT EXISTS` por name pra idempotência sem UNIQUE).
- [ ] `tb_atendimento_ia_sub` conforme spec §4 (UNIQUE parcial `(id_user) WHERE status IN ('pending','active','past_due')`; UNIQUEs parciais de session/subscription; provisioning_status CHECK; config JSONB default `{"paused":false,"answer_dm":true,"answer_os":true,"extra_instructions":""}`).
- [ ] `ALTER TABLE tb_api_connection ADD COLUMN IF NOT EXISTS managed_by TEXT NULL` + index parcial.
- [ ] Flag: `INSERT INTO tb_feature_flag (flag_key,label,description,is_enabled) VALUES ('atendimento_ia_venda',...,FALSE) ON CONFLICT DO NOTHING` (schema tem `is_enabled`, mig 168).
- [ ] Conferir nº colunas=valores em todo INSERT (memória: migration falha derruba boot).

### Task F1.2 — Tokens gerenciados fora do teto

**Files:** Modify `src/storages/ApiConnectionStorage.js`, `src/services/ApiConnectionService.js`

- [ ] `countActive` passa a excluir `managed_by IS NOT NULL` (teto de 3 é só para conexões do próprio user).
- [ ] `listByUser` inclui `managed_by` no SELECT (painéis mostram selo; front F2 não precisa mudar os modais existentes — só ganham o campo).
- [ ] `revoke` (user) recusa conexão gerenciada (`error: "Conexão gerenciada pelo Atendimento IA"`), novo `revokeManaged(conn, id_connection)` interno sem guard de dono p/ uso do service.
- [ ] Storage: `create` já aceita kind; adicionar param `managed_by`.

### Task F1.3 — AtendimentoIaService + ProvisionService

**Files:** Create `src/services/AtendimentoIaService.js`, `src/services/AtendimentoIaProvisionService.js`, `src/storages/AtendimentoIaStorage.js`

- [ ] Storage: CRUD de plan (list/get/create/update/softDelete), sub (createPending, getLiveByUser, getBySession, getBySubscriptionId, getById, activate, setStatus/BySubscriptionId, markCanceled, markExpiredBySession, setPeriod, setProvisioning{status,attempts,next,error}, setConnections, setConfig, listSubsAdmin, listDueForProvision).
- [ ] `AtendimentoIaService`: `getMine(user)` (plans + sub + usage via ProvisionService.fetchUsage com cache 60s), `createCheckout(user,{id_plan})` (409 se sub viva; cria pending com snapshot; `createMonthlySubscriptionCheckoutSession` metadata `{type:'atendimento_ia', id_sub}`; success `/account/atendimento-ia?atendimento_ia=sucesso`), `updateConfig(user, patch)` (valida booleans + extra_instructions ≤2000; salva; re-push best-effort), `cancel(user)` (Stripe cancel imediato + revoga conexões managed + deprovision best-effort + status canceled).
- [ ] Webhook handlers no service: `confirmStripeSession(session)` (ativa + `scheduleProvision`), `handleInvoicePaid(invoice, subscriptionId)` / `...ByMetadata` (atualiza período + re-push com cycle_start novo — **zera contador no bot**), `handleInvoiceFailed` (past_due), `handleSubscriptionDeleted` (cancela+revoga+deprovision), `handleChargeRefunded` (full refund ⇒ mesmo caminho do deleted; achar sub por invoice→subscription como no handleChargeRefunded de perfil).
- [ ] `AtendimentoIaProvisionService`: envs `ATENDIMENTO_BOT_URL`/`ATENDIMENTO_BOT_SECRET`; `pushProvision(sub)` — **re-cunha os 2 tokens** (revokeManaged antigos + create novos c/ managed_by, capturando token em claro só na memória) e POST provision (payload spec §6, header `x-provision-secret`); sucesso ⇒ provisioned; falha ⇒ failed + backoff `[60s,300s,1800s,7200s,21600s]` máx 8; `pushConfig(sub)` (payload SEM tokens); `pushDeprovision(external_id)`; `fetchUsage(external_id)` GET `/freelandoo/usage/:id`; `startSweeper()` no boot (30s interval, processa `listDueForProvision`). NUNCA logar token.

### Task F1.4 — Rotas + webhook wiring

**Files:** Create `src/routes/atendimentoIa.routes.js`, `src/routes/atendimentoIaAdmin.routes.js`; Modify `src/routes/index.js`, `src/controllers/` (novo `AtendimentoIaController.js`), `src/services/StripeWebhookService.js`, `src/server.js`/boot (sweeper)

- [ ] Rotas /me: GET `/me/atendimento-ia`, POST `/me/atendimento-ia/checkout`, PATCH `/me/atendimento-ia/config`, POST `/me/atendimento-ia/cancel` — todas `[authMiddleware, requireFeature('atendimento_ia_venda')]` exceto... decisão: `GET` e `cancel`/`config` SEM requireFeature (assinante existente gerencia mesmo com venda desligada); só `checkout` exige a flag.
- [ ] Admin: CRUD plans + GET subs + POST subs/:id/reprovision, guard `[authMiddleware, roleMiddleware("Administrator")]`.
- [ ] StripeWebhookService: case `atendimento_ia` no fulfill; entrada no roteador invoice.paid/failed/deleted (após sponsorship, antes do profile) + fallback metadata; case expire; charge.refunded chain.
- [ ] Boot: `AtendimentoIaProvisionService.startSweeper()` junto do sweeper do WebhookDispatchService (mesmo ponto de inicialização).
- [ ] `node --check` em tudo; commit `feat(atendimento-ia): slice F1 — venda por planos + provisionamento (backend)` + push.

### Task B1 — Bot pjcodeworks (provision/usage/limite)

**Files (em `atendimento views/pjcodeworks-agent-main/backend`):** Create `sql/migrations/0XX_freelandoo_provision.sql` (numerar após a última), `src/routes/freelandoo-provision.js`; Modify `src/db/freelandoo.js`, `src/freelandoo/responder.js`, `index.js` (mount + cron), `.env.example`

- [ ] Mig: colunas na tabela de conexão Freelandoo existente (ver `019_freelandoo_channel.sql` e `db/freelandoo.js` antes): `external_id TEXT UNIQUE`, `token_data_encrypted`, `token_limit_monthly BIGINT`, `cycle_start TIMESTAMPTZ`, `tokens_used BIGINT DEFAULT 0`, `config JSONB DEFAULT '{}'`, `playbook_generated_at`.
- [ ] `POST /freelandoo/provision` (header `x-provision-secret` = env `FREELANDOO_PROVISION_SECRET`, comparação timing-safe): upsert por external_id — tokens presentes ⇒ re-cifra e salva; `cycle_start` mudou ⇒ `tokens_used=0`; salva limit/config; registra webhook via `client.setWebhook(PUBLIC_URL + rota do webhook existente)`; dispara `gerarPlaybook` em background (grava resultado como playbook/contexto da instância — reusar o caminho que o dashboard usa hoje em `api-freelandoo.js`/`playbook-freelandoo.js`); ativa. Responde `{ok:true}` rápido (playbook async).
- [ ] `POST /freelandoo/deprovision`: `ativo=false`.
- [ ] `GET /freelandoo/usage/:external_id`: `{cycle_start, tokens_used, token_limit, paused_by_limit, playbook_generated_at}`.
- [ ] Responder: antes de processar — `config.paused` ⇒ skip; `dm:`/`os:` vs `answer_dm/answer_os` ⇒ skip; `tokens_used >= token_limit` ⇒ skip (`limite_tokens`). Após responder: somar tokens (input+output do aiProvider — ver como `api-llm-uso.js` captura; usar a mesma fonte) em `tokens_used`. `extra_instructions` (≤2000) injetado no contexto do playbook.
- [ ] Cron diário (setInterval 24h no boot, com guard de env): re-gera playbook das instâncias ativas.
- [ ] `npm test` do bot se existir suite; commit no repo do bot (verificar se é git repo; se não for, apenas salvar arquivos e avisar).

### Task F2 — Front vendedor

**Files:** Create `app/(header-only)/account/atendimento-ia/page.tsx`, proxies `app/api/me/atendimento-ia/{route.ts,checkout/route.ts,config/route.ts,cancel/route.ts}`; Modify headcard do `/account` (botão Bot na toolbar, gated `useFeature('atendimento_ia_venda')` OU sub ativa), `scripts/i18n-atendimento-ia-merge.js` (novo, ns `AtendimentoIa`)

- [ ] Página client, `.fl-sharp`, estados: pitch+cards de planos (nome, R$/mês via locale, tokens/mês compacto, CTA assinar → checkout redirect), ativando (provisioning pending/failed), ativo (medidor barra tokens usado/limite + reset em period_end; banner limite atingido; toggles paused/answer_dm/answer_os com PATCH otimista; textarea instruções extras + salvar; plano atual + hint de troca "cancele e assine outro"; cancelar c/ confirm), past_due banner, canceled ⇒ pitch. Retorno `?atendimento_ia=sucesso`.
- [ ] i18n: todas as strings `t("chave","fallback pt")` + merge script (pt/en/es) rodado no mesmo commit.
- [ ] `npm run lint` + `npm run build`; commit `feat(atendimento-ia): slice F2 — página do bot no /account` + push (NUNCA `git add -A`).

### Task F3 — Admin UI

**Files:** Create `app/(header-only)/administracao/atendimento-ia/page.tsx`, proxy `app/api/admin/atendimento-ia/[...path]/route.ts`; Modify quick-links de `/administracao`

- [ ] pt-only dark utilitário (convenção admin, sem i18n): aba Planos (tabela CRUD inline: nome, preço R$, tokens/mês, ~estimativa `Math.round(tokens/3500)` atendimentos, ativo, ordem) + aba Assinantes (username, plano, status, provisioning + erro, uso do bot quando disponível, botão Re-provisionar).
- [ ] Card "Atendimento IA" (ícone Bot) nos quick-links.
- [ ] lint + build; commit `feat(atendimento-ia): slice F3 — painel admin (planos + assinantes)` + push.

### Task F4 — Docs + memória

**Files:** Create `freelandoo-backend/docs/API_ATENDIMENTO_IA_PROVISION.md` (contrato Freelandoo↔bot: 3 endpoints, headers, payloads, semântica de upsert/ciclo); Modify `CLAUDE.md` (seção GATILHO), memória do CLI

- [ ] Documentar envs dos 2 lados + pendências do Alex (deploy backend bot no Railway, secrets, ligar flag).
- [ ] Commit docs no backend + atualizar memória `project_freelandoo_atendimento_ia`.

---

## Self-review (rodado na escrita)
- **Cobertura do spec:** §4→F1.1/F1.2; §5→F1.3/F1.4; §6→F1.3; §7→B1; §8→F2/F3; §9 embutido nos guards; §10 parcial (unit onde a suite existir; e2e = pendência Alex); §11/§12→F4. Gap intencional: testes unitários formais do lado Freelandoo — o backend não tem suite de unit isolada (só e2e test:checkout, bloqueado por ambiente); validação = node --check + smoke de rotas + build front. Registrado como risco no F4.
- **Consistência de nomes:** flag `atendimento_ia_venda`; metadata `type='atendimento_ia'`; header `x-provision-secret`; envs `ATENDIMENTO_BOT_URL/ATENDIMENTO_BOT_SECRET` (Freelandoo) e `FREELANDOO_PROVISION_SECRET` (bot) — iguais ao spec.
- **Placeholders:** nenhum "TBD"; os pontos "ver como X faz" são instruções de leitura de código existente no repo do bot, resolvidas na execução do B1.
