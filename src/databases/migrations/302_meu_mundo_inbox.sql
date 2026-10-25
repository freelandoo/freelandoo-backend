-- 302 — MEU MUNDO 3D (mm3d-30): notificações, caixa de entrada, presentes e Poléns no jogo.
--
-- 1) tb_mm_mail: o CORREIO INTERNO do jogo (não é e-mail). Presentes,
--    comunicados oficiais, promoções e recibos de compra. Mensagens entre
--    pessoas NÃO moram aqui: a caixa lê as conversas existentes
--    (tb_conversation / tb_message) — um sistema só de mensagens.
--    Presente = `gift` (item do catálogo, skin ou moedas do jogo); resgatar
--    grava `claimed_at` UMA vez (UPDATE ... WHERE claimed_at IS NULL dentro
--    da transação da vida, que trava a pessoa) — clique duplo, outra aba ou
--    reconexão devolvem o resultado gravado.
-- 2) tb_mm_notice: o HISTÓRICO do sino. Toda notificação temporária do jogo
--    vira uma linha; sair da tela não marca como lida. `id_mail` liga a
--    notificação ao conteúdo da caixa (sem registro solto). `dedupe_key`
--    impede a mesma notificação duas vezes (webhook repetido, releitura).
-- 3) tb_mm_inbox_pref: preferência de promoções (comunicado oficial sempre chega).
-- 4) polen_transactions: tipo 'spend_meu_mundo' (produto do jogo pago em
--    Poléns). CHECK reescrito como SUPERSET com o mesmo nome + NOT VALID
--    (lição da mig 152). A carteira de Poléns continua sendo a da Freelandoo
--    (polen_wallets) — o jogo não tem carteira de Poléns própria.
-- 5) Corpo "female" no CHECK do avatar (skin "feminina").

CREATE TABLE IF NOT EXISTS public.tb_mm_mail (
  id BIGSERIAL PRIMARY KEY,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  gift JSONB NULL,
  claimed_at TIMESTAMPTZ NULL,
  claim_result JSONB NULL,
  dedupe_key TEXT NULL,
  created_by UUID NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_mm_mail_kind CHECK (kind IN ('gift', 'official', 'promo', 'receipt')),
  CONSTRAINT chk_mm_mail_title CHECK (char_length(title) BETWEEN 1 AND 120),
  CONSTRAINT chk_mm_mail_body CHECK (char_length(body) <= 2000),
  CONSTRAINT chk_mm_mail_gift CHECK ((kind = 'gift') = (gift IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ix_mm_mail_user ON public.tb_mm_mail (id_user, id DESC);
CREATE INDEX IF NOT EXISTS ix_mm_mail_unread ON public.tb_mm_mail (id_user) WHERE read_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_mail_dedupe ON public.tb_mm_mail (id_user, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tb_mm_notice (
  id BIGSERIAL PRIMARY KEY,
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  code TEXT NOT NULL,
  priority SMALLINT NOT NULL DEFAULT 3,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  id_mail BIGINT NULL REFERENCES public.tb_mm_mail(id) ON DELETE SET NULL,
  dedupe_key TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  read_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_mm_notice_kind CHECK (kind IN ('need', 'life', 'gift', 'official', 'promo', 'purchase')),
  CONSTRAINT chk_mm_notice_code CHECK (code ~ '^[a-z0-9_]{1,40}$'),
  CONSTRAINT chk_mm_notice_priority CHECK (priority BETWEEN 1 AND 5)
);

CREATE INDEX IF NOT EXISTS ix_mm_notice_user ON public.tb_mm_notice (id_user, id DESC);
CREATE INDEX IF NOT EXISTS ix_mm_notice_unread ON public.tb_mm_notice (id_user) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS ix_mm_notice_need ON public.tb_mm_notice (id_user, code, created_at DESC) WHERE kind = 'need';
CREATE UNIQUE INDEX IF NOT EXISTS ux_mm_notice_dedupe ON public.tb_mm_notice (id_user, dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.tb_mm_inbox_pref (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  promos BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5) Corpo "female" (a skin "feminina"): CHECK do corpo como superset, mesmo nome.
ALTER TABLE public.tb_mm_avatar_pref DROP CONSTRAINT IF EXISTS chk_mm_avatar_body;
ALTER TABLE public.tb_mm_avatar_pref
  ADD CONSTRAINT chk_mm_avatar_body CHECK (body IN ('normal', 'slim', 'fat', 'strong', 'sergio', 'female'));

ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad', 'earn_purchase_stripe', 'earn_level_up', 'earn_live_gift',
      'earn_community_goal',
      'spend_profile_activation', 'spend_premium_highlight', 'spend_profile_boost',
      'spend_post_boost', 'spend_clan_highlight', 'spend_manifestation', 'spend_premium',
      'spend_live_gift', 'spend_function_purchase', 'spend_condo_listing_slot',
      'spend_meu_mundo',
      'admin_adjustment', 'refund', 'reversal'
    )
  ) NOT VALID;
