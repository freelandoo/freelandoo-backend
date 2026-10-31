-- 318 — Meu Mundo 3D mm3d-58: CLASSES (raposas × vampiros).
--
-- Regra em src/utils/meuMundoClans.js. A classe é do JOGADOR (passa de um
-- hóspede para o outro); o corpo sai dela + sexo + fase da vida e não se grava.
-- Bairro ganha classe (NULL = bairro de antes: deixa de receber gente; quem
-- mora nele muda ao escolher a classe, levando o nível da casa).
-- Artefato de troca de classe: um por linha, consumido na troca.

CREATE TABLE IF NOT EXISTS public.tb_mm_clan (
  id_user UUID PRIMARY KEY REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  clan TEXT NOT NULL,
  sex TEXT NOT NULL,
  chosen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  changed_at TIMESTAMPTZ NULL,
  changes INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT chk_mm_clan CHECK (clan IN ('raposa', 'vampiro')),
  CONSTRAINT chk_mm_clan_sex CHECK (sex IN ('m', 'f'))
);

ALTER TABLE public.tb_mm_neighborhood ADD COLUMN IF NOT EXISTS clan TEXT NULL;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_mm_neighborhood_clan') THEN
    ALTER TABLE public.tb_mm_neighborhood
      ADD CONSTRAINT chk_mm_neighborhood_clan CHECK (clan IS NULL OR clan IN ('raposa', 'vampiro'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS ix_mm_neighborhood_clan ON public.tb_mm_neighborhood (clan, seq);

CREATE TABLE IF NOT EXISTS public.tb_mm_artifact (
  id_artifact UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  source TEXT NOT NULL,
  acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  used_at TIMESTAMPTZ NULL,
  CONSTRAINT chk_mm_artifact_kind CHECK (kind IN ('troca_classe'))
);
CREATE INDEX IF NOT EXISTS ix_mm_artifact_user_free ON public.tb_mm_artifact (id_user) WHERE used_at IS NULL;
