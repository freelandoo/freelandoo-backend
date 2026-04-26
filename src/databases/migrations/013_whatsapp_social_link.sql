-- =============================================================================
-- Migration 013: WhatsApp como rede social com link automático
-- =============================================================================

-- Coluna para guardar o número normalizado (somente dígitos, com country code)
ALTER TABLE public.tb_profile_social_media
  ADD COLUMN IF NOT EXISTS phone_number_normalized VARCHAR(20);

-- Tipo "WhatsApp"
INSERT INTO public.tb_social_media_type (desc_social_media_type, url, icon)
VALUES ('WhatsApp', 'https://wa.me/', 'whatsapp')
ON CONFLICT (desc_social_media_type) DO UPDATE
  SET icon = EXCLUDED.icon,
      url = EXCLUDED.url,
      is_active = TRUE;
