# Proteção de Pagamento — Disputa, Devolução e Provas (Loja + Booking)

> Design validado via brainstorming em 2026-06-05. **Ainda não implementado.**
> Cobre produtos (Loja) e serviços (Booking). Sem Stripe Connect: dinheiro na conta
> da plataforma, repasse manual; a proteção apenas **adia/congela** o repasse e
> reembolsa via Stripe quando preciso.

---

## 1. Understanding Summary

- **O quê**: escrow lógico + disputa + devolução que adia o repasse ao vendedor/prestador
  e devolve ao comprador quando algo dá errado (não chegou, errado/defeito, golpe,
  prestador faltou).
- **Por quê**: hoje o repasse parte do pagamento (8d→aprovado→admin paga ≤30d) e libera
  mesmo se o item nunca chegou. Falta proteção ao comprador e prova de entrega/execução.
- **Para quem**: compradores (proteção), vendedores/prestadores (regras claras), admin
  (arbitragem só nos casos-limite).
- **Domínios**: Loja (`tb_profile_product_order`) + Booking (`tb_profile_bookings`).
  Service-requests/O.S. entram só como **canal de notificação**.
- **Não-objetivos**: Stripe Connect; reembolso parcial manual com UI; envio fora do ME;
  rastreio de transportadora que não seja o Melhor Envio.

## 2. Benchmark (jun/2026)

- **Mercado Livre/Pago**: dinheiro retido no intermediário; libera 2d após entrega (Mercado
  Envios) ou ~11d após confirmar envio próprio; reclamação→mediação→contestação; Programa
  de Proteção ao Vendedor exige comprovar entrega (rastreio + recebimento).
- **Shopee** (modelo mais próximo): dinheiro reservado até o comprador confirmar entrega;
  devolução em até 7d (Art. 49 CDC); reembolso só após vendedor confirmar recebimento da
  devolução, e se ele silenciar no prazo a Shopee reembolsa sozinha.
- **Melhor Envio — Logística Reversa**: só Correios (PAC/SEDEX Reverso); gera **código de
  autorização de postagem** (sem imprimir etiqueta), enviado ao comprador; via API
  (cart→checkout→generate); custo da loja; código vale 30d.

## 3. Decision Log

| # | Decisão | Alternativas | Por quê |
|---|---------|--------------|---------|
| 1 | **Produto**: relógio do repasse começa quando o lojista anexa **foto da postagem + rastreio ME válido** | começar no pagamento; começar na entrega confirmada | Prova de envio dispara; alinha "envio próprio" do ML mas com prova |
| 2 | **Serviço**: relógio começa quando o prestador anexa **foto de chegada/início E o cliente confirma**; foto de conclusão é prova extra | só foto chegada; só confirmação do cliente | Combina prova + aceite do cliente |
| 3 | Janela de disputa = **7 dias** do gatilho; silêncio → **auto-OK** | confirmação ativa obrigatória; janela só da entrega | Evita travar dinheiro; alinha Shopee/ML + CDC |
| 4 | Resolução = **regras automáticas; admin só no limite** | admin arbitra tudo; vendedor-primeiro | Escala sem sobrecarregar admin |
| 5 | Devolução é **self-service**: página com passos → etiqueta/código reverso ME → posta à origem → **lojista avisado por O.S.** | devolução manual via suporte | Automação ponta-a-ponta |
| 6 | **Reembolso de produto** dispara quando **rastreio reverso = ENTREGUE na origem** | reembolso ao aprovar; ao lojista confirmar | Protege caixa; produto volta antes do dinheiro |
| 7 | Casos sem retorno (não chegou/golpe/faltou): **prova decide; sem prova → auto-reembolso; com prova → admin** | sempre admin; vendedor contesta com prazo | Automático onde a prova é clara |
| 8 | Envio **sempre via etiqueta ME** (rastreio do ME); reversa 100% no ME | ME ou envio próprio; só envio próprio | "Código válido" = rastreio ME existe; reversa garantida |
| 9 | **Plataforma absorve o frete reverso**; preço de toda compra **embute ida + volta** | vendedor paga; depende do motivo | Caixa pré-financiado pra devolução; UX melhor |
| 10 | Arquitetura: **módulo compartilhado de Disputa/Devolução (domain-aware) + gating por domínio** | escrow unificado; estender cada fluxo | DRY no que importa sem reabrir ledgers em produção |
| 11 | Prazos: **7d disputa + 8d holdback** (libera ~D+15, admin paga ≤30d) | configurável; só 7d | Mantém holdback atual, só deslocado |
| 12 | Serviço sem foto: auto-reembolso **só quando o cliente reclamar "não apareceu"** (sem foto→reembolsa; com foto→admin) | timeout após data agendada | Evita reembolso automático sem reclamação |

## 4. Assumptions

1. Sem mudar Stripe: reembolso pelo caminho `charge.refunded` existente; repasse segue
   manual; disputa apenas congela o payout (impede virar "pago").
2. Detecção de entrega (ida e reversa) por **job CDC** consultando a API de rastreio do ME
   (igual ao scheduler de retry de etiqueta).
3. Provas (fotos) no R2 sob prefixos `fulfillment-proof/` e `dispute-evidence/`.
4. Disputa só dentro da janela de 7d; após `clear`, fecha.
5. Volume baixo; sem requisito de tempo real; idempotência em webhooks/jobs.
6. Backfill retroativo cria `protection_case` em `clear` para pedidos/bookings já pagos em
   holdback (não quebra repasses em andamento).

## 5. Schema (migrations 120–123)

`domain ∈ ('product','booking')`, `ref_id` = `id_order`/`id_booking`.

### mig 120
- **`tb_protection_case`** (1:1 por transação): `id`, `domain`, `ref_id`, `state`
  (`awaiting_fulfillment → dispute_window → clear → disputed → refunded`), `proof_at`,
  `window_ends_at` (= proof_at + 7d), `cleared_at`, `current_dispute_id`,
  `UNIQUE(domain, ref_id)`.
- **`tb_fulfillment_proof`**: `id`, `protection_case_id`, `kind`
  (`shipment`|`arrival`|`completion`), `photo_url`, `tracking_code?`,
  `created_by_user_id`, `created_at`.

### mig 121
- **`tb_dispute`**: `id`, `protection_case_id`, `domain`, `ref_id`, `opened_by_user_id`,
  `reason_code` (`product_not_arrived`|`product_wrong`|`product_defective`|
  `service_no_show`|`scam`|`other`), `state` (`open → awaiting_return →
  return_in_transit → return_delivered → resolved_refund | resolved_release |
  escalated_admin`), `description`, `resolved_by` (`system`|`admin`),
  `resolution_note`, timestamps.
- **`tb_dispute_evidence`**: `id`, `dispute_id`, `uploaded_by_user_id`, `role`
  (`buyer`|`seller`|`admin`), `photo_url`, `note`, `created_at`.

### mig 122
- **`tb_return`**: `id`, `dispute_id`, `me_reverse_order_id`, `reverse_tracking_code`,
  `reverse_auth_code`, `reverse_status` (`pending → code_issued → posted →
  in_transit → delivered_origin | expired`), `purchased_at`, `posted_at`,
  `delivered_at`, `error`, `attempts`, `last_attempt_at`.

### mig 123 (gating)
- `tb_seller_balance` e `tb_booking_payout`: + `protection_case_id`. O payout passa a ser
  **armado só quando `protection_case.state='clear'`**, com `available_at = cleared_at + 8d`
  (não mais no pagamento). Disputa = não arma / congela.

## 6. Máquina de estados

**Produto (feliz)**: pagamento → `awaiting_fulfillment`; lojista anexa foto postagem →
`dispute_window` (proof_at, +7d); 7d sem disputa → `clear` → arma seller_balance (+8d) →
`aprovado` → admin paga.

**Serviço (feliz)**: pagamento → `awaiting_fulfillment`; prestador anexa foto chegada **e**
cliente confirma → `dispute_window`; (conclusão = prova extra); 7d → `clear` → arma
booking_payout (+8d) → `aprovado` → admin paga.

**Disputa (dentro dos 7d)**: abre `tb_dispute` → case `disputed` (congela). Roteia por
`reason_code`:
- `product_wrong/defective` → `awaiting_return` → compra reversa ME → `return_in_transit`
  → (polling) `return_delivered` → **auto-reembolso + reverte ledger + repõe estoque** →
  `resolved_refund`, case `refunded`.
- `product_not_arrived` → rastreio ida nunca "entregue" → auto-reembolso; já entregue →
  `escalated_admin`.
- `service_no_show` → sem foto de chegada → auto-reembolso; com foto → `escalated_admin`.
- `scam/other` → `escalated_admin`.
- Admin: `resolved_refund` (reembolsa) ou `resolved_release` (clear → arma payout).

## 7. Fluxo de dados

**Hooks**: `confirmStripeSession` / `confirmBookingFromPayment` → `ProtectionService.openCase`
(em vez de criar ledger). `SellerBalanceService`/`BookingPayoutService` ganham
`armFromProtection(case)` (no `clear`).

**Endpoints (auth)**:
- `POST /me/orders/:id/shipment-proof` (multipart `photo`) — lojista (status `paid` + etiqueta ME comprada).
- `POST /me/bookings/:id/arrival-proof`, `.../completion-proof` (multipart) — prestador.
- `POST /me/bookings/:id/confirm` — cliente confirma chegada.
- `POST /me/disputes` (`domain`,`ref_id`,`reason_code`,`description` + fotos).
- `GET  /me/disputes/:id` — página de devolução self-service.
- `POST /me/disputes/:id/evidence`.
- Admin: `GET /admin/disputes?state=&domain=&q=`, `POST /admin/disputes/:id/resolve` (`refund`|`release` + nota).

**ME**: `integrations/melhorenvio/purchaseReverseLabel.js` (remetente=comprador,
destinatário=origem do lojista) e `trackShipment.js` (status ida + reverso).

**Jobs CDC** (scheduler em `index.js`):
- `tickProtectionWindows` (~30min): `dispute_window` com `window_ends_at<=now` e sem disputa → `clear` + arma ledger.
- `tickTracking` (~30min): ida em disputa `not_arrived` + returns `in_transit` → consulta ME → transição/reembolso.
- `tickReverseLabels`: retry compra reversa (≤5, gap 30min).

**Webhooks**: reusa `charge.refunded` (reverte ledger + estoque). Resolução chama
`StripeService.refund(charge_id)`; webhook fecha o ciclo (idempotente).

## 8. Erros / idempotência / bordas

- `openCase` idempotente via `UNIQUE(domain, ref_id)`; `armFromProtection` arma uma vez
  (UNIQUE por `protection_case_id`); reembolso disparado uma vez (guard por `dispute.state`).
- Jobs usam `SELECT … FOR UPDATE SKIP LOCKED`.
- **Reembolso x frete embutido**: devolução → reembolsa produto + ida (retém a volta, que
  custeou o reverso); não-chegou/golpe (sem reverso) → reembolsa tudo.
- Etiqueta reversa falha → retry; >5 → `escalated_admin`.
- `auth_code` expira (30d) sem postar → `expired` → `escalated_admin` (lembrete por O.S. antes).
- Lojista nunca posta → case fica `awaiting_fulfillment`, nunca arma payout; comprador pode
  abrir `product_not_arrived` a qualquer momento.
- Nunca reembolsa em dobro: divergência (ledger já `pago`) → `escalated_admin`.
- Estoque repõe só em produto, uma vez.
- Supervisão/menor herda bloqueios já existentes.

## 9. UI e notificações

- **Comprador**: `/account/compras` + agendamentos mostram status da proteção e botão
  "Tive um problema"; página `/account/disputas/[id]` self-service (motivo → auth_code ME →
  postar nos Correios → acompanhar → reembolso), com empty/loading/error.
- **Vendedor/Prestador**: "Confirmar postagem" (foto + rastreio pré-preenchido) na Loja;
  "Anexar chegada"/"Anexar conclusão" no Booking.
- **O.S. (mensagens)**: mensagens de sistema em cada evento (disputa, etiqueta emitida,
  produto a caminho, reembolso, contestação) com link de ação.
- **Admin** `/administracao/disputas`: fila por estado, detalhe com provas dos 2 lados +
  rastreio ida/reverso, botões Reembolsar / Liberar vendedor (nota obrigatória). Badge no
  modal `AdminAlerts` somando disputas escaladas.

## 10. Testes

- **Unit**: transições do case; roteamento por `reason_code`; cálculo de reembolso
  (devolução vs não-chegou); `window_ends_at`/`available_at`.
- **Integração (PG teste)**: idempotência de `openCase`/`armFromProtection`; reembolso sem
  dobra; `SKIP LOCKED`.
- **Mock ME**: `purchaseReverseLabel`/`trackShipment` → `delivered_origin` (reembolso),
  `expired` (admin), falha (retry).
- **E2E**: produto feliz; devolução completa; não-chegou; serviço (chegada+confirma; no-show
  sem foto → reembolso; com foto → admin).
- **Backfill**: pedidos/bookings já pagos em holdback ganham `protection_case` em `clear`.

## 11. Slices propostos (handoff de implementação)

1. **Schema + ProtectionService + gating** (migs 120, 123) — abre case no pagamento, arma
   ledger no clear, backfill. Sem UI.
2. **Provas de fulfillment** (mig 120 cont.) — endpoints shipment/arrival/completion +
   confirm cliente + upload R2 + dispara `dispute_window` + job `tickProtectionWindows`.
3. **Disputas core** (mig 121) — abrir disputa, evidências, roteamento por `reason_code`,
   casos sem retorno (auto-reembolso/escala), fila + resolução admin.
4. **Logística reversa ME** (mig 122) — `purchaseReverseLabel` + `trackShipment` +
   `tickTracking` + `tickReverseLabels` + reembolso no `delivered_origin`.
5. **Frontend comprador** — status de proteção em compras/agendamentos, "Tive um problema",
   página self-service de devolução.
6. **Frontend vendedor/prestador + O.S.** — botões de prova/postagem; mensagens de sistema.
7. **Admin** `/administracao/disputas` + badge no AdminAlerts.

> Cada slice: commit + push nos repos (migrations no mesmo commit do código que as usa).
