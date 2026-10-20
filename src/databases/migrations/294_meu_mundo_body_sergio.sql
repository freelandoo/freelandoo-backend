-- Meu Mundo 3D: corpo "sergio" (o lutador da RA da Casa Views) no seletor de
-- tipo físico de teste. Superset do CHECK da mig 291, com o MESMO nome: um nome
-- novo deixaria o antigo valendo em paralelo e recusando o corpo novo.
ALTER TABLE public.tb_mm_avatar_pref DROP CONSTRAINT IF EXISTS chk_mm_avatar_body;
ALTER TABLE public.tb_mm_avatar_pref
  ADD CONSTRAINT chk_mm_avatar_body CHECK (body IN ('normal', 'slim', 'fat', 'strong', 'sergio'));
