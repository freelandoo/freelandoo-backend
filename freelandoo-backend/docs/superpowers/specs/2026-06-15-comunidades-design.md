# Comunidades (substituem Clans) — Design

> Data: 2026-06-15 · Status: aprovado pelo Alex ("pode começar") · Repos: `freelandoo-backend` + `freelandoo frontend/freelandoo-website-main`

## 1. Conceito

A **Comunidade** substitui o conceito de **Clan**. É uma **página própria**, no estilo da página de participante da **Casa Views**:

- **Tema claro**; o dono (líder) **customiza as cores** da página.
- **Pública e indexada** — qualquer pessoa (logada ou não) navega e **consome** o conteúdo.
- **3 abas**: **Feed** (posts 4:5), **Bees** (9:16), **Membros** (cards de perfil).
- Conteúdo postado "pela comunidade" aparece no **feed global atribuído à comunidade**; dentro da página, Feed/Bees mostram **só** o conteúdo da própria comunidade.
- A área/aba **"Clans"** do app vira **"Comunidade"** e lista as páginas de comunidades.

A comunidade **NÃO** tem comportamento de clan:
- Sem vitrine/busca, **sem limite de membros**, **sem split de venda**, **sem produto/afiliado**.

## 2. Modelo de dados

**Reaproveitar `tb_profile` com um novo tipo `is_community`** (terceiro tipo, ao lado de subperfil normal e do clan legado, agora desativado). Posts/bees/feed/chat já são indexados por `id_profile` — reusar entrega feed+bees+página sem reescrever a máquina de conteúdo. A comunidade é **filtrada da vitrine/busca** (como o clan já é).

- Alternativa descartada: `tb_community` 100% nova → duplicaria toda a infra de feed/bees/portfólio.
- **Membros são USERS** (não subperfis): `tb_community_member (id_community_profile, id_user, role, joined_at)`, com `role ∈ {leader, vice, member}`.
- **"Nível/XP de um user"** (para requisitos e comparações de liderança) = o **subperfil de maior XP** daquele user (decisão cravada).
- Comunidade carrega `xp_total`/`xp_level` em `tb_profile` (reuso), mas calculados pela regra própria (§7), não pela média de membros do clan.

### Colunas/tabelas novas (a partir da migration 154)

- `tb_profile`: `is_community BOOLEAN NOT NULL DEFAULT FALSE`; `community_theme JSONB NULL` (cores customizáveis); `id_leader_user UUID NULL` (líder atual).
- `tb_community_member (id_community_profile, id_user, role, joined_at)` — PK `(id_community_profile, id_user)`; índice por `id_user` para contar participações.
- `tb_community_entitlement (id_user, create_cap, member_cap, updated_at)` — tetos atuais do user (default 1/1; cada bundle pago soma +1/+1).
- `tb_community_slot_purchase (...)` — compras de bundle R$100 (Stripe `price_data` ad-hoc, idempotente por `stripe_session_id`), espelhando `tb_clan_slot_purchase`.
- `tb_community_xp_accumulator (id_community_profile, accumulated_xp, last_cycle_applied)` — acumulador "+1 por membro por ciclo".
- `tb_community_ranking_snapshot (...)` — snapshot por ciclo (xp/nível/posição) para calcular crescimento e perda de posição.
- `tb_community_leadership_vote (id_vote, id_community_profile, id_leader_user, id_challenger_user, status, opens_at, closes_at, result)` e `tb_community_vote_ballot (id_vote, id_user, choice, voted_at)`.

## 3. Criação

- **Só user** cria. Requisito: ter **≥1 subperfil nível 5** no momento da criação.
- Teto de criação: **1 grátis + 2 pagas** (cada paga vem do bundle de R$100, §4).
- Quem cria é o **líder** e **já entra como membro** (consome 1 slot de criação **e** 1 de membro).

## 4. Cobrança — bundle R$100

Um pagamento de **R$100** sobe **os dois tetos juntos** (+1 criar **e** +1 entrar):

| Estado | Pode criar | Pode ser membro de |
|---|---|---|
| Grátis (default) | 1 | 1 |
| Após 1× R$100 | 2 | 2 |
| Após 2× R$100 | 3 | 3 (máx) |

- **Fundar** consome 1 slot de criação **e** 1 de membro. **Entrar** em comunidade de outro consome só 1 slot de membro.
- Stripe `price_data` ad-hoc (padrão Manifestação/Polens), webhook **idempotente** por `stripe_session_id`. Aplica `+1/+1` em `tb_community_entitlement` na confirmação.

## 5. Entrada de membros

- **Aberta e gratuita**, sem convite/aprovação. Requisito mínimo: ter **≥1 subperfil**.
- O 2º/3º ingresso exige ter comprado o bundle (member_cap suficiente).
- Página **pública/indexada para leitura** mesmo a não-membros; virar membro (contar XP/votar) exige login + subperfil + slot disponível.

## 6. Página da comunidade (UI — tema claro, estilo Casa Views)

- Header: nome, avatar/banner, **cores customizáveis pelo dono**, contador de membros, nível e posição no ranking.
- Abas **Feed** / **Bees** / **Membros**.
- **Qualquer membro pode postar "pela comunidade"** (decisão cravada). **Líder/vice podem moderar** (remover post/bee da comunidade).
- Estados obrigatórios desenhados: empty / loading / error.
- **i18n pt-BR/en/es por padrão** (regra permanente do projeto) — texto novo nasce com `t("chave","fallback pt")` + dicts no mesmo commit. Conteúdo de usuário não traduz.

## 7. XP, nível e ranking da comunidade

- **XP da comunidade = XP do líder (espelhado em tempo real) + acumulador próprio**.
- O acumulador soma **+1 por membro a cada ciclo de ranking**.
- Se o líder muda, a **base espelhada** passa a ser o XP do novo líder; o **acumulador permanece**.
- Nível da comunidade pela mesma fórmula log do XP de perfil (`XpStorage.levelFromXp`).
- **Ranking público de comunidades** por ciclo/temporada (espelha o ranking de perfis).
- **Benchmark de crescimento por nível**: ao fechar o ciclo, calcula-se o crescimento médio (%) das comunidades **do mesmo nível**. Comunidade **muito abaixo** dessa média **ou** que **perdeu posição** fica elegível à votação (§8).

## 8. Votação de liderança

- **Gatilho** (ao fechar o ciclo): comunidade **muito abaixo do crescimento médio do seu nível** OU **perdeu posição**, **e** existe **≥1 membro com nível > líder**.
- **Disputa**: **líder atual × membro de maior nível** (desafiante único). Se o líder já é o de maior nível, **não abre**.
- **Modal no login**: ao logar, cada membro vê o card de perfil do líder e do desafiante + botão *"Sua comunidade está evoluindo pouco — quer manter [líder] ou trocar para [desafiante]?"*.
- **Resolução**: janela fixa de **7 dias**; **maioria simples** vence; **empate mantém** o líder.
- **Líder destituído vira vice-líder.**
- Troca de líder **re-baseia o XP espelhado** para o novo líder.

### Vice-líder

- Título honorário; **pode moderar** o conteúdo da comunidade (remover post/bee). Sem outros poderes.

## 9. Desativação dos clans

- **Sem migração.** Clans ficam `is_active=false`/ocultos.
- Payouts/splits **pendentes preservados** para liquidação manual (sem novos).
- Rotas/UI de clan saem do app (aba vira Comunidade). Migrations históricas e a coluna `is_clan` **permanecem** (inertes, não removidas) — não quebrar migrations re-executadas no boot.

## 10. Superfície backend (alto nível)

- **Migrations** (a partir da 154): `is_community` + theme + `id_leader_user` em `tb_profile`; `tb_community_member`; `tb_community_entitlement`; `tb_community_slot_purchase`; `tb_community_xp_accumulator`; `tb_community_ranking_snapshot`; `tb_community_leadership_vote` + `tb_community_vote_ballot`.
- **Services**: `CommunityService` (CRUD/página/membros/tema), `CommunityXpService` (substitui o caminho `recalcClanXp`), `CommunityLeadershipService` (gatilho + votação), `CommunityRankingService` (snapshot/benchmark). Reuso de `StripeService`/webhook idempotente para o bundle.
- **Jobs** (boot scheduler, padrão dos jobs órfãos do PayDebug): fim de ciclo → aplica acumulador, recomputa ranking/benchmark, abre votos elegíveis; job de **fechamento de votos** vencidos.
- **Camadas**: `routes/ → controllers/ → services/ → storages/` (SQL puro), `runWithLogs`, `sendServiceResult`, guard admin onde aplicável. Proxies no frontend em `app/api/` (sem prefixo `/api` no backend).

## 11. Decisões cravadas (eram pontos abertos)

1. **"XP/nível do user"** = subperfil de maior XP do user.
2. **Postar pela comunidade**: qualquer membro posta; líder/vice moderam.
3. **Vice-líder**: título + moderação de conteúdo, sem outros poderes.

## 12. Fora de escopo (YAGNI)

- Migração automática de clans → comunidades.
- Splits/payout/produto/afiliado dentro da comunidade.
- Listagem da comunidade na vitrine/busca.
- Convite/aprovação de entrada.
