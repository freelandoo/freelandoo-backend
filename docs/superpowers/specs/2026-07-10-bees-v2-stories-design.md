# Bees v2 — Stories viram Bees, vídeos viram Curtos (design)

**Data:** 2026-07-10
**Status:** aprovado pelo Alex (brainstorming 2026-07-10)
**Escopo:** reestruturação completa do sistema de conteúdo efêmero (stories) e da página /bees.

---

## 1. Renomes e destino de cada conceito

| Conceito hoje | Destino |
|---|---|
| Story `kind='trampo'` (StoryBar do /search, exclusivo de assinante) | **Morre.** StoryBar do /search removida, criação bloqueada, nada substitui o perk. Linhas existentes expiram sozinhas em 24h. |
| Story `kind='rest'` (StoryBar do /feed) | **Vira "bee".** Continua na `tb_story`, ganha engajamento completo, vida 24h→7d e timeline própria. |
| Vídeo bee (`tb_profile_portfolio_item.feed_kind='bees'`, página /bees) | **Vira "curto".** Rename só de aplicação (valor físico `'bees'` fica, estilo `tb_machine`). Perde a página dedicada; continua misturado no /feed e na grade do perfil (aba renomeada "Curtos"). |
| Página `/bees` (scroll vertical TikTok de vídeos) | **Vira a timeline vertical de bees (stories)**, global por padrão, com filtro. Botão flutuante de Lives permanece. |
| StoryBar do `/feed` | Continua, mostrando **bees só de quem eu acompanho** (borda metálica de não-visto, mecânica atual do rest). |

## 2. Decisões cravadas (Alex, 2026-07-10)

1. **Vida do bee:** nasce com 24h; **engajamento estende** até o teto de 7 dias.
2. **Interação:** bee tem a barra completa do /bees atual — curtida, comentário, denúncia, compartilhar, salvar — **e** o autor pode anexar **localização** e **links estilizados**.
3. **Curtos continuam existindo** como formato de postagem: composer + /feed + grade do perfil. Só perdem a página dedicada.
4. **Ordenação da timeline:** os bees entram **no mesmo algoritmo dos posts** (mistura 60/25/15 com `engagement_score` + boost de novidade + penalidade de subengajamento).
5. **Lives:** botão flutuante com contador continua no /bees.
6. **Arquitetura:** **manter a `tb_story`** como casa do bee ("copia a regra do algoritmo para a tb_story e mantém ela; só troca story para bees"). Não converge para `tb_profile_portfolio_item`.
7. **Bee ENTRA no ranking social/XP:** curtidas/comentários/shares de bee alimentam XP com os mesmos pesos (`xp_settings`) dos posts.
8. Filtro da timeline: menu de **3 pontinhos brancos** no topo → "Quem acompanho" / "Global" (global é o padrão).

## 3. Modelo de dados (migration nova — próxima livre, ≥181)

`tb_story` fica e ganha:

- CHECK do `kind` vira `('trampo','rest','bee')` — legados continuam válidos (migrations re-rodam no boot; NUNCA remover valores históricos). **Todo bee novo nasce `kind='bee'`.** Zero migração de dados: trampo/rest vivos expiram em 24h sozinhos.
- Colunas novas (espelho das do post):
  - `likes_count INT NOT NULL DEFAULT 0`
  - `comments_count INT NOT NULL DEFAULT 0`
  - `impressions_count INT NOT NULL DEFAULT 0`
  - `engagement_score NUMERIC NOT NULL DEFAULT 0`
  - `location TEXT` (≤80 chars, texto livre)
  - `links JSONB NOT NULL DEFAULT '[]'` (máx. 3 itens `{label ≤30, url, style}`)
- Índice para a timeline: `(kind, created_at DESC) WHERE deleted_at IS NULL` + índice por `engagement_score`.

Tabelas irmãs (espelho 1:1 das dos posts — FKs para `tb_story`):

- `tb_story_like (id_story, id_user, created_at, PK(id_story,id_user))`
- `tb_story_comment` (espelho da `tb_portfolio_comment`: content 1..1000, `is_active`, `likes_count`)
- `tb_story_comment_like` (espelho da `tb_portfolio_comment_like`)
- `tb_story_report` (espelho da `tb_post_report`: `reason_category`, `reason`, UNIQUE(id_story, reporter))
- `tb_story_view` **já existe** (por usuário) e ganha dupla função: visto/não-visto da StoryBar **e** fonte do `impressions_count` (o mark-viewed passa a incrementar o contador na primeira view do par story×user).

### Semântica do `expires_at`

- Bee novo grava `expires_at = created_at + 7 dias` (**teto duro** — usado pela limpeza de R2 e por qualquer varredura).
- A **visibilidade efetiva** é lazy, calculada no SQL de leitura:

```sql
NOW() < LEAST(
  created_at + INTERVAL '7 days',
  created_at + INTERVAL '24 hours' + (engagement_score * INTERVAL '1 hour')
)
```

- O fator **1h por ponto de engajamento** vive numa constante única no backend (fácil calibrar). Sem job/sweeper novo: o bee "morre" quando as queries param de retorná-lo.

## 4. Algoritmo da timeline (regra copiada SEM duplicar código)

Extrair as funções puras do `PortfolioFeedService` para um módulo compartilhado `src/utils/feedMix.js`:

- `computeRankInfo` (score composto: `engagement_score` + boost de novidade <72h até +30 − penalidade ×0.5 p/ >2000 impressões com ratio <1%),
- `buildPools` (top 60% / novos / exploração),
- `interleave` (mistura 60/25/15),
- PRNG com seed + cursor `"<seed>:<index>"`.

O feed de posts passa a importar do módulo (comportamento idêntico, zero mudança funcional) e o novo `BeeFeedService` aplica exatamente a mesma regra sobre candidatos da `tb_story` (kind='bee', dentro da janela de vida do §3).

**Scope:** `?scope=global` (padrão — todos os bees vivos) ou `?scope=following` (só perfis que o viewer segue via `tb_user_follow`).

## 5. Endpoints (backend)

Novos (montados em `/bees`, auth obrigatória como o /stories atual):

- `GET  /bees/timeline?scope=global|following&cursor=&limit=` — timeline ranqueada (mix 60/25/15). Resposta espelha o shape do feed (itens + `next_cursor` + `has_more`), com `viewer_has_liked`, contadores, `location`, `links`, áudio e perfil.
- `POST /bees/:id_story/like` · `DELETE /bees/:id_story/like`
- `GET  /bees/:id_story/comments?cursor=` · `POST /bees/:id_story/comments`
- `DELETE /bees/comments/:id_comment` (autor ou dono do bee) · `POST /bees/comments/:id_comment/like` (toggle)
- `POST /bees/:id_story/report` (categorias iguais às do post)
- `POST /bees/events` — espelho do `POST /feed/events` (share, impression etc.) com `StoryEventStorage` próprio atualizando `engagement_score`/contadores da `tb_story` com **os mesmos pesos** dos posts e o mesmo dedupe por `session_id`.

Reusados/ajustados dos stories atuais:

- `POST /stories/:id_story/view` — segue marcando visto e passa a incrementar `impressions_count` (primeira view do par).
- `POST /stories/:id_story/react` — reação emoji→DM continua existindo (não conflita com a curtida pública).
- `GET /stories/feed` — perde o parâmetro `kind` (StoryBar do /feed lista bees de quem eu sigo); `GET /stories/by-profile/:id` e `DELETE /me/stories/:id` seguem.
- Criação (`POST /me/stories`, presigned da câmera): `kind` deixa de ser input — **sempre `'bee'`**; validação de assinatura do trampo removida; regra de permissão = a do rest (qualquer subperfil ativo do dono; supervisão `can_post_feed` mantida).
- Campos novos na criação: `location` (trim ≤80, passa na moderação junto do caption) e `links` (array ≤3 de `{label, url, style}`; `label` trim ≤30 e moderado; `url` só `http(s)` absoluta ≤500 chars; `style` enum de presets visuais definidos no front). Link inválido → erro 400 (não silencioso).

### Moderação, XP, notificações

- Comentário de bee passa pelo `ChatModerationService` (mesma régua do comentário de post).
- **XP/ranking:** like/comentário/share de bee premiam o subperfil autor via `XpStorage.award` com os **mesmos `event_type`s** que os posts usam (pesos vêm do `xp_settings` — fonte única; nada de peso novo hardcoded) e `source_type` próprio (`story_like`/`story_comment`/`story_event`) com `source_id` determinístico para idempotência.
- **Notificações:** like e comentário de bee inserem em `tb_notification` com os tipos like/comment existentes, payload apontando para o bee (deep-link abre a timeline no item).
- Denúncia: gravada em `tb_story_report`; painel admin de denúncias ganha uma **listagem simples** de bees denunciados com ação de remover (soft delete). Sem workflow novo.

## 6. Superfícies (frontend)

### `/bees` — timeline de bees
- Scroll vertical fullscreen (mesma anatomia do `BeesPost` atual: snap por item, mute global, barra lateral curtir/comentar/compartilhar/salvar/denunciar, contador de curtidas, caption, autor com enxame).
- Fonte de dados: `GET /bees/timeline` (substitui `/api/feed/bees` na página).
- **Menu de 3 pontinhos brancos no topo** → alterna "Global" (padrão) / "Quem acompanho". Preferência persiste em `localStorage`.
- Overlay novo: **chip de localização** (ícone de pin + texto) e **links estilizados** (até 3 chips clicáveis conforme `style`; abrem em nova aba com `rel="noopener noreferrer"`).
- Reação emoji→DM disponível no item (mantém o canal privado).
- **Lives:** botão flutuante com contador permanece como está (socket `lives:changed` + poll fallback).
- Visual: manter a identidade atual do /bees (dark, `#0b0804`), cantos retos (`.fl-sharp` onde couber).

### `/feed`
- StoryBar no topo sem `kind`, listando bees de **quem eu acompanho** (agrupado por perfil, borda metálica na cor do enxame quando há não-visto — mecânica atual).
- `StoryPlayer` (fullscreen tap-through) ganha a **mesma barra de ações** (curtir + comentar + compartilhar), para o bee ter os mesmos poderes nas duas superfícies.
- A mistura do /feed (posts 4:5 + vídeos 9:16) continua igual — os vídeos agora se chamam "Curtos" só no texto.

### `/search`
- StoryBar do trampo **removida** (junto do fluxo de criação com `initialKind="trampo"`). Nada entra no lugar.

### Perfil / grade
- Aba "Bees" do `UserPortfolio` vira **"Curtos"** (rename i18n; `feed_kind='bees'` físico intocado).

### Criação (composer + câmera)
- `MediaComposer` modo story: seletor trampo/rest **some**; publica sempre bee.
- Campos novos no passo de publicação: localização (input texto) e editor de links estilizados (label + URL + preset visual; máx. 3).
- Módulo de câmera (`lib/camera`): `StoryKind` colapsa para `'bee'`; presigned flow inalterado no resto (MP4/H.264, poster WebP, música, filter_meta, split 60s).
- Criação de **curto** (vídeo permanente) continua no fluxo atual do composer, só renomeada.

### i18n (regra permanente)
- Todos os textos novos nascem com `t("chave", "fallback pt")` nos 3 idiomas via script merge idempotente.
- Renames visíveis: "Bees"→ novo significado (stories) e "Curtos" para os vídeos — varrer ns `Bees`, `Feed`, `Post`, `Stories`, `Composer`, `Account` (aba do perfil), notificações e denúncias. Regra do escoteiro nos arquivos tocados.

## 7. Fora de escopo (v1)

- Nenhum perk substitui o trampo para assinantes.
- Sem migração de dados da `tb_story` (legado expira sozinho) e sem mexer nos vídeos curtos existentes além de texto.
- Bookmark de bee expira junto do bee (some da aba Salvos quando o bee morre — filtro na leitura, sem limpeza ativa).
- Sem pro-rata/algoritmo configurável por admin: fator de extensão (1h/ponto) é constante de código.
- `GET /feed/bees` (rota da página antiga) fica como legado para o mix do /feed; não é removida.

## 8. Fatiamento previsto

| # | Slice | Conteúdo |
|---|---|---|
| B1 | Backend engajamento | Migration (colunas + tabelas irmãs) + like/comment/report/events + XP/notificações + moderação |
| B2 | Backend timeline | `utils/feedMix.js` extraído (posts passam a importar) + `BeeFeedService` + `GET /bees/timeline` scope global/following + criação `kind='bee'` c/ location/links + view→impressions |
| F1 | /bees novo | Timeline vertical consumindo `/bees/timeline`, 3 pontinhos c/ filtro, overlay location/links, barra de ações, comentários, Lives preservado |
| F2 | /feed + /search | StoryBar sem kind, StoryPlayer com ações, remoção do trampo no /search |
| F3 | Composer/câmera | Kind único + campos location/links + renames de criação |
| F4 | Renames + i18n | "Curtos" em todas as superfícies, ns 3 idiomas, varredura escoteiro + admin de denúncias de bee |

Cada slice: commit + push no repo correspondente (migrations no mesmo commit do código que as usa; front NUNCA `git add -A`).
