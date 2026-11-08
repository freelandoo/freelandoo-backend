-- 327 — Meu Mundo 3D: a alma do hóspede (mm3d-72, 2026-11-07).
--
-- Pedido do Alex: personalidade nova (psicopata, covarde, comilão, bondoso,
-- competitivo), quanto ele gosta do dono (afeto, sem teto), o que mais gosta e
-- o que mais odeia, desejos e apelidos. A regra é src/utils/meuMundoSoul.js.
--  - tb_mm_character.soul: { temper, affection, likes, hates, zeroSince, wish,
--    nextWishAt, petName } — NULL = de antes (nasce pela semente na leitura).
--  - tb_mm_player: o apelido que a PESSOA escolhe para si ao entrar no jogo
--    (vale para todos os hóspedes dela, de geração em geração).

ALTER TABLE tb_mm_character ADD COLUMN IF NOT EXISTS soul JSONB;

CREATE TABLE IF NOT EXISTS tb_mm_player (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
