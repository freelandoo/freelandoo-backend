# Atendimento IA — venda no user + bot automático (design)

**Data:** 2026-07-05 · **Status:** aprovado pelo Alex (com correções: planos múltiplos c/ limite de tokens, painel admin, página do bot)

## 1. O que é

Produto de plataforma vendido ao usuário da Freelandoo: um **bot de atendimento com IA** que responde as conversas do vendedor (DMs e chats de O.S.) falando com propriedade sobre a conta dele — cada perfil e subperfil, serviços, produtos, cursos e **preços** — usando a **API de Atendimento** (`/ext/v1`, token `flnd_atd_`) para ler/responder mensagens e a **API de Dados** (`/ext/v1/data`, token `flnd_data_`) para montar a base de conhecimento.

O bot é o **pjcodeworks-agent** (projeto local `atendimento views/pjcodeworks-agent-main`, backend Express + Postgres, deploy Railway). Ele **já tem** o canal Freelandoo pronto (mig 019: instância por conexão, webhook HMAC, fila idempotente por `id_message`, `responder.js` no motor de playbook) e **já tem** o gerador de playbook a partir da API de Dados (`playbook-freelandoo.js`: perfis, serviços/produtos por subperfil com centavos→R$, cursos, métricas → Markdown via LLM). O que falta é o **lado Freelandoo** (venda + provisionamento automático) e, no bot, o **endpoint de provisionamento** + **medidor/limite de tokens**.

A receita é 100% da plataforma (sem payout/holdback — diferente de comunidade privada e bolsa patrocínio).

## 2. Decisões cravadas (Alex, 2026-07-05)

1. **Cobrança:** assinatura **mensal Stripe** (reusa `createMonthlySubscriptionCheckoutSession` + o padrão de roteamento de `invoice.paid` criado para comunidade/bolsa).
2. **Planos múltiplos**, cada um com **preço mensal + limite de tokens de LLM por ciclo**. Admin controla tudo num painel próprio; seed com exemplos úteis. Preço de entrada ~R$ 29,90/mês.
3. **Limite de tokens:** ao bater o limite do ciclo, **o bot para de responder** até o próximo ciclo (ou upgrade de plano).
4. **Botão no user:** toolbar do headcard do `/account` → leva à **página do bot** (não é só modal).
5. **Página do bot (vendedor):** configurações "na medida do possível" (pausar/retomar, atender DMs on/off, atender O.S. on/off, instruções extras) + medidor de tokens do ciclo.
6. **Provisionamento:** automático **push** (Freelandoo → bot) com fila de retry; tokens cunhados pelo backend (o vendedor nunca vê token).
7. **Flag** `atendimento_ia_venda` seedada **DESLIGADA** (o produto depende do bot no ar; liga no Painel de Controle). Não confundir com a flag `atendimento_api` (a API em si).
8. Bot **nunca inicia conversa** — só responde (comportamento já existente do responder).

## 3. Arquitetura (visão geral)

```
Vendedor ──(1) assina plano──▶ Freelandoo backend ──(2) Stripe checkout subscription
Stripe ──(3) checkout.completed/invoice.paid──▶ Freelandoo webhook
Freelandoo ──(4) cunha tokens flnd_atd_ + flnd_data_ (managed) ──▶ tb_api_connection
Freelandoo ──(5) POST {BOT_URL}/freelandoo/provision {secret, external_id, tokens, plano, config}──▶ Bot
Bot ──(6) setWebhook na API de Atendimento + gerarPlaybook (API de Dados) + ativa instância
Comprador manda msg ──▶ Freelandoo ──webhook──▶ Bot ──responde via /ext/v1── (contando tokens)
Vendedor muda config/plano ou cancela ──▶ Freelandoo re-push provision / revoga tokens + deprovision
```

Idempotência em todas as pontas: provision é **upsert** por `external_id`; pagamentos por `stripe_invoice_id`; eventos de mensagem por `id_message` (já existente no bot).

## 4. Freelandoo — modelo de dados (mig 175)

### `tb_atendimento_ia_plan`
| coluna | tipo | nota |
|---|---|---|
| id_plan | BIGSERIAL PK | |
| name | TEXT NOT NULL | ex.: "Básico" |
| description | TEXT | linha de venda |
| monthly_cents | INT NOT NULL CHECK > 0 | |
| token_limit_monthly | BIGINT NOT NULL CHECK > 0 | tokens de LLM por ciclo |
| sort_order | INT DEFAULT 0 | |
| is_active | BOOLEAN DEFAULT TRUE | soft-hide na vitrine |
| created_at / updated_at | TIMESTAMPTZ | |

**Seed (exemplos úteis, editáveis no painel admin):**
| Plano | Preço | Tokens/mês | ≈ atendimentos* |
|---|---|---|---|
| Básico | R$ 29,90 | 300.000 | ~80–100 respostas |
| Profissional | R$ 59,90 | 1.000.000 | ~300 respostas |
| Turbo | R$ 99,90 | 2.500.000 | ~800 respostas |

*estimativa exibida como texto no admin (1 turno ≈ 3–4k tokens com playbook no prompt); não é contrato.

### `tb_atendimento_ia_sub`
| coluna | tipo | nota |
|---|---|---|
| id_sub | BIGSERIAL PK | |
| id_user | UUID FK tb_user | UNIQUE parcial WHERE status IN ('pending','active','past_due') — 1 viva por user |
| id_plan | BIGINT FK plan | |
| monthly_cents / token_limit_monthly | snapshot do plano na compra | mudança de plano não retro-aplica |
| status | pending / active / past_due / canceled / expired | mesmo vocabulário das outras subs |
| stripe_session_id / stripe_subscription_id / stripe_customer_id | TEXT, UNIQUEs parciais | |
| current_period_start / current_period_end | TIMESTAMPTZ | do invoice.paid; manda pro bot como âncora do ciclo |
| provisioning_status | pending / provisioned / failed / deprovisioned | |
| provision_attempts / next_provision_attempt_at / provision_last_error | retry com backoff | |
| id_connection_atendimento / id_connection_data | FK tb_api_connection | tokens cunhados |
| config | JSONB DEFAULT '{}' | `{ paused, answer_dm, answer_os, extra_instructions }` |
| created_at / activated_at / canceled_at / updated_at | | |

### `tb_api_connection` (alteração)
- `managed_by TEXT NULL` (valor: `'atendimento_ia'`). Conexões gerenciadas: **não contam no teto de 3 ativas por kind**, aparecem nos painéis do user com selo "Gerenciada pelo Atendimento IA" e **sem** botão de revogar (morrem junto com a assinatura). Cunhadas server-side; token em claro **nunca** vai pro frontend — só pro payload de provision.

### `tb_stripe`/webhook
Sem tabela nova de pagamentos: `invoice.paid` só mantém a sub ativa e atualiza o período (auditoria pelo Stripe + tb_stripe_webhook_event).

## 5. Freelandoo — endpoints

### Vendedor (`/me/atendimento-ia`, auth + `requireFeature('atendimento_ia_venda')`)
- `GET /me/atendimento-ia` → `{ plans[], sub | null, usage | null }`. `usage` vem do bot (`GET {BOT_URL}/freelandoo/usage/:external_id`, cache in-memory 60s; se o bot não responder, `usage:null` e o front mostra "indisponível").
- `POST /me/atendimento-ia/checkout` body `{ id_plan }` → cria sub pending + subscription checkout (metadata `type='atendimento_ia'`, `id_sub`). Bloqueia se já há sub viva (409 → orientar trocar de plano).
- `PATCH /me/atendimento-ia/config` body parcial `{ paused, answer_dm, answer_os, extra_instructions (≤2000 chars) }` → salva no JSONB + re-push provision (best-effort; se falhar, marca retry).
- `POST /me/atendimento-ia/cancel` → cancela Stripe (imediato), revoga as 2 conexões, deprovision best-effort, status canceled.
- **Troca de plano (v1):** sem pro-rata — o front orienta: cancelar e assinar o novo plano. (Upgrade in-place via Stripe subscription update fica pra v2.)

### Admin (`/admin/atendimento-ia`, `[authMiddleware, roleMiddleware("Administrator")]`)
- CRUD `GET/POST /admin/atendimento-ia/plans`, `PATCH/DELETE /admin/atendimento-ia/plans/:id` (delete = `is_active=false`; plano com assinantes não some das subs — snapshot).
- `GET /admin/atendimento-ia/subs?status=` → lista assinantes (user, plano, status, provisioning, uso do ciclo via bot quando disponível).
- `POST /admin/atendimento-ia/subs/:id/reprovision` → força re-push (zera backoff).

### Webhook Stripe (mesmo padrão comunidade/bolsa — não regredir)
- `fulfillCheckoutSession`: case `atendimento_ia` → ativa sub, cunha as 2 conexões (se ainda não existem), agenda provision.
- Roteador de `invoice.paid`: membership → sponsorship → **atendimento_ia** → profile-sub; fallback por `subscription_data.metadata`. No paid: atualiza período + re-push provision com a nova âncora de ciclo (**é isso que zera o contador de tokens no bot**).
- `invoice.payment_failed` → past_due (bot continua até o subscription.deleted; opcional pausar — decisão: **continua** em past_due, o Stripe faz smart retries).
- `customer.subscription.deleted` → canceled + revoga conexões + deprovision.
- `checkout.session.expired` → sub pending vira expired.
- `charge.refunded` total → trata como canceled (revoga + deprovision).

## 6. Freelandoo — provisionamento (`AtendimentoIaProvisionService`)

- Envs Railway: `ATENDIMENTO_BOT_URL` (URL pública do **backend** do bot — a vercel.app é só o dashboard), `ATENDIMENTO_BOT_SECRET`.
- `pushProvision(sub)` → `POST {BOT_URL}/freelandoo/provision`, header `x-provision-secret`, body:

```json
{
  "external_id": "<id_user>",
  "label": "<username>",
  "token_atendimento": "flnd_atd_...",
  "token_data": "flnd_data_...",
  "token_limit_monthly": 300000,
  "cycle_start": "2026-07-05T00:00:00Z",
  "config": { "paused": false, "answer_dm": true, "answer_os": true, "extra_instructions": "" }
}
```

  Resposta 200 `{ ok: true }` → `provisioning_status='provisioned'`. Os tokens em claro só existem no momento da cunhagem (o hash fica no banco); o service cunha e envia na mesma operação. **Re-push de config/ciclo NÃO re-envia tokens** (campos omitidos = manter).
- **Retry:** falhou → `failed` + backoff (1min → 5min → 30min → 2h → 6h, máx 8 tentativas) via sweeper no boot (padrão WebhookDispatchService). Como não armazenamos token em claro, **cada nova tentativa de provisionar RE-CUNHA os 2 tokens** (revoga os anteriores e envia os novos no payload) — o bot faz upsert, então sobrescrever token é seguro. Página do vendedor mostra "ativando…" enquanto `pending/failed`.
- `pushDeprovision(sub)` → `POST /freelandoo/deprovision { external_id }` best-effort (tokens já revogados garantem o desligamento mesmo sem resposta).
- **NUNCA logar token** (nem no runWithLogs meta).

## 7. Bot (pjcodeworks-agent) — o que muda

1. **`POST /freelandoo/provision`** (novo, secret `FREELANDOO_PROVISION_SECRET`): upsert por `external_id` — cria/atualiza a instância Freelandoo (linha em `app.empresa_whatsapp_instances`, empresa única "Freelandoo — Atendimento IA"), guarda tokens cifrados (crypto.js), chama `setWebhook` da API de Atendimento apontando pro próprio backend, dispara `gerarPlaybook` (playbook-freelandoo.js já existente) em background e ativa. Campos de token omitidos = mantém os atuais (re-push de config). `cycle_start` novo = **zera o contador de tokens do ciclo**.
2. **`POST /freelandoo/deprovision`**: desativa a instância (não apaga histórico).
3. **`GET /freelandoo/usage/:external_id`** (secret): `{ cycle_start, tokens_used, token_limit, paused_by_limit, playbook_generated_at }`.
4. **Medidor/limite de tokens:** tabela/colunas por instância `(cycle_start, tokens_used)`. Cada resposta soma input+output tokens do provider (o rastreio de uso de LLM já existe — `api-llm-uso.js`; reusar a fonte). Antes de responder: `paused` (config) ou `tokens_used >= token_limit` → **não responde** (loga skip `limite_tokens`). Config `answer_dm/answer_os` filtra por prefixo `dm:`/`os:`; `extra_instructions` é injetado no prompt da instância (com guarda de tamanho).
5. **Refresh do playbook:** job diário re-roda `gerarPlaybook` das instâncias ativas (preços/serviços novos entram em ≤24h).

## 8. Freelandoo — UI

### Página do vendedor: `/account/atendimento-ia` (client, i18n pt/en/es, `.fl-sharp`, gated `useFeature('atendimento_ia_venda')`)
- **Sem assinatura:** pitch curto (o que o bot faz: responde DMs e O.S. sabendo seus serviços e preços; nunca inicia conversa) + **cards dos planos** (nome, R$/mês, tokens/mês) → assinar → checkout. Retorno `?atendimento_ia=sucesso`.
- **Ativando:** pago mas `provisioning_status != provisioned` → estado "ativando seu bot…".
- **Ativo:** medidor de tokens do ciclo (barra usado/limite + data de reset = fim do período; estourou → banner "limite atingido — o bot está pausado até DD/MM ou faça upgrade"), controles: **Pausar/Retomar**, **Responder diretas** on/off, **Responder O.S.** on/off, **Instruções extras** (textarea + salvar), plano atual + orientação de troca, **Cancelar** (confirm).
- **past_due:** banner de pagamento pendente. **canceled:** volta ao pitch.
- Botão **"Atendimento IA"** (ícone Bot) na toolbar do headcard do `/account` linkando pra página.
- Proxies `app/api/me/atendimento-ia/*`.

### Painel admin: `/administracao/atendimento-ia` (pt-only, dark utilitário — convenção admin)
- Aba **Planos**: tabela CRUD (nome, preço, tokens/mês, ~atendimentos estimados, ativo, ordem) — os 3 exemplos seedados já aparecem aqui.
- Aba **Assinantes**: lista (username, plano, status, provisioning, uso do ciclo, última tentativa/erro) + botão "Re-provisionar" por linha.
- Card "Atendimento IA" nos quick-links de `/administracao`.
- Proxy catch-all `app/api/admin/atendimento-ia/[...path]`.

## 9. Erros e casos de borda
- **Bot fora do ar na compra:** sub ativa + provisioning failed → retry automático; vendedor vê "ativando…"; admin vê o erro e pode forçar.
- **Recompra pós-cancelamento:** nova sub + tokens novos (as conexões antigas ficam revogadas).
- **Duplo clique/2 checkouts:** UNIQUE parcial de sub viva por user; checkout reusa a pending.
- **Usage indisponível** (bot não responde ao GET): página mostra medidor "indisponível no momento" sem quebrar.
- **Flag desligada com assinantes ativos:** esconde venda/página nova, MAS webhook/cobrança/bot continuam (kill-switch é de venda, não de serviço) — igual à semântica da flag `comunidade_privada`.
- **Limite estourado ≠ cancelado:** cobrança continua; bot volta no próximo `invoice.paid` (âncora nova zera contador).

## 10. Testes
- **Unit (Freelandoo):** ProvisionService com bot mockado (sucesso/timeout/500 → retry states); cálculo de elegibilidade de checkout; managed connections fora do teto de 3.
- **Unit (bot):** provision upsert idempotente; gate de limite (limite-1 responde, limite não responde); reset por cycle_start novo.
- **E2E manual (pendência Alex):** Stripe test + bot no Railway → assinar → responder conversa real → estourar limite artificialmente → cancelar.

## 11. Pendências do Alex (não-codáveis)
1. Subir o **backend** do bot no Railway (tem Dockerfile; token do Railway já fornecido — guardado na memória do CLI, fora do repo) e me passar/registrar a URL pública → env `ATENDIMENTO_BOT_URL` + `ATENDIMENTO_BOT_SECRET` no Railway da Freelandoo e `FREELANDOO_PROVISION_SECRET` no do bot.
2. Ligar a flag `atendimento_ia_venda` no Painel de Controle quando quiser abrir a venda.
3. Rodar o e2e do item 10.

## 12. Fatiamento previsto
- **F1 — Freelandoo backend:** mig 175 (plans + subs + managed_by + seed + flag OFF) + checkout + webhook (4 pontos) + ProvisionService + sweeper + endpoints /me e /admin.
- **F2 — Freelandoo frontend:** página `/account/atendimento-ia` + botão no headcard + i18n (ns novo `AtendimentoIa`) + proxies.
- **B1 — Bot:** provision/deprovision/usage + limite de tokens + config por instância + cron de playbook.
- **F3 — Admin UI:** `/administracao/atendimento-ia` (planos + assinantes) + quick-link.
- **F4 — Docs:** contrato Freelandoo↔bot em `docs/API_ATENDIMENTO_IA_PROVISION.md` + atualização do CLAUDE.md/memória.
