-- =============================================================================
-- Migration 104: Monetization Onboarding — seed dos 5 caminhos + steps
-- =============================================================================
-- Idempotente: usa ON CONFLICT (path_key) DO NOTHING e ON CONFLICT
-- (path_id, step_order) DO NOTHING. Edits do admin nunca são sobrescritos.
--
-- Marca is_seed = TRUE pra bloquear delete dos 5 caminhos fixos.

-- ---------- 1. Caminhos -------------------------------------------------------
INSERT INTO public.tour_monetization_paths
  (path_key, title, description, cta_label, sort_order, is_active, is_seed, version)
VALUES
  ('affiliate', 'Indicar e ganhar',
   'Compartilhe a Freelandoo com sua rede e receba comissão a cada assinatura, curso ou produto vendido pelo seu link.',
   'Quero indicar', 1, TRUE, TRUE, 1),
  ('courses', 'Ensinar e ganhar',
   'Crie cursos com aulas em vídeo, quiz e materiais. Ganhe a cada matrícula paga em Reais ou Poléns.',
   'Quero ensinar', 2, TRUE, TRUE, 1),
  ('products', 'Vender produtos',
   'Monte sua loja dentro do seu subperfil. Estoque, frete pelo Melhor Envio e checkout Stripe — tudo automatizado.',
   'Quero vender produtos', 3, TRUE, TRUE, 1),
  ('services', 'Vender serviços',
   'Anuncie seu trabalho na vitrine, receba pedidos diretos e gerencie sua agenda. Você só paga a assinatura do subperfil.',
   'Quero vender serviços', 4, TRUE, TRUE, 1),
  ('explore', 'Só explorando',
   'Sem pressa. Veja como a Freelandoo funciona antes de decidir como quer monetizar.',
   'Quero conhecer', 5, TRUE, TRUE, 1)
ON CONFLICT (path_key) DO NOTHING;

-- ---------- 2. Steps — affiliate (4 steps) -----------------------------------
WITH p AS (SELECT id FROM public.tour_monetization_paths WHERE path_key = 'affiliate' LIMIT 1)
INSERT INTO public.tour_path_steps
  (path_id, step_order, route, target_selector, wait_for_selector, placement, title, content)
SELECT p.id, v.step_order, v.route, v.target_selector, v.wait_for_selector, v.placement, v.title, v.content
FROM p, (VALUES
  (1, '/account',           '[data-tour-path="affiliate-dropside"]',  '[data-tour-path="affiliate-dropside"]',  'right',
   'Seu link de indicação', 'Abra o menu da sua conta e procure por "Indique e ganhe". É lá que mora seu link único.'),
  (2, '/account/afiliados',  '[data-tour-path="affiliate-link"]',      '[data-tour-path="affiliate-link"]',      'bottom',
   'Compartilhe onde quiser', 'Cole esse link em redes sociais, grupos ou converse com clientes. Cada cadastro que vier por ele fica vinculado a você.'),
  (3, '/account/afiliados',  '[data-tour-path="affiliate-coupon"]',    '[data-tour-path="affiliate-coupon"]',    'bottom',
   'Cupom personalizado',     'Crie um cupom com seu nome — dá desconto pro cliente e comissão pra você. Funciona em assinatura, cursos, Poléns e produtos.'),
  (4, '/account/faturamentos', '[data-tour-path="affiliate-earnings"]', '[data-tour-path="affiliate-earnings"]', 'top',
   'Acompanhe seus ganhos',   'Aqui você vê comissões aguardando (8 dias de holdback) e o que já caiu na sua conta.')
) AS v(step_order, route, target_selector, wait_for_selector, placement, title, content)
ON CONFLICT (path_id, step_order) DO NOTHING;

-- ---------- 3. Steps — courses (4 steps) -------------------------------------
WITH p AS (SELECT id FROM public.tour_monetization_paths WHERE path_key = 'courses' LIMIT 1)
INSERT INTO public.tour_path_steps
  (path_id, step_order, route, target_selector, wait_for_selector, placement, title, content)
SELECT p.id, v.step_order, v.route, v.target_selector, v.wait_for_selector, v.placement, v.title, v.content
FROM p, (VALUES
  (1, '/cursos',                  '[data-tour-path="courses-home"]',     '[data-tour-path="courses-home"]',     'bottom',
   'Galeria de cursos',          'Aqui você vê todos os cursos publicados. Os seus aparecem com botão de edição quando estiver logado.'),
  (2, '/cursos/criar',             '[data-tour-path="courses-create"]',   '[data-tour-path="courses-create"]',   'bottom',
   'Crie seu primeiro curso',    'Nome, capa, descrição e preço (R$ ou Poléns). Você pode começar com 1 módulo e adicionar mais depois.'),
  (3, '/cursos/criar',             '[data-tour-path="courses-modules"]',  '[data-tour-path="courses-modules"]',  'right',
   'Módulos e aulas',            'Cada módulo agrupa aulas em vídeo. Você pode anexar PDFs, links e até quiz com nota.'),
  (4, '/cursos',                  '[data-tour-path="courses-publish"]',  '[data-tour-path="courses-publish"]',  'top',
   'Publicar',                   'Quando estiver pronto, publique. O curso aparece na galeria e em afiliados podem indicar com cupom.')
) AS v(step_order, route, target_selector, wait_for_selector, placement, title, content)
ON CONFLICT (path_id, step_order) DO NOTHING;

-- ---------- 4. Steps — products (4 steps) ------------------------------------
WITH p AS (SELECT id FROM public.tour_monetization_paths WHERE path_key = 'products' LIMIT 1)
INSERT INTO public.tour_path_steps
  (path_id, step_order, route, target_selector, wait_for_selector, placement, title, content)
SELECT p.id, v.step_order, v.route, v.target_selector, v.wait_for_selector, v.placement, v.title, v.content
FROM p, (VALUES
  (1, '/loja',                    '[data-tour-path="store-home"]',       '[data-tour-path="store-home"]',       'bottom',
   'Loja Freelandoo',            'Vitrine de produtos físicos. Para vender, você precisa de um subperfil ativo com assinatura.'),
  (2, '/account/loja/criar',       '[data-tour-path="store-create"]',     '[data-tour-path="store-create"]',     'bottom',
   'Cadastre um produto',        'Fotos, descrição, preço, peso e dimensões — o peso/dimensão é usado pelo Melhor Envio pra calcular o frete.'),
  (3, '/account/loja',             '[data-tour-path="store-stock"]',      '[data-tour-path="store-stock"]',      'right',
   'Estoque e categorias',       'Defina quantidade em estoque e em qual categoria entra. Sem estoque, o botão "comprar" some.'),
  (4, '/account/loja/vendas',      '[data-tour-path="store-orders"]',     '[data-tour-path="store-orders"]',     'top',
   'Vendas e etiquetas',         'Pedidos chegam aqui. A etiqueta do Melhor Envio é gerada automaticamente — só imprimir e despachar.')
) AS v(step_order, route, target_selector, wait_for_selector, placement, title, content)
ON CONFLICT (path_id, step_order) DO NOTHING;

-- ---------- 5. Steps — services (4 steps) ------------------------------------
WITH p AS (SELECT id FROM public.tour_monetization_paths WHERE path_key = 'services' LIMIT 1)
INSERT INTO public.tour_path_steps
  (path_id, step_order, route, target_selector, wait_for_selector, placement, title, content)
SELECT p.id, v.step_order, v.route, v.target_selector, v.wait_for_selector, v.placement, v.title, v.content
FROM p, (VALUES
  (1, '/search',                  '[data-tour-path="services-vitrine"]', '[data-tour-path="services-vitrine"]', 'bottom',
   'Vitrine de profissionais',   'Aqui clientes encontram quem oferece serviço. Você aparece aqui depois de criar um subperfil pago.'),
  (2, '/account',                 '[data-tour-path="services-subprofile"]', '[data-tour-path="services-subprofile"]', 'right',
   'Crie um subperfil',          'Cada subperfil é uma profissão diferente. Assinatura R$300/ano, fica visível na vitrine e recebe pedidos.'),
  (3, '/account',                 '[data-tour-path="services-agenda"]',  '[data-tour-path="services-agenda"]',  'right',
   'Sua agenda',                 'Defina horários, valores e raio de atendimento. Clientes agendam direto pela sua página.'),
  (4, '/account/agendamentos',     '[data-tour-path="services-bookings"]', '[data-tour-path="services-bookings"]', 'top',
   'Receber por agendamento',    'Pagamentos de bookings entram com 8 dias de holdback (CDC) e depois caem no seu saldo.')
) AS v(step_order, route, target_selector, wait_for_selector, placement, title, content)
ON CONFLICT (path_id, step_order) DO NOTHING;

-- ---------- 6. Steps — explore (3 steps) -------------------------------------
WITH p AS (SELECT id FROM public.tour_monetization_paths WHERE path_key = 'explore' LIMIT 1)
INSERT INTO public.tour_path_steps
  (path_id, step_order, route, target_selector, wait_for_selector, placement, title, content)
SELECT p.id, v.step_order, v.route, v.target_selector, v.wait_for_selector, v.placement, v.title, v.content
FROM p, (VALUES
  (1, '/',         '[data-tour-path="explore-home"]',   '[data-tour-path="explore-home"]',   'bottom',
   'Início',      'A home traz destaques de profissionais, cursos e produtos. Comece por aqui pra ter uma noção do que rola.'),
  (2, '/search',   '[data-tour-path="explore-search"]', '[data-tour-path="explore-search"]', 'bottom',
   'Vitrine',     'A vitrine separa profissionais por enxame (categoria). Use os filtros pra encontrar pelo que precisa.'),
  (3, '/feed',     '[data-tour-path="explore-feed"]',   '[data-tour-path="explore-feed"]',   'bottom',
   'Feed',        'Posts e bees (vídeos) dos profissionais que você seguir aparecem aqui. Dá pra curtir, comentar e mandar mensagem.')
) AS v(step_order, route, target_selector, wait_for_selector, placement, title, content)
ON CONFLICT (path_id, step_order) DO NOTHING;
