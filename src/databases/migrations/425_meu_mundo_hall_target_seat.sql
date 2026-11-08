-- 425 — MEU MUNDO 3D (2026-11-08): HALL DA FAMA na Arena das Lâminas.
--
-- Pedido do Alex: a Arena mostra o TOP 10 (pódio do 1º ao 3º, lista do 4º ao 10º) e dá para
-- desafiar até o 1º mesmo com pouco Poder. Cadeira vazia aparece preenchida pelo próximo do
-- top do Poder; vencer essa pessoa dá AQUELA cadeira (antes: a primeira vaga). A cadeira
-- mostrada no instante do desafio fica gravada aqui (NULL = defensor sentado ou desafio antigo).
-- Idempotente.

ALTER TABLE public.tb_mm_hall_challenge ADD COLUMN IF NOT EXISTS target_seat INTEGER NULL;
