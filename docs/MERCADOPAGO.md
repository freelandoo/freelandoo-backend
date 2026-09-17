# Mercado Pago — ligar, testar e voltar atrás

> Este documento é para **executar no painel**, não é plano de implementação.
>
> **Estado: LIGADO em produção desde 2026-09-17.** O Mercado Pago é o **único**
> provedor — o Stripe e o Asaas foram removidos inteiros, e nenhum dos dois
> chegou a cobrar um real. Sem `MERCADOPAGO_ACCESS_TOKEN` não existe plano B: a
> compra estoura no primeiro clique, alto e imediato.
>
> **⚠️ Nenhum segredo entra aqui.** Este arquivo é versionado. Token e
> assinatura secreta vivem só nas variáveis do Railway.

---

## 1. Por que o Mercado Pago, e por que o Asaas saiu

O Asaas foi construído inteiro (mig 236 + auditoria A1–A6) e **nunca cobrou um
real**: conferido em produção que `tb_payment_intent` está vazia. Foi esse fato
que permitiu removê-lo de uma vez em vez de mantê-lo como saída do passado —
não havia dinheiro dele para devolver.

O motivo de ele sair é **tarifa fixa contra percentual**:

| cobrança real da plataforma | Asaas Pix (R$1,99 fixo) | Mercado Pago Pix (~0,99%) |
|---|---|---|
| Delivery R$ 3,00 | **66%** | ~R$ 0,03 |
| Função R$ 9,90 | **20%** | ~R$ 0,10 |
| Plano Negócio R$ 50 | 4% | ~R$ 0,50 |
| Site Freelandoo R$ 99 | 2% | ~R$ 0,98 |

O ponto em que a tarifa fixa passa a ganhar da percentual é **~R$201**
(`0,99% × X = R$1,99`). Praticamente nenhum ticket da Freelandoo chega lá.

**⚠️ Os percentuais acima não são medidos** — confirme as tarifas contratadas
antes de calibrar qualquer coisa. Quem apura a tarifa REAL por cobrança é
`getChargeFee`, que grava em `processor_fee_source = 'mercadopago_fee'`.

---

## 2. O que fazer no painel (é só isto)

### 2.1 Criar a aplicação

1. <https://www.mercadopago.com.br/developers> → **Suas integrações** → criar
   aplicação.
2. Produto: **Pagamentos online** → **Checkout Pro**.
3. Em **Credenciais**, pegue as de **produção** e as de **teste**.

**Não precisamos da `public key`.** O checkout é redirect (Checkout Pro), tudo
server-side — nada muda na CSP do frontend.

### 2.2 Cadastrar o webhook

No painel da aplicação → **Webhooks** → configurar a URL:

```
https://<backend>/webhooks/mercadopago
```

Marque os eventos:

- `payment` (pagamentos)
- `subscription_preapproval` (assinaturas)
- `subscription_authorized_payment` (as faturas mensais da assinatura)

> **⚠️ Marcar só `payment` deixa o bloco de assinatura morto, sem erro nenhum.**
> Foi exatamente o que o Asaas ensinou: o painel dele separava "eventos para
> cobranças" de "eventos para assinaturas", e marcar só o primeiro deixou o fim
> da assinatura invisível.

Copie a **assinatura secreta** que o painel mostra — é ela que vai em
`MERCADOPAGO_WEBHOOK_SECRET`.

### 2.3 Variáveis no Railway

| variável | valor |
|---|---|
| `MERCADOPAGO_ACCESS_TOKEN` | o access token da aplicação |
| `MERCADOPAGO_WEBHOOK_SECRET` | a assinatura secreta do webhook |
| `PAYMENT_PROVIDER` | `mercadopago` (opcional — com a credencial presente ele já assume) |
| `MERCADOPAGO_NOTIFICATION_URL` | opcional; vazio = derivado de `BASE_URL` |

**⚠️ O ambiente é o próprio token.** `TEST-…` é sandbox, `APP_USR-…` é produção.
Não existe uma env de ambiente para errar — e também não existe rede de
segurança: colar o token de produção durante um teste **cobra de verdade**.
(O Asaas tinha `ASAAS_ENV`, que fazia o erro cair no sandbox. Aqui não há.)

---

## 3. O que muda para quem usa

### 3.1 Avulsos — nada muda no fluxo, muda o meio de pagamento

A página de pagamento passa a ser a do Mercado Pago, com **Pix, cartão e
boleto**. O comprador vê os itens em **linhas separadas** (produto + frete),
como no Stripe — o Asaas cobrava um valor só e o frete virava texto.

### 3.2 Assinaturas — mudam de meio de pagamento

Os quatro fluxos recorrentes (`plan_subscription`, `community_membership`,
`vaquinha_sponsorship`, `atendimento_ia`) passam a usar `preapproval`, que
**cobra por CARTÃO**. Pix recorrente clássico não existe; o **Pix Automático** é
outro produto e precisa estar habilitado na conta.

### 3.3 "Cancelar no fim do ciclo" agora é nosso (mig 251)

**⚠️ Isto conserta um defeito que tirava mês pago de assinante.** Quatro lugares
cancelam pedindo "no fim do ciclo":

- sair da comunidade privada (`CommunityMembershipService`)
- cancelar o Plano Negócio (`PlanService`)
- cancelar a assinatura do perfil (`StripeSubscriptionService`)
- apagar a conta (`user/DeleteMeService`)

No Stripe isso funciona (`cancel_at_period_end` é nativo). No Mercado Pago **não
existe** — cancelar é imediato. Os quatro agora passam por
`SubscriptionEndService`, que:

- **delega ao provedor** quando ele sabe fazer sozinho
  (`SUPPORTS_PERIOD_END = true`), e
- **agenda a data** em `tb_subscription_end` quando não sabe. Um sweeper de 1h
  executa o cancelamento quando o ciclo pago acaba.

⚠️ **Hoje o primeiro ramo está VAZIO e é só por isso que ele fica:** o Mercado
Pago declara `SUPPORTS_PERIOD_END = false` e era o Stripe quem sabia fazer
nativamente. O ramo continua porque é ele que mantém a decisão *por capacidade
declarada*, e não *por nome de provedor* — foi essa distinção que permitiu
trocar o gateway inteiro sem reabrir os quatro pontos de cancelamento.

> **⚠️ Provedor novo declara `SUPPORTS_PERIOD_END`.** Esquecendo, o valor é
> `undefined` e ele cai na fila — que é o lado seguro do erro.

---

## 4. Como testar em sandbox

1. Ponha o token `TEST-…` no Railway (ou local) e reinicie.
2. Crie **usuários de teste** no painel (vendedor e comprador) — o Mercado Pago
   não deixa você pagar a si mesmo.
3. Compre qualquer coisa barata (Polén, função) e pague pelo checkout de teste.
4. Confira:
   - a linha em `tb_payment_intent` saindo de `created` para `paid`;
   - o `provider_ref` **re-carimbado** com o id do *payment* (ele nasce com o id
     da *preferência*);
   - o produto entregue.

**⚠️ O re-carimbo é load-bearing.** Sem ele o estorno mandaria o id de uma
preferência para a rota de estorno de pagamento (404) e
`resolveProviderByRef` devolveria `"stripe"` pela regra da ausência — o pedido
de estorno iria para o gateway errado e o dinheiro ficaria com a gente.

### Rodar as suítes

```bash
npm run test:unit              # 313 casos, inclui a tradução para a forma de Checkout Session
npm run test:payments          # mig 250 (os 5 CHECKs), contra o banco, com ROLLBACK
npm run test:subscription-end  # mig 251 (a fila de cancelamento), idem
```

> As duas e2e podem apontar para produção porque **não existe `COMMIT` nelas** e
> as duas conferem, no fim, que o banco voltou ao estado de antes.
>
> ⚠️ Se a conexão morrer com `self-signed certificate in certificate chain`, é o
> `sslmode=require` da connection string vencendo o objeto `ssl`. Rode com
> `NODE_TLS_REJECT_UNAUTHORIZED=0` ou troque a URL para `sslmode=no-verify`.

---

## 5. Como voltar atrás

**Não dá mais, e isso é decisão.** O Stripe saiu do registry em 2026-09-17
(*"se for pagamento é MP"*), então tirar `MERCADOPAGO_ACCESS_TOKEN` não devolve
a cobrança a ninguém: ela simplesmente para, com erro alto no primeiro clique de
compra.

Foi o preço aceito para acabar com o fallback silencioso — o modo de falhar que
deixava uma migração pela metade por semanas sem ninguém notar. Se um dia for
preciso voltar, é reintroduzir um adapter no registry (o contrato em
`integrations/payments/contract.js` continua lá, e foi ele que permitiu trocar o
provedor inteiro sem reescrever os 20 fluxos).

**O que sobrevive de qualquer provedor antigo:** os CHECKs do banco continuam
aceitando `'stripe'` e `'asaas'` como valores **HISTÓRICOS** (mig 250), e o
provedor de cada cobrança sai da **intenção** (mig 231), nunca do ambiente.

---

## 5.9 O que já foi conferido contra a API real (2026-09-16)

Sonda rodada com a credencial de **produção**, pelo NOSSO adapter (não curl na
mão — o que se queria saber é se o NOSSO payload passa). **Nada foi cobrado:**
preferência é só a página de pagamento, e o `preapproval` de teste nasceu
`pending` (só cobra depois que o titular autoriza o cartão) e foi **cancelado**
no fim da sonda.

Conferido: a conta responde e é do site **MLB**; a preferência é criada e guarda
o `external_reference` com o id da **intenção** (o único fio até o pedido); os
dois itens saem em **linhas separadas** (produto + frete) com os valores certos
em reais; o placeholder `{CHECKOUT_SESSION_ID}` é substituído antes de ir; o
`auto_return` é aceito; a `notification_url` fica gravada **na própria
preferência**; a busca por `external_reference` (o caminho da reconciliação, que
socorre *"paguei e não recebi"*) é aceita; o `preapproval` é criado devolvendo o
id **do gateway** em `subscription`; a janela do ciclo é derivada; e o cancelamento
funciona.

**A assinatura do webhook foi exercitada contra a ROTA REAL**, com o manifesto
`id:<data.id>;request-id:<x-request-id>;ts:<ts>;` da doc oficial: assinatura
válida passa; segredo errado, `data.id` trocado (replay em outra cobrança),
`x-request-id` trocado, cabeçalho ausente e assinatura malformada **todos caem
em 401**; o formato antigo (IPN `topic`/`id`) também passa; e **sem o segredo no
ambiente a porta responde 503**, nunca aceita o corpo.

> ⚠️ **O que a sonda NÃO prova, e não tem como provar sem dinheiro real:** o
> corpo de um `payment` aprovado, o estorno, a tarifa apurada (`getChargeFee`) e
> a fatura mensal da assinatura. Os quatro só existem depois que alguém paga.

---

## 6. Pendências conhecidas

1. **`GET /authorized_payments/{id}` — a ROTA foi conferida; a resposta de
   SUCESSO não.** Conferido em 2026-09-16 contra a API de produção: o endpoint
   existe, o nosso token tem escopo nele e o wrapper traduz a resposta em
   `MercadoPagoError` com `statusCode` 404 para id inexistente — ou seja, ele
   não é rota fantasma e não estoura de um jeito que o webhook não saiba tratar.
   O que **continua sem prova** é o FORMATO do corpo quando existe uma fatura de
   verdade, e isso exige um ciclo real (alguém autoriza o cartão e o mês vira).
   A falha dele é tratada como evento **ignorado** (log + 2xx), nunca como erro,
   para não travar a fila de webhooks.
2. **A estimativa de tarifa continua calibrada para o Stripe.** É ela que a tela
   de quem entrega mostra **antes** do aceite. Com o Mercado Pago ela erra para
   baixo (promete menos do que cai) — direção segura, mas é tela sobre dinheiro.
   Recalibrar depois de ter extrato real.
3. **Não há caminho de "reativar" uma assinatura agendada para cancelar.**
   `SubscriptionEndService.releaseSchedule` existe e nenhuma tela o chama.
4. **Disputa (`charged_back`) passa a estornar.** Nem o Stripe nem o Asaas
   tratavam isso; é a primeira vez que a plataforma reage a um chargeback. Vale
   observar o primeiro caso real.
5. ~~As 5 assinaturas de perfil vivas no Stripe~~ — **ERA FALSO, e foi medido
   antes de remover o Stripe (2026-09-17).** A conta de produção
   (`acct_1TZuuE452Tgx3qwD`) tem **ZERO cobranças e ZERO assinaturas em toda a
   vida dela**. Aquelas 5 são linhas do NOSSO banco que nunca corresponderam a
   uma assinatura viva do lado de lá. Foi esse fato que tornou a remoção segura
   — e ele vale como aviso: *"conferido em produção"* num comentário precisa
   dizer **onde** foi conferido, senão vira folclore que decide arquitetura.
