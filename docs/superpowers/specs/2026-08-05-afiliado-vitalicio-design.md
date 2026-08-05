# Afiliado vitalício — dois regimes: vínculo (plataforma) × cupom de conteúdo (usuário)

**Data:** 2026-08-05
**Status:** IMPLEMENTADO 2026-08-05 (P1, P2, V1, V2, V3, C1, X1, X2, X3).
Pendente: comissão na Carteira (ver §13) e os números do admin (§11).
**Substitui:** o modelo de atribuição por transação descrito em `project_freelandoo_affiliate_additive`

---

## 1. A regra que organiza tudo: hierarquia

O que decide o comportamento é **quem vende**:

| | **Plataforma vende** | **Usuário vende** |
|---|---|---|
| Exemplos | perfil/ativação, poléns, premium, manifestação, boost de XP, Loja de Funções | produtos de loja, cursos, serviços, booking |
| Cria vínculo? | **sim** — é o único lugar onde o vínculo nasce | **não** |
| Comprador ganha | **comissão + desconto** | comissão (**sem desconto**) |
| Quem leva a comissão | **o vínculo, sempre** | **o cupom do conteúdo sobrepõe o vínculo** |
| Preço | varia por usuário (vinculado paga menos) | **igual para todo mundo** |

A lógica por trás: **desconto é dinheiro da plataforma, então só a plataforma dá.** Nos itens do
usuário, quem define o pool é o dono do produto — esse dinheiro é dele para pagar quem vende por ele,
não para virar desconto que ele não escolheu conceder.

E na atribuição vale o mesmo raciocínio invertido: no item do usuário, quem trabalhou pela venda foi
**quem compartilhou aquele conteúdo**. Seria injusto o vínculo (herdado de uma compra de poléns de
dois anos atrás) roubar a comissão de quem divulgou o curso.

---

## 2. Regime PLATAFORMA — vínculo vitalício

### 2.1 Como funciona

Usar o cupom de alguém numa compra de plataforma cria um **vínculo permanente** entre comprador e
afiliado (`tb_user_referral`). A partir daí, **toda compra de plataforma** daquele usuário:

- gera comissão para o afiliado vinculado, para sempre;
- dá **desconto** ao comprador, para sempre;
- **ignora qualquer cupom de terceiro** — o vínculo vence.

O desconto vale **já na primeira compra** (a que cria o vínculo). É o gancho: *compra pelo meu link,
já economiza, e economiza para sempre*.

### 2.2 A matemática do pool

```
pool               = preço_base × pct_admin / 100      (% por tipo de compra, definida no admin)
comissão_afiliado  = pool × split / 100                (split global, ex. 70%)
desconto_vinculado = pool − comissão_afiliado

comprador vinculado paga   = preço_base − desconto_vinculado
comprador sem vínculo paga = preço_base   (plataforma fica com o pool inteiro)
```

O pool é custo de margem da plataforma — é o preço de adquirir e reter um usuário. Por isso a % é
por tipo de compra e editável, e por isso o split existe: você calibra quanto vira incentivo do
afiliado e quanto vira atrativo do comprador.

### 2.3 Contextos

| `source_context` | Estado hoje | Falta |
|---|---|---|
| `profile_subscription` (ativação/compra de perfil) | já gera comissão | migrar para a tabela de regras + desconto |
| `polen_purchase` | já manda `coupon_code` no metadata | mapear no `resolveCommissionContext` |
| `premium` | já manda `coupon_code` | mapear |
| `manifestation` | já manda `coupon_code` | mapear |
| `xp_boost` | **não manda `coupon_code`** | capturar cupom + mapear |
| `function_purchase` (Loja de Funções) | sem comissão | entra |

**Fora:** `clan_slot`, `community_slot`, `donation`/vaquinha, `vaquinha_sponsorship`,
`community_membership`.

**Trava inviolável:** comissão e desconto só sobre **dinheiro real do Stripe**. Manifestação ou
premium pagos com **poléns não geram nada** — aquele real já foi comissionado quando o pacote de
poléns foi comprado. Sem isso você paga duas vezes pelo mesmo dinheiro.

---

## 3. Regime USUÁRIO — cupom de conteúdo

### 3.1 Como funciona

Qualquer usuário compartilha o produto/curso/serviço de outro; o link carrega o cupom dele. Quem
abrir aquele conteúdo pelo link fica **grudado naquele cupom para aquele conteúdo** — não expira,
não depende de aba aberta. Se comprar, a comissão é de quem compartilhou, **mesmo que o comprador
tenha vínculo com outra pessoa**.

Sem desconto: o preço do item é o mesmo para todo mundo, sempre.

### 3.2 `tb_content_referral` — a atribuição por conteúdo (novo)

```sql
CREATE TABLE IF NOT EXISTS public.tb_content_referral (
  id_attribution   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user_visitor  UUID REFERENCES public.tb_user(id_user),   -- quando logado
  visitor_token    VARCHAR(64),                                -- anônimo, casado no login
  item_type        VARCHAR(24) NOT NULL,   -- 'product' | 'course' | 'service'
  item_id          VARCHAR(64) NOT NULL,
  id_coupon        UUID NOT NULL REFERENCES public.tb_coupon(id_coupon),
  id_affiliate     UUID NOT NULL REFERENCES public.tb_affiliate(id_affiliate),
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_content_referral_user
  ON public.tb_content_referral (id_user_visitor, item_type, item_id)
  WHERE id_user_visitor IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_content_referral_anon
  ON public.tb_content_referral (visitor_token, item_type, item_id)
  WHERE id_user_visitor IS NULL;
```

Gravada por um endpoint leve (`POST /affiliate/touch`) disparado **só quando a URL tem `?cupom=`** —
sem custo em navegação normal. **Último toque vence** (atualiza `id_coupon`): se a pessoa vê o mesmo
curso por dois links diferentes, o último divulgador leva.

**Anônimo → logado:** o front guarda um `visitor_token` em `localStorage`; no login/cadastro as
linhas anônimas migram para o `id_user`. Sem isso, quem clica deslogado e compra depois de criar
conta some da atribuição — que é exatamente o furo do `sessionStorage` de hoje.

### 3.3 O pool aqui é 100% comissão

```
pool = seller × item.affiliate_percent / 100     (o dono define, por produto)
comissão = pool          (não há desconto)
display = gross_up(seller + serviço + pool)      (igual para todo mundo)
```

O vendedor recebe `seller` intacto. Sem `affiliates_allowed`, não há pool: nem comissão, nem preço
inflado.

### 3.4 Regras do regime

| Regra | Motivo |
|---|---|
| Comprar item de usuário **não cria vínculo** | vínculo é território da plataforma |
| Cupom de conteúdo **> vínculo** | quem divulgou aquele item ganha |
| Sem cupom de conteúdo, cai no **vínculo** | "sobrepõe" implica que o vínculo é a base |
| Sem nenhum dos dois → plataforma fica com o pool | como hoje |
| **Dono do item não ganha comissão do próprio item** | senão todo vendedor compartilha o próprio link e embolsa `seller + pool`, e o modelo de taxas vira ficção |
| Autocompra não gera comissão | já existe hoje |

---

## 4. Precedência — o resolvedor inteiro

```
compra de PLATAFORMA:
   1. vínculo vivo               → comissão + desconto        (mode='referral')
   2. sem vínculo + cupom        → CRIA vínculo + comissão + desconto  (mode='coupon', 1ª compra)
   3. nada                       → preço cheio, pool fica com a plataforma

compra de USUÁRIO (item com affiliates_allowed):
   1. cupom de conteúdo do item  → comissão                   (mode='content')
   2. senão, vínculo vivo        → comissão                   (mode='referral')
   3. nada                       → pool fica com a plataforma
   NUNCA desconto · NUNCA cria vínculo
```

Isso roda em dois momentos: `resolvePricing` no **checkout** (para saber quanto cobrar e cravar
`affiliate_commission_cents` / `referral_discount_cents` no metadata) e `resolveAttribution` no
**webhook** (para criar a conversão). O webhook confere o que o checkout cravou.

---

## 5. Modelo de dados (resumo)

### 5.1 `tb_user_referral` — o vínculo

```sql
CREATE TABLE IF NOT EXISTS public.tb_user_referral (
  id_referral        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user_referred   UUID NOT NULL UNIQUE REFERENCES public.tb_user(id_user),
  id_affiliate       UUID NOT NULL REFERENCES public.tb_affiliate(id_affiliate),
  id_coupon          UUID REFERENCES public.tb_coupon(id_coupon),
  bound_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  bound_source       VARCHAR(24) NOT NULL,   -- 'first_purchase' | 'admin' | 'backfill'
  id_first_order     UUID REFERENCES public.tb_order(id_order),
  expires_at         TIMESTAMPTZ,            -- NULL = vitalício
  released_at        TIMESTAMPTZ,
  released_reason    TEXT,
  released_by        UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

O `UNIQUE (id_user_referred)` é a regra de negócio inteira: **primeiro vínculo vence, para sempre**.
O vínculo é da **conta** — com CPF obrigatório (mig 188), conta = pessoa, e subperfis/clans/perfil-conta
herdam do dono.

**Regras de vínculo:** não vincula a si mesmo; **não vincula se o CPF do indicado == CPF do afiliado**
(mata "compro com meu segundo cadastro"); afiliado precisa estar `ACTIVE`; **um nível só** (multi-nível
é pirâmide, risco jurídico); nunca sobrescrito. Morre só por `released_at` do admin; afiliado
bloqueado faz o vínculo **dormir**, não some.

### 5.2 % por produto

```sql
ALTER TABLE public.courses            ADD COLUMN IF NOT EXISTS affiliate_percent NUMERIC(5,2);
ALTER TABLE public.tb_profile_product ADD COLUMN IF NOT EXISTS affiliate_percent NUMERIC(5,2);
ALTER TABLE public.tb_profile_service ADD COLUMN IF NOT EXISTS affiliate_percent NUMERIC(5,2);
```

NULL = usa o default global. `affiliates_allowed` (mig 090) continua sendo o liga/desliga; a coluna
nova é o "quanto".

### 5.3 `tb_affiliate_program_settings` — trilhos globais

```sql
CREATE TABLE IF NOT EXISTS public.tb_affiliate_program_settings (
  id_settings              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commission_split_percent NUMERIC(5,2) NOT NULL DEFAULT 70,  -- SÓ plataforma: afiliado × desconto
  seller_percent_min       NUMERIC(5,2) NOT NULL DEFAULT 0,
  seller_percent_max       NUMERIC(5,2) NOT NULL DEFAULT 50,
  default_percent          NUMERIC(5,2) NOT NULL DEFAULT 25,  -- item com affiliate_percent NULL
  effective_from           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by               UUID
);
```

### 5.4 `tb_affiliate_commission_rule` — regra por tipo de compra

Uma linha por `source_context`, com `regime` ('platform' | 'user'), `is_enabled`, `percent` (usado só
no regime plataforma), `max_pool_cents`, `min_order_cents`, `recurring_allowed`, `max_recurring_cycles`.
É o painel de controle do custo do programa. `clan_slot` e `community_slot` não recebem linha.

### 5.5 `tb_affiliate_conversion` — colunas novas

```sql
ALTER TABLE public.tb_affiliate_conversion
  ADD COLUMN IF NOT EXISTS id_referral             UUID REFERENCES public.tb_user_referral(id_referral),
  ADD COLUMN IF NOT EXISTS attribution_mode        VARCHAR(16),  -- 'coupon' | 'referral' | 'content'
  ADD COLUMN IF NOT EXISTS referral_discount_cents INTEGER NOT NULL DEFAULT 0;
```

Sem `attribution_mode` não dá para medir qual dos dois regimes traz receita.

---

## 6. O que a separação de regimes simplificou

**Preço volta a ser único no marketplace.** Como só itens de plataforma têm desconto, as vitrines de
produto/curso/serviço — que são justamente as páginas estáticas/ISR e de alto volume — continuam com
**um preço só para todo mundo**. Nada de preço por usuário em listagem, nada de re-dinamizar rota
(regra F3.S5 preservada de graça). O preço variável fica confinado a poucas telas internas (loja de
poléns, premium, manifestação, Loja de Funções, checkout de ativação).

**O gate da mig 086** (`tb_item.is_subscription`, que hoje limita desconto de cupom à anuidade) fica
coerente: desconto continua existindo só onde a plataforma vende.

---

## 7. Checkout — o que o comprador vê

**Item de plataforma, comprador vinculado:** o campo de cupom **desaparece** e dá lugar ao selo do
vínculo — "Vínculo: @fulano · desconto de R$ X aplicado". Não há o que digitar: o vínculo vence
qualquer código.

**Item de plataforma, sem vínculo:** campo de cupom normal — é assim que o vínculo nasce. Vale
mostrar o incentivo ("use o cupom de quem te indicou e o desconto vale para sempre").

**Item de usuário:** sem campo de desconto e sem selo de preço — o preço é o mesmo para todos. Se
houver cupom de conteúdo ativo, no máximo um crédito discreto ao divulgador ("indicado por @fulano"),
por transparência.

---

## 8. Recorrência

Renovação de assinatura hoje **não gera comissão**: só o `checkout.session.completed` inicial passa
por `createFromProfileSubscription`. O `handleInvoicePaid`
([`StripeWebhookService.js:184`](../../../src/services/StripeWebhookService.js)) roteia por
membership → sponsorship → atendimento IA → assinatura de perfil e nunca toca em afiliado.

Vínculo vitalício sem recorrência é meia promessa. Hook no fim do `handleInvoicePaid`, idempotente
por `source_event_id = 'invoice:' + invoice.id`, respeitando `recurring_allowed`. Só regime
plataforma.

---

## 9. Consequências operacionais

**Volume de conversões explode** — de uma linha por venda esporádica para uma por compra de cada
indicado, para sempre. O pagamento manual em lote PIX (`payConversionsNow`) não escala: comissão
deve cair na **Carteira** com o holdback de 8 dias que já existe (mesmo padrão de vaquinha/booking).

**Transparência:** o comprador precisa ver "você foi indicado por @fulano" nos dados da conta.

**Backfill:** para cada conversão existente, criar o vínculo pela conversão **mais antiga** de cada
comprador (`bound_source='backfill'`, `ON CONFLICT DO NOTHING`) — mas **só a partir de conversões de
contexto plataforma**, já que compra de item de usuário não vincula.

---

## 10. Fatiamento

| Slice | Frente | Entrega | Depende de |
|---|---|---|---|
| **P1** | back | Mig: `affiliate_percent` nos 3 itens + `tb_affiliate_program_settings` + `tb_affiliate_commission_rule` seedada com o regime de cada contexto. `computeFees` recebe o % do item; `computeFeesFor`/`pricePreview` propagam; checkouts cravam o pool. Comportamento igual ao de hoje, só que a % passa a ser do dono. | — |
| **P2** | front | Campo de % nos 3 modais (produto/serviço/curso) com breakdown ao vivo ("você recebe X · comprador paga Y · afiliado ganha Z"), clamp nos limites do admin. i18n 3 idiomas. | P1 |
| **V1** | back | `tb_user_referral` + colunas na conversion + `ReferralService.bind/resolve/release` com as regras da 5.1 (CPF, self, 1 nível) + backfill (só contexto plataforma). Nada de dinheiro muda. | — |
| **V2** | back | Atribuição regime plataforma: vínculo vence cupom; vínculo nasce na 1ª compra de plataforma. | V1 |
| **V3** | back+front | **Desconto do vínculo** nos itens de plataforma: `resolvePricing` no checkout, `referral_discount_cents` no metadata/conversão, selo do vínculo no lugar do campo de cupom. | P1, V2 |
| **C1** | back+front | **Cupom de conteúdo** (regime usuário): `tb_content_referral` + `POST /affiliate/touch` + `visitor_token` no front + merge anônimo→logado no login + precedência conteúdo > vínculo no checkout de produto/curso/serviço. Aposenta o `sessionStorage`. | V2 |
| **X1** | back | Contextos de plataforma restantes: poléns, premium, manifestação, `xp_boost` (capturar cupom), Loja de Funções. Trava "nunca sobre pólen gasto". Admin da tabela de regras. | V3 |
| **X2** | back | Recorrência: hook no `invoice.paid`, idempotente por invoice id. | V2 |
| **X3** | back+front | Comissão na Carteira com holdback 8d (aposenta o lote PIX manual); "Meus indicados"; admin para quebrar vínculo; "indicado por @x" nos dados do comprador. | V2 |

**Marcos com valor isolado:**
- **P1+P2** — vendedores definem a própria %. Independe de todo o resto.
- **V1+V2** — vínculo funcionando, sem mudar nenhum número de margem.
- **V3** — o desconto entra em pé; é o slice que o usuário final percebe.
- **C1** — o compartilhamento de conteúdo para de vazar atribuição.

---

## 11. Números que faltam

1. **`commission_split_percent`** — do pool de plataforma, quanto vai ao afiliado × quanto vira
   desconto. Sugestão 70/30. Mais desconto = mais viral; mais comissão = afiliado mais motivado.
2. **% por contexto de plataforma** — ativação/perfil, poléns, premium, manifestação, boost, Loja de
   Funções. Custo direto e perpétuo de margem; cada linha merece um número pensado.
3. **`seller_percent_max`** — teto do que o dono pode destinar. Sugestão 50%.
4. **`default_percent`** — para os itens já publicados (NULL). 25% preserva o comportamento atual.
