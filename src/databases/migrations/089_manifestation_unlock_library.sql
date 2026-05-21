-- =============================================================================
-- Migration 089: Manifestação — modelo "biblioteca de desbloqueios" + seed 30 banners
-- =============================================================================
-- Reaproveita as tabelas existentes (036/037). Muda o modelo de posse:
--   ANTES: 1 manifestação ativa por user, alugada (expira), compra substitui.
--   AGORA: usuário desbloqueia VÁRIAS manifestações (permanente, 50 poléns cada)
--          e aplica UMA por vez (is_active = a manifestação exibida no headcard).
-- tag_*/stripe_*/duration_days/stock continuam como colunas LEGADAS opcionais
-- (o admin antigo ainda as usa; a loja nova as ignora).
-- Idempotente: ADD COLUMN IF NOT EXISTS, DROP CONSTRAINT IF EXISTS, ON CONFLICT.

-- ---------------------------------------------------------------------------
-- 1. manifestation_products: slug + type + headline
-- ---------------------------------------------------------------------------
ALTER TABLE public.manifestation_products
  ADD COLUMN IF NOT EXISTS slug     TEXT,
  ADD COLUMN IF NOT EXISTS type     TEXT,
  ADD COLUMN IF NOT EXISTS headline TEXT;

-- A loja nova não usa tag — tag_label deixa de ser obrigatória.
ALTER TABLE public.manifestation_products
  ALTER COLUMN tag_label DROP NOT NULL;

-- type: motivational | emotion (nullable — produtos legados podem não ter).
ALTER TABLE public.manifestation_products
  DROP CONSTRAINT IF EXISTS manifestation_products_type_chk;
ALTER TABLE public.manifestation_products
  ADD CONSTRAINT manifestation_products_type_chk
  CHECK (type IS NULL OR type IN ('motivational', 'emotion'));

-- slug único (índice não-parcial: múltiplos NULL coexistem; habilita ON CONFLICT).
CREATE UNIQUE INDEX IF NOT EXISTS ux_manifestation_products_slug
  ON public.manifestation_products (slug);

-- ---------------------------------------------------------------------------
-- 2. user_manifestations: modelo biblioteca
-- ---------------------------------------------------------------------------
-- Desbloqueio é permanente — expires_at deixa de ser obrigatório.
ALTER TABLE public.user_manifestations
  ALTER COLUMN expires_at DROP NOT NULL;

-- Compra entra como NÃO aplicada; "Usar" é uma ação separada.
ALTER TABLE public.user_manifestations
  ALTER COLUMN is_active SET DEFAULT FALSE;

-- payment_method agora cobre também concessão admin e liberação grátis.
ALTER TABLE public.user_manifestations
  DROP CONSTRAINT IF EXISTS user_manifestations_payment_method_check;
ALTER TABLE public.user_manifestations
  ADD CONSTRAINT user_manifestations_payment_method_check
  CHECK (payment_method IN ('stripe', 'polens', 'admin', 'free'));

-- Dedupe defensivo: o modelo antigo permitia re-compra do mesmo produto.
-- Mantém a linha mais recente por (user_id, product_id) antes do índice único.
DELETE FROM public.user_manifestations a
 USING public.user_manifestations b
 WHERE a.user_id = b.user_id
   AND a.product_id = b.product_id
   AND (a.acquired_at < b.acquired_at
        OR (a.acquired_at = b.acquired_at AND a.ctid < b.ctid));

-- Um desbloqueio por (user, produto) — impede débito duplicado (idempotência).
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_manifestations_user_product
  ON public.user_manifestations (user_id, product_id);

-- ux_user_manifestations_active (1 linha is_active=TRUE por user) continua válido:
-- agora significa "a manifestação aplicada no headcard".

-- ---------------------------------------------------------------------------
-- 3. Seed das 30 manifestações (idempotente via ON CONFLICT (slug))
-- ---------------------------------------------------------------------------
-- Imagens estáticas servidas pelo frontend em /public/banners-manifestacao/.
-- Cria as 30 com preço inicial de 50 Poléns. ON CONFLICT DO NOTHING: depois da
-- 1ª criação o admin é o dono da linha (preço em Poléns/R$, status, imagem) —
-- o seed nunca sobrescreve edições feitas no painel admin.
INSERT INTO public.manifestation_products
  (slug, name, type, headline, description, banner_url, price_polens, price_cents, is_active, sort_order)
VALUES
  ('prosperidade','Prosperidade','motivational','Em fase de crescimento.','Para quem está focado em dinheiro, avanço e expansão.','/banners-manifestacao/prosperidade.png',50,0,TRUE,1),
  ('resiliencia','Resiliência','motivational','Cai, levanta e continua.','Para quem segue firme mesmo depois de dificuldade.','/banners-manifestacao/resiliencia.png',50,0,TRUE,2),
  ('ambicao','Ambição','motivational','Eu não vim para ficar no mesmo lugar.','Para quem quer crescer, conquistar e subir de nível.','/banners-manifestacao/ambicao.png',50,0,TRUE,3),
  ('disciplina','Disciplina','motivational','Todo dia um pouco mais forte.','Para quem acredita em constância, rotina e execução.','/banners-manifestacao/disciplina.png',50,0,TRUE,4),
  ('evolucao','Evolução','motivational','Subindo de nível.','Para quem está melhorando, ganhando XP e avançando.','/banners-manifestacao/evolucao.png',50,0,TRUE,5),
  ('coragem','Coragem','motivational','Vai com medo mesmo.','Para quem age mesmo sem ter certeza absoluta.','/banners-manifestacao/coragem.png',50,0,TRUE,6),
  ('foco','Foco','motivational','Sem distração. Só execução.','Para quem está concentrado em uma meta.','/banners-manifestacao/foco.png',50,0,TRUE,7),
  ('vitoria','Vitória','motivational','Hoje é dia de ganhar.','Para quem está em clima de conquista.','/banners-manifestacao/vitoria.png',50,0,TRUE,8),
  ('liberdade','Liberdade','motivational','Trabalhando pelo meu próprio caminho.','Para quem busca autonomia e independência.','/banners-manifestacao/liberdade.png',50,0,TRUE,9),
  ('determinacao','Determinação','motivational','Não paro até acontecer.','Para quem está decidido a continuar.','/banners-manifestacao/determinacao.png',50,0,TRUE,10),
  ('alegria','Alegria','emotion','Energia boa que contagia.','Estado de alegria, brilho e energia positiva.','/banners-manifestacao/alegria.png',50,0,TRUE,11),
  ('bravo','Bravo','emotion','Fúria pronta pra explodir.','Estado de intensidade, irritação e reação.','/banners-manifestacao/bravo.png',50,0,TRUE,12),
  ('raiva','Raiva','emotion','Calor que pede descarga.','Estado de explosão emocional, tensão e descarga.','/banners-manifestacao/raiva.png',50,0,TRUE,13),
  ('feliz','Feliz','emotion','Sorriso leve, coração aberto.','Estado de felicidade, leveza e positividade.','/banners-manifestacao/feliz.png',50,0,TRUE,14),
  ('alegre','Alegre','emotion','Energia boa que contagia.','Estado de animação, celebração e entusiasmo.','/banners-manifestacao/alegre.png',50,0,TRUE,15),
  ('cansado','Cansado','emotion','Corpo pede pausa, mente também.','Estado de exaustão, baixa energia e necessidade de descanso.','/banners-manifestacao/cansado.png',50,0,TRUE,16),
  ('ansioso','Ansioso','emotion','Pensamento acelerado, peito inquieto.','Estado de agitação, tensão mental e expectativa.','/banners-manifestacao/ansioso.png',50,0,TRUE,17),
  ('depre','Deprê','emotion','Silêncio pesado por dentro.','Estado de tristeza, melancolia e recolhimento.','/banners-manifestacao/depre.png',50,0,TRUE,18),
  ('fome','Fome','emotion','Barriga ronca, vontade chama.','Estado de desejo por comida, apetite e vontade.','/banners-manifestacao/fome.png',50,0,TRUE,19),
  ('carente','Carente','emotion','Falta abraço, sobra saudade.','Estado de necessidade de afeto, atenção e conexão.','/banners-manifestacao/carente.png',50,0,TRUE,20),
  ('solteiro','Solteiro','emotion','Livre, leve e sem amarras.','Estado de independência afetiva, liberdade e leveza.','/banners-manifestacao/solteiro.png',50,0,TRUE,21),
  ('apaixonado','Apaixonado','emotion','Coração aceso, alma presente.','Estado de paixão, conexão e intensidade afetiva.','/banners-manifestacao/apaixonado.png',50,0,TRUE,22),
  ('confiante','Confiante','emotion','Eu sei o meu valor.','Estado de segurança, autoestima e presença.','/banners-manifestacao/confiante.png',50,0,TRUE,23),
  ('esperancoso','Esperançoso','emotion','Ainda tem luz no caminho.','Estado de esperança, otimismo e visão de futuro.','/banners-manifestacao/esperancoso.png',50,0,TRUE,24),
  ('grato','Grato','emotion','Reconheço cada conquista.','Estado de gratidão, reconhecimento e abundância emocional.','/banners-manifestacao/grato.png',50,0,TRUE,25),
  ('ousado','Ousado','emotion','Sem medo de tentar.','Estado de coragem social, atitude e energia de risco.','/banners-manifestacao/ousado.png',50,0,TRUE,26),
  ('sereno','Sereno','emotion','Paz que vem de dentro.','Estado de tranquilidade, equilíbrio e paz emocional.','/banners-manifestacao/sereno.png',50,0,TRUE,27),
  ('livre','Livre','emotion','Leveza para ser quem sou.','Estado de liberdade, leveza e autenticidade.','/banners-manifestacao/livre.png',50,0,TRUE,28),
  ('calmo','Calmo','emotion','Silêncio que fortalece.','Estado de calma, controle emocional e estabilidade.','/banners-manifestacao/calmo.png',50,0,TRUE,29),
  ('inspirado','Inspirado','emotion','Ideia acesa.','Estado de criatividade, imaginação e produção.','/banners-manifestacao/inspirado.png',50,0,TRUE,30)
ON CONFLICT (slug) DO NOTHING;
