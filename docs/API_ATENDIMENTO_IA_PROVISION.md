# Atendimento IA — contrato de provisionamento (Freelandoo ↔ bot)

Contrato entre o backend da **Freelandoo** e o **bot de atendimento**
(pjcodeworks-agent). A Freelandoo vende o produto (assinatura mensal por
planos) e provisiona o bot automaticamente; o bot atende as conversas do
vendedor pelas APIs de Atendimento (`/ext/v1`) e de Dados (`/ext/v1/data`).

- Spec do produto: `docs/superpowers/specs/2026-07-05-atendimento-ia-design.md`
- Lado Freelandoo: `src/services/AtendimentoIaProvisionService.js` (mig 175)
- Lado bot: `backend/src/routes/freelandoo-provision.js` (mig 020 do bot)

## Autenticação

Todas as chamadas levam o header **`x-provision-secret`** com o segredo
compartilhado (comparação timing-safe no bot).

| Onde | Env |
|---|---|
| Freelandoo (Railway) | `ATENDIMENTO_BOT_URL` (URL pública HTTPS do **backend** do bot) e `ATENDIMENTO_BOT_SECRET` |
| Bot (Railway) | `FREELANDOO_PROVISION_SECRET` (mesmo valor do `ATENDIMENTO_BOT_SECRET`) e `PUBLIC_BACKEND_URL` (ou `RAILWAY_PUBLIC_DOMAIN`) |

## POST `{BOT_URL}/freelandoo/provision`

Upsert por `external_id` (= `id_user` na Freelandoo). Campos de token
**omitidos = manter os atuais** (re-push leve de config/ciclo).

```json
{
  "external_id": "<id_user>",
  "label": "<username>",
  "token_atendimento": "flnd_atd_...",   // presente na 1ª ativação e nos re-provisionamentos (tokens re-cunhados)
  "token_data": "flnd_data_...",
  "token_limit_monthly": 300000,
  "cycle_start": "2026-07-05T00:00:00Z", // âncora do ciclo de cobrança
  "config": { "paused": false, "answer_dm": true, "answer_os": true, "extra_instructions": "" }
}
```

Comportamento do bot:
- **1ª vez** (`external_id` desconhecido): exige os 2 tokens; cria a empresa
  dedicada "Freelandoo — Atendimento IA" (slug `freelandoo-atendimento-ia`,
  lazy), o contexto 1:1 e a instância (`app.empresa_whatsapp_instances`,
  `evolution_instance` = `fl-ia-…`), cifra os tokens (AES-256-GCM,
  `FREELANDOO_ENC_KEY`), registra o webhook na API de Atendimento
  (`{PUBLIC_BACKEND_URL}/freelandoo/webhook/<instance_id>`) e dispara a
  geração do playbook em background. Responde `201 { ok, created: true }`.
- **Upsert**: atualiza o que veio. `cycle_start` diferente do atual **zera o
  contador de tokens** (`tokens_used = 0`). Token de atendimento novo ⇒
  re-registra o webhook. Token de dados novo ⇒ re-gera o playbook. Só config
  ⇒ atualiza `instrucoes_do_vendedor` na versão ativa do contexto (sem LLM).
  Reativa a instância (recompra pós-cancelamento). `200 { ok, created: false }`.
- **Playbook**: `playbook-freelandoo.js` coleta os 7 endpoints da API de
  Dados, gera o Markdown via LLM e a versão do contexto nasce com
  `conteudo_json.informacoes_empresa = markdown` + regras fixas (nunca
  inventar preço; nunca iniciar conversa; seguir `instrucoes_do_vendedor`).
  A versão é ATIVADA (`ativarContexto2`) — sem versão ativa a instância não
  responde. Refresh automático **diário** (10 min após o boot, depois a cada 24h).

## POST `{BOT_URL}/freelandoo/deprovision`

```json
{ "external_id": "<id_user>" }
```
Desativa a instância (`ativo = FALSE`), preservando histórico. Idempotente
(`{ ok, already: true }` se já não existe). Os tokens já foram revogados pela
Freelandoo antes desta chamada — mesmo sem ela o bot morre com 401.

## GET `{BOT_URL}/freelandoo/usage/:external_id`

```json
{
  "cycle_start": "2026-07-05T00:00:00Z",
  "tokens_used": 123456,
  "token_limit": 300000,
  "paused_by_limit": false,
  "paused_by_config": false,
  "active": true,
  "playbook_generated_at": "2026-07-05T12:00:00Z"
}
```
A Freelandoo consome com cache de 60s para o medidor da página
`/account/atendimento-ia` e o painel admin.

## Limite de tokens (enforcement no bot)

O `responder.js` conta os tokens REAIS de cada turno (usage do provedor;
fallback ~chars/4) via provider embrulhado, soma em
`freelandoo_connections.tokens_used` e **não responde** quando
`tokens_used >= token_limit_monthly` (skip `limite_tokens`). O contador zera
quando a Freelandoo re-push com `cycle_start` novo — o que acontece a cada
`invoice.paid` (renovação). Gates adicionais: `config.paused`,
`config.answer_dm` (conversas `dm:`) e `config.answer_os` (conversas `os:`).

## Semântica de re-cunhagem de tokens

A Freelandoo **não persiste token em claro** (só hash). Por isso, toda
tentativa de provisionamento completo (1ª vez, retry do sweeper, botão
"Re-provisionar" do admin) **revoga os tokens gerenciados anteriores e cunha
novos**, enviados no payload. O upsert do bot sobrescreve — é seguro e
esperado receber tokens diferentes dos anteriores.

## Fluxo de cobrança (referência)

1. Vendedor assina um plano → checkout Stripe subscription mensal
   (metadata `type='atendimento_ia'`).
2. `checkout.session.completed` → Freelandoo ativa a sub + agenda provision.
3. `invoice.paid` (todo ciclo) → atualiza período + re-push `cycle_start` novo
   (zera contador no bot).
4. `invoice.payment_failed` → `past_due` (bot segue até o Stripe desistir).
5. `customer.subscription.deleted` / cancelamento na página / refund total →
   revoga tokens + `deprovision` + status `canceled`.

## Pendências operacionais (Alex)

1. Subir o **backend** do bot no Railway (a URL vercel.app é só o dashboard)
   e aplicar a mig `sql/migrations/020_freelandoo_provision.sql` no banco do
   bot (o bot não roda migrations no boot).
2. Configurar os envs dos dois lados (tabela acima) com o MESMO segredo.
3. Ligar a flag **`atendimento_ia_venda`** no Painel de Controle para abrir a
   venda (nasce desligada).
4. E2E com Stripe test: assinar → responder conversa → estourar limite →
   cancelar.
