-- Migration 003: Machines taxonomy (Phase 1)
-- Introduces tb_machine as first-class entity and links tb_category to a machine.
-- Safe to run multiple times (idempotent: IF NOT EXISTS, ON CONFLICT).

-- =============================================================================
-- tb_machine — first-class entity, public-facing catalogue
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.tb_machine (
  id_machine     SERIAL PRIMARY KEY,
  slug           VARCHAR(40)  NOT NULL UNIQUE,
  name           VARCHAR(120) NOT NULL,
  display_order  INTEGER      NOT NULL DEFAULT 0,
  color_from     VARCHAR(16),
  color_to       VARCHAR(16),
  color_glow     VARCHAR(40),
  color_ring     VARCHAR(40),
  color_accent   VARCHAR(16),
  color_text     VARCHAR(16),
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS ix_tb_machine_active
  ON public.tb_machine (display_order) WHERE is_active = TRUE;

-- =============================================================================
-- tb_category: add id_machine FK (nullable for back-compat; admin can cleanup).
-- =============================================================================
ALTER TABLE public.tb_category
  ADD COLUMN IF NOT EXISTS id_machine INTEGER REFERENCES public.tb_machine(id_machine);

CREATE INDEX IF NOT EXISTS ix_tb_category_machine
  ON public.tb_category (id_machine) WHERE is_active = TRUE;

-- =============================================================================
-- Seed the 8 official machines
-- =============================================================================
INSERT INTO public.tb_machine (slug, name, display_order, color_from, color_to, color_glow, color_ring, color_accent, color_text)
VALUES
  ('views',          'Máquina de Views',          1, '#6d28d9', '#2563eb', 'rgba(139,92,246,0.45)', 'rgba(139,92,246,0.7)', '#a78bfa', '#ddd6fe'),
  ('divulgacao',     'Máquina de Divulgação',     2, '#e11d48', '#db2777', 'rgba(244,63,94,0.45)',  'rgba(244,63,94,0.7)',  '#fb7185', '#fecdd3'),
  ('limpeza',        'Máquina de Limpeza',        3, '#059669', '#10b981', 'rgba(16,185,129,0.45)', 'rgba(16,185,129,0.7)', '#34d399', '#a7f3d0'),
  ('construcao',     'Máquina de Construção',     4, '#ea580c', '#f59e0b', 'rgba(249,115,22,0.45)', 'rgba(249,115,22,0.7)', '#fb923c', '#fed7aa'),
  ('negocios',       'Máquina de Negócios',       5, '#0ea5e9', '#06b6d4', 'rgba(14,165,233,0.45)', 'rgba(14,165,233,0.7)', '#38bdf8', '#bae6fd'),
  ('oportunidades',  'Máquina de Oportunidades',  6, '#e6b800', '#f59e0b', 'rgba(230,184,0,0.45)',  'rgba(230,184,0,0.7)',  '#fbbf24', '#fde68a'),
  ('saude_beleza',   'Máquina de Saúde e Beleza', 7, '#d946ef', '#ec4899', 'rgba(217,70,239,0.45)', 'rgba(217,70,239,0.7)', '#e879f9', '#fbcfe8'),
  ('saude_pet',      'Máquina de Saúde do Pet',   8, '#0d9488', '#14b8a6', 'rgba(20,184,166,0.45)', 'rgba(20,184,166,0.7)', '#2dd4bf', '#99f6e4')
ON CONFLICT (slug) DO UPDATE SET
  name          = EXCLUDED.name,
  display_order = EXCLUDED.display_order,
  color_from    = EXCLUDED.color_from,
  color_to      = EXCLUDED.color_to,
  color_glow    = EXCLUDED.color_glow,
  color_ring    = EXCLUDED.color_ring,
  color_accent  = EXCLUDED.color_accent,
  color_text    = EXCLUDED.color_text,
  updated_at    = NOW();

-- =============================================================================
-- Seed the official professions for each machine.
-- Insert by (desc_category, id_machine). If a category with same name already
-- exists (case-insensitive), link it to the right machine instead of duplicating.
-- =============================================================================

-- Helper: upsert a category with its machine, matching by lower(desc_category).
-- We use a DO block because INSERT ... ON CONFLICT needs a unique index on the
-- key; tb_category may not have UNIQUE on desc_category in this database.
DO $seed$
DECLARE
  v RECORD;
  v_machine_id INTEGER;
  v_existing_id INTEGER;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      -- 1. Views
      ('views', 'Editor de vídeo'),
      ('views', 'Editor de cortes'),
      ('views', 'Thumbmaker'),
      ('views', 'Designer de thumbnail'),
      ('views', 'Motion designer'),
      ('views', 'Roteirista'),
      ('views', 'Copywriter para vídeos'),
      ('views', 'Estrategista de conteúdo'),
      ('views', 'Social media focado em conteúdo'),
      ('views', 'Especialista em YouTube'),
      ('views', 'Especialista em TikTok/Reels'),
      ('views', 'Gestor de canal'),

      -- 2. Divulgação
      ('divulgacao', 'Influenciador'),
      ('divulgacao', 'Microinfluenciador'),
      ('divulgacao', 'Creator UGC'),
      ('divulgacao', 'Afiliado'),
      ('divulgacao', 'Embaixador de marca'),
      ('divulgacao', 'Creator de lifestyle'),
      ('divulgacao', 'Creator de nicho'),
      ('divulgacao', 'Apresentador de produto'),
      ('divulgacao', 'Divulgador local'),
      ('divulgacao', 'Creator para campanhas'),
      ('divulgacao', 'Creator para lançamentos'),

      -- 3. Limpeza
      ('limpeza', 'Diarista'),
      ('limpeza', 'Faxineira'),
      ('limpeza', 'Auxiliar de limpeza'),
      ('limpeza', 'Limpeza pós-obra'),
      ('limpeza', 'Limpeza pesada'),
      ('limpeza', 'Organização residencial'),
      ('limpeza', 'Organização comercial'),
      ('limpeza', 'Passadeira'),
      ('limpeza', 'Lavador de estofado'),
      ('limpeza', 'Limpeza de vidros'),
      ('limpeza', 'Limpeza de escritório'),

      -- 4. Construção
      ('construcao', 'Pedreiro'),
      ('construcao', 'Ajudante de obra'),
      ('construcao', 'Servente'),
      ('construcao', 'Engenheiro civil'),
      ('construcao', 'Arquiteto'),
      ('construcao', 'Pintor'),
      ('construcao', 'Azulejista'),
      ('construcao', 'Gesseiro'),
      ('construcao', 'Eletricista'),
      ('construcao', 'Encanador'),
      ('construcao', 'Instalador'),
      ('construcao', 'Mestre de obras'),
      ('construcao', 'Marceneiro'),
      ('construcao', 'Serralheiro'),

      -- 5. Negócios
      ('negocios', 'Social media'),
      ('negocios', 'Designer gráfico'),
      ('negocios', 'Gestor de tráfego'),
      ('negocios', 'Copywriter'),
      ('negocios', 'SDR'),
      ('negocios', 'Closer'),
      ('negocios', 'Assistente virtual'),
      ('negocios', 'Atendimento ao cliente'),
      ('negocios', 'Suporte operacional'),
      ('negocios', 'Analista de CRM'),
      ('negocios', 'Web designer'),
      ('negocios', 'Desenvolvedor'),
      ('negocios', 'Consultor comercial'),
      ('negocios', 'Especialista em automação'),
      ('negocios', 'Analista de marketing'),

      -- 6. Oportunidades
      ('oportunidades', 'Freelancer geral'),
      ('oportunidades', 'Assistente geral'),
      ('oportunidades', 'Auxiliar administrativo'),
      ('oportunidades', 'Recepcionista'),
      ('oportunidades', 'Promotor'),
      ('oportunidades', 'Divulgador'),
      ('oportunidades', 'Captador de leads'),
      ('oportunidades', 'Operador digital'),
      ('oportunidades', 'Suporte geral'),
      ('oportunidades', 'Profissional multitarefa'),
      ('oportunidades', 'Prestador local'),
      ('oportunidades', 'Parceiro comercial'),

      -- 7. Saúde e Beleza
      ('saude_beleza', 'Massagista'),
      ('saude_beleza', 'Massoterapeuta'),
      ('saude_beleza', 'Esteticista'),
      ('saude_beleza', 'Designer de sobrancelhas'),
      ('saude_beleza', 'Maquiadora'),
      ('saude_beleza', 'Cabeleireiro'),
      ('saude_beleza', 'Barbeiro'),
      ('saude_beleza', 'Manicure'),
      ('saude_beleza', 'Pedicure'),
      ('saude_beleza', 'Lash designer'),
      ('saude_beleza', 'Terapeuta corporal'),
      ('saude_beleza', 'Drenagem linfática'),
      ('saude_beleza', 'Depiladora'),
      ('saude_beleza', 'Micropigmentadora'),
      ('saude_beleza', 'Spa / relaxamento'),

      -- 8. Saúde do Pet
      ('saude_pet', 'Banhista'),
      ('saude_pet', 'Tosador'),
      ('saude_pet', 'Groomer'),
      ('saude_pet', 'Dog walker'),
      ('saude_pet', 'Pet sitter'),
      ('saude_pet', 'Adestrador'),
      ('saude_pet', 'Cuidador de pets'),
      ('saude_pet', 'Hotel para pets'),
      ('saude_pet', 'Transporte pet'),
      ('saude_pet', 'Veterinário'),
      ('saude_pet', 'Auxiliar veterinário'),
      ('saude_pet', 'Fisioterapia animal'),
      ('saude_pet', 'Recreador pet'),
      ('saude_pet', 'Cuidador domiciliar de pets')
    ) AS t(machine_slug, profession)
  LOOP
    SELECT id_machine INTO v_machine_id
      FROM public.tb_machine
      WHERE slug = v.machine_slug;

    IF v_machine_id IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id_category INTO v_existing_id
      FROM public.tb_category
      WHERE LOWER(desc_category) = LOWER(v.profession)
      LIMIT 1;

    IF v_existing_id IS NULL THEN
      INSERT INTO public.tb_category (desc_category, id_machine, is_active)
      VALUES (v.profession, v_machine_id, TRUE);
    ELSE
      UPDATE public.tb_category
        SET id_machine = v_machine_id,
            is_active  = TRUE
      WHERE id_category = v_existing_id;
    END IF;
  END LOOP;
END
$seed$;

-- =============================================================================
-- Best-effort remap of legacy category names that don't exactly match the
-- canonical spelling (e.g. "editor de video" without accent, plural forms).
-- Unknown categories stay with id_machine = NULL for admin cleanup.
-- =============================================================================
DO $remap$
DECLARE
  v RECORD;
  v_machine_id INTEGER;
BEGIN
  FOR v IN
    SELECT * FROM (VALUES
      ('views',         'editor de video'),
      ('views',         'editores de video'),
      ('views',         'editor de videos'),
      ('views',         'thumbnail'),
      ('views',         'thumb maker'),
      ('views',         'roteiro'),
      ('views',         'roteiristas'),
      ('views',         'estrategista de crescimento'),
      ('divulgacao',    'influenciadores'),
      ('divulgacao',    'microinfluencer'),
      ('divulgacao',    'ugc'),
      ('divulgacao',    'afiliados'),
      ('limpeza',       'faxina'),
      ('limpeza',       'limpeza'),
      ('limpeza',       'organizacao'),
      ('limpeza',       'organização'),
      ('limpeza',       'limpeza pos-obra'),
      ('construcao',    'ajudante'),
      ('construcao',    'engenheiro'),
      ('construcao',    'acabamento'),
      ('negocios',      'designer'),
      ('negocios',      'atendimento'),
      ('negocios',      'suporte'),
      ('negocios',      'trafego pago'),
      ('negocios',      'gestor de trafego')
    ) AS t(machine_slug, legacy_name)
  LOOP
    SELECT id_machine INTO v_machine_id
      FROM public.tb_machine
      WHERE slug = v.machine_slug;

    IF v_machine_id IS NOT NULL THEN
      UPDATE public.tb_category
         SET id_machine = v_machine_id
       WHERE LOWER(desc_category) = LOWER(v.legacy_name)
         AND id_machine IS NULL;
    END IF;
  END LOOP;
END
$remap$;
