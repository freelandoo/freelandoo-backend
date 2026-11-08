-- 400 — MEU MUNDO 3D B1 (2026-11-08): BAIRROS POR PROXIMIDADE.
--
-- A escolha do bairro junta a CLASSE (mm3d-58) e a ÁREA do jogador (T2: Região Imediata do
-- IBGE, tb_profile.id_area). Quem tem área cai num bairro da mesma classe e área; sem vaga,
-- nasce o próximo bairro daquela classe e área. Quem não tem cidade cai em qualquer bairro
-- da classe com vaga. Quem já mora fica onde está (os bairros de antes ficam com área NULL).
-- O centro já mistura todo mundo em salas de 20 (CentroRoom; a 21ª pessoa abre outra sala).
-- Sem FK: os ids de área são estáveis (fl_area_rebuild) e o jogo não depende da tabela de
-- áreas existir. Idempotente.
ALTER TABLE public.tb_mm_neighborhood ADD COLUMN IF NOT EXISTS id_area INT NULL;
CREATE INDEX IF NOT EXISTS ix_mm_neighborhood_clan_area ON public.tb_mm_neighborhood (clan, id_area, seq);
