-- =============================================================================
-- Migration 242: A OFERTA DO SITE PRONTO — o cliente aceita, e só então troca
-- =============================================================================
-- Decisão do Alex (2026-09-12): "quando eu clicar no site pronto, o sistema
-- checa se tem um site pronto disponível para aquela conta e abre um modal para
-- aceitar a substituição; se aceitar, troca ali".
--
-- A mig 241 abriu a brecha e deu a porta de escrita à PLATAFORMA. O que faltava
-- era o gesto do CLIENTE: ele não tinha como dizer sim. Até aqui, ligar o site
-- pronto era um botão nosso — trocávamos o site de alguém sem que essa pessoa
-- apertasse nada.
--
-- ─── ⚠️ ACEITAR NÃO É ESCREVER, E É ISSO QUE MANTÉM AS TRÊS TRAVAS ──────────
--
-- A tentação aqui é dar ao cliente uma rota que grava `template` +
-- `template_data`. Seria exatamente a brecha que a 241 trancou (ler o cabeçalho
-- dela e `utils/managedSite.js`): qualquer líder passaria a apontar o próprio
-- site para um tema nosso, com o conteúdo que ele quisesse.
--
-- Por isso o CONTEÚDO É GRAVADO AQUI, por nós, ANTES — e a rota do cliente não
-- aceita `data` em lugar nenhum do corpo. Ela recebe o ID de uma oferta que já
-- está no banco e COPIA. O que o cliente decide é "sim" ou "não"; o que o site
-- vai dizer continua sendo escrito por quem tem o papel de admin.
--
-- É a mesma forma da proposta do professor (mig 180): quem propõe escreve, quem
-- recebe só aceita — e o payload do aceite é o id, nunca o conteúdo.
--
-- ─── POR QUE TABELA, E NÃO MAIS DUAS COLUNAS EM tb_community_site ───────────
--
--   1. A OFERTA EXISTE ANTES DO SITE. Comunidade que nunca abriu o construtor
--      não tem linha em `tb_community_site` (é o 404 "este negócio ainda não
--      tem site" do painel), e é justamente para quem nunca montou nada que o
--      site pronto mais vale. Colunas lá dentro obrigariam a criar uma linha de
--      site só para guardar uma proposta que talvez seja recusada.
--   2. A OFERTA TEM CICLO DE VIDA (preparada → aceita, ou retirada) e AUTORIA.
--      Em colunas soltas isso vira quatro campos que só têm sentido entre dois
--      cliques, no meio da tabela que descreve o site que está no ar.
--   3. `tb_community_site` tem HOJE uma porta de escrita só para estas colunas
--      (`setManaged`), e é disso que a trava nº 3 é feita. Cada coluna nova ali
--      é mais uma coisa que alguém pode confundir com o documento.
--
-- ─── UMA OFERTA VIVA POR COMUNIDADE ────────────────────────────────────────
--
-- O índice parcial `WHERE status = 'pending'` é o que garante isso — mesma
-- forma da fila de fraude (mig 201) e do vínculo de morador (mig 203). Duas
-- pendentes ao mesmo tempo fariam o painel do cliente mostrar uma e o aceite
-- aplicar a outra, decidido pela ordem de busca.
--
-- ⚠️ REVISAR UMA OFERTA CRIA LINHA NOVA e retira a anterior, em vez de editar a
-- pendente. O motivo é o aceite: ele vem pinado no `id_offer` que o cliente
-- ESTAVA VENDO. Editando a linha no lugar, o id não mudaria e ele confirmaria
-- um texto que nunca leu — é o mesmo raciocínio do `if_version`. A linha
-- retirada fica: é o histórico do que foi oferecido e quando.
--
-- ─── SEM 'declined', DE PROPÓSITO ──────────────────────────────────────────
--
-- Fechar o modal é "agora não", e a oferta continua esperando. Um botão de
-- recusar que APAGA a oferta tiraria do cliente um produto que ele pagou, por
-- um clique de curiosidade — e reoferecê-la dependeria de alguém aqui perceber.
-- Estado que ninguém alimenta é convite para alguém religar (a lição de
-- `communityDefaultExclusive` e do `hideHeader` órfão), então ele não existe no
-- CHECK: se um dia houver o botão, ele entra junto.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_managed_site_offer (
  id_offer        UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- A oferta é reservada para a COMUNIDADE, não para a pessoa: o site mora na
  -- comunidade, e quem tem duas de negócio precisaria escolher onde aplicar.
  -- Quem ACEITA é o líder dela, lido na hora — pendurar a oferta no id de quem
  -- lidera hoje faria a troca de liderança levar o site junto.
  id_profile      UUID NOT NULL
                    REFERENCES public.tb_profile (id_profile) ON DELETE CASCADE,

  -- O tema e o conteúdo, na MESMA forma das colunas de `tb_community_site` —
  -- aceitar é uma cópia, e formatos diferentes exigiriam uma conversão no meio
  -- do caminho mais sensível da feature.
  template        VARCHAR(64) NOT NULL,
  template_data   JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- O recado que o cliente lê no modal ("montamos a partir do que você já tinha
  -- escrito"). Vazio é legítimo: o painel mostra o resumo mesmo sem ele.
  note            TEXT NULL,

  status          VARCHAR(16) NOT NULL DEFAULT 'pending',

  -- Quem preparou. SET NULL e não CASCADE: apagar a conta de quem montou não
  -- pode levar embora o site que o cliente está usando.
  created_by_user UUID NULL
                    REFERENCES public.tb_user (id_user) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Quando saiu de 'pending'. NULL enquanto espera.
  decided_at      TIMESTAMPTZ NULL
);

-- O CHECK é NOMEADO: sem nome, o Postgres gera um e a próxima migration que
-- precisar alargar a lista teria de varrer o catálogo para achá-lo — é o que
-- custou caro na vaga de condomínio (mig 198). Um DROP antes do ADD mantém a
-- migration idempotente e deixa a lista alargável pelo nome.
ALTER TABLE public.tb_managed_site_offer
  DROP CONSTRAINT IF EXISTS chk_managed_site_offer_status;
ALTER TABLE public.tb_managed_site_offer
  ADD CONSTRAINT chk_managed_site_offer_status
  CHECK (status IN ('pending', 'accepted', 'withdrawn'));

-- ⚠️ A unicidade da oferta VIVA. É ela que faz "o site pronto que está
-- reservado para você" ser uma coisa só, e não a primeira que a busca achar.
CREATE UNIQUE INDEX IF NOT EXISTS ux_managed_site_offer_pending
  ON public.tb_managed_site_offer (id_profile)
  WHERE status = 'pending';

-- A leitura do histórico de uma comunidade (o painel de admin) e do que já foi
-- aceito. A parcial acima não serve aqui: ela só enxerga a pendente.
CREATE INDEX IF NOT EXISTS ix_managed_site_offer_profile
  ON public.tb_managed_site_offer (id_profile, created_at DESC);

COMMENT ON TABLE public.tb_managed_site_offer IS
  'Site pronto escrito por nos e reservado para uma comunidade. O cliente aceita e o conteudo e COPIADO para tb_community_site. A rota do cliente nunca recebe conteudo - so o id_offer.';
COMMENT ON COLUMN public.tb_managed_site_offer.status IS
  'pending = esperando o cliente; accepted = ja aplicado; withdrawn = retirada por nos ou substituida por uma revisao.';
COMMENT ON COLUMN public.tb_managed_site_offer.template_data IS
  'Mesmo formato de tb_community_site.template_data. Validado por utils/siteTemplates.js ANTES de gravar aqui - aceitar nao re-valida o que ja passou pela porta de admin.';
