# Redesign de Clans — "Clan como subperfil coletivo"

**Data:** 2026-06-06
**Status:** Design aprovado (aguardando review do spec → plano de execução)

## Objetivo

Tirar o clan do estado de silo morto (auditoria 2026-06-06: 2 clans, ambos
deletados, 0 adoção) e transformá-lo num **subperfil coletivo** com propósito
financeiro concreto: vários perfis colaboram em serviços/cursos e **dividem a
venda igualmente**, com o dinheiro caindo de verdade no saldo de cada um.

A abordagem é **evolução, não reconstrução**: o clan continua sendo um
`tb_profile` com `is_clan=true` (reusa headcard, portfolio agregado, agenda,
ranking, follow). Adiciona-se só o que falta (anexar perfis em curso, split que
paga de verdade, chat de grupo, bloqueios e a regra de 1 clan por usuário).

## Decisões cravadas (confirmadas pelo Alex)

1. **Onde aparece**: o clan fica na **aba "Clans"** do usuário (`/account/clans`),
   **não** entra no picker de subperfis. "Virar subperfil" = ganhar as
   **capacidades** de um subperfil, não virar item do seletor.
2. **Ancoragem**: todo clan é ancorado a **um subperfil dono** (`role='owner'`),
   como já é hoje. O clan herda `is_paid` do subperfil dono (live).
3. **Conteúdo (posts + bees)**: **agregação read-time** (espelho = view, não
   cópia). Nada nasce no clan; ele espelha o que os membros postam nos próprios
   subperfis. Apaga na origem = some do clan.
4. **Serviços e cursos**: **qualquer membro** cria itens no clan. Cada membro
   **edita/exclui o que ele criou**; o **dono modera** (pode tirar qualquer item).
5. **Anexar perfis**: **livre, sem aceite** — consentimento = ter entrado no clan
   (via convite aceito). Só membros do clan podem ser anexados.
6. **Divisão do dinheiro**: ao vender serviço/curso do clan, o **líquido**
   (preço − taxa da plataforma) é dividido **igual entre os perfis anexados** e
   cai no **Saldo de cada um** (mig 067), com holdback CDC de **8 dias**. Sobra
   dos centavos (floor) vai pro 1º anexado.
7. **Bloqueios**: clan **não vende produtos** e **não gera/recebe comissão de
   afiliado** (nem como vendedor nem como indicador).
8. **Chat fixo**: criar clan cria uma **conversa de grupo no /mensagens** com
   todos os membros, **fixada no topo**, sincronizada com a membresia. Aposenta
   o mural antigo `tb_clan_message`.
9. **Pontuação**: **média simples** (soma dos membros ÷ qtd). Sem mudança.
10. **1 clan por usuário**: um usuário inteiro (somando todos os subperfis) só
    participa de **um** clan.

## Modelo & permissões

- Clan = `tb_profile is_clan=true`, ancorado a um subperfil dono.
- **Capacidades de subperfil**: espelha posts/bees, hospeda serviços/cursos,
  divide dinheiro. **Não** aparece no picker "agir como" (conteúdo é agregado,
  ninguém posta "como o clan").
- **Permissão de itens (serviço/curso)**: criador edita/exclui o seu; dono modera.
- **Visibilidade**: herda `is_paid` do subperfil dono (já implementado).

## Conteúdo espelhado (posts + bees)

- **Posts**: já agregado (`PortfolioStorage.listAggregatedItemsForClanPublic`).
- **Bees**: estender a mesma agregação pra incluir `feed_kind='bee'` (mig 053).
- **Atribuição**: cada item mostra o autor real (chip avatar+@username do membro);
  item do próprio clan leva badge "Clan".
- **Escopo**: o espelho aparece **só na página do clan**. No `/feed` e `/search`
  globais o item segue atribuído ao **membro**. O clan aparece no `/search` como
  entidade (UNION já existente).
- **Ocultar**: dono oculta post **ou bee** do feed do clan via
  `tb_clan_hidden_post` (existe pra post; estender pra bee) — sem afetar a origem.

## Serviços & cursos com perfis anexados

**Serviços** (reusa o existente):
- `tb_profile_service` + `tb_profile_service_member` (slice 7a).
- Permissão muda: **qualquer membro** cria serviço no clan (hoje só o dono).
- Perfis anexados validados contra `tb_clan_member`.

**Cursos** (novo):
- Nova tabela `tb_course_member (course_id, id_member_profile)` — perfis anexados
  = co-autores que dividem.
- Curso do clan: `courses.profile_id = clan`, `owner_user_id = membro criador`.
- **Qualquer membro** cria curso no clan e anexa membros.

**Regras comuns:**
- Anexados = quem (a) divide o dinheiro e (b) aparece como co-executor/co-autor.
- Só membros do clan podem ser anexados.
- O criador **não entra automático** — decide anexar a si ou não.
- Publicar serviço/curso de clan exige **≥1 perfil anexado**.
- Membro que sai do clan sai dos anexos **futuros**; vendas já feitas mantêm o
  split já registrado.

## Divisão do dinheiro → Saldo (o coração)

Fluxo único pros dois (serviço e curso):

```
Venda paga (booking de serviço OU compra de curso do clan)
  → líquido = preço − taxa da plataforma   (sem comissão de afiliado)
  → divide IGUAL entre os N perfis anexados
  → cada parte entra no SALDO do subperfil anexado, "aguardando" 8 dias (holdback)
  → sobra dos centavos (floor) vai pro 1º anexado
  → saca junto com o resto do saldo dele
```

- **Serviço (booking)**: `recordClanSplitForBooking` hoje grava na tabela morta
  `tb_clan_earning_split`. **Redirecionar** pro sistema de **Saldo** (mig 067):
  1 entrada de saldo por anexado, holdback 8 dias. O líquido **não vai mais pro
  clan como um todo** — vai direto pros membros anexados.
- **Curso**: caminho **novo**. No `CoursesService.confirmStripeSession`, se o
  curso é de clan, pega o líquido (`seller_amount_cents`, já pós-taxa) e divide
  igual entre os anexados → Saldo de cada um (8 dias). É o **primeiro caminho
  curso→saldo** da plataforma.
- **Idempotência**: 1 split por venda (id do booking / id da matrícula).
- **Tabela morta**: aposentar `tb_clan_earning_split` — o Saldo (mig 067) vira a
  fonte única de verdade, origem marcada (`clan_service` / `clan_course`).

## Chat de grupo fixado

- Criar clan → cria conversa de **grupo no /mensagens** com todos os membros,
  **fixada no topo** (flag ligando conversa ↔ clan).
- **Sincronização**: entra no clan → entra no grupo; sai/removido → sai do grupo;
  clan deletado → grupo arquivado.
- Reusa `GroupConversationService` (inclui áudio etc.).
- **Aposenta `tb_clan_message`**: para de escrever e some a UI; dados antigos
  ficam parados, sem migração.

## Bloqueios

- **Produtos**: `ProfileProductService.create` rejeita quando `profile.is_clan`.
- **Afiliado**: venda de serviço/curso de clan **não gera comissão**
  (`maybeAttributeCouponCommission` pula itens de clan); clan **não pode ser
  afiliado/indicador**.

## 1 clan por usuário

- Adicionar coluna `id_user` a `tb_clan_member` (denormalizada do membro) +
  `UNIQUE(id_user)`. Backfill a partir do `id_user` do `id_member_profile`.
- Validar em: **criar clan** (user do dono livre), **convidar** (user do
  convidado livre), **aceitar convite** (revalida).
- Owner conta como a membresia daquele user (é uma row em `tb_clan_member`).

## Schema (resumo das mudanças)

| Mudança | Onde |
|---|---|
| `tb_course_member (course_id, id_member_profile)` | nova tabela |
| `id_user` + `UNIQUE(id_user)` em `tb_clan_member` | alter + backfill |
| `tb_clan_hidden_post` passa a cobrir bees | reuso (item já é portfolio item) |
| ligação conversa de grupo ↔ clan (flag/coluna) | nova coluna em conversa |
| origem `clan_service`/`clan_course` no Saldo (mig 067) | reuso/extensão |
| `tb_clan_earning_split` aposentada | para de escrever |

Migrations a partir de **124** (última no disco = 123).

## Slices nomeados (proposta de execução)

1. **Slice 1 — Regra 1-clan-por-usuário + schema base**: mig `id_user`+UNIQUE em
   `tb_clan_member`, `tb_course_member`, validações em criar/convidar/aceitar.
2. **Slice 2 — Permissão coletiva de itens**: qualquer membro cria serviço/curso
   no clan; criador edita o seu, dono modera; exige ≥1 anexado.
3. **Slice 3 — Split que paga de verdade (serviço)**: redireciona o split de
   booking pro Saldo (mig 067) com holdback 8d; aposenta `tb_clan_earning_split`.
4. **Slice 4 — Split de curso**: caminho curso→Saldo no `confirmStripeSession`,
   divisão igual entre anexados.
5. **Slice 5 — Bees espelhadas + ocultar bee**: estende agregação e hide.
6. **Slice 6 — Chat de grupo fixado**: auto-cria grupo no /mensagens, sincroniza
   membresia, fixa no topo; deprecia `tb_clan_message`.
7. **Slice 7 — Bloqueios**: produto + afiliado para clans.
8. **Slice 8 — Frontend**: aba Clans com capacidades novas (criar serviço/curso,
   anexar membros, ver split), espelho de bees, chat fixo, badges de co-autoria.

## Fora de escopo

- Stripe Connect / payout direto por membro (fica no holdback+Saldo atual).
- Crédito de saldo para cursos **não-clan** (continuam como hoje, sem saldo).
- Transferência de posse do clan.
- Migração dos dados antigos de `tb_clan_message`.

## Pontos de atenção

- Cursos hoje **não creditam saldo nenhum** — o split de curso é o primeiro
  caminho curso→Saldo; conferir o modelo de taxa (`StoreGovernanceService`).
- Permissão de serviço/agenda hoje checa `profile.id_user === user`; abrir pra
  "qualquer membro do clan" exige tocar `ProfileServiceService` e endpoints de
  availability/booking sem furar a checagem pra perfis normais.
- Posições de ranking do clan já são on-the-fly (não regredir).
