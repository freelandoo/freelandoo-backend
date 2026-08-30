-- =============================================================================
-- Migration 207: A vaga de garagem passa a apontar para a unidade NOVA
-- Fecho do subsistema 5 (migs 205/206).
--
-- Por que esta migration existe: a mig 205 mudou o ESPAÇO DE IDs das unidades.
-- `tb_condo_parking.id_unit` continuava apontando para `tb_condo_unit`, que
-- virou legado — e a situação do morador (`CondoStorage.getResidentStatus`)
-- passou a devolver ids de `tb_residence_unit`. Sem esta migration, cadastrar
-- uma vaga usaria um id do espaço NOVO contra uma FK do espaço VELHO: ou
-- estoura violação de chave estrangeira, ou — pior — casa por coincidência com
-- a unidade errada e amarra a vaga do 101 ao apartamento de outra pessoa.
--
-- É o tipo de erro que não aparece em teste com banco pequeno, porque os dois
-- espaços de id começam em 1 e coincidem por um tempo.
--
-- A vaga em si NÃO é migrada de tabela: `tb_condo_parking` continua sendo dela.
-- O que muda é só para onde a coluna de unidade aponta.
--
-- Idempotente. (O runner já envolve cada migration em transação própria.)
-- =============================================================================

-- ─── 1. Reaponta os dados antes de trocar a FK ──────────────────────────────
-- O ponteiro da mig 205 (`tb_condo_unit.id_residence_unit`) é a tradução entre
-- os dois espaços. Vaga cuja unidade legada não foi migrada (condomínio sem
-- endereço completo) fica com id_unit NULL: perder o vínculo com a unidade é
-- ruim, mas apontar para a unidade errada é pior.
--
-- Guardado por um teste de existência da coluna: num banco onde a 205 ainda não
-- rodou (impossível pela ordem, mas o runner não garante) isto não explodiria.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'tb_condo_unit'
       AND column_name = 'id_residence_unit'
  ) AND EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.tb_condo_parking'::regclass
       AND con.contype = 'f'
       AND att.attname = 'id_unit'
       AND con.confrelid = 'public.tb_condo_unit'::regclass
  ) THEN
    UPDATE public.tb_condo_parking p
       SET id_unit = cu.id_residence_unit
      FROM public.tb_condo_unit cu
     WHERE p.id_unit = cu.id_unit;

    -- Sobrou apontando para o espaço velho = unidade sem tradução.
    UPDATE public.tb_condo_parking p
       SET id_unit = NULL
     WHERE p.id_unit IS NOT NULL
       AND NOT EXISTS (
             SELECT 1 FROM public.tb_residence_unit ru
              WHERE ru.id_unit = p.id_unit
           );
  END IF;
END $$;

-- ─── 1b. O aviso direcionado a um apartamento ───────────────────────────────
-- Mesmo problema, mesma correção: `tb_condo_notice.id_unit` apontava para a
-- unidade legada. Sem reapontar, um aviso "para o 101" seguiria endereçado à
-- linha antiga — e a entrega, que agora pergunta quem MORA na unidade, nunca
-- casaria com ninguém. O aviso simplesmente não chegaria, sem erro nenhum.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.tb_condo_notice'::regclass
       AND con.contype = 'f'
       AND att.attname = 'id_unit'
       AND con.confrelid = 'public.tb_condo_unit'::regclass
  ) THEN
    UPDATE public.tb_condo_notice n
       SET id_unit = cu.id_residence_unit
      FROM public.tb_condo_unit cu
     WHERE n.id_unit = cu.id_unit;
  END IF;
END $$;

-- Aviso de unidade que perdeu o alvo vira aviso ÓRFÃO, e o CHECK de escopo da
-- mig 197 não aceita scope='unit' com id_unit NULL. Então ele é arquivado
-- (soft-delete), não mutilado: o histórico continua legível.
UPDATE public.tb_condo_notice n
   SET deleted_at = COALESCE(n.deleted_at, NOW())
 WHERE n.scope = 'unit'
   AND n.id_unit IS NOT NULL
   AND n.deleted_at IS NULL
   AND NOT EXISTS (
         SELECT 1 FROM public.tb_residence_unit ru WHERE ru.id_unit = n.id_unit
       );

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.tb_condo_notice'::regclass
       AND con.contype = 'f'
       AND att.attname = 'id_unit'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.tb_condo_notice DROP CONSTRAINT %I', c.conname
    );
  END LOOP;

  ALTER TABLE public.tb_condo_notice
    ADD CONSTRAINT fk_condo_notice_residence_unit
    FOREIGN KEY (id_unit) REFERENCES public.tb_residence_unit(id_unit)
    ON DELETE CASCADE;
END $$;

-- ─── 2. Troca a FK ──────────────────────────────────────────────────────────
-- Varre o pg_constraint pela COLUNA (o nome é gerado pelo Postgres e não é
-- confiável), igual às migs 189 e 202.
--
-- SET NULL, e não CASCADE: apagar um apartamento não pode apagar a vaga, que é
-- um bem separado — e a mig 205 já garante que apartamento com morador não é
-- apagável.
DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_attribute att
        ON att.attrelid = con.conrelid
       AND att.attnum = ANY (con.conkey)
     WHERE con.conrelid = 'public.tb_condo_parking'::regclass
       AND con.contype = 'f'
       AND att.attname = 'id_unit'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.tb_condo_parking DROP CONSTRAINT %I', c.conname
    );
  END LOOP;

  ALTER TABLE public.tb_condo_parking
    ADD CONSTRAINT fk_condo_parking_residence_unit
    FOREIGN KEY (id_unit) REFERENCES public.tb_residence_unit(id_unit)
    ON DELETE SET NULL;
END $$;
