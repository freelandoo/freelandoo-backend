-- 430 — MEU MUNDO: GENÉTICAS do Laboratório de Criogenia (pedido do Alex, 09/11/2026).
--
-- No laboratório a pessoa compra a GENÉTICA de uma espécie ("genética de Aurion") e a
-- mistura com um personagem adulto dela (regra MIX em features/meu-mundo/characters/rules.ts,
-- serviço MeuMundoCharacterService.fuse). A genética fica guardada até ser usada; usada,
-- grava em qual filho entrou. `ref` = chave do pedido (clique duplo não compra duas vezes).
-- `seed` dá o temperamento dela (Soul.bornSoul), o mesmo jeito de um personagem.
-- Idempotente.

CREATE TABLE IF NOT EXISTS public.tb_mm_genetics (
  id_genetics UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  species TEXT NOT NULL,
  sex TEXT NOT NULL,
  seed INTEGER NOT NULL,
  ref TEXT NOT NULL,
  price INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ NULL,
  used_in UUID NULL REFERENCES public.tb_mm_character(id_character) ON DELETE SET NULL,
  CONSTRAINT chk_mm_genetics_species CHECK (species ~ '^[a-z0-9_]{1,32}$'),
  CONSTRAINT chk_mm_genetics_sex CHECK (sex IN ('m', 'f')),
  CONSTRAINT chk_mm_genetics_price CHECK (price >= 0),
  CONSTRAINT ux_mm_genetics_ref UNIQUE (id_user, ref)
);

CREATE INDEX IF NOT EXISTS ix_mm_genetics_open ON public.tb_mm_genetics (id_user, created_at) WHERE used_at IS NULL;
