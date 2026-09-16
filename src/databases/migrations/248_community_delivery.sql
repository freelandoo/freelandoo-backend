-- =============================================================================
-- Migration 248: DELIVERY entre vizinhos (condomínio e bairro)
--
-- Pedido do Alex: "se precisar que alguém busque na recepção, ou leve do
-- apartamento que vendeu ao que comprou, quem comprou pode pagar R$3 a mais e
-- esses R$3 ficam disponíveis para alguém buscar" — mais o chamado avulso:
-- "qualquer pessoa da comunidade pode chamar um delivery mesmo sem ter
-- comprado, por exemplo buscar na portaria algo que chegou de iFood".
--
-- ─── A MÁQUINA DE ESTADOS ───────────────────────────────────────────────────
--
--   aberto ──(alguém ACEITA → COBRA)──► aceito ──(entregou)──► entregue
--      │                                   │                      │
--      │                                   │      ┌──(quem pediu confirma)──┐
--      │                                   │      └──(o prazo vence)────────┴► concluído → saldo
--      │                                   └─(entregador cancela)─► aberto + ESTORNO
--      └─(expira: 2h comida / 24h resto)──► morto, SEM COBRANÇA NENHUMA
--
-- ⚠️ COBRA-SE NO ACEITE, NÃO NA ABERTURA (decisão do Alex). Chamado que ninguém
-- pega expira sem custo — é o que permite alguém abrir um pedido às 23h sem
-- medo de pagar por um favor que não aconteceu. A consequência de engenharia é
-- que `expired` NUNCA tem `provider_ref`, e o teste escreve isso como asserção.
--
-- ⚠️ QUEM PEDIU CONFIRMA, COM PRAZO, e o prazo vencido libera sozinho. Isso
-- fecha as DUAS fraudes simétricas: quem entrega e some com o dinheiro (não
-- recebe sem entregar), e quem recebe a encomenda e nunca confirma para não
-- pagar (o prazo libera o repasse sem depender da boa vontade dele).
--
-- ─── SEM HOLDBACK AQUI, E ISTO NÃO É ESQUECIMENTO ───────────────────────────
--
-- A Loja segura 8 dias (`tb_booking_payout`, `tb_clan_payout`) porque lá é
-- compra REMOTA de bem: o CDC dá 7 dias de arrependimento e o dinheiro precisa
-- estar disponível para voltar. Aqui é entrega EM MÃOS dentro do prédio,
-- confirmada explicitamente por quem pediu — não existe arrependimento de uma
-- corrida que já terminou. E o valor é pequeno: segurar R$1,01 por oito dias
-- mata a feature, porque ninguém carrega um sofá por dinheiro que chega na
-- semana que vem.
--
-- ⚠️ NÃO "CONSERTAR" ISTO DEPOIS achando que faltou holdback. O regime do
-- sub-projeto 3 (venda dentro da vitrine) é OUTRO e lá o holdback VOLTA.
--
-- ─── PREÇO É TABELA ADMIN-EDITÁVEL, NUNCA CONSTANTE ─────────────────────────
--
-- Lição já paga neste repo (mig 244): a taxa do agendamento era
-- `PLATFORM_FEE_CENTS = 1000` no código enquanto a TELA DE ADMIN escrevia em
-- `tb_booking_fee_settings` e ninguém lia — em produção havia 5% + R$2,50
-- configurados sem efeito nenhum. Tela morta é ruim; tela morta que MENTE é
-- pior, porque a pessoa decide preço olhando para ela.
--
-- Idempotente.
-- =============================================================================

-- ─── 1. A tabela de preços (admin-editável) ──────────────────────────────────
-- Uma linha por TIPO de corrida. Os quatro tipos e os preços são os do Alex:
-- comida R$3 · encomenda pequena R$4 · mudança R$50 · volumoso R$50.
--
-- `is_active = FALSE` é o kill-switch por tipo: some da lista de quem abre um
-- chamado, sem apagar o histórico de quem já correu naquele tipo.
CREATE TABLE IF NOT EXISTS public.tb_community_delivery_settings (
  kind          VARCHAR(24)  PRIMARY KEY,
  label         VARCHAR(80)  NOT NULL,
  price_cents   INT          NOT NULL CHECK (price_cents >= 0),
  -- Janela de vida do chamado ABERTO, em minutos.
  -- ⚠️ COMIDA EXPIRA EM 2h e o resto em 24h, e a diferença é o produto: comida
  -- é perecível e o chamado perde o sentido — um "busca meu lanche na portaria"
  -- aceito seis horas depois entrega comida fria. Expirar não custa nada,
  -- porque não houve cobrança.
  expires_minutes INT        NOT NULL DEFAULT 1440 CHECK (expires_minutes > 0),
  -- Prazo que quem PEDIU tem para confirmar depois de o entregador marcar
  -- "entreguei". Vencido, o repasse é liberado sozinho.
  confirm_hours INT          NOT NULL DEFAULT 24 CHECK (confirm_hours > 0),
  sort_order    INT          NOT NULL DEFAULT 0,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_by    UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);

-- Seed fill-if-absent: re-rodar NÃO desfaz o preço que o admin escolheu na
-- tela. É a mesma regra do seed da Loja de Funções (mig 195) — semear com
-- UPDATE faria o próximo deploy ressuscitar o valor de fábrica.
INSERT INTO public.tb_community_delivery_settings
  (kind, label, price_cents, expires_minutes, confirm_hours, sort_order)
VALUES
  ('food',      'Comida',                        300,  120, 24, 1),
  ('parcel',    'Encomenda pequena',             400, 1440, 24, 2),
  ('moving',    'Ajudar com mudança',           5000, 1440, 48, 3),
  ('bulky',     'Móveis e eletrodomésticos',    5000, 1440, 48, 4)
ON CONFLICT (kind) DO NOTHING;

-- ─── 2. O chamado ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tb_community_delivery_request (
  id_delivery   BIGSERIAL    PRIMARY KEY,
  -- A comunidade territorial (condomínio OU bairro). É `tb_profile` porque
  -- comunidade é perfil desde sempre.
  id_community  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_requester  UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  -- ⚠️ SEM FK PARA tb_community_delivery_settings, de propósito: desativar um
  -- tipo na tela de admin não pode apagar (nem travar) as corridas que já
  -- aconteceram naquele tipo. O CHECK abaixo é a lista fechada de verdade.
  kind          VARCHAR(24)  NOT NULL
                  CHECK (kind IN ('food', 'parcel', 'moving', 'bulky')),

  -- O PREÇO É CONGELADO NA ABERTURA (snapshot). Mexer na tabela de preços não
  -- pode mudar o valor de um chamado que já está no ar — quem aceitou leu um
  -- número e é esse que vale.
  price_cents   INT          NOT NULL CHECK (price_cents >= 0),

  note          VARCHAR(500) NULL,
  pickup        VARCHAR(160) NULL,
  dropoff       VARCHAR(160) NULL,

  status        VARCHAR(16)  NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'accepted', 'delivered', 'completed',
                                    'canceled', 'expired')),

  id_courier    UUID         NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,

  -- ── dinheiro ──────────────────────────────────────────────────────────────
  -- A cobrança nasce no ACEITE. Enquanto o chamado está `open` os três campos
  -- abaixo são NULL — e é assim que se prova que chamado expirado não cobrou
  -- ninguém.
  payment_provider  VARCHAR(16) NULL
                      CHECK (payment_provider IS NULL
                             OR payment_provider IN ('stripe', 'asaas')),
  session_id        TEXT        NULL,
  provider_ref      TEXT        NULL,
  -- ⚠️ A URL DO CHECKOUT PRECISA SER GUARDADA, e o motivo é quem paga:
  -- a cobrança nasce quando o ENTREGADOR aceita, mas quem paga é quem PEDIU —
  -- e essa pessoa não está na tela naquele instante. Sem guardar o link, ele
  -- existiria só na resposta de um clique que outra pessoa deu, e o pedinte
  -- não teria por onde pagar a corrida que já aceitaram para ele.
  --
  -- Some junto com o resto quando o chamado é devolvido: link de checkout de
  -- uma corrida que voltou para a fila levaria a pessoa a pagar por uma
  -- entrega que ninguém está fazendo.
  checkout_url      TEXT        NULL,
  payment_status    VARCHAR(16) NOT NULL DEFAULT 'none'
                      CHECK (payment_status IN ('none', 'pending', 'paid',
                                                'refunded', 'canceled')),

  -- Tarifa do gateway. Nasce ESTIMADA e é substituída pela apurada na
  -- confirmação do pagamento.
  -- ⚠️ `processor_fee_source` existe para se descobrir DEPOIS quais repasses
  -- saíram no palpite: `fallback` = estimativa, `gateway` = número apurado.
  -- Não apurar NÃO é tarifa zero (ver o service).
  processor_fee_cents  INT       NOT NULL DEFAULT 0 CHECK (processor_fee_cents >= 0),
  processor_fee_source VARCHAR(12) NOT NULL DEFAULT 'none'
                         CHECK (processor_fee_source IN ('none', 'fallback', 'gateway')),
  -- O que sobra para quem entrega. NUNCA negativo (ver o CHECK): numa corrida
  -- de R$3 com tarifa de R$1,99 o líquido chega perto de zero, e um número
  -- negativo viraria DÉBITO na carteira de quem trabalhou.
  courier_cents INT          NOT NULL DEFAULT 0 CHECK (courier_cents >= 0),

  -- ── carimbos ──────────────────────────────────────────────────────────────
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ  NOT NULL,
  accepted_at   TIMESTAMPTZ  NULL,
  delivered_at  TIMESTAMPTZ  NULL,
  -- Quando o repasse se libera sozinho, se ninguém confirmar. Só existe depois
  -- de `delivered`.
  confirm_due_at TIMESTAMPTZ NULL,
  completed_at  TIMESTAMPTZ  NULL,
  canceled_at   TIMESTAMPTZ  NULL,
  cancel_reason VARCHAR(24)  NULL
                  CHECK (cancel_reason IS NULL
                         OR cancel_reason IN ('courier', 'requester', 'expired', 'admin')),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- O quadro de chamados abertos da comunidade: é a leitura mais quente da
-- feature (todo morador que abre a aba faz esta consulta).
CREATE INDEX IF NOT EXISTS idx_delivery_board
  ON public.tb_community_delivery_request (id_community, created_at DESC)
  WHERE status = 'open';

-- O sweeper de expiração varre só o que ainda está aberto.
CREATE INDEX IF NOT EXISTS idx_delivery_expiring
  ON public.tb_community_delivery_request (expires_at)
  WHERE status = 'open';

-- O sweeper de liberação varre só o que foi entregue e não confirmado.
CREATE INDEX IF NOT EXISTS idx_delivery_confirm_due
  ON public.tb_community_delivery_request (confirm_due_at)
  WHERE status = 'delivered';

CREATE INDEX IF NOT EXISTS idx_delivery_requester
  ON public.tb_community_delivery_request (id_requester, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_courier
  ON public.tb_community_delivery_request (id_courier, created_at DESC)
  WHERE id_courier IS NOT NULL;

-- Idempotência do webhook: mesma convenção das outras compras do projeto.
CREATE UNIQUE INDEX IF NOT EXISTS ux_delivery_session
  ON public.tb_community_delivery_request (session_id)
  WHERE session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_provider_ref
  ON public.tb_community_delivery_request (provider_ref)
  WHERE provider_ref IS NOT NULL;

-- ─── 3. O repasse (espelha tb_booking_payout) ────────────────────────────────
-- Formato deliberadamente igual ao do agendamento: é o padrão já estabelecido
-- de "dinheiro que virou saldo de alguém", com os mesmos quatro estados
-- (aguardando → aprovado → pago; revertido sai da conta).
--
-- ⚠️ AQUI `available_at` NASCE NO PASSADO (= agora): sem holdback, confirmar é
-- liberar. A coluna existe assim mesmo para o repasse caber no mesmo
-- vocabulário do resto da carteira — e para o dia em que alguém quiser segurar
-- um tipo específico (uma mudança de R$50 talvez mereça), sem migration nova.
CREATE TABLE IF NOT EXISTS public.tb_community_delivery_payout (
  id_payout     BIGSERIAL    PRIMARY KEY,
  id_delivery   BIGINT       NOT NULL UNIQUE
                  REFERENCES public.tb_community_delivery_request(id_delivery) ON DELETE CASCADE,
  id_community  UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_courier    UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind          VARCHAR(24)  NOT NULL,
  charge_cents  INT          NOT NULL CHECK (charge_cents >= 0),
  processor_fee_cents INT    NOT NULL DEFAULT 0 CHECK (processor_fee_cents >= 0),
  net_cents     INT          NOT NULL CHECK (net_cents >= 0),
  status        VARCHAR(12)  NOT NULL DEFAULT 'aprovado'
                  CHECK (status IN ('aguardando', 'aprovado', 'pago', 'revertido')),
  available_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  approved_at   TIMESTAMPTZ  NULL,
  paid_out_at   TIMESTAMPTZ  NULL,
  paid_out_note TEXT         NULL,
  reverted_at   TIMESTAMPTZ  NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_payout_courier
  ON public.tb_community_delivery_payout (id_courier, created_at DESC);

-- ─── 4. O freio do cancelamento ──────────────────────────────────────────────
-- O entregador pode cancelar a qualquer momento (decisão do Alex) e o dinheiro
-- volta INTEIRO para quem pagou — a plataforma come a tarifa do gateway.
--
-- ⚠️ Isso precisa de freio ou vira torneira: aceitar e cancelar em série custa
-- uma tarifa por vez à plataforma e deixa quem pediu esperando alguém que nunca
-- vem. Três cancelamentos em sete dias bloqueiam ACEITAR por 24h.
--
-- ⚠️ CONTADO EM COLUNA PRÓPRIA, não derivado da tabela de chamados: o cancelado
-- é reaberto (volta a `open` para outra pessoa pegar) e perde o vínculo com
-- quem desistiu, então a contagem por varredura devolveria zero justo para quem
-- mais cancela.
CREATE TABLE IF NOT EXISTS public.tb_community_delivery_strike (
  id_strike    BIGSERIAL   PRIMARY KEY,
  id_user      UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_community UUID        NULL REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  id_delivery  BIGINT      NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_strike_user
  ON public.tb_community_delivery_strike (id_user, created_at DESC);

-- ─── 5. "Disponível agora" ───────────────────────────────────────────────────
-- O Alex pediu "um botão chamado me chame" E disse "qualquer um da comunidade
-- pode ir receber". As duas coisas convivem: QUALQUER MEMBRO ACEITA um chamado
-- — não existe papel promovido —, e quem quiser liga este toggle para RECEBER
-- NOTIFICAÇÃO quando um chamado abrir.
--
-- ⚠️ É DISPONIBILIDADE, NÃO PAPEL. Não construir `tb_*_courier` no molde de
-- `tb_academy_professor`: ninguém precisa ser promovido para entregar, e um
-- papel aqui criaria a fila de aprovação que a decisão do Alex removeu.
CREATE TABLE IF NOT EXISTS public.tb_community_delivery_availability (
  id_community UUID        NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_user      UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  is_available BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_community, id_user)
);

CREATE INDEX IF NOT EXISTS idx_delivery_available
  ON public.tb_community_delivery_availability (id_community)
  WHERE is_available = TRUE;

-- ─── 6. Notificações ─────────────────────────────────────────────────────────
-- ⚠️ SUPERSET COM O MESMO NOME DE CONSTRAINT (regra das migs 153/197/206/244/246).
-- A lista INTEIRA de novo, com os valores novos no fim. Nome diferente deixaria
-- a constraint antiga de pé EM PARALELO, e ela recusaria exatamente os valores
-- que a nova passou a permitir — o primeiro INSERT falhando em produção por uma
-- constraint que ninguém lembra de procurar.
ALTER TABLE public.tb_notification
  DROP CONSTRAINT IF EXISTS tb_notification_type_chk;

ALTER TABLE public.tb_notification
  ADD CONSTRAINT tb_notification_type_chk
  CHECK (type IN (
    -- social (057)
    'like_received',
    'comment_received',
    'follow_received',
    'message_received',
    -- supervisão (062)
    'supervised_message_received',
    'parental_permission_request',
    -- pedidos de produto (071)
    'product_request_new',
    'product_response_new',
    -- comercial (152)
    'product_sale',
    'course_sale',
    'booking_received',
    'service_response_received',
    'chamado_match',
    'affiliate_commission_released',
    'subscription_expiring',
    'premium_expiring',
    'manifestation_expiring',
    'live_started',
    'clan_invite',
    'clan_member_joined',
    'live_gift_received',
    -- condomínio (197)
    'condo_claim_pending',
    'condo_claim_resolved',
    'condo_notice_received',
    'condo_poll_opened',
    -- residência (203/204)
    'residence_claim_pending',
    'residence_recognized',
    'residence_contested',
    'residence_proof_requested',
    'residence_ended',
    -- disputa (206)
    'condo_family_request',
    'condo_dispute_opened',
    'condo_dispute_decided',
    'condo_proof_submitted',
    -- WhatsApp oficial (246) — W6
    'whatsapp_quality_alert',
    -- delivery entre vizinhos (248)
    'delivery_opened',
    'delivery_accepted',
    'delivery_delivered',
    'delivery_confirmed',
    'delivery_canceled'
  )) NOT VALID;

-- ─── 7. Feature flag (Painel de Controle) ────────────────────────────────────
-- Nasce LIGADA, como `condominio` e `atendimento_api`: o Painel serve para
-- DESLIGAR se algo der errado, não para ter que lembrar de ligar depois do
-- deploy.
INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'delivery_vizinho',
  'Delivery entre vizinhos',
  'Chamados de entrega dentro do condomínio e do bairro: qualquer morador abre um chamado pago (comida, encomenda, mudança, volumoso) e qualquer vizinho aceita e recebe. Cobra-se no aceite; chamado que ninguém pega expira sem custo. Desligar esconde a aba e impede abrir chamados novos — os que já estão no ar continuam podendo ser concluídos.'
)
ON CONFLICT (flag_key) DO NOTHING;
