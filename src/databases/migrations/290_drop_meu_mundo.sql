-- 290 — RETIRADA DO MEU MUNDO (ex-Freelandoo Arena) da produção.
--
-- Decisão do Alex em 2026-10-18: o jogo sai inteiro da produção (serviço
-- arena-server, cliente no R2, rotas /arena e o botão do headcard). O repositório
-- freelandoo-arena continua só na máquina local dele.
--
-- Tabelas exclusivas do jogo, das migs 281, 282, 284–289. Nenhuma tabela fora
-- da família tb_arena_* tem FK para elas (conferido no catálogo de produção).
--
-- ⚠️ A mig 283 NÃO é do jogo e FICA: tb_user_block, tb_message_report e
-- tb_message.client_message_id valem para o site inteiro (/me/blocks,
-- /admin/message-reports e o envio idempotente de DM).
--
-- As migrations 281–289 FICAM no repositório: o runner confere checksum e
-- re-executa a lista inteira num banco virgem, onde elas criam e esta apaga
-- (mesma decisão da mig 280, a retirada do EVO Brazil).
--
-- Idempotente: IF EXISTS. O CASCADE só leva índices, constraints, gatilhos e
-- as sequências das próprias tabelas.

DROP TABLE IF EXISTS public.tb_arena_minigame_result CASCADE;
DROP TABLE IF EXISTS public.tb_arena_minigame_match CASCADE;
DROP TABLE IF EXISTS public.tb_arena_admission CASCADE;
DROP TABLE IF EXISTS public.tb_arena_account_lease CASCADE;
DROP TABLE IF EXISTS public.tb_arena_room CASCADE;
DROP TABLE IF EXISTS public.tb_arena_worker CASCADE;
DROP TABLE IF EXISTS public.tb_arena_boost CASCADE;
DROP TABLE IF EXISTS public.tb_arena_xp_grant CASCADE;
DROP TABLE IF EXISTS public.tb_arena_progression CASCADE;
DROP TABLE IF EXISTS public.tb_arena_mission_contrib CASCADE;
DROP TABLE IF EXISTS public.tb_arena_mission_progress CASCADE;
DROP TABLE IF EXISTS public.tb_arena_mission_def CASCADE;
DROP TABLE IF EXISTS public.tb_arena_fact CASCADE;
DROP TABLE IF EXISTS public.tb_arena_ad_video_session CASCADE;
DROP TABLE IF EXISTS public.tb_arena_ad_signal CASCADE;
DROP TABLE IF EXISTS public.tb_arena_ad_booking CASCADE;
DROP TABLE IF EXISTS public.tb_arena_ad_creative CASCADE;
DROP TABLE IF EXISTS public.tb_arena_ad_campaign CASCADE;
DROP TABLE IF EXISTS public.tb_arena_ad_placement CASCADE;
DROP TABLE IF EXISTS public.tb_arena_avatar_grant CASCADE;
DROP TABLE IF EXISTS public.tb_arena_avatar_variant CASCADE;
DROP TABLE IF EXISTS public.tb_arena_avatar_model CASCADE;
DROP TABLE IF EXISTS public.tb_arena_presence_unique CASCADE;
DROP TABLE IF EXISTS public.tb_arena_presence_member CASCADE;
DROP TABLE IF EXISTS public.tb_arena_presence_sample CASCADE;
DROP TABLE IF EXISTS public.tb_arena_presence_beat CASCADE;
DROP TABLE IF EXISTS public.tb_arena_territory_tally CASCADE;
DROP TABLE IF EXISTS public.tb_arena_territory_state CASCADE;
DROP TABLE IF EXISTS public.tb_arena_territory_count CASCADE;
DROP TABLE IF EXISTS public.tb_arena_checkpoint CASCADE;
DROP TABLE IF EXISTS public.tb_arena_post CASCADE;
DROP TABLE IF EXISTS public.tb_arena_sensitive_consent CASCADE;
DROP TABLE IF EXISTS public.tb_arena_preference CASCADE;
DROP TABLE IF EXISTS public.tb_arena_player CASCADE;
DROP TABLE IF EXISTS public.tb_arena_team CASCADE;
DROP TABLE IF EXISTS public.tb_arena_category CASCADE;

DROP SEQUENCE IF EXISTS public.seq_arena_territory_revision;
DROP FUNCTION IF EXISTS public.fn_arena_ad_creative_immutable() CASCADE;
DROP FUNCTION IF EXISTS public.fn_arena_xp_grant_immutable() CASCADE;
