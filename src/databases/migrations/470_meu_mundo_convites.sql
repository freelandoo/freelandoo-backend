-- 470 — Meu Mundo: CONVITES com o cupom da conta (gacha-v1, 24/11/2026). Decisões do Alex em
-- MEU MUNDO 3D/planos/2026-11-24-gachas-fragmentos-proposta.md:
--   • novo membro = conta que entra no Meu Mundo pela 1ª vez com o cupom de alguém;
--   • ativado (15 min ativos em recibos do jogo em até 14 dias), quem convidou ESCOLHE 10 fragmentos de um
--     personagem jogável; não repete na rodada; depois dos 12 a lista recomeça.
-- Registro PRÓPRIO do jogo: NÃO cria nem mexe no vínculo financeiro de afiliado (tb_referral / compra de Gold).
--
--  • id_invitee é a chave: um convidado tem UM convidador, para sempre (o primeiro vínculo válido vence).
--  • status: waiting (vinculado, ainda não ativou) → pending (ativou; prêmio esperando a escolha) → delivered;
--    capped (ativou além do teto de 30 a cada 30 dias: registrado, sem prêmio); expired (não ativou em 14 dias).
--  • reward: { character, item, qty } escolhido; o recibo (source 'invite_reward', action_key = id_invitee)
--    garante um crédito só, mesmo com várias abas.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.tb_mm_invite (
  id_invitee UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  id_inviter UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'waiting',
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  activated_at TIMESTAMPTZ NULL,
  delivered_at TIMESTAMPTZ NULL,
  reward JSONB NULL
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_invite_self') THEN
    ALTER TABLE public.tb_mm_invite ADD CONSTRAINT chk_mm_invite_self CHECK (id_invitee <> id_inviter);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_invite_status') THEN
    ALTER TABLE public.tb_mm_invite ADD CONSTRAINT chk_mm_invite_status CHECK (status IN ('waiting', 'pending', 'delivered', 'capped', 'expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_mm_invite_inviter ON public.tb_mm_invite (id_inviter, status, claimed_at DESC);
