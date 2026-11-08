-- 410 — MEU MUNDO B12: LABORATÓRIO DE CRIOGENIA (pedido do Alex, 08/11/2026).
--
-- O laboratório vende o EMBRIÃO de um personagem (entregue na cápsula pelo grant, como
-- prêmio e fusão) e o ACELERADOR que o leva aos 15 anos. A única mudança de esquema é a
-- origem nova 'lab' (personagem e grant). CHECK reescrito como SUPERSET com o mesmo nome.
-- Idempotente.

ALTER TABLE public.tb_mm_character DROP CONSTRAINT IF EXISTS chk_mm_character_origin;
ALTER TABLE public.tb_mm_character
  ADD CONSTRAINT chk_mm_character_origin CHECK (origin IN ('hospede', 'heir', 'skin', 'fusion', 'prize', 'market', 'gift', 'admin_test', 'lab'));

ALTER TABLE public.tb_mm_character_grant DROP CONSTRAINT IF EXISTS chk_mm_character_grant_source;
ALTER TABLE public.tb_mm_character_grant
  ADD CONSTRAINT chk_mm_character_grant_source CHECK (source IN ('skin', 'prize', 'gift', 'admin_test', 'lab'));
