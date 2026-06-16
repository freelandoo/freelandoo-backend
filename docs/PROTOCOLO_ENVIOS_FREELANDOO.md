# Protocolo de Envios Freelandoo

> Spec canônica do fluxo de compra protegida de **produtos físicos** da Loja.
> Define a O.S. de envio, as provas em vídeo do vendedor, o acompanhamento
> automático do rastreio, a janela de conferência do comprador e a retenção do
> saldo. Decisões cravadas pelo Alex em 2026-06-16.

## Princípio

A Freelandoo **não usa Stripe Connect**: o dinheiro de toda compra cai na conta
da plataforma e o repasse ao vendedor é manual/agendado. Isso é um **escrow
nativo** — a plataforma segura o dinheiro e só libera quando o protocolo é
cumprido. O Protocolo de Envios torna esse escrow **visível e auditável** dentro
de uma conversa de O.S. nas mensagens.

## Decisões cravadas (Alex, 2026-06-16)

1. **Retenção de 30 dias, fixa pra todos.** O saldo da venda fica com a
   Freelandoo por **30 dias** a partir da compra, independentemente de nível,
   reputação ou da confirmação do comprador. Sem níveis de confiança / sem
   holdback progressivo. (Substitui o holdback de 8 dias da mig 064 para a Loja.)
2. **Toda compra abre uma O.S. de envio** entre comprador e vendedor em
   `/mensagens` (canal do protocolo). É o trilho único do envio.
3. **Vendedor prova por vídeo** (2 provas, ver Etapas) antes de o rastreio
   começar a ser acompanhado.
4. **O sistema narra o rastreio** na O.S. conforme o pacote avança (postado →
   em trânsito → saiu para entrega → entregue), com notificação no sino a cada
   passo.
5. **Janela de conferência de 7 dias** após a entrega: o comprador confere e,
   se houver problema, reclama. **Silêncio por 7 dias = compra aprovada.**

## Máquina de estados da O.S. de envio

```
            compra paga (webhook)
                   │
                   ▼
        ┌─────────────────────┐
        │ AGUARDANDO_EMBALAGEM │  vendedor deve enviar VÍDEO embalando
        └─────────────────────┘
                   │ vídeo de embalagem aceito
                   ▼
        ┌─────────────────────┐
        │ AGUARDANDO_POSTAGEM  │  vendedor deve enviar VÍDEO na agência +
        └─────────────────────┘  foto do comprovante de postagem (rastreio)
                   │ postagem comprovada (código de rastreio lido)
                   ▼
        ┌─────────────────────┐
        │     EM_TRANSITO      │  sistema acompanha o rastreio ME e narra
        └─────────────────────┘  cada passo na O.S. + sino
                   │ rastreio = ENTREGUE
                   ▼
        ┌─────────────────────┐
        │ ENTREGUE_CONFERENCIA │  comprador tem 7 dias: "Confirmar
        └─────────────────────┘  recebimento" ou "Tive um problema"
            │                 │
   confirma │                 │ abre problema
   ou 7d    │                 ▼
   sem ação ▼          ┌──────────────┐
   ┌──────────────┐    │ EM_DISPUTA   │ → fluxo de disputa/devolução
   │   APROVADA   │    └──────────────┘   (Protocolo de Proteção, separado)
   └──────────────┘
```

Estados terminais paralelos: `CANCELADA` (vendedor não postou no prazo →
reembolso total) e `REEMBOLSADA` (resolução de disputa).

## Etapas detalhadas

### 1. Compra paga → abre a O.S.
No `confirmStripeSession` da Loja (pedido `paid`), além de criar o saldo do
vendedor (retido 30 dias), o sistema **abre uma O.S. de envio** ligada ao
`id_order` e posta a primeira mensagem do "robô do protocolo" explicando os
passos. Notifica os dois lados.

### 2. Vendedor: vídeo de embalagem
O vendedor grava um **vídeo embalando o produto** (lacre visível, item dentro).
Upload pela própria O.S. (reusa upload de mídia do chat). Enquanto não enviar, o
estado fica `AGUARDANDO_EMBALAGEM`. **Prazo sugerido: 2 dias úteis.**

### 3. Vendedor: vídeo de postagem + comprovante
O vendedor grava um **vídeo na agência dos Correios postando o pacote** e anexa
a **foto do comprovante de postagem** (o recibo dos Correios que traz o código
de rastreio). A etiqueta é pré-paga pela plataforma (Melhor Envio), então o
"comprovante" é o **comprovante de postagem**, não um pagamento do vendedor.
> ⚠️ Interpretação a confirmar com o Alex: o pedido original falava em "notinha
> de pagamento do frete". No modelo ME a plataforma paga a etiqueta; o vendedor
> só posta. Aqui assumimos **comprovante de postagem dos Correios**. Se o desejo
> for que o vendedor pague o frete e seja reembolsado, o modelo muda (ver
> "Pontos abertos").

Postagem comprovada → estado `EM_TRANSITO`. **Prazo total p/ postar: ex. 3 dias
úteis**; estourou sem postar → `CANCELADA` + reembolso total ao comprador.

### 4. Sistema: narração do rastreio
Um job CDC (no scheduler do `index.js`) consulta o rastreio ME (`trackShipment`)
periodicamente e, a cada mudança de status relevante, **posta uma mensagem na
O.S.** e dispara notificação:
- "📦 Postado nos Correios"
- "🚚 Em trânsito"
- "📍 Saiu para entrega"
- "✅ Entregue"

### 5. Entrega → janela de conferência de 7 dias
Ao detectar `ENTREGUE`, o sistema posta: *"Produto entregue. Você tem 7 dias
para conferir e relatar qualquer problema."* O comprador vê dois botões:
- **Confirmar recebimento** → `APROVADA` na hora.
- **Tive um problema** → `EM_DISPUTA` (entra no Protocolo de Proteção).

### 6. Auto-aprovação
Job CDC: O.S. em `ENTREGUE_CONFERENCIA` há **≥ 7 dias** sem resposta do comprador
→ `APROVADA` automaticamente.

## Dinheiro e prazos

- **Comprador paga**: produto + frete (cotação ME) no checkout (Stripe).
- **Plataforma adianta** a etiqueta ME do saldo da carteira ME.
- **Saldo do vendedor**: criado como retido por **30 dias** a partir da compra.
  A aprovação (passo 6) libera da disputa, mas o **repasse financeiro só ocorre
  após os 30 dias** (proteção contra chargeback/CDC). Em regra, os 30 dias são o
  gargalo; a aprovação só garante que não há disputa pendente.
- **Cancelamento por não-postagem** ou **disputa procedente** → reembolso via
  `charge.refunded` (reverte o saldo retido — ainda está com a plataforma).

## Frete de devolução (quando o vendedor paga)

Vale a matriz do Protocolo de Proteção. Como o saldo fica retido 30 dias, a
plataforma **adianta a etiqueta reversa** e **debita do responsável** a partir
do saldo retido:

| Situação | Quem paga a volta | Reembolso |
|---|---|---|
| Defeito / quebrado (CDC art. 18) | **Vendedor** (debitado do saldo retido) | Total |
| Errado / diferente do anúncio | **Vendedor** | Total |
| Não chegou (rastreio comprova) | **Vendedor** | Total, sem devolução física |
| Arrependimento até 7 dias (CDC art. 49) | **Vendedor** | Total |
| Devolução voluntária após 7 dias (se vendedor aceitar) | **Comprador** | Produto, menos frete da volta |
| Suspeita de fraude / erro da plataforma | **Plataforma** | Conforme apuração |

Regra de comunicação: **o vendedor paga o frete de volta sempre que a devolução
for culpa dele (defeito, errado, não chegou) ou direito legal do comprador
(arrependimento em 7 dias). O comprador só paga quando devolve por gosto próprio
fora desses casos.** Mostrado no anúncio, no checkout e na tela de devolução
antes de confirmar.

## Implementação — slices propostos

Depende do **Melhor Envio em produção** para o rastreio real (a captura/narração
do rastreio precisa de token de produção).

1. **Schema + abertura da O.S.**: estado do protocolo no pedido (ou tabela
   `tb_shipment_protocol` por `id_order`); `confirmStripeSession` abre a O.S. e
   posta a mensagem inicial; retenção do saldo passa de 8 → **30 dias**.
2. **Provas do vendedor**: endpoints de upload do vídeo de embalagem e do vídeo
   de postagem + comprovante; transições de estado; prazo de postagem + cancela.
3. **Narração do rastreio**: job CDC com `trackShipment` (ME), postando passos
   na O.S. + notificações.
4. **Janela de 7 dias**: botões "Confirmar recebimento" / "Tive um problema";
   job de auto-aprovação; ligação com o fluxo de disputa/devolução.
5. **Página explicativa pública** `/protocolo-de-envios` (i18n 3 idiomas) — *este
   é o primeiro entregável, independe do ME de produção.*

## Pontos abertos (confirmar com o Alex)

- **"Notinha de pagamento do frete"**: comprovante de postagem (modelo ME atual)
  vs. vendedor paga o frete e é reembolsado (muda o modelo financeiro).
- **Aprovação x repasse**: confirmar que a aprovação em entrega+7d NÃO antecipa
  o repasse (que fica nos 30 dias). Ou a aprovação antecipa?
- **Prazos**: 2 dias úteis p/ embalar, 3 dias úteis p/ postar — valores
  sugeridos, ajustáveis.
- **Vídeos obrigatórios x opcionais**: tornar a embalagem obrigatória bloqueia
  vendedores sem jeito com vídeo; avaliar "obrigatório acima de R$X".
