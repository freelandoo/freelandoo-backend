-- =============================================================================
-- Migration 191: Loja de Funções — funções da conta viram produtos compráveis
-- =============================================================================
-- As funções do menu lateral (mig 186) deixam de ser gratuitas: cada uma vira
-- um produto na vitrine /funcoes (carrossel estilo TENKA). O usuário só vê a
-- linha da função na seção "Funções" (e os pontos de entrada dela) DEPOIS de
-- comprar. Compra vitalícia via Stripe (price_data ad-hoc), sem comissão de
-- afiliado. Reembolso total revoga a função (owned = compra paga sem refund).
--
-- tb_function_product é um CATÁLOGO FECHADO: uma linha por feature_key da
-- whitelist (userFeaturePref.routes). Admin edita preço/textos/cores/imagem e
-- o toggle is_for_sale — is_for_sale = FALSE significa que a função é GRÁTIS
-- (comporta-se como antes desta migration), não que ela some do site.
--
-- "vitrine" nasce is_for_sale = FALSE de propósito: a V1 da vitrine removeu o
-- gate de pagamento por decisão de produto (commit 7b9a497) — vendê-la
-- reintroduziria o gate. Alex pode ligar no admin se mudar de ideia.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_function_product (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key        TEXT NOT NULL UNIQUE,
  nav_label          TEXT NOT NULL,
  eyebrow            TEXT NOT NULL DEFAULT '',
  headline           TEXT NOT NULL,
  short_description  TEXT NOT NULL DEFAULT '',
  full_description   TEXT NOT NULL DEFAULT '',
  background_color   TEXT NOT NULL DEFAULT '#101014',
  accent_color       TEXT NOT NULL DEFAULT '#F2B705',
  text_color         TEXT NOT NULL DEFAULT '#FFFFFF',
  placeholder_color  TEXT NOT NULL DEFAULT '#1D1810',
  image_url          TEXT,
  price_cents        INTEGER NOT NULL DEFAULT 990 CHECK (price_cents >= 0),
  is_for_sale        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order         INTEGER NOT NULL DEFAULT 0,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tb_user_function_purchase (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  id_user                UUID NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  feature_key            TEXT NOT NULL,
  id_product             UUID REFERENCES public.tb_function_product(id) ON DELETE SET NULL,
  status                 TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending','paid','failed','expired')),
  amount_cents           INTEGER NOT NULL DEFAULT 0 CHECK (amount_cents >= 0),
  -- 'stripe' | 'admin_grant' (concessão manual do admin, amount 0)
  payment_provider       TEXT NOT NULL DEFAULT 'stripe',
  stripe_session_id      TEXT,
  stripe_payment_intent  TEXT,
  paid_at                TIMESTAMPTZ,
  refunded_at            TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_user_function_purchase_session
  ON public.tb_user_function_purchase (stripe_session_id)
  WHERE stripe_session_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_user_function_purchase_user
  ON public.tb_user_function_purchase (id_user, feature_key);

CREATE INDEX IF NOT EXISTS ix_user_function_purchase_pi
  ON public.tb_user_function_purchase (stripe_payment_intent)
  WHERE stripe_payment_intent IS NOT NULL;

-- Seed do catálogo: uma linha por função da whitelist. Textos/cores/preços são
-- só o ponto de partida — o admin edita tudo em /administracao/loja-funcoes.
INSERT INTO public.tb_function_product
  (feature_key, nav_label, eyebrow, headline, short_description, full_description,
   background_color, accent_color, text_color, placeholder_color, price_cents, is_for_sale, sort_order)
VALUES
  ('courses', 'Cursos', 'FUNÇÃO 01', 'CURSOS',
   'Crie, publique e venda cursos em vídeo com módulos, aulas, materiais e questionários.',
   'Com a função Cursos você monta cursos completos dentro da Freelandoo: módulos, aulas em vídeo, PDFs, questionários e página de vendas própria. Acompanhe alunos, receita e progresso — tudo integrado ao seu perfil.',
   '#0F3D5C', '#FFD166', '#FFFFFF', '#0A2A40', 990, TRUE, 10),
  ('store', 'Loja', 'FUNÇÃO 02', 'LOJA',
   'Venda produtos físicos com checkout, frete via Melhor Envio e repasse direto pra sua carteira.',
   'A função Loja transforma seu perfil numa vitrine de produtos físicos: cadastro com fotos e atributos, checkout Stripe, cálculo de frete, etiqueta de envio e histórico de vendas com repasse pro seu saldo.',
   '#B23A0F', '#FFD166', '#FFFFFF', '#7C2A0C', 990, TRUE, 20),
  ('services', 'Serviços', 'FUNÇÃO 03', 'SERVIÇOS',
   'Publique serviços com preço, prazo e agendamento pago direto no seu perfil.',
   'Com a função Serviços seus perfis exibem ofertas com preço listado e botão de agendamento. O cliente paga o sinal pelo site e o horário entra na sua agenda automaticamente.',
   '#14532D', '#FDE047', '#FFFFFF', '#0C3A1E', 990, TRUE, 30),
  ('vaquinha', 'Vaquinha', 'FUNÇÃO 04', 'VAQUINHA',
   'Arrecade doações com meta, prazo e repasse pro seu saldo — ou crie uma Bolsa de patrocínio mensal.',
   'A função Vaquinha permite criar campanhas de arrecadação com meta e prazo, ou Bolsas de patrocínio recorrente. As doações caem no seu saldo com holdback de segurança e a página da campanha é pública para compartilhar.',
   '#9D174D', '#FDE68A', '#FFFFFF', '#701235', 990, TRUE, 40),
  ('communities', 'Comunidade', 'FUNÇÃO 05', 'COMUNIDADE',
   'Crie comunidades públicas ou privadas com feed, recados e mensalidade dos membros.',
   'Com a função Comunidade você reúne seguidores num espaço próprio: feed exclusivo, recados, membros e — se quiser — mensalidade paga com repasse direto pra você.',
   '#3730A3', '#FBBF24', '#FFFFFF', '#272075', 990, TRUE, 50),
  ('wallet', 'Carteira', 'FUNÇÃO 06', 'CARTEIRA',
   'Acompanhe saldo, extrato e vida financeira da sua conta em um só lugar.',
   'A função Carteira abre o painel financeiro da conta: saldo disponível, extrato de ganhos e repasses, recibos e a visão de vida financeira com seus investimentos.',
   '#713F12', '#FDE047', '#FFFFFF', '#52300D', 990, TRUE, 60),
  ('fitness_academias', 'Academia', 'FUNÇÃO 07', 'FITNESS',
   'Painel fitness pessoal: treinos, dieta, água, medidas e conexão com sua academia.',
   'Com a função Academia você monta fichas de treino, registra calorias e água, acompanha medidas e indicadores — e conecta sua conta à academia para frequência, mensalidades e professor.',
   '#1F2937', '#F2B705', '#FFFFFF', '#111827', 990, TRUE, 70),
  ('profiles', 'Perfis', 'FUNÇÃO 08', 'PERFIS',
   'Crie subperfis independentes: cada frente sua com posts, redes e vitrine próprios.',
   'A função Perfis libera a aba Perfis da conta: crie subperfis para cada frente do seu trabalho, cada um com portfólio, redes sociais e presença na vitrine — tudo sob a mesma conta.',
   '#155E75', '#FDE047', '#FFFFFF', '#0E4152', 990, TRUE, 80),
  ('agenda', 'Agenda', 'FUNÇÃO 09', 'AGENDA',
   'Agenda unificada da conta: horários, regras semanais e agendamentos de todos os perfis.',
   'Com a função Agenda você controla a disponibilidade da conta inteira: regras semanais, exceções e todos os agendamentos dos seus perfis num calendário só, sem conflito de horário.',
   '#B45309', '#FFE08A', '#FFFFFF', '#7C3A06', 990, TRUE, 90),
  ('vitrine', 'Vitrine', 'FUNÇÃO 10', 'VITRINE',
   'Seus perfis na vitrine pública da Freelandoo, encontráveis por qualquer cliente.',
   'A função Vitrine coloca seus perfis na busca pública da Freelandoo, onde clientes encontram profissionais por cidade, profissão e enxame.',
   '#0F766E', '#FDE047', '#FFFFFF', '#0A544E', 0, FALSE, 100)
ON CONFLICT (feature_key) DO NOTHING;
