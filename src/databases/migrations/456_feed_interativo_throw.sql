-- =============================================================================
-- Migration 456 — Feed Interativo F2: Throw (lançar post no feed de alguém)
-- =============================================================================
-- 1) tb_feed_throw_link: quem (sender) pode lançar conteúdo no feed de quem
--    (receiver). Nasce 'pending' (convite); só o RECEIVER aceita. Estados:
--      pending   convite aberto
--      active    aceito: o sender lança e o post cai no feed do receiver
--      silenced  aceito, mas o receiver silenciou: o envio é aceito e
--                descartado em silêncio (o sender não fica sabendo)
--      declined  receiver recusou o convite (o sender pode convidar de novo
--                depois de 7 dias)
--      revoked   receiver tirou a permissão (idem)
--      blocked   receiver bloqueou: nenhum convite novo deste sender
--    Uma linha por par (sender, receiver). O par inverso é outra linha.
-- 2) tb_feed_drop: a FILA ÚNICA do que cai no feed de alguém — throw (F2),
--    gift = baú (F3), capsule = cápsula do tempo (F4). Já nasce com os três
--    kinds e todos os estados (scheduled/canceled são da cápsula) para não
--    precisar trocar CHECK a cada fase.
--      scheduled  cápsula esperando a hora (deliver_at)
--      delivered  pronta para entrar no feed do receiver (inbox)
--      seen       entrou no feed (o cliente confirmou)
--      opened     baú aberto
--      muted      descartada em silêncio (link silenciado)
--      canceled   cápsula cancelada pelo sender antes da hora
--      failed     não deu para entregar (post sumiu/ficou privado na hora)
-- 3) tb_feed_fx_prefs: quem pode me CONVIDAR ('todos' | 'mutuos' | 'ninguem')
--    e se aceito baú.
-- 4) Flag 'feed_interativo' no Painel de Controle (fail-open, como as outras).
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_feed_throw_link (
  id_link       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_sender     UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_receiver   UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',
  invited_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at   TIMESTAMPTZ NULL,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT tb_feed_throw_link_pair_uq UNIQUE (id_sender, id_receiver),
  CONSTRAINT tb_feed_throw_link_not_self_chk CHECK (id_sender <> id_receiver)
);
ALTER TABLE public.tb_feed_throw_link DROP CONSTRAINT IF EXISTS tb_feed_throw_link_status_chk;
ALTER TABLE public.tb_feed_throw_link
  ADD CONSTRAINT tb_feed_throw_link_status_chk
  CHECK (status IN ('pending', 'active', 'silenced', 'declined', 'revoked', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_feed_throw_link_receiver
  ON public.tb_feed_throw_link (id_receiver, status);
CREATE INDEX IF NOT EXISTS idx_feed_throw_link_sender
  ON public.tb_feed_throw_link (id_sender, status);

CREATE TABLE IF NOT EXISTS public.tb_feed_drop (
  id_drop            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind               TEXT NOT NULL,
  id_sender          UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_receiver        UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_portfolio_item  UUID NULL REFERENCES public.tb_profile_portfolio_item(id_portfolio_item) ON DELETE SET NULL,
  -- Mensagem/figurinha/destino da cápsula — validado no service, nunca HTML.
  payload            JSONB NOT NULL DEFAULT '{}'::jsonb,
  status             TEXT NOT NULL DEFAULT 'delivered',
  deliver_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at       TIMESTAMPTZ NULL,
  seen_at            TIMESTAMPTZ NULL,
  opened_at          TIMESTAMPTZ NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Um lançamento para "todos" gera uma linha por receiver com o mesmo lote.
  id_batch           UUID NULL
);
ALTER TABLE public.tb_feed_drop DROP CONSTRAINT IF EXISTS tb_feed_drop_kind_chk;
ALTER TABLE public.tb_feed_drop
  ADD CONSTRAINT tb_feed_drop_kind_chk CHECK (kind IN ('throw', 'gift', 'capsule'));
ALTER TABLE public.tb_feed_drop DROP CONSTRAINT IF EXISTS tb_feed_drop_status_chk;
ALTER TABLE public.tb_feed_drop
  ADD CONSTRAINT tb_feed_drop_status_chk
  CHECK (status IN ('scheduled', 'delivered', 'seen', 'opened', 'muted', 'canceled', 'failed'));

-- Inbox do receiver (o que ainda não entrou no feed).
CREATE INDEX IF NOT EXISTS idx_feed_drop_inbox
  ON public.tb_feed_drop (id_receiver, created_at DESC)
  WHERE status = 'delivered';
-- Worker da cápsula.
CREATE INDEX IF NOT EXISTS idx_feed_drop_scheduled
  ON public.tb_feed_drop (deliver_at)
  WHERE status = 'scheduled';
-- Limites por remetente (janela de tempo).
CREATE INDEX IF NOT EXISTS idx_feed_drop_sender_recent
  ON public.tb_feed_drop (id_sender, kind, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tb_feed_fx_prefs (
  id_user        UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  invite_policy  TEXT NOT NULL DEFAULT 'todos',
  accept_gifts   BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.tb_feed_fx_prefs DROP CONSTRAINT IF EXISTS tb_feed_fx_prefs_policy_chk;
ALTER TABLE public.tb_feed_fx_prefs
  ADD CONSTRAINT tb_feed_fx_prefs_policy_chk CHECK (invite_policy IN ('todos', 'mutuos', 'ninguem'));

INSERT INTO public.tb_feature_flag (flag_key, label, description)
VALUES (
  'feed_interativo',
  'Feed Interativo',
  'Lançar post no feed de quem aceitou, baú, cápsula do tempo, Paths e feed sincronizado. Desligar fecha as rotas /feed-interativo (dados preservados).'
)
ON CONFLICT (flag_key) DO NOTHING;
