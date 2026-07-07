# Fitness & Academias — Design (2026-07-07)

Integração Freelandoo ↔ software de academia (Coliseu como primeira implementação) + painel
fitness do usuário + página social da academia. Aprovado pelo Alex em 2026-07-07.

## Objetivo

O usuário Freelandoo vincula sua matrícula de academia pelo **CPF** e ganha um **painel
fitness**: contador de calorias, água, treinos passados pelo professor (com check por
exercício), frequência real medida pela **catraca**, status de matrícula/pagamentos e
ranking. A academia ganha uma **página social** (cópia adaptada de comunidade) com ranking
de frequência dos membros, cadastro de professores e uma **grade de treinos por data** que
professores usam para acompanhar todos os alunos (peso, altura, consumo calórico, água,
tempo com a mesma ficha, frequência).

## Decisões cravadas (Alex, 2026-07-07)

1. **Arquitetura Freelandoo-cêntrica.** A academia cadastra a URL base + token da API do
   sistema dela; a Freelandoo **puxa** (polling) eventos de catraca e pagamentos. Todo o
   resto (treinos, calorias, água, medidas, ranking, social) vive no banco da Freelandoo.
2. **Contrato padrão "Gym Provider API"** definido pela Freelandoo; o Coliseu implementa
   primeiro, qualquer software de academia pode implementar depois. Pull, não push.
3. **Academia é feature nova e separada** (não reusa tb_clan/comunidade), mas copia as
   funções sociais da comunidade: posts de texto/vídeo/imagem, ranking de membros, metas de
   posts e compartilhamento — **mais a meta de frequência** (catraca) para ranking de
   frequência.
4. **Vínculo por CPF com verificação automática**: consulta à API da academia na hora; se a
   matrícula existir, vincula e traz status/plano. CPF inexistente → erro orientando
   procurar a recepção.
5. **Gate de acesso ao painel fitness inteiro** (calorias, água, treinos, medidas): só quem
   tem matrícula ativa em academia vinculada **OU** subperfil pago (assinatura ativa
   `tb_profile_subscription`).
6. **Base de alimentos:** TACO (UNICAMP, ~600 alimentos BR) seedada no banco + Open Food
   Facts via API para industrializados (com cache local do item usado).
7. **Treino = fichas estruturadas (A/B/C) + biblioteca global de exercícios** seedada.
   Check por exercício; todos checados = sessão concluída.
8. **Peso/altura: aluno E professor editam** (histórico de medições, `recorded_by`).
9. **Privacidade:** dados corporais/consumo/grade visíveis só para o próprio aluno +
   professores da MESMA academia + dono. Público/membros comuns veem só o ranking.
10. **Professor** é um user Freelandoo vinculado à academia, promovido pelo **dono/adm da
    academia** no painel dela.
11. **Monetização v1: grátis** para a academia; flag **`fitness_academias` nasce OFF**
    (kill-switch). Cobrança da academia fica para v2. Monetização indireta: o gate empurra
    assinatura de subperfil para quem não tem academia.
12. **Estética tabloide** como o `/ranking` (`.fl-sharp`, sem cantos arredondados);
    **i18n pt/en/es de nascença** (regra permanente).

## 1. Contrato "Gym Provider API"

Documento público: `freelandoo-backend/docs/API_GYM_PROVIDER.md` (criar na Fase 1).
O software da academia expõe 3 endpoints; auth `Authorization: Bearer <token>` (token
gerado no software da academia e colado no cadastro Freelandoo).

| Endpoint | Retorno | Uso |
|---|---|---|
| `GET /freelandoo/member?cpf=` | `{ found, name, membership: { status: 'active'\|'overdue'\|'canceled'\|'expired', plan_name, enrolled_at, expires_at } }` | Vínculo por CPF + refresh de status |
| `GET /freelandoo/access-events?since=<cursor>&limit=` | `{ events: [{ id, cpf, at, passed }], next_cursor }` | Frequência (só `passed=true` conta) |
| `GET /freelandoo/payments?since=<cursor>&limit=` | `{ payments: [{ id, cpf, amount_cents, due_date, status, paid_at }], next_cursor }` | Extrato de mensalidades no painel do aluno |

Regras do contrato: cursores opacos (o provider decide o formato; a Freelandoo só ecoa);
ids estáveis (idempotência); paginação por `limit` (default 200); timeout de 10s do lado
Freelandoo; erros 401/403 marcam a conexão como inválida e alertam o dono.

### Módulo no Coliseu

Rotas novas `/api/freelandoo/*` no app Coliseu implementando o contrato:
- `member?cpf=` → `Person` por CPF + `Membership` mais recente (status mapeado de
  `MembershipStatus`).
- `access-events` → `AccessEvent` com `physicallyPassed=true`, cursor = `serverTime`+id.
- `payments` → `Payment`/`Cobranca` (status mapeado de `PaymentStatus`/`CobrancaStatus`).
- Token por unidade (config/env `FREELANDOO_API_TOKEN`), comparação constant-time.
- CPFs normalizados (só dígitos) nos dois lados.

## 2. Backend Freelandoo

### Migrations (176+, idempotentes, padrão existente)

**Academia**
- `tb_academy`: id, id_owner_user, nome, slug UNIQUE, descrição, cidade/`id_region`,
  avatar/capa (R2 prefixo `academy-media/`), `api_base_url`, `api_token` (cifrado com a
  mesma técnica dos tokens gerenciados), `sync_status`, `sync_error`, `events_cursor`,
  `payments_cursor`, `last_sync_at`, `is_active`, created_at.
- `tb_academy_member`: id_academy, id_user, cpf (só dígitos), membership_status, plan_name,
  enrolled_at, expires_at, linked_at, last_refreshed_at. UNIQUE(id_academy, id_user) e
  UNIQUE(id_academy, cpf) — 1 CPF por user por academia.
- `tb_academy_professor`: id_academy, id_user, granted_by, created_at.
  UNIQUE(id_academy, id_user). Pré-requisito: ser membro vinculado.

**Espelho (dados puxados)**
- `tb_academy_access_event`: id_academy, id_member, external_id, occurred_at.
  UNIQUE(id_academy, external_id). Índice (id_member, occurred_at).
- `tb_academy_payment`: id_academy, id_member, external_id, amount_cents, due_date, status,
  paid_at. UNIQUE(id_academy, external_id).

**Fitness**
- `tb_food`: id, source ('taco'|'off'|'custom'), external_ref (código TACO ou barcode OFF),
  nome, kcal_100g, protein_g, carbs_g, fat_g, created_by (custom). Seed TACO via script
  `scripts/seed-taco.js` (dataset em JSON no repo).
- `tb_fitness_food_log`: id_user, log_date, meal ('cafe'|'almoco'|'jantar'|'lanche'),
  id_food, quantity_g, kcal (snapshot), macros (snapshot). Índice (id_user, log_date).
- `tb_fitness_water_log`: id_user, log_date, total_ml (upsert por dia).
- `tb_fitness_measurement`: id_user, weight_kg, height_cm, measured_at, recorded_by
  (id do user que registrou — aluno ou professor).

**Treinos**
- `tb_exercise`: biblioteca global — nome, grupo muscular, is_active. Seed curado (~100
  exercícios comuns) via script; admin pode expandir depois.
- `tb_workout_plan`: id_academy, id_member (aluno), created_by (professor), nome ("Treino
  A"), notes, is_active, created_at. "Tempo com o mesmo treino" = idade da ficha ativa.
- `tb_workout_plan_exercise`: id_plan, id_exercise, sets, reps, load_kg, rest_seconds,
  position.
- `tb_workout_session`: id_member, id_plan, session_date, completed_at.
  UNIQUE(id_plan, id_member, session_date).
- `tb_workout_check`: id_session, id_plan_exercise, checked_at. UNIQUE(id_session,
  id_plan_exercise). Todos os exercícios checados → seta completed_at da sessão.

**Social da academia**: tabelas próprias `tb_academy_post` (texto/imagem/vídeo, mídia no
R2 `academy-media/`) e `tb_academy_goal` espelhando a mecânica de metas da comunidade
(posts, compartilhamento e **frequência**), sem tocar nas tabelas de comunidade — feature
separada por decisão. O plano da Fase 4 copia a UX da comunidade olhando o código real.

**Flag**: seed `fitness_academias` DESLIGADA na migration (kill-switch geral: esconde
rotas/da UI; academias e vínculos existentes ficam intactos ao desligar).

### Serviços e rotas

- `AcademyService/Storage/Controller` — CRUD do dono (self-service, grátis), página
  pública, membros, professores (`POST /academies/:id/professors` guard = dono).
- `AcademyLinkService` — `POST /academies/:id/link {cpf}`: valida CPF, chama
  `member?cpf` no provider, cria/atualiza `tb_academy_member`. Refresh de status junto do
  sweeper. Anti-abuso: rate-limit por user; CPF já vinculado a outro user na mesma academia
  → erro claro.
- `AcademySyncService` (sweeper no boot, padrão dos sweepers existentes): a cada ~10min por
  academia ativa, puxa access-events e payments incrementais (cursores em `tb_academy`),
  upsert idempotente por external_id, associa ao membro pelo CPF (evento de CPF não
  vinculado é ignorado sem erro). Falha → `sync_status='error'` + backoff exponencial;
  nunca derruba o boot.
- `FitnessService` — logs de comida/água/medidas + resumo diário. Busca de alimento:
  `GET /fitness/foods?q=` (tb_food local) e `GET /fitness/foods/off?q=|barcode=` (proxy
  Open Food Facts com timeout curto; item escolhido é cacheado em tb_food).
- `WorkoutService` — fichas (professor cria/edita para aluno da sua academia), sessões e
  checks (aluno), biblioteca de exercícios.
- `AcademyRankingService` — ranking mensal por academia: frequência = dias distintos com
  giro; + rankings de posts/compartilhamento (mecânica copiada da comunidade).
- **Grade do professor**: `GET /academies/:id/training-grid?date=` (guard professor|dono) —
  uma linha por membro: peso/altura mais recentes, kcal e água do dia, ficha ativa + dias
  com ela, sessões concluídas e frequência no período.
- **Gate** `requireFitnessAccess` (middleware): matrícula com `membership_status='active'`
  em alguma academia OU assinatura de subperfil ativa. Aplicado a todas as rotas
  `/fitness/*` e `/workouts/*`. `requireFeature('fitness_academias')` em tudo.
- **Privacidade** (enforçada no service, não só na UI): dados de um aluno só saem para o
  próprio aluno, professores da mesma academia e o dono.

## 3. Frontend Freelandoo

Tudo tabloide (`.fl-sharp`), i18n 3 idiomas no mesmo commit (ns novos: `Academies`,
`Fitness`, `Workouts`), gated por `useFeature("fitness_academias")`.

- **`/academias`** — descoberta: busca por nome/cidade + cadastro self-service do dono
  (nome, cidade, mídia, URL+token da API com botão "testar conexão").
- **`/academias/[slug]`** — página da academia: capa, feed de posts (texto/foto/vídeo),
  ranking de membros (abas: frequência / posts / compartilhamento), CTA "Vincular matrícula
  (CPF)". Modo gestão (dono): editar dados, status do sync, gerenciar professores.
  Aba **Treinos** (professores + dono): seletor de data + grade linhas=alunos ×
  colunas=peso, altura, kcal, água, ficha ativa + dias com ela, frequência; clicar no aluno
  abre o editor de ficha (biblioteca de exercícios com busca por grupo muscular).
- **`/fitness`** — painel do usuário (gated; sem acesso → tela de venda: "vincule sua
  academia ou assine um subperfil"): resumo do dia (kcal consumidas vs meta, anel de água
  com +copo 250ml/custom, treino do dia com checks), calendário/streak de frequência da
  catraca, card matrícula (academia, plano, status, últimas mensalidades), histórico de
  peso/altura (aluno registra), posição no ranking da academia.
- **Contador de calorias**: busca (TACO instantâneo + aba "produtos" via OFF), seleção de
  porção em gramas, diário por refeição, totais de kcal/macros do dia.
- Proxies `app/api/academies/*`, `app/api/fitness/*`, `app/api/workouts/*`.

## 4. Erros e resiliência

- Provider fora do ar: vínculo falha com mensagem amigável; sweeper acumula atraso sem
  quebrar nada (painel mostra "atualizado há X"); 401/403 → conexão inválida + aviso ao
  dono.
- Idempotência total no espelho (UNIQUE external_id) — re-poll seguro.
- Open Food Facts indisponível → busca local continua funcionando (degradação suave).
- Desligar a flag esconde tudo sem apagar dados.

## 5. Testes

- Unit/integração nos services: gate (matrícula × subperfil), ranking (dias distintos),
  snapshot de kcal, permissões de professor/privacidade, idempotência do sync.
- e2e do contrato: Coliseu local + `access-agent` (adapter fake) gerando giros → sweeper
  Freelandoo → frequência no painel.
- Lint + build nos dois repos; smoke pós-deploy existente.

## 6. Fases (cada uma vira plano de implementação próprio)

1. **Fundação** — `docs/API_GYM_PROVIDER.md` + módulo no Coliseu + migrations academia/
   espelho + cadastro de academia + vínculo CPF + sweeper + flag.
2. **Painel fitness** — gate, seed TACO + proxy OFF, calorias, água, medidas, card
   matrícula/pagamentos, frequência.
3. **Treinos** — seed biblioteca de exercícios, fichas, sessões/checks, professores, grade
   por data.
4. **Academia social** — posts, metas (posts/compartilhamento/frequência), rankings,
   páginas públicas.

## Fora de escopo (v1)

- Cobrança da academia pela Freelandoo (v2).
- Push/webhook do provider (contrato é pull-only).
- Scanner de código de barras por câmera (busca por texto/código digitado na v1).
- Prescrição de dieta pelo professor (professor vê consumo, não prescreve).
- Múltiplas unidades da mesma academia como entidades separadas (cada cadastro = 1 URL de
  API; rede com N unidades cadastra N academias).
