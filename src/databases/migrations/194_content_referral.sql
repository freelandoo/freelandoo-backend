-- =============================================================================
-- Migration 194 — Cupom de conteúdo (atribuição por item compartilhado)
-- =============================================================================
-- Slice C1 do desenho em docs/superpowers/specs/2026-08-05-afiliado-vitalicio-design.md
--
-- Regime USUÁRIO (produto / curso / serviço): quem compartilha o conteúdo de
-- outro leva a comissão, e o cupom daquele link **sobrepõe o vínculo**.
--
-- Hoje isso vive num sessionStorage que morre ao fechar a aba. Aqui a
-- atribuição passa a ser persistente por (visitante × item): não expira, e o
-- último toque vence.
--
-- Anônimo entra por visitor_token (localStorage) e é casado com a conta no
-- login — sem isso, quem clica deslogado, cria conta e compra depois some da
-- atribuição, que é exatamente o furo atual.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_content_referral (
  id_attribution  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user_visitor UUID REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  visitor_token   VARCHAR(64),
  item_type       VARCHAR(24) NOT NULL,
  item_id         VARCHAR(64) NOT NULL,
  id_coupon       UUID NOT NULL REFERENCES public.tb_coupon(id_coupon),
  id_affiliate    UUID NOT NULL REFERENCES public.tb_affiliate(id_affiliate),
  first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_content_referral_type_chk
    CHECK (item_type IN ('product', 'course', 'service')),
  CONSTRAINT tb_content_referral_who_chk
    CHECK (id_user_visitor IS NOT NULL OR visitor_token IS NOT NULL)
);

-- Último toque vence: o UPSERT precisa de um alvo único por visitante+item.
CREATE UNIQUE INDEX IF NOT EXISTS ux_content_referral_user
  ON public.tb_content_referral (id_user_visitor, item_type, item_id)
  WHERE id_user_visitor IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_content_referral_anon
  ON public.tb_content_referral (visitor_token, item_type, item_id)
  WHERE id_user_visitor IS NULL;

CREATE INDEX IF NOT EXISTS ix_content_referral_token
  ON public.tb_content_referral (visitor_token)
  WHERE id_user_visitor IS NULL;

COMMENT ON TABLE public.tb_content_referral IS
  'Atribuição por conteúdo compartilhado (regime usuário). Não expira; último toque vence. Sobrepõe o vínculo vitalício.';
COMMENT ON COLUMN public.tb_content_referral.visitor_token IS
  'Visitante anônimo (localStorage). Migrado para id_user_visitor no login.';
