-- =============================================================================
-- Migration 186: Preferências de funções POR USUÁRIO (seção "Funções" do menu)
-- =============================================================================
-- Análogo pessoal do Painel de Controle (mig 168): cada usuário pode desligar
-- funções da PRÓPRIA experiência (Cursos, Loja, Vaquinha, Comunidade, Carteira,
-- Academia). É preferência de UI — esconde os pontos de entrada no front do
-- próprio usuário; NÃO bloqueia rotas no backend e NÃO afeta outros usuários.
-- A flag global do admin continua mandando: desligada no Painel de Controle,
-- a função some pra todo mundo independente da preferência pessoal.
--
-- Sem linha na tabela = ligado (default). Só gravamos quando o usuário mexe.
-- Idempotente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.tb_user_feature_pref (
  id_user     UUID         NOT NULL REFERENCES public.tb_user(id_user) ON DELETE CASCADE,
  feature_key TEXT         NOT NULL,
  is_enabled  BOOLEAN      NOT NULL DEFAULT TRUE,
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id_user, feature_key)
);
