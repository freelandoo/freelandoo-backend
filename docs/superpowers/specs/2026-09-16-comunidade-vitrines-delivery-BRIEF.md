# BRIEF MASTER — Vitrines + Delivery em condomínio e bairro

> **Para quem:** a sessão de Claude Code que vai executar isto de ponta a ponta.
> **Como usar:** este arquivo é o contrato. Leia inteiro antes da primeira linha
> de código. O `CLAUDE.md` da raiz continua valendo por cima de tudo.
>
> **Autorização do Alex, literal:** *"faça tudo, planeje, e execute tudo de uma
> vez, sem pedir permissão em mais nada, qualquer dúvida você faz o recomendado
> por você, e só pare ao terminar tudo e já pushado."*
>
> Ou seja: **não pare para perguntar.** Dúvida que sobrar, decida pelo que este
> documento recomenda; se ele não cobrir, decida pelo padrão do repo e **anote a
> decisão no commit**.

---

## 1. O que o Alex pediu (transcrição do que importa)

Condomínio e rua (bairro) passam a funcionar "como a comunidade game e a
financeira": as pessoas postam no feed e há **duas abas — vitrine de serviços e
vitrine de produtos**. Ao lado do card da foto, um **botão de delivery**.

Sobre o delivery, nas palavras dele:

- Uma venda foi feita de um serviço ou produto. Se precisar que alguém busque
  na recepção, ou leve do apartamento que vendeu ao que comprou, **quem comprou
  pode pagar R$3 a mais** e esses R$3 ficam disponíveis para alguém buscar.
- **Qualquer pessoa da comunidade pode chamar um delivery mesmo sem ter
  comprado** — por exemplo, buscar na portaria algo que chegou de iFood.
- Tabela de preços dele: **comida R$3 · encomenda pequena R$4 · ajudar com
  mudança R$50 · ajudar com encomendas (móveis, eletrodomésticos) R$50**.
- **Qualquer um da comunidade pode pegar o chamado** e receber.
- **Quem for buscar pode cancelar a qualquer momento e o dinheiro volta para
  quem pagou.**

---

## 2. Decisões que o Alex JÁ tomou — não reabrir

| # | decisão | observação |
|---|---|---|
| 1 | **Cobrança por corrida**, com a tabela de preços acima | ele recusou carteira pré-paga e Poléns |
| 2 | **Asaas** como provedor | ver §4 — ele está DESLIGADO hoje |
| 3 | **Quem entrega absorve a tarifa** do gateway | numa corrida de R$3 no Asaas/Pix sobra **R$1,01**; ele sabe e aceitou ("a priori") |
| 4 | **Delivery é aberto a qualquer membro** — NÃO é papel promovido | ele falou "como professor" na primeira descrição e depois corrigiu: *"qualquer um da comunidade pode ir receber"*. **Vale a correção.** Não construir `tb_*_courier` no molde do `tb_academy_professor` |
| 5 | **Cobra quando alguém ACEITA** o chamado | chamado que ninguém pega expira **sem custo nenhum** |
| 6 | **Quem pediu confirma, com prazo**; sem resposta no prazo, libera sozinho | fecha as duas fraudes simétricas |
| 7 | **Fazer os três sub-projetos** (§5), de uma vez | |

⚠️ **A conta da tarifa foi levantada duas vezes e ele manteve a decisão.** Não
levantar de novo, não "otimizar" para carteira pré-paga, não trocar para Poléns.

---

## 3. O que já existe e ninguém sabia — **leia antes de desenhar qualquer coisa**

Descoberto lendo o código em 2026-09-16. Isso muda o tamanho do trabalho.

### 3.1 As duas vitrines JÁ EXISTEM no condomínio

`tb_condo_listing` (**mig 198**) já é exatamente a vitrine pedida:

```sql
kind        VARCHAR(10) NOT NULL CHECK (kind IN ('service', 'product')),
title, description, price_cents, contact, image_url,
status      CHECK (status IN ('active','archived'))
```

Com cota por tipo (`tb_condo_listing_slot`: 2 grátis, vaga extra por R$9,90 ou
200 Poléns) e rotas prontas em `/condos/:id_condo/listings`.

**Elas só não são abas** — hoje moram dentro do bloco de extras
(`condo-extras.tsx`, junto de avisos/enquetes/vizinhos/vaga).

➡️ **Sub-projeto 1 não é "construir vitrines". É promovê-las a abas e estendê-las
ao bairro.** Construir tabela nova aqui seria a segunda verdade sobre a mesma
coisa.

### 3.2 O anúncio NÃO vende

`tb_condo_listing` tem um campo **`contact`** — a venda acontece **fora da
plataforma**. Conferido: não existe nenhum fluxo de pedido/checkout ligado a
listing; o único checkout ali é o de comprar **vaga de anúncio**.

➡️ **O "+R$3 numa compra" pressupõe um checkout que não existe.** Vender
vizinho-a-vizinho é subsistema inteiro (pagamento, retenção, disputa, holdback).
É o sub-projeto 3, e é o maior dos três.

### 3.3 O bairro não tem vitrine nenhuma

As rotas são `/condos/...` e o storage é `CondoListingStorage`. Bairro
(`community_kind = 'neighborhood'`, mig 204) não tem nada disso.

### 3.4 ⚠️ O Asaas está DESLIGADO em produção

Conferido no Railway em 2026-09-16: **`ASAAS_API_KEY`, `ASAAS_ENV` e
`PAYMENT_PROVIDER` estão AUSENTES.** Só `STRIPE_SECRET_KEY` existe, e é
`sk_live`. A migração para o Asaas está completa no código e **inerte**.

Conferido também na conta Stripe: as capabilities ativas são
**`card_payments`** e **`boleto_payments`** — **Pix NÃO está habilitado**.

**Tarifas reais** (apuradas nas páginas oficiais, 2026-09-16):

| | R$3 | R$50 |
|---|---|---|
| **Stripe cartão** (3,99% + R$0,39) — *o que roda hoje* | R$0,51 → líquido **R$2,49** | R$2,39 → **R$47,61** |
| Stripe Pix (1,19%) — *não habilitado* | R$0,04 | R$0,60 |
| **Asaas Pix** (R$1,99 fixo) — *o que o Alex escolheu* | R$1,99 → **R$1,01** | R$1,99 → R$48,01 |
| Asaas cartão (2,99% + R$0,49) | R$0,58 → R$2,42 | R$1,99 → R$48,01 |

➡️ **Consequência de engenharia, não de produto:** a mesma corrida rende
R$2,49 hoje e R$1,01 no dia em que o Asaas subir. **Nunca cravar o número.**
A conta sai do `PaymentGateway` ativo, como o `utils/bookingFee.js` já faz.

---

## 4. Decisões que EU tomei por você (o Alex autorizou)

Cada uma tem o porquê. Se você discordar com base em algo que encontrar no
código, pode mudar — **mas registre no commit**.

1. **A tela de quem entrega mostra o LÍQUIDO, não o bruto.** Se o card anuncia
   "R$3" e caem R$1,01, o vizinho descobre na primeira corrida e não faz a
   segunda. O card diz *"você recebe R$X,XX"*, com X vindo do gateway.

2. **A tabela de preços é ADMIN-EDITÁVEL desde o dia 1, nunca constante.**
   Lição já paga neste repo: *"A TELA DE ADMIN DA TAXA EXISTIA E MENTIA"* — a
   taxa do agendamento era `PLATFORM_FEE_CENTS = 1000` no código enquanto a tela
   escrevia noutro lugar. Criar `tb_community_delivery_settings` no molde de
   `tb_booking_fee_settings`, com os 4 tipos e preços, e ler dali. **Não criar
   constante de preço no service.**

3. **Sem holdback no delivery.** O holdback de 8 dias existe para a Loja (CDC,
   compra remota de bem). Aqui é entrega em mãos dentro do prédio, confirmada
   explicitamente por quem pediu. Segurar R$1,01 por 8 dias mata a feature.
   Confirmou → vira saldo sacável. **Anotar isso em comentário no código**, para
   ninguém "consertar" depois achando que foi esquecimento.

4. **Expiração por tipo.** Comida expira em **2h** (é perecível e o chamado
   perde sentido); os outros em **24h**. Expirar não custa nada, porque não
   houve cobrança (decisão 5 do Alex).

5. **Cancelamento do entregador tem freio.** Ele pode cancelar a qualquer
   momento (decisão do Alex) e o dinheiro volta **inteiro** para quem pagou —
   a plataforma come a tarifa. Para isso não virar torneira: **3 cancelamentos
   em 7 dias bloqueiam aceitar por 24h**. Contar em coluna própria, não derivar.

6. **"Me chame" vira disponibilidade, não papel.** O Alex disse *"um botão
   chamado me chame"* e também *"qualquer um pode pegar"*. As duas coisas
   convivem: **qualquer membro aceita** um chamado, e quem quiser liga um
   toggle *"disponível agora"* para **receber notificação** quando abrir um.
   Isso honra as duas falas sem criar papel promovido.

7. **Nome físico é legado — NÃO renomear `tb_condo_listing`.** Ela vai passar a
   servir bairro também. Renomear quebraria a mig 198, que o runner re-executa
   em banco virgem e cujo checksum ele confere no boot. É a mesma regra de
   `tb_machine` (guarda enxames), `tb_story` (guarda bees) e
   `tb_games_presence` (guarda presença do Financeiro). **Generalize o service e
   as rotas; deixe a tabela com o nome dela.**

8. **Rota nova genérica, `/condos/...` mantida por compat.** Criar
   `/communities/:id_profile/listings` servindo condo E bairro; manter a rota
   antiga montada apontando para o mesmo service, para o front em cache não
   quebrar. Migrar o front para a nova.

9. **Ordem de execução:** 1 → 2 → 3. O delivery (2) não depende de 3, e é onde
   está o valor. O "+R$3 na compra" é a junção de 2 e 3 e entra **por último**.

---

## 5. Os três sub-projetos

### Sub-projeto 1 — As vitrines viram abas (condo + bairro)

**Backend**
- Generalizar `CondoListingStorage`/`CondoService` para aceitar comunidade
  `condo` **e** `neighborhood`. O guard de quem pode ver/publicar difere:
  condo exige **morador confirmado**, bairro exige **morador reconhecido**
  (§7.3).
- Rotas `/communities/:id_profile/listings*` (ver decisão 8).
- A cota (`tb_condo_listing_slot`) passa a valer para bairro também.

**Frontend**
- `CommunityTab` hoje é `"feed" | "members"` em
  `app/(header-only)/comunidades/[id]/page.tsx`. Vira
  `"feed" | "services" | "products" | "members"`.
- As duas abas novas só existem em `condo` e `neighborhood`.
- Tirar os anúncios de dentro de `condo-extras.tsx` — **não deixar nos dois
  lugares**, senão publicar num não aparece no outro.

### Sub-projeto 2 — Delivery avulso (o coração)

**Máquina de estados** (decisões 5 e 6 do Alex):

```
aberto ──(alguém aceita → COBRA)──► aceito ──(entregou)──► entregue
   │                                   │                      │
   │                                   │                      ├─(quem pediu confirma)─► concluído → saldo
   │                                   │                      └─(prazo vence)─────────► concluído → saldo
   │                                   └─(entregador cancela)─► aberto de novo + ESTORNO
   └─(expira: 2h comida / 24h resto)──► morto, sem custo
```

**Tabelas** (mig **248** — é o próximo número livre; a última é a 247):
- `tb_community_delivery_request` — comunidade, quem pediu, tipo, preço,
  observação, ponto de retirada/entrega, status, quem aceitou, os carimbos de
  tempo, e o vínculo de pagamento (`provider_ref` / intenção).
- `tb_community_delivery_settings` — a tabela de preços admin-editável
  (decisão 2).
- Repasse: **espelhar `tb_booking_payout` / `BookingPayoutStorage`**, que é o
  padrão já estabelecido. Não inventar formato novo.

**Dinheiro**
- Cobrança pelo `PaymentGateway` (`createCheckout`), no aceite.
- Tarifa **apurada** com `PaymentGateway.getChargeFee(provider_ref)` na
  confirmação, substituindo a estimativa — **na ordem certa: antes de escrever
  o repasse**, senão a corrida fica certa e o repasse errado, e é o repasse que
  vira saque. É exatamente o que o `BookingService` faz; copie a ordem de lá.
- **Líquido nunca negativo.** Corrida de R$3 com tarifa de R$1,99 chega perto de
  zero; um valor negativo viraria débito na carteira de quem trabalhou.
- **Não apurar ≠ tarifa zero.** `getChargeFee` devolve `null` quando não
  consegue ler; nesse caso mantenha a estimativa e marque a origem
  (`fee_source = 'fallback'`) — é assim que se descobre depois quais repasses
  saíram no palpite.
- Estorno: `PaymentGateway.refund({ provider_ref })`, que resolve o provedor
  pela intenção — **nunca pelo prefixo do id** (`sub_` colide entre Stripe e
  Asaas).

**Webhook**
- O webhook é **at-least-once**. O confirmador precisa ser **idempotente por
  session id**, devolver `{error}`/`{canceled}` quando NÃO entregar, e ter
  tratamento de `charge.refunded`. Registrar a origem em
  `PaymentOpsStorage.SOURCES` (senão o painel de pendentes fica cego para o
  delivery). São **três pontos** a editar: fulfill, expire e refund.

**Notificações**
- Tipos novos (`delivery_opened`, `delivery_accepted`, `delivery_delivered`,
  `delivery_confirmed`, `delivery_canceled`) entram no CHECK de
  `tb_notification`, reescrito como **SUPERSET com o MESMO nome de constraint:
  `tb_notification_type_chk`**. Nome diferente deixa a constraint antiga de pé
  em paralelo, recusando tudo. (Regra já paga nas migs 153/197/206/244/246.)
- Push por socket: o evento precisa estar na lista `events` de
  `lib/realtime.ts` no front — **evento fora dela não chega e a tela parece
  congelada**.

**Frontend**
- Pill **Delivery** no headcard, 4º da pilha. **A conta fecha:** os pills são
  `h-9` (36px) com `gap-1.5` (6px); 4 pills = 4×36 + 3×6 = **162px** contra uma
  foto de **192px** (w-32 com proporção 2/3). **Um QUINTO (198px) escaparia** —
  se alguém acrescentar outro pill depois, refaça esta conta.
- Condo/bairro têm hoje 3 pills (Perfil, Mural, Ranking). O pill "Indicadores"
  é **exclusivo do negócio**, então não disputa espaço aqui.

### Sub-projeto 3 — Vender dentro da vitrine (o grande)

Fazer o anúncio vender pela plataforma: checkout, retenção, confirmação de
recebimento, disputa e holdback. **Só depois disto o "+R$3 na compra" existe** —
ele é um add-on no checkout do sub-projeto 3 que abre um chamado do
sub-projeto 2 já pago.

⚠️ Aqui **o holdback de 8 dias VOLTA a valer** (é compra de bem/serviço, CDC),
ao contrário do delivery. Não confundir os dois regimes.

⚠️ Se o tempo apertar, **entregue 1 e 2 completos e pare**. Um sub-projeto 3
pela metade põe dinheiro entre vizinhos sem disputa — pior que não existir.

---

## 6. Ponto jurídico a registrar (não bloqueia)

Vizinho recebendo dinheiro para carregar móveis (R$50) é trabalho, não favor.
A plataforma está intermediando. **Escreva uma seção nos termos** dizendo o que
a Freelandoo é aqui (intermediária de pagamento entre vizinhos) e o que ela não
é (empregadora, transportadora, seguradora). Não é bloqueio de entrega, mas
deixe anotado nas pendências do `CLAUDE.md` para o Alex decidir se sobe
`TERMS_VERSION`.

---

## 7. Armadilhas DESTE repo — todas já custaram tempo real

### 7.1 Migrations
- **Próximo número livre: 248.**
- Elas rodam **no boot** e o runner **compara checksum e aborta com exit 1**.
  Migration já aplicada **NUNCA** pode ser editada — mudança entra em arquivo
  novo.
- Idempotentes sempre (`IF NOT EXISTS`, `DROP CONSTRAINT IF EXISTS` antes de
  `ADD`).
- **CHECK inline tem nome gerado pelo Postgres**: para trocar, varra o
  `pg_constraint` **pela COLUNA**, não pelo nome chutado — errar deixa a antiga
  de pé em paralelo e o primeiro INSERT novo é recusado, **em produção**.

### 7.2 SQL
- **42P08**: o mesmo parâmetro usado como coluna (varchar) e dentro de uma
  expressão/`CASE` (text) faz o Postgres deduzir tipos inconsistentes. Custou as
  migs 202–204, a 224 e o sweeper do WhatsApp. **Cast `::text` explícito, ou
  calcule o booleano/timestamp no JS.**
- `ROLLUP` leva a **expressão inteira**, nunca a posição ordinal — dentro de
  `ROLLUP(1)` o `1` é constante e agrupa tudo num balde só, em silêncio.

### 7.3 Quem é morador
- Condo: **titular de unidade aprovada** — `CondoStorage.getResidentStatus`.
  Entrar na comunidade **não basta**.
- Bairro: `status='recognized' AND ended_at IS NULL` — **sempre as duas
  metades**.
- ⚠️ **Use `src/utils/condoResidentSql.js` como fonte única. NÃO reescreva o
  predicado.** Já houve regressão exatamente assim: avisos e enquetes
  continuaram perguntando à tabela legada e o morador novo publicava e **não
  recebia nada, sem erro nenhum**.
- Modalidade nova precisa estar declarada em `communityPolicy` — o default é
  **territorial** (o mais restritivo), e sem a linha a tela nasce vazia para
  sempre, sem erro.

### 7.4 Front
- **`useSearchParams` obriga Suspense e tira a rota do pré-render.** O build já
  quebrou assim. Deep-link se lê do **`window`**, uma vez, em efeito.
- **Dicionário vence fallback inline.** Trocar só a string no JSX **não muda
  nada na tela** se a chave já existe no dicionário — precisa de script de
  merge com **OVERRIDE**, não `fill-if-absent`.
- i18n: script `scripts/i18n-*-merge.js`, idempotente, 3 idiomas, **rodar 2× e
  conferir que a 2ª passada dá 0**. Nunca editar `messages/*.json` na mão.
- **Sem cantos arredondados** (`.fl-sharp`) — exceto avatar circular.
- **Toda página nasce com `PageBackLink`.**
- Modal aberto de dentro de outro modal precisa de `z-` maior que o de baixo, e
  vai por **portal no body** se houver ancestral com `transform`.

### 7.5 Git
- ⚠️ **NUNCA `git add -A`.** Há WIP alheio não commitado no working tree do
  backend (`AdminUsersController.js`, `AdminUsersStorage.js`). Stage só os
  caminhos seus; se um arquivo tiver hunk seu e hunk alheio, use
  `git apply --cached` de um patch filtrado.
- Commit + push nos dois repos ao fim de cada slice. Migration no mesmo commit
  do código que a usa.

---

## 8. Barra de validação (o padrão da casa)

Não dê nada por entregue sem isto:

- **Backend:** `npm run test:unit` verde (hoje 305/305) + suíte e2e nova
  (`npm run test:community-delivery`) rodando **contra o Postgres de produção
  dentro de transação com ROLLBACK** — é seguro **porque não existe `COMMIT`**;
  confira produção intocada depois. `node --check` e eslint nos arquivos
  tocados.
- **Escreva o defeito como asserção.** O padrão deste repo é conferir a suíte
  **falhando com o defeito de volta**. Faça isso pelo menos para: a corrida que
  cobra no aceite (e não na abertura), o líquido que não fica negativo, e o
  chamado expirado que **não** cobrou ninguém.
- **Front:** `tsc --noEmit`, `eslint --max-warnings=0`, `npm run build` limpos.
  Anote a contagem de páginas (hoje **220**).
- **Deploy:** conferir o estado do Railway **pela API depois do push**, em vez
  de supor. Idem Vercel.
- **Atualize o `CLAUDE.md`** com um gatilho novo no topo, no formato dos outros:
  o que foi entregue, as decisões que não podem regredir, as armadilhas pagas e
  as pendências do Alex.

---

## 9. O que NÃO fazer

- ❌ Não reabra a conta da tarifa (§2, decisão 3).
- ❌ Não crie tabela nova de vitrine — `tb_condo_listing` já é ela (§3.1).
- ❌ Não renomeie `tb_condo_listing` (§4, decisão 7).
- ❌ Não crie papel promovido de entregador (§2, decisão 4).
- ❌ Não crave preço nem tarifa em constante (§4, decisões 1 e 2).
- ❌ Não ligue o Asaas você mesmo. É decisão de infra do Alex, e ligá-la muda o
  líquido da corrida de R$2,49 para R$1,01.
- ❌ Não entregue o sub-projeto 3 pela metade (§5).
