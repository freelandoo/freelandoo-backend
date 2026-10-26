-- 304 — MEU MUNDO 3D: cores do personagem (mm3d-36).
--
-- Pedido do Alex (2026-10-26): camiseta, calça, pele e cabelo do personagem
-- padrão (nas 4 condições) e da feminina, escolhidos de uma paleta, de graça,
-- vistos por todos. Cada skin guarda as suas: {"standard":"0032","feminina":"b97b"}.
-- O código (4 dígitos base36 = índice na paleta de cada parte) é validado em
-- src/utils/meuMundoColors.js; ausente ou inválido = as cores de sempre.
-- As cores são da CONTA (tb_mm_avatar_pref), não do hóspede: sobrevivem à morte.

ALTER TABLE public.tb_mm_avatar_pref
  ADD COLUMN IF NOT EXISTS colors JSONB NOT NULL DEFAULT '{}'::jsonb;
