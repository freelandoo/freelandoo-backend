-- 268_verified_badge.sql
--
-- O SELO VERIFICADO — R$9,90 por mês.
--
-- Decisão do Alex (2026-09-28): "selo de verificado vamos criar, 9,90 por mês.
-- O nosso selo brilha como as fotos de perfis de vídeos virais. E já coloque o
-- selo nos admins."
--
-- ─── O SELO É DA PESSOA, NÃO DO PERFIL ─────────────────────────────────────
-- Quem se verifica é quem está por trás da conta (1 CPF = 1 conta, mig 188).
-- Pendurar o selo no perfil faria quem tem dois perfis pagar duas vezes pela
-- mesma pessoa. Todo perfil da conta mostra o selo; clan e comunidade não
-- (são coletivos — o selo diria que o GRUPO foi verificado).
--
-- ─── VIGÊNCIA LAZY, SEM SWEEPER ─────────────────────────────────────────────
-- "Verificado" = `paid_until > NOW()` OU ser administrador da plataforma. É
-- lido no SELECT (`utils/verifiedBadge.js`), como o anúncio mensal da mig 252:
-- um job que tirasse o selo seria uma segunda verdade sobre a mesma data.
--
-- ─── ADMIN TEM O SELO SEM PAGAR, E SEM LINHA AQUI ───────────────────────────
-- O selo do admin sai do PAPEL (tb_user_role 'Administrator'), não de uma linha
-- gravada nesta tabela: gravar deixaria o selo de pé no dia em que a pessoa
-- deixasse de ser admin.
--
-- ─── DOIS REGIMES, COMO A VITRINE (mig 252) ─────────────────────────────────
-- Cartão = assinatura (preapproval), renova sozinha e cada fatura empurra
-- `paid_until`. Pix = UM mês, sem assinatura (`subscription_ref` NULL).

-- 1. A régua (admin-editável; nunca constante no service — lição da mig 244).
CREATE TABLE IF NOT EXISTS public.tb_verification_settings (
  id            INT         PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  monthly_cents INT         NOT NULL DEFAULT 990 CHECK (monthly_cents >= 0),
  is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL
);
INSERT INTO public.tb_verification_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- 2. O estado do selo de cada pessoa. Uma linha por conta.
CREATE TABLE IF NOT EXISTS public.tb_user_verification (
  id_user               UUID        PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  paid_until            TIMESTAMPTZ NULL,
  subscription_ref      TEXT        NULL,
  subscription_provider VARCHAR(16) NULL,
  subscription_status   VARCHAR(16) NULL
                          CHECK (subscription_status IS NULL
                                 OR subscription_status IN ('active', 'past_due', 'canceled')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A renovação chega como fatura e é por aqui que ela acha a pessoa.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_verification_sub
  ON public.tb_user_verification (subscription_ref)
  WHERE subscription_ref IS NOT NULL;

-- 3. As cobranças (primeiro mês, Pix, cada renovação).
CREATE TABLE IF NOT EXISTS public.tb_user_verification_payment (
  id_payment        BIGSERIAL   PRIMARY KEY,
  id_user           UUID        NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  method            VARCHAR(8)  NOT NULL CHECK (method IN ('card', 'pix', 'renewal')),
  payment_provider  VARCHAR(16) NULL,
  amount_cents      INT         NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  status            VARCHAR(12) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'canceled', 'refunded')),
  stripe_session_id TEXT        NULL,
  payment_intent_id TEXT        NULL,
  invoice_ref       TEXT        NULL,
  period_start      TIMESTAMPTZ NULL,
  period_end        TIMESTAMPTZ NULL,
  paid_at           TIMESTAMPTZ NULL,
  refunded_at       TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotência do webhook (at-least-once): a mesma sessão não confirma duas
-- vezes e a mesma fatura não empurra o selo dois meses.
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_verification_payment_session
  ON public.tb_user_verification_payment (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_verification_payment_invoice
  ON public.tb_user_verification_payment (invoice_ref)
  WHERE invoice_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_verification_payment_pi
  ON public.tb_user_verification_payment (payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_user_verification_payment_user
  ON public.tb_user_verification_payment (id_user, created_at DESC);

-- 4. Kill-switch de VENDA. Nasce ligado; desligar para de vender, nunca tira o
-- selo de quem já pagou.
INSERT INTO public.tb_feature_flag (flag_key, is_enabled, label, description)
VALUES (
  'selo_verificado', TRUE, 'Selo verificado',
  'Venda do selo verificado (R$9,90/mês). Desligar para de vender; quem já pagou mantém o selo até o fim do período.'
)
ON CONFLICT (flag_key) DO NOTHING;
