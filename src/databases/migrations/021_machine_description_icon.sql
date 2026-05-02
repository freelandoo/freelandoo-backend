-- Migration 021: tb_machine ganha description + icon_name; FK tb_category.id_machine
-- vira ON DELETE SET NULL para permitir exclusão de máquinas órfãs na governança.
-- Idempotente.

ALTER TABLE public.tb_machine
  ADD COLUMN IF NOT EXISTS description VARCHAR(280),
  ADD COLUMN IF NOT EXISTS icon_name   VARCHAR(40);

-- Drop existing FK (sem nome explícito; achamos pelo information_schema) e
-- recriamos com ON DELETE SET NULL.
DO $$
DECLARE
  v_constraint_name TEXT;
BEGIN
  SELECT tc.constraint_name
    INTO v_constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
   WHERE tc.table_schema = 'public'
     AND tc.table_name   = 'tb_category'
     AND tc.constraint_type = 'FOREIGN KEY'
     AND kcu.column_name = 'id_machine'
   LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.tb_category DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.tb_category
    ADD CONSTRAINT tb_category_id_machine_fkey
      FOREIGN KEY (id_machine)
      REFERENCES public.tb_machine(id_machine)
      ON DELETE SET NULL;
END $$;

-- Defaults amigáveis para as 8 máquinas seed.
UPDATE public.tb_machine SET
  description = COALESCE(description, CASE slug
    WHEN 'views'         THEN 'Conteúdo, edição, roteiros e crescimento digital.'
    WHEN 'divulgacao'    THEN 'Creators, influenciadores e campanhas que geram alcance.'
    WHEN 'limpeza'       THEN 'Faxina, organização e serviços de apoio.'
    WHEN 'construcao'    THEN 'Obras, reformas, instalações e acabamentos.'
    WHEN 'negocios'      THEN 'Marketing, design, vendas e suporte para empresas.'
    WHEN 'oportunidades' THEN 'Renda extra, bicos, parcerias e novas oportunidades.'
    WHEN 'saude_beleza'  THEN 'Estética, cuidados pessoais e bem-estar.'
    WHEN 'saude_pet'     THEN 'Banho, tosa, passeio e cuidados para pets.'
  END),
  icon_name = COALESCE(icon_name, CASE slug
    WHEN 'views'         THEN 'Play'
    WHEN 'divulgacao'    THEN 'Megaphone'
    WHEN 'limpeza'       THEN 'Sparkles'
    WHEN 'construcao'    THEN 'HardHat'
    WHEN 'negocios'      THEN 'TrendingUp'
    WHEN 'oportunidades' THEN 'Briefcase'
    WHEN 'saude_beleza'  THEN 'Heart'
    WHEN 'saude_pet'     THEN 'PawPrint'
  END)
WHERE slug IN ('views','divulgacao','limpeza','construcao','negocios','oportunidades','saude_beleza','saude_pet');
