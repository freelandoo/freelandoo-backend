-- 315: agendar sem e-mail (pedido do Alex, 2026-10-31).
--
-- No site da barbearia o contato que importa é o WhatsApp: é por ele que quem
-- atende fala com o cliente. O e-mail passou a ser opcional e o WhatsApp
-- obrigatório (a regra mora em BookingService.createPublicBooking).
--
-- A coluna era NOT NULL desde a mig 010. Quem lê já trata a falta:
-- o lembrete pula sem e-mail e os JOINs por e-mail simplesmente não casam.
-- Idempotente: DROP NOT NULL numa coluna já anulável não faz nada.
ALTER TABLE public.tb_profile_bookings
  ALTER COLUMN client_email DROP NOT NULL;
