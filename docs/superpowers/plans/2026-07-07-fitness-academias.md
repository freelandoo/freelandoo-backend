# Fitness & Academias — Plano de Implementação (4 fases)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans para
> implementar tarefa a tarefa. Passos usam checkbox (`- [ ]`).

**Goal:** Conectar a Freelandoo a softwares de academia (Coliseu primeiro) via contrato
pull "Gym Provider API" e entregar painel fitness gated + treinos professor→aluno +
página social da academia com ranking de frequência pela catraca.

**Architecture:** Freelandoo-cêntrica — a academia cadastra URL+token da API dela;
sweeper puxa catraca+pagamentos (idempotente por external_id); todo o resto vive no
banco da Freelandoo. Feature nova separada (não toca tb_clan/comunidade). Flag
`fitness_academias` nasce OFF. Spec: `docs/superpowers/specs/2026-07-07-fitness-academias-design.md`.

**Tech Stack:** Freelandoo back Express 5 + pg puro (camadas routes→controllers→services
→storages, migrations idempotentes no boot); front Next.js 16 App Router + Tailwind 4,
tabloide `.fl-sharp`, i18n pt/en/es por script merge; Coliseu Next.js 16 + Prisma/Postgres
(vitest).

**Decisões de execução (travadas na exploração do código):**
- Sweepers iniciam no `index.js` raiz do backend (padrão `WebhookDispatchService.startSweeper()`).
- Rotas montadas em `src/routes/index.js`; guards `authMiddleware`, `requireFeature`,
  `roleMiddleware("Administrator")`; erros de service `{ error }` → `sendServiceResult`.
- Migrations: próxima = **176**; UUID `gen_random_uuid()`; seed de flag `ON CONFLICT DO NOTHING`.
- Token da academia: novo util `src/utils/secretBox.js` (AES-256-GCM, chave derivada de
  `SECRET_BOX_KEY` || `JWT_SECRET` via sha256) — precisa ser recuperável p/ chamadas outbound.
- Anti-SSRF da `api_base_url`: reusa `validateWebhookUrl` de `src/utils/webhookUrl.js`.
- Coliseu: rotas API em `src/app/api/freelandoo/*/route.ts`, auth Bearer constant-time em
  `src/lib/freelandoo/auth.ts` (env `FREELANDOO_API_TOKEN`), Prisma client `src/lib/db.ts`.
  `Cobranca` NÃO tem timestamps → migration prisma adiciona `updatedAt` (cursor de payments).
  `AccessEvent` cursor = `serverTime`+id, só `physicallyPassed=true`. CPF normalizado (dígitos)
  via `$queryRaw` com `regexp_replace`.
- Mapeamento MembershipStatus Coliseu→contrato: ACTIVE→active, SUSPENDED→overdue,
  CANCELED→canceled, EXPIRED→expired, DRAFT|PENDING_PAYMENT→pending.
- Freelandoo NÃO valida CPF de user globalmente — o CPF digitado vale por vínculo
  (UNIQUE academy+cpf e academy+user).
- Testes: Coliseu = vitest (padrão do repo). Freelandoo back não tem framework de unit
  (cultura = scripts e2e) → validação por script smoke + lint; front = lint + build.

---

## Fase 1 — Fundação

### F1.S1 — Coliseu: módulo Gym Provider (`/api/freelandoo/*`)

**Files (repo oliseu, commit só estes caminhos — há WIP alheio):**
- Create: `prisma/migrations/<ts>_cobranca_updated_at/migration.sql` (via `prisma migrate dev`)
  — `Cobranca.updatedAt DateTime @updatedAt @default(now())` no schema.
- Create: `src/lib/freelandoo/auth.ts` — `exigirFreelandoo(req)`: Bearer vs env
  `FREELANDOO_API_TOKEN` (timingSafeEqual; 503 se env ausente em prod, 401 se difere).
- Create: `src/lib/freelandoo/provider.ts` — queries: `memberByCpf(cpf)` (Person por CPF
  normalizado + Membership mais recente + mapeamento de status), `accessEventsSince(cursor, limit)`
  (AccessEvent physicallyPassed, ordena serverTime+id, cursor opaco base64 `time|id`),
  `paymentsSince(cursor, limit)` (Cobranca por updatedAt+id, status pendente→pending,
  pago→paid, atrasado→overdue, amount_cents = round(valor*100)).
- Create: `src/app/api/freelandoo/member/route.ts`, `.../access-events/route.ts`,
  `.../payments/route.ts` (GET, auth, validação de query).
- Test: `src/lib/freelandoo/provider.test.ts` (vitest, prisma mockado como nos testes de
  billing) — mapeamentos de status, normalização de CPF, cursor roundtrip.

- [ ] Schema + migration `updatedAt` em Cobranca
- [ ] `auth.ts` + `provider.ts` + testes passando (`npm test`)
- [ ] 3 rotas + teste manual `curl` local
- [ ] Commit (paths explícitos): `feat(freelandoo): Gym Provider API — member/access-events/payments`

### F1.S2 — Freelandoo backend: fundação

**Files:**
- Create: `src/databases/migrations/176_fitness_academias.sql` — `tb_academy` (id_academy
  UUID PK, id_owner_user FK tb_user, nome, slug UNIQUE, descricao, cidade, api_base_url,
  api_token_enc TEXT, sync_status TEXT default 'never' ('never'|'ok'|'error'|'auth_error'),
  sync_error, events_cursor, payments_cursor, last_sync_at, avatar_url, cover_url,
  is_active bool default TRUE, created_at); `tb_academy_member` (id_member UUID PK,
  id_academy FK CASCADE, id_user FK CASCADE, cpf VARCHAR(11), member_name (do provider),
  membership_status TEXT ('active'|'overdue'|'canceled'|'expired'|'pending'), plan_name,
  enrolled_at, expires_at, linked_at default NOW(), last_refreshed_at; UNIQUE(id_academy,id_user),
  UNIQUE(id_academy,cpf)); `tb_academy_professor` (id_academy, id_user, granted_by,
  created_at, PK(id_academy,id_user)); `tb_academy_access_event` (id_event UUID PK,
  id_academy, id_member FK CASCADE, external_id TEXT, occurred_at TIMESTAMPTZ,
  UNIQUE(id_academy,external_id), INDEX(id_member,occurred_at)); `tb_academy_payment`
  (id_payment UUID PK, id_academy, id_member FK CASCADE, external_id, amount_cents INT,
  due_date, status TEXT, paid_at, UNIQUE(id_academy,external_id)); seed flag
  `fitness_academias` FALSE.
- Create: `src/utils/secretBox.js` — `seal(plain)` / `open(sealed)` AES-256-GCM
  (`v1:<iv>:<tag>:<ct>` base64), chave sha256(SECRET_BOX_KEY||JWT_SECRET).
- Create: `src/integrations/gymProvider.js` — client HTTP do contrato: `getMember(base,token,cpf)`,
  `getAccessEvents(base,token,cursor,limit)`, `getPayments(...)`; timeout 10s (AbortController),
  normaliza erros ({error, status}), monta URLs com `new URL` sob o base.
- Create: `src/storages/AcademyStorage.js` — CRUD academy, membros, professores, upsert
  espelhos (ON CONFLICT (id_academy,external_id) DO UPDATE p/ payment; DO NOTHING p/ event),
  cursores, listagem p/ sync.
- Create: `src/services/AcademyService.js` — criar/editar academia (valida URL via
  validateWebhookUrl, cifra token, testConnection chama getMember com cpf '00000000000'
  esperando 200 found:false), busca pública, professores (grant/revoke só dono, alvo tem
  que ser membro), guards de dono/professor.
- Create: `src/services/AcademyLinkService.js` — `link(user, id_academy, cpf)`: normaliza
  CPF (11 dígitos), consulta provider, cria/atualiza tb_academy_member; `refresh(member)`;
  `myMemberships(user)`.
- Create: `src/services/AcademySyncService.js` — `syncAcademy(academy)`: pagina
  access-events + payments pelos cursores, associa por CPF→member (ignora CPF não
  vinculado), atualiza cursor/sync_status; `startSweeper()` (10min, unref, 1 academia por
  vez, backoff simples: academia com erro só re-tenta no tick seguinte); refresh de
  membership status dos membros (1x/dia por academia via last_refreshed_at).
- Create: `src/controllers/AcademyController.js` + `src/routes/academy.routes.js`:
  `POST /academies` (auth), `GET /academies?q=&city=` (público), `GET /academies/:slug`
  (optionalAuth; inclui my_membership/is_owner/is_professor), `PATCH /academies/:id` (dono),
  `POST /academies/:id/test-connection` (dono), `POST /academies/:id/link` (auth, rateLimit),
  `DELETE /academies/:id/link` (desvincular), `GET /me/academies` (auth),
  `POST/DELETE /academies/:id/professors` (dono), `GET /academies/:id/members` (dono|professor).
  Tudo sob `requireFeature("fitness_academias")`.
- Modify: `src/routes/index.js` (mount `/academies` + `/me/academies` via router único) e
  `index.js` raiz (startSweeper).
- Create: `docs/API_GYM_PROVIDER.md` — contrato público completo.

- [ ] Migration 176 + utils + integration client
- [ ] Storage/Service/Controller/Routes + sweeper wired
- [ ] `npm run lint` verde; smoke local das rotas com flag OFF (403) e ON
- [ ] Commit+push: `feat(fitness): fase 1 — fundação academias (mig 176, gym provider client, vínculo CPF, sweeper)`

### F1.S3 — Freelandoo front: /academias

**Files (repo front, ns i18n `Academies`):**
- Create: `app/(header-only)/academias/page.tsx` — busca/lista (nome/cidade) + CTA criar
  (modal: nome, cidade, descrição, api_base_url, token, botão testar conexão).
- Create: `app/(header-only)/academias/[slug]/page.tsx` — v1: header da academia, status
  do meu vínculo, botão "Vincular matrícula (CPF)" (modal), painel do dono (dados, sync
  status/última sync, testar conexão, professores: promover por membro, remover), lista de
  membros (dono/professor). Tabloide `.fl-sharp`, gated `useFeature("fitness_academias")`.
- Create: proxies `app/api/academies/[...path]/route.ts` + `app/api/me/academies/route.ts`.
- Create: `scripts/i18n-fitness-merge.js` (padrão fill-if-absent) + rodar.
- [ ] Página + modais + proxies + i18n 3 idiomas
- [ ] `npm run lint` + `npm run build`
- [ ] Commit+push (paths explícitos): `feat(fitness): fase 1 — /academias (cadastro, vínculo CPF, painel do dono)`

## Fase 2 — Painel fitness

### F2.S1 — Backend fitness

- Create: `src/databases/migrations/177_fitness_diario.sql` — `tb_food` (id_food UUID,
  source 'taco'|'off'|'custom', external_ref, nome, kcal_100g NUMERIC, protein_g, carbs_g,
  fat_g NUMERIC, created_by NULL, UNIQUE(source,external_ref) parcial WHERE external_ref
  NOT NULL, índice trigram/ILIKE em nome); `tb_fitness_food_log` (id_user, log_date DATE,
  meal CHECK cafe|almoco|jantar|lanche, id_food FK, quantity_g, kcal, protein_g, carbs_g,
  fat_g snapshots, created_at, INDEX(id_user,log_date)); `tb_fitness_water_log` (id_user,
  log_date, total_ml, PK(id_user,log_date)); `tb_fitness_measurement` (id UUID, id_user,
  weight_kg NUMERIC NULL, height_cm NUMERIC NULL, measured_at default NOW(), recorded_by);
  `tb_fitness_settings` (id_user PK, daily_kcal_goal INT default 2000, water_goal_ml INT
  default 2000).
- Create: `scripts/seed-taco.js` + `src/databases/data/taco-foods.json` (subset curado
  ~150 alimentos BR com kcal/macros por 100g; fill-if-absent por (source,external_ref)).
- Create: `src/middlewares/requireFitnessAccess.js` — user tem tb_academy_member
  membership_status='active' OU assinatura de subperfil ativa (mesma query do gate de
  perfil pago existente); anexa `req.fitnessAccess = { via, academies: [...] }`.
- Create: `FitnessStorage/FitnessService/FitnessController` + `src/routes/fitness.routes.js`:
  `GET /fitness/summary?date=` (kcal+macros do dia, água, meta, última medição, streak/
  frequência do mês por academia vinculada, matrícula+últimos pagamentos), `GET /fitness/foods?q=`
  (local ILIKE, limit 20), `GET /fitness/foods/off?q=` (proxy Open Food Facts
  `https://world.openfoodfacts.org/cgi/search.pl` timeout 5s, mapeia nutriments),
  `POST /fitness/foods/off/cache` (upsert tb_food source='off'), `POST /fitness/food-logs`,
  `DELETE /fitness/food-logs/:id`, `PUT /fitness/water?date=` ({total_ml} upsert),
  `POST /fitness/measurements` (self), `GET /fitness/measurements`, `PUT /fitness/settings`.
  Professores registram medição de aluno via rota da academia (fase 3 grid usa):
  `POST /academies/:id/members/:memberId/measurements` (guard professor|dono).
- [ ] Migration+seed+gate+rotas; lint; commit+push
  `feat(fitness): fase 2 — diário de calorias/água/medidas (mig 177, seed TACO, gate)`

### F2.S2 — Front /fitness

- Create: `app/(header-only)/fitness/page.tsx` + componentes em `app/(header-only)/fitness/_components/`
  (SummaryCards kcal/água/treino-placeholder, FoodDiary por refeição + FoodSearchModal
  TACO/OFF com porção em g, WaterCard +copo 250ml/custom, MeasurementsCard histórico,
  FrequencyCalendar mês da catraca + streak, MembershipCard status/plano/mensalidades,
  tela de venda quando 403 do gate: "vincule sua academia ou assine um subperfil").
- Proxies `app/api/fitness/[...path]/route.ts`. i18n ns `Fitness` no merge script.
- [ ] lint+build; commit+push `feat(fitness): fase 2 — painel /fitness (calorias, água, medidas, frequência)`

## Fase 3 — Treinos

### F3.S1 — Backend treinos

- Create: `src/databases/migrations/178_fitness_treinos.sql` — `tb_exercise` (id UUID,
  nome, muscle_group CHECK em peito|costas|ombros|biceps|triceps|pernas|gluteos|abdomen|
  cardio|corpo_inteiro, is_active, UNIQUE(nome)); seed ~100 exercícios no própria migration
  (INSERT ... WHERE NOT EXISTS); `tb_workout_plan` (id UUID, id_academy, id_member FK
  CASCADE, created_by, nome, notes, is_active, created_at; INDEX(id_member,is_active));
  `tb_workout_plan_exercise` (id UUID, id_plan FK CASCADE, id_exercise FK, sets INT, reps
  TEXT, load_kg NUMERIC NULL, rest_seconds INT NULL, position INT); `tb_workout_session`
  (id UUID, id_member, id_plan, session_date DATE, completed_at NULL,
  UNIQUE(id_plan,session_date)); `tb_workout_check` (id_session FK CASCADE,
  id_plan_exercise FK CASCADE, checked_at, PK(id_session,id_plan_exercise)).
- Create: `WorkoutStorage/WorkoutService/WorkoutController` + `workout.routes.js`:
  aluno — `GET /workouts/today`, `GET /workouts/plans` (minhas fichas),
  `POST /workouts/sessions` ({id_plan,date}), `POST/DELETE /workouts/sessions/:id/checks/:planExerciseId`
  (todos checados → completed_at; destick reabre); professor —
  `GET /academies/:id/exercises?muscle=`, `POST/PATCH/DELETE fichas de um membro da MESMA
  academia`, `GET /academies/:id/training-grid?date=` (linha por membro ativo: peso/altura
  mais recentes, kcal+água do dia, ficha ativa + dias com ela (NOW - created_at da ficha
  ativa mais antiga ainda ativa), sessões concluídas na semana, frequência 30d). Privacidade
  enforçada no service (aluno só o dele; professor/dono só da academia dele).
- [ ] Migration+seed+rotas; lint; commit+push `feat(fitness): fase 3 — treinos (mig 178, fichas, checks, grade do professor)`

### F3.S2 — Front treinos

- Modify: `/fitness` — card "Treino de hoje" real (ficha ativa, checks por exercício,
  progresso, concluir sessão).
- Modify: `/academias/[slug]` — aba **Treinos** (professor|dono): seletor de data, grade
  (tabela `overflow-x-auto`): aluno × peso, altura, kcal, água, ficha + dias com ela,
  frequência 30d, sessões semana; clicar → painel do aluno (fichas A/B/C, editor com
  busca da biblioteca por grupo muscular, sets/reps/carga/descanso, medição registrada
  pelo professor).
- i18n ns `Workouts`. lint+build. Commit+push
  `feat(fitness): fase 3 — treino do dia + grade de treinos por data`

## Fase 4 — Academia social

### F4.S1 — Backend social

- Create: `src/databases/migrations/179_academy_social.sql` — `tb_academy_post` (id UUID,
  id_academy, id_user, body TEXT, media_url, media_kind NULL image|video, share_count INT
  default 0, created_at, deleted_at NULL, INDEX(id_academy,created_at));
  `tb_academy_goal` (id_academy PK, freq_target_month INT default 12, posts_target_month
  INT default 4, shares_target_month INT default 4, updated_at) — metas configuráveis pelo dono.
- Create: `AcademySocialStorage/Service/Controller` (+ rotas no academy.routes):
  `GET/POST /academies/:id/posts` (membro posta; upload via uploadPortfolioMedia p/ R2
  prefixo `academy-media/`), `DELETE /academies/:id/posts/:postId` (autor|dono),
  `POST /academies/:id/posts/:postId/share` (share_count++),
  `GET /academies/:id/ranking?month=` — por membro: dias distintos de catraca no mês,
  posts no mês, shares recebidos no mês + % das metas; abas ordenáveis.
  `PUT /academies/:id/goals` (dono). Avatar/capa: `POST /academies/:id/media`
  (uploadAvatar, dono).
- [ ] Migration+rotas; lint; commit+push `feat(fitness): fase 4 — social da academia (mig 179, posts, metas, ranking)`

### F4.S2 — Front social

- Modify: `/academias/[slug]` — página completa: capa+avatar (upload do dono), feed de
  posts (texto/imagem/vídeo, composer p/ membros, share), aba Ranking (frequência/posts/
  compartilhamento com metas e progresso), aba Treinos (fase 3), gestão do dono (metas).
- i18n (ns Academies). lint+build. Commit+push
  `feat(fitness): fase 4 — página social da academia (feed, ranking, metas)`

## Validação final

- [ ] Lint+build front; lint back; migrations aplicam em boot local se possível.
- [ ] Atualizar CLAUDE.md (seção gatilho) + memória `project_freelandoo_fitness_academias`.
- [ ] Pendências do Alex documentadas: env `FREELANDOO_API_TOKEN` no deploy do Coliseu,
  `SECRET_BOX_KEY` no Railway (ou cai no JWT_SECRET), ligar flag `fitness_academias`,
  e2e com Coliseu+access-agent fake, dataset TACO completo (subset curado na v1).
