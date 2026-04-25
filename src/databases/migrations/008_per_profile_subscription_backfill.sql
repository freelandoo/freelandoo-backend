-- =============================================================================
-- Migration 008: backfill fee_paid de tb_user_status para tb_profile_status
-- =============================================================================
-- A nova lógica de pagamento é por perfil. Este backfill copia o status
-- fee_paid (se existir em tb_user_status) para o perfil mais recente do
-- usuário em tb_profile_status. Usuários sem perfil ficam logados na tabela
-- de pendências para revisão manual.
-- Nota: tb_status.id_status na produção é UUID.

CREATE TABLE IF NOT EXISTS public.tb_subscription_backfill_log (
  id            BIGSERIAL PRIMARY KEY,
  id_user       UUID NOT NULL,
  id_profile    UUID,
  source        TEXT NOT NULL,
  action        TEXT NOT NULL,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $bf$
DECLARE
  v_fee_paid_id INTEGER;
  v RECORD;
  v_target_profile UUID;
BEGIN
  SELECT id_status INTO v_fee_paid_id
  FROM public.tb_status WHERE desc_status = 'fee_paid' LIMIT 1;

  IF v_fee_paid_id IS NULL THEN
    RAISE NOTICE '008: status fee_paid ainda não existe — migration 007 não rodou?';
    RETURN;
  END IF;

  FOR v IN
    SELECT us.id_user
    FROM public.tb_user_status us
    WHERE us.id_status = v_fee_paid_id
      AND NOT EXISTS (
        SELECT 1 FROM public.tb_subscription_backfill_log bl
        WHERE bl.id_user = us.id_user AND bl.action IN ('migrated','pending_review')
      )
  LOOP
    SELECT id_profile INTO v_target_profile
    FROM public.tb_profile
    WHERE id_user = v.id_user
      AND is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_target_profile IS NULL THEN
      INSERT INTO public.tb_subscription_backfill_log
        (id_user, id_profile, source, action, notes)
      VALUES
        (v.id_user, NULL, 'tb_user_status', 'pending_review',
         'usuário tinha fee_paid em tb_user_status mas não tem perfil ativo');
      CONTINUE;
    END IF;

    INSERT INTO public.tb_profile_status (id_profile, id_status, created_by)
    VALUES (v_target_profile, v_fee_paid_id, v.id_user)
    ON CONFLICT (id_profile, id_status) DO NOTHING;

    INSERT INTO public.tb_subscription_backfill_log
      (id_user, id_profile, source, action, notes)
    VALUES
      (v.id_user, v_target_profile, 'tb_user_status', 'migrated',
       'fee_paid copiado de tb_user_status para tb_profile_status no perfil mais recente');
  END LOOP;
END
$bf$;
