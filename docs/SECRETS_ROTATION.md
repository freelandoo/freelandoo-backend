# Relatório de credenciais — Freelandoo

Gerado em 2026-05-23 pela Frente 1 do hardening.

> **Como ler:** cada credencial tem **origem** (de onde veio), **escopo**
> (onde é usada), **estado** (se já apareceu no histórico git) e **ação**
> recomendada (rotacionar ou ok).

Convenção:
- 🔴 **ROTACIONAR JÁ** — chave real apareceu em arquivo rastreado pelo git.
- 🟡 **ROTACIONAR PREVENTIVAMENTE** — não há leak confirmado, mas a chave
  é antiga ou já passou por máquinas/CLIs e o custo de rotacionar é baixo.
- 🟢 **OK** — chave nunca esteve em git público; manter monitorada.

---

## Backend

### 🔴 `DATABASE_URL` (Postgres Railway)
- **Origem:** Railway → projeto `carefree-curiosity` → Postgres.
- **Escopo:** servidor (app + migrations + scripts utilitários como
  `migrate-remote.js`, `check-schema.js`).
- **Estado:** **VAZADA.** Arquivo `.env.migrate` (única linha:
  `DATABASE_URL=postgresql://postgres:IcjFQksHzGHMfDVNYjoCiwGATOhuTLFc@monorail.proxy.rlwy.net:55621/railway`)
  foi adicionado no commit `4fe0e8f` (2026-04-25) e permaneceu rastreado
  até esta auditoria.
- **Ação:**
  1. Rotacionar credencial do Postgres no painel Railway
     (`Postgres → Variables → DATABASE_URL` → "Generate new password" ou
     equivalente).
  2. Atualizar `.env` local com o novo URL.
  3. Atualizar variável no serviço Backend do Railway (geralmente já é
     reference da var do Postgres, então é só redeploy).
  4. (Opcional, recomendável) reescrever histórico git removendo
     `.env.migrate` de TODOS os commits passados — `git filter-repo` ou
     BFG. **NÃO faço isso automaticamente:** reescrever histórico é
     destrutivo e exige coordenação com todos que clonaram o repo.

### 🟡 `JWT_SECRET`
- **Origem:** gerado manualmente em algum momento.
- **Escopo:** assinatura/verificação de JWT em `AuthService`, `socket.js`,
  middlewares.
- **Estado:** **não há leak confirmado** no histórico git
  (`git log -S "JWT_SECRET="` só retorna placeholders).
- **Ação:** rotacionar preventivamente — gera invalidação geral dos tokens
  ativos (todo mundo precisa relogar). Comando sugerido:
  `openssl rand -base64 48`.
  Atualizar em `.env` local + Railway. Considerar fazer junto com algum
  deploy programado para evitar má experiência fora de hora.

### 🟡 `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- **Origem:** Stripe Dashboard.
- **Escopo:** `StripeService.js` (criação de sessions) e
  `webhooks.routes.js` (verificação de assinatura).
- **Estado:** sem leak confirmado.
- **Ação:** rotacionar **apenas se houve compartilhamento por canal
  inseguro** (WhatsApp, email, screenshot). Caso contrário, manter e
  garantir que estão fora do `.env.example`. O `STRIPE_WEBHOOK_SECRET` é
  diferente entre `localhost`, `staging` e `prod` — não confundir.

### 🟡 `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`
- **Origem:** Cloudflare R2.
- **Escopo:** upload (perfil, portfólio, manifestação, etc.).
- **Estado:** sem leak confirmado.
- **Ação:** rotacionar preventivamente se compartilhada. Criar nova API
  token no Cloudflare → atualizar `.env` + Railway → revogar a anterior.

### 🟡 `RESEND_API_KEY`
- **Origem:** Resend.
- **Escopo:** email transacional (ativação, reset de senha, notificações).
- **Estado:** sem leak confirmado.
- **Ação:** preventiva — Resend permite múltiplas chaves; criar nova,
  promover, revogar a antiga.

### 🟡 `MELHOR_ENVIO_SANDBOX_TOKEN`
- **Origem:** Painel Melhor Envio (sandbox).
- **Escopo:** cálculo + geração de etiquetas (Loja de produtos).
- **Estado:** sem leak confirmado.
- **Ação:** o token expira em **2027-05-12** (planejado para rotação
  automática antes). Manter. Quando trocar para produção, gerar token
  novo e nunca usar o sandbox em prod.

### 🟢 `GOOGLE_CLIENT_ID` (backend)
- **Origem:** Google Cloud Console.
- **Escopo:** validação do `id_token` no signin com Google.
- **Estado:** OK — Client ID **público** por design (também é exposto no
  frontend como `NEXT_PUBLIC_GOOGLE_CLIENT_ID`). Não há "secret"
  correspondente porque o fluxo é client-side popup, sem trocar code.
- **Ação:** nenhuma.

---

## Frontend

### 🔴 `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY`
- **Origem:** Mercado Pago (gateway que **não** está mais em uso — projeto
  migrou para Stripe).
- **Estado:** **VAZADA.** Arquivo `env.download`
  (`NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY=APP_USR-495b19e5-...`) foi
  rastreado pelo commit `56eec270` (2026-05-09).
- **Risco real:** chave é uma `public key` do MP — projetada para ser
  embarcada no browser, então o leak por si só não permite cobrança.
  Permite criar checkouts em nome da conta, o que pode ser usado para
  ataques de imagem ("checkout falso usando sua public key"). Baixo,
  mas não nulo.
- **Ação:**
  1. **Revogar a aplicação no painel Mercado Pago** (já não é usada;
     simples cancelar).
  2. Remover do `.env.local` (não é mais referenciada em código).
  3. Arquivo `env.download` foi removido do tracking nesta frente; pode
     ser deletado do disco local com segurança.

### 🟢 `BACKEND_API_URL` + `NEXT_PUBLIC_BACKEND_URL` + `NEXT_PUBLIC_REALTIME_URL`
- **Origem:** próprio backend Railway.
- **Estado:** URLs públicas. Não são segredo.
- **Ação:** nenhuma.

### 🟢 `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- Igual ao backend — Client ID público por design.

### 🟢 `NEXT_PUBLIC_ADSENSE_SLOT_CONTENT`
- ID público de slot AdSense. Não é segredo.

---

## Checklist pós-rotação

Quando rotacionar uma credencial:
- [ ] Atualizar `.env` local
- [ ] Atualizar variável no Railway (backend) / Vercel (frontend)
- [ ] Redeploy para forçar pickup
- [ ] Confirmar que o serviço afetado ainda funciona (login, upload,
      pagamento, email)
- [ ] Revogar a credencial antiga **apenas depois** do step anterior
- [ ] Anotar a data de rotação aqui, com a inicial de quem rotacionou:

| Credencial | Última rotação | Por |
|------------|----------------|-----|
| `DATABASE_URL` | _pendente_ | — |
| `JWT_SECRET` | _pendente_ | — |
| `STRIPE_SECRET_KEY` | — | — |
| `STRIPE_WEBHOOK_SECRET` | — | — |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | — | — |
| `RESEND_API_KEY` | — | — |
| `MELHOR_ENVIO_SANDBOX_TOKEN` | — | expira 2027-05-12 |
| `NEXT_PUBLIC_MERCADOPAGO_PUBLIC_KEY` | _pendente revogar_ | — |
