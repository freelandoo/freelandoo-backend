-- =============================================================================
-- Migration 190: agenda COMPARTILHADA por conta
-- Regras semanais e exceções por data (mig 010) eram por perfil, e o check de
-- conflito filtrava `id_profile = $1` — então dois perfis do MESMO dono podiam
-- vender a mesma quinta 14h. Uma pessoa tem um corpo e uma hora só.
-- A partir daqui a agenda mora no PERFIL-CONTA (is_user_account) e a ocupação
-- é calculada sobre todos os perfis do dono; o booking continua guardando o
-- perfil de ORIGEM, pra tela dizer "agendado pelo perfil X".
-- Clan fica de fora: é entidade coletiva, não o corpo do líder.
--
-- Esta migration só CONSOLIDA o que já existe no perfil-conta. As linhas dos
-- subperfis NÃO são apagadas: viram inertes (ninguém mais lê) e ficam como
-- histórico — apagar disponibilidade configurada pelo usuário, sem volta, é
-- pior que deixar linha morta legível. Idempotente.
-- =============================================================================

-- ─── 1. Regras semanais → perfil-conta ───────────────────────────────────────
-- Só preenche dia da semana que o perfil-conta ainda NÃO tem (o que já está
-- configurado nele vence). Entre subperfis concorrentes, vence o mais recente.
INSERT INTO public.tb_profile_availability_rules
  (id_profile, weekday, is_enabled, start_time, end_time, slot_duration_minutes, buffer_minutes)
SELECT DISTINCT ON (acc.id_profile, src.weekday)
       acc.id_profile, src.weekday, src.is_enabled, src.start_time, src.end_time,
       src.slot_duration_minutes, src.buffer_minutes
  FROM public.tb_profile_availability_rules src
  JOIN public.tb_profile sp  ON sp.id_profile = src.id_profile
  JOIN public.tb_profile acc ON acc.id_user = sp.id_user
                            AND COALESCE(acc.is_user_account, FALSE) = TRUE
 WHERE COALESCE(sp.is_clan, FALSE) = FALSE
   AND COALESCE(sp.is_user_account, FALSE) = FALSE
   AND NOT EXISTS (
     SELECT 1 FROM public.tb_profile_availability_rules dst
      WHERE dst.id_profile = acc.id_profile AND dst.weekday = src.weekday
   )
 ORDER BY acc.id_profile, src.weekday, src.updated_at DESC
ON CONFLICT (id_profile, weekday) DO NOTHING;

-- ─── 2. Exceções por data → perfil-conta ─────────────────────────────────────
INSERT INTO public.tb_profile_availability_overrides
  (id_profile, override_date, is_day_blocked, custom_start_time, custom_end_time,
   extra_slots_json, blocked_slots_json, note)
SELECT DISTINCT ON (acc.id_profile, src.override_date)
       acc.id_profile, src.override_date, src.is_day_blocked, src.custom_start_time,
       src.custom_end_time, src.extra_slots_json, src.blocked_slots_json, src.note
  FROM public.tb_profile_availability_overrides src
  JOIN public.tb_profile sp  ON sp.id_profile = src.id_profile
  JOIN public.tb_profile acc ON acc.id_user = sp.id_user
                            AND COALESCE(acc.is_user_account, FALSE) = TRUE
 WHERE COALESCE(sp.is_clan, FALSE) = FALSE
   AND COALESCE(sp.is_user_account, FALSE) = FALSE
   AND src.override_date >= CURRENT_DATE
   AND NOT EXISTS (
     SELECT 1 FROM public.tb_profile_availability_overrides dst
      WHERE dst.id_profile = acc.id_profile AND dst.override_date = src.override_date
   )
 ORDER BY acc.id_profile, src.override_date, src.updated_at DESC
ON CONFLICT (id_profile, override_date) DO NOTHING;

-- ─── 3. Índice do escopo de ocupação ─────────────────────────────────────────
-- O conflito passou a varrer vários perfis por data (id_profile = ANY(...)).
CREATE INDEX IF NOT EXISTS idx_profile_bookings_profile_date
  ON public.tb_profile_bookings (id_profile, booking_date)
  WHERE status NOT IN ('canceled','expired');
