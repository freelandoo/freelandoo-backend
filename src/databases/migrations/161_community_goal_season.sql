-- =============================================================================
-- Migration 161: Meta da Comunidade vira TEMPORADA com ranking + prêmio
-- A meta passa a ter prazo (mín. 30 dias, validado no app), prêmio em poléns
-- (bancado pela plataforma) e um vencedor (#1 do ranking da métrica na janela).
-- Métricas: 'xp' (delta por membro), 'posts' (posts+engajamento no feed da
-- comunidade) e 'shares' (retornos via link de share — Slice 2).
-- Idempotente.
-- =============================================================================

BEGIN;

-- ── Extensão da meta ────────────────────────────────────────────────────────
ALTER TABLE public.tb_community_goal
  ADD COLUMN IF NOT EXISTS starts_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS prize_polens   INT         NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS status         VARCHAR(12) NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS winner_user_id UUID        NULL REFERENCES public.tb_user(id_user) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS closed_at      TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS prize_paid     BOOLEAN     NOT NULL DEFAULT FALSE;

-- target_value agora é opcional (a temporada vale pelo ranking + prazo).
ALTER TABLE public.tb_community_goal
  ALTER COLUMN target_value DROP NOT NULL;

-- ── Baseline de XP por membro (para a métrica 'xp', delta na janela) ─────────
CREATE TABLE IF NOT EXISTS public.tb_community_goal_member (
  id_goal      BIGINT  NOT NULL REFERENCES public.tb_community_goal(id) ON DELETE CASCADE,
  id_user      UUID    NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  baseline_xp  NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (id_goal, id_user)
);

-- ── Retornos via link de share (Slice 2 popula; só membro pontua) ───────────
CREATE TABLE IF NOT EXISTS public.tb_community_share_return (
  id                   BIGSERIAL    PRIMARY KEY,
  id_community_profile UUID         NOT NULL REFERENCES public.tb_profile(id_profile) ON DELETE CASCADE,
  id_member_user       UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_portfolio_item    UUID         NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE SET NULL,
  visitor_hash         TEXT         NOT NULL,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Dedupe anti-spam: 1 ponto por (comunidade, membro, post, visitante).
CREATE UNIQUE INDEX IF NOT EXISTS ux_community_share_return
  ON public.tb_community_share_return (id_community_profile, id_member_user, id_portfolio_item, visitor_hash);

CREATE INDEX IF NOT EXISTS idx_community_share_return_window
  ON public.tb_community_share_return (id_community_profile, id_member_user, created_at);

-- ── Tipo de transação de polén para o prêmio da temporada ───────────────────
ALTER TABLE public.polen_transactions
  DROP CONSTRAINT IF EXISTS polen_transactions_type_chk;

ALTER TABLE public.polen_transactions
  ADD CONSTRAINT polen_transactions_type_chk CHECK (
    type IN (
      'earn_rewarded_ad', 'earn_purchase_stripe', 'earn_level_up', 'earn_live_gift',
      'earn_community_goal',
      'spend_profile_activation', 'spend_premium_highlight', 'spend_profile_boost',
      'spend_post_boost', 'spend_clan_highlight', 'spend_manifestation', 'spend_premium',
      'spend_live_gift', 'admin_adjustment', 'refund', 'reversal'
    )
  );

COMMIT;
