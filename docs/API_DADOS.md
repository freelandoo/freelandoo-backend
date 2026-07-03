# API de Dados — Freelandoo

Leia os dados da sua conta a partir de um software de terceiro (ERP, BI, painel,
planilha). É uma API **somente-leitura**: nunca escreve nada e **não expõe dados
financeiros** (saldo, ganhos, repasses, faturamento). Preços listados de
serviço/produto/curso entram por serem dados operacionais, não financeiros.

## Autenticação

1. No site, em **Conexões de Dados**, gere um token (`flnd_data_...`).
   Ele aparece UMA única vez — copie e guarde.
2. Envie em todo request: `Authorization: Bearer flnd_data_...`
3. Base URL: a mesma do backend Freelandoo. Prefixo: `/ext/v1/data`.

Limite: 60 requests/minuto por conexão (HTTP 429 com `Retry-After` ao exceder).
Token revogado no site → 401 imediato. Máx. 3 conexões de dados ativas por conta.

> O token de **Dados** (`flnd_data_`) e o token de **Atendimento** (`flnd_atd_`)
> são independentes: um não acessa as rotas do outro (HTTP 403). Um token de
> dados **não** lê nem responde mensagens.

## Escopo

A conexão enxerga **somente os dados do dono do token** — todos os seus perfis
(conta principal, subperfis, clans e comunidades) e o que pende deles: serviços,
produtos, cursos, redes sociais, seguidores, nível e XP.

## Endpoints

Todos são `GET`. Respostas em JSON.

### `GET /ext/v1/data/me`
Resumo da conta + validação do token.
```json
{
  "id_user": "…", "username": "fulano", "account_profile_id": "…",
  "level": 5, "xp_total": 42000,
  "counts": {
    "profiles_total": 4, "subprofiles": 2, "communities": 1, "clans": 0,
    "services": 7, "products": 3, "courses": 2
  }
}
```

### `GET /ext/v1/data/profiles`
Todos os perfis do usuário, com seguidores e XP por perfil.
→ `{ profiles: [{ id_profile, username, display_name, bio, avatar_url, sub_profile_slug, estado, municipio, profession, profession_slug, enxame_slug, enxame_name, is_user_account, is_clan, is_community, is_active, is_visible, is_paid, created_at, followers, level, xp_total }] }`

### `GET /ext/v1/data/services`
Serviços de todos os perfis.
→ `{ services: [{ id_profile_service, id_profile, name, description, duration_minutes, price_amount, is_active, affiliates_allowed, created_at, updated_at }] }`

### `GET /ext/v1/data/products`
Produtos da loja.
→ `{ products: [{ id_profile_product, id_profile, name, description, price_amount, stock_quantity, is_active, moderation_status, id_product_category, created_at, updated_at }] }`

### `GET /ext/v1/data/social`
Redes sociais cadastradas nos perfis.
→ `{ social: [{ id_profile, network, url, follower_range, phone_number_normalized }] }`

### `GET /ext/v1/data/courses`
Cursos (criados pelo usuário). Sem receita/faturamento.
→ `{ courses: [{ id, profile_id, title, slug, short_description, cover_url, price_cents, status, affiliates_allowed, modules_count, lessons_count, students_count, published_at, created_at }] }`

### `GET /ext/v1/data/metrics`
Métricas agregadas + por perfil (seguidores, nível, XP).
→ `{ totals: { followers, xp_total }, per_profile: [{ id_profile, display_name, is_community, is_clan, followers, level, xp_total, xp_next_level, xp_progress_percent }] }`

## Valores monetários

- `price_amount` (serviços e produtos) e `price_cents` (cursos) estão na menor
  unidade da moeda (centavos). Ex.: `price_amount: 5000` = R$ 50,00.

## Erros

- `401` — token ausente/inválido/revogado.
- `403` — recurso desligado (`data_api` off) **ou** token de tipo errado
  (ex.: token de atendimento chamando `/ext/v1/data`).
- `429` — limite de requisições (respeite o header `Retry-After`).

## Exemplo

Veja `scripts/dados-fetch-example.js` — puxa `/me`, `/profiles` e `/metrics` e
imprime o resumo. Uso: `DATA_TOKEN=flnd_data_… BASE_URL=https://… node scripts/dados-fetch-example.js`
