-- 273_academy_payment_canceled_refunded.sql
-- COBRANÇA DA ACADEMIA GANHA "canceled" E "refunded" (Alex, 2026-10-06).
--
-- O Coliseu (Gym Provider API) passou a cancelar cobrança e a registrar
-- estorno/chargeback pelo Asaas. Com o CHECK antigo (pending/paid/overdue) e o
-- sync convertendo status desconhecido em "pending", uma cobrança cancelada
-- ou estornada aparecia para o aluno como PENDENTE — pior do que não mostrar.
--
-- O CHECK nasceu inline na mig 176, então o nome é o gerado pelo Postgres;
-- procura pelo catálogo em vez de chutar o nome.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class rel ON rel.oid = con.conrelid
      JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
     WHERE nsp.nspname = 'public'
       AND rel.relname = 'tb_academy_payment'
       AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.tb_academy_payment DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE public.tb_academy_payment
  ADD CONSTRAINT chk_academy_payment_status
  CHECK (status IN ('pending','paid','overdue','canceled','refunded'));
