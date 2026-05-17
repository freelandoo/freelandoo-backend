-- =============================================================================
-- Migration 068: Product Categories — categorias para a Loja de produtos
-- =============================================================================
-- Categorias separadas das máquinas de serviço. Usadas tanto pela vitrine de
-- produtos da loja do subperfil (tb_profile_product) quanto pelo "Pedir Produto"
-- (tb_product_request, mig 070).
-- parent_id reservado para futura hierarquia (subcategorias) — null hoje.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_product_category (
  id_product_category   SERIAL       PRIMARY KEY,
  name                  VARCHAR(120) NOT NULL,
  slug                  VARCHAR(140) NOT NULL UNIQUE,
  description           TEXT,
  icon                  VARCHAR(80),
  parent_id             INT          REFERENCES public.tb_product_category(id_product_category) ON DELETE SET NULL,
  status                VARCHAR(16)  NOT NULL DEFAULT 'active'
                          CHECK (status IN ('active','inactive')),
  sort_order            INT          NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_category_status
  ON public.tb_product_category (status, sort_order, name);

CREATE INDEX IF NOT EXISTS idx_product_category_parent
  ON public.tb_product_category (parent_id);

-- ─── Seed inicial: 22 categorias ─────────────────────────────────────────────
INSERT INTO public.tb_product_category (name, slug, sort_order, status)
VALUES
  ('Vestuário',             'vestuario',              10,  'active'),
  ('Calçados',              'calcados',               20,  'active'),
  ('Acessórios',            'acessorios',             30,  'active'),
  ('Eletrônicos',           'eletronicos',            40,  'active'),
  ('Eletrodomésticos',      'eletrodomesticos',       50,  'active'),
  ('Informática',           'informatica',            60,  'active'),
  ('Games',                 'games',                  70,  'active'),
  ('Casa e Decoração',      'casa-e-decoracao',       80,  'active'),
  ('Móveis',                'moveis',                 90,  'active'),
  ('Artesanato',            'artesanato',             100, 'active'),
  ('Beleza e Cosméticos',   'beleza-e-cosmeticos',    110, 'active'),
  ('Produtos Pet',          'produtos-pet',           120, 'active'),
  ('Alimentos Artesanais',  'alimentos-artesanais',   130, 'active'),
  ('Papelaria',             'papelaria',              140, 'active'),
  ('Livros e Materiais',    'livros-e-materiais',     150, 'active'),
  ('Ferramentas',           'ferramentas',            160, 'active'),
  ('Autopeças e Acessórios','autopecas-e-acessorios', 170, 'active'),
  ('Esporte e Fitness',     'esporte-e-fitness',      180, 'active'),
  ('Bebês e Crianças',      'bebes-e-criancas',       190, 'active'),
  ('Festas e Eventos',      'festas-e-eventos',       200, 'active'),
  ('Saúde e Bem-estar',     'saude-e-bem-estar',      210, 'active'),
  ('Outros',                'outros',                 999, 'active')
ON CONFLICT (slug) DO NOTHING;
