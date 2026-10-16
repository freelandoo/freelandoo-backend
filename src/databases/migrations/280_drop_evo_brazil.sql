-- 280 — RETIRADA DO EVO BRAZIL (ex-Cat demon), P0 da Freelandoo Arena.
--
-- Decisão do Alex em 2026-10-16: o jogo sai inteiro da produção (página
-- /jogar, /monsters, /evo, app Android, saves e vínculo do app). O projeto
-- Godot continua só na máquina local dele.
--
-- As três tabelas eram exclusivas do jogo (migs 278 e 279) e nenhuma outra
-- tabela tem FK apontando para elas. No dia da retirada havia 7 códigos de
-- vínculo (todos expirados, vida de 5 min), 1 sessão do app e 0 saves.
--
-- As migrations 278 e 279 FICAM no repositório: o runner confere checksum e
-- re-executa a lista inteira num banco virgem, onde elas criam e esta apaga.
--
-- Idempotente: IF EXISTS. O CASCADE só leva índices e constraints delas.

DROP TABLE IF EXISTS public.tb_game_save CASCADE;
DROP TABLE IF EXISTS public.tb_app_session CASCADE;
DROP TABLE IF EXISTS public.tb_app_link_code CASCADE;
