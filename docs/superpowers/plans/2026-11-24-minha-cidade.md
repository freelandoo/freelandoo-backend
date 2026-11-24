# Minha cidade — plano técnico (2026-11-24)

Direção de produto alinhada com o Alex em 24/11: **Minha cidade** é a entrada comum de
**Meu bairro** e **Meu condomínio**. A pessoa diz se mora em CASA ou em CONDOMÍNIO e ganha a
aba correspondente dentro do ambiente — o padrão de escolha + aba do Esportes (`/esportes`,
aba da academia = comunidade existente embutida).

## O que se reaproveita (nada é copiado)

| Peça | Onde | Papel em Minha cidade |
|---|---|---|
| Comunidade de bairro / condomínio | `tb_profile` (`community_kind` neighborhood/condo) | as abas SÃO essas comunidades, pelos IDs de sempre |
| Página da comunidade | front `comunidades/[id]` → `_components/community-detail.tsx` | renderizada DENTRO da aba (`embed`), com mural, pills, vitrines, delivery, planta, avisos, enquetes, vagas, administração |
| Residência (CEP + número) | `ResidenceService.claim`, `NeighborhoodStorage.listMine` | fluxo "moro em casa" (a `NeighborhoodView` em modo embutido) |
| Busca de condomínio | `GET /communities?kind=condo&q=` (`CommunityStorage.listPublic`) | fluxo "moro em condomínio" |
| Cadastro de condomínio | `/comunidades/criar?tipo=condo` | quem não acha o prédio cadastra |
| Morador do condomínio | `CondoResidence` (dentro da página da comunidade) | unidade, família × disputa, veredito |
| Delivery / mudança | `CommunityDeliveryService` (food/parcel/bulky/moving), `/comunidades/[id]/delivery` | o pill Delivery da comunidade ativa; nada novo |
| Política | `communityPolicy.js`, `territorialCommunity.js`, `condoResidentSql.js` | intocados: a aba não concede nada |

## Contratos novos

- **Mig 468 `tb_user_city_pref`** (aditiva, idempotente): `id_user` PK, `housing_kind`
  (`house`|`condo`, NULL = nunca escolheu), `last_tab` (`bairro`|`condominio`), `updated_at`.
  Preferência de INTERFACE — não toca residência, membresia nem pedido.
- **`GET /me/city`** (auth): `{ preference, bairros[], condos[] }` — a preferência + os vínculos
  existentes (bairro por residência ativa ∪ membresia de bairro; condomínio por membresia).
  Uma requisição, sem N+1.
- **`PUT /me/city`** (auth): `{ housing_kind?, last_tab? }`, validação em `utils/cityPref.js`;
  parcial (o que não veio fica). 400 em valor fora da lista.
- **Acesso rápido**: chave nova `city`; `condo` e `neighborhood` gravados viram `city`
  (alias em `normalizeQuickPills` e no `sanitize` do front) — sem pill órfão nem duplicado.

## Front

- Rota canônica **`/minha-cidade`**. Parâmetros: `lugar=bairro|condominio` (a aba) e
  `c=<id_profile>` (qual comunidade, quando há mais de uma). `?aba=`/`?painel=` continuam sendo
  da comunidade embutida e passam direto.
- `/bairro` redireciona para `/minha-cidade?lugar=bairro`. `/comunidades/<id>` de bairro ou
  condomínio, para quem é MEMBRO, troca a URL por `/minha-cidade?lugar=…&c=<id>` preservando a
  query (notificações, convites e links salvos chegam no contexto certo). Visitante e as outras
  modalidades seguem na página de sempre. Rotas de serviço (`/delivery`, `/compras`…) ficam.
- Menu da foto e pill: as linhas "Meu condomínio" e "Meu bairro" viram **Minha cidade**.

## Slices

1. **Back** — mig 468, `cityPref.js`, `CityPrefStorage`, `CityService`, rotas, alias `city` no
   acesso rápido; unit + e2e `test:city`.
2. **Front: extração** — `CommunityDetail({ id, embed })` sai do `page.tsx` (a página vira casca);
   `NeighborhoodView({ embedded, onChanged })`.
3. **Front: ambiente** — `/minha-cidade` com escolha casa × condomínio, abas, restauração
   (servidor + URL), busca de condomínio, troca de moradia.
4. **Front: compatibilidade** — redirecionamentos, menu/pills, i18n pt/en/es.
5. **Validação e entrega** — lint, build, unit/e2e, preview, deploy conferido.

## Critérios de aceite (resumo)

Ver o prompt de 24/11. Pontos que este desenho garante por construção: autorização continua 100%
no servidor (a aba só escolhe o que mostrar); pedido/residência/publicação nunca são reatribuídos
por trocar preferência; `c=` só é honrado se a comunidade está nos vínculos da pessoa.
