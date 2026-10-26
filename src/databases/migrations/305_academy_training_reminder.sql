-- 305 — Fila de treinos do professor + aviso vindo da academia.
--
-- Pedido do Alex (2026-10-26): o Coliseu ganha a aba Treinos (vencidos,
-- vencendo, sem treino) e o professor da academia recebe na Freelandoo um
-- modal para atualizá-los. O modal abre sozinho quando há fila; o botão
-- "Avisar professores" do Coliseu (POST /partner/v1/training-reminder) grava
-- este instante, e o modal volta a abrir para quem o tinha dispensado antes
-- dele — é a única coisa que o aviso precisa guardar.

ALTER TABLE public.tb_academy
  ADD COLUMN IF NOT EXISTS training_reminder_at TIMESTAMPTZ NULL;
