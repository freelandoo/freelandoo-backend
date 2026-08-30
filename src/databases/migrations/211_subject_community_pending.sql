-- =============================================================================
-- Migration 211: o assunto de pet/carro/games pode nascer VAZIO
-- =============================================================================
-- Decisão do Alex (2026-08-30): "as opções de comunidade não têm modais, já
-- entra em uma página pronta editável — se precisa do modelo do carro, deixa
-- para editar no headcard, os selects, tudo editável, sem modal".
--
-- A mig 210 exigia o assunto no ato da criação porque a criação era um
-- formulário (o modal). Sem o modal, a comunidade nasce primeiro e o assunto é
-- escolhido DENTRO dela, no modo de edição do headcard — então espécie,
-- plataforma e título de jogo passam a aceitar NULL enquanto ninguém escolheu.
--
-- NULL aqui significa "ainda não escolhido", e é diferente de vazio: o CHECK
-- continua valendo para todo valor preenchido (CHECK passa em NULL por
-- definição), então ninguém grava uma plataforma inventada.
--
-- O modelo do carro (tb_profile.id_car_model) já nascia NULL e continua assim.
-- O índice ux_profile_car_model não é afetado: no Postgres cada NULL é
-- distinto, então N carros sem modelo escolhido convivem, e a unicidade só
-- começa a valer quando alguém de fato escolhe o modelo — que é exatamente
-- quando ela precisa valer.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

ALTER TABLE public.tb_community_pet  ALTER COLUMN species    DROP NOT NULL;
ALTER TABLE public.tb_community_game ALTER COLUMN platform   DROP NOT NULL;
ALTER TABLE public.tb_community_game ALTER COLUMN game_title DROP NOT NULL;
