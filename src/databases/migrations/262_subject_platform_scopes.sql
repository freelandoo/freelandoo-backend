-- 262_subject_platform_scopes.sql
-- PET, CARRO E GAMES VIRAM PLATAFORMAS COM A ABA "MESMO X".
--
-- Decisão do Alex (2026-09-25): existem dois tipos de espaço. Comunidade com
-- líder (negócio, condomínio, bairro) tem membros; PLATAFORMA (games,
-- Financeiro, pet, carro) tem um feed público de todo mundo e uma aba que
-- recorta esse feed:
--   carro → mesmo MODELO (mig 259, já existia)
--   pet   → mesma RAÇA
--   games → mesmo JOGO ATUAL
--
-- Esta migration só prepara as duas comparações que faltavam. Nenhuma linha
-- de membro é tocada: o `leader` do dono continua sendo o marcador de POSSE
-- que `listMySpaces`/`spaceCaps` leem. "Sem membros" é regra de aplicação
-- (ninguém além do dono entra — ver CommunityService.join).
--
-- ─── A chave normalizada ─────────────────────────────────────────────────────
-- "Elden Ring", "elden ring" e "ELDEN  RING!" são o mesmo jogo para uma pessoa
-- e três para um WHERE. A regra mora numa função SQL, e não em JS, por DOIS
-- motivos: (1) a coluna de games vira GERADA a partir dela, então não existe
-- caminho de escrita que esqueça de normalizar; (2) o pet compara o texto livre
-- de "outra raça" com a MESMA régua, dentro da consulta. Duas réguas (uma em
-- JS, outra em SQL) discordariam no primeiro acento fora da lista.
--
-- `unaccent` não é usado de propósito: é extensão, e CREATE EXTENSION exige
-- superusuário — falhar aqui aborta o boot (run-migrations sai com exit 1).
-- `translate` cobre o português, que é o que a base tem.
--
-- IMMUTABLE é obrigatório: é o que permite a coluna gerada e o índice por
-- expressão. É verdade — a saída depende só da entrada.

CREATE OR REPLACE FUNCTION public.fl_norm_key(t text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $fn$
  SELECT NULLIF(
    btrim(
      regexp_replace(
        lower(
          translate(
            COALESCE(t, ''),
            'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
            'AAAAAEEEEIIIIOOOOOUUUUCNaaaaaeeeeiiiiooooouuuucn'
          )
        ),
        '[^a-z0-9]+', ' ', 'g'
      )
    ),
    ''
  )
$fn$;

-- ─── Games: o jogo atual ganha a chave ───────────────────────────────────────
-- GERADA e STORED: o backfill acontece no ADD COLUMN e toda escrita futura
-- (o upsert do jogo atual) recalcula sozinha. NULL = "não declarou".
ALTER TABLE public.tb_user_current_game
  ADD COLUMN IF NOT EXISTS game_key TEXT
  GENERATED ALWAYS AS (public.fl_norm_key(game_title)) STORED;

CREATE INDEX IF NOT EXISTS ix_user_current_game_key
  ON public.tb_user_current_game (game_key)
  WHERE game_key IS NOT NULL;

-- ─── Pet: as duas formas de "mesma raça" ─────────────────────────────────────
-- Raça do catálogo: `id_breed`. O catálogo tem uma linha por (espécie, raça),
-- então o vira-lata de cachorro e o de gato são linhas diferentes — comparar o
-- id já impede o SRD de cachorro casar com o SRD de gato, sem regra extra.
CREATE INDEX IF NOT EXISTS ix_community_pet_breed
  ON public.tb_community_pet (id_breed)
  WHERE id_breed IS NOT NULL;

-- "Outra raça" (texto livre): casa por espécie + texto normalizado.
CREATE INDEX IF NOT EXISTS ix_community_pet_breed_label
  ON public.tb_community_pet (species, public.fl_norm_key(breed_label))
  WHERE id_breed IS NULL AND breed_label IS NOT NULL;
