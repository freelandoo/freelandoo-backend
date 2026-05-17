-- =============================================================================
-- Migration 078: Conversation groups (até 200 membros)
-- =============================================================================
-- Estende tb_conversation pra suportar grupos com N participantes (1..MAX_MEMBERS).
--
-- Decisões:
--   - Mesma tabela tb_conversation; coluna kind discrimina 'direct' vs 'group'.
--   - Grupos têm name + cover_url + owner_profile_id; sem entity_a/b lógicos
--     (os campos ficam nullable; só importam pra direct).
--   - Membros usam a tabela existente tb_conversation_participant (1 row por
--     membro). Já tem unread_count + last_read_at por participante.
--   - Mensagens reusam tb_message (sender_entity_id é o subperfil que enviou).
--   - max_members default = 200; soft cap aplicado em service.
--
-- Para preservar a integridade das conversas 1-a-1 já existentes:
--   - CHECK canonical_order e no_self continuam, mas agora condicionais a
--     kind='direct' (NÃO se aplicam quando kind='group').
--   - entity_a/b passam a permitir NULL pra rows kind='group'.
-- =============================================================================

BEGIN;

-- ─── Permite NULL em entity_a/b ────────────────────────────────────────────
ALTER TABLE public.tb_conversation
  ALTER COLUMN entity_a_id DROP NOT NULL,
  ALTER COLUMN entity_b_id DROP NOT NULL,
  ALTER COLUMN entity_a_type DROP NOT NULL,
  ALTER COLUMN entity_b_type DROP NOT NULL;

-- ─── Novas colunas de grupo ────────────────────────────────────────────────
ALTER TABLE public.tb_conversation
  ADD COLUMN IF NOT EXISTS kind              VARCHAR(16) NOT NULL DEFAULT 'direct',
  ADD COLUMN IF NOT EXISTS name              VARCHAR(120),
  ADD COLUMN IF NOT EXISTS cover_url         TEXT,
  ADD COLUMN IF NOT EXISTS owner_profile_id  UUID REFERENCES public.tb_profile(id_profile) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS max_members       INT NOT NULL DEFAULT 200;

ALTER TABLE public.tb_conversation
  DROP CONSTRAINT IF EXISTS tb_conversation_kind_chk;
ALTER TABLE public.tb_conversation
  ADD CONSTRAINT tb_conversation_kind_chk
  CHECK (kind IN ('direct','group'));

-- ─── CHECKs condicionais por kind ──────────────────────────────────────────
-- O Postgres não tem partial CHECK constraints, então usamos expressões com
-- OR no próprio CHECK.

ALTER TABLE public.tb_conversation
  DROP CONSTRAINT IF EXISTS tb_conversation_no_self_chk;
ALTER TABLE public.tb_conversation
  ADD CONSTRAINT tb_conversation_no_self_chk
  CHECK (
    kind <> 'direct'
    OR (entity_a_id IS NOT NULL AND entity_b_id IS NOT NULL AND entity_a_id <> entity_b_id)
  );

ALTER TABLE public.tb_conversation
  DROP CONSTRAINT IF EXISTS tb_conversation_canonical_order_chk;
ALTER TABLE public.tb_conversation
  ADD CONSTRAINT tb_conversation_canonical_order_chk
  CHECK (
    kind <> 'direct'
    OR (entity_a_id IS NOT NULL AND entity_b_id IS NOT NULL AND entity_a_id < entity_b_id)
  );

-- Em grupos, name é obrigatório
ALTER TABLE public.tb_conversation
  DROP CONSTRAINT IF EXISTS tb_conversation_group_name_chk;
ALTER TABLE public.tb_conversation
  ADD CONSTRAINT tb_conversation_group_name_chk
  CHECK (kind <> 'group' OR (name IS NOT NULL AND char_length(name) >= 2));

-- ─── Índices ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_conversation_kind
  ON public.tb_conversation (kind)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversation_group_owner
  ON public.tb_conversation (owner_profile_id, last_message_at DESC NULLS LAST)
  WHERE kind = 'group' AND deleted_at IS NULL;

-- ─── Audit: papel do participante em grupo (owner/admin/member) ────────────
ALTER TABLE public.tb_conversation_participant
  ADD COLUMN IF NOT EXISTS role VARCHAR(16) NOT NULL DEFAULT 'member';

ALTER TABLE public.tb_conversation_participant
  DROP CONSTRAINT IF EXISTS tb_conv_part_role_chk;
ALTER TABLE public.tb_conversation_participant
  ADD CONSTRAINT tb_conv_part_role_chk
  CHECK (role IN ('owner','admin','member'));

COMMIT;
