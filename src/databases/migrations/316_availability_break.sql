-- 316: intervalo (almoço) na regra semanal da agenda (pedido do Alex,
-- 2026-10-31: "bloqueia do meio-dia às 13h, que será o horário de almoço de
-- todos os dias" — barbearia do Enzo).
--
-- Antes a única forma de tirar uma faixa do dia era o bloqueio POR DATA
-- (tb_profile_availability_overrides.blocked_slots_json), que teria de ser
-- repetido para cada dia para sempre. O intervalo mora na regra do dia da
-- semana: NULL nos dois = sem intervalo (o comportamento de antes).
-- A regra é validada no serviço (os dois juntos, início < fim, dentro do
-- expediente). Idempotente.
ALTER TABLE public.tb_profile_availability_rules
  ADD COLUMN IF NOT EXISTS break_start TIME,
  ADD COLUMN IF NOT EXISTS break_end   TIME;
